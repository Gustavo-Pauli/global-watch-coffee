import 'server-only';

/** Server-to-server secret; never forwarded to the browser. */
export async function workerFetch(path: string, init: RequestInit = {}) {
  const base = process.env.PYTHON_WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !/^https?:\/\//.test(base)) throw new Error('PYTHON_WORKER_URL inválida.');
  if (!secret || secret.length < 32) throw new Error('WORKER_SECRET ausente ou fraco.');
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(path)) throw new Error('Caminho interno inválido.');
  const headers = new Headers(init.headers);
  headers.set('X-Worker-Token', secret);
  return fetch(base.replace(/\/+$/, '') + path, {
    ...init, headers, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(100_000),
  });
}
export function failureResponse(error: unknown) {
  console.error('[geo-worker]', error instanceof Error ? error.name : 'unknown');
  return Response.json({detail:'Serviço geoespacial temporariamente indisponível.'},{status:502});
}
