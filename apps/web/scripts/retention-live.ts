import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { getCookies } from 'better-auth/cookies';

/** Opt-in integration proof; never runs cleanup against the user's application DB. */
async function main() {
  if (process.env.RUN_LIVE_RETENTION !== '1') throw new Error('Set RUN_LIVE_RETENTION=1 for disposable local integration.');
  const url = process.env.TEST_DATABASE_URL;
  const base = process.env.RETENTION_BASE_URL || 'http://localhost:3001';
  if (!url) throw new Error('TEST_DATABASE_URL is required.');
  const target = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/global_watch_retention_test')
    throw new Error('Only the dedicated local global_watch_retention_test database is permitted.');
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) || new URL(base).port !== '3001')
    throw new Error('Only a dedicated local server on port 3001 is permitted.');
  for (const name of ['BETTER_AUTH_SECRET', 'CRON_SECRET', 'SUPABASE_URL']) if (!process.env[name]) throw new Error(`${name} is required.`);
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('A server-side Storage secret is required.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 2 }) });
  const storage = createClient(process.env.SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'geo-private';
  const owner = `retention-smoke-${randomUUID()}`;
  const expiredId = randomUUID(), activeId = randomUUID();
  const allPaths: string[] = [];
  try {
    // Refuse to let the authenticated cron touch records outside this run.
    assert.equal(await prisma.analysis.count(), 0, 'Dedicated retention DB must be empty; inspect leftovers before running.');
    await prisma.user.create({ data: { id: owner, name: 'Disposable retention test', email: `${owner}@example.invalid`, emailVerified: true } });
    const expiredLimit = `${owner}:expired`, activeLimit = `${owner}:active`;
    await prisma.rateLimit.createMany({ data: [
      { key: expiredLimit, count: 1, expiresAt: new Date(Date.now() - 60_000) },
      { key: activeLimit, count: 1, expiresAt: new Date(Date.now() + 86400_000) },
    ] });
    const token = randomUUID();
    await prisma.session.create({ data: { id: randomUUID(), token, userId: owner, expiresAt: new Date(Date.now() + 3600_000) } });
    const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(token).digest('base64');
    const cookieName = getCookies({ baseURL: base, secret: process.env.BETTER_AUTH_SECRET }).sessionToken.name;
    const cookie = `${cookieName}=${encodeURIComponent(`${token}.${signature}`)}`;
    const pathsFor = (id: string) => {
      const prefix = `users/${createHash('sha256').update(owner).digest('hex')}/analyses/${id}`;
      return [`${prefix}/input/image.tif`, `${prefix}/input/scl.tif`, ...[
        'candidatos.geojson', 'imagem_classificada.png', 'imagem_mapa.png', 'imagem_rgb.png', 'classificacao.tif', 'resultado.json',
      ].map(name => `${prefix}/out/${name}`)];
    };
    const expiredPaths = pathsFor(expiredId), activePaths = pathsFor(activeId);
    allPaths.push(...expiredPaths, ...activePaths);
    for (const [id, paths, expiresAt] of [
      [expiredId, expiredPaths, new Date(Date.now() - 60_000)],
      [activeId, activePaths, new Date(Date.now() + 86400_000)],
    ] as const) {
      await prisma.analysis.create({ data: { id, ownerId: owner, status: 'uploading', imagePath: paths[0], sclPath: paths[1], expiresAt } });
      for (const objectPath of paths) {
        const { error } = await storage.storage.from(bucket).upload(objectPath, Buffer.from('disposable-retention-fixture'), { contentType: 'application/octet-stream' });
        if (error) throw new Error('Disposable fixture upload failed.');
      }
    }
    // Prove this exact server sees the isolated DB before granting cron access.
    const probe = await fetch(`${base}/api/analyses/${activeId}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) });
    assert.equal(probe.status, 202, 'Server did not see isolated test identity/record; refusing cron.');
    assert.equal((await probe.json()).analysis.id, activeId);
    const denied = await fetch(`${base}/api/internal/cleanup`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(denied.status, 401);
    const response = await fetch(`${base}/api/internal/cleanup`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(55_000),
    });
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.cleaned, 1);
    assert.equal(report.failed, 0);
    assert.equal(report.remaining, 0);
    assert.equal(await prisma.analysis.findUnique({ where: { id: expiredId } }), null);
    assert.ok(await prisma.analysis.findUnique({ where: { id: activeId } }));
    assert.equal(await prisma.rateLimit.findUnique({ where: { key: expiredLimit } }), null);
    assert.ok(await prisma.rateLimit.findUnique({ where: { key: activeLimit } }));
    for (const objectPath of expiredPaths) {
      const { data } = await storage.storage.from(bucket).info(objectPath);
      assert.equal(data, null, 'Expired object survived cleanup.');
    }
    for (const objectPath of activePaths) {
      const { data, error } = await storage.storage.from(bucket).info(objectPath);
      assert.ok(data && !error, 'Active object was incorrectly deleted.');
    }
    console.log(JSON.stringify({ test: 'real-cleanup-http', unauthorizedStatus: 401, cleaned: report.cleaned,
      expiredObjectsRemoved: expiredPaths.length, activeObjectsPreserved: activePaths.length, rateLimitExpiryVerified: true, isolatedDatabase: true }));
  } finally {
    let cleanupFailed = false;
    try {
      if (allPaths.length) {
        const { error } = await storage.storage.from(bucket).remove(allPaths);
        cleanupFailed = !!error;
      }
      if (cleanupFailed) {
        // Leave private object paths available to a later authenticated cleanup.
        await prisma.analysis.updateMany({ where: { ownerId: owner }, data: { expiresAt: new Date(Date.now() - 1000) } });
      } else await prisma.analysis.deleteMany({ where: { ownerId: owner } });
      await prisma.rateLimit.deleteMany({ where: { key: { startsWith: `${owner}:` } } });
      await prisma.user.deleteMany({ where: { id: owner } });
    } finally { await prisma.$disconnect(); }
    if (cleanupFailed) throw new Error('Disposable Storage fixture cleanup failed; metadata retained for cron.');
  }
}

main().catch(() => {
  // Do not print provider exception bodies, URLs, keys or fixture session cookies.
  console.error('Retention integration failed. Verify the isolated DB/server, credentials and fixture cleanup.');
  process.exitCode = 1;
});
