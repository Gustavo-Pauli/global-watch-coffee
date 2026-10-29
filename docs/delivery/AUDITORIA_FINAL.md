# Auditoria final — Global Watch Coffee

**Data: 29/10/2026 · execução local Windows · entrega prevista: 30/10/2026.**

O trabalho incluiu correções de código, migração integral de acesso ao banco para Prisma, redesign cartográfico, testes reais locais e documentação operacional. **Não foi feito push, deploy ou alteração de visibilidade no GitHub.** Build e testes locais não comprovam operação pública, cold start ou disponibilidade contínua.

## Escopo e evidências de partida

Foram lidos o [enunciado original](../../data/sample/DESAFIO.txt), README, arquitetura, nota de pesquisa, configurações, aplicação web, worker, testes e os dois briefings fornecidos. `LEIA_ANTES_DE_APLICAR_PATCH.txt` foi respeitado; os ambientes e credenciais existentes não foram sobrescritos. A árvore Git estava limpa no início desta auditoria.

Banco configurado: PostgreSQL **local**, `localhost:5435/global-watch-coffee`. Supabase está sendo usado como Storage remoto. Não presumir que a migration local foi aplicada a um banco Supabase remoto. O worker continua sem conexão ao banco e sem chave administrativa do Storage.

As referências de produtos terceiros serviram apenas para hierarquia, densidade e UX; não foram copiadas como assets. As capturas adicionadas são do próprio aplicativo, com dados do kit e usuários descartáveis de teste.

## Problemas encontrados e correções

| Gravidade | Problema comprovado ou condição de risco | Correção e evidência |
|---|---|---|
| Alta | Tokens de upload assinados não impunham o tamanho declarado pelo browser | Bucket privado configurado com teto real de 12 MiB; servidor confere privacidade e limite antes de emitir URLs. SCL também é conferida no start e no worker. `lib/storage.ts` |
| Alta | Bodies JSON podiam ser lidos sem limite real de stream | Parser Next de 16 KiB; worker autentica antes de ler e limita JSON a 32 KiB, inclusive chunked. MIME, JSON inválido, UTF-8, arrays e campos obrigatórios cobertos por testes |
| Alta | Pequenos SCL comprimidos podiam expandir para rasters grandes; downloads HTTP comprimidos escapavam do raciocínio de limite | Limites de dimensões/tipo, codificação HTTP identity obrigatória, limites de bytes e reprojeção. `worker.py`, `test_worker_security.py` |
| Alta | Segurança das tabelas dependeria dos grants/defaults particulares de um projeto Supabase | Migration aditiva habilita RLS e remove grants de PUBLIC/anon/authenticated nas seis tabelas, sem políticas públicas. **Não foi comprovada exposição remota**: no banco local não existem roles Data API. Preflight obrigatório antes de aplicar remotamente |
| Média | Starts duplicados/ID alheio podiam consumir cota e disputar estado | Transação serializável com compare-and-set e reserva de cota diária na mesma unidade; retry limitado. Testes de concorrência, rollback e propriedade |
| Média | Callback repetido podia falhar após a tarefa já finalizar | Estado terminal igual retorna 200; estado terminal conflitante retorna 409; atualização condicional. Saídas são verificadas no Storage, não aceitas como números enviados no callback |
| Média | Data de aquisição de demos não era persistida no histórico | Callback persiste somente a data ISO válida efetivamente produzida pelo Python; datas impossíveis e valores inválidos são rejeitados |
| Média | URLs de Storage eram validadas de forma ampla | Host/porta/protocolo fixos, caminhos específicos para leitura/upload e rejeição de traversal/escapes. Regressões SSRF |
| Média | TIFF classificado retinha pixels descartados dos polígonos/ha | TIFF agora representa as mesmas regiões mínimas mantidas no GeoJSON. Teste sintético compara os dois produtos |
| Média | NoData, metadados de bandas, transform e escala insuficientemente validados | Máscaras GDAL, radiometria finita, ordem declarada B02/B03/B04/B08, escala/offset, CRS e transform; erro explícito para cena sem pixels válidos |
| Média | Estatística por polígono fazia varreduras repetidas da imagem; paralelismo/cache dependiam da máquina | Raster de rótulos e bincount, teto de regiões, RF uma thread, GDAL cache 16 MiB e Uvicorn um processo |
| Média | Checagem numérica do chat confundia IDs/datas com medidas e rejeitava arredondamento legítimo | Validação separa hectares, NDVI, IDs, contagem e datas; rejeita percentuais/escrita exponencial sem suporte. Triagem adicional de confirmações sem campo. Chave Gemini vai em header; endpoint/modelo configurável |
| Média | Consulta a polígono posterior ao 250º podia dizer que ele não existia | Fallback procura a coleção completa; contexto LLM limitado inclui o polígono explicitamente pedido |
| Média | Respostas antigas da UI e URLs de imagem podiam sobreviver à troca de contexto | Abort de polling/chat, verificação de identidade/seleção e revogação de object URLs. Histórico e downloads preservam isolamento entre sessões |
| Baixa | Semântica de acesso e limpeza não correspondia à promessa de retenção exata | Acesso expira em três dias; cron diário remove fisicamente depois, com orçamento/retry e metadata preservada em falha de Storage. Docs corrigidos |
| Baixa | Documentação ainda dizia build indisponível, orientava CLI antigo e publicação automática | README, migração, deploy, GitHub, arquitetura e checklist atualizados; guia v1 marcado histórico; CI usa lock congelado e banco de teste |
| Baixa | pnpm 10 registrava scripts do Prisma/engines/esbuild como ignorados | Allowlist explícita somente desses três pacotes em pnpm-workspace.yaml; rebuild e nova instalação frozen confirmaram zero scripts ignorados |

