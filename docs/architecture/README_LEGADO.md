> **ARQUIVO HISTÓRICO (VERSÃO ANTERIOR).** Este arquivo registra decisões descartadas. **NÃO USAR PARA SETUP/DEPLOY.** As fontes atuais são `README.md`, `docs/architecture/ARQUITETURA.md` e `docs/delivery/DEPLOY.md`.

> **Documento histórico anterior à migração para Turborepo.** Caminhos e comandos aqui podem estar obsoletos. Para executar, use o [README principal](../../README.md) e [DEPLOY atualizado](../delivery/DEPLOY.md).

---

# Global Watch — Assistente Geoespacial para Café

Desafio técnico: **Next.js 16 (React) + Better Auth + TypeScript** como aplicação principal; **Python/FastAPI interno** exclusivamente para processar GeoTIFFs Sentinel-2 L2A. A aplicação classifica **possíveis áreas de café**, não confirma presença de café nem estima precisão científica sem dados de campo.

> **Situação:** migração do Vite/Google ID Token para Next.js/Better Auth implementada no código em 28/10/2026; o novo worker Python passou nos testes locais. **Build npm, Google OAuth real, Gemini real e deploy público ainda não foram verificados** neste ambiente (sem acesso ao registro npm e sem credenciais externas). Não apresente como publicação concluída até testar uma URL real.

## Arquitetura

```text
Navegador (React / Next.js App Router)
   ├── Better Auth → Google OAuth (callback /api/auth/callback/google)
   ├── Cookie HttpOnly / sessão em PostgreSQL
   ├── /api/analysis/demo        ← sessão verificada + limite de uso
   ├── /api/analysis/upload      ← sessão verificada + limite de upload
   ├── /api/analyses/:id        ← sessão verificada / isolamento
   ├── /api/analyses/:id/files  ← sessão verificada / download
   └── /api/analyses/:id/chat   ← Gemini com fatos calculados
                 │
     Requisição servidor-servidor com WORKER_SECRET + Better Auth user.id
                 ▼
Python FastAPI (backend/worker.py) — sem OAuth, sem CORS público
   ├── Valida magic bytes, raster, banda, CRS, tamanho, SCL
   ├── Classifica pixels reais (coffee_v2.py + modelo v2)
   ├── Calcula NDVI/GNDVI/EVI2 e estatísticas espaciais
   ├── Gera polígonos, hectares, GeoJSON, PNG e GeoTIFF
   └── Guarda resultados por usuário e id aleatório
```

A separação atende a exigência de **React e Python**. O Next.js é uma aplicação React com um backend TS que autentica e orquestra; o serviço Python apenas executa análise geoespacial. A empresa não confirmou expressamente essa divisão, mas o enunciado não exige backend exclusivamente Python.

## Executar localmente

Requisitos: **Node.js 22.12+**, Python 3.11+, PostgreSQL 15+.

**1. PostgreSQL.** Utilize PostgreSQL local ou gratuito gerenciado. Para um banco local em Docker, por exemplo:

```bash
docker run -d --name globalwatch-db \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=globalwatch \
  -p 5432:5432 postgres:16
```

**2. Python** (terminal 1, na raiz do repositório):

```bash
python -m venv .venv
# Windows (PowerShell): .venv\Scripts\Activate.ps1
# Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt  # inclui requisitos Python e testes
# Configurar WORKER_SECRET igual nos dois serviços, >=32 caracteres
# Linux/macOS:
export WORKER_SECRET="altere-para-um-segredo-aleatorio-de-48-caracteres"
uvicorn backend.server:app --host 127.0.0.1 --port 8000
```

No Windows, defina `WORKER_SECRET` com `$env:WORKER_SECRET="..."`. Use `python -c "import secrets;print(secrets.token_urlsafe(48))"` para gerar a chave.

**3. Next.js** (terminal 2):

```bash
cd frontend
cp .env.example .env.local  # no Windows, use Copy-Item
# Edite DATABASE_URL, WORKER_SECRET, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID,
# GOOGLE_CLIENT_SECRET e BETTER_AUTH_URL
npm install
npm run auth:migrate  # cria tabelas Better Auth (revisar SQL solicitado pelo CLI)
# Execute frontend/database.sql na mesma base PostgreSQL, ex.: psql "$DATABASE_URL" -f database.sql
npm run dev
```

