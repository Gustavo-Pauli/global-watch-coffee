# Global Watch Coffee

Aplicação de geoprocessamento para identificar **áreas candidatas a cafezais existentes** em GeoTIFFs Sentinel-2. Os resultados são exploratórios: não comprovam café, não avaliam aptidão agrícola e não representam precisão validada em campo.

Next.js + React + Better Auth/Google, **Prisma + PostgreSQL**, Supabase Storage privado e worker Python/FastAPI. A coleção em `/analyses` organiza as imagens; cada análise tem workspace cartográfico próprio. Upload, camadas, informações, arquivos e chat abrem sob demanda. O menu da conta permite editar o nome e sair. Não existem dados fictícios de clima, alertas ou séries temporais.

O estado verificável da entrega, comandos e limitações estão em [AUDITORIA_FINAL.md](docs/delivery/AUDITORIA_FINAL.md). Build local não comprova deploy. Nenhum push, alteração de visibilidade ou deploy é executado automaticamente.

## Executar localmente

Requisitos: Node >=22.12, pnpm 10.12.1, Python 3.12, PostgreSQL, projeto Supabase e cliente Google OAuth. Uma chave Gemini é necessária para respostas generativas; sem ela há contingência explicitamente identificada como resposta por regras.

```powershell
pnpm.cmd install --frozen-lockfile
# Somente se ainda não existir .venv:
python -m venv apps/geo-worker/.venv
& apps/geo-worker/.venv/Scripts/python.exe -m pip install -e './apps/geo-worker[dev]'
```

Crie os arquivos locais a partir de `.env.example` **somente se não existirem**. Nunca sobrescreva credenciais nem recrie a `.venv` existente. O Next lê `apps/web/.env.local`; o worker lê `apps/geo-worker/.env`, independentemente do diretório atual.

`pnpm-workspace.yaml` permite explicitamente os scripts de instalação de `@prisma/engines`, `prisma` e `esbuild`; não habilita scripts arbitrários de todas as dependências. A instalação gera o cliente Prisma automaticamente.

| Configuração | Onde |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` opcional | Next/Prisma; runtime pelo pooler, CLI por conexão direta ou pooler de sessão |
| `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Somente Next |
| `SUPABASE_URL` | Next e worker |
| `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET=geo-private` | Somente Next; chave `sb_secret_...` |
| `WORKER_SECRET` com >=32 caracteres | Mesmo valor no Next e worker |
| `PYTHON_WORKER_URL` | Next; local `http://127.0.0.1:8000` |
| `NEXT_CALLBACK_URL` | Worker; local `http://localhost:3000` |
| `CRON_SECRET` | Next; segredo da limpeza |
| `GEMINI_API_KEY`, `GEMINI_MODEL` opcional | Somente Next |

No Supabase, crie um bucket **privado**, `geo-private`, com limite por objeto **12 MiB (12582912 bytes)**. O servidor recusa emitir URLs de upload se o bucket estiver público ou sem limite adequado. SCL tem limite adicional de 4 MiB na aplicação. O PostgreSQL pode continuar local; Supabase Storage não exige mover o banco.

### Banco novo versus banco existente

```powershell
pnpm.cmd db:generate
pnpm.cmd db:validate
# Banco vazio, exclusivamente:
pnpm.cmd db:deploy
```

**Banco já utilizado:** não rode a migration inicial sobre tabelas existentes. Siga [PRISMA_MIGRATION.md](docs/delivery/PRISMA_MIGRATION.md) para comparar o schema e registrar o baseline sem recriar tabelas. `db:baseline` só é correto após essa comparação. `auth:migrate` agora é um alias de `prisma migrate deploy`; não execute mais o CLI `auth@latest` nem `database.sql` como mecanismo normal de atualização. O SQL antigo é referência histórica.

### Servidores

No Git Bash, é possível iniciar os dois serviços na raiz com a `.venv` ativa:

```bash
source apps/geo-worker/.venv/Scripts/activate
pnpm dev
```

