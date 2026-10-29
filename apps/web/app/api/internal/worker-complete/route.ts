import { timingSafeEqual } from 'node:crypto';
import { pool } from '@/lib/auth';
import { OUTPUTS, exists, outputPath, readJson } from '@/lib/storage';
export const runtime='nodejs';

function trusted(request: Request) {
  const configured=process.env.WORKER_SECRET;
  const actual=request.headers.get('x-worker-token');
  if (!configured || !actual) return false;
  const a=Buffer.from(configured); const b=Buffer.from(actual);
  return a.length===b.length && timingSafeEqual(a,b);
}
export async function POST(request:Request) {
  if (!trusted(request)) return Response.json({detail:'Não autorizado.'},{status:401});
  const body=await request.json().catch(()=>null);
  if (!body || typeof body.id!=='string' || !/^[0-9a-f-]{36}$/i.test(body.id) ||
      !['ready','error'].includes(body.status)) return Response.json({detail:'Callback inválido.'},{status:422});
  const {rows}=await pool.query<{owner_id:string;status:string}>(
    `SELECT owner_id,status FROM app_analyses WHERE id=$1 LIMIT 1`,[body.id]);
  const record=rows[0];
  if (!record || record.status!=='processing') return Response.json({detail:'Tarefa não encontrada ou finalizada.'},{status:409});
  if (body.status==='error') {
    await pool.query(`UPDATE app_analyses SET status='error',error_code='processing_failed',updated_at=NOW()
      WHERE id=$1 AND status='processing'`,[body.id]);
    return Response.json({ok:true});
  }
  try {
    const user=record.owner_id;
    // Do not trust any computed data in a callback. Read Python-generated files in private Storage.
    for (const kind of Object.keys(OUTPUTS) as (keyof typeof OUTPUTS)[])
      if (!await exists(outputPath(user,body.id,kind))) throw new Error('Output missing');
    const result=await readJson(outputPath(user,body.id,'result'));
    if (!result || typeof result!=='object' || !Number.isFinite(Number((result as Record<string,unknown>).candidate_area_ha)))
      throw new Error('Resultado inválido');
    await pool.query(`UPDATE app_analyses SET status='ready',result=$2,updated_at=NOW()
      WHERE id=$1 AND status='processing'`,[body.id,JSON.stringify(result)]);
    return Response.json({ok:true});
  } catch {
    // Leave processing to allow retry of callback / monitoring; never claim a partial success.
    return Response.json({detail:'Arquivos incompletos.'},{status:503});
  }
}
