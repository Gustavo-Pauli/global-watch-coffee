import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export type LabBounds = [[number, number], [number, number]];
export type LabClass = 1 | 2 | 3 | 4 | 5;
export type LabReferenceKind = 'human_visual_interpretation' | 'expert_visual_interpretation' | 'ai_visual_interpretation';
export const LAB_CLASSES: { value: LabClass; label: string }[] = [
  { value: 1, label: 'Floresta' }, { value: 2, label: 'Pastagem' },
  { value: 3, label: 'Cultivo agrícola' }, { value: 4, label: 'Solo exposto' }, { value: 5, label: 'Água' },
];
export type LabScene = {
  id: string; date: string; phase: 'baseline' | 'recent'; clearPercent: number;
  rgbAssetId: string; falseColorAssetId: string;
};
export type LabCandidate = {
  id: string; areaHa: number;
  timing: 'observed_new_recent_loss' | 'left_censored_possible_loss_since_baseline' | 'mixed_censoring_candidate';
  firstAnomaly: [string | null, string | null]; lastIntact: [string | null, string | null];
  corroborated: [string | null, string | null]; latestObservation: [string | null, string | null];
  reboundFraction: number; validatedDeforestation: false; cause: null;
};
export type LabRegion = {
  id: string; name: string; role: 'development' | 'geographic_holdout'; bounds: LabBounds;
  scenes: LabScene[]; candidates: FeatureCollection<Polygon | MultiPolygon, LabCandidate>;
  metrics: { candidateCount: number; candidateAreaHa: number; newlyObservedCount: number; newlyObservedAreaHa: number };
};
export type LabSample = {
  id: string; regionId: string; row: number; col: number; block: string;
  longitude: number; latitude: number; split: 'train' | 'validation' | 'test' | 'transfer_test';
  targetSceneId: string; targetDate: string; supportM: number; usable: boolean;
  frames: { date: string; phase: 'baseline' | 'recent'; rgbAssetId: string; falseColorAssetId: string; clearPercent: number }[];
};
export type LabPaper = { title: string; year: number; url: string; relevance: string; kind: 'journal' | 'conference' | 'preprint' | 'documentation' };
export type LabStudySummary = {
  id: string; fingerprint: string; title: string; description: string; cutoff: string;
  status: 'reference_evaluation_pending'; acquiredSceneCount: number; candidateCount: number;
  sampleCount: number; usableSampleCount: number; regionNames: string[];
};
export type LabStudy = LabStudySummary & {
  schemaVersion: 1; manifestSha256: string; samplingRevision: number;
  regions: LabRegion[]; samples: LabSample[]; papers: LabPaper[];
  caseCards: { id: string; regionId: string; candidateId: string; imageAssetId: string; caption: string }[];
  hypotheses: { id: string; title: string; question: string; state: string; finding: string }[];
  method: { name: string; explanation: string; parameters: { label: string; value: string }[]; limitations: string[] };
  modelRuns: { name: string; sceneId: string; date: string; tileCount: number; inferenceSeconds: number; peakAllocatedMiB: number; featureSpacingM: number; scope: string }[];
  referenceAccess: { name: string; status: string; detail: string }[];
  classificationState: string; attribution: string; interpretationNote: string;
};
// Asset paths stay server-only. Client documents receive only the opaque asset IDs.
export type LabBundle = LabStudy & { assets: Record<string, { path: string; mimeType: 'image/jpeg' | 'image/png'; bytes: number; sha256: string }> };
export type LabReview = {
  sampleId: string; decision: 'class' | 'indeterminate'; label: LabClass | null;
  certainty: 'high' | 'low'; notes: string; referenceKind: LabReferenceKind;
  blindReview: boolean; revision: number; updatedAt: string;
};
export type LabReviewInput = Omit<LabReview, 'revision' | 'updatedAt'> & { expectedRevision: number };
export type LabReviewCollection = { reviews: LabReview[]; totalReviewCount: number; myReviewedCount: number };

export function labAssetUrl(studyId: string, assetId: string) {
  return `/api/experiments/${encodeURIComponent(studyId)}/assets/${encodeURIComponent(assetId)}`;
}
