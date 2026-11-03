# Referências e protocolo do piloto

Verificação de acesso realizada em **02/11/2026**, sem autenticação ou criação de contas. Os resultados completos da execução ficam em `experiments/outputs/land-change/references/access-audit.json` (artefato local ignorado pelo Git).

## Produtos verificados

| Produto | Evidência nesta execução | Consequência |
|---|---|---|
| MapBiomas Cobertura 10 m, Coleção 4, ano 2025 | A [página oficial](https://brasil.mapbiomas.org/iniciativas-e-produtos/cobertura-e-uso-da-terra/cobertura-10m/cobertura/) publica a URL usada no código; GET de bytes dessa URL retornou HTTP 403 / AccessDenied. | Nenhum recorte quantitativo foi obtido. Não substituir por um ano anterior silenciosamente. |
| MapBiomas Cobertura 30 m, Coleção 11, ano 2025 | GET/HEAD anônimo da URL já usada pelo projeto retornou HTTP 403. | O recorte local de Guaxupé não serve como referência dos dois recortes amazônicos. |
| MapBiomas Alerta | A [documentação da API](https://docs.api.alerta.mapbiomas.org/pt-BR/) exige conta verificada e Bearer Token. A consulta anônima, somente leitura, ao endpoint de produção falhou por erro de rede nesta máquina. | Não foram obtidos alertas. Falha de rede observada não comprova resposta HTTP 401 desse endpoint. |
| NASA OPERA DIST-ALERT-HLS V1 | A CMR pública retornou um granule recente para cada recorte. Os dois TIFFs de status retornaram HTTP 401 ao GET anônimo de bytes. | Catálogo consultável; rasters indisponíveis sem acesso autenticado nesta execução. Metadados não equivalem a download do produto. |

Os granules DIST encontrados foram adquiridos em **31/10/2026** e produzidos em **02/11/2026**: `T21MXN` para Novo Progresso e `T21MYS` para Belterra. A especificação e a distribuição oficial estão na [NASA/JPL](https://www.jpl.nasa.gov/go/opera/products/dist-product-suite/). Não foi criada conta Earthdata nem solicitado processamento remoto.

O MapBiomas Cobertura exige preservação de atribuição; a referência local registra CC BY 4.0. O [MapBiomas Alerta](https://alerta.mapbiomas.org/perguntas-frequentes/) informa CC BY-SA para seus dados. Essas licenças não são intercambiáveis com a licença MIT do código. Consultar os termos do produto obtido antes de redistribuí-lo.

## Como repetir a auditoria ou alinhar um raster

Na raiz do repositório:

```powershell
& apps/geo-worker/.venv/Scripts/python.exe -m research.land_change.references --audit-only
```

Com um raster categórico realmente disponível:

```powershell
& apps/geo-worker/.venv/Scripts/python.exe -m research.land_change.references --image CAMINHO_DA_CENA.tif --source CAMINHO_DA_REFERENCIA.tif --year 2025
```

O código preserva os códigos originais, recorta apenas a janela necessária e alinha por vizinho mais próximo. Registra ano, fonte, grade, checksum e contagens por classe; não chama o resultado de verdade de campo. URLs assinadas ou com credenciais são recusadas na proveniência. Um erro ao obter o recorte resulta em código de saída 2, nunca em um raster fictício.

## Referência independente e comparações válidas

1. Congelar os blocos espaciais de treino, ajuste e teste antes de examinar previsões. Anotar imagens sem mostrar MapBiomas, limiares ou resultados dos modelos ao intérprete.
2. Para classificação, registrar classe, data/intervalo, evidências, intérprete e ambiguidade de cada amostra. `Pastagem` versus `cultivo` exige trajetória temporal ou outro suporte suficiente; vegetação baixa isolada não resolve essa distinção. Usar `indeterminado` quando necessário.
3. Uma amostra de floresta precisa ser distinguida de silvicultura quando houver evidências. Cobertura arbórea, vegetação nativa, uso anterior e situação legal são afirmações diferentes.
4. Para detecção, registrar a última observação clara intacta, a primeira observação clara alterada e, separadamente, a data de confirmação. A ocorrência está em um intervalo; a data de publicação de um alerta não é a data exata da remoção.
5. Incluir controles estáveis e difíceis, e não somente polígonos de um detector. Caso a amostra venha de seleção por candidato/modelo, registrar o viés e não estimar revocação de toda a área a partir dela.
6. Rótulos de outro mapa ou de limiares automáticos são **supervisão fraca/pseudorrótulos**. Um teste contra eles mede concordância. Um intérprete automatizado sobre as mesmas imagens também não é revisão independente de campo; registrar essa limitação e solicitar segunda interpretação antes de alegações fortes.
7. Comparar períodos e legendas compatíveis. Um mapa anual de 2025 não pode ser tratado como errado simplesmente porque uma observação de 2026 mostra outro uso. Separar atualização temporal de erro em áreas demonstradamente estáveis.
8. Nuvens, sombras e ausência de observações representam falta de evidência. Não converter pixels desconhecidos em ausência de mudança, floresta estável ou acerto de classificação.
9. Reportar as quantidades de amostras válidas/indeterminadas por classe e bloco; classes raras ou sem suporte ficam inconclusivas. Intervalos por reamostragem devem agrupar por bloco espacial, não por pixels vizinhos.

Sem produtos comparadores acessíveis e sem anotações independentes, o piloto pode produzir **candidatos, mapas exploratórios, qualidade dos dados e custos medidos**, mas não uma afirmação de superioridade ao MapBiomas nem precisão/recall de desmatamento confirmado.

## Emenda de suporte antes da anotação — 02/11/2026

A revisão alinhada r2 mantém as 300 posições congeladas e ainda não possui rótulos. A distribuição sorteada é: **94 treino, 27 validação, 29 teste local e 150 teste de transferência**. O critério inicial de dez referências por classe tornava a avaliação local de cinco classes impossível: seriam necessárias pelo menos 50 posições em cada partição local.

Antes de examinar qualquer resultado de classificação ou preencher rótulos, o suporte mínimo exploratório passa a ser:

| Partição | Mínimo de blocos independentes por classe |
|---|---:|
| Treino | 10 |
| Validação local | 5 |
| Teste local | 5 |
| Teste geográfico de transferência | 10 |

Cinco permite a possibilidade de avaliar cinco classes em uma partição local com pelo menos 25 posições. Isso não garante que todas as classes estejam presentes ou interpretáveis: classes raras e suportes inválidos ainda tornam a avaliação inconclusiva. Nenhuma geometria, peso, classe ou posição foi modificada a partir de previsões. A emenda é motivada pelo tamanho da amostra congelada, não pelo desempenho de um método.

Os dois classificadores usam a mesma política, registrada como `preannotation-amendment-20261102-v2` nas métricas. Os resultados continuam sendo concordância exploratória com a interpretação declarada, sem estimativa de acurácia populacional, intervalos de confiança ou superioridade ao MapBiomas. A quantidade mínima é um limite prático do piloto, sem justificativa para alegações fortes a partir de cinco exemplos.
