# Repositório e publicação manual

Repositório local: Global Watch Coffee. A auditoria prepara commits locais quando possível; **não executa push, deploy nem alteração de visibilidade**. A visibilidade atual no GitHub não foi consultada nesta execução.

Antes de qualquer publicação autorizada, revise `git diff`, `git diff --check`, arquivos staged e histórico. Exclua `.env`, `.env.local`, `.venv`, node_modules, logs, cookies e tokens. Referências visuais externas são apenas orientação: não comitar screenshots, marcas ou assets de terceiros. Capturas em `docs/delivery/screenshots` devem mostrar apenas o próprio aplicativo e dados de teste.

Execute os gates do [README](../../README.md), verifique a [auditoria](AUDITORIA_FINAL.md) e revise licenças/atribuições do kit e MapBiomas. A exigência de repositório público do desafio continua uma ação humana pendente até confirmação explícita; não torna autorizada a exposição automática de dados ou chaves.

A CI usa lockfile congelado, gera Prisma Client, valida schema, aplica migrations em PostgreSQL de teste e executa verificações. Passar CI não prova Google OAuth, Gemini, cold start ou funcionamento de uma URL pública.
