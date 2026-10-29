# Atualização do repositório existente

Repositório conectado identificado em 29/10/2026: **`Gustavo-Pauli/global-watch-coffee`** (`main`). Ao consultar a conta, sua visibilidade era **private**. O desafio exige **GitHub público**.

O projeto deve ser atualizado nesse mesmo repositório, não é necessário criar outro.

Depois de aplicar o patch na sua pasta local (consulte `MIGRACAO_LOCAL.md`):

```bash
# Terminal Git Bash na raiz do projeto
pnpm install                  # gera/atualiza pnpm-lock.yaml
python -m pytest apps/geo-worker/tests -q
pnpm --filter @global-watch/web build

git status                    # revise arquivos e mudanças locais
git diff --check
git add -A
git diff --cached --stat
# Confirme: nenhum .env, nenhuma chave, nenhum .venv, nenhum node_modules

git commit -m "refactor: stateless geoprocessing and private Supabase Storage"
git push origin main
```

Após o push, abra **GitHub → global-watch-coffee → Settings → General → Danger Zone → Change repository visibility → Public**. Verifique que é o repositório correto, que não existem secrets no histórico do Git e que a política do desafio permite tornar públicos os dados e arquivos; o kit Sentinel-2 já traz atribuição no repositório.

Cheque que o repo contém `apps/web`, `apps/geo-worker`, `data`, `docs`, `render.yaml`, `apps/web/vercel.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml` e que a CI executa `python -m pytest` e o build Next.js.

Não publique segredos (`SUPABASE_SERVICE_ROLE_KEY`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `WORKER_SECRET`, `CRON_SECRET`). O `.gitignore` exclui `.env`, `.env.local`, `.venv`, caches e SQLite. `*.joblib` só são carregados de arquivos próprios, sem fazer unpickle de uploads.

A atualização ao GitHub **não é automática com o ZIP**: deve ser aplicada e enviada a partir do repositório local, preservando suas alterações. O conector disponível nesta conversa não oferece sincronização direta do ZIP do contêiner com o repositório existente.
