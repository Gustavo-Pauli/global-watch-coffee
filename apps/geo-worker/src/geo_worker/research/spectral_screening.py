"""Historical spectral-screening baseline; not a validated coffee detector."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform_geom
from scipy import ndimage

from geo_worker.pipeline.features import MAX_PIXELS, align_scl, normalized_difference
from geo_worker.pipeline.geometry import candidate_polygons
from geo_worker.pipeline.rendering import rgb_composite, draw_candidate_outlines, save_leaflet_raster

INDEX_THRESHOLDS = {"ndvi_min": 0.60, "gndvi_min": 0.25, "evi2_min": 0.25}

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

        ndvi = normalized_difference(nir, red)
        gndvi = normalized_difference(nir, green)
        evi2 = np.zeros_like(ndvi)
        divisor = nir + 2.4 * red + 1
        np.divide(2.5 * (nir - red), divisor, out=evi2, where=np.abs(divisor) > 1e-6)

        scl = align_scl(Path(scl_path), src) if scl_path else None
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
        features = candidate_polygons(cleaned, src.transform, src.crs, min_area_ha)

        output_dir.mkdir(parents=True, exist_ok=True)
        geojson = {"type": "FeatureCollection", "features": features}
        (output_dir / "candidatos.geojson").write_text(
            json.dumps(geojson, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        rgb = rgb_composite(reflectance)
        rgb.save(output_dir / "imagem_rgb.png")
        geometries_projected = [
            transform_geom("EPSG:4326", src.crs, f["geometry"]) for f in features
        ]
        classified = draw_candidate_outlines(rgb, geometries_projected, src.transform)
        classified.save(output_dir / "imagem_classificada.png")
        leaflet_bounds = save_leaflet_raster(src, rgb, output_dir / "imagem_mapa.png")

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


def main():
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


if __name__ == "__main__":
    main()
