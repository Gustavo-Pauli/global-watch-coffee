import { originAllowed } from '@/lib/origin';
import { sessionUserId } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { createAnalysis, startAnalysis, VALID_SCENES, AnalysisError, markError } from '@/lib/analyses';
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
  if (typeof body.scene !== 'string' || !VALID_SCENES.some(scene=>scene===body.scene))
    return Response.json({detail:'Cena não reconhecida.'},{status:422});
  if (!await rateLimit(owner,'analysis',5,3600)) return Response.json({detail:'Limite de cinco análises por hora.'},{status:429});
  let id: string | undefined;
  try {
    const created=await createAnalysis(owner,body.scene,null,false); id=created.id;
    const outcome=await startAnalysis(owner,created.id);
    if (!outcome.ok) return Response.json({detail:'Worker ocupado ou indisponível.'},{status:outcome.status});
    return Response.json({id:created.id,status:'processing'},{status:202});
  } catch (error) {
    if (error instanceof AnalysisError) {
      if(id) await markError(id,'start_rejected');
      return Response.json({detail:error.message},{status:error.status});
    }
    return failureResponse(error);
  }
}
