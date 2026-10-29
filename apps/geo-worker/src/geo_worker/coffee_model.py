"""Classificador exploratório de café com supervisão fraca do MapBiomas.

Treinamento: duas cenas Sentinel-2 + MapBiomas 2025, classe 46. Os rótulos
são um mapa independente publicado, mas NÃO uma validação de campo.
Os preditores são derivados das bandas do GeoTIFF enviado, não da identidade
do arquivo ou de resultados pré-calculados.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import Resampling, reproject, transform_geom
from scipy import ndimage
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import precision_recall_fscore_support
from sklearn.model_selection import GroupShuffleSplit

from geo_worker.processing import (
    _draw_candidate_outlines,
    _load_scl,
    _normalized_difference,
    _polygons,
    _save_leaflet_raster,
    _visualize_rgb,
)


FEATURE_NAMES = [
    "blue", "green", "red", "nir", "ndvi", "gndvi", "evi2",
    "ndvi_mean5", "ndvi_std5", "nir_mean5", "nir_std5",
    "nir_red_ratio",
]
LABEL_COFFEE = 46
MAX_SAMPLES_PER_NEGATIVE_CLASS = 2500
MAX_SAMPLES_COFFEE = 6000
PREDICTION_CUTOFF = 0.60


def scene_features(image_path: Path, scl_path: Path | None = None):
    with rasterio.open(image_path) as src:
        if src.driver != "GTiff" or src.count != 4 or src.crs is None:
            raise ValueError("Imagem deve ser GeoTIFF com B02, B03, B04, B08 e CRS.")
        if src.width * src.height > 16_000_000:
            raise ValueError("Imagem excede o limite de 16 milhões de pixels.")
        digital = src.read().astype(np.float32)
        valid = np.isfinite(digital).all(axis=0)
        if src.nodata is not None:
            valid &= (digital != src.nodata).all(axis=0)
        scales = np.asarray(src.scales, dtype=np.float32)[:, None, None]
        offsets = np.asarray(src.offsets, dtype=np.float32)[:, None, None]
        reflectance = digital * scales + offsets
        blue, green, red, nir = reflectance
        ndvi = _normalized_difference(nir, red)
        gndvi = _normalized_difference(nir, green)
        evi2 = np.zeros_like(ndvi)
        denominator = nir + 2.4 * red + 1
        np.divide(2.5 * (nir - red), denominator, out=evi2, where=np.abs(denominator) > 1e-6)
        ndvi_mean = ndimage.uniform_filter(ndvi, size=5, mode="nearest")
        nir_mean = ndimage.uniform_filter(nir, size=5, mode="nearest")
        ndvi_std = np.sqrt(np.maximum(0, ndimage.uniform_filter(ndvi * ndvi, size=5) - ndvi_mean**2))
        nir_std = np.sqrt(np.maximum(0, ndimage.uniform_filter(nir * nir, size=5) - nir_mean**2))
        ratio = np.divide(nir, red + 1e-3)
        features = np.stack(
            [blue, green, red, nir, ndvi, gndvi, evi2, ndvi_mean, ndvi_std, nir_mean, nir_std, ratio],
            axis=-1,
        ).astype(np.float32)
        features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
        if scl_path:
            scl = _load_scl(scl_path, src)
            valid &= np.isin(scl, (4, 5))  # áreas claras; nuvens/sombras ficam excluídas
        return features, valid, reflectance, (src.transform, src.crs)


def aligned_reference(reference_path: Path, target_path: Path) -> np.ndarray:
    with rasterio.open(reference_path) as ref, rasterio.open(target_path) as target:
        if ref.crs is None or target.crs is None:
            raise ValueError("Referência e imagem precisam ter CRS.")
        labels = np.zeros(target.shape, dtype=np.uint8)
        reproject(
            ref.read(1), labels,
            src_transform=ref.transform, src_crs=ref.crs,
            dst_transform=target.transform, dst_crs=target.crs,
            src_nodata=ref.nodata, dst_nodata=0,
            resampling=Resampling.nearest,
        )
        return labels


def _sample_balanced(features, valid, labels, groups, allowed_indices, rng):
    chosen = []
    flat_labels = labels.ravel()
    eligible = valid.ravel() & (flat_labels != 0)
    for label in np.unique(flat_labels[eligible]):
        positions = np.flatnonzero(eligible & (flat_labels == label))
        positions = positions[np.isin(groups[positions], allowed_indices)]
        cap = MAX_SAMPLES_COFFEE if label == LABEL_COFFEE else MAX_SAMPLES_PER_NEGATIVE_CLASS
        if len(positions) > cap:
            positions = rng.choice(positions, size=cap, replace=False)
        chosen.append(positions)
    if not chosen:
        return np.empty((0, features.shape[-1]), dtype=np.float32), np.empty(0, dtype=bool)
    indices = np.concatenate(chosen)
    return features.reshape(-1, features.shape[-1])[indices], flat_labels[indices] == LABEL_COFFEE


def train(
    primary_image: Path,
    secondary_image: Path,
    reference_path: Path,
    primary_scl: Path,
    secondary_scl: Path,
    model_path: Path,
):
    first, first_valid, _, _ = scene_features(primary_image, primary_scl)
    second, second_valid, _, _ = scene_features(secondary_image, secondary_scl)
    if first.shape != second.shape:
        raise ValueError("As duas cenas de treinamento devem ter a mesma forma.")
    with rasterio.open(primary_image) as a, rasterio.open(secondary_image) as b:
        if a.crs != b.crs or a.transform != b.transform:
            raise ValueError("As cenas precisam estar na mesma grade geográfica.")
    labels = aligned_reference(reference_path, primary_image)
    if (labels == LABEL_COFFEE).sum() == 0:
        raise ValueError("A região não possui pixels rotulados como café na referência.")

    # Divisão por blocos espaciais de ~640m, evitando que pixels vizinhos das
    # mesmas áreas caiam simultaneamente em treino e validação.
    height, width = labels.shape
    y, x = np.indices((height, width))
    groups = ((y // 64) * ((width + 63) // 64) + x // 64).ravel()
    labels_flat = labels.ravel()
    splitter = GroupShuffleSplit(n_splits=30, test_size=0.25, random_state=29)
    selected = None
    for train_indices, test_indices in splitter.split(groups, groups=groups):
        tr, te = np.unique(groups[train_indices]), np.unique(groups[test_indices])
        if ((labels_flat == LABEL_COFFEE) & np.isin(groups, tr)).sum() >= 100 and (
            (labels_flat == LABEL_COFFEE) & np.isin(groups, te)
        ).sum() >= 100:
            selected = tr, te
            break
    if selected is None:
        raise ValueError("Não foi possível criar divisão espacial com café em treino e validação.")
    tr, te = selected
    rng = np.random.default_rng(2026)
    train_sets, test_sets = [], []
    for features, valid in ((first, first_valid), (second, second_valid)):
        train_sets.append(_sample_balanced(features, valid, labels, groups, tr, rng))
        test_sets.append(_sample_balanced(features, valid, labels, groups, te, rng))
    xtrain = np.concatenate([item[0] for item in train_sets])
    ytrain = np.concatenate([item[1] for item in train_sets])
    xtest = np.concatenate([item[0] for item in test_sets])
    ytest = np.concatenate([item[1] for item in test_sets])

    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=13,
        min_samples_leaf=12,
        max_features="sqrt",
        class_weight="balanced_subsample",
        random_state=2026,
        n_jobs=-1,
    )
    model.fit(xtrain, ytrain)
    pred = model.predict_proba(xtest)[:, 1] >= PREDICTION_CUTOFF
    precision, recall, f1, _ = precision_recall_fscore_support(
        ytest, pred, average="binary", zero_division=0
    )
    report = {
        "type": "spatial_holdout_agreement_with_mapbiomas_labels",
        "explicit_warning": "NÃO é acurácia de detecção de café em campo.",
        "reference": "MapBiomas Brasil Coleção 11, mapa anual 2025, classe 46 (café), 30 m",
        "training_images": [str(primary_image), str(secondary_image)],
        "training_pixels": len(ytrain),
        "reference_coffee_training_pixels": int(ytrain.sum()),
        "reference_holdout_pixels": len(ytest),
        "reference_coffee_holdout_pixels": int(ytest.sum()),
        "reference_agreement_precision": round(float(precision), 4),
        "reference_agreement_recall": round(float(recall), 4),
        "reference_agreement_f1": round(float(f1), 4),
        "spatial_block_size_pixels": 64,
        "features": FEATURE_NAMES,
        "model": "RandomForest, 100 árvores, profundidade máxima 13, min_leaf 12",
        "not_ground_truth": True,
        "notes": "Rótulos 30 m reamostrados para 10 m; separação espacial por blocos. Duas datas da mesma área. Transferência para outras regiões não foi validada.",
    }
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"estimator": model, "features": FEATURE_NAMES, "training_report": report}, model_path)
    (model_path.parent / "treinamento.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return report


def _predicted_scores(model, features):
    flat = features.reshape(-1, features.shape[-1])
    scores = np.zeros(len(flat), dtype=np.float32)
    for offset in range(0, len(flat), 50_000):
        batch = flat[offset : offset + 50_000]
        scores[offset : offset + len(batch)] = model.predict_proba(batch)[:, 1]
    return scores.reshape(features.shape[:2])


def classify(
    image_path: Path,
    output_dir: Path,
    model_path: Path,
    scl_path: Path | None = None,
    secondary_image: Path | None = None,
    secondary_scl: Path | None = None,
    min_area_ha: float = 0.25,
    acquisition_date: str | None = None,
) -> dict:
    # Carregar artefato joblib SOMENTE de caminho confiável fixado no servidor.
    trained = joblib.load(model_path)
    if trained["features"] != FEATURE_NAMES:
        raise ValueError("As features do modelo não coincidem com o processamento.")
    features, valid, reflectance, geometry = scene_features(image_path, scl_path)
    scores = _predicted_scores(trained["estimator"], features)
    support = valid.astype(np.uint8)
    if secondary_image:
        additional, additional_valid, _, other_geometry = scene_features(secondary_image, secondary_scl)
        if additional.shape != features.shape or other_geometry != geometry:
            raise ValueError("Imagem de outra data deve ter a mesma grade e CRS.")
        secondary_scores = _predicted_scores(trained["estimator"], additional)
        scores = (scores * valid + secondary_scores * additional_valid) / np.maximum(
            1, valid.astype(np.uint8) + additional_valid.astype(np.uint8)
        )
        support = valid.astype(np.uint8) + additional_valid.astype(np.uint8)

    mask = (support > 0) & (scores >= PREDICTION_CUTOFF)
    mask = ndimage.binary_opening(mask, structure=np.ones((2, 2)))
    mask = ndimage.binary_closing(mask, structure=np.ones((2, 2)))

    output_dir.mkdir(parents=True, exist_ok=True)
    with rasterio.open(image_path) as src:
        features_geojson = _polygons(mask, src.transform, src.crs, min_area_ha)
        for item in features_geojson:
            item["properties"]["class"] = "cafe_candidato_supervisao_fraca"
            item["properties"]["method"] = "rf_mapbiomas_2025_reference"
        (output_dir / "candidatos.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": features_geojson}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        rgb = _visualize_rgb(reflectance)
        project_geoms = [transform_geom("EPSG:4326", src.crs, f["geometry"]) for f in features_geojson]
        classified = _draw_candidate_outlines(rgb, project_geoms, src.transform)
        classified.save(output_dir / "imagem_classificada.png")
        rgb.save(output_dir / "imagem_rgb.png")
        leaflet_bounds = _save_leaflet_raster(src, rgb, output_dir / "imagem_mapa.png")
    stats = {
        "method": "random_forest_weak_supervision_mapbiomas_2025",
        "image": image_path.name,
        "acquisition_date": acquisition_date,
        "secondary_image": secondary_image.name if secondary_image else None,
        "leaflet_bounds": leaflet_bounds,
        "candidate_polygon_count": len(features_geojson),
        "candidate_area_ha": round(sum(x["properties"]["area_ha"] for x in features_geojson), 3),
        "valid_pixels": int(valid.sum()),
        "model_source": trained["training_report"]["reference"],
        "is_coffee_detection_validated": False,
        "limitations": "Classificação exploratória supervisionada por mapa anual de 30 m do MapBiomas, sem campo. Acordo com a referência não prova presença real de café; pouco generalizável fora de Guaxupé.",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (output_dir / "resultado.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    training = actions.add_parser("train")
    training.add_argument("--primary", type=Path, default=Path("data/sample/imagem_multiespectral.tif"))
    training.add_argument("--secondary", type=Path, default=Path("data/additional/imagem_adicional_multiespectral.tif"))
    training.add_argument("--reference", type=Path, default=Path("data/reference/mapbiomas_2025_recorte_30m.tif"))
    training.add_argument("--scl", type=Path, default=Path("data/sample/qualidade_scl.tif"))
    training.add_argument("--secondary-scl", type=Path, default=Path("data/additional/qualidade_adicional_scl.tif"))
    training.add_argument("--model", type=Path, default=Path("apps/geo-worker/models/v1/coffee_rf.joblib"))

    classifier = actions.add_parser("classify")
    classifier.add_argument("image", type=Path)
    classifier.add_argument("--model", type=Path, default=Path("apps/geo-worker/models/v1/coffee_rf.joblib"))
    classifier.add_argument("--scl", type=Path)
    classifier.add_argument("--secondary", type=Path)
    classifier.add_argument("--secondary-scl", type=Path)
    classifier.add_argument("--date")
    classifier.add_argument("--output", type=Path, default=Path("experiments/outputs/model"))

    args = parser.parse_args()
    if args.action == "train":
        result = train(args.primary, args.secondary, args.reference, args.scl, args.secondary_scl, args.model)
    else:
        result = classify(args.image, args.output, args.model, args.scl, args.secondary, args.secondary_scl, acquisition_date=args.date)
    print(json.dumps(result, ensure_ascii=False, indent=2))
