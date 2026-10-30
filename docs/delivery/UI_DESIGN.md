# Interface da plataforma — Global Watch Coffee

## Organização

A entrada autenticada é uma coleção de análises em `/analyses`: busca, filtro de status, ordenação por criação e ação **Nova análise**. Cada registro abre um workspace próprio em `/analyses/:id`. Refresh e histórico do navegador preservam a identidade da análise. A raiz `/` redireciona à coleção. O login Google é uma tela dedicada, sem mapa decorativo ou apresentação de marketing.

O shell compartilhado separa navegação, conta e conteúdo. A mesma sidebar com rótulos aparece na coleção e no mapa; o usuário pode recolhê-la e sua preferência permanece entre rotas e recargas. O controle fica na própria sidebar, junto à marca quando aberta e centralizado no topo da rail quando fechada. A transição de 200 ms conserva links/conta/foco; o modo de movimento reduzido a desliga. Tooltips identificam os ícones da rail. No celular, os mesmos itens abrem em um sheet. **Nova análise** fica no mesmo lugar do cabeçalho de 48 px em todas as rotas. Apenas o módulo implementado é mostrado. A composição por rotas permite acrescentar módulos depois sem colocar navegação vazia hoje.

## Sistema visual

A revisão de componentes e grid está em [COMPONENTES_E_ALINHAMENTO.md](COMPONENTES_E_ALINHAMENTO.md): container compartilhado de 1120 px incluindo gutters de 24/16 px, marca textual Global Watch, Button/Input/Select/Table do shadcn e contagens sem repetição. A coleção tem largura limitada; o mapa mantém o canvas completo.

- Inter variável servida localmente por Fontsource; corpo 13–14 px e metadados 12 px. Inputs de toque usam 16 px.
- Superfícies carvão neutras `#171717`, `#1d1d1f`, divisórias `#343437`, texto `#ededee`. Verde contido `#c0d6a6` nas geometrias e seleção; botão primário neutro.
- Controles de aproximadamente 36 px no desktop e alvos ampliados no toque. Cantos de 5–8 px, sem grades de KPIs, gradientes, glows ou vidro.
- Radix Dialog, Dropdown Menu, Avatar, Tabs, Switch e Tooltip com CSS próprio. Menus/dialogs não são imitações feitas apenas com `div` e handlers.

## Fluxos reais

**Nova análise:** dialog com upload como opção inicial e exemplos como alternativa. Arquivo obrigatório, requisitos de quatro bandas/CRS junto ao campo e opções de SCL/data em disclosure. Extensão, arquivo vazio e limites são verificados no navegador; o servidor e o Python continuam responsáveis pela validação efetiva. O fluxo usa upload direto ao Storage e distingue preparação, envio e início, sem porcentagens fictícias.

**Processamento:** a análise recebe rota própria e pode ser acompanhada depois pela coleção. Sair da tela interrompe somente a espera do navegador; não alega cancelar o job já aceito. Falhas e upload incompleto mostram ações de nova análise/retentativa.

**Resultado:** mapa ocupa o workspace, com imagem RGB efetivamente produzida, polígonos interativos, enquadramento, zoom, escala e atribuição. Zoom fracionário enquadra a imagem sem perder uma faixa inteira de resolução de zoom. Legenda, hectares e data da imagem analisada ficam visíveis. A aquisição aparece uma vez, no cabeçalho, em formato numérico que cabe no celular; o rótulo acessível e o tooltip identificam seu significado. O fundo padrão é Satélite MapTiler, com Ruas e Sem fundo no seletor. As imagens mantêm suas cores reais; não se aplica o filtro do antigo mapa base.

**Ferramentas:** Informações e Assistente são abas do mesmo painel à direita: 340 px, altura completa e geometria idêntica. Apenas o conteúdo muda. A conversa tem histórico rolável e composição fixa. Aproximar, afastar e enquadrar ficam no canto inferior direito do canvas, junto à divisória, sem mudar de posição entre abas. O mapa cede largura ao abrir o painel e recupera essa faixa ao fechá-lo, mantendo centro e zoom. O painel começa aberto no desktop e recolhido no celular. Quando recolhido, **Resultados** permite reabri-lo. **Camadas** reúne mapa de fundo e visibilidade do resultado. **Baixar** abre o menu para GeoJSON, PNG com polígonos, GeoTIFF classificado e RGB. O seletor distingue o fundo MapTiler da imagem analisada e seus polígonos; não inventa um raster NDVI ou um calendário de aquisições.

**Explicação científica:** o painel mostra área candidata, contagem e NDVI. **Sobre o resultado** abre um dialog com método, limitações reais e significado do índice; dados técnicos ficam em disclosure. O popup mostra identificação e hectares. As ressalvas não se repetem a cada polígono, sem remover a distinção entre candidato e café confirmado.

**Chat:** vinculado à análise da rota. Mostra a classificação real, perguntas e respostas; alternar abas ou recolher o painel preserva a pergunta e as mensagens. Sugestões colocam foco no campo de composição. Fallback `rules_fallback_not_ai` é identificado como resposta por regras/IA indisponível; não se apresenta como resposta generativa. Trocar a análise ou encerrar a sessão desmonta esse contexto e aborta requisições pendentes.

**Conta:** avatar/nome abre menu com **Meu perfil** e **Sair da conta**. Nome salva via Better Auth e a sessão é atualizada. Email é somente leitura. Foco volta ao menu após fechar o perfil. Não existem telas fictícias de times, cobrança ou configurações.

## Acessibilidade e mobile

Dialogs usam título, descrição, foco contido, Escape e retorno de foco ao botão de origem. O sheet móvel segue o mesmo comportamento. Ferramentas do mapa são regiões não modais: mantêm o mapa utilizável, recebem foco ao abrir e fecham com Escape, sem interferir em outro dialog/menu aberto. Botões possuem rótulos; formulários têm labels e erros anunciados. O campo do chat preserva o foco durante a espera. Há link de salto, contraste e foco visível; animações respeitam reduced motion.

No celular, o painel ocupa a área principal abaixo do cabeçalho em ambas as abas. O mapa e os controles ficam temporariamente ocultos. Fechar o painel restaura o mapa sem alterar sua posição. A data continua visível no cabeçalho. A tabela oculta colunas secundárias em telas estreitas, mantendo registro/status/abertura. Decisão e capturas: [CONVERSA_E_NAVEGACAO_DO_MAPA.md](CONVERSA_E_NAVEGACAO_DO_MAPA.md).

## Dados e limites preservados

Não foram adicionados clima, alertas, séries, acurácia ou dados inventados. Áreas continuam candidatas, sem validação de campo. APIs, autorização por proprietário, processamento Python, armazenamento privado, cotas e retenção foram preservados. A coleção usa os até 30 registros recentes já retornados pela API; busca/filtro são locais nesse conjunto. Não se promete paginação ou busca global ainda não implementada. O nome original do upload não é persistido pelo schema atual; a identificação usa o ID real da análise.

As referências enviadas, incluindo MapBiomas, orientam hierarquia e padrões de interação. Não são assets e não foram copiadas para o repositório. Decisões iniciais: [UI_REDESIGN.md](UI_REDESIGN.md). A evolução vigente de fontes/datas/painel está em [MAPAS_E_DATAS.md](MAPAS_E_DATAS.md), e a revisão do shell e da hierarquia em [SHELL_E_HIERARQUIA.md](SHELL_E_HIERARQUIA.md). Evidências técnicas e visuais não substituem a avaliação visual do usuário.
