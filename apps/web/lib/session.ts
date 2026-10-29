import 'server-only';
import { headers } from 'next/headers';
import { auth } from './auth';

export async function sessionUserId(): Promise<string | null> {
  // Verifica a sessão no BANCO, não apenas a presença de cookie.
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}
