# Validação da entrega

Registro das verificações locais realizadas em 30/10/2026. Esta limpeza documental não executou novos testes nem validações remotas.

## Evidências locais

| Camada | Evidência |
|---|---|
| Python | 62 testes passaram; nas três cenas, a reorganização preservou resultados legados, geometrias, hectares e arquivos binários originais. |
| Web | 37 testes unitários passaram; o teste PostgreSQL é opt-in. Build Next e TypeScript passaram na revisão funcional. |
| PostgreSQL | Dez cenários de integração em banco descartável: ownership, expiração, concorrência, cotas, callbacks, datas, constraints, RLS e Better Auth. |
| Fluxo completo | Upload + SCL e exemplo atravessaram Next, Storage, worker Python e callback; mapa, downloads, isolamento entre duas identidades e logout foram verificados localmente. |
| Interface | Navegador em desktop, tablet e celular, incluindo teclado, perfil, menus, datas, painel, enquadramento e viewport curto de conversa. |
| Inspeção | Artefatos reais pré-calculados usados para verificar RGB/falsa cor/NDVI, opacidade, lista, seleção e downloads privados, sem iniciar outro job. |
| Gemini | Nove perguntas reais e dois turnos no navegador retornaram `ai_grounded`. Uma solicitação adversarial de precisão inventada foi bloqueada. |

A correção de desseleção foi verificada no navegador: clicar no fundo remove popup, destaque e seleção na lista; zoom preserva a seleção. A tabela passou a usar link nativo expandido para a linha inteira, hover de ponta a ponta e padding interno. O usuário assumiu a validação das alterações finais; não se afirma que toda revisão posterior repetiu a suíte.

## Limites da comprovação

- Sessões descartáveis nos testes não comprovam consentimento Google real no domínio publicado.
- Build local não comprova deploy. A publicação e seus logs foram acompanhados pelo usuário; a validação pública final permanece no checklist.
- Windows não comprova RAM/cold start no Render Linux. Medição local e limites: [geoprocessamento](AUDITORIA_GEO.md) e [resultados/contrato](ARQUITETURA_E_INSPECAO.md).
- Gemini pode sofrer indisponibilidade ou cota. Contingência por regras é identificada e não substitui o requisito de IA.
- Não há validação independente em campo. MapBiomas é supervisão fraca; outubro participou do treino final.

## Reprodução

Comandos essenciais estão no [README](../../README.md). Procedimentos específicos: [Gemini](GEMINI_VALIDACAO.md), [retenção](RETENCAO_VALIDACAO.md), [preflight](PREFLIGHT.md) e [banco/migrations](PRISMA_MIGRATION.md). Todos os testes live são opt-in, usam fixtures próprios e podem consumir cotas. Nunca apontar testes para produção.

Os experimentos mantidos em `experiments/` sustentam a pesquisa e são usados por testes. Resultados prontos não substituem o processamento de uploads.
