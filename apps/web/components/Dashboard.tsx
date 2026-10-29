'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {authClient} from '@/lib/auth-client';
import type {FeatureCollection} from 'geojson';
import {Activity,ArrowDownToLine,ArrowRight,BookOpen,CheckCircle2,ChevronDown,CloudUpload,Compass,FileImage,Layers3,Leaf,LogOut,Map,MessageCircle,Send,ShieldCheck,Sparkles,TriangleAlert,UploadCloud,X} from 'lucide-react';

type Bounds=[[number,number],[number,number]];
type AnalysisResult={method:string;acquisition_date:string|null;candidate_polygon_count:number;candidate_area_ha:number;valid_pixels:number;leaflet_bounds:Bounds;ndvi_median:number|null;limitations:string;model_score_not_calibrated:boolean};
type AnalysisData={analysis:{id:string,status:string,scene:string|null,date:string|null};result:AnalysisResult;geojson:FeatureCollection};
type Message={role:'bot'|'user';text:string;mode?:string};
type HistoryItem={id:string;scene:string|null;date:string|null;status:string;created:number};
const API='';
const SatelliteMap=dynamic(()=>import('./SatelliteMap'),{ssr:false});

async function request<T>(path:string,init:RequestInit={}):Promise<T>{
 const res=await fetch(API+path,{...init,credentials:'same-origin',cache:'no-store'});
 if(!res.ok){let detail='Falha na operação.';try{const body=await res.json();detail=typeof body.detail==='string'?body.detail:detail;}catch{}throw new Error(detail)}
 return res.json() as Promise<T>;
}
function Metric({icon,label,value,unit}:{icon:ReactNode;label:string;value:string;unit?:string}){return <div className="metric"><div className="metric-icon">{icon}</div><div><p>{label}</p><strong>{value}</strong>{unit&&<span> {unit}</span>}</div></div>}

