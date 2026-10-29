"""Regression tests for untrusted worker envelopes and bounded raster loading."""
import json
import threading
import asyncio

import httpx
import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from geo_worker import worker
from test_worker import CALLBACK, MODEL, SECRET, STORAGE, job, signed


def make_client(**kwargs):
    return TestClient(worker.create_worker(secret=SECRET, model=MODEL,
                                           storage_base=STORAGE, callback_url=CALLBACK, **kwargs))


@pytest.mark.parametrize('body', [b'', b'{', b'{}', b'null', b'[]', b'{"id":123}'])
def test_malformed_or_missing_job_fields_are_controlled(body):
    with make_client() as client:
        response = client.post('/internal/process', content=body,
                               headers={'X-Worker-Token': SECRET, 'Content-Type': 'application/json'})
        assert response.status_code == 422


def test_authentication_precedes_json_parsing_and_size_checks():
    with make_client() as client:
        response = client.post('/internal/process', content=b'{' * (worker.MAX_JOB_BYTES + 1))
        assert response.status_code == 401


def test_wrong_content_type_and_body_limits():
    with make_client() as client:
        assert client.post('/internal/process', content='{}',
                           headers={'X-Worker-Token': SECRET, 'Content-Type': 'text/plain'}).status_code == 415
        headers = {'X-Worker-Token': SECRET, 'Content-Type': 'application/json'}
        assert client.post('/internal/process', content=b'x' * (worker.MAX_JOB_BYTES + 1), headers=headers).status_code == 413
        # Streaming/chunked bodies cannot bypass the limit by omitting Content-Length.
        assert client.post('/internal/process', content=iter([b'x' * (worker.MAX_JOB_BYTES + 1)]), headers=headers).status_code == 413


@pytest.mark.parametrize('path', [
    '/storage/v1/object/sign/geo-private/../public/x',
    '/storage/v1/object/sign/geo-private/%2e%2e/public/x',
    '/storage/v1/object/sign/geo-private/%252e%252e/public/x',
    '/storage/v1/object/sign/geo-private/foo%5c..%5cbar',
    '/storage/v1/object/public/sign/geo-private/x',
])
def test_storage_path_normalization_cannot_change_endpoint(path):
    assert not worker.storage_url_allowed(STORAGE + path + '?token=abc', STORAGE)


def test_output_urls_must_be_upload_urls():
    assert not worker.storage_url_allowed(signed('result.json'), STORAGE, upload=True)
    assert not worker.storage_url_allowed(signed('result.json', True), STORAGE)
    with make_client() as client:
        payload = job()
        payload['uploads']['result'] = signed('result.json')
        assert client.post('/internal/process', json=payload, headers={'X-Worker-Token': SECRET}).status_code == 422


def test_compressed_scl_cannot_exceed_pixel_limit(tmp_path):
    # Tiny on disk, but deliberately enormous after decompression.
    scl = tmp_path / 'large-scl.tif'
    with rasterio.open(scl, 'w', driver='GTiff', count=1, dtype='uint8',
                       width=1100, height=1000, crs='EPSG:32723',
                       transform=from_origin(323200, 7642980, 10, 10), compress='deflate') as dst:
        dst.write(np.zeros((1000, 1100), dtype='uint8'), 1)
    with pytest.raises(ValueError, match='SCL excede'):
        worker.validate_rasters(MODEL.parents[4] / 'data/sample/imagem_multiespectral.tif', scl)


