import { deflateSync } from 'node:zlib';
import type { BrowserContext } from '@playwright/test';
import type { FeatureCollection, Polygon } from 'geojson';
import type { AnalysisData, Bounds } from '../../../features/analyses/types';
import type { ResultExtensions } from '../../../lib/analysis-artifacts';
import type { LabCandidate, LabRegion, LabStudy } from '../../../features/experiments/types';

export const analysisId = 'offline-map-analysis';
export const studyId = 'offline-map-study';
export const southBounds: Bounds = [[-8, -56], [-7.8, -55.8]];
export const northBounds: Bounds = [[51.4, -.2], [51.6, 0]];

function polygon(bounds: Bounds, offset: number): Polygon {
  const [[south, west], [north, east]] = bounds;
  const x = west + (east - west) * offset, y = south + (north - south) * offset;
  const width = (east - west) * .12, height = (north - south) * .12;
  return { type: 'Polygon', coordinates: [[[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]]] };
}

export function analysisFixture(bounds: Bounds = southBounds): AnalysisData & { result: AnalysisData['result'] & ResultExtensions } {
  return {
    analysis: { id: analysisId, status: 'ready', scene: null, date: '2026-10-07' },
    result: {
      method: 'offline-browser-fixture', acquisition_date: '2026-10-07', candidate_polygon_count: 2,
      candidate_area_ha: 5, valid_pixels: 1024, leaflet_bounds: bounds, ndvi_median: .6,
      limitations: 'Synthetic UI fixture; no scientific measurements.', model_score_not_calibrated: true,
      schema_version: 2, visualizations: { rgb: 'map', false_color: 'false_color', ndvi: 'ndvi' },
      quality: { total_pixels: 1024, eligible_pixels: 1024, input_invalid_pixels: 0, scl_excluded_pixels: null,
        scl_applied: false, eligible_percent: 100, ndvi_defined_pixels: 1024 },
      provenance: { crs: 'EPSG:4326', resolution: { x: 10, y: 10, unit: 'm' }, bands: ['B02', 'B03', 'B04', 'B08'],
        model_version: 'offline-browser-fixture', parameters: { threshold: .5, min_area_ha: .5, coherence: false },
        input_sha256: 'a'.repeat(64), scl_sha256: null, model_sha256: 'b'.repeat(64),
        analysis_fingerprint: 'c'.repeat(64), date_source: 'user_supplied', area_method: 'geodesic_wgs84' },
    },
    geojson: { type: 'FeatureCollection', features: [1, 2].map(id => ({ type: 'Feature',
      properties: { id, area_ha: id === 1 ? 3 : 2, ndvi_mean: .6, touches_scene_boundary: false },
      geometry: polygon(bounds, id === 1 ? .2 : .65) })) },
  };
}

function region(id: string, bounds: Bounds, role: LabRegion['role']): LabRegion {
  const candidates: FeatureCollection<Polygon, LabCandidate> = { type: 'FeatureCollection', features: [1, 2].map(index => ({
    type: 'Feature', geometry: polygon(bounds, index === 1 ? .2 : .65), properties: {
      id: `${id}-${index}`, areaHa: index === 1 ? 3 : 2, timing: 'observed_new_recent_loss',
      firstAnomaly: ['2026-10-07', '2026-10-07'], lastIntact: ['2026-08-01', '2026-08-01'],
      corroborated: ['2026-10-12', '2026-10-12'], latestObservation: ['2026-10-12', '2026-10-12'],
      reboundFraction: 0, validatedDeforestation: false, cause: null,
    },
  })) };
  return { id, name: id === 'south' ? 'Piloto sul sintético' : 'Piloto norte sintético', role, bounds, candidates,
    scenes: [
      { id: `${id}-before`, date: '2026-08-01', phase: 'baseline', clearPercent: 100, rgbAssetId: `${id}-before-rgb`, falseColorAssetId: `${id}-before-false` },
      { id: `${id}-after`, date: '2026-10-07', phase: 'recent', clearPercent: 100, rgbAssetId: `${id}-after-rgb`, falseColorAssetId: `${id}-after-false` },
    ], metrics: { candidateCount: 2, candidateAreaHa: 5, newlyObservedCount: 2, newlyObservedAreaHa: 5 } };
}

