import copy
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from research.land_change.classify import (
    CLASSES, FEATURE_NAMES, classify_feature_matrix, extract_embedding_features, extract_features,
    main as classify_main, support_features, validate_samples,
)
from sklearn.ensemble import RandomForestClassifier


def sample(index=0, *, split='train', region='development', label=None,
           reference_kind='ai_visual_interpretation'):
    return {'id': f'{region}_{split}_{index}', 'region': region,
            'row': 100 + index * 100, 'col': 100, 'block': str(index),
            'split': split, 'target_scene_id': 'target', 'target_date': '2026-10-01',
            'label_support_m': 160, 'label': label, 'certainty': 'high',
            'reviewer': 'blind_interpreter', 'reference_kind': reference_kind}


def complete_samples():
    result = []
    for split_index, split in enumerate(('train', 'validation', 'test', 'transfer_test')):
        region = 'holdout' if split == 'transfer_test' else 'development'
        for class_code in CLASSES:
            for position in range(10):
                index = split_index * 1000 + class_code * 20 + position
                result.append(sample(index, split=split, region=region, label=class_code))
    return result


def matrix(samples):
    return np.asarray([[float(item['label'] or 0), float(item['row'] % 7)]
                       for item in samples], dtype=np.float32)


def test_unreviewed_and_source_labels_never_fit_a_model():
    samples = [sample(0), sample(1, label=1, reference_kind='mapbiomas'),
               sample(2, label=1, reference_kind='model_prediction')]
    report, model = classify_feature_matrix(np.ones((3, 4)), samples)
    assert model is None
    assert report['status'] == 'insufficient_training_reference'
    assert report['eligible_sample_count'] == 0
    assert report['reference_rejections'] == {'unlabeled': 1, 'unsupported_reference_kind': 2}
    assert not report['mapbiomas_superiority_established']


def test_uncertain_or_missing_reviewer_does_not_become_reference():
    uncertain, missing = sample(1, label=1), sample(2, label=1)
    uncertain['certainty'] = 'low'
    missing['reviewer'] = None
    report, model = classify_feature_matrix(np.ones((2, 4)), [uncertain, missing])
    assert model is None
    assert report['reference_rejections'] == {'uncertain_interpretation': 1, 'missing_reviewer': 1}


def test_duplicate_or_overlapping_geographic_support_is_rejected():
    first = sample(1)
    duplicate = copy.deepcopy(first)
    duplicate['id'] = 'another_identifier'
    duplicate['col'] += 15
    with pytest.raises(ValueError, match='overlapping'):
        validate_samples([first, duplicate])


def test_same_geographic_block_cannot_cross_splits():
    first, other = sample(1), sample(2, split='test')
    other['block'] = first['block']
    with pytest.raises(ValueError, match='multiple splits'):
        validate_samples([first, other])


def test_transfer_region_cannot_be_used_for_training():
    with pytest.raises(ValueError, match='transfer region'):
        validate_samples([sample(1), sample(2, split='transfer_test')])


def test_future_target_is_rejected_even_when_its_label_is_unknown():
    future = sample(1)
    future['target_date'] = '2026-11-03T00:00:00Z'
    with pytest.raises(ValueError, match='later than'):
        validate_samples([future])


def test_missing_training_class_or_independent_blocks_prevents_fitting():
    samples = [sample(index, label=1) for index in range(30)]
    report, model = classify_feature_matrix(np.ones((30, 4)), samples)
    assert model is None
    assert report['missing_training_support'] == {'2': 10, '3': 10, '4': 10, '5': 10}


def test_training_uses_train_only_and_ai_scores_are_named_as_agreement(monkeypatch):
    samples = complete_samples()
    features = matrix(samples)
    features = np.column_stack((features, np.arange(len(samples))))
    original_fit = RandomForestClassifier.fit
    fitting_rows = []
    def spy_fit(model, x, y, *args, **kwargs):
        fitting_rows.extend(x[:, -1].astype(int).tolist())
        return original_fit(model, x, y, *args, **kwargs)
    monkeypatch.setattr(RandomForestClassifier, 'fit', spy_fit)
    report, model = classify_feature_matrix(features, samples)
    assert model is not None
    assert fitting_rows == [index for index, item in enumerate(samples) if item['split'] == 'train']
    assert model.n_jobs == 2 and model.n_estimators == 200
    assert report['training_split'] == 'train'
    for split in ('validation', 'test', 'transfer_test'):
        evaluation = report['evaluations'][split]
        assert evaluation['reference_type'] == 'agreement_with_AI_visual_interpretation'
        assert evaluation['status'] == 'five_class_agreement_evaluated'
        assert evaluation['macro_f1'] is not None
    assert report['independent_field_accuracy'] is None
    assert report['human_expert_reference_count'] == 0


