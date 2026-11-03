"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { errorMessage } from "@/lib/client-api";
import { LAB_CLASSES, labAssetUrl, type LabClass, type LabReferenceKind, type LabReview, type LabReviewCollection, type LabReviewInput, type LabSample, type LabStudy } from "./types";
import { LabRequestError, labDate, labJSON, labNumber } from "./api";
import { DiscardDialog, LabZoomImage } from "./LabShared";
import styles from "./experiments.module.css";

type Draft = { decision: "class" | "indeterminate" | null; label: LabClass | null; certainty: "high" | "low"; notes: string; referenceKind: LabReferenceKind; blindReview: boolean };
const draftFor = (review?: LabReview): Draft => review ? { decision: review.decision, label: review.label, certainty: review.certainty, notes: review.notes, referenceKind: review.referenceKind, blindReview: review.blindReview } : { decision: null, label: null, certainty: "high", notes: "", referenceKind: "human_visual_interpretation", blindReview: false };

function SampleEditor({ study, sample, existing, onSaved, onConflict, onDirty }: { study: LabStudy; sample: LabSample; existing?: LabReview; onSaved: (review: LabReview) => void; onConflict: () => Promise<LabReviewCollection>; onDirty: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(existing));
  const [color, setColor] = useState<"rgb" | "falseColor">("rgb");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloadDialog, setReloadDialog] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFor(existing));
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const patch = (value: Partial<Draft>) => { setDraft(previous => ({ ...previous, ...value })); setError(""); };
  async function save() {
    if (saving || draft.decision === null || conflict || (!sample.usable && draft.decision === "class")) return;
    setSaving(true); setError("");
    const input: LabReviewInput = { sampleId: sample.id, decision: draft.decision, label: draft.decision === "class" ? draft.label : null, certainty: draft.decision === "indeterminate" ? "low" : draft.certainty, notes: draft.notes, referenceKind: draft.referenceKind, blindReview: draft.blindReview, expectedRevision: existing?.revision || 0 };
    try {
      const result = await labJSON<{ review: LabReview }>(`/api/experiments/${encodeURIComponent(study.id)}/reviews`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      setDraft(draftFor(result.review)); onDirty(false); onSaved(result.review);
    } catch (caught) {
      setError(errorMessage(caught));
      if (caught instanceof LabRequestError && caught.status === 409) {
        setConflict(true);
        try { await onConflict(); } catch { setError("A revisão mudou em outra aba, mas não foi possível carregar a versão atual. Seu rascunho foi preservado."); }
      }
    } finally { setSaving(false); }
  }
  async function reloadSaved() {
    setSaving(true);
    try {
      const fresh = await onConflict();
      setDraft(draftFor(fresh.reviews.find(review => review.sampleId === sample.id)));
      setConflict(false); setError(""); setReloadDialog(false);
    } catch (caught) {
      setReloadDialog(false);
      setError(`Não foi possível carregar a revisão atual. Seu rascunho continua preservado. ${errorMessage(caught)}`);
    } finally { setSaving(false); }
  }
  const regionName = study.regions.find(region => region.id === sample.regionId)?.name || sample.regionId;
  return <section aria-label="Anotação da amostra" data-testid="experiment-review-editor">
    <div className={styles.sampleHeading}><div><h3>{regionName} · {sample.id}</h3><p>Classifique o quadrado de {sample.supportM} × {sample.supportM} m em <strong>{labDate(sample.targetDate)}</strong>.</p></div><div className={styles.viewToggle} aria-label="Visualização das fichas"><button aria-pressed={color === "rgb"} onClick={() => setColor("rgb")}>Cor natural</button><button aria-pressed={color === "falseColor"} onClick={() => setColor("falseColor")}>Falsa cor</button></div></div>
    <div className={styles.frames}>{sample.frames.map((frame, index) => <figure className={`${styles.frame} ${frame.date === sample.targetDate ? styles.frameTarget : ""}`} key={`${frame.date}:${index}`}><LabZoomImage src={labAssetUrl(study.id, color === "rgb" ? frame.rgbAssetId : frame.falseColorAssetId)} alt={`${color === "rgb" ? "Cor natural" : "Falsa cor"} da amostra ${sample.id} em ${labDate(frame.date)}, com o suporte de avaliação em laranja`} title={`${regionName} · ${labDate(frame.date)}`} description={`${color === "rgb" ? "Cor natural" : "Falsa cor"} · Amostra ${sample.id}. O quadrado laranja delimita o suporte de ${sample.supportM} × ${sample.supportM} m. ${frame.date === sample.targetDate ? "Esta é a data da classificação." : `Contexto temporal para a classificação em ${labDate(sample.targetDate)}.`}`} /><figcaption><strong>{labDate(frame.date)}</strong><span>{frame.date === sample.targetDate ? "Data da classificação" : "Contexto temporal"}</span></figcaption></figure>)}</div>
    <p className={styles.reviewNote}>O quadrado laranja delimita a área que será avaliada. As outras datas ajudam a interpretar a paisagem. Marque indeterminado quando houver nuvens, mistura de usos ou dúvida entre pastagem e cultivo. {sample.usable ? "" : "Esta amostra não tem suporte claro suficiente. Registre indeterminado e, se desejar, descreva a limitação nas observações."}</p>
    <div className={styles.reviewForm}>
      <fieldset disabled={saving}><legend>O que ocupa a área na data indicada?</legend><div className={styles.classChoices}>
        {LAB_CLASSES.map(item => <button type="button" key={item.value} disabled={!sample.usable} aria-pressed={draft.decision === "class" && draft.label === item.value} onClick={() => patch({ decision: "class", label: item.value })}>{item.label}</button>)}
        <button type="button" aria-pressed={draft.decision === "indeterminate"} onClick={() => patch({ decision: "indeterminate", label: null, certainty: "low" })}>Indeterminado</button>
      </div><div className={styles.reviewFields}>
        <label className={styles.field}>Certeza<select value={draft.certainty} disabled={draft.decision === "indeterminate"} onChange={event => patch({ certainty: event.target.value as Draft["certainty"] })}><option value="high">Alta</option><option value="low">Baixa / precisa de revisão</option></select></label>
        <label className={styles.field}>Tipo de interpretação<select value={draft.referenceKind} onChange={event => patch({ referenceKind: event.target.value as LabReferenceKind })}><option value="human_visual_interpretation">Interpretação visual humana</option><option value="expert_visual_interpretation">Interpretação visual especializada</option><option value="ai_visual_interpretation">Interpretação assistida por IA</option></select></label>
        <label className={`${styles.field} ${styles.notesField}`}>Observações<textarea value={draft.notes} maxLength={2000} onChange={event => patch({ notes: event.target.value })} placeholder="Evidências observadas, dúvidas ou limitações da imagem…" /></label>
      </div><label className={styles.checkboxNote}><input type="checkbox" checked={draft.blindReview} onChange={event => patch({ blindReview: event.target.checked })} /><span>Declaro que interpretei esta amostra sem consultar previsões do modelo ou rótulos externos. Essa informação registra a condição da minha revisão.</span></label></fieldset>
      <div className={styles.saveRow}><button className={styles.primaryButton} disabled={saving || draft.decision === null || !dirty || conflict || (!sample.usable && draft.decision === "class")} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar revisão"}</button><span className={styles.saveStatus} role="status">{dirty ? "Alterações ainda não salvas" : existing ? <><Check size={12} style={{ display: "inline", verticalAlign: "middle" }} /> Revisão salva · {labDate(existing.updatedAt)}</> : "Selecione uma classe ou marque indeterminado."}</span></div>
      {error && <p className={styles.error} role="alert" style={{ marginTop: 14 }}>{error}</p>}
      {conflict && <div className={styles.conflict}>Sua revisão foi alterada em outra aba. O rascunho desta tela continua preservado. Carregue a versão salva antes de editar novamente.<br /><button className={styles.button} onClick={() => setReloadDialog(true)}>Carregar versão salva</button></div>}
    </div>
    <DiscardDialog open={reloadDialog} onCancel={() => setReloadDialog(false)} onDiscard={() => void reloadSaved()} />
  </section>;
}

