# Conversa e navegação do mapa — 30/10/2026

**Atualização de 30/10:** painel com abertura animada e popups para a esquerda, incluindo mobile; conversa generativa com histórico validada. [Evidências atuais](REVISAO_ENTREGA_2026-10-30.md). A seção de verificação abaixo é histórica.

## Organização

Informações e Assistente usam **o mesmo painel de 340 px**, com toda a altura da área principal à direita, abaixo do cabeçalho. A posição, as dimensões, o cabeçalho das abas e o botão de fechar são idênticos. Só o conteúdo muda. O mapa cede essa faixa horizontal enquanto o painel está aberto, mantendo seu centro geográfico. Alternar abas não redimensiona o canvas nem desloca os controles.

A thread tem rolagem própria e o campo de pergunta fica fixo no rodapé. Informações mantém as medidas e o acesso à explicação científica no topo, com rolagem própria quando necessária. Não existe uma reserva vertical para colocar zoom/enquadramento abaixo da conversa.

Os três controles **aproximar, afastar e enquadrar** foram mantidos. Ficam no canto inferior direito do canvas, junto à divisória do painel em ambas as abas. Quando o painel é fechado, acompanham a borda externa do mapa ampliado. Créditos e escala também pertencem ao canvas e não ficam abaixo da conversa.

A legenda **Plantações de Café**, com hectares permanentes, ocupa o alto à esquerda. Camadas/Baixar ocupam o alto à direita em um grupo vertical; o botão Mostrar resultados aparece acima, separado. Ambos usam o mesmo componente, tamanho, fundo, bordas e divisórias da navegação. Não existem dois padrões de botões cartográficos.

## Como as referências orientaram a decisão

| Referência enviada | Padrão observado | Aplicação no Global Watch |
|---|---|---|
| EarthEye, interface escura | Dados em painéis laterais; ferramentas do mapa junto às suas bordas | Dados concentrados em uma região, agrupamento de Camadas/Baixar e controles periféricos |
| Análise agrícola clara | Navegação, ações e detalhe selecionado têm regiões diferentes | Sidebar global preservada; contexto da análise no cabeçalho; popup ligado ao polígono |
| Mapa de classificação claro | Origem/período e legenda têm hierarquia própria; controles não invadem os dados | Data de aquisição no cabeçalho; mosaico identificado no seletor; legenda da classe candidata |
| MapBiomas, duas vistas | Coluna de dados separa fisicamente o canvas; zoom permanece na borda desse canvas | Painel lateral contínuo e único para Informações/Assistente; mapa e controles estáveis entre abas |

Os padrões foram combinados conforme o conteúdo existente. Não foram copiados logos, screenshots, dados, séries, clima, alertas, classes de cultivo ou gráficos das referências. Não foi acrescentado um calendário sem catálogo temporal real.

No celular e em telas estreitas, o mesmo painel ocupa a área principal abaixo do cabeçalho em ambas as abas. O mapa e seus controles ficam temporariamente ocultos e fora da navegação por teclado. Fechar o painel restaura o mapa no mesmo enquadramento e devolve foco a Resultados; pergunta e mensagens são preservadas.

## Limites preservados

A mudança é de composição e foco. Não altera geometrias, resultados, APIs, processamento, chaves ou armazenamento. No desktop, o canvas muda de largura somente ao abrir/fechar o painel, conservando o centro e o nível de zoom. No celular, o mapa continua montado para conservar sua posição. O controle Resultados pertence ao workspace, fora da região temporariamente oculta do mapa, para poder receber foco após fechar. Não foi criado um segundo chat ou outra navegação.

## Verificação

A regressão usa artefatos reais já processados e fixtures descartáveis, sem novos jobs ou chamadas Gemini. **Build de produção e TypeScript passaram; dois testes de navegador passaram**, com o fluxo live de processamento desativado. A UI foi verificada em 320, 390, 768 e 1440 px, incluindo pouca altura.

As verificações exigem geometria idêntica do painel entre abas, mapa e três controles imóveis durante essa troca, campo fixo com histórico rolável, ausência de sobreposição, conservação do centro/zoom ao fechar e reabrir, pergunta preservada e retorno de foco no celular. Foram observadas **86 respostas MapTiler, todas HTTP 200**. Zero jobs/chat; cota global em 10. Fixtures foram removidos, ambientes e servidores preservados. Nenhum commit foi feito. A revisão local não representa deploy ou teste com usuários.

Capturas: [conversa no desktop](screenshots/desktop-chat-ready.png), [informações](screenshots/desktop-information.png), [conversa móvel](screenshots/mobile-chat-ready.png), [pouca altura](screenshots/mobile-short-chat.png).
