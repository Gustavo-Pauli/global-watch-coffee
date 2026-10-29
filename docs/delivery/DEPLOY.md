# Publicação — monorepo Next.js + Python

**Situação:** ainda não publicado. Esta documentação é um procedimento de implantação, não prova de deploy.

## Visão geral

- **Next.js App Router:** Vercel; Root Directory do projeto: `apps/web`.
- **Python FastAPI:** Render (Web Service); Root Directory: `apps/geo-worker`.
- **Dados e modelos:** estão na **raiz do mesmo repositório**, em `data/` e `apps/geo-worker/models/`. O Render clona o repositório inteiro, portanto o worker poderá ler as entradas pela localização calculada pelo pacote.
- **PostgreSQL:** provedor de sua escolha, usado no Better Auth e rate limit.
- **Google:** OAuth Web application com callbacks de desenvolvimento e produção.

## 1. Banco e autenticação

1. Crie PostgreSQL. Defina `DATABASE_URL` somente no ambiente do Next.js.
2. Rode `pnpm --filter @global-watch/web auth:migrate` localmente para gerar/aplicar migração de Better Auth e revise o SQL.
3. Aplique `apps/web/database.sql` no mesmo banco, por exemplo usando `psql`.
4. Em Google Cloud Console, autorize `http://localhost:3000/api/auth/callback/google` e `https://SEU-DOMINIO/api/auth/callback/google`.

## 2. Worker Python no Render

Na criação do serviço, configure:

- **Root Directory:** `apps/geo-worker`
- **Build Command:** `pip install .`
- **Start Command:** `uvicorn geo_worker.server:app --host 0.0.0.0 --port $PORT`
- **Variáveis de ambiente:** `WORKER_SECRET` (chave aleatória >=32 caracteres), `RETENTION_DAYS=7`.

O pacote Python e seus modelos ficam dentro da root configurada. O caminho para `data/` é resolvido a partir da posição instalada no checkout. Atenção: `pip install .` sem editable instala o código em site-packages, fazendo os caminhos baseados em `__file__` apontarem para fora do repositório. **Por isso, use `pip install -e .` no Render** ou configure os caminhos por variáveis explícitas com outro empacotamento.

**Build Command final:** `pip install -e .`.

O `/health` pode ser público. Todas as rotas `/internal/*` exigem `X-Worker-Token` e `X-Owner-Id` enviados pelo Next.js. Nunca exponha `WORKER_SECRET` ao browser.

## 3. Next.js na Vercel

- Importe **o mesmo repositório GitHub** na Vercel e configure Root Directory como `apps/web`.
- Framework Preset: Next.js; Node >=22.12.
- Build padrão: `next build` (com pnpm workspace, Vercel deverá reconhecer `pnpm-lock.yaml` na raiz quando este for gerado).
- Variáveis: `DATABASE_URL`, `BETTER_AUTH_URL=https://SEU-DOMINIO`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PYTHON_WORKER_URL=https://SEU-WORKER.onrender.com`, `WORKER_SECRET` (mesma chave do Render) e `GEMINI_API_KEY`.
- Não prefixe segredos com `NEXT_PUBLIC_`.

## 4. Verificação pública obrigatória

1. Testar login Google, sessão persistente, logout e URL em janela anônima.
2. Processar agosto e julho pelos botões (cenas efetivamente reprocessadas) e upload de TIFF com SCL.
3. Conferir polígonos no Leaflet, hectares, PNG, TIFF e GeoJSON.
4. Chat Gemini real referenciando os dados daquela análise. Sem chave, há apenas contingência.
5. Testar usuário B tentando acessar arquivos do usuário A, uploads inválidos e limites de uso.
6. Testar desktop e celular, timeout/cold start Render e gravação do vídeo de <= 3 minutos.

## Limitações do protótipo

- Upload Next limitado a 4 MB por imagem + 256 KB de SCL, em atenção ao limite de payload Vercel.
- Render Free pode suspender a instância, atrasar resposta e apagar resultados salvos no disco local.
- O worker guarda metadados e imagens temporários em SQLite/disco local; para maior estabilidade seria preciso storage persistente e fila.
- O processamento sincronizado pode atingir timeout ao acordar o serviço; validar na URL antes de entregar.

Consulte os termos atuais da [Vercel](https://vercel.com/docs/errors/function_payload_too_large) e do [Render](https://render.com/docs/free).
