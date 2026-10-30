"""Scientific presentation metadata must remain tied to the processed pixels."""
import hashlib
import json
import threading

import httpx
import numpy as np
import pytest
import rasterio
from PIL import Image
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from geo_worker.api.worker import ALL_OUTPUT_FILES, OPTIONAL_OUTPUT_FILES, create_worker
from geo_worker.pipeline import classification
from geo_worker.pipeline.features import read_scene
from geo_worker.pipeline.provenance import processing_provenance
from geo_worker.pipeline.rendering import false_color_composite, ndvi_composite
from test_worker import CALLBACK, MODEL, ROOT, SECRET, STORAGE, job, signed


def write_scene(path, data=None, valid=None):
    if data is None:
        data = np.full((4, 32, 32), .1, dtype='float32')
        data[0] = 0
        data[3] = .4
    with rasterio.open(path, 'w', driver='GTiff', width=data.shape[2], height=data.shape[1],
                       count=4, dtype='float32', crs='EPSG:32723', transform=from_origin(323200, 7642980, 10, 10)) as dst:
        dst.write(data)
        dst.descriptions = ('B02', 'B03', 'B04', 'B08')
        if valid is not None:
            dst.write_mask(valid)


def write_scl(path, values):
    with rasterio.open(path, 'w', driver='GTiff', width=values.shape[1], height=values.shape[0],
                       count=1, dtype='uint8', crs='EPSG:32723', transform=from_origin(323200, 7642980, 10, 10)) as dst:
        dst.write(values, 1)


def test_quality_partitions_input_mask_scl_and_ndvi_domain_without_changing_eligibility(tmp_path):
    path, scl = tmp_path / 'image.tif', tmp_path / 'scl.tif'
    data = np.full((4, 32, 32), .1, dtype='float32')
    data[3] = .4
    data[2:4, 12:16] = 0  # undefined denominator, still eligible for the original classifier
    data[2, 16:20] = -.1
    data[3, 16:20] = .3  # NDVI outside its presentation domain
    valid = np.full((32, 32), 255, dtype='uint8')
    valid[:4] = 0
    write_scene(path, data, valid)
    classes = np.full((32, 32), 4, dtype='uint8')
    classes[4:8] = 8
    classes[8:12] = 6  # exclusions are not synonymous with cloud coverage
    write_scl(scl, classes)
    scene = read_scene(path, scl)
    assert scene.quality == {
        'total_pixels': 1024, 'eligible_pixels': 640, 'input_invalid_pixels': 128,
        'scl_excluded_pixels': 256, 'scl_applied': True, 'eligible_percent': 62.5,
        'ndvi_defined_pixels': 384,
    }
    assert scene.valid[12:20].all()
    assert not scene.ndvi_defined[12:20].any()
    no_scl = read_scene(path)
    assert no_scl.quality['scl_excluded_pixels'] is None
    assert no_scl.quality['eligible_pixels'] == 896


def test_quality_percent_matches_javascript_half_up_contract(tmp_path):
    data = np.full((4, 2, 1000), .1, dtype='float32')
    data[3] = .4
    mask = np.zeros((2, 1000), dtype='uint8')
    mask[0, :3] = 255
    path = tmp_path / 'image.tif'
    write_scene(path, data, mask)
    assert read_scene(path).quality['eligible_percent'] == .2
    data = np.full((4, 4, 4), .1, dtype='float32')
    data[3] = .4
    mask = np.zeros((4, 4), dtype='uint8')
    mask[0, 0] = 255
    write_scene(path, data, mask)
    assert read_scene(path).quality['eligible_percent'] == 6.3


def test_fixed_ndvi_colors_false_color_channel_order_and_transparency():
    values = np.array([[-1, 0, 1, 0]], dtype='float32')
    image = np.asarray(ndvi_composite(values, np.array([[True, True, True, False]])))
    assert image[0, :3].tolist() == [[140, 76, 45, 255], [236, 225, 181, 255], [46, 107, 79, 255]]
    assert image[0, 3].tolist() == [0, 0, 0, 0]
    reflectance = np.array([[[.01, .01]], [[.02, .02]], [[.08, .08]], [[.32, .32]]], dtype='float32')
    before = reflectance.copy()
    colored = np.asarray(false_color_composite(reflectance, np.array([[True, False]])))
    expected = (255 * (np.array([.32, .08, .02], dtype='float32') / .32) ** .75).astype('uint8')
    assert colored[0, 0, :3].tolist() == expected.tolist()
    assert colored[0, 1].tolist() == [0, 0, 0, 0]
    assert np.array_equal(reflectance, before)


@pytest.mark.parametrize('all_undefined', [False, True])
def test_polygon_ndvi_is_measured_only_from_defined_retained_pixels(tmp_path, monkeypatch, all_undefined):
    path = tmp_path / 'image.tif'
    data = np.full((4, 32, 32), .1, dtype='float32')
    data[3] = .4
    if all_undefined:
        data[2:4, 5:10, 5:10] = 0
    else:
        data[2:4, 6, 6] = 0
        data[2, 7, 7], data[3, 7, 7] = -.1, .3
    write_scene(path, data)

    def fixed_scores(model, features):
        scores = np.zeros((32, 32, len(model.classes_)), dtype='float32')
        scores[:, :, 0] = 1
        scores[5:10, 5:10, 0] = 0
        scores[5:10, 5:10, 1] = 1
        return scores

    monkeypatch.setattr(classification, 'predict_scores', fixed_scores)
    output = tmp_path / 'out'
    result = classification.classify(path, output, MODEL, coherence=False, render_visualizations=True)
    feature = json.loads((output / 'candidatos.geojson').read_text(encoding='utf8'))['features'][0]
    assert feature['properties']['ndvi_mean'] == (None if all_undefined else .6)
    with rasterio.open(output / 'classificacao.tif') as src:
        assert int((src.read(1) == 1).sum()) == 25
    assert result['candidate_polygon_count'] == 1
    assert result['valid_pixels'] == 1024