def test_small_test_class_suppresses_five_class_metrics():
    samples = [item for item in complete_samples()
               if not (item['split'] == 'test' and item['label'] == 5)]
    samples.append(sample(9999, split='test', label=5))
    report, model = classify_feature_matrix(matrix(samples), samples)
    assert model is not None
    evaluation = report['evaluations']['test']
    assert evaluation['macro_f1'] is None and evaluation['overall_agreement'] is None
    assert evaluation['per_class']['5']['status'] == 'inconclusive'
    assert evaluation['per_class']['5']['f1'] is None


def test_preannotation_support_amendment_allows_local_five_but_not_transfer_five():
    selected = []
    counts = {}
    for item in complete_samples():
        key = (item['split'], item['label'])
        counts[key] = counts.get(key, 0) + 1
        if item['split'] == 'train' or counts[key] <= 5:
            selected.append(item)
    report, model = classify_feature_matrix(matrix(selected), selected)
    assert model is not None
    assert report['min_independent_per_class_by_split'] == {
        'train': 10, 'validation': 5, 'test': 5, 'transfer_test': 10}
    for split in ('validation', 'test'):
        result = report['evaluations'][split]
        assert result['status'] == 'five_class_agreement_evaluated'
        assert result['macro_f1'] is not None
        assert result['min_independent_per_class'] == 5
    transfer = report['evaluations']['transfer_test']
    assert transfer['status'] == 'insufficient_evaluation_reference'
    assert transfer['macro_f1'] is None and transfer['overall_agreement'] is None
    assert all(item['status'] == 'inconclusive' for item in transfer['per_class'].values())
    assert report['confidence_intervals'] is None
    assert report['population_accuracy_estimated'] is False
    assert report['mapbiomas_superiority_established'] is False


def test_clear_support_threshold_excludes_cloudy_examples_without_imputation():
    bands = np.full((6, 16, 16), 0.2, dtype=np.float32)
    bands[3] = 0.6
    scl = np.full((16, 16), 4, dtype=np.uint8)
    scl[:2] = 9  # 12.5% cloud means fewer than 90% clear pixels.
    features, diagnostic = support_features(bands, scl)
    assert np.isnan(features).all()
    assert diagnostic['status'] == 'insufficient_clear_support'
    scl[:2] = 4
    features, diagnostic = support_features(bands, scl)
    assert len(features) == len(FEATURE_NAMES) == 18
    assert np.isfinite(features).all() and diagnostic['status'] == 'ready'
    assert features[FEATURE_NAMES.index('ndvi_mean')] == pytest.approx(0.5)


def test_scene_date_mismatch_and_heldout_role_fail_before_raster_reads():
    labeled = sample(1, label=1)
    manifest = {'cutoff_utc': '2026-11-02T23:59:59Z', 'regions': [
        {'id': 'development', 'role': 'development', 'scenes': [
            {'id': 'target', 'date': '2026-10-02', 'image': 'unused.tif', 'scl': 'unused.tif'}]}]}
    with pytest.raises(ValueError, match='date does not match'):
        extract_features(manifest, [labeled])
    manifest['regions'][0]['scenes'][0]['date'] = labeled['target_date']
    manifest['regions'][0]['role'] = 'geographic_holdout'
    with pytest.raises(ValueError, match='holdout'):
        extract_features(manifest, [labeled])


def test_raster_features_use_only_the_named_scene_and_preserve_cloud_unknowns(tmp_path):
    import rasterio
    from rasterio.transform import from_origin
    image, scl = tmp_path / 'scene.tif', tmp_path / 'scl.tif'
    profile = dict(driver='GTiff', width=100, height=100, count=6, dtype='float32',
                   crs='EPSG:32721', transform=from_origin(500000, 9200000, 10, 10))
    bands = np.full((6, 100, 100), 0.2, dtype=np.float32)
    bands[3] = 0.6
    with rasterio.open(image, 'w', **profile) as dataset:
        dataset.write(bands)
    profile.update(count=1, dtype='uint8')
    quality = np.full((100, 100), 4, dtype=np.uint8)
    quality[42:44, 42:58] = 9
    with rasterio.open(scl, 'w', **profile) as dataset:
        dataset.write(quality, 1)
    annotation = sample(0, label=1)
    annotation.update(row=50, col=50)
    manifest = {'cutoff_utc': '2026-11-02T23:59:59Z', 'regions': [
        {'id': 'development', 'role': 'development', 'scenes': [
            {'id': 'target', 'date': annotation['target_date'],
             'image': str(image), 'scl': str(scl)}]}]}
    features, diagnostics = extract_features(manifest, [annotation])
    assert np.isnan(features).all()
    assert diagnostics[0]['status'] == 'insufficient_clear_support'
    assert diagnostics[0]['target_date'] == annotation['target_date']


