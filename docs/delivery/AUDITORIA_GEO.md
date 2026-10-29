# Auditoria do worker e geoprocessamento

Verificação local em 29/10/2026. Este documento registra execução no Windows; não comprova deploy, cold start ou consumo no Render.

## Escopo e método efetivamente utilizado

O enunciado em `data/sample/DESAFIO.txt` exige processamento real, índice espectral, polígonos, hectares e limitações explícitas. O worker de produção usa somente `models/v2/coffee_rf.joblib`, com scikit-learn **1.8.0** fixado. Não foi realizado treinamento nem substituição de modelos nesta auditoria.

- Quatro bandas posicionais B02, B03, B04 e B08; descrições, quando presentes, precisam declarar essa mesma ordem. Descrições do kit como `B02_blue` são aceitas. Sem descrições, a semântica das bandas continua sendo responsabilidade de quem prepara o arquivo.
- Reflectância obtida uma vez por `DN * scale + offset` dos metadados; no kit, `0.0001` e `-0.1`. DN sem escala que produz valores incompatíveis com reflectância é rejeitado; nenhuma escala é inferida silenciosamente.
- Máscaras GDAL/NoData e valores não finitos são excluídos. Zero físico não é automaticamente NoData. SCL é alinhada por vizinho mais próximo; apenas classes 4 e 5 entram como observações claras. Cena sem qualquer pixel válido retorna erro.
- NDVI, GNDVI, EVI2, textura 5x5 e razão NIR/vermelho compõem doze atributos. A inferência executa as árvores sobre os pixels recebidos; teste altera NIR e confirma que os polígonos mudam.
- RF multiclasse com escore não calibrado ≥0,50 e classe vencedora café, coerência 3x3 e área mínima de 0,2 ha. O GeoJSON é WGS84; hectares vêm de `pyproj.Geod` sobre as geometrias, não de uma suposição fixa de metros por pixel.
- O TIFF classificado usa 1 para os candidatos efetivamente retidos no GeoJSON, 0 para demais pixels válidos e 255 para NoData. PNG, GeoJSON, TIFF e resumo derivam da mesma execução.
- A versão v2 foi treinada com julho, agosto **e outubro**. Outubro não é teste temporal independente. Supervisão MapBiomas de 30 m é rótulo fraco, sem confirmação de campo; scores e métricas de referência não são acurácia de detecção de café.

## Problemas e correções

| Gravidade | Evidência anterior | Correção / teste |
|---|---|---|
| Alta | FastAPI podia receber e interpretar JSON sem limite antes de validar o segredo | Middleware ASGI autentica primeiro e limita o corpo, inclusive chunked, a 32 KiB; tipos incorretos retornam 415, excesso 413, dados inválidos 422 |
| Alta | SCL comprimida de poucos bytes podia declarar dimensões enormes e ser lida integralmente | Validação de GTiff, uma banda uint8 e até um milhão de pixels **antes** da leitura; regressão com SCL compactada acima do limite |
| Alta | O limite de download era aplicado depois da descompressão HTTP | Requisição `Accept-Encoding: identity`, rejeição de Content-Encoding e conferência de bytes declarados/recebidos; teste antes de decodificar gzip |
| Média | A lista permitida verificava apenas prefixo e ocorrência de `/sign/` | Endpoints distintos de leitura/upload; rejeição de dot segments, escapes percentuais aninhados e barras invertidas; host, porta, HTTPS e ausência de credenciais permanecem obrigatórios |
| Média | Retentativa de tarefa ativa recebia erro ou poderia estimular reexecução | ID ativo retorna 202 sem disparar outro classificador; outra tarefa recebe 503; regressão verifica uma única execução |
| Média | Validade dependia de DN diferente de zero e ignorava máscaras GDAL explícitas | Máscaras GDAL e radiometria finita verificadas, preservando zeros físicos válidos; testes independentes com raster sintético |
| Média | Ordem declarada errada, grade rotacionada ou escala ausente podiam alimentar o modelo incorretamente | Validações explícitas de bandas, transformação e reflectância; regressões de entradas inválidas |
| Média | TIFF mantinha pequenas componentes descartadas do GeoJSON e dos hectares | Rasterização das geometrias retidas para o TIFF; teste com regiões de 25 e 4 pixels confirma a mesma seleção em ambos os formatos |
| Média | Escore por polígono criava uma máscara do tamanho da cena para cada região | Uma matriz de rótulos e `bincount` substituem esse custo quadrático; limite de 10.000 regiões interrompe entradas patológicas |
| Média | Paralelismo do RF/GDAL e cache GDAL variavam conforme CPUs/RAM do host | RF `n_jobs=1`, cache GDAL de 16 MiB, GDAL com uma thread, Render explicitamente com um processo Uvicorn |
| Média | Modelo de outra versão sklearn podia produzir apenas warning e continuar | Pipeline v2 transforma `InconsistentVersionWarning` em erro e exige metadados/classes v2; teste carrega modelo de produção sem incompatibilidade |
| Baixa | Dependência multipart e imports não eram usados pelo novo protocolo JSON | Removidos `python-multipart`, import `re`, `median_filter` e `Image` sem uso |

Arquivos principais: `apps/geo-worker/src/geo_worker/{worker,coffee_v2,processing}.py`, `apps/geo-worker/pyproject.toml`, `render.yaml`, `apps/geo-worker/tests/test_worker_security.py` e `test_v2_integrity.py`.

