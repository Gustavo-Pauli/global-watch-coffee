"""Synthetic georeferenced regressions, independent of the model's accuracy."""
import json
import warnings

import joblib
import numpy as np
import pytest
import rasterio
from affine import Affine
from rasterio.transform import from_origin
from sklearn.exceptions import InconsistentVersionWarning

from geo_worker import coffee_v2
from geo_worker.processing import _polygons
from test_worker import MODEL


def write_image(path, *, data=None, transform=None, descriptions=None, scales=None, mask=None):
    if data is None:
        data = np.full((4, 32, 32), .1, dtype='float32')
        data[0] = 0  # zero physical reflectance is valid unless marked NoData
        data[3] = .4
    with rasterio.open(path, 'w', driver='GTiff', width=32, height=32, count=4,
                       dtype=data.dtype, crs='EPSG:32723',
                       transform=transform or from_origin(323200, 7642980, 10, 10)) as dst:
        dst.write(data)
        if descriptions:
            dst.descriptions = descriptions
        if scales:
            dst.scales = scales
        if mask is not None:
            dst.write_mask(mask)


def test_explicit_gdal_mask_is_respected_and_valid_zero_is_not_nodata(tmp_path):
    path = tmp_path / 'masked.tif'
    mask = np.full((32, 32), 255, dtype='uint8')
    mask[:8] = 0
    write_image(path, mask=mask)
    _, valid, _, _ = coffee_v2.read_features(path)
    assert not valid[:8].any()
    assert valid[8:].all()


def test_all_invalid_input_is_rejected_instead_of_becoming_ready_zero(tmp_path):
    path = tmp_path / 'invalid.tif'
    write_image(path, mask=np.zeros((32, 32), dtype='uint8'))
    with pytest.raises(ValueError, match='sem pixels válidos'):
        coffee_v2.read_features(path)


def test_unscaled_digital_numbers_are_not_treated_as_reflectance(tmp_path):
    path = tmp_path / 'unscaled.tif'
    write_image(path, data=np.full((4, 32, 32), 2000, dtype='uint16'))
    with pytest.raises(ValueError, match='escala/offset'):
        coffee_v2.read_features(path)


def test_wrong_declared_band_order_and_rotated_grid_are_rejected(tmp_path):
    path = tmp_path / 'bands.tif'
    write_image(path, descriptions=('B08', 'B03', 'B04', 'B02'))
    with pytest.raises(ValueError, match='Ordem das bandas'):
        coffee_v2.read_features(path)
    write_image(path, transform=Affine(10, 1, 323200, 0, -10, 7642980))
    with pytest.raises(ValueError, match='Grade geográfica'):
        coffee_v2.read_features(path)


def test_classified_tiff_and_geojson_keep_the_same_minimum_area(tmp_path, monkeypatch):
    path = tmp_path / 'input.tif'
    write_image(path)

    def fake_scores(model, features):
        scores = np.zeros((32, 32, len(model.classes_)), dtype='float32')
        scores[:, :, 0] = 1
        for rows, cols in [(slice(5, 10), slice(5, 10)), (slice(20, 22), slice(20, 22))]:
            scores[rows, cols, 0] = 0
            scores[rows, cols, 1] = 1
        return scores

    monkeypatch.setattr(coffee_v2, '_predict_scores', fake_scores)
    result = coffee_v2.classify(path, tmp_path / 'out', MODEL, coherence=False)
    collection = json.loads((tmp_path / 'out/candidatos.geojson').read_text(encoding='utf-8'))
    with rasterio.open(tmp_path / 'out/classificacao.tif') as src:
        classified = src.read(1)
    assert result['candidate_polygon_count'] == len(collection['features']) == 1
    assert int((classified == 1).sum()) == 25
    assert not classified[20:22, 20:22].any()
    assert .24 < result['candidate_area_ha'] < .26


def test_production_v2_model_loads_without_sklearn_version_mismatch():
    with warnings.catch_warnings():
        warnings.simplefilter('error', InconsistentVersionWarning)
        saved = joblib.load(MODEL)
    assert saved['features'][4] == 'ndvi'
    assert saved['estimator'].n_features_in_ == 12


def test_fragmented_raster_cannot_generate_unbounded_polygons():
    binary = np.zeros((16, 16), dtype=bool)
    binary[::2, ::2] = True
    with pytest.raises(ValueError, match='excessivamente fragmentada'):
        _polygons(binary, from_origin(323200, 7642980, 10, 10), 'EPSG:32723', 0, max_regions=2)
