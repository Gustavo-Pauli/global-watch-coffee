"use client";

import { LocateFixed, Minus, Plus } from "lucide-react";
import { useMap } from "react-leaflet";
import { cn } from "@/lib/utils";
import MapToolButton, { mapControlGroupClass } from "../MapToolButton";
import { useGeospatialMapControls } from "./GeospatialMap";

export default function MapNavigation({ fitLabel = "Enquadrar imagem", className }: { fitLabel?: string; className?: string }) {
  const map = useMap();
  const { fit } = useGeospatialMapControls();
  return <div className={cn(mapControlGroupClass, "absolute bottom-[41px] right-[14px] z-[800] max-[760px]:right-[12px]", className)} aria-label="Navegação do mapa" onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} data-testid="map-navigation">
    <MapToolButton label="Aproximar mapa" onClick={() => map.zoomIn()}><Plus size={18} /></MapToolButton>
    <MapToolButton label="Afastar mapa" onClick={() => map.zoomOut()}><Minus size={18} /></MapToolButton>
    <MapToolButton label={fitLabel} onClick={fit}><LocateFixed size={18} /></MapToolButton>
  </div>;
}
