import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LabBundle, LabReview } from '../features/experiments/types';
import { experimentUserAllowed } from '../lib/experiment-access';
import { exportExperimentReviews, parseExperimentReview } from '../lib/experiment-reviews';
import { ExperimentError, loadExperimentBundle, parseExperimentBundle, publicExperimentStudy, readExperimentAsset } from '../lib/experiments';

const jpeg = Buffer.from([255, 216, 255, 224, 0, 1]);
const fingerprint = 'f'.repeat(64);
function bundle(): LabBundle {
  return {
    schemaVersion: 1, id: 'test-study', fingerprint, manifestSha256: 'a'.repeat(64), samplingRevision: 2,
    title: 'Private research', description: 'Test fixture', cutoff: '2026-11-02T23:59:59Z', status: 'reference_evaluation_pending',
    acquiredSceneCount: 1, candidateCount: 0, sampleCount: 1, usableSampleCount: 1, regionNames: ['Region'],
    regions: [{ id: 'region', name: 'Region', role: 'development', bounds: [[-8, -56], [-7, -55]],
      scenes: [{ id: 'scene', date: '2026-10-01', phase: 'recent', clearPercent: 99, rgbAssetId: 'rgb', falseColorAssetId: 'rgb' }],
      candidates: { type: 'FeatureCollection', features: [] },
      metrics: { candidateCount: 0, candidateAreaHa: 0, newlyObservedCount: 0, newlyObservedAreaHa: 0 } }],
    samples: [{ id: 'sample-1', regionId: 'region', row: 8, col: 8, block: '0_0', longitude: -55.5, latitude: -7.5,
      split: 'test', targetSceneId: 'scene', targetDate: '2026-10-01', supportM: 160, usable: true,
      frames: [{ date: '2026-10-01', phase: 'recent', rgbAssetId: 'rgb', falseColorAssetId: 'rgb', clearPercent: 99 }] }],
    assets: { rgb: { path: 'assets/rgb.jpg', mimeType: 'image/jpeg', bytes: jpeg.length, sha256: createHash('sha256').update(jpeg).digest('hex') } },
    papers: [], caseCards: [], hypotheses: [], method: { name: 'test', explanation: '', parameters: [], limitations: [] },
    modelRuns: [], referenceAccess: [], classificationState: 'pending', attribution: 'Source fixture', interpretationNote: 'No field validation',
  };
}
const reviewInput = () => ({ sampleId: 'sample-1', decision: 'class', label: 1, certainty: 'high', notes: '',
  referenceKind: 'human_visual_interpretation', blindReview: true, expectedRevision: 0 });

test('experiment access is default-deny and email grants require verified database email', () => {
  const user = { id: 'reviewer', email: 'Reviewer@Example.test', emailVerified: false, name: 'Reviewer' };
  assert.equal(experimentUserAllowed(null, { EXPERIMENT_USER_IDS: 'reviewer' }), false);
  assert.equal(experimentUserAllowed(user, {}), false);
  assert.equal(experimentUserAllowed(user, { EXPERIMENT_USER_EMAILS: 'reviewer@example.test' }), false);
  assert.equal(experimentUserAllowed({ ...user, emailVerified: true }, { EXPERIMENT_USER_EMAILS: ' REVIEWER@example.test ' }), true);
  assert.equal(experimentUserAllowed(user, { EXPERIMENT_USER_IDS: 'reviewer' }), true);
  assert.equal(experimentUserAllowed(user, { EXPERIMENT_USER_IDS: 'other', EXPERIMENT_USER_EMAILS: 'other@example.test' }), false);
});

test('review inputs reject identity spoofing, contradictory labels, malformed revisions and oversized notes', () => {
  assert.equal(parseExperimentReview(reviewInput()).label, 1);
  for (const changed of [
    { reviewerId: 'attacker' }, { fingerprint: 'changed' }, { label: 0 }, { label: null },
    { decision: 'indeterminate', label: 1 }, { certainty: 'certain' }, { referenceKind: 'source_pseudolabel' },
    { blindReview: 'true' }, { expectedRevision: -1 }, { expectedRevision: 1.1 }, { notes: 'x'.repeat(2001) },
  ]) assert.throws(() => parseExperimentReview({ ...reviewInput(), ...changed }), error => error instanceof ExperimentError && error.status === 422);
  assert.equal(parseExperimentReview({ ...reviewInput(), decision: 'indeterminate', label: null }).label, null);
});

test('bundle normalizer strips extra server fields and rejects missing assets and remote paths', () => {
  const source = bundle() as LabBundle & { secretPath: string };
  source.secretPath = 'private/source.tif';
  const parsed = parseExperimentBundle(source, 'test-study');
  const publicStudy = publicExperimentStudy(parsed);
  assert.equal('assets' in publicStudy, false);
  assert.equal('secretPath' in publicStudy, false);
  for (const unsafe of ['../secret.jpg', 'C:/private/secret.jpg', 'https://host/image.jpg', 'assets\\..\\secret.jpg']) {
    const source = bundle(); source.assets.rgb.path = unsafe;
    assert.throws(() => parseExperimentBundle(source, 'test-study'), error => error instanceof ExperimentError);
  }
  const missing = bundle(); missing.samples[0].frames[0].rgbAssetId = 'absent';
  assert.throws(() => parseExperimentBundle(missing, 'test-study'));
});

