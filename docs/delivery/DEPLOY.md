# Deploy gratuito e verificação pública

Guia revisado em 29/10/2026. A auditoria prepara o código e verifica fluxos locais; **não foi autorizado nem executado deploy**. Os planos gratuitos atendem à demonstração com limites e indisponibilidades, sem garantia de produção contínua.

## 1. Pré-requisitos e segredos

Use o mesmo PostgreSQL para Prisma/Better Auth/análises. No Supabase, mantenha Storage privado `geo-private`, limite por objeto **12582912 bytes**, sem política de upload anônimo. O app verifica configuração privada e limite antes de emitir URLs. A chave administrativa atual é `SUPABASE_SECRET_KEY=sb_secret_...`; o nome legado continua aceito apenas por compatibilidade. Nunca envie a chave administrativa ao worker ou browser.

Configure no Next: `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `PYTHON_WORKER_URL`, `WORKER_SECRET`, `CRON_SECRET` e `GEMINI_API_KEY`. `GEMINI_MODEL` é opcional; o padrão é `gemini-3.5-flash-lite`. Disponibilidade e cota precisam ser confirmadas no projeto Google. O app não habilita cobrança nem provisiona serviços pagos.

Para os fundos Satélite/Ruas, configure `NEXT_PUBLIC_MAPTILER_KEY` no ambiente de build web. É uma chave pública de navegador: restrinja as origens no painel MapTiler e inclua o domínio publicado. Mudanças exigem novo build. Sem ela, a imagem processada e os polígonos continuam disponíveis, com Sem mapa. Confira cotas/permissões da conta para os endpoints usados; não se presume raster gratuito indefinidamente. Fontes, atribuição e semântica de datas: [MAPAS_E_DATAS.md](MAPAS_E_DATAS.md).

Para o CLI Prisma, use `DIRECT_URL` com conexão direta ou pooler de sessão quando `DATABASE_URL` usar o transaction pooler. A configuração CLI carrega `.env.local` sem sobrepor variáveis do ambiente. Copie os endpoints corretos do painel; não reduza validação TLS para contornar certificados.

O runtime usa Prisma com adapter PostgreSQL e pool de duas conexões por instância. Isso limita cada instância, não a soma de todas as instâncias Vercel: monitore o limite global do Supabase. [Guia Prisma/Supabase](https://supabase.com/docs/guides/database/prisma).

## 2. Migração segura

1. Exporte backup no provedor e registre contagem de usuários/sessões/análises.
2. `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm db:validate`.
3. Banco novo vazio: `pnpm db:deploy`.
4. Banco existente: siga a comparação/baseline em [PRISMA_MIGRATION.md](PRISMA_MIGRATION.md). Somente após provar equivalência, marque `0_existing_schema` como aplicada; não execute esse CREATE TABLE sobre tabelas existentes.
5. `pnpm db:status`; confira dados e sessões após subir o app.

Não rode `migrate reset`, `db push`, `auth@latest migrate` ou o SQL histórico por tentativa. O build gera o Prisma Client; **não aplica migrations em produção automaticamente**.

## 3. Worker no Render Free

| Campo | Valor |
|---|---|
| Root Directory | Vazio; raiz do monorepo |
| Runtime / Python | Python 3.12 |
| Build Command | `pip install -e apps/geo-worker` |
| Start Command | `uvicorn geo_worker.server:app --host 0.0.0.0 --port $PORT --workers 1` |
| Plan / Health | Free / `/health` |

As pastas `data` e `models` devem existir no checkout; não mova a raiz para `apps/geo-worker`. `render.yaml` registra a configuração. O `.venv` local não entra no deploy.

Variáveis: `WORKER_SECRET` idêntico ao Next, `SUPABASE_URL` e `NEXT_CALLBACK_URL=https://SEU-SITE.vercel.app`. Modelo v2 incluso; `COFFEE_MODEL` é override administrativo, nunca valor de upload. Não forneça credenciais PostgreSQL, chave Supabase administrativa ou sessão de usuário ao worker.

Confirme `/health` com `model_available=true`, um job real, callback e os seis arquivos. O worker aceita só URLs assinadas do projeto configurado, autentica antes de ler o JSON, limita corpos, rasters e concorrência. Não é uma fila durável: reiniciar cancela a tarefa em memória; a aplicação marca ausência de callback como erro após o prazo.

