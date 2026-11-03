"""Generate a local annotation UI; never show model predictions or source labels."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .common import DEFAULT_OUTPUT


def render(root):
    labels=json.loads((root/"review/blind_samples.json").read_text(encoding="utf-8"))
    counters={}
    for sample in labels["samples"]:
        index=counters.get(sample["region"],0)
        counters[sample["region"]]=index+1
        sample["card"]={"href":f'review/{sample["region"]}-samples-{index//12:02d}.jpg',"x":(index%12%3)*410,"y":(index%12//3)*310}
    payload=json.dumps(labels,ensure_ascii=False).replace("</","<\\/")
    template='''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anotação de referências — estudo amazônico</title><style>body{font:16px/1.5 system-ui;margin:0;background:#f4f5f0;color:#1c2c23}main{max-width:1050px;margin:24px auto;padding:0 20px}h1{font-size:28px}button,input,select{font:inherit;padding:9px;border:1px solid #b2beb3;border-radius:4px;background:white}button{cursor:pointer}button.selected{background:#245c3d;color:white}nav,.choices,.form{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}svg{width:100%;max-width:820px;background:white}section{background:white;padding:20px;border:1px solid #d9dfd5;margin:18px 0}p{max-width:850px}.muted{font-size:14px;color:#495c4d}textarea{width:100%;min-height:60px;font:inherit}a{color:#245c3d}</style><main><a href="report.html">← Relatório</a><h1>Revisão sem previsões do modelo</h1><p>Classifique somente o quadrado laranja de 160 × 160 m na <strong>última data da ficha</strong>. As datas anteriores servem como contexto. Use “Indeterminado” quando houver nuvens, mistura de usos ou dúvida — em especial entre pastagem e cultivo.</p><p class="muted">RGB na linha superior e falsa cor na inferior. A ficha não mostra previsões, classes de outros mapas ou resultados de avaliação. As anotações ficam apenas neste navegador até você exportar o JSON.</p><div class="form"><label>Revisor <input id="reviewer" placeholder="Nome ou identificador"></label><label>Tipo de interpretação <select id="kind"><option value="human_visual_interpretation">Visual humana</option><option value="expert_visual_interpretation">Visual especializada</option><option value="ai_visual_interpretation">Assistida por IA</option></select></label></div><nav><button id="previous">Anterior</button><input id="position" type="number" min="1" style="width:90px"><button id="next">Próxima</button><button id="export">Baixar anotações JSON</button></nav><p id="status"></p><section><h2 id="identifier"></h2><p id="target"></p><svg id="preview" viewBox="0 0 410 310" role="img"><image id="sheet" width="1240" height="1260"/></svg><div class="choices" id="choices"></div><label>Certeza <select id="certainty"><option value="high">Alta</option><option value="low">Baixa / precisa de revisão</option></select></label><p><label>Observações <textarea id="notes"></textarea></label></p><button id="save">Salvar anotação e avançar</button></section><p class="muted">Uma anotação visual não é validação de campo. O tipo de revisão acompanha o arquivo exportado. Atalhos: 1–5 selecionam a classe, X seleciona indeterminado, setas navegam. O export preserva as divisões de treino e teste previamente congeladas.</p></main><script id="data" type="application/json">__PAYLOAD__</script><script>
const original=JSON.parse(document.getElementById('data').textContent),key='land-change-annotations:'+original.study_id+':'+original.sampling_revision+':'+original.manifest_sha256;let payload=original,index=0,selected=null;
try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&saved.study_id===original.study_id&&saved.manifest_sha256===original.manifest_sha256&&saved.sampling_revision===original.sampling_revision&&saved.samples.length===original.samples.length&&saved.samples.every((s,i)=>['id','target_scene_id','target_date','row','col','split','block','label_support_m'].every(k=>s[k]===original.samples[i][k])))payload=saved;}catch{}
const el=id=>document.getElementById(id),classes=[[1,'1 · Floresta'],[2,'2 · Pastagem'],[3,'3 · Cultivo'],[4,'4 · Solo exposto'],[5,'5 · Água'],[null,'X · Indeterminado']];
function persist(){try{localStorage.setItem(key,JSON.stringify(payload))}catch{el('status').textContent='Não foi possível salvar no navegador. Exporte o JSON para preservar as anotações.'}}
function mark(value){selected=value;el('choices').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',JSON.parse(b.dataset.value)===value));}
for(const[value,label]of classes){const b=document.createElement('button');b.textContent=label;b.dataset.value=JSON.stringify(value);b.onclick=()=>mark(value);el('choices').append(b)}
function show(){const s=payload.samples[index],card=original.samples[index].card;el('identifier').textContent=s.id;el('target').textContent='Data avaliada: '+s.target_date.slice(0,10)+' · '+s.label_support_m+' m · '+s.split;el('sheet').setAttribute('href',card.href);el('sheet').setAttribute('x',-card.x);el('sheet').setAttribute('y',-card.y);el('position').value=index+1;el('position').max=payload.samples.length;el('certainty').value=s.certainty||'high';el('notes').value=s.notes||'';if(s.reviewer)el('reviewer').value=s.reviewer;if(s.reference_kind&&s.reference_kind!=='unreviewed')el('kind').value=s.reference_kind;mark(s.label);el('status').textContent=(index+1)+' de '+payload.samples.length+' · '+payload.samples.filter(s=>s.reviewed).length+' revisadas';}
function save(){const s=payload.samples[index],reviewer=el('reviewer').value.trim();if(!reviewer){el('reviewer').focus();return false}s.label=selected;s.certainty=selected===null?'low':el('certainty').value;s.notes=el('notes').value;s.reviewer=reviewer;s.reference_kind=el('kind').value;s.reviewed=true;s.model_predictions_shown=false;persist();return true}
el('save').onclick=()=>{if(save()){index=Math.min(index+1,payload.samples.length-1);show()}};el('previous').onclick=()=>{index=Math.max(0,index-1);show()};el('next').onclick=()=>{index=Math.min(payload.samples.length-1,index+1);show()};el('position').onchange=()=>{index=Math.max(0,Math.min(payload.samples.length-1,Number(el('position').value)-1));show()};
el('export').onclick=()=>{const data=JSON.parse(JSON.stringify(payload));data.samples.forEach(s=>delete s.card);data.model_predictions_shown=false;const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='annotations-'+data.study_id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
document.onkeydown=e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key>='1'&&e.key<='5')mark(Number(e.key));if(e.key.toLowerCase()==='x')mark(null);if(e.key==='ArrowRight')el('next').click();if(e.key==='ArrowLeft')el('previous').click()};show();
</script></html>'''
    output=root/"annotate.html"
    output.write_text(template.replace("__PAYLOAD__",payload),encoding="utf-8",newline="\n")
    return output


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",type=Path,default=DEFAULT_OUTPUT)
    args=parser.parse_args()
    print(render(args.root))


if __name__=="__main__":
    main()
