"""Pipeline v2: café *candidato* com rótulos fracos purificados e RF multiclasse.

NÃO confirma cafezais; o MapBiomas é utilizado apenas como rótulo indireto.
Processa todo GeoTIFF válido recebido, sem atalhos dependentes do nome/arquivo.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import rasterio
from rasterio.warp import transform as transform_coords, reproject, Resampling, transform_geom
from scipy.ndimage import binary_erosion, uniform_filter, median_filter
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit
from PIL import Image

from geo_worker.processing import _load_scl, _polygons, _visualize_rgb, _draw_candidate_outlines, _save_leaflet_raster

CLASS_NAMES = {0: "other", 1: "coffee", 2: "forest", 3: "pasture", 4: "mosaic"}
MAP_CLASSES = {46: 1, 3: 2, 15: 3, 21: 4}
BANDS = ["B02", "B03", "B04", "B08"]
EXTRA_BANDS = ["B05", "B06", "B07", "B8A", "B11", "B12"]
MAX_PIXELS = 16_000_000
MODEL_VERSION = "rf_purified_multiclass_2.0"


def ndiff(a, b):
    out = np.zeros_like(a, dtype=np.float32)
    np.divide(a-b, a+b, out=out, where=np.abs(a+b)>1e-6)
    return out


def _masked_stats(arr, valid, size=5):
    # NODATA e nuvens nunca contribuem como espectro preto nas estatísticas locais.
    v = valid.astype(np.float32)
    denom = np.maximum(uniform_filter(v, size=size, mode="constant") , 1e-6)
    mean = uniform_filter(np.where(valid, arr, 0), size=size, mode="constant") / denom
    squared = uniform_filter(np.where(valid, arr*arr, 0), size=size, mode="constant") / denom
    std = np.sqrt(np.maximum(squared - mean*mean, 0))
    return mean, std


def read_features(image: Path, scl: Path | None = None, extra: Path | None = None):
    with rasterio.open(image) as src:
        if src.driver != "GTiff" or src.count != 4 or src.crs is None or not src.crs.is_projected:
            raise ValueError("Envie GeoTIFF multiespectral de 4 bandas, com CRS projetado.")
        if src.width * src.height > MAX_PIXELS:
            raise ValueError("Imagem ultrapassa o limite de pixels permitido.")
        if src.transform.a <= 0 or src.transform.e >= 0:
            raise ValueError("Grade geográfica inesperada (resolução/transform).")
        raw = src.read().astype(np.float32)
        valid = (raw != 0).all(axis=0) & np.isfinite(raw).all(axis=0)
        if src.nodata is not None:
            valid &= (raw != src.nodata).all(axis=0)
        scales = np.array(src.scales, dtype=np.float32)[:, None, None]
        offsets = np.array(src.offsets, dtype=np.float32)[:, None, None]
        if np.any(scales <= 0):
            raise ValueError("Escalas radiométricas inválidas.")
        data = raw * scales + offsets  # usa metadados do upload; NÃO reaplica offset
        blue, green, red, nir = data
        if scl:
            valid &= np.isin(_load_scl(scl, src), (4, 5))
        ext_arrays = []
        if extra:
            with rasterio.open(extra) as ex:
                if ex.count != 6 or ex.crs is None:
                    raise ValueError("Bandas adicionais devem conter B05,B06,B07,B8A,B11,B12.")
                for i in range(6):
                    resampled = np.zeros(src.shape, dtype=np.float32)
                    reproject(rasterio.band(ex, i+1), resampled,
                              src_transform=ex.transform, src_crs=ex.crs,
                              src_nodata=ex.nodata, dst_transform=src.transform,
                              dst_crs=src.crs, resampling=Resampling.bilinear)
                    # Reamostrar os valores físicos, não os DN, quando escala/offset diferirem.
                    # A entrada extra deve ser reflectância float32, declarada pelas descrições.
                    if ex.dtypes[i] not in ('float32', 'float64') or ex.scales[i] != 1 or ex.offsets[i] != 0:
                        raise ValueError("Bandas extras devem estar em reflectância física float32 (sem scale/offset).")
                    ext_arrays.append(resampled)
                valid &= np.logical_and.reduce([np.isfinite(x) for x in ext_arrays])
    ndvi = ndiff(nir, red)
    gndvi = ndiff(nir, green)
    evi2 = np.zeros_like(ndvi)
    den = nir + 2.4 * red + 1
    np.divide(2.5*(nir-red), den, out=evi2, where=np.abs(den)>1e-6)
    ndm, nds = _masked_stats(ndvi, valid)
    nirm, nirs = _masked_stats(nir, valid)
    names = ["blue", "green", "red", "nir", "ndvi", "gndvi", "evi2", "ndvi_mean5", "ndvi_std5", "nir_mean5", "nir_std5", "nir_red_ratio"]
    arrays = [blue, green, red, nir, ndvi, gndvi, evi2, ndm, nds, nirm, nirs, nir/(red+1e-3)]
    if ext_arrays:
        b05,b06,b07,b8a,b11,b12 = ext_arrays
        arrays += ext_arrays + [ndiff(b8a,b05), ndiff(b8a,b11), ndiff(b8a,b12)]
        names += EXTRA_BANDS + ["ndre", "ndmi", "nbr"]
    stack = np.stack(arrays, axis=-1).astype('float32')
    stack = np.nan_to_num(stack, nan=0, posinf=0, neginf=0)
    # Guardar CRS/transform; resultado sempre muda com pixels efetivos da entrada.
    return stack, valid, data, names


def native_weak_samples(reference: Path, image: Path, erode=1):
    """Extrai UM ponto por célula nativa ~30m, longe de bordas de classe."""
    with rasterio.open(reference) as ref, rasterio.open(image) as scene:
        native = ref.read(1)
        eligible = np.zeros(native.shape, dtype=bool)
        if erode:
            for cls in np.unique(native):
                if cls != 0:
                    eligible |= binary_erosion(native == cls, iterations=erode, border_value=0)
        else:
            eligible = native != 0
        yy, xx = np.nonzero(eligible)
        xs, ys = rasterio.transform.xy(ref.transform, yy, xx, offset='center')
        projected_x, projected_y = transform_coords(ref.crs, scene.crs, xs, ys)
        rows, cols = rasterio.transform.rowcol(scene.transform, projected_x, projected_y)
        rows, cols = np.asarray(rows), np.asarray(cols)
        keep = (rows >= 0)&(rows < scene.height)&(cols >= 0)&(cols < scene.width)
        rows,cols,labels = rows[keep],cols[keep],native[yy[keep],xx[keep]]
        # Agrupamento por posição real fixo em todas as datas: blocos 500x500m.
        group = (rows // 50) * ((scene.width+49)//50) + cols//50
        target = np.array([MAP_CLASSES.get(int(x),0) for x in labels],dtype=np.uint8)
        return rows, cols, target, group


def samples_for_scenes(scenes, reference, erode=1):
    primary = Path(scenes[0][0])
    rows,cols,y,groups = native_weak_samples(reference,primary,erode)
    Xs, ys, gs, dates = [],[],[],[]
    feature_names = None
    for n, (image,scl,extra) in enumerate(scenes):
        f,valid,_,names = read_features(Path(image), Path(scl) if scl else None, Path(extra) if extra else None)
        with rasterio.open(primary) as a, rasterio.open(image) as b:
            if a.shape!=b.shape or a.crs!=b.crs or a.transform!=b.transform:
                raise ValueError("Todas as cenas de treinamento precisam usar a mesma grade.")
        if feature_names is not None and feature_names!=names:
            raise ValueError("Treino misto com bandas adicionais ausentes em algumas datas.")
        feature_names=names
        ok = valid[rows,cols]
        eligible=np.flatnonzero(ok)
        rng=np.random.default_rng(511+n)
        chosen=[]
        for class_id in range(5):
            pool=eligible[y[eligible]==class_id]
            if len(pool)>1400:
                pool=rng.choice(pool,size=1400,replace=False)
            chosen.append(pool)
        selection=np.concatenate(chosen)
        Xs.append(f[rows[selection], cols[selection]]);ys.append(y[selection]);gs.append(groups[selection])
        dates.append(np.full(len(selection),n,dtype='uint8'))
    return np.concatenate(Xs),np.concatenate(ys),np.concatenate(gs),np.concatenate(dates),feature_names


def _forest_fpr(y,p):
    mask=y==2
    return (float(np.mean(p[mask]==1)) if np.any(mask) else None)


def metrics(y,p):
    yt=y==1; yp=p==1
    prec,rec,f1,_=precision_recall_fscore_support(yt,yp,average='binary',zero_division=0)
    return {"coffee_reference_precision":round(float(prec),4),"coffee_reference_recall":round(float(rec),4),
            "coffee_reference_f1":round(float(f1),4),"forest_commission_rate":None if _forest_fpr(y,p) is None else round(_forest_fpr(y,p),5),
            "reference_coffee_count":int(yt.sum()),"evaluated_points":int(len(yt)),
            "confusion_matrix_order":[CLASS_NAMES[x] for x in range(5)],
            "confusion_matrix":confusion_matrix(y,p,labels=list(range(5))).tolist()}


def _new_model(seed=2026,trees=95):
    return RandomForestClassifier(n_estimators=trees,min_samples_leaf=3,max_features='sqrt',
                                  class_weight='balanced_subsample',n_jobs=-1,random_state=seed)


def train(scenes,reference,model_path, erode=1):
    X,y,group,dates,names=samples_for_scenes(scenes,reference,erode)
    if np.sum(y==1)<30 or len(set(y))<3:
        raise ValueError("Não há amostras de café e negativos suficientes no mapa de referência.")
    selected=None
    for tr,te in GroupShuffleSplit(n_splits=35,test_size=.27,random_state=42).split(X,y,group):
        if (y[tr]==1).sum()>25 and (y[te]==1).sum()>15:
            selected=tr,te;break
    if selected is None:
        raise ValueError("Não há blocos espaciais com café suficientes para avaliar honestamente.")
    train_ids,test_ids=selected
    cv=_new_model();cv.fit(X[train_ids],y[train_ids]);p=cv.predict(X[test_ids])
    spatial=metrics(y[test_ids],p)
    temporal=[]
    if len(scenes)>1:
        for d in range(len(scenes)):
            a=dates!=d;b=dates==d
            if (y[a]==1).sum()>25 and (y[b]==1).sum()>10:
                m=_new_model(seed=100+d,trees=55)
                m.fit(X[a],y[a]);temporal.append({"heldout_scene":str(scenes[d][0]),"metrics":metrics(y[b],m.predict(X[b]))})
    final=_new_model();final.fit(X,y)
    report={"model_version":MODEL_VERSION,"trained_images":[str(s[0]) for s in scenes],
            "weak_reference":str(reference),"training_source_cell_samples":int(len(y)),
            "coffee_cell_samples":int((y==1).sum()),"erosion_native_cells":erode,
            "features":names,"spatial_holdout":spatial,"leave_one_date_out":temporal,
            "training_data_warning":"MapBiomas 30m, supervisão fraca, sem rótulos de campo; nenhum score é acurácia real.",
            "threshold":0.50, "forest_class_id":2}
    model_path.parent.mkdir(parents=True,exist_ok=True)
    joblib.dump({"estimator":final,"features":names,"report":report},model_path)
    (model_path.parent/'treinamento_v2.json').write_text(json.dumps(report,indent=2,ensure_ascii=False), encoding='utf-8')
    return report


def _predict_scores(model,feat):
    probs=np.zeros((*feat.shape[:2],len(model.classes_)),dtype=np.float32)
    flat=feat.reshape((-1,feat.shape[-1]))
    for start in range(0,len(flat),45000):
        probs.reshape((-1,len(model.classes_)))[start:start+45000]=model.predict_proba(flat[start:start+45000])
    return probs


def classify(image,output,model_path,scl=None,extra=None,acquisition_date=None,
             threshold=.50,min_area_ha=.2,coherence=True):
    if not .1<=threshold<=.99 or min_area_ha<0:
        raise ValueError("Threshold e tamanho mínimo inválidos.")
    saved=joblib.load(model_path) # somente arquivo fixo confiável, nunca upload!
    features,valid,rgb_bands,names=read_features(image,scl,extra)
    if names!=saved['features']:
        raise ValueError("Bandas do arquivo não correspondem ao esquema do modelo.")
    m=saved['estimator']; scores=_predict_scores(m,features)
    coffee=np.asarray(scores[:,:,list(m.classes_).index(1)],dtype=np.float32)
    pred=np.argmax(scores,axis=2)
    # A probabilidade é escore NÃO calibrado; evitar chamar de confiança real.
    mask=(coffee>=threshold) & (m.classes_[pred]==1) & valid
    if coherence:
        # Filtro majoritário mínimo; não cria classificações sobre regiões inválidas.
        from scipy.ndimage import convolve
        neighbors=convolve(mask.astype('uint8'),np.ones((3,3),dtype='uint8'),mode='constant')
        mask=mask & (neighbors>=4)
    mask &= valid
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    with rasterio.open(image) as src:
        polys=_polygons(mask,src.transform,src.crs,min_area_ha)
        for item in polys:
            item['properties'].update(class_name='coffee_candidate',model_version=MODEL_VERSION,
                probability_kind='uncalibrated_rf_score',acquisition_date=acquisition_date)
            geom_proj=transform_geom('EPSG:4326',src.crs,item['geometry'])
            from rasterio.features import geometry_mask
            inside=geometry_mask([geom_proj],out_shape=src.shape,transform=src.transform,invert=True)
            values=coffee[inside & mask]
            item['properties']['mean_model_score']=round(float(values.mean()),3) if values.size else None
            item['properties']['touches_scene_boundary']=bool(np.any((inside & mask)[0]) or np.any((inside & mask)[-1]) or np.any((inside & mask)[:,0]) or np.any((inside & mask)[:,-1]))
        coll={"type":"FeatureCollection","features":polys}
        (output/'candidatos.geojson').write_text(json.dumps(coll,ensure_ascii=False), encoding='utf-8')
        rgb=_visualize_rgb(rgb_bands)
        rgb.save(output/'imagem_rgb.png')
        geometry=[transform_geom('EPSG:4326',src.crs,p['geometry']) for p in polys]
        _draw_candidate_outlines(rgb,geometry,src.transform).save(output/'imagem_classificada.png')
        bounds=_save_leaflet_raster(src,rgb,output/'imagem_mapa.png')
    # GeoTIFF classificado para uso técnico, além do PNG obrigatório.
    with rasterio.open(image) as src:
        profile=src.profile.copy(); profile.update(count=1,dtype='uint8',nodata=255,compress='deflate')
        with rasterio.open(output/'classificacao.tif','w',**profile) as dst:
            dst.write(np.where(valid,mask.astype('uint8'),255).astype('uint8'),1)
    stats={"method":MODEL_VERSION,"acquisition_date":acquisition_date,"candidate_polygon_count":len(polys),
           "candidate_area_ha":round(sum(x['properties']['area_ha'] for x in polys),3),
           "valid_pixels":int(valid.sum()),"leaflet_bounds":bounds,"image":Path(image).name,
           "ndvi_median":round(float(np.median(features[:,:,4][valid])),4) if valid.any() else None,
           "model_score_threshold":threshold,"model_score_not_calibrated":True,
           "coffee_validated":False,"limitations":"MapBiomas 30m para rótulos fracos; sem verificação de campo; áreas candidatas, não cafezais confirmados.",
           "created_at":datetime.now(timezone.utc).isoformat()}
    (output/'resultado.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2), encoding='utf-8')
    return stats

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    sub=parser.add_subparsers(dest='cmd',required=True)
    tr=sub.add_parser('train');tr.add_argument('--model',default='apps/geo-worker/models/v2/coffee_rf.joblib');tr.add_argument('--reference',default='data/reference/mapbiomas_2025_recorte_30m.tif')
    cl=sub.add_parser('classify');cl.add_argument('image');cl.add_argument('--scl');cl.add_argument('--model',default='apps/geo-worker/models/v2/coffee_rf.joblib');cl.add_argument('--output',default='experiments/outputs/v2');cl.add_argument('--date')
    args=parser.parse_args()
    if args.cmd=='train':
        scenes=[('data/sample/imagem_multiespectral.tif','data/sample/qualidade_scl.tif',None),
                ('data/additional/imagem_adicional_multiespectral.tif','data/additional/qualidade_adicional_scl.tif',None),
                ('data/unseen/imagem_adicional_multiespectral.tif','data/unseen/qualidade_adicional_scl.tif',None)]
        result=train(scenes,Path(args.reference),Path(args.model))
    else: result=classify(Path(args.image),Path(args.output),Path(args.model),Path(args.scl) if args.scl else None,acquisition_date=args.date)
    print(json.dumps(result,ensure_ascii=False,indent=2))