test('assets are opaque allowlisted files with hash, size and containment checks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'global-watch-lab-'));
  try {
    const directory = path.join(root, 'bundles/test-study'); await mkdir(path.join(directory, 'assets'), { recursive: true });
    await writeFile(path.join(directory, 'study.json'), JSON.stringify(bundle()));
    await writeFile(path.join(directory, 'assets/rgb.jpg'), jpeg);
    assert.equal((await loadExperimentBundle('test-study', root)).id, 'test-study');
    assert.deepEqual((await readExperimentAsset('test-study', 'rgb', root)).bytes, jpeg);
    for (const id of ['../rgb', '%2e%2e', 'absent', 'constructor'])
      await assert.rejects(readExperimentAsset('test-study', id, root), error => error instanceof ExperimentError && error.status === 404);
    await assert.rejects(loadExperimentBundle('../test-study', root), error => error instanceof ExperimentError && error.status === 404);
    await writeFile(path.join(directory, 'assets/rgb.jpg'), Buffer.from([255, 216, 255, 1]));
    await assert.rejects(readExperimentAsset('test-study', 'rgb', root), error => error instanceof ExperimentError && error.status === 503);
    // Directory junctions work without elevated symlink privileges on Windows.
    const outside = path.join(root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'study.json'), JSON.stringify(bundle()));
    await symlink(outside, path.join(root, 'bundles/escaped'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(loadExperimentBundle('escaped', root), error => error instanceof ExperimentError && error.status === 404);
  } finally {
    const relative = path.relative(tmpdir(), root);
    assert.ok(relative.startsWith('global-watch-lab-') && !path.isAbsolute(relative) && !relative.startsWith('..'));
    await rm(root, { recursive: true, force: true });
  }
});

test('own-reference export preserves geometry and excludes unblinded and uncertain labels', () => {
  const study = publicExperimentStudy(parseExperimentBundle(bundle(), 'test-study'));
  study.samples = Array.from({ length: 4 }, (_, index) => ({ ...study.samples[0], id: `sample-${index + 1}` }));
  const reviews: LabReview[] = [
    { sampleId: 'sample-1', decision: 'class', label: 1, certainty: 'high', notes: 'Observed', referenceKind: 'human_visual_interpretation', blindReview: true, revision: 2, updatedAt: '2026-11-03T00:00:00Z' },
    { sampleId: 'sample-2', decision: 'class', label: 2, certainty: 'high', notes: '', referenceKind: 'ai_visual_interpretation', blindReview: false, revision: 1, updatedAt: '2026-11-03T00:00:00Z' },
    { sampleId: 'sample-3', decision: 'class', label: 3, certainty: 'low', notes: '', referenceKind: 'expert_visual_interpretation', blindReview: true, revision: 1, updatedAt: '2026-11-03T00:00:00Z' },
  ];
  const exported = exportExperimentReviews(study, 'server-reviewer-id', reviews);
  assert.deepEqual(exported.samples.map(sample => sample.label), [1, null, null, null]);
  assert.equal(exported.samples[0].row, study.samples[0].row);
  assert.equal(exported.samples[0].reviewer, 'server-reviewer-id');
  assert.equal(exported.samples[0].reference_kind, 'human_visual_interpretation');
  assert.equal(exported.manifest_sha256, study.manifestSha256);
  assert.equal(exported.excluded_unblinded_review_count, 1);
  assert.equal(exported.excluded_uncertain_or_indeterminate_review_count, 1);
  assert.equal(exported.independent_blindness_verified, false);
});

test('every private experiments route denies an unauthenticated request before file/database access', async () => {
  process.env.DATABASE_URL ||= 'postgresql://localhost:1/unused_auth_test';
  process.env.BETTER_AUTH_SECRET ||= 'isolated-unit-test-secret-at-least-thirty-two-characters';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  const routes = [
    await import('../app/api/experiments/route'), await import('../app/api/experiments/[id]/route'),
    await import('../app/api/experiments/[id]/assets/[assetId]/route'), await import('../app/api/experiments/[id]/reviews/route'),
    await import('../app/api/experiments/[id]/reviews/export/route'),
  ];
  for (const route of routes) {
    const response = await route.GET(new Request('http://localhost:3000/api/experiments/test-study'),
      { params: Promise.resolve({ id: 'test-study', assetId: 'rgb' }) });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
    assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
  }
  const reviews = await import('../app/api/experiments/[id]/reviews/route');
  assert.equal((await reviews.PUT(new Request('http://localhost:3000/api/experiments/test-study/reviews', { method: 'PUT', body: '{' }),
    { params: Promise.resolve({ id: 'test-study' }) })).status, 401);
});
