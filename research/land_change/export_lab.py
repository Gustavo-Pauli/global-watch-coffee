"""Export the frozen pilot into a portable, private internal-Lab bundle.

The resulting JSON matches apps/web/features/experiments/types.ts. It contains
opaque image IDs rather than source paths, labels, credentials or raster URLs.
Only generated JPG/PNG assets are exported; full rasters and model weights stay
in the offline research directory. No network access is performed.
"""

from __future__ import annotations

import argparse
from collections import Counter
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import shutil
import time
from uuid import uuid4

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import rasterio
from rasterio.warp import transform, transform_bounds
from rasterio.windows import Window
from shapely.geometry import shape

from .common import DEFAULT_OUTPUT, ROOT, file_hash, rgb_image
from .review import sample_scenes


PRIVATE_BUNDLES = ROOT / "apps/web/.lab-data/bundles"
# Same opaque identifier contract as the private web API.
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
SHA = re.compile(r"^[a-f0-9]{64}$")
TIMINGS = {
    "observed_new_recent_loss", "left_censored_possible_loss_since_baseline", "mixed_censoring_candidate",
}
SPLITS = {"train", "validation", "test", "transfer_test"}
MAX_SINGLE_ASSET = 8_000_000
DEFAULT_MAX_ASSET_BYTES = 100_000_000

PAPERS = [
    {"title": "Rapid monitoring of global land change", "year": 2025,
     "url": "https://doi.org/10.1038/s41467-025-64014-9", "kind": "journal",
     "relevance": "Referência do DIST-ALERT: perturbações recentes da vegetação, sem atribuição automática de causa."},
    {"title": "Near Real-Time Forest Loss Detection in the Brazilian Amazon Using Bayesian Fusion of Sentinel-1 SAR and Sentinel-2 Multispectral Time Series",
     "year": 2026, "url": "https://doi.org/10.5194/isprs-annals-XI-3-2026-507-2026", "kind": "conference",
     "relevance": "Motiva a investigação de séries temporais e fusão óptico-radar; o detector deste piloto é uma referência espectral mais simples."},
    {"title": "Mapping land uses following tropical deforestation with location-aware deep learning", "year": 2026,
     "url": "https://doi.org/10.1016/j.isprsjprs.2025.12.007", "kind": "journal",
     "relevance": "Investiga o uso posterior da terra; não comprova motivação, autoria ou causalidade apenas pelas imagens."},
    {"title": "TerraMind: Large-Scale Generative Multimodality for Earth Observation", "year": 2025,
     "url": "https://arxiv.org/abs/2504.11171", "kind": "conference",
     "relevance": "Base do encoder congelado executado localmente; os tokens deste experimento têm suporte de 160 m."},
    {"title": "OlmoEarth v1.3: Embeddings", "year": 2026,
     "url": "https://arxiv.org/abs/2610.32294", "kind": "preprint",
     "relevance": "Alternativa recente de representações geoespaciais; não foi executada neste estudo."},
]


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def _json(path: Path):
    if not path.is_file() or path.stat().st_size > 12_000_000:
        raise ValueError(f"Missing or oversized required research artifact: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON value")))


def _identifier(value, description="identifier") -> str:
    if not isinstance(value, str) or not ID.fullmatch(value) or value in (".", ".."):
        raise ValueError(f"Invalid {description}")
    return value


def _number(value, description, *, minimum=None, maximum=None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"Invalid finite {description}")
    if minimum is not None and value < minimum or maximum is not None and value > maximum:
        raise ValueError(f"Out-of-range {description}")
    return value


def _iso(value: str):
    if not isinstance(value, str):
        raise ValueError("Missing ISO date")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if len(value) == 10:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if parsed.tzinfo is None:
        raise ValueError("Datetime must include timezone")
    return parsed.astimezone(timezone.utc)


def _date_range(value, cutoff):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("Invalid candidate date interval")
    parsed = [_iso(item) if item is not None else None for item in value]
    if any(item is not None and item > cutoff for item in parsed):
        raise ValueError("Candidate date exceeds cutoff")
    if all(item is not None for item in parsed) and parsed[0] > parsed[1]:
        raise ValueError("Reversed candidate date interval")
    return value


def _inside(path: Path, root: Path) -> Path:
    resolved, boundary = path.resolve(), root.resolve()
    if not resolved.is_relative_to(boundary):
        raise ValueError("Research source or private destination escapes its allowed root")
    return resolved


