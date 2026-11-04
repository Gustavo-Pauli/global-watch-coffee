"use client";
import { cn } from "@/lib/utils";
import * as Switch from "@/components/ui/switch";
import { LoaderCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { textButtonClass } from "@/components/ui/action";
import type { Visualization, VisualizationManifest } from "@/lib/analysis-artifacts";
import type { BasemapId } from "./sources";
import { formatDate } from "@/features/analyses/types";
import MapLayersControl from "./MapLayersControl";
import BasemapPicker from "./BasemapPicker";
type Props = {
    basemap: BasemapId;
    onBasemap: (value: BasemapId) => void;
    hasKey: boolean;
    hasImage: boolean;
    showRaster: boolean;
    onRaster: (value: boolean) => void;
    showPolygons: boolean;
    onPolygons: (value: boolean) => void;
    acquisitionDate: string | null;
    modes: VisualizationManifest;
    visualization: Visualization;
    onVisualization: (value: Visualization) => void;
    opacity: number;
    onOpacity: (value: number) => void;
    imageLoading: boolean;
    imageError: string;
    retryImage: () => void;
};
export default function MapLayersPicker(props: Props) {
  return <MapLayersControl>
    <BasemapPicker value={props.basemap} onChange={props.onBasemap} hasKey={props.hasKey} />
          <div className={"mt-[17px] border-t border-solid border-border pt-[15px]"}>
            <div className={"mb-[7px]"}>
              <h3 className={"text-[12px] font-medium"}>Resultado</h3>
              <span className={"mt-[5px] block text-[12px] text-muted-foreground"}>Aquisição: <time dateTime={props.acquisitionDate ?? undefined}>{formatDate(props.acquisitionDate)}</time></span>
            </div>
            {Object.keys(props.modes).length > 1 && <div className="mb-[13px] mt-[4px]">
              <label className="mb-[7px] block text-[12px] text-muted-foreground" htmlFor="analysis-visualization">Visualização</label>
              <Select value={props.visualization} onValueChange={value => props.onVisualization(value as Visualization)} disabled={!props.showRaster}>
                <SelectTrigger id="analysis-visualization" className="h-[35px] w-full" aria-label="Visualização da imagem">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="rgb">Cor natural · RGB</SelectItem>
                  {props.modes.false_color && <SelectItem value="false_color">Falsa cor · B08, B04, B03</SelectItem>}
                  {props.modes.ndvi && <SelectItem value="ndvi">NDVI · vegetação</SelectItem>}
                </SelectContent>
              </Select>
              {props.visualization === "false_color" && <p className="mt-[7px] text-[11px] leading-[1.5] text-muted-foreground">A vegetação aparece em tons de vermelho.</p>}
            </div>}
            <div className="mb-[9px] mt-[3px]">
              <div className="mb-[5px] flex justify-between gap-[12px] text-[12px] text-muted-foreground">
                <label htmlFor="analysis-opacity">Opacidade da imagem</label>
                <output htmlFor="analysis-opacity" className="tabular-nums">{props.opacity}%</output>
              </div>
              <input id="analysis-opacity" className="m-0 h-[24px] w-full accent-[var(--accent)] disabled:opacity-40" type="range" min={0} max={100} step={5} value={props.opacity} onChange={event => props.onOpacity(Number(event.target.value))} disabled={!props.showRaster || !props.hasImage} />
            </div>
            {props.imageLoading && <p role="status" className="mb-[8px] flex items-center gap-[7px] text-[12px] text-muted-foreground"><LoaderCircle size={13} className="animate-spin" />Carregando imagem…</p>}
            {props.imageError && <div role="alert" className="mb-[10px] text-[12px] leading-[1.5] text-[var(--error)]">
              <p>{props.imageError}</p>
              <Button variant="native" className={cn(textButtonClass, "mt-[6px]")} onClick={props.retryImage}>Tentar novamente</Button>
            </div>}
            <div className={"flex min-h-[43px] items-center justify-between gap-[16px] pointer-coarse:min-h-[45px]"}>
              <label htmlFor="analysis-raster" className={"flex flex-1 cursor-pointer items-center gap-[9px] py-[9px] text-[12px]"}>
                <span className={"size-[11px] shrink-0 border border-solid border-[#a6b18f] bg-[#8a906a]"}/>
                <span>Imagem analisada</span>
              </label>
              <Switch.Root className={"mr-[2px]"} id="analysis-raster" checked={props.showRaster} onCheckedChange={props.onRaster} disabled={!props.hasImage} aria-label="Imagem analisada">
                <Switch.Thumb />
              </Switch.Root>
            </div>
            <div className={"flex min-h-[43px] items-center justify-between gap-[16px] pointer-coarse:min-h-[45px]"}>
              <label htmlFor="analysis-polygons" className={"flex flex-1 cursor-pointer items-center gap-[9px] py-[9px] text-[12px]"}>
                <span className={"size-[11px] shrink-0 border-[1.5px] border-solid border-[var(--accent)] bg-[#c0d6a633]"}/>
                <span>Plantações de Café</span>
              </label>
              <Switch.Root className={"mr-[2px]"} id="analysis-polygons" checked={props.showPolygons} onCheckedChange={props.onPolygons} aria-label="Plantações de Café">
                <Switch.Thumb />
              </Switch.Root>
            </div>
          </div>
  </MapLayersControl>;
}
