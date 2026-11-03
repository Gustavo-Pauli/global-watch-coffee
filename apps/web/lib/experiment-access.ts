import 'server-only';
import { ExperimentError } from './experiments';

export type ExperimentUser = { id: string; email: string; emailVerified: boolean; name: string };
type AccessEnvironment = { EXPERIMENT_USER_EMAILS?: string; EXPERIMENT_USER_IDS?: string };

/** Default-deny; email grants require a verified email from the database. */
export function experimentUserAllowed(user: ExperimentUser | null, environment: AccessEnvironment = {
  EXPERIMENT_USER_EMAILS: process.env.EXPERIMENT_USER_EMAILS,
  EXPERIMENT_USER_IDS: process.env.EXPERIMENT_USER_IDS,
}) {
  if (!user) return false;
  const ids = new Set((environment.EXPERIMENT_USER_IDS || '').split(',').map(value => value.trim()).filter(Boolean));
  const emails = new Set((environment.EXPERIMENT_USER_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  return ids.has(user.id) || (user.emailVerified && emails.has(user.email.toLowerCase()));
}

export async function getExperimentAccess(requestHeaders?: Headers): Promise<{ user: ExperimentUser | null; allowed: boolean }> {
  const { auth } = await import('./auth');
  const incoming = requestHeaders ?? await (await import('next/headers')).headers();
  // This explicitly bypasses Better Auth's optional cookie session cache.
  const session = await auth.api.getSession({ headers: incoming, query: { disableCookieCache: true } });
  if (!session?.user.id) return { user: null, allowed: false };
  const { prisma } = await import('./db');
  const user = await prisma.user.findUnique({ where: { id: session.user.id },
    select: { id: true, email: true, emailVerified: true, name: true } });
  return { user, allowed: experimentUserAllowed(user) };
}

export async function requireExperimentUser(request: Request): Promise<ExperimentUser> {
  const access = await getExperimentAccess(request.headers);
  if (!access.user) throw new ExperimentError('Entre com Google.', 401);
  if (!access.allowed) throw new ExperimentError('Acesso restrito à experimentação.', 403);
  return access.user;
}
