"""Primeiro protótipo: triagem espectral exploratória, não um detector validado de café.

Uso: python -m geo_worker.processing data/sample/imagem_multiespectral.tif --scl data/sample/qualidade_scl.tif --output experiments/outputs/baseline
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from pyproj import Geod
from rasterio.features import shapes
from rasterio.warp import Resampling, calculate_default_transform, reproject, transform_geom
from scipy import ndimage
from shapely.geometry import shape


INDEX_THRESHOLDS = {
    "ndvi_min": 0.60,
    "gndvi_min": 0.25,
    "evi2_min": 0.25,
}
GEOD = Geod(ellps="WGS84")
MAX_PIXELS = 16_000_000


def _normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    denom = a + b
    result = np.zeros_like(a, dtype=np.float32)
    np.divide(a - b, denom, out=result, where=np.abs(denom) > 1e-6)
    return result


def _load_scl(scl_path: Path, reference: rasterio.io.DatasetReader) -> np.ndarray:
    """Alinha classes categóricas de 20 m a 10 m usando vizinho mais próximo."""
    scl = np.zeros((reference.height, reference.width), dtype=np.uint8)
    with rasterio.open(scl_path) as source:
        if source.count != 1 or source.crs is None:
            raise ValueError("A máscara SCL precisa ter uma banda e CRS válido.")
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


def _polygons(binary: np.ndarray, transform, crs, min_area_ha: float):
    features = []
    for geometry, value in shapes(binary.astype("uint8"), mask=binary, transform=transform):
        if not value:
            continue
        wgs84 = transform_geom(crs, "EPSG:4326", geometry, precision=7)
        area_ha = abs(GEOD.geometry_area_perimeter(shape(wgs84))[0]) / 10_000
        if area_ha < min_area_ha:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": wgs84,
                "properties": {
                    "id": len(features) + 1,
                    "area_ha": round(area_ha, 4),
                    "class": "vegetacao_compativel_candidata",
                    "validated_coffee": False,
                },
            }
        )
    return features


def _visualize_rgb(reflectance: np.ndarray) -> Image.Image:
    """Composição visual RGB, sem modificar os dados usados na classificação."""
    rgb = reflectance[[2, 1, 0]].transpose(1, 2, 0)
    scaled = np.clip(rgb / 0.32, 0, 1) ** 0.75
    return Image.fromarray((255 * scaled).astype(np.uint8), "RGB").convert("RGBA")


def _draw_candidate_outlines(
    base: Image.Image, features_projected: list[dict], transform
) -> Image.Image:
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    inverse = ~transform
    for feature in features_projected:
        geometry = shape(feature)
        parts = [geometry] if geometry.geom_type == "Polygon" else geometry.geoms
        for part in parts:
            points = [tuple(inverse * point) for point in part.exterior.coords]
            if len(points) >= 3:
                draw.polygon(points, fill=(255, 174, 20, 75))
                draw.line(points, fill=(255, 122, 0, 245), width=2, joint="curve")
            for hole in part.interiors:
                # Não pinta cavidades como se fossem candidatas.
                draw.polygon([tuple(inverse * p) for p in hole.coords], fill=(0, 0, 0, 0))
    return Image.alpha_composite(base, overlay)


def _save_leaflet_raster(src: rasterio.io.DatasetReader, source_rgba: Image.Image, path: Path):
    """Gera PNG reamostrado em lon/lat, com limites utilizáveis no Leaflet."""
    dst_transform, width, height = calculate_default_transform(
        src.crs, "EPSG:4326", src.width, src.height, *src.bounds
    )
    src_data = np.asarray(source_rgba)
    warped = np.zeros((height, width, 4), dtype=np.uint8)
    for band in range(4):
        reproject(
            src_data[:, :, band],
            warped[:, :, band],
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=dst_transform,
            dst_crs="EPSG:4326",
            resampling=Resampling.nearest if band == 3 else Resampling.bilinear,
        )
    Image.fromarray(warped, "RGBA").save(path)
    left, top = dst_transform * (0, 0)
    right, bottom = dst_transform * (width, height)
    return [[round(bottom, 7), round(left, 7)], [round(top, 7), round(right, 7)]]


def process_scene(
    image_path: str | Path,
    output_dir: str | Path,
    scl_path: str | Path | None = None,
    acquisition_date: str | None = None,
    min_area_ha: float = 0.5,
) -> dict:
    """Executa cálculo real por upload; nunca retorna resultados fixos do exemplo."""
    image_path, output_dir = Path(image_path), Path(output_dir)
    if min_area_ha <= 0:
        raise ValueError("Área mínima deve ser positiva.")

    with rasterio.open(image_path) as src:
        if src.driver != "GTiff" or src.count != 4:
            raise ValueError("Use GeoTIFF com quatro bandas na ordem B02, B03, B04, B08.")
        if src.crs is None or src.transform.is_identity:
            raise ValueError("GeoTIFF sem georreferenciamento válido.")
        if src.width * src.height > MAX_PIXELS:
            raise ValueError("Imagem excede o limite de 16 milhões de pixels.")
        digital = src.read().astype(np.float32)
        valid = np.isfinite(digital).all(axis=0)
        if src.nodata is not None:
            valid &= (digital != src.nodata).all(axis=0)
        scales = np.array(src.scales, dtype=np.float32)[:, None, None]
        offsets = np.array(src.offsets, dtype=np.float32)[:, None, None]
        reflectance = digital * scales + offsets  # uma única conversão radiométrica
        blue, green, red, nir = reflectance

        ndvi = _normalized_difference(nir, red)
        gndvi = _normalized_difference(nir, green)
        evi2 = np.zeros_like(ndvi)
        divisor = nir + 2.4 * red + 1
        np.divide(2.5 * (nir - red), divisor, out=evi2, where=np.abs(divisor) > 1e-6)

        scl = _load_scl(Path(scl_path), src) if scl_path else None
        # SCL 4 = vegetação; 2/3 = sombra; 8/9/10 = nuvens; 11 = neve/gelo.
        clear_vegetation = valid & (scl == 4 if scl is not None else np.ones_like(valid))
        candidate_pixels = (
            clear_vegetation
            & (ndvi >= INDEX_THRESHOLDS["ndvi_min"])
            & (gndvi >= INDEX_THRESHOLDS["gndvi_min"])
            & (evi2 >= INDEX_THRESHOLDS["evi2_min"])
        )
        # Remove pontos isolados. Não resolve a diferenciação café/floresta.
        cleaned = ndimage.binary_opening(candidate_pixels, structure=np.ones((2, 2)))
        cleaned = ndimage.binary_closing(cleaned, structure=np.ones((2, 2)))
        features = _polygons(cleaned, src.transform, src.crs, min_area_ha)

        output_dir.mkdir(parents=True, exist_ok=True)
        geojson = {"type": "FeatureCollection", "features": features}
        (output_dir / "candidatos.geojson").write_text(
            json.dumps(geojson, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        rgb = _visualize_rgb(reflectance)
        rgb.save(output_dir / "imagem_rgb.png")
        geometries_projected = [
            transform_geom("EPSG:4326", src.crs, f["geometry"]) for f in features
        ]
        classified = _draw_candidate_outlines(rgb, geometries_projected, src.transform)
        classified.save(output_dir / "imagem_classificada.png")
        leaflet_bounds = _save_leaflet_raster(src, rgb, output_dir / "imagem_mapa.png")

        stats = {
            "image": image_path.name,
            "acquisition_date": acquisition_date,
            "crs_original": str(src.crs),
            "width": src.width,
            "height": src.height,
            "leaflet_bounds": leaflet_bounds,
            "scales": list(map(float, src.scales)),
            "offsets": list(map(float, src.offsets)),
            "valid_pixels": int(valid.sum()),
            "candidate_pixel_count_before_filter": int(candidate_pixels.sum()),
            "candidate_polygon_count": len(features),
            "candidate_area_ha": round(sum(f["properties"]["area_ha"] for f in features), 3),
            "ndvi_median": round(float(np.median(ndvi[valid])), 4) if valid.any() else None,
            "scl_applied": scl is not None,
            "method": "spectral_screening_v0",
            "index_thresholds": INDEX_THRESHOLDS,
            "min_area_ha": min_area_ha,
            "is_coffee_detection_validated": False,
            "warning": (
                "Triagem exploratória de vegetação compatível, NÃO identificação de café. "
                "Culturas não cafeeiras e vegetação nativa podem gerar falsos positivos; "
                "é necessário usar dados temporais e referência independente para validação."
            ),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        (output_dir / "resultado.json").write_text(
            json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--scl", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=Path("outputs"))
    parser.add_argument("--date", default=None)
    parser.add_argument("--min-area", type=float, default=0.5)
    args = parser.parse_args()
    print(
        json.dumps(
            process_scene(args.image, args.output, args.scl, args.date, args.min_area),
            ensure_ascii=False,
            indent=2,
        )
    )
