# Organização e inspeção técnica — 30/10/2026

O objetivo desta revisão é facilitar a avaliação e a defesa do desafio: código legível, processamento verificável e inspeção dos dados reais. Publicação na Vercel/Render/Supabase foi informada pelo usuário; ele fará a validação pública final antes do vídeo. Os testes registrados aqui são locais.

## Organização

- Web: `features/shell`, `features/analyses`, `features/map` e `features/chat`; `components/ui` contém os componentes compartilhados. Tailwind 4 sem prefixo é o padrão. CSS global fica restrito à base, tokens/animações e integração Leaflet.
- Python: `api` contém HTTP, autenticação de serviço e tarefas; `pipeline` contém leitura, índices, classificação e renderização; `research` reúne treino, avaliação e protótipos. Inferência de produção não importa pesquisa. Entradas antigas são facades para preservar os comandos documentados.
- Prisma/Better Auth permanecem no Next. O worker não recebe banco, sessão de usuário ou chave administrativa do Storage.

## Dados e compatibilidade

O resultado JSON de esquema 2 acrescenta qualidade, proveniência e visualizações. Análises anteriores continuam funcionando com os seis arquivos originais; não há migração SQL.

Os dois novos PNGs são `mapa_falsa_cor.png` (B08/B04/B03) e `mapa_ndvi.png`, na mesma grade/bounds do raster do mapa. São gerados sequencialmente. O worker aceita o conjunto antigo de seis URLs ou o novo de oito; rejeita nomes desconhecidos e conjuntos incompletos. A conclusão verifica todos os arquivos declarados e a limpeza inclui os extras.

`ndvi_mean` é calculado por polígono usando os labels existentes. Só entram pixels elegíveis, com denominador definido, valor finito e índice no domínio [-1,1]. Fora disso o PNG é transparente e a média pode ser nula. Isso não altera as features do modelo, máscara, geometrias, hectares ou mediana legada da cena.

Qualidade separa pixels inválidos da entrada e pixels excluídos pela SCL, sem dupla contagem. Somente SCL 4/5 permanecem elegíveis quando há máscara. A porcentagem usa arredondamento decimal compatível entre Python e JS. **Pixels excluídos não são uma estimativa de cobertura de nuvens.**

Proveniência registra CRS/resolução/unidade, bandas, modelo, parâmetros, hashes e origem da data. O fingerprint deriva de conteúdo e configuração, sem UUID ou horário da execução. Data informada pelo usuário não vira aquisição certificada. Hectares são calculados de forma geodésica em WGS84.

O chat diferencia NDVI médio do polígono e mediana da cena, valida números por campo/ID e só aceita percentuais rotulados de pixels. Esses percentuais nunca autorizam precisão, probabilidade ou confiança do classificador. Resultados antigos não recebem qualidade ou médias inventadas.

## Evidência do processamento

- Reorganização: 50 testes passaram; julho/agosto/outubro mantiveram resultados completos (exceto timestamp) e hashes dos artefatos.
- Extensões: 62 testes Python passaram. Nas três cenas e no teste sintético de um milhão de pixels, números legados, geometrias e os quatro arquivos binários originais permaneceram iguais. GeoJSON acrescenta a média NDVI.
- Memória em processos Windows separados, com um milhão de pixels: baseline 408,82 MiB; extras 410,11 MiB (+1,29 MiB). Tempos 10,434 s e 11,114 s nessa ordem de execução; outras amostras variaram com cache/concorrência. Isso não comprova RAM ou cold start no Render Linux e não demonstra ganho de velocidade.
- Testes TypeScript cobrem manifesto allowlisted, compatibilidade, qualidade reconciliada, proveniência, limpeza e grounding por polígono. Verificação final local: build e TypeScript passaram; 37 testes unitários web e 10 cenários PostgreSQL em banco descartável passaram. O navegador verificou shell/perfil/teclado, controles/menus/datas/enquadramento, desktop de 1440/1920 px, tablet, celular de 320/390 px e conversa em viewport curto. Upload + SCL e exemplo atravessaram Next, Storage e Python com callback e downloads, incluindo isolamento entre duas identidades. O teste separado de inspeção usa artefatos reais pré-calculados: não representa outro job HTTP. Gemini respondeu nove perguntas reais e dois turnos no navegador como `ai_grounded`; uma solicitação adversarial de precisão inventada foi bloqueada pelo guard. Login OAuth no provedor e deploy público não foram automatizados.

## Atualizar o ambiente publicado

1. Publicar o worker primeiro; `/health` deve incluir `output_schema_versions: [1,2]`.
2. Publicar o Next depois. O preflight passa a exigir essa capacidade do worker.
3. Verificar upload + SCL, imagem adicional, novas visualizações, seleção/lista, chat generativo, downloads, sessão/ownership e celular. Confirmar repositório público e cron.
4. Conferir memória/cold start reais, cotas e retenção. Não resetar cotas para mascarar falhas.

Não houve deploy, push, alteração de segredos, modelos ou dados de usuários nesta implementação. As referências externas continuam somente como orientação visual.
