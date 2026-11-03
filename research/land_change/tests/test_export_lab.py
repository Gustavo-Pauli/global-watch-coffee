"""Portable private bundles preserve dates/support and exclude source secrets."""

from io import BytesIO
import json
from pathlib import Path
import re
import shutil

import numpy as np
from PIL import Image
import pytest
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform, transform_geom

from research.land_change.common import file_hash, write_json
from research.land_change.export_lab import export, sample_frame


def fixture_study(workspace: Path):
    source = workspace / "experiments/outputs/land-change"
    source.mkdir(parents=True)
    affine = from_origin(600000, 9200000, 10, 10)
    scenes = []
    dates = [("baseline", "2025-08-01"), ("baseline", "2025-08-11"),
             ("recent", "2026-08-11"), ("recent", "2026-10-01")]
    for index, (phase, day) in enumerate(dates):
        sid = f"S2_fixture_{index}"
        directory = source / "scenes/pilot" / sid
        directory.mkdir(parents=True)
        image, scl = directory / "reflectance.tif", directory / "scl.tif"
        bands = np.broadcast_to(np.array([.04, .08, .05, .50, .12, .10], dtype="float32")[:, None, None], (6, 64, 64)).copy()
        bands[0] += index * .001  # Distinct source observations need unambiguous content identities.
        with rasterio.open(image, "w", driver="GTiff", width=64, height=64, count=6,
                           dtype="float32", nodata=np.nan, crs="EPSG:32721", transform=affine) as dst:
            dst.write(bands)
        with rasterio.open(scl, "w", driver="GTiff", width=64, height=64, count=1,
                           dtype="uint8", nodata=0, crs="EPSG:32721", transform=affine) as dst:
            dst.write(np.full((64, 64), 4, dtype="uint8"), 1)
        Image.new("RGB", (64, 64), (index * 30 + 20, 60, 30)).save(directory / "rgb.jpg")
        Image.new("RGB", (64, 64), (180, index * 20 + 10, 25)).save(directory / "false_color.jpg")
        scenes.append({"id": sid, "date": day + "T14:00:00Z", "phase": phase,
                       "image": str(image.resolve()), "scl": str(scl.resolve()),
                       "image_sha256": file_hash(image), "scl_sha256": file_hash(scl),
                       "quality": {"full_resolution_clear_percent": 100}})
    region = {"id": "pilot", "name": "Pilot", "role": "development", "bbox": [-1, -1, 1, 1],
              "crs": "EPSG:32721", "transform": list(affine)[:6], "width": 64, "height": 64, "scenes": scenes}
    identifier = "fixture-land-change"
    manifest = {"study_id": identifier, "cutoff_utc": "2026-11-02T23:59:59Z", "regions": [region]}
    write_json(source / "manifest.json", manifest)
    manifest_sha = file_hash(source / "manifest.json")
    write_json(source / "study.json", {"study_id": identifier, "max_baseline_scenes": 2, "max_recent_scenes": 2})
    candidate = {
        "type": "Feature", "geometry": transform_geom("EPSG:32721", "EPSG:4326", {
            "type": "Polygon", "coordinates": [[[600160, 9199520], [600320, 9199520],
                                                     [600320, 9199680], [600160, 9199680], [600160, 9199520]]]}),
        "properties": {"id": "pilot-candidate-0001", "area_ha": 2.56,
                       "observation_classification": "observed_new_recent_loss",
                       "first_anomaly_date_range": ["2026-10-01", "2026-10-01"],
                       "last_intact_before_first_anomaly_date_range": ["2026-08-11", "2026-08-11"],
                       "corroboration_date_range": ["2026-10-01", "2026-10-01"],
                       "latest_valid_observation_date_range": ["2026-10-01", "2026-10-01"],
                       "latest_clear_non_anomalous_pixel_fraction": 0,
                       "validated_deforestation": False, "cause": None,
                       "private_path": "C:\\Users\\private-person\\hidden"},
    }
    write_json(source / "detection/pilot/candidates.geojson", {
        "type": "FeatureCollection", "features": [candidate], "validated_deforestation": False})
    detection_region = {"region": "pilot", "candidate_polygon_count": 1, "candidate_area_ha_geodesic": 2.56,
                        "candidate_count_by_observation_classification": {"observed_new_recent_loss": 1},
                        "candidate_area_ha_geodesic_by_observation_classification": {"observed_new_recent_loss": 2.56}}
    write_json(source / "detection/detection_summary.json", {
        "study_id": identifier, "manifest_sha256": manifest_sha, "validated_deforestation": False,
        "parameters": {"min_area_ha": .5, "corroborating_days": 2}, "regions": [detection_region]})
    case_dir = source / "cases/pilot"
    case_dir.mkdir(parents=True)
    Image.new("RGB", (120, 50), (60, 80, 40)).save(case_dir / "pilot-candidate-0001.jpg")
    write_json(source / "cases/cases.json", {"study_id": identifier, "manifest_sha256": manifest_sha, "regions": [
        {"id": "pilot", "candidate_geojson_sha256": file_hash(source / "detection/pilot/candidates.geojson"),
         "cases": [{"candidate_id": "pilot-candidate-0001"}]}]})
    x, y = affine * (40.5, 40.5)
    lon, lat = transform("EPSG:32721", "EPSG:4326", [x], [y])
    sample = {"id": "pilot_00_00", "region": "pilot", "row": 40, "col": 40, "block": "0_0",
              "lon": lon[0], "lat": lat[0], "split": "train", "label_support_m": 160,
              "target_scene_id": scenes[-1]["id"], "target_date": scenes[-1]["date"],
              "label": 3, "reviewer": "private reviewer", "notes": "private annotation", "reference_kind": "human_visual_interpretation"}
    write_json(source / "review/blind_samples.json", {"study_id": identifier, "manifest_sha256": manifest_sha,
               "sampling_revision": 2, "model_predictions_shown": False, "samples": [sample]})
    write_json(source / "review/review_freeze.json", {"manifest_sha256": manifest_sha})
    quality = {"id": sample["id"], "scene_id": scenes[-1]["id"], "target_date": scenes[-1]["date"],
               "clear_fraction": 1, "status": "ready"}
    for name in ("feature_quality.json", "embedding_feature_quality.json"):
        write_json(source / "classification" / name, {"samples": [quality]})
    for name in ("metrics.json", "embedding_metrics.json"):
        write_json(source / "classification" / name, {"study_id": identifier, "manifest_sha256": manifest_sha,
                   "status": "insufficient_training_reference"})
    write_json(source / "summary.json", {"study_id": identifier, "classification_status": "insufficient_training_reference",
               "reference_sample_count": 1, "feature_quality_counts": {"ready": 1}, "mapbiomas_superiority_established": False})
    write_json(source / "model-probe/review-target/probe.json", {
        "input_sha256": scenes[-1]["image_sha256"], "scl_sha256": scenes[-1]["scl_sha256"],
        "model_license": "Apache-2.0", "feature_spacing_crs_units": [160.0, 160.0],
        "tile_count": 1, "inference_seconds": .5, "peak_cuda_allocated_bytes": 1024**2})
    write_json(source / "references/access-audit.json", {
        "mapbiomas_10m_2025": {"http_status": 403, "url": "https://private.invalid/?secret-token=hidden"},
        "mapbiomas_30m_2025": {"http_status": 403}, "dist_alert": [{"region": "pilot", "raster_probe": {"http_status": 401}}]})
    return source, manifest, sample


