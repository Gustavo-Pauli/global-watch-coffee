# Global Watch | Nota de pesquisa
**Mapeamento exploratório de cafezais · Guaxupé/MG · 28/10/2026**  
**Versão oficial de entrega: PDF A4 em duas páginas.**

## 01 — Escopo e dados disponíveis

**Pergunta:** como delimitar **polígonos candidatos a cafezais existentes** em imagens multiespectrais, sem confundir detecção com aptidão agrícola ou confirmação em campo? O processamento usa os pixels do GeoTIFF enviado; não consulta resultados pré-computados.

| Entrada | Especificação |
|---|---|
| Kit original | Sentinel-2 L2A de 16/08/2025, Guaxupé/MG, 512 × 512 pixels, 10 m, EPSG:32723 |
| Dados | B02, B03, B04, B08; máscara SCL a 20 m |
| Datas extras processadas | 21/07/2025 e 25/10/2025, com IDs e URLs STAC documentados |

## 02 — Fluxo executado em Python

**GeoTIFF + SCL → reflectância, índices e texturas → Random Forest multiclasse e coerência espacial → polígonos e hectares.**

A reflectância é obtida por `DN × 0,0001 − 0,1` segundo o kit, uma única vez; NoData é excluído pelas máscaras GDAL. A máscara SCL é reamostrada por vizinho mais próximo para excluir nuvens e sombras. São calculados NDVI, GNDVI, EVI2 e texturas locais. Na inferência, há coerência 3 × 3, região mínima de 0,2 ha, GeoJSON em WGS84 (EPSG:4326) e cálculo geodésico da área.

O treinamento utiliza **supervisão fraca** do MapBiomas Coleção 11/2025 (classe 46 = café). A revisão introduziu as classes café, floresta, pastagem, mosaico e outros; rótulos com erosão de uma célula no mapa original de aproximadamente 30 m e apenas um ponto amostrado por célula; julho, agosto e outubro. Avaliação por blocos espaciais e leave-one-date-out.

## 03 — Alternativas e decisão técnica

| Abordagem | Status | Justificativa |
|---|---|---|
| Índices + limiares | Testada | Baixo custo, mas confunde vegetação densa com café. Não adotada como classificador final. |
| Random Forest multiclasse | **Implementada** | Compatível com quatro bandas, execução em CPU, resultados auditáveis e reproduzíveis. |
| Prithvi-EO-2.0 / Clay | **Pesquisadas, não testadas** | Adaptar entradas, classificar especificamente café e validar exige dados e tempo; ganho não demonstrado no prazo. |