Render Free suspende após **15 minutos sem tráfego recebido**, leva cerca de um minuto para acordar e perde alterações no disco local. Há 750 horas gratuitas por workspace/mês e limites de transferência/build. Não acrescente tráfego artificial para impedir suspensão. [Render Free](https://render.com/docs/free). O plano de 512 MiB precisa de teste real Linux; medições locais constam em [AUDITORIA_GEO.md](AUDITORIA_GEO.md) e não provam o consumo no Render.

## 4. Next.js na Vercel Hobby

Importe o repositório existente manualmente, framework Next.js, **Root Directory `apps/web`**, Node 22.12 ou superior. Preserve acesso aos arquivos do workspace fora dessa raiz e a detecção pnpm/Turbo. Instalação recomendada na raiz: `pnpm install --frozen-lockfile`; build do pacote: `pnpm --filter @global-watch/web build`. Não crie outro projeto apenas para contornar a configuração do monorepo. [Turborepo/Vercel](https://vercel.com/docs/monorepos/turborepo).

Cadastre variáveis separadas para Production e Preview. `BETTER_AUTH_URL` deve ser a URL exata do ambiente e `NEXT_CALLBACK_URL` do worker deve corresponder a ela. Não compartilhe indiscriminadamente dados reais de produção com previews. Adicione a URI Google `https://SEU-SITE.vercel.app/api/auth/callback/google` ao mesmo client ID usado nesse ambiente; mantenha também a URI local se necessário.

O upload direto ao Storage evita o teto de **4,5 MB de corpo** das funções. TIFF não transita pelo Next. Rotas JSON pequenas têm limites próprios. Com Fluid Compute, Hobby permite até 300s por função; o app usa prazos menores e responde ao início do job sem esperar a classificação. Esse teto não resolve perda de tarefas no worker. [Limites Vercel](https://vercel.com/docs/functions/limitations), [duração](https://vercel.com/docs/functions/configuring-functions/duration).

`apps/web/vercel.json` agenda `/api/internal/cleanup` uma vez ao dia, compatível com Hobby. Configure `CRON_SECRET`; a Vercel envia `Authorization: Bearer ...`. Cron Hobby tem precisão por hora e não execução exata. Os dados vencidos ficam inacessíveis ao usuário após três dias; arquivos podem permanecer até a limpeza seguinte e eventuais novas tentativas. [Cron Hobby](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Supabase Free inclui 500 MB de banco e 1 GB de Storage; o limite global de upload pode chegar a 50 MB, mas este aplicativo exige 12 MiB por objeto. Consulte a cota vigente e configure o teto no bucket, não apenas no navegador. [Cotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [limites de arquivos](https://supabase.com/docs/guides/storage/uploads/file-limits).

## 5. Gate manual antes da entrega

- Login Google real, logout, sessão após refresh e callback correto no domínio público.
- Demo agosto e julho, upload multiespectral + SCL, GeoJSON/overlay/áreas e todos os downloads reais.
- Usuário B recebe 404 para análise, arquivos e chat de A; requisições sem sessão retornam 401/403.
- Gemini retorna `type=ai_grounded` com chave/cota reais. Contingência `rules_fallback_not_ai` não satisfaz sozinha o requisito de IA.
- Cold start e reinício Render, job interrompido e erro por timeout, concorrência e limites.
- RAM máxima no Render Free com a maior entrada admitida; validar também SCL e arquivos comprimidos.
- Cron remove só vencidos e mantém metadata quando há erro de Storage; conferir logs sem URLs assinadas/chaves.
- Desktop e celular, teclado, contraste, estados vazios/erro, mapa e popups.
- Pesquisa PDF de até duas páginas, atribuições/licenças dos dados, vídeo <=3 minutos e visibilidade GitHub revisados pelo usuário.

Não existe confirmação automática de URL pública, vídeo entregue, visibilidade do GitHub ou desempenho medido em Render nesta auditoria. Revise a matriz em [AUDITORIA_FINAL.md](AUDITORIA_FINAL.md) antes de alegar conclusão.
