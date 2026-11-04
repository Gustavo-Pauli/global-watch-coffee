import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tooltip from 'radix-ui/tooltip';
import { useMap } from 'react-leaflet';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { Layer, Path } from 'leaflet';
import GeospatialMap from '../../../features/map/engine/GeospatialMap';
import MapGeoJSONLayer from '../../../features/map/engine/MapGeoJSONLayer';
import MapRasterLayer from '../../../features/map/engine/MapRasterLayer';
import MapTileLayer from '../../../features/map/engine/MapTileLayer';
import type { MapBounds, MapFocusRequest, MapLayerStatus, MapTileSource } from '../../../features/map/engine/types';

const bounds: MapBounds = [[0, 0], [.04, .04]];
type Properties = { id: string; label: string };
function collection(id: string, label: string, west: number, south: number): FeatureCollection<Polygon, Properties> {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id, label }, geometry: {
    type: 'Polygon', coordinates: [[[west, south], [west + .008, south], [west + .008, south + .008], [west, south + .008], [west, south]]],
  } }] };
}
const initialAlpha = collection('shared', 'Alpha', .004, .004);
const replacementAlpha = collection('other', 'Replacement', .004, .004);
const initialBeta = collection('shared', 'Beta', .028, .028);
const idlessData = collection('unidentified', 'Unidentified reference', .015, .015);
const noFeatureId = () => null;
const featureId = (feature: Feature) => String(feature.properties?.id);
function decorate(layerId: string) {
  return (feature: Feature, layer: Layer) => {
    const popup = document.createElement('span');
    popup.textContent = String(feature.properties?.label);
    layer.bindPopup(popup);
    layer.on('add', () => {
      const element = (layer as Path).getElement();
      element?.setAttribute('data-layer', layerId);
      element?.setAttribute('data-feature', String(feature.properties?.id));
    });
  };
}
const decorateAlpha = decorate('alpha');
const decorateBeta = decorate('beta');
const decorateIdless = decorate('idless');
const alphaStyle = { color: '#2266aa', fillColor: '#2266aa', fillOpacity: .4, weight: 2 };
const alphaSelected = { color: '#11ddff', weight: 5, fillOpacity: .7, dashArray: '7,3' };
const betaStyle = { color: '#773399', fillColor: '#773399', fillOpacity: .4, weight: 2 };
const betaSelected = { color: '#ff1199', weight: 5, fillOpacity: .7 };
const betaAlternate = { color: '#779944', fillColor: '#779944', fillOpacity: .4, weight: 2 };
const betaAlternateSelected = { color: '#88ee00', weight: 5, fillOpacity: .7 };
const idlessStyle = { color: '#aa1122', weight: 6, dashArray: '8,4' };
const idlessAlternateStyle = { color: '#55bb44' };
const emptySelectedStyle = {};
const shiftedRasterBounds: MapBounds = [[.01, .01], [.03, .03]];
const tileSource: MapTileSource = { id: 'offline-reference', title: 'Offline reference tiles',
  url: 'http://127.0.0.1/engine/tiles/{z}/{x}/{y}.png', attribution: 'Offline tile credit',
  time: { kind: 'reference', label: 'Reference without acquisition date' }, maxNativeZoom: 18 };
const fitOptions = { padding: [20, 20] as [number, number], animate: false };

function Probe({ onView }: { onView: (view: { lat: number; lng: number; zoom: number }) => void }) {
  const map = useMap();
  useEffect(() => {
    const update = () => { const center = map.getCenter(); onView({ lat: center.lat, lng: center.lng, zoom: map.getZoom() }); };
    map.on('moveend zoomend', update);
    update();
    return () => { map.off('moveend zoomend', update); };
  }, [map, onView]);
  return null;
}

