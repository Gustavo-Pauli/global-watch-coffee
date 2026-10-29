import 'server-only';
import { pool } from './auth';

/** Janela fixa de rate limiting atômica, compartilhada entre instâncias Next.js. */
export async function rateLimit(user: string, action: string, max: number, windowSeconds: number) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${user}:${action}:${bucket}`;
  const result = await pool.query<{ count: number }>(
    `INSERT INTO app_rate_limits (key, count, expires_at)
     VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 second'))
     ON CONFLICT (key) DO UPDATE SET count = app_rate_limits.count + 1
     RETURNING count`, [key, windowSeconds * 2]);
  return result.rows[0].count <= max;
}
