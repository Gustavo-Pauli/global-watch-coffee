import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { cleanupExpired, cronAuthorized, type CleanupRepository, type CleanupRow } from '../lib/cleanup';
import { outputPath, ALL_OUTPUTS, storageAdmin } from '../lib/storage';

type StoredRow = CleanupRow & { expiresAt: number };
function row(expiresAt: number, input = false): StoredRow {
  return { id: randomUUID(), ownerId: 'cleanup-fixture', expiresAt,
    imagePath: input ? 'fixture/input/image.tif' : null, sclPath: input ? 'fixture/input/scl.tif' : null };
}
function memory(rows: StoredRow[], limits: number[] = []) {
  const records = new Map(rows.map(record => [record.id, record]));
  const events: string[] = [];
  const repository: CleanupRepository = {
    async findExpired(cutoff, take) {
      return [...records.values()].filter(record => record.expiresAt < cutoff.getTime())
        .sort((a, b) => a.expiresAt - b.expiresAt).slice(0, take);
    },
    async deleteExpired(id, cutoff) {
      events.push(`delete:${id}`);
      if ((records.get(id)?.expiresAt ?? Infinity) >= cutoff.getTime()) return 0;
      return Number(records.delete(id));
    },
    async deleteExpiredLimits(cutoff) {
      for (let index = limits.length - 1; index >= 0; index--) if (limits[index] < cutoff.getTime()) limits.splice(index, 1);
    },
    async countExpired(cutoff) { return [...records.values()].filter(record => record.expiresAt < cutoff.getTime()).length; },
  };
  return { records, events, repository, limits };
}

test('cleanup authorization requires the exact configured bearer token, not a session or empty secret', () => {
  const request = (authorization?: string) => new Request('http://localhost/api/internal/cleanup', {
    headers: authorization ? { authorization, Cookie: 'better-auth.session_token=fixture' } : { Cookie: 'better-auth.session_token=fixture' },
  });
  assert.equal(cronAuthorized(request(), 'cron-secret'), false);
  assert.equal(cronAuthorized(request('Bearer cron-secret'), undefined), false);
  assert.equal(cronAuthorized(request('Bearer cron-secret'), ''), false);
  assert.equal(cronAuthorized(request('Bearer cron-secrex'), 'cron-secret'), false);
  assert.equal(cronAuthorized(request('Bearer cron-secret-extra'), 'cron-secret'), false);
  assert.equal(cronAuthorized(request('Basic cron-secret'), 'cron-secret'), false);
  assert.equal(cronAuthorized(request('Bearer cron-secret'), 'cron-secret'), true);
});

test('cleanup removes expired inputs and all core/optional outputs before metadata while active rows and limits survive', async () => {
  const expired = row(99, true), active = row(101), boundary = row(100);
  const state = memory([expired, active, boundary], [99, 100, 101]);
  const pathsSeen: string[][] = [];
  const result = await cleanupExpired({ repository: state.repository, now: () => 100,
    removeObjects: async paths => { state.events.push('storage'); pathsSeen.push(paths); },
  });
  assert.deepEqual(result, { cleaned: 1, failed: 0, remaining: 0 });
  assert.deepEqual(state.events, ['storage', `delete:${expired.id}`]);
  assert.deepEqual(pathsSeen[0], [expired.imagePath, expired.sclPath,
    ...Object.keys(ALL_OUTPUTS).map(kind => outputPath(expired.ownerId, expired.id, kind as keyof typeof ALL_OUTPUTS))]);
  assert.deepEqual([...state.records.keys()], [active.id, boundary.id]);
  assert.deepEqual(state.limits, [100, 101]);
});

test('a thrown Storage failure retains its metadata, continues other rows and succeeds on a later retry', async () => {
  const first = row(1), second = row(2);
  const state = memory([first, second]);
  let calls = 0;
  const result = await cleanupExpired({ repository: state.repository, now: () => 100,
    removeObjects: async () => { if (++calls === 1) throw new TypeError('simulated network failure'); },
  });
  assert.deepEqual(result, { cleaned: 1, failed: 1, remaining: 1 });
  assert.equal(state.records.has(first.id), true);
  assert.equal(state.records.has(second.id), false);
  assert.deepEqual(await cleanupExpired({ repository: state.repository, now: () => 100, removeObjects: async () => {} }),
    { cleaned: 1, failed: 0, remaining: 0 });
});

