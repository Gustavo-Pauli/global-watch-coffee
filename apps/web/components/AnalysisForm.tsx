'use client';

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Check, FileUp, LoaderCircle, X } from 'lucide-react';
import { SCENES, formatDate } from './analysis-types';

type Props = {
  disabled: boolean;
  onDemo: (scene: string) => Promise<void>;
  onUpload: (image: File, scl: File | null, date: string) => Promise<void>;
};

function FileField({ label, hint, file, maxBytes, onChange }: {
  label: string; hint: string; file: File | null; maxBytes: number; onChange: (file: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  function select(file: File | null) {
    setError('');
    if (file && (!/\.tiff?$/i.test(file.name) || !file.size || file.size > maxBytes)) {
      setError(`Escolha um TIFF válido de até ${maxBytes / 1024 / 1024} MiB.`);
      if (input.current) input.current.value = '';
      return;
    }
    onChange(file);
  }
  return <div className="field-group">
    <span className="field-label">{label}</span>
    <input ref={input} className="sr-only" aria-label={label} type="file" accept=".tif,.tiff,image/tiff"
      onChange={event => select(event.target.files?.[0] ?? null)} />
    <div className={'file-control' + (file ? ' has-file' : '')}>
      <button type="button" className="file-select" onClick={() => input.current?.click()}>
        {file ? <Check size={17} /> : <FileUp size={17} />}
        <span><strong>{file?.name ?? 'Selecionar arquivo'}</strong><small>{file ? `${(file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MiB` : 'GeoTIFF · .tif ou .tiff'}</small></span>
      </button>
      {file && <button className="icon-button" type="button" aria-label={`Remover ${label}`} onClick={() => { select(null); if (input.current) input.current.value = ''; }}><X size={16} /></button>}
    </div>
    <p className="field-hint">{hint}</p>
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

export default function AnalysisForm({ disabled, onDemo, onUpload }: Props) {
  const [mode, setMode] = useState<'demo' | 'upload'>('demo');
  const [scene, setScene] = useState('august');
  const [image, setImage] = useState<File | null>(null);
  const [scl, setScl] = useState<File | null>(null);
  const [date, setDate] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    if (mode === 'demo') await onDemo(scene);
    else if (image) await onUpload(image, scl, date);
  }
  return <form className="analysis-form" onSubmit={submit}>
    <div className="panel-heading"><span className="section-label">Entrada de dados</span><h1>Nova análise</h1><p>Identifique áreas candidatas a café a partir de uma imagem multiespectral.</p></div>
    <div className="segmented-control" aria-label="Origem dos dados">
      <button type="button" aria-pressed={mode === 'demo'} disabled={disabled} onClick={() => setMode('demo')}>Demonstração</button>
      <button type="button" aria-pressed={mode === 'upload'} disabled={disabled} onClick={() => setMode('upload')}>Enviar GeoTIFF</button>
    </div>
    <fieldset disabled={disabled}>
      {mode === 'demo' ? <div className="demo-fields">
        <div className="field-intro"><h2>Cenas de Guaxupé, MG</h2><p>Imagens reais Sentinel-2. Cada execução processa os pixels da cena escolhida.</p></div>
        <div className="scene-options">{SCENES.map(item => <label key={item.value} className={'scene-option' + (scene === item.value ? ' selected' : '')}>
          <input type="radio" name="scene" value={item.value} checked={scene === item.value} onChange={() => setScene(item.value)} />
          <span className="scene-radio" aria-hidden="true">{scene === item.value && <span />}</span>
          <span className="scene-option-text"><strong>{formatDate(item.date, true)}</strong><small>{item.description}</small></span>
        </label>)}</div>
        <div className="input-spec"><span>Sensor</span><strong>Sentinel-2 L2A</strong><span>Bandas</span><strong>B02 · B03 · B04 · B08</strong><span>Qualidade</span><strong>Máscara SCL incluída</strong></div>
      </div> : <div className="upload-fields">
        <div className="field-intro"><h2>Arquivos da imagem</h2><p>Quatro bandas nesta ordem: B02, B03, B04 e B08. O arquivo deve conter um CRS projetado.</p></div>
        <FileField label="Imagem multiespectral" hint="Obrigatório · 4 bandas · até 12 MiB" file={image} maxBytes={12 * 1024 * 1024} onChange={setImage} />
        <FileField label="Máscara SCL (opcional)" hint="Uma banda de classificação de cena · até 4 MiB" file={scl} maxBytes={4 * 1024 * 1024} onChange={setScl} />
        <label className="field-group"><span className="field-label">Data de aquisição <span className="muted">(opcional)</span></span><input className="text-input" type="date" value={date} onChange={event => setDate(event.target.value)} /><span className="field-hint">Informe a data da imagem, se conhecida.</span></label>
      </div>}
    </fieldset>
    <button className="button button-primary start-analysis" disabled={disabled || (mode === 'upload' && !image)} type="submit">
      {disabled ? <><LoaderCircle size={17} className="spin" /> Preparando análise</> : <>Iniciar análise <ArrowRight size={17} /></>}
    </button>
    <p className="retention-note">Arquivos privados, disponíveis por até 3 dias. Os resultados indicam candidatos e precisam de verificação em campo.</p>
  </form>;
}
