# Checklist de entrega — Global Watch (prazo 30/10/2026)

| Requisito | Estado em 29/10/2026 | Evidência |
|---|---|---|
| React + Python | **Código implementado** | Next.js em `apps/web/`, geoprocessamento `apps/geo-worker/src/geo_worker/worker.py` + `coffee_v2.py` |
| Login Google, logout, validação no backend | **Código implementado; OAuth real pendente** | Better Auth, `/api/auth/[...all]`, `sessionUserId()`; configurar OAuth |
| Upload real e índice espectral | **Python validado; integração Next não testada no navegador** | `apps/geo-worker/tests/test_worker.py`, scripts e TIFF real |
| Polígonos candidatos e hectares | **Testes Python passaram** | `candidatos.geojson`, `resultado.json`, geodesia |
| Mapa, data, legenda e downloads | **Código migrado; build visual pendente** | `SatelliteMap.tsx`, `Dashboard.tsx` |
| Chat de IA ancorado em fatos | **Código pronto; Gemini real pendente** | `/api/analyses/[id]/chat`; sem chave há fallback explícito |
| Responsive e estados | **CSS/React migrado; navegador pendente** | `globals.css`, Dashboard |
| Isolamento, validação, limites, segredo | **Worker testado; Next não testado end-to-end** | sessões Better Auth server-side, user.id, worker token, rate limit PG e Origin |
| Segunda cena real | **Cumprida no Python** | julho; outubro adicional |
| Nota <=2 páginas | **Pronta** | `docs/research/NOTA_PESQUISA_FINAL.pdf` |
| README, fontes, licenças e IA | **Atualizados** | README, nota, proveniência |
| Deploy grátis | **PENDENTE** | Vercel + Render + PostgreSQL e testes públicos |
| Repositório GitHub público | **PENDENTE** | monorepo preparado; criar repositório novo e enviar via git, sem segredos e conferir arquivos |
| Vídeo <= 3 minutos | **PENDENTE** | roteiro disponível; filmar aplicação publicada |

**Atenção:** o desafio pede app público funcionando sem fornecimento de credenciais pelo avaliador. A migração do código, isoladamente, não conclui a entrega.
