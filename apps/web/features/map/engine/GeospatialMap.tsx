"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { MapContainer, ScaleControl, useMap } from "react-leaflet";
import type { LeafletMouseEvent } from "leaflet";
import { cn } from "@/lib/utils";
import type { MapBounds, MapFitOptions } from "./types";

type MapControls = { fit: () => void; notice: (id: string, content: ReactNode | null) => void };
const ControlsContext = createContext<MapControls | null>(null);

export function useGeospatialMapControls() {
  const controls = useContext(ControlsContext);
  if (!controls) throw new Error("Map layers and navigation must be inside GeospatialMap.");
  return controls;
}

export function useLatestMapValue<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; });
  return ref;
}

export function useMapNotice(id: string, content: ReactNode | null) {
  const { notice } = useGeospatialMapControls();
  useEffect(() => {
    notice(id, content);
    return () => notice(id, null);
  }, [id, content, notice]);
}

function MapContents({ initialBounds, fitOptions, onBackgroundClick, children }: {
  initialBounds: MapBounds; fitOptions: MapFitOptions; onBackgroundClick?: (event: LeafletMouseEvent) => void; children: ReactNode;
}) {
  const map = useMap();
  const fitConfig = useLatestMapValue({ initialBounds, fitOptions });
  const background = useLatestMapValue(onBackgroundClick);
  const [notices, setNotices] = useState(() => new Map<string, ReactNode>());
  const fit = useCallback(() => {
    const current = fitConfig.current;
    const options = typeof current.fitOptions === "function" ? current.fitOptions(map) : current.fitOptions;
    map.fitBounds(current.initialBounds, options);
  }, [map, fitConfig]);
  // Fit only when the extent changes. Layer controls and inspector tabs must
  // preserve the user's viewport; explicit navigation reads the latest options.
  const boundsKey = initialBounds.flat().join(",");
  useEffect(() => { fit(); }, [fit, boundsKey]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  useEffect(() => {
    const clear = (event: LeafletMouseEvent) => {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest(".leaflet-interactive, .leaflet-control, .leaflet-popup, button, a, input, select, textarea, [role=button]")) return;
      background.current?.(event);
    };
    map.on("click", clear);
    return () => { map.off("click", clear); };
  }, [map, background]);
  const notice = useCallback((id: string, content: ReactNode | null) => {
    setNotices(previous => {
      if (content === null ? !previous.has(id) : previous.get(id) === content) return previous;
      const next = new Map(previous);
      if (content === null) next.delete(id); else next.set(id, content);
      return next;
    });
  }, []);
  const controls = useMemo(() => ({ fit, notice }), [fit, notice]);
  return <ControlsContext.Provider value={controls}>
    {children}
    {notices.size > 0 && <div className="absolute left-[17px] top-[72px] z-[700] flex max-w-[min(320px,calc(100%-34px))] flex-col gap-[8px]">{Array.from(notices, ([id, content]) => <div key={id}>{content}</div>)}</div>}
  </ControlsContext.Provider>;
}

export type GeospatialMapProps = Omit<ComponentProps<typeof MapContainer>, "bounds" | "boundsOptions" | "center" | "zoom" | "zoomControl" | "children"> & {
  initialBounds: MapBounds;
  fitOptions: MapFitOptions;
  children: ReactNode;
  onBackgroundClick?: (event: LeafletMouseEvent) => void;
  showScale?: boolean;
};

/** Client-only Leaflet surface. Layers own data; this component owns viewport life cycle. */
export default function GeospatialMap({ initialBounds, fitOptions, children, onBackgroundClick, className, zoomSnap = 0, zoomDelta = .5, scrollWheelZoom = true, showScale = true, ...options }: GeospatialMapProps) {
  return <MapContainer {...options} className={cn("geospatial-map size-full bg-[#282c2b] z-0", className)} bounds={initialBounds} boundsOptions={typeof fitOptions === "function" ? undefined : fitOptions} zoomSnap={zoomSnap} zoomDelta={zoomDelta} zoomControl={false} scrollWheelZoom={scrollWheelZoom}>
    <MapContents initialBounds={initialBounds} fitOptions={fitOptions} onBackgroundClick={onBackgroundClick}>{children}{showScale && <ScaleControl position="bottomleft" imperial={false} />}</MapContents>
  </MapContainer>;
}
