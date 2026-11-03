# Global Watch Coffee

Plataforma experimental para explorar imagens Sentinel-2 e identificar áreas candidatas a cafezais. Permite enviar GeoTIFFs, visualizar RGB, falsa cor e NDVI, inspecionar polígonos e baixar resultados geoespaciais.

Os resultados precisam de revisão: não comprovam cultivo, não avaliam aptidão agrícola e não têm precisão validada em campo. O projeto está em desenvolvimento para uso público; a hospedagem gratuita ainda precisa ser validada para a carga real.

## Estrutura

- `apps/web`: Next.js, React, Leaflet, Better Auth e Prisma/PostgreSQL. Autenticação Google, análises por usuário, armazenamento privado e chat sobre os resultados.
- `apps/geo-worker`: FastAPI e pipeline Python. `pipeline/` contém o processamento operacional; `research/` mantém treinamento e avaliação reproduzíveis.
- `data`: cenas de exemplo, referência de treinamento, metadados e atribuições.
- `scripts`: obtenção de dados, experimentos de limiares e verificação do repositório.

O worker utiliza o Random Forest em `apps/geo-worker/models/v2`. A versão v1 permanece para regressões e comparação científica. As predições históricas necessárias aos testes estão em `apps/geo-worker/tests/fixtures/predictions`; novas análises processam os pixels recebidos.

## Desenvolvimento local

Requisitos: Node >=22.12, pnpm 10.12.1, Python 3.12, PostgreSQL, Supabase Storage e cliente Google OAuth.

```powershell
pnpm.cmd install --frozen-lockfile
python -m venv apps/geo-worker/.venv
& apps/geo-worker/.venv/Scripts/python.exe -m pip install -e './apps/geo-worker[dev]'
```

Crie a `.venv` apenas se ela não existir. Copie `apps/web/.env.example` para `apps/web/.env.local` e `apps/geo-worker/.env.example` para `apps/geo-worker/.env`, preservando configurações existentes. Os exemplos descrevem as variáveis; não versione credenciais.

- PostgreSQL: configure `DATABASE_URL` e, se necessário, `DIRECT_URL` para a CLI. `docker compose up -d postgres` inicia um banco local com os valores de `compose.yaml`.
- Supabase: crie o bucket **privado** `geo-private`, com limite por objeto de **12582912 bytes (12 MiB)**. Configure URL e chave secreta no Next; o worker recebe URLs assinadas por job.
- Google OAuth: cadastre `http://localhost:3000/api/auth/callback/google` e configure cliente, segredo e Better Auth no Next.
- Worker: use o mesmo `WORKER_SECRET` de pelo menos 32 caracteres nos dois serviços. Configure `PYTHON_WORKER_URL=http://127.0.0.1:8000` no Next e `NEXT_CALLBACK_URL=http://localhost:3000` no worker.
- Mapas: configure a chave pública MapTiler com restrições de origem. Gemini é opcional para respostas generativas; sem chave, o chat identifica a resposta por regras.

Para um **banco vazio**:

```powershell
pnpm.cmd db:generate
pnpm.cmd db:validate
pnpm.cmd db:deploy
```

Em banco existente, faça backup e compare o schema antes de marcar `0_existing_schema` como aplicado com `pnpm.cmd db:baseline`. O comando não verifica equivalência: confira também CHECKs e FKs nas migrations. Não marque a baseline em banco vazio. A migration seguinte habilita RLS e revoga acesso público; a conexão privada do servidor precisa ser proprietária das tabelas ou ter BYPASSRLS e permissões de CRUD.

Inicie os dois serviços com:

```powershell
pnpm.cmd dev
```

Os scripts do worker usam automaticamente `apps/geo-worker/.venv` no Windows e no Linux/macOS, sem precisar ativá-la no terminal. Sem `.venv`, usam o `python` disponível no PATH, que precisa ter as dependências instaladas.

Para iniciar em terminais separados:

```powershell
# Terminal 1
pnpm.cmd dev:worker
# Terminal 2
pnpm.cmd dev:web
```

Acesse `http://localhost:3000`. A saúde do worker está em `http://127.0.0.1:8000/health`.

## Limites atuais

O upload aceita GeoTIFF com quatro bandas B02/B03/B04/B08, CRS projetado em metros, até um milhão de pixels e 12 MiB. A SCL opcional aceita até 4 MiB. Os arquivos ficam no Storage privado; as rotas verificam o proprietário da análise.

Há cinco tentativas de criação por hora/usuário, dez processamentos globais/dia e um job simultâneo no worker. A retenção lógica é de três dias; a exclusão física depende da chamada diária autenticada a `/api/internal/cleanup` com `CRON_SECRET`. URLs assinadas permanecem válidas até expirar.

O worker mantém jobs em memória, sem fila durável. Reinícios podem interromper análises. `render.yaml` e `apps/web/vercel.json` são configurações existentes; sua presença não comprova disponibilidade contínua nem operação sem custos.

O modelo foi treinado com supervisão fraca do MapBiomas em uma região de Guaxupé/MG. As três cenas locais participaram do treino v2, inclusive a pasta historicamente chamada `unseen`. Não constituem teste independente desse modelo. Scores não são probabilidades calibradas; transferência para outras regiões não foi validada.

## Verificações e contribuição

Trabalhe em branches a partir de `develop` e abra pull requests para ela. A `main` preserva a versão anterior durante a avaliação em andamento.

```powershell
pnpm.cmd check:files
pnpm.cmd test:web
& apps/geo-worker/.venv/Scripts/python.exe -m pytest apps/geo-worker/tests -q --disable-warnings
pnpm.cmd typecheck
pnpm.cmd build
```

Os testes de banco só executam com `TEST_DATABASE_URL` explícita para um banco descartável cujo nome contenha `test` ou `audit`, com migrations aplicadas.

Com o app local aberto, `pnpm.cmd test:browser` executa Playwright. Instale Chromium com `pnpm.cmd --filter @global-watch/web exec playwright install chromium` se necessário. `RUN_LIVE_BROWSER=1` habilita fluxos com banco/Storage e processamento real; use ambiente isolado. `RUN_UI_BROWSER=1` habilita fixtures de interface e exige `UI_FIXTURE_DIR` com os oito arquivos listados em `apps/web/tests/browser/workbench.spec.ts`. Essas verificações não cobrem o consentimento OAuth Google. Capturas vão para o diretório temporário `global-watch-browser-screenshots` ou `BROWSER_SCREENSHOT_DIR`.

`pnpm.cmd release:check --mode=local` verifica configuração sem publicar. As verificações `test:retention:live` e `test:gemini:live` exigem opt-in descrito nos scripts e utilizam serviços reais.

Mudanças no classificador devem preservar a proveniência e distinguir concordância com rótulos de treino de validação independente. Melhor precisão exige avaliação espacial e temporal independente.

## Licença e atribuições

O código original é distribuído sob a [licença MIT](LICENSE). Dados, mapas e componentes de terceiros mantêm seus próprios termos; consulte [data/README.md](data/README.md) e `apps/web/components/ui/LICENSE`.

Contains modified Copernicus Sentinel data (2025). MapBiomas é a fonte de supervisão fraca, sem vínculo institucional com o projeto.
