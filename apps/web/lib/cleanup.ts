import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ALL_OUTPUTS, outputPath } from './storage';

export type CleanupRow = { id: string; ownerId: string; imagePath: string | null; sclPath: string | null };
export type CleanupRepository = {
  findExpired: (cutoff: Date, take: number) => Promise<CleanupRow[]>;
  deleteExpired: (id: string, cutoff: Date) => Promise<number>;
  deleteExpiredLimits: (cutoff: Date) => Promise<void>;
  countExpired: (cutoff: Date) => Promise<number>;
};

export function cronAuthorized(request: Request, secret: string | undefined) {
  const actual = request.headers.get('authorization');
  if (!secret || !actual) return false;
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(actual);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Shared by the route and integration fixtures; no global client or credentials. */
export function cleanupRepository(db: Pick<PrismaClient, 'analysis' | 'rateLimit'>): CleanupRepository {
  return {
    findExpired: (cutoff, take) => db.analysis.findMany({
      where: { expiresAt: { lt: cutoff } }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], take,
      select: { id: true, ownerId: true, imagePath: true, sclPath: true },
    }),
    deleteExpired: async (id, cutoff) => (await db.analysis.deleteMany({ where: { id, expiresAt: { lt: cutoff } } })).count,
    deleteExpiredLimits: async cutoff => { await db.rateLimit.deleteMany({ where: { expiresAt: { lt: cutoff } } }); },
    countExpired: cutoff => db.analysis.count({ where: { expiresAt: { lt: cutoff } } }),
  };
}

/** Storage deletion must finish before its metadata is removed. A failed or
 * timed-out row stays retryable; one thrown failure must not abort later rows. */
export async function cleanupExpired(deps: {
  repository: CleanupRepository;
  removeObjects: (paths: string[], timeoutMs: number) => Promise<void>;
  now?: () => number;
}, options: { budgetMs?: number; batchSize?: number } = {}) {
  const now = deps.now ?? Date.now;
  const started = now(), cutoff = new Date(started), deadline = started + (options.budgetMs ?? 45_000);
  const repository = deps.repository;
  let cleaned = 0, failed = 0;
  const rows = await repository.findExpired(cutoff, options.batchSize ?? 200);
  for (const row of rows) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    const paths = [row.imagePath, row.sclPath, ...(Object.keys(ALL_OUTPUTS) as (keyof typeof ALL_OUTPUTS)[])
      .map(kind => outputPath(row.ownerId, row.id, kind))].filter((value): value is string => !!value);
    try {
      await deps.removeObjects(paths, Math.min(10_000, remainingMs));
      // If a dependency overruns its signal, leave metadata for the next cron.
      if (now() >= deadline) { failed++; break; }
      cleaned += await repository.deleteExpired(row.id, cutoff);
    } catch { failed++; }
  }
  await repository.deleteExpiredLimits(cutoff);
  const remaining = await repository.countExpired(cutoff);
  return { cleaned, failed, remaining };
}
