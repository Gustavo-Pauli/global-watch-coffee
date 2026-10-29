# Diagnóstico dos erros aparentes — 28/10/2026

Esta análise **não altera nem treina o modelo**. Compara os polígonos produzidos com o mapa MapBiomas usado como supervisão fraca. O resultado mede **concordância com essa referência**, não acurácia em campo nem prova de café.

## 1. As duas datas ajudaram?

| Processamento | Área candidata (ha) | Coincide com café do mapa (ha) | Coincide com floresta (ha) | Coincide com outras classes (ha) | Café do mapa encontrado |
| --- | ---: | ---: | ---: | ---: | ---: |
| Limiares espectrais (16/08) | 1.159,99 | 24,46 | 881,42 | 254,11 | 56,9% |
| Random Forest — só 16/08 | 97,17 | 28,25 | 10,83 | 58,09 | 65,7% |
| Random Forest — só 21/07 | 102,27 | 28,44 | 5,52 | 68,31 | 66,1% |
| **Random Forest — duas datas** | **96,02** | **29,07** | **7,07** | **59,88** | **67,6%** |

As duas datas trouxeram uma **melhora modesta** em cobertura da classe café do MapBiomas e reduziram a sobreposição com floresta em relação a agosto sozinho, mas **não eliminaram confusão com outras classes**. A interseção sobre união (IoU) entre as máscaras de agosto e das duas datas é **0,7737**: a combinação retirou ~12,90 ha que agosto apontava e acrescentou ~11,75 ha que agosto não apontava.

## 2. Onde está o maior problema?

O polígono **33**, com ~47,85 ha, reúne **cerca de metade da área candidata total**. Dentro dele, o mapa MapBiomas atribui aproximadamente **24,7% a café**, **5,3% a floresta** e **70,0% a outras classes**; a classe predominante é **mosaico de usos (21)**, categoria que pode agregar usos agropecuários misturados. Isso significa que é uma área prioritária para inspeção manual com uma fonte independente. **Não se pode afirmar que os 70% estejam errados em campo só porque discordam do mapa.**

O segundo maior exemplo de discordância é o polígono **32** (~5,60 ha), com ~79,3% atribuído pelo MapBiomas a outras classes, predominantemente **pastagem (15)**. Também precisa de validação independente.

![Comparação visual das previsões com o MapBiomas](evaluation/diagnostico/mapa_erros_referencia.png)

Na figura: **verde** = concordância da predição com café no mapa; **vermelho** = predição sobre floresta; **laranja** = predição sobre outras classes; **azul** = áreas que o mapa chama de café e o modelo não selecionou. O painel da esquerda mostra por que NDVI sozinho foi insuficiente; o da direita mostra a melhora e os erros restantes do Random Forest.

## 3. O que muda se o limiar de classificação mudar?

| Escore mínimo | Área candidata (ha) | Café no MapBiomas (ha) | Floresta no MapBiomas (ha) | Cobertura do café no mapa |
| --- | ---: | ---: | ---: | ---: |
| 0,50 | 132,00 | 33,04 | 16,01 | 76,84% |
| **0,60 — adotado** | **96,02** | **29,07** | **7,07** | **67,60%** |
| 0,70 | 72,82 | 25,14 | 3,40 | 58,47% |
| 0,80 | 50,87 | 21,35 | 0,94 | 49,65% |

O trade-off é claro: limiares mais rígidos eliminam boa parte das áreas discordantes, mas **também deixam de selecionar áreas mapeadas como café**. Mesmo a 0,80, ~28,58 ha das previsões coincidem com outras classes. Portanto **trocar apenas o limiar não resolve o problema científico**. O 0,60 foi mantido como configuração exploratória, **não otimizada contra os dados de avaliação**. Os escores do Random Forest não são percentuais calibrados de probabilidade.

## 4. O que ainda falta para afirmar que encontramos café?

1. **Amostras de validação independentes**: pontos ou perímetros de cafezais e outras coberturas verificados fora do mapa MapBiomas de treinamento.
2. **Mais diversidade temporal**: duas cenas separadas por 26 dias não caracterizam toda a dinâmica anual e a sazonalidade do café.
3. **Teste geográfico independente**: a cidade e o recorte atual não representam diferentes regiões do Brasil.
4. **Calibração de escores** com rótulos de validação exclusivos antes de publicar qualquer porcentagem de confiança.

## Como reproduzir

```bash
python coffee_model.py classify sample/imagem_multiespectral.tif --scl sample/qualidade_scl.tif --date 2025-08-16 --output outputs_model_uma_data
python diagnose_errors.py
python threshold_sensitivity.py
```

Saídas: `evaluation/diagnostico/diagnostico_falsos_positivos.json`, `evaluation/diagnostico/mapa_erros_referencia.png` e `evaluation/sensibilidade_limites.json`. As categorias da legenda MapBiomas, inclusive 21/mosaico de usos e 46/café, constam na [tabela oficial da Coleção 11](https://brasil.mapbiomas.org/iniciativas-e-produtos/cobertura-e-uso-da-terra/cobertura-30m/cobertura/).
