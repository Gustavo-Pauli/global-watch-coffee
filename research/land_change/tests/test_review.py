"""Reference evidence stays cloud-masked, dated, blind, and immutable."""

import json
import sys

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from research.land_change import review
from research.land_change.common import file_hash


def test_masked_average_excludes_native_clouds_before_spatial_aggregation():
    bands = np.full((6, 8, 8), .2, dtype="float32")
    bands[:, 0, 0] = 999
    valid = np.ones((8, 8), dtype=bool)
    valid[0, 0] = False
    valid[4:, 4:] = False
    averaged = review.masked_block_average(bands, valid, factor=4)
    assert averaged.shape == (6, 2, 2)
    assert averaged[:, 0, 0] == pytest.approx(np.full(6, .2))
    assert np.isnan(averaged[:, 1, 1]).all()  # Missing evidence never becomes black/zero reflectance.


def test_temporal_overview_masks_native_cloud_pixel_even_if_nearest_scl_is_clear(tmp_path):
    image, scl_path = tmp_path / "scene.tif", tmp_path / "scl.tif"
    transform = from_origin(600000, 9200000, 10, 10)
    bands = np.full((6, 8, 8), .2, dtype="float32")
    bands[:, 0, 0] = 999
    scl = np.full((8, 8), 4, dtype="uint8")
    scl[0, 0] = 9
    with rasterio.open(image, "w", driver="GTiff", width=8, height=8, count=6,
                       dtype="float32", crs="EPSG:32721", transform=transform) as dst:
        dst.write(bands)
    with rasterio.open(scl_path, "w", driver="GTiff", width=8, height=8, count=1,
                       dtype="uint8", crs="EPSG:32721", transform=transform) as dst:
        dst.write(scl, 1)
    region = {"scenes": [{"phase": "recent", "image": str(image), "scl": str(scl_path)}]}
    composite = review.median_composite(region, "recent")
    assert composite[:, 0, 0] == pytest.approx(np.full(6, .2))


def freeze_inputs(tmp_path, monkeypatch):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"study_id": "pilot", "regions": [{"id": "pilot"}]}), encoding="utf-8")
    output = tmp_path / "review"
    output.mkdir()
    card = output / "pilot-samples-00.jpg"
    card.write_bytes(b"original evidence")
    samples = [{"id": "sample-a", "label": None}]
    monkeypatch.setattr(review, "blind_samples", lambda *args: samples)
    monkeypatch.setattr(review, "overview", lambda *args: pytest.fail("Frozen evidence must not be regenerated"))
    monkeypatch.setattr(review, "contact_sheets", lambda *args: pytest.fail("Frozen cards must not be regenerated"))
    monkeypatch.setattr(sys, "argv", ["review", "--manifest", str(manifest), "--output", str(output)])
    return manifest, output, card


@pytest.mark.parametrize("existing_freeze", [True, False])
def test_edited_annotations_preserve_visual_cards_on_rerun(tmp_path, monkeypatch, existing_freeze):
    manifest, output, card = freeze_inputs(tmp_path, monkeypatch)
    target = output / "blind_samples.json"
    original = json.dumps({"samples": [{"id": "sample-a", "label": 1}]}).encode()
    target.write_bytes(original)
    freeze = output / "review_freeze.json"
    if existing_freeze:
        freeze.write_text(json.dumps({"manifest_sha256": file_hash(manifest)}), encoding="utf-8")
    with pytest.raises(ValueError, match="Edited annotations"):
        review.main()
    assert card.read_bytes() == b"original evidence"
    assert target.read_bytes() == original
    assert freeze.exists() == existing_freeze


def test_changed_manifest_cannot_replace_frozen_review_evidence(tmp_path, monkeypatch):
    _, output, card = freeze_inputs(tmp_path, monkeypatch)
    freeze = output / "review_freeze.json"
    original = b'{"manifest_sha256":"another-manifest"}\n'
    freeze.write_bytes(original)
    with pytest.raises(ValueError, match="another manifest"):
        review.main()
    assert card.read_bytes() == b"original evidence"
    assert freeze.read_bytes() == original


def sample_region():
    def scene(identifier, date, phase, clear):
        return {"id": identifier, "date": date, "phase": phase,
                "quality": {"full_resolution_clear_percent": clear}}
    return {"id": "holdout", "role": "geographic_holdout", "width": 300, "height": 300,
            "crs": "EPSG:32721", "transform": list(from_origin(600000, 9200000, 10, 10))[:6],
            "scenes": [scene("baseline", "2025-08-01T14:00:00Z", "baseline", 100),
                       scene("early", "2026-08-11T14:00:00Z", "recent", 90),
                       scene("target", "2026-09-21T14:00:00Z", "recent", 95),
                       scene("newer_cloudy", "2026-10-21T14:00:00Z", "recent", 15)]}


def test_blind_reference_samples_have_explicit_date_and_spatial_support():
    region = sample_region()
    samples = review.blind_samples(region, 20261102)
    assert samples
    assert all(sample["target_scene_id"] == "target" for sample in samples)
    assert all(sample["target_date"] == "2026-09-21T14:00:00Z" for sample in samples)
    assert all(sample["label_support_m"] == 160 for sample in samples)
    assert all(sample["label"] is None and sample["reference_kind"] == "unreviewed" for sample in samples)
    assert all(sample["split"] == "transfer_test" for sample in samples)
    assert len({sample["block"] for sample in samples}) == len(samples)
    assert samples == review.blind_samples(region, 20261102)  # Same seed cannot change the reference frame.
