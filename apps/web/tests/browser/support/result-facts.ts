import assert from 'node:assert/strict';
import type { FeatureCollection } from 'geojson';

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  assert.equal(typeof value, 'number', `${label} must be numeric`);
  assert.ok(Number.isSafeInteger(value) && Number(value) >= 0, `${label} must be a nonnegative integer`);
  return Number(value);
}

/** Assert independent relationships in real worker outputs, including legacy results. */
export function assertResultFacts(result: Record<string, unknown>, geojson: FeatureCollection) {
  assert.equal(geojson.features.length, result.candidate_polygon_count);
  const polygonArea = geojson.features.reduce((sum, feature) => sum + Number(feature.properties?.area_ha), 0);
  assert.ok(Number.isFinite(polygonArea), 'Every polygon must have a measured area');
  assert.ok(Math.abs(polygonArea - Number(result.candidate_area_ha)) < 0.002, 'Polygon hectares must agree with the analysis total');

  // Saved analyses from before schema 2 must remain usable without invented metadata.
  if (result.schema_version === undefined) return;
  assert.equal(result.schema_version, 2);
  const quality = record(result.quality, 'quality');
  const total = integer(quality.total_pixels, 'total_pixels');
  const eligible = integer(quality.eligible_pixels, 'eligible_pixels');
  const invalid = integer(quality.input_invalid_pixels, 'input_invalid_pixels');
  assert.equal(eligible, result.valid_pixels);
  assert.equal(typeof quality.scl_applied, 'boolean');
  const excluded = quality.scl_applied
    ? integer(quality.scl_excluded_pixels, 'scl_excluded_pixels')
    : (assert.equal(quality.scl_excluded_pixels, null), 0);
  assert.equal(eligible + invalid + excluded, total, 'Quality categories must account for every input pixel');
  assert.ok(integer(quality.ndvi_defined_pixels, 'ndvi_defined_pixels') <= eligible);
  assert.equal(quality.eligible_percent, total ? Math.round(eligible / total * 1000) / 10 : 0);

  const provenance = record(result.provenance, 'provenance');
  for (const key of ['input_sha256', 'model_sha256', 'analysis_fingerprint']) {
    assert.match(String(provenance[key]), /^[a-f0-9]{64}$/, `${key} must be a SHA-256 identifier`);
  }
  if (quality.scl_applied) assert.match(String(provenance.scl_sha256), /^[a-f0-9]{64}$/);
  else assert.equal(provenance.scl_sha256, null);
  assert.ok(['sample_metadata', 'user_supplied', 'unknown'].includes(String(provenance.date_source)));
  assert.equal(provenance.area_method, 'geodesic_wgs84');
  assert.equal(provenance.model_version, result.method);
  assert.ok(Array.isArray(provenance.bands) && provenance.bands.length >= 4);
  const resolution = record(provenance.resolution, 'resolution');
  assert.ok(Number(resolution.x) > 0 && Number(resolution.y) > 0);
  assert.ok(typeof resolution.unit === 'string' && resolution.unit.length > 0);

  for (const feature of geojson.features) {
    const mean = feature.properties?.ndvi_mean;
    assert.ok(mean === null || typeof mean === 'number' && Number.isFinite(mean) && mean >= -1 && mean <= 1,
      `Polygon ${feature.properties?.id} must contain measured NDVI or null`);
  }
}