def embedding_fixture(tmp_path):
    image, scl = tmp_path / 'scene.tif', tmp_path / 'scl.tif'
    image.write_bytes(b'frozen image bytes')
    scl.write_bytes(b'frozen quality bytes')
    annotation = sample(0, label=1)
    annotation.update(row=24, col=24)
    region = {'id': 'development', 'role': 'development', 'width': 32, 'height': 32,
              'crs': 'EPSG:32721', 'transform': [10, 0, 500000, 0, -10, 9200000],
              'scenes': [{'id': 'target', 'date': annotation['target_date'],
                          'image': str(image), 'scl': str(scl)}]}
    manifest = {'cutoff_utc': '2026-11-02T23:59:59Z', 'regions': [region]}
    directory = tmp_path / 'embeddings/development_review_target'
    directory.mkdir(parents=True)
    probe = {'input': str(image), 'scl': str(scl),
             'input_sha256': hashlib.sha256(image.read_bytes()).hexdigest(),
             'scl_sha256': hashlib.sha256(scl.read_bytes()).hexdigest(),
             'source_shape': [32, 32], 'source_crs': region['crs'],
             'source_transform': region['transform'], 'source_resolution': [10, 10],
             'feature_spacing_source_pixels': 16, 'feature_spacing_crs_units': [160, 160],
             'minimum_clear_patch_fraction': 0.9, 'model_id': 'frozen-test-model',
             'model_checkpoint_sha256': 'frozen-checkpoint', 'tile_size_pixels': 32,
             'feature_shape': [1, 2, 2, 3]}
    (directory / 'probe.json').write_text(json.dumps(probe))
    np.savez_compressed(directory / 'features.npz',
                        features=np.arange(12, dtype=np.float32).reshape(1, 2, 2, 3),
                        clear_fraction=np.ones((1, 2, 2), dtype=np.float32),
                        windows=np.array([[0, 0, 32, 32]]))
    return manifest, annotation, tmp_path / 'embeddings', directory


def test_embedding_join_selects_exact_aligned_support(tmp_path):
    manifest, annotation, root, _ = embedding_fixture(tmp_path)
    features, diagnostics = extract_embedding_features(manifest, [annotation], root)
    np.testing.assert_array_equal(features, [[9, 10, 11]])
    assert diagnostics[0]['status'] == 'ready'
    assert diagnostics[0]['token_row'] == diagnostics[0]['token_col'] == 1
    assert diagnostics[0]['feature_support_m'] == annotation['label_support_m'] == 160


def test_embedding_join_rejects_shifted_support_instead_of_nearest_patch(tmp_path):
    manifest, annotation, root, _ = embedding_fixture(tmp_path)
    annotation['row'] += 1
    with pytest.raises(ValueError, match='shifted'):
        extract_embedding_features(manifest, [annotation], root)


def test_embedding_join_rejects_source_hash_mismatch(tmp_path):
    manifest, annotation, root, _ = embedding_fixture(tmp_path)
    Path(manifest['regions'][0]['scenes'][0]['image']).write_bytes(b'changed after embedding')
    with pytest.raises(ValueError, match='hash mismatch'):
        extract_embedding_features(manifest, [annotation], root)


def test_embedding_join_rejects_recorded_date_mismatch(tmp_path):
    manifest, annotation, root, directory = embedding_fixture(tmp_path)
    probe_path = directory / 'probe.json'
    probe = json.loads(probe_path.read_text())
    probe['source_date'] = '2026-09-30'
    probe_path.write_text(json.dumps(probe))
    with pytest.raises(ValueError, match='date mismatch'):
        extract_embedding_features(manifest, [annotation], root)


def test_embedding_join_keeps_cloud_masked_tokens_unknown(tmp_path):
    manifest, annotation, root, directory = embedding_fixture(tmp_path)
    clear = np.ones((1, 2, 2), dtype=np.float32)
    clear[0, 1, 1] = .80
    np.savez_compressed(directory / 'features.npz',
                        features=np.arange(12, dtype=np.float32).reshape(1, 2, 2, 3),
                        clear_fraction=clear, windows=np.array([[0, 0, 32, 32]]))
    features, diagnostics = extract_embedding_features(manifest, [annotation], root)
    assert np.isnan(features).all()
    assert diagnostics[0]['status'] == 'insufficient_clear_support'


def test_cli_rejects_annotations_frozen_against_another_manifest(tmp_path, monkeypatch):
    manifest, labels = tmp_path / 'manifest.json', tmp_path / 'labels.json'
    manifest.write_text(json.dumps({'study_id': 'test', 'regions': []}))
    labels.write_text(json.dumps({'study_id': 'test', 'manifest_sha256': 'anothermanifest',
                                 'model_predictions_shown': False, 'samples': []}))
    monkeypatch.setattr('sys.argv', ['classify', '--manifest', str(manifest), '--labels', str(labels),
                                    '--output', str(tmp_path / 'output')])
    with pytest.raises(ValueError, match='manifest hash'):
        classify_main()
    assert not (tmp_path / 'output').exists()
