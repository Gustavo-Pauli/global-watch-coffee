# Global Watch Café · desafio técnico

**Monorepo pnpm + Turborepo**, Next.js/React/Better Auth + Python/FastAPI, com Postgres e Supabase Storage Free. Identifica **áreas candidatas de cultivos de café existentes** em GeoTIFFs Sentinel-2; não comprova café e não avalia aptidão agrícola.

> **Status da entrega:** geoprocessamento e testes Python executados localmente. Next.js, Google OAuth, Gemini, Supabase real, Render e Vercel **ainda precisam de build/teste ponta a ponta**. Não alegar deploy antes de verificar a URL.

## Estrutura

```text
apps/
  web/                 Next.js App Router, Better Auth, mapa Leaflet, Gemini, APIs
    app/api/           Rotas de sessão, análises, chat e callback
    lib/               PostgreSQL, Storage assinado, sessão, rate limiting
    database.sql       Tabelas app_analyses e app_rate_limits
  geo-worker/          FastAPI stateless, classificador RF v2 e testes
    src/geo_worker/    Leitura de TIFF, SCL, índices, polígonos, worker
    models/v1|v2/     Modelos com proveniência de treino
    tests/             Testes com cena real e URLs de Storage simuladas
data/                   Imagem recebida + duas datas adicionais + referência
experiments/            Evidências, erros, ablações e resultados históricos
docs/research/          Nota de até 2 páginas e metodologia
 docs/delivery/         Implantação, roteiro de vídeo e checklist
scripts/                Ferramentas locais de pesquisa/validação
```

## Desenvolvimento local (Git Bash / Windows)

Dependências: Node >=22, pnpm 10, **Python 3.12**, PostgreSQL (local Docker ou Supabase), um projeto Supabase com bucket privado, OAuth Google e chave Gemini para IA generativa.

```bash
corepack enable
pnpm install                 # gera pnpm-lock.yaml; commitar ao GitHub
python -m venv apps/geo-worker/.venv
source apps/geo-worker/.venv/Scripts/activate
python -m pip install -e './apps/geo-worker[dev]'
cp apps/web/.env.example apps/web/.env.local
cp apps/geo-worker/.env.example apps/geo-worker/.env
```

Configure as variáveis em `.env`/`.env.local`. O worker carrega automaticamente `.env` via python-dotenv; **não precisa exportar `WORKER_SECRET` no Git Bash**. O mesmo `WORKER_SECRET` >=32 caracteres precisa constar nas duas configurações. Não envie esses arquivos ao GitHub.

**Supabase:** use `DATABASE_URL` no Better Auth, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` **somente no Next.js**, bucket `geo-private` (privado). Crie as tabelas:

```bash
pnpm --filter @global-watch/web auth:migrate
# Em seguida execute apps/web/database.sql no PostgreSQL/Supabase SQL Editor
```

Execute em terminais separados na raiz do monorepo:

```bash
pnpm dev:worker              # FastAPI :8000
pnpm dev:web                 # Next.js :3000
```

Acesse `http://127.0.0.1:8000/health` e `http://localhost:3000`. Configure Google OAuth com callback `http://localhost:3000/api/auth/callback/google`.

**Para testar sem Google** (apenas o Python, sem abrir sessão Next.js):

```bash
python -m pytest apps/geo-worker/tests -q
python -m geo_worker.coffee_v2 classify data/sample/imagem_multiespectral.tif --scl data/sample/qualidade_scl.tif --model apps/geo-worker/models/v2/coffee_rf.joblib --output /tmp/gw-cafe-agosto --date 2025-08-16
```

## Fluxo da aplicação

