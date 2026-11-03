"""Temporal screening safeguards using real georeferenced synthetic rasters."""

from dataclasses import replace
import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import shape

from research.land_change.detect import DetectionParameters, run


FOREST = np.array([.04, .08, .05, .50, .12, .10], dtype="float32")
LOSS = np.array([.10, .14, .20, .25, .28, .30], dtype="float32")
GRID = from_origin(600000, 9200000, 10, 10)


def scene(tmp_path: Path, name: str, day: str, phase: str,
          reflectance=FOREST, scl=4, transform=GRID):
    image = tmp_path / f"{name}.tif"
    quality = tmp_path / f"{name}_scl.tif"
    bands = np.broadcast_to(np.asarray(reflectance)[:, None, None], (6, 12, 12)).copy()
    if np.ndim(scl) == 0:
        scl = np.full((12, 12), scl, dtype="uint8")
    with rasterio.open(image, "w", driver="GTiff", width=12, height=12, count=6,
                       dtype="float32", nodata=np.nan, crs="EPSG:32721", transform=transform) as dst:
        dst.write(bands)
    with rasterio.open(quality, "w", driver="GTiff", width=12, height=12, count=1,
                       dtype="uint8", nodata=0, crs="EPSG:32721", transform=transform) as dst:
        dst.write(scl.astype("uint8"), 1)
    return {"id": name, "date": day, "phase": phase, "image": str(image), "scl": str(quality)}


def manifest(tmp_path, recent, baseline_days=("2025-08-01", "2025-08-11")):
    baseline = [scene(tmp_path, f"baseline_{index}", day, "baseline")
                for index, day in enumerate(baseline_days)]
    payload = {"study_id": "test-study", "cutoff_utc": "2026-11-02T23:59:59Z",
               "regions": [{"id": "pilot", "scenes": baseline + recent}]}
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def execute(tmp_path, recent, *, baseline_days=("2025-08-01", "2025-08-11"), tile=5):
    path = manifest(tmp_path, recent, baseline_days)
    output = tmp_path / "outputs"
    result = run(path, output, DetectionParameters(min_area_ha=.1, tile_size=tile))
    collection = json.loads((output / "pilot/candidates.geojson").read_text(encoding="utf-8"))
    with rasterio.open(output / "pilot/vegetation_loss_status.tif") as src:
        status = src.read(1)
    return result["regions"][0], collection, status


def test_cloud_gaps_neither_corroborate_nor_reset_and_dates_are_bounded(tmp_path):
    recent = [
        scene(tmp_path, "intact", "2026-08-01", "recent"),
        scene(tmp_path, "first", "2026-08-11", "recent", LOSS),
        scene(tmp_path, "cloud", "2026-08-16", "recent", FOREST, scl=9),
        scene(tmp_path, "second", "2026-08-21", "recent", LOSS),
    ]
    summary, collection, status = execute(tmp_path, recent)
    assert (status == 4).all()
    assert summary["candidate_polygon_count"] == 1  # Component crosses processing tiles.
    candidate = collection["features"][0]["properties"]
    assert candidate["first_anomaly_date_range"] == ["2026-08-11", "2026-08-11"]
    assert candidate["last_intact_before_first_anomaly_date_range"] == ["2026-08-01", "2026-08-01"]
    assert candidate["corroboration_date_range"] == ["2026-08-21", "2026-08-21"]
    assert candidate["min_recent_clear_days"] == 3
    assert candidate["observation_classification"] == "observed_new_recent_loss"
    assert candidate["validated_deforestation"] is False
    assert summary["accuracy_evaluated"] is False


def test_cloud_does_not_count_as_a_second_anomaly(tmp_path):
    recent = [
        scene(tmp_path, "first", "2026-08-11", "recent", LOSS),
        scene(tmp_path, "cloud", "2026-08-21", "recent", LOSS, scl=9),
    ]
    summary, collection, status = execute(tmp_path, recent)
    assert (status == 3).all()
    assert collection["features"] == []
    assert summary["observable_eligible_area_ha_projected"] == 0
    assert summary["eligible_area_with_insufficient_recent_observations_ha_projected"] == pytest.approx(1.44)


def test_missing_non_index_band_cannot_corroborate_a_loss(tmp_path):
    missing_blue = LOSS.copy()
    missing_blue[0] = np.nan
    recent = [
        scene(tmp_path, "first", "2026-08-11", "recent", LOSS),
        scene(tmp_path, "missing_blue", "2026-08-21", "recent", missing_blue),
    ]
    summary, collection, status = execute(tmp_path, recent)
    assert (status == 3).all()
    assert collection["features"] == []
    assert summary["observable_eligible_area_ha_projected"] == 0


