**VERSÃO HISTÓRICA - substituída por NOTA_PESQUISA_FINAL.md / PDF, com resultados do modelo v2.**

# Nota de pesquisa — identificação exploratória de cafezais

**Desafio Global Watch · 28/10/2026 · Versão para revisão antes da entrega**

## Problema e três fontes primárias

O objetivo é identificar **áreas que já podem conter cultivo de café** em imagens de satélite, não avaliar aptidão agrícola para cultivo futuro. A imagem fornecida corresponde a um recorte Sentinel-2 L2A de Guaxupé/MG, 16/08/2025, em quatro bandas de 10 m (B02/B03/B04/B08), sem rótulos de café. Uma segunda cena original da mesma região, de 21/07/2025 (`S2A_T23KLS_20250721T131759_L2A`), foi obtida via catálogo Earth Search/Element 84 e recortada/alinhada à grade fornecida. Os dados brutos e a proveniência acompanham o projeto.

1. **Embrapa, *Dense Time Series of Harmonized Landsat Sentinel-2 and Ensemble Machine Learning to Map Coffee Production Stages* (2025)** — referência metodológica específica sobre o uso de séries temporais densas, índices, texturas e algoritmos de árvores para mapear cafezais e fases produtivas. Inspirou a seleção de variáveis e explicitou a limitação de usar somente duas datas. [Publicação original](https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1178755/1/AP-Dense-Time-Series-2025.pdf).
2. **Projeto MapBiomas Brasil, Coleção 11, mapa anual de cobertura e uso 2025** — referência temática externa de 30 m com código **46 = café**. Forneceu rótulos *fracos* de treinamento e uma comparação de coerência espacial. Não é inventário de campo nem prova definitiva de café. [Produto e códigos oficiais](https://brasil.mapbiomas.org/iniciativas-e-produtos/cobertura-e-uso-da-terra/cobertura-30m/cobertura/).
3. **Copernicus Data Space, documentação Sentinel-2 L2A** — descreve bandas, reflectância e a *Scene Classification Layer* (SCL), usada para filtrar qualidade de observação/nuvens, e não para distinguir espécies vegetais. [Documentação oficial](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html).

## Alternativas consideradas e método selecionado

- **Alternativa 1 — índices NDVI/GNDVI/EVI2 com limiares:** simples, sem treinamento e interpretável, porém confunde severamente café, mata e outras culturas. Foi implementada como referência de erro e descartada como método principal.
- **Alternativa 2 — modelo especializado com série temporal densa ou rótulos de campo:** seria metodologicamente superior para generalizar a outras safras e áreas, mas exigiria muitos mosaicos e amostras verificadas fora do prazo. O estudo da Embrapa orientou essa avaliação.
- **Método escolhido — Random Forest com supervisão fraca do MapBiomas:** transforma as quatro bandas de cada data em reflectância respeitando os fatores armazenados (`DN × escala + offset`), calcula NDVI/GNDVI/EVI2, médias e variações locais de textura (12 atributos), alinha a SCL de 20 m por vizinho mais próximo e aprende a separar a classe 46 dos demais rótulos anuais. Um teste de concordância usa grupos espaciais separados de ~640 m para reduzir vazamento por vizinhança. As previsões reais da imagem fornecida passam por limpeza morfológica, vetorização raster→GeoJSON, reprojeção para WGS84 e cálculo geodésico de hectares. O escore de corte 0,60 **não é probabilidade calibrada de haver café**.

## Verificação reproduzível, erro e limitações

`audit_scene.py` confirmou que as duas imagens estão na **mesma grade EPSG:32723**, 512 × 512 pixels, 10 m por pixel e com escala 0,0001 e offset −0,1 em todas as bandas. `test_processing.py` e `test_coffee_model.py` verificam o processamento; uma alteração programática nas bandas do upload altera as previsões, evitando respostas pré-computadas. `evaluate_reference.py` mede as interseções espaciais na grade comum.

**Erro detectado:** na cena de 16/08, a primeira triagem produziu cerca de 1.160 ha candidatos, dos quais **881,42 ha coincidiam com floresta** no MapBiomas e apenas **24,46 ha** com café. A classificação Random Forest reduziu o total para ~96,02 ha, dos quais **29,07 ha** coincidem com café, **7,07 ha** com floresta e **59,88 ha** com outras classes. Ela recuperou ~67,6% da área rotulada como café, mas a maior parte das áreas candidatas permanece fora da classe café do mapa. O modelo alcançou F1 ~0,4236 **em concordância com MapBiomas em blocos espaciais reservados**, sem validação de campo.

**Limitações:** duas datas e uma única região; referência temática de 30 m reamostrada para 10 m, com incerteza nos limites dos talhões; rótulos MapBiomas podem errar; comparação com MapBiomas **não é validação independente**, pois ele também treinou o modelo. Sem amostras de campo, nenhuma saída deve ser chamada de café confirmado, exatidão de detecção ou percentual de confiança. Melhorias futuras: amostras independentes de café e não café, mais meses/safras, bandas red-edge/SWIR e validação em outras regiões.

**Teste adicional (fora do treino):** ao aplicar o mesmo modelo à terceira cena real de 25/10/2025 (sem retreinamento), surgiram 109 polígonos/83,27 ha, com apenas 6,30 ha coincidindo com café e 66,45 ha com floresta no MapBiomas. O erro demonstra forte limitação temporal, mesmo dentro da área conhecida. A comparação é temática, não uma medição independente de acurácia. Ver `RELATORIO_INSPECAO.md`.

## Origem, direitos e uso de IA

- **Sentinel-2 / Copernicus:** recorte original do desafio + cena adicional do catálogo Earth Search, com IDs, metadados e URLs em `sample/` e `additional/`. Dados Sentinel abertos, com atribuição “Contains modified Copernicus Sentinel data (2025)”; [termos oficiais](https://dataspace.copernicus.eu/terms-and-conditions).
- **MapBiomas Brasil:** recorte do GeoTIFF de cobertura 2025, Coleção 11, baixado da fonte pública e sem alterações na classificação original; licença a confirmar nos termos específicos do produto Coleção 11 (materiais oficiais citam CC BY e CC BY-SA), com crédito ao MapBiomas e referência ao produto oficial. URLs e dados de recorte em `reference/proveniencia_mapbiomas.json`.
- **Ferramentas de IA:** ChatGPT auxiliou na pesquisa de alternativas, estruturação do código e documentação. Nenhuma resposta da IA foi usada como rótulo de café ou como geometria: a classificação e as métricas são produzidas pelos scripts Python executáveis. Antes de entregar, revisar manualmente as análises visuais, as fontes, os testes e esta declaração para refletir o trabalho efetivamente realizado.
