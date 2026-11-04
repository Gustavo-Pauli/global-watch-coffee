// Reference maps are deliberately separate from the dated processing image.
// Adding a dated source must supply real scene metadata, not reuse analysis.date.
import type { MapTileSource, SourceTime } from "./engine/types";
export type { SourceTime } from "./engine/types";

export type BasemapId = "satellite" | "streets" | "none";
export type BasemapSource = {
  id: BasemapId;
  title: string;
  description: string;
  provider: string | null;
  time: SourceTime;
  maxNativeZoom: number;
  url: (key: string) => string | null;
};

export const BASEMAPS: readonly BasemapSource[] = [
  {
    id: "satellite",
    title: "Satélite",
    description: "Imagem de referência do entorno",
    provider: "MapTiler",
    time: { kind: "mosaic", label: "Mosaico · data de aquisição não informada" },
    maxNativeZoom: 22,
    url: (key) =>
      key
        ? `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`
        : null,
  },
  {
    id: "streets",
    title: "Ruas",
    description: "Estradas, acessos e municípios",
    provider: "MapTiler",
    time: { kind: "reference", label: "Mapa cartográfico · sem data de aquisição" },
    maxNativeZoom: 22,
    url: (key) =>
      key
        ? `https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`
        : null,
  },
  {
    id: "none",
    title: "Sem fundo",
    description: "Apenas a imagem e os resultados",
    provider: null,
    time: { kind: "reference", label: "Sem fundo de referência" },
    maxNativeZoom: 22,
    url: () => null,
  },
];

export const MAPTILER_ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>';
export function basemapSource(id: BasemapId) {
  return BASEMAPS.find((source) => source.id === id)!;
}

/** Provider-specific configuration stays outside the map engine. */
export function resolveBasemapSource(id: BasemapId, key: string): MapTileSource {
  const source = basemapSource(id);
  return {
    id: source.id, title: source.title, url: source.url(key), time: source.time,
    attribution: MAPTILER_ATTRIBUTION, maxNativeZoom: source.maxNativeZoom,
    maxZoom: 22, className: `basemap-tiles basemap-${source.id}`,
  };
}

export function sourceTimeLabel(time: SourceTime) {
  if (time.kind !== "acquisition") return time.label;
  const date = new Date(`${time.date.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? "Data não informada" : new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  }).format(date);
}