def test_clear_non_anomaly_resets_pending_run(tmp_path):
    recent = [
        scene(tmp_path, "first", "2026-08-11", "recent", LOSS),
        scene(tmp_path, "intact", "2026-08-16", "recent", FOREST),
        scene(tmp_path, "second", "2026-08-21", "recent", LOSS),
    ]
    _, collection, status = execute(tmp_path, recent)
    assert (status == 3).all()
    assert collection["features"] == []


def test_single_baseline_observation_cannot_establish_eligibility(tmp_path):
    recent = [scene(tmp_path, f"loss_{index}", day, "recent", LOSS)
              for index, day in enumerate(("2026-08-11", "2026-08-21"))]
    summary, collection, status = execute(tmp_path, recent, baseline_days=("2025-08-01",))
    assert not status.any()
    assert summary["eligible_forest_area_ha_projected"] == 0
    assert collection["features"] == []


def test_overlapping_scenes_on_same_day_do_not_corroborate(tmp_path):
    recent = [scene(tmp_path, name, "2026-08-11", "recent", LOSS)
              for name in ("orbit_a", "orbit_b")]
    summary, collection, status = execute(tmp_path, recent)
    assert (status == 3).all()
    assert len(summary["recent_unique_dates"]) == 1
    assert collection["features"] == []


def test_loss_at_first_recent_observation_is_left_censored(tmp_path):
    recent = [scene(tmp_path, f"loss_{index}", day, "recent", LOSS)
              for index, day in enumerate(("2026-08-11", "2026-08-21"))]
    summary, collection, _ = execute(tmp_path, recent)
    candidate = collection["features"][0]["properties"]
    assert candidate["observation_classification"] == "left_censored_possible_loss_since_baseline"
    assert candidate["left_censored_pixel_fraction"] == 1
    assert candidate["last_intact_before_first_anomaly_date_range"] == ["2025-08-11", "2025-08-11"]
    assert summary["candidate_count_by_observation_classification"]["observed_new_recent_loss"] == 0


def test_latest_clear_non_anomaly_retains_original_candidate_for_review(tmp_path):
    recent = [
        scene(tmp_path, "first", "2026-08-11", "recent", LOSS),
        scene(tmp_path, "second", "2026-08-21", "recent", LOSS),
        scene(tmp_path, "rebound", "2026-08-26", "recent", FOREST),
    ]
    _, collection, status = execute(tmp_path, recent)
    assert (status == 5).all()
    assert collection["features"][0]["properties"]["latest_clear_non_anomalous_pixel_fraction"] == 1


def test_diagonally_touching_loss_cells_export_valid_polygon_parts_without_changing_area(tmp_path):
    mask = np.zeros((12, 12), dtype=bool)
    mask[1:5, 1:5] = True
    mask[5:9, 5:9] = True
    recent = [scene(tmp_path, f"loss_{index}", day, "recent", LOSS)
              for index, day in enumerate(("2026-08-11", "2026-08-21"))]
    for item in recent:
        with rasterio.open(item["image"], "r+") as source:
            bands = source.read()
            bands[:, ~mask] = FOREST[:, None]
            source.write(bands)
    _, collection, status = execute(tmp_path, recent)
    assert int((status == 4).sum()) == 32
    assert len(collection["features"]) == 1
    candidate = collection["features"][0]
    assert shape(candidate["geometry"]).is_valid
    assert shape(candidate["geometry"]).geom_type == "MultiPolygon"
    assert candidate["properties"]["pixel_count"] == 32
    assert candidate["properties"]["area_ha"] == pytest.approx(.32, abs=.01)


@pytest.mark.parametrize("field,value", [
    ("ndvi_drop_min", None), ("nbr_drop_min", float("nan")),
    ("forest_ndvi_min", float("inf")), ("min_area_ha", 0),
    ("corroborating_days", 1), ("min_baseline_days", 1),
    ("tile_size", 1.5), ("forest_nbr_min", True),
])
def test_invalid_parameters_are_rejected(field, value):
    with pytest.raises(ValueError):
        replace(DetectionParameters(), **{field: value}).validate()


def test_future_scene_is_rejected_instead_of_leaking_into_analysis(tmp_path):
    recent = [scene(tmp_path, "future", "2026-11-03", "recent", LOSS)]
    with pytest.raises(ValueError, match="cutoff"):
        execute(tmp_path, recent)


def test_baseline_cannot_include_an_observation_from_recent_period(tmp_path):
    recent = [scene(tmp_path, "recent", "2026-08-11", "recent", LOSS)]
    with pytest.raises(ValueError, match="predate"):
        execute(tmp_path, recent, baseline_days=("2026-08-11", "2026-08-21"))


def test_misaligned_grid_is_rejected(tmp_path):
    recent = [scene(tmp_path, "shifted", "2026-08-11", "recent", LOSS,
                    transform=from_origin(600010, 9200000, 10, 10))]
    with pytest.raises(ValueError, match="same grid"):
        execute(tmp_path, recent)
