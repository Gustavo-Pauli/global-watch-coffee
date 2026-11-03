"""Conservative, bounded spectral screening of persistent vegetation loss.

This is a research baseline, not a deforestation validation system. The input
manifest supplies already aligned physical reflectance (blue, green, red, NIR,
SWIR1, SWIR2) and SCL rasters. Cloud/NoData observations are unknown; they never
count as either corroboration or evidence that vegetation recovered.
"""

from __future__ import annotations

import argparse
from contextlib import ExitStack
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
import hashlib
import json
import math
from numbers import Real
from pathlib import Path
from typing import Any

import numpy as np
from pyproj import Geod
import rasterio
from rasterio.features import shapes
from rasterio.warp import transform_geom
from rasterio.windows import Window
from scipy import ndimage
from shapely import make_valid, union_all
from shapely.geometry import mapping, shape


EPOCH = date(1970, 1, 1)
GEOD = Geod(ellps="WGS84")
STATUS = {
    0: "insufficient_forest_baseline_or_not_eligible",
    1: "eligible_insufficient_recent_observations",
    2: "observed_without_current_corroborated_loss",
    3: "single_pending_anomaly",
    4: "corroborated_candidate_latest_clear_anomalous",
    5: "corroborated_candidate_latest_clear_not_anomalous",
}
OBSERVATION_BANDS = (
    "eligible_forest_baseline",
    "baseline_clear_observation_days",
    "recent_clear_observation_days",
    "recent_anomalous_observation_days",
    "first_anomaly_day",
    "last_intact_day_before_first_anomaly",
    "corroboration_day",
    "latest_valid_observation_day",
)


@dataclass(frozen=True)
class DetectionParameters:
    forest_ndvi_min: float = 0.65
    forest_nbr_min: float = 0.50
    ndvi_drop_min: float = 0.20
    nbr_drop_min: float = 0.20
    post_ndvi_max: float = 0.55
    mad_multiplier: float = 3.0
    min_baseline_days: int = 2
    corroborating_days: int = 2
    min_area_ha: float = 0.50
    tile_size: int = 256

    def validate(self) -> None:
        for key, value in asdict(self).items():
            if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value):
                raise ValueError(f"{key} must be a finite number.")
        for key in ("forest_ndvi_min", "forest_nbr_min", "post_ndvi_max"):
            if not -1 <= getattr(self, key) <= 1:
                raise ValueError(f"{key} must be an index value in [-1, 1].")
        for key in ("ndvi_drop_min", "nbr_drop_min"):
            if not 0 < getattr(self, key) <= 2:
                raise ValueError(f"{key} must be in (0, 2].")
        if self.mad_multiplier < 0 or self.min_area_ha <= 0:
            raise ValueError("MAD multiplier must be nonnegative and area must be positive.")
        for key, minimum in (("min_baseline_days", 2), ("corroborating_days", 2), ("tile_size", 1)):
            value = getattr(self, key)
            if int(value) != value or value < minimum:
                raise ValueError(f"{key} must be an integer >= {minimum}.")
        if self.tile_size > 1024:
            raise ValueError("tile_size must not exceed 1024.")


def _day(value: str) -> int:
    if not isinstance(value, str):
        raise ValueError("Observation dates must be ISO strings.")
    try:
        if len(value) == 10:
            parsed = date.fromisoformat(value)
        else:
            instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if instant.tzinfo is None:
                raise ValueError("Datetime observations require an explicit timezone.")
            parsed = instant.astimezone(timezone.utc).date()
        return (parsed - EPOCH).days
    except (ValueError, TypeError) as error:
        raise ValueError(f"Invalid ISO observation date: {value!r}") from error


def _iso(day: int) -> str | None:
    if day < 0:
        return None
    return date.fromordinal(EPOCH.toordinal() + int(day)).isoformat()


def _asset(path: str, manifest_dir: Path) -> Path:
    asset = Path(path)
    return asset if asset.is_absolute() else (manifest_dir / asset).resolve()


