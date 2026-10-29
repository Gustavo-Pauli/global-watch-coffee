'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, History, Layers, LoaderCircle, LogOut, MapPin, Menu, Plus, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import AnalysisForm from './AnalysisForm';
import ResultsPanel from './ResultsPanel';
import type { AnalysisData, Bounds, ChatMessage, DownloadKind, HistoryItem, WorkStage } from './analysis-types';
import { formatDate, sceneDate, sceneLabel, STATUS_LABELS } from './analysis-types';

const SatelliteMap = dynamic(() => import('./SatelliteMap'), { ssr: false, loading: () => <div className="map-loading"><LoaderCircle className="spin" size={20} /><span>Carregando mapa…</span></div> });
const DEFAULT_BOUNDS: Bounds = [[-21.38, -46.73], [-21.28, -46.61]];
const EMPTY_GEOJSON = { type: 'FeatureCollection' as const, features: [] };
type SignedUpload = { signedUrl: string; path: string; token: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'Não foi possível concluir a operação. Tente novamente.');
  return body as T;
}
function aborted(error: unknown) { return error instanceof DOMException && error.name === 'AbortError'; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'; }
function wait(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export default function Dashboard() {
  const { data: session, isPending } = authClient.useSession();
  const authenticated = Boolean(session?.user);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stage, setStage] = useState<WorkStage>(null);
  const [error, setError] = useState('');
  const [overlay, setOverlay] = useState<string | null>(null);
  const [showRaster, setShowRaster] = useState(true);
  const [showPolygons, setShowPolygons] = useState(true);
  const [panel, setPanel] = useState<'new' | 'result' | 'about'>('new');
  const [resultTab, setResultTab] = useState<'results' | 'chat'>('results');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [downloading, setDownloading] = useState<DownloadKind | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const identity = useRef<string | null | undefined>(undefined);
  const selectedRef = useRef<string | null>(null);
  const overlayRef = useRef<string | null>(null);
  const chatOperation = useRef<AbortController | null>(null);
  const historySidebar = useRef<HTMLElement | null>(null);
  const accountGeneration = useRef(0);

  const clearOverlay = useCallback(() => {
    if (overlayRef.current) URL.revokeObjectURL(overlayRef.current);
    overlayRef.current = null; setOverlay(null);
  }, []);
  const clearSelection = useCallback(() => {
    operation.current?.abort(); chatOperation.current?.abort();
    setAnalysis(null); setSelectedId(null); selectedRef.current = null; setStage(null);
    setMessages([]); setQuestion(''); setChatLoading(false); setDownloading(null); clearOverlay();
  }, [clearOverlay]);
  useEffect(() => {
    const user = session?.user.id ?? null;
    if (identity.current !== undefined && identity.current !== user) {
      accountGeneration.current += 1;
      clearSelection(); setHistory([]); setError(''); setPanel('new');
    }
    identity.current = user;
  }, [session?.user.id, clearSelection]);
  useEffect(() => () => { operation.current?.abort(); chatOperation.current?.abort(); if (overlayRef.current) URL.revokeObjectURL(overlayRef.current); }, []);
  useEffect(() => {
    if (!sidebarOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => Array.from(historySidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { setSidebarOpen(false); return; }
      if (event.key !== 'Tab') return;
      const items = controls();
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [sidebarOpen]);

  const refreshHistory = useCallback(async () => {
    if (!session?.user.id) return;
    const user = session.user.id; setHistoryLoading(true);
    try {
      const items = await request<HistoryItem[]>('/api/analyses');
      if (identity.current === user) { setHistory(items); setHistoryError(''); }
    } catch { if (identity.current === user) setHistoryError('Histórico indisponível. Tente atualizar.'); }
    finally { if (identity.current === user) setHistoryLoading(false); }
  }, [session?.user.id]);
  useEffect(() => { if (authenticated) void refreshHistory(); else setHistory([]); }, [authenticated, refreshHistory]);
  useEffect(() => {
    if (!authenticated || !history.some(item => item.status === 'processing')) return;
    const timer = setInterval(() => void refreshHistory(), 15000);
    return () => clearInterval(timer);
  }, [authenticated, history, refreshHistory]);

  const openAnalysis = useCallback(async (id: string) => {
    operation.current?.abort(); chatOperation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    const signal = controller.signal;
    setSelectedId(id); selectedRef.current = id; setAnalysis(null); clearOverlay();
    setPanel('result'); setResultTab('results'); setSidebarOpen(false); setStage('opening'); setError('');
    setMessages([]); setQuestion(''); setChatLoading(false);
    try {
      const deadline = Date.now() + 11 * 60 * 1000;
      let data: AnalysisData | null = null;
      while (Date.now() < deadline) {
        const response = await fetch(`/api/analyses/${id}`, { credentials: 'same-origin', cache: 'no-store', signal });
        const body = await response.json().catch(() => null);
        if (response.status === 202) {
          if (body?.analysis?.status === 'uploading') throw new Error('O envio desta análise não foi concluído. Inicie uma nova análise para reenviar os arquivos.');
          setStage('processing'); await wait(signal, 4000); continue;
        }
        if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'Não foi possível carregar esta análise.');
        data = body as AnalysisData; break;
      }
      if (!data) throw new Error('A análise ainda está em processamento. Você pode abri-la novamente pelo histórico.');
      if (signal.aborted) return;
      setAnalysis(data); setStage(null); setShowRaster(true); setShowPolygons(true);
      const image = await fetch(`/api/analyses/${id}/files/map`, { credentials: 'same-origin', cache: 'no-store', signal });
      if (!image.ok) throw new Error('A imagem de fundo não pôde ser carregada. Os polígonos e os resultados continuam disponíveis.');
      const blob = await image.blob(); if (signal.aborted) return;
      const url = URL.createObjectURL(blob); overlayRef.current = url; setOverlay(url);
    } catch (caught) { if (!aborted(caught) && !signal.aborted) setError(errorMessage(caught)); }
    finally { if (!signal.aborted) { setStage(null); void refreshHistory(); } }
  }, [clearOverlay, refreshHistory]);

  async function processDemo(scene: string) {
    if (!authenticated || stage) return;
    clearSelection(); setStage('preparing'); setError('');
    const controller = new AbortController(); operation.current = controller;
    try {
      const response = await request<{ id: string }>('/api/analysis/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene }), signal: controller.signal });
      void refreshHistory(); await openAnalysis(response.id);
    } catch (caught) { if (!aborted(caught)) { setError(errorMessage(caught)); setStage(null); void refreshHistory(); } }
  }
  async function directUpload(file: File, signature: SignedUpload, signal: AbortSignal) {
    const form = new FormData(); form.append('cacheControl', '3600'); form.append('', file, file.name);
    const response = await fetch(signature.signedUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form, signal });
    if (!response.ok) throw new Error(`Não foi possível enviar ${file.name}. O armazenamento retornou ${response.status}.`);
  }
  async function processUpload(image: File, scl: File | null, date: string) {
    if (!authenticated || stage) return;
    clearSelection(); setStage('preparing'); setError('');
    const controller = new AbortController(); operation.current = controller;
    try {
      const prepared = await request<{ id: string; uploads: { image: SignedUpload; scl?: SignedUpload } }>('/api/analysis/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ image: { name: image.name, size: image.size }, scl: scl ? { name: scl.name, size: scl.size } : null, date: date || null }),
      });
      setStage('uploading'); await directUpload(image, prepared.uploads.image, controller.signal);
      if (scl && prepared.uploads.scl) await directUpload(scl, prepared.uploads.scl, controller.signal);
      await request('/api/analysis/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: prepared.id }), signal: controller.signal });
      void refreshHistory(); await openAnalysis(prepared.id);
    } catch (caught) { if (!aborted(caught)) { setError(errorMessage(caught)); setStage(null); void refreshHistory(); } }
  }
  async function download(kind: DownloadKind) {
    if (!authenticated || !selectedId || downloading) return;
    const generation = accountGeneration.current;
    setDownloading(kind); setError('');
    try {
      const response = await fetch(`/api/analyses/${selectedId}/files/${kind}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Download indisponível');
      const blob = await response.blob();
      if (generation !== accountGeneration.current) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url;
      anchor.download = { geojson: 'candidatos.geojson', tif: 'classificacao.tif', classified: 'imagem_classificada.png', rgb: 'imagem_rgb.png' }[kind];
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { if (generation === accountGeneration.current) setError('O arquivo está indisponível. Tente novamente ou execute uma nova análise se os dados expiraram.'); }
    finally { if (generation === accountGeneration.current) setDownloading(null); }
  }
  async function sendQuestion() {
    const text = question.trim(), id = selectedId;
    if (text.length < 2 || !id || !analysis || !authenticated || chatLoading) return;
    const controller = new AbortController(); chatOperation.current = controller;
    setMessages(items => [...items, { role: 'user', text }]); setQuestion(''); setChatLoading(true);
    try {
      const response = await request<{ answer: string; type: string }>(`/api/analyses/${id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text }), signal: controller.signal });
      if (selectedRef.current === id && !controller.signal.aborted) setMessages(items => [...items, { role: 'assistant', text: response.answer, mode: response.type }]);
    } catch (caught) { if (!aborted(caught) && selectedRef.current === id) setMessages(items => [...items, { role: 'assistant', text: errorMessage(caught) }]); }
    finally { if (selectedRef.current === id) setChatLoading(false); }
  }
  async function signIn() {
    if (signingIn || isPending) return;
    setError(''); setSigningIn(true);
    try { const { error } = await authClient.signIn.social({ provider: 'google', callbackURL: '/' }); if (error) { setError(error.message || 'Não foi possível iniciar o login Google.'); setSigningIn(false); } }
    catch (caught) { setError(errorMessage(caught)); setSigningIn(false); }
  }
  async function signOut() {
    setError('');
    try { const { error } = await authClient.signOut(); if (error) throw new Error(error.message || 'Não foi possível encerrar a sessão.'); clearSelection(); setHistory([]); setPanel('new'); }
    catch (caught) { setError(errorMessage(caught)); }
  }
  function newAnalysis() { clearSelection(); setError(''); setPanel('new'); setSidebarOpen(false); }
  const bounds = useMemo(() => analysis?.result.leaflet_bounds ?? DEFAULT_BOUNDS, [analysis]);
  const selectedHistory = history.find(item => item.id === selectedId);
  const busyTransfer = stage === 'uploading' || stage === 'preparing';

  return <div className="workbench">
    <a className="skip-link" href="#workspace-panel">Ir para as ferramentas de análise</a>
    <header className="app-header">
      <div className="app-identity"><button className="icon-button mobile-history" aria-label="Abrir histórico de análises" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span className="brand-symbol" aria-hidden="true"><span /><span /><span /></span><a className="brand-name" href="/">Global Watch <span>Coffee</span></a></div>
      <div className="header-context"><span className="header-divider" /><span>Workspace geoespacial</span></div>
      <div className="header-actions"><button className="icon-button help-button" aria-label="Sobre a análise e os dados" aria-pressed={panel === 'about'} onClick={() => setPanel(panel === 'about' ? (analysis ? 'result' : 'new') : 'about')}><CircleHelp size={18} /></button><span className="prototype-label">Uso exploratório</span></div>
    </header>
    <div className="workspace-grid">
      {sidebarOpen && <button className="drawer-backdrop" aria-label="Fechar histórico" onClick={() => setSidebarOpen(false)} />}
      <aside ref={historySidebar} className={'history-sidebar' + (sidebarOpen ? ' is-open' : '')} aria-label="Histórico de análises" role={sidebarOpen ? 'dialog' : undefined} aria-modal={sidebarOpen || undefined}>
        <div className="sidebar-title"><h2><History size={17} /> Análises</h2><button className="icon-button mobile-close" aria-label="Fechar histórico" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
        <button className="button new-analysis-button" disabled={busyTransfer} onClick={newAnalysis}><Plus size={17} /> Nova análise</button>
        <div className="history-caption"><span>Recentes</span>{authenticated && <button className="text-action" disabled={historyLoading} onClick={() => void refreshHistory()}>{historyLoading ? 'Atualizando…' : 'Atualizar'}</button>}</div>
        <div className="history-items">
          {authenticated ? history.length ? history.map(item => <button key={item.id} disabled={busyTransfer} onClick={() => void openAnalysis(item.id)} className={'history-row' + (selectedId === item.id ? ' is-selected' : '')} aria-current={selectedId === item.id ? 'true' : undefined}>
            <span className={'history-status status-dot ' + item.status} /><span className="history-row-text"><strong>{formatDate(sceneDate(item.scene, item.date))}</strong><span>{sceneLabel(item.scene)}</span><small>{STATUS_LABELS[item.status]}</small></span><ChevronRight size={14} />
          </button>) : <div className="history-empty"><Layers size={22} /><h3>{historyLoading ? 'Carregando análises' : 'Seu histórico começa aqui'}</h3><p>As análises que você executar ficam disponíveis por até 3 dias.</p></div> : <div className="history-empty"><Layers size={22} /><h3>Um lugar para suas análises</h3><p>Entre com Google para processar imagens e recuperar seus resultados.</p></div>}
          {historyError && <p role="status" className="history-error">{historyError}</p>}
        </div>
        <div className="sidebar-method"><span className="section-label">Sobre o resultado</span><p>Áreas candidatas a café.<br />A confirmação depende de campo.</p><button className="text-action" onClick={() => { setPanel('about'); setSidebarOpen(false); }}>Método e limitações <ArrowRight size={14} /></button></div>
        <div className="sidebar-account">{authenticated ? <><div className="user-initial">{session?.user.name?.slice(0, 1).toLocaleUpperCase() || 'U'}</div><div className="account-label"><strong>{session?.user.name || 'Minha conta'}</strong><span>Sessão Google</span></div><button className="icon-button" onClick={() => void signOut()} aria-label="Sair da conta"><LogOut size={17} /></button></> : <><ShieldCheck size={18} /><span>{isPending ? 'Verificando sessão…' : 'Acesso privado por conta'}</span></>}</div>
      </aside>
      <main className="map-workspace" aria-label="Visualização geográfica">
        <div className="map-toolbar"><div className="location-label"><MapPin size={16} /><span>{analysis ? sceneLabel(analysis.analysis.scene) : 'Região de referência'}<strong>{analysis ? formatDate(analysis.result.acquisition_date ?? analysis.analysis.date) : 'Guaxupé, Minas Gerais'}</strong></span></div>{analysis ? <span className="toolbar-state"><span className="status-dot ready" /> Concluída</span> : <span className="toolbar-note">{stage ? 'Análise em andamento' : 'Mapa de localização'}</span>}</div>
        <div className="map-canvas"><SatelliteMap bounds={bounds} geojson={analysis?.geojson ?? EMPTY_GEOJSON} overlay={overlay} showRaster={showRaster} showPolygons={showPolygons} />
          {analysis && <div className="map-layer-controls" aria-label="Camadas do mapa"><span><Layers size={15} /> Camadas</span><label><input type="checkbox" checked={showRaster} onChange={event => setShowRaster(event.target.checked)} disabled={!overlay} /><span>Imagem processada</span></label><label><input type="checkbox" checked={showPolygons} onChange={event => setShowPolygons(event.target.checked)} /><span>Áreas candidatas</span></label></div>}
          {!analysis && !stage && <div className="map-empty-note"><span className="map-locator" aria-hidden="true" /><div><strong>Explore a partir de uma imagem</strong><span>O mapa exibirá os pixels e os candidatos da sua análise.</span></div></div>}
          {stage && <div className="map-processing" role="status"><LoaderCircle size={16} className="spin" /><span>{stage === 'uploading' ? 'Enviando arquivos ao armazenamento privado' : stage === 'preparing' ? 'Preparando sua análise' : stage === 'opening' ? 'Carregando resultados' : 'Processando a imagem no worker'}</span></div>}
        </div>
        <div className="map-statusbar"><span>{analysis ? <><i className="legend-swatch" /> Candidatos a café · sem validação de campo</> : 'Nenhuma camada de análise selecionada'}</span><span>{analysis ? `${analysis.analysis.scene ? 'Sentinel-2' : 'Imagem enviada'} · WGS 84` : 'Mapa de referência · OpenStreetMap'}</span></div>
      </main>
      <aside id="workspace-panel" className="context-panel" aria-label="Ferramentas e resultados" tabIndex={-1}>
        {error && <div className="error-message" role="alert"><TriangleAlert size={17} /><span>{error}</span><button className="icon-button" aria-label="Fechar mensagem de erro" onClick={() => setError('')}><X size={15} /></button></div>}
        {panel === 'about' ? <div className="about-panel"><button className="text-action" onClick={() => setPanel(analysis ? 'result' : 'new')}><ArrowLeft size={15} /> Voltar</button><div className="panel-heading"><span className="section-label">Método e limites</span><h1>Uma leitura exploratória do território</h1><p>Esta ferramenta aponta áreas que se assemelham aos padrões de café aprendidos pelo modelo.</p></div><section><h2>Do pixel ao polígono</h2><p>Imagens multiespectrais, índices como NDVI e classificação Random Forest geram pixels candidatos. Esses pixels são agrupados em polígonos, com área estimada em hectares.</p></section><section><h2>O que o mapa não comprova</h2><p>Os resultados podem confundir café, floresta e outras coberturas vegetais. Os rótulos de referência têm resolução de 30 m e não substituem verificação em campo.</p><p>O score do modelo não é confiança calibrada. A aplicação não calcula clima, alertas ou evolução temporal.</p></section><section><h2>Seus dados</h2><p>O acesso é vinculado à sua conta. Arquivos são privados e ficam disponíveis por até 3 dias. Links de download têm validade curta.</p></section></div>
        : !authenticated ? <div className="signin-panel"><div className="panel-heading"><span className="section-label">Seu workspace</span><h1>Análise de café,<br />a partir do território.</h1><p>Processe uma cena Sentinel-2, explore os candidatos no mapa e consulte os resultados.</p></div><ol className="signin-steps"><li><span>01</span><div><strong>Escolha uma imagem</strong><p>Use uma cena real de demonstração ou envie seu GeoTIFF.</p></div></li><li><span>02</span><div><strong>Explore o resultado</strong><p>Polígonos, hectares, NDVI e arquivos para download.</p></div></li><li><span>03</span><div><strong>Consulte os dados</strong><p>Entenda os números e as limitações desta análise.</p></div></li></ol><button className="button button-primary google-signin" disabled={isPending || signingIn} onClick={() => void signIn()}>{isPending || signingIn ? <LoaderCircle size={17} className="spin" /> : <span className="google-letter" aria-hidden="true">G</span>}{isPending ? 'Verificando sessão' : signingIn ? 'Abrindo Google' : 'Continuar com Google'}<ArrowRight size={16} /></button><p className="signin-note"><ShieldCheck size={14} /> Análises privadas, vinculadas à sua conta.</p><div className="signin-caveat">Identificação de áreas candidatas.<br />Não confirma a presença de cafezais.</div></div>
        : stage && panel === 'result' ? <div className="processing-panel"><span className="section-label">{selectedHistory ? formatDate(sceneDate(selectedHistory.scene, selectedHistory.date)) : 'Análise em execução'}</span><LoaderCircle size={27} className="processing-spinner spin" /><h1>{stage === 'opening' ? 'Carregando sua análise' : 'Lendo a imagem, pixel a pixel.'}</h1><p>{stage === 'opening' ? 'Recuperando os resultados e os arquivos privados.' : 'O worker está classificando a cena e produzindo os arquivos geoespaciais.'}</p><div className="processing-steps"><div><Check size={15} /><span>Análise recebida</span></div><div className="current"><LoaderCircle size={15} className="spin" /><span>{stage === 'opening' ? 'Carregando resultados' : 'Processamento e arquivos'}</span></div><div><span className="step-pending" /><span>Resultado disponível no mapa</span></div></div><p className="processing-help">A primeira execução pode levar mais tempo enquanto o serviço inicia. A análise permanece no histórico se você sair desta tela.</p></div>
        : panel === 'result' && analysis ? <ResultsPanel analysis={analysis} tab={resultTab} setTab={setResultTab} download={download} downloading={downloading} messages={messages} question={question} setQuestion={setQuestion} sendQuestion={sendQuestion} chatLoading={chatLoading} />
        : panel === 'result' && selectedId ? <div className="unavailable-panel"><TriangleAlert size={24} /><h1>Análise indisponível</h1><p>Consulte a mensagem acima ou execute uma nova análise. Seus outros resultados continuam no histórico.</p><button className="button button-primary" onClick={newAnalysis}><Plus size={17} /> Nova análise</button></div>
        : <><AnalysisForm disabled={Boolean(stage)} onDemo={processDemo} onUpload={processUpload} />{stage && <div className="transfer-state" role="status"><LoaderCircle size={17} className="spin" />{stage === 'uploading' ? 'Enviando arquivos diretamente ao Storage…' : 'Preparando e iniciando o processamento…'}</div>}</>}
      </aside>
    </div>
  </div>;
}