Também foram adicionados `nosniff`, proteção contra frames, política de referência restritiva e `private, no-store` nas APIs/redirecionamentos privados. A auditoria de dependências npm de produção retornou zero advisories conhecidos; isso não equivale a ausência de vulnerabilidades no aplicativo ou no código nativo GDAL.

## Prisma e preservação de dados

- Prisma ORM 7.10.1, driver adapter PostgreSQL e adapter oficial Better Auth.
- Seis tabelas existentes, nomes físicos, tipos, índices, FKs e CHECKs preservados. Nenhuma consulta SQL manual permanece no runtime da aplicação; SQL DDL é usado nas migrations para CHECKs e RLS, recursos específicos PostgreSQL.
- Diff inicial sem diferenças; baseline registrada sem reexecutar CREATE TABLE. Em seguida, hardening RLS aplicado **somente localmente**, após verificar destino, proprietário/BYPASSRLS e ausência de políticas existentes.
- `db:status`: duas migrations aplicadas. Ao final das integrações/limpeza: **1 usuário, 1 sessão, 1 conta OAuth e 1 análise** existentes; leitura da sessão e das consultas continua funcionando.
- Cliente gerado no postinstall e build; build não migra banco automaticamente. Scripts `db:*`, `test:web`, `test:db` e `test:browser` documentados.
- Banco descartável separado `global_watch_audit_test` usado para regressões SQL; testes não limpam indiscriminadamente o banco utilizado pelo app.

Procedimento, preflight de role/grants e backout seguro: [PRISMA_MIGRATION.md](PRISMA_MIGRATION.md).

## Testes executados