def _private_root(bundle_root: Path, workspace: Path) -> Path:
    expected = (workspace / "apps/web/.lab-data/bundles").resolve()
    if bundle_root.resolve() != expected or not expected.is_relative_to(workspace.resolve()):
        raise ValueError("Bundles must stay under apps/web/.lab-data/bundles; public export is forbidden")
    return expected


def _remove_stage(stage: Path, private_root: Path):
    target = _inside(stage, private_root)
    if target.parent != private_root.resolve() or not target.name.startswith(".stage-"):
        raise ValueError("Refusing cleanup outside the verified staging directory")
    if target.exists():
        shutil.rmtree(target)


def _asset_file(source_root, relative):
    path = _inside(source_root / relative, source_root)
    if not path.is_file():
        raise ValueError(f"Missing required source file: {Path(relative).name}")
    return path


class Assets:
    def __init__(self, stage: Path, max_bytes: int):
        self.stage = stage
        self.max_bytes = max_bytes
        self.records = {}
        self.bytes = 0
        (stage / "assets").mkdir(parents=True)

    def add(self, content: bytes) -> str:
        if not content or len(content) > MAX_SINGLE_ASSET:
            raise ValueError("Image exceeds the single-asset bound")
        with Image.open(BytesIO(content)) as image:
            image.verify()
            format_ = image.format
        if format_ not in ("JPEG", "PNG"):
            raise ValueError("Only verified JPEG/PNG assets may be exported")
        identifier = hashlib.sha256(content).hexdigest()
        if identifier in self.records:
            return identifier
        if self.bytes + len(content) > self.max_bytes:
            raise ValueError("Private bundle asset budget exceeded")
        extension, mime = ("jpg", "image/jpeg") if format_ == "JPEG" else ("png", "image/png")
        relative = f"assets/{identifier}.{extension}"
        (self.stage / relative).write_bytes(content)
        self.records[identifier] = {"path": relative, "mimeType": mime, "bytes": len(content), "sha256": identifier}
        self.bytes += len(content)
        return identifier

    def copy(self, path: Path):
        if path.stat().st_size > MAX_SINGLE_ASSET:
            raise ValueError("Source image exceeds the asset bound")
        return self.add(path.read_bytes())