def test_fingerprint_ignores_paths_but_tracks_inputs_model_parameters_and_date(tmp_path):
    image, same, model, scl = [tmp_path / name for name in ['image.tif', 'copy.tif', 'model.bin', 'scl.tif']]
    image.write_bytes(b'input'); same.write_bytes(b'input'); model.write_bytes(b'model'); scl.write_bytes(b'scl')
    source = {'crs': 'EPSG:32723', 'resolution': {'x': 10, 'y': 10, 'unit': 'metre'}, 'bands': ['B02', 'B03', 'B04', 'B08']}
    parameters = {'threshold': .5, 'min_area_ha': .2, 'coherence': True}
    def identify(path=image, params=parameters, date='2025-08-16'):
        return processing_provenance(path, scl, model, source, 'rf_purified_multiclass_2.0', params, date, 'user_supplied')
    initial = identify()
    assert identify(same)['analysis_fingerprint'] == initial['analysis_fingerprint']
    assert identify(params={**parameters, 'threshold': .6})['analysis_fingerprint'] != initial['analysis_fingerprint']
    assert identify(date='2025-08-17')['analysis_fingerprint'] != initial['analysis_fingerprint']
    model.write_bytes(b'another-model')
    assert identify()['analysis_fingerprint'] != initial['analysis_fingerprint']
    assert initial['input_sha256'] == hashlib.sha256(b'input').hexdigest()
    assert identify(date=None)['date_source'] == 'unknown'


def test_optional_products_have_the_same_grid_and_leave_core_products_identical(tmp_path):
    image = ROOT / 'data/sample/imagem_multiespectral.tif'
    scl = ROOT / 'data/sample/qualidade_scl.tif'
    legacy, extended = tmp_path / 'legacy', tmp_path / 'extended'
    old = classification.classify(image, legacy, MODEL, scl, acquisition_date='2025-08-16')
    new = classification.classify(image, extended, MODEL, scl, acquisition_date='2025-08-16', render_visualizations=True)
    assert old['visualizations'] == {'rgb': 'map'}
    assert new['visualizations'] == {'rgb': 'map', 'false_color': 'false_color', 'ndvi': 'ndvi'}
    assert len(list(legacy.iterdir())) == 6
    assert len(list(extended.iterdir())) == 8
    for path in legacy.iterdir():
        if path.name != 'resultado.json':
            assert path.read_bytes() == (extended / path.name).read_bytes(), path.name
    assert old['provenance'] == new['provenance']
    with Image.open(extended / 'imagem_mapa.png') as rgb:
        size = rgb.size
    for name in ['mapa_falsa_cor.png', 'mapa_ndvi.png']:
        with Image.open(extended / name) as presented:
            assert presented.mode == 'RGBA'
            assert presented.size == size
    assert old['leaflet_bounds'] == new['leaflet_bounds']


def test_worker_uploads_only_requested_eight_and_advertises_schema_compatibility():
    outputs, callback, done = {}, {}, threading.Event()
    def handler(request):
        if request.url.path.endswith('/api/internal/worker-complete'):
            callback.update(json.loads(request.content)); done.set()
            return httpx.Response(200)
        if request.method == 'PUT':
            outputs[request.url.path.split('/')[-1]] = request.content
            return httpx.Response(200)
        return httpx.Response(404)
    app = create_worker(secret=SECRET, model=MODEL, storage_base=STORAGE, callback_url=CALLBACK, transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        assert client.get('/health').json()['output_schema_versions'] == [1, 2]
        payload = job()
        payload['uploads'] = {kind: signed(name, True) for kind, (name, _) in ALL_OUTPUT_FILES.items()}
        assert client.post('/internal/process', json=payload, headers={'X-Worker-Token': SECRET}).status_code == 202
        assert done.wait(45)
        assert callback == {'id': payload['id'], 'status': 'ready'}
        assert set(outputs) == {name for name, _ in ALL_OUTPUT_FILES.values()}
        result = json.loads(outputs['resultado.json'])
        assert result['schema_version'] == 2
        assert result['provenance']['date_source'] == 'sample_metadata'
        assert set(result['visualizations']) == {'rgb', 'false_color', 'ndvi'}


@pytest.mark.parametrize('extra_keys', [['false_color'], ['ndvi'], ['unknown'], ['false_color', 'ndvi', 'unknown']])
def test_worker_rejects_incomplete_or_unknown_output_capabilities(extra_keys):
    app = create_worker(secret=SECRET, model=MODEL, storage_base=STORAGE, callback_url=CALLBACK)
    with TestClient(app) as client:
        payload = job()
        for kind in extra_keys:
            payload['uploads'][kind] = signed(OPTIONAL_OUTPUT_FILES.get(kind, ('unknown.png',))[0], True)
        assert client.post('/internal/process', json=payload, headers={'X-Worker-Token': SECRET}).status_code == 422
