import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJSON, errorMessage, isAborted } from '../lib/client-api';

test('network timeout covers a stalled response body and releases the operation with a useful error', async t => {
  let aborted = false;
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('deadline did not abort')), 1000);
      init.signal!.addEventListener('abort', () => { aborted = true; clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
    }),
  }));
  await assert.rejects(requestJSON('/test', { timeoutMs: 10 }), /conexão demorou/i);
  assert.equal(aborted, true);
});

test('caller cancellation remains cancellation; invalid JSON receives a recoverable service error', async t => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => { init.signal!.throwIfAborted(); });
  await assert.rejects(requestJSON('/test', { signal: controller.signal }), error => isAborted(error));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: () => Promise.reject(new SyntaxError('provider HTML')) }));
  await assert.rejects(requestJSON('/test'), /resposta inválida/);
  assert.match(errorMessage(new DOMException('Timeout', 'TimeoutError')), /conexão demorou/i);
});