def validate_sources(source: Path):
    """Validate identity/freeze/hash joins before creating any output bundle."""
    manifest = _json(source / "manifest.json")
    study = _json(source / "study.json")
    summary = _json(source / "summary.json")
    detection = _json(source / "detection/detection_summary.json")
    cases = _json(source / "cases/cases.json")
    samples = _json(source / "review/blind_samples.json")
    freeze = _json(source / "review/review_freeze.json")
    feature_quality = _json(source / "classification/feature_quality.json")
    embedding_quality = _json(source / "classification/embedding_feature_quality.json")
    metrics = _json(source / "classification/metrics.json")
    embedding_metrics = _json(source / "classification/embedding_metrics.json")
    access = _json(source / "references/access-audit.json")
    identifier = _identifier(manifest.get("study_id"), "study id")
    manifest_sha = file_hash(source / "manifest.json")
    cutoff = _iso(manifest["cutoff_utc"])
    for artifact in (study, summary, detection, cases, samples, metrics, embedding_metrics):
        if artifact.get("study_id") != identifier:
            raise ValueError("Research artifacts belong to different studies")
    for artifact in (detection, cases, samples, freeze, metrics, embedding_metrics):
        if artifact.get("manifest_sha256") != manifest_sha:
            raise ValueError("Research artifact does not match the frozen manifest")
    if samples.get("sampling_revision") != 2 or samples.get("model_predictions_shown") is not False:
        raise ValueError("Only the frozen prediction-blind sampling revision 2 is supported")
    if metrics.get("status") != embedding_metrics.get("status") or summary.get("classification_status") != metrics.get("status"):
        raise ValueError("Classification state is inconsistent")
    if metrics.get("status") != "insufficient_training_reference":
        raise ValueError("Exporter currently requires the reference-evaluation-pending study state")
    if detection.get("validated_deforestation") is not False or summary.get("mapbiomas_superiority_established") is not False:
        raise ValueError("Unsupported validation or superiority claim")
    regions = manifest.get("regions")
    if not isinstance(regions, list) or not regions:
        raise ValueError("Missing completed acquisition regions")
    if len({region["id"] for region in regions}) != len(regions):
        raise ValueError("Duplicate region id")
    detection_by_region = {item["region"]: item for item in detection["regions"]}
    cases_by_region = {item["id"]: item for item in cases["regions"]}
    if set(detection_by_region) != {region["id"] for region in regions} or set(cases_by_region) != set(detection_by_region):
        raise ValueError("Incomplete detection or qualitative-case regions")
    scenes = {}
    vectors = {}
    for region in regions:
        rid = _identifier(region["id"], "region id")
        if region.get("role") not in ("development", "geographic_holdout"):
            raise ValueError("Invalid region role")
        if not region.get("scenes") or not {item["phase"] for item in region["scenes"]} == {"baseline", "recent"}:
            raise ValueError("Incomplete scene phases")
        expected = int(study["max_baseline_scenes"]) + int(study["max_recent_scenes"])
        phase_counts = Counter(item["phase"] for item in region["scenes"])
        if (len(region["scenes"]) != expected or phase_counts["baseline"] != study["max_baseline_scenes"]
                or phase_counts["recent"] != study["max_recent_scenes"]):
            raise ValueError("Incomplete frozen scene selection")
        affine = rasterio.Affine(*region["transform"])
        for scene in region["scenes"]:
            sid = _identifier(scene["id"], "scene id")
            if (rid, sid) in scenes or _iso(scene["date"]) > cutoff:
                raise ValueError("Duplicate scene or observation after cutoff")
            local = {}
            for kind, basename, count in (("image", "reflectance.tif", 6), ("scl", "scl.tif", 1)):
                path = _asset_file(source, Path("scenes") / rid / sid / basename)
                checksum = scene.get(kind + "_sha256")
                if not isinstance(checksum, str) or not SHA.fullmatch(checksum) or file_hash(path) != checksum:
                    raise ValueError("Source raster integrity mismatch")
                with rasterio.open(path) as raster:
                    if (raster.count != count or raster.width != region["width"] or raster.height != region["height"]
                            or raster.transform != affine or raster.crs != rasterio.crs.CRS.from_string(region["crs"])):
                        raise ValueError("Source raster grid differs from the manifest")
                    if kind == "image" and (raster.scales != (1.0,) * 6 or raster.offsets != (0.0,) * 6):
                        raise ValueError("Source reflectance must already have scale 1 and offset 0")
                    if kind == "image" and (any(dtype not in ("float32", "float64") for dtype in raster.dtypes)
                                            or not raster.crs.is_projected or raster.crs.linear_units != "metre"
                                            or raster.transform.a != 10 or raster.transform.e != -10
                                            or raster.transform.b != 0 or raster.transform.d != 0):
                        raise ValueError("Expected six floating reflectance bands on the frozen 10 m metric grid")
                local[kind] = path
            local["rgb"] = _asset_file(source, Path("scenes") / rid / sid / "rgb.jpg")
            local["false"] = _asset_file(source, Path("scenes") / rid / sid / "false_color.jpg")
            scenes[(rid, sid)] = {"scene": scene, **local}
        vector_path = _asset_file(source, Path("detection") / rid / "candidates.geojson")
        if cases_by_region[rid].get("candidate_geojson_sha256") != file_hash(vector_path):
            raise ValueError("Case selection no longer matches candidate geometries")
        vector = _json(vector_path)
        if vector.get("type") != "FeatureCollection" or vector.get("validated_deforestation") is not False:
            raise ValueError("Invalid candidate collection")
        features = vector.get("features", [])
        if len(features) != detection_by_region[rid]["candidate_polygon_count"]:
            raise ValueError("Candidate count differs from detection summary")
        if abs(sum(_number(item["properties"]["area_ha"], "candidate area", minimum=0) for item in features)
               - detection_by_region[rid]["candidate_area_ha_geodesic"]) > .001:
            raise ValueError("Candidate area differs from detection summary")
        vectors[rid] = vector
    records = samples.get("samples", [])
    if len(records) != summary.get("reference_sample_count") or len({item["id"] for item in records}) != len(records):
        raise ValueError("Sample frame is incomplete or has duplicate ids")
    qualities = {item["id"]: item for item in feature_quality["samples"]}
    embedding_qualities = {item["id"]: item for item in embedding_quality["samples"]}
    if len(qualities) != len(records) or len(embedding_qualities) != len(records) or set(qualities) != {item["id"] for item in records} or set(qualities) != set(embedding_qualities):
        raise ValueError("Feature-quality records do not match the sampling frame")
    for sample in records:
        _identifier(sample["id"], "sample id")
        key = (sample["region"], sample["target_scene_id"])
        if key not in scenes or scenes[key]["scene"]["date"] != sample["target_date"]:
            raise ValueError("Sample target does not resolve to a dated scene")
        if sample.get("label_support_m") != 160 or (sample["row"] - 8) % 16 or (sample["col"] - 8) % 16:
            raise ValueError("Sample support is not the frozen aligned 160 m support")
        if sample.get("split") not in SPLITS:
            raise ValueError("Invalid spatial sample split")
        for table in (qualities, embedding_qualities):
            quality = table[sample["id"]]
            if quality.get("scene_id") != sample["target_scene_id"] or quality.get("target_date") != sample["target_date"]:
                raise ValueError("Feature date differs from annotation target")
            _number(quality.get("clear_fraction"), "clear support fraction", minimum=0, maximum=1)
    probe_paths = sorted((source / "model-probe").glob("*/probe.json"))
    if not probe_paths:
        raise ValueError("Missing measured model runs")
    probes = [_json(path) for path in probe_paths]
    return {"manifest": manifest, "manifest_sha": manifest_sha, "study": study, "summary": summary,
            "detection": detection, "vectors": vectors, "cases": cases, "samples": records,
            "qualities": qualities, "probes": probes, "access": access, "scenes": scenes,
            "classification_status": metrics["status"], "sampling_revision": 2}


