"""Experimentos com limiares. Referência serve apenas a diagnóstico, NÃO truth."""
from pathlib import Path
import json
from geo_worker.pipeline.classification import classify
from geo_worker.evaluate_reference import evaluate

root=Path(__file__).resolve().parents[1]
names=['august','october']
scenes=[('data/sample/imagem_multiespectral.tif','data/sample/qualidade_scl.tif','2025-08-16'),
        ('data/unseen/imagem_adicional_multiespectral.tif','data/unseen/qualidade_adicional_scl.tif','2025-10-25')]
outs={}
for name, (path,scl,date) in zip(names,scenes):
  for cutoff in (0.45,0.5,0.55,0.6,0.65):
    directory=root/'experiments'/'evaluation'/'experiments_v2'/f'{name}_{cutoff}'
    stats=classify(root/path,directory,root/'apps/geo-worker/models/v2/coffee_rf.joblib',root/scl,acquisition_date=date,threshold=cutoff)
    outs[f'{name}_{cutoff}']={"stats":stats}
    result=evaluate(root/path,root/'data/reference/mapbiomas_2025_recorte_30m.tif',
          {'v2':directory/'candidatos.geojson'},root/'experiments'/'evaluation'/'experiments_v2'/'comparison_tmp')
    outs[f'{name}_{cutoff}']['reference']=result['comparisons']['v2']
for k,v in outs.items():
 print(k,'area',v['stats']['candidate_area_ha'],'coffee',v['reference']['candidate_overlap_reference_coffee_ha'],'forest',v['reference']['candidate_overlap_reference_forest_ha'])
(root/'experiments'/'evaluation'/'experiments_v2'/'ablation.json').write_text(json.dumps(outs,indent=2,ensure_ascii=False))
