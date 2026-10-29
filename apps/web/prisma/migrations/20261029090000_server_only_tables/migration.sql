-- These are private server-owned application/Better Auth tables. Browser users
-- authenticate to Next.js, not to the Supabase Data API. Never grant public
-- clients access to OAuth tokens, session tokens, or other users' analyses.
-- No rows, columns, indexes, or ownership are changed by this migration.
BEGIN;

DO $hardening$
DECLARE
  table_name text;
  client_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['user','session','account','verification','app_analyses','app_rate_limits']
  LOOP
    -- This application has no Data API policies. Do not silently remove or
    -- override a policy installed by another application/operator.
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    ) THEN
      RAISE EXCEPTION 'Unexpected RLS policies on public.%; review before server-only hardening', table_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);

    -- Supabase provides these roles; plain local PostgreSQL does not.
    FOREACH client_role IN ARRAY ARRAY['anon','authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, client_role);
      END IF;
    END LOOP;
  END LOOP;
END;
$hardening$;

COMMIT;
