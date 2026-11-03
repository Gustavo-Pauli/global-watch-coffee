"""Render measured pilot artifacts as a local, dependency-free HTML report."""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from PIL import Image, ImageDraw
from affine import Affine
from rasterio.warp import transform_geom

from .common import DEFAULT_OUTPUT, write_json


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def number(value, digits=1):
    return f"{value:,.{digits}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def render(root):
    manifest=read_json(root/"manifest.json")
    if not manifest:
        raise ValueError("A completed acquisition manifest is required")
    detection=read_json(root/"detection/detection_summary.json")
    classification=read_json(root/"classification/metrics.json")
    feature_quality=read_json(root/"classification/feature_quality.json")
    access=read_json(root/"references/access-audit.json")
    labels=read_json(root/"review/blind_samples.json")
    probes=[read_json(path) for path in sorted(root.glob("**/probe.json"))]
    probes=[probe for probe in probes if probe]
    assets=root/"report-assets"
    assets.mkdir(exist_ok=True)
    regions=[]
    for region in manifest["regions"]:
        source=root/"review"/f'{region["id"]}-overview.jpg'
        if source.exists():
            overview=Image.open(source)
            width,height=region["width"]//4,region["height"]//4
            scale=min(1,780/width,780/height)
            width,height=int(width*scale),int(height*scale)
            for name,offset in (("baseline",0),("recent",820)):
                overview.crop((10,35+offset,10+width,35+offset+height)).save(assets/f'{region["id"]}-{name}.jpg',quality=95)
            vector_path=root/"detection"/region["id"]/"candidates.geojson"
            if vector_path.is_file():
                overlay=Image.open(assets/f'{region["id"]}-recent.jpg')
                draw=ImageDraw.Draw(overlay)
                inverse=~Affine(*region["transform"])
                for feature in read_json(vector_path)["features"]:
                    geometry=transform_geom("EPSG:4326",region["crs"],feature["geometry"])
                    polygons=geometry["coordinates"] if geometry["type"]=="MultiPolygon" else [geometry["coordinates"]]
                    for polygon in polygons:
                        for ring in polygon:
                            pixels=[inverse*(x,y) for x,y,*_ in ring]
                            draw.line([(col*width/region["width"],row*height/region["height"]) for col,row in pixels],fill=(255,170,0),width=2)
                overlay.save(assets/f'{region["id"]}-candidates.jpg',quality=95)
        summary=next((item for item in detection["regions"] if item["region"]==region["id"]),None) if detection else None
        dates=sorted(scene["date"][:10] for scene in region["scenes"] if scene["phase"]=="recent")
        regions.append(dict(id=region["id"],name=region["name"],bbox=region["bbox"],scene_count=len(region["scenes"]),recent_dates=dates,detection=summary))
    quality_counts={}
    for sample in (feature_quality or {}).get("samples",[]):
        quality_counts[sample["status"]]=quality_counts.get(sample["status"],0)+1
    summary=dict(study_id=manifest["study_id"],cutoff_utc=manifest["cutoff_utc"],
        phase="acquisition_and_feasibility_completed_reference_evaluation_pending",
        regions=regions,classification_status=(classification or {}).get("status","not_run"),
        reference_sample_count=len((labels or {}).get("samples",[])),
        reviewed_reference_count=sum(sample.get("label") is not None for sample in (labels or {}).get("samples",[])),
        feature_quality_counts=quality_counts,model_probes=probes,reference_access=access,
        validated_deforestation=False,mapbiomas_superiority_established=False,
        product_identity_selected=False,external_spend_brl=0,
        conclusions=[
            "Recent public Sentinel-2 acquisition and regional quality auditing ran successfully.",
            "Spectral persistence produced candidates, not independently validated forest-loss events.",
            "The event interval and left-censoring materially affect which candidates can be called newly observed.",
            "Pasture/crop attribution and accuracy comparison require reviewed reference labels.",
            "No winner between detection and classification is supported by this round.",
        ])
    write_json(root/"summary.json",summary)
    rows=[]
    region_sections=[]
    total_candidates=0
    for region in regions:
        det=region["detection"] or {}
        counts=det.get("candidate_count_by_observation_classification",{})
        areas=det.get("candidate_area_ha_geodesic_by_observation_classification",{})
        total_candidates+=det.get("candidate_polygon_count",0)
        rows.append(f'<tr><th>{html.escape(region["name"])}</th><td>{region["scene_count"]}</td><td>{det.get("candidate_polygon_count","—")}</td><td>{number(det.get("candidate_area_ha_geodesic",0))} ha</td><td>{counts.get("observed_new_recent_loss",0)} / {number(areas.get("observed_new_recent_loss",0))} ha</td></tr>')
        cards=sorted((root/"cases"/region["id"]).glob("cases-*.jpg"))
        case_links=" ".join(f'<a href="{path.relative_to(root).as_posix()}">Casos {i+1}</a>' for i,path in enumerate(cards))
        region_sections.append(f'''<section><h2>{html.escape(region["name"])}</h2>
<p>Observações recentes utilizadas: {", ".join(region["recent_dates"])}. As imagens abaixo são medianas temporais para orientação; as datas individuais estão nas fichas.</p>
<div class="comparison"><figure><img src="report-assets/{region["id"]}-baseline.jpg" alt="Mediana RGB de referência de agosto a outubro de 2025"><figcaption>Referência: agosto–outubro de 2025</figcaption></figure><figure><img id="recent-{region["id"]}" src="report-assets/{region["id"]}-recent.jpg" alt="Mediana RGB das observações recentes de 2026"><figcaption>Observações: agosto–novembro de 2026</figcaption><label><input type="checkbox" onchange="document.getElementById('recent-{region["id"]}').src=this.checked?'report-assets/{region["id"]}-candidates.jpg':'report-assets/{region["id"]}-recent.jpg'"> Sobrepor candidatos espectrais em laranja</label></figure></div>
<p><strong>Limites de tempo:</strong> {counts.get("observed_new_recent_loss",0)} candidatos inteiramente observados como novos; {counts.get("left_censored_possible_loss_since_baseline",0)} já alterados na primeira observação útil; {counts.get("mixed_censoring_candidate",0)} misturam esses casos.</p>
<p>{case_links}</p><p><a href="detection/{region["id"]}/candidates.geojson">Baixar candidatos GeoJSON</a> · <a href="detection/{region["id"]}/detection_summary.json">Ver parâmetros e medições</a> · <a href="review/{region["id"]}-overview.jpg">Ver RGB e falsa cor</a></p></section>''')
    model_rows=[]
    for probe in probes:
        model_rows.append(f'<tr><td>{html.escape(Path(probe["input"]).parent.name)}</td><td>{probe["tile_count"]} × {probe["tile_size_pixels"]} px</td><td>{number(probe["inference_seconds"],3)} s</td><td>{number(probe["peak_cuda_allocated_bytes"]/1024**2)} MiB</td><td>{probe["clear_feature_patches"]}</td></tr>')
    model_html=('''<table><thead><tr><th>Cena</th><th>Recortes</th><th>Inferência</th><th>Pico GPU alocado</th><th>Patches claros</th></tr></thead><tbody>'''+"".join(model_rows)+"</tbody></table>") if model_rows else "<p>O teste de execução do TerraMind ainda não possui resultado registrado.</p>"
    body=f'''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Estudo amazônico — resultados da primeira rodada</title>
<style>body{{font:16px/1.6 system-ui,sans-serif;color:#19251e;background:#f4f5f0;margin:0}}main{{max-width:1120px;margin:auto;padding:36px 24px}}h1{{font-size:clamp(28px,4vw,44px);line-height:1.15;max-width:850px}}h2{{line-height:1.25}}section,.notice{{background:white;padding:24px;margin:24px 0;border:1px solid #d9dfd5;border-radius:8px}}.notice{{border-left:5px solid #be8232}}.lead{{font-size:20px;max-width:850px}}table{{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow:auto}}td,th{{padding:12px;border-bottom:1px solid #d9dfd5;text-align:left}}.comparison{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}figure{{margin:0}}img{{width:100%;height:auto;display:block}}figcaption{{font-size:14px;padding-top:8px}}a{{color:#245c3d}}.facts{{display:flex;gap:24px;flex-wrap:wrap}}.facts b{{font-size:28px;display:block}}code{{overflow-wrap:anywhere}}footer{{font-size:13px;margin:30px 0}}@media(max-width:650px){{.comparison{{grid-template-columns:1fr}}main{{padding:20px 12px}}section{{padding:16px}}}}@media print{{body{{background:white}}section{{break-inside:avoid}}}}</style><main>
<h1>O que os dados recentes permitem descobrir?</h1><p class="lead">Comparação exploratória entre detectar perda de vegetação e classificar a paisagem nos pilotos de Novo Progresso e Belterra.</p>
<p>Dados congelados até 02/11/2026 · Branch de pesquisa isolada · Sem serviços pagos</p>
<div class="notice"><strong>A comparação de precisão continua pendente.</strong> O detector encontrou candidatos reais nos pixels. As referências ainda não foram anotadas e os comparadores externos não puderam ser baixados. Não há, nesta rodada, desmatamento confirmado, causa identificada ou superioridade demonstrada ao MapBiomas.</div>
<div class="facts"><div><b>{sum(r["scene_count"] for r in regions)}</b>recortes adquiridos</div><div><b>{total_candidates}</b>candidatos espectrais</div><div><b>{summary["reference_sample_count"]}</b>amostras para revisão</div><div><b>R$ 0</b>em serviços externos</div></div>
<section><h2>Detecção: resultado medido</h2><p>Candidatos exigem queda persistente de NDVI e NBR, observada em pelo menos duas datas claras. A máscara de partida é compatível com vegetação densa; ainda não é uma classificação validada de floresta nativa. O limite mínimo é de 0,5 hectare.</p><table><thead><tr><th>Piloto</th><th>Cenas</th><th>Candidatos</th><th>Área candidata</th><th>Novos dentro da série recente</th></tr></thead><tbody>{"".join(rows)}</tbody></table><p>As áreas não são estimativas de desmatamento real. Sazonalidade, agricultura, regeneração e imperfeições das máscaras podem produzir candidatos. Pixels cobertos por nuvens ficam desconhecidos.</p></section>
{"".join(region_sections)}
<section><h2>Classificação: o que falta para comparar</h2><p>Foram extraídos atributos em {quality_counts.get("ready",0)} das {summary["reference_sample_count"]} amostras; {summary["reference_sample_count"]-quality_counts.get("ready",0)} não têm suporte claro suficiente. Cada amostra descreve 160 × 160 m. A classe deve corresponder à data marcada na ficha.</p><p>Classes propostas: floresta, pastagem, cultivo, solo exposto e água. Existem {summary["reviewed_reference_count"]} rótulos preenchidos. O treinamento fica bloqueado quando não há referências suficientes por classe. Mapas ou regras espectrais não serão usados como rótulos independentes de teste.</p><p><a href="annotate.html">Abrir fichas para anotação</a> · <a href="review/blind_samples.json">Amostras e divisões espaciais</a> · <a href="classification/metrics.json">Estado da avaliação</a></p></section>
<section><h2>Modelo pré-treinado: viabilidade local</h2>{model_html}<p>Os tempos medem apenas o cálculo do encoder na GPU: excluem importação, carregamento dos pesos, leitura dos rasters, hashes e exportação. A memória é o pico alocado pelo PyTorch; exclui driver, contexto CUDA e treinamento.</p><p>O teste mede execução, sem treinar ou avaliar uma classificação. Seus tokens têm espaçamento de 16 pixels da fonte (160 m), com contexto de todo o recorte. Isso não constitui segmentação validada a 10 m. O SWIR é nativamente 20 m.</p></section>
<section><h2>Comparadores externos</h2><p>As URLs consultadas para MapBiomas 2025 retornaram HTTP 403. O DIST‑ALERT forneceu metadados recentes, mas os rasters retornaram HTTP 401. A API do MapBiomas Alerta documenta autenticação e a consulta anônima falhou. Isso é uma limitação de acesso desta execução, não evidência de ausência de dados nem de melhor desempenho do nosso detector.</p><p><a href="references/access-audit.json">Ver auditoria de acesso</a></p></section>
<section><h2>Decisão de produto</h2><p>Esta rodada confirma a aquisição recente e a geração de candidatos em uma área limitada. Ainda não sustenta escolher um vencedor por precisão. A próxima evidência necessária é a revisão das amostras, incluindo negativos, e a obtenção de produtos comparadores com datas e definições compatíveis.</p><p>Para detecção, verificar falsos alertas e intervalos de mudança. Para classificação, verificar se pastagem e cultivo são distinguíveis com as referências disponíveis. Atribuir o uso posterior deve continuar indeterminado quando a sequência ainda não permite reconhecer um destino.</p></section>
<footer>Contains modified Copernicus Sentinel data (2025, 2026). Imagens de medianas temporais são orientação visual; as observações datadas e suas fontes estão no <a href="manifest.json">manifesto</a>. <a href="summary.json">Resumo estruturado</a>. Código e protocolo em <code>research/land_change/</code>.</footer></main></html>'''
    path=root/"report.html"
    path.write_text(body,encoding="utf-8",newline="\n")
    return path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",type=Path,default=DEFAULT_OUTPUT)
    args=parser.parse_args()
    print(render(args.root))


if __name__=="__main__":
    main()
