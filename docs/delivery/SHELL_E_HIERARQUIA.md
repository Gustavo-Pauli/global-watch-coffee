# Shell, hierarquia e leitura dos resultados

A organização vigente, incluindo a análise das quatro referências enviadas, está em [CONVERSA_E_NAVEGACAO_DO_MAPA.md](CONVERSA_E_NAVEGACAO_DO_MAPA.md): painel único e de geometria idêntica para Informações/Assistente, com os três controles no canto do canvas e sem deslocamento entre abas.

Revisão de 30/10: [componentes, container e alinhamento](COMPONENTES_E_ALINHAMENTO.md). A coleção e o cabeçalho agora compartilham limites e gutters, os controles principais usam shadcn e a marca é somente Global Watch. As evidências abaixo documentam a revisão anterior do painel flutuante.

## Navegação compartilhada

A coleção e o mapa usam as mesmas regras de navegação. A sidebar mantém rótulos ou rail conforme a escolha do usuário, com preferência preservada entre rotas e recargas. A conta e os destinos não mudam de lugar quando uma análise é aberta.

Nova análise tem um único lugar global no cabeçalho, inclusive no celular. A coleção não repete título/subtítulo/ação logo abaixo. O mapa não troca o shell nem acrescenta uma criação exclusiva à sidebar. Voltar à coleção usa a navegação Análises. Controles de mapa ficam no mapa; o painel mostra seu controle de reabertura somente quando está recolhido.

## Revisão de composição: painel flutuante e navegação

A revisão seguinte responde à moldura ainda rígida: o cabeçalho de 64 px e a coluna direita inteira reservavam espaço além do conteúdo. Foram comparadas três alternativas:

| Alternativa | Ganho | Custo |
|---|---|---|
| Painel flutuante, com altura conforme a aba | O mapa continua abaixo das informações e mantém toda a largura | O enquadramento precisa considerar a área encoberta; controles não podem se sobrepor |
| Coluna direita até o topo, com cabeçalho só sobre o mapa | Alinha a junção superior e oferece espaço estável para conversa | Continua reservando toda a altura para poucas informações |
| Painel fechado inicialmente | Libera o mapa inteiro | Esconde os resultados essenciais na primeira leitura |

Foi escolhido o painel flutuante. Informações usa altura natural; Assistente mantém a posição/largura, ganha altura limitada e separa histórico rolável do campo de pergunta. A troca de abas e o fechamento não redimensionam nem reenquadram o mapa. Enquadrar imagem considera o painel aberto em telas largas. No celular, o painel começa abaixo das ferramentas; em pouca altura, prioriza a conversa e oculta controles concorrentes até fechar, conservando escala e créditos.

```text
marca       recolher │ Análise · aquisição                  Nova análise  (48 px)
Análises             ├──────────────────────────────────────────────────────────
                     │ Camadas · Baixar                  ┌ Informações | Assistente × ┐
                     │                                  │ conteúdo da aba            │
                     │                MAPA              └────────────────────────────┘
                     │                     mapa continua abaixo das informações
conta                │ legenda                                             zoom
```

O cabeçalho comum tem 48 px e mantém título e aquisição na mesma linha no desktop. O controle de recolher pertence à sidebar, ao lado da marca. Na rail, expandir ocupa esse mesmo topo, sem marca duplicada. Largura e rótulos têm transição curta; destinos e conta permanecem no DOM para conservar foco. A preferência é restaurada antes do paint, com animações habilitadas depois. Tooltips identificam os ícones da rail; a composição de triggers segue o [padrão oficial Radix `asChild`](https://www.radix-ui.com/primitives/docs/guides/composition). O modo de movimento reduzido desliga essas transições. Cores e identidade visual foram mantidas.

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
- Playwright com Chrome instalado, servidor local já mantido pelo usuário e fixtures descartáveis de banco/Storage: **2 testes passaram em 56,2 s**; o fluxo live que consome processamento ficou desativado. A cena pública já processada fornece os seis artefatos reais usados na revisão da interface.
- A repetição somente da UI para registrar a thumbnail já carregada em 320 px passou em **55,6 s**, sem repetir o teste de login. A captura agora exige imagem completa com dimensões naturais válidas.
- Navegação coleção → análise → coleção conserva largura, rótulos e preferência da sidebar; recarga conserva o recolhimento. Nova análise permanece no mesmo lugar do cabeçalho. Menu móvel, perfil e logout também foram verificados. Não foi repetido o handshake OAuth Google nesta alteração.
- Abas por teclado, pergunta preservada, visibilidade das camadas, download, popup curto e foco ao fechar/reabrir os resultados passaram. Sobre o resultado mantém método e limitações, contém foco no dialog, fecha com Escape e devolve o foco.
- Cabeçalho de **48 px**, controle dentro da sidebar, tooltip por ponteiro/teclado e transição de **200 ms** foram verificados. Movimento reduzido desativa a animação. Restaurar a preferência não anima o primeiro layout. O centro geográfico é conservado ao recolher a sidebar, e abrir/fechar o painel ou trocar abas não altera tamanho/enquadramento do mapa.
- Capturas revisadas em **320, 390, 768 e 1440 px**, além de **390 × 500 px** para pouca altura. Info cresce pelo conteúdo e Chat mantém o composer visível com histórico rolável, inclusive sob carga de texto de teste. Zoom, legenda, escala, créditos e painel não competem por espaço nos estados normais. A data numérica permanece completa, com `datetime`, nome acessível e tooltip.
- A primeira checagem de tooltip falhou ao saltar o ponteiro em um único evento entre triggers. Movimento contínuo via área neutra e foco por teclado passaram, preservando a área hoverable do Radix; isso foi corrigido na automação, sem mudar o componente para contornar o teste.
- **90 respostas de tiles MapTiler na última execução, todas HTTP 200** (86 na execução completa anterior), com Referer limitado à origem local. Zero chamadas aos endpoints de processamento/chat e zero erros de página. A cota global permaneceu em **10**.
- Fixtures removidos, dados e servidores do usuário preservados. Nenhuma alteração em `.env`, `.env.local` ou `.venv`, nenhuma migração e nenhum commit. Esta revisão local não é evidência de deploy nem teste de usabilidade com usuários.

Capturas atuais: [coleção](screenshots/desktop-analyses.png), [rail](screenshots/desktop-sidebar-collapsed.png), [mapa e informações](screenshots/desktop-information.png), [assistente](screenshots/desktop-chat-ready.png), [camadas](screenshots/desktop-layers.png), [explicação científica](screenshots/desktop-about-result.png), [mapa em 320 px](screenshots/mobile-narrow-results.png) e [chat com pouca altura](screenshots/mobile-short-chat.png).

Comparação de composição: [inset flutuante escolhido](screenshots/shell-floating-information.png) e [coluna até o topo](screenshots/shell-docked-comparison.png). Usam a mesma cena processada, sem fundo externo; o dock é apenas uma simulação temporária de CSS durante a revisão, removida em seguida. Não existe seletor de layouts no produto.
