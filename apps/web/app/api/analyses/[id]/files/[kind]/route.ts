import { sessionUserId } from '@/lib/session';
import { workerFetch, relayJson, failureResponse } from '@/lib/worker';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  const owner = await sessionUserId();
  if (!owner) return Response.json({ detail: 'Não autorizado.' }, { status: 401 });
  const { id, kind } = await context.params;
  const types: Record<string, { mime: string; name: string }> = {
    geojson: { mime: 'application/geo+json', name: 'candidatos.geojson' },
    classified: { mime: 'image/png', name: 'imagem_classificada.png' },
    map: { mime: 'image/png', name: 'imagem_mapa.png' },
    rgb: { mime: 'image/png', name: 'imagem_rgb.png' },
    tif: { mime: 'image/tiff', name: 'classificacao.tif' },
  };
  if (!/^[0-9a-f-]{36}$/.test(id) || !types[kind]) return Response.json({ detail: 'Arquivo desconhecido.' }, { status: 404 });
  try {
    const res = await workerFetch(owner, `/internal/analyses/${id}/files/${kind}`);
    if (!res.ok) return relayJson(res);
    const { mime, name } = types[kind];
    return new Response(res.body, { status: 200, headers: {
      'Content-Type': mime, 'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    }});
  } catch (error) { return failureResponse(error); }
}
