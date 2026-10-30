"""Estudo de sensibilidade ao limiar, sem retreinamento ou ajuste automático.

O mapa de referência é usado SOMENTE na auditoria posterior ao cálculo das
predições. Não escolha um limiar por esta tabela como se fosse validação externa.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom
from scipy import ndimage

from geo_worker.research.coffee_model import _predicted_scores, aligned_reference, scene_features
from geo_worker.diagnose_errors import _metrics, _pixel_area_ha
from geo_worker.pipeline.geometry import candidate_polygons


def compare_thresholds(
    image: Path, scl: Path, secondary: Path, secondary_scl: Path,
    model: Path, reference: Path, output: Path,
    thresholds: tuple[float, ...] = (0.5, 0.6, 0.7, 0.8),
) -> dict:
    if not thresholds or any(not 0 < t < 1 for t in thresholds):
        raise ValueError("Limiar deve estar estritamente entre zero e um.")
    trained = joblib.load(model)  # modelo do proprio projeto, nunca upload do usuario
    first, valid_first, _, geometry = scene_features(image, scl)
    second, valid_second, _, second_geometry = scene_features(secondary, secondary_scl)
    if first.shape != second.shape or geometry != second_geometry:
        raise ValueError("As cenas nao estao alinhadas no espaco.")
    a = _predicted_scores(trained["estimator"], first)
    b = _predicted_scores(trained["estimator"], second)
    combined = (a * valid_first + b * valid_second) / np.maximum(
        1, valid_first.astype(np.uint8) + valid_second.astype(np.uint8)
    )
    valid = valid_first | valid_second
    labels = aligned_reference(reference, image)
    results = []
    with rasterio.open(image) as src:
        pixel_area = _pixel_area_ha(src)
        for cutoff in thresholds:
            mask = valid & (combined >= cutoff)
            mask = ndimage.binary_opening(mask, structure=np.ones((2, 2)))
            mask = ndimage.binary_closing(mask, structure=np.ones((2, 2)))
            polygons = candidate_polygons(mask, src.transform, src.crs, min_area_ha=0.25)
            pixel_mask = rasterize(
                ((transform_geom("EPSG:4326", src.crs, item["geometry"]), 1) for item in polygons),
                out_shape=src.shape,
                transform=src.transform,
            ).astype(bool)
            metric = _metrics(pixel_mask, labels, pixel_area)
            results.append({
                "cutoff": cutoff,
                "polygon_count": len(polygons),
                "candidate_area_ha_geodesic": round(sum(x["properties"]["area_ha"] for x in polygons), 3),
                "candidate_area_ha_rasterized": metric["candidate_area_ha_approx_rasterized"],
                "reference_coffee_overlap_ha": metric["reference_coffee_overlap_ha"],
                "reference_forest_overlap_ha": metric["reference_forest_overlap_ha"],
                "reference_other_overlap_ha": metric["reference_other_overlap_ha"],
                "reference_coffee_covered_pct": metric["reference_coffee_covered_pct"],
            })
    report = {
        "purpose": "threshold_sensitivity_for_research_not_ground_truth",
        "model_was_retrained": False,
        "model_was_tuned_using_reference": False,
        "is_field_validation": False,
        "warning": "Comparacao com fonte usada para treinar o modelo: nao e avaliacao independente.",
        "results": results,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, default=Path("data/sample/imagem_multiespectral.tif"))
    parser.add_argument("--scl", type=Path, default=Path("data/sample/qualidade_scl.tif"))
    parser.add_argument("--secondary", type=Path, default=Path("data/additional/imagem_adicional_multiespectral.tif"))
    parser.add_argument("--secondary-scl", type=Path, default=Path("data/additional/qualidade_adicional_scl.tif"))
    parser.add_argument("--model", type=Path, default=Path("apps/geo-worker/models/v1/coffee_rf.joblib"))
    parser.add_argument("--reference", type=Path, default=Path("data/reference/mapbiomas_2025_recorte_30m.tif"))
    parser.add_argument("--output", type=Path, default=Path("experiments/evaluation/sensibilidade_limites.json"))
    args = parser.parse_args()
    report = compare_thresholds(args.image, args.scl, args.secondary, args.secondary_scl,
                                args.model, args.reference, args.output)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