| Verificação | Resultado e limite |
|---|---|
| Instalação JavaScript com lock congelado/postinstall | Passou; Prisma Client gerado. Allowlist de scripts Prisma/engines/esbuild conferida com rebuild e nova instalação. Não é prova de cold cache ou máquina limpa |
| `pnpm db:validate`, `pnpm db:status` | Schema válido; duas migrations locais aplicadas |
| `pnpm test:web` | **17 testes unitários passaram** após continuação; suíte DB fica explicitamente skipped sem TEST_DATABASE_URL. Inclui chat adversarial/rounding, JSON stream, Origin, cleanup e preflight |
| `pnpm test:db` com banco descartável explícito | **11 testes contados pelo runner** (10 subtestes e suíte principal) passaram; 32 chamadas concorrentes, ownership, expiração, cotas/CAS/rollback, callbacks, metadados, CHECKs, catálogo RLS/grants e adapter Better Auth |
| Python pytest | **50 testes passaram**, 21,76 s na execução registrada pelo auditor do worker. Pixels reais, TIFF/GeoJSON, SSRF, tamanho, formatos, concorrência, retry e falhas parciais |
| Python compileall e pip check | Passaram; dependências da `.venv` existente consistentes |
| `pnpm typecheck` | Passou no monorepo (TypeScript e compilação Python) |
| `pnpm build` | Passou após as alterações finais; Prisma generate + Next.js 16.4.3 production build |
| `RUN_LIVE_BROWSER=1 pnpm test:browser` | **2 testes passaram**, 55,0 s. Chrome/Playwright real, Next production local, worker estável e Supabase Storage real |
| Smoke após RLS e build final | Sessão válida, consulta autenticada, headers e logout passaram; token invalidado passa a receber 401. Nova revisão de login/mobile com reduced motion: 1 teste passou |
| `python scripts/check_repository.py`, `git diff --check` | Passaram |
| `pnpm audit --prod --json` | Zero vulnerabilidades conhecidas reportadas na consulta |
| PDF de pesquisa | Duas páginas com texto extraível, conferidas estruturalmente com pypdf. Não foi alterado/renderizado nesta auditoria |
| Retenção HTTP com Storage real | Passou em Next production `localhost:3001` + banco isolado: 401 sem token, 8 objetos vencidos removidos, 8 ativos preservados, rate limits conferidos; fixtures removidos |
| `pnpm release:check --mode=local` | Verificações automáticas de banco, migrations, RLS/grants, Storage, worker e ambos health passaram; exit 1 somente por chave Gemini ausente |

Não há linter configurado; não foi alegado resultado de lint. A CI foi atualizada para executar instalação frozen, geração/validação Prisma, migrations em PostgreSQL 16 de teste, regressões e build, mas o workflow **não foi executado no GitHub** nesta tarefa.

### Integração real no navegador

A suíte cria duas identidades e sessões Better Auth descartáveis **diretamente no banco**, assina cookies de teste com o segredo local e remove os seus próprios dados depois. Não há bypass adicionado às rotas do produto. Isso verifica sessão/autorização, **não o handshake/consentimento OAuth Google**.

Foram verificados: login UI, mapa, demo agosto, seis artefatos/callback, resultado, 404 para outra identidade em análise/arquivo/chat, downloads de GeoJSON/PNG/TIFF, resposta de chat determinística identificada, refresh, upload real multiespectral + SCL, data, logout e 401 após encerrar sessão. Requisições autenticadas com MIME incorreto, JSON malformado, objeto vazio, array e corpo excessivo foram rejeitadas com 415/400/422/413. O formulário rejeitou arquivo não TIFF.

A suíte consome dois slots reais de processamento por execução completa e não zera a cota compartilhada. Falhas durante processamento mantêm metadata de limpeza se necessário; não se apagam dados de outros proprietários. O conjunto foi repetido para corrigir seletores do próprio teste e, durante desenvolvimento, um reload do Uvicorn interrompeu um job; a aplicação apresentou erro em vez de sucesso. A execução final foi feita sem reload e passou.

O backend de navegador integrado estava indisponível. O fallback usado foi Playwright com Chrome já instalado; não se alegou inspeção pelo backend indisponível.

## Interface e capturas

O redesign é um workspace escuro neutro, com um destaque oliva, histórico compacto, mapa central e um painel contextual. Nova análise, processamento, resultado, downloads, método e consulta têm estados reais. Não foram criados módulos de clima, alertas, séries temporais ou precisão. No mobile, mapa/painel empilham e histórico abre como drawer. Labels, foco visível, Escape, abas por teclado e reduced motion foram considerados; não houve auditoria WCAG completa.