1. Login Google validado pelo **Better Auth no Next.js**; Next autoriza tarefas e impõe limites no PostgreSQL.
2. Usuário envia metadados do TIFF ao Next. Next cria `app_analyses` e entrega **URL de upload assinada**; navegador envia bytes direto ao bucket Supabase **privado**, sem passar pelo limite Vercel de 4,5 MB.
3. Next confirma arquivos no Storage e chama `POST /internal/process` no worker Render, autenticando com `WORKER_SECRET`. Resposta 202 é imediata.
4. Python baixa o TIFF via URL assinada, valida assinatura/bandas/CRS/SCL/limite de pixels; calcula NDVI/GNDVI/EVI2 e Random Forest, poligoniza em GeoJSON, estima hectares e produz PNG/TIFF + resumo JSON. Processamento é **novo a cada análise**.
5. Python sobe artefatos a Storage e notifica `POST /api/internal/worker-complete` autenticado. Next lê os resultados produzidos e marca tarefa como pronta no PostgreSQL.
6. A UI consulta o status, visualiza mapa Leaflet/legenda/data/ha, baixa arquivos por URLs temporárias, e conversa com Gemini em função de fatos calculados. Se falta Gemini, a resposta é explicitamente marcada como fallback **não IA**.

Não existe banco SQLite no worker. PostgreSQL contém usuários/sessões, estado/histórico e rate limits; Storage contém arquivos. O worker mantém apenas diretórios temporários, apagados ao fim da tarefa.

## Limites e segurança

- TIFF até **12 MiB**, SCL até **4 MiB**, quatro bandas e um milhão de pixels. Cenas de demonstração reprocessadas: agosto/julho/outubro.
- Cinco análises por hora por usuário e **dez globalmente por dia**, para respeitar o plano gratuito. Retenção **três dias** com limpeza diária via cron autenticado na Vercel.
- Uploads e resultados são **privados**; Next valida o proprietário em todas as rotas e só depois fornece URLs assinadas breves. `service_role` e chaves OAuth/Gemini ficam exclusivamente nos servidores.
- Worker valida host das URLs contra `SUPABASE_URL`, impedindo acesso a endpoints arbitrários (SSRF). Executa uma tarefa por vez.
- Render Free suspende após 15 min sem tráfego, pode demorar para acordar, tem disco efêmero e pode interromper tarefas em memória ao reiniciar. Não existe fila persistente; tarefas sem callback são marcadas como erro após 12 min.
- A classe café do MapBiomas 2025 é **rótulo fraco** (30m), não verdade de campo. Outubro está no treino da versão v2, não é teste independente. Scores não são acurácia nem confiança calibrada.

## Testes, documentação e entrega

```bash
python -m pytest apps/geo-worker/tests -q
pnpm typecheck
pnpm build
python scripts/check_repository.py
```

- [Nota de pesquisa (PDF, até 2 páginas)](docs/research/NOTA_PESQUISA_FINAL.pdf)
- [Nota editável](docs/research/NOTA_PESQUISA_FINAL.md)
- [Arquitetura e limites](docs/architecture/ARQUITETURA.md)
- [Guia de deploy gratuito](docs/delivery/DEPLOY.md)
- [Checklist de entrega](docs/delivery/CHECKLIST_ENTREGA.md)
- [Vídeo de até 3 minutos](docs/delivery/ROTEIRO_VIDEO.md)
- [Migração do monorepo local](docs/delivery/MIGRACAO_LOCAL.md)
- [Publicação no GitHub existente](docs/delivery/GITHUB.md)

**Uso de IA no desenvolvimento:** ChatGPT e pesquisa técnica auxiliaram desenho, código e documentação; foram verificados com testes, análise de referência MapBiomas (sem rotulagem de campo) e revisão de limitações. O Gemini no produto explica resultados efetivamente calculados. Prithvi-EO-2.0 e Clay foram pesquisados, **não executados**, conforme nota.

**Importante:** no ambiente de geração não foi possível acessar o registro npm para instalar dependências e executar `next build`. O `pnpm-lock.yaml` precisa ser gerado localmente antes do push. Acesse [guia de implantação](docs/delivery/DEPLOY.md) e confirme tudo na URL pública antes de enviar. As fontes oficiais usadas para limites incluem [Render Free](https://render.com/docs/free), [Vercel Function payload](https://vercel.com/docs/errors/function_payload_too_large) e [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).
