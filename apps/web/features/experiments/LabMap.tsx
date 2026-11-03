"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJSON, ImageOverlay, MapContainer, ScaleControl, TileLayer, useMap } from "react-leaflet";
import { geoJSON, type LatLngBoundsExpression } from "leaflet";
import { LocateFixed } from "lucide-react";
import { basemapSource, MAPTILER_ATTRIBUTION } from "@/features/map/sources";
import { labAssetUrl, type LabCandidate, type LabRegion, type LabScene } from "./types";
import { labDate } from "./api";
import styles from "./experiments.module.css";

export type LabMapProps = {
  studyId: string; region: LabRegion; before: LabScene; after: LabScene;
  color: "rgb" | "falseColor"; opacity: number; showCandidates: boolean;
  candidateIds: string[]; selectedId: string | null; focusToken: number;
  onSelect: (id: string) => void;
};

function MapEffects({ region, selectedId, focusToken }: Pick<LabMapProps, "region" | "selectedId" | "focusToken">) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(region.bounds as LatLngBoundsExpression, { padding: [20, 20], animate: false });
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, region.id, region.bounds]);
  useEffect(() => {
    const feature = region.candidates.features.find(item => item.properties.id === selectedId);
    if (feature) map.fitBounds(geoJSON(feature).getBounds(), { padding: [45, 45], maxZoom: 17, animate: false });
  }, [map, region.candidates, selectedId, focusToken]);
  return <button type="button" className={styles.mapReframe} aria-label="Enquadrar piloto" title="Enquadrar piloto" onClick={() => map.fitBounds(region.bounds as LatLngBoundsExpression, { padding: [20, 20], animate: false })}><LocateFixed size={17} /></button>;
}

export default function LabMap(props: LabMapProps) {
  const { studyId, region, before, after, color, opacity, candidateIds, selectedId, showCandidates, onSelect } = props;
  const [broken, setBroken] = useState<string[]>([]);
  const beforeUrl = labAssetUrl(studyId, color === "rgb" ? before.rgbAssetId : before.falseColorAssetId);
  const afterUrl = labAssetUrl(studyId, color === "rgb" ? after.rgbAssetId : after.falseColorAssetId);
  useEffect(() => setBroken([]), [beforeUrl, afterUrl]);
  const filtered = useMemo(() => ({ ...region.candidates, features: region.candidates.features.filter(feature => candidateIds.includes(feature.properties.id)) }), [region.candidates, candidateIds]);
  const context = basemapSource("streets").url(process.env.NEXT_PUBLIC_MAPTILER_KEY || "");
  const failed = (name: string) => setBroken(previous => previous.includes(name) ? previous : [...previous, name]);
  return <div className={styles.mapHost} data-testid="experiment-map">
    <MapContainer bounds={region.bounds as LatLngBoundsExpression} scrollWheelZoom={false} zoomControl={true} zoomSnap={.25} zoomDelta={.5} maxZoom={19} minZoom={4}>
      {context && <TileLayer url={context} attribution={MAPTILER_ATTRIBUTION} maxNativeZoom={18} />}
      <ImageOverlay key={beforeUrl} url={beforeUrl} bounds={region.bounds as LatLngBoundsExpression} opacity={1} eventHandlers={{ error: () => failed("referência") }} />
      <ImageOverlay key={afterUrl} url={afterUrl} bounds={region.bounds as LatLngBoundsExpression} opacity={opacity} eventHandlers={{ error: () => failed("comparação") }} />
      {showCandidates && <GeoJSON key={`${region.id}:${candidateIds.join(",")}`} data={filtered} style={feature => ({ color: feature?.properties?.id === selectedId ? "#f1e9cf" : "#e0bd76", weight: feature?.properties?.id === selectedId ? 3 : 1.5, fillColor: "#d6b46c", fillOpacity: feature?.properties?.id === selectedId ? .32 : .12 })} onEachFeature={(feature, layer) => {
        const properties = feature.properties as LabCandidate;
        layer.on("click", () => onSelect(properties.id));
        const tooltip = document.createElement("span");
        tooltip.textContent = `Candidato ${properties.id} · ${properties.areaHa.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha`;
        layer.bindTooltip(tooltip, { sticky: true });
      }} />}
      <MapEffects region={region} selectedId={selectedId} focusToken={props.focusToken} />
      <ScaleControl position="bottomleft" />
    </MapContainer>
    {broken.length > 0 && <div className={styles.mapMessage} role="status">Não foi possível carregar a imagem de {broken.join(" e ")}. Escolha outra observação ou tente recarregar o estudo.</div>}
    <div className={styles.mapKey}><span>{showCandidates && <i className={styles.keyDot} />}Candidatos sem validação</span><span>{labDate(before.date)} → {labDate(after.date)}</span></div>
  </div>;
}
