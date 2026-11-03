"""Small utilities shared by offline acquisition and evaluation."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "experiments/outputs/land-change"


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)


def file_hash(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def config_hash(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def rgb_image(bands, valid=None, false_color=False):
    indices = [3, 2, 1] if false_color else [2, 1, 0]
    rgb = np.moveaxis(bands[indices], 0, -1).astype(np.float32)
    # Fixed physical stretch: comparability between scenes, no per-date autocontrast.
    rgb = np.clip(np.nan_to_num(rgb) / (0.45 if false_color else 0.30), 0, 1) ** (1 / 1.4)
    rgb = (rgb * 255).astype(np.uint8)
    if valid is not None:
        rgb[~valid] = (38, 38, 42)
    return Image.fromarray(rgb)
