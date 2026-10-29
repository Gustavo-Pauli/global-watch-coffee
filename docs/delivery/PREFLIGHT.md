# Preflight de publicação, somente leitura

`apps/web/scripts/release-preflight.ts` inspeciona a configuração e os serviços existentes sem executar migrations, criar/deletar dados, alterar permissões, provisionar contas, fazer deploy ou chamar Gemini. Não imprime URLs, nomes de role, IDs do cliente Google ou valores de credenciais. Erros de serviços são convertidos em categorias fixas; respostas de provedores não são copiadas para o relatório.

## Executar

Na raiz do monorepo, após `pnpm install --frozen-lockfile`:

```powershell
pnpm --filter @global-watch/web exec node --import tsx scripts/release-preflight.ts --mode=local
```

O modo local carrega `apps/web/.env.local` sem sobrescrever variáveis já exportadas. Também lê `apps/geo-worker/.env` para comparar o segredo compartilhado, URL do Storage, callback e ausência de chaves administrativas/conexão PostgreSQL no worker. Nenhum arquivo de ambiente é escrito.

Se os servidores locais estiverem desligados, é possível validar apenas configuração, banco e Storage:

```powershell
pnpm --filter @global-watch/web exec node --import tsx scripts/release-preflight.ts --mode=local --skip-health
```

Para um ambiente de produção **já configurado**, forneça as variáveis pelo terminal/gerenciador seguro de segredos ou selecione um arquivo externo explicitamente:

```powershell
pnpm --filter @global-watch/web exec node --import tsx scripts/release-preflight.ts --mode=production
# Opcional: caminho de arquivo local privado, não conteúdo ou chave na linha de comando.
pnpm --filter @global-watch/web exec node --import tsx scripts/release-preflight.ts --mode=production --env-file=C:/CAMINHO/PRIVADO/production.env
```

O modo produção **não carrega `.env.local` implicitamente**. Recusa endpoints HTTP, localhost/endereço privado e banco local nas verificações de formato. O hostname é uma verificação sintática, não uma auditoria de DNS ou prova de que o ambiente está publicado. `DIRECT_URL`, quando fornecida, tem o formato validado; a inspeção de catálogo usa a conexão **de runtime `DATABASE_URL`**. O operador continua responsável por conferir que conexão direta/pooler de sessão e pooler de runtime pertencem ao mesmo banco antes de migrar.

## O que é verificado

- Presença de variáveis obrigatórias, incluindo `GEMINI_API_KEY`; comprimento mínimo e exemplos óbvios de placeholders para segredos compartilhados.
- Forma de origem das URLs e do client ID Google. Nenhuma API do Google Console é chamada: o registro do callback ainda exige conferência humana.
- Versão mínima de Node compatível com a ferramenta instalada, sem provisionar outro runtime.
- Conexão PostgreSQL e presença das seis tabelas privadas.
- Role de runtime com CRUD e condição de proprietário/BYPASSRLS, inclusive efeito de `FORCE ROW LEVEL SECURITY` no proprietário comum.
- RLS habilitado nas seis tabelas, nenhum grant de `PUBLIC`, nenhum acesso herdado/expresso de `anon`/`authenticated` e nenhuma política pública instalada.
- Presença validada dos dois CHECKs, duas FKs e oito índices nomeados da aplicação. Isso não substitui um diff completo do schema.
- Migrations esperadas, conclusão sem falhas pendentes e checksums dos arquivos SQL. Checkouts LF/CRLF são aceitos, alterações de SQL não.
- Bucket existente, privado e com teto de exatamente 12 MiB para comportar o máximo admitido pelo app sem liberar objetos maiores.
- Health público do Next e worker, com timeout de 10 segundos, sem seguir redirects e com body de resposta limitado. O worker precisa informar modelo disponível.

As consultas de catálogo e de `_prisma_migrations` são SQL de diagnóstico, fora do runtime das rotas. Não leem linhas de usuário, sessões, contas OAuth ou análises. O cliente Storage usa somente `getBucket`; nenhum objeto é listado, baixado, criado ou apagado.

## Interpretar o JSON e exit code

| Campo / código | Significado |
|---|---|
| `checks[].status=pass` | A condição específica foi verificada |
| `fail` | Bloqueio verificado ou serviço inacessível; consultar o código sanitizado |
| `warn` | Conferência humana necessária; não é um sucesso implícito |
| `skip` | A verificação não foi executada; por exemplo, Gemini real nunca é chamado por este script |
| `preflightPassed=true` | Nenhuma verificação executada falhou, sujeito aos warnings/skips |
| `readyForRelease=false` | Sempre falso: este comando isolado nunca certifica entrega/produção |
| Exit `0` | Nenhuma falha automática, mas ainda há gates humanos |
| Exit `1` | Uma ou mais falhas automáticas, incluindo ausência de chave Gemini |
| Exit `2` | Argumentos inválidos, arquivo selecionado indisponível ou falha interna sanitizada |

Com a configuração local inspecionada em 29/10/2026, banco/RLS/role/migrations/constraints/Storage e consistência do worker passaram. As primeiras execuções retornaram exit 1 por chave Gemini ausente. Depois de o usuário configurar a chave, o comando retornou **exit 0, zero bloqueios automáticos**, com health do Next e worker confirmados. `readyForRelease=false` permanece intencional. A geração real foi validada separadamente em [GEMINI_VALIDACAO.md](GEMINI_VALIDACAO.md). Na raiz, o atalho é `pnpm release:check --mode=local`.

O relatório não confirma Google OAuth real, resposta generativa fundamentada, cotas/faturamento dos provedores, políticas remotas efetivas da Data API, callback de processamento, cold start/restart, memória Render, passagem de três dias/cron, URL pública, vídeo ou visibilidade GitHub. Use o procedimento em [DEPLOY.md](DEPLOY.md), a [migração segura](PRISMA_MIGRATION.md) e a [auditoria](AUDITORIA_FINAL.md).

## Testes

`tests/preflight.test.ts` cobre origens locais/privadas disfarçadas, credenciais em URL, endpoints com path/query, não exposição de credenciais em relatórios de configuração e checksums com finais de linha diferentes/SQL adulterado. Faz parte de `pnpm test:web`. O typecheck também inclui o script.

Não salvar o JSON em arquivos públicos automaticamente. Embora o formato evite valores de segredos, o resultado operacional ainda deve ser revisado antes de ser compartilhado.
