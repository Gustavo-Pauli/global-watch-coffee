import 'server-only';

export function workerConfig() {
  const base = process.env.PYTHON_WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !/^https?:\/\//.test(base)) throw new Error('PYTHON_WORKER_URL inválida.');
  if (!secret || secret.length < 32) throw new Error('WORKER_SECRET ausente ou fraco.');
  return { base: base.replace(/\/+$/, ''), secret };
}

export async function workerFetch(owner: string, path: string, init: RequestInit = {}) {
  const { base, secret } = workerConfig();
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(path)) throw new Error('Caminho interno inválido.');
  const headers = new Headers(init.headers);
  headers.set('X-Worker-Token', secret);
  headers.set('X-Owner-Id', owner);
  return fetch(base + path, {
    ...init,
    headers,
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(115_000),
  });
}

export async function relayJson(response: Response) {
  const body = await response.json().catch(() => ({ detail: 'Serviço indisponível.' }));
  // Não envia cabeçalhos do worker nem stacktrace aos clientes.
  return Response.json(body, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
}

export function failureResponse(error: unknown) {
  console.error('[internal worker] falha na requisição', error instanceof Error ? error.name : 'unknown');
  return Response.json({ detail: 'Serviço geoespacial temporariamente indisponível.' }, { status: 502 });
}
