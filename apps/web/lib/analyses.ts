import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma, type Analysis } from '@prisma/client';
import { prisma } from './db';
import { consumeLimit } from './rate-limit';
import { exists, inputPath, outputPath, OUTPUTS, signedRead, signedUpload } from './storage';
import { workerFetch } from './worker';

export const VALID_SCENES = ['august', 'july', 'october'] as const;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type AnalysisRecord = {
  id: string; owner_id: string; status: 'uploading'|'processing'|'ready'|'error';
  scene: string|null; acquisition_date: string|null; image_path: string|null;
  scl_path: string|null; result: Record<string,unknown>|null; error_code: string|null;
};
export class AnalysisError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

function apiRecord(row: Analysis): AnalysisRecord {
  return {
    id: row.id, owner_id: row.ownerId, status: row.status as AnalysisRecord['status'],
    scene: row.scene, acquisition_date: row.acquisitionDate?.toISOString().slice(0, 10) ?? null,
    image_path: row.imagePath, scl_path: row.sclPath,
    result: row.result as Record<string, unknown> | null, error_code: row.errorCode,
  };
}

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  const test = new Date(Date.UTC(y,m-1,d));
  return test.getUTCFullYear() === y && test.getUTCMonth() === m-1 && test.getUTCDate() === d;
}

export async function createAnalysis(user: string, scene: string|null, date: string|null, hasScl: boolean) {
  if (scene !== null && !VALID_SCENES.includes(scene as typeof VALID_SCENES[number])) throw new AnalysisError('Cena inválida.', 422);
  if (date !== null && !validDate(date)) throw new AnalysisError('Data inválida.', 422);
  const id = randomUUID();
  const imagePath = scene ? null : inputPath(user, id, 'image');
  const sclPath = hasScl && !scene ? inputPath(user, id, 'scl') : null;
  await prisma.analysis.create({ data: {
    id, ownerId: user, status: 'uploading', scene,
    acquisitionDate: date ? new Date(date + 'T00:00:00.000Z') : null, imagePath, sclPath,
  } });
  return { id, imagePath, sclPath };
}

export async function ownAnalysis(user: string, id: string): Promise<AnalysisRecord | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const row = await prisma.analysis.findFirst({ where: { id, ownerId: user, expiresAt: { gt: new Date() } } });
  return row ? apiRecord(row) : null;
}

export async function markError(id: string, errorCode: string) {
  await prisma.analysis.updateMany({ where: { id, status: { in: ['uploading', 'processing'] } },
    data: { status: 'error', errorCode, updatedAt: new Date() } });
}

/** Ownership, state transition, and global quota are one serializable transaction.
 * Duplicate/foreign/expired requests cannot spend the global quota. */
export async function claimAnalysis(user: string, id: string) {
  if (!UUID_PATTERN.test(id)) throw new AnalysisError('Análise não encontrada.', 404);
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const record = await tx.analysis.findFirst({ where: { id, ownerId: user, expiresAt: { gt: new Date() } } });
        if (!record) throw new AnalysisError('Análise não encontrada.', 404);
        if (record.status !== 'uploading') throw new AnalysisError('Esta análise já foi iniciada.', 409);
        const { count } = await tx.analysis.updateMany({ where: { id, ownerId: user, status: 'uploading' },
          data: { status: 'processing', updatedAt: new Date() } });
        if (count !== 1) throw new AnalysisError('Esta análise já foi iniciada.', 409);
        if (!await consumeLimit(tx, 'global', 'analysis', 10, 86400))
          throw new AnalysisError('Cota diária do serviço gratuito atingida. Tente amanhã.', 429);
        return record;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 4) continue;
      throw error;
    }
  }
}

/** Prepare capabilities before claiming a job; failures here cannot strand it in processing. */
export async function startAnalysis(user: string, id: string) {
  const record = await ownAnalysis(user, id);
  if (!record) throw new AnalysisError('Análise não encontrada.', 404);
  if (record.status !== 'uploading') throw new AnalysisError('Esta análise já foi iniciada.', 409);
  if (record.image_path && !await exists(record.image_path, 12 * 1024 * 1024))
    throw new AnalysisError('Envie o GeoTIFF antes de iniciar a análise.', 409);
  if (record.scl_path && !await exists(record.scl_path, 4 * 1024 * 1024))
    throw new AnalysisError('Envie a máscara SCL antes de iniciar a análise.', 409);
  const uploads: Record<string,string> = {};
  let imageUrl: string | null, sclUrl: string | null;
  try {
    for (const kind of Object.keys(OUTPUTS) as (keyof typeof OUTPUTS)[])
      uploads[kind] = (await signedUpload(outputPath(user,id,kind))).signedUrl;
    imageUrl = record.image_path ? await signedRead(record.image_path, 1200) : null;
    sclUrl = record.scl_path ? await signedRead(record.scl_path, 1200) : null;
  } catch (error) {
    await prisma.analysis.updateMany({ where: { id, ownerId: user, status: 'uploading' },
      data: { status: 'error', errorCode: 'storage_unavailable', updatedAt: new Date() } });
    throw error;
  }
  await claimAnalysis(user, id);
  // A network timeout can occur AFTER worker acceptance. Leave processing for a
  // late callback; stale-job reconciliation records interruption after 12 minutes.
  const response = await workerFetch('/internal/process', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id, scene:record.scene, date:record.acquisition_date,
      image_url:imageUrl, scl_url:sclUrl, uploads }),
  });
  if (!response.ok) {
    await markError(id, response.status === 503 ? 'worker_busy' : 'worker_rejected');
    return { ok: false, status: response.status === 503 ? 503 : 502 };
  }
  return { ok: true, status: 202 };
}

/** A sleeping/restarted free worker cannot leave an eternal processing spinner. */
export async function failStaleJobs(owner: string) {
  const now = new Date();
  await prisma.analysis.updateMany({ where: { ownerId: owner, status: 'processing', updatedAt: { lt: new Date(now.getTime()-12*60_000) } },
    data: { status: 'error', errorCode: 'worker_timeout', updatedAt: now } });
  await prisma.analysis.updateMany({ where: { ownerId: owner, status: 'uploading', updatedAt: { lt: new Date(now.getTime()-2*60*60_000) } },
    data: { status: 'error', errorCode: 'upload_expired', updatedAt: now } });
}
