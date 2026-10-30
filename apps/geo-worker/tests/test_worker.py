"""Stateless worker: authentication, SSRF protection and REAL processing/upload/callback."""
import json
import threading
import uuid
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from geo_worker.api.worker import OUTPUT_FILES, create_worker, storage_url_allowed

ROOT = Path(__file__).resolve().parents[3]
SECRET = 'unit-test-shared-secret-0123456789-0123456789'
STORAGE = 'https://example.supabase.co'
CALLBACK = 'http://localhost:3000'
MODEL = ROOT / 'apps/geo-worker/models/v2/coffee_rf.joblib'


def signed(name: str, upload: bool = False):
    route = 'upload/sign' if upload else 'sign'
    return f'{STORAGE}/storage/v1/object/{route}/geo-private/{name}?token=signed-token'


def job(scene='august'):
    return {
        'id': str(uuid.uuid4()), 'scene': scene,
        'uploads': {key: signed(name, True) for key, (name, _) in OUTPUT_FILES.items()},
    }


def test_authentication_and_url_restrictions():
    assert storage_url_allowed(signed('image.tif'), STORAGE)
    assert not storage_url_allowed('https://evil.example/storage/v1/object/sign/geo-private/x?token=123', STORAGE)
    assert not storage_url_allowed('http://example.supabase.co/storage/v1/object/sign/geo-private/x?token=123', STORAGE)
    assert not storage_url_allowed('https://example.supabase.co@evil.example/storage/v1/object/sign/geo-private/x?token=123', STORAGE)
    with TestClient(create_worker(secret=SECRET, model=MODEL, storage_base=STORAGE,
                                  callback_url=CALLBACK)) as client:
        request = job()
        assert client.post('/internal/process', json=request).status_code == 401
        assert client.post('/internal/process', json=request, headers={'X-Worker-Token':'bad'}).status_code == 401
        request['scene'] = 'unknown'
        assert client.post('/internal/process', json=request,headers={'X-Worker-Token':SECRET}).status_code==422
        request['scene'] = None
        request['image_url'] = 'http://169.254.169.254/latest/meta-data/'
        assert client.post('/internal/process', json=request,headers={'X-Worker-Token':SECRET}).status_code==422


def test_processing_real_scene_uploads_outputs_and_calls_back():
    uploaded = {}
    notified = threading.Event()
    callback = {}

    def handler(request: httpx.Request):
        if request.url.path.endswith('/api/internal/worker-complete'):
            assert request.headers.get('x-worker-token') == SECRET
            callback.update(json.loads(request.content))
            notified.set()
            return httpx.Response(200, json={'ok':True})
        if request.method == 'PUT' and '/upload/sign/' in request.url.path:
            uploaded[request.url.path.split('/')[-1]] = request.content
            return httpx.Response(200, json={'Key':'test'})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    app = create_worker(secret=SECRET, model=MODEL, storage_base=STORAGE,
                        callback_url=CALLBACK, transport=transport)
    with TestClient(app) as client:
        payload=job()
        response=client.post('/internal/process',json=payload,headers={'X-Worker-Token':SECRET})
        assert response.status_code == 202, response.text
        assert notified.wait(timeout=45), 'Worker did not send completion callback'
        assert callback == {'id': payload['id'], 'status': 'ready'}
        assert len(uploaded) == len(OUTPUT_FILES)
        result=json.loads(uploaded['resultado.json'])
        assert result['valid_pixels'] > 0
        assert result['coffee_validated'] is False
        assert json.loads(uploaded['candidatos.geojson'])['type'] == 'FeatureCollection'
        assert uploaded['imagem_classificada.png'][:8] == b'\x89PNG\r\n\x1a\n'


def test_real_uploaded_pixels_are_processed():
    notified=threading.Event()
    output={}
    original=(ROOT/'data/sample/imagem_multiespectral.tif').read_bytes()
    scl=(ROOT/'data/sample/qualidade_scl.tif').read_bytes()

    def handler(request: httpx.Request):
        if request.url.path.endswith('/api/internal/worker-complete'):
            output['callback']=json.loads(request.content)
            notified.set()
            return httpx.Response(200,json={'ok':True})
        if request.method=='GET':
            return httpx.Response(200,content=scl if request.url.path.endswith('scl.tif') else original)
        if request.method=='PUT':
            return httpx.Response(200,json={'Key':'test'})
        return httpx.Response(404)

    app=create_worker(secret=SECRET,model=MODEL,storage_base=STORAGE,
                      callback_url=CALLBACK,transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        payload=job(scene=None)
        payload.update(image_url=signed('image.tif'),scl_url=signed('scl.tif'),date='2025-08-16')
        response=client.post('/internal/process',json=payload,headers={'X-Worker-Token':SECRET})
        assert response.status_code==202,response.text
        assert notified.wait(timeout=45)
        assert output['callback']['status']=='ready'


def test_invalid_tiff_never_yields_ready():
    notified=threading.Event()
    callback={}
    def handler(request: httpx.Request):
        if request.url.path.endswith('/api/internal/worker-complete'):
            callback.update(json.loads(request.content));notified.set()
            return httpx.Response(200,json={'ok':True})
        if request.method=='GET':return httpx.Response(200,content=b'NOT_TIFF')
        if request.method=='PUT':raise AssertionError('invalid input must not generate artifacts')
        return httpx.Response(404)
    app=create_worker(secret=SECRET,model=MODEL,storage_base=STORAGE,
                      callback_url=CALLBACK,transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        payload=job(scene=None)
        payload['image_url']=signed('image.tif')
        response=client.post('/internal/process',json=payload,headers={'X-Worker-Token':SECRET})
        assert response.status_code==202
        assert notified.wait(timeout=15)
        assert callback['status']=='error'
