# Interface da plataforma — Global Watch Coffee

## Organização

A entrada autenticada é uma coleção de análises em `/analyses`: busca, filtro de status, ordenação por criação e ação **Nova análise**. Cada registro abre um workspace próprio em `/analyses/:id`. Refresh e histórico do navegador preservam a identidade da análise. A raiz `/` redireciona à coleção. O login Google é uma tela dedicada, sem mapa decorativo ou apresentação de marketing.

O shell compartilhado separa navegação, conta e conteúdo. Ao entrar numa análise, a sidebar recolhe automaticamente; a expansão manual vale para essa visita. Ao voltar à coleção, a preferência anterior da lista é restaurada. O controle fica na própria sidebar, junto à marca quando aberta e centralizado no topo da rail quando fechada. A transição de 200 ms conserva links/conta/foco; movimento reduzido a desliga. Tooltips identificam os ícones da rail. No celular, os mesmos itens abrem em um sheet. **Nova análise** fica no cabeçalho de 48 px em todas as rotas. Apenas o módulo implementado é mostrado.

## Sistema visual

Coleção e cabeçalho usam a largura disponível e gutters de 24/16 px, sem container centralizado; marca textual Global Watch; componentes shadcn; contagem somente no rodapé da tabela. O status tem cores coerentes entre lista e seletor.

- Inter variável servida localmente por Fontsource; corpo 13–14 px e metadados 12 px. Inputs de toque usam 16 px.
- Superfícies carvão neutras `#171717`, `#1d1d1f`, divisórias `#343437`, texto `#ededee`. Verde contido `#c0d6a6` nas geometrias e seleção; botão primário neutro.
- Controles de aproximadamente 36 px no desktop e alvos ampliados no toque. Cantos de 5–8 px, sem grades de KPIs, gradientes, glows ou vidro.
- Componentes shadcn/Radix Dialog, Dropdown Menu, Avatar, Tabs, Switch e Tooltip estilizados com Tailwind 4 sem prefixo. Menus/dialogs não são imitações feitas apenas com `div` e handlers.

## Fluxos reais

**Nova análise:** dialog com upload como opção inicial e exemplos como alternativa. Arquivo obrigatório, requisitos de quatro bandas/CRS junto ao campo e opções de SCL/data em disclosure. Extensão, arquivo vazio e limites são verificados no navegador; o servidor e o Python continuam responsáveis pela validação efetiva. O fluxo usa upload direto ao Storage e distingue preparação, envio e início, sem porcentagens fictícias.

**Processamento:** a análise recebe rota própria e pode ser acompanhada depois pela coleção. Sair da tela interrompe somente a espera do navegador; não alega cancelar o job já aceito. Falhas e upload incompleto mostram ações de nova análise/retentativa.

**Resultado:** mapa ocupa o workspace, com imagem RGB efetivamente produzida, polígonos interativos, enquadramento, zoom, escala e atribuição. Zoom fracionário enquadra a imagem sem perder uma faixa inteira de resolução de zoom. Legenda, hectares e data da imagem analisada ficam visíveis. A aquisição aparece uma vez, no cabeçalho, em formato numérico que cabe no celular; o rótulo acessível e o tooltip identificam seu significado. O fundo padrão é Satélite MapTiler, com Ruas e Sem fundo no seletor. As imagens mantêm suas cores reais; não se aplica o filtro do antigo mapa base.

**Ferramentas:** Informações e Assistente são abas do mesmo painel à direita: 340 px, altura completa e geometria idêntica. Apenas o conteúdo muda. A conversa tem histórico rolável e composição fixa. Aproximar, afastar e enquadrar ficam no canto inferior direito do canvas, junto à divisória, sem mudar de posição entre abas. O mapa cede largura ao abrir o painel e recupera essa faixa ao fechá-lo, mantendo centro e zoom. O painel começa aberto no desktop e recolhido no celular. Quando recolhido, **Resultados** permite reabri-lo. **Camadas** reúne mapa de fundo e visibilidade do resultado. **Baixar** abre o menu para GeoJSON, PNG com polígonos, GeoTIFF classificado e RGB. O seletor distingue o fundo MapTiler da imagem analisada e seus polígonos; não inventa um raster NDVI ou um calendário de aquisições.

**Explicação científica:** o painel mostra área estimada, contagem e NDVI. **Sobre o resultado** abre um dialog com método, limitações reais e significado do índice; dados técnicos ficam em disclosure. O popup mostra identificação e hectares. As ressalvas não se repetem a cada polígono, sem remover a distinção entre candidato e café confirmado.

