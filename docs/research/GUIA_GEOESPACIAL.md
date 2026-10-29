> Documento histórico da abordagem v1. Não usar os comandos, limiares, versões ou resultados abaixo como configuração de produção. O worker atual usa RF v2 com três datas no treino, score 0,50, mínimo 0,2 ha e scikit-learn 1.8.0. Consulte AUDITORIA_GEO.md e a nota final para o método efetivo.

# Como funciona a parte geoespacial — guia para explicar na avaliação

Este guia acompanha o código real do projeto. O objetivo é **localizar áreas com aparência de cafezal existente**, não avaliar se seria possível plantar café naquele solo.

## 1. O que temos na imagem?

Um GeoTIFF é uma matriz de pixels com localização geográfica. A cena do desafio contém 512 × 512 pixels de **10 metros** cada, em `EPSG:32723` (UTM). Cada pixel cobre **100 m² = 0,01 ha**. São quatro camadas, na ordem:

| Banda | O que mede | Por que importa |
| --- | --- | --- |
| B02 (azul) | Reflexão no azul | Compor a imagem e ajudar na classificação. |
| B03 (verde) | Reflexão no verde | Vegetação e índice GNDVI. |
| B04 (vermelho) | Reflexão no vermelho | Clorofila absorve fortemente essa faixa. |
| B08 (infravermelho próximo/NIR) | Reflexão no infravermelho próximo | Vegetação saudável tende a refletir muito NIR. |

Os números armazenados **não são a reflectância diretamente**. No kit, a fórmula correta para **cada banda** é `reflectância = pixel * 0,0001 - 0,1`. Aplicar o offset duas vezes distorce os índices. É possível conferir o fator em `evaluation/auditoria_cenas.json`.

## 2. Como o Python interpreta a vegetação?

`processing.py` e `coffee_model.py` abrem as bandas com `rasterio` e as transformam em `numpy.ndarray`.

- **NDVI = (NIR − vermelho) / (NIR + vermelho)**: indicador geral de vigor/cobertura vegetal.
- **GNDVI = (NIR − verde) / (NIR + verde)**: outra forma de observar vegetação, sensível à resposta no verde.
- **EVI2**: índice que combina NIR e vermelho, com ajuste para moderar saturação do NDVI em vegetação densa.
- **Textura local**: média e desvio-padrão em janelas de 5 × 5 pixels. A organização espacial de linhas de uma plantação pode ter textura diferente de mata; não é uma distinção garantida.

**Índice alto não significa café.** Café, floresta e outras culturas podem ter resposta parecida. O primeiro protótipo filtrava pixels com índices altos e produziu muitos falsos candidatos, inclusive mata.

## 3. Por que há um segundo TIFF chamado SCL?

SCL é a camada de **qualidade da observação** do Sentinel-2. Ajuda a ignorar nuvens e sombras, e não a descobrir o tipo de plantação. O TIFF SCL tem resolução de **20 m**, por isso o Python alinha-o aos pixels de 10 m usando `Resampling.nearest` (classes não podem ser interpoladas como se fossem cores).

Na rotina do Random Forest, usamos os códigos SCL 4 (vegetação) e 5 (não vegetado) como observações claras. Isso evita descartar bordas de talhões rotuladas de maneira inconsistente na SCL; a classificação propriamente dita é feita pelas bandas e pelo modelo.

## 4. Como o modelo decide quais pixels podem ser café?

O primeiro algoritmo (só limiares de NDVI/GNDVI/EVI2) mostrou-se insuficiente. A segunda abordagem é um **Random Forest** — conjunto de árvores de decisão — treinado com 12 características espectrais e de textura. Os rótulos de treino vêm do mapa publicado **MapBiomas 2025, classe 46 = café**. O mapa de referência é de 30 m, alinhado por vizinho mais próximo a 10 m; isso **não faz o rótulo ficar mais preciso**.

O modelo foi treinado com cenas de **21/07/2025** e **16/08/2025** para a mesma área de Guaxupé/MG. O teste separa **blocos espaciais de cerca de 640 m**, não pixels aleatórios misturados. O F1 computado mede apenas **concordância com os rótulos MapBiomas não utilizados no treino**; não há medições de campo para alegar acurácia de detecção de café.

Para classificar outro upload, a aplicação extrai características dos **pixels recebidos** e usa o modelo treinado. A latitude/longitude não é usada como consulta à resposta pronta do MapBiomas. Uma segunda cena alinhada é opcional e permite combinar pontuações de duas datas para reduzir dependência de uma observação.

## 5. Como pixels se transformam em polígonos e hectares?

1. O modelo calcula um escore para cada pixel; esta versão seleciona pixels com escore ≥ 0,60, sem interpretar 0,60 como 60% de certeza de haver café.
2. Operações morfológicas (`scipy.ndimage`) retiram ruídos muito pequenos e conectam pequenos buracos.
3. `rasterio.features.shapes` transforma regiões contíguas em geometrias vetoriais.
4. Cada polígono é convertido da projeção UTM para **WGS84/EPSG:4326**, formato esperado pelo GeoJSON e pelo mapa web.
5. `pyproj.Geod` calcula a área geodésica de cada geometria, depois divide por 10.000 para apresentar hectares. Polígonos menores do que a área mínima são descartados.
6. A imagem RGB original e os contornos são exportados; a cópia destinada ao mapa é reprojetada para coordenadas geográficas.

O arquivo `candidatos.geojson` contém os polígonos; `resultado.json` contém a soma das áreas, quantidade de polígonos e limites do raster para sobreposição no Leaflet.

## 6. O que deu errado e como verificamos?

Na primeira abordagem, mais de **881 ha** de candidatos coincidiram com **floresta** na referência MapBiomas, enquanto só ~24,46 ha coincidiam com a classe café. Após o Random Forest e os filtros espaciais, a área candidata total caiu para **~96,02 ha**, com ~29,07 ha em café e ~7,07 ha em floresta **segundo o mesmo mapa**. A concordância melhorou, mas permanecem ~59,88 ha em outras classes e regiões de café não identificadas.

Essas comparações e o erro foram calculados por `evaluate_reference.py`, e os insumos/índices são auditados por `audit_scene.py`. **Não podemos chamar isso de validação independente do modelo**, porque o MapBiomas forneceu os rótulos de treino. Para validar presença real de café, seria preciso usar pontos de campo, perímetros confiáveis de lavouras ou outra referência externa independente.

Para entender **onde** o classificador discorda do mapa e o efeito de usar **uma ou duas datas**, veja [ANALISE_ERROS.md](ANALISE_ERROS.md). O arquivo mostra também por que mudar somente o limiar de escore não resolve a identificação real do cultivo.

## Executar e inspecionar

Na pasta do projeto, com `pip install -r requirements.txt`:

```bash
python audit_scene.py
python coffee_model.py classify sample/imagem_multiespectral.tif --scl sample/qualidade_scl.tif --secondary additional/imagem_adicional_multiespectral.tif --secondary-scl additional/qualidade_adicional_scl.tif --date 2025-08-16 --output outputs_model
python evaluate_reference.py
python -m unittest -v
```

**Frase segura para apresentar:** “Nosso modelo aponta regiões candidatas a cafezal usando imagens multiespectrais e rótulos de referência de 30 metros. Os polígonos e áreas são calculados de verdade. Como não temos validação de campo, o resultado é exploratório, e mostramos onde ele falha.”
