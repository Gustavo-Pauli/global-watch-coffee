"""Render explicitly model-selected qualitative cases, never accuracy labels.

Three dated acquisitions are shown with fixed reflectance stretches and native
aspect ratio. Acquisition selection uses local cloud/NoData quality, not how
strong the predicted change looks. All outputs are generated research artifacts.
"""

from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
import math
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom
from rasterio.windows import Window
from shapely.geometry import mapping, shape

from .common import DEFAULT_OUTPUT, file_hash, rgb_image, write_json


GROUPS = (
    "observed_new_recent_loss",
    "left_censored_possible_loss_since_baseline",
    "mixed_censoring_candidate",
)
GROUP_LABELS = {
    GROUPS[0]: "new loss bounded within recent period",
    GROUPS[1]: "left-censored: may predate recent period",
    GROUPS[2]: "mixed temporal bounds within polygon",
}
CARD_WIDTH = 1200
CARD_HEIGHT = 492
PANEL_WIDTH = 390
PANEL_HEIGHT = 170


def font(size=14):
    for path in ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def select_cases(features, seed, quota=4):
    """Deterministic, seeded selection by censoring; never by size or appearance."""
    rng = np.random.default_rng(seed)
    selected = []
    selected_ids = set()
    counts = {}
    for group in GROUPS:
        members = sorted((feature for feature in features
                          if feature["properties"].get("observation_classification") == group),
                         key=lambda feature: feature["properties"]["id"])
        counts[group] = len(members)
        indices = rng.permutation(len(members))[:quota]
        for index in indices:
            feature = members[int(index)]
            selected.append(feature)
            selected_ids.add(feature["properties"]["id"])
    remainder = sorted((feature for feature in features
                        if feature["properties"]["id"] not in selected_ids),
                       key=lambda feature: feature["properties"]["id"])
    for index in rng.permutation(len(remainder))[:max(0, len(GROUPS) * quota - len(selected))]:
        selected.append(remainder[int(index)])
    return selected, counts


def crop_window(geometry, source, margin_m=160, minimum_m=320, max_pixels=1024):
    left, bottom, right, top = geometry.bounds
    res_x, res_y = abs(source.transform.a), abs(source.transform.e)
    center_col, center_row = ~source.transform * ((left + right) / 2, (bottom + top) / 2)
    desired_width = math.ceil(max(minimum_m, right - left + 2 * margin_m) / res_x)
    desired_height = math.ceil(max(minimum_m, top - bottom + 2 * margin_m) / res_y)
    width, height = min(desired_width, max_pixels, source.width), min(desired_height, max_pixels, source.height)
    col = max(0, min(math.floor(center_col - width / 2), source.width - width))
    row = max(0, min(math.floor(center_row - height / 2), source.height - height))
    return Window(col, row, width, height), {
        "col_off": col, "row_off": row, "width": width, "height": height,
        "resolution_m": [res_x, res_y], "margin_requested_m": margin_m,
        "maximum_pixels_per_axis": max_pixels,
        "requested_extent_capped": desired_width > width or desired_height > height,
    }


def _read(source, quality, window):
    bands = source.read(window=window)
    scl = quality.read(1, window=window)
    valid = np.isfinite(bands).all(axis=0) & np.isin(scl, (4, 5, 6))
    valid &= (source.read_masks(window=window) > 0).all(axis=0)
    valid &= quality.read_masks(1, window=window) > 0
    return bands, valid


def local_quality(scene, source, quality, window, candidate_mask):
    _, valid = _read(source, quality, window)
    local_clear = float(valid.mean() * 100)
    candidate_clear = float(valid[candidate_mask].mean() * 100) if candidate_mask.any() else 0.0
    return {
        "scene_id": scene["id"], "date": scene["date"], "phase": scene["phase"],
        "image": scene["image"], "scl": scene["scl"],
        "window_clear_percent": round(local_clear, 3),
        "candidate_clear_percent": round(candidate_clear, 3),
        "usable_for_local_comparison": local_clear >= 60 and candidate_clear >= 70,
    }


