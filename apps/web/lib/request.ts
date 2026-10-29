import 'server-only';

export class BodyError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** Bound the stream itself, not a client-controlled Content-Length header. */
export async function readJsonBody(request: Request, limit = 16 * 1024): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new BodyError('Use Content-Type application/json.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError('JSON inválido.', 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new BodyError('Requisição acima do limite.', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new BodyError('JSON inválido.', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BodyError('Informe um objeto JSON.', 422);
    return body as Record<string, unknown>;
  } finally { reader.releaseLock(); }
}

export async function jsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  try { return await readJsonBody(request); }
  catch (error) {
    if (error instanceof BodyError) return Response.json({ detail: error.message }, { status: error.status });
    throw error;
  }
}
