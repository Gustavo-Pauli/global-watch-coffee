import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from './db';

type RateLimitClient = Pick<Prisma.TransactionClient, 'rateLimit'>;

/** PostgreSQL upsert + increment is atomic across server instances. */
export async function consumeLimit(db: RateLimitClient, user: string, action: string, max: number, windowSeconds: number, now = new Date()) {
  const bucket = Math.floor(now.getTime() / (windowSeconds * 1000));
  const key = `${user}:${action}:${bucket}`;
  const result = await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, expiresAt: new Date(now.getTime() + windowSeconds * 2000) },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return result.count <= max;
}

export function rateLimit(user: string, action: string, max: number, windowSeconds: number) {
  return consumeLimit(prisma, user, action, max, windowSeconds);
}
