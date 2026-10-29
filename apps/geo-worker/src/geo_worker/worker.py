"""Serviço INTERNO Python. Better Auth valida o usuário no Next.js.

O worker aceita somente requisições assinadas com segredo de servidor; X-Owner-Id
é enviado exclusivamente pelo Next.js após validação de sessão. Não há OAuth aqui.
"""
import asyncio
import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated
from uuid import uuid4

import rasterio
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from geo_worker.coffee_v2 import classify
from geo_worker.paths import REPO_ROOT, WORKER_ROOT, DATA_ROOT, MODELS_ROOT

ROOT = REPO_ROOT
DEMO = {
    'august': ('data/sample/imagem_multiespectral.tif', 'data/sample/qualidade_scl.tif', '2025-08-16'),
    'july': ('data/additional/imagem_adicional_multiespectral.tif', 'data/additional/qualidade_adicional_scl.tif', '2025-07-21'),
    'october': ('data/unseen/imagem_adicional_multiespectral.tif', 'data/unseen/qualidade_adicional_scl.tif', '2025-10-25'),
}
OUTPUT_FILES = {'geojson':'candidatos.geojson', 'classified':'imagem_classificada.png',
                'map':'imagem_mapa.png', 'rgb':'imagem_rgb.png', 'tif':'classificacao.tif'}
MAX_BYTES = 40 * 1024 * 1024

class DemoRequest(BaseModel):
    scene: str = 'august'