export default function Dashboard(){
 const { data: session, isPending } = authClient.useSession();
 const authenticated=!!session?.user;

 const [analysisId,setAnalysisId]=useState<string|null>(null);
 const [analysis,setAnalysis]=useState<AnalysisData|null>(null);
 const [image,setImage]=useState<File|null>(null);
 const [scl,setScl]=useState<File|null>(null);
 const [date,setDate]=useState('2025-08-16');
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [mapOverlay,setMapOverlay]=useState<string|null>(null);
 const [classifiedPreview,setClassifiedPreview]=useState<string|null>(null);
 const [messages,setMessages]=useState<Message[]>([{role:'bot',text:'Olá! Depois de processar uma cena, posso explicar a área candidata, o NDVI e as limitações da classificação.'}]);
 const [question,setQuestion]=useState('');
 const [chatLoading,setChatLoading]=useState(false);
 const [sidebar,setSidebar]=useState(false);
 const [selectedScene,setSelectedScene]=useState('august');
 const [history,setHistory]=useState<HistoryItem[]>([]);
 const selectedInput=useRef<HTMLInputElement|null>(null);
 const previousUserId=useRef<string|null|undefined>(undefined);
 useEffect(()=>{
  const current=session?.user.id ?? null;
  if(previousUserId.current!==undefined && previousUserId.current!==current){
   setAnalysis(null);setAnalysisId(null);setHistory([]);
   setMapOverlay(old=>{if(old)URL.revokeObjectURL(old);return null});
   setClassifiedPreview(old=>{if(old)URL.revokeObjectURL(old);return null});
  }
  previousUserId.current=current;
 },[session?.user.id]);
 const dateLabels:{[k:string]:string}={august:'16 agosto 2025 · cena original',july:'21 julho 2025 · imagem adicional',october:'25 outubro 2025 · teste temporal'};
 const number=(value:number,digits=2)=>value.toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});

 const refreshHistory=useCallback(async()=>{try{setHistory(await request<HistoryItem[]>('/api/analyses'));}catch{setHistory([])}},[]);
 useEffect(()=>{if(authenticated)void refreshHistory();else setHistory([]);},[authenticated,refreshHistory]);
 const loadAnalysis=useCallback(async(id:string)=>{
  let data: AnalysisData | null=null;
  for(let attempt=0;attempt<45;attempt++){
   const response=await fetch(`/api/analyses/${id}`,{credentials:'same-origin',cache:'no-store'});
   if(response.status===202){
    await new Promise(resolve=>setTimeout(resolve,4000));
    continue;
   }
   if(!response.ok){
    const body=await response.json().catch(()=>({detail:'Falha no processamento.'}));
    throw new Error(body.detail || 'Falha no processamento.');
   }
   data=await response.json() as AnalysisData;
   break;
  }
  if(!data)throw new Error('O processamento ainda está em andamento. Consulte o histórico e tente abrir novamente.');
  setAnalysis(data);setAnalysisId(id);
  const r=await fetch(`${API}/api/analyses/${id}/files/map`,{credentials:'same-origin'});
  if(!r.ok)throw new Error('Não foi possível carregar a imagem do mapa.');
  const url=URL.createObjectURL(await r.blob());
  setMapOverlay(old=>{if(old)URL.revokeObjectURL(old);return url});
  const preview=await fetch(`${API}/api/analyses/${id}/files/classified`,{credentials:'same-origin'});
  if(preview.ok){const png=URL.createObjectURL(await preview.blob());setClassifiedPreview(old=>{if(old)URL.revokeObjectURL(old);return png})}
  void refreshHistory();
  setMessages([{role:'bot',text:`Análise concluída: ${data.result.candidate_polygon_count} áreas candidatas e ${number(data.result.candidate_area_ha)} ha estimados. Esses polígonos não comprovam cultivo de café.`}]);
 },[refreshHistory]);
 const processDemo=async()=>{
  if(!authenticated)return;setLoading(true);setError('');
  try{
   const data=await request<{id:string}>('/api/analysis/demo',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:selectedScene})});
   await loadAnalysis(data.id);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível processar a cena.')}finally{setLoading(false);void refreshHistory()}
 };
 type SignedUpload={signedUrl:string;path:string;token:string};
 const directUpload=async(file:File,signature:SignedUpload)=>{
  // Matches Supabase Storage's signed-upload endpoint. No service-role key in the browser.
  const payload=new FormData();
  payload.append('cacheControl','3600');
  payload.append('',file,file.name);
  const response=await fetch(signature.signedUrl,{method:'PUT',headers:{'x-upsert':'false'},body:payload});
  if(!response.ok)throw new Error(`Storage recusou ${file.name} (${response.status}).`);
 };
 const processUpload=async()=>{
  if(!authenticated||!image)return;setLoading(true);setError('');
  try{
   const prepared=await request<{id:string;uploads:{image:SignedUpload;scl?:SignedUpload}}>(
    '/api/analysis/upload',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({image:{name:image.name,size:image.size},
      scl:scl?{name:scl.name,size:scl.size}:null,date:date||null})});
   await directUpload(image,prepared.uploads.image);
   if(scl && prepared.uploads.scl)await directUpload(scl,prepared.uploads.scl);
   await request(`/api/analysis/start`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:prepared.id})});
   await loadAnalysis(prepared.id);
  }catch(e){setError(e instanceof Error?e.message:'Falha no upload.')}finally{setLoading(false);void refreshHistory()}
 };
 const download=async(kind:'geojson'|'classified'|'tif')=>{
  if(!authenticated||!analysisId)return;setError('');
  try{const response=await fetch(`${API}/api/analyses/${analysisId}/files/${kind}`,{credentials:'same-origin'});
   if(!response.ok)throw new Error('Download indisponível.');
   const href=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=href;
   a.download=kind==='geojson'?'candidatos.geojson':kind==='tif'?'classificacao.tif':'imagem_classificada.png';
   document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1200);
  }catch(e){setError(e instanceof Error?e.message:'Download indisponível.')}
 };
 const sendQuestion=async()=>{
  const q=question.trim();if(!q||!authenticated||!analysisId||chatLoading)return;
  setMessages(m=>[...m,{role:'user',text:q}]);setQuestion('');setChatLoading(true);
  try{const res=await request<{answer:string;type:string;warning?:string}>(`/api/analyses/${analysisId}/chat`,
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})});
   setMessages(m=>[...m,{role:'bot',text:res.answer,mode:res.type}]);
  }catch(e){setMessages(m=>[...m,{role:'bot',text:e instanceof Error?e.message:'Não foi possível responder.'}])}finally{setChatLoading(false)}
 };
 const logout=async()=>{
  try{await authClient.signOut()}finally{
   setAnalysis(null);setAnalysisId(null);setImage(null);setHistory([]);
   setMapOverlay(o=>{if(o)URL.revokeObjectURL(o);return null});
   setClassifiedPreview(o=>{if(o)URL.revokeObjectURL(o);return null});
  }
 };
 useEffect(()=>()=>{if(mapOverlay)URL.revokeObjectURL(mapOverlay);if(classifiedPreview)URL.revokeObjectURL(classifiedPreview)},[mapOverlay,classifiedPreview]);
 const center=useMemo<Bounds>(()=>analysis?.result.leaflet_bounds??[[-21.35,-46.70],[-21.30,-46.65]], [analysis]);
 const geojson=analysis?.geojson??{type:'FeatureCollection' as const,features:[]};

 return <div className="app-shell">
  <aside className={'sidebar '+(sidebar?'expanded':'')}>
   <div className="brand"><div className="brand-mark"><Leaf size={22}/></div><div className="brand-words"><strong>GLOBAL<span>WATCH</span></strong><small>GEOINTELLIGENCE / CAFÉ</small></div></div>
   <div className="nav-caption">WORKSPACE</div>
   <div className="nav-item active"><Map size={18}/> Análise geoespacial <span className="nav-line"/></div>
   <div className="nav-item inactive"><Layers3 size={18}/> Sentinel-2 L2A</div>
   {authenticated&&history.length>0&&<><div className="nav-caption">ANÁLISES RECENTES</div><div className="history-list">{history.slice(0,5).map(item=><button key={item.id} className={'history-item '+(analysisId===item.id?'selected':'')} disabled={loading||item.status==='error'||item.status==='uploading'} onClick={()=>{setError('');void loadAnalysis(item.id).catch(e=>setError(e instanceof Error?e.message:'Falha ao abrir análise.'))}}>{item.date||'Sem data'}<small>{item.scene||'Imagem enviada'}</small></button>)}</div></>}
   <div className="sidebar-bottom"><div className="status-dot"/> <span>Pipeline geoespacial ativo</span><p>Identificação exploratória de possíveis cafezais. Sem validação de campo.</p></div>
  </aside>
  <main className="main">
   <header className="topbar"><button className="mobile-menu" onClick={()=>setSidebar(s=>!s)} aria-label="Menu"><Layers3 size={20}/></button>
    <div className="breadcrumb">Monitoramento <span>/</span><strong>Análise de café</strong></div>
    <div className="header-right"><span className="top-status"><span className="live-dot"/> Sentinel-2</span>
    {authenticated?<button className="logout" onClick={logout}><LogOut size={16}/> Sair</button>:<span className="visitor">Acesso seguro</span>}</div>
   </header>
   <div className="content">
    <section className="hero"><div><div className="eyebrow"><span className="eyebrow-line"/> INTELIGÊNCIA GEOSPACIAL <span className="eyebrow-number">/ 01</span></div>
      <h1>Encontre padrões.<br/><em>Explore o território.</em></h1>
      <p>Use dados multiespectrais Sentinel-2 e classificação automatizada para identificar áreas candidatas ao cultivo de café.</p></div>
      <div className="hero-icon"><Compass size={48} strokeWidth={1.2}/></div>
    </section>
    {!authenticated?<section className="signin"><ShieldCheck size={28}/><div><h2>Entre para acessar o workspace</h2><p>Autenticação com Google, validação no servidor e dados de análise privados por usuário.</p></div>
     <button className="primary-action login-google" disabled={isPending} onClick={async()=>{
      setError('');try{
       const {error}=await authClient.signIn.social({provider:'google',callbackURL:'/'});
       if(error)setError(error.message || 'Erro ao iniciar login Google.');
      }catch(e){setError(e instanceof Error?e.message:'Falha no login Google.')}
     }}>{isPending?'Verificando sessão…':'Entrar com Google'} <ArrowRight size={17}/></button>
    </section>:<>
     <div className="section-heading"><div><span>01 / ENTRADA DE DADOS</span><h2>Nova análise</h2></div><p>Selecione uma demonstração ou envie seu GeoTIFF.</p></div>
     <div className="entry-grid">
      <section className="panel demo"><div className="panel-icon lime"><FileImage size={23}/></div><div className="panel-label">EXPLORAR CENAS REAIS</div><h3>Comece com uma imagem</h3><p>Processamento integral de cenas reais da região de Guaxupé, MG.</p>
       <div className="select-wrap"><select value={selectedScene} onChange={e=>setSelectedScene(e.target.value)} disabled={loading} aria-label="Cena de demonstração">{Object.entries(dateLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><ChevronDown size={16}/></div>
       <button className="primary-action" disabled={loading} onClick={processDemo}>{loading?'Processando…':'Analisar demonstração'}<ArrowRight size={17}/></button>
      </section>
      <section className="panel upload"><div className="panel-icon blue"><CloudUpload size={23}/></div><div className="panel-label">SEUS DADOS</div><h3>Envie seu GeoTIFF</h3><p>Quatro bandas B02/B03/B04/B08. Até 12 MB por imagem; transferência direta ao armazenamento privado.</p>
       <input ref={selectedInput} type="file" accept=".tif,.tiff,image/tiff" hidden onChange={e=>setImage(e.target.files?.[0]??null)}/>
       <button className="file-pick" onClick={()=>selectedInput.current?.click()}><UploadCloud size={17}/>{image?image.name:'Escolher arquivo multiespectral'}</button>
       <div className="input-row"><label>Máscara SCL <small>opcional</small><input type="file" accept=".tif,.tiff" onChange={e=>setScl(e.target.files?.[0]??null)}/></label><label>Data da imagem<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>
       <button className="secondary-action" disabled={loading||!image} onClick={processUpload}>Processar arquivo <ArrowRight size={17}/></button>
      </section>
     </div>
     {loading&&<div className="info-state"><div className="spinner"/><span>Enviando/validando a imagem e aguardando o processamento real. No Render gratuito, a primeira execução pode levar mais tempo…</span></div>}
     {error&&<div className="error-state" role="alert"><TriangleAlert size={20}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Fechar"><X size={18}/></button></div>}
     <div className="section-heading result-heading"><div><span>02 / RESULTADOS</span><h2>Visão territorial</h2></div>{analysis&&<div className="result-chip"><CheckCircle2 size={15}/> Análise concluída</div>}</div>
     {analysis?<>
       <div className="metric-grid"><Metric icon={<Leaf size={22}/>} label="ÁREA CANDIDATA" value={number(analysis.result.candidate_area_ha)} unit="ha"/>
       <Metric icon={<Layers3 size={22}/>} label="POLÍGONOS" value={String(analysis.result.candidate_polygon_count)}/>
       <Metric icon={<Activity size={22}/>} label="NDVI MEDIANO" value={analysis.result.ndvi_median===null?'—':number(analysis.result.ndvi_median,3)}/>
       <Metric icon={<Map size={22}/>} label="DATA DA IMAGEM" value={analysis.result.acquisition_date??'Não informada'}/></div>
       <div className="map-layout"><div className="map-panel"><div className="map-top"><div><span className="small-dot"/> CAMADA SATELITAL + POLÍGONOS</div><span>EPSG:4326 · Leaflet</span></div>
        <SatelliteMap bounds={center} geojson={geojson as FeatureCollection} overlay={mapOverlay}/>
        <div className="map-footer"><span><i className="legend-highlight"/> Área candidata (não confirmada)</span><span>Fonte: Copernicus / Sentinel-2</span></div></div>
        <div className="details-panel"><div className="details-top"><span className="panel-label">RESULTADOS EXPORTÁVEIS</span><h3>Arquivos da análise</h3><p>Dados produzidos a partir dos pixels enviados, sem coordenadas pré-calculadas.</p></div>
        <button className="download" onClick={()=>download('geojson')}><Layers3 size={19}/><div><strong>Polígonos GeoJSON</strong><small>EPSG:4326 · áreas individuais</small></div><ArrowDownToLine size={18}/></button>
        <button className="download" onClick={()=>download('classified')}><FileImage size={19}/><div><strong>Imagem classificada</strong><small>PNG · contornos sobre a cena</small></div><ArrowDownToLine size={18}/></button>
        <button className="download" onClick={()=>download('tif')}><BookOpen size={19}/><div><strong>Raster classificado</strong><small>GeoTIFF · pixels e CRS</small></div><ArrowDownToLine size={18}/></button>
        <div className="caveat"><TriangleAlert size={17}/><div><strong>Interpretação responsável</strong><p>Estes polígonos são candidatos, não cafezais comprovados. Scores de modelo não equivalem a confiança calibrada.</p></div></div></div></div>
       <div className="section-heading chat-heading"><div><span>03 / ASSISTENTE</span><h2>Converse com os resultados</h2></div></div>
       <section className="chat-panel"><div className="chat-header"><span className="bot-badge"><Sparkles size={17}/></span><div><strong>Assistente de análise</strong><small>Respostas ancoradas nos dados da cena</small></div><span className="chat-ready">● Pronto</span></div>
       <div className="chat-messages" aria-live="polite">{classifiedPreview&&<div className="chat-image"><img src={classifiedPreview} alt="Imagem processada com polígonos candidatos de café"/><div><strong>Classificação desta cena</strong><small>Contornos computados no servidor · toque em exportar para baixar</small></div></div>}{messages.map((m,i)=><div key={i} className={'chat-message '+m.role}><div className="chat-bubble">{m.text}{m.mode==='rules_fallback_not_ai'&&<div className="fallback-note">Resposta determinística · IA generativa não configurada</div>}</div></div>)}{chatLoading&&<div className="chat-message bot"><div className="chat-bubble">Analisando a pergunta…</div></div>}</div>
       <form className="chat-form" onSubmit={e=>{e.preventDefault();void sendQuestion()}}><MessageCircle size={20}/><input value={question} onChange={e=>setQuestion(e.target.value)} disabled={chatLoading} placeholder="Ex.: Qual a área estimada? Quais as limitações?"/><button type="submit" disabled={!question.trim()||chatLoading} aria-label="Enviar"><Send size={19}/></button></form></section>
       </>:<div className="empty-result"><div className="empty-symbol"><Layers3 size={30}/></div><h3>Sua análise aparece aqui</h3><p>Escolha uma das cenas de demonstração ou envie um arquivo para visualizar os resultados.</p></div>}
    </>}
    {error&&!authenticated&&<div className="error-state"><TriangleAlert size={18}/>{error}</div>}
    <footer><span>GLOBAL WATCH / GEOINTELLIGENCE</span><span>Dados demonstrativos de café · uso exploratório · 2026</span></footer>
   </div>
  </main>
 </div>;
}