def _same_grid(first: Any, other: Any) -> bool:
    return (
        first.width == other.width and first.height == other.height
        and first.crs == other.crs and first.transform == other.transform
    )


def _open_region(region: dict, manifest_dir: Path, cutoff: int, stack: ExitStack):
    scenes = region.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError(f"Region {region.get('id')!r} has no scenes.")
    opened = []
    template = None
    for item in scenes:
        if item.get("phase") not in ("baseline", "recent"):
            raise ValueError("Each scene needs an explicit baseline or recent phase.")
        day = _day(item["date"])
        if day > cutoff:
            raise ValueError(f"Scene {item.get('id')} is later than the study cutoff.")
        image = stack.enter_context(rasterio.open(_asset(item["image"], manifest_dir)))
        scl = stack.enter_context(rasterio.open(_asset(item["scl"], manifest_dir)))
        if image.count != 6 or any(x not in ("float32", "float64") for x in image.dtypes):
            raise ValueError("Images must contain six floating-point reflectance bands.")
        if any(x != 1 for x in image.scales) or any(x != 0 for x in image.offsets):
            raise ValueError("Input bands must already be physical reflectance, scale 1 and offset 0.")
        if image.crs is None or not image.crs.is_projected or image.crs.linear_units != "metre":
            raise ValueError("Images need a projected CRS in metres.")
        if (image.transform.a <= 0 or image.transform.e >= 0
                or image.transform.b != 0 or image.transform.d != 0):
            raise ValueError("Unexpected raster transform.")
        if image.width * image.height > 16_000_000:
            raise ValueError("Pilot region exceeds the 16-million-pixel bound.")
        if scl.count != 1 or not _same_grid(image, scl):
            raise ValueError("SCL and reflectance must have the exact same grid.")
        template = image if template is None else template
        if not _same_grid(template, image):
            raise ValueError("All observations must have the exact same grid.")
        opened.append({"item": item, "day": day, "image": image, "scl": scl})
    baseline = [x for x in opened if x["item"]["phase"] == "baseline"]
    recent = [x for x in opened if x["item"]["phase"] == "recent"]
    if not baseline or not recent:
        raise ValueError("Each region needs baseline and recent observations.")
    if max(x["day"] for x in baseline) >= min(x["day"] for x in recent):
        raise ValueError("All baseline observations must predate the recent period.")
    return template, _group_dates(baseline), _group_dates(recent)


def _group_dates(observations):
    grouped: dict[int, list[dict]] = {}
    for observation in observations:
        grouped.setdefault(observation["day"], []).append(observation)
    # Same-day overlaps are mosaicked pixel-wise, but can support only one date.
    return sorted(grouped.items())


def _indices(observations: list[dict], window: Window):
    height, width = int(window.height), int(window.width)
    ndvi = np.full((height, width), np.nan, dtype=np.float32)
    nbr = np.full_like(ndvi, np.nan)
    water = np.zeros((height, width), dtype=bool)
    filled = np.zeros_like(water)
    for observation in observations:
        image, scl = observation["image"], observation["scl"]
        bands = image.read(window=window)
        codes = scl.read(1, window=window)
        valid = (image.read_masks(window=window) > 0).all(axis=0)
        valid &= (scl.read_masks(1, window=window) > 0) & np.isin(codes, (4, 5, 6))
        valid &= np.isfinite(bands).all(axis=0)
        red, nir, swir2 = bands[2], bands[3], bands[5]
        first_denominator, second_denominator = nir + red, nir + swir2
        valid &= (np.abs(first_denominator) > 1e-6) & (np.abs(second_denominator) > 1e-6)
        local_ndvi = np.zeros_like(red)
        local_nbr = np.zeros_like(red)
        np.divide(nir - red, first_denominator, out=local_ndvi, where=valid)
        np.divide(nir - swir2, second_denominator, out=local_nbr, where=valid)
        valid &= (np.abs(local_ndvi) <= 1) & (np.abs(local_nbr) <= 1)
        take = valid & ~filled
        ndvi[take], nbr[take] = local_ndvi[take], local_nbr[take]
        water[take] = codes[take] == 6
        filled |= take
    return ndvi, nbr, filled, water


