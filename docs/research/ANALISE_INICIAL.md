# Diagnóstico inicial — 28/10/2026

## O que foi verificado no arquivo real

- Sentinel-2 L2A, Guaxupé/MG, 16/08/2025.
- TIFF de 4 bandas, 512 × 512 pixels, 10 m; EPSG:32723; metadados de escala `0.0001` e offset `-0.1` nas quatro bandas.
- 262.144 pixels válidos no recorte.
- Percentis da NDVI: mediana ~0,5587; p10 ~0,242; p90 ~0,8087.
- SCL alinhada com reamostragem **nearest**: 168.744 pixels da classe 4 (vegetação), 93.060 da classe 5 (não vegetado), 124 da classe 2 e 216 da classe 7.

## Resultado do primeiro experimento

Triagem de vegetação com NDVI ≥ 0,60, GNDVI ≥ 0,25, EVI2 ≥ 0,25, SCL=4, filtragem morfológica e área mínima de 0,5 ha.

- 64 polígonos candidatos;
- aproximadamente 1.160,055 hectares marcados;
- maior polígono: aproximadamente 782,82 ha.

**Segunda imagem efetivamente obtida e processada:** `S2A_T23KLS_20250721T131759_L2A`, 21/07/2025, baixa cobertura de nuvens no tile de origem (0,003012%). Mantidas as quatro bandas, a escala/offset e os mesmos limites geográficos. O algoritmo gerou 29 polígonos e aproximadamente **1.523,272 ha** de vegetação candidata, contra 1.160,055 ha no dia 16/08/2025. A NDVI mediana mudou de 0,6916 para 0,5587. A variação expressiva ressalta a inadequação de estimar cafezais por um único corte espectral, e não comprova mudança de uso do solo.

**Problema encontrado:** o maior polígono cobre uma vasta região de vegetação escura e contínua, visualmente compatível com mata. É um **provável falso positivo**, ilustrando por que a seleção espectral não basta para afirmar que uma região cultiva café. Não podemos usar os 1.160 ha como estimativa real da área cafeeira.

Este achado não é uma validação independente nem uma prova de que uma área específica não contém café. O próximo experimento deve comparar as geometrias com mapas temáticos e imagens de outra data.

## Como vamos melhorar

1. Buscar referência independente (e.g., MapBiomas, classe café) para restringir/avaliar candidatos, sem tratar o mapa externo como verdade de campo.
2. Explorar diferença temporal e segmentação por talhões para evitar polígonos gigantes que unem floresta e cultivos.
3. Só depois escolher limiares finais; registrar o erro concreto e suas correções.

## Fontes primárias

- Embrapa: https://www.embrapa.br/en/busca-de-publicacoes/-/publicacao/1178755/dense-time-series-of-harmonized-landsat-sentinel-2-and-ensemble-machine-learning-to-map-coffee-production-stages
- Embrapa: https://apct.sede.embrapa.br/pab/pt_BR/article/view/26560
- Copernicus: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html
- MapBiomas (dados abertos e instruções de download): https://brasil.mapbiomas.org/downloads/
