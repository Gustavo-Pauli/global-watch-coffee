"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import PageHeader from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/client-api";
import { LabAccess, DiscardDialog } from "./LabShared";
import { labDate, labJSON } from "./api";
import type { LabStudy } from "./types";
import ExplorePanel from "./ExplorePanel";
import ReviewPanel from "./ReviewPanel";
import { StudyPapers, StudyResults } from "./StudyResults";
import styles from "./experiments.module.css";

const tabs = [{ id: "explore", label: "Explorar" }, { id: "review", label: "Revisar amostras" }, { id: "results", label: "Resultados e método" }, { id: "papers", label: "Pesquisas" }] as const;
type Tab = typeof tabs[number]["id"];

function Workspace({ id }: { id: string }) {
  const router = useRouter();
  const [study, setStudy] = useState<LabStudy | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>("explore");
  const [dirty, setDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const clearPending = useCallback(() => setPendingAction(null), []);
  const dirtyChange = useCallback((value: boolean) => setDirty(value), []);
  useEffect(() => {
    const abort = new AbortController();
    labJSON<LabStudy>(`/api/experiments/${encodeURIComponent(id)}`, { signal: abort.signal }).then(data => { if (!abort.signal.aborted) { setStudy(data); setError(""); } }).catch(caught => { if (!abort.signal.aborted) setError(errorMessage(caught)); });
    return () => abort.abort();
  }, [id, attempt]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/") || url.pathname === window.location.pathname) return;
      event.preventDefault(); event.stopPropagation();
      setPendingAction(() => () => router.push(`${url.pathname}${url.search}${url.hash}`));
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty, router]);
  const switchTab = (value: Tab) => {
    if (value === tab) return;
    if (dirty) setPendingAction(() => () => setTab(value)); else setTab(value);
  };
  return <div className={styles.page} data-testid="experiment-workspace">
    <PageHeader title="Experimentação" meta={<Link href="/experiments" className={styles.textButton} style={{ minHeight: 24, fontSize: 11 }}><ArrowLeft size={12} /> Estudos</Link>} action={null} />
    {error ? <main id="main-content" className={styles.content}><div className={styles.error} role="alert"><p>{error}</p><button className={styles.button} onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tentar novamente</button></div></main> : study === null ? <main id="main-content" className={styles.loading} role="status">Carregando imagens e evidências do estudo…</main> : <>
      <div className={styles.studyTop}><div className={styles.studyTitle}><div><h2>{study.title}</h2><p>{study.regionNames.join(" · ")} · Dados até {labDate(study.cutoff)}</p></div></div><div className={styles.tabs} role="tablist" aria-label="Áreas do estudo">{tabs.map((item, position) => <button key={item.id} id={`lab-tab-${item.id}`} className={styles.tab} role="tab" aria-label={item.label} aria-selected={tab === item.id} aria-controls={`lab-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => switchTab(item.id)} onKeyDown={event => {
        const index = event.key === "ArrowRight" ? (position + 1) % tabs.length : event.key === "ArrowLeft" ? (position + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (index !== null) { event.preventDefault(); switchTab(tabs[index].id); if (!dirty) document.getElementById(`lab-tab-${tabs[index].id}`)?.focus(); }
      }}>{item.label}{item.id === "review" && <span className={styles.tabCount} aria-hidden="true">{study.sampleCount}</span>}</button>)}</div></div>
      <div className={styles.notice}><Info size={14} /><p><strong>Avaliação de referências pendente.</strong> Os resultados são candidatos a perda de vegetação. Causas, acurácia e superioridade ao MapBiomas ainda não foram demonstradas.</p></div>
      <main id="main-content" role="tabpanel" aria-labelledby={`lab-tab-${tab}`} className={styles.page} data-panel={tab}><div id={`lab-panel-${tab}`} className={styles.page}>{tab === "explore" ? <ExplorePanel study={study} /> : tab === "review" ? <ReviewPanel study={study} onDirtyChange={dirtyChange} /> : tab === "results" ? <StudyResults study={study} /> : <StudyPapers study={study} />}</div></main>
    </>}
    <DiscardDialog open={pendingAction !== null} onCancel={clearPending} onDiscard={() => { setDirty(false); pendingAction?.(); setPendingAction(null); }} />
  </div>;
}

export default function ExperimentWorkspace({ id }: { id: string }) { return <LabAccess><Workspace id={id} /></LabAccess>; }