def choose_dates(records):
    baseline = sorted((record for record in records if record["phase"] == "baseline"),
                      key=lambda record: (record["date"], record["scene_id"]))
    recent = sorted((record for record in records if record["phase"] == "recent"),
                    key=lambda record: (record["date"], record["scene_id"]))
    if not baseline or not recent:
        raise ValueError("Qualitative case cards require baseline and recent observations.")
    clear = [record for record in recent if record["usable_for_local_comparison"]]
    if clear:
        first, last = clear[0], clear[-1]
    else:
        # Expose the best available acquisition as insufficient, rather than
        # inventing a cloud-free observation or silently omitting this case.
        fallback = max(recent, key=lambda record: (record["candidate_clear_percent"], record["window_clear_percent"], record["date"]))
        first = last = fallback
    return [
        {**baseline[0], "role": "earliest_baseline", "selection": "earliest baseline, even when clouded"},
        {**first, "role": "earliest_recent_clear", "selection": "earliest locally usable recent acquisition" if clear else "no locally usable recent acquisition; insufficient-evidence fallback"},
        {**last, "role": "latest_recent_clear", "selection": "latest locally usable recent acquisition" if clear else "no locally usable recent acquisition; insufficient-evidence fallback"},
    ]


def _outline(image, geometry, source, window):
    draw = ImageDraw.Draw(image)
    inverse = ~source.transform

    def ring(coordinates):
        points = []
        for x, y, *_ in coordinates:
            col, row = inverse * (x, y)
            points.append(((col - window.col_off) * image.width / window.width,
                           (row - window.row_off) * image.height / window.height))
        if len(points) > 1:
            draw.line(points, fill=(255, 180, 0), width=2)

    polygons = geometry.geoms if geometry.geom_type == "MultiPolygon" else [geometry]
    for polygon in polygons:
        ring(polygon.exterior.coords)
        for interior in polygon.interiors:
            ring(interior.coords)


def _range_text(values):
    return "..".join(value if value is not None else "unknown" for value in values)


