# Experimento de classificação com referência externa — 28/10/2026

## Mudança de método

O primeiro filtro, baseado só em índices espectrais e máscara SCL, confundiu vastas regiões de mata com cafezais. Para testar uma alternativa mais específica, utilizamos **supervisão fraca**: os rótulos públicos do MapBiomas Brasil (Coleção 11, ano 2025, classe 46 para café), mais duas imagens Sentinel-2 com 4 bandas, índices NDVI/GNDVI/EVI2 e texturas locais calculadas em Python.

Foi treinado um Random Forest de 100 árvores e 12 características espectrais/espaciais. A verificação separou espacialmente os dados em blocos de 640 × 640 m, mantendo pixels vizinhos e suas duas datas no mesmo lado da divisão. A referência original é de 30 m e foi alinhada à grade Sentinel-2 de 10 m por vizinho mais próximo (não criou detalhes novos no rótulo).

**Atenção:** este modelo aprende um mapa publicado, não amostras verificadas em campo. O valor F1=0,4236 em regiões separadas é **concordância com os rótulos MapBiomas**, e **não é acurácia real de detectar café**. O modelo pode generalizar mal para outras cidades/datas.

## Comparação quantitativa na mesma imagem — 16/08/2025

| Medida | Triagem só espectral | Random Forest supervisionado pelo MapBiomas |
|---|---:|---:|
| Área candidata | 1.160,0 ha | 96,02 ha |
| Sobreposição com café MapBiomas | 24,46 ha | 29,07 ha |
| Sobreposição com floresta MapBiomas | **881,42 ha** | **7,07 ha** |
| Sobreposição com outras classes MapBiomas | 254,11 ha | 59,88 ha |
| Parcela dos 43 ha de café da referência localizada | 56,9% | 67,6% |

Esses números foram medidos com máscaras rasterizadas sobre uma mesma grade, não comparando apenas a soma de áreas de geometrias em sistemas diferentes.

## Erro identificado e não resolvido por completo

O filtro inicial chamava de *candidato* quase toda a grande mancha florestal visível no centro/leste da imagem. Isso gerou 881 ha de sobreposição com a classe floresta de uma referência temática independente. O Random Forest reduziu muito essa sobreposição, mas **ainda marcou 60 ha atribuídos a outras classes** pelo mesmo mapa. Portanto não está pronto para afirmações sobre cafezais reais.

## Limitações honestas

- O próprio MapBiomas pode ter erro; não o tratamos como verdade de campo.
- Uma cena de 512×512 pixels e duas datas não oferecem diversidade suficiente para generalizar a todo o Brasil.
- MapBiomas 30m cria rótulos imprecisos na borda de talhões pequenos; a reamostragem para 10m não aumenta essa precisão.
- A divisão espacial reduz vazamento entre treino e teste, mas ambos continuam na mesma região.
- O classificador produz **áreas candidatas** e não uma probabilidade de ocorrência de café cientificamente calibrada.
- Comparação de duas datas do mesmo ano é útil, mas trabalhos da Embrapa mostram vantagem de séries temporais bem mais densas.

## Fontes e condições

1. MapBiomas Brasil: Coleção 11, Cobertura 30m, classe 46 (café); uso aberto CC BY 4.0 com atribuição. https://brasil.mapbiomas.org/iniciativas-e-produtos/cobertura-e-uso-da-terra/cobertura-30m/cobertura/
2. Embrapa: *Dense time series of harmonized Landsat Sentinel-2 and ensemble machine learning to map coffee production stages*. https://www.embrapa.br/en/busca-de-publicacoes/-/publicacao/1178755/dense-time-series-of-harmonized-landsat-sentinel-2-and-ensemble-machine-learning-to-map-coffee-production-stages
3. Embrapa: *Variáveis multitemporais para o mapeamento de áreas de cultivo de café*. https://apct.sede.embrapa.br/pab/pt_BR/article/view/26560
4. Sentinel-2 L2A: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html

Este documento é a auditoria de um experimento inicial, **não é ainda a nota de pesquisa final de até duas páginas** exigida pela empresa.
