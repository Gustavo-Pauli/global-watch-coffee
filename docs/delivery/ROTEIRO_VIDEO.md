# Roteiro de demonstração — até 3 minutos

**Status: roteiro pronto; o vídeo NÃO foi gravado.** Grave a tela no aplicativo realmente publicado, sem simular resultados.

**00:00–00:20 — Entrada e objetivo.** Mostrar URL pública, tela responsiva (breve resize), explicar “candidatos de café, não cultivo confirmado”.

**00:20–00:40 — Login Google.** Entrar e mostrar que acessar `/api/analyses` sem token retorna 401 (API docs ou DevTools), logout demonstrado depois.

**00:40–01:20 — Processamento real do kit.** Na coleção, abrir “Nova análise”, aba “Usar exemplo”, escolher agosto/2025 e clicar “Iniciar análise”. Mostrar processamento, mapa com contornos, legenda/data/ha; abrir “Informações” para contagem e NDVI. Mencionar DN escala/offset, SCL e RF multiclasse em 1 frase.

**01:20–01:45 — Download.** No menu “Arquivos”, baixar `candidatos.geojson`, `imagem_classificada.png`, `classificacao.tif`. Mostrar propriedades `area_ha` e CRS.

**01:45–02:15 — Chatbot.** Abrir “Assistente”, mostrar a classificação e perguntar “Quantos hectares?” e “Você tem certeza que é café?” Mostrar que números são do relatório e que há limitações. Se a resposta for por regras, mostrar a identificação de contingência; IA generativa depende da configuração e disponibilidade do servidor.

**02:15–02:40 — Imagem adicional.** Processar julho/2025 (data diferente) e mostrar que resultados são recalculados, sem hardcoding. Se couber, alternar para outubro e comentar erro temporal diagnosticado.

**02:40–03:00 — Evidências/segurança.** Mostrar pytest, relatório de comparação espacial, referência bibliográfica e logout. URL do repositório público + nota de pesquisa.

**Antes de gravar:** testar fluxo num navegador anônimo e em smartphone; validar contas Google permitidas, tempo real de processamento, limite de 3min, áudio e URLs, sem expor chaves nem tokens.
