# Mapas de referência, datas e painel da análise

## Decisão de produto

O usuário não precisa configurar uma fonte para começar. **Satélite** é o fundo padrão quando `NEXT_PUBLIC_MAPTILER_KEY` está configurada. **Ruas** ajuda a localizar municípios e acessos. **Sem fundo** permite focar na imagem e nos resultados, inclusive quando o provedor não estiver disponível. A escolha do fundo é uma preferência local do navegador.

O menu **Camadas** reúne essas opções e a visibilidade da imagem analisada e dos candidatos. As escolhas ficam sob **Mapa de fundo** e os switches sob **Resultado**, sem descrições repetidas. À direita há um único painel de altura completa e 340 px no desktop para **Informações** e **Assistente**. Trocar de aba altera somente o conteúdo: mapa, painel e controles mantêm a geometria. A conversa tem histórico rolável e campo fixo. Abrir/fechar o painel redimensiona o canvas, preservando centro e zoom. Abaixo de 900 px, o painel começa recolhido; quando aberto, ocupa a área principal em ambas as abas. **Resultados** permite reabri-lo quando fechado. A navegação e a criação continuam no cabeçalho de 48 px e sidebar compartilhados. Composição e evidências: [CONVERSA_E_NAVEGACAO_DO_MAPA.md](CONVERSA_E_NAVEGACAO_DO_MAPA.md).

## O que cada data significa

A legenda da classificação chama-se **Plantações de Café** e permanece no alto à esquerda com os hectares, independentemente da aba do painel. Configurações no alto à direita e zoom/enquadramento embaixo usam grupos verticais iguais. A nomenclatura da camada não altera o método ou a ausência de validação em campo, documentados em Sobre o resultado.

