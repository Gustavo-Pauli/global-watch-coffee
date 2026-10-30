# Componentes e alinhamento — 30/10/2026

## Composição

A coleção e seu cabeçalho usam o mesmo `.page-container`: largura máxima de **1120 px incluindo os gutters**, margem horizontal automática e padding de **24 px** no desktop ou **16 px** no celular. Título, busca e tabela começam na mesma borda; Nova análise termina na borda direita do conteúdo. A largura não aumenta indefinidamente em monitores grandes. O mapa continua usando todo o canvas; seu cabeçalho segue o recuo das ferramentas, sem herdar o limite da tabela.

No celular, a busca ocupa uma linha completa; status e atualização ficam na linha seguinte. Isso evita comprimir campos com texto até truncá-los. O botão Nova análise usa Inter **13 px, peso 500 e linha de 20 px**. Busca usa 13 px no desktop e 16 px em dispositivos de toque para evitar zoom ao focar o campo.

## Componentes implementados

Antes desta revisão, a interface usava primitives Radix e CSS próprio. Agora há configuração `components.json`, `cn` e componentes locais **Button, Input, Select e Table**, obtidos do registro oficial shadcn `new-york-v4`. Os arquivos preservam a URL de origem e a licença MIT em `components/ui/LICENSE`. A instalação segue o [fluxo manual do shadcn](https://ui.shadcn.com/docs/installation/manual).

- Button: cabeçalho, ações da coleção, criação e perfil.
- Input: busca e campos de perfil.
- Select: filtro de status, com menu, seleção, teclado e digitação para localizar uma opção.
- Table: estrutura semântica da lista; ordenação e links reais foram preservados.

Dialog, abas, menus da conta e camadas continuam usando os primitives Radix já existentes. Esta etapa não afirma que todos os componentes foram migrados para shadcn.

Tailwind 4 compila somente as classes dos componentes UI com prefixo `ui:`. Os tokens usam a paleta existente. Não se aplica o reset global Preflight sobre a aplicação ou o Leaflet, conforme a [configuração de Preflight do Tailwind](https://tailwindcss.com/docs/preflight). Utilities são carregadas sem uma camada inferior ao CSS legado; isso evita que o normalize de `button` anule as cores dos componentes. Medidas de layout continuam no CSS da plataforma.

## Simplificação

- Marca textual **Global Watch**, sem símbolo, subtítulo Coffee ou repetição no rodapé do login.
- Uma contagem junto ao título; com filtro, mostra o subconjunto, como **0 de 1**. O rodapé não repete o total.
- Sem caixa decorativa de arquivo e sem segunda seta/link de abertura na tabela. O título continua sendo o link da análise.
- Hectares aparecem no painel de Informações. Quando ele é fechado ou a aba Assistente está ativa, aparecem na legenda, mantendo a área disponível sem exibi-la em dois lugares ao mesmo tempo.
- A explicação geral do dialog de criação fica acessível sem repetir texto visível. Requisitos de arquivo, bandas, limites e erros permanecem junto ao formulário.

## Verificação

Build Next de produção e TypeScript passaram. **20 testes unitários e dois testes de navegador passaram**, com integração SQL e o fluxo live que consome processamento explicitamente desativados. A revisão usou Chrome via Playwright e o servidor local do usuário; não representa deploy nem teste com usuários.

As verificações usam a cena pública já processada e fixtures descartáveis de banco/Storage. Cobrem alinhamento/largura em **1920 px** com sidebar aberta e recolhida, marca sem SVG/subtítulo, tipografia computada **Inter 13 px / 500** do CTA, Select por teclado/digitação, busca, contagem, estados vazios, criação e perfil. Mapa, abas, foco, movimento reduzido e capturas em **320, 390, 768 e 1440 px**, além de chat em pouca altura, foram preservados. A captura do formulário e do perfil também foi revisada.

Foram observadas **106 respostas MapTiler, todas HTTP 200**. Nenhum job ou chamada Gemini foi iniciado; a cota global permaneceu em **10**. Fixtures foram removidos. Arquivos de ambiente, `.venv` e servidores foram preservados. Não foi feito commit.

Capturas: [coleção](screenshots/desktop-analyses.png), [monitor amplo](screenshots/wide-analyses.png), [filtro de status](screenshots/desktop-status-filter.png), [coleção móvel](screenshots/mobile-analyses.png).
