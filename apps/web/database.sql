-- Aplique uma vez no Supabase SQL Editor após migrar as tabelas Better Auth.
-- O Next.js é a única autoridade para identidades, análises e rate limits.
CREATE TABLE IF NOT EXISTS app_analyses (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 days'),
  status TEXT NOT NULL CHECK (status IN ('uploading','processing','ready','error')),
  scene TEXT,
  acquisition_date DATE,
  image_path TEXT,
  scl_path TEXT,
  result JSONB,
  error_code TEXT,
  CONSTRAINT input_source CHECK ((scene IS NOT NULL AND image_path IS NULL) OR (scene IS NULL AND image_path IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS app_analyses_owner_created ON app_analyses(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_analyses_expires ON app_analyses(expires_at);
CREATE TABLE IF NOT EXISTS app_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS app_rate_limits_expires_idx ON app_rate_limits(expires_at);
-- Sem permissões RLS para anon/authenticated: acesso via Next.js autenticado, PostgreSQL server-side.
