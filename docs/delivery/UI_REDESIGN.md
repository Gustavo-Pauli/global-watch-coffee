# Redesign da plataforma — 29/10/2026

## Prioridade e direção

O desafio original está em `data/sample/DESAFIO.txt`. O redesign preserva o fluxo real de autenticação, upload, Python, índices, polígonos, downloads e chat. A experiência anterior foi rejeitada pelo usuário por excesso de informações e ferramentas permanentes. Esta alteração não será commitada, conforme solicitado. Backup local dos componentes anteriores fora do repositório; nenhuma alteração em `.env`, `.env.local` ou `.venv`.

As seis novas referências e a referência adicional do MapBiomas foram analisadas como padrões de interação: navegação persistente discreta, listas operacionais, conta no rodapé, mapa dominante e ferramentas contextuais que podem ser fechadas. MapBiomas reforçou hierarquia entre camadas, seleção e informação, sem importar temas ou gráficos que o pipeline não produz. Não são assets do projeto. Não copiar screenshots, marcas, dados ou recursos sem implementação.

## Estrutura antes da implementação

```text
Plataforma
├── Análises /analyses
│   ├── Busca e filtro de status
│   ├── Lista de registros reais → abrir /analyses/:id
│   └── Nova análise → formulário em dialog
├── Análise /analyses/:id
│   ├── Voltar à lista · identificação · data
│   ├── Mapa + imagem calculada + polígonos
│   ├── Legenda e hectares sempre disponíveis no resultado
│   └── Camadas / Informações / Arquivos / Assistente sob demanda
└── Conta
    ├── Meu perfil → nome editável, email e foto da sessão
    └── Sair da conta
```

Entrada pela coleção: o desafio exige recuperar análises, mas não exige abrir sempre um mapa. O mapa é central na exploração de uma análise, sem ocupar criação ou login. Rotas próprias permitem refresh, links diretos, histórico do navegador e futura evolução independente dos módulos. Não adicionar módulos futuros vazios.

## Sistema visual

- Inter variável local, corpo 14 px e metadados 12 px; texto de formulário 16 px em telas de toque.
- Carvão neutro, divisórias discretas, superfícies opacas e um destaque verde contido para geometria e estado.
- Controles compactos, hierarquia curta e alinhamento consistente. Sem cards de KPI, hero, gradiente, neon ou métricas inventadas.
- Desktop: navegação lateral; rail no workspace cartográfico. Mobile: navegação em sheet e ferramentas sobre o mapa, com altura limitada e rolagem interna.
- Uma ferramenta contextual aberta por vez. A área estimada, a data e a legenda exigidas pelo desafio permanecem acessíveis no mapa.

## Componentes e pesquisa

