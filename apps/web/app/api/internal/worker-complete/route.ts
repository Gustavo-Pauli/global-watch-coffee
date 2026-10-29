import { timingSafeEqual } from 'node:crypto';
import { completeAnalysis } from '@/lib/completion';
import { UUID_PATTERN } from '@/lib/analyses';
import { jsonBody } from '@/lib/request';
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
  const body=await jsonBody(request);
  if(body instanceof Response)return body;
  if(typeof body.id!=='string'||!UUID_PATTERN.test(body.id)||(body.status!=='ready'&&body.status!=='error'))
    return Response.json({detail:'Callback inválido.'},{status:422});
  const result=await completeAnalysis(body.id,body.status);
  return result.status===200?Response.json({ok:true}):Response.json({detail:result.detail},{status:result.status});
}