def _font(size):
    for name in ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def sample_frame(image, quality, sample, scene, false_color=False):
    row, col = int(sample["row"]), int(sample["col"])
    if row - 16 < 0 or col - 16 < 0 or row + 16 > image.height or col + 16 > image.width:
        raise ValueError("Sample context is outside its source image")
    if abs(image.transform.a) != 10 or abs(image.transform.e) != 10:
        raise ValueError("Sample renderer requires the frozen 10 m source grid")
    window = Window(col - 16, row - 16, 32, 32)
    bands, scl = image.read(window=window), quality.read(1, window=window)
    valid = np.isfinite(bands).all(axis=0) & np.isin(scl, (4, 5, 6))
    valid &= (image.read_masks(window=window) > 0).all(axis=0) & (quality.read_masks(1, window=window) > 0)
    clear = float(valid[8:24, 8:24].mean() * 100)
    view = rgb_image(bands, valid, false_color).resize((320, 320), Image.Resampling.NEAREST)
    draw_view = ImageDraw.Draw(view)
    draw_view.rectangle((80, 80, 239, 239), outline=(255, 180, 0), width=2)
    card = Image.new("RGB", (390, 390), (245, 245, 240))
    card.paste(view, (35, 50))
    draw = ImageDraw.Draw(card)
    draw.text((8, 5), f'{scene["date"][:10]} | {scene["phase"]} | {"NIR / red / green" if false_color else "RGB"}', font=_font(15), fill="black")
    draw.text((8, 27), f'Suporte 160 m: {clear:.2f}% claro | laranja = amostra', font=_font(13), fill=(80, 50, 0))
    if clear < 90:
        draw.rectangle((35, 352, 354, 369), fill=(40, 40, 40))
        draw.text((42, 352), "EVIDÊNCIA CLARA INSUFICIENTE", font=_font(12), fill="white")
    output = BytesIO()
    # Nearest-neighbor satellite pixels form large constant blocks. Lossless PNG
    # is smaller here than JPEG while preserving the support boundary exactly.
    card.save(output, format="PNG", optimize=True, compress_level=6)
    return output.getvalue(), clear