def _nanmedian(values: np.ndarray) -> np.ndarray:
    # Avoid warnings for all-invalid columns without replacing missing data by 0.
    mask = np.isfinite(values)
    count = mask.sum(axis=0)
    sorted_values = np.sort(np.where(mask, values, np.inf), axis=0)
    lower = np.maximum((count - 1) // 2, 0)[None]
    upper = np.maximum(count // 2, 0)[None]
    lo = np.take_along_axis(sorted_values, lower, axis=0)[0]
    hi = np.take_along_axis(sorted_values, upper, axis=0)[0]
    result = np.full(count.shape, np.nan, dtype=np.float32)
    np.add(lo, hi, out=result, where=count > 0)
    result[count > 0] *= .5
    return result


def _screen_window(baseline, recent, window: Window, parameters: DetectionParameters):
    p = parameters
    baseline_ndvi, baseline_nbr, baseline_days, forest_days = [], [], [], []
    height, width = int(window.height), int(window.width)
    last_intact = np.full((height, width), -1, dtype=np.int32)
    for day, observations in baseline:
        ndvi, nbr, valid, water = _indices(observations, window)
        terrestrial = valid & ~water
        forest = terrestrial & (ndvi >= p.forest_ndvi_min) & (nbr >= p.forest_nbr_min)
        baseline_ndvi.append(np.where(terrestrial, ndvi, np.nan))
        baseline_nbr.append(np.where(terrestrial, nbr, np.nan))
        baseline_days.append(terrestrial)
        forest_days.append(forest)
        last_intact[forest] = day
    base_ndvi_stack = np.stack(baseline_ndvi)
    base_nbr_stack = np.stack(baseline_nbr)
    baseline_count = np.stack(baseline_days).sum(axis=0, dtype=np.int32)
    forest_count = np.stack(forest_days).sum(axis=0, dtype=np.int32)
    base_ndvi, base_nbr = _nanmedian(base_ndvi_stack), _nanmedian(base_nbr_stack)
    ndvi_mad = _nanmedian(np.abs(base_ndvi_stack - base_ndvi))
    nbr_mad = _nanmedian(np.abs(base_nbr_stack - base_nbr))
    eligible = (
        (baseline_count >= p.min_baseline_days) & (forest_count >= p.min_baseline_days)
        & (base_ndvi >= p.forest_ndvi_min) & (base_nbr >= p.forest_nbr_min)
    )
    ndvi_threshold = np.maximum(p.ndvi_drop_min, p.mad_multiplier * ndvi_mad)
    nbr_threshold = np.maximum(p.nbr_drop_min, p.mad_multiplier * nbr_mad)
    clear_count = np.zeros((height, width), dtype=np.int32)
    anomaly_count = np.zeros_like(clear_count)
    streak = np.zeros_like(clear_count)
    pending_first = np.full_like(clear_count, -1)
    pending_bound = np.full_like(clear_count, -1)
    event_first = np.full_like(clear_count, -1)
    event_bound = np.full_like(clear_count, -1)
    corroborated = np.full_like(clear_count, -1)
    latest_valid = np.full_like(clear_count, -1)
    latest_anomalous = np.zeros_like(eligible)
    for day, observations in recent:
        ndvi, nbr, valid, _ = _indices(observations, window)
        observed = valid & eligible
        anomalous = (
            observed & (base_ndvi - ndvi >= ndvi_threshold)
            & (base_nbr - nbr >= nbr_threshold) & (ndvi <= p.post_ndvi_max)
        )
        clear_count[observed] += 1
        anomaly_count[anomalous] += 1
        latest_valid[observed] = day
        latest_anomalous[observed] = anomalous[observed]
        new_run = anomalous & (streak == 0)
        pending_first[new_run] = day
        pending_bound[new_run] = last_intact[new_run]
        streak[anomalous] += 1
        no_anomaly = observed & ~anomalous
        streak[no_anomaly] = 0
        pending_first[no_anomaly] = -1
        pending_bound[no_anomaly] = -1
        newly_corroborated = anomalous & (streak >= p.corroborating_days) & (corroborated < 0)
        event_first[newly_corroborated] = pending_first[newly_corroborated]
        event_bound[newly_corroborated] = pending_bound[newly_corroborated]
        corroborated[newly_corroborated] = day
        intact = no_anomaly & (ndvi >= p.forest_ndvi_min) & (nbr >= p.forest_nbr_min)
        last_intact[intact] = day
    status = np.zeros((height, width), dtype=np.uint8)
    status[eligible] = 1
    status[eligible & (clear_count >= p.corroborating_days)] = 2
    status[eligible & (streak > 0) & (corroborated < 0)] = 3
    status[(corroborated >= 0) & latest_anomalous] = 4
    status[(corroborated >= 0) & ~latest_anomalous] = 5
    pending = (status == 3)
    event_first[pending] = pending_first[pending]
    event_bound[pending] = pending_bound[pending]
    measurements = np.stack((
        eligible.astype(np.int32), baseline_count, clear_count, anomaly_count,
        event_first, event_bound, corroborated, latest_valid,
    ))
    return status, measurements


def _range(values: np.ndarray) -> list[str | None]:
    valid = values[values >= 0]
    return [_iso(int(valid.min())), _iso(int(valid.max()))] if valid.size else [None, None]


def _valid_polygonal(geometry):
    """Preserve diagonally touching raster cells as valid polygon parts."""
    repaired = geometry if geometry.is_valid else make_valid(geometry)
    polygons = []

    def collect(item):
        if item.geom_type == "Polygon":
            polygons.append(item)
        elif hasattr(item, "geoms"):
            for part in item.geoms:
                collect(part)

    collect(repaired)
    if not polygons:
        raise ValueError("Candidate topology contains no polygonal area.")
    polygonal = union_all(polygons)
    if polygonal.is_empty or not polygonal.is_valid:
        raise ValueError("Candidate polygon topology could not be repaired.")
    return polygonal


def _polygonize(status_path: Path, observations_path: Path, region_id: str,
                output_path: Path, parameters: DetectionParameters, recent_start: int):
    features = []
    with rasterio.open(status_path) as status_src, rasterio.open(observations_path) as observations:
        status = status_src.read(1)
        mask = np.isin(status, (4, 5))
        components, number = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
        if number > 20_000:
            raise ValueError("Candidate map is too fragmented for the bounded pilot.")
        slices = ndimage.find_objects(components)
        for geometry, component in shapes(components.astype(np.int32), mask=mask,
                                          connectivity=8, transform=status_src.transform):
            component = int(component)
            native = _valid_polygonal(shape(geometry))
            transformed = transform_geom(status_src.crs, "EPSG:4326", mapping(native), precision=7)
            polygonal = _valid_polygonal(shape(transformed))
            wgs84 = mapping(polygonal)
            area = abs(GEOD.geometry_area_perimeter(polygonal)[0]) / 10_000
            if not np.isfinite(area) or area < parameters.min_area_ha:
                continue
            y_slice, x_slice = slices[component - 1]
            window = Window.from_slices(y_slice, x_slice)
            local_mask = components[y_slice, x_slice] == component
            values = observations.read(window=window)[:, local_mask]
            local_status = status[y_slice, x_slice][local_mask]
            recently_intact = values[5] >= recent_start
            censoring = (
                "observed_new_recent_loss" if recently_intact.all()
                else "left_censored_possible_loss_since_baseline" if not recently_intact.any()
                else "mixed_censoring_candidate"
            )
            features.append({
                "type": "Feature", "geometry": wgs84,
                "properties": {
                    "id": f"{region_id}-candidate-{len(features) + 1:04d}",
                    "class": "candidate_persistent_vegetation_loss",
                    "validated_deforestation": False,
                    "cause": None,
                    "observation_classification": censoring,
                    "left_censored_pixel_fraction": round(float(np.mean(~recently_intact)), 4),
                    "area_ha": round(float(area), 4),
                    "pixel_count": int(local_mask.sum()),
                    "first_anomaly_date_range": _range(values[4]),
                    "last_intact_before_first_anomaly_date_range": _range(values[5]),
                    "corroboration_date_range": _range(values[6]),
                    "latest_valid_observation_date_range": _range(values[7]),
                    "min_recent_clear_days": int(values[2].min()),
                    "max_recent_clear_days": int(values[2].max()),
                    "latest_clear_non_anomalous_pixel_fraction": round(float(np.mean(local_status == 5)), 4),
                    "needs_post_disturbance_review": True,
                },
            })
    collection = {
        "type": "FeatureCollection", "features": features,
        "method": "spectral_persistence_baseline_v1",
        "validated_deforestation": False,
        "limitations": [
            "Corroboration is repeated spectral evidence, not independent validation.",
            "Flooding, burning, harvest and forest management may generate candidates.",
            "No economic driver, permanence or responsibility is inferred.",
            "SWIR resampling does not increase its native spatial detail.",
            "Date ranges express observation bounds, not exact disturbance times.",
            "Without a clear intact observation during the recent period, loss is left-censored and may predate that period.",
        ],
    }
    output_path.write_text(json.dumps(collection, indent=2, ensure_ascii=False), encoding="utf-8")
    return collection


def run_region(region: dict, manifest_dir: Path, cutoff: int, output: Path,
               parameters: DetectionParameters) -> dict:
    parameters.validate()
    region_id = region.get("id")
    if not isinstance(region_id, str) or not region_id or Path(region_id).name != region_id or region_id in (".", ".."):
        raise ValueError("Region id must be a simple nonempty path component.")
    directory = output / region_id
    directory.mkdir(parents=True, exist_ok=True)
    status_path = directory / "vegetation_loss_status.tif"
    observations_path = directory / "observation_evidence.tif"
    with ExitStack() as stack:
        template, baseline, recent = _open_region(region, manifest_dir, cutoff, stack)
        profile = {
            "driver": "GTiff", "width": template.width, "height": template.height,
            "crs": template.crs, "transform": template.transform,
            "compress": "deflate", "tiled": True,
        }
        status_dst = stack.enter_context(rasterio.open(status_path, "w", count=1, dtype="uint8", nodata=0, **profile))
        evidence_dst = stack.enter_context(rasterio.open(observations_path, "w", count=8, dtype="int32", nodata=-1, **profile))
        status_dst.set_band_description(1, "spectral_persistence_status")
        status_dst.update_tags(status_legend=json.dumps(STATUS), validated_deforestation="false")
        for index, name in enumerate(OBSERVATION_BANDS, 1):
            evidence_dst.set_band_description(index, name)
        evidence_dst.update_tags(date_encoding="days since 1970-01-01 UTC; -1 missing", count_units="distinct valid UTC acquisition dates")
        counts = {int(key): 0 for key in STATUS}
        observable = 0
        baseline_supported = 0
        for row in range(0, template.height, parameters.tile_size):
            for col in range(0, template.width, parameters.tile_size):
                window = Window(col, row, min(parameters.tile_size, template.width - col),
                                min(parameters.tile_size, template.height - row))
                status, measurements = _screen_window(baseline, recent, window, parameters)
                status_dst.write(status, 1, window=window)
                evidence_dst.write(measurements, window=window)
                for value, count in zip(*np.unique(status, return_counts=True)):
                    counts[int(value)] += int(count)
                observable += int(((measurements[0] == 1) & (measurements[2] >= parameters.corroborating_days)).sum())
                baseline_supported += int((measurements[1] >= parameters.min_baseline_days).sum())
        pixel_area = abs(template.transform.a * template.transform.e) / 10_000
        grid = {"crs": str(template.crs), "width": template.width, "height": template.height,
                "transform": list(template.transform)[:6], "pixel_area_ha_projected": pixel_area}
    collection = _polygonize(status_path, observations_path, region_id,
                             directory / "candidates.geojson", parameters, recent[0][0])
    eligible = sum(count for key, count in counts.items() if key > 0)
    summary = {
        "region": region_id, "method": "spectral_persistence_baseline_v1",
        "parameters": asdict(parameters), "grid": grid,
        "baseline_unique_dates": [_iso(day) for day, _ in baseline],
        "recent_unique_dates": [_iso(day) for day, _ in recent],
        "status_pixel_counts": {STATUS[key]: count for key, count in counts.items()},
        "baseline_supported_area_ha_projected": round(baseline_supported * pixel_area, 4),
        "eligible_forest_area_ha_projected": round(eligible * pixel_area, 4),
        "observable_eligible_area_ha_projected": round(observable * pixel_area, 4),
        "eligible_area_with_insufficient_recent_observations_ha_projected": round((eligible - observable) * pixel_area, 4),
        "candidate_polygon_count": len(collection["features"]),
        "candidate_area_ha_geodesic": round(sum(x["properties"]["area_ha"] for x in collection["features"]), 4),
        "candidate_count_by_observation_classification": {
            name: sum(x["properties"]["observation_classification"] == name for x in collection["features"])
            for name in ("observed_new_recent_loss", "left_censored_possible_loss_since_baseline", "mixed_censoring_candidate")
        },
        "candidate_area_ha_geodesic_by_observation_classification": {
            name: round(sum(x["properties"]["area_ha"] for x in collection["features"]
                            if x["properties"]["observation_classification"] == name), 4)
            for name in ("observed_new_recent_loss", "left_censored_possible_loss_since_baseline", "mixed_censoring_candidate")
        },
        "accuracy_evaluated": False, "validated_deforestation": False,
        "area_note": "Raster coverage areas use the projected grid; candidate polygons use WGS84 geodesic hectares.",
        "selection_note": "Same-day scenes count once; invalid/cloud observations do not reset or corroborate candidates.",
        "limitations": collection["limitations"],
    }
    (directory / "detection_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


def run(manifest: Path, output: Path, parameters: DetectionParameters | None = None) -> dict:
    parameters = parameters or DetectionParameters()
    parameters.validate()
    payload = manifest.read_bytes()
    config = json.loads(payload)
    cutoff = _day(config["cutoff_utc"])
    regions = config.get("regions")
    if not isinstance(regions, list) or not regions:
        raise ValueError("Manifest requires a nonempty regions list.")
    if len({x.get("id") for x in regions}) != len(regions):
        raise ValueError("Region ids must be unique.")
    output.mkdir(parents=True, exist_ok=True)
    result = {
        "study_id": config.get("study_id"), "cutoff_utc": config["cutoff_utc"],
        "manifest_sha256": hashlib.sha256(payload).hexdigest(),
        "method": "spectral_persistence_baseline_v1",
        "parameters": asdict(parameters), "validated_deforestation": False,
        "regions": [run_region(x, manifest.resolve().parent, cutoff, output, parameters) for x in regions],
    }
    (output / "detection_summary.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--min-area-ha", type=float, default=DetectionParameters.min_area_ha)
    parser.add_argument("--tile-size", type=int, default=DetectionParameters.tile_size)
    args = parser.parse_args()
    result = run(args.manifest, args.output, DetectionParameters(min_area_ha=args.min_area_ha, tile_size=args.tile_size))
    print(json.dumps({"study_id": result["study_id"], "regions": [
        {"id": x["region"], "candidates": x["candidate_polygon_count"], "candidate_area_ha": x["candidate_area_ha_geodesic"]}
        for x in result["regions"]
    ]}, indent=2))


if __name__ == "__main__":
    main()
