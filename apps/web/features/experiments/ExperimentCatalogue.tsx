"use client";

import Link from "next/link";
import { ArrowUpRight, FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import PageHeader from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/client-api";
import { labDate, labJSON, labNumber } from "./api";
import { LabAccess } from "./LabShared";
import type { LabStudySummary } from "./types";
import styles from "./experiments.module.css";

function Catalogue() {
  const [studies, setStudies] = useState<LabStudySummary[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    labJSON<{ studies: LabStudySummary[] }>("/api/experiments", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setStudies(data.studies); setError(""); } })
      .catch(caught => { if (!controller.signal.aborted) setError(errorMessage(caught)); });
    return () => controller.abort();
  }, [attempt]);
  return <div className={styles.page} data-testid="experiments-catalogue">
    <PageHeader title="Experimentação" action={null} />
    <main className={styles.content} id="main-content">
      <div className={styles.intro}><div><h2>Estudos em andamento</h2><p>Explore as imagens, examine o que os métodos encontraram e contribua com a revisão das amostras. Os resultados aqui acompanham o estágio real de cada estudo.</p></div><FlaskConical className={styles.introIcon} size={25} /></div>
      {error ? <div className={styles.error} role="alert"><p>{error}</p><button className={styles.button} onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tentar novamente</button></div> : studies === null ? <div className={styles.loading} role="status">Carregando estudos…</div> : studies.length === 0 ? <div className={styles.empty}>Ainda não há estudos disponibilizados neste ambiente.</div> : studies.map(study => <Link href={`/experiments/${encodeURIComponent(study.id)}`} key={study.id} className={styles.studyLink} data-testid="experiment-study-card">
        <div><h3>{study.title}</h3><p>{study.description}</p><div className={styles.studyFacts}><span><strong>{labNumber(study.acquiredSceneCount, 0)}</strong> observações</span><span><strong>{labNumber(study.candidateCount, 0)}</strong> candidatos</span><span><strong>{labNumber(study.sampleCount, 0)}</strong> amostras</span></div><div className={styles.studyFoot}><span>{study.regionNames.join(" · ")}</span><span>Dados até {labDate(study.cutoff)}</span><span className={styles.pending}>Avaliação de referências pendente</span></div></div><ArrowUpRight size={21} aria-label="Abrir estudo" />
      </Link>)}
    </main>
  </div>;
}

export default function ExperimentCatalogue() { return <LabAccess><Catalogue /></LabAccess>; }