def _candidate(feature, cutoff):
    geometry, raw = feature["geometry"], feature["properties"]
    if geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("Only polygonal candidates may enter the Lab")
    parsed = shape(geometry)
    if not parsed.is_valid or parsed.is_empty or not all(math.isfinite(value) for value in parsed.bounds):
        raise ValueError("Invalid candidate geometry")
    if parsed.bounds[0] < -180 or parsed.bounds[2] > 180 or parsed.bounds[1] < -90 or parsed.bounds[3] > 90:
        raise ValueError("Candidate geometry is not WGS84")
    if raw.get("validated_deforestation") is not False or raw.get("cause") is not None or raw.get("observation_classification") not in TIMINGS:
        raise ValueError("Unsupported candidate interpretation")
    properties = {
        "id": _identifier(raw["id"], "candidate id"),
        "areaHa": _number(raw["area_ha"], "candidate area", minimum=0),
        "timing": raw["observation_classification"],
        "firstAnomaly": _date_range(raw["first_anomaly_date_range"], cutoff),
        "lastIntact": _date_range(raw["last_intact_before_first_anomaly_date_range"], cutoff),
        "corroborated": _date_range(raw["corroboration_date_range"], cutoff),
        "latestObservation": _date_range(raw["latest_valid_observation_date_range"], cutoff),
        "reboundFraction": _number(raw["latest_clear_non_anomalous_pixel_fraction"], "rebound fraction", minimum=0, maximum=1),
        "validatedDeforestation": False, "cause": None,
    }
    return {"type": "Feature", "geometry": geometry, "properties": properties}


def _reference_access(access):
    records = []
    for key, label in (("mapbiomas_10m_2025", "MapBiomas 10 m · 2025"), ("mapbiomas_30m_2025", "MapBiomas 30 m · 2025")):
        entry = access.get(key, {})
        status = entry.get("http_status")
        records.append({"name": label, "status": f"HTTP {status}" if isinstance(status, int) and 100 <= status <= 599 else "indisponível nesta execução",
                        "detail": "Não foi usado como referência independente nem comparado quantitativamente nesta rodada."})
    records.append({"name": "MapBiomas Alerta", "status": "consulta anônima não concluída",
                    "detail": "A documentação registra necessidade de conta. Falha de acesso não indica ausência de dados."})
    for entry in access.get("dist_alert", []):
        status = entry.get("raster_probe", {}).get("http_status")
        region = _identifier(entry.get("region"), "reference region")
        records.append({"name": f"DIST-ALERT · {region}", "status": f"HTTP {status}" if isinstance(status, int) and 100 <= status <= 599 else "raster indisponível nesta execução",
                        "detail": "Metadados foram localizados; o raster não foi comparado quantitativamente. Perturbação não equivale a desmatamento confirmado."})
    return records


