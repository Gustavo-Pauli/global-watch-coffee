"""Offline v2 training and reference evaluation; never imported by the API."""
import json
from pathlib import Path

import joblib
import numpy as np
import rasterio
from rasterio.warp import transform as transform_coords
from scipy.ndimage import binary_erosion
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit

from geo_worker.pipeline.features import read_features
from geo_worker.pipeline.classification import CLASS_NAMES, MODEL_VERSION

MAP_CLASSES = {46: 1, 3: 2, 15: 3, 21: 4}

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
