'use client';
import { useEffect } from 'react';
import { MapContainer, TileLayer, ImageOverlay, GeoJSON, useMap } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import type { LatLngBoundsExpression } from 'leaflet';

type Bounds = [[number,number],[number,number]];
const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
function FitBounds({ bounds }: {bounds:Bounds}) {
  const map = useMap();
  useEffect(() => { map.fitBounds(bounds as LatLngBoundsExpression, { padding: [24,24] }); }, [map,bounds]);
  return null;
}
export default function SatelliteMap({ geojson, bounds, overlay }: { geojson:FeatureCollection; bounds:Bounds;overlay:string|null }) {
  return <MapContainer className="map" center={[-21.331,-46.68]} zoom={12} zoomControl={false} scrollWheelZoom>
    <TileLayer attribution={attribution} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    {overlay && <ImageOverlay url={overlay} bounds={bounds as LatLngBoundsExpression} opacity={0.84}/>}
    <GeoJSON key={`${JSON.stringify(geojson).length}-${bounds[0][0]}`} data={geojson}
      style={{color:'#d4f768',weight:2.5,fillColor:'#a6d950',fillOpacity:.16}}
      onEachFeature={(feature,layer) => {
        const id = Number(feature.properties?.id ?? 0);
        const ha = Number(feature.properties?.area_ha ?? 0);
        layer.bindPopup(`Candidato ${Number.isFinite(id) ? id : '?'} · ${Number.isFinite(ha) ? ha.toFixed(2) : '?'} ha · Sem validação de campo`);
      }}/>
    <FitBounds bounds={bounds}/>
  </MapContainer>;
}
