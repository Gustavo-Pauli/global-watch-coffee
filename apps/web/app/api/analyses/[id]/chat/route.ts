import { originAllowed } from '@/lib/origin';
import { sessionUserId } from '@/lib/session';
import { ownAnalysis } from '@/lib/analyses';
import { readJson, outputPath } from '@/lib/storage';
import { rateLimit } from '@/lib/rate-limit';
import { reportFacts } from '@/lib/chat';
import { groundedAnswer } from '@/lib/gemini';
import { jsonBody } from '@/lib/request';
export const runtime = 'nodejs';
export const maxDuration = 35;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!originAllowed(request)) return Response.json({ detail: 'Origem não autorizada.' }, { status: 403 });
  const owner = await sessionUserId();
  if (!owner) return Response.json({ detail: 'Entre com Google.' }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ detail: 'Análise não encontrada.' }, { status: 404 });
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const question = body?.question;
  if (typeof question !== 'string' || question.trim().length < 2 || question.length > 1200)
    return Response.json({ detail: 'Pergunta deve ter entre 2 e 1200 caracteres.' }, { status: 422 });
  if (!await rateLimit(owner, 'chat', 12, 60))
    return Response.json({ detail: 'Limite de perguntas por minuto.' }, { status: 429 });
  let facts;
  try {
    const row=await ownAnalysis(owner,id);
    if (!row) return Response.json({detail:'Análise não encontrada.'},{status:404});
    if (row.status !== 'ready' || !row.result)
      return Response.json({detail:'O processamento ainda não terminou.'},{status:409});
    const geojson=await readJson(outputPath(owner,id,'geojson'));
    facts=reportFacts({result:row.result,geojson});
  } catch {
    return Response.json({detail:'Resultados indisponíveis.'},{status:503});
  }
  return Response.json(await groundedAnswer(question, facts));
}
