# Componentes e alinhamento — 30/10/2026

**Revisão atual:** veja [30/10 — entrega](REVISAO_ENTREGA_2026-10-30.md). Camadas/Baixar agora abrem à esquerda; o painel tem transição de abertura. A seção de verificação abaixo registra a etapa anterior, sem novos jobs naquele momento.

## Composição

A coleção e seu cabeçalho usam toda a largura disponível, com padding de **24 px** no desktop ou **16 px** no celular. Não existe limite central de 1120 px nem margem automática. Título, busca e tabela começam na mesma borda; Nova análise termina na borda direita do conteúdo. O cabeçalho mostra apenas o título, sem contagem. O mapa tem gutters próprios de 14/12 px.

No celular, a busca ocupa uma linha completa; status e atualização ficam na linha seguinte. Isso evita comprimir campos com texto até truncá-los. O botão Nova análise usa Inter **13 px, peso 500 e linha de 20 px**. Busca usa 13 px no desktop e 16 px em dispositivos de toque para evitar zoom ao focar o campo.

## Componentes implementados

Antes desta revisão, a interface usava primitives Radix e CSS próprio. Agora há configuração `components.json`, `cn` e componentes locais **Button, Input, Select e Table**, obtidos do registro oficial shadcn `new-york-v4`. Os arquivos preservam a URL de origem e a licença MIT em `components/ui/LICENSE`. A instalação segue o [fluxo manual do shadcn](https://ui.shadcn.com/docs/installation/manual).

- Button: cabeçalho, ações da coleção, criação e perfil.
- Input: busca e campos de perfil.
- Select: filtro de status, com bolinhas nas opções e no valor selecionado, usando as mesmas cores e rótulos da tabela. O texto continua identificando o estado sem depender apenas da cor. Menu, teclado e digitação para localizar uma opção foram preservados.
- Table: estrutura semântica da lista; ordenação e links reais foram preservados.

Dialog, abas, menus da conta e camadas continuam usando os primitives Radix já existentes. Esta etapa não afirma que todos os componentes foram migrados para shadcn.

Tailwind 4 compila somente as classes dos componentes UI com prefixo `ui:`. Os tokens usam a paleta existente. Não se aplica o reset global Preflight sobre a aplicação ou o Leaflet, conforme a [configuração de Preflight do Tailwind](https://tailwindcss.com/docs/preflight). Utilities são carregadas sem uma camada inferior ao CSS legado; isso evita que o normalize de `button` anule as cores dos componentes. Medidas de layout continuam no CSS da plataforma.

## Simplificação

- Marca textual **Global Watch**, sem símbolo, subtítulo Coffee ou repetição no rodapé do login.
- Contagem somente **abaixo da tabela**. Com filtro, mostra o subconjunto, como **0 de 1 análise**. O cabeçalho não mostra número.
- Sem caixa decorativa de arquivo e sem segunda seta/link de abertura na tabela. O título continua sendo o link da análise.
- A legenda **Plantações de Café** mostra os hectares permanentemente, inclusive com Informações aberto. Não há mais uma condição que esconda essa medida.
- A explicação geral do dialog de criação fica acessível sem repetir texto visível. Requisitos de arquivo, bandas, limites e erros permanecem junto ao formulário.

## Organização da análise e da conta

A sidebar recolhe automaticamente em cada entrada numa análise, inclusive ao abrir outro ID ou recarregar. Pode ser expandida durante essa visita; ao voltar à coleção, sua preferência anterior é restaurada. A expansão temporária do mapa não sobrescreve a preferência da lista.

O botão da conta tem **44 × 44 px na rail**, com avatar centralizado. Aberto, tem **52 px de altura**; nome e e-mail usam linha de 16 px e gap de 2 px. Perfil, logout, tooltips e retorno de foco foram preservados.

No mapa, a legenda **Plantações de Café** fica no canto superior esquerdo e mantém a área em hectares sempre visível. Área estimada e polígonos identificados usam os valores reais do processamento; método e limitações continuam em Sobre o resultado. No canto superior direito do canvas, **Camadas** e **Baixar arquivos** formam um grupo vertical de ícones. Quando o painel está fechado, **Mostrar resultados** aparece acima, em um botão separado com intervalo de 8 px. Todos têm nome acessível e tooltip. No celular, a medida pode ocupar uma segunda linha.

Configurações e navegação cartográfica usam o **mesmo MapToolButton**, os mesmos grupos verticais e a mesma regra visual: botões de 36 px no desktop com mouse ou 40 px em toque, ícones de 18 px, fundo/borda/divisórias/sombra comuns e padding zero no grupo. Os dois grupos se alinham ao recuo direito de 14 px no desktop ou 12 px no celular. Tooltips abrem à esquerda.

Informações e Assistente conservam o mesmo painel lateral de 340 px e altura completa; somente o conteúdo muda. Aproximar, afastar e enquadrar permanecem juntos na borda inferior direita do canvas. Controles cartográficos não pertencem ao painel de conversa. Referências e comportamento: [CONVERSA_E_NAVEGACAO_DO_MAPA.md](CONVERSA_E_NAVEGACAO_DO_MAPA.md).

## Verificação

Build Next de produção e TypeScript passaram. **20 testes unitários e dois testes de navegador passaram**, com integração SQL e o fluxo live que consome processamento explicitamente desativados. A revisão usou Chrome via Playwright e o servidor local do usuário; não representa deploy nem teste com usuários.

As verificações usam a cena pública já processada e fixtures descartáveis de banco/Storage. Cobrem alinhamento/largura em **1920 px** com sidebar aberta e recolhida, marca sem SVG/subtítulo, tipografia computada **Inter 13 px / 500** do CTA, Select por teclado/digitação, busca, contagem, estados vazios, criação e perfil. Mapa, abas, foco, movimento reduzido e capturas em **320, 390, 768 e 1440 px**, além de chat em pouca altura, foram preservados. A captura do formulário e do perfil também foi revisada.

Foram observadas **106 respostas MapTiler, todas HTTP 200**. Nenhum job ou chamada Gemini foi iniciado; a cota global permaneceu em **10**. Fixtures foram removidos. Arquivos de ambiente, `.venv` e servidores foram preservados. Não foi feito commit.

Capturas: [coleção](screenshots/desktop-analyses.png), [monitor amplo](screenshots/wide-analyses.png), [filtro de status](screenshots/desktop-status-filter.png), [coleção móvel](screenshots/mobile-analyses.png).
