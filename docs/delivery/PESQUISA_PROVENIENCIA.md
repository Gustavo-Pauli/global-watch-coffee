# Pesquisa, proveniência e atribuição

Conferência em **29/10/2026**, com registros primários, código e metadados locais. Nenhum modelo foi treinado, raster alterado ou arquivo de referência visual externo adicionado nesta verificação. Não houve publicação do repositório.

## Fontes de pesquisa verificadas

As três referências da nota correspondem a publicações reais; título, autoria abreviada e ano estão corretos. Suas metodologias apoiam escolhas gerais, sem validar os hectares, polígonos ou scores deste protótipo.

| Referência da nota | Registro primário conferido | O que sustenta e o que não transfere ao protótipo |
|---|---|---|
| Parreiras et al. (2025), *Dense Time Series of Harmonized Landsat Sentinel-2 and Ensemble Machine Learning to Map Coffee Production Stages*, Remote Sensing 17(18), 3168, DOI 10.3390/rs17183168 | [Embrapa Alice: registro do artigo](https://www.alice.cnptia.embrapa.br/alice/handle/doc/1178755) e [página da editora](https://www.mdpi.com/2072-4292/17/18/3168) | Séries HLS e combinação RF/XGBoost para café/estágios. O trabalho utiliza observações de campo e contexto multitemporal próprio; suas métricas não são precisão deste modelo regional de quatro bandas. A página direta da editora retornou 429 em uma tentativa; o registro institucional confirmou a referência. |
| Alves, Volpato & Campos (2021), *Mapeamento automatizado de áreas de café em Minas Gerais*, Embrapa Café, Documentos 13, 26 p. | [Embrapa Infoteca](https://www.infoteca.cnptia.embrapa.br/infoteca/handle/doc/1134278) | Uso de Sentinel-2A associado a GEOBIA. O protótipo não implementa a mesma segmentação orientada a objetos; citar a alternativa não equivale a reproduzir seus resultados. A página identifica acesso aberto e licença do repositório CC BY-NC-ND 4.0; isso não autoriza copiar/adaptar figuras ou o texto integral para o produto. |
| Schneider, Alves & Ferreira (2025), *Coffee crop detection and mapping using Sentinel-2 data and spatial coherence*, Theoretical and Applied Engineering 9(3), DOI 10.31422/taae.v9i3.64 | [Registro oficial TAAE/UFLA](https://www.taaeufla.eeng.ufla.br/index.php/TAAE/article/view/64), publicado em 27/05/2025 | RF e coerência espacial para reduzir erros isolados; autores Bruno de Oliveira Schneider, Marcelo de Carvalho Alves e Vítor Augusto Ferreira. O trabalho usa R, cena de junho/2022 e avaliação espacial própria; o filtro do protótipo é uma adaptação, sem equivalência de desempenho demonstrada. |

## Sentinel-2: origem e atribuição

O [aviso oficial Copernicus Sentinel](https://cds.climate.copernicus.eu/licences/ec-sentinel) permite reprodução, distribuição e adaptação dos dados nas condições indicadas e exige crédito de origem, com indicação de modificação. O crédito existente `Contains modified Copernicus Sentinel data (2025)` é compatível com recorte/empilhamento. Isso se refere aos dados Sentinel, não a marcas, screenshots ou outros conteúdos de portais. O [catálogo AWS mantido pela Element 84](https://registry.opendata.aws/sentinel-2-l2a-cogs/) identifica a fonte COG/Earth Search e remete aos termos Sentinel.

Os três endpoints STAC responderam HTTP 200 nesta conferência. IDs e datas coincidem com os registros locais; os assets blue/green/red/nir/scl estão disponíveis nos metadados:

| Pasta | Item | Aquisição UTC confirmada |
|---|---|---|
| `data/sample` | [S2B_T23KLS_20250816T132502_L2A](https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a/items/S2B_T23KLS_20250816T132502_L2A) | 2025-08-16T13:28:10.823000Z |
| `data/additional` | [S2A_T23KLS_20250721T131759_L2A](https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a/items/S2A_T23KLS_20250721T131759_L2A) | 2025-07-21T13:18:32.386000Z |
| `data/unseen` | [S2B_T23KLS_20251025T132232_L2A](https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a/items/S2B_T23KLS_20251025T132232_L2A) | 2025-10-25T13:28:08.082000Z |

Os **oito arquivos** listados em `data/sample/SHA256SUMS.txt` coincidem byte a byte com os hashes declarados, incluindo os TIFFs. Não houve novo download/comparação pixel a pixel dos COGs remotos: STAC e checksum local comprovam identificação e integridade local, não autenticidade independente de cada pixel.

## MapBiomas: licença identificada

A página oficial de [Cobertura 30 m — Coleção 11](https://brasil.mapbiomas.org/iniciativas-e-produtos/cobertura-e-uso-da-terra/cobertura-30m/cobertura/) confirma a série 1985–2025, a classe **46 = Café**, o endpoint TIFF de 2025 usado pelo script e **CC BY 4.0** no rodapé. A [FAQ oficial](https://brasil.mapbiomas.org/faq/) fornece o formato de citação. A licença requer crédito, link e indicação das alterações; consulte o [texto CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

`data/reference/proveniencia_mapbiomas.json` agora registra licença, evidência e data de conferência, preservando a citação/data de acesso original de 28/10/2026. As modificações são recorte espacial na resolução nativa e uso de vizinho mais próximo para alinhamento no processamento. O TIFF não é verdade de campo nem confirmação de café.

Citação operacional sugerida: **Projeto MapBiomas — Coleção 11 da Série Anual de Mapas de Cobertura e Uso da Terra do Brasil, mapa 2025, acessado em 28/10/2026; recorte de Guaxupé/MG; CC BY 4.0.** Acompanhar com o link do produto e da licença. Não reutilizar marcas/gráficos do portal sob a suposição de que a licença dos dados os abrange. O repositório de dados Dataverse retornou 503 nesta consulta; não foi atribuído um DOI de dataset que não pôde ser conferido.

## Modelo e reprodutibilidade

`coffee_v2.py` contém o treinamento próprio de Random Forest e serialização; `models/v2/treinamento_v2.json` registra doze atributos, supervisão fraca, amostragem/erosão, avaliações espacial/temporal e as três cenas de treinamento. Outubro entrou no treinamento final: a pasta `unseen` conserva um nome histórico, não representa um teste final independente. A auditoria não reconstruiu o treinamento nem confirmou autoria por uma fonte externa.

Hashes SHA-256 registrados nesta data:

```text
f39a9a35afe75483fc091634222f21d8332f062cd4d0f0ace3ed7675f981b4bf  apps/geo-worker/models/v2/coffee_rf.joblib
70f589f82ab3aab2fde7784400718e47e9b301a8f6e6fce7847ce5971391459c  data/reference/mapbiomas_2025_recorte_30m.tif
```

Não há arquivo LICENSE/COPYING próprio no checkout inspecionado. Isso não altera as licenças dos dados/bibliotecas nem concede automaticamente permissão de reutilização do código/pesos a terceiros; a escolha de licença para material próprio continua sendo do titular. Nenhuma licença de código foi inventada nesta tarefa.

## Mudanças e pendências concretas

- Referências bibliográficas mantidas: não foi encontrada inexatidão nos três registros citados.
- Registro MapBiomas e parágrafo de proveniência da nota Markdown atualizados com CC BY 4.0 e evidência primária. O PDF de duas páginas **não foi regenerado** e ainda contém a ressalva de licença anterior; esta conferência acompanha a entrega até revisão conjunta do PDF.
- `scripts/fetch_reference.py` foi alinhado com CC BY 4.0 e a mesma evidência. A data histórica da conferência manual da licença permanece 29/10/2026; a data de um novo download/citação é gerada dinamicamente em UTC, sem fingir uma nova verificação da licença. A sintaxe foi conferida sem executar extração/rede; nenhum raster foi baixado novamente.
- Antes de eventual publicação autorizada, manter atribuições junto aos dados e resultados, revisar a licença pretendida para código/pesos próprios e garantir que referências visuais externas não entrem no commit. Nenhuma conclusão de desempenho agronômico ou permissão sobre marcas decorre desta verificação.
