"use client";

import MapTileLayer from "./engine/MapTileLayer";
import { resolveBasemapSource, type BasemapId } from "./sources";

/** Concrete provider adapter; the engine only receives a source descriptor. */
export default function BasemapLayer({ id }: { id: BasemapId }) {
  const source = resolveBasemapSource(id, process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "");
  source.logo = <a className="absolute bottom-[6px] left-[13px] z-[600] flex rounded-[2px] bg-[#ffffffed] px-[4px] py-[2px] max-[760px]:left-[12px]" href="https://www.maptiler.com" target="_blank" rel="noopener noreferrer" aria-label="MapTiler" data-testid="maptiler-logo">
    <img src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler" width="88" height="22" className="block h-[20px] w-[80px]" />
  </a>;
  return <MapTileLayer source={source} errorTestId="basemap-error" />;
}
