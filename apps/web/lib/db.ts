import 'server-only';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL obrigatório (PostgreSQL).');
  // Each warm Vercel instance reuses one small pool. Use the Supabase transaction
  // pooler in DATABASE_URL and a direct/session URL only for migrations.
  const adapter = new PrismaPg({ connectionString, max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
  // Callers log sanitized error categories; avoid emitting query/connection data.
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
