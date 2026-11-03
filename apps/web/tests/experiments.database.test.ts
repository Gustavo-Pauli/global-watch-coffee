import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { LabStudy } from '../features/experiments/types';

const url = process.env.TEST_DATABASE_URL;
if (url && !/(test|audit)/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must identify a disposable test/audit database.');

test('experiment reviews: PostgreSQL revision races, reviewer isolation and server-only constraints', { skip: !url }, async () => {
  process.env.DATABASE_URL = url!;
  const { prisma } = await import('../lib/db');
  const { saveExperimentReview, getExperimentReviews, exportExperimentReviews } = await import('../lib/experiment-reviews');
  const { ExperimentError } = await import('../lib/experiments');
  const first = `lab-audit-${randomUUID()}`, second = `lab-audit-${randomUUID()}`;
  const study = { id: `study-${randomUUID()}`, fingerprint: 'f'.repeat(64), manifestSha256: 'a'.repeat(64), samplingRevision: 2,
    samples: [{ id: 'sample-1', regionId: 'region', row: 8, col: 8, block: '0_0', longitude: -55, latitude: -7,
      split: 'test', targetSceneId: 'scene', targetDate: '2026-10-01', supportM: 160, usable: true }] } as LabStudy;
  const input = { sampleId: 'sample-1', decision: 'class', label: 1, certainty: 'high', notes: '',
    referenceKind: 'human_visual_interpretation', blindReview: true, expectedRevision: 0 };
  try {
    await prisma.user.createMany({ data: [first, second].map(id => ({ id, name: 'Disposable lab reviewer', email: `${id}@example.invalid`, emailVerified: true })) });
    const creates = await Promise.allSettled([saveExperimentReview(study, first, input), saveExperimentReview(study, first, { ...input, label: 2 })]);
    assert.equal(creates.filter(result => result.status === 'fulfilled').length, 1);
    const conflict = creates.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.ok(conflict.reason instanceof ExperimentError && conflict.reason.status === 409);
    const updates = await Promise.allSettled([
      saveExperimentReview(study, first, { ...input, notes: 'First edit', expectedRevision: 1 }),
      saveExperimentReview(study, first, { ...input, notes: 'Concurrent edit', expectedRevision: 1 }),
    ]);
    assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
    const own = await getExperimentReviews(study, first);
    assert.equal(own.reviews.length, 1); assert.equal(own.reviews[0].revision, 2);
    await saveExperimentReview(study, second, { ...input, label: 4 });
    const other = await getExperimentReviews(study, second);
    assert.equal(other.totalReviewCount, 2); assert.equal(other.reviews.length, 1);
    assert.equal(other.reviews[0].label, 4);
    assert.equal(exportExperimentReviews(study, second, other.reviews).samples[0].reviewer, second);
    assert.equal(exportExperimentReviews(study, second, other.reviews).samples[0].label, 4);
    const direct = { studyId: study.id, fingerprint: study.fingerprint, reviewerId: first,
      sampleId: 'invalid-class', decision: 'class', label: 6, certainty: 'high',
      notes: '', referenceKind: 'human_visual_interpretation', blindReview: true };
    await assert.rejects(prisma.experimentReview.create({ data: direct }));
    await assert.rejects(prisma.experimentReview.create({ data: { ...direct, label: 1, revision: 0 } }));
    await assert.rejects(prisma.experimentReview.create({ data: { ...direct, label: 1, notes: 'x'.repeat(2001) } }));
    const rows = await prisma.$queryRaw<{ rls: boolean; publicGrants: number; clientGrants: number; policies: number }[]>`
      SELECT c.relrowsecurity AS rls,
        (SELECT count(*)::int FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee=0) AS "publicGrants",
        (SELECT count(*)::int FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl JOIN pg_roles r ON r.oid=acl.grantee WHERE r.rolname IN ('anon','authenticated')) AS "clientGrants",
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='experiment_reviews'`;
    assert.deepEqual(rows, [{ rls: true, publicGrants: 0, clientGrants: 0, policies: 0 }]);
  } finally {
    await prisma.experimentReview.deleteMany({ where: { reviewerId: { in: [first, second] } } });
    await prisma.user.deleteMany({ where: { id: { in: [first, second] } } });
    await prisma.$disconnect();
  }
});