O Prithvi-EO-2.0 usa originalmente seis bandas HLS, diferentes das quatro fornecidas pelo kit. O Clay permite obter representações de dados Sentinel-2. Bandas red-edge/SWIR são possibilidades futuras, **não testadas nesta entrega**. Fontes: [NASA/IBM Prithvi](https://github.com/NASA-IMPACT/Prithvi-EO-2.0) e [Clay](https://clay-foundation.github.io/model/).

## 04 — Fundamentação: três fontes primárias

1. **Parreiras et al. (2025).** *Dense Time Series of Harmonized Landsat Sentinel-2 and Ensemble Machine Learning to Map Coffee Production Stages.* Remote Sensing 17(18):3168. Séries temporais e RF/XGBoost. https://doi.org/10.3390/rs17183168
2. **Alves, Volpato & Campos (2021).** *Mapeamento automatizado de áreas de café em Minas Gerais.* Embrapa Café. Sentinel-2 e abordagem orientada a objetos. https://www.infoteca.cnptia.embrapa.br/infoteca/handle/doc/1134278
3. **Schneider, Alves & Ferreira (2025).** *Coffee crop detection and mapping using Sentinel-2 data and spatial coherence.* TAAE 9(3). Coerência espacial na classificação. https://doi.org/10.31422/taae.v9i3.64

**Dados auxiliares:** [Copernicus Sentinel-2 L2A/SCL](https://sentiwiki.copernicus.eu/web/s2-products) e [MapBiomas Brasil Coleção 11/2025, 30 m](https://brasil.mapbiomas.org/). MapBiomas **não é verdade de campo**.

## 05 — Resultados obtidos, com referência MapBiomas

Áreas de **candidatos** e sobreposições temáticas aproximadas com o mapa anual, expressas em hectares. **Não são acurácia real nem áreas de café confirmadas.**

| Cena | Classificador | Candidatos | Sobrep. café | Sobrep. floresta |
|---|---|---:|---:|---:|
| Agosto 2025 | RF anterior | 96,02 ha | 29,07 ha | 7,07 ha |
| Agosto 2025 | RF revisado, corte 0,50 | 22,66 ha | 12,14 ha | 1,03 ha |
| Outubro 2025 | RF anterior | 83,27 ha | 6,30 ha | 66,45 ha |
| Outubro 2025 | RF revisado, corte 0,50 | 10,96 ha | 7,94 ha | 0,00 ha |

A revisão reduziu a sobreposição com floresta em outubro (66,45 → 0,00 ha), **mas também reduziu a cobertura de café rotulado em agosto** (29,07 → 12,14 ha). Não há evidência de superioridade geral.

## 06 — Validação e erros efetivamente encontrados

- **Validação espacial:** F1 ≈ 0,355 para o RF revisado em blocos espaciais, contra rótulos indiretos. **Teste temporal leave-one-date-out:** F1 ≈ 0,391 segurando outubro. Os protocolos são distintos e F1 entre modelos antigos e novos não é diretamente comparável.
- **Erro de classificação:** RF binário treinado em julho/agosto confundiu floresta com café em outubro. A revisão adotou negativos difíceis, rótulos menos ruidosos e treino multidata. Sem ablação completa, não se pode atribuir o ganho a um fator.
- **Erro de código:** o operador `Affine @ tuple` causava falhas de overlay na versão instalada; foi substituído por `Affine * tuple` e coberto por testes de regressão.

**Ressalva:** outubro influenciou a seleção da abordagem e entrou no treinamento final. **Não é teste final independente/intocado**.

## 07 — Limitações que afetam a interpretação

- **Rótulos:** MapBiomas tem resolução aproximada de 30 m. Reamostrar para 10 m não aumenta sua precisão. Falta validação de campo e teste em outra região.
- **Generalização:** apenas bandas do visível e NIR; sazonalidade, manejo, poda, sombra, nuvens e pixels mistos podem confundir cafezais com outras culturas e florestas.
- **Saída:** scores de RF não são probabilidades calibradas, e limiares de score e área de 0,2 ha podem omitir talhões. Polígonos são **candidatos para revisão**, nunca comprovação da espécie.

## 08 — Reprodutibilidade, licenças e IA

**Resultados por upload:** `candidatos.geojson` (EPSG:4326 e hectares por polígono), `imagem_classificada.png`, `imagem_mapa.png`, `classificacao.tif`, `resultado.json`. Hectares resultam da vetorização raster e cálculo geodésico.

**Proveniência:** IDs e URLs STAC em `sample/`, `additional/`, `unseen/` e `reference/`. Crédito: “Contains modified Copernicus Sentinel data (2025)”. A página oficial de [Cobertura 30 m — Coleção 11](https://brasil.mapbiomas.org/iniciativas-e-produtos/cobertura-e-uso-da-terra/cobertura-30m/cobertura/) declara os dados sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), conferida em 29/10/2026. Manter atribuição, link da licença e indicação do recorte/reamostragem. Bibliotecas Python abertas registradas nos requisitos. Esta revisão foi incorporada ao Markdown, ao PDF de duas páginas e ao [registro de proveniência](../delivery/PESQUISA_PROVENIENCIA.md).

**IA:** ChatGPT/GPT-6 e Deep Research apoiaram pesquisa, código e documentação. Não substituíram processamento de pixels nem geraram rótulos ou hectares. O chat generativo depende de chave no servidor; sem ela, a aplicação informa a contingência determinística.
