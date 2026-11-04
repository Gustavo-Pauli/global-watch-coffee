"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageOverlay } from "react-leaflet";
import { latLngBounds, type ImageOverlay as LeafletImageOverlay } from "leaflet";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textButtonClass } from "@/components/ui/action";
import { cn } from "@/lib/utils";
import { useLatestMapValue, useMapNotice } from "./GeospatialMap";
import type { MapBounds, MapLayerStatus, SourceTime } from "./types";
import { setSourceMetadata, sourceAccessibleLabel } from "./source-metadata";

export type MapRasterLayerProps = {
  id: string;
  title: string;
  url: string | null;
  bounds: MapBounds;
  opacity: number;
  visible?: boolean;
  attribution?: string;
  time?: SourceTime;
  onStatus?: (status: MapLayerStatus) => void;
};

function RasterImage({ id, title, url, bounds, opacity, attribution, time, onStatus, onRetry }: MapRasterLayerProps & { url: string; onRetry: () => void }) {
  const [state, setState] = useState<MapLayerStatus["state"]>("loading");
  const layer = useRef<LeafletImageOverlay | null>(null);
  const statusCallback = useLatestMapValue(onStatus);
  const leafletBounds = useMemo(() => latLngBounds(bounds), [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]]);
  useEffect(() => { statusCallback.current?.({ id, title, state }); }, [id, title, state, statusCallback]);
  const markImage = useCallback(() => {
    const image = layer.current?.getElement();
    if (image) {
      setSourceMetadata(image, { id, title, time });
      image.alt = sourceAccessibleLabel(title, time);
      image.dataset.geospatialStatus = state;
    }
  }, [id, title, time, state]);
  useEffect(markImage, [markImage]);
  const notice = useMemo(() => state === "loading" ? <div className="flex items-center gap-[7px] rounded-[5px] border border-solid border-[#424246] bg-[#202023ed] px-[11px] py-[8px] text-[12px] text-muted-foreground" role="status" data-testid="map-raster-loading" data-geospatial-layer={id}><LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" />Carregando imagem: {title}…</div> : state === "error" ? <div className="flex flex-col gap-[6px] rounded-[5px] border border-solid border-[#55555c] bg-[#222225] p-[12px] text-[12px] text-[#d0d0d6]" role="status" data-testid="map-raster-error" data-geospatial-layer={id}>
    <span>Não foi possível carregar a imagem: {title}.</span><Button className={cn(textButtonClass, "self-start")} onClick={onRetry} variant="native" aria-label={`Tentar novamente: ${title}`}>Tentar novamente</Button>
  </div> : null, [state, id, title, onRetry]);
  useMapNotice(`raster:${id}`, notice);
  return <ImageOverlay ref={layer} url={url} bounds={leafletBounds} opacity={opacity} attribution={attribution} eventHandlers={{ add: markImage, load: () => { markImage(); setState("ready"); }, error: () => { markImage(); setState("error"); } }} />;
}

/** Native image loading only: authentication and artifact lookup belong to callers. */
export default function MapRasterLayer(props: MapRasterLayerProps) {
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  if (!props.url || props.visible === false) return null;
  // A new URL or explicit retry owns a fresh lifecycle. Opacity and bounds
  // update the existing overlay without resetting its status or the viewport.
  return <RasterImage key={`${props.id}:${props.url}:${revision}`} {...props} url={props.url} onRetry={retry} />;
}
