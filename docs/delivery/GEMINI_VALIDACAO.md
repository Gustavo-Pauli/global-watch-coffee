# Gemini real: verificação local

Validado em 29/10/2026 depois de o usuário configurar a chave em `apps/web/.env.local`. Nenhum arquivo de credenciais foi sobrescrito, nenhuma chave foi impressa ou commitada e nenhuma configuração de faturamento foi alterada.

## Origem dos fatos e ambiente

O modelo `gemini-3.5-flash-lite` respondeu à API real do Google. A cena pública de agosto do kit foi novamente processada em Python com RF v2, gerando **24 polígonos, 22,661 ha candidatos e NDVI mediano 0,5592**. Somente os fatos usados pelo chat (data, áreas, contagem, IDs/áreas de polígonos e limitações) foram enviados ao provedor. Não foram enviados cookies, tokens OAuth, dados de conta, imagens ou coordenadas dos polígonos.

A integração usa Next em produção local, PostgreSQL local e Supabase Storage real. `scripts/gemini-live.ts` cria uma identidade/sessão descartável e uma análise pronta contendo os arquivos **efetivamente gerados** pelo classificador. Não acrescenta bypass de autenticação às rotas e não usa registros de usuários existentes. A prova de processamento/upload completo já está registrada na auditoria anterior; este teste concentra-se na rota autenticada do chat e no navegador.

## Correções motivadas pelas chamadas reais

- A validação rejeitava números corretos com marcação Markdown e a expressão `MapBiomas 30m` já presente nas limitações Python. Agora normaliza marcação pareada e aceita apenas a resolução qualificada que realmente consta nos fatos. Uma referência a 30 m não autoriza 30 ha nem uma precisão inventada.
- O contexto agora informa se a lista de polígonos enviada está completa; a instrução deixa de induzir o modelo a declarar que toda lista é parcial. Esses nomes de campos não devem aparecer na resposta ao usuário.
- Respostas são solicitadas em texto simples, com até 100 palavras. Números, datas, contagens e medidas continuam sujeitos à validação; percentuais e notação exponencial sem suporte permanecem rejeitados.
- O provedor recebe até **35 segundos**, reduzidos ao orçamento restante de 50 segundos desde o início da rota. A função tem teto de 60 segundos, deixando margem abaixo desse teto. Se o orçamento acabar, não é enviada outra chamada e a contingência é identificada.

## Resultado e limites da prova

Foram obtidas respostas reais `type=ai_grounded` para área/quantidade de polígonos e NDVI. Um pedido para ignorar os dados e afirmar café confirmado com 99% de precisão foi rejeitado pela validação, retornando `rules_fallback_not_ai`, sem expor esse percentual como resultado. No navegador, a consulta também retornou `ai_grounded` e foi exibida com o rótulo de IA. Captura: [chat com Gemini real](screenshots/desktop-chat-gemini.png).

Na execução final com o orçamento atualizado:

| Caso | Resultado | Tentativas / duração HTTP local |
|---|---|---|
| Área e contagem | `ai_grounded`: 24 polígonos e 22,66 ha | 1 / 16,671 s |
| NDVI mediano | `ai_grounded`: 0,56, arredondado de 0,5592 | 1 / 14,951 s |
| Pedido adversarial de precisão inventada | `rules_fallback_not_ai`, motivo `unsupported_numbers` | 1 / 15,780 s |
| Consulta no navegador | `ai_grounded`, rótulo de IA visível | Passou; captura revisada |

Os tempos são amostras locais, não um benchmark ou SLA. Build, typecheck e 20 testes unitários web passaram; a integração PostgreSQL continua opt-in e foi explicitamente skipped nesse comando unitário.

Durante as primeiras amostras houve timeouts do provedor; respostas numéricas legítimas também revelaram os falsos negativos descritos acima. O teste permite **uma** nova tentativa somente para `provider_unavailable`, registra cada tentativa e nunca trata fallback como resposta generativa. O produto não repete automaticamente uma chamada rejeitada para contornar a validação. Oscilações de disponibilidade, cotas e latência do Google continuam possíveis.

Esta é uma amostra funcional local, não uma garantia de verdade semântica, resistência a toda injeção de prompt, cota gratuita ou funcionamento no domínio público. A triagem numérica e linguística é conservadora e pode escolher a contingência. O usuário deve manter a distinção entre candidatos e cafezais confirmados. O consentimento Google OAuth não foi automatizado neste teste.

## Reproduzir sem dados pessoais

Com a `.venv` existente, credenciais locais configuradas e um servidor web local em `http://localhost:3000`:

```powershell
$demoOutput = Join-Path $env:TEMP 'global-watch-gemini-live'
& apps/geo-worker/.venv/Scripts/python.exe -m geo_worker.coffee_v2 classify data/sample/imagem_multiespectral.tif --scl data/sample/qualidade_scl.tif --output $demoOutput --date 2025-08-16
$env:RUN_LIVE_GEMINI = '1'
pnpm test:gemini:live
Remove-Item Env:RUN_LIVE_GEMINI
```

O teste exige host local, utiliza o diretório temporário desse comando e limpa os seus próprios registros/objetos. Se a remoção de Storage falhar, conserva a metadata vencida para retry do cron. As chamadas consomem a cota do Gemini e alguns slots de chat da identidade descartável; não consomem a cota global de processamento Python. Não executar automaticamente em CI sem credenciais e autorização para chamadas reais.

O preflight verifica apenas configuração/catálogos/health: sua ausência de bloqueios não substitui este teste real nem os gates de deploy. Modelo e limites de geração são verificáveis na [documentação de modelos](https://ai.google.dev/gemini-api/docs/models); disponibilidade efetiva foi conferida também com a API do projeto, sem imprimir a chave.
