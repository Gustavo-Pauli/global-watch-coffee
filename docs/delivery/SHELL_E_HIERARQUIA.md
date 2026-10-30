# Shell, hierarquia e leitura dos resultados

## Decisão antes da implementação

A revisão anterior ainda mudava regras ao entrar no mapa: sidebar completa virava rail automaticamente, a criação mudava de lugar, havia retorno à coleção junto à navegação lateral e “Detalhes” controlava uma área distante. A revisão atual unifica essas regras de navegação.

Foram comparadas duas alternativas: rail fixa de ícones em todas as páginas; ou sidebar com rótulos, recolhida por escolha do usuário. Escolhida a segunda para reduzir a necessidade de memorizar ícones. A preferência de recolhimento é mantida entre rotas. Em telas móveis, os mesmos itens aparecem no menu de navegação.

```text
Navegação global                   Cabeçalho comum
marca                             [recolher/abrir navegação] título + aquisição   [Nova análise]
Análises
conta                             Contexto do mapa
                                  [Camadas] [Baixar]         [Informações | Assistente]
                                  mapa + imagem + candidatos
```

Nova análise tem um único lugar global no cabeçalho, inclusive no celular. A coleção não repete título/subtítulo/ação logo abaixo. O mapa não troca o shell nem acrescenta uma criação exclusiva à sidebar. Voltar à coleção usa a navegação Análises. Controles de mapa ficam no mapa; o painel mostra seu controle de reabertura somente quando está recolhido.

## Informação e texto

- Aquisição no cabeçalho; não repetir no painel e no seletor. Formato numérico completo no celular, com identificação da aquisição no rótulo acessível e no tooltip; **Sem data** quando ausente.
- Informações: hectares, contagem de candidatos e NDVI, sem parágrafo permanente de ressalvas.
- Sobre o resultado: explicação científica e limitações acessíveis, em um único dialog. O desafio exige justificar o método e distinguir candidatos de café confirmado; esse conteúdo deve continuar disponível.
- Popup de polígono: identificação e área, sem repetir o aviso científico em cada interação.
- Camadas: mapa de fundo, opções e visibilidade do resultado. Remover descrições óbvias e a data repetida. Manter a informação de que o satélite de referência é um mosaico temporal.
- Chat: classificação e entrada de pergunta; remover introdução/rodapé redundantes. Manter identificação de resposta por regras quando a IA não responder.

O método de revisão usa consistência, reconhecimento e foco no essencial, conforme as [heurísticas da Nielsen Norman Group](https://www.nngroup.com/articles/ten-usability-heuristics/). São critérios de inspeção, não prova de usabilidade com usuários. A decisão específica do shell é nossa aplicação desses critérios ao fluxo real deste projeto.

## Verificação executada

- Build de produção Next e TypeScript passaram. Testes web: **20 passaram**, com integração SQL explicitamente ignorada sem banco descartável configurado.
- Playwright com Chrome instalado, servidor local já mantido pelo usuário e fixtures descartáveis de banco/Storage: **2 testes passaram em 46,3 s**; o fluxo live que consome processamento ficou desativado. A cena pública já processada fornece os seis artefatos reais usados na revisão da interface.
- Navegação coleção → análise → coleção conserva largura, rótulos e preferência da sidebar; recarga conserva o recolhimento. Nova análise permanece no mesmo lugar do cabeçalho. Menu móvel, perfil e logout também foram verificados. Não foi repetido o handshake OAuth Google nesta alteração.
- Abas por teclado, pergunta preservada, visibilidade das camadas, download, popup curto e foco ao fechar/reabrir os resultados passaram. Sobre o resultado mantém método e limitações, contém foco no dialog, fecha com Escape e devolve o foco.
- Capturas revisadas em **320, 390, 768 e 1440 px**. Uma regra antiga recuava e cortava a data no celular; o novo cabeçalho passou a ter uma classe própria. As verificações agora exigem texto numérico completo, sem clipping, além de `datetime`, nome acessível e tooltip.
- **174 respostas de tiles MapTiler, todas HTTP 200**, com Referer limitado à origem local. Zero chamadas aos endpoints de processamento/chat e zero erros de página. A cota global permaneceu em **10**.
- Fixtures removidos, dados e servidores do usuário preservados. Nenhuma alteração em `.env`, `.env.local` ou `.venv`, nenhuma migração e nenhum commit. Esta revisão local não é evidência de deploy nem teste de usabilidade com usuários.

Capturas atuais: [coleção](screenshots/desktop-analyses.png), [mapa e informações](screenshots/desktop-information.png), [camadas](screenshots/desktop-layers.png), [explicação científica](screenshots/desktop-about-result.png), [mapa em 320 px](screenshots/mobile-narrow-results.png) e [informações no celular](screenshots/mobile-information.png).
