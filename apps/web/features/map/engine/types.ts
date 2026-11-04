import type { ReactNode } from "react";
import type { Feature, FeatureCollection } from "geojson";
import type { FitBoundsOptions, Layer, Map as LeafletMap, PathOptions } from "leaflet";

export type MapBounds = [[number, number], [number, number]];
export type SourceTime =
  | { kind: "mosaic"; label: string }
  | { kind: "reference"; label: string }
  | { kind: "acquisition"; date: string; cloudCoverPercent?: number; platform?: string; product?: string };

export type MapFitOptions = FitBoundsOptions | ((map: LeafletMap) => FitBoundsOptions);
export type MapTileSource = {
  id: string;
  title: string;
  url: string | null;
  attribution: string;
  time: SourceTime;
  maxNativeZoom: number;
  maxZoom?: number;
  className?: string;
  logo?: ReactNode;
};
export type MapLayerStatus = { id: string; title: string; state: "loading" | "ready" | "error" };
export type MapFocusRequest<TId extends string | number> = { id: TId; sequence: number } | null;
export type MapFeatureStyle = PathOptions | ((feature: Feature) => PathOptions);
export type MapGeoJSONLayerProps<TId extends string | number> = {
  id: string;
  data: FeatureCollection;
  getFeatureId: (feature: Feature) => TId | null | undefined;
  selectedId: TId | null;
  onSelect?: (id: TId) => void;
  focusRequest: MapFocusRequest<TId>;
  style: MapFeatureStyle;
  selectedStyle: MapFeatureStyle;
  focusOptions?: FitBoundsOptions;
  openPopupOnFocus?: boolean;
  onEachFeature?: (feature: Feature, layer: Layer) => void;
  visible?: boolean;
};