Usar Radix Primitives com CSS próprio: [instalação oficial](https://www.radix-ui.com/primitives/docs/overview/getting-started), [Dialog](https://www.radix-ui.com/primitives/docs/components/dialog), [Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu), [Avatar](https://www.radix-ui.com/primitives/docs/components/avatar). Esses componentes fornecem foco, teclado, Escape e comportamento de menus/dialogs. O projeto não usa Tailwind; a [instalação completa do shadcn](https://ui.shadcn.com/docs/installation/manual) acrescentaria uma segunda base de estilos sem necessidade.

Perfil usa `authClient.updateUser({ name })` e `refetch()` da sessão, conforme [Better Auth](https://better-auth.com/docs/concepts/users-accounts). Não criar ações decorativas ou mudanças de email/senha que o fluxo Google não suporta aqui. Fonte servida localmente via [Fontsource](https://fontsource.org/docs/getting-started/variable).

## Critérios de revisão

1. Criar e recuperar uma análise são imediatamente identificáveis.
2. Cada ação visível funciona; nenhum link de módulo futuro está presente.
3. Perfil salva o nome e logout encerra a sessão real.
4. O workspace abre com mapa dominante e sem uma coluna técnica obrigatória.
5. Camadas, informações e assistente abrem e fecham; menus e dialogs têm foco correto.
6. Upload, processamento, falha e ausência de resultados possuem estados próprios, sem progresso inventado.
7. Desktop e mobile não têm overflow horizontal, e o fluxo funciona por teclado.
8. Dados e imagens são reais; NDVI não é apresentado como comprovação de café.

Esta direção é uma decisão de implementação, não uma alegação de aprovação visual do usuário.

## Validação desta alteração

- TypeScript e build Next de produção passaram. Vinte testes unitários web passaram, com integração SQL explicitamente ignorada sem `TEST_DATABASE_URL`. Auditoria npm de produção sem advisories conhecidos.
- O fluxo ao vivo executou **dois processamentos novos reais**, exemplo e upload multiespectral + SCL; verificou imagem, polígonos, arquivos, chat, isolamento de outra identidade, navegação, busca/filtro e perfil salvo. A execução parou somente no último clique de logout, porque o indicador de desenvolvimento do Next cobria o avatar da rail. `devIndicators: false` corrigiu a interferência. Não foi reexecutado o processamento para repetir esse clique: a cota global estava em 9/10 e foi preservada.
- A regressão de UI em **build de produção local** usa PostgreSQL/Better Auth e Storage reais, usuário/sessões e prefixo descartáveis, com arquivos da cena pública realmente calculados antes. Ela cobre perfil persistido após refresh, logout na rail e no sheet móvel, popup de geometria real, camadas, teclado, Escape/retorno e contenção de foco, formulários e classificação no assistente. Não inicia jobs nem chama Gemini; verifica que a cota global permanece igual.
- O teste de login dedicado também passou no runtime de produção. Não automatiza consentimento OAuth Google. A validação generativa anterior permanece em `GEMINI_VALIDACAO.md`; o script foi adaptado aos novos seletores sem novas chamadas ao provedor nesta revisão.
- Na última execução do código final, **2 testes de navegador passaram em 37 s** (regressão quota-free e login). Depois da limpeza ficaram os mesmos 1 usuário, 1 sessão, 1 conta OAuth e 1 análise originais; cota global 9. Nenhum fixture foi deixado no banco/Storage.
- Revisão de capturas e limites dos controles em 1440, 768, 390 e 320 px. Um corte real da barra em 320 px foi corrigido, conservando nome acessível e controle de informações. Capturas aguardam fontes e desativam transições durante a captura, evitando frames intermediários do Leaflet/abas.
- Não foram repetidos os testes Python/SQL de toda a auditoria por uma mudança de apresentação; os dois novos jobs usaram o worker existente. Nenhum deploy, push, alteração de visibilidade ou commit foi feito. Não houve auditoria WCAG completa nem validação em um telefone físico.

## Reproduzir a regressão sem gastar a cota de jobs

Na raiz, com o ambiente Python existente, prepare apenas os artefatos públicos usados pela apresentação:

```powershell
$env:UI_FIXTURE_DIR = Join-Path $env:TEMP 'global-watch-ui-fixture'
& apps/geo-worker/.venv/Scripts/python.exe -m geo_worker.coffee_v2 classify data/sample/imagem_multiespectral.tif --scl data/sample/qualidade_scl.tif --date 2025-08-16 --output $env:UI_FIXTURE_DIR
pnpm.cmd build
pnpm.cmd --filter @global-watch/web start
```

Em outro terminal, com a mesma variável `UI_FIXTURE_DIR`, execute:

```powershell
$env:UI_FIXTURE_DIR = Join-Path $env:TEMP 'global-watch-ui-fixture'
$env:RUN_UI_BROWSER = '1'
pnpm.cmd --filter @global-watch/web exec playwright test platform.spec.ts
```

O teste exige banco **local**, Chrome, credenciais locais já configuradas e os seis artefatos reais da cena do kit. Cria e remove somente seus próprios fixtures. Isso é regressão de apresentação sobre uma análise pronta; não substitui o teste de envio/processamento, disponível em `RUN_LIVE_BROWSER=1` e sujeito às cotas compartilhadas. Nunca zerar cotas para fazer testes passarem.

Capturas do próprio aplicativo: [coleção](screenshots/desktop-analyses.png), [mapa](screenshots/desktop-results.png), [camadas](screenshots/desktop-layers.png), [perfil](screenshots/desktop-profile.png), [mapa móvel](screenshots/mobile-results.png), [perfil móvel](screenshots/mobile-profile.png). Capturas antigas de chat generativo e processamento têm sua proveniência preservada, sem tratá-las como prova de uma nova chamada Gemini.
