"""Comparação temporal e análise espacial dos erros aparentes da classificação.

Usa MapBiomas APENAS para diagnosticar resultados já calculados. O modelo de
predição nunca consulta este mapa para decidir a classe dos pixels de upload.
Os números expressam concordância temática, não validação por trabalho de campo.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.features import rasterize
from rasterio.warp import transform_geom

from geo_worker.research.coffee_model import aligned_reference
from geo_worker.evaluate_reference import _load_polygon_mask
from geo_worker.pipeline.rendering import rgb_composite


CLASSES = {
    0: "Sem dados de referencia",
    3: "Formacao florestal",
    9: "Silvicultura",
    15: "Pastagem",
    20: "Cana",
    21: "Mosaico de usos",
    24: "Area urbanizada",
    33: "Corpo d'agua",
    41: "Outras lavouras temporarias",
    46: "Cafe",
}


def _pixel_area_ha(src) -> float:
    if not src.crs or not src.crs.is_projected or src.crs.linear_units != "metre":
        raise ValueError("A auditoria precisa de CRS projetado em metros.")
    transform = src.transform
    return abs(transform.a * transform.e - transform.b * transform.d) / 10_000


def _metrics(prediction: np.ndarray, labels: np.ndarray, pixel_area_ha: float) -> dict:
    coffee = labels == 46
    forest = labels == 3
    unique, counts = np.unique(labels[prediction], return_counts=True)
    classes = [
        {
            "class_code": int(code),
            "class_name": CLASSES.get(int(code), "Outra classe"),
            "candidate_overlap_ha": round(int(count) * pixel_area_ha, 3),
        }
        for code, count in zip(unique, counts)
    ]
    classes.sort(key=lambda item: item["candidate_overlap_ha"], reverse=True)
    return {
        "candidate_area_ha_approx_rasterized": round(int(prediction.sum()) * pixel_area_ha, 3),
        "reference_coffee_overlap_ha": round(int((prediction & coffee).sum()) * pixel_area_ha, 3),
        "reference_forest_overlap_ha": round(int((prediction & forest).sum()) * pixel_area_ha, 3),
        "reference_other_overlap_ha": round(int((prediction & ~(coffee | forest)).sum()) * pixel_area_ha, 3),
        "reference_coffee_covered_pct": round(100 * int((prediction & coffee).sum()) / int(coffee.sum()), 2)
        if coffee.any() else None,
        "candidate_overlap_by_mapbiomas_class": classes,
    }


def _important_polygons(geojson_path: Path, src, labels: np.ndarray, pixel_area_ha: float) -> list:
    collection = json.loads(geojson_path.read_text(encoding="utf-8"))
    rows = []
    for feature in collection["features"]:
        projected = transform_geom("EPSG:4326", src.crs, feature["geometry"])
        pixel_mask = rasterize(
            [(projected, 1)], out_shape=src.shape, transform=src.transform,
        ).astype(bool)
        total = int(pixel_mask.sum())
        if not total:
            continue
        counts = np.bincount(labels[pixel_mask].astype(np.int32), minlength=47)
        coffee = int(counts[46])
        forest = int(counts[3])
        other = total - coffee - forest
        leading_class = int(counts.argmax())
        rows.append({
            "polygon_id": int(feature["properties"]["id"]),
            "polygon_area_ha_geodesic": feature["properties"]["area_ha"],
            "polygon_area_ha_rasterized": round(total * pixel_area_ha, 3),
            "reference_coffee_pct": round(100 * coffee / total, 1),
            "reference_forest_pct": round(100 * forest / total, 1),
            "reference_other_pct": round(100 * other / total, 1),
            "reference_non_coffee_area_ha": round((total - coffee) * pixel_area_ha, 3),
            "dominant_reference_class": CLASSES.get(leading_class, f"Classe {leading_class}"),
            "dominant_reference_class_code": leading_class,
        })
    rows.sort(key=lambda row: row["reference_non_coffee_area_ha"], reverse=True)
    return rows


def _panel(rgb, candidate, labels, title: str, pixel_area_ha: float):
    image = np.asarray(rgb.convert("RGB")).copy()
    coffee = labels == 46
    marks = [
        (coffee & ~candidate, [50, 117, 229]),     # café no mapa que não foi apontado
        (candidate & coffee, [25, 191, 109]),      # concordância com café no mapa
        (candidate & (labels == 3), [240, 67, 71]),  # floresta no mapa
        (candidate & ~(coffee | (labels == 3)), [255, 170, 30]),
    ]
    for mask, color in marks:
        image[mask] = (image[mask] * 0.30 + np.asarray(color) * 0.70).astype(np.uint8)
    visual = Image.fromarray(image, "RGB")
    canvas = Image.new("RGB", (visual.width, visual.height + 36), (244, 247, 250))
    canvas.paste(visual, (0, 36))
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 10), title, fill=(25, 30, 42))
    draw.text((10, 23), f"Candidatos: {round(int(candidate.sum()) * pixel_area_ha, 1)} ha", fill=(55, 61, 73))
    return canvas


def diagnose(image: Path, reference: Path, candidates: dict[str, Path], output: Path) -> dict:
    if "rf_both" not in candidates:
        raise ValueError("Informe uma classificação combinada com a chave 'rf_both'.")
    output.mkdir(parents=True, exist_ok=True)
    with rasterio.open(image) as src:
        pixel_area_ha = _pixel_area_ha(src)
        labels = aligned_reference(reference, image)
        masks = {name: _load_polygon_mask(path, src) for name, path in candidates.items()}
        results = {name: _metrics(mask, labels, pixel_area_ha) for name, mask in masks.items()}
        principal = _important_polygons(candidates["rf_both"], src, labels, pixel_area_ha)
        with np.errstate(invalid="ignore", divide="ignore"):
            if "rf_aug" in masks:
                augmented = masks["rf_aug"]
                combined = masks["rf_both"]
                intersection = int((augmented & combined).sum())
                union = int((augmented | combined).sum())
                comparison = {
                    "intersection_over_union_aug_alone_vs_two_dates": round(intersection / union, 4) if union else None,
                    "candidate_only_aug_ha": round(int((augmented & ~combined).sum()) * pixel_area_ha, 3),
                    "candidate_only_two_dates_ha": round(int((combined & ~augmented).sum()) * pixel_area_ha, 3),
                }
            else:
                comparison = {}
        raw = src.read().astype(np.float32)
        scales = np.asarray(src.scales, dtype=np.float32)[:, None, None]
        offsets = np.asarray(src.offsets, dtype=np.float32)[:, None, None]
        rgb = rgb_composite(raw * scales + offsets)
        left_key = "baseline" if "baseline" in masks else "rf_aug" if "rf_aug" in masks else "rf_both"
        left = _panel(rgb, masks[left_key], labels, left_key, pixel_area_ha)
        right = _panel(rgb, masks["rf_both"], labels, "Random Forest - duas datas", pixel_area_ha)
        sheet = Image.new("RGB", (left.width + right.width, left.height + 75), (244, 247, 250))
        sheet.paste(left, (0, 0))
        sheet.paste(right, (left.width, 0))
        draw = ImageDraw.Draw(sheet)
        base_y = left.height + 8
        swatches = [
            ((25, 191, 109), "Verde: concorda com cafe no MapBiomas"),
            ((240, 67, 71), "Vermelho: floresta no MapBiomas"),
            ((255, 170, 30), "Laranja: outras classes no MapBiomas"),
            ((50, 117, 229), "Azul: cafe do mapa nao detectado"),
        ]
        for offset, (color, text) in enumerate(swatches):
            x = 16 if offset < 2 else left.width + 5
            y = base_y + (offset % 2) * 23
            draw.rectangle((x, y + 2, x + 12, y + 14), fill=color)
            draw.text((x + 18, y + 2), text, fill=(25, 30, 42))
        draw.text((16, left.height + 55), "Comparacao com rotulos de treino - NAO validacao independente nem verdade de campo.", fill=(25, 30, 42))
        sheet.save(output / "mapa_erros_referencia.png")
    report = {
        "analysis": "rasterized_polygon_agreement_with_training_reference",
        "explicit_warning": "NAO e acuracia independente nem confirmacao de cultivo em campo.",
        "reference": "MapBiomas Brasil Colecao 11, cobertura anual 2025, 30 m, classe 46 cafe",
        "pixel_area_ha": pixel_area_ha,
        "variants": results,
        "temporal_comparison": comparison,
        "largest_rf_both_polygons_by_area_disagreeing_with_reference": principal[:12],
        "does_not_change_model_or_predictions": True,
    }
    (output / "diagnostico_falsos_positivos.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, default=Path("data/sample/imagem_multiespectral.tif"))
    parser.add_argument("--reference", type=Path, default=Path("data/reference/mapbiomas_2025_recorte_30m.tif"))
    parser.add_argument("--baseline", type=Path, default=Path("experiments/outputs/baseline/candidatos.geojson"))
    parser.add_argument("--rf-aug", type=Path, default=Path("outputs_model_uma_data/candidatos.geojson"))
    parser.add_argument("--rf-jul", type=Path, default=Path("outputs_model_adicional/candidatos.geojson"))
    parser.add_argument("--rf-both", type=Path, default=Path("experiments/outputs/model/candidatos.geojson"))
    parser.add_argument("--output", type=Path, default=Path("experiments/evaluation/diagnostico"))
    args = parser.parse_args()
    report = diagnose(args.image, args.reference,
                      {"baseline": args.baseline, "rf_aug": args.rf_aug,
                       "rf_jul": args.rf_jul, "rf_both": args.rf_both}, args.output)
    print(json.dumps({"variants": {key: value["candidate_area_ha_approx_rasterized"]
                                   for key, value in report["variants"].items()},
                      "temporal_comparison": report["temporal_comparison"],
                      "largest_disagreements": report["largest_rf_both_polygons_by_area_disagreeing_with_reference"][:3]},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
