import type { FeatureCollection } from "geojson";

export type Candidate = {
  id: number;
  area: number;
  ndvi: number | null;
  boundary: boolean;
};

export function candidates(geojson: FeatureCollection): Candidate[] {
  return geojson.features.flatMap(feature => {
    const properties = feature.properties;
    if (!properties || typeof properties.id !== "number" || !Number.isFinite(properties.id)) return [];
    return [{
      id: properties.id,
      area: typeof properties.area_ha === "number" ? properties.area_ha : 0,
      ndvi: typeof properties.ndvi_mean === "number" && Number.isFinite(properties.ndvi_mean)
        ? properties.ndvi_mean : null,
      boundary: properties.touches_scene_boundary === true,
    }];
  });
}

export type FocusRequest = { id: number; sequence: number } | null;
