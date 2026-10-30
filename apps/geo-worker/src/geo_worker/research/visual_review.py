"""Pranchas de inspeção das regiões que mais discordam da referência temática.

Compara as duas imagens Sentinel-2 fornecidas/obtidas e o mapa MapBiomas.
Não constitui inspeção de campo ou confirmação independente de lavouras.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.warp import transform_geom
from shapely.geometry import shape

from geo_worker.research.coffee_model import aligned_reference
from geo_worker.pipeline.rendering import rgb_composite


COLORS = {
    46: (199, 70, 224),  # café no MapBiomas
    3: (231, 75, 75),    # floresta
    21: (250, 184, 45), # mosaico de usos
    15: (45, 167, 224), # pastagem
}


def _satellite_images(path: Path):
    with rasterio.open(path) as source:
        raw = source.read().astype(np.float32)
        scale = np.asarray(source.scales, dtype=np.float32)[:, None, None]
        offset = np.asarray(source.offsets, dtype=np.float32)[:, None, None]
        reflectance = raw * scale + offset
    rgb = rgb_composite(reflectance).convert("RGB")
    # Falsa cor: R=NIR, G=vermelho e B=verde; é apenas visualização qualitativa.
    false_color = reflectance[[3, 2, 1]].transpose(1, 2, 0)
    false_color = np.uint8(255 * np.power(np.clip(false_color / 0.45, 0, 1), 0.85))
    return rgb, Image.fromarray(false_color, "RGB")


def _projected_geometry_mask_bounds(feature: dict, source, pad_pixels=12):
    projected = shape(transform_geom("EPSG:4326", source.crs, feature["geometry"]))
    x0, y0, x1, y1 = projected.bounds
    inverse = ~source.transform
    c0, r0 = inverse * (x0, y1)
    c1, r1 = inverse * (x1, y0)
    left = max(0, int(np.floor(min(c0, c1))) - pad_pixels)
    right = min(source.width, int(np.ceil(max(c0, c1))) + pad_pixels)
    top = max(0, int(np.floor(min(r0, r1))) - pad_pixels)
    bottom = min(source.height, int(np.ceil(max(r0, r1))) + pad_pixels)
    return projected, (left, top, right, bottom)


def _draw_outline(image: Image.Image, projected, source, crop: tuple[int, int, int, int]):
    result = image.copy()
    draw = ImageDraw.Draw(result)
    inverted = ~source.transform
    shapes = [projected] if projected.geom_type == "Polygon" else list(projected.geoms)
    for part in shapes:
        for ring in (part.exterior, *part.interiors):
            points = []
            for coordinates in ring.coords:
                x, y = inverted * coordinates
                points.append((x - crop[0], y - crop[1]))
            if len(points) >= 3:
                draw.line(points, fill=(255, 255, 255), width=2)
                draw.line(points, fill=(7, 8, 12), width=1)
    return result


def _panel(image: Image.Image, label: str, width: int = 460, height: int = 312):
    container = Image.new("RGB", (width, height), (25, 32, 43))
    drawing = ImageDraw.Draw(container)
    drawing.text((12, 10), label, fill=(245, 247, 251))
    # Amplia blocos de 10 m para que sejam inspecionáveis, sem inventar detalhe.
    scale = min((width - 18) / image.width, (height - 44) / image.height)
    sample = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        resample=Image.Resampling.NEAREST,
    )
    container.paste(sample, ((width - sample.width) // 2, 36 + (height - 44 - sample.height) // 2))
    return container


def create_visual_review(
    primary: Path, secondary: Path, unseen: Path, reference: Path, polygons: Path,
    output: Path, ids: tuple[int, ...] = (33, 32, 29),
) -> list[dict]:
    output.mkdir(parents=True, exist_ok=True)
    rgb_aug, _ = _satellite_images(primary)
    rgb_jul, _ = _satellite_images(secondary)
    rgb_oct, _ = _satellite_images(unseen)
    labels = aligned_reference(reference, primary)
    label_legend = "Roxo cafe | Vermelho floresta | Laranja mosaico | Azul pastagem"
    summary = []
    features = {feature["properties"]["id"]: feature
                for feature in json.loads(polygons.read_text(encoding="utf-8"))["features"]}
    with rasterio.open(primary) as source, rasterio.open(secondary) as src_secondary, rasterio.open(unseen) as src_unseen:
        if source.crs != src_secondary.crs or source.shape != src_secondary.shape or source.transform != src_secondary.transform:
            raise ValueError("As duas cenas precisam ter uma grade espacial identica.")
        if source.crs != src_unseen.crs or source.shape != src_unseen.shape or source.transform != src_unseen.transform:
            raise ValueError("A cena de teste precisa coincidir com a grade espacial.")
        for id_ in ids:
            feature = features[id_]
            geom, crop = _projected_geometry_mask_bounds(feature, source)
            rgb_a = _draw_outline(rgb_aug.crop(crop), geom, source, crop)
            rgb_b = _draw_outline(rgb_jul.crop(crop), geom, source, crop)
            rgb_c = _draw_outline(rgb_oct.crop(crop), geom, source, crop)

            class_map = np.asarray(rgb_aug.crop(crop)).copy()
            class_labels = labels[crop[1]:crop[3], crop[0]:crop[2]]
            for class_code, color in COLORS.items():
                select = class_labels == class_code
                class_map[select] = (class_map[select] * 0.35 + np.array(color) * 0.65).astype(np.uint8)
            with_reference = _draw_outline(Image.fromarray(class_map, "RGB"), geom, source, crop)

            sheet = Image.new("RGB", (920, 702), (245, 247, 251))
            for idx, (image, name) in enumerate((
                (rgb_a, "Sentinel-2 RGB - 16/08/2025"),
                (rgb_b, "Sentinel-2 RGB - 21/07/2025"),
                (rgb_c, "Sentinel-2 RGB - 25/10/2025 (fora do treino)"),
                (with_reference, "MapBiomas 2025 - classes do mapa de treino"),
            )):
                sheet.paste(_panel(image, name), ((idx % 2) * 460, (idx // 2) * 312))
            painter = ImageDraw.Draw(sheet)
            center = shape(feature["geometry"]).centroid
            painter.text((15, 634), f"Poligono {id_} | Area candidata: {feature['properties']['area_ha']:.2f} ha", fill=(18, 24, 33))
            painter.text((15, 650), label_legend, fill=(35, 41, 50))
            painter.text((15, 666), f"Centro aproximado: lat {center.y:.6f}, lon {center.x:.6f}", fill=(35, 41, 50))
            painter.text((15, 682), "Contorno branco/preto = predito. Imagens 10m, sem confirmacao por vistoria.", fill=(35, 41, 50))
            name = f"poligono_{id_}_inspecao.png"
            sheet.save(output / name)
            summary.append({
                "polygon_id": id_,
                "candidate_area_ha": feature["properties"]["area_ha"],
                "center": {"lat": round(center.y, 6), "lon": round(center.x, 6)},
                "image": name,
                "google_maps_satellite_review_url":
                f"https://www.google.com/maps/@{center.y:.6f},{center.x:.6f},17z/data=!3m1!1e3",
                "visual_inspection_limitation": "10m pixels and thematic labels are not field validation; finer imagery must be checked manually.",
            })
    (output / "locais_para_conferencia.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return summary



def main():
    report = create_visual_review(
        Path("data/sample/imagem_multiespectral.tif"),
        Path("data/additional/imagem_adicional_multiespectral.tif"),
        Path("data/unseen/imagem_adicional_multiespectral.tif"),
        Path("data/reference/mapbiomas_2025_recorte_30m.tif"),
        Path("experiments/outputs/model/candidatos.geojson"),
        Path("experiments/evaluation/inspecao_visual"),
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
