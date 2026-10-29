# Dados para reprodução

- `sample/`: cena original de agosto + máscara SCL, área e atribuição do desafio.
- `additional/`: cena adicional de julho e proveniência.
- `unseen/`: cena de outubro, utilizada no estudo temporal e posteriormente no treino v2.
- `reference/`: recorte da classe de uso do solo MapBiomas para supervisão fraca.

Os GeoTIFFs são dados reais. MapBiomas **não é ground truth independente** quando é usado como fonte de rótulos. Todos os metadados e declarações de proveniência existentes foram preservados.

Crédito: Contains modified Copernicus Sentinel data (2025). Consulte as informações originais em `sample/ATRIBUICAO.txt` e os arquivos `proveniencia*.json`.
