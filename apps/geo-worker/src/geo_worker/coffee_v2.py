"""Compatibility v2 imports/CLI; service inference is geo_worker.pipeline.classification."""
import argparse
import json
from pathlib import Path

from geo_worker.pipeline.classification import CLASS_NAMES, MODEL_VERSION, classify, predict_scores as _predict_scores
from geo_worker.pipeline.features import BANDS, EXTRA_BANDS, MAX_PIXELS, read_features, normalized_difference as ndiff, masked_local_stats as _masked_stats
from geo_worker.research.training import MAP_CLASSES, native_weak_samples, samples_for_scenes, metrics, train, _forest_fpr, _new_model


def main():
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


if __name__ == "__main__":
    main()
