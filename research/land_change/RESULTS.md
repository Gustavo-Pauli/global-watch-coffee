# Primeira rodada: aquisição e viabilidade

Estudo `amazon-land-change-20261102-v1`. A avaliação de precisão e a escolha da
identidade da plataforma continuam pendentes. Este documento registra medições
reais, sem transformar candidatos espectrais em desmatamento confirmado.

## Dados adquiridos

Foram baixados 32 recortes Sentinel-2 C1 L2A, dezesseis por região: quatro
observações de agosto-outubro de 2025 e doze de agosto-novembro de 2026.
Cada recorte possui seis bandas em reflectância física e SCL alinhada, com
fontes, datas, conversão radiométrica e SHA-256 no manifesto local.

A seleção foi congelada por disponibilidade e qualidade regional antes de
executar os modelos. Não foram usados resultados de detecção para escolher cenas.

## Linha A: detecção executada

| Piloto | Candidatos espectrais | Área candidata | Inteiramente novos na série recente |
|---|---:|---:|---:|
| Novo Progresso/PA | 59 | 109,5142 ha | 18 candidatos / 18,5406 ha |
| Belterra/PA | 287 | 649,8028 ha | 74 candidatos / 103,3443 ha |

Os demais candidatos já estavam alterados na primeira observação útil ou misturam
intervalos de mudança distintos. Todas as 346 geometrias exportadas são válidas.
A máscara inicial significa vegetação densa compatível com os índices; não
comprova floresta nativa. Há candidatos que posteriormente voltaram a apresentar
índices não anômalos. Ainda não foram medidos precisão, omissão ou atraso real.

Foram renderizados 24 casos qualitativos, selecionados com semente fixa e
estratificados pelo tipo de intervalo temporal. Eles incluem RGB, falsa cor,
datas individuais, limites candidatos e evidência encoberta explicitamente
desconhecida. São casos selecionados pelo detector, não amostras de validação.

## Linha B: preparação e execução do encoder

As 300 amostras foram selecionadas sem previsões; seus centros foram alinhados
à mesma grade nativa de características antes de qualquer anotação. Na revisão
alinhada, 290 suportes são utilizáveis e dez têm cobertura clara insuficiente,
igualmente para os atributos espectrais e o TerraMind.

Nenhuma referência foi rotulada. O Random Forest não foi treinado porque faltam
exemplos revisados de floresta, pastagem, cultivo, solo exposto e água. Não há
acurácia medida nem evidência de superioridade ao MapBiomas.

O TerraMind Tiny foi executado na RTX 2060 SUPER de 8 GB, em ambiente isolado:

| Execução | Janelas | Patches utilizáveis | Tempo GPU do encoder | Pico alocado PyTorch |
|---|---:|---:|---:|---:|
| Novo Progresso, 01/11/2026, probe parcial | 4 | 731 | 0,327 s | 36,7 MiB |
| Novo Progresso, 07/10/2026, recorte completo | 100 | 18.274 | 0,716 s | 36,7 MiB |
| Belterra, 07/10/2026, recorte completo | 100 | 18.429 | 0,633 s | 61,2 MiB |

Esses tempos excluem importação, carregamento, leitura, hashes e exportação.
A memória exclui driver/contexto CUDA e treinamento. São características de
192 canais com espaçamento de 160 m, não classificações ou segmentação a 10 m.
Os pesos oficiais foram verificados por SHA-256; o ambiente passou em `pip check`.

Blocos de amostragem distintos não garantem independência estatística: os tokens
do encoder compartilham o contexto de janelas de 2,24 km. A transferência entre
as duas regiões será uma separação mais forte que os subconjuntos locais.

## Comparadores e decisão

- As URLs tentadas do MapBiomas 2025 retornaram HTTP 403.
- DIST-ALERT forneceu metadados recentes, mas os rasters retornaram HTTP 401.
- A API do MapBiomas Alerta documenta autenticação; a consulta anônima falhou.

Isso registra acesso não obtido nesta execução, sem concluir que os produtos
sejam pagos ou indisponíveis por outros meios legítimos.

O gasto com serviços externos foi R$ 0. Não foram alterados banco, APIs,
dependências da aplicação, `develop` ou `main`.

O resultado atual confirma viabilidade de aquisição e inferência em uma área
limitada. A comparação decisiva ainda exige referências revisadas e comparadores
compatíveis em data, legenda e suporte espacial. As fichas e o formulário local
de anotação tornam essa próxima etapa concreta e auditável.

Artefatos grandes são locais e ignorados pelo Git, em
`experiments/outputs/land-change/`; o relatório visual é `report.html`.
Comandos e limites de reprodução estão no README desta pasta.

Contains modified Copernicus Sentinel data (2025, 2026). TerraMind: Apache-2.0;
demais dados e dependências preservam seus termos de origem.
