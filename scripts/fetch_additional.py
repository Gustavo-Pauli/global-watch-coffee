"""Recorta outra cena pública Sentinel-2 para a mesma grade espacial do kit.

Exige acesso à internet, sem credenciais. Usa verificação HTTPS padrão do GDAL.
Não é usado em uploads da aplicação; é um script de obtenção de dados de pesquisa.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject


CATALOG = "https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a/items/"
EXPECTED_HOST = "e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com"
ASSETS = ("blue", "green", "red", "nir")


def retrieve(scene_id: str, reference_path: Path, reference_scl_path: Path, destination: Path):
    if not scene_id.startswith("S2") or "/" in scene_id or ".." in scene_id:
        raise ValueError("ID de cena inválido.")
    with urlopen(CATALOG + scene_id, timeout=20) as response:
        scene = json.load(response)
    if scene["id"] != scene_id:
        raise ValueError("O catálogo retornou uma cena inesperada.")

    def asset_url(name):
        url = scene["assets"][name]["href"]
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != EXPECTED_HOST:
            raise ValueError(f"Origem inesperada para a banda {name}.")
        return url

    destination.mkdir(parents=True, exist_ok=True)
    image_file = destination / "imagem_adicional_multiespectral.tif"
    quality_file = destination / "qualidade_adicional_scl.tif"

    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(reference_path) as target:
            profile = target.profile.copy()
            profile.update(count=4, compress="deflate", tiled=True)
            with rasterio.open(image_file, "w", **profile) as dest:
                scales, offsets = [], []
                for index, name in enumerate(ASSETS, 1):
                    asset = scene["assets"][name]
                    with rasterio.open(asset_url(name)) as source:
                        band = np.zeros((target.height, target.width), dtype=np.uint16)
                        reproject(
                            rasterio.band(source, 1),
                            band,
                            src_transform=source.transform,
                            src_crs=source.crs,
                            src_nodata=0,
                            dst_transform=target.transform,
                            dst_crs=target.crs,
                            dst_nodata=0,
                            resampling=Resampling.nearest,
                        )
                        dest.write(band, index)
                        radiometry = asset["raster:bands"][0]
                        scales.append(float(radiometry.get("scale", 1)))
                        offsets.append(float(radiometry.get("offset", 0)))
                dest.scales = tuple(scales)
                dest.offsets = tuple(offsets)

        with rasterio.open(reference_scl_path) as scl_reference:
            profile = scl_reference.profile.copy()
            profile.update(count=1, compress="deflate")
            with rasterio.open(asset_url("scl")) as source:
                with rasterio.open(quality_file, "w", **profile) as dest:
                    band = np.zeros(scl_reference.shape, dtype="uint8")
                    reproject(
                        rasterio.band(source, 1),
                        band,
                        src_transform=source.transform,
                        src_crs=source.crs,
                        src_nodata=0,
                        dst_transform=scl_reference.transform,
                        dst_crs=scl_reference.crs,
                        dst_nodata=0,
                        resampling=Resampling.nearest,
                    )
                    dest.write(band, 1)

    provenance = {
        "id": scene_id,
        "datetime": scene["properties"]["datetime"],
        "tile_cloud_cover_percent": scene["properties"].get("eo:cloud_cover"),
        "catalog": CATALOG + scene_id,
        "assets": {name: asset_url(name) for name in (*ASSETS, "scl")},
        "modifications": "recorte e alinhamento à grade espacial do kit; B02/B03/B04/B08",
        "attribution": "Contains modified Copernicus Sentinel data (2025)",
    }
    (destination / "proveniencia_adicional.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return provenance


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", default="S2A_T23KLS_20250721T131759_L2A")
    parser.add_argument("--reference", type=Path, default=Path("data/sample/imagem_multiespectral.tif"))
    parser.add_argument("--scl-reference", type=Path, default=Path("data/sample/qualidade_scl.tif"))
    parser.add_argument("--output", type=Path, default=Path("data/additional"))
    args = parser.parse_args()
    print(json.dumps(retrieve(args.scene, args.reference, args.scl_reference, args.output), indent=2))
