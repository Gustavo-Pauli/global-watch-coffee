-- Executar UMA vez no mesmo PostgreSQL usado pelo Better Auth.
-- As tabelas de autenticação são criadas pelo comando npm run auth:migrate.
CREATE TABLE IF NOT EXISTS app_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS app_rate_limits_expires_idx ON app_rate_limits(expires_at);
-- Limpeza periódica opcional: DELETE FROM app_rate_limits WHERE expires_at < NOW();
