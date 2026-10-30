import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.chdir(fileURLToPath(new URL('../', import.meta.url)));

function run(module, args) {
  const result = spawnSync(process.execPath, [require.resolve(module), ...args], {
    stdio: 'inherit', env: process.env,
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

// Preview deployments must never migrate the production database.
if (process.env.VERCEL_ENV === 'production') {
  const connection = process.env.DATABASE_URL;
  if (!connection) throw new Error('Configure DATABASE_URL in Vercel Production before deploying.');
  let url;
  try { url = new URL(connection); }
  catch { throw new Error('DATABASE_URL is not a valid PostgreSQL URI.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('DATABASE_URL must point to the remote PostgreSQL database.');
  }
  process.env.DIRECT_URL = connection;
  run('prisma/build/index.js', ['migrate', 'deploy']);
}

run('prisma/build/index.js', ['generate']);
run('next/dist/bin/next', ['build']);