def test_duplicate_active_job_is_not_processed_twice(monkeypatch):
    entered, release, notified = threading.Event(), threading.Event(), threading.Event()
    executions = []

    def classify(*args):
        executions.append(args)
        entered.set()
        assert release.wait(10)

    def handler(request):
        if request.url.path.endswith('/api/internal/worker-complete'):
            notified.set()
            return httpx.Response(200, json={'ok': True})
        return httpx.Response(404)

    monkeypatch.setattr(worker, 'classify_job', classify)
    with make_client(transport=httpx.MockTransport(handler)) as client:
        payload = job()
        headers = {'X-Worker-Token': SECRET}
        try:
            assert client.post('/internal/process', json=payload, headers=headers).status_code == 202
            assert entered.wait(5)
            assert client.post('/internal/process', json=payload, headers=headers).status_code == 202
            assert client.post('/internal/process', json=job(), headers=headers).status_code == 503
            assert len(executions) == 1
        finally:
            release.set()
        assert notified.wait(5)


def test_oversized_download_never_uploads_or_signals_ready(monkeypatch):
    notified, outcomes = threading.Event(), []

    def handler(request):
        if request.url.path.endswith('/api/internal/worker-complete'):
            outcomes.append(json.loads(request.content))
            notified.set()
            return httpx.Response(200, json={'ok': True})
        if request.method == 'GET':
            return httpx.Response(200, content=b'II*\x00' + b'x' * 20)
        raise AssertionError('Invalid input must not generate uploads')

    monkeypatch.setattr(worker, 'MAX_IMAGE', 8)
    with make_client(transport=httpx.MockTransport(handler)) as client:
        payload = job(None)
        payload['image_url'] = signed('image.tif')
        assert client.post('/internal/process', json=payload, headers={'X-Worker-Token': SECRET}).status_code == 202
        assert notified.wait(5)
        assert outcomes[0]['status'] == 'error'


def test_http_compression_is_rejected_before_decompression(tmp_path):
    async def run():
        def handler(request):
            assert request.headers['accept-encoding'] == 'identity'
            # A streaming response avoids eagerly decoding in the test fixture.
            return httpx.Response(200, headers={'Content-Encoding': 'gzip'},
                                  stream=httpx.ByteStream(b'not-even-a-valid-gzip'))

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(ValueError, match='Compressão HTTP'):
                await worker.download_tiff(client, signed('image.tif'), tmp_path / 'image.tif', worker.MAX_IMAGE)
    asyncio.run(run())


def test_partial_storage_failure_never_signals_ready(monkeypatch):
    notified, outcomes = threading.Event(), []

    def fake_classify(image, output, *args):
        output.mkdir()
        for name, _ in worker.OUTPUT_FILES.values():
            (output / name).write_bytes(b'test-artifact')

    def handler(request):
        if request.url.path.endswith('/api/internal/worker-complete'):
            outcomes.append(json.loads(request.content))
            notified.set()
            return httpx.Response(200, json={'ok': True})
        if request.method == 'PUT':
            return httpx.Response(503)
        return httpx.Response(404)

    monkeypatch.setattr(worker, 'classify_job', fake_classify)
    with make_client(transport=httpx.MockTransport(handler)) as client:
        assert client.post('/internal/process', json=job(), headers={'X-Worker-Token': SECRET}).status_code == 202
        assert notified.wait(5)
        assert outcomes[0]['status'] == 'error'


def test_callback_retries_after_transient_failure(monkeypatch):
    notified, outcomes = threading.Event(), []

    def fake_classify(image, output, *args):
        output.mkdir()
        for name, _ in worker.OUTPUT_FILES.values():
            (output / name).write_bytes(b'test-artifact')

    def handler(request):
        if request.url.path.endswith('/api/internal/worker-complete'):
            outcomes.append(json.loads(request.content))
            if len(outcomes) == 1:
                return httpx.Response(503)
            notified.set()
            return httpx.Response(200, json={'ok': True})
        return httpx.Response(200)

    monkeypatch.setattr(worker, 'classify_job', fake_classify)
    with make_client(transport=httpx.MockTransport(handler)) as client:
        payload = job()
        assert client.post('/internal/process', json=payload, headers={'X-Worker-Token': SECRET}).status_code == 202
        assert notified.wait(8)
        assert outcomes == [{'id': payload['id'], 'status': 'ready'}] * 2
