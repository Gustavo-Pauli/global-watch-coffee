# Experimentação interna

A área `/experiments` reúne estudos importados, imagens datadas, candidatos a
mudança, referências científicas e revisões individuais. O processamento pesado
continua nos scripts de pesquisa; os controles do mapa filtram resultados já
calculados. Esta área não inicia treinamento nem consulta novas cenas sozinha.

## Acesso

O usuário entra com o mesmo Google usado na plataforma. Em `.env.local`, defina
`EXPERIMENT_USER_EMAILS` com e-mails separados por vírgula. O servidor exige uma
sessão válida e e-mail verificado. Uma lista vazia não concede acesso a ninguém.
`EXPERIMENT_USER_IDS` permite concessões por identificador exato; não existe
liberação automática por estar em desenvolvimento. Reinicie o servidor depois de
alterar a configuração.

Imagens e APIs também verificam o acesso. Ocultar o item da navegação não é a
barreira de autorização. Para hospedar em outro ambiente, configure a lista lá;
a configuração local não é enviada pelo Git.

## Dados e revisões

O exportador de [pesquisa](../../../../research/land_change/README.md) gera um
pacote em `apps/web/.lab-data/bundles/<id>/study.json`, acompanhado de imagens
compactas. `EXPERIMENT_DATA_DIR` pode apontar para outro diretório privado. Esses
arquivos ficam fora de `public` e do Git. Um ambiente sem pacotes mostra o catálogo
vazio. Novos estudos podem ser importados no mesmo formato.

O build não copia esses dados privados para o artefato da aplicação. Na
hospedagem, provisione o diretório separadamente e configure seu caminho.

Execute `pnpm db:generate` e `pnpm db:deploy` para preparar a tabela de revisões no
banco configurado. A migração é aditiva. Cada interpretação pertence ao usuário e
à versão exata do estudo; salvar em duas abas detecta conflitos. Não se mostram
as respostas de outros revisores na tela de anotação.

O download de referências inclui apenas as classes do próprio revisor com alta
certeza, suporte utilizável e declaração explícita de revisão sem previsões.
Outras classes são exportadas como nulas. Essa declaração é registrada, não
verificada de forma independente. Uma interpretação humana ou de IA não se
transforma automaticamente em referência de campo.

## Verificação local

Os testes comuns cobrem autorização, validação e leitura dos pacotes. O teste de
navegador `tests/browser/experiments.spec.ts` usa banco local e sessões descartáveis
reais. Para executá-lo, conceda temporariamente os IDs `experiment-qa-local` e
`experiment-qa-peer` em `EXPERIMENT_USER_IDS`, importe o estudo e rode, em
`apps/web`:

```powershell
$env:RUN_EXPERIMENT_BROWSER='1'
pnpm.cmd test:browser tests/browser/experiments.spec.ts
```

O teste se recusa a substituir usuários existentes e remove somente suas próprias
identidades, sessões e revisões. As concessões de teste são configuração local;
não precisam existir em um ambiente publicado.
