import test from 'node:test';
import assert from 'node:assert/strict';
import { availableVisualizations, optionalOutputKinds, requiredOutputKinds, resultExtensions, visualizationManifest } from '../lib/analysis-artifacts';

function result() {
  return {
    schema_version: 2, method: 'rf_purified_multiclass_2.0', valid_pixels: 75,
    visualizations: { rgb: 'map', false_color: 'false_color', ndvi: 'ndvi' },
    quality: { total_pixels: 100, eligible_pixels: 75, input_invalid_pixels: 10, scl_excluded_pixels: 15,
      scl_applied: true, eligible_percent: 75, ndvi_defined_pixels: 70 },
    provenance: { crs: 'EPSG:32723', resolution: { x: 10, y: 10, unit: 'metre' }, bands: ['B02', 'B03', 'B04', 'B08'],
      model_version: 'rf_purified_multiclass_2.0', parameters: { threshold: 0.5, min_area_ha: 0.2, coherence: true },
      input_sha256: 'a'.repeat(64), scl_sha256: 'b'.repeat(64), model_sha256: 'c'.repeat(64), analysis_fingerprint: 'd'.repeat(64),
      date_source: 'sample_metadata', area_method: 'geodesic_wgs84' },
  };
}

test('legacy analysis stays RGB-only and valid v2 capabilities use fixed artifact keys', () => {
  assert.deepEqual(availableVisualizations({ valid_pixels: 75 }), { rgb: 'map' });
  assert.deepEqual(optionalOutputKinds(result()), ['false_color', 'ndvi']);
  const coreOnly = result();
  coreOnly.visualizations = { rgb: 'map' } as typeof coreOnly.visualizations;
  assert.ok(resultExtensions(coreOnly));
  assert.deepEqual(optionalOutputKinds(coreOnly), []);
  assert.equal(requiredOutputKinds({ method: 'legacy' }).length, 6);
  assert.equal(requiredOutputKinds(result()).length, 8);
  assert.throws(() => requiredOutputKinds({ ...result(), quality: {} }));
  assert.throws(() => requiredOutputKinds({ schema_version: 3 }));
});

test('manifest cannot supply external URLs, file paths, inherited or unknown output kinds', () => {
  for (const manifest of [null, [], { rgb: 'rgb' }, { rgb: 'map', ndvi: '../../private' },
    { rgb: 'map', ndvi: 'https://example.invalid/image.png' }, { rgb: 'map', arbitrary: 'ndvi' },
    Object.create({ rgb: 'map', ndvi: 'ndvi' })]) {
    assert.equal(visualizationManifest(manifest), null);
  }
});

test('quality counts must reconcile, distinguish SCL, and agree with the existing valid pixel field', () => {
  for (const patch of [{ eligible_pixels: 76 }, { input_invalid_pixels: -1 }, { scl_excluded_pixels: null },
    { eligible_percent: 99 }, { ndvi_defined_pixels: 76 }, { total_pixels: 0 }]) {
    const bad = result(); Object.assign(bad.quality, patch);
    assert.equal(resultExtensions(bad), null);
  }
  const withoutScl = result();
  Object.assign(withoutScl.quality, { eligible_pixels: 90, scl_excluded_pixels: null, scl_applied: false, eligible_percent: 90 });
  withoutScl.valid_pixels = 90;
  withoutScl.provenance.scl_sha256 = null as unknown as string;
  assert.ok(resultExtensions(withoutScl));
});

test('provenance rejects invented configuration, unknown date source and malformed fingerprints', () => {
  for (const patch of [{ input_sha256: 'private-name.tif' }, { date_source: 'certified' }, { area_method: 'projected' },
    { model_version: 'other' }, { resolution: { x: 0, y: 10, unit: 'metre' } }]) {
    const bad = result(); Object.assign(bad.provenance, patch);
    assert.equal(resultExtensions(bad), null);
    assert.deepEqual(availableVisualizations(bad), { rgb: 'map' });
  }
});
