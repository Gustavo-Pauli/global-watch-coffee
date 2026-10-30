// Reference maps are deliberately separate from the dated processing image.
// Adding a dated source must supply real scene metadata, not reuse analysis.date.
export type SourceTime =
  | { kind: "mosaic"; label: string }
  | { kind: "reference"; label: string }
  | {
      kind: "acquisition";
      date: string;
      cloudCoverPercent?: number;
      platform?: string;
      product?: string;
    };

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
