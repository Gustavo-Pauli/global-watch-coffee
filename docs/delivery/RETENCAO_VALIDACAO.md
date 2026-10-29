# Retenção e limpeza: verificação complementar

Continuação da auditoria em 29/10/2026. As alterações abaixo verificam a remoção de análises expiradas e protegem a possibilidade de tentar novamente depois de falhas. Não foi preciso esperar três dias de relógio nem remover dados do banco utilizado pelo app.

## Problemas encontrados e corrigidos

A rota original tratava a resposta `{error}` do Supabase, mas uma exceção de rede/SDK interrompia o cron inteiro com erro HTTP, antes de processar os registros seguintes. O orçamento de 45 segundos também era conferido apenas entre registros; uma chamada de Storage sem timeout podia consumir o limite da função.

A lógica foi extraída para `apps/web/lib/cleanup.ts`, mantendo a resposta `{cleaned, failed, remaining}`. A rota continua autenticada exclusivamente por `CRON_SECRET` e não aceita sessão de usuário como credencial de limpeza.

- Cada falha de Storage ou exclusão de metadata fica contida ao registro correspondente, incrementa `failed` e preserva o alvo para nova tentativa. Os registros seguintes continuam sendo processados enquanto houver orçamento.
- Os objetos de entrada e os seis artefatos são removidos **antes** de excluir a metadata da análise. A exclusão do banco mantém condição de expiração, permitindo remoção idempotente.
- A seleção e os contadores usam um cutoff de expiração fixado no início. Registros/limites que vencem durante a execução ficam para o próximo cron; não são removidos oportunisticamente no meio desta execução. `remaining` conta os vencidos naquele cutoff.
- O lote continua limitado a 200 registros, ordenados por expiração e ID para desempate estável. Ao atingir o lote, o backlog aparece em `remaining`.
- Antes de cada operação externa, o tempo restante é calculado. A chamada Supabase recebe um `AbortSignal` de **no máximo 10 segundos**, reduzido ao tempo restante do orçamento global de 45 segundos.
- Se um consumidor ignorar o sinal e retornar depois do orçamento, a metadata desse registro permanece para o próximo cron. A exclusão dos objetos pode já ter ocorrido; remover novamente um objeto ausente é compatível com o retry esperado.
- `storageAdmin(signal?)` aceita o sinal apenas quando solicitado; chamadas existentes sem sinal mantêm o comportamento anterior. Se o SDK já fornecer outro sinal, os sinais são combinados com `AbortSignal.any` em Node 22.

## Testes executados

```powershell
pnpm --filter @global-watch/web exec node --conditions=react-server --import tsx --test tests/cleanup.test.ts
pnpm --filter @global-watch/web typecheck
```

**9 testes focados passaram; TypeScript passou.**

1. Autorização exige Bearer exato e segredo configurado; cookie de sessão, segredo vazio, Basic e token divergente não autorizam.
2. Registro expirado tem entradas e seis artefatos removidos antes da metadata; registro ativo e o limite exato do cutoff permanecem.
3. Exceção de Storage preserva a metadata, permite limpar o registro seguinte e admite sucesso na próxima tentativa.
4. Falha ao excluir metadata depois de remover objetos deixa o registro para retry idempotente.
5. 201 registros expirados produzem 200 remoções e backlog `remaining=1`.
6. Budgets por chamada diminuem com o orçamento; overrun preserva registros não finalizados.
7. Consulta inicial que consome o orçamento impede iniciar remoções externas.
8. Expiração que ocorre durante a execução não muda o cutoff nem remove limites ativos no começo.
9. O cliente Supabase real recebe o sinal abortado através do fetch customizado; teste sem rede e sem impressão de credenciais.

Os testes de serviço usam repositório em memória e falhas injetadas. Eles verificam controle de fluxo, limites e consistência; **não comprovam permissões ou disponibilidade reais do Supabase**.

## Integração HTTP e Storage reais

Executada pelo auditor principal em 29/10/2026, contra Next production local em `localhost:3001`, banco separado `global_watch_retention_test` e bucket privado existente. O script `apps/web/scripts/retention-live.ts` exige opt-in, destino local exato e ausência de análises prévias nesse banco. Antes de autorizar o cron, ele cria uma identidade descartável e prova que o servidor vê seu registro no banco isolado; recusa continuar se o servidor estiver ligado a outro banco.

Resultado: **passou**. Chamada sem token retornou 401; chamada autorizada retornou `cleaned=1`, `failed=0`, `remaining=0`. Oito objetos de análise vencida foram removidos; oito objetos de análise ativa permaneceram, assim como sua metadata. Um rate limit vencido foi removido e um ativo permaneceu. Depois, o script removeu exclusivamente seus próprios fixtures: banco de teste terminou com zero usuários, sessões, análises e limites. No banco do app continuaram 1 usuário, 1 sessão, 1 conta OAuth e 1 análise.

Isso verifica a expiração por estado/data dos fixtures, **não a passagem de três dias nem o agendamento na Vercel**. Nenhum processamento Python foi disparado, nenhuma cota de análise foi consumida e nenhum dado de usuário foi usado nos fixtures.

Para reproduzir, crie um banco local vazio chamado `global_watch_retention_test` e aplique as migrations nele, com `DATABASE_URL` e `DIRECT_URL` apontando explicitamente para esse banco somente no terminal de teste. Rode o build web. Inicie um Next separado, com essas variáveis e `BETTER_AUTH_URL=http://localhost:3001`:

```powershell
pnpm --filter @global-watch/web exec next start --hostname 127.0.0.1 --port 3001
```

Em outro terminal, configure `TEST_DATABASE_URL` com a URL desse banco descartável (nunca o banco do app), mantendo as credenciais de Storage/cron locais no arquivo existente:

```powershell
$env:RUN_LIVE_RETENTION = '1'
$env:TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@localhost:5435/global_watch_retention_test'
pnpm test:retention:live
Remove-Item Env:RUN_LIVE_RETENTION, Env:TEST_DATABASE_URL
```

Não inicie análises de geoprocessamento nesse servidor de teste: ele existe somente para a verificação de retenção. Se a remoção final de fixtures falhar, a metadata é conservada vencida para que o cron possa tentar novamente, sem perder os caminhos dos objetos.

## Limites e operação

- O orçamento cobre a decisão de iniciar novas remoções e limita cada requisição de Storage. Não é uma garantia de tempo total de banco/rede: conexão/consulta Prisma e os contadores finais ainda podem consumir tempo. A Function tem `maxDuration=60`; uma interrupção pode deixar objetos já removidos e metadata pendente, situação tratada pelo retry.
- Falha na seleção inicial, na limpeza de rate limits ou no contador final continua sendo falha da execução; esses erros não são ocultados com uma resposta de sucesso fictícia.
- Uma execução concorrente pode encontrar um objeto ou registro que outra já removeu. O Storage tolera arquivo ausente e o delete condicional retorna contagem zero; não há dependência de exclusividade de cron.
- Backlog persistente de registros com erro exige monitorar `failed`/`remaining`, corrigir a causa e repetir a limpeza autenticada. O cron Hobby diário não oferece SLA nem limpeza física exatamente no instante de três dias.
- Não foi alterado o prazo de retenção do produto. Acesso expira após três dias; remoção física depende da execução posterior do cron. URLs assinadas já emitidas continuam válidas até a expiração delas.
- Nenhuma sessão, conta OAuth, análise ativa ou dado pessoal do banco usado pelo app foi removido por esta etapa. Nenhuma variável `.env` foi sobrescrita, e nenhum serviço foi publicado.
