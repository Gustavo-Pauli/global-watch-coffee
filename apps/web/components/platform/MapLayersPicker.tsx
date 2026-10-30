"use client";

import * as Popover from "radix-ui/popover";
import * as RadioGroup from "radix-ui/radio-group";
import * as Switch from "radix-ui/switch";
import { Layers, X } from "lucide-react";
import { BASEMAPS, basemapSource, type BasemapId } from "../map-sources";
import { formatDate } from "../analysis-types";
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
};

export default function MapLayersPicker(props: Props) {
  const source = basemapSource(props.basemap);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <MapToolButton className="source-trigger" label="Camadas">
          <Layers size={17} />
        </MapToolButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="map-layers-popover"
          sideOffset={9}
          align="end"
          collisionPadding={12}
          aria-label="Camadas"
        >
          <div className="picker-header">
            <h2>Camadas</h2>
            <Popover.Close asChild>
              <button className="icon-button" aria-label="Fechar camadas">
                <X size={17} />
              </button>
            </Popover.Close>
          </div>
          <h3 className="picker-section-label">Mapa de fundo</h3>
          <RadioGroup.Root
            value={props.basemap}
            onValueChange={(value) => props.onBasemap(value as BasemapId)}
            aria-label="Mapa de fundo"
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
                </span>
              </label>
            ))}
          </RadioGroup.Root>
          {source.time.kind !== "reference" && (
            <p className="source-context">
              {source.time.kind === "mosaic"
                ? source.time.label
                : formatDate(source.time.date)}
            </p>
          )}
          {!props.hasKey && (
            <p className="form-error">
              Mapa de referência indisponível neste ambiente.
            </p>
          )}
          <div className="analysis-layers">
            <div className="analysis-layers-heading">
              <h3>Resultado</h3>
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
                <span>Plantações de Café</span>
              </label>
              <Switch.Root
                className="switch"
                id="analysis-polygons"
                checked={props.showPolygons}
                onCheckedChange={props.onPolygons}
                aria-label="Plantações de Café"
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
