# Implantação gratuita · checklist operacional

**Situação:** código preparado, **NÃO há URL pública configurada**; testes OAuth/Gemini/Storage/Render/Vercel reais ainda precisam ser executados. Não confundir testes locais do worker com aprovação do deploy.

## Contas e custos

- Vercel Hobby para Next.js (verificar política de uso, especialmente se o desafio pode ser considerado atividade comercial).
- Render Free para FastAPI; suspende após 15 minutos sem tráfego, reativa com atraso (~1 min), disco **efêmero**. Não usar SQLite.
- Supabase Free para **um PostgreSQL e um bucket Storage privado**. Plano Free com limite 50 MB por objeto (a aplicação limita a 12/4 MiB). Cotas de armazenamento/egresso e pausa por inatividade existem.
- Google Cloud OAuth Web Application (seu cliente Google) e chave Gemini com cota disponível. O avaliador usa apenas sua conta Google; **não precisa fornecer chaves nem pagar**.

## 1. Supabase (obrigatório para fluxo novo)

1. Crie o projeto no plano Free, região próxima ao Render. Copie a **Postgres connection string** (`DATABASE_URL`, preferir pooler adequado ao ambiente serverless, conforme instrução Supabase), `SUPABASE_URL` e a chave **service_role** (somente Vercel).
2. No Storage, crie bucket privado `geo-private`. Não habilite acesso público e não crie política de upload anônimo; Next cria URLs assinadas com a chave exclusiva do servidor.
3. Configure a quota global no painel Storage para pelo menos 12 MiB (limite total Free 50 MB).
4. Com `apps/web/.env.local` preenchido, execute **na raiz do monorepo**:
   ```bash
   pnpm install
   pnpm --filter @global-watch/web auth:migrate
   ```
   Inspecione a migração de Better Auth e confirme as tabelas. Em seguida cole `apps/web/database.sql` no SQL Editor do mesmo projeto Supabase (não precisa criar banco à parte).
5. Configure `CRON_SECRET` para remover dados vencidos. O endpoint `/api/internal/cleanup` aceita apenas `Authorization: Bearer <CRON_SECRET>`; `apps/web/vercel.json` agenda execução diária.

## 2. Google OAuth e Gemini

- Crie OAuth Client tipo **Web application** e configure callback de desenvolvimento `http://localhost:3000/api/auth/callback/google`, além do URL de produção `https://SEU-SITE.vercel.app/api/auth/callback/google`.
- Em Vercel defina `BETTER_AUTH_URL=https://SEU-SITE.vercel.app`, `BETTER_AUTH_SECRET` forte, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Configure `GEMINI_API_KEY` na Vercel para respostas **realmente generativas**; sem ela, o site mostra explicitamente um fallback baseado em regras (isso sozinho NÃO satisfaz a exigência do chatbot com IA).
- Nunca forneça `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_SECRET`, `BETTER_AUTH_SECRET`, Google Client Secret ou Gemini API key ao cliente/browser.

## 3. Worker Python no Render (cuidado: repositório raiz)

Na criação de Web Service **Free** conecte o mesmo GitHub e configure:

| Campo | Valor |
|---|---|
| Root Directory | **deixar VAZIO** (raiz do repositório) |
| Runtime | Python |
| Build Command | `pip install -e apps/geo-worker` |
| Start Command | `uvicorn geo_worker.server:app --host 0.0.0.0 --port $PORT` |
| Health Check | `/health` |
| Python | 3.12 recomendada |

Não use `apps/geo-worker` como Root Directory, pois `data/sample`, `data/additional` e `data/unseen` ficam fora dessa pasta e as cenas de demonstração não funcionariam.

Variáveis Render: `WORKER_SECRET` (aleatório com >=32 caracteres), `SUPABASE_URL` e `NEXT_CALLBACK_URL=https://SEU-SITE.vercel.app`. **Não** forneça `SUPABASE_SERVICE_ROLE_KEY` ao worker. Pode usar o `render.yaml` da raiz como referência. Verifique `/health`: `model_available=true`.

O worker só recebe requisições autenticadas com `X-Worker-Token`; seu `/health` é público.

## 4. Next.js Vercel

- Importe GitHub como projeto Next.js com **Root Directory `apps/web`**. Habilite detecção de pnpm workspace/Turbo. Use Node >=22.12. O lockfile `pnpm-lock.yaml` deve ser gerado com `pnpm install` na raiz e commitado.
- Env Vercel: `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=geo-private`, `PYTHON_WORKER_URL=https://SEU-WORKER.onrender.com`, `WORKER_SECRET` (a **mesma** do Render), `GEMINI_API_KEY` e `CRON_SECRET`.
- `WORKER_SECRET` também deve ser idêntico no endpoint que recebe callback. Verifique logs de callback se status não mudar.

## 5. Testes pela URL pública (obrigatório antes do envio)

- [ ] Login e logout reais com Google; sessão recuperada após refresh; usuário diferente não acessa histórico, GeoJSON nem links de download.
- [ ] Botões de agosto e julho geram **novas tarefas reais**, não outputs pré-calculados; classe de saída não é café comprovado.
- [ ] Upload TIFF 4 bandas + SCL faz upload direto para Storage e retorna `processing`/depois `ready`, incluindo após cold start Render.
- [ ] Upload inválido retorna erro controlado, sem armazenar dados com status `ready`.
- [ ] Mapa Leaflet mostra GeoJSON, sobreposição, legenda, data e hectares; links baixar PNG/TIFF/GeoJSON funcionam.
- [ ] Chat Gemini responde usando somente números da análise (sem inventar área) e distingue limitações; conferir resposta `type=ai_grounded`.
- [ ] `GET` de análise e arquivos de outro usuário retorna 404. POST sem cookie ou token retorna 401/403.
- [ ] Testar limite de tamanho e rate limiting, incluindo cota global diária de 10 análises.
- [ ] Verificar RAM/CPU e tempo no Render Free. Se passar de 512 MB, reduzir tamanho máximo de pixels e documentar.
- [ ] Testar remoção automática/expiração de dados, retenção anunciada de 3 dias; verificar mensagens de tarefas interrompidas.
- [ ] Revisar desktop/celular, GitHub público, README, nota de 2 páginas, uso de IA e vídeo <=3 minutos.

## Falhas conhecidas e contingência

- Render Free pode reiniciar enquanto está processando; tarefa em memória é cancelada, não há fila durável. Status vira erro após 12 minutos de ausência de callback; reprocessar manualmente.
- Cota total 10 análises/dia e limite de arquivos se destinam a proteger o plano gratuito; alterar quotas exige rever uso de 1 GB Storage.
- Dados de terceiros vão para bucket **privado** com URLs assinadas temporárias; URLs assinadas podem ser usadas por quem as obtiver até a expiração.
- Sem `pnpm-lock.yaml` no commit, build do CI poderá resolver versões diferentes do ambiente local.

Documentação oficial: [Render Free](https://render.com/docs/free), [Vercel limite 4,5MB](https://vercel.com/docs/errors/function_payload_too_large), [Supabase URLs assinadas](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl), [Better Auth PostgreSQL](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/adapters/postgresql.mdx).
