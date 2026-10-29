import { originAllowed } from '@/lib/origin';
import { rateLimit } from '@/lib/rate-limit';
import { sessionUserId } from '@/lib/session';
import { startAnalysis } from '@/lib/analyses';
import { failureResponse } from '@/lib/worker';
export const runtime='nodejs';
export const maxDuration=120;
export async function POST(request: Request) {
  if (!originAllowed(request)) return Response.json({detail:'Origem não autorizada.'},{status:403});
  const owner=await sessionUserId();
  if (!owner) return Response.json({detail:'Entre com Google.'},{status:401});
  const body=await request.json().catch(()=>null);
  if (typeof body?.id !== 'string') return Response.json({detail:'ID inválido.'},{status:422});
  try {
    if (!await rateLimit('global','analysis',10,86400))
      return Response.json({detail:'Cota diária do serviço gratuito atingida. Tente amanhã.'},{status:429});
    const outcome=await startAnalysis(owner,body.id);
    if (!outcome.ok) return Response.json({detail:'Worker ocupado ou indisponível.'},{status:outcome.status});
    return Response.json({id:body.id,status:'processing'},{status:202});
  } catch (error) {
    if (error instanceof Error && /Análise não encontrada|já iniciada|Envie/.test(error.message))
      return Response.json({detail:error.message},{status:409});
    return failureResponse(error);
  }
}
