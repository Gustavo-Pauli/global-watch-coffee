"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LabCandidate, LabRegion, LabStudy } from "./types";
import { labDate, labNumber, labTiming } from "./api";
import styles from "./experiments.module.css";

const Map = dynamic(() => import("./LabMap"), { ssr: false, loading: () => <div className={styles.mapHost}><div className={styles.loading}>Carregando mapa…</div></div> });

function initialDates(region: LabRegion) {
  const baseline = region.scenes.filter(scene => scene.phase === "baseline").sort((a, b) => b.clearPercent - a.clearPercent || b.date.localeCompare(a.date))[0];
  const latest = region.scenes.filter(scene => scene.phase === "recent").sort((a, b) => b.date.localeCompare(a.date))[0];
  return { before: baseline?.id || region.scenes[0]?.id || "", after: latest?.id || [...region.scenes].sort((a, b) => b.date.localeCompare(a.date))[0]?.id || "" };
}
function interval(value: [string | null, string | null]) { return value[0] === value[1] ? labDate(value[0]) : `${labDate(value[0])} a ${labDate(value[1])}`; }

export default function ExplorePanel({ study }: { study: LabStudy }) {
  const [regionId, setRegionId] = useState(study.regions[0]?.id || "");
  const region = study.regions.find(item => item.id === regionId) || study.regions[0];
  const [dates, setDates] = useState(() => region ? initialDates(region) : { before: "", after: "" });
  const [color, setColor] = useState<"rgb" | "falseColor">("rgb");
  const [opacity, setOpacity] = useState(.65);
  const [showCandidates, setShowCandidates] = useState(true);
  const [minimumArea, setMinimumArea] = useState(.5);
  const [timing, setTiming] = useState<"all" | LabCandidate["timing"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const candidates = useMemo(() => region?.candidates.features.filter(feature => feature.properties.areaHa >= minimumArea && (timing === "all" || feature.properties.timing === timing)) || [], [region, minimumArea, timing]);
  const ids = useMemo(() => candidates.map(item => item.properties.id), [candidates]);
  const selected = candidates.find(feature => feature.properties.id === selectedId)?.properties;
  useEffect(() => { if (selectedId && !ids.includes(selectedId)) setSelectedId(null); }, [ids, selectedId]);
  const select = useCallback((id: string) => { setSelectedId(id); setFocusToken(value => value + 1); }, []);
  if (!region) return <div className={styles.empty}>O estudo não possui pilotos cartográficos disponíveis.</div>;
  const before = region.scenes.find(scene => scene.id === dates.before) || region.scenes[0];
  const after = region.scenes.find(scene => scene.id === dates.after) || region.scenes.at(-1);
  return <div className={styles.workspace} data-testid="experiment-explore">
    <div className={styles.mapColumn}>
      <div className={styles.mapToolbar}>
        <label className={styles.field}>Piloto<select value={region.id} onChange={event => { const next = study.regions.find(item => item.id === event.target.value)!; setRegionId(next.id); setDates(initialDates(next)); setSelectedId(null); }} aria-label="Piloto do estudo">{study.regions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label className={styles.field}>Imagem de referência<select aria-label="Imagem de referência" value={before?.id || ""} onChange={event => setDates(previous => ({ ...previous, before: event.target.value }))}>{region.scenes.map(scene => <option key={scene.id} value={scene.id}>{labDate(scene.date)} · {labNumber(scene.clearPercent)}% claro</option>)}</select></label>
        <label className={styles.field}>Imagem de comparação<select aria-label="Imagem de comparação" value={after?.id || ""} onChange={event => setDates(previous => ({ ...previous, after: event.target.value }))}>{region.scenes.map(scene => <option key={scene.id} value={scene.id}>{labDate(scene.date)} · {labNumber(scene.clearPercent)}% claro</option>)}</select></label>
        <label className={styles.field}>Visualização<select value={color} onChange={event => setColor(event.target.value as "rgb" | "falseColor")} aria-label="Visualização da imagem"><option value="rgb">Cor natural · RGB</option><option value="falseColor">Falsa cor</option></select></label>
        <label className={styles.field}>Opacidade da comparação · {Math.round(opacity * 100)}%<input type="range" min="0" max="1" step=".05" value={opacity} onChange={event => setOpacity(Number(event.target.value))} aria-label="Opacidade da imagem de comparação" /></label>
        <label className={styles.fieldCheckbox}><input type="checkbox" checked={showCandidates} onChange={event => setShowCandidates(event.target.checked)} /> Candidatos</label>
      </div>
      {before && after ? <Map studyId={study.id} region={region} before={before} after={after} color={color} opacity={opacity} showCandidates={showCandidates} candidateIds={ids} selectedId={selectedId} focusToken={focusToken} onSelect={select} /> : <div className={styles.empty}>Imagens datadas indisponíveis neste piloto.</div>}
      <div className={styles.mapFoot}><span>Arraste a opacidade para comparar as duas observações. Preto e nuvens não comprovam mudança.</span><span>Sentinel‑2 · bandas visíveis a 10 m · SWIR nativo a 20 m</span></div>
    </div>
    <aside className={styles.candidateSidebar} aria-label="Candidatos do piloto">
      <div className={styles.sidebarHead}><h3>{labNumber(candidates.length, 0)} de {labNumber(region.candidates.features.length, 0)} candidatos</h3><p>Filtros de visualização dos resultados já calculados. As datas escolhidas no mapa não executam uma nova análise.</p><div className={styles.candidateFilters}>
        <label className={styles.field}>Área mínima (ha)<input aria-label="Área mínima dos candidatos" type="number" min=".5" step=".5" value={minimumArea} onChange={event => setMinimumArea(Math.max(.5, Number(event.target.value) || .5))} /></label>
        <label className={styles.field}>Intervalo observado<select aria-label="Filtrar intervalo dos candidatos" value={timing} onChange={event => setTiming(event.target.value as typeof timing)}><option value="all">Todos os intervalos</option><option value="observed_new_recent_loss">Mudança nova observada</option><option value="left_censored_possible_loss_since_baseline">Já alterado no início</option><option value="mixed_censoring_candidate">Intervalos misturados</option></select></label>
      </div></div>
      <div className={styles.candidateList}>{candidates.length ? candidates.map(feature => { const candidate = feature.properties; return <button className={styles.candidateButton} key={candidate.id} aria-pressed={candidate.id === selectedId} onClick={() => select(candidate.id)} data-testid="experiment-candidate"><span className={styles.candidateRow}><span>Candidato {candidate.id}</span><strong>{labNumber(candidate.areaHa)} ha</strong></span><small>{labTiming[candidate.timing]}</small></button>; }) : <p className={styles.empty}>Nenhum candidato atende a esses filtros.</p>}</div>
      <div className={styles.candidateDetails}>{selected ? <><h4>Candidato {selected.id} · {labNumber(selected.areaHa)} ha</h4><dl className={styles.detailsList}><dt>Intervalo</dt><dd>{labTiming[selected.timing]}</dd><dt>Último sinal intacto</dt><dd>{interval(selected.lastIntact)}</dd><dt>Primeira anomalia</dt><dd>{interval(selected.firstAnomaly)}</dd><dt>Corroboração</dt><dd>{interval(selected.corroborated)}</dd><dt>Última observação</dt><dd>{interval(selected.latestObservation)}</dd><dt>Retorno do sinal</dt><dd>{labNumber(selected.reboundFraction * 100)}% dos pixels</dd><dt>Causa</dt><dd>Não determinada</dd></dl><p className={styles.detailNote}>Intervalos agregam datas de diferentes pixels. Perda de sinal de vegetação ainda precisa de revisão; não confirma desmatamento ou o uso posterior.</p></> : <><h4>Inspecione um candidato</h4><p className={styles.detailNote}>Clique em um polígono ou na lista para enquadrá-lo e ver as datas, a área e os limites da interpretação.</p></>}</div>
    </aside>
  </div>;
}