Capturas em 1440x1000 e 390x844; o navegador não apresentou erros JavaScript no fluxo completo e não houve overflow horizontal nas larguras verificadas. [Sistema visual e fluxos](UI_DESIGN.md).

| Tela | Captura do próprio aplicativo |
|---|---|
| Login desktop / celular | [Desktop](screenshots/desktop-login.png) · [Mobile](screenshots/mobile-login.png) |
| Nova análise | [Desktop](screenshots/desktop-new-analysis.png) |
| Processamento real | [Desktop](screenshots/desktop-processing.png) |
| Resultado real com imagem e polígonos | [Desktop](screenshots/desktop-results.png) · [Mobile](screenshots/mobile-results.png) |
| Chat de contingência | [Desktop](screenshots/desktop-chat.png) |
| Upload preenchido / rejeição de formato | [Upload](screenshots/desktop-upload.png) · [Erro real de validação](screenshots/desktop-invalid-upload.png) |

## Conformidade com o enunciado

| Requisito | Estado comprovado | Pendência |
|---|---|---|
| React + Python, processamento de cada upload | Implementado e testado localmente com pixels e integração reais | Validar ambiente publicado |
| Google login/cadastro/logout e backend | Adapter e sessão/logout/autorização testados com fixtures; cliente Google existente preservado | Repetir consentimento/login com Google real e domínio público |
| Índice espectral, classificação, polígonos e hectares | Implementado e testado; agosto produz 24 candidatos / 22,661 ha | Campo/generalização não validados, sem alegar acurácia |
| Imagem adicional | Julho e outubro presentes e cobertos pelo processamento/testes; outubro participa do treino | Demonstrar imagem adicional na URL pública/vídeo |
| Mapa, imagem, legenda, data, arquivos | Testados no navegador com Storage real | Rever domínio público e redes/dispositivos reais |
| Chatbot com IA fundamentada | Integração Gemini e regressões com mocks implementadas; contingência real rotulada | **GEMINI_API_KEY ausente**: chamada generativa real não validada e requisito de IA ainda não fechado |
| UI desktop/mobile, vazio/processamento/erro | Redesign implementado e capturado; fluxo real e erro de validação testados | Revisão humana final e acessibilidade ampliada |
| Segurança de rotas/ownership/upload | Regressões e integração de duas sessões passaram | Duas contas Google reais e Data API Supabase remoto |
| Hospedagem gratuita | Código/configuração e limites documentados | **Nenhum deploy realizado**, sem URL pública confirmada |
| GitHub público | Código e docs preparados; segredos ignorados | Visibilidade não consultada/alterada; nenhum push |
| Nota de pesquisa e IA | Markdown e PDF existentes; PDF com duas páginas | Revisar atribuições/licenças e anexar na entrega |
| Vídeo <=3 minutos | Roteiro existente | Gravar depois da validação pública |

## Riscos e limites que permanecem