export function studyFixture(): LabStudy {
  return {
    schemaVersion: 1, id: studyId, fingerprint: 'd'.repeat(64), manifestSha256: 'e'.repeat(64), samplingRevision: 2,
    title: 'Estudo sintético de navegação', description: 'Offline browser fixture, not research data.',
    cutoff: '2026-11-02T23:59:59Z', status: 'reference_evaluation_pending', acquiredSceneCount: 4,
    candidateCount: 4, sampleCount: 0, usableSampleCount: 0, regionNames: ['Piloto sul sintético', 'Piloto norte sintético'],
    regions: [region('south', southBounds, 'development'), region('north', northBounds, 'geographic_holdout')],
    samples: [], papers: [], caseCards: [], hypotheses: [], modelRuns: [], referenceAccess: [],
    method: { name: 'UI fixture', explanation: 'Synthetic UI fixture.', parameters: [], limitations: [] },
    classificationState: 'pending', attribution: 'Synthetic test data', interpretationNote: 'No scientific measurements.',
  };
}

function crc32(bytes: Buffer) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/** Valid, decodable 32px RGB PNGs generated locally; no image package or binary fixture is needed. */
export function tinyPng(color: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc((32 * 3 + 1) * 32);
  for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
    const offset = row * 97 + 1 + col * 3;
    // Alternating quadrants make pan/zoom and before/after images visually distinguishable.
    for (let channel = 0; channel < 3; channel++) scanlines[offset + channel] = Math.max(0, color[channel] - ((row < 16) === (col < 16) ? 0 : 40));
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

export type OfflineMapFixture = {
  failAssets: Set<string>; requests: string[]; unexpected: string[]; errors: string[];
  tiles: { fail: boolean; requests: number };
};

/** HTTP interception only: the shipped auth/API implementation is never modified or bypassed server-side. */
export async function installMapFixtures(context: BrowserContext, baseURL: string): Promise<OfflineMapFixture> {
  const state: OfflineMapFixture = { failAssets: new Set(), requests: [], unexpected: [], errors: [], tiles: { fail: false, requests: 0 } };
  const origin = new URL(baseURL).origin, study = studyFixture();
  const before = tinyPng([83, 133, 62]), after = tinyPng([178, 122, 72]), falseColor = tinyPng([180, 58, 86]);
  await context.addInitScript(() => {
    // The initialization also runs on an opaque about:blank document.
    try { localStorage.setItem('global-watch:basemap:v1', 'none'); } catch { /* Storage is optional there. */ }
  });
  for (const page of context.pages()) page.on('pageerror', error => state.errors.push(error.message));
  context.on('page', page => page.on('pageerror', error => state.errors.push(error.message)));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.hostname === 'api.maptiler.com') {
      if (url.pathname.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="22"><text x="0" y="15">Fixture</text></svg>' });
      state.tiles.requests++;
      return route.fulfill({ status: state.tiles.fail ? 503 : 200, contentType: 'image/png', body: state.tiles.fail ? Buffer.from('unavailable') : before });
    }
    if (url.origin !== origin) {
      state.unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    state.requests.push(url.pathname);
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', json: body });
    if (url.pathname === '/api/auth/get-session') return json({
      user: { id: 'offline-browser-user', email: 'offline@example.invalid', emailVerified: true, name: 'Offline fixture', image: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      session: { id: 'offline-browser-session', userId: 'offline-browser-user', token: 'offline-only', expiresAt: '2099-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ipAddress: null, userAgent: null },
    });
    if (url.pathname === '/api/experiments/access') return json({ allowed: true });
    if (url.pathname === `/api/experiments/${studyId}`) return json(study);
    if (url.pathname === '/api/experiments') return json({ studies: [study] });
    if (url.pathname === `/api/experiments/${studyId}/reviews`) return json({ reviews: [], myReviewedCount: 0, totalReviewCount: 0 });
    if (url.pathname === `/api/analyses/${analysisId}`) return json(analysisFixture());
    if (url.pathname === `/api/analyses/${analysisId}-north`) return json(analysisFixture(northBounds));
    const asset = url.pathname.match(new RegExp(`^/api/experiments/${studyId}/assets/([a-z-]+)$`))?.[1]
      ?? url.pathname.match(new RegExp(`^/api/analyses/${analysisId}(?:-north)?/files/(map|false_color|ndvi)$`))?.[1];
    if (asset) {
      if (state.failAssets.has(asset)) return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic unavailable image' });
      const body = asset.includes('false') || asset === 'ndvi' ? falseColor : asset.includes('after') ? after : before;
      return route.fulfill({ contentType: 'image/png', body, headers: { 'cache-control': 'no-store' } });
    }
    state.unexpected.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 500, json: { detail: 'Unexpected offline fixture request' } });
  });
  return state;
}
