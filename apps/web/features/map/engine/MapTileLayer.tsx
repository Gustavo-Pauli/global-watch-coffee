"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TileLayer } from "react-leaflet";
import type { TileLayer as LeafletTileLayer } from "leaflet";
import { Button } from "@/components/ui/button";
import { textButtonClass } from "@/components/ui/action";
import { cn } from "@/lib/utils";
import { useMapNotice } from "./GeospatialMap";
import type { MapTileSource } from "./types";
import { setSourceMetadata, sourceAccessibleLabel } from "./source-metadata";

export type MapTileLayerProps = {
  source: MapTileSource;
  errorMessage?: string;
  errorTestId?: string;
};

export default function MapTileLayer({ source, errorMessage = "O mapa de referência não carregou por completo. As outras camadas continuam independentes.", errorTestId = "map-tile-error" }: MapTileLayerProps) {
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const layer = useRef<LeafletTileLayer | null>(null);
  useEffect(() => { setFailed(false); }, [source.id, source.url]);
  const markSource = useCallback(() => {
    const container = layer.current?.getContainer();
    if (!container) return;
    setSourceMetadata(container, source);
    container.setAttribute("role", "img");
    container.setAttribute("aria-label", sourceAccessibleLabel(source.title, source.time));
  }, [source.id, source.title, source.time]);
  useEffect(markSource, [markSource, source.url, revision]);
  const retry = useCallback(() => { setFailed(false); setRevision(value => value + 1); }, []);
  const notice = useMemo(() => failed && source.url ? <div className="flex flex-col gap-[6px] rounded-[5px] border border-solid border-[#55555c] bg-[#222225] p-[12px] text-[12px] text-[#d0d0d6]" role="status" data-testid={errorTestId} data-geospatial-layer={source.id}>
    <span>{errorMessage}</span><Button className={cn(textButtonClass, "self-start")} onClick={retry} variant="native">Recarregar mapa</Button>
  </div> : null, [failed, source.url, source.id, errorTestId, errorMessage, retry]);
  useMapNotice(`tile:${source.id}`, notice);
  if (!source.url) return null;
  return <>
    <TileLayer ref={layer} key={`${source.id}:${source.url}:${revision}`} attribution={source.attribution} url={source.url} maxNativeZoom={source.maxNativeZoom} maxZoom={source.maxZoom ?? 22} referrerPolicy="strict-origin" className={source.className} eventHandlers={{ add: markSource, load: markSource, tileerror: () => setFailed(true) }} />
    {source.logo}
  </>;
}
