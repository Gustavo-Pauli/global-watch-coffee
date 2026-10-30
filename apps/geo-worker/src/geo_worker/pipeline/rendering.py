"""Raster presentation products; no effect on classification or source values."""
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.warp import Resampling, calculate_default_transform, reproject
from shapely.geometry import shape

def rgb_composite(reflectance: np.ndarray) -> Image.Image:
    """Composição visual RGB, sem modificar os dados usados na classificação."""
    rgb = reflectance[[2, 1, 0]].transpose(1, 2, 0)
    scaled = np.clip(rgb / 0.32, 0, 1) ** 0.75
    return Image.fromarray((255 * scaled).astype(np.uint8), "RGB").convert("RGBA")


def draw_candidate_outlines(
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


def save_leaflet_raster(src: rasterio.io.DatasetReader, source_rgba: Image.Image, path: Path):
    """Gera PNG reamostrado em lon/lat, com limites utilizáveis no Leaflet."""
    dst_transform, width, height = calculate_default_transform(
        src.crs, "EPSG:4326", src.width, src.height, *src.bounds
    )
    if width <= 0 or height <= 0 or width * height > 2_000_000:
        raise ValueError("A reprojeção para o mapa excede o limite de dois milhões de pixels.")
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
