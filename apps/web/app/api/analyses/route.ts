import { sessionUserId } from '@/lib/session';
import { workerFetch, relayJson, failureResponse } from '@/lib/worker';
export const runtime = 'nodejs';
export async function GET() {
  const owner = await sessionUserId();
  if (!owner) return Response.json({ detail: 'Entre com Google.' }, { status: 401 });
  try { return relayJson(await workerFetch(owner, '/internal/analyses')); }
  catch (error) { return failureResponse(error); }
}
