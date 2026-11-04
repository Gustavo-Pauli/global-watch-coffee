"use client";

import { useCallback, useEffect, useRef } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import { latLngBounds, type GeoJSON as LeafletGeoJSON, type LatLng, type LatLngBounds, type Layer, type PathOptions } from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import { useLatestMapValue } from "./GeospatialMap";
import type { MapFeatureStyle, MapFocusRequest, MapGeoJSONLayerProps } from "./types";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
type FeatureLayer = Layer & { setStyle?: (style: PathOptions) => void; getBounds?: () => LatLngBounds; getLatLng?: () => LatLng; bringToFront?: () => void; getElement?: () => Element | undefined; eachLayer?: (callback: (layer: FeatureLayer) => void) => void };
function options(style: MapFeatureStyle, feature: Feature) { return typeof style === "function" ? style(feature) : style; }
function markLayer(layer: FeatureLayer, id: string) {
  layer.getElement?.()?.setAttribute("data-geospatial-layer", id);
  layer.eachLayer?.(child => markLayer(child, id));
}

function captureStyles(layer: FeatureLayer, defaults: WeakMap<FeatureLayer, PathOptions>) {
  const original: Record<string, unknown> = {};
  // Leaflet path defaults also live on the options prototype.
  for (const key in layer.options) original[key] = (layer.options as Record<string, unknown>)[key];
  defaults.set(layer, original);
  layer.eachLayer?.(child => captureStyles(child, defaults));
}

function applyStyle(layer: FeatureLayer, style: PathOptions, defaults: WeakMap<FeatureLayer, PathOptions>) {
  if (layer.eachLayer) layer.eachLayer(child => applyStyle(child, style, defaults));
  else layer.setStyle?.({ ...defaults.get(layer), ...style });
}

/** Data replacement, style and feature indexes are scoped to this layer instance. */
export default function MapGeoJSONLayer<TId extends string | number>(props: MapGeoJSONLayerProps<TId>) {
  const { id, data, selectedId, focusRequest, style, selectedStyle, visible = true } = props;
  const map = useMap();
  const config = useLatestMapValue(props);
  const layer = useRef<LeafletGeoJSON | null>(null);
  const items = useRef(new Map<TId, { layer: FeatureLayer; feature: Feature }>());
  const allItems = useRef<{ id: TId | null | undefined; layer: FeatureLayer; feature: Feature }[]>([]);
  const defaults = useRef(new WeakMap<FeatureLayer, PathOptions>());
  const appliedFocus = useRef<MapFocusRequest<TId>>(null);
  const handleFeature = useCallback((feature: Feature, featureLayer: Layer) => {
    const current = config.current;
    const item = featureLayer as FeatureLayer;
    const featureId = current.getFeatureId(feature);
    const selected = featureId != null && featureId === current.selectedId;
    captureStyles(item, defaults.current);
    applyStyle(item, { ...options(current.style, feature), ...(selected ? options(current.selectedStyle, feature) : {}) }, defaults.current);
    const mark = () => markLayer(item, current.id);
    item.on("add", mark); mark();
    allItems.current.push({ id: featureId, layer: item, feature });
    if (featureId != null) {
      items.current.set(featureId, { layer: item, feature });
      item.on("click", () => config.current.onSelect?.(featureId));
    }
    current.onEachFeature?.(feature, featureLayer);
  }, [config]);
  useEffect(() => {
    items.current.clear();
    allItems.current = [];
    layer.current?.clearLayers();
    if (visible) layer.current?.addData(data);
    return () => { items.current.clear(); allItems.current = []; };
  }, [data, visible, id]);
  useEffect(() => {
    for (const item of allItems.current) {
      const selected = item.id != null && item.id === selectedId;
      applyStyle(item.layer, { ...options(style, item.feature), ...(selected ? options(selectedStyle, item.feature) : {}) }, defaults.current);
      if (selected) item.layer.bringToFront?.();
    }
  }, [selectedId, style, selectedStyle, data, visible]);
  useEffect(() => {
    if (!focusRequest) { appliedFocus.current = null; return; }
    if (!visible || (appliedFocus.current?.id === focusRequest.id && appliedFocus.current.sequence === focusRequest.sequence)) return;
    const frame = requestAnimationFrame(() => {
      const currentRequest = config.current.focusRequest;
      if (!currentRequest || currentRequest.id !== focusRequest.id || currentRequest.sequence !== focusRequest.sequence) return;
      const item = items.current.get(focusRequest.id)?.layer;
      if (!item) return;
      const point = item.getLatLng?.();
      const bounds = item.getBounds?.() ?? (point ? latLngBounds(point, point) : null);
      if (!bounds?.isValid()) return;
      map.invalidateSize({ pan: false });
      map.fitBounds(bounds, { padding: [55, 75], maxZoom: 18, animate: false, ...config.current.focusOptions });
      // Data filters and layer visibility must not replay a completed request.
      // A request for an absent/hidden feature remains pending until it can fit.
      appliedFocus.current = { id: focusRequest.id, sequence: focusRequest.sequence };
      if (config.current.openPopupOnFocus !== false) item.openPopup();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest?.id, focusRequest?.sequence, map, data, visible, config]);
  if (!visible) return null;
  return <GeoJSON ref={layer} data={EMPTY} onEachFeature={handleFeature} />;
}