## Testes e resultados

Ambiente: Python 3.12.6, scikit-learn 1.8.0, NumPy 2.5.4, Rasterio 1.5.2, FastAPI 0.162.0, httpx 0.28.1 e joblib 1.6.0; `.venv` existente preservada.

```powershell
& apps/geo-worker/.venv/Scripts/python.exe -m pytest apps/geo-worker/tests -q --disable-warnings
& apps/geo-worker/.venv/Scripts/python.exe -m compileall -q apps/geo-worker/src apps/geo-worker/tests
& apps/geo-worker/.venv/Scripts/python.exe -m pip check
```

- **50 testes passaram em 21,76 s**, incluindo processamento real de cenas/bytes de upload, callbacks e Storage simulados, alteração de pixels, autenticação, envelope inválido/vazio, tipo de conteúdo, limite chunked, SSRF, SCL, concorrência, falha parcial de upload, retentativa de callback e integridade TIFF/GeoJSON.
- `compileall`: passou. `pip check`: `No broken requirements found`.
- Os mocks HTTP testam o contrato e os artefatos reais do classificador; não comprovam permissões do Supabase nem callback após cold start. A validação com os serviços reais é registrada separadamente no relatório final.
- A suíte ainda emite avisos de depreciação das bibliotecas e de versão do **modelo v1 histórico** (serializado com sklearn 1.9.1). O teste do modelo **v2 de produção** eleva a incompatibilidade a erro e passou. Não substituir o pin 1.8.0 pelo do v1: isso introduziria incompatibilidade no v2. Para reproduzir pesquisa v1, usar ambiente separado compatível; não selecionar v1 em `COFFEE_MODEL` no serviço v2.

## Medição local de recursos

Processos Python independentes; `GetProcessMemoryInfo`/`PeakWorkingSetSize` do Windows, com assinatura nativa de 64 bits validada. Tempo cobre `classify_job` (leitura, modelo, inferência e seis produtos locais), excluindo transferências HTTP e imports iniciais.

| Entrada | Tempo local | Pico de working set | Resultado |
|---|---:|---:|---|
| Kit agosto, 512x512, SCL real | 4,06 s | 255,0 MiB | 24 polígonos, 22,661 ha candidatos |
| Teste sintético de carga, 1000x1000, pixels do kit repetidos, sem SCL | 10,16 s | 409,2 MiB | Processamento concluído; não é nova evidência agronômica |

São duas amostras locais, sem garantia de pior caso, consumo Linux ou limite do Render. Fragmentação, forma da projeção e versões de bibliotecas alteram consumo; a reprojeção PNG também tem teto de dois milhões de pixels. Medir RSS e duração no Render antes da apresentação pública; se faltar margem de RAM, reduzir o limite de pixels mantendo a mensagem da UI consistente. Nenhuma medição de cold start foi realizada.

## Operação e riscos restantes

- Worker recebe apenas URLs temporárias, segredo de comunicação, identificação da tarefa e opções permitidas. Não acessa PostgreSQL, sessão Google nem chave administrativa do Storage.
- Produção: `uvicorn geo_worker.server:app --host 0.0.0.0 --port $PORT --workers 1`, a partir da raiz do monorepo. Dados de demonstração estão em `data/`, fora da pasta do worker. `render.yaml` usa raiz do repositório, Python 3.12 e instalação do pacote editable.
- A limitação de uma tarefa é **por processo**. Não escalar para vários workers sem rever capacidade, idempotência e memória; o comando fornecido fixa um processo.
- Idempotência local cobre tarefas **em execução**. Não há registro durável de trabalhos no Python. O Next.js precisa autorizar a transição de estado e aceitar callback repetido de forma idempotente.
- Render Free suspende após 15 minutos sem requisições e pode levar cerca de um minuto para retomar. Disco é efêmero. Uma interrupção perde a tarefa; o status PostgreSQL e o timeout do Next.js permitem informar falha, mas não retomam o trabalho. Não foi introduzida fila paga.
- O worker tenta callback três vezes, com timeout e espera crescente, sem registrar URLs assinadas ou tokens. Falha definitiva de callback depende do tratamento de tarefa stale no Next.js.
- TIFF não declara necessariamente a semântica correta das bandas. Descrições incoerentes são rejeitadas; sem descrições, o contrato de preparação continua essencial. O modelo é exploratório e regional; não existe validação de campo.
- Geoprocessamento nativo continua sendo entrada não confiável para GDAL: limites de corpo, bytes, dimensões e operações reduzem abuso, mas não equivalem a isolamento de sistema operacional para executar código nativo malformado. Manter bibliotecas atualizadas e o serviço sem outros segredos.

## Referências oficiais consultadas

- [scikit-learn: persistência e incompatibilidade entre versões](https://scikit-learn.org/stable/model_persistence.html): pickle/joblib exige ambiente compatível e origem confiável.
- [Rasterio: máscaras NoData/GDAL](https://rasterio.readthedocs.io/en/stable/topics/masks.html): distinção entre máscara de validade e valor numérico do pixel.
- [Render Free](https://render.com/docs/free): suspensão, reativação e filesystem efêmero. O plano é destinado a projetos de teste/hobby; este protótipo não oferece durabilidade de execução.
- [Render: FastAPI](https://render.com/docs/deploy-fastapi): execução HTTP com Uvicorn, host público e `$PORT`.