test('a metadata deletion failure preserves the retry target after successful idempotent object removal', async () => {
  const state = memory([row(1)]);
  const original = state.repository.deleteExpired;
  state.repository.deleteExpired = async () => { throw new Error('simulated database interruption'); };
  let removals = 0;
  const removeObjects = async () => { removals++; };
  assert.deepEqual(await cleanupExpired({ repository: state.repository, now: () => 100, removeObjects }),
    { cleaned: 0, failed: 1, remaining: 1 });
  state.repository.deleteExpired = original;
  assert.deepEqual(await cleanupExpired({ repository: state.repository, now: () => 100, removeObjects }),
    { cleaned: 1, failed: 0, remaining: 0 });
  assert.equal(removals, 2);
});

test('default batch cap reports backlog instead of silently claiming every expired row was removed', async () => {
  const state = memory(Array.from({ length: 201 }, (_, index) => row(index)));
  let calls = 0;
  const result = await cleanupExpired({ repository: state.repository, now: () => 1000, removeObjects: async () => { calls++; } });
  assert.deepEqual(result, { cleaned: 200, failed: 0, remaining: 1 });
  assert.equal(calls, 200);
});

test('Storage calls receive remaining budgets and an overrun retains metadata for another cron', async () => {
  const first = row(1), second = row(2), third = row(3);
  const state = memory([first, second, third]);
  let clock = 1000;
  const budgets: number[] = [];
  const result = await cleanupExpired({ repository: state.repository, now: () => clock,
    removeObjects: async (_paths, timeoutMs) => { budgets.push(timeoutMs); clock += budgets.length === 1 ? 40_000 : 5000; },
  });
  assert.deepEqual(budgets, [10_000, 5000]);
  assert.deepEqual(result, { cleaned: 1, failed: 1, remaining: 2 });
  assert.equal(state.records.has(second.id), true);
  assert.equal(state.records.has(third.id), true);
  assert.deepEqual(await cleanupExpired({ repository: state.repository, now: () => clock, removeObjects: async () => {} }),
    { cleaned: 2, failed: 0, remaining: 0 });
});

test('cleanup stops before object removal if the initial query has exhausted its budget', async () => {
  const state = memory([row(1)]);
  const original = state.repository.findExpired;
  let clock = 1000;
  state.repository.findExpired = async (cutoff, take) => { const rows = await original(cutoff, take); clock += 45_000; return rows; };
  let removed = false;
  assert.deepEqual(await cleanupExpired({ repository: state.repository, now: () => clock, removeObjects: async () => { removed = true; } }),
    { cleaned: 0, failed: 0, remaining: 1 });
  assert.equal(removed, false);
});

test('a fixed cutoff does not sweep rows or rate limits that expire while this run is working', async () => {
  const state = memory([row(99), row(110)], [99, 110]);
  let clock = 100;
  const result = await cleanupExpired({ repository: state.repository, now: () => clock, removeObjects: async () => { clock = 150; } });
  assert.deepEqual(result, { cleaned: 1, failed: 0, remaining: 0 });
  assert.equal(state.records.size, 1);
  assert.deepEqual(state.limits, [110]);
});

test('Storage SDK scoped fetch receives an aborted signal without logging credentials or making real requests', async () => {
  const previousFetch = globalThis.fetch, previousUrl = process.env.SUPABASE_URL, previousKey = process.env.SUPABASE_SECRET_KEY;
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  let observedSignal: AbortSignal | null | undefined;
  try {
    process.env.SUPABASE_URL = 'https://storage-fixture.invalid';
    process.env.SUPABASE_SECRET_KEY = 'unit-test-key';
    globalThis.fetch = (async (_input, init) => {
      calls++;
      observedSignal = init?.signal;
      throw new DOMException('Aborted', 'AbortError');
    }) as typeof fetch;
    const { error } = await storageAdmin(controller.signal).storage.from('fixture').remove(['fixture.txt']);
    assert.ok(error);
    assert.equal(calls, 1);
    assert.equal(observedSignal?.aborted, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
