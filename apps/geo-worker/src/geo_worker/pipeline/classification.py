"""Production v2 coffee-candidate inference; no training or research dependencies."""
import json
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom, Resampling
from sklearn.exceptions import InconsistentVersionWarning

from geo_worker.pipeline.features import read_features, read_scene
from geo_worker.pipeline.geometry import candidate_polygons
from geo_worker.pipeline.provenance import processing_provenance
from geo_worker.pipeline.rendering import (
    rgb_composite, draw_candidate_outlines, save_leaflet_raster,
    false_color_composite, ndvi_composite,
)

CLASS_NAMES = {0: "other", 1: "coffee", 2: "forest", 3: "pasture", 4: "mosaic"}
MODEL_VERSION = "rf_purified_multiclass_2.0"

def predict_scores(model,feat):
    probs=np.zeros((*feat.shape[:2],len(model.classes_)),dtype=np.float32)
    flat=feat.reshape((-1,feat.shape[-1]))
    for start in range(0,len(flat),45000):
        probs.reshape((-1,len(model.classes_)))[start:start+45000]=model.predict_proba(flat[start:start+45000])
    return probs


def classify(image,output,model_path,scl=None,extra=None,acquisition_date=None,
             threshold=.50,min_area_ha=.2,coherence=True, *, render_visualizations=False,
             date_source='unknown'):
    if not .1<=threshold<=.99 or min_area_ha<0:
        raise ValueError("Threshold e tamanho mínimo inválidos.")
    # Only a trusted configured file can reach joblib. Cross-version pickle
    # loading is unsupported by sklearn and must not silently serve predictions.
    with warnings.catch_warnings():
        warnings.simplefilter('error', InconsistentVersionWarning)
        saved=joblib.load(model_path)
    if (saved.get('report', {}).get('model_version') != MODEL_VERSION
            or set(saved['estimator'].classes_) != set(CLASS_NAMES)):
        raise ValueError("Modelo incompatível com o pipeline multiclasse v2.")
    features,valid,rgb_bands,names,quality,source,ndvi_defined=read_scene(image,scl,extra)
    if names!=saved['features']:
        raise ValueError("Bandas do arquivo não correspondem ao esquema do modelo.")
    # Render Free has limited CPU/RAM: avoid one prediction thread per host CPU.
    m=saved['estimator']; m.set_params(n_jobs=1)
    scores=predict_scores(m,features)
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
    # A contiguous plane lets us release the full predictor/model arrays before
    # rendering additional products on the small free-tier worker.
    ndvi_values = np.ascontiguousarray(features[:, :, 4])
    ndvi_median = round(float(np.median(ndvi_values[valid])), 4) if valid.any() else None
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    visualizations = {'rgb': 'map'}
    with rasterio.open(image) as src:
        polys=candidate_polygons(mask,src.transform,src.crs,min_area_ha)
        geometry=[transform_geom('EPSG:4326',src.crs,p['geometry']) for p in polys]
        # Rasterize retained components once. A full-scene mask per polygon was
        # quadratic in scene size/fragmentation and could monopolize a free CPU.
        labels = (rasterize(((g, i + 1) for i, g in enumerate(geometry)), out_shape=src.shape,
                            transform=src.transform, fill=0, dtype='int32')
                  if geometry else np.zeros(src.shape, dtype='int32'))
        retained = labels != 0
        counts = np.bincount(labels[mask], minlength=len(polys) + 1)
        sums = np.bincount(labels[mask], weights=coffee[mask], minlength=len(polys) + 1)
        boundary_ids = set(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])).tolist())
        for i, item in enumerate(polys, 1):
            item['properties'].update(class_name='coffee_candidate',model_version=MODEL_VERSION,
                probability_kind='uncalibrated_rf_score',acquisition_date=acquisition_date)
            item['properties']['mean_model_score']=round(float(sums[i]/counts[i]),3) if counts[i] else None
            item['properties']['touches_scene_boundary']=i in boundary_ids
        del scores, coffee, pred, m, saved, features
        sample = ndvi_defined & retained
        ndvi_counts = np.bincount(labels[sample], minlength=len(polys) + 1)
        ndvi_sums = np.bincount(labels[sample], weights=ndvi_values[sample], minlength=len(polys) + 1)
        for i, item in enumerate(polys, 1):
            item['properties']['ndvi_mean'] = round(float(ndvi_sums[i] / ndvi_counts[i]), 4) if ndvi_counts[i] else None
        del sample, ndvi_counts, ndvi_sums
        coll={"type":"FeatureCollection","features":polys}
        (output/'candidatos.geojson').write_text(json.dumps(coll,ensure_ascii=False), encoding='utf-8')
        rgb=rgb_composite(rgb_bands)
        rgb.save(output/'imagem_rgb.png')
        # The TIFF must show exactly the candidates retained in the GeoJSON/ha.
        # Previously sub-0.2ha components disappeared only from vector outputs.
        draw_candidate_outlines(rgb,geometry,src.transform).save(output/'imagem_classificada.png')
        bounds=save_leaflet_raster(src,rgb,output/'imagem_mapa.png')
        rgb.close()
        del rgb
        if render_visualizations:
            false_color = false_color_composite(rgb_bands, valid)
            try:
                false_bounds = save_leaflet_raster(src, false_color, output/'mapa_falsa_cor.png')
            finally:
                false_color.close()
            if false_bounds != bounds:
                raise ValueError('Grade da falsa cor não corresponde à imagem RGB.')
            visualizations['false_color'] = 'false_color'
            ndvi_image = ndvi_composite(ndvi_values, ndvi_defined)
            try:
                ndvi_bounds = save_leaflet_raster(src, ndvi_image, output/'mapa_ndvi.png', color_resampling=Resampling.nearest)
            finally:
                ndvi_image.close()
            if ndvi_bounds != bounds:
                raise ValueError('Grade NDVI não corresponde à imagem RGB.')
            visualizations['ndvi'] = 'ndvi'
    # GeoTIFF classificado para uso técnico, além do PNG obrigatório.
    with rasterio.open(image) as src:
        profile=src.profile.copy(); profile.update(count=1,dtype='uint8',nodata=255,compress='deflate')
        with rasterio.open(output/'classificacao.tif','w',**profile) as dst:
            dst.write(np.where(valid,retained.astype('uint8'),255).astype('uint8'),1)
    stats={"method":MODEL_VERSION,"acquisition_date":acquisition_date,"candidate_polygon_count":len(polys),
           "candidate_area_ha":round(sum(x['properties']['area_ha'] for x in polys),3),
           "valid_pixels":int(valid.sum()),"leaflet_bounds":bounds,"image":Path(image).name,
           "ndvi_median":ndvi_median,
           "model_score_threshold":threshold,"model_score_not_calibrated":True,
           "coffee_validated":False,"limitations":"MapBiomas 30m para rótulos fracos; sem verificação de campo; áreas candidatas, não cafezais confirmados.",
           "created_at":datetime.now(timezone.utc).isoformat()}
    stats.update(schema_version=2, visualizations=visualizations, quality=quality,
                 provenance=processing_provenance(Path(image), Path(scl) if scl else None, Path(model_path), source,
                     MODEL_VERSION, {'threshold':float(threshold), 'min_area_ha':float(min_area_ha), 'coherence':bool(coherence)},
                     acquisition_date, date_source))
    (output/'resultado.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2), encoding='utf-8')
    return stats
