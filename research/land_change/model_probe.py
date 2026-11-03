"""Bounded TerraMind Tiny feature probe, separate from the application worker.

The frozen encoder emits one feature per 16 x 16 input-pixel patch. It is not
a 10 m classification model. All source pixels remain observations, and no
generated modalities or invented land-use labels enter this experiment.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import time

import numpy as np
import rasterio
from rasterio.windows import Window

MODEL_ID = "ibm-esa-geospatial/TerraMind-1.0-tiny"
MODEL_VARIANT = "terramind_v1_tiny"
MODEL_SHA256 = "e56ea9ebcd4451078b9ca4893d5cd8a89bbee376ae16829c3e7fbbbc76de0eba"
SOURCE_BANDS = ("blue", "green", "red", "nir", "swir1", "swir2")
MODEL_BANDS = ("BLUE", "GREEN", "RED", "NIR_BROAD", "SWIR_1", "SWIR_2")
PATCH_SIZE = 16
# TerraMind v1 pretraining normalization. Source: terramind_register.py,
# v1_pretraining_mean/std; indices B02/B03/B04/B08/B11/B12 of S2L2A.
# Its statistics use reflectance * 10000, not uncorrected post-2022 Sentinel DN.
PRETRAIN_MEAN = np.array([1503.317, 1718.197, 1853.91, 3083.234, 2424.884, 1857.648], dtype="float32")
PRETRAIN_STD = np.array([2141.107, 2038.973, 2134.138, 1871.918, 1434.261, 1334.311], dtype="float32")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_reflectance(data: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Normalize physical reflectance and neutral-fill invalid pixels.

    A true clear-pixel fraction is exported separately; neutral-fill does not
    turn obscured land into evidence. Model attention can include the full
    input window, so a feature is contextual rather than a local measurement.
    """
    if data.ndim != 3 or data.shape[0] != 6 or valid.shape != data.shape[1:]:
        raise ValueError("Expected six reflectance bands and an aligned valid mask.")
    if valid.dtype != np.bool_:
        raise ValueError("Valid mask must be boolean rather than category codes.")
    if valid.any() and not np.isfinite(data[:, valid]).all():
        raise ValueError("Nonfinite reflectance cannot be marked as valid evidence.")
    if valid.any() and np.nanmax(np.abs(data[:, valid])) > 2:
        raise ValueError("Expected physical reflectance, not raw digital numbers.")
    normalized = (data * 10000 - PRETRAIN_MEAN[:, None, None]) / PRETRAIN_STD[:, None, None]
    return np.where(valid[None], normalized, 0).astype("float32")


def validate_source_grid(path: Path | str, scl: Path | str) -> None:
    """Check actual raster metadata before loading torch or downloading weights."""
    with rasterio.open(path) as image, rasterio.open(scl) as quality:
        if (image.count != 6 or image.crs is None or not image.crs.is_projected
                or image.crs.linear_units.lower() not in ("metre", "meter", "metres", "meters")
                or any(dtype not in ("float32", "float64") for dtype in image.dtypes)):
            raise ValueError("Expected six-band physical reflectance on a projected metric grid.")
        if (not np.isfinite(tuple(image.transform)).all() or image.transform.a <= 0
                or image.transform.e >= 0 or image.transform.b != 0 or image.transform.d != 0):
            raise ValueError("Expected finite north-up raster geometry.")
        if quality.count != 1 or (image.shape, image.crs, image.transform) != (quality.shape, quality.crs, quality.transform):
            raise ValueError("Single-band SCL must exactly match the source raster grid.")
        if tuple(image.scales) != (1.0,) * 6 or tuple(image.offsets) != (0.0,) * 6:
            raise ValueError("Input must already be physical reflectance with scale=1 and offset=0.")