**Posição das ferramentas:** a legenda **Plantações de Café** fica no alto à esquerda e sempre mostra os hectares. Camadas/Baixar formam um grupo vertical no alto à direita do canvas; Mostrar resultados aparece acima desse grupo, separado. A navegação e as ações usam o mesmo componente, medidas, fundo, bordas, divisórias, ícones e tooltips. A legenda e o toggle de polígonos usam o mesmo vocabulário. O painel mostra **Área estimada** e **Polígonos identificados**; a explicação científica continua disponível em Sobre o resultado.

**Chat:** vinculado à análise da rota. Mostra a classificação real, perguntas e respostas; alternar abas ou recolher o painel preserva a pergunta e as mensagens. Sugestões colocam foco no campo de composição. Fallback `rules_fallback_not_ai` é identificado como resposta por regras/IA indisponível; não se apresenta como resposta generativa. Trocar a análise ou encerrar a sessão desmonta esse contexto e aborta requisições pendentes.

**Conta:** avatar/nome abre menu com **Meu perfil** e **Sair da conta**. Nome salva via Better Auth e a sessão é atualizada. Email é somente leitura. Foco volta ao menu após fechar o perfil. Não existem telas fictícias de times, cobrança ou configurações.

## Acessibilidade e mobile

Dialogs usam título, descrição, foco contido, Escape e retorno de foco ao botão de origem. O sheet móvel segue o mesmo comportamento. Ferramentas do mapa são regiões não modais: mantêm o mapa utilizável, recebem foco ao abrir e fecham com Escape, sem interferir em outro dialog/menu aberto. Botões possuem rótulos; formulários têm labels e erros anunciados. O campo do chat preserva o foco durante a espera. Há link de salto, contraste e foco visível; animações respeitam reduced motion.

No celular, o painel ocupa a área principal abaixo do cabeçalho em ambas as abas. O mapa e os controles ficam temporariamente ocultos. Fechar o painel restaura o mapa sem alterar sua posição. A data continua visível no cabeçalho. A tabela oculta colunas secundárias em telas estreitas, mantendo registro/status/abertura.

## Dados e limites preservados

Não foram adicionados clima, alertas, séries, acurácia ou dados inventados. Áreas continuam candidatas, sem validação de campo. APIs, autorização por proprietário, processamento Python, armazenamento privado, cotas e retenção foram preservados. A coleção usa os até 30 registros recentes já retornados pela API; busca/filtro são locais nesse conjunto. Não se promete paginação ou busca global ainda não implementada. O nome original do upload não é persistido pelo schema atual; a identificação usa o ID real da análise.

As referências enviadas, incluindo MapBiomas, orientam hierarquia e padrões de interação. Não são assets e não foram copiadas para o repositório. A evolução vigente de fontes/datas/painel está em [MAPAS_E_DATAS.md](MAPAS_E_DATAS.md). Evidências técnicas e visuais não substituem a avaliação visual do usuário.

## Inspeção multiespectral — 30/10/2026

A migração preserva shell e controles e organiza componentes por feature. CSS permanece apenas nos tokens/base, animações e na ponte Leaflet; a ordem explícita das layers mantém as utilities acima da base.

Camadas oferece Cor natural, Falsa cor e NDVI somente quando o resultado declara esses arquivos. O carregamento é sob demanda, com cache da análise, opacidade e preservação da última imagem válida em falhas. A escala NDVI representa [-1,1], sem categorias inventadas de saúde. Resultados legados continuam RGB.

Explorar polígonos fica recolhido nas Informações: busca por número, ordenação por área/ID e paginação de 50 itens. Seleção na lista localiza o polígono; seleção no mapa mantém o painel como está. No celular, localizar fecha o painel para mostrar o mapa. Perguntar sobre o polígono apenas preenche o chat, sem enviar automaticamente.

Qualidade e proveniência ficam em Sobre o resultado, sob divulgação progressiva. Metadados JSON estão no mesmo menu de downloads.

## Tabela e seleção

A linha inteira da tabela é um link nativo, com seta de abertura, hover de ponta a ponta e padding dentro das células. Teclado e abertura em nova aba preservam o comportamento do navegador. No mapa, clicar no fundo limpa popup e seleção; os controles de zoom preservam o polígono selecionado.

A regressão `RUN_UI_BROWSER=1` usa seis artefatos reais de uma cena pública em `UI_FIXTURE_DIR`; `RUN_INSPECTION_BROWSER=1` usa os oito artefatos de esquema 2 em `INSPECTION_FIXTURE_DIR`. São fixtures de análise pronta e não substituem o fluxo live de upload/processamento. As evidências e os limites estão em [Validação da entrega](AUDITORIA_FINAL.md).
