# Inspeção visual e teste de generalização — 28/10/2026

## O que foi feito

Foram inspecionados os três polígonos com maior área discordante da referência MapBiomas, com imagens RGB Sentinel-2 de **21/07**, **16/08** e **25/10/2025**. A cena de outubro, `S2B_T23KLS_20251025T132232_L2A`, foi obtida do catálogo público Earth Search e **não foi utilizada no treinamento** do modelo. Seu recorte e metadados estão em `unseen/`.

Essas são **observações reais de datas diferentes**, mas todas da família Sentinel-2. Comparar mudanças de cor/textura e permanência de talhões ajuda na auditoria; não revela necessariamente a espécie plantada, em especial com pixels de 10 metros.

### Polígono 33 — 47,85 ha

![Inspeção visual do polígono 33](evaluation/inspecao_visual/poligono_33_inspecao.png)

- Centro aproximado: **−21.338120, −46.675109** ([abrir imagens de satélite no Google Maps](https://www.google.com/maps/@-21.338120,-46.675109,17z/data=!3m1!1e3)).
- Observação visual: talhões com limites relativamente organizados permanecem reconhecíveis em julho, agosto e outubro. **Isso é compatível com uso agrícola, mas não distingue café de outras lavouras.**
- O MapBiomas rotula somente ~24,7% do polígono como café; ~70% como outras classes, predominantemente mosaico de usos. Como essa referência treinou o modelo, essa comparação **não é validação independente**.
- **Conclusão:** região altamente incerta; não chamar a área inteira de café.

### Polígono 32 — 5,60 ha

![Inspeção visual do polígono 32](evaluation/inspecao_visual/poligono_32_inspecao.png)

- Centro: **−21.337711, −46.682477** ([satélite no Google Maps](https://www.google.com/maps/@-21.337711,-46.682477,17z/data=!3m1!1e3)).
- São manchas de vegetação em área predominantemente rotulada como pastagem no mapa externo, sem padrão visual suficientemente específico para café em resolução de 10 metros.
- **Conclusão:** alta chance de confusão temática; presença de café não verificada.

### Polígono 29 — 5,55 ha

![Inspeção visual do polígono 29](evaluation/inspecao_visual/poligono_29_inspecao.png)

- Centro: **−21.333927, −46.656488** ([satélite no Google Maps](https://www.google.com/maps/@-21.333927,-46.656488,17z/data=!3m1!1e3)).
- A geometria alcança a **borda leste do recorte fornecido**; parte da possível área agrícola está fora da imagem, e o polígono não deve ser interpretado como o limite completo do talhão.
- **Conclusão:** área parcial; não inferir geometria completa nem quantidade real de café para fora dos dados.

## Teste em imagem não vista no treinamento: problema importante

| Cena processada | Polígonos | Área candidata | Coincidência com café MapBiomas | Coincidência com floresta MapBiomas |
| --- | ---: | ---: | ---: | ---: |
| Agosto + julho, ambas usadas no treino | 35 | 96,02 ha | 29,07 ha | 7,07 ha |
| **Outubro, fora do treino** | **109** | **83,27 ha** | **6,30 ha** | **66,45 ha** |
| Agosto + outubro, combinação exploratória | 26 | 35,97 ha | 14,95 ha | 3,36 ha |

A imagem de outubro revelou **uma falha séria de generalização temporal**: apesar de haver poucos sinais de nuvens e manter a mesma grade, o modelo classificou muitas manchas florestais como candidatas. Combinar outubro com agosto reduz a área florestal selecionada, porém deixa de identificar grande parte do café apontado na referência. Portanto, **mais datas nem sempre melhoram um modelo fraco; a forma de treiná-lo e validá-lo importa**. Os números acima são comparações com a referência de treinamento, não métricas independentes de acurácia.

O modelo atual **não deve ser descrito como detector confiável para qualquer data ou localidade**. Sua saída continua sendo apenas uma triagem de candidatos. Para desenvolvimento posterior seriam necessários treinamento multissazonal, teste por ano/região e amostras independentes de café e não café.

## Referências externas pesquisadas — limites do acesso

- O **Geoportal do Café da EMATER-MG** é uma fonte temática promissora ([portal](https://portaldocafedeminas.emater.mg.gov.br/)), mas nesta pesquisa não foi possível obter polígonos georreferenciados verificáveis e reutilizáveis para a área de estudo.
- A plataforma **SeloVerde-MG** indica bases de áreas cafeeiras da EMATER com **acesso restrito sob solicitação**, não uma referência pública pronta para integração ([fontes de dados](https://cit.ctmodelagem.com.br/seloverde_mg_cafe/en/data-sources/)).
- O catálogo **USGS Landsat Collection 2** forneceu metadados de cena de 17/08/2025, mas o download dos ativos nesse serviço redirecionou para um login; o catálogo alternativo Earth Search indicou ativos Landsat com pagamento pelo solicitante. **Não foram baixados nem usados** como imagens de validação.
- Links de satélite acima são **pontos para conferência manual futura**, não prova de que uma fonte independente foi efetivamente interpretada.

## Reprodução

```bash
python fetch_additional.py --scene S2B_T23KLS_20251025T132232_L2A --output unseen
python coffee_model.py classify unseen/imagem_adicional_multiespectral.tif --scl unseen/qualidade_adicional_scl.tif --date 2025-10-25 --output outputs_model_outubro
python visual_review.py
python evaluate_reference.py --baseline outputs_model/candidatos.geojson --model outputs_model_outubro/candidatos.geojson --output evaluation/outubro
```

O download requer acesso HTTPS público e certificado CA válido para o GDAL; nunca desabilitar a verificação TLS em produção. As pranchas, `locais_para_conferencia.json` e os resultados de outubro são reproduzíveis com os dados incluídos no projeto.
