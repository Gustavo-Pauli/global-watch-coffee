import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextFacts, explain, numericsSupported, reportFacts } from '../lib/chat';
import { groundedAnswer } from '../lib/gemini';

const facts = reportFacts({ result: { candidate_polygon_count: 300, candidate_area_ha: 1234.567, ndvi_median: -0.1234, acquisition_date: '2025-08-16' },
  geojson: { features: Array.from({ length: 300 }, (_, index) => ({ properties: { id: index + 1, area_ha: 0.4567 } })) } });

test('chat rejects absent/non-finite facts, keeps missing NDVI unavailable and includes later polygons', () => {
  assert.throws(() => reportFacts(null));
  assert.throws(() => reportFacts({ result: { candidate_area_ha: Infinity }, geojson: { features: [] } }));
  assert.equal(reportFacts({ result: { candidate_polygon_count: 0, candidate_area_ha: 0 }, geojson: { features: [] } }).ndvi_median, null);
  assert.match(explain('área do polígono 300', facts), /0,46/);
  assert.equal(contextFacts('área do polígono 300', facts).polygons.length, 250);
  assert.ok(contextFacts('área do polígono 300', facts).polygons.some(p => p.id === 300));
});

test('numeric guard accepts supported Brazilian rounding/signed NDVI and rejects inventions', () => {
  assert.ok(numericsSupported('Sentinel-2: 1.234,57 ha e NDVI -0,123 em 16/08/2025.', facts));
  assert.equal(numericsSupported('9999 hectares', facts), false);
  assert.equal(numericsSupported('NDVI 0,123', facts), false);
  assert.equal(numericsSupported('Precisão de 99,9%', facts), false);
  assert.equal(numericsSupported('Precisão de 100%', facts), false);
  assert.equal(numericsSupported('Área candidata de 2025 ha', facts), false);
  assert.equal(numericsSupported('Área candidata de 1e6 ha', facts), false);
});

test('numeric guard checks paired Markdown values against their units and preserves rejections', () => {
  for (const answer of [
    'São **1.234,57** hectares candidatos.',
    'São __1.234,57__ hectares candidatos.',
    'São *1.234,57* hectares candidatos.',
    'São _1.234,57_ hectares candidatos.',
    'São `1.234,57`\u00a0hectares candidatos.',
    'Foram gerados **300** polígonos candidatos.',
    'Polígono **1**: **0,46**\u202fha estimados.',
    'O NDVI mediano é **-0,123** em **2025-08-16**.',
  ]) assert.ok(numericsSupported(answer, facts), answer);
  for (const answer of [
    'São **9999** hectares candidatos.',
    'Foram gerados **299** polígonos candidatos.',
    'O NDVI mediano é **0,123**.',
    'Precisão de **100**%.',
    'Área candidata de **2025** ha.',
    'Área candidata de 1**e6** ha.',
    'Área candidata de 1e`6` ha.',
    'Área candidata de 1*e6* ha.',
  ]) assert.equal(numericsSupported(answer, facts), false, answer);
});

test('numeric guard accepts MapBiomas resolution only when qualified by trusted limitations', () => {
  const referenceFacts = { ...facts, limitations: 'MapBiomas 30m para rótulos fracos; sem validação de campo.' };
  assert.ok(numericsSupported('Foram usados rótulos fracos do MapBiomas 30m.', referenceFacts));
  assert.ok(numericsSupported('Foram usados rótulos fracos do MapBiomas **30** m.', referenceFacts));
  assert.equal(numericsSupported('Foram usados rótulos fracos do MapBiomas 30m.', facts), false);
  for (const answer of [
    'Foram usados rótulos fracos do MapBiomas 10m.',
    'A resolução é 30m.',
    'Área de 30 ha.',
    'MapBiomas 2025 ha.',
    'MapBiomas 30m².',
  ]) assert.equal(numericsSupported(answer, referenceFacts), false, answer);
});

test('Gemini key uses header and verified text receives AI label; unsupported or blocked text falls back', async () => {
  let requestUrl = '';
  const fetcher = (async (input, init) => {
    requestUrl = String(input);
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'unit-test-secret');
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'São 1.234,57 ha candidatos, sem validação de campo.' }] } }] });
  }) as typeof fetch;
  assert.equal((await groundedAnswer('área?', facts, { apiKey: 'unit-test-secret', fetcher })).type, 'ai_grounded');
  assert.ok(!requestUrl.includes('unit-test-secret'));
  for (const body of [{ candidates: [] }, { candidates: [{ finishReason: 'MAX_TOKENS' }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'São 9999 hectares.' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Café confirmado em campo.' }] } }] }]) {
    assert.equal((await groundedAnswer('área?', facts, { apiKey: 'unit-test-secret', fetcher: (async () => Response.json(body)) as typeof fetch })).type, 'rules_fallback_not_ai');
  }
  assert.equal((await groundedAnswer('área?', facts, { apiKey: '' })).type, 'rules_fallback_not_ai');
});

test('exhausted route budget falls back without sending another provider request', async () => {
  let called = false;
  const fetcher = (async () => { called = true; return Response.json({}); }) as typeof fetch;
  const reply = await groundedAnswer('área?', facts, { apiKey: 'unit-test-secret', timeoutMs: 0, fetcher });
  assert.equal(reply.type, 'rules_fallback_not_ai');
  assert.equal(called, false);
});
