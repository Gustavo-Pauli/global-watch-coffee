# Decisões de arquitetura

| Camada | Local | Responsabilidade |
| --- | --- | --- |
| React + Next.js | `apps/web` | UI, App Router, mapa, uploads, downloads e chatbot |
| Better Auth + Postgres | `apps/web` | OAuth Google, sessão e autorização de requisições |
| Python + FastAPI | `apps/geo-worker` | Pipeline científico, leitura de TIFF, classificação e polígonos |
| Dados de demonstração | `data` | Cena original, outras datas e referência com proveniência |
| Pesquisa e evidências | `docs`, `experiments` | Avaliação, comparações, limitações e entrega |

**Fronteira de confiança:** navegador nunca envia `X-Owner-Id` ao worker. O Next.js valida sessão, seleciona o proprietário e autentica a chamada interna com `WORKER_SECRET`. O worker só vê a identidade interna e preserva isolamento por usuário.

**Por que monorepo?** O mesmo commit documenta a versão da UI, worker, dados e modelo. O Turborepo orquestra scripts dos pacotes JavaScript; Python é gerenciado por `pyproject.toml` próprio e invocado como workspace de comandos (não é biblioteca npm).

**Não criamos packages/* artificiais:** ainda não há biblioteca TS compartilhada e não há motivo para abstrair apenas para preencher a pasta.
