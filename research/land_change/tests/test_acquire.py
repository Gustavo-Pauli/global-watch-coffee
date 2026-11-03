from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import json
import sys
import threading

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from research.land_change import acquire
from research.land_change.acquire import asset_url, grid_for_region, select_scenes
from research.land_change.common import config_hash, file_hash


def test_data_urls_are_restricted_to_public_catalog_asset_host():
    with pytest.raises(ValueError, match="Unexpected data host"):
        asset_url({"assets": {"red": {"href": "http://127.0.0.1/private"}}}, "red")
    with pytest.raises(ValueError, match="Unexpected data host"):
        asset_url({"assets": {"red": {"href": "https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com.evil.test/B04.tif"}}}, "red")


def test_cloud_selection_uses_aoi_quality_not_scene_percent_and_rejects_partial_footprints():
    config = {"selection_interval_days": 8, "min_region_clear_percent": 15}
    def item(identifier, date, clear, covered=100):
        return {"id": identifier, "date": date, "quality": {"clear_percent": clear, "covered_percent": covered, "scene_cloud_percent": 99-clear}}
    first = datetime.fromisoformat("2026-08-01T00:00:00+00:00")
    bucket = int(first.timestamp()//(8*86400))
    date = datetime.fromtimestamp((bucket*8+1)*86400).isoformat()+"Z"
    entries = [item("bad", date, 0), item("partial", date, 99, 92), item("good", date, 80), item("inferior", date, 45)]
    assert [entry["id"] for entry in select_scenes(config, entries, 12)] == ["good"]


def test_projected_grid_is_metric_aligned_and_config_identity_is_order_invariant():
    grid = grid_for_region({"resolution_m": 10}, {"bbox": [-55.5, -7.2, -55.3, -7.0]})
    assert grid["crs"] == "EPSG:32721"
    assert grid["width"] > 2000 and grid["height"] > 2000
    assert grid["transform"][0] == 10 and grid["transform"][4] == -10
    assert grid["transform"][2] % 10 == 0
    assert config_hash({"b": 2, "a": 1}) == config_hash({"a": 1, "b": 2})


def cached_scene(tmp_path):
    scene = {"id": "cached", "date": "2026-10-01T14:00:00Z", "phase": "recent"}
    region = {"id": "pilot", "width": 12, "height": 12, "crs": "EPSG:32721",
              "transform": list(from_origin(600000, 9200000, 10, 10))[:6]}
    directory = tmp_path / "scenes/pilot/cached"
    directory.mkdir(parents=True)
    record = dict(scene)
    for kind, count, dtype in (("image", 6, "float32"), ("scl", 1, "uint8")):
        path = directory / f"{kind}.tif"
        with rasterio.open(path, "w", driver="GTiff", width=12, height=12, count=count,
                           dtype=dtype, crs=region["crs"], transform=rasterio.Affine(*region["transform"])) as dst:
            dst.write(np.ones((count, 12, 12), dtype=dtype))
        record[kind] = str(path)
        record[kind + "_sha256"] = file_hash(path)
    (directory / "scene.json").write_text(json.dumps(record), encoding="utf-8")
    return scene, region, record


def test_unchanged_cached_scene_needs_no_remote_access(tmp_path, monkeypatch):
    scene, region, record = cached_scene(tmp_path)
    monkeypatch.setattr(acquire, "_download_scene", lambda *args: pytest.fail("Cache hit must not redownload"))
    assert acquire.download_scene({}, tmp_path, region, scene) == record


@pytest.mark.parametrize("kind,mutation", [("image", "missing"), ("scl", "corrupt")])
def test_cached_rasters_must_exist_and_match_their_recorded_hash(tmp_path, kind, mutation):
    from pathlib import Path
    scene, region, record = cached_scene(tmp_path)
    path = Path(record[kind])
    if mutation == "missing":
        path.unlink()
    else:
        with path.open("ab") as target:
            target.write(b"changed")
    with pytest.raises(ValueError, match="missing or corrupt"):
        acquire.download_scene({}, tmp_path, region, scene)


def test_cached_raster_cannot_be_reused_with_another_grid(tmp_path):
    scene, region, _ = cached_scene(tmp_path)
    region["transform"][2] += 10
    with pytest.raises(ValueError, match="grid differs"):
        acquire.download_scene({}, tmp_path, region, scene)


def test_cached_scene_cannot_be_reused_with_changed_acquisition_identity(tmp_path):
    scene, region, _ = cached_scene(tmp_path)
    scene["date"] = "2026-10-02T14:00:00Z"
    with pytest.raises(ValueError, match="identity differs"):
        acquire.download_scene({}, tmp_path, region, scene)


def test_concurrent_downloads_reserve_disk_budget_before_they_start(tmp_path, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    region = {"id": "pilot", "width": 12, "height": 12}
    reservation = region["width"] * region["height"] * 50 + 2_000_000
    config = {"disk_budget_bytes": reservation + 10_000}
    monkeypatch.setattr(acquire, "RESERVED_BYTES", 0)

    def blocked_download(config, output, region, scene, directory, completion):
        entered.set()
        if not release.wait(timeout=5):
            raise AssertionError("Test did not release first acquisition")
        return {"id": scene["id"]}

    monkeypatch.setattr(acquire, "_download_scene", blocked_download)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(acquire.download_scene, config, tmp_path, region, {"id": "first"})
        try:
            assert entered.wait(timeout=3)
            second = pool.submit(acquire.download_scene, config, tmp_path, region, {"id": "second"})
            with pytest.raises(ValueError, match="disk budget"):
                second.result(timeout=3)
        finally:
            release.set()
        assert first.result(timeout=3) == {"id": "first"}
    assert acquire.RESERVED_BYTES == 0


def test_failed_download_releases_reserved_disk_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(acquire, "RESERVED_BYTES", 0)
    monkeypatch.setattr(acquire, "_download_scene", lambda *args: (_ for _ in ()).throw(RuntimeError("Data unavailable")))
    with pytest.raises(RuntimeError, match="Data unavailable"):
        acquire.download_scene({"disk_budget_bytes": 10_000_000}, tmp_path,
                               {"id": "pilot", "width": 12, "height": 12}, {"id": "failed"})
    assert acquire.RESERVED_BYTES == 0


def test_catalog_cannot_silently_truncate_its_sampling_frame(monkeypatch):
    calls = []

    def page(url):
        calls.append(url)
        return {"features": [{"id": str(len(calls))}],
                "links": [{"rel": "next", "href": f"https://catalog.example/v1/search?page={len(calls)}"}]}

    monkeypatch.setattr(acquire, "get_json", page)
    with pytest.raises(ValueError, match="silently truncate"):
        acquire.catalog_items({"catalog": "https://catalog.example/v1", "collection": "sentinel"},
                              {"bbox": [-55.5, -7.2, -55.3, -7.0]}, "2026-08-01", "2026-11-02")
    assert len(calls) == 10


def test_changed_config_rerun_preserves_existing_freeze_before_any_inventory(tmp_path, monkeypatch):
    output = tmp_path / "output"
    output.mkdir()
    frozen = output / "study.json"
    original = b'{"study_id":"original","seed":1}\n'
    frozen.write_bytes(original)
    changed = tmp_path / "changed.json"
    changed.write_text('{"study_id":"changed","seed":2}', encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["acquire", "--config", str(changed), "--output", str(output), "--inventory-only"])
    monkeypatch.setattr(acquire, "inventory", lambda *args: pytest.fail("Changed freeze must be rejected first"))
    with pytest.raises(ValueError, match="existing study freeze"):
        acquire.main()
    assert frozen.read_bytes() == original
