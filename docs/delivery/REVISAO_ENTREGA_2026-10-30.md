# Revisão para entrega — 30/10/2026

Enunciado: `data/sample/DESAFIO.txt`. Esta etapa revisou criação, envio, processamento, erros, conta, segurança, downloads e conversa, além da composição do mapa. O usuário autorizou commit; não foi feito push, mudança de visibilidade ou deploy.

## Problemas corrigidos

| Problema reproduzido | Correção |
|---|---|
| Chat sem contexto anterior | Até seis turnos, validados no backend como contexto não confiável. Fatos continuam vindo do processamento após ownership |
| Respostas corretas rejeitadas por formatos de ID, data e “MapBiomas de 30 metros” | Formatos e arredondamentos reconhecidos; IDs, datas, medidas e resoluções inventados continuam bloqueados |
| Todo fallback dizia “IA indisponível” | Motivos separados para cota, demora, configuração, resposta incompleta e texto não validado |
| Resumo longo e repetitivo em cada pergunta | Respostas focadas, método verificado e ajuda contextual quando pertinentes |
| Negação em outra oração liberava afirmação de café confirmado | Triagem separa orações, sem alegar prova de toda a semântica de texto livre |
| Contingência confundia “candidata” com “data” | Reconhecimento da palavra inteira |
| Rede pendente bloqueava Nova análise indefinidamente | Preparação/início até 60 s, upload até 120 s por arquivo; erro libera controles sem afirmar cancelamento de job aceito |
| Erro terminal oferecia retry inútil | Nova análise e Voltar às análises; retry mantido para indisponibilidade temporária |
| Teste disputava fechamento automático no breakpoint | Aguarda o estado móvel final |
| Tooltip sobrepunha uma opção do menu no celular | Tooltip fica fechado enquanto Camadas/Baixar estão abertos; regressão cobre mouse, foco e viewport estreito |

Só HTTP 500/502/503/504 permite uma repetição, dentro do mesmo orçamento de até 35 s. Rejeições numéricas/semânticas não são repetidas automaticamente para contornar a validação. Contingência continua separada de geração por IA.

## Pedidos de UI conferidos

- Global Watch sem faux logo/Coffee; sidebar consistente e animada, conta compacta quadrada, auto-recolhimento na análise e preferência da coleção preservada.
- Coleção sem container central limitador; gutters alinhados, contagem abaixo da tabela e status coloridos no menu e no valor selecionado.
- Legenda Plantações de Café no alto à esquerda com hectares permanentes. Ferramentas verticais no alto à direita, mesmo componente do zoom/enquadrar; Mostrar resultados separado acima.
- Camadas e Baixar abrem para a esquerda, inclusive em 320 px, contidos no viewport.
- Aquisição real no grupo Resultado em Camadas. MapTiler é identificado como mosaico sem data exata; Ruas é cartografia, sem aquisição de satélite. Não foi inventada data de fundo.
- Informações e Assistente no mesmo painel de altura completa, abertura de 200 ms e movimento reduzido respeitado; centro e zoom preservados.
- Classificação na conversa, estados vazios/erro/processamento, foco, teclado, perfil persistido e logout.

O Satellite reúne fontes distintas, conforme a [documentação MapTiler](https://docs.maptiler.com/schema-raster/satellite/). Um futuro catálogo Sentinel deve fornecer aquisição, produto e qualidade reais; não foi criado calendário ou informação de nuvens sem catálogo.

## Verificação local

| Check | Resultado |
|---|---|
| Web | 26 testes unitários passaram; SQL opt-in skipped nesse comando |
| PostgreSQL separado | 10 cenários de integração passaram em `global_watch_audit_test`, sem usar o banco do app |
| Python | 50 testes passaram, incluindo recomputação para pixels alterados e segurança do worker |
| Build | Prisma generate, Next de produção e TypeScript passaram |
| Preflight | Zero bloqueios automáticos; health, migrations, RLS, constraints e bucket privado conferidos |
| UI | `platform.spec.ts` passou em 320/390/768/1440/1920 px; 80 tiles HTTP 200 |
| Fluxo completo | Dois testes de `workbench.spec.ts` passaram: exemplo e upload GeoTIFF + SCL, Python/callback, arquivos, chat, 404 de outra identidade e logout |
| Gemini real | Sete perguntas de uso real `ai_grounded`, pedido de precisão inventada recusado e dois turnos no navegador com histórico conferido |

As tentativas anteriores identificaram falsos negativos do chat e uma corrida do teste no breakpoint. A execução final passou. Foram consumidos quatro processamentos nesta revisão, sem reset de cotas. Fixtures próprios de banco/Storage foram removidos; ambientes, `.venv` e serviços existentes foram preservados.

A varredura limitada de texto rastreado encontrou apenas placeholders de chave em `.env.example` e CI. Ambientes reais não aparecem no histórico dos caminhos inspecionados; isso não garante todo objeto Git ou imagem. Referências visuais externas não foram adicionadas. Python ainda emite avisos de bibliotecas e do modelo v1 histórico; o worker usa v2.

## Pendências públicas

GitHub consultado nesta revisão: **privado**. Não há URL pública confirmada na configuração/README inspecionados. Consentimento Google real no domínio final, cron público, cold start Linux e Gemini nesse domínio ainda exigem prova no destino. Há roteiro do vídeo de até três minutos; não há evidência de vídeo entregue. Nota de pesquisa Markdown/PDF e relato de uso de IA existem; presença dos arquivos essenciais conferida.

Uma tentativa de abrir preview temporário de produção na porta 3001 foi rejeitada pela revisão automática com “blocked by policy”. Não foi iniciada uma instância por esse procedimento; o build passou, mas os testes funcionais desta revisão usaram o servidor local existente. Checks locais e commit não significam entrega pública completa nem perfeição. O [checklist](CHECKLIST_ENTREGA.md) mantém esses gates explícitos. Detalhes da conversa: [GEMINI_VALIDACAO.md](GEMINI_VALIDACAO.md).
