import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, parse } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';

type Environment = Record<string, string | undefined>;
type Mode = 'local' | 'production';
type Check = { name: string; status: 'pass' | 'fail' | 'skip' | 'warn'; code: string; details?: Record<string, boolean | number> };
const tables = ['user', 'session', 'account', 'verification', 'app_analyses', 'app_rate_limits'];
const required = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'SUPABASE_URL', 'PYTHON_WORKER_URL', 'WORKER_SECRET', 'CRON_SECRET', 'GEMINI_API_KEY'];
const maxObjectBytes = 12 * 1024 * 1024;

export function isLocalHost(host: string) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const mapped = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return isLocalHost(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
  }
  return value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value === '::1' ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(value) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(value) ||
    /^(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(value);
}

export function validServiceURL(value: string | undefined, mode: Mode): URL | null {
  try {
    const url = new URL(value || '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    if (mode === 'production' && (url.protocol !== 'https:' || isLocalHost(url.hostname))) return null;
    if (url.protocol === 'http:' && !isLocalHost(url.hostname)) return null;
    return url;
  } catch { return null; }
}

export function checkEnvironment(env: Environment, mode: Mode): Check[] {
  const checks: Check[] = required.map(name => ({ name, status: env[name]?.trim() ? 'pass' : 'fail', code: env[name]?.trim() ? 'configured' : 'missing' }));
  checks.push({ name: 'SUPABASE_ADMIN_KEY', status: (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim() ? 'pass' : 'fail', code: (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim() ? 'configured_server_only' : 'missing' });
  for (const name of ['BETTER_AUTH_SECRET', 'WORKER_SECRET', 'CRON_SECRET']) {
    const valid = (env[name]?.length ?? 0) >= 32 && !/^(?:ci-|placeholder|gere_|segredo_|mesma_)/i.test(env[name] || '');
    checks.push({ name: `${name}_STRENGTH`, status: valid ? 'pass' : 'fail', code: valid ? 'length_and_placeholder_check_passed' : 'weak_or_placeholder' });
  }
  for (const name of ['BETTER_AUTH_URL', 'PYTHON_WORKER_URL', 'SUPABASE_URL']) {
    const valid = validServiceURL(env[name], mode);
    checks.push({ name: `${name}_FORMAT`, status: valid ? 'pass' : 'fail', code: valid ? 'valid_origin' : 'invalid_or_disallowed_origin' });
  }
  let databaseValid = false, localDatabase = false;
  try { const url = new URL(env.DATABASE_URL || ''); databaseValid = ['postgres:', 'postgresql:'].includes(url.protocol) && !!url.hostname && !!url.pathname.slice(1); localDatabase = isLocalHost(url.hostname); } catch { /* sanitized below */ }
  checks.push({ name: 'DATABASE_URL_FORMAT', status: databaseValid && (mode !== 'production' || !localDatabase) ? 'pass' : 'fail', code: databaseValid && (mode !== 'production' || !localDatabase) ? 'valid_database_target' : 'invalid_or_local_production_database', details: { localDatabase } });
  if (env.DIRECT_URL) {
    let directValid = false;
    try { const url = new URL(env.DIRECT_URL); directValid = ['postgres:', 'postgresql:'].includes(url.protocol) && !!url.hostname && !!url.pathname.slice(1) && (mode !== 'production' || !isLocalHost(url.hostname)); } catch { /* sanitized below */ }
    checks.push({ name: 'DIRECT_URL_FORMAT', status: directValid ? 'pass' : 'fail', code: directValid ? 'valid_cli_target_shape_only' : 'invalid_cli_target' });
  }
  checks.push({ name: 'CLI_RUNTIME_DATABASE_EQUIVALENCE', status: 'warn', code: 'direct_or_session_pooler_target_requires_operator_verification' });
  checks.push({ name: 'GOOGLE_CLIENT_FORMAT', status: /^[\w-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID || '') ? 'pass' : 'fail', code: /^[\w-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID || '') ? 'web_client_shape_only' : 'invalid_client_shape' });
  checks.push({ name: 'GOOGLE_REDIRECT_URI', status: validServiceURL(env.BETTER_AUTH_URL, mode) ? 'warn' : 'fail', code: 'console_registration_requires_manual_verification' });
  checks.push({ name: 'GEMINI_REAL_CALL', status: 'skip', code: 'not_called_by_read_only_preflight' });
  return checks;
}

export function migrationChecksumMatches(source: string, checksum: string) {
  // Prisma migrations can be checked out on Windows with CRLF; accept either
  // line-ending representation, never a changed SQL statement.
  const lf = source.replace(/\r\n/g, '\n');
  return [source, lf, lf.replace(/\n/g, '\r\n')].some(text => createHash('sha256').update(text).digest('hex') === checksum);
}

async function databaseChecks(env: Environment, webRoot: string): Promise<Check[]> {
  if (!env.DATABASE_URL) return [{ name: 'DATABASE_CATALOG', status: 'skip', code: 'database_not_configured' }];
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 10_000 }), log: [] });
  try {
    const catalog = await prisma.$queryRaw<{
      table_name: string; rls: boolean; can_crud: boolean; can_bypass: boolean; public_grants: bigint; client_grants: bigint; policy_count: bigint;
    }[]>`SELECT c.relname AS table_name, c.relrowsecurity AS rls,
      (has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
       AND has_table_privilege(current_user,c.oid,'UPDATE') AND has_table_privilege(current_user,c.oid,'DELETE')) AS can_crud,
      (r.rolsuper OR r.rolbypassrls OR (c.relowner=r.oid AND NOT c.relforcerowsecurity)) AS can_bypass,
      (SELECT count(*) FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS public_grants,
      (SELECT count(*) FROM pg_roles client WHERE client.rolname IN ('anon','authenticated') AND
        (has_table_privilege(client.oid,c.oid,'SELECT') OR has_table_privilege(client.oid,c.oid,'INSERT') OR
         has_table_privilege(client.oid,c.oid,'UPDATE') OR has_table_privilege(client.oid,c.oid,'DELETE') OR
         has_table_privilege(client.oid,c.oid,'TRUNCATE') OR has_table_privilege(client.oid,c.oid,'REFERENCES') OR has_table_privilege(client.oid,c.oid,'TRIGGER'))) AS client_grants,
      (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policy_count
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.rolname=current_user
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('user','session','account','verification','app_analyses','app_rate_limits')`;
    const allTables = catalog.length === tables.length;
    const roleValid = allTables && catalog.every(row => row.can_crud && row.can_bypass);
    const rlsValid = allTables && catalog.every(row => row.rls && !Number(row.public_grants) && !Number(row.client_grants) && !Number(row.policy_count));
    const checks: Check[] = [
      { name: 'DATABASE_TABLES', status: allTables ? 'pass' : 'fail', code: allTables ? 'six_private_tables_present' : 'missing_private_tables', details: { tableCount: catalog.length } },
      { name: 'DATABASE_RUNTIME_ROLE', status: roleValid ? 'pass' : 'fail', code: roleValid ? 'crud_and_owner_or_bypass_confirmed' : 'runtime_role_would_be_blocked' },
      { name: 'DATABASE_RLS', status: rlsValid ? 'pass' : 'fail', code: rlsValid ? 'private_server_only_catalog_confirmed' : 'public_grants_or_policies_or_missing_rls' },
    ];
    const integrity = await prisma.$queryRaw<{ check_count: bigint; fk_count: bigint; index_count: bigint }[]>`SELECT
      (SELECT count(*) FROM pg_constraint p WHERE p.conrelid='public.app_analyses'::regclass AND p.contype='c' AND p.convalidated AND p.conname IN ('input_source','app_analyses_status_check')) AS check_count,
      (SELECT count(*) FROM pg_constraint p WHERE p.connamespace='public'::regnamespace AND p.contype='f' AND p.convalidated AND p.conname IN ('session_userId_fkey','account_userId_fkey')) AS fk_count,
      (SELECT count(*) FROM pg_indexes p WHERE p.schemaname='public' AND p.indexname IN ('user_email_key','session_token_key','session_userId_idx','account_userId_idx','verification_identifier_idx','app_analyses_owner_created','app_analyses_expires','app_rate_limits_expires_idx')) AS index_count`;
    const flags = { checksPresent: Number(integrity[0].check_count) === 2, foreignKeysPresent: Number(integrity[0].fk_count) === 2, indexesPresent: Number(integrity[0].index_count) === 8 };
    checks.push({ name: 'DATABASE_CONSTRAINTS_INDEXES', status: Object.values(flags).every(Boolean) ? 'pass' : 'fail', code: 'named_catalog_objects_checked', details: flags });
    try {
      const applied = await prisma.$queryRaw<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations`;
      const directories = (await readdir(resolve(webRoot, 'prisma/migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory());
      let correct = true;
      for (const directory of directories) {
        const source = await readFile(resolve(webRoot, 'prisma/migrations', directory.name, 'migration.sql'), 'utf8');
        const records = applied.filter(record => record.migration_name === directory.name && record.finished_at && !record.rolled_back_at);
        if (records.length !== 1 || !migrationChecksumMatches(source, records[0].checksum)) correct = false;
      }
      const successful = applied.filter(record => record.finished_at && !record.rolled_back_at);
      if (successful.length !== directories.length || applied.some(record => !record.finished_at && !record.rolled_back_at)) correct = false;
      checks.push({ name: 'DATABASE_MIGRATIONS', status: correct ? 'pass' : 'fail', code: correct ? 'applied_and_checksums_match' : 'pending_failed_unknown_or_changed_migration', details: { expected: directories.length, applied: successful.length } });
    } catch { checks.push({ name: 'DATABASE_MIGRATIONS', status: 'fail', code: 'migration_metadata_unavailable' }); }
    return checks;
  } catch { return [{ name: 'DATABASE_CATALOG', status: 'fail', code: 'connection_or_catalog_check_failed' }]; }
  finally { await prisma.$disconnect(); }
}

async function storageChecks(env: Environment, mode: Mode): Promise<Check[]> {
  if (!validServiceURL(env.SUPABASE_URL, mode) || !(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)) return [{ name: 'STORAGE_BUCKET', status: 'skip', code: 'valid_storage_configuration_required' }];
  try {
    const client = createClient(env.SUPABASE_URL!, (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }) },
    });
    const { data, error } = await client.storage.getBucket(env.SUPABASE_STORAGE_BUCKET || 'geo-private');
    if (error || !data) return [{ name: 'STORAGE_BUCKET', status: 'fail', code: 'bucket_unavailable_or_key_rejected' }];
    const details = { privateBucket: !data.public, limitAllowsApplicationMaximum: Number(data.file_size_limit) === maxObjectBytes };
    return [{ name: 'STORAGE_BUCKET', status: Object.values(details).every(Boolean) ? 'pass' : 'fail', code: 'private_bucket_and_12_mib_ceiling_checked', details }];
  } catch { return [{ name: 'STORAGE_BUCKET', status: 'fail', code: 'storage_connection_or_configuration_failed' }]; }
}

async function healthCheck(name: string, base: URL | null, path: string, worker: boolean): Promise<Check> {
  if (!base) return { name, status: 'skip', code: 'valid_origin_required' };
  try {
    const response = await fetch(new URL(path, base), { redirect: 'error', signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!response.ok || !response.body) return { name, status: 'fail', code: 'health_endpoint_rejected', details: { httpStatus: response.status } };
    const reader = response.body.getReader(); let body = '', bytes = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 16_384) { await reader.cancel(); throw new Error('limit'); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    const data = JSON.parse(body);
    const valid = data.status === 'ok' && (worker ? data.model_available === true && data.internal_worker === true : data.service === 'global-watch-web');
    return { name, status: valid ? 'pass' : 'fail', code: valid ? 'liveness_only_confirmed' : 'unexpected_health_contract' };
  } catch { return { name, status: 'fail', code: 'unreachable_timeout_redirect_or_invalid_health' }; }
}

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find(arg => arg.startsWith('--mode='))?.slice(7) || 'local';
  if (!['local', 'production'].includes(modeArg) || args.some(arg => !/^--mode=(?:local|production)$|^--skip-health$|^--env-file=.+$/.test(arg))) {
    console.log(JSON.stringify({ preflightPassed: false, code: 'invalid_arguments', usage: '--mode=local|production [--skip-health] [--env-file=PATH]' })); process.exitCode = 2; return;
  }
  const mode = modeArg as Mode;
  const webRoot = resolve(__dirname, '..');
  const envFile = args.find(arg => arg.startsWith('--env-file='))?.slice(11);
  if (envFile || mode === 'local') {
    const loaded = config({ path: envFile ? resolve(envFile) : resolve(webRoot, '.env.local'), quiet: true });
    if (loaded.error) { console.log(JSON.stringify({ preflightPassed: false, code: 'environment_file_unavailable' })); process.exitCode = 2; return; }
  }
  const env = process.env;
  const checks = checkEnvironment(env, mode);
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  checks.unshift({ name: 'NODE_RUNTIME', status: (nodeMajor === 22 && nodeMinor >= 12) || nodeMajor >= 24 ? 'pass' : 'fail', code: 'prisma_supported_runtime_floor_checked', details: { nodeMajor, nodeMinor } });
  if (mode === 'local') {
    try {
      const worker = parse(await readFile(resolve(webRoot, '../geo-worker/.env')));
      const details = { sharedSecretMatches: !!env.WORKER_SECRET && worker.WORKER_SECRET === env.WORKER_SECRET,
        storageOriginMatches: !!env.SUPABASE_URL && worker.SUPABASE_URL?.replace(/\/$/, '') === env.SUPABASE_URL.replace(/\/$/, ''),
        callbackOriginMatches: !!env.BETTER_AUTH_URL && worker.NEXT_CALLBACK_URL?.replace(/\/$/, '') === env.BETTER_AUTH_URL.replace(/\/$/, ''),
        noAdministrativeKeyInWorker: !worker.SUPABASE_SECRET_KEY && !worker.SUPABASE_SERVICE_ROLE_KEY && !worker.DATABASE_URL };
      checks.push({ name: 'LOCAL_WORKER_CONFIGURATION', status: Object.values(details).every(Boolean) ? 'pass' : 'fail', code: 'local_files_compared_without_output', details });
    } catch { checks.push({ name: 'LOCAL_WORKER_CONFIGURATION', status: 'fail', code: 'worker_env_unavailable' }); }
  }
  checks.push(...await databaseChecks(env, webRoot), ...await storageChecks(env, mode));
  if (args.includes('--skip-health')) checks.push({ name: 'HEALTH_ENDPOINTS', status: 'skip', code: 'explicitly_skipped' });
  else checks.push(...await Promise.all([
    healthCheck('APPLICATION_HEALTH', validServiceURL(env.BETTER_AUTH_URL, mode), '/api/health', false),
    healthCheck('WORKER_HEALTH', validServiceURL(env.PYTHON_WORKER_URL, mode), '/health', true),
  ]));
  const blockers = checks.filter(check => check.status === 'fail').length;
  console.log(JSON.stringify({ mode, readOnly: true, preflightPassed: blockers === 0, readyForRelease: false,
    blockers, checks, manualVerificationRequired: ['google_oauth_console_and_real_login', 'gemini_real_grounded_response_and_quota', 'worker_callback_and_cold_start', 'public_domain_end_to_end', 'provider_free_plan_and_retention_cron'] }, null, 2));
  process.exitCode = blockers ? 1 : 0;
}

if (typeof require !== 'undefined' && require.main === module) void main().catch(() => {
  console.log(JSON.stringify({ preflightPassed: false, readyForRelease: false, code: 'preflight_internal_failure' })); process.exitCode = 2;
});
