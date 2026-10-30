import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextFacts, explain, numericsSupported, reportFacts } from '../lib/chat';
import { groundedAnswer } from '../lib/gemini';

function measuredScene() {
  return {
    result: {
      schema_version: 2,
      candidate_polygon_count: 2,
      candidate_area_ha: 3.4,
      valid_pixels: 990,
      ndvi_median: 0.559,
      acquisition_date: '2025-08-16',
      method: 'rf_purified_multiclass_2.0',
      coffee_validated: false,
      visualizations: { rgb: 'map', false_color: 'false_color', ndvi: 'ndvi' },
      quality: {
        total_pixels: 1000, eligible_pixels: 990, input_invalid_pixels: 4,
        scl_excluded_pixels: 6, scl_applied: true, eligible_percent: 99,
        ndvi_defined_pixels: 980,
      },
      provenance: {
        crs: 'EPSG:32723', resolution: { x: 10, y: 10, unit: 'metre' },
        bands: ['B02', 'B03', 'B04', 'B08'], model_version: 'rf_purified_multiclass_2.0',
        parameters: { threshold: 0.5, min_area_ha: 0.2, coherence: true },
        input_sha256: 'a'.repeat(64), scl_sha256: 'b'.repeat(64), model_sha256: 'c'.repeat(64),
        analysis_fingerprint: 'd'.repeat(64), date_source: 'sample_metadata', area_method: 'geodesic_wgs84',
      },
    },
    geojson: { features: [
      { properties: { id: 1, area_ha: 1.2, ndvi_mean: 0.72 as number | null, touches_scene_boundary: true } },
      { properties: { id: 2, area_ha: 2.2, ndvi_mean: 0.41, touches_scene_boundary: false } },
    ] },
  };
}

test('measured polygon context preserves its NDVI and edge flag separately from the scene median', () => {
  const input = measuredScene();
  const facts = reportFacts(input);
  assert.deepEqual(facts.quality, { ...input.result.quality, excluded_percent: 1 });
  assert.equal(facts.ndvi_median, 0.559);
  assert.equal(facts.polygons[0].ndvi_mean, 0.72);
  assert.equal(facts.polygons[0].border, true);
  assert.equal(facts.polygons[1].ndvi_mean, 0.41);
  assert.equal(facts.polygons[1].border, false);
  const scoped = contextFacts('Qual é o NDVI médio do polígono 1?', facts);
  assert.equal(scoped.subject_polygon_id, 1);
  assert.equal(contextFacts('Compare o polígono 1 com o polígono 2.', facts).subject_polygon_id, 2);
  assert.equal(contextFacts('Qual é a área da cena?', facts).subject_polygon_id, undefined);
});

test('NDVI guard binds measured means to their polygon IDs and does not substitute the scene median', () => {
  const facts = reportFacts(measuredScene());
  const one = contextFacts('Qual é o NDVI médio do polígono 1?', facts);
  const two = contextFacts('Qual é o NDVI médio do polígono 2?', facts);
  for (const answer of [
    'O NDVI médio do polígono 1 é 0,720.',
    'Polígono 1: NDVI médio 0,72 e área de 1,20 ha.',
    'O NDVI médio é 0,720.',
  ]) assert.equal(numericsSupported(answer, one), true, answer);
  assert.equal(numericsSupported('O NDVI médio do polígono 2 é 0,410.', two), true);
  assert.equal(numericsSupported('O NDVI mediano da cena é 0,559.', facts), true);
  for (const answer of [
    'O NDVI médio do polígono 1 é 0,410.',
    'O NDVI médio do polígono 1 é 0,559.',
    'O NDVI médio é 0,410.',
    'O NDVI médio é 0,559.',
  ]) assert.equal(numericsSupported(answer, one), false, answer);
  assert.equal(numericsSupported('O NDVI médio do polígono 2 é 0,720.', two), false);
  assert.equal(numericsSupported('O NDVI mediano da cena é 0,720.', facts), false);
});

test('polygon hectares are scoped to the named polygon, including answers with multiple measured values', () => {
  const facts = reportFacts(measuredScene());
  const one = contextFacts('Qual é a área do polígono 1?', facts);
  for (const answer of [
    'O polígono 1 tem 1,20 ha estimados.',
    'A área é 1,20 ha.',
    'Polígono 1: 1,20 ha e NDVI médio 0,720.',
  ]) assert.equal(numericsSupported(answer, one), true, answer);
  for (const answer of [
    'O polígono 1 tem 2,20 ha estimados.',
    'A área é 2,20 ha.',
    'O polígono 1 tem 3,40 ha estimados.',
    'Polígono 1: 2,20 ha e NDVI médio 0,720.',
    'O polígono 2 tem 1,20 ha estimados.',
  ]) assert.equal(numericsSupported(answer, one), false, answer);
  assert.equal(numericsSupported('A área total da cena é 3,40 ha.', facts), true);
});

