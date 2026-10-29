import { originAllowed } from '@/lib/origin';
import { sessionUserId } from '@/lib/session';
import { startAnalysis, AnalysisError } from '@/lib/analyses';
import { failureResponse } from '@/lib/worker';
import { jsonBody } from '@/lib/request';
export const runtime='nodejs';
export const maxDuration=120;
export async function POST(request: Request) {
  if (!originAllowed(request)) return Response.json({detail:'Origem não autorizada.'},{status:403});
  const owner=await sessionUserId();
  if (!owner) return Response.json({detail:'Entre com Google.'},{status:401});
  const body=await jsonBody(request);
  if (body instanceof Response) return body;
  if (typeof body.id !== 'string') return Response.json({detail:'ID inválido.'},{status:422});
  try {
    const outcome=await startAnalysis(owner,body.id);
    if (!outcome.ok) return Response.json({detail:'Worker ocupado ou indisponível.'},{status:outcome.status});
    return Response.json({id:body.id,status:'processing'},{status:202});
  } catch (error) {
    if (error instanceof AnalysisError) return Response.json({detail:error.message},{status:error.status});
    return failureResponse(error);
  }
}