def build_bundle(source: Path, validated, assets: Assets):
    manifest = validated["manifest"]
    cutoff = _iso(manifest["cutoff_utc"])
    regions, samples, model_runs, case_cards = [], [], [], []
    scene_lookup = validated["scenes"]
    detection_lookup = {item["region"]: item for item in validated["detection"]["regions"]}
    for region in manifest["regions"]:
        rid = region["id"]
        scenes = []
        for scene in sorted(region["scenes"], key=lambda item: (item["date"], item["id"])):
            local = scene_lookup[(rid, scene["id"])]
            scenes.append({"id": scene["id"], "date": scene["date"], "phase": scene["phase"],
                           "clearPercent": _number(scene["quality"]["full_resolution_clear_percent"], "scene clear percentage", minimum=0, maximum=100),
                           "rgbAssetId": assets.copy(local["rgb"]), "falseColorAssetId": assets.copy(local["false"])})
        affine = rasterio.Affine(*region["transform"])
        left, bottom, right, top = rasterio.transform.array_bounds(region["height"], region["width"], affine)
        west, south, east, north = transform_bounds(region["crs"], "EPSG:4326", left, bottom, right, top, densify_pts=21)
        candidates = [_candidate(feature, cutoff) for feature in validated["vectors"][rid]["features"]]
        if len({feature["properties"]["id"] for feature in candidates}) != len(candidates):
            raise ValueError("Duplicate candidate id")
        summary = detection_lookup[rid]
        regions.append({"id": rid, "name": region["name"], "role": region["role"], "bounds": [[south, west], [north, east]],
                        "scenes": scenes, "candidates": {"type": "FeatureCollection", "features": candidates},
                        "metrics": {"candidateCount": len(candidates), "candidateAreaHa": summary["candidate_area_ha_geodesic"],
                                    "newlyObservedCount": summary["candidate_count_by_observation_classification"]["observed_new_recent_loss"],
                                    "newlyObservedAreaHa": summary["candidate_area_ha_geodesic_by_observation_classification"]["observed_new_recent_loss"]}})
        selected = sample_scenes(region)
        if len(selected) != 3:
            raise ValueError("Expected three distinct dated blind-review frames per region")
        regional_samples = [item for item in validated["samples"] if item["region"] == rid]
        with ExitStack() as stack:
            sources = {scene["id"]: (stack.enter_context(rasterio.open(scene_lookup[(rid, scene["id"])]["image"])),
                                     stack.enter_context(rasterio.open(scene_lookup[(rid, scene["id"])]["scl"]))) for scene in selected}
            for sample in regional_samples:
                if sample["target_scene_id"] != selected[-1]["id"]:
                    raise ValueError("Blind-review frame selection does not match frozen target")
                frames = []
                target_clear = None
                for scene in selected:
                    image, quality = sources[scene["id"]]
                    rgb, clear = sample_frame(image, quality, sample, scene)
                    false, false_clear = sample_frame(image, quality, sample, scene, True)
                    if false_clear != clear:
                        raise ValueError("Different quality between views of one observation")
                    frames.append({"date": scene["date"], "phase": scene["phase"], "rgbAssetId": assets.add(rgb),
                                   "falseColorAssetId": assets.add(false), "clearPercent": round(clear, 6)})
                    if scene["id"] == sample["target_scene_id"]:
                        target_clear = clear
                feature_quality = validated["qualities"][sample["id"]]
                if target_clear is None or abs(target_clear / 100 - feature_quality["clear_fraction"]) > 1e-8:
                    raise ValueError("Rendered sample support differs from classifier feature support")
                x, y = affine * (sample["col"] + .5, sample["row"] + .5)
                lon, lat = transform(region["crs"], "EPSG:4326", [x], [y])
                if abs(lon[0] - sample["lon"]) > 1e-7 or abs(lat[0] - sample["lat"]) > 1e-7:
                    raise ValueError("Sample coordinates do not match its frozen raster center")
                samples.append({"id": sample["id"], "regionId": rid, "row": int(sample["row"]), "col": int(sample["col"]),
                                "block": str(sample["block"]), "longitude": sample["lon"], "latitude": sample["lat"], "split": sample["split"],
                                "targetSceneId": sample["target_scene_id"], "targetDate": sample["target_date"], "supportM": 160,
                                "usable": target_clear >= 90, "frames": frames})
    by_image_hash = {}
    for local in scene_lookup.values():
        by_image_hash.setdefault(local["scene"]["image_sha256"], []).append(local["scene"])
    for probe in validated["probes"]:
        matching = by_image_hash.get(probe.get("input_sha256"), [])
        if len(matching) != 1 or probe.get("scl_sha256") != matching[0]["scl_sha256"]:
            raise ValueError("Model run source is ambiguous or absent from manifest")
        scene = matching[0]
        spacing = probe.get("feature_spacing_crs_units")
        if spacing != [160.0, 160.0] or probe.get("model_license") != "Apache-2.0":
            raise ValueError("Unsupported model feature spacing or provenance")
        model_runs.append({"name": "TerraMind Tiny · encoder congelado", "sceneId": scene["id"], "date": scene["date"],
                           "tileCount": int(_number(probe["tile_count"], "model tile count", minimum=1)),
                           "inferenceSeconds": _number(probe["inference_seconds"], "inference seconds", minimum=0),
                           "peakAllocatedMiB": round(_number(probe["peak_cuda_allocated_bytes"], "allocated memory", minimum=0) / 1024**2, 4),
                           "featureSpacingM": 160,
                           "scope": "Viabilidade do encoder na GPU; exclui carregamento, leitura, exportação e treinamento. Não mede acurácia ou segmentação a 10 m."})
    candidate_ids = {feature["properties"]["id"] for region in regions for feature in region["candidates"]["features"]}
    for region in validated["cases"]["regions"]:
        for case in region["cases"]:
            candidate_id = _identifier(case["candidate_id"], "case candidate id")
            if candidate_id not in candidate_ids:
                raise ValueError("Qualitative case does not resolve to a candidate")
            card = _asset_file(source, Path("cases") / region["id"] / (candidate_id + ".jpg"))
            case_cards.append({"id": "case-" + candidate_id, "regionId": region["id"], "candidateId": candidate_id,
                               "imageAssetId": assets.copy(card),
                               "caption": "Caso selecionado pelo detector: comparação qualitativa com contorno previsto. Não é referência cega nem prova de desmatamento."})
    parameters = validated["detection"]["parameters"]
    bundle = {
        "schemaVersion": 1, "id": manifest["study_id"], "fingerprint": "",
        "manifestSha256": validated["manifest_sha"], "samplingRevision": validated["sampling_revision"],
        "title": "Amazônia: mudanças recentes e classificação da paisagem",
        "description": "Estudo piloto em Novo Progresso e Belterra para comparar detecção de perda de vegetação e classificação regional com imagens recentes.",
        "cutoff": manifest["cutoff_utc"], "status": "reference_evaluation_pending",
        "acquiredSceneCount": sum(len(region["scenes"]) for region in regions),
        "candidateCount": sum(region["metrics"]["candidateCount"] for region in regions),
        "sampleCount": len(samples), "usableSampleCount": sum(sample["usable"] for sample in samples),
        "regionNames": [region["name"] for region in regions], "regions": regions, "samples": samples,
        "caseCards": case_cards, "papers": PAPERS,
        "hypotheses": [
            {"id": "recent-loss", "title": "Detectar perda de vegetação e acompanhar o uso posterior",
             "question": "As séries recentes permitem encontrar mudanças verificáveis e distinguir eventos novos de diferenças que já existiam?",
             "state": "avaliação de referência pendente",
             "finding": "Candidatos espectrais foram gerados com persistência e limites temporais explícitos. Causa, permanência e precisão ainda não foram determinadas."},
            {"id": "land-cover", "title": "Classificar a paisagem com dados espectrais e TerraMind",
             "question": "Modelos adaptados a um recorte regional podem distinguir as classes propostas e transferir para outra área?",
             "state": "treinamento bloqueado por falta de referências",
             "finding": "Atributos espectrais e tokens do encoder foram extraídos. Sem referências suficientes por classe, não há classificação treinada nem vencedor por acurácia."},
        ],
        "method": {"name": "Referência espectral temporal · NDVI/NBR",
                   "explanation": "Medianas e variação robusta da estação de 2025 são comparadas às observações de agosto a novembro de 2026. Nuvens ficam desconhecidas. Corroboração em datas diferentes não equivale a validação independente.",
                   "parameters": [{"label": key, "value": str(value)} for key, value in sorted(parameters.items())],
                   "limitations": [
                       "Vegetação densa espectralmente compatível não é uma classificação validada de floresta nativa.",
                       "Agricultura, sazonalidade, água, fogo e falhas de máscara podem gerar candidatos.",
                       "Eventos sem observação intacta recente são temporalmente censurados e podem anteceder agosto de 2026.",
                       "SWIR é nativamente 20 m; os tokens TerraMind deste estudo têm suporte de 160 m e contexto compartilhado.",
                       "Casos diagnósticos foram selecionados pelo detector e não permitem estimar omissões ou precisão por si só.",
                       "Não foi estabelecida superioridade sobre o MapBiomas, causalidade ou validação de campo.",
                   ]},
        "modelRuns": model_runs, "referenceAccess": _reference_access(validated["access"]),
        "classificationState": validated["classification_status"],
        "attribution": "Contains modified Copernicus Sentinel data (2025, 2026). TerraMind Tiny: IBM, ESA e colaboradores, Apache-2.0. Dados e modelos de terceiros mantêm seus próprios termos.",
        "interpretationNote": "A revisão usa o quadrado laranja de 160 × 160 m na data-alvo. Registre ambiguidade e origem da interpretação. Interpretação visual, inclusive por IA, não substitui validação de campo ou revisão especializada independente.",
        "assets": dict(sorted(assets.records.items())),
    }
    if len(samples) != validated["summary"]["reference_sample_count"]:
        raise ValueError("Some reference samples did not resolve to a region")
    expected_usable = validated["summary"].get("feature_quality_counts", {}).get("ready")
    if expected_usable is not None and bundle["usableSampleCount"] != expected_usable:
        raise ValueError("Usable reference count differs from measured feature quality")
    # Never put an absolute source path or annotation labels into this payload.
    payload = canonical({key: value for key, value in bundle.items() if key != "fingerprint"})
    if b"C:\\" in payload or b"file://" in payload or b"SUPABASE_SECRET" in payload:
        raise ValueError("Private source information reached the portable bundle")
    bundle["fingerprint"] = hashlib.sha256(payload).hexdigest()
    return bundle


