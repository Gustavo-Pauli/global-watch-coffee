# Shared geospatial map

`engine/GeospatialMap` is the only product component that creates a Leaflet map.
It requires latitude/longitude bounds and composes layers and controls as children.
There is no fixed location, study identifier, authentication or model vocabulary in
the engine. Keep the existing client-only dynamic imports: Leaflet needs the DOM.
Import pure types from `engine/types`, not the client component barrel.

## Components and ownership

- `GeospatialMap`: initial framing, resize observer, background interactions,
  metric scale and a stack of independent layer notices. Resizing invalidates the
  canvas without resetting the user's view. Framing options may be a function
  when an adapter needs to account for a floating panel.
- `MapNavigation`: the same zoom, zoom out and fit controls in both workspaces.
- `MapTileLayer`: a supplied URL, provider credits, time metadata, optional logo
  and retry. `sources.ts` and `BasemapLayer` adapt MapTiler outside the engine.
- `MapRasterLayer`: a georeferenced image URL, bounds, opacity, visibility,
  acquisition metadata, loading and retry. Each image has its own lifecycle;
  changing opacity does not recreate the map. URL resolution, authorization,
  cancellation and blob caching remain in the calling adapter.
- `MapGeoJSONLayer`: independent data, styles, visibility, selection and framing.
  Feature IDs must be unique within one layer; another layer may reuse them.
  Unidentified features can be styled without being selectable. Increment the
  focus request sequence to explicitly frame the same feature again. Filtering
  or toggling a layer does not replay an already applied request.
- `MapLayersControl` and `BasemapPicker`: common UI chrome. The analysis and Lab
  supply their own visualization and result controls.

`SatelliteMap` retains numeric polygon IDs, area/NDVI popups, the assistant action
and inspector insets. `use-raster.ts` retains the existing private API, decode
validation, cancellation, cache and last usable image behavior. `LabMap` retains
study URLs, string IDs, frozen candidates, tooltips and the two dated observations.
Research results and the scientific pipeline are unchanged.

## Sources and extensions

Raster bounds use `[latitude, longitude]`; GeoJSON coordinates use
`[longitude, latitude]`. A `SourceTime` describes an acquisition, an undated mosaic
or a reference map. A scene's date must never become the acquisition date of its
basemap. Imported plain-text credits must be escaped before passing them to
Leaflet's HTML attribution option. Region clear-pixel percentage is not scene
cloud-cover percentage.

New URL tile/image providers can supply the existing layer contracts. Other
renderers can be composed inside the same map. This PR does not implement COG
reading, STAC discovery, reprojection services, a tile server or a layer registry.
Georeference arrays must already describe the renderer's geographic extent.

## Verification

`tests/browser/map-engine.spec.ts` exercises the actual two workspaces with small
synthetic HTTP fixtures. `map-engine-layers.spec.ts` mounts the actual engine with
React/Leaflet and its installed CSS, testing multiple layers without a product
route. Its bundler is the locked esbuild dependency of the existing `tsx` tooling;
no dependency was added. Both suites intercept network requests and need no data
download, login, database, provider credentials or GPU.

Against an existing local web server:

```powershell
pnpm.cmd --filter @global-watch/web exec playwright test tests/browser/map-engine.spec.ts tests/browser/map-engine-layers.spec.ts
```

CI builds with placeholder provider settings, installs Chromium and opts into a
Playwright-managed local server via `MAP_BROWSER_START_SERVER=1`. Browser fixtures
test UI behavior, not geospatial accuracy or authentication. Existing Node/DB
regressions and the opt-in real-artifact browser suites retain those boundaries.
