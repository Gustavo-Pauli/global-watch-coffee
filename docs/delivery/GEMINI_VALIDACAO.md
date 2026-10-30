# Chat Gemini: funcionamento e reprodução

O servidor envia ao provedor apenas fatos da análise do proprietário e histórico limitado. Área, contagem, data, maior polígono, NDVI da cena, médias por polígono e qualidade vêm do processamento. O guard valida números por campo e ID; percentuais de pixels não autorizam afirmações de precisão. Limitações e origem MapBiomas integram o contexto.

Na revisão local de 30/10/2026, nove perguntas reais e uma conversa de dois turnos no navegador retornaram `ai_grounded`. Foram abordados área/contagem, método, verificação em campo, priorização de vistoria, aquisição versus mosaico de fundo, exportação, NDVI mediano, NDVI do polígono e SCL/pixels elegíveis. Uma solicitação de precisão inventada foi rejeitada pelo guard. [Conversa do próprio aplicativo](screenshots/desktop-chat-gemini.png).

A contingência `rules_fallback_not_ai` distingue ausência de configuração, quota, timeout, indisponibilidade, resposta incompleta e conteúdo não validado. Ela não é apresentada como geração por IA. A prova local não garante a disponibilidade futura do provedor.

## Reproduzir

Com o servidor local aberto e `.env.local` configurado, prepare os artefatos da cena pública na pasta indicada por `GEMINI_FIXTURE_DIR`. Depois, na raiz:

```powershell
$env:RUN_LIVE_GEMINI = '1'
$env:GEMINI_FIXTURE_DIR = 'CAMINHO_DOS_ARTEFATOS_REAIS'
pnpm.cmd test:gemini:live
```

O script usa PostgreSQL e Storage locais/configurados com identidades e prefixos descartáveis, verifica histórico e respostas, e limpa seus objetos. Não inicia processamento Python, mas consome cota Gemini. Não usar em produção nem enviar chaves pelo chat. O consentimento Google não é automatizado por esse teste.
