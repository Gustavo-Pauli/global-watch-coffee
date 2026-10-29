"""Integração real de worker: chaves internas, isolamento por usuário e pixel real."""
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from geo_worker.worker import create_worker

ROOT=Path(__file__).resolve().parents[3]
SECRET='unit-test-shared-secret-0123456789-0123456789'

def headers(user='user_a'):
    return {'X-Worker-Token': SECRET, 'X-Owner-Id': user}


def test_internal_access_and_isolation():
    with tempfile.TemporaryDirectory() as temp:
        client=TestClient(create_worker(storage=Path(temp),secret=SECRET,model=ROOT/'apps/geo-worker/models/v2/coffee_rf.joblib'))
        assert client.get('/internal/analyses').status_code==401
        assert client.get('/internal/analyses',headers={'X-Worker-Token':'bad','X-Owner-Id':'user_a'}).status_code==401
        assert client.get('/internal/analyses',headers=headers('../danger')).status_code==403
        assert client.get('/internal/analyses',headers=headers()).status_code==200
        assert client.post('/internal/analysis/demo',headers=headers(),json={'scene':'not-valid'}).status_code==422
        r=client.post('/internal/analysis/demo',headers=headers(),json={'scene':'august'})
        assert r.status_code==200,r.text
        aid=r.json()['id']
        result=client.get('/internal/analyses/'+aid,headers=headers())
        assert result.status_code==200
        data=result.json()
        assert data['result']['candidate_area_ha']>=0
        assert data['result']['coffee_validated'] is False
        assert client.get('/internal/analyses/'+aid,headers=headers('user_b')).status_code==404
        assert client.get(f'/internal/analyses/{aid}/files/geojson',headers=headers('user_b')).status_code==404
        assert client.get(f'/internal/analyses/{aid}/files/geojson',headers=headers()).json()['type']=='FeatureCollection'
        assert client.get(f'/internal/analyses/{aid}/files/tif',headers=headers()).status_code==200
        assert client.get('/internal/analyses',headers=headers('user_b')).json()==[]


def test_real_upload_and_validation():
    with tempfile.TemporaryDirectory() as temp:
        client=TestClient(create_worker(storage=Path(temp),secret=SECRET,model=ROOT/'apps/geo-worker/models/v2/coffee_rf.joblib'))
        assert client.post('/internal/analysis/upload',headers=headers(),files={'image':('bad.tif',b'not a tiff','image/tiff')}).status_code==415
        with (ROOT/'data/sample/imagem_multiespectral.tif').open('rb') as image, (ROOT/'data/sample/qualidade_scl.tif').open('rb') as scl:
            r=client.post('/internal/analysis/upload',headers=headers(),files={
                'image':('input.tif',image,'image/tiff'),
                'scl':('scl.tif',scl,'image/tiff'),
            },data={'date':'2025-08-16'})
        assert r.status_code==200,r.text
        aid=r.json()['id']
        report=client.get(f'/internal/analyses/{aid}',headers=headers()).json()['result']
        assert report['valid_pixels']>0
        assert report['candidate_polygon_count']>=0
        assert client.get(f'/internal/analyses/{aid}/files/classified',headers=headers()).status_code==200
        assert client.post('/internal/analysis/upload',headers=headers(),files={'image':('not_tiff.txt',b'hi','text/plain')}).status_code==415
