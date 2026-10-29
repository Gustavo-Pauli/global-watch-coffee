# Prisma: schema preservado e migração segura

Atualizado em 29/10/2026. O runtime usa Prisma ORM **7.10.1**, `@prisma/adapter-pg` e o adapter oficial do Better Auth. A versão 8 estava publicada como release candidate na consulta; ela não foi adotada. Node mínimo continua 22.12.0. Python não recebe conexão de banco.

**Estado atual:** as duas migrations estão registradas no banco local da aplicação e no banco isolado de testes. O hardening `20261029090000_server_only_tables` foi aplicado no banco local somente após conferir `DATABASE_URL`/`DIRECT_URL`, destino `localhost:5435/global-watch-coffee`, ausência de políticas e role `postgres` proprietária/BYPASSRLS. `db:status` confirma atualização concluída; o usuário e a sessão existentes continuam legíveis. Nenhuma migration foi aplicada em PostgreSQL Supabase remoto; antes de publicar, revisar a role de runtime e os grants conforme o procedimento abaixo.

## Mapeamento e integridade

`apps/web/prisma/schema.prisma` representa as seis tabelas originais: `user`, `session`, `account`, `verification`, `app_analyses` e `app_rate_limits`. `@map`/`@@map` preservam colunas/tabelas físicas; tipos `TEXT`, `UUID`, `JSONB`, `DATE`, `TIMESTAMPTZ(6)`, índices existentes e FKs de sessão/conta são mantidos. Não foram adicionadas FKs de proprietário à tabela de análises: elas não existiam, e adicioná-las exige auditar registros órfãos previamente. Toda consulta pública de análise aplica proprietário e expiração.

A baseline `0_existing_schema/migration.sql` inclui os CHECKs PostgreSQL `input_source` e `app_analyses_status_check`, que não são representáveis no DSL Prisma. **Não substituir a baseline por uma nova geração sem manter esses CHECKs.** O arquivo `database.sql` anterior é referência histórica; novos ambientes usam as migrations Prisma, sem executar os dois inicializadores juntos.

## Banco existente: não reaplicar CREATE TABLE

1. Faça backup do banco e confirme o destino (local, homologação ou produção).
2. Configure `DATABASE_URL` no ambiente do servidor; para CLI use `DIRECT_URL` apontando para conexão direta ou pooler de sessão. Os comandos carregam `apps/web/.env.local` sem sobrescrever valores já fornecidos pelo ambiente.
3. Na raiz, execute `pnpm db:generate` e `pnpm db:validate`.
4. Confira o schema real com `pnpm --filter @global-watch/web exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`. Esperado: **No difference detected**, exit 0. O Prisma não compara CHECKs: confirme os dois CHECKs e as FKs no catálogo PostgreSQL ou no SQL Editor.
5. Somente com a conferência concluída, execute `pnpm db:baseline`. Isso cria/atualiza apenas `_prisma_migrations`, marcando a baseline já existente como aplicada; não executa seus `CREATE TABLE`.
6. Execute `pnpm db:status` e `pnpm db:deploy` para migrations futuras revisadas.

Se houver diferença, interrompa a aplicação e prepare uma migration aditiva revisável. **Não use `migrate reset`, `db push --accept-data-loss` nem marque baseline em um banco vazio.** Não há migração destrutiva necessária nesta alteração.

No banco local configurado (`localhost:5435`, `global-watch-coffee`), a inspeção de colunas, defaults, índices, FKs e CHECKs foi realizada; o diff retornou zero diferenças. A baseline foi marcada como aplicada. As tabelas e os dados existentes foram preservados. Isso **não** comprova migração de um banco Supabase de produção.

## Banco novo

Com a conexão de um banco vazio configurada, execute `pnpm db:deploy`. A baseline cria as seis tabelas, índices, FKs e CHECKs. Não executar `db:baseline` nessa situação.

## Runtime e Vercel

- `lib/db.ts` mantém um Prisma Client reutilizado no desenvolvimento e um pool pequeno de até duas conexões por instância ativa.
- Em Supabase serverless, use a conexão de pooler de transação para `DATABASE_URL`; use conexão direta/pooler de sessão em `DIRECT_URL` para CLI. Prisma 7 usa o driver `pg`; parâmetros antigos de pool do engine Prisma não configuram esse pool.
- `postinstall` e `build` executam `prisma generate`; build não executa migrations e nunca escreve no banco.
- Não desabilite validação TLS para contornar erro de certificado. Use URL/certificados fornecidos pelo projeto Supabase.
- `auth:migrate` permanece como alias de compatibilidade para `prisma migrate deploy`; o CLI `auth migrate` deixou de ser o proprietário do schema.

## Hardening da Data API: revisar antes de publicar

As tabelas de Better Auth contêm informações sensíveis, incluindo tokens de sessão e de provedores OAuth. Uma tabela no schema `public` pode ser exposta pela Data API se tiver grants apropriados, independentemente de as rotas Next.js verificarem proprietário. Não basta escrever em um comentário SQL que o acesso é exclusivo do servidor.

A documentação oficial Supabase descreve grants automáticos históricos para `anon`/`authenticated`; o rollout de mudança de defaults não remove grants de tabelas existentes. **Isso não prova exposição deste projeto remoto.** O PostgreSQL local inspecionado não possui essas roles nem Data API: suas seis tabelas estavam com RLS desabilitado e ACL padrão de proprietário, sem grants públicos confirmados. A role local `postgres` é proprietária, superuser e `BYPASSRLS`.

