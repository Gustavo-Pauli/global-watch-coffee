"""Spatially separated, reference-gated classification for the research pilot.

Labels must come from an explicit visual interpretation. This module never
derives reference labels from a map, spectral rule, or model prediction.
Scores are agreement with the stated interpretation, not field accuracy.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import ExitStack
from datetime import datetime, timezone
import json
from pathlib import Path

import joblib
import numpy as np
import rasterio
from rasterio.windows import Window
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

from research.land_change.common import DEFAULT_OUTPUT, file_hash, write_json


CLASSES = {1: 'forest', 2: 'pasture', 3: 'cropland', 4: 'exposed_soil', 5: 'water'}
SPLITS = {'train', 'validation', 'test', 'transfer_test'}
REFERENCES = {'ai_visual_interpretation', 'expert_visual_interpretation', 'human_visual_interpretation'}
SUPPORT_M = 160
MIN_CLEAR = 0.90
MIN_INDEPENDENT = 10
MIN_EVALUATION_BY_SPLIT = {'validation': 5, 'test': 5, 'transfer_test': 10}
SUPPORT_POLICY = 'preannotation-amendment-20261102-v2'
SEED = 20261102
CUTOFF = '2026-11-02T23:59:59Z'
FEATURE_NAMES = [f'{band}_{stat}' for stat in ('mean', 'std')
                 for band in ('blue', 'green', 'red', 'nir', 'swir1', 'swir2')]
FEATURE_NAMES += [f'{index}_{stat}' for index in ('ndvi', 'nbr', 'ndmi')
                  for stat in ('mean', 'std')]


def as_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def validate_samples(samples: list[dict], cutoff_utc: str = CUTOFF) -> None:
    """Reject duplicate, overlapping and cross-split geographic supports."""
    identifiers, block_splits, by_region = set(), {}, defaultdict(list)
    cutoff = as_utc(cutoff_utc)
    transfer_regions = {sample['region'] for sample in samples if sample.get('split') == 'transfer_test'}
    for sample in samples:
        identifier = sample.get('id')
        if not identifier or identifier in identifiers:
            raise ValueError('Sample IDs must be present and unique.')
        identifiers.add(identifier)
        split, region = sample.get('split'), sample.get('region')
        if split not in SPLITS or not region or not sample.get('block'):
            raise ValueError('Every sample requires region, geographic block and a declared split.')
        if region in transfer_regions and split != 'transfer_test':
            raise ValueError('A geographic transfer region cannot also supply fitting or development samples.')
        if sample.get('label_support_m') != SUPPORT_M:
            raise ValueError('All reference and feature supports must be exactly 160 m.')
        row, col = sample.get('row'), sample.get('col')
        if (not isinstance(row, int) or isinstance(row, bool) or row < 0
                or not isinstance(col, int) or isinstance(col, bool) or col < 0):
            raise ValueError('Sample centers require nonnegative integer row and col.')
        date = sample.get('target_date')
        if date and as_utc(date) > cutoff:
            raise ValueError('Target observation is later than the frozen study cutoff.')
        label = sample.get('label')
        if label is not None and (isinstance(label, bool) or label not in CLASSES):
            raise ValueError('Unknown class code in explicit interpretation.')
        if label is not None and (not date or not sample.get('target_scene_id')):
            raise ValueError('A labeled sample requires its target date and scene ID.')
        block = (region, sample['block'])
        if block in block_splits and block_splits[block] != split:
            raise ValueError('The same geographic block occurs in multiple splits.')
        block_splits[block] = split
        # The pilot has 10 m pixels. Sixteen pixels correspond to its frozen
        # 160 m support. Edge-touching supports are allowed; overlapping ones
        # would inflate the number of independent examples, even within a split.
        for other in by_region[region]:
            if abs(row - other['row']) < 16 and abs(col - other['col']) < 16:
                raise ValueError('Duplicate or overlapping geographic support.')
        by_region[region].append(sample)


def support_features(bands: np.ndarray, scl: np.ndarray,
                     masks: np.ndarray | None = None) -> tuple[np.ndarray, dict]:
    """Derive means/stds only from clear, finite pixels of a 16x16 support."""
    if bands.shape != (6, 16, 16) or scl.shape != (16, 16):
        raise ValueError('Feature support must contain six bands and exactly 16x16 pixels.')
    valid = np.isfinite(bands).all(axis=0) & np.isin(scl, (4, 5, 6))
    if masks is not None:
        if masks.shape != bands.shape:
            raise ValueError('Raster masks must match all six bands.')
        valid &= (masks != 0).all(axis=0)
    valid &= (np.abs(bands) <= 2).all(axis=0)
    clear_fraction = float(valid.mean())
    diagnostic = {'clear_fraction': clear_fraction, 'clear_pixel_count': int(valid.sum()),
                  'support_pixel_count': 256, 'label_support_m': SUPPORT_M}
    if clear_fraction < MIN_CLEAR:
        return np.full(len(FEATURE_NAMES), np.nan, dtype=np.float32), {
            **diagnostic, 'status': 'insufficient_clear_support'}
    values = bands[:, valid].astype(np.float64)
    output = [*values.mean(axis=1), *values.std(axis=1)]
    for first, second in ((3, 2), (3, 5), (3, 4)):
        denominator = values[first] + values[second]
        defined = np.abs(denominator) > 1e-6
        if defined.sum() < MIN_CLEAR * 256:
            return np.full(len(FEATURE_NAMES), np.nan, dtype=np.float32), {
                **diagnostic, 'status': 'insufficient_defined_index_support'}
        index = (values[first, defined] - values[second, defined]) / denominator[defined]
        output.extend((float(index.mean()), float(index.std())))
    return np.asarray(output, dtype=np.float32), {**diagnostic, 'status': 'ready'}


def extract_features(manifest: dict, samples: list[dict]) -> tuple[np.ndarray, list[dict]]:
    """Read only the observation/date explicitly named by each annotation."""
    cutoff = manifest.get('cutoff_utc', CUTOFF)
    validate_samples(samples, cutoff)
    regions = {region['id']: region for region in manifest['regions']}
    scenes = {(region['id'], scene['id']): scene for region in manifest['regions']
              for scene in region['scenes']}
    features = np.full((len(samples), len(FEATURE_NAMES)), np.nan, dtype=np.float32)
    diagnostics = []
    with ExitStack() as stack:
        opened = {}
        for position, sample in enumerate(samples):
            key = (sample['region'], sample.get('target_scene_id'))
            scene = scenes.get(key)
            if scene is None:
                if sample.get('label') is not None:
                    raise ValueError('Labeled sample target scene is absent from this frozen manifest.')
                diagnostics.append({'id': sample['id'], 'status': 'missing_target_scene'})
                continue
            if as_utc(scene['date']) > as_utc(cutoff):
                raise ValueError('Manifest target scene lies beyond the frozen study cutoff.')
            if sample.get('target_date') and as_utc(sample['target_date']) != as_utc(scene['date']):
                raise ValueError('Annotation target date does not match its scene.')
            if regions[sample['region']].get('role') == 'geographic_holdout' and sample['split'] != 'transfer_test':
                raise ValueError('Manifest geographic holdout cannot be used for fitting.')
            if key not in opened:
                image = stack.enter_context(rasterio.open(scene['image']))
                quality = stack.enter_context(rasterio.open(scene['scl']))
                if (image.count != 6 or any(dtype not in ('float32', 'float64') for dtype in image.dtypes)
                        or image.crs is None or image.crs != quality.crs
                        or image.transform != quality.transform or image.shape != quality.shape
                        or quality.count != 1 or image.transform.a != 10 or image.transform.e != -10
                        or image.transform.b != 0 or image.transform.d != 0
                        or not image.crs.is_projected
                        or any(scale != 1 for scale in image.scales)
                        or any(offset != 0 for offset in image.offsets)):
                    raise ValueError('Expected aligned six-band physical reflectance and SCL on a 10 m grid.')
                opened[key] = image, quality
            image, quality = opened[key]
            row, col = sample['row'], sample['col']
            if row < 8 or col < 8 or row + 8 > image.height or col + 8 > image.width:
                diagnostics.append({'id': sample['id'], 'status': 'support_outside_scene'})
                continue
            window = Window(col - 8, row - 8, 16, 16)
            vector, diagnostic = support_features(image.read(window=window), quality.read(1, window=window),
                                                  image.read_masks(window=window))
            features[position] = vector
            diagnostics.append({'id': sample['id'], 'scene_id': scene['id'], 'target_date': scene['date'],
                                **diagnostic})
    return features, diagnostics


def extract_embedding_features(manifest: dict, samples: list[dict],
                               embedding_root: Path) -> tuple[np.ndarray, list[dict]]:
    """Match the exact labeled 160 m support to an existing native token.

    There is deliberately no nearest-token lookup or upsampling. The extractor
    uses the same image/SCL hashes, target observation and cutoff as spectral
    features. The probe's date is resolved through its exact hashed source
    scene in the manifest because older probe reports do not store a date.
    Tokens carry their full inference-window context; this is not pixel-level
    segmentation or an observation independent from adjacent tokens.
    """
    validate_samples(samples, manifest.get('cutoff_utc', CUTOFF))
    scenes = {(region['id'], scene['id']): scene for region in manifest['regions']
              for scene in region['scenes']}
    regions = {region['id']: region for region in manifest['regions']}
    cache, dimensions, model_identity = {}, None, None
    vectors, diagnostics = [], []
    for sample in samples:
        if sample['row'] % 16 != 8 or sample['col'] % 16 != 8:
            raise ValueError('Sample support is shifted from the native 16-pixel embedding grid; do not snap or approximate it.')
        region_id = sample['region']
        if Path(region_id).name != region_id or region_id in ('.', '..'):
            raise ValueError('Region must be a simple path component.')
        scene = scenes.get((region_id, sample.get('target_scene_id')))
        if scene is None:
            raise ValueError('Embedding target scene is absent from the frozen manifest.')
        if not sample.get('target_date') or as_utc(sample['target_date']) != as_utc(scene['date']):
            raise ValueError('Embedding annotation target date does not match its scene.')
        if as_utc(scene['date']) > as_utc(manifest.get('cutoff_utc', CUTOFF)):
            raise ValueError('Embedding target lies beyond the frozen study cutoff.')
        if regions[region_id].get('role') == 'geographic_holdout' and sample['split'] != 'transfer_test':
            raise ValueError('Manifest geographic holdout cannot supply fitting samples.')
        if region_id not in cache:
            directory = embedding_root / f'{region_id}_review_target'
            probe = json.loads((directory / 'probe.json').read_text(encoding='utf-8'))
            if (Path(probe['input']).resolve() != Path(scene['image']).resolve()
                    or Path(probe['scl']).resolve() != Path(scene['scl']).resolve()):
                raise ValueError('Embedding probe source paths do not match the annotation target scene.')
            if (probe.get('input_sha256') != file_hash(Path(scene['image']))
                    or probe.get('scl_sha256') != file_hash(Path(scene['scl']))):
                raise ValueError('Embedding probe source hash mismatch.')
            probe_date = probe.get('source_date') or probe.get('acquisition_date')
            if probe_date and as_utc(probe_date) != as_utc(scene['date']):
                raise ValueError('Embedding probe date mismatch.')
            region = regions[region_id]
            if (probe.get('source_shape') != [region['height'], region['width']]
                    or probe.get('source_crs') != region['crs']
                    or list(probe.get('source_transform', [])) != list(region['transform'])[:6]
                    or probe.get('source_resolution') != [10.0, 10.0]
                    or probe.get('feature_spacing_source_pixels') != 16
                    or probe.get('feature_spacing_crs_units') != [160.0, 160.0]
                    or probe.get('minimum_clear_patch_fraction', 0) < MIN_CLEAR):
                raise ValueError('Embedding native grid, support or clear-coverage policy differs from the reference.')
            identity = (probe.get('model_id'), probe.get('model_checkpoint_sha256'))
            if not all(identity):
                raise ValueError('Embedding model identity and checkpoint hash are required.')
            if model_identity is not None and identity != model_identity:
                raise ValueError('Regions use different embedding models or checkpoints.')
            model_identity = identity
            with np.load(directory / 'features.npz', allow_pickle=False) as archive:
                features = archive['features']
                clear = archive['clear_fraction']
                windows = archive['windows']
            if (features.ndim != 4 or clear.shape != features.shape[:3]
                    or windows.shape != (len(features), 4)
                    or features.shape[1] * 16 != probe.get('tile_size_pixels')
                    or features.shape[2] * 16 != probe.get('tile_size_pixels')
                    or list(features.shape) != probe.get('feature_shape')):
                raise ValueError('Embedding arrays do not match the declared native tile layout.')
            if dimensions is not None and features.shape[-1] != dimensions:
                raise ValueError('Embedding feature dimensions differ between regions.')
            dimensions = features.shape[-1]
            cache[region_id] = probe, features, clear, windows
        probe, features, clear, windows = cache[region_id]
        if Path(probe['input']).resolve() != Path(scene['image']).resolve():
            raise ValueError('One regional probe cannot represent a different target observation.')
        left, top = sample['col'] - 8, sample['row'] - 8
        matching = [index for index, (x, y, width, height) in enumerate(windows)
                    if x <= left and y <= top and left + 16 <= x + width and top + 16 <= y + height]
        diagnostic = {'id': sample['id'], 'scene_id': scene['id'], 'target_date': scene['date'],
                      'label_support_m': SUPPORT_M, 'feature_support_m': SUPPORT_M,
                      'model_id': probe['model_id'], 'model_checkpoint_sha256': probe['model_checkpoint_sha256'],
                      'target_date_validation': 'Exact source path and SHA256 resolved to target scene date in frozen manifest.',
                      'context_note': 'Token includes attention to the full inference tile.'}
        vector = np.full(dimensions, np.nan, dtype=np.float32)
        if len(matching) > 1:
            raise ValueError('Multiple inference windows represent the same support; ambiguous embedding source.')
        if not matching:
            diagnostic['status'] = 'outside_embedding_extent'
        else:
            tile = matching[0]
            x, y, _, _ = windows[tile]
            if (left - x) % 16 or (top - y) % 16:
                raise ValueError('Inference window origin shifts the native token support.')
            row, col = (top - y) // 16, (left - x) // 16
            clear_fraction = float(clear[tile, row, col])
            diagnostic.update(clear_fraction=clear_fraction, tile_index=tile,
                              token_row=int(row), token_col=int(col))
            if not np.isfinite(clear_fraction) or clear_fraction < MIN_CLEAR:
                diagnostic['status'] = 'insufficient_clear_support'
            elif not np.isfinite(features[tile, row, col]).all():
                diagnostic['status'] = 'unavailable_embedding'
            else:
                vector = features[tile, row, col].astype(np.float32)
                diagnostic['status'] = 'ready'
        vectors.append(vector)
        diagnostics.append(diagnostic)
    return np.asarray(vectors, dtype=np.float32).reshape(len(samples), dimensions or 0), diagnostics


def reference_rejection(sample: dict) -> str | None:
    if sample.get('label') is None:
        return 'unlabeled'
    if sample.get('reference_kind') not in REFERENCES:
        return 'unsupported_reference_kind'
    if sample.get('certainty') != 'high':
        return 'uncertain_interpretation'
    if not str(sample.get('reviewer') or '').strip():
        return 'missing_reviewer'
    return None


def independent_counts(samples: list[dict], indices: list[int]) -> dict[str, int]:
    return {str(code): len({(samples[index]['region'], samples[index]['block'])
                           for index in indices if samples[index]['label'] == code})
            for code in CLASSES}


def agreement_name(samples: list[dict], indices: list[int]) -> str:
    kinds = {samples[index]['reference_kind'] for index in indices}
    if kinds == {'ai_visual_interpretation'}:
        return 'agreement_with_AI_visual_interpretation'
    if kinds == {'expert_visual_interpretation'}:
        return 'agreement_with_expert_visual_interpretation'
    if kinds == {'human_visual_interpretation'}:
        return 'agreement_with_human_visual_interpretation'
    return 'agreement_with_mixed_visual_interpretation'


def classify_feature_matrix(features: np.ndarray, samples: list[dict], *,
                            cutoff_utc: str = CUTOFF) -> tuple[dict, RandomForestClassifier | None]:
    """Fit fixed RF only when all five classes have independent visual support.

    Returns a JSON-safe report and the fitted model (or None). The caller may
    supply another feature matrix, e.g. frozen encoder features, but it must
    describe the SAME 160 m support and target observations as these samples.
    NaNs mark unavailable feature support and are excluded, never imputed into
    evidence. Validation/test/transfer data never enter model fitting.
    """
    validate_samples(samples, cutoff_utc)
    features = np.asarray(features)
    if features.ndim != 2 or len(features) != len(samples) or features.shape[1] == 0:
        raise ValueError('Feature matrix requires one nonempty row per declared sample.')
    eligible, rejections = [], Counter()
    eligibility = []
    for index, sample in enumerate(samples):
        rejection = reference_rejection(sample)
        if rejection is None and not np.isfinite(features[index]).all():
            rejection = 'unavailable_features'
        if rejection is None:
            eligible.append(index)
        else:
            rejections[rejection] += 1
        eligibility.append({'id': sample['id'], 'eligible': rejection is None, 'reason': rejection})
    split_indices = {split: [i for i in eligible if samples[i]['split'] == split]
                     for split in ('train', 'validation', 'test', 'transfer_test')}
    counts = {split: independent_counts(samples, indices) for split, indices in split_indices.items()}
    human = sum(samples[index]['reference_kind'] == 'expert_visual_interpretation' for index in eligible)
    report = {
        'status': 'insufficient_training_reference',
        'classes': {str(code): name for code, name in CLASSES.items()},
        'sample_count': len(samples), 'eligible_sample_count': len(eligible),
        'sampling_frame_counts_by_split': {split: sum(sample['split'] == split for sample in samples)
                                           for split in ('train', 'validation', 'test', 'transfer_test')},
        'reference_rejections': dict(rejections), 'eligibility': eligibility,
        'independent_counts_by_split': counts,
        'min_independent_per_class_by_split': {'train': MIN_INDEPENDENT, **MIN_EVALUATION_BY_SPLIT},
        'support_policy_version': SUPPORT_POLICY,
        'support_policy_basis': 'Frozen unlabeled sampling frame has 94 train, 27 validation, 29 test, 150 transfer samples; local five-class evaluation needs at least 25 supports.',
        'confidence_intervals': None, 'population_accuracy_estimated': False,
        'reference_policy': 'Explicit high-certainty visual annotations only; never source or model pseudolabels.',
        'human_expert_reference_count': int(human),
        'field_validated': False, 'independent_field_accuracy': None,
        'mapbiomas_superiority_established': False,
        'support_m': SUPPORT_M, 'feature_dimensions': int(features.shape[1]),
        'model_parameters': {'n_estimators': 200, 'min_samples_leaf': 3,
                             'class_weight': 'balanced', 'random_state': SEED, 'n_jobs': 2},
        'training_split': 'train', 'threshold_tuning': False,
        'evaluations': {}, 'predictions': [],
    }
    missing = {code: MIN_INDEPENDENT - count for code, count in counts['train'].items()
               if count < MIN_INDEPENDENT}
    report['missing_training_support'] = missing
    if missing:
        report['reason'] = 'No model fitted: fewer than ten independent high-certainty training blocks for one or more classes.'
        return report, None
    train = split_indices['train']
    model = RandomForestClassifier(**report['model_parameters'])
    model.fit(features[train], np.asarray([samples[index]['label'] for index in train]))
    report['status'] = 'trained_with_visual_reference'
    for split in ('validation', 'test', 'transfer_test'):
        indices = split_indices[split]
        counts_for_split = counts[split]
        minimum_evaluation = MIN_EVALUATION_BY_SPLIT[split]
        evaluated = {'status': 'insufficient_evaluation_reference',
                     'reference_type': agreement_name(samples, indices) if indices else None,
                     'sample_count': len(indices), 'independent_counts': counts_for_split,
                     'min_independent_per_class': minimum_evaluation,
                     'overall_agreement': None, 'macro_f1': None, 'per_class': {}}
        if not indices:
            report['evaluations'][split] = evaluated
            continue
        actual = np.asarray([samples[index]['label'] for index in indices])
        predicted = model.predict(features[indices])
        precision, recall, f1, support = precision_recall_fscore_support(
            actual, predicted, labels=list(CLASSES), zero_division=0)
        evaluated['confusion_matrix_class_order'] = list(CLASSES)
        evaluated['confusion_matrix_counts'] = confusion_matrix(actual, predicted, labels=list(CLASSES)).tolist()
        for position, code in enumerate(CLASSES):
            sufficient = counts_for_split[str(code)] >= minimum_evaluation
            evaluated['per_class'][str(code)] = {
                'name': CLASSES[code], 'status': 'supported_in_pilot' if sufficient else 'inconclusive',
                'sample_count': int(support[position]),
                'independent_count': counts_for_split[str(code)],
                'precision': float(precision[position]) if sufficient else None,
                'recall': float(recall[position]) if sufficient else None,
                'f1': float(f1[position]) if sufficient else None,
            }
        if all(count >= minimum_evaluation for count in counts_for_split.values()):
            evaluated.update(status='five_class_agreement_evaluated',
                             overall_agreement=float(np.mean(actual == predicted)),
                             macro_f1=float(np.mean(f1)))
        for index, prediction in zip(indices, predicted):
            report['predictions'].append({'id': samples[index]['id'], 'split': split,
                                           'reference_label': samples[index]['label'],
                                           'predicted_label': int(prediction),
                                           'reference_kind': samples[index]['reference_kind']})
        report['evaluations'][split] = evaluated
    report['limitations'] = [
        'Visual agreement is not independent field accuracy.',
        'Distinct 1 km blocks do not establish statistical independence; TerraMind tokens can share a 2.24 km attention window. Geographic transfer is evaluated separately.',
        'AI-interpreted reference is reported as AI agreement, never as expert or field validation.',
        'Small geographic pilot; no claim of national transfer or superiority to MapBiomas.',
        'Means describe a 160 m support; no native 10 m segmentation is produced by this classifier.',
        'Local validation/test scores need five independent blocks per class; transfer scores need ten. These are exploratory support gates, not population accuracy guarantees.',
        'No confidence intervals or population accuracy are estimated in this small pilot.',
    ]
    return report, model


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=DEFAULT_OUTPUT / 'manifest.json')
    parser.add_argument('--labels', type=Path, default=DEFAULT_OUTPUT / 'review/blind_samples.json')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT / 'classification')
    parser.add_argument('--embedding-root', type=Path,
                        help='Use existing {region}_review_target/features.npz and probe.json for the same references.')
    args = parser.parse_args()
    manifest_hash = file_hash(args.manifest)
    labels_hash = file_hash(args.labels)
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    labels = json.loads(args.labels.read_text(encoding='utf-8'))
    if labels.get('study_id') != manifest['study_id']:
        raise ValueError('Annotations and image manifest belong to different studies.')
    if labels.get('manifest_sha256') != manifest_hash:
        raise ValueError('Annotation manifest hash does not match the frozen image manifest.')
    if labels.get('model_predictions_shown') is not False:
        raise ValueError('The annotation file must explicitly record model_predictions_shown=false.')
    samples = labels['samples']
    features, diagnostics = extract_features(manifest, samples)
    report, model = classify_feature_matrix(features, samples, cutoff_utc=manifest.get('cutoff_utc', CUTOFF))
    if file_hash(args.manifest) != manifest_hash or file_hash(args.labels) != labels_hash:
        raise ValueError('Input annotations or manifest changed during evaluation; run again against frozen inputs.')
    report.update(study_id=manifest['study_id'], method='spectral_support_random_forest',
                  feature_names=FEATURE_NAMES, feature_observation_policy='Target scene only; no future or temporal composites.',
                  manifest_sha256=manifest_hash, labels_sha256=labels_hash,
                  model_file='spectral_rf.joblib' if model is not None else None)
    args.output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.output / 'spectral_features.npz', features=features,
                        sample_ids=np.asarray([sample['id'] for sample in samples]))
    write_json(args.output / 'feature_quality.json', {'samples': diagnostics})
    write_json(args.output / 'metrics.json', report)
    if model is not None:
        joblib.dump({'model': model, 'feature_names': FEATURE_NAMES, 'support_m': SUPPORT_M,
                     'manifest_sha256': report['manifest_sha256'],
                     'labels_sha256': report['labels_sha256']}, args.output / 'spectral_rf.joblib')
    else:
        # A prior successful run must not leave an apparently current model
        # beside a newly insufficient-reference report.
        (args.output / 'spectral_rf.joblib').unlink(missing_ok=True)
    embedding_status = None
    if args.embedding_root is not None:
        embeddings, embedding_diagnostics = extract_embedding_features(manifest, samples, args.embedding_root)
        embedding_report, embedding_model = classify_feature_matrix(
            embeddings, samples, cutoff_utc=manifest.get('cutoff_utc', CUTOFF))
        if file_hash(args.manifest) != manifest_hash or file_hash(args.labels) != labels_hash:
            raise ValueError('Input annotations or manifest changed during embedding evaluation.')
        embedding_report.update(
            study_id=manifest['study_id'], method='terramind_frozen_encoder_random_forest',
            manifest_sha256=manifest_hash, labels_sha256=labels_hash,
            feature_support_m=SUPPORT_M, native_feature_spacing_pixels=16,
            spatial_context='Tokens include the full inference tile; these are not native 10 m predictions.',
            model_file='embedding_rf.joblib' if embedding_model is not None else None)
        np.savez_compressed(args.output / 'embedding_features.npz', features=embeddings,
                            sample_ids=np.asarray([sample['id'] for sample in samples]))
        write_json(args.output / 'embedding_feature_quality.json', {'samples': embedding_diagnostics})
        write_json(args.output / 'embedding_metrics.json', embedding_report)
        if embedding_model is not None:
            joblib.dump({'model': embedding_model, 'support_m': SUPPORT_M,
                         'manifest_sha256': manifest_hash, 'labels_sha256': labels_hash},
                        args.output / 'embedding_rf.joblib')
        else:
            (args.output / 'embedding_rf.joblib').unlink(missing_ok=True)
        embedding_status = embedding_report['status']
    print(json.dumps({'status': report['status'], 'eligible': report['eligible_sample_count'],
                      'missing_training_support': report['missing_training_support'],
                      'embedding_status': embedding_status,
                      'output': str(args.output.resolve())}))


if __name__ == '__main__':
    main()
