# Checklist de entrega — Global Watch (prazo 30/10/2026)

| Requisito do enunciado | Estado verificado | O que falta |
|---|---|---|
| React + Python | Next.js/React + FastAPI + classificação real no repositório | Build web/integração pública |
| Login Google e logout, backend validando sessão | Better Auth e `sessionUserId()` implementados | OAuth Google real em produção |
| Upload multiespectral e índice espectral | Worker testado com TIFF original; upload direto assinado implementado | Upload real ao Supabase pelo navegador |
| Polígonos candidatos, hectares, justificativa | Python e testes do classificador | Conferir dados na UI pública |
| Mapa, imagem, legenda, data e downloads | React/Leaflet e URLs privadas de download implementadas | Conferência desktop/celular e links reais |
| Chatbot **com IA** fundamentada nos resultados | Gemini conectado no código com verificação de números | Chave/cota e teste de `ai_grounded`; fallback não conta como IA |
| UI responsiva, loading, erros, vazio | Interface e polling assíncrono implementados | Revisão no navegador |
| Backend seguro e limites | Owner no PostgreSQL, segredo interno e URL Storage assinada; tests do worker | Testes de duas contas OAuth e cota via URL pública |
| Imagem adicional real | Julho e outubro presentes; análises Python reexecutam imagens | Demonstrar pelo site |
| Nota pesquisa até 2 páginas | PDF pronto em `docs/research` | Anexar/linkar junto da entrega |
| README e relato de IA | Reorganizados, com ressalvas de validação | Conferir links após GitHub público |
| Frontend/backend gratuitos | Configuração Vercel/Render/Supabase documentada | **Serviços NÃO publicados** |
| Repositório GitHub público | Monorepo preparado e .gitignore | **Criar e fazer push, revisar segredos** |
| Vídeo até 3 minutos | Roteiro pronto | **Gravar a aplicação publicada** |

**Validação até aqui:** testes Python reais e de servidor interno com HTTP assinado simulado; parsing TS/TSX. Não foi possível executar `pnpm install`, `next build`, Google OAuth, Supabase/Render/Vercel reais neste ambiente. Nenhum deles deve ser comunicado como concluído.
