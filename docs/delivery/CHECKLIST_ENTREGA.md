# Checklist de entrega — 30/10/2026

A matriz com evidências está em [AUDITORIA_FINAL.md](AUDITORIA_FINAL.md). O enunciado original está em `data/sample/DESAFIO.txt`.

- [ ] Rodar login Google/consentimento e logout no domínio público; confirmar sessão após refresh.
- [ ] Configurar chave/cota Gemini no ambiente público e repetir `ai_grounded`; a geração local já passou em API e navegador conforme GEMINI_VALIDACAO.md. Contingência por regras não cumpre o requisito de IA.
- [ ] Aplicar Prisma em produção com comparação/baseline segura e backup; nunca reset/db push.
- [ ] Confirmar bucket privado com teto de 12 MiB e segredos apenas nos servidores corretos.
- [ ] Publicar Vercel/Render/Supabase manualmente após autorização; validar cold start, RAM Linux e reinício durante análise.
- [ ] Testar demo agosto, imagem adicional, GeoTIFF + SCL e downloads pela URL pública.
- [ ] Testar duas contas Google reais e 404 para análise, arquivos e chat de outro usuário.
- [ ] Conferir cron diário, expiração de acesso, limpeza física e logs sem segredos.
- [ ] Revisar nota PDF de duas páginas, fontes primárias, licenças e atribuição dos dados.
- [ ] Gravar vídeo <=3 minutos da aplicação publicada mostrando imagem adicional e limitações.
- [ ] Revisar histórico Git/segredos/assets antes de eventual publicação autorizada; confirmar repositório público pelo usuário.

Verificações locais e screenshots do aplicativo não substituem esses gates públicos. Não foi executado push, deploy ou alteração de visibilidade nesta auditoria.
