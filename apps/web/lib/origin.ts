import 'server-only';

/** Protege mutações que usam cookies de sessão contra Origin de outro site. */
export function originAllowed(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';
  try {
    const expected = process.env.BETTER_AUTH_URL;
    if (!expected) return false;
    return new URL(origin).origin === new URL(expected).origin;
  } catch { return false; }
}
