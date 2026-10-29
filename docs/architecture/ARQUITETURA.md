# Arquitetura escolhida para o desafio Global Watch

**Objetivo do enunciado:** aplicação React + Python, OAuth Google, processamento REAL de GeoTIFF enviado, polígonos GeoJSON/ha, mapa, chat com IA, privacidade, limites e serviços gratuitos. Nenhuma parte deste documento é comprovação de deploy.

```text
Browser React/Next.js (Google via Better Auth)
       | API Next.js (validar sessão + limites)
       | 1) cria tarefa no PostgreSQL; URL assinada upload
       v
Supabase Storage PRIVADO  <-- arquivo TIFF do navegador (não passa pela Vercel)
       | 2) Next emite URLs assinadas, inicia tarefa com WORKER_SECRET
       v
Render Free: FastAPI /internal/process
       | 3) baixa TIFF, verifica TIFF/CRS/bandas/SCL, calcula índices e RF
       | 4) sobe GeoJSON, PNG, TIFF, resultado JSON ao Storage privado
       | 5) callback autenticado /api/internal/worker-complete
       v
Next.js (lê outputs, grava resumo PostgreSQL, expõe URLs temporárias)
       | Leaflet / download / chat Gemini com números realmente calculados
       v
Browser do usuário autenticado
```

## Responsabilidades

| Camada | Tecnologia | Estado armazenado |
|---|---|---|
| `apps/web` | Next.js 16 + Better Auth + pg | sessões, análises/status e rate limits no PostgreSQL |
| Storage | Supabase Free, bucket **privado** | TIFFs de entrada e arquivos realmente produzidos |
| `apps/geo-worker` | FastAPI + Rasterio + RF scikit-learn | **nenhum estado permanente**; diretório temporário por tarefa |
| Chat | Gemini no servidor Next.js | usa apenas resultados da análise do proprietário |

O worker recebe **apenas URLs assinadas, IDs de tarefa e segredo servidor-servidor**; não recebe OAuth, ID arbitrário de usuário, credenciais de banco ou chave service-role. Todos os endpoints do usuário verificam a sessão Better Auth e consultam a análise com `WHERE owner_id=$user`. O worker não pode consultar análises de outros usuários.

## Por que assíncrono?

Render Free pode levar cerca de um minuto para despertar. Uma função Vercel não deve manter aberta a resposta até o final de todo o geoprocessamento. Next inicia a tarefa, retorna HTTP 202, a UI consulta `GET /api/analyses/[id]` até concluir. O callback interno só é aceito com `X-Worker-Token` correto; o Next só marca `ready` depois de verificar e ler os artefatos Python do Storage.

É um protótipo de curta duração; execução em background na memória do único processo Render **não é uma fila durável**. Se Render reiniciar durante a tarefa, ela pode ser interrompida e será marcada como erro após 12 minutos. Não alegamos garantia de processamento nesse cenário.

## Cotas do protótipo

- Upload direto ao Storage: **12 MiB** TIFF de 4 bandas + **4 MiB** SCL, no máximo 1 milhão de pixels e 4 bandas.
- 5 análises por usuário a cada hora; **10 análises no total por dia** entre todos os usuários. Rate limit persistente e atômico no PostgreSQL.
- Dados retidos por **3 dias**. Cron diário autenticado remove objetos e linhas vencidos (deve ser configurado no deploy).
- Supabase Free pode pausar projeto inativo; Render Free suspende web service em 15 min de inatividade e perde disco local. Os resultados não dependem do disco local do Render após conclusão.
- Requisição de upload não passa pela Function Vercel, evitando seu limite de 4,5 MB. Downloads também usam redirecionamento temporário para Storage.

## Limitações explícitas

- Não há verdade de campo para confirmar café; MapBiomas foi usado como rótulo fraco. Modelo de classificação exploratória.
- O worker gratuito pode não suportar muitos pixels simultâneos; mede-se memória/tempo no deploy, usando um job por vez.
- Se a função de callback falhar repetidamente, o estado poderá expirar, mesmo que os artefatos existam.
- Limite global diário deliberado para evitar cobrança e consumo de 1 GB do Storage Free; sem SLA.
- Apenas dados Sentinel-2 compatíveis com as bandas e escalas exigidas são suportados, não qualquer GeoTIFF genérico.

Referências: [desafio original](../../data/sample/DESAFIO.txt), [Render Free](https://render.com/docs/free), [Vercel 4,5 MB](https://vercel.com/docs/errors/function_payload_too_large), [Supabase Storage Free](https://supabase.com/docs/guides/storage/uploads/file-limits).
