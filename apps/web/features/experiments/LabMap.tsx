"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Feature } from "geojson";
import type { Layer } from "leaflet";
import GeospatialMap from "@/features/map/engine/GeospatialMap";
import MapNavigation from "@/features/map/engine/MapNavigation";
import MapRasterLayer from "@/features/map/engine/MapRasterLayer";
import MapGeoJSONLayer from "@/features/map/engine/MapGeoJSONLayer";
import BasemapLayer from "@/features/map/BasemapLayer";
import BasemapPicker from "@/features/map/BasemapPicker";
import MapLayersControl from "@/features/map/MapLayersControl";
import { mapControlGroupClass } from "@/features/map/MapToolButton";
import type { BasemapId } from "@/features/map/sources";
import { labAssetUrl, type LabCandidate, type LabRegion, type LabScene } from "./types";
import { labDate } from "./api";
import styles from "./experiments.module.css";

export type LabMapProps = {
  studyId: string; region: LabRegion; before: LabScene; after: LabScene;
  color: "rgb" | "falseColor"; opacity: number; showCandidates: boolean;
  candidateIds: string[]; selectedId: string | null; focusToken: number;
  onSelect: (id: string | null) => void;
  layerControls: ReactNode; attribution: string;
};
const fitOptions = { paddingTopLeft: [20, 68] as [number, number], paddingBottomRight: [60, 70] as [number, number] };
const featureId = (feature: Feature) => typeof feature.properties?.id === "string" ? feature.properties.id : null;
const candidateStyle = { color: "#e0bd76", weight: 1.5, fillColor: "#d6b46c", fillOpacity: .12 };
const selectedStyle = { color: "#f1e9cf", weight: 3, fillColor: "#d6b46c", fillOpacity: .32 };
const focusOptions = { padding: [45, 45] as [number, number], maxZoom: 17, animate: false };

export default function LabMap(props: LabMapProps) {
  const { studyId, region, before, after, color, opacity, candidateIds, selectedId, showCandidates, onSelect } = props;
  const hasMapKey = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim());
  const [basemap, setBasemap] = useState<BasemapId>(hasMapKey ? "streets" : "none");
  const beforeUrl = labAssetUrl(studyId, color === "rgb" ? before.rgbAssetId : before.falseColorAssetId);
  const afterUrl = labAssetUrl(studyId, color === "rgb" ? after.rgbAssetId : after.falseColorAssetId);
  const filtered = useMemo(() => ({ ...region.candidates, features: region.candidates.features.filter(feature => candidateIds.includes(feature.properties.id)) }), [region.candidates, candidateIds]);
  const focusRequest = useMemo(() => selectedId === null ? null : { id: selectedId, sequence: props.focusToken }, [selectedId, props.focusToken]);
  const decorate = useCallback((feature: Feature, layer: Layer) => {
    const properties = feature.properties as LabCandidate;
    const tooltip = document.createElement("span");
    tooltip.textContent = `Candidato ${properties.id} · ${properties.areaHa.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha`;
    layer.bindTooltip(tooltip, { sticky: true });
  }, []);
  // Imported attribution is plain text; Leaflet's attribution option accepts HTML.
  const credit = props.attribution.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  return <div className={styles.mapHost} data-testid="experiment-map">
    <GeospatialMap initialBounds={region.bounds} fitOptions={fitOptions} zoomSnap={.25} zoomDelta={.5} maxZoom={19} minZoom={4} onBackgroundClick={() => onSelect(null)}>
      <BasemapLayer id={basemap} />
      <MapRasterLayer id="reference" title="Imagem de referência" url={beforeUrl} bounds={region.bounds} opacity={1} attribution={credit} time={{ kind: "acquisition", date: before.date, platform: "Sentinel-2" }} />
      <MapRasterLayer id="comparison" title="Imagem de comparação" url={afterUrl} bounds={region.bounds} opacity={opacity} attribution={credit} time={{ kind: "acquisition", date: after.date, platform: "Sentinel-2" }} />
      <MapGeoJSONLayer id="study-candidates" data={filtered} getFeatureId={featureId} selectedId={selectedId} onSelect={onSelect} focusRequest={focusRequest} focusOptions={focusOptions} style={candidateStyle} selectedStyle={selectedStyle} onEachFeature={decorate} visible={showCandidates} />
      <MapNavigation />
    </GeospatialMap>
    <div className={`${mapControlGroupClass} absolute right-[14px] top-[14px] z-[850] max-[760px]:right-[12px]`} role="group" aria-label="Ferramentas do mapa" data-testid="map-toolbar">
      <MapLayersControl>
        <BasemapPicker value={basemap} onChange={setBasemap} hasKey={hasMapKey} />
        <div className={styles.layerControls}>{props.layerControls}</div>
      </MapLayersControl>
    </div>
    <div className={styles.mapKey}><span>{showCandidates && <i className={styles.keyDot} />}Candidatos sem validação</span><span>{labDate(before.date)} / {labDate(after.date)}</span></div>
  </div>;
}