def export_fixture(workspace, source):
    private = workspace / "apps/web/.lab-data/bundles"
    return export(source, private, workspace=workspace)


def test_bundle_has_opaque_verified_assets_and_no_private_annotation_or_paths(tmp_path):
    source, manifest, _ = fixture_study(tmp_path)
    bundle, metrics = export_fixture(tmp_path, source)
    assert bundle["acquiredSceneCount"] == 4
    assert bundle["candidateCount"] == 1
    assert bundle["sampleCount"] == bundle["usableSampleCount"] == 1
    assert bundle["samplingRevision"] == 2
    assert len(bundle["samples"][0]["frames"]) == 3
    assert bundle["samples"][0]["targetSceneId"] == manifest["regions"][0]["scenes"][-1]["id"]
    assert len(bundle["caseCards"]) == 1
    assert len(bundle["papers"]) == 5
    assert metrics["labelsIncluded"] is False
    encoded = json.dumps(bundle)
    assert str(tmp_path) not in encoded
    assert "private reviewer" not in encoded and "private annotation" not in encoded and "secret-token" not in encoded
    assert "label" not in bundle["samples"][0] and "reviewer" not in bundle["samples"][0]
    assert "private_path" not in bundle["regions"][0]["candidates"]["features"][0]["properties"]
    target = tmp_path / "apps/web/.lab-data/bundles" / bundle["id"]
    for identifier, asset in bundle["assets"].items():
        assert re.fullmatch(r"[a-f0-9]{64}", identifier)
        assert asset["path"].startswith("assets/") and not Path(asset["path"]).is_absolute()
        path = target / asset["path"]
        assert file_hash(path) == identifier == asset["sha256"]
        assert path.stat().st_size == asset["bytes"]
    assert metrics["assetBytes"] < 1_000_000
    # The image alignment follows the actual raster footprint, not its arbitrary inventory bbox.
    assert bundle["regions"][0]["bounds"] != [[-1, -1], [1, 1]]


