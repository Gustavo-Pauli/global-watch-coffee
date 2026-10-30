"""Validated reflectance and spectral predictors shared by inference and research."""
from pathlib import Path
from typing import NamedTuple

import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from scipy.ndimage import uniform_filter

BANDS = ["B02", "B03", "B04", "B08"]
EXTRA_BANDS = ["B05", "B06", "B07", "B8A", "B11", "B12"]
MAX_PIXELS = 16_000_000


class SceneData(NamedTuple):
    features: np.ndarray
    valid: np.ndarray
    reflectance: np.ndarray
    names: list[str]
    quality: dict
    source: dict
    ndvi_defined: np.ndarray

def align_scl(scl_path: Path, reference: rasterio.io.DatasetReader) -> np.ndarray:
    """Alinha classes categóricas de 20 m a 10 m usando vizinho mais próximo."""
    scl = np.zeros((reference.height, reference.width), dtype=np.uint8)
    with rasterio.open(scl_path) as source:
        if source.driver != 'GTiff' or source.count != 1 or source.crs is None:
            raise ValueError("A máscara SCL precisa ter uma banda e CRS válido.")
        if source.width * source.height > MAX_PIXELS:
            raise ValueError("A máscara SCL excede o limite de pixels.")
        reproject(
            source.read(1),
            scl,
            src_transform=source.transform,
            src_crs=source.crs,
            src_nodata=source.nodata,
            dst_transform=reference.transform,
            dst_crs=reference.crs,
            dst_nodata=0,
            resampling=Resampling.nearest,
        )
    return scl


def normalized_difference(a, b):
    out = np.zeros_like(a, dtype=np.float32)
    np.divide(a-b, a+b, out=out, where=np.abs(a+b)>1e-6)
    return out


def masked_local_stats(arr, valid, size=5):
    # NODATA e nuvens nunca contribuem como espectro preto nas estatísticas locais.
    v = valid.astype(np.float32)
    denom = np.maximum(uniform_filter(v, size=size, mode="constant") , 1e-6)
    mean = uniform_filter(np.where(valid, arr, 0), size=size, mode="constant") / denom
    squared = uniform_filter(np.where(valid, arr*arr, 0), size=size, mode="constant") / denom
    std = np.sqrt(np.maximum(squared - mean*mean, 0))
    return mean, std