Esse comando usa as tarefas persistentes já configuradas no `turbo.json`, sem o parâmetro obsoleto `--parallel` ([Turborepo](https://turborepo.dev/docs/reference/run#--parallel)). As portas 3000 e 8000 precisam estar livres. Se os serviços já estiverem abertos em outros terminais, encerre essas instâncias antes de iniciar o conjunto. No Windows, outro worker ocupando 8000 pode causar `WinError 10013`.

Para executar em terminais separados:

```powershell
# Terminal 1 (Python da .venv, sem depender do PATH global):
& apps/geo-worker/.venv/Scripts/python.exe -m uvicorn geo_worker.server:app --app-dir apps/geo-worker/src --reload --host 127.0.0.1 --port 8000
# Terminal 2:
pnpm.cmd dev:web
```

No Git Bash, ative `source apps/geo-worker/.venv/Scripts/activate` antes de `pnpm dev:worker`. Acesse `http://localhost:3000` e `http://127.0.0.1:8000/health`. Cadastre no mesmo cliente Google usado pelo app a URI exata `http://localhost:3000/api/auth/callback/google`.

## Fluxo e limites

1. Better Auth verifica a sessão no PostgreSQL; todas as operações conferem o proprietário.
2. Next autoriza upload por URL assinada. Os bytes TIFF vão diretamente ao Storage, sem passar pelas funções Vercel.
3. Next confirma os objetos, faz a transição atômica para processamento e envia o job ao worker autenticado.
4. Python processa pixels reais, usando B02/B03/B04/B08, máscaras de qualidade, índices e RF v2. Retorna polígonos WGS84, hectares geodésicos, PNGs, GeoTIFF e JSON.
5. Os seis arquivos são enviados ao Storage privado. Callback autenticado finaliza o estado no banco; repetições são idempotentes.
6. O usuário recupera o resultado e baixa arquivos por rotas que conferem propriedade. O chat usa apenas fatos calculados, com contingência rotulada quando a IA não está disponível.

TIFF: 12 MiB, quatro bandas, CRS projetado em metros, até um milhão de pixels; SCL: 4 MiB e até um milhão de pixels. Cinco tentativas de criação por hora/usuário e dez processamentos globais/dia; apenas um job simultâneo no worker. Retenção lógica de três dias; remoção física pelo cron diário pode ocorrer depois do vencimento. URLs assinadas já emitidas continuam válidas até expirar.

O worker não usa banco nem disco persistente. Reinícios podem interromper jobs: não há fila durável, e tarefas sem callback expiram. Não há promessa de execução contínua no plano gratuito.

## Verificações

```powershell
pnpm.cmd test:web
& apps/geo-worker/.venv/Scripts/python.exe -m pytest apps/geo-worker/tests -q --disable-warnings
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd release:check --mode=local
& apps/geo-worker/.venv/Scripts/python.exe scripts/check_repository.py
```

`pnpm test:db` exige `TEST_DATABASE_URL` apontando para banco descartável cujo nome contenha `test` ou `audit`; consulte [migração](docs/delivery/PRISMA_MIGRATION.md). Os testes unitários ignoram essa integração quando a variável está ausente. Nunca aponte testes para produção.

Para revisão visual: execute o app local, instale Chrome ou `pnpm --filter @global-watch/web exec playwright install chromium`, e execute `pnpm test:browser`. O fluxo real opt-in usa `RUN_LIVE_BROWSER=1`, cria usuários/sessões descartáveis e limpa seus próprios objetos; usa a configuração local e consome a cota de processamento. **Não testa o consentimento OAuth Google**. Capturas do aplicativo ficam em `docs/delivery/screenshots`; não há screenshots externos copiados.

A regressão adicional `RUN_UI_BROWSER=1` testa o workspace pronto e conta no build local de produção sem iniciar jobs. Ela usa arquivos realmente processados da cena pública e fixtures próprios no PostgreSQL/Storage. Preparação e limites em [UI_REDESIGN.md](docs/delivery/UI_REDESIGN.md); `UI_FIXTURE_DIR` aponta para os seis artefatos. A busca da coleção atua sobre até 30 registros recentes retornados pela API.

O preflight é somente leitura, não exibe segredos e retorna código 1 se faltar uma configuração obrigatória, inclusive a chave Gemini. Nunca declara produção pronta sozinho. A verificação de retenção real tem opt-in e banco/servidor isolados; consulte os procedimentos antes de executá-la.

## Documentos

- [Auditoria final e matriz de conformidade](docs/delivery/AUDITORIA_FINAL.md)
- [Migração Prisma sem perda de dados](docs/delivery/PRISMA_MIGRATION.md)
- [Auditoria do geoprocessamento](docs/delivery/AUDITORIA_GEO.md)
- [Design e estados da interface](docs/delivery/UI_DESIGN.md)
- [Decisões e validação do novo redesign](docs/delivery/UI_REDESIGN.md)
- [Preflight de configuração e permissões](docs/delivery/PREFLIGHT.md)
- [Validação real de retenção e novas tentativas](docs/delivery/RETENCAO_VALIDACAO.md)
- [Validação do Gemini real pela API e pelo navegador](docs/delivery/GEMINI_VALIDACAO.md)
- [Fontes, licenças e proveniência verificadas](docs/delivery/PESQUISA_PROVENIENCIA.md)
- [Deploy gratuito e validação pública](docs/delivery/DEPLOY.md)
- [Nota de pesquisa editável](docs/research/NOTA_PESQUISA_FINAL.md) e [PDF](docs/research/NOTA_PESQUISA_FINAL.pdf)
- [Roteiro do vídeo](docs/delivery/ROTEIRO_VIDEO.md)

MapBiomas é supervisão fraca, não verdade de campo; outubro participou do treinamento final e não é teste independente. Scores não são confiança calibrada. Modelos v1 são pesquisa histórica, v2 é o modelo do worker. Crédito: Contains modified Copernicus Sentinel data (2025); manter atribuições dos dados e dos mapas.

Para gerar a nota de pesquisa, instale o extra Python `[research]` e execute `python scripts/build_research_pdf.py`. O gerador usa DejaVu Sans instalado no Linux ou Arial do Windows e não depende de caminhos Linux no Windows. Confira sempre o limite de duas páginas e a renderização depois de alterar o texto.

ChatGPT auxiliou pesquisa, implementação e documentação; processamento e números dependem de pixels reais e verificações registradas. Prithvi e Clay foram pesquisados, não executados. As referências visuais do redesign foram usadas apenas para orientação, sem copiar marcas, dados, layouts ou assets de terceiros.
