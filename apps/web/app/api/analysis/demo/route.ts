import { originAllowed } from '@/lib/origin';
import { sessionUserId } from '@/lib/session';
import { workerFetch, relayJson, failureResponse } from '@/lib/worker';
import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(request: Request) {
  if (!originAllowed(request)) return Response.json({ detail: 'Origem não autorizada.' }, { status: 403 });
  const owner = await sessionUserId();
  if (!owner) return Response.json({ detail: 'Entre com Google.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !['august', 'july', 'october'].includes(body.scene))
    return Response.json({ detail: 'Cena não reconhecida.' }, { status: 422 });
  if (!await rateLimit(owner, 'analysis', 5, 3600))
    return Response.json({ detail: 'Limite de 5 análises por hora.' }, { status: 429 });
  try {
    const res = await workerFetch(owner, '/internal/analysis/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: body.scene }) });
    return relayJson(res);
  } catch (error) { return failureResponse(error); }
}
