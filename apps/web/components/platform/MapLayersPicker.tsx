"use client";

import * as Popover from "radix-ui/popover";
import * as RadioGroup from "radix-ui/radio-group";
import * as Switch from "radix-ui/switch";
import { ChevronDown, Layers, X } from "lucide-react";
import { BASEMAPS, basemapSource, type BasemapId } from "../map-sources";
import { formatDate } from "../analysis-types";

type Props = {
  basemap: BasemapId;
  onBasemap: (value: BasemapId) => void;
  hasKey: boolean;
  date: string | null;
  hasImage: boolean;
  showRaster: boolean;
  onRaster: (value: boolean) => void;
  showPolygons: boolean;
  onPolygons: (value: boolean) => void;
};

export default function MapLayersPicker(props: Props) {
  const source = basemapSource(props.basemap);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="tool-button source-trigger"
          aria-label="Mapa e camadas"
        >
          <Layers size={17} />
          <span>{source.title}</span>
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="map-layers-popover"
          sideOffset={9}
          align="start"
          collisionPadding={12}
          aria-label="Mapa e camadas"
        >
          <div className="picker-header">
            <h2>Mapa e camadas</h2>
            <Popover.Close asChild>
              <button className="icon-button" aria-label="Fechar camadas">
                <X size={17} />
              </button>
            </Popover.Close>
          </div>
          <h3 className="picker-section-label">Mapa de referência</h3>
          <RadioGroup.Root
            value={props.basemap}
            onValueChange={(value) => props.onBasemap(value as BasemapId)}
            aria-label="Mapa de referência"
            className="basemap-options"
          >
            {BASEMAPS.map((item) => (
              <label
                className="basemap-option"
                key={item.id}
                data-disabled={
                  item.id !== "none" && !props.hasKey ? "" : undefined
                }
              >
                <RadioGroup.Item
                  className="basemap-radio"
                  value={item.id}
                  disabled={item.id !== "none" && !props.hasKey}
                  aria-label={item.title}
                >
                  <RadioGroup.Indicator className="basemap-radio-dot" />
                </RadioGroup.Item>
                <span
                  className={`basemap-preview preview-${item.id}`}
                  aria-hidden="true"
                />
                <span className="basemap-option-copy">
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </span>
              </label>
            ))}
          </RadioGroup.Root>
          <p className="source-context">
            {source.time.kind === "mosaic"
          ? `${source.time.label}. Não corresponde à aquisição da análise.`
              : source.time.kind === "reference"
                ? source.time.label
                : formatDate(source.time.date)}
          </p>
          {!props.hasKey && (
            <p className="form-error">
              Mapa de referência indisponível neste ambiente.
            </p>
          )}
          <div className="analysis-layers">
            <div className="analysis-layers-heading">
              <h3>Dados da análise</h3>
              <span>{formatDate(props.date)}</span>
            </div>
            <div className="compact-layer-row">
              <label htmlFor="analysis-raster">
                <span className="layer-key layer-key-image" />
                <span>Imagem analisada</span>
              </label>
              <Switch.Root
                className="switch"
                id="analysis-raster"
                checked={props.showRaster}
                onCheckedChange={props.onRaster}
                disabled={!props.hasImage}
                aria-label="Imagem analisada"
              >
                <Switch.Thumb className="switch-thumb" />
              </Switch.Root>
            </div>
            <div className="compact-layer-row">
              <label htmlFor="analysis-polygons">
                <span className="layer-key layer-key-polygons" />
                <span>Áreas candidatas</span>
              </label>
              <Switch.Root
                className="switch"
                id="analysis-polygons"
                checked={props.showPolygons}
                onCheckedChange={props.onPolygons}
                aria-label="Áreas candidatas"
              >
                <Switch.Thumb className="switch-thumb" />
              </Switch.Root>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