def test_export_is_stable_after_dataset_relocation_and_repeated_publication(tmp_path):
    source, manifest, _ = fixture_study(tmp_path)
    first, _ = export_fixture(tmp_path, source)
    relocated = tmp_path / "relocated-dataset"
    shutil.copytree(source, relocated)
    # Manifest paths still name the original directory. The portable exporter
    # must resolve the relocated files by their frozen source hierarchy instead.
    original_raster = Path(manifest["regions"][0]["scenes"][0]["image"])
    with original_raster.open("ab") as target:
        target.write(b"original no longer trustworthy")
    second, _ = export_fixture(tmp_path, relocated)
    assert second["fingerprint"] == first["fingerprint"]
    assert second["assets"] == first["assets"]
    private = tmp_path / "apps/web/.lab-data/bundles"
    assert not list(private.glob(".stage-*"))


def test_corrupt_source_raster_is_rejected_before_export(tmp_path):
    source, manifest, _ = fixture_study(tmp_path)
    path = Path(manifest["regions"][0]["scenes"][0]["image"])
    with path.open("ab") as target:
        target.write(b"corrupted")
    with pytest.raises(ValueError, match="integrity mismatch"):
        export_fixture(tmp_path, source)
    assert not (tmp_path / "apps/web/.lab-data/bundles").exists()


def test_mismatched_reference_freeze_is_rejected(tmp_path):
    source, _, _ = fixture_study(tmp_path)
    freeze = source / "review/review_freeze.json"
    freeze.write_text('{"manifest_sha256":"wrong"}', encoding="utf-8")
    with pytest.raises(ValueError, match="frozen manifest"):
        export_fixture(tmp_path, source)


def test_budget_failure_leaves_existing_bundle_intact_and_cleans_stage(tmp_path):
    source, _, _ = fixture_study(tmp_path)
    first, _ = export_fixture(tmp_path, source)
    private = tmp_path / "apps/web/.lab-data/bundles"
    published = private / first["id"] / "study.json"
    original = published.read_bytes()
    with pytest.raises(ValueError, match="budget"):
        export(source, private, workspace=tmp_path, max_asset_bytes=1)
    assert published.read_bytes() == original
    assert not list(private.glob(".stage-*"))


def test_public_or_outside_destination_is_forbidden(tmp_path):
    source, _, _ = fixture_study(tmp_path)
    for destination in (tmp_path / "apps/web/public/data", tmp_path.parent / "outside-data"):
        with pytest.raises(ValueError, match="public export is forbidden"):
            export(source, destination, workspace=tmp_path)


def test_frame_preserves_exact_support_boundary_date_and_native_clear_fraction(tmp_path):
    source, manifest, sample = fixture_study(tmp_path)
    scene = manifest["regions"][0]["scenes"][-1]
    quality_path = Path(scene["scl"])
    with rasterio.open(quality_path, "r+") as quality:
        scl = quality.read(1)
        scl[32, 32] = 9  # Inside the16x16 support.
        scl[24, 24] = 9  # In the surrounding context only.
        quality.write(scl, 1)
    with rasterio.open(scene["image"]) as image, rasterio.open(quality_path) as quality:
        content, clear = sample_frame(image, quality, sample, scene)
    card = Image.open(BytesIO(content))
    assert card.format == "PNG" and card.size == (390, 390)
    assert card.getpixel((115, 130)) == (255, 180, 0)
    assert card.getpixel((274, 289)) == (255, 180, 0)
    assert card.getpixel((114, 130)) != (255, 180, 0)
    assert clear == pytest.approx(255 / 256 * 100)
