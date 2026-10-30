"use client";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import * as Popover from "radix-ui/popover";
import * as RadioGroup from "radix-ui/radio-group";
import * as Switch from "@/components/ui/switch";
import { Layers, LoaderCircle, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { textButtonClass } from "@/components/ui/action";
import type { Visualization, VisualizationManifest } from "@/lib/analysis-artifacts";
import { BASEMAPS, type BasemapId } from "./sources";
import { formatDate } from "@/features/analyses/types";
import MapToolButton from "./MapToolButton";
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
    return (<Popover.Root>
      <Popover.Trigger asChild>
        <MapToolButton  label="Camadas">
          <Layers size={17}/>
        </MapToolButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={"z-[2500] max-h-[calc(100dvh-145px)] w-[min(340px,calc(100vw-84px))] overflow-y-auto rounded-[8px] border border-solid border-[#45454c] bg-[#222225] px-[16px] pb-[12px] pt-[15px] shadow-[0_8px_25px_#0005] max-[760px]:max-h-[calc(100dvh-160px)]"} sideOffset={9} side="left" align="start" collisionPadding={12} aria-label="Camadas" data-testid="layer-picker">
          <div className={"-mr-[5px] -mt-[3px] mb-[12px] ml-0 flex items-center justify-between gap-[16px]"}>
            <h2 className={"text-[14px] font-medium"}>Camadas</h2>
            <Popover.Close asChild>
              <IconButton  aria-label="Fechar camadas" hitArea="popup">
                <X size={17}/>
              </IconButton>
            </Popover.Close>
          </div>
          <h3 className={"mb-[10px] text-[12px] font-normal text-muted-foreground"}>Mapa de fundo</h3>
          <RadioGroup.Root value={props.basemap} onValueChange={(value) => props.onBasemap(value as BasemapId)} aria-label="Mapa de fundo" className={"flex flex-col gap-[7px]"}>
            {BASEMAPS.map((item) => (<label className={"flex min-w-0 cursor-pointer items-center gap-[10px] rounded-[5px] border border-solid border-[#3a3a40] px-[9px] py-[9px] hover:bg-[#2d2d32] has-[[data-state=checked]]:border-[#787883] has-[[data-state=checked]]:bg-[#303035] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 pointer-coarse:min-h-[62px]"} key={item.id} data-disabled={item.id !== "none" && !props.hasKey ? "" : undefined}>
                <RadioGroup.Item className={"size-[15px] shrink-0 rounded-full border border-solid border-[#8e8e99] bg-transparent p-[3px]"} value={item.id} disabled={item.id !== "none" && !props.hasKey} aria-label={item.title}>
                  <RadioGroup.Indicator className={"block size-[7px] rounded-full bg-[var(--accent)]"}/>
                </RadioGroup.Item>
                <span className={cn("relative h-[34px] w-[32px] shrink-0 overflow-hidden rounded-[3px] border border-solid border-[#56565d]", item.id === "satellite" ? "bg-[#3f4d32] before:absolute before:left-[4px] before:top-[8px] before:h-[36px] before:w-[16px] before:rotate-[33deg] before:bg-[#837454] before:content-['']" : item.id === "streets" ? "bg-[#c5c4bb] before:absolute before:-left-[8px] before:top-[14px] before:h-[4px] before:w-[55px] before:-rotate-[35deg] before:bg-[#efefe8] before:content-[''] after:absolute after:-left-[8px] after:top-[14px] after:h-[4px] after:w-[55px] after:rotate-[70deg] after:bg-[#efefe8] after:content-['']" : "border-dashed bg-[#24262a]")} aria-hidden="true"/>
                <span className={"flex min-w-0 flex-col gap-[5px]"}>
                  <strong className={"text-[13px] font-medium"}>{item.title}</strong>
                  {item.id !== "none" && (<span className={"text-[12px] leading-[1.45] text-muted-foreground"}>{item.time.kind === "acquisition" ? formatDate(item.time.date) : item.time.label}</span>)}
                </span>
              </label>))}
          </RadioGroup.Root>
          {!props.hasKey && (<p className={"mt-[10px] text-[12px] leading-[1.6] text-[var(--error)]"}>
              Mapa de referência indisponível neste ambiente.
            </p>)}
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>);
}