test('quality counts and eligible percentage are field scoped and never authorize accuracy claims', () => {
  const facts = reportFacts(measuredScene());
  for (const answer of [
    '99% dos pixels foram elegíveis para análise.',
    'São 990 pixels elegíveis de 1.000 pixels totais.',
    'Há 4 pixels inválidos e 6 pixels excluídos pela SCL.',
  ]) assert.equal(numericsSupported(answer, facts), true, answer);
  for (const answer of [
    '98% dos pixels foram elegíveis para análise.',
    '99% da cena está sem nuvens.',
    'O modelo tem 99% de precisão.',
    'A confiança da classificação é 99%.',
    'A acurácia é de 99%.',
    'A precisão é 99% dos pixels elegíveis.',
    'Há 4 pixels elegíveis.',
    'Há 990 pixels inválidos.',
    'Há 4 pixels excluídos pela SCL.',
    'Há 6 pixels inválidos.',
  ]) assert.equal(numericsSupported(answer, facts), false, answer);
});

test('absent or undefined polygon NDVI remains unavailable in legacy results and deterministic answers', () => {
  const modern = measuredScene();
  modern.geojson.features[0].properties.ndvi_mean = null;
  const noMean = contextFacts('Qual é o NDVI médio do polígono 1?', reportFacts(modern));
  assert.equal(numericsSupported('O NDVI médio é 0,559.', noMean), false);
  assert.match(explain('Qual é o NDVI médio do polígono 1?', noMean), /indisponível|não.*(?:calculad|disponível)/i);
  assert.doesNotMatch(explain('Qual é o NDVI médio do polígono 1?', noMean), /0,559/);

  const legacy = reportFacts({
    result: { candidate_polygon_count: 2, candidate_area_ha: 3.4, ndvi_median: 0.559 },
    geojson: { features: [{ properties: { id: 1, area_ha: 1.2 } }, { properties: { id: 2, area_ha: 2.2 } }] },
  });
  assert.equal(legacy.quality, undefined);
  assert.equal(legacy.polygons[0].ndvi_mean == null, true);
  assert.equal(numericsSupported('O NDVI mediano da cena é 0,559.', legacy), true);
  assert.equal(numericsSupported('99% dos pixels foram elegíveis para análise.', legacy), false);
  assert.equal(numericsSupported('São 990 pixels elegíveis.', legacy), false);
});

test('provider context carries verified scoped facts and rejects cross-polygon invention without network access', async () => {
  const facts = reportFacts(measuredScene());
  const fetcher = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const verified = body.contents[0].parts[0].text as string;
    assert.match(verified, /"subject_polygon_id":1/);
    assert.match(verified, /"ndvi_mean":0\.72/);
    assert.match(verified, /"eligible_percent":99/);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'O NDVI médio do polígono 1 é 0,720.' }] } }] });
  }) as typeof fetch;
  assert.equal((await groundedAnswer('Qual é o NDVI médio do polígono 1?', facts,
    { apiKey: 'unit-test-secret', fetcher })).type, 'ai_grounded');

  for (const answer of ['O NDVI médio do polígono 1 é 0,410.', 'O polígono 1 tem 2,20 ha.', 'A classificação tem 99% de precisão.']) {
    const reply = await groundedAnswer('Qual é o NDVI médio do polígono 1?', facts, {
      apiKey: 'unit-test-secret',
      fetcher: (async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: answer }] } }] })) as typeof fetch,
    });
    assert.equal(reply.type, 'rules_fallback_not_ai', answer);
  }
});

test('legacy provider payloads remain usable without fabricated quality or polygon means', async () => {
  const facts = reportFacts({
    result: { candidate_polygon_count: 2, candidate_area_ha: 3.4, ndvi_median: 0.559 },
    geojson: { features: [{ properties: { id: 1, area_ha: 1.2 } }, { properties: { id: 2, area_ha: 2.2 } }] },
  });
  let inspected = false;
  const reply = await groundedAnswer('Qual é o NDVI mediano da cena?', facts, {
    apiKey: 'unit-test-secret',
    fetcher: (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const verified = body.contents[0].parts[0].text as string;
      inspected = true;
      assert.doesNotMatch(verified, /"quality"|"eligible_percent"/);
      assert.match(verified, /"ndvi_median":0\.559/);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'O NDVI mediano da cena é 0,559.' }] } }] });
    }) as typeof fetch,
  });
  assert.equal(inspected, true);
  assert.equal(reply.type, 'ai_grounded');
});
