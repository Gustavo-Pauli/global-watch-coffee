# Migração do seu monorepo no Windows / Git Bash

**Esta versão substitui o SQLite do geo-worker por PostgreSQL + Supabase Storage.** Sua pasta `apps/geo-worker/.venv` deve continuar onde já está; não precisa ser recriada.

1. **Antes de copiar o patch**, faça backup ou commit das suas mudanças locais (`git status`). Extraia o patch na raiz, substituindo arquivos de código; ele não contém nem sobrescreve `.env` ou `.venv`.
2. Atualize o ambiente Python: `source apps/geo-worker/.venv/Scripts/activate` e `python -m pip install -e './apps/geo-worker[dev]'`. Isso também fixa a versão scikit-learn 1.8.0 do modelo v2.
3. Na raiz do monorepo execute `pnpm install` para gerar `pnpm-lock.yaml` e instalar `@supabase/supabase-js`.
4. Crie projeto Supabase Free e bucket **privado** `geo-private`. Use Postgres já configurado para Better Auth (pode ser o mesmo Supabase). Preencha somente **em `apps/web/.env.local`**: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `CRON_SECRET`. Confira também Better Auth, Google, Gemini e worker URL.
5. No **`apps/geo-worker/.env`**, mantenha `WORKER_SECRET` idêntico ao Next, acrescente `SUPABASE_URL` e `NEXT_CALLBACK_URL=http://localhost:3000` (em produção, URL Vercel). **NÃO coloque service-role no worker**.
6. Crie tabelas (`pnpm --filter @global-watch/web auth:migrate` e `apps/web/database.sql` no SQL Editor do Supabase). O SQL é aditivo, não apaga sessões existentes.
7. Inicie em dois terminais: `pnpm dev:worker` e `pnpm dev:web`.
8. Primeiro valide `python -m pytest apps/geo-worker/tests -q`; depois teste login Google, demo agosto, upload GeoTIFF+SCL e chatbot pelo navegador.
9. Revise `git diff`; confirme que `.env`, `.env.local`, `.venv` e chaves não estão no commit. Faça `git add -A`, `git commit -m 'refactor: stateless geo worker and private storage'` e `git push origin main`. O repositório conectado `Gustavo-Pauli/global-watch-coffee` ainda estava privado na consulta; é necessário alterar sua visibilidade para **Public** antes da entrega.

**Atenção:** o upload mudou de `POST multipart /api/analysis/upload` para `POST JSON` de pré-autorização, upload direto ao Storage e `POST /api/analysis/start`. Sem as novas variáveis e tabelas, o aplicativo não funcionará; configure primeiro as contas grátis.

Consulte [guia completo](DEPLOY.md). A pasta `.storage/` e o antigo SQLite são legados locais e não são mais utilizados. A mudança não importa histórico de análises antigas do SQLite, que era efêmero.
