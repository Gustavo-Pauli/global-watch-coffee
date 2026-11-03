import 'server-only';
import { createHash } from 'node:crypto';
import { open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { LabBundle, LabStudy, LabStudySummary } from '../features/experiments/types';

export class ExperimentError extends Error {
  constructor(message: string, public readonly status = 404) { super(message); }
}
export const EXPERIMENT_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
};
const ID = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MAX_DOCUMENT = 16 * 1024 * 1024;
const MAX_ASSET = 20 * 1024 * 1024;
const invalid = () => new ExperimentError('O estudo está indisponível ou possui dados inválidos.', 503);
export function experimentJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: EXPERIMENT_HEADERS });
}
export function experimentFailure(error: unknown) {
  return experimentJson({ detail: error instanceof ExperimentError ? error.message : 'A experimentação está temporariamente indisponível.' },
    error instanceof ExperimentError ? error.status : 503);
}
export function validExperimentId(value: string) { return ID.test(value); }
export function pathContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 2000) {
  if (typeof value !== 'string' || value.length > maximum) throw invalid();
  return value;
}
function id(value: unknown) { const result = text(value, 128); if (!ID.test(result)) throw invalid(); return result; }
function hash(value: unknown) { const result = text(value, 64); if (!HASH.test(result)) throw invalid(); return result; }
function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid();
  return value;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const result = number(value, min, max); if (!Number.isSafeInteger(result)) throw invalid(); return result;
}
function array(value: unknown, maximum = 10000) { if (!Array.isArray(value) || value.length > maximum) throw invalid(); return value; }
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw invalid(); return value as T;
}
function date(value: unknown) {
  const result = text(value, 64);
  if (!/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function datePair(value: unknown): [string | null, string | null] {
  const values = array(value, 2); if (values.length !== 2) throw invalid();
  return values.map(item => item === null ? null : date(item)) as [string | null, string | null];
}
function point(value: unknown): [number, number] {
  const coordinates = array(value, 3); if (coordinates.length < 2) throw invalid();
  return [number(coordinates[0], -180, 180), number(coordinates[1], -90, 90)];
}
function bounds(value: unknown): [[number, number], [number, number]] {
  const values = array(value, 2); if (values.length !== 2) throw invalid();
  const result = values.map(item => { const pair = array(item, 2); if (pair.length !== 2) throw invalid();
    return [number(pair[0], -90, 90), number(pair[1], -180, 180)]; }) as [[number, number], [number, number]];
  if (result[0][0] >= result[1][0] || result[0][1] >= result[1][1]) throw invalid();
  return result;
}
function polygon(value: unknown): number[][][] {
  return array(value, 1000).map(ring => {
    const points = array(ring, 100000).map(point); if (points.length < 4) throw invalid();
    const first = points[0], last = points[points.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) throw invalid();
    return points;
  });
}
function paperUrl(value: unknown) {
  const result = text(value, 2000), parsed = new URL(result);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw invalid();
  return result;
}

/** Reconstruct known fields so metadata cannot leak server paths through extras. */
export function parseExperimentBundle(value: unknown, expectedId: string): LabBundle {
  const source = record(value);
  if (source.schemaVersion !== 1 || source.id !== expectedId) throw invalid();
  const rawAssets = record(source.assets), assetEntries = Object.entries(rawAssets);
  if (assetEntries.length > 4096) throw invalid();
  const assets: LabBundle['assets'] = {};
  for (const [key, raw] of assetEntries) {
    const asset = record(raw), assetPath = text(asset.path, 512);
    if (!ID.test(key) || !assetPath || assetPath.includes('\\') || assetPath.includes(':') || path.isAbsolute(assetPath)
      || assetPath.split('/').some(part => !part || part === '.' || part === '..')) throw invalid();
    Object.defineProperty(assets, key, { value: { path: assetPath,
      mimeType: choice(asset.mimeType, ['image/jpeg', 'image/png']), bytes: integer(asset.bytes, 1, MAX_ASSET), sha256: hash(asset.sha256) }, enumerable: true });
  }
  const assetId = (value: unknown) => { const key = id(value); if (!Object.hasOwn(assets, key)) throw invalid(); return key; };
  const regions: LabBundle['regions'] = array(source.regions, 10).map(raw => {
    const region = record(raw), metrics = record(region.metrics), collection = record(region.candidates);
    if (collection.type !== 'FeatureCollection') throw invalid();
    const scenes = array(region.scenes, 200).map(rawScene => { const scene = record(rawScene); return {
      id: id(scene.id), date: date(scene.date), phase: choice(scene.phase, ['baseline', 'recent']),
      clearPercent: number(scene.clearPercent, 0, 100), rgbAssetId: assetId(scene.rgbAssetId), falseColorAssetId: assetId(scene.falseColorAssetId),
    }; });
    if (new Set(scenes.map(scene => scene.id)).size !== scenes.length) throw invalid();
    const features = array(collection.features, 20000).map(rawFeature => {
      const feature = record(rawFeature), geometry = record(feature.geometry), props = record(feature.properties);
      if (feature.type !== 'Feature' || props.validatedDeforestation !== false || props.cause !== null) throw invalid();
      const type = choice(geometry.type, ['Polygon', 'MultiPolygon']);
      return { type: 'Feature' as const, geometry: type === 'Polygon'
        ? { type: 'Polygon' as const, coordinates: polygon(geometry.coordinates) }
        : { type: 'MultiPolygon' as const, coordinates: array(geometry.coordinates, 1000).map(polygon) },
      properties: { id: id(props.id), areaHa: number(props.areaHa),
        timing: choice(props.timing, ['observed_new_recent_loss', 'left_censored_possible_loss_since_baseline', 'mixed_censoring_candidate']),
        firstAnomaly: datePair(props.firstAnomaly), lastIntact: datePair(props.lastIntact),
        corroborated: datePair(props.corroborated), latestObservation: datePair(props.latestObservation),
        reboundFraction: number(props.reboundFraction, 0, 1), validatedDeforestation: false as const, cause: null },
      };
    });
    return { id: id(region.id), name: text(region.name, 200), role: choice(region.role, ['development', 'geographic_holdout']),
      bounds: bounds(region.bounds), scenes, candidates: { type: 'FeatureCollection' as const, features },
      metrics: { candidateCount: integer(metrics.candidateCount), candidateAreaHa: number(metrics.candidateAreaHa),
        newlyObservedCount: integer(metrics.newlyObservedCount), newlyObservedAreaHa: number(metrics.newlyObservedAreaHa) } };
  });
  if (new Set(regions.map(region => region.id)).size !== regions.length) throw invalid();
  const samples: LabBundle['samples'] = array(source.samples, 10000).map(raw => {
    const sample = record(raw), regionId = id(sample.regionId), region = regions.find(item => item.id === regionId);
    if (!region || typeof sample.usable !== 'boolean') throw invalid();
    const targetSceneId = id(sample.targetSceneId), target = region.scenes.find(scene => scene.id === targetSceneId);
    const targetDate = date(sample.targetDate);
    if (!target || target.date !== targetDate) throw invalid();
    return { id: id(sample.id), regionId, row: integer(sample.row), col: integer(sample.col), block: text(sample.block, 128),
      longitude: number(sample.longitude, -180, 180), latitude: number(sample.latitude, -90, 90),
      split: choice(sample.split, ['train', 'validation', 'test', 'transfer_test']), targetSceneId, targetDate,
      supportM: number(sample.supportM, 1, 10000), usable: sample.usable,
      frames: array(sample.frames, 20).map(rawFrame => { const frame = record(rawFrame); return {
        date: date(frame.date), phase: choice(frame.phase, ['baseline', 'recent']), rgbAssetId: assetId(frame.rgbAssetId),
        falseColorAssetId: assetId(frame.falseColorAssetId), clearPercent: number(frame.clearPercent, 0, 100),
      }; }),
    };
  });
  if (new Set(samples.map(sample => sample.id)).size !== samples.length) throw invalid();
  const method = record(source.method);
  const result: LabBundle = {
    schemaVersion: 1, id: id(source.id), fingerprint: hash(source.fingerprint), manifestSha256: hash(source.manifestSha256),
    samplingRevision: integer(source.samplingRevision, 1), title: text(source.title, 300), description: text(source.description, 4000),
    cutoff: date(source.cutoff), status: choice(source.status, ['reference_evaluation_pending']),
    acquiredSceneCount: integer(source.acquiredSceneCount), candidateCount: integer(source.candidateCount),
    sampleCount: integer(source.sampleCount), usableSampleCount: integer(source.usableSampleCount),
    regionNames: array(source.regionNames, 10).map(value => text(value, 200)), regions, samples, assets,
    papers: array(source.papers, 100).map(raw => { const paper = record(raw); return { title: text(paper.title, 500),
      year: integer(paper.year, 1900, 2100), url: paperUrl(paper.url), relevance: text(paper.relevance, 4000),
      kind: choice(paper.kind, ['journal', 'conference', 'preprint', 'documentation']) }; }),
    caseCards: array(source.caseCards, 100).map(raw => { const card = record(raw), regionId = id(card.regionId), candidateId = id(card.candidateId);
      const region = regions.find(item => item.id === regionId);
      if (!region || !region.candidates.features.some(feature => feature.properties.id === candidateId)) throw invalid();
      return { id: id(card.id), regionId, candidateId, imageAssetId: assetId(card.imageAssetId), caption: text(card.caption, 4000) }; }),
    hypotheses: array(source.hypotheses, 20).map(raw => { const hypothesis = record(raw); return { id: id(hypothesis.id),
      title: text(hypothesis.title, 500), question: text(hypothesis.question, 4000), state: text(hypothesis.state, 500), finding: text(hypothesis.finding, 10000) }; }),
    method: { name: text(method.name, 300), explanation: text(method.explanation, 10000),
      parameters: array(method.parameters, 100).map(raw => { const parameter = record(raw); return { label: text(parameter.label, 300), value: text(parameter.value, 2000) }; }),
      limitations: array(method.limitations, 100).map(value => text(value, 4000)) },
    modelRuns: array(source.modelRuns, 100).map(raw => { const run = record(raw); return { name: text(run.name, 500), sceneId: id(run.sceneId),
      date: date(run.date), tileCount: integer(run.tileCount), inferenceSeconds: number(run.inferenceSeconds),
      peakAllocatedMiB: number(run.peakAllocatedMiB), featureSpacingM: number(run.featureSpacingM), scope: text(run.scope, 4000) }; }),
    referenceAccess: array(source.referenceAccess, 100).map(raw => { const access = record(raw); return { name: text(access.name, 500), status: text(access.status, 500), detail: text(access.detail, 4000) }; }),
    classificationState: text(source.classificationState, 4000), attribution: text(source.attribution, 4000), interpretationNote: text(source.interpretationNote, 10000),
  };
  if (result.sampleCount !== samples.length || result.usableSampleCount !== samples.filter(sample => sample.usable).length
      || result.candidateCount !== regions.reduce((total, region) => total + region.candidates.features.length, 0)
      || regions.some(region => region.metrics.candidateCount !== region.candidates.features.length)) throw invalid();
  return result;
}

export function publicExperimentStudy(bundle: LabBundle): LabStudy {
  const { assets: _serverOnlyAssets, ...study } = bundle; return study;
}
export function experimentSummary(study: LabStudy): LabStudySummary {
  const { id, fingerprint, title, description, cutoff, status, acquiredSceneCount, candidateCount,
    sampleCount, usableSampleCount, regionNames } = study;
  return { id, fingerprint, title, description, cutoff, status, acquiredSceneCount, candidateCount, sampleCount, usableSampleCount, regionNames };
}
async function boundedRead(filename: string, limit: number) {
  const handle = await open(/* turbopackIgnore: true */ filename, 'r');
  try {
    const stat = await handle.stat(); if (!stat.isFile() || stat.size > limit) throw invalid();
    const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1)); let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break; length += read.bytesRead;
    }
    if (length !== stat.size || length > limit) throw invalid();
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
/**
 * Runtime-mounted private data, deliberately absent from Next's file tracing.
 * Deployments must explicitly provision bundles/<id>/study.json and its assets
 * under EXPERIMENT_DATA_DIR (or the app's .lab-data directory). The bundler must
 * never discover/copy the research source tree or local environment files.
 * Next itself uses this argument-level magic comment for runtime fs paths in
 * dist/server/load-manifest.external.js and dist/server/image-optimizer.js.
 */
export function experimentDataRoot() {
  return path.resolve(/* turbopackIgnore: true */ process.env.EXPERIMENT_DATA_DIR
    || path.join(/* turbopackIgnore: true */ process.cwd(), '.lab-data'));
}
async function bundleDirectory(studyId: string, root = experimentDataRoot()) {
  if (!validExperimentId(studyId)) throw new ExperimentError('Estudo não encontrado.');
  try {
    const actualRoot = await realpath(/* turbopackIgnore: true */ root);
    const bundles = await realpath(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ actualRoot, 'bundles'));
    const directory = await realpath(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ bundles, studyId));
    if (!pathContained(actualRoot, bundles) || !pathContained(bundles, directory)) throw new ExperimentError('Estudo não encontrado.');
    return directory;
  } catch (error) { if (error instanceof ExperimentError) throw error; throw new ExperimentError('Estudo não encontrado.'); }
}
export async function loadExperimentBundle(studyId: string, root = experimentDataRoot()): Promise<LabBundle> {
  const directory = await bundleDirectory(studyId, root);
  try {
    const filename = await realpath(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, 'study.json'));
    if (!pathContained(directory, filename)) throw invalid();
    return parseExperimentBundle(JSON.parse((await boundedRead(filename, MAX_DOCUMENT)).toString('utf8')), studyId);
  } catch (error) { if (error instanceof ExperimentError) throw error; throw invalid(); }
}
export async function listExperimentStudies(root = experimentDataRoot()): Promise<LabStudySummary[]> {
  let directory;
  try {
    const actualRoot = await realpath(/* turbopackIgnore: true */ root);
    const bundles = await realpath(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ actualRoot, 'bundles'));
    if (!pathContained(actualRoot, bundles)) throw invalid();
    directory = await opendir(/* turbopackIgnore: true */ bundles);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const names = []; let seen = 0;
  for await (const entry of directory) {
    if (entry.isDirectory() && validExperimentId(entry.name)) names.push(entry.name);
    if (++seen >= 100) break;
  }
  const studies = [];
  for (const name of names.sort().slice(0, 20)) studies.push(experimentSummary(await loadExperimentBundle(name, root)));
  return studies;
}
export async function readExperimentAsset(studyId: string, assetId: string, root = experimentDataRoot()) {
  if (!validExperimentId(assetId)) throw new ExperimentError('Arquivo não encontrado.');
  const bundle = await loadExperimentBundle(studyId, root);
  if (!Object.hasOwn(bundle.assets, assetId)) throw new ExperimentError('Arquivo não encontrado.');
  const asset = bundle.assets[assetId], directory = await bundleDirectory(studyId, root);
  const filename = await realpath(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ directory, asset.path));
  if (!pathContained(directory, filename)) throw new ExperimentError('Arquivo não encontrado.');
  const bytes = await boundedRead(filename, MAX_ASSET);
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw invalid();
  const signatureValid = asset.mimeType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!signatureValid) throw invalid();
  return { bytes, mimeType: asset.mimeType };
}
