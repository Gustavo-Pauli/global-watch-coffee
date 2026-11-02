# Dados de exemplo e reprodução

- `sample/`: cena Sentinel-2 de agosto de 2025, máscara SCL, área de estudo e metadados.
- `additional/`: cena de julho de 2025 e proveniência.
- `unseen/`: cena de outubro de 2025. O nome é histórico: ela participou do treinamento v2 e não é teste independente desse modelo.
- `reference/`: recorte MapBiomas utilizado como supervisão fraca.

Os GeoTIFFs e metadados são entradas do processamento e dos testes. MapBiomas não equivale a verdade de campo e não comprova a presença de café.

## Atribuições

Contains modified Copernicus Sentinel data (2025). As modificações incluem recorte espacial e empilhamento de bandas. Origem e termos em `sample/ATRIBUICAO.txt`, `sample/fonte_stac.json` e nos arquivos `proveniencia*.json` de cada pasta.

Projeto MapBiomas — Coleção 11 da Série Anual de Mapas de Cobertura e Uso da Terra do Brasil, mapa 2025, acessado em 28/10/2026; recorte de Guaxupé/MG. A referência local registra CC BY 4.0 e a origem em `reference/proveniencia_mapbiomas.json`. O processamento alinha os rótulos por vizinho mais próximo.

Os termos dos dados são independentes da licença MIT do código. Mantenha atribuições e proveniência ao redistribuí-los.