1. **Jobs em memória não sobrevivem a restart.** Worker tenta callback com retry e Next reconcilia stale em 12 minutos; isso não é fila durável nem retomada. Não foi adicionada infraestrutura paga.
2. **Recursos gratuitos precisam de prova no destino.** Medição Windows: agosto 4,06 s / 255,0 MiB; entrada sintética de um milhão de pixels 10,16 s / 409,2 MiB. Exclui transferências e não comprova RAM Linux/Render nem pior caso. Render Free suspende e pode cancelar jobs.
3. **Gemini real bloqueado por ausência de chave.** Mocks não provam disponibilidade, cota, faturamento ou qualidade factual real. Triagem numérica/linguística e instruções reduzem alucinações, mas não provam a verdade semântica de texto livre; uma resposta pode cair no fallback conservador. Testar perguntas adversariais e formato de números com o modelo real.
4. **Modelos e dados são exploratórios.** MapBiomas é rótulo fraco de aproximadamente 30 m; outubro influenciou/participa do treino final. v2 é compatível com sklearn 1.8.0; v1 histórico 1.9.1 ainda avisa em testes de pesquisa. Não re-treinado nem usado para maquiar métricas.
5. **Uploads nativos têm risco residual.** Limites de bytes/pixels, GDAL cache/thread e validações não equivalem a sandbox de GDAL. Bandas sem descrições dependem de preparação correta; apenas imagens compatíveis são suportadas.
6. **Storage/retentividade.** URLs assinadas são bearer temporários; quem as obtiver pode usá-las até expirar. Bucket tem limite real, mas criação de capacidades tem janela de configuração em cache de 30 segundos. Acesso expira após três dias; limpeza física depende do cron/retry. A limpeza HTTP e de objetos reais passou com fixtures de data vencida; não houve passagem real de três dias nem teste do agendamento Vercel.
7. **Produção e testes humanos.** Google real, Data API remota, cold start, reinício, cron público e Gemini ainda exigem validação com serviços/destino finais. O plano gratuito não tem SLA de produção contínua.

## Checklist objetivo para colocar online

1. Revisar segredos, arquivos staged, histórico e direitos de redistribuição dos dados. Nunca adicionar screenshots de referência externos.
2. Configurar domínio e variáveis de Production/Preview; `DATABASE_URL` pelo pooler e `DIRECT_URL` apropriada ao CLI. Conferir proprietário/BYPASSRLS e grants antes das migrations remotas; backup e procedimento de [Prisma](PRISMA_MIGRATION.md).
3. Confirmar bucket privado com teto 12 MiB. Chave `SUPABASE_SECRET_KEY` só no Next; worker recebe apenas URL e segredo de comunicação.
4. Configurar Google callback exato e Gemini com cota disponível. Obter `type=ai_grounded` real; fallback não substitui a exigência.
5. Publicar manualmente Render com raiz do monorepo e **workers 1**; publicar Next em Vercel com raiz `apps/web`. Verificar health/modelo e callbacks HTTPS.
6. Repetir demo, imagem adicional, upload, mapa, downloads e duas contas Google pela URL pública; medir RAM/tempo no Render e testar cold start/restart.
7. Configurar CRON_SECRET e confirmar cron diário, expiração, limpeza e retomada de backlog sem apagar metadata prematuramente.
8. Revisar nota de duas páginas e fontes; gravar vídeo <=3 minutos. Somente com autorização específica, executar push/alterar visibilidade conforme a entrega.

Configuração detalhada e fontes oficiais atuais: [DEPLOY.md](DEPLOY.md). Nenhuma ação externa de publicação foi realizada por este trabalho.

## Continuação: retenção, preflight e proveniência

A continuação encontrou e corrigiu um problema adicional no cron: exceções de rede/SDK interrompiam a execução, e uma chamada de Storage não tinha timeout próprio. O serviço agora contém falhas por registro, usa cutoff fixo e aplica um sinal de até 10 segundos, reduzido ao orçamento restante. Novos testes cobrem retry, falhas parciais, backlog, expiração durante a execução e timeout; a rota foi validada com banco/HTTP/Storage reais separados. [Detalhes e reprodução](RETENCAO_VALIDACAO.md).

O preflight é uma ferramenta operacional somente leitura. Confere permissões e migrations sem imprimir valores de credenciais e sem executar migração/publicação; mantém gates humanos explícitos e não chama Gemini. [Procedimento](PREFLIGHT.md).

As três publicações foram conferidas em fontes primárias, três cenas STAC responderam com os IDs/datas/assets esperados e oito checksums do kit coincidiram. A licença dos dados MapBiomas foi identificada como CC BY 4.0; proveniência, nota Markdown e gerador foram alinhados, preservando a data original. O PDF permanece com a ressalva anterior e não foi regenerado; o documento de proveniência acompanha a nota até revisão conjunta do PDF. A licença para código/pesos próprios permanece decisão do titular. [Evidências](PESQUISA_PROVENIENCIA.md).
