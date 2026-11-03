"""Freeze a STAC inventory, audit AOI clouds, download bounded COG windows.

Only public metadata and data. No credentials, bucket writes, or worker/API calls.
Selection uses observation availability/quality, never predictions or change size.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import math
from pathlib import Path
import threading
import time
from urllib.parse import urlencode, urlparse
from urllib.request import urlopen

from affine import Affine
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds

from .common import DEFAULT_OUTPUT, ROOT, config_hash, file_hash, rgb_image, write_json

ALLOWED_HOST = "e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com"
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="40", GDAL_HTTP_MAX_RETRY="2", GDAL_HTTP_RETRY_DELAY="1", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_NUM_THREADS="1")
DISK_LOCK = threading.Lock()
RESERVED_BYTES = 0


def get_json(url):
    with urlopen(url, timeout=30) as response:
        return json.load(response)


def catalog_items(config, region, start, end):
    params = dict(collections=config["collection"], bbox=",".join(map(str, region["bbox"])), datetime=f"{start}/{end}", limit=100, sortby="properties.datetime")
    url = config["catalog"] + "/search?" + urlencode(params)
    items = []
    for page in range(10):
        result = get_json(url)
        items.extend(result.get("features", []))
        next_url = next((link["href"] for link in result.get("links", []) if link["rel"] == "next"), None)
        if not next_url:
            break
        if page == 9:
            raise ValueError("Catalog sampling frame exceeds page budget; do not silently truncate")
        if not next_url.startswith(config["catalog"] + "/"):
            raise ValueError("Unexpected catalog pagination host")
        url = next_url
    return items


def grid_for_region(config, region):
    lon, lat = (region["bbox"][0]+region["bbox"][2])/2, (region["bbox"][1]+region["bbox"][3])/2
    crs = f"EPSG:{(32700 if lat < 0 else 32600) + int((lon+180)//6)+1}"
    left, bottom, right, top = transform_bounds("EPSG:4326", crs, *region["bbox"], densify_pts=21)
    resolution = config["resolution_m"]
    left, bottom = math.floor(left/resolution)*resolution, math.floor(bottom/resolution)*resolution
    right, top = math.ceil(right/resolution)*resolution, math.ceil(top/resolution)*resolution
    return dict(crs=crs, transform=list(from_origin(left, top, resolution, resolution))[:6], width=round((right-left)/resolution), height=round((top-bottom)/resolution))


def asset_url(item, band):
    url = item["assets"][band]["href"]
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != ALLOWED_HOST:
        raise ValueError(f"Unexpected data host for {band}")
    return url


def read_asset(item, band, grid, overview=1):
    transform = Affine(*grid["transform"]) * Affine.scale(overview)
    width, height = math.ceil(grid["width"]/overview), math.ceil(grid["height"]/overview)
    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(asset_url(item, band)) as source:
            with WarpedVRT(source, crs=grid["crs"], transform=transform, width=width, height=height, resampling=Resampling.nearest if band == "scl" else Resampling.bilinear, nodata=0) as vrt:
                raw = vrt.read(1)
    if band == "scl":
        return raw
    radiometry = item["assets"][band]["raster:bands"][0]
    result = raw.astype(np.float32) * float(radiometry.get("scale", 1)) + float(radiometry.get("offset", 0))
    result[raw == 0] = np.nan
    return result


def quality(item, grid, classes):
    scl = read_asset(item, "scl", grid, overview=12)
    valid = scl != 0
    return dict(clear_percent=round(float(np.isin(scl, classes).mean()*100), 3), covered_percent=round(float(valid.mean()*100), 3), overview_resolution_m=120, scene_cloud_percent=item["properties"].get("eo:cloud_cover"))


def select_scenes(config, entries, maximum):
    buckets = {}
    for entry in entries:
        if entry.get("error") or entry["quality"]["covered_percent"] < 99 or entry["quality"]["clear_percent"] < config["min_region_clear_percent"]:
            continue
        timestamp = datetime.fromisoformat(entry["date"].replace("Z", "+00:00")).timestamp()
        bucket = int(timestamp // (config["selection_interval_days"]*86400))
        current = buckets.get(bucket)
        if current is None or entry["quality"]["clear_percent"] > current["quality"]["clear_percent"]:
            buckets[bucket] = entry
    selected = sorted(buckets.values(), key=lambda entry: entry["date"])
    if len(selected) > maximum:
        positions = np.linspace(0, len(selected)-1, maximum).round().astype(int)
        selected = [selected[position] for position in positions]
    return selected


def inventory(config, output):
    target = output / "inventory.json"
    if target.exists():
        result = json.loads(target.read_text(encoding="utf-8"))
        if result["config_sha256"] != config_hash(config):
            raise ValueError("Existing inventory belongs to another config; use another output directory")
        return result
    result = dict(study_id=config["study_id"], cutoff_utc=config["cutoff_utc"], config_sha256=config_hash(config), regions=[])
    for region in config["regions"]:
        grid = grid_for_region(config, region)
        record = {**region, **grid, "candidates": [], "scenes": []}
        for phase, start, end, maximum in [("baseline", config["baseline_start"], config["baseline_end"], config["max_baseline_scenes"]), ("recent", config["recent_start"], config["cutoff_utc"], config["max_recent_scenes"])]:
            items = catalog_items(config, region, start, end)
            # Store original metadata before selection to preserve the complete sampling frame.
            phase_entries = []
            for item in items:
                date = item["properties"]["datetime"]
                write_json(output / "stac" / (item["id"] + ".json"), item)
                entry = dict(id=item["id"], date=date, phase=phase)
                try:
                    entry["quality"] = quality(item, grid, config["clear_scl_classes"])
                except Exception as exc:
                    entry["error"] = type(exc).__name__ + ": " + str(exc)[:240]
                phase_entries.append(entry)
                print(json.dumps({"region": region["id"], **entry}), flush=True)
            record["candidates"].extend(phase_entries)
            record["scenes"].extend(select_scenes(config, phase_entries, maximum))
        result["regions"].append(record)
        write_json(output / "inventory.partial.json", result)
    write_json(target, result)
    return result


def download_scene(config, output, region, scene):
    global RESERVED_BYTES
    directory = output / "scenes" / region["id"] / scene["id"]
    directory.mkdir(parents=True, exist_ok=True)
    completion = directory / "scene.json"
    if completion.exists():
        cached = json.loads(completion.read_text(encoding="utf-8"))
        for key in ("id", "date", "phase"):
            if cached[key] != scene[key]:
                raise ValueError("Cached scene identity differs from frozen inventory")
        for kind in ("image", "scl"):
            path = Path(cached[kind])
            if not path.is_file() or file_hash(path) != cached[kind+"_sha256"]:
                raise ValueError("Cached raster is missing or corrupt; remove only that generated scene and acquire again")
            with rasterio.open(path) as source:
                if source.width != region["width"] or source.height != region["height"] or source.crs != rasterio.crs.CRS.from_string(region["crs"]) or source.transform != Affine(*region["transform"]):
                    raise ValueError("Cached raster grid differs from frozen inventory")
        return cached
    # Reserve enough for uncompressed files, overviews and metadata. Admission is
    # atomic across the two acquisition workers. Other research jobs are capped
    # separately; a final measured check also covers their concurrent writes.
    reservation = region["width"]*region["height"]*50 + 2_000_000
    with DISK_LOCK:
        occupied = sum(path.stat().st_size for path in output.rglob("*") if path.is_file())
        if occupied+RESERVED_BYTES+reservation > config["disk_budget_bytes"]:
            raise ValueError("Study data disk budget reached")
        RESERVED_BYTES += reservation
    try:
        return _download_scene(config, output, region, scene, directory, completion)
    finally:
        with DISK_LOCK:
            RESERVED_BYTES -= reservation


def _download_scene(config, output, region, scene, directory, completion):
    item = json.loads((output / "stac" / (scene["id"]+".json")).read_text(encoding="utf-8"))
    started = time.perf_counter()
    profile = dict(driver="GTiff", crs=region["crs"], transform=Affine(*region["transform"]), width=region["width"], height=region["height"], tiled=True, compress="deflate", blockxsize=256, blockysize=256)
    scl = read_asset(item, "scl", region)
    scl_path, image_path = directory / "scl.tif", directory / "reflectance.tif"
    with rasterio.open(scl_path, "w", **profile, count=1, dtype="uint8", nodata=0) as dest:
        dest.write(scl, 1)
    bands = []
    for index, name in enumerate(config["bands"], 1):
        print(json.dumps({"download":scene["id"],"band":name}),flush=True)
        bands.append(read_asset(item, name, region))
    stack = np.stack(bands)
    valid = np.isfinite(stack).all(axis=0) & np.isin(scl, config["clear_scl_classes"])
    with rasterio.open(image_path, "w", **profile, count=6, dtype="float32", nodata=float("nan"), predictor=3) as dest:
        dest.write(stack)
        dest.descriptions = tuple(config["bands"])
        dest.update_tags(attribution=f"Contains modified Copernicus Sentinel data ({scene['date'][:4]})", source_item=item["id"], band_order=",".join(config["bands"]), swir_native_resolution_m="20", swir_resampling="bilinear", physical_reflectance="true")
    for false_color in (False, True):
        preview = rgb_image(stack, valid, false_color)
        preview.thumbnail((1200,1200))
        preview.save(directory / ("false_color.jpg" if false_color else "rgb.jpg"), quality=90)
    record = {**scene,"config_sha256":config_hash(config),"image":str(image_path.resolve()),"scl":str(scl_path.resolve()),"image_sha256":file_hash(image_path),"scl_sha256":file_hash(scl_path),"download_seconds":round(time.perf_counter()-started,2),"quality":{**scene["quality"],"full_resolution_clear_percent":round(float(valid.mean()*100),3)},"source":{name:asset_url(item,name) for name in [*config["bands"],"scl"]}}
    write_json(completion,record)
    print(json.dumps({"completed":scene["id"],"clear_percent":record["quality"]["full_resolution_clear_percent"],"seconds":record["download_seconds"]}),flush=True)
    return record


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config",type=Path,default=Path(__file__).with_name("study.json"))
    parser.add_argument("--output",type=Path,default=DEFAULT_OUTPUT)
    parser.add_argument("--inventory-only",action="store_true")
    parser.add_argument("--workers",type=int,default=2,choices=(1,2))
    args=parser.parse_args()
    config=json.loads(args.config.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True,exist_ok=True)
    existing_config = args.output / "study.json"
    if existing_config.exists() and config_hash(json.loads(existing_config.read_text(encoding="utf-8"))) != config_hash(config):
        raise ValueError("Do not overwrite an existing study freeze; use another output directory")
    write_json(args.output / "study.json",config)
    audit=inventory(config,args.output)
    if args.inventory_only:
        return
    manifest={**audit,"regions":[]}
    for region in audit["regions"]:
        records=[]
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            jobs=[executor.submit(download_scene,config,args.output,region,scene) for scene in region["scenes"]]
            for job in jobs:
                records.append(job.result())
        manifest["regions"].append({**region,"scenes":records})
        write_json(args.output / "manifest.json",manifest)
    if sum(path.stat().st_size for path in args.output.rglob("*") if path.is_file()) > config["disk_budget_bytes"]:
        raise ValueError("Measured research data exceeds storage budget")
    print(json.dumps({"manifest":str((args.output/"manifest.json").resolve()),"regions":len(manifest["regions"])}),flush=True)


if __name__=="__main__":
    main()