function Fixture() {
  const [alpha, setAlpha] = useState<string | null>(null);
  const [beta, setBeta] = useState<string | null>(null);
  const [alphaFocus, setAlphaFocus] = useState<MapFocusRequest<string>>(null);
  const [betaFocus, setBetaFocus] = useState<MapFocusRequest<string>>(null);
  const [alphaVisible, setAlphaVisible] = useState(true);
  const [alphaMounted, setAlphaMounted] = useState(true);
  const [alphaData, setAlphaData] = useState(initialAlpha);
  const [alternateStyle, setAlternateStyle] = useState(false);
  const [view, setView] = useState({ lat: 0, lng: 0, zoom: 0 });
  const [rastersEnabled, setRastersEnabled] = useState(false);
  const [comparisonVisible, setComparisonVisible] = useState(true);
  const [comparisonRevision, setComparisonRevision] = useState(0);
  const [comparisonOpacity, setComparisonOpacity] = useState(.6);
  const [statuses, setStatuses] = useState<Record<string, MapLayerStatus['state']>>({});
  const [tilesEnabled, setTilesEnabled] = useState(false);
  const [idlessEnabled, setIdlessEnabled] = useState(false);
  const [idlessAlternate, setIdlessAlternate] = useState(false);
  const [rasterBounds, setRasterBounds] = useState(bounds);
  const status = (next: MapLayerStatus) => setStatuses(previous => previous[next.id] === next.state ? previous : { ...previous, [next.id]: next.state });
  const focusAlpha = () => { setAlpha('shared'); setAlphaFocus(previous => ({ id: 'shared', sequence: (previous?.sequence ?? 0) + 1 })); };
  const focusBeta = () => { setBeta('shared'); setBetaFocus(previous => ({ id: 'shared', sequence: (previous?.sequence ?? 0) + 1 })); };
  return <Tooltip.Provider><main>
    <button onClick={focusAlpha}>Focus alpha</button><button onClick={focusBeta}>Focus beta</button>
    <button onClick={() => setAlpha(null)}>Clear alpha</button>
    <button onClick={() => setAlphaVisible(value => !value)}>Toggle alpha visibility</button>
    <button onClick={() => setAlphaData(replacementAlpha)}>Replace alpha data</button>
    <button onClick={() => setAlphaMounted(value => !value)}>Toggle alpha mounting</button>
    <button onClick={() => setAlternateStyle(value => !value)}>Change beta style</button>
    <button onClick={() => setRastersEnabled(true)}>Load rasters</button>
    <button onClick={() => setComparisonRevision(value => value + 1)}>Change comparison URL</button>
    <button onClick={() => setComparisonVisible(value => !value)}>Toggle comparison visibility</button>
    <button onClick={() => setComparisonOpacity(.2)}>Reduce comparison opacity</button>
    <button onClick={() => setTilesEnabled(value => !value)}>Toggle reference tiles</button>
    <button onClick={() => setIdlessEnabled(true)}>Load ID-less reference</button>
    <button onClick={() => setIdlessAlternate(value => !value)}>Change ID-less style</button>
    <button onClick={() => setAlphaData({ ...initialAlpha, features: [...initialAlpha.features] })}>Refresh alpha data</button>
    <button onClick={() => setRasterBounds(shiftedRasterBounds)}>Change raster bounds</button>
    <output data-testid="engine-selection">{JSON.stringify({ alpha, beta })}</output>
    <output data-testid="engine-view">{JSON.stringify(view)}</output>
    <output data-testid="engine-status">{JSON.stringify(statuses)}</output>
    <div id="fixture-map"><GeospatialMap initialBounds={bounds} fitOptions={fitOptions} inertia={false}>
      {tilesEnabled && <MapTileLayer source={tileSource} />}
      {rastersEnabled && <>
        <MapRasterLayer id="reference" title="Reference scene" url="http://127.0.0.1/engine/reference.png" bounds={rasterBounds} opacity={1} attribution="Offline acquisition reference credit" time={{ kind: 'acquisition', date: '2025-09-01' }} onStatus={status} />
        <MapRasterLayer id="comparison" title="Comparison scene" url={`http://127.0.0.1/engine/comparison.png?revision=${comparisonRevision}`} bounds={bounds} opacity={comparisonOpacity} visible={comparisonVisible} attribution="Offline acquisition comparison credit" time={{ kind: 'acquisition', date: '2026-09-01' }} onStatus={status} />
      </>}
      {alphaMounted && <MapGeoJSONLayer id="alpha" data={alphaData} getFeatureId={featureId} selectedId={alpha} onSelect={setAlpha} focusRequest={alphaFocus} style={alphaStyle} selectedStyle={alphaSelected} focusOptions={{ maxZoom: 15, animate: false }} onEachFeature={decorateAlpha} visible={alphaVisible} />}
      <MapGeoJSONLayer id="beta" data={initialBeta} getFeatureId={featureId} selectedId={beta} onSelect={setBeta} focusRequest={betaFocus} style={alternateStyle ? betaAlternate : betaStyle} selectedStyle={alternateStyle ? betaAlternateSelected : betaSelected} focusOptions={{ maxZoom: 15, animate: false }} onEachFeature={decorateBeta} />
      {idlessEnabled && <MapGeoJSONLayer id="idless" data={idlessData} getFeatureId={noFeatureId} selectedId={null} focusRequest={null} style={idlessAlternate ? idlessAlternateStyle : idlessStyle} selectedStyle={emptySelectedStyle} onEachFeature={decorateIdless} />}
      <Probe onView={setView} />
    </GeospatialMap></div>
  </main></Tooltip.Provider>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
