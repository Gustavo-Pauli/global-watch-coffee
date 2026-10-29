# Global Watch Café · Desafio técnico

**Monorepo (Turborepo + pnpm) com Next.js/Better Auth e worker geoespacial Python.**

Sistema exploratório para detectar **áreas candidatas de cafeicultura existente** em GeoTIFFs Sentinel-2 L2A. Não indica aptidão agrícola nem comprova presença de café. O cálculo geoespacial e a extração de polígonos são reais; o MapBiomas é utilizado como supervisão fraca.

> Estado: código e pipeline Python verificados localmente. OAuth Google, build do Next.js, Gemini e deploy público **ainda precisam de teste real**. Não apresentar como entrega online concluída.

## Organização

```text
apps/
  web/                Next.js 16, Better Auth, Leaflet e chat Gemini
  geo-worker/         Python, FastAPI interno, modelos e testes
    src/geo_worker/   Rotas internas, índices espectrais, classificadores
    models/v1/        Modelo RF original
    models/v2/        Modelo RF multiclasses atual (default)
    tests/            Testes de processamento e autorização
data/                 TIFFs de agosto/julho/outubro, SCL e MapBiomas
docs/
  research/           Nota de pesquisa (PDF/Markdown) e análises
  delivery/           Deploy, checklist e roteiro de vídeo
  architecture/       Decisões e documentação histórica
experiments/
  evaluation/         Comparações e inspeções visuais
  outputs/            Artefatos históricos gerados, versionados
scripts/              Aquisição, reexecução de experimentos, verificações
.github/workflows/    CI de Python e TypeScript
```

## Instalação local

**Requisitos:** Node.js >= 22.12, Python >= 3.11, PostgreSQL; gerenciador pnpm 10.x. O modelo foi salvo com scikit-learn 1.9.1 (outras versões podem gerar avisos/alterar resultados).

```bash
corepack enable
pnpm install   # gera pnpm-lock.yaml se ainda não existir; faça commit desse arquivo antes do push
python -m venv .venv
source .venv/bin/activate   # PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -e './apps/geo-worker[dev]'
cp apps/web/.env.example apps/web/.env.local
```

Para subir PostgreSQL de desenvolvimento, use `docker compose up -d postgres` (a senha do `compose.yaml` é apenas para uso **local**, jamais produção). Configure `apps/web/.env.local`: DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PYTHON_WORKER_URL e WORKER_SECRET. Use **o mesmo** WORKER_SECRET nas duas aplicações, com pelo menos 32 caracteres aleatórios. `GEMINI_API_KEY` é usado somente no Next.js. Configure o banco Postgres e execute a migração de Better Auth e o `database.sql` (conforme guia de deploy).

```bash
pnpm dev                 # Next.js e FastAPI em paralelo (com Python instalado)
pnpm build               # Build web
pnpm typecheck           # Verificações TS e sintaxe Python
pnpm test                # Testes Python
python scripts/check_repository.py
```

Alternativamente, rode em dois terminais:

```bash
pnpm dev:web
pnpm dev:worker
```

`http://localhost:3000` → Next.js. `http://127.0.0.1:8000/health` → Python. Configure o Google OAuth com callback `http://localhost:3000/api/auth/callback/google`. Não há autenticação Google diretamente no Python.

## O que a aplicação faz

1. Autentica a identidade usando **Google + Better Auth** no Next.js.
2. Recebe imagem Sentinel-2 de **quatro bandas** (B02, B03, B04, B08) e máscara SCL opcional.
3. O Next.js confere sessão, limite de uso e repassa o TIFF para o worker com `WORKER_SECRET`.
4. O Python calcula NDVI, GNDVI, EVI2, atributos espaciais e classifica com Random Forest; gera **polígonos GeoJSON, hectares, visualizações PNG, GeoTIFF e estatísticas**.
5. O React/Leaflet visualiza os polígonos; o chat usa apenas métricas efetivamente produzidas.
6. Resultados são isolados por usuário; arquivos locais no worker são efêmeros em hospedagem grátis.

Os botões de cenas de demonstração **processam os TIFFs novamente**, não exibem outputs pré-computados.

## Reproduzir testes de geoprocessamento

```bash
python -m pytest apps/geo-worker/tests -q
python -m geo_worker.coffee_v2 classify data/sample/imagem_multiespectral.tif --scl data/sample/qualidade_scl.tif --model apps/geo-worker/models/v2/coffee_rf.joblib --output /tmp/gw-cafe-agosto --date 2025-08-16
```

**Validação:** MapBiomas 2025 (classe 46) foi fonte de rótulos e é somente referência indireta, não verdade de campo; resultados são candidatos. Outubro foi posteriormente usado no treino v2, então não é teste temporal independente da versão final. Veja os detalhes e problemas encontrados em `docs/research/NOTA_PESQUISA_FINAL.pdf` e `docs/research/RELATORIO_INSPECAO.md`.

## Documentação e publicação

- [Nota de pesquisa (duas páginas)](docs/research/NOTA_PESQUISA_FINAL.pdf)
- [Checklist de entrega](docs/delivery/CHECKLIST_ENTREGA.md)
- [Guia de publicação](docs/delivery/DEPLOY.md)
- [Roteiro do vídeo](docs/delivery/ROTEIRO_VIDEO.md)
- [Pesquisa e evolução](docs/research/NOTA_PESQUISA_FINAL.md)
- [Decisões da arquitetura](docs/architecture/ARQUITETURA.md)

## Importante para o GitHub

Código, TIFFs de teste, modelos v1/v2, pesquisa e outputs de auditoria são versionados. **Não** publique `.env.local`, chave de serviço, credenciais Google, banco SQLite local ou `node_modules`. Modelos `.joblib` são carregados somente de arquivos próprios do projeto, nunca de uploads de terceiros.

Após criar um **novo repositório vazio** no GitHub:

```bash
# Windows/PowerShell (um script com conferência de segredos):
./scripts/publish_github.ps1 -RepoUrl "https://github.com/SEU-USUARIO/global-watch-cafe.git"
# Linux/macOS: bash scripts/publish_github.sh https://github.com/SEU-USUARIO/global-watch-cafe.git
```

**Nota:** o registro npm não ficou acessível neste ambiente, portanto ainda não foi possível gerar `pnpm-lock.yaml`, instalar Node packages, executar `next build` ou verificar o Turbo CLI. O primeiro `pnpm install` deverá gerar o lockfile; faça commit dele para CI e produção. O acesso ao repositório e a URL pública precisam ser verificados antes de enviar ao recrutador.
