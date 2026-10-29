"""Stateless geo-worker. Better Auth/Postgres/Storage belong exclusively to Next.js.

Only server-authenticated jobs are accepted. Uploaded GeoTIFFs and generated files
travel through short-lived, pre-signed URLs on the configured private Storage host.
Neither SQLite nor user sessions nor permanent output files live in this worker.
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx
import rasterio
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from geo_worker.coffee_v2 import classify
from geo_worker.paths import REPO_ROOT, MODELS_ROOT

DEMO = {
    'august': ('data/sample/imagem_multiespectral.tif', 'data/sample/qualidade_scl.tif', '2025-08-16'),
    'july': ('data/additional/imagem_adicional_multiespectral.tif', 'data/additional/qualidade_adicional_scl.tif', '2025-07-21'),
    'october': ('data/unseen/imagem_adicional_multiespectral.tif', 'data/unseen/qualidade_adicional_scl.tif', '2025-10-25'),
}
OUTPUT_FILES = {
    'geojson': ('candidatos.geojson', 'application/geo+json'),
    'classified': ('imagem_classificada.png', 'image/png'),
    'map': ('imagem_mapa.png', 'image/png'),
    'rgb': ('imagem_rgb.png', 'image/png'),
    'tif': ('classificacao.tif', 'image/tiff'),
    'result': ('resultado.json', 'application/json'),
}
MAX_IMAGE = 12 * 1024 * 1024
MAX_SCL = 4 * 1024 * 1024


class JobRequest(BaseModel):
    id: str
    scene: str | None = None
    image_url: str | None = None
    scl_url: str | None = None
    date: str | None = None
    uploads: dict[str, str] = Field(default_factory=dict)

    @field_validator('id')
    @classmethod
    def valid_uuid(cls, value: str) -> str:
        if str(UUID(value)) != value:
            raise ValueError('ID inválido')
        return value

    @field_validator('date')
    @classmethod
    def valid_date(cls, value: str | None) -> str | None:
        if value:
            datetime.strptime(value, '%Y-%m-%d')
        return value


def storage_url_allowed(url: str, storage_base: str) -> bool:
    """No SSRF: only HTTPS signed Storage URLs for our own configured project."""
    try:
        target = urlsplit(url)
        base = urlsplit(storage_base)
        return (
            target.scheme == ('http' if base.hostname in ('127.0.0.1', 'localhost') else 'https')
            and target.hostname == base.hostname
            and target.port == base.port
            and target.username is None and target.password is None
            and target.path.startswith('/storage/v1/object/')
            and ('/sign/' in target.path)
            and bool(target.query)
            and not target.fragment
        )
    except ValueError:
        return False


async def download_tiff(client: httpx.AsyncClient, url: str, path: Path, limit: int) -> None:
    size = 0
    with path.open('wb') as target:
        async with client.stream('GET', url) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise ValueError('GeoTIFF excede o tamanho permitido')
                target.write(chunk)
    with path.open('rb') as target:
        if target.read(4) not in (b'II*\x00', b'MM\x00*', b'II+\x00', b'MM\x00+'):
            raise ValueError('GeoTIFF sem assinatura TIFF válida')


def validate_rasters(image: Path, scl: Path | None) -> None:
    with rasterio.open(image) as src:
        if src.count != 4 or src.crs is None or not src.crs.is_projected:
            raise ValueError('Esperadas quatro bandas e CRS projetado')
        if src.width * src.height > 1_000_000:
            raise ValueError('Limite de um milhão de pixels')
    if scl:
        with rasterio.open(scl) as src:
            if src.count != 1 or src.crs is None:
                raise ValueError('Máscara SCL inválida')


def create_worker(*, secret: str | None = None, model: Path | None = None,
                  storage_base: str | None = None, callback_url: str | None = None,
                  transport: httpx.AsyncBaseTransport | None = None):
    secret = secret if secret is not None else os.getenv('WORKER_SECRET', '')
    if len(secret) < 32:
        raise RuntimeError('WORKER_SECRET precisa ter pelo menos 32 caracteres aleatórios.')
    model = Path(model or os.getenv('COFFEE_MODEL', str(MODELS_ROOT / 'v2/coffee_rf.joblib'))).resolve()
    storage_base = (storage_base or os.getenv('SUPABASE_URL', '')).rstrip('/')
    callback_url = callback_url or os.getenv('NEXT_CALLBACK_URL', '')
    if not storage_base.startswith(('https://', 'http://')):
        raise RuntimeError('SUPABASE_URL deve apontar ao Storage do projeto.')
    if not callback_url.startswith(('https://', 'http://')):
        raise RuntimeError('NEXT_CALLBACK_URL obrigatório.')
    if urlsplit(callback_url).hostname not in ('127.0.0.1', 'localhost') and not callback_url.startswith('https://'):
        raise RuntimeError('Callback de produção deve utilizar HTTPS.')
    callback = callback_url.rstrip('/') + '/api/internal/worker-complete'
    app = FastAPI(title='Geo-worker interno', docs_url=None, redoc_url=None, openapi_url=None)
    semaphore = asyncio.Semaphore(1)
    tasks: set[asyncio.Task] = set()

    def authorize(x_worker_token: str | None) -> None:
        if not x_worker_token or not secrets.compare_digest(x_worker_token, secret):
            raise HTTPException(401, 'Acesso exclusivo ao servidor de aplicação.')

    async def execute(job: JobRequest):
        outcome = {'id': job.id, 'status': 'error', 'error_code': 'processing_failed'}
        try:
            with tempfile.TemporaryDirectory(prefix='gw-geo-') as tmp:
                workspace = Path(tmp)
                image = workspace / 'image.tif'
                scl = workspace / 'scl.tif' if job.scl_url else None
                date = job.date
                timeout = httpx.Timeout(90.0, connect=20.0)
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, transport=transport) as client:
                    if job.scene:
                        demo_image, demo_scl, date = DEMO[job.scene]
                        image = REPO_ROOT / demo_image
                        scl = REPO_ROOT / demo_scl
                    else:
                        await download_tiff(client, job.image_url, image, MAX_IMAGE)
                        if job.scl_url and scl is not None:
                            await download_tiff(client, job.scl_url, scl, MAX_SCL)
                    await asyncio.to_thread(validate_rasters, image, scl)
                    await asyncio.to_thread(classify, image, workspace / 'out', model, scl, acquisition_date=date)
                    for kind, (name, content_type) in OUTPUT_FILES.items():
                        file = workspace / 'out' / name
                        if not file.is_file():
                            raise ValueError(f'Arquivo de saída ausente: {kind}')
                        response = await client.put(job.uploads[kind], content=file.read_bytes(), headers={
                            'Content-Type': content_type, 'x-upsert': 'false'
                        })
                        response.raise_for_status()
                outcome = {'id': job.id, 'status': 'ready'}
        except Exception as error:
            # Never log signed URLs, user content or storage tokens.
            print(f'[geo-worker] job={job.id} failed: {type(error).__name__}', flush=True)
        finally:
            for attempt in range(3):
                try:
                    async with httpx.AsyncClient(timeout=20, transport=transport) as client:
                        response = await client.post(callback, json=outcome, headers={'X-Worker-Token': secret})
                        response.raise_for_status()
                    break
                except Exception as error:
                    print(f'[geo-worker] callback attempt {attempt+1} for {job.id} failed: {type(error).__name__}', flush=True)
                    if attempt < 2:
                        await asyncio.sleep(2 * (attempt + 1))
            semaphore.release()

    @app.get('/health')
    def health():
        return {'status': 'ok', 'model_available': model.is_file(), 'internal_worker': True}

    @app.post('/internal/process', status_code=202)
    async def start(job: JobRequest, x_worker_token: str | None = Header(default=None)):
        authorize(x_worker_token)
        if not model.is_file():
            raise HTTPException(503, 'Modelo não disponível.')
        if bool(job.scene) == bool(job.image_url):
            raise HTTPException(422, 'Informe uma cena ou uma imagem enviada.')
        if job.scene and (job.scene not in DEMO or job.scl_url):
            raise HTTPException(422, 'Cena inválida.')
        if not job.scene and not storage_url_allowed(job.image_url or '', storage_base):
            raise HTTPException(422, 'URL de entrada inválida.')
        if job.scl_url and not storage_url_allowed(job.scl_url, storage_base):
            raise HTTPException(422, 'URL SCL inválida.')
        if set(job.uploads) != set(OUTPUT_FILES) or any(
            not storage_url_allowed(value, storage_base) for value in job.uploads.values()
        ):
            raise HTTPException(422, 'URLs de saída inválidas.')
        if semaphore.locked():
            raise HTTPException(503, 'Worker ocupado: tente novamente após o término da análise.')
        await semaphore.acquire()
        task = asyncio.create_task(execute(job))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        return {'id': job.id, 'status': 'processing'}

    return app