Abra `http://localhost:3000`. O Google Cloud Console precisa de um **OAuth 2.0 Client ID → Web application** com URI de redirecionamento `http://localhost:3000/api/auth/callback/google`, além do URI de produção `https://SEU-DOMINIO/api/auth/callback/google`. **O client secret nunca vai para o navegador.**

**4. Verificação local:**

```bash
python -m pytest -q           # processamento e segurança do worker
cd frontend && npm run typecheck && npm run build
```

Entre com Google, processe a cena original (agosto), outra data (julho), envie o TIFF com SCL, confirme mapa/GeoJSON/PNG/TIFF, faça perguntas ao assistente, saia e teste uma segunda conta. Os três botões de demonstração **processam os TIFFs** por nova invocação ao classificador, não usam resultados prontos.

## Serviços, credenciais e segurança

| Variável | Serviço | Uso |
|---|---|---|
| `DATABASE_URL` | Next.js | PostgreSQL persistente para Better Auth e limites de chat/upload |
| `BETTER_AUTH_SECRET` | Next.js | Assinatura de sessão (>=32 caracteres aleatórios) |
| `BETTER_AUTH_URL` | Next.js | URL pública exata para cookies e callback OAuth |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Next.js | Autorização Google no servidor |
| `PYTHON_WORKER_URL` | Next.js | URL fixa do serviço Python, não derivada do usuário |
| `WORKER_SECRET` | **Ambos** | Autenticação servidor-servidor; nunca expor ao navegador |
| `GEMINI_API_KEY` | Next.js (opcional no local) | Chat realmente generativo; **obrigatória na entrega** se a IA for demonstrada |
| `STORAGE_ROOT`, `RETENTION_DAYS` | Python | Resultados por usuário; padrão de limpeza lógica: 7 dias |

- Todos os endpoints de análise no Next.js usam `auth.api.getSession()` no servidor; não confiam em cookies apenas por sua presença.
- POSTs de aplicação verificam `Origin`, tamanho do upload e janela de rate limit em PostgreSQL. A separação interna valida um `WORKER_SECRET` de no mínimo 32 caracteres via comparação constante.
- Python rejeita arquivos TIFF falsos, tipos não aceitos, tamanhos excessivos, CRS ausente, número errado de bandas e rasters com mais de 1 milhão de pixels. O modelo `joblib` é fixo no servidor, não enviado pelo usuário.
- A consulta usa **o id real da sessão Better Auth** como proprietário; o navegador não pode especificar `X-Owner-Id`. Para todas as leituras de resultados e arquivos, o worker consulta id **e** proprietário. Requisições não autorizadas retornam 401/404.
- Próximo passo de produção: serviço Python deve aceitar requisições apenas do Next.js ou continuar validando o token de servidor. No Render Free o worker pode ficar publicamente acessível; o segredo segue obrigatório e a rota `/docs` foi desabilitada.
- Por simplicidade, análises e arquivos binários residem temporariamente no filesystem do Python. Em serviços gratuitos com disco efêmero, **podem desaparecer antes do prazo lógico de 7 dias**, especialmente ao suspender/reimplantar. O PostgreSQL do Next guarda contas e sessões, não esses arquivos. O chat não inventa informações após expiração.

## Restrições da hospedagem gratuita

Recomendado para protótipo: **Next.js na Vercel Hobby**, Python em **Render Free** e PostgreSQL gratuito gerenciado (como Neon). A Vercel limita o corpo de requisições de funções a **4,5 MB**; nesta implementação, a rota do Next.js limita a imagem a 4 MB e a SCL a 256 KB para deixar margem. O Python, quando acessado por um orquestrador diferente, limita TIFFs a 40 MB. Para aceitar cenas maiores na plataforma pública, é preciso upload direto com URL assinada e armazenamento de objetos, sem passar pelo corpo da função Next.js.

