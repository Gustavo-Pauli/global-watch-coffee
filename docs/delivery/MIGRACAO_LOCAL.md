# Migração local após o patch e Prisma

O patch já foi extraído pelo usuário. Preserve `.env`, `.env.local`, `.venv`, modelos e dados. Os arquivos antigos `requirements-api.txt`, `requirements-core.txt`, `requirements-dev.txt` foram substituídos por `pyproject.toml`.

1. Revise `git status` e faça backup das alterações que ainda não estiverem commitadas.
2. Atualize a **mesma** `.venv`: `apps/geo-worker/.venv/Scripts/python.exe -m pip install -e './apps/geo-worker[dev]'`.
3. Instale JavaScript na raiz: `pnpm install --frozen-lockfile`. O postinstall gera Prisma Client.
4. Confira as variáveis existentes usando os exemplos sem copiar arquivos por cima. Use `SUPABASE_SECRET_KEY` no Next; no worker apenas `SUPABASE_URL`, `WORKER_SECRET` e `NEXT_CALLBACK_URL`.
5. Confirme bucket privado `geo-private`, limite por objeto 12582912 bytes. PostgreSQL local pode continuar em uso junto ao Storage remoto.
6. Siga [PRISMA_MIGRATION.md](PRISMA_MIGRATION.md): **banco existente exige comparação e baseline**, não reaplicação do CREATE TABLE. Não usar db push/reset. O antigo `database.sql` não é mais a fonte de migrations.
7. Inicie worker pela `.venv` e Next conforme [README](../../README.md). O worker deve reportar `model_available=true`.
8. Execute testes, typecheck e build, depois valide interface/fluxo real. Resultados e limitações constam em [AUDITORIA_FINAL.md](AUDITORIA_FINAL.md).

Google usa a URI local exata `http://localhost:3000/api/auth/callback/google`. A chave Gemini é necessária para o chat generativo; ausência de chave é mostrada como contingência por regras. Não exponha segredos em screenshots/logs/commits.

O banco antigo SQLite e `.storage/` não são usados; o histórico efêmero anterior não é importado. Esta migração não publica site/repositório, não altera visibilidade GitHub e não executa push. Esses passos só podem ocorrer por ação ou autorização específica do usuário.
