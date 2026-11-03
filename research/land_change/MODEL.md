# Viabilidade local do TerraMind Tiny

Este experimento usa o encoder congelado `ibm-esa-geospatial/TerraMind-1.0-tiny`, sem gerar modalidades artificiais. Ele mede a capacidade de extrair características de imagens reais na GPU local. Não constitui um classificador treinado, comparação de acurácia ou prova de operação em produção.

## Ambiente isolado

Python e dependências ficam em `research/land_change/.venv`. O ambiente Python do worker e as dependências da aplicação não são alterados.

```powershell
python -m venv research/land_change/.venv
& research/land_change/.venv/Scripts/python.exe -m pip install torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu118
& research/land_change/.venv/Scripts/python.exe -m pip install -r research/land_change/requirements-model.txt
& research/land_change/.venv/Scripts/python.exe -m pip check
```

O wheel CUDA Windows utilizado tem SHA-256 `80855ec840b7b06372ff43535d01393a8ec101842618d1f9ed629572b52aed71`, publicado no índice oficial do PyTorch. O checkpoint tem SHA-256 `e56ea9ebcd4451078b9ca4893d5cd8a89bbee376ae16829c3e7fbbbc76de0eba`; o probe interrompe a execução se esse artefato mudar.

O cache do modelo está em `experiments/outputs/land-change/model-cache`, com limite de 4 GiB. A lista completa de versões instaladas fica em `model-cache/environment-freeze.txt`; `environment-licenses.json` registra os metadados de licença de cada distribuição, incluindo campos ausentes. Pacotes de instalação e pesos são artefatos locais ignorados pelo Git.

## Entradas e interpretação

- GeoTIFF float32 com reflectância física e seis bandas: B02, B03, B04, **B08**, B11 e B12, nessa ordem; escala 1 e offset 0.
- B08 é mapeado para `NIR_BROAD`. `NIR_NARROW` representaria B8A e não pode substituir B08 silenciosamente.
- SCL deve estar exatamente alinhada. Apenas classes 4, 5 e 6 contam como observação utilizável. Água é permitida; nuvens, sombras e pixels inválidos não são evidência de uma classe terrestre.
- Reflectância física é multiplicada por 10000 e normalizada pelas médias e desvios de pré-treino TerraMind v1 correspondentes às seis bandas. Isso não reaplica o offset radiométrico Sentinel.
- Pixels inválidos recebem o valor neutro após normalização. A fração utilizável de cada patch é exportada; características de patches com menos de 90% utilizável recebem NaN.

O encoder tem patches de **16 × 16 pixels de entrada**: com imagem de 10 m, as características estão em uma grade de **160 m**, com 192 canais. Os tokens também incorporam contexto da janela inteira de inferência. Expandir essas características para uma grade de 10 m não produz uma classificação detalhada de 10 m. As bandas SWIR continuam tendo informação nativa de 20 m mesmo quando reamostradas na entrada.

## Executar

```powershell
& research/land_change/.venv/Scripts/python.exe -m research.land_change.model_probe --image CAMINHO/reflectance.tif --scl CAMINHO/scl.tif --output experiments/outputs/land-change/model-probe/execucao --max-tiles 4
```

O limite padrão é quatro janelas de 224 × 224 pixels em ordem de leitura. Essa seleção é um teste de viabilidade e não uma amostra estatística. A função `extract_tile_features()` também pode ser importada, recebendo caminhos de imagem, SCL e diretório de saída. Nenhuma mudança automática para CPU ocorre se CUDA não estiver disponível.

`features.npz` contém `features`, `clear_fraction` e `windows`. `windows` guarda coluna, linha, largura e altura em pixels da imagem de origem. `probe.json` registra hashes, normalização, resolução, forma dos resultados, versões, tempo e pico de memória CUDA. Um futuro classificador deve respeitar a escala das características e os blocos espaciais das referências. O treinamento permanece condicionado a referências revisadas; rótulos de outro produto não viram validação independente.

## Resultados executados em 2 de novembro de 2026

CUDA foi verificado na RTX 2060 SUPER de 8 GiB. `pip check` não encontrou dependências quebradas. PyTorch 2.7.1+cu118, torchvision 0.22.1+cu118, TerraTorch 1.2.13, timm 1.0.30 e rasterio 1.5.2 foram utilizados.

| Cena real | Janelas de 224 px | Patches com ≥90% utilizável | Tempo de inferência GPU | Pico alocado pelo PyTorch |
|---|---:|---:|---:|---:|
| Novo Progresso, 01/11/2026 — prefixo de viabilidade | 4 | 731 / 784 | 0,327 s | 36,7 MiB |
| Novo Progresso, 07/10/2026 — recorte completo de revisão | 100 | 18.274 / 19.600 | 0,716 s | 36,7 MiB |
| Belterra, 07/10/2026 — recorte completo de revisão | 100 | 18.429 / 19.600 | 0,633 s | 61,2 MiB |

Os tempos foram medidos com sincronização CUDA por janela e excluem importação, carregamento do modelo, leitura dos rasters, hashes e exportação. O primeiro carregamento do processo levou aproximadamente 12,7 s. Os valores de memória são do alocador PyTorch: não incluem contexto CUDA, driver, outros processos nem memória necessária a treinamento.

Os artefatos estão em `experiments/outputs/land-change/model-probe/{novo_progresso_latest,novo_progresso_review_target,belterra_review_target}`. As características têm forma `(janelas, 14, 14, 192)`. Conferências posteriores verificaram valores finitos nos patches utilizáveis, NaN nos patches excluídos e coerência das janelas de origem. O resultado demonstra viabilidade de extração local de características; a comparação entre classificadores depende das referências revisadas.

Onze testes adicionais em `tests/test_model_probe.py` passaram no ambiente do worker, sem PyTorch: unidades radiométricas, pixels ausentes, entradas inválidas, deslocamento de meia célula na SCL, projeção e geometria, além da integridade do arquivo inteiro. As verificações de grade ocorrem antes de carregar o modelo ou baixar pesos.

Downloads integrais inicialmente ficaram parados nesta conexão. Os dois artefatos grandes foram obtidos por intervalos HTTP da mesma origem oficial, com validação de `Content-Range`, tamanho final e SHA-256. Nenhum mirror, credencial ou serviço pago foi necessário. O checkpoint foi então carregado pelo mecanismo normal do TerraTorch/Hugging Face.

## Fontes e licenças

- [Model card oficial](https://huggingface.co/ibm-esa-geospatial/TerraMind-1.0-tiny): pesos Apache-2.0, bandas suportadas e arquitetura.
- [Código TerraMind](https://github.com/IBM/terramind): Apache-2.0.
- [Implementação TerraTorch](https://github.com/terrastackai/terratorch): seleção dos pesos por banda, estatísticas de pré-treino e encoder.
- [Índice CUDA do PyTorch](https://download.pytorch.org/whl/cu118/torch/): origem e hash do wheel instalado. PyTorch/torchvision e suas dependências mantêm suas próprias licenças distribuídas com os pacotes.
- Contains modified Copernicus Sentinel data (2025, 2026). A proveniência das cenas é mantida no manifesto do estudo.