def read_scene(image: Path, scl: Path | None = None, extra: Path | None = None) -> SceneData:
    with rasterio.open(image) as src:
        if src.driver != "GTiff" or src.count != 4 or src.crs is None or not src.crs.is_projected:
            raise ValueError("Envie GeoTIFF multiespectral de 4 bandas, com CRS projetado.")
        if src.width * src.height > MAX_PIXELS:
            raise ValueError("Imagem ultrapassa o limite de pixels permitido.")
        if (not np.isfinite(tuple(src.transform)).all() or src.transform.a <= 0
                or src.transform.e >= 0 or src.transform.b != 0 or src.transform.d != 0):
            raise ValueError("Grade geográfica inesperada (resolução/transform).")
        source = {
            "crs": str(src.crs),
            "resolution": {"x": float(src.res[0]), "y": float(src.res[1]), "unit": src.crs.linear_units},
            "bands": list(BANDS),
        }
        declared = [description.upper().strip().split('_', 1)[0].split(' ', 1)[0]
                    if description else None for description in src.descriptions]
        if any(declared) and declared != BANDS:
            raise ValueError("Ordem das bandas declaradas deve ser B02, B03, B04, B08.")
        raw = src.read().astype(np.float32)
        valid = (src.read_masks() != 0).all(axis=0) & np.isfinite(raw).all(axis=0)
        if src.nodata is not None:
            valid &= (raw != src.nodata).all(axis=0)
        scales = np.array(src.scales, dtype=np.float32)[:, None, None]
        offsets = np.array(src.offsets, dtype=np.float32)[:, None, None]
        if not np.isfinite(scales).all() or np.any(scales <= 0) or not np.isfinite(offsets).all():
            raise ValueError("Escalas radiométricas inválidas.")
        data = raw * scales + offsets  # usa metadados do upload; NÃO reaplica offset
        valid &= np.isfinite(data).all(axis=0)
        if valid.any() and np.max(np.abs(data[:, valid])) > 2:
            raise ValueError("Reflectância incompatível: confira os metadados de escala/offset do GeoTIFF.")
        blue, green, red, nir = data
        input_valid = valid.copy()
        if scl:
            valid &= np.isin(align_scl(scl, src), (4, 5))
        if not valid.any():
            raise ValueError("Imagem sem pixels válidos após aplicar NoData e máscara SCL.")
        ext_arrays = []
        if extra:
            with rasterio.open(extra) as ex:
                if ex.count != 6 or ex.crs is None:
                    raise ValueError("Bandas adicionais devem conter B05,B06,B07,B8A,B11,B12.")
                for i in range(6):
                    resampled = np.zeros(src.shape, dtype=np.float32)
                    reproject(rasterio.band(ex, i+1), resampled,
                              src_transform=ex.transform, src_crs=ex.crs,
                              src_nodata=ex.nodata, dst_transform=src.transform,
                              dst_crs=src.crs, resampling=Resampling.bilinear)
                    # Reamostrar os valores físicos, não os DN, quando escala/offset diferirem.
                    # A entrada extra deve ser reflectância float32, declarada pelas descrições.
                    if ex.dtypes[i] not in ('float32', 'float64') or ex.scales[i] != 1 or ex.offsets[i] != 0:
                        raise ValueError("Bandas extras devem estar em reflectância física float32 (sem scale/offset).")
                    ext_arrays.append(resampled)
                valid &= np.logical_and.reduce([np.isfinite(x) for x in ext_arrays])
                input_valid &= np.logical_and.reduce([np.isfinite(x) for x in ext_arrays])
    ndvi = normalized_difference(nir, red)
    gndvi = normalized_difference(nir, green)
    evi2 = np.zeros_like(ndvi)
    den = nir + 2.4 * red + 1
    np.divide(2.5*(nir-red), den, out=evi2, where=np.abs(den)>1e-6)
    ndm, nds = masked_local_stats(ndvi, valid)
    nirm, nirs = masked_local_stats(nir, valid)
    names = ["blue", "green", "red", "nir", "ndvi", "gndvi", "evi2", "ndvi_mean5", "ndvi_std5", "nir_mean5", "nir_std5", "nir_red_ratio"]
    arrays = [blue, green, red, nir, ndvi, gndvi, evi2, ndm, nds, nirm, nirs, nir/(red+1e-3)]
    if ext_arrays:
        b05,b06,b07,b8a,b11,b12 = ext_arrays
        arrays += ext_arrays + [normalized_difference(b8a,b05), normalized_difference(b8a,b11), normalized_difference(b8a,b12)]
        names += EXTRA_BANDS + ["ndre", "ndmi", "nbr"]
    stack = np.stack(arrays, axis=-1).astype('float32')
    stack = np.nan_to_num(stack, nan=0, posinf=0, neginf=0)
    # The classifier keeps its original predictors and eligibility. These extra
    # exclusions affect only the displayed NDVI and per-polygon NDVI means.
    ndvi_defined = valid & (np.abs(nir + red) > 1e-6) & np.isfinite(ndvi) & (ndvi >= -1) & (ndvi <= 1)
    total = int(valid.size)
    eligible = int(valid.sum())
    input_count = int(input_valid.sum())
    quality = {
        "total_pixels": total,
        "eligible_pixels": eligible,
        "input_invalid_pixels": total - input_count,
        "scl_excluded_pixels": input_count - eligible if scl else None,
        "scl_applied": bool(scl),
        # Match the nonnegative Math.round contract rather than bankers rounding.
        "eligible_percent": float(np.floor(eligible / total * 1000 + 0.5) / 10),
        "ndvi_defined_pixels": int(ndvi_defined.sum()),
    }
    return SceneData(stack, valid, data, names, quality, source, ndvi_defined)


def read_features(image: Path, scl: Path | None = None, extra: Path | None = None):
    """Preserve the four-value research/public API while inference uses read_scene."""
    scene = read_scene(image, scl, extra)
    return scene.features, scene.valid, scene.reflectance, scene.names
