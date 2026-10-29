"""Auditoria espacial: compara resultados com o mapa público MapBiomas.

Métricas representam CONCORDÂNCIA COM A REFERÊNCIA, não acurácia em campo.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import rasterize
from rasterio.warp import transform_geom

from geo_worker.coffee_model import aligned_reference
from geo_worker.processing import _visualize_rgb


def _load_polygon_mask(path: Path, target: rasterio.io.DatasetReader):
    with path.open(encoding="utf-8") as file:
        features = json.load(file)["features"]
    geoms = (
        (transform_geom("EPSG:4326", target.crs, feature["geometry"]), 1)
        for feature in features
    )
    return rasterize(geoms, out_shape=target.shape, transform=target.transform).astype(bool)


def evaluate(primary: Path, reference: Path, results: dict[str, Path], output: Path):
    output.mkdir(parents=True, exist_ok=True)
    labels = aligned_reference(reference, primary)
    with rasterio.open(primary) as target:
        original = target.read().astype("float32")
        scales = np.asarray(target.scales)[:, None, None]
        offsets = np.asarray(target.offsets)[:, None, None]
        rgb = _visualize_rgb(original * scales + offsets)
        rgba = np.asarray(rgb).copy()
        coffee = labels == 46
        forest = labels == 3
        rgba[coffee, :3] = (0.5 * rgba[coffee, :3] + 0.5 * np.array([204, 62, 218])).astype("uint8")
        Image.fromarray(rgba, "RGBA").save(output / "mapbiomas_cafe_referencia.png")

        reference_coffee_pixels = int(coffee.sum())
        summary = {
            "reference": "MapBiomas Brasil Coleção 11, 2025, 30 m; rótulos reamostrados para 10 m",
            "reference_coffee_approx_ha": round(reference_coffee_pixels * 0.01, 2),
            "reference_forest_approx_ha": round(int(forest.sum()) * 0.01, 2),
            "comparison_is_validation_against_field_truth": False,
            "comparisons": {},
        }
        for label, geojson_path in results.items():
            mask = _load_polygon_mask(geojson_path, target)
            area = int(mask.sum())
            common = int((mask & coffee).sum())
            summary["comparisons"][label] = {
                "candidate_approx_ha": round(area * 0.01, 2),
                "candidate_overlap_reference_coffee_ha": round(common * 0.01, 2),
                "candidate_overlap_reference_forest_ha": round(int((mask & forest).sum()) * 0.01, 2),
                "candidate_overlap_other_classes_ha": round(int((mask & ~(coffee | forest)).sum()) * 0.01, 2),
                "reference_coffee_area_covered_percent": round(100 * common / reference_coffee_pixels, 1)
                if reference_coffee_pixels
                else None,
            }
    (output / "comparacao_referencia.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--primary", type=Path, default=Path("data/sample/imagem_multiespectral.tif"))
    parser.add_argument("--reference", type=Path, default=Path("data/reference/mapbiomas_2025_recorte_30m.tif"))
    parser.add_argument("--baseline", type=Path, default=Path("experiments/outputs/baseline/candidatos.geojson"))
    parser.add_argument("--model", type=Path, default=Path("experiments/outputs/model/candidatos.geojson"))
    parser.add_argument("--output", type=Path, default=Path("experiments/evaluation"))
    args = parser.parse_args()
    data = evaluate(args.primary, args.reference, {"baseline": args.baseline, "model": args.model}, args.output)
    print(json.dumps(data, indent=2, ensure_ascii=False))