def create_worker(*, storage: Path | None = None, secret: str | None = None, model: Path | None = None):
    storage = Path(storage or os.getenv('STORAGE_ROOT',str(WORKER_ROOT/'.storage'))).resolve()
    secret = secret if secret is not None else os.getenv('WORKER_SECRET','')
    if len(secret) < 32:
        raise RuntimeError('WORKER_SECRET precisa ter pelo menos 32 caracteres aleatórios.')
    model = Path(model or os.getenv('COFFEE_MODEL',str(MODELS_ROOT/'v2/coffee_rf.joblib'))).resolve()
    storage.mkdir(parents=True, exist_ok=True)
    db_path = storage/'worker.sqlite3'
    retention_days = max(1, min(int(os.getenv('RETENTION_DAYS','7')),30))
    with sqlite3.connect(db_path) as cx:
        cx.execute('CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, owner TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL, scene TEXT, date TEXT, error TEXT)')
        cx.execute('CREATE INDEX IF NOT EXISTS owner_created ON analyses(owner, created)')

    app=FastAPI(title='Geo-worker interno',docs_url=None,redoc_url=None,openapi_url=None)
    semaphore=asyncio.Semaphore(1)

    @contextmanager
    def db():
        cx=sqlite3.connect(db_path,timeout=15)
        cx.row_factory=sqlite3.Row
        try:
            yield cx
            cx.commit()
        finally:cx.close()

    def authorize(x_worker_token: Annotated[str|None,Header(alias='X-Worker-Token')]=None,
                  x_owner_id: Annotated[str|None,Header(alias='X-Owner-Id')]=None)->str:
        if not x_worker_token or not secrets.compare_digest(x_worker_token,secret):
            raise HTTPException(401,'Acesso exclusivo ao servidor de aplicação.')
        if not x_owner_id or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}',x_owner_id):
            raise HTTPException(403,'Identificador interno inválido.')
        return x_owner_id

    def folder(owner:str,aid:str):
        return storage/'jobs'/hashlib.sha256(owner.encode()).hexdigest()/aid

    def cleanup():
        cutoff=int(time.time())-retention_days*86400
        with db() as cx:
            rows=cx.execute('SELECT id,owner FROM analyses WHERE created<?',(cutoff,)).fetchall()
            cx.execute('DELETE FROM analyses WHERE created<?',(cutoff,))
        for row in rows:shutil.rmtree(folder(row['owner'],row['id']),ignore_errors=True)

    def find_job(owner:str, aid:str):
        if not re.fullmatch(r'[0-9a-f-]{36}',aid): raise HTTPException(404,'Análise não encontrada.')
        with db() as cx:
            row=cx.execute('SELECT * FROM analyses WHERE id=? AND owner=?',(aid,owner)).fetchone()
        if row is None:raise HTTPException(404,'Análise não encontrada.')
        return dict(row)

    def new_job(owner:str,scene:str|None,date:str|None):
        cleanup()
        now=int(time.time())
        with db() as cx:
            count=cx.execute('SELECT COUNT(*) FROM analyses WHERE owner=? AND created>?',(owner,now-3600)).fetchone()[0]
            if count>=5:raise HTTPException(429,'Máximo de cinco análises por hora.')
            aid=str(uuid4())
            cx.execute('INSERT INTO analyses VALUES (?,?,?,?,?,?,?)',(aid,owner,now,'processing',scene,date,None))
        return aid

    async def save_tiff(upload:UploadFile,path:Path,size_limit=MAX_BYTES):
        if not upload.filename or Path(upload.filename).suffix.lower() not in ('.tif','.tiff'):
            raise HTTPException(415,'Somente arquivos TIFF são aceitos.')
        first=await upload.read(4)
        if first not in (b'II*\x00',b'MM\x00*',b'II+\x00',b'MM\x00+'):
            raise HTTPException(415,'Assinatura TIFF inválida.')
        size=len(first)
        path.parent.mkdir(parents=True,exist_ok=True)
        try:
            with path.open('wb') as out:
                out.write(first)
                while chunk:=await upload.read(1024*1024):
                    size+=len(chunk)
                    if size>size_limit:raise HTTPException(413,'Limite de tamanho excedido.')
                    out.write(chunk)
        finally:await upload.close()

    async def process(owner:str,aid:str,img:Path,scl:Path|None,date:str|None):
        if semaphore.locked():
            with db() as cx:cx.execute('UPDATE analyses SET status=?,error=? WHERE id=? AND owner=?',('error','worker_busy',aid,owner))
            raise HTTPException(503,'Processamento ocupado; tente novamente em instantes.')
        async with semaphore:
            try:
                # joblib carregado apenas a partir de arquivo interno confiável.
                result=await asyncio.to_thread(classify,img,folder(owner,aid)/'out',model,scl,acquisition_date=date)
                with db() as cx:cx.execute('UPDATE analyses SET status=? WHERE id=? AND owner=?',('ready',aid,owner))
                return result
            except Exception as exc:
                with db() as cx:cx.execute('UPDATE analyses SET status=?,error=? WHERE id=? AND owner=?',('error',type(exc).__name__,aid,owner))
                raise HTTPException(422,'Falha ao classificar GeoTIFF; confira bandas, CRS e escala.') from exc

    @app.get('/health')
    def health():return {'status':'ok','model_available':model.is_file(),'internal_worker':True}

    @app.post('/internal/analysis/demo')
    async def demo(body:DemoRequest,owner:Annotated[str,Depends(authorize)]):
        if body.scene not in DEMO:raise HTTPException(422,'Cena inválida.')
        image,scl,date=DEMO[body.scene]
        if not model.is_file():raise HTTPException(503,'Modelo não disponível.')
        aid=new_job(owner,body.scene,date)
        result=await process(owner,aid,ROOT/image,ROOT/scl,date)
        return {'id':aid,'result':result}

    @app.post('/internal/analysis/upload')
    async def upload(image:Annotated[UploadFile,File()],owner:Annotated[str,Depends(authorize)],
                     scl:UploadFile|None=File(None),date:str|None=Form(None)):
        if date:
            try:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date):raise ValueError()
                datetime.strptime(date,'%Y-%m-%d')
            except ValueError:raise HTTPException(422,'Data inválida.')
        if not model.is_file():raise HTTPException(503,'Modelo não disponível.')
        aid=new_job(owner,None,date)
        target=folder(owner,aid)
        try:
            await save_tiff(image,target/'image.tif')
            quality=None
            if scl:
                quality=target/'scl.tif'
                await save_tiff(scl,quality,MAX_BYTES//4)
            with rasterio.open(target/'image.tif') as source:
                if source.count!=4 or source.crs is None or not source.crs.is_projected or source.width*source.height>1_000_000:
                    raise HTTPException(422,'Esperadas 4 bandas e CRS projetado; máximo de um milhão de pixels.')
            if quality:
                with rasterio.open(quality) as source:
                    if source.count!=1 or source.crs is None:
                        raise HTTPException(422,'SCL deve ter uma banda e CRS válido.')
            result=await process(owner,aid,target/'image.tif',quality,date)
            return {'id':aid,'result':result}
        except Exception:
            with db() as cx:cx.execute('UPDATE analyses SET status=?,error=? WHERE id=?',('error','invalid_upload',aid))
            shutil.rmtree(target,ignore_errors=True)
            raise

    @app.get('/internal/analyses')
    def list_analyses(owner:Annotated[str,Depends(authorize)]):
        with db() as cx:
            return [dict(r) for r in cx.execute('SELECT id,created,status,scene,date FROM analyses WHERE owner=? ORDER BY created DESC LIMIT 30',(owner,)).fetchall()]

    @app.get('/internal/analyses/{aid}')
    def get_analysis(aid:str,owner:Annotated[str,Depends(authorize)]):
        row=find_job(owner,aid)
        if row['status']!='ready':return {'analysis':row,'result':None}
        out=folder(owner,aid)/'out'
        return {'analysis':row,'result':json.loads((out/'resultado.json').read_text()),'geojson':json.loads((out/'candidatos.geojson').read_text())}

    @app.get('/internal/analyses/{aid}/files/{kind}')
    def files(aid:str,kind:str,owner:Annotated[str,Depends(authorize)]):
        row=find_job(owner,aid)
        if row['status']!='ready' or kind not in OUTPUT_FILES:raise HTTPException(404,'Arquivo não disponível.')
        path=folder(owner,aid)/'out'/OUTPUT_FILES[kind]
        if not path.is_file():raise HTTPException(404,'Arquivo expirou.')
        return FileResponse(path,filename=path.name)

    return app