- **Imagem analisada:** a aquisição efetivamente informada/produzida pelo processamento. Aparece uma vez no cabeçalho, em formato numérico completo inclusive no celular. O rótulo acessível e o tooltip identificam a aquisição. Essa data identifica os resultados, não a imagem de fundo. Se não foi fornecida, a UI mostra **Sem data**.
- **Satélite MapTiler:** mosaico de fontes e datas diferentes. A UI não o apresenta como uma cena da data da análise. O [catálogo oficial](https://docs.maptiler.com/schema-raster/satellite/) descreve o conjunto `satellite-v2` como composição de imagens de satélite e aéreas.
- **Ruas:** cartografia para localização; não representa uma aquisição orbital.

Mudar o fundo não recalcula classificação, área, NDVI ou geometrias. A camada de análise e o fundo são estados separados. A imagem RGB efetivamente processada permanece visível por padrão; o usuário pode ocultá-la para inspecionar o fundo em mais detalhe.

## Fontes implementadas

| Opção | Endpoint | Comportamento |
|---|---|---|
| Satélite | MapTiler Tiles `satellite-v2`, JPG | Padrão; cores naturais, sem o filtro usado no antigo mapa base |
| Ruas | MapTiler Maps `streets-v4/256`, PNG | Tiles de 256 px, alinhados à grade Leaflet padrão |
| Sem fundo | Sem requisições de tiles | Conserva imagem, polígonos, escala e ferramentas |

URLs, descrições, provedor, natureza temporal e limites ficam em `components/map-sources.ts`; a apresentação está em `MapLayersPicker.tsx`. O Leaflet conserva posição/zoom ao trocar de fundo; somente a camada do provedor é substituída. A integração segue a [documentação Leaflet do MapTiler](https://docs.maptiler.com/leaflet/examples/how-to-use-leaflet/) e a [diferença entre grades de 256/512 px](https://docs.maptiler.com/guides/maps-apis/maps-platform/difference-between-256x256-512x512-and-hidpiretina-rasterized-tiles/).

Não foi incluído EOxCloudless: o serviço sugerido é um mosaico anual, não uma cena da aquisição. A [licença oficial das coleções 2018–2025](https://cloudless.eox.at/license-non-commercial) também restringe o uso não comercial. Isso não é uma boa dependência padrão para a evolução pretendida da plataforma. Nenhum dia, nuvem ou resolução local é inventado para preencher controles.

## Evolução para cenas por data

O tipo `SourceTime` distingue cartografia, mosaico e aquisição individual. Novas fontes temporais devem fornecer metadados reais antes de expor seletores. A implementação atual não oferece catálogo Sentinel por dia nem promete fazê-lo só por mudar a URL de um tile.

Quando existir um catálogo real, o adaptador deve trazer identificação da cena, aquisição, plataforma, produto/nível de processamento, cobertura geográfica, informação de nuvens disponível, licença e recurso de visualização. Essas informações não devem ser inferidas do nome comercial do fundo.

O fluxo simples deve continuar com uma seleção automática adequada ao local/período e mostrar a cena efetivamente escolhida. **Escolher outra imagem** pode revelar as datas disponíveis e filtros adicionais. Não exibir um calendário de dias sem cobertura; não substituir silenciosamente a data pedida. A cobertura de nuvens da cena inteira não deve ser apresentada como medida calculada sobre o talhão. Versões/produtos aparecem apenas quando são escolhas reais e pertinentes ao processamento. Mosaicos anuais devem mostrar período/ano, sem simular um instante de aquisição.

## Configuração e atribuição

`NEXT_PUBLIC_MAPTILER_KEY` é uma chave de uso no navegador, incorporada no build Next. Configure-a no ambiente web e restrinja suas origens no painel MapTiler, incluindo o domínio publicado e os endereços locais usados. Depois de mudar a chave, reinicie o dev server ou gere outro build; o worker Python não precisa dela. Não substituir `.env.local` existente.

Créditos MapTiler/OpenStreetMap e logo com link ficam visíveis, inclusive no celular, conforme a [atribuição oficial](https://docs.maptiler.com/guides/map-design/attribution/add-attribution/), que exige o logo para contas gratuitas. Não foi criado proxy nem alterado um plano do provedor. Os dois endpoints responderam HTTP 200 com a configuração local; isso não garante cotas ou acesso indefinidos. A disponibilidade depende da conta e do serviço.

As requisições dos tiles usam `strict-origin`: enviam a origem da aplicação, sem caminho da análise ou query. Erros do fundo não substituem a imagem processada nem removem os resultados. A contingência pode ser escolhida como **Sem fundo**.

## Verificação

Regressão em `tests/browser/platform.spec.ts`: dados reais previamente processados da cena pública, banco/Storage e sessões descartáveis, sem novos jobs Python nem chamadas Gemini. Confere respostas reais de tiles MapTiler, origem do Referer, alternância de fundos, ausência de mapa, camadas, abas por teclado, preservação da pergunta, foco e tamanhos móveis. Não intercepta requisições de tiles para desativar cache.

Na revisão vigente do shell, **2 testes de navegador passaram em 56,2 s**, com o fluxo live de processamento explicitamente desativado. A repetição somente da UI para corrigir a captura da thumbnail passou em **55,6 s**. Cobriram 1440, 768, 390 e 320 px, inclusive toque, movimento reduzido, data completa sem clipping e chat em pouca altura (390 × 500 px). Na última execução foram observadas **90 respostas de tiles, todas HTTP 200**, com Referer limitado a `http://localhost:3000/`, sem caminho/ID da análise. Satélite, Ruas e Sem fundo, abas por teclado, pergunta preservada, perfil e logout foram verificados. Alternar abas/recolher o painel mantém o canvas e o enquadramento; a sidebar animada conserva o centro geográfico. Nenhum job de processamento ou chamada Gemini foi iniciado; a cota global permaneceu em 10. Os fixtures foram removidos, preservando os dados já existentes no ambiente. Decisões e evidências: [SHELL_E_HIERARQUIA.md](SHELL_E_HIERARQUIA.md).

Build Next de produção e TypeScript passaram; 20 testes unitários web passaram, com integração SQL explicitamente ignorada por ausência de configuração de banco descartável. A revisão de navegador usou o dev server local que o usuário já mantinha aberto; não é evidência de deploy ou de execução pública. Não foi alterado o plano MapTiler, executada migração ou feito commit.

Capturas do aplicativo: [seletor](screenshots/desktop-layers.png), [informações](screenshots/desktop-information.png), [assistente](screenshots/desktop-chat-ready.png), [ruas](screenshots/desktop-streets.png), [informações no celular](screenshots/mobile-information.png). Isso não é validação de um futuro catálogo de aquisições Sentinel nem de cobertura temporal/qualidade de nuvens.
