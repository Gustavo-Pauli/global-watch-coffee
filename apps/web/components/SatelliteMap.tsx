"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import {
  GeoJSON,
  ImageOverlay,
  MapContainer,
  TileLayer,
  useMap,
  ScaleControl,
} from "react-leaflet";
import type { FeatureCollection } from "geojson";
import type {
  LatLngBoundsExpression,
  GeoJSON as LeafletGeoJSON,
} from "leaflet";
import type { Bounds } from "./analysis-types";
import MapToolButton from "./platform/MapToolButton";
import {
  basemapSource,
  MAPTILER_ATTRIBUTION,
  type BasemapId,
} from "./map-sources";

type InspectorRef = RefObject<HTMLElement | null>;

function MapTools({
  bounds,
  inspectorRef,
}: {
  bounds: Bounds;
  inspectorRef: InspectorRef;
}) {
  const map = useMap();
  const fitImage = useCallback(() => {
    const canvas = map.getContainer().getBoundingClientRect();
    const inspector = inspectorRef.current?.getBoundingClientRect();
    // Framing respects the floating panel, without moving the map on tab changes.
    const rightInset =
      inspector && canvas.width >= 700
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
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return (
    <div
      className="map-navigation map-control-group"
      aria-label="Navegação do mapa"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <MapToolButton label="Aproximar mapa" onClick={() => map.zoomIn()}>
        <Plus size={18} />
      </MapToolButton>
      <MapToolButton label="Afastar mapa" onClick={() => map.zoomOut()}>
        <Minus size={18} />
      </MapToolButton>
      <MapToolButton label="Enquadrar imagem" onClick={fitImage}>
        <LocateFixed size={18} />
      </MapToolButton>
    </div>
  );
}

function CandidateLayer({ geojson }: { geojson: FeatureCollection }) {
  const layer = useRef<LeafletGeoJSON | null>(null);
  useEffect(() => {
    layer.current?.clearLayers();
    layer.current?.addData(geojson);
  }, [geojson]);
  return (
    <GeoJSON
      ref={layer}
      data={geojson}
      style={{
        color: "#c0d6a6",
        weight: 1.7,
        fillColor: "#c0d6a6",
        fillOpacity: 0.14,
      }}
      onEachFeature={(feature, item) => {
        const id = Number(feature.properties?.id ?? 0),
          area = Number(feature.properties?.area_ha ?? 0);
        const content = document.createElement("div"),
          title = document.createElement("strong"),
          measure = document.createElement("span");
        title.textContent = `Polígono ${Number.isFinite(id) ? id : "—"}`;
        measure.textContent = `${Number.isFinite(area) ? area.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} ha`;
        content.append(title, measure);
        item.bindPopup(content);
      }}
    />
  );
}

export default function SatelliteMap({
  geojson,
  bounds,
  overlay,
  showRaster,
  showPolygons,
  basemap,
  inspectorRef,
}: {
  geojson: FeatureCollection;
  bounds: Bounds;
  overlay: string | null;
  showRaster: boolean;
  showPolygons: boolean;
  basemap: BasemapId;
  inspectorRef: InspectorRef;
}) {
  const [tileError, setTileError] = useState(false);
  const [tileRevision, setTileRevision] = useState(0);
  const source = basemapSource(basemap);
  const tileUrl = source.url(process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "");
  useEffect(() => {
    setTileError(false);
  }, [basemap]);
  return (
    <MapContainer
      className="map"
      center={[-21.331, -46.68]}
      zoom={12}
      zoomSnap={0}
      zoomDelta={0.5}
      zoomControl={false}
      scrollWheelZoom
    >
      {tileUrl && (
        <TileLayer
          key={`${basemap}-${tileRevision}`}
          attribution={MAPTILER_ATTRIBUTION}
          url={tileUrl}
          maxNativeZoom={source.maxNativeZoom}
          maxZoom={22}
          referrerPolicy="strict-origin"
          className={`basemap-tiles basemap-${basemap}`}
          eventHandlers={{ tileerror: () => setTileError(true) }}
        />
      )}
      {overlay && showRaster && (
        <ImageOverlay
          url={overlay}
          bounds={bounds as LatLngBoundsExpression}
          opacity={1}
        />
      )}
      {showPolygons && <CandidateLayer geojson={geojson} />}
      {tileError && tileUrl && (
        <div className="basemap-error" role="status">
          <span>
            O mapa de referência não carregou por completo. As camadas da
            análise continuam independentes.
          </span>
          <button
            onClick={() => {
              setTileError(false);
              setTileRevision((value) => value + 1);
            }}
          >
            Recarregar mapa
          </button>
        </div>
      )}
      <MapTools bounds={bounds} inspectorRef={inspectorRef} />
      <ScaleControl position="bottomleft" imperial={false} />
      {tileUrl && (
        <a
          className="maptiler-logo"
          href="https://www.maptiler.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="MapTiler"
        >
          <img
            src="https://api.maptiler.com/resources/logo.svg"
            alt="MapTiler"
            width="88"
            height="22"
          />
        </a>
      )}
    </MapContainer>
  );
}
