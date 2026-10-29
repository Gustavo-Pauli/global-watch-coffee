# Interface cartográfica — Global Watch Coffee

## Direção e limites

A interface usa um espaço de trabalho cartográfico original: histórico compacto à esquerda, mapa no centro e ferramentas contextuais à direita. O painel contextual muda entre nova análise, resultado, consulta e explicação do método. O chat não ocupa uma coluna adicional permanente.

As referências fornecidas orientaram densidade, hierarquia, contexto cartográfico e estados de formulário. Não foram copiadas marcas, dados ou layouts literais. Nenhum screenshot externo foi adicionado ao repositório. Não há séries temporais, clima, alertas ou precisão inventados.

## Sistema visual

- Tipografia: Arial/Helvetica/system sans, disponível localmente, sem dependência de fonte externa. Texto operacional de 11–12 px no desktop, títulos contextuais de 20–25 px; controles e leitura principal maiores no mobile.
- Superfícies: carvão esverdeado `#131513`, `#1b1e1b`, divisórias `#33382f` e texto `#edf0e8`.
- Destaque único: oliva claro `#c4d58c`. Cor de erro discreta usada exclusivamente como sinal de estado.
- Ritmo: incrementos de 4 px, controles de aproximadamente 40 px, cantos de 4–5 px. Sem vidro, gradientes, glows ou hero de marketing.
- Dados: a área candidata é a medida principal. Polígonos, NDVI mediano e pixels válidos aparecem como linhas de dados; downloads são ações identificadas por tipo real.
- Estados: sem sessão, histórico vazio, preparação, envio direto, processamento, carregamento, resultado, falha, arquivo indisponível e fallback do chat.

## Fluxos

1. Sem sessão, o mapa de referência mostra a região de Guaxupé e o painel explica o acesso com Google. Esse mapa não representa uma análise nem contém polígonos simulados.
2. Nova análise permite escolher uma das três cenas reais ou enviar imagem com quatro bandas e máscara SCL opcional. A data de aquisição de upload é opcional e começa vazia.
3. Os arquivos são enviados diretamente ao Storage. O estado de envio é distinguido do processamento; não há porcentagem fictícia. O resultado é acompanhado via API existente.
4. O resultado mostra a imagem efetivamente produzida, polígonos interativos, controle de camadas, enquadramento, zoom, escala, atribuição cartográfica e legenda.
5. O histórico permite retomar resultados ou acompanhar processamento. Erros e uploads interrompidos têm mensagem explícita. Trocar de seleção cancela somente a espera no navegador.
6. As consultas ao chat ficam vinculadas à análise selecionada e são descartadas ao trocar a análise/conta. O fallback determinístico é identificado, sem apresentá-lo como IA.

## Responsividade e acessibilidade

Em telas intermediárias o histórico se torna um drawer. No mobile, mapa e painel são empilhados; o mapa conserva altura utilizável e o conteúdo é rolável. Não há mapa espremido entre três colunas no celular.

Controles têm nomes acessíveis, foco visível, grupos de formulário, labels de arquivos e radio buttons reais. Há link para pular ao painel. Resultados e chat usam abas identificadas e mensagens de erro usam `role=alert`. Motion respeita `prefers-reduced-motion`. O drawer prende o foco enquanto aberto, fecha com Escape e devolve o foco ao controle de origem. No mobile, o login aparece logo após a introdução, antes da explicação das três etapas.

O mapa base tem um aviso explícito de falha e ação de recarregar quando tiles externos não carregam. As camadas calculadas são independentes desse mapa base. A seleção de outra análise ou a troca de conta cancela a espera do navegador, sem alegar cancelar um trabalho já aceito pelo worker. Números ausentes/inválidos são exibidos como travessão, sem `NaN` ou métricas substitutas.

## Verificação

A revisão de screenshots e integrações deve ser registrada em `AUDITORIA_FINAL.md`, distinguindo screenshots de dados reais, fixtures de sessão de teste e validação humana de Google OAuth. O redesign conserva as rotas existentes; não usa uma simulação de análise para preencher os resultados.
