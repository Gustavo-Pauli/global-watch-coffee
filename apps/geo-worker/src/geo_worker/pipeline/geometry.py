"""Bounded polygonization with geodesic WGS84 areas."""
import numpy as np
from pyproj import Geod
from rasterio.features import shapes
from rasterio.warp import transform_geom
from shapely.geometry import shape

GEOD = Geod(ellps="WGS84")

def candidate_polygons(binary: np.ndarray, transform, crs, min_area_ha: float, *, max_regions: int = 10_000):
    features = []
    for region, (geometry, value) in enumerate(shapes(binary.astype("uint8"), mask=binary, transform=transform)):
        if region >= max_regions:
            raise ValueError("Imagem excessivamente fragmentada; envie um recorte menor.")
        if not value:
            continue
        wgs84 = transform_geom(crs, "EPSG:4326", geometry, precision=7)
        area_ha = abs(GEOD.geometry_area_perimeter(shape(wgs84))[0]) / 10_000
        if not np.isfinite(area_ha):
            raise ValueError("Geometria fora dos limites válidos do CRS informado.")
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