A segunda migration habilita RLS nas seis tabelas e revoga privilégios de `PUBLIC`, `anon` e `authenticated` (essas duas somente se existirem), sem criar políticas públicas. Ela é transacional e não altera dados. Se encontrar políticas existentes, aborta para revisão humana, em vez de removê-las silenciosamente. Não altera tabelas gerenciadas de `storage`, `auth` ou outros schemas Supabase.

**Preflight obrigatório com a conexão de runtime, antes de `pnpm db:deploy`:**

```sql
SELECT current_user, r.rolsuper, r.rolbypassrls
FROM pg_roles r WHERE r.rolname = current_user;

SELECT c.relname, pg_get_userbyid(c.relowner) AS table_owner,
       c.relrowsecurity, c.relforcerowsecurity,
       has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
       has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
       has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('user','session','account','verification','app_analyses','app_rate_limits');

SELECT * FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user','session','account','verification','app_analyses','app_rate_limits');
```

O servidor Prisma precisa conectar como proprietário dessas tabelas **ou** como role `BYPASSRLS` com grants explícitos de CRUD para as seis tabelas. Uma role comum sem políticas fica sem acesso às linhas. A chave `SUPABASE_SECRET_KEY` autentica o cliente Storage e **não** concede permissões à conexão PostgreSQL de `DATABASE_URL`. Não usar as roles públicas `anon`/`authenticated` no Prisma e não criar políticas públicas para corrigir erro de login.

Após aplicar, validar login/sessão, criação/leitura de análise, rate limiting e callback com a mesma role real. No Supabase, conferir negação de acesso às seis tabelas via Data API com chave publishable, sem imprimir dados de sessão/conta em testes. A suíte local verifica RLS e grants de catálogo, mas não equivale a essa prova remota.

**Backout seguro:** fazer backup de ACL/roles antes da aplicação. Se a role do servidor não tiver o acesso previsto, corrigir `DATABASE_URL`/permissões dessa role privada; não restaurar grants a `PUBLIC`, `anon` ou `authenticated` para contornar a falha. A migration não remove dados e o proprietário continua acessando. Uma reversão excepcional de RLS deve ser revisada manualmente, com a Data API desabilitada ou removida desses objetos, preservando as revogações públicas. Não há down migration automática que reabra tabelas sensíveis.

## Correções de segurança e concorrência

- A reserva da cota diária e a transição `uploading → processing` ficam na mesma transação serializável, com retry limitado para conflitos. IDs inválidos, análises de terceiros e starts duplicados não consomem a cota global. Rate limits usam `upsert`/incremento atômico via Prisma.
- As URLs de Storage são preparadas antes de reservar o job. Erro nessa preparação marca a análise como erro; timeout depois de envio ao worker permanece em processamento até callback tardio ou reconciliação em 12 minutos.
- Callbacks repetidos para o mesmo estado terminal retornam 200; um terminal diferente retorna 409. A atualização final é condicional e não transforma erro já finalizado em sucesso.
- JSON de mutações e callbacks tem limite real de stream de 16 KiB, MIME JSON obrigatório e rejeição de UTF-8/JSON inválido, arrays e envelopes vazios/nulos.
- Antes de emitir URLs assinadas, o servidor confere bucket privado e limite por objeto de até 12 MiB. Configure **12 MiB (12582912 bytes)** no bucket. O limite de SCL de 4 MiB também é conferido no start e no download do worker. Campos de tamanho fornecidos pelo browser não são tratados como prova do tamanho real.
- JSON vindo do Storage tem timeout e limite de stream de 4 MiB antes do parse.
- Cleanup processa até 200 registros expirados com orçamento de 45 segundos, mantém metadados se remover arquivos falhar e informa `remaining`. Acesso expira em três dias; remoção física depende da execução diária do cron e pode exigir repetição quando há backlog.

## Testes

`pnpm test:web` roda testes unitários de JSON, Origin e chat. A suíte de banco só executa com `TEST_DATABASE_URL` explícita e nome de banco contendo `test` ou `audit`. Ela nunca deve apontar para o banco usado pelo aplicativo.

Exemplo PowerShell, após criar um banco descartável e aplicar `pnpm db:deploy` nele:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@localhost:5435/global_watch_audit_test'
pnpm test:db
Remove-Item Env:TEST_DATABASE_URL
```

Execução local: as duas migrations foram aplicadas em `global_watch_audit_test`; **11 testes passaram**, incluindo 32 requisições concorrentes ao rate limiter, proprietário/expiração, abuso de cota por ID alheio, start duplicado, rollback por cota, callback idempotente, validação da data real de aquisição, CHECKs, flags RLS/grants/políticas e leitura/escrita de usuário/sessão pelo adapter oficial Better Auth. Apenas dados de teste com IDs próprios foram removidos. Essa suíte não equivale a um login OAuth real nem prova serviços externos.

## Fontes oficiais consultadas

- [Prisma 7 / driver adapters](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Configuração Prisma](https://docs.prisma.io/docs/orm/reference/prisma-config-reference)
- [Connection pool](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool)
- [Better Auth Prisma adapter](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/adapters/prisma.mdx)
- [Supabase grants e Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Mudança de defaults não revoga grants existentes](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
