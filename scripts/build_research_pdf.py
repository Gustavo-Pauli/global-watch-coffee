"""Gera a nota de pesquisa, com duas páginas e informação técnica verificável.

Execute: python build_research_pdf.py
A seção de comparação evidencia que modelos fundacionais foram pesquisados,
mas não executados; métricas indicam concordância com referência fraca.
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable, HRFlowable, KeepTogether, PageBreak, Paragraph,
    SimpleDocTemplate, Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parents[1] / "docs" / "research"
PDF = ROOT / "NOTA_PESQUISA_FINAL.pdf"
DEJAVU = Path("/usr/share/fonts/truetype/dejavu")
# Fontes inclusas em sistemas Linux usuais; não redistribuir os arquivos de fontes.
pdfmetrics.registerFont(TTFont("DejaVuGW", str(DEJAVU / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DejaVuGW-Bold", str(DEJAVU / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFontFamily("DejaVuGW", normal="DejaVuGW", bold="DejaVuGW-Bold", italic="DejaVuGW", boldItalic="DejaVuGW-Bold")

NAVY = colors.HexColor("#142F37")
GREEN = colors.HexColor("#6C944A")
MUTED = colors.HexColor("#556B70")
RULE = colors.HexColor("#DCE6E3")
PALE = colors.HexColor("#F4F7F6")
PALE_GREEN = colors.HexColor("#EFF5EB")
WHITE = colors.white
PAGE_W, PAGE_H = A4
MARGIN = 45
CW = PAGE_W - 2 * MARGIN

styles = {
    "section": ParagraphStyle(
        "section", fontName="DejaVuGW-Bold", fontSize=10.4, leading=15.5,
        textColor=NAVY, spaceBefore=10, spaceAfter=5.2,
    ),
    "body": ParagraphStyle(
        "body", fontName="DejaVuGW", fontSize=8.7, leading=13.15,
        textColor=NAVY, spaceAfter=5,
    ),
    "small": ParagraphStyle(
        "small", fontName="DejaVuGW", fontSize=8.05, leading=12.1,
        textColor=NAVY, spaceAfter=4,
    ),
    "tiny": ParagraphStyle(
        "tiny", fontName="DejaVuGW", fontSize=7.55, leading=11.15,
        textColor=NAVY, spaceAfter=3,
    ),
    "caption": ParagraphStyle(
        "caption", fontName="DejaVuGW", fontSize=7.6, leading=11.4,
        textColor=MUTED, spaceAfter=4.0,
    ),
    "table_header": ParagraphStyle(
        "table_header", fontName="DejaVuGW-Bold", fontSize=7.7,
        leading=11, textColor=WHITE,
    ),
    "table_cell": ParagraphStyle(
        "table_cell", fontName="DejaVuGW", fontSize=7.8,
        leading=11.7, textColor=NAVY,
    ),
    "table_cell_bold": ParagraphStyle(
        "table_cell_bold", fontName="DejaVuGW-Bold", fontSize=7.8,
        leading=11.7, textColor=NAVY,
    ),
    "bullet": ParagraphStyle(
        "bullet", fontName="DejaVuGW", fontSize=8.45, leading=12.9,
        textColor=NAVY, leftIndent=12.5, firstLineIndent=-10,
        spaceAfter=3,
    ),
    "meta": ParagraphStyle(
        "meta", fontName="DejaVuGW", fontSize=7.55,
        leading=11.4, textColor=NAVY,
    ),
}


def p(text, style="body"):
    return Paragraph(text, styles[style])


def section(num, title):
    return p(f'<font color="#6C944A">{num}</font>  {title}', 'section')


def rule(sp=4):
    return HRFlowable(width="100%", thickness=0.5, color=RULE, spaceBefore=sp, spaceAfter=sp)


def bullet(text):
    return p(f'<font color="#6C944A"><b>•</b></font>  {text}', 'bullet')


def make_table(rows, widths, header=True, special=None):
    enriched=[]
    for ri,row in enumerate(rows):
        cell_style = 'table_header' if header and ri == 0 else 'table_cell'
        enriched.append([p(str(val), ('table_cell_bold' if (not (header and ri == 0) and ci == 0) else cell_style))
                         if not (header and ri == 0) else p(str(val), cell_style)
                         for ci,val in enumerate(row)])
    t=Table(enriched,colWidths=widths,repeatRows=1 if header else 0,hAlign="LEFT")
    commands=[
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('LEFTPADDING',(0,0),(-1,-1),9),
        ('RIGHTPADDING',(0,0),(-1,-1),7),
        ('TOPPADDING',(0,0),(-1,-1),6),
        ('BOTTOMPADDING',(0,0),(-1,-1),6),
        ('LINEBELOW',(0,-1),(-1,-1),0.6,RULE),
    ]
    if header:
        commands += [('BACKGROUND',(0,0),(-1,0),NAVY),('TOPPADDING',(0,0),(-1,0),7),('BOTTOMPADDING',(0,0),(-1,0),7)]
        for i in range(1,len(rows)):
            if i % 2 == 0:
                commands.append(('BACKGROUND',(0,i),(-1,i),PALE))
            commands.append(('LINEBELOW',(0,i),(-1,i),0.3,RULE))
    if special:
        commands.extend(special)
    t.setStyle(TableStyle(commands))
    return t


class Pipeline(Flowable):
    """Fluxo técnico compacto, legível e sem aparência de infográfico decorativo."""
    def __init__(self, width=CW):
        super().__init__()
        self.width=width
        self.height=67
    def draw(self):
        items=[
            ("01  ENTRADA", "GeoTIFF + SCL"),
            ("02  PREPARO", "Reflectância + índices"),
            ("03  MODELO", "RF multiclasse + filtro"),
            ("04  SAÍDA", "Polígonos + hectares"),
        ]
        gap=17
        bw=(self.width-3*gap)/4
        for i,(label,main) in enumerate(items):
            x=i*(bw+gap)
            self.canv.setFillColor(PALE)
            self.canv.setStrokeColor(RULE)
            self.canv.roundRect(x,8,bw,54,7,fill=1,stroke=1)
            self.canv.setFont("DejaVuGW-Bold",7.2)
            self.canv.setFillColor(GREEN)
            self.canv.drawString(x+8,45,label)
            self.canv.setFillColor(NAVY)
            # Texto em duas linhas apenas quando necessário
            if i == 1:
                texts=["Reflectância", "+ índices"]
            elif i==2:
                texts=["RF multiclasse", "+ filtro"]
            elif i==3:
                texts=["Polígonos", "+ hectares"]
            else:
                texts=[main]
            self.canv.setFont("DejaVuGW",7.8)
            for j,txt in enumerate(texts):
                self.canv.drawString(x+8,30-j*12,txt)
            if i<3:
                ax=x+bw+3
                self.canv.setStrokeColor(GREEN)
                self.canv.setLineWidth(1.2)
                self.canv.line(ax,35,ax+10,35)
                pth=self.canv.beginPath()
                pth.moveTo(ax+10,35)
                pth.lineTo(ax+6,38)
                pth.moveTo(ax+10,35)
                pth.lineTo(ax+6,32)
                self.canv.drawPath(pth,stroke=1)


def decorate(canvas, doc):
    page=doc.page
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0,PAGE_H-12,PAGE_W,12,stroke=0,fill=1)
    canvas.setFillColor(NAVY)
    canvas.setFont("DejaVuGW-Bold",12)
    canvas.drawString(MARGIN,PAGE_H-48,"GLOBAL WATCH")
    canvas.setFillColor(GREEN)
    canvas.drawString(MARGIN+121,PAGE_H-48,"/")
    canvas.setFillColor(NAVY)
    canvas.drawString(MARGIN+134,PAGE_H-48,"NOTA DE PESQUISA")
    canvas.setFont("DejaVuGW",8.1)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN,PAGE_H-67,"Mapeamento exploratório de cafezais   •   Guaxupé/MG   •   28/10/2026")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.8)
    canvas.line(MARGIN,PAGE_H-79,PAGE_W-MARGIN,PAGE_H-79)
    canvas.line(MARGIN,47,PAGE_W-MARGIN,47)
    canvas.setFont("DejaVuGW",7.35)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN,30,"Candidatos a café ≠ cafezais comprovados  |  referência: MapBiomas 2025")
    canvas.drawRightString(PAGE_W-MARGIN,30,f"{page} / 2")
    canvas.restoreState()


story=[]
S=story.append

# PÁGINA 1 — Por que e como foi implementado.
S(section("01", "Escopo e dados disponíveis"))
S(p("<b>Pergunta:</b> como delimitar <b>polígonos candidatos a cafezais existentes</b> em imagens multiespectrais, sem confundir detecção com aptidão agrícola ou confirmação em campo? O processamento usa os pixels do GeoTIFF recebido; não consulta resultados pré-computados."))
metadata=[
    [p('<b>Imagem original</b><br/>16/08/2025 · Sentinel-2 L2A','meta'),
     p('<b>Área e grade</b><br/>Guaxupé/MG · 512×512 · 10 m · EPSG:32723','meta')],
    [p('<b>Entradas</b><br/>B02, B03, B04, B08 · máscara SCL 20 m','meta'),
     p('<b>Outras datas processadas</b><br/>21/07/2025 e 25/10/2025 · IDs STAC','meta')],
]
mt=Table(metadata,colWidths=[CW*0.45,CW*0.55],hAlign='LEFT')
mt.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),0.5,RULE),
    ('INNERGRID',(0,0),(-1,-1),0.45,RULE),
    ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
    ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
]))
S(mt)

S(section("02", "Fluxo executado em Python"))
S(Pipeline())
S(p("<b>Pré-processamento:</b> reflectância = DN × 0,0001 − 0,1 (metadados do kit; transformação feita uma vez; DN=0 inválido). SCL reamostrada por vizinho mais próximo para mascarar nuvens/sombras; NDVI, GNDVI, EVI2 e texturas locais. <b>Saída:</b> coerência 3×3, regiões ≥0,2 ha, GeoJSON WGS84 e área geodésica.","small"))
S(p("<b>Treinamento:</b> MapBiomas Coleção 11/2025 (classe 46 = café) como <b>supervisão fraca</b>. A revisão introduziu classes café/floresta/pastagem/mosaico/outros, erosão de 1 célula no rótulo nativo de 30 m, amostragem de 1 ponto por célula e três datas; avaliação com blocos espaciais e teste temporal.","small"))

S(section("03", "Alternativas e decisão técnica"))
S(make_table([
    ["Abordagem", "Situação", "Motivo e decisão"],
    ["Índices + limiares", "Testada", "Baixo custo, mas confunde vegetação densa com café. Não adotada como classificador final."],
    ["Random Forest multiclasse", "Implementada", "Compatível com quatro bandas, roda em CPU e permite investigar erros e reproduzir o processamento."],
    ["Prithvi-EO-2.0 / Clay", "Pesquisadas, <b>não testadas</b>", "Modelos fundacionais promissores, mas requerem adaptação dos dados, classificação específica de café e validação adicional; ganho não demonstrado no prazo."],
], [133,100,CW-233]))
S(p("<b>Prithvi-EO-2.0</b> usa originalmente seis bandas HLS, diferentes das quatro do kit; o <b>Clay</b> oferece representações para dados Sentinel-2. Bandas red-edge/SWIR também foram consideradas para trabalhos futuros, sem experimentos nesta entrega. <font color='#556B70'>Fontes:</font> <link href='https://github.com/NASA-IMPACT/Prithvi-EO-2.0' color='#286257'>NASA/IBM</link> e <link href='https://clay-foundation.github.io/model/' color='#286257'>Clay</link>.","tiny"))

S(section("04", "Fundamentação — três fontes primárias"))
S(p("<b>1 · Parreiras et al. (2025).</b> <i>Dense Time Series of Harmonized Landsat Sentinel-2 and Ensemble Machine Learning to Map Coffee Production Stages.</i> Remote Sensing 17(18):3168. Séries temporais e RF/XGBoost. <link href='https://doi.org/10.3390/rs17183168' color='#286257'>doi:10.3390/rs17183168</link>","tiny"))
S(p("<b>2 · Alves, Volpato &amp; Campos (2021).</b> <i>Mapeamento automatizado de áreas de café em Minas Gerais.</i> Embrapa Café. Sentinel-2 e classificação orientada a objetos. <link href='https://www.infoteca.cnptia.embrapa.br/infoteca/handle/doc/1134278' color='#286257'>Embrapa, doc. 1134278</link>","tiny"))
S(p("<b>3 · Schneider, Alves &amp; Ferreira (2025).</b> <i>Coffee crop detection and mapping using Sentinel-2 data and spatial coherence.</i> TAAE 9(3). Coerência espacial em classificação. <link href='https://doi.org/10.31422/taae.v9i3.64' color='#286257'>doi:10.31422/taae.v9i3.64</link>","tiny"))
S(p("<b>Dados auxiliares:</b> Sentinel-2 L2A / SCL (<link href='https://sentiwiki.copernicus.eu/web/s2-products' color='#286257'>Copernicus</link>); MapBiomas Brasil Coleção 11 / 2025, 30 m (<link href='https://brasil.mapbiomas.org/' color='#286257'>MapBiomas</link>). Referência temática <b>não é verdade de campo</b>.","tiny"))

S(PageBreak())

# PÁGINA 2 — o que os testes mostram, erros, limites e responsabilização.
S(section("05", "Resultados obtidos — comparação com MapBiomas"))
S(p("Áreas em hectares dos polígonos candidatos e suas <b>sobreposições aproximadas</b> com as classes do mapa anual de 2025. Não representam acurácia real nem hectares de café confirmados.","caption"))
S(make_table([
    ["Cena", "Classificador", "Candidatos", "Sobrep. café", "Sobrep. floresta"],
    ["Ago/2025", "RF anterior", "96,02 ha", "29,07 ha", "7,07 ha"],
    ["Ago/2025", "RF revisado · 0,50", "22,66 ha", "12,14 ha", "1,03 ha"],
    ["Out/2025", "RF anterior", "83,27 ha", "6,30 ha", "66,45 ha"],
    ["Out/2025", "RF revisado · 0,50", "10,96 ha", "7,94 ha", "0,00 ha"],
],[86,125,93,96,CW-400]))
S(Spacer(1,5))
S(p("<b>Interpretação:</b> a revisão reduziu fortemente candidatos sobre floresta, sobretudo em outubro (66,45 → 0,00 ha), <b>mas também reduziu a cobertura de café rotulado em agosto</b> (29,07 → 12,14 ha). Não há evidência para declarar superioridade geral do modelo.","small"))

S(section("06", "Validação e erros efetivamente encontrados"))
S(bullet("<b>Validação por blocos espaciais:</b> F1 ≈ 0,355 para o RF revisado, contra rótulos indiretos; <b>teste leave-one-date-out:</b> F1 ≈ 0,391 retendo outubro no ensaio temporal. Protocolos distintos; F1 dos modelos antigos e novos não é comparável diretamente."))
S(bullet("<b>Falha de classificação:</b> o RF binário treinado em julho/agosto confundiu floresta com café na cena de outubro; foram introduzidos negativos difíceis, rótulos menos ruidosos e treinamento multidata. Sem ablação completa, não atribuímos o ganho a um fator isolado."))
S(bullet("<b>Falha de software:</b> operações <font face='DejaVuGW-Bold'>Affine @ tuple</font> quebravam a sobreposição com a biblioteca instalada. Corrigidas para <font face='DejaVuGW-Bold'>Affine * tuple</font>, com testes de regressão."))
S(p("<b>Cuidado metodológico:</b> outubro foi usado na seleção da abordagem e no treinamento da versão final; <b>não é um conjunto final independente/intocado</b>.","caption"))

S(section("07", "Limitações que afetam a interpretação"))
S(bullet("<b>Rótulos e escala:</b> MapBiomas é anual e tem resolução aproximada de 30 m; reamostrar para 10 m não adiciona detalhe real. Sem inventário de campo ou teste em região diferente, não é possível declarar precisão da identificação de café."))
S(bullet("<b>Generalização:</b> banda visível + NIR, sazonalidade, práticas de manejo, poda, sombreamento, nuvens e pixels mistos podem confundir cafezais, floresta e outras culturas."))
S(bullet("<b>Saída operacional:</b> scores RF não calibrados; corte de score e área mínima de 0,2 ha podem omitir talhões. Polígonos representam <b>candidatos para revisão</b>, não propriedades validadas."))

S(section("08", "Reprodutibilidade, direitos de uso e IA"))
S(p("<b>Arquivos gerados por upload:</b> <font face='DejaVuGW-Bold'>candidatos.geojson</font> (EPSG:4326; áreas individuais), <font face='DejaVuGW-Bold'>imagem_classificada.png</font>, <font face='DejaVuGW-Bold'>imagem_mapa.png</font>, <font face='DejaVuGW-Bold'>classificacao.tif</font> e <font face='DejaVuGW-Bold'>resultado.json</font>. Hectares vêm das geometrias vetorizadas e do cálculo geodésico.","small"))
S(p("<b>Proveniência e licenças:</b> URLs/IDs STAC em <font face='DejaVuGW-Bold'>sample/</font>, <font face='DejaVuGW-Bold'>additional/</font>, <font face='DejaVuGW-Bold'>unseen/</font> e <font face='DejaVuGW-Bold'>reference/</font>. Crédito Copernicus: “Contains modified Copernicus Sentinel data (2025)”. MapBiomas exige atribuição; verificar termos da Coleção 11 para eventual redistribuição. Bibliotecas Python abertas estão declaradas nos requisitos.","small"))
S(p("<b>Uso de IA:</b> ChatGPT/GPT-6 e Deep Research apoiaram pesquisa, programação e documentação; nenhum substituiu a análise dos pixels, gerou rótulos ou estimou hectares. O chat generativo depende de credencial no servidor; sem ela, a aplicação informa a contingência determinística.","small"))


doc=SimpleDocTemplate(str(PDF),pagesize=A4,
    leftMargin=MARGIN,rightMargin=MARGIN,topMargin=96,bottomMargin=59,
    title='Nota de pesquisa — Mapeamento exploratório de cafezais | Global Watch',
    author='Desafio técnico — Global Watch',
    subject='Metodologia, alternativas, avaliação, limitações e fontes primárias',
    pageCompression=1)
doc.build(story,onFirstPage=decorate,onLaterPages=decorate)
print(PDF)