Render Free suspende após aproximadamente 15 minutos ocioso e **perde os resultados locais** ao suspender, reiniciar ou redeploy. Os primeiros requests podem levar cerca de um minuto. Respeite as cotas atuais de cada serviço e informe isso ao avaliador. Mais detalhes em `DEPLOY.md`.

## Método geoespacial / limitação científica

Entrada: 4 bandas **B02 (blue), B03 (green), B04 (red), B08 (NIR)**, Sentinel-2 L2A e máscara SCL opcional. Pipeline: leitura real Rasterio, escala/offset, filtragem de nuvens, índices **NDVI, GNDVI, EVI2**, agregações espaciais, Random Forest multiclasse (café, floresta, pastagem, mosaico, outros), limiar de candidato, coerência espacial, regiões conectadas, polygonização, áreas geodésicas e reprojeção WGS84. Produtos: `resultado.json`, `candidatos.geojson`, `imagem_mapa.png`, `imagem_classificada.png`, `imagem_rgb.png`, `classificacao.tif`.

O treinamento usou supervisão fraca do **MapBiomas 2025, classe 46 (café), resolução original ~30 m**. O MapBiomas não é verdade de campo, e a classe do treino não pode ser usada como validação independente. A inferência **não consulta MapBiomas**. A taxa de sobreposição com referência é uma medida de concordância, não "acurácia real". A queda dos falsos positivos sobre floresta foi acompanhada de perdas de cobertura de café rotulado. Outubro foi usado no treinamento final: não é conjunto de teste independente. O período e região de aplicação são restritos.

**Alternativas pesquisadas mas NÃO testadas:** máscaras apenas por índices espectrais (confundem vegetação); Prithvi-EO-2.0 e Clay exigiriam adaptação/treinamento supervisionado específico para café e validação. Nenhuma alegação de superioridade experimental. Resultados e fontes originais estão em `NOTA_PESQUISA_FINAL.pdf`, `RELATORIO_INSPECAO.md`, `evaluation/experiments_v2/ablation.json`.

## Entregáveis do desafio e estado real

- [x] Código de app React/Next.js + Python, endpoints protegidos e processamento de cenas reais (escrito).
- [x] GeoTIFF/GeoJSON/PNG, métricas, mapa Leaflet e camada de chat (código escrito).
- [x] Testes Python de autenticação interna, isolamento de proprietário, upload real e geoprocessamento.
- [x] Nota de pesquisa <=2 páginas: `NOTA_PESQUISA_FINAL.pdf` e `.md`.
- [ ] **Compilar e rodar Next.js** com dependências reais, e testar fluxos no navegador e em celular.
- [ ] **Testar Google OAuth real** e Gemini com credenciais de servidor.
- [ ] **Publicar** URL pública (Next.js + Python + banco), testar depois de período ocioso.
- [ ] **Criar repositório público** no GitHub sem segredos, verificar histórico de commits.
- [ ] **Gravar vídeo** real de até 3 minutos (veja `ROTEIRO_VIDEO.md`).

## Evidências de testes

Execute `python -m pytest -q` a partir da raiz. Há testes de processamento original e de imagem alterada, polygonização, área, SCL, geoindices, classificação, auditoria e comparação de limiares. `test_worker.py` adiciona isolamento entre usuários, header interno obrigatório, rejeição de MIME/assinatura, upload real e downloads. Os testes do **OAuth Google/Better Auth real e Next.js compilado** não foram executados aqui; são pendências explícitas.

## Fontes e licenças

A cena fornecida está em `sample/` com `ATRIBUICAO.txt`, `fonte_stac.json` e metadados; datas adicionais em `additional/` e `unseen/` com proveniência; MapBiomas e seu registro em `reference/`. Use atribuição e respeite condições da fonte. Consulte o PDF da nota de pesquisa para fontes primárias, alternativas e metodologia de identificação de café.

## Uso de IA no desenvolvimento

Foi utilizada assistência de IA para examinar requisitos, pesquisar métodos e bibliotecas, elaborar o protótipo, testes, texto e revisões. As conclusões foram confrontadas com imagens reais, scripts de testes e referência MapBiomas; o sistema não afirma medições de campo ou superioridade de modelos não executados. **O código gerado deve ser novamente revisado e demonstrado pelo autor antes da entrega.**