def _publish(stage: Path, target: Path, private_root: Path):
    """Commit the manifest atomically, with immutable referenced assets ready first."""
    _inside(target, private_root)
    if not target.exists():
        os.replace(stage, target)
        return
    if target.is_symlink() or not target.is_dir():
        raise ValueError("Private bundle target must be a regular directory")
    assets_dir = _inside(target / "assets", private_root)
    assets_dir.mkdir(exist_ok=True)
    for asset in (stage / "assets").iterdir():
        destination = _inside(assets_dir / asset.name, private_root)
        if destination.exists():
            if file_hash(destination) != asset.stem:
                raise ValueError("Existing content-addressed asset is corrupt")
        else:
            os.replace(asset, destination)
    # Existing readers may still reference previous hashes, so old assets are
    # retained; no live manifest can point to a deleted or partial image.
    os.replace(stage / "build.json", target / "build.json")
    os.replace(stage / "study.json", target / "study.json")
    _remove_stage(stage, private_root)


def export(source: Path = DEFAULT_OUTPUT, bundle_root: Path = PRIVATE_BUNDLES,
           *, workspace: Path = ROOT, max_asset_bytes=DEFAULT_MAX_ASSET_BYTES):
    started = time.perf_counter()
    private_root = _private_root(bundle_root, workspace)
    source = source.resolve()
    validated = validate_sources(source)
    validated_seconds = time.perf_counter() - started
    private_root.mkdir(parents=True, exist_ok=True)
    study_id = _identifier(validated["manifest"]["study_id"], "study id")
    stage = private_root / (".stage-" + study_id + "-" + uuid4().hex)
    stage.mkdir()
    try:
        assets = Assets(stage, max_asset_bytes)
        bundle = build_bundle(source, validated, assets)
        (stage / "study.json").write_bytes(canonical(bundle) + b"\n")
        build = {"schemaVersion": 1, "studyId": study_id, "fingerprint": bundle["fingerprint"],
                 "generatedAt": datetime.now(timezone.utc).isoformat(),
                 "sourceValidationSeconds": round(validated_seconds, 3),
                 "exportSeconds": round(time.perf_counter() - started, 3),
                 "sceneCount": bundle["acquiredSceneCount"], "sampleCount": bundle["sampleCount"],
                 "usableSampleCount": bundle["usableSampleCount"], "candidateCount": bundle["candidateCount"],
                 "modelRunCount": len(bundle["modelRuns"]), "caseCardCount": len(bundle["caseCards"]),
                 "assetCount": len(assets.records), "assetBytes": assets.bytes,
                 "manifestBytes": (stage / "study.json").stat().st_size,
                 "assetBudgetBytes": max_asset_bytes,
                 "privateDataset": True, "labelsIncluded": False}
        target = private_root / study_id
        previous_assets = list((target / "assets").iterdir()) if (target / "assets").is_dir() else []
        build["retainedUnreferencedAssetBytes"] = sum(path.stat().st_size for path in previous_assets
                                                       if path.is_file() and path.stem not in assets.records)
        (stage / "build.json").write_bytes(canonical(build) + b"\n")
        projected_bytes = (sum(path.stat().st_size for path in previous_assets if path.is_file())
                           + sum(record["bytes"] for record in assets.records.values()
                                 if not (target / record["path"]).exists())
                           + (stage / "study.json").stat().st_size + (stage / "build.json").stat().st_size)
        if projected_bytes > max_asset_bytes:
            raise ValueError("Private bundle directory budget would be exceeded, including retained previous assets")
        _publish(stage, target, private_root)
        build["privateDirectoryBytesAtMeasurement"] = sum(path.stat().st_size for path in target.rglob("*") if path.is_file())
        temporary = target / "build.json.tmp"
        temporary.write_bytes(canonical(build) + b"\n")
        os.replace(temporary, target / "build.json")
        print(json.dumps({"bundle": str(target), **build}, indent=2))
        return bundle, build
    except BaseException:
        _remove_stage(stage, private_root)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--bundle-root", type=Path, default=PRIVATE_BUNDLES)
    parser.add_argument("--max-asset-bytes", type=int, default=DEFAULT_MAX_ASSET_BYTES)
    args = parser.parse_args()
    export(args.source, args.bundle_root, max_asset_bytes=args.max_asset_bytes)


if __name__ == "__main__":
    main()
