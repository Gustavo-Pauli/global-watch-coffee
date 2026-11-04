"use client";

import { useCallback, type RefObject } from "react";
import type { Feature, FeatureCollection } from "geojson";
import type { Layer, Map as LeafletMap } from "leaflet";
import { formatNumber, type Bounds } from "@/features/analyses/types";
import type { FocusRequest } from "./candidates";
import type { BasemapId } from "./sources";
import BasemapLayer from "./BasemapLayer";
import { GeospatialMap, MapGeoJSONLayer, MapNavigation, MapRasterLayer } from "./engine";

type InspectorRef = RefObject<HTMLElement | null>;
const candidateStyle = { color: "#c0d6a6", weight: 1.7, fillColor: "#c0d6a6", fillOpacity: .14 };
const selectedStyle = { color: "#f4f5dc", weight: 2.7, fillOpacity: .3 };
const candidateId = (feature: Feature) => Number(feature.properties?.id ?? 0);

/** Analysis-specific interpretation stays outside the shared map engine. */
export default function SatelliteMap({ geojson, bounds, overlay, opacity, showRaster, showPolygons, basemap, inspectorRef, selected, onSelect, onAsk, focusRequest, acquisitionDate }: {
  geojson: FeatureCollection;
  bounds: Bounds;
  overlay: string | null;
  opacity: number;
  showRaster: boolean;
  showPolygons: boolean;
  basemap: BasemapId;
  inspectorRef: InspectorRef;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onAsk: (id: number) => void;
  focusRequest: FocusRequest;
  acquisitionDate?: string | null;
}) {
  const fitOptions = useCallback((map: LeafletMap) => {
    const canvas = map.getContainer().getBoundingClientRect();
    const inspector = inspectorRef.current?.getBoundingClientRect();
    const rightInset = inspector && canvas.width >= 700 ? Math.max(36, canvas.right - inspector.left + 16) : 14;
    return { paddingTopLeft: [canvas.width < 600 ? 14 : 36, 68] as [number, number], paddingBottomRight: [rightInset, 64] as [number, number], maxZoom: 16, animate: false };
  }, [inspectorRef]);
  const clearSelection = useCallback(() => onSelect(null), [onSelect]);
  const bindPopup = useCallback((feature: Feature, item: Layer) => {
    const id = candidateId(feature), area = Number(feature.properties?.area_ha ?? 0);
    const content = document.createElement("div"), title = document.createElement("strong"), measure = document.createElement("span");
    title.textContent = `Polígono ${Number.isFinite(id) ? id : "—"}`;
    measure.textContent = `${Number.isFinite(area) ? area.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} ha`;
    content.append(title, measure);
    const ndvi = feature.properties?.ndvi_mean;
    if (typeof ndvi === "number" && Number.isFinite(ndvi)) {
      const index = document.createElement("small");
      index.textContent = `NDVI médio: ${formatNumber(ndvi, 3)}`;
      content.append(index);
    }
    if (feature.properties?.touches_scene_boundary === true) {
      const warning = document.createElement("small");
      warning.textContent = "Toca a borda da imagem; a área pode estar incompleta.";
      content.append(warning);
    }
    const ask = document.createElement("button");
    ask.type = "button";
    ask.className = "mt-[3px] border-0 bg-transparent p-0 text-left text-[12px] text-[#c0d6a6] underline-offset-[3px] hover:underline";
    ask.textContent = "Perguntar sobre este polígono";
    ask.addEventListener("click", () => onAsk(id));
    content.append(ask);
    item.bindPopup(content, { autoPan: false, maxWidth: 250 });
  }, [onAsk]);
  return <GeospatialMap initialBounds={bounds} fitOptions={fitOptions} onBackgroundClick={showPolygons ? clearSelection : undefined}>
    <BasemapLayer id={basemap} />
    <MapRasterLayer id="analysis-raster" title="Imagem analisada" url={overlay} bounds={bounds} opacity={opacity} visible={showRaster} time={acquisitionDate ? { kind: "acquisition", date: acquisitionDate } : undefined} />
    <MapGeoJSONLayer id="analysis-candidates" data={geojson} getFeatureId={candidateId} selectedId={selected} onSelect={onSelect} focusRequest={focusRequest} style={candidateStyle} selectedStyle={selectedStyle} onEachFeature={bindPopup} visible={showPolygons} />
    <MapNavigation />
  </GeospatialMap>;
}
