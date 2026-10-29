import { sessionUserId } from '@/lib/session';
import { workerFetch, relayJson, failureResponse } from '@/lib/worker';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await sessionUserId();
  if (!owner) return Response.json({ detail: 'Não autorizado.' }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ detail: 'ID inválido.' }, { status: 404 });
  try { return relayJson(await workerFetch(owner, `/internal/analyses/${id}`)); }
  catch (error) { return failureResponse(error); }
}
