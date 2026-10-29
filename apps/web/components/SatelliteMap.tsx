"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  basemapSource,
  MAPTILER_ATTRIBUTION,
  type BasemapId,
} from "./map-sources";

function MapTools({ bounds }: { bounds: Bounds }) {
  const map = useMap();
  const fitImage = useCallback(() => {
    map.fitBounds(bounds as LatLngBoundsExpression, {
      padding: map.getSize().x < 600 ? [14, 58] : [36, 36],
      maxZoom: 16,
      animate: false,
    });
  }, [map, bounds]);
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
      className="map-navigation"
      aria-label="Navegação do mapa"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        aria-label="Aproximar mapa"
        title="Aproximar"
        onClick={() => map.zoomIn()}
      >
        <Plus size={18} />
      </button>
      <button
        aria-label="Afastar mapa"
        title="Afastar"
        onClick={() => map.zoomOut()}
      >
        <Minus size={18} />
      </button>
      <button
        aria-label="Enquadrar imagem"
        title="Enquadrar imagem"
        onClick={fitImage}
      >
        <LocateFixed size={18} />
      </button>
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
          measure = document.createElement("span"),
          note = document.createElement("small");
        title.textContent = `Candidato ${Number.isFinite(id) ? id : "—"}`;
        measure.textContent = `${Number.isFinite(area) ? area.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} ha`;
        note.textContent = "Sem validação em campo";
        content.append(title, measure, note);
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
}: {
  geojson: FeatureCollection;
  bounds: Bounds;
  overlay: string | null;
  showRaster: boolean;
  showPolygons: boolean;
  basemap: BasemapId;
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
      <MapTools bounds={bounds} />
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
