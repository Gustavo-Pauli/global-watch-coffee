"use client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { textButtonClass } from "@/components/ui/action";
import { useCallback, useEffect, useRef, useState, type RefObject, } from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import { GeoJSON, ImageOverlay, MapContainer, TileLayer, useMap, ScaleControl, } from "react-leaflet";
import type { FeatureCollection } from "geojson";
import type { LatLngBoundsExpression, LatLngBounds, Path, GeoJSON as LeafletGeoJSON, } from "leaflet";
import { formatNumber, type Bounds } from "@/features/analyses/types";
import type { FocusRequest } from "./candidates";
import MapToolButton, { mapControlGroupClass } from "./MapToolButton";
import { basemapSource, MAPTILER_ATTRIBUTION, type BasemapId, } from "./sources";
type InspectorRef = RefObject<HTMLElement | null>;
function MapTools({ bounds, inspectorRef, }: {
    bounds: Bounds;
    inspectorRef: InspectorRef;
}) {
    const map = useMap();
    const fitImage = useCallback(() => {
        const canvas = map.getContainer().getBoundingClientRect();
        const inspector = inspectorRef.current?.getBoundingClientRect();
        // Framing respects the floating panel, without moving the map on tab changes.
        const rightInset = inspector && canvas.width >= 700
            ? Math.max(36, canvas.right - inspector.left + 16)
            : 14;
        map.fitBounds(bounds as LatLngBoundsExpression, {
            paddingTopLeft: [canvas.width < 600 ? 14 : 36, 68],
            paddingBottomRight: [rightInset, 64],
            maxZoom: 16,
            animate: false,
        });
    }, [map, bounds, inspectorRef]);
    useEffect(() => {
        fitImage();
    }, [fitImage]);
    useEffect(() => {
        const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
        observer.observe(map.getContainer());
        return () => observer.disconnect();
    }, [map]);
    return (<div className={cn(mapControlGroupClass, "absolute bottom-[41px] right-[14px] z-[800] max-[760px]:right-[12px]")} aria-label="Navegação do mapa" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} data-testid="map-navigation">
      <MapToolButton label="Aproximar mapa" onClick={() => map.zoomIn()}>
        <Plus size={18}/>
      </MapToolButton>
      <MapToolButton label="Afastar mapa" onClick={() => map.zoomOut()}>
        <Minus size={18}/>
      </MapToolButton>
      <MapToolButton label="Enquadrar imagem" onClick={fitImage}>
        <LocateFixed size={18}/>
      </MapToolButton>
    </div>);
}
function CandidateLayer({ geojson, selected, onSelect, onAsk, focusRequest }: {
    geojson: FeatureCollection;
    selected: number | null;
    onSelect: (id: number) => void;
    onAsk: (id: number) => void;
    focusRequest: FocusRequest;
}) {
    const map = useMap();
    const layer = useRef<LeafletGeoJSON | null>(null);
    const items = useRef(new Map<number, Path & { getBounds: () => LatLngBounds }>());
    useEffect(() => {
        items.current.clear();
        layer.current?.clearLayers();
        layer.current?.addData(geojson);
    }, [geojson]);
    useEffect(() => {
        for (const [id, item] of items.current) {
            item.setStyle({ color: id === selected ? "#f4f5dc" : "#c0d6a6", weight: id === selected ? 2.7 : 1.7, fillColor: "#c0d6a6", fillOpacity: id === selected ? 0.3 : 0.14 });
            if (id === selected) item.bringToFront();
        }
    }, [selected, geojson]);
    useEffect(() => {
        if (!focusRequest) return;
        const frame = requestAnimationFrame(() => {
            const item = items.current.get(focusRequest.id);
            if (!item) return;
            map.invalidateSize({ pan: false });
            map.fitBounds(item.getBounds(), { padding: [55, 75], maxZoom: 18, animate: false });
            item.openPopup();
        });
        return () => cancelAnimationFrame(frame);
    }, [focusRequest, map]);
    return (<GeoJSON ref={layer} data={geojson} style={{
            color: "#c0d6a6",
            weight: 1.7,
            fillColor: "#c0d6a6",
            fillOpacity: 0.14,
        }} onEachFeature={(feature, item) => {
            const id = Number(feature.properties?.id ?? 0), area = Number(feature.properties?.area_ha ?? 0);
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
            items.current.set(id, item as Path & { getBounds: () => LatLngBounds });
            item.on("click", () => onSelect(id));
            item.bindPopup(content, { autoPan: false, maxWidth: 250 });
        }}/>);
}
export default function SatelliteMap({ geojson, bounds, overlay, opacity, showRaster, showPolygons, basemap, inspectorRef, selected, onSelect, onAsk, focusRequest }: {
    geojson: FeatureCollection;
    bounds: Bounds;
    overlay: string | null;
    opacity: number;
    showRaster: boolean;
    showPolygons: boolean;
    basemap: BasemapId;
    inspectorRef: InspectorRef;
    selected: number | null;
    onSelect: (id: number) => void;
    onAsk: (id: number) => void;
    focusRequest: FocusRequest;
}) {
    const [tileError, setTileError] = useState(false);
    const [tileRevision, setTileRevision] = useState(0);
    const source = basemapSource(basemap);
    const tileUrl = source.url(process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "");
    useEffect(() => {
        setTileError(false);
    }, [basemap]);
    return (<MapContainer className={"size-full bg-[#282c2b] z-0"} center={[-21.331, -46.68]} zoom={12} zoomSnap={0} zoomDelta={0.5} zoomControl={false} scrollWheelZoom>
      {tileUrl && (<TileLayer key={`${basemap}-${tileRevision}`} attribution={MAPTILER_ATTRIBUTION} url={tileUrl} maxNativeZoom={source.maxNativeZoom} maxZoom={22} referrerPolicy="strict-origin" className={`basemap-tiles basemap-${basemap}`}  eventHandlers={{ tileerror: () => setTileError(true) }}/>)}
      {overlay && showRaster && (<ImageOverlay url={overlay} bounds={bounds as LatLngBoundsExpression} opacity={opacity}/>)}
      {showPolygons && <CandidateLayer geojson={geojson} selected={selected} onSelect={onSelect} onAsk={onAsk} focusRequest={focusRequest}/>}
      {tileError && tileUrl && (<div className={"absolute left-[17px] top-[72px] z-[700] flex max-w-[min(320px,calc(100%-34px))] flex-col gap-[6px] rounded-[5px] border border-solid border-[#55555c] bg-[#222225] p-[12px] text-[12px] text-[#d0d0d6]"} role="status" data-testid="basemap-error">
          <span>
            O mapa de referência não carregou por completo. As camadas da
            análise continuam independentes.
          </span>
          <Button className={cn(textButtonClass, "self-start")} onClick={() => {
                setTileError(false);
                setTileRevision((value) => value + 1);
            }} variant="native">
            Recarregar mapa
          </Button>
        </div>)}
      <MapTools bounds={bounds} inspectorRef={inspectorRef}/>
      <ScaleControl position="bottomleft" imperial={false}/>
      {tileUrl && (<a className={"absolute bottom-[6px] left-[13px] z-[600] flex rounded-[2px] bg-[#ffffffed] px-[4px] py-[2px] max-[760px]:left-[12px]"} href="https://www.maptiler.com" target="_blank" rel="noopener noreferrer" aria-label="MapTiler" data-testid="maptiler-logo">
          <img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler" width="88" height="22" className={"block h-[20px] w-[80px]"}/>
        </a>)}
    </MapContainer>);
}