export default function ReviewPanel({ study, onDirtyChange }: { study: LabStudy; onDirtyChange: (dirty: boolean) => void }) {
  const [collection, setCollection] = useState<LabReviewCollection | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [regionId, setRegionId] = useState("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(study.samples[0]?.id || "");
  const [dirty, setDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const onDirty = useCallback((value: boolean) => { setDirty(value); onDirtyChange(value); }, [onDirtyChange]);
  useEffect(() => {
    const abort = new AbortController();
    labJSON<LabReviewCollection>(`/api/experiments/${encodeURIComponent(study.id)}/reviews`, { signal: abort.signal }).then(data => { if (!abort.signal.aborted) { setCollection(data); setError(""); } }).catch(caught => { if (!abort.signal.aborted) setError(errorMessage(caught)); });
    return () => abort.abort();
  }, [study.id, attempt]);
  const reviews = useMemo(() => new Map((collection?.reviews || []).map(review => [review.sampleId, review])), [collection]);
  const filtered = useMemo(() => study.samples.filter(sample => (regionId === "all" || sample.regionId === regionId) && (!pendingOnly || !reviews.has(sample.id))), [study.samples, regionId, pendingOnly, reviews]);
  // Keep the current editor mounted when a refresh makes it leave "pending".
  // In particular, a 409 can reveal another tab's saved review while this
  // editor still contains an unsaved draft; filtering must not discard it.
  const sample = study.samples.find(item => item.id === selectedId) || filtered[0];
  const position = sample ? filtered.indexOf(sample) : -1;
  const navigate = (action: () => void) => { if (dirty) setPendingAction(() => action); else action(); };
  async function refreshReviews() { const data = await labJSON<LabReviewCollection>(`/api/experiments/${encodeURIComponent(study.id)}/reviews`); setCollection(data); return data; }
  function saved(review: LabReview) { setCollection(previous => previous ? { reviews: [...previous.reviews.filter(item => item.sampleId !== review.sampleId), review], totalReviewCount: previous.totalReviewCount + (reviews.has(review.sampleId) ? 0 : 1), myReviewedCount: previous.myReviewedCount + (reviews.has(review.sampleId) ? 0 : 1) } : null); }
  if (collection === null) return <div className={styles.review}>{error ? <div className={styles.error} role="alert">{error}<br /><button className={styles.button} onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tentar novamente</button></div> : <div className={styles.loading} role="status">Carregando suas revisões…</div>}</div>;
  return <div className={styles.review} data-testid="experiment-review">
    <div className={styles.reviewToolbar}><div className={styles.reviewProgress}>Minha revisão: <strong>{labNumber(collection.myReviewedCount, 0)} / {labNumber(study.sampleCount, 0)}</strong><br /><span>{labNumber(collection.totalReviewCount, 0)} revisões registradas no estudo. As interpretações de outros revisores não são exibidas aqui.</span></div><a href={`/api/experiments/${encodeURIComponent(study.id)}/reviews/export`} className={styles.button} download><ArrowDownToLine size={15} /> Exportar minhas revisões</a></div>
    <div className={styles.reviewFilters}><label className={styles.field}>Piloto<select aria-label="Filtrar amostras por piloto" value={regionId} onChange={event => { const value = event.target.value; navigate(() => { setRegionId(value); setSelectedId(study.samples.find(item => (value === "all" || item.regionId === value) && (!pendingOnly || !reviews.has(item.id)))?.id || ""); }); }}><option value="all">Todos os pilotos</option>{study.regions.map(region => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label><label className={styles.fieldCheckbox}><input type="checkbox" checked={pendingOnly} onChange={event => { const checked = event.target.checked; navigate(() => { setPendingOnly(checked); setSelectedId(study.samples.find(item => (regionId === "all" || item.regionId === regionId) && (!checked || !reviews.has(item.id)))?.id || ""); }); }} /> Apenas minhas pendentes</label></div>
    <div className={styles.reviewNavigation}><button className={styles.button} aria-label="Amostra anterior" disabled={position <= 0} onClick={() => navigate(() => setSelectedId(filtered[position - 1].id))}><ChevronLeft size={15} /> Anterior</button><span>{position >= 0 ? `${position + 1} de ${filtered.length}` : sample ? `Em revisão · ${filtered.length} pendentes` : `0 de ${filtered.length}`}</span><button className={styles.button} aria-label="Próxima amostra" disabled={filtered.length === 0 || position >= filtered.length - 1} onClick={() => navigate(() => setSelectedId(filtered[Math.max(0, position + 1)].id))}>Próxima <ChevronRight size={15} /></button></div>
    {sample ? <SampleEditor key={sample.id} study={study} sample={sample} existing={reviews.get(sample.id)} onSaved={saved} onConflict={refreshReviews} onDirty={onDirty} /> : <div className={styles.empty} style={{ marginTop: 20 }}>Nenhuma amostra corresponde aos filtros. {pendingOnly ? "Você pode desmarcar o filtro para consultar suas revisões salvas." : ""}</div>}
    <DiscardDialog open={pendingAction !== null} onCancel={() => setPendingAction(null)} onDiscard={() => { onDirty(false); pendingAction?.(); setPendingAction(null); }} />
  </div>;
}
