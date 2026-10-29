"""Testes adicionais do método revisado com pixels reais do kit."""
import json
from pathlib import Path
import tempfile

import numpy as np
import rasterio
from geo_worker.coffee_v2 import read_features, classify, native_weak_samples

ROOT=Path(__file__).resolve().parents[3]


def test_v2_weak_labels_one_point_per_native_cell():
    source=ROOT/'data/reference/mapbiomas_2025_recorte_30m.tif'
    image=ROOT/'data/sample/imagem_multiespectral.tif'
    rr,cc,y,g=native_weak_samples(source,image)
    assert len(rr)==len(set(zip(rr.tolist(),cc.tolist())))
    assert (y==1).sum()>30
    assert (y==2).sum()>(y==1).sum()
    assert len(g)==len(y)


def test_v2_real_upload_difference_changes_polygons():
    image=ROOT/'data/sample/imagem_multiespectral.tif'
    with tempfile.TemporaryDirectory() as temp:
        temp=Path(temp)
        with rasterio.open(image) as src:
            raw=src.read();raw[3]=np.maximum(raw[2],1)
            profile=src.profile.copy();scales=src.scales;offsets=src.offsets
        modified=temp/'altered.tif'
        with rasterio.open(modified,'w',**profile) as dst:
            dst.write(raw);dst.scales=scales;dst.offsets=offsets
        unchanged=classify(image,temp/'original',ROOT/'apps/geo-worker/models/v2/coffee_rf.joblib',ROOT/'data/sample/qualidade_scl.tif')
        altered=classify(modified,temp/'modified',ROOT/'apps/geo-worker/models/v2/coffee_rf.joblib',ROOT/'data/sample/qualidade_scl.tif')
        assert unchanged['candidate_area_ha']!=altered['candidate_area_ha']
        assert altered['coffee_validated'] is False
        assert (temp/'modified'/'classificacao.tif').is_file()


def test_v2_no_data_and_physical_features():
    a,valid,reflectance,names=read_features(ROOT/'data/sample/imagem_multiespectral.tif',ROOT/'data/sample/qualidade_scl.tif')
    assert a.shape[-1]==12
    assert np.isfinite(a).all()
    assert abs(float(np.median(a[:,:,4][valid]))-0.5592)<.003
    assert 'ndvi' in names
    assert valid.sum()>200000
