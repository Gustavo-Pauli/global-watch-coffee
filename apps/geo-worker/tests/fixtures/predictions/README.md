# Predições para regressão

GeoJSONs históricos calculados a partir das cenas locais. São entradas dos testes de diagnóstico e inspeção temporal; a API não os utiliza como resposta a uploads.

- `baseline.geojson`: triagem espectral na cena de agosto.
- `model.geojson`: modelo v1 treinado com julho/agosto, aplicado em agosto.
- `model_uma_data.geojson`: variante treinada apenas com agosto.
- `model_adicional.geojson`: variante treinada apenas com julho.
- `model_outubro.geojson`: modelo v1 aplicado em outubro.

Preservados byte a byte da versão anterior para detectar mudanças nas rotinas de comparação. Não são rótulos de campo. Modelos e referências estão em `apps/geo-worker/models/` e `data/`.

Contains modified Copernicus Sentinel data (2025). Consulte `data/README.md` para as atribuições das cenas e da referência MapBiomas.