def render_case(feature, window, geometry, sources, selected):
    properties = feature["properties"]
    card = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), (245, 245, 240))
    draw = ImageDraw.Draw(card)
    group = properties.get("observation_classification")
    draw.text((10, 8), f'{properties["id"]} | {properties["area_ha"]:.4f} ha | {GROUP_LABELS.get(group, group)}', fill="black", font=font(17))
    draw.text((10, 32), "MODEL-SELECTED QUALITATIVE CASE | orange = spectral candidate, not a validated clearing boundary", fill=(115, 55, 0), font=font(14))
    draw.text((10, 54), "Last intact bound: " + _range_text(properties["last_intact_before_first_anomaly_date_range"])
              + " | First anomaly: " + _range_text(properties["first_anomaly_date_range"]), fill="black", font=font(14))
    draw.text((10, 74), "Corroboration: " + _range_text(properties["corroboration_date_range"])
              + f' | left-censored pixels: {100 * properties.get("left_censored_pixel_fraction", 0):.1f}%', fill="black", font=font(14))
    roles = {"earliest_baseline": "earliest baseline", "earliest_recent_clear": "first usable recent", "latest_recent_clear": "last usable recent"}
    for index, record in enumerate(selected):
        scene, source, quality = sources[record["scene_id"]]
        bands, valid = _read(source, quality, window)
        x = 10 + index * 397
        date_label = record["date"][:10]
        draw.text((x, 100), f'{roles[record["role"]]} | {date_label}', fill="black", font=font(14))
        draw.text((x, 119), f'clear: window {record["window_clear_percent"]:.1f}% / candidate {record["candidate_clear_percent"]:.1f}%', fill="black", font=font(13))
        for false_color, y in ((False, 145), (True, 326)):
            image = rgb_image(bands, valid, false_color)
            fitted = ImageOps.contain(image, (PANEL_WIDTH, PANEL_HEIGHT), method=Image.Resampling.NEAREST)
            # Draw at display resolution so a 2-pixel outline does not obscure
            # the interior of narrow native-raster candidate components.
            _outline(fitted, geometry, source, window)
            card.paste(fitted, (x + (PANEL_WIDTH - fitted.width) // 2, y + (PANEL_HEIGHT - fitted.height) // 2))
            if not record["usable_for_local_comparison"]:
                draw.rectangle((x, y, x + PANEL_WIDTH, y + 20), fill=(48, 48, 48))
                draw.text((x + 4, y + 2), "UNKNOWN: insufficient clear evidence", fill="white", font=font(13))
        draw.text((x + 3, 144), "RGB", fill=(50, 50, 50), font=font(12))
        draw.text((x + 3, 325), "NIR / red / green", fill=(50, 50, 50), font=font(12))
    return card


def run(manifest_path: Path, detection_dir: Path, output: Path, seed=20261102):
    started = time.perf_counter()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output.mkdir(parents=True, exist_ok=True)
    result = {
        "study_id": manifest["study_id"], "manifest_sha256": file_hash(manifest_path),
        "kind": "model_selected_qualitative_case_review", "seed": seed,
        "accuracy_estimated": False, "recall_estimable_from_these_cases": False,
        "selection": {"per_region": 12, "per_censoring_group": 4,
                      "fallback": "seeded remaining candidates when a group has fewer than four",
                      "selection_by_area_or_visual_strength": False},
        "local_scene_quality_rule": {"minimum_window_clear_percent": 60, "minimum_candidate_clear_percent": 70,
                                     "valid_scl_classes": [4, 5, 6], "requires_all_bands_finite": True},
        "limitations": [
            "Cases were selected from detector output and cannot measure precision or recall without separate reference interpretation.",
            "The earliest recent clear acquisition may occur after a disturbance; observation bounds in the caption remain authoritative.",
            "Dates with cloud or NoData are shown as unknown, not as evidence of an intact or changed surface.",
            "Orange outlines are model outputs; these cards are not prediction-blind references.",
            "No economic driver, permanence, illegal activity or responsibility is assigned.",
        ], "regions": [],
    }
    for region_index, region in enumerate(manifest["regions"]):
        candidate_path = detection_dir / region["id"] / "candidates.geojson"
        collection = json.loads(candidate_path.read_text(encoding="utf-8"))
        chosen, counts = select_cases(collection["features"], seed + region_index)
        directory = output / region["id"]
        directory.mkdir(parents=True, exist_ok=True)
        region_result = {"id": region["id"], "candidate_geojson_sha256": file_hash(candidate_path),
                         "eligible_counts_by_censoring_group": counts, "cases": [], "contact_sheets": []}
        cards = []
        with ExitStack() as stack:
            sources = {}
            for scene in region["scenes"]:
                sources[scene["id"]] = (scene, stack.enter_context(rasterio.open(scene["image"])),
                                        stack.enter_context(rasterio.open(scene["scl"])))
            template = next(iter(sources.values()))[1]
            for feature in chosen:
                native = shape(transform_geom("EPSG:4326", template.crs, feature["geometry"]))
                window, window_record = crop_window(native, template)
                candidate_mask = rasterize([(mapping(native), 1)], out_shape=(int(window.height), int(window.width)),
                                           transform=template.window_transform(window), dtype="uint8").astype(bool)
                quality = [local_quality(scene, image, scl, window, candidate_mask)
                           for scene, image, scl in sources.values()]
                selected = choose_dates(quality)
                card = render_case(feature, window, native, sources, selected)
                case_path = directory / (feature["properties"]["id"] + ".jpg")
                card.save(case_path, quality=94)
                cards.append(card)
                region_result["cases"].append({
                    "candidate_id": feature["properties"]["id"],
                    "detector_properties": feature["properties"],
                    "crop": window_record, "card": str(case_path.resolve()),
                    "source_dates": selected,
                    "distinct_acquisitions_shown": len({record["scene_id"] for record in selected}),
                    "all_local_scene_quality": quality,
                })
        for page_start in range(0, len(cards), 4):
            page_cards = cards[page_start:page_start + 4]
            page = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT * len(page_cards)), "white")
            for row, card in enumerate(page_cards):
                page.paste(card, (0, row * CARD_HEIGHT))
            page_path = directory / f'cases-{page_start // 4:02d}.jpg'
            page.save(page_path, quality=93)
            region_result["contact_sheets"].append(str(page_path.resolve()))
        result["regions"].append(region_result)
    result["render_seconds"] = round(time.perf_counter() - started, 2)
    write_json(output / "cases.json", result)
    print(json.dumps({"cases": str((output / "cases.json").resolve()), "regions": [
        {"id": region["id"], "cases": len(region["cases"]), "pages": len(region["contact_sheets"])}
        for region in result["regions"]
    ]}, indent=2))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_OUTPUT / "manifest.json")
    parser.add_argument("--detection", type=Path, default=DEFAULT_OUTPUT / "detection")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT / "cases")
    parser.add_argument("--seed", type=int, default=20261102)
    args = parser.parse_args()
    run(args.manifest, args.detection, args.output, args.seed)


if __name__ == "__main__":
    main()
