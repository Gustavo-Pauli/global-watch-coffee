'use client';

import { useEffect, useRef } from 'react';
import { ArrowDownToLine, ArrowUpRight, ArrowUp, FileImage, FileJson, Layers, LoaderCircle, MessageSquare, TriangleAlert } from 'lucide-react';
import type { AnalysisData, ChatMessage, DownloadKind } from './analysis-types';
import { formatDate, formatNumber, sceneLabel } from './analysis-types';

type Props = {
  analysis: AnalysisData;
  tab: 'results' | 'chat';
  setTab: (tab: 'results' | 'chat') => void;
  download: (kind: DownloadKind) => Promise<void>;
  downloading: DownloadKind | null;
  messages: ChatMessage[];
  question: string;
  setQuestion: (value: string) => void;
  sendQuestion: () => Promise<void>;
  chatLoading: boolean;
};

export default function ResultsPanel({ analysis, tab, setTab, download, downloading, messages, question, setQuestion, sendQuestion, chatLoading }: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (tab === 'chat') end.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }); }, [messages, chatLoading, tab]);
  const result = analysis.result;
  const questions = ['Qual é a área candidata?', 'Como interpretar o NDVI?', 'Quais são as limitações?'];
  return <div className={'results-panel' + (tab === 'chat' ? ' chat-active' : '')}>
    <div className="panel-tabs" role="tablist" aria-label="Detalhes da análise" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'results' : event.key === 'End' ? 'chat' : tab === 'results' ? 'chat' : 'results';
      setTab(next); requestAnimationFrame(() => document.getElementById(`${next}-tab`)?.focus());
    }}>
      <button id="results-tab" role="tab" tabIndex={tab === 'results' ? 0 : -1} aria-selected={tab === 'results'} aria-controls="results-content" onClick={() => setTab('results')}>Resultados</button>
      <button id="chat-tab" role="tab" tabIndex={tab === 'chat' ? 0 : -1} aria-selected={tab === 'chat'} aria-controls="chat-content" onClick={() => setTab('chat')}><MessageSquare size={15} /> Consultar análise</button>
    </div>
    {tab === 'results' ? <div id="results-content" role="tabpanel" aria-labelledby="results-tab" className="result-content">
      <div className="panel-heading"><span className="section-label">{sceneLabel(analysis.analysis.scene)}</span><h1>{formatDate(result.acquisition_date ?? analysis.analysis.date, true)}</h1><p className="completion-line"><span className="status-dot ready" /> Processamento concluído</p></div>
      <section className="primary-measure" aria-label="Área candidata"><span>Área candidata a café</span><strong>{formatNumber(result.candidate_area_ha)}<small>ha</small></strong><p>Estimativa da área dos polígonos detectados.</p></section>
      <dl className="result-measures"><div><dt>Polígonos candidatos</dt><dd>{formatNumber(result.candidate_polygon_count, 0)}</dd></div><div><dt>NDVI mediano</dt><dd>{result.ndvi_median === null ? 'Indisponível' : formatNumber(result.ndvi_median, 3)}</dd></div><div><dt>Pixels válidos</dt><dd>{formatNumber(result.valid_pixels, 0)}</dd></div></dl>
      <section className="downloads-section"><div className="section-title"><h2>Arquivos da análise</h2><ArrowDownToLine size={15} /></div>
        {([
          ['geojson', 'Polígonos', 'GeoJSON · coordenadas WGS 84', FileJson],
          ['classified', 'Imagem classificada', 'PNG · contornos sobre a imagem', FileImage],
          ['tif', 'Raster classificado', 'GeoTIFF · pixels e referência espacial', Layers],
          ['rgb', 'Imagem em cor natural', 'PNG · composição RGB', FileImage],
        ] as const).map(([kind, label, hint, Icon]) => <button key={kind} className="download-row" onClick={() => void download(kind)} disabled={downloading !== null}>
          <Icon size={17} /><span><strong>{label}</strong><small>{hint}</small></span>{downloading === kind ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}
        </button>)}
      </section>
      <section className="model-notice"><TriangleAlert size={16} /><div><h2>Candidatos, não confirmação</h2><p>{result.limitations || 'A classificação não substitui a verificação em campo. Café e outras coberturas vegetais podem ser confundidos.'}</p><p>O score do modelo não representa confiança calibrada.</p></div></section>
      <button className="text-action result-chat-link" onClick={() => setTab('chat')}>Consultar estes resultados <ArrowUpRight size={16} /></button>
    </div> : <div id="chat-content" role="tabpanel" aria-labelledby="chat-tab" className="chat-content">
      <div className="chat-intro"><span className="section-label">Assistente da análise</span><h2>Pergunte aos resultados</h2><p>Consulte área, NDVI, método e limitações desta imagem.</p></div>
      <div className="chat-messages" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 && <div className="chat-start"><p>Use uma sugestão ou escreva sua pergunta.</p><div className="suggested-questions">{questions.map(text => <button key={text} onClick={() => setQuestion(text)}>{text}<ArrowUpRight size={14} /></button>)}</div></div>}
        {messages.map((message, index) => <div key={index} className={'chat-message ' + message.role}><span className="message-author">{message.role === 'user' ? 'Você' : 'Assistente'}</span><p>{message.text}</p>{message.mode === 'rules_fallback_not_ai' && <small className="fallback-note">Resposta por regras · IA generativa indisponível</small>}{message.mode === 'ai_grounded' && <small className="answer-source">IA · contexto desta análise</small>}</div>)}
        {chatLoading && <div className="chat-thinking"><LoaderCircle size={15} className="spin" /> Consultando os dados…</div>}
        <div ref={end} />
      </div>
      <form className="chat-form" onSubmit={event => { event.preventDefault(); void sendQuestion(); }}><label className="sr-only" htmlFor="chat-question">Pergunta sobre a análise</label><textarea id="chat-question" rows={2} value={question} onChange={event => setQuestion(event.target.value)} minLength={2} maxLength={1200} disabled={chatLoading} placeholder="Pergunte sobre esta imagem…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendQuestion(); } }} /><button className="button button-primary" type="submit" aria-label="Enviar pergunta" disabled={question.trim().length < 2 || chatLoading}><ArrowUp size={17} /></button></form>
      <p className="chat-footnote">Respostas limitadas aos dados e às limitações da análise.</p>
    </div>}
  </div>;
}
