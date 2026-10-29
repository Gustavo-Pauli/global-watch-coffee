import 'server-only';
import { randomUUID } from 'node:crypto';
import { pool } from './auth';
import { exists, inputPath, outputPath, OUTPUTS, signedRead, signedUpload } from './storage';
import { workerFetch } from './worker';

export const VALID_SCENES = ['august', 'july', 'october'] as const;
export type AnalysisRecord = {
  id: string; owner_id: string; status: 'uploading'|'processing'|'ready'|'error';
  scene: string|null; acquisition_date: string|null; image_path: string|null;
  scl_path: string|null; result: Record<string,unknown>|null; error_code: string|null;
};

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  const test = new Date(Date.UTC(y,m-1,d));
  return test.getUTCFullYear() === y && test.getUTCMonth() === m-1 && test.getUTCDate() === d;
}

export async function createAnalysis(user: string, scene: string|null, date: string|null, hasScl: boolean) {
  const id = randomUUID();
  const imagePath = scene ? null : inputPath(user, id, 'image');
  const sclPath = hasScl && !scene ? inputPath(user, id, 'scl') : null;
  await pool.query(
    `INSERT INTO app_analyses(id,owner_id,status,scene,acquisition_date,image_path,scl_path)
     VALUES ($1,$2,'uploading',$3,$4,$5,$6)`,
    [id,user,scene,date,imagePath,sclPath]
  );
  return { id, imagePath, sclPath };
}

export async function ownAnalysis(user: string, id: string): Promise<AnalysisRecord | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await pool.query<AnalysisRecord>(
    `SELECT id,owner_id,status,scene,acquisition_date::TEXT,image_path,scl_path,result,error_code
     FROM app_analyses WHERE id=$1 AND owner_id=$2 AND expires_at>NOW() LIMIT 1`,[id,user]);
  return rows[0] || null;
}

export async function markError(id: string, errorCode: string) {
  await pool.query(`UPDATE app_analyses SET status='error',error_code=$2,updated_at=NOW()
    WHERE id=$1 AND status IN ('uploading','processing')`,[id,errorCode]);
}

/** Start an asynchronous job; the worker calls /api/internal/worker-complete afterwards. */
export async function startAnalysis(user: string, id: string) {
  const record = await ownAnalysis(user, id);
  if (!record || record.status !== 'uploading') throw new Error('Análise não encontrada ou já iniciada.');
  if (record.image_path && !await exists(record.image_path, 12 * 1024 * 1024))
    throw new Error('Envie o GeoTIFF antes de iniciar a análise.');
  if (record.scl_path && !await exists(record.scl_path, 4 * 1024 * 1024))
    throw new Error('Envie a máscara SCL antes de iniciar a análise.');
  const { rowCount } = await pool.query(
    `UPDATE app_analyses SET status='processing',updated_at=NOW()
     WHERE id=$1 AND owner_id=$2 AND status='uploading'`,[id,user]);
  if (rowCount !== 1) throw new Error('Esta análise já foi iniciada.');
  try {
    const uploads: Record<string,string> = {};
    for (const kind of Object.keys(OUTPUTS) as (keyof typeof OUTPUTS)[])
      uploads[kind] = (await signedUpload(outputPath(user,id,kind))).signedUrl;
    const response = await workerFetch('/internal/process', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        id, scene:record.scene, date:record.acquisition_date,
        image_url:record.image_path ? await signedRead(record.image_path, 1200) : null,
        scl_url:record.scl_path ? await signedRead(record.scl_path, 1200) : null,
        uploads,
      }),
    });
    if (!response.ok) {
      await markError(id, response.status === 503 ? 'worker_busy' : 'worker_rejected');
      return { ok: false, status: response.status === 503 ? 503 : 502 };
    }
    return { ok: true, status: 202 };
  } catch (err) {
    // Timeout pode ocorrer DEPOIS de o Render aceitar o job. Mantenha 'processing'
    // para que um callback tardio ainda possa finalizar a tarefa corretamente.
    throw err;
  }
}

/** A sleeping/restarted free worker cannot leave an eternal processing spinner. */
export async function failStaleJobs(owner: string) {
  await pool.query(`UPDATE app_analyses SET status='error',error_code='worker_timeout',updated_at=NOW()
    WHERE owner_id=$1 AND status='processing' AND updated_at<NOW()-INTERVAL '12 minutes'`,[owner]);
  await pool.query(`UPDATE app_analyses SET status='error',error_code='upload_expired',updated_at=NOW()
    WHERE owner_id=$1 AND status='uploading' AND updated_at<NOW()-INTERVAL '2 hours'`,[owner]);
}
