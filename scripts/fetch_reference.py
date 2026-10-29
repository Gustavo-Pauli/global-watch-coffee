"""Baixa só o recorte do mapa anual MapBiomas 2025 (classe café = 46).

Requer rede; a entrada é um GeoTIFF público oficial, não um rótulo de campo.
O recorte é armazenado na resolução original de ~30 m. A reamostragem para
outras resoluções deve sempre usar vizinho mais próximo.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import rasterio
from rasterio.windows import from_bounds, transform as window_transform
from rasterio.warp import transform_bounds


SOURCE = (
    "https://storage.googleapis.com/mapbiomas-public/initiatives/brasil/"
    "collection11/lulc/coverage/brazil_coverage/brazil_coverage-col11_2025.tif"
)


def extract(reference_image: Path, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    native_file = out_dir / "mapbiomas_2025_recorte_30m.tif"
    with rasterio.open(reference_image) as target:
        bounds = transform_bounds(target.crs, "EPSG:4326", *target.bounds)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(SOURCE) as source:
            window = from_bounds(*bounds, transform=source.transform).round_offsets().round_lengths()
            window = window.intersection(rasterio.windows.Window(0, 0, source.width, source.height))
            image = source.read(1, window=window)
            profile = source.profile.copy()
            profile.update(
                height=image.shape[0],
                width=image.shape[1],
                transform=window_transform(window, source.transform),
                count=1,
                compress="deflate",
            )
    with rasterio.open(native_file, "w", **profile) as dest:
        dest.write(image, 1)

    document = {
        "origin": "MapBiomas Brasil — Coleção 11 — Cobertura e Uso da Terra, 2025",
        "source": SOURCE,
        "license": "Dados públicos com atribuição; confirmar licença específica Coleção 11 (CC BY ou CC BY-SA conforme material oficial)",
        "citation": "Projeto MapBiomas — Coleção 11, acessado em 28/10/2026",
        "coffee_class": 46,
        "forest_class": 3,
        "original_resolution": "aproximadamente 30 metros",
        "data/reference_is_field_truth": False,
        "native_clip": native_file.name,
    }
    (out_dir / "proveniencia_mapbiomas.json").write_text(
        json.dumps(document, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return document


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, default=Path("data/sample/imagem_multiespectral.tif"))
    parser.add_argument("--output", type=Path, default=Path("data/reference"))
    args = parser.parse_args()
    print(json.dumps(extract(args.image, args.output), ensure_ascii=False, indent=2))
