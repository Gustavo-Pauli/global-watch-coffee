# Publicação do monorepo no GitHub

1. Crie um repositório **público e vazio**, por exemplo `global-watch-cafe`, na conta desejada. Não use outro repositório existente.
2. Rode `python scripts/check_repository.py`. Confirme que `git status` não inclui segredos.
3. Execute `powershell -ExecutionPolicy Bypass -File scripts/publish_github.ps1 -RepoUrl "https://github.com/SEU-USUARIO/global-watch-cafe.git"` no Windows, ou `bash scripts/publish_github.sh https://github.com/SEU-USUARIO/global-watch-cafe.git` no Linux/macOS. O script imprime os arquivos staged e só prossegue depois da confirmação `SIM`.
4. Verifique que o remote `origin` realmente corresponde ao repositório vazio criado.
5. No GitHub, confira se estão presentes `data/`, `apps/geo-worker/models/`, `apps/web/` e `docs/` e se **não** há `.env.local`.

Os binários de modelos e resultados fazem parte do primeiro commit, para que o exemplo seja reproduzível. Como há artefatos experimentais grandes, o repositório é maior que um projeto web comum; se futuramente crescer, mova datasets e modelos para releases ou Git LFS, mantendo checksums e scripts de obtenção.

O conector de GitHub disponível nesta conversa não permite a criação de repositórios; não há envio para uma URL pública nesta etapa.

**Antes da publicação:** execute `pnpm install` e versiona `pnpm-lock.yaml`. Neste ambiente o registry npm não resolveu, então não foi possível gerar esse arquivo automaticamente.
