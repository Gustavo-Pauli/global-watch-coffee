"""Radiometry and source integrity guards run without the optional torch stack."""
import numpy as np
import pytest
import rasterio
from rasterio.transform import Affine, from_origin

from research.land_change.model_probe import (
    _sha256, extract_tile_features, normalize_reflectance, validate_source_grid,
)


def rasters(tmp_path, *, transform=None, quality_transform=None, crs="EPSG:32721",
            dtype="float32", scale=1.0):
    transform = transform or from_origin(600000, 9200000, 10, 10)
    image, quality = tmp_path / "image.tif", tmp_path / "scl.tif"
    with rasterio.open(image, "w", driver="GTiff", width=16, height=16,
                       count=6, dtype=dtype, crs=crs, transform=transform) as dst:
        dst.write(np.full((6, 16, 16), .2, dtype=dtype))
        dst.scales = (scale,) * 6
    with rasterio.open(quality, "w", driver="GTiff", width=16, height=16,
                       count=1, dtype="uint8", crs=crs,
                       transform=quality_transform or transform) as dst:
        dst.write(np.full((16, 16), 4, dtype="uint8"), 1)
    return image, quality


def test_physical_reflectance_uses_pretraining_units_without_reapplying_sentinel_offset():
    # Independent physical-unit anchors from the documented pretraining stats.
    # A second -0.1 correction or missing *10000 would break all six anchors.
    anchor = np.array([.1503317, .1718197, .1853910, .3083234, .2424884, .1857648],
                      dtype="float32")[:, None, None]
    normalized = normalize_reflectance(anchor, np.ones((1, 1), dtype=bool))
    assert normalized == pytest.approx(np.zeros((6, 1, 1)), abs=2e-7)


def test_obscured_nonfinite_pixels_are_neutral_filled_but_not_accepted_as_valid():
    bands = np.full((6, 4, 4), .2, dtype="float32")
    bands[:, 0, 0] = np.nan
    bands[:, 0, 1] = np.inf
    valid = np.ones((4, 4), dtype=bool)
    with pytest.raises(ValueError, match="Nonfinite"):
        normalize_reflectance(bands, valid)
    valid[0, :2] = False
    normalized = normalize_reflectance(bands, valid)
    assert np.isfinite(normalized).all()
    assert (normalized[:, 0, :2] == 0).all()
    assert not (normalized[:, 1:, :] == 0).all()


def test_all_missing_support_never_becomes_spurious_reflectance():
    normalized = normalize_reflectance(np.full((6, 2, 2), np.nan, dtype="float32"),
                                      np.zeros((2, 2), dtype=bool))
    assert np.array_equal(normalized, np.zeros((6, 2, 2), dtype="float32"))


def test_radiometry_rejects_raw_dn_and_categorical_valid_masks():
    valid = np.ones((4, 4), dtype=bool)
    with pytest.raises(ValueError, match="physical reflectance"):
        normalize_reflectance(np.full((6, 4, 4), 1500, dtype="float32"), valid)
    with pytest.raises(ValueError, match="boolean"):
        normalize_reflectance(np.full((6, 4, 4), .2, dtype="float32"), valid.astype("uint8"))
    with pytest.raises(ValueError, match="aligned"):
        normalize_reflectance(np.zeros((6, 4, 4), dtype="float32"), valid[:3])


def test_input_grid_requires_exact_scl_alignment_and_rejects_shift_before_optional_model_load(tmp_path):
    shifted = from_origin(600005, 9200000, 10, 10)  # Half-pixel shift is material.
    image, quality = rasters(tmp_path, quality_transform=shifted)
    with pytest.raises(ValueError, match="exactly match"):
        # This must fail without torch installed, creating cache, or loading weights.
        extract_tile_features(image, quality, tmp_path / "output", device="cpu")
    assert not (tmp_path / "output").exists()


@pytest.mark.parametrize("options", [
    {"crs": "EPSG:4326"},
    {"dtype": "uint16"},
    {"scale": .0001},
    {"transform": Affine(10, 1, 600000, 0, -10, 9200000)},
])
def test_grid_rejects_geographic_units_raw_dn_metadata_and_rotated_support(tmp_path, options):
    image, quality = rasters(tmp_path, **options)
    with pytest.raises(ValueError):
        validate_source_grid(image, quality)


def test_physical_projected_grid_is_accepted(tmp_path):
    image, quality = rasters(tmp_path)
    validate_source_grid(image, quality)


def test_source_hash_is_path_independent_and_covers_bytes_after_first_chunk(tmp_path):
    first, copy = tmp_path / "first.bin", tmp_path / "copy.bin"
    first.write_bytes(b"abc")
    assert _sha256(first) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    contents = b"known observation" * 70000
    assert len(contents) > 1024 * 1024
    first.write_bytes(contents)
    copy.write_bytes(contents)
    before = _sha256(first)
    assert before == _sha256(copy)
    with first.open("r+b") as stream:
        stream.seek(1024 * 1024 + 8)
        stream.write(b"!")
    assert _sha256(first) != before
    assert _sha256(copy) == before
