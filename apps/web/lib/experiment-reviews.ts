import 'server-only';
import type { LabReview, LabReviewCollection, LabReviewInput, LabStudy } from '../features/experiments/types';
import { ExperimentError } from './experiments';

const INPUT_KEYS = ['sampleId', 'decision', 'label', 'certainty', 'notes', 'referenceKind', 'blindReview', 'expectedRevision'];
export function parseExperimentReview(body: Record<string, unknown>): LabReviewInput {
  if (Object.keys(body).length !== INPUT_KEYS.length || Object.keys(body).some(key => !INPUT_KEYS.includes(key))
    || typeof body.sampleId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(body.sampleId)
    || !['class', 'indeterminate'].includes(body.decision as string)
    || !['high', 'low'].includes(body.certainty as string)
    || !['human_visual_interpretation', 'expert_visual_interpretation', 'ai_visual_interpretation'].includes(body.referenceKind as string)
    || typeof body.blindReview !== 'boolean' || typeof body.notes !== 'string' || body.notes.length > 2000
    || !Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0 || (body.expectedRevision as number) > 2147483646
    || (body.decision === 'class' ? !Number.isInteger(body.label) || (body.label as number) < 1 || (body.label as number) > 5 : body.label !== null))
    throw new ExperimentError('Informe uma revisão válida para a amostra.', 422);
  return body as LabReviewInput;
}
type ReviewRow = Omit<LabReview, 'updatedAt'> & { updatedAt: Date };
export function publicExperimentReview(row: ReviewRow): LabReview {
  return { sampleId: row.sampleId, decision: row.decision, label: row.label, certainty: row.certainty,
    notes: row.notes, referenceKind: row.referenceKind, blindReview: row.blindReview,
    revision: row.revision, updatedAt: row.updatedAt.toISOString() };
}
const reviewSelect = { sampleId: true, decision: true, label: true, certainty: true, notes: true,
  referenceKind: true, blindReview: true, revision: true, updatedAt: true } as const;

export async function getExperimentReviews(study: LabStudy, reviewerId: string): Promise<LabReviewCollection> {
  const { prisma } = await import('./db');
  const where = { studyId: study.id, fingerprint: study.fingerprint };
  const [rows, totalReviewCount] = await prisma.$transaction([
    prisma.experimentReview.findMany({ where: { ...where, reviewerId }, select: reviewSelect,
      orderBy: { sampleId: 'asc' }, take: study.samples.length }),
    prisma.experimentReview.count({ where }),
  ]);
  const known = new Set(study.samples.map(sample => sample.id));
  const reviews = rows.filter(row => known.has(row.sampleId)).map(row => publicExperimentReview(row as ReviewRow));
  return { reviews, totalReviewCount, myReviewedCount: reviews.length };
}

export async function saveExperimentReview(study: LabStudy, reviewerId: string, untrusted: Record<string, unknown>): Promise<LabReview> {
  const input = parseExperimentReview(untrusted);
  const sample = study.samples.find(sample => sample.id === input.sampleId);
  if (!sample) throw new ExperimentError('Amostra não encontrada neste estudo.', 404);
  if (!sample.usable && input.decision === 'class') throw new ExperimentError('Esta amostra não possui cobertura útil suficiente; registre como indeterminada.', 422);
  const { prisma } = await import('./db');
  const identity = { studyId: study.id, fingerprint: study.fingerprint, sampleId: sample.id, reviewerId };
  const data = { decision: input.decision, label: input.label, certainty: input.certainty,
    notes: input.notes, referenceKind: input.referenceKind, blindReview: input.blindReview };
  try {
    const row = await prisma.$transaction(async transaction => {
      if (input.expectedRevision === 0) return transaction.experimentReview.create({ data: { ...identity, ...data }, select: reviewSelect });
      const update = await transaction.experimentReview.updateMany({ where: { ...identity, revision: input.expectedRevision },
        data: { ...data, revision: { increment: 1 } } });
      if (update.count !== 1) throw new ExperimentError('A revisão foi alterada. Recarregue sua revisão antes de salvar novamente.', 409);
      return transaction.experimentReview.findUniqueOrThrow({ where: { studyId_fingerprint_sampleId_reviewerId: identity }, select: reviewSelect });
    });
    return publicExperimentReview(row as ReviewRow);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002')
      throw new ExperimentError('A revisão foi alterada. Recarregue sua revisão antes de salvar novamente.', 409);
    throw error;
  }
}

/** Only the requesting reviewer's explicitly blind, high-certainty labels export. */
export function exportExperimentReviews(study: LabStudy, reviewerId: string, reviews: LabReview[]) {
  const owned = new Map(reviews.map(review => [review.sampleId, review]));
  let excludedUnblinded = 0, excludedUncertain = 0, includedLabels = 0;
  const samples = study.samples.map(sample => {
    const review = owned.get(sample.id);
    const include = !!review && review.blindReview && review.certainty === 'high' && review.decision === 'class' && sample.usable;
    if (review && !review.blindReview) excludedUnblinded++;
    else if (review && !include) excludedUncertain++;
    if (include) includedLabels++;
    return { id: sample.id, region: sample.regionId, row: sample.row, col: sample.col, block: sample.block,
      lon: sample.longitude, lat: sample.latitude, split: sample.split,
      target_scene_id: sample.targetSceneId, target_date: sample.targetDate, label_support_m: sample.supportM,
      label: include ? review.label : null, certainty: include ? 'high' : null,
      reviewer: review ? reviewerId : null, reference_kind: review ? review.referenceKind : 'unreviewed',
      notes: review?.notes || '', review_revision: review?.revision || 0,
      blind_review_declared: review?.blindReview ?? null,
    };
  });
  return { study_id: study.id, manifest_sha256: study.manifestSha256, study_fingerprint: study.fingerprint,
    sampling_revision: study.samplingRevision, classes: { '1': 'forest', '2': 'pasture', '3': 'cropland', '4': 'exposed_soil', '5': 'water' },
    model_predictions_shown: false,
    blindness_provenance: 'reviewer_declaration_not_independently_verified', independent_blindness_verified: false,
    export_policy: 'Only this reviewer’s usable, high-certainty class labels explicitly declared blind are included; all other labels are null.',
    included_label_count: includedLabels, excluded_unblinded_review_count: excludedUnblinded,
    excluded_uncertain_or_indeterminate_review_count: excludedUncertain, samples };
}
