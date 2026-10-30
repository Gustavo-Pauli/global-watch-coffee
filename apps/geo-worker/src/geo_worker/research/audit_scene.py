"""Inspeção reproduzível dos insumos geoespaciais, sem classificar café.

Uso: python -m geo_worker.audit_scene --output experiments/evaluation/auditoria_cenas.json

Este script comprova quais bandas, escalas, datas, grades, máscaras e índices
alimentam o modelo. Não usa o mapa MapBiomas como resposta pronta.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio

from geo_worker.research.coffee_model import aligned_reference, scene_features
from geo_worker.pipeline.features import align_scl


def inspect_scene(image: Path, scl: Path, acquisition_date: str) -> dict:
    with rasterio.open(image) as src:
        if src.crs is None or src.count != 4:
            raise ValueError("Cena inválida: precisam existir CRS e quatro bandas.")
        if src.width * src.height > 16_000_000:
            raise ValueError("Cena maior que 16 milhões de pixels.")
        if not src.crs.is_projected or not src.crs.linear_units == "metre":
            raise ValueError("Para esta auditoria, espera-se grade projetada em metros.")
        scl_values, scl_counts = np.unique(align_scl(scl, src), return_counts=True)
        info = {
            "scene": image.name,
            "date": acquisition_date,
            "crs": str(src.crs),
            "shape_pixels": [src.height, src.width],
            "band_order": ["B02_blue", "B03_green", "B04_red", "B08_nir"],
            "scales": [float(v) for v in src.scales],
            "offsets": [float(v) for v in src.offsets],
            "pixel_size_m": [abs(float(src.transform.a)), abs(float(src.transform.e))],
            "bounding_box_projected": [round(float(v), 3) for v in src.bounds],
            "pixel_area_ha": round(abs(float(src.transform.a * src.transform.e - src.transform.b * src.transform.d)) / 10_000, 5),
            "scl_classes_pixel_count_10m_grid": {str(int(k)): int(v) for k, v in zip(scl_values, scl_counts)},
        }
    features, valid, reflectance, _ = scene_features(image, scl)
    for index_name, index in (("ndvi", 4), ("gndvi", 5), ("evi2", 6)):
        sample = features[:, :, index][valid]
        info[f"{index_name}_percentiles_clear"] = [
            round(float(v), 4) for v in np.percentile(sample, [5, 50, 95])
        ] if sample.size else None
    info["valid_clear_pixel_count"] = int(valid.sum())
    info["red_reflectance_median_clear"] = round(float(np.median(reflectance[2][valid])), 5) if valid.any() else None
    return info


def audit(
    primary: Path,
    primary_scl: Path,
    secondary: Path,
    secondary_scl: Path,
    reference: Path,
    output: Path | None = None,
) -> dict:
    first = inspect_scene(primary, primary_scl, "2025-08-16")
    second = inspect_scene(secondary, secondary_scl, "2025-07-21")
    with rasterio.open(primary) as a, rasterio.open(secondary) as b:
        same_grid = a.crs == b.crs and a.transform == b.transform and a.shape == b.shape
        if not same_grid:
            raise ValueError("As duas cenas não coincidem em CRS, resolução e transformação.")
    reference_labels = aligned_reference(reference, primary)
    unique, counts = np.unique(reference_labels, return_counts=True)
    result = {
        "purpose": "radiometric_and_geospatial_quality_audit",
        "primary": first,
        "additional": second,
        "same_projected_grid": same_grid,
        "reference": "MapBiomas coleção 11, cobertura 2025, 30 m, classe 46=café",
        "reference_source_resolution_m": 30,
        "reference_resampling": "nearest_neighbor_to_10m_grid",
        "reference_class_pixels_10m_grid": {str(int(k)): int(v) for k, v in zip(unique, counts)},
        "does_not_establish_coffee_ground_truth": True,
        "warnings": [
            "SCL filtra condições de observação, não identifica espécie ou tipo de cultura.",
            "Os índices espectrais identificam propriedades da vegetação; café e floresta podem ter índices parecidos.",
            "O mapa de referência também é saída de um classificador e foi utilizado no treinamento.",
            "Rótulos de 30 m alinhados a 10 m NÃO ganham precisão de 10 m.",
        ],
    }
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--primary", type=Path, default=Path("data/sample/imagem_multiespectral.tif"))
    parser.add_argument("--primary-scl", type=Path, default=Path("data/sample/qualidade_scl.tif"))
    parser.add_argument("--secondary", type=Path, default=Path("data/additional/imagem_adicional_multiespectral.tif"))
    parser.add_argument("--secondary-scl", type=Path, default=Path("data/additional/qualidade_adicional_scl.tif"))
    parser.add_argument("--reference", type=Path, default=Path("data/reference/mapbiomas_2025_recorte_30m.tif"))
    parser.add_argument("--output", type=Path, default=Path("experiments/evaluation/auditoria_cenas.json"))
    arguments = parser.parse_args()
    print(json.dumps(audit(arguments.primary, arguments.primary_scl, arguments.secondary,
                           arguments.secondary_scl, arguments.reference, arguments.output),
                     indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