def _load_model(device: str, cache: Path):
    # Do not consume ~/.cache or modify the app's Python environment.
    os.environ["HF_HOME"] = str(cache.resolve())
    os.environ["HF_HUB_CACHE"] = str((cache / "hub").resolve())
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    cache_bytes = sum(p.stat().st_size for p in cache.rglob("*") if p.is_file())
    if cache_bytes > 4 * 1024**3:
        raise RuntimeError("Research model cache exceeds its 4 GiB limit.")
    import torch
    from terratorch import BACKBONE_REGISTRY
    from huggingface_hub import hf_hub_download

    checkpoint = Path(hf_hub_download(repo_id=MODEL_ID, filename="TerraMind_v1_tiny.pt"))
    if _sha256(checkpoint) != MODEL_SHA256:
        raise RuntimeError("Official model checkpoint changed; review before changing the frozen study.")

    model = BACKBONE_REGISTRY.build(
        MODEL_VARIANT,
        pretrained=True,
        modalities=["S2L2A"],
        bands={"S2L2A": list(MODEL_BANDS)},
    ).eval().to(device)
    model.requires_grad_(False)
    return model


def extract_tile_features(
    path: Path | str,
    scl: Path | str,
    output: Path | str,
    *,
    device: str = "cuda",
    tile_size: int = 224,
    max_tiles: int | None = 4,
    cache: Path | str = "experiments/outputs/land-change/model-cache",
) -> dict:
    """Extract a bounded prefix of aligned tiles; write NPZ features + metadata.

    Set max_tiles=None only for a deliberate full-scene run. The default probe
    cannot accidentally process an entire large AOI. NPZ arrays have shapes
    features=(N, grid_y, grid_x, channels), clear_fraction=(N, grid_y, grid_x),
    and windows=(N, 4) ordered col_off,row_off,width,height in source pixels.
    Padded pixels count as invalid; patches with <90% clear pixels are masked.
    """
    path, scl, output, cache = map(Path, (path, scl, output, cache))
    if tile_size <= 0 or tile_size % PATCH_SIZE:
        raise ValueError("tile_size must be a positive multiple of 16.")
    if max_tiles is not None and max_tiles <= 0:
        raise ValueError("max_tiles must be positive or None.")
    validate_source_grid(path, scl)
    import torch

    if device.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable; select --device cpu explicitly rather than silently changing the run.")
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    model_started = time.perf_counter()
    model = _load_model(device, cache)
    model_seconds = time.perf_counter() - model_started
    if device.startswith("cuda"):
        torch.cuda.reset_peak_memory_stats()
    grid = tile_size // PATCH_SIZE
    all_features, all_clear, windows = [], [], []
    elapsed = 0.0
    with rasterio.open(path) as image, rasterio.open(scl) as quality:
        for row in range(0, image.height, tile_size):
            for col in range(0, image.width, tile_size):
                width, height = min(tile_size, image.width - col), min(tile_size, image.height - row)
                window = Window(col, row, width, height)
                data = image.read(window=window).astype("float32")
                labels = quality.read(1, window=window)
                valid = (image.read_masks(window=window) > 0).all(axis=0)
                valid &= np.isfinite(data).all(axis=0) & np.isin(labels, (4, 5, 6))
                normalized = np.zeros((6, tile_size, tile_size), dtype="float32")
                normalized[:, :height, :width] = normalize_reflectance(data, valid)
                full_valid = np.zeros((tile_size, tile_size), dtype=bool)
                full_valid[:height, :width] = valid
                clear = full_valid.reshape(grid, PATCH_SIZE, grid, PATCH_SIZE).mean(axis=(1, 3))
                tensor = torch.from_numpy(normalized[None]).to(device)
                if device.startswith("cuda"):
                    torch.cuda.synchronize()
                started = time.perf_counter()
                with torch.inference_mode():
                    result = model({"S2L2A": tensor})
                if device.startswith("cuda"):
                    torch.cuda.synchronize()
                elapsed += time.perf_counter() - started
                # TerraTorch returns intermediate transformer-layer tensors.
                last = result[-1] if isinstance(result, (tuple, list)) else result
                if last.ndim != 3 or last.shape[0] != 1 or last.shape[1] != grid * grid:
                    raise RuntimeError(f"Unexpected patch token layout: {tuple(last.shape)}")
                features = last[0].reshape(grid, grid, -1).float().cpu().numpy()
                features[clear < .90] = np.nan
                all_features.append(features)
                all_clear.append(clear.astype("float32"))
                windows.append((col, row, width, height))
                if max_tiles is not None and len(windows) >= max_tiles:
                    break
            if max_tiles is not None and len(windows) >= max_tiles:
                break
        spatial = {
            "source_crs": str(image.crs),
            "source_transform": list(image.transform)[:6],
            "source_shape": [image.height, image.width],
            "source_resolution": list(image.res),
            "feature_spacing_source_pixels": PATCH_SIZE,
            "feature_spacing_crs_units": [PATCH_SIZE * x for x in image.res],
        }
    features_array = np.stack(all_features)
    clear_array = np.stack(all_clear)
    np.savez_compressed(output / "features.npz", features=features_array, clear_fraction=clear_array,
                        windows=np.array(windows, dtype="int32"))
    versions = {}
    for package in ("torch", "torchvision", "terratorch", "timm", "numpy", "rasterio", "huggingface_hub"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    report = {
        "model_id": MODEL_ID,
        "model_checkpoint_sha256": MODEL_SHA256,
        "model_license": "Apache-2.0",
        "model_license_source": "https://huggingface.co/ibm-esa-geospatial/TerraMind-1.0-tiny",
        "input": str(path.resolve()),
        "input_sha256": _sha256(path),
        "scl": str(scl.resolve()),
        "scl_sha256": _sha256(scl),
        "source_bands": list(SOURCE_BANDS),
        "model_bands": list(MODEL_BANDS),
        "input_units": "physical reflectance",
        "normalization": "physical reflectance * 10000, then TerraMind v1 pretraining band mean/std",
        "normalization_mean": PRETRAIN_MEAN.tolist(),
        "normalization_std": PRETRAIN_STD.tolist(),
        "device": device,
        "cuda_runtime": torch.version.cuda,
        "gpu_name": torch.cuda.get_device_name() if device.startswith("cuda") else None,
        "model_load_seconds": round(model_seconds, 3),
        "inference_seconds": round(elapsed, 3),
        "tile_count": len(windows),
        "tile_size_pixels": tile_size,
        "feature_shape": list(features_array.shape),
        "clear_feature_patches": int((clear_array >= .90).sum()),
        "minimum_clear_patch_fraction": .90,
        "peak_cuda_allocated_bytes": torch.cuda.max_memory_allocated() if device.startswith("cuda") else 0,
        "peak_cuda_reserved_bytes": torch.cuda.max_memory_reserved() if device.startswith("cuda") else 0,
        "memory_measurement": "PyTorch allocator only; excludes CUDA context, driver and other processes. Not training memory.",
        "versions": versions,
        **spatial,
        "limitations": [
            "Frozen encoder features, not trained classifications or accuracy measurements.",
            "Native feature grid is 16 input pixels: 160 m for a 10 m source; SWIR input remains natively 20 m.",
            "Tokens attend to the full inference window and are contextual features, not independent local observations.",
            "Cloud and invalid pixels are neutral-filled; patch clear fraction is explicit and patches below 90% are masked.",
            "A tiny prefix is a feasibility probe; no full-AOI throughput or production guarantee is implied.",
        ],
    }
    (output / "probe.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--scl", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--tile-size", type=int, default=224)
    parser.add_argument("--max-tiles", type=int, default=4)
    parser.add_argument("--cache", type=Path, default=Path("experiments/outputs/land-change/model-cache"))
    args = parser.parse_args()
    report = extract_tile_features(args.image, args.scl, args.output, device=args.device,
                                   tile_size=args.tile_size, max_tiles=args.max_tiles, cache=args.cache)
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
