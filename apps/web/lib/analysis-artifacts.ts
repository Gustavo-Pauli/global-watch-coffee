/** Shared, serializable result contract. No server services or credentials here. */
export const CORE_OUTPUTS = {
  geojson: 'candidatos.geojson', classified: 'imagem_classificada.png',
  map: 'imagem_mapa.png', rgb: 'imagem_rgb.png',
  tif: 'classificacao.tif', result: 'resultado.json',
} as const;
export const OPTIONAL_OUTPUTS = {
  false_color: 'mapa_falsa_cor.png', ndvi: 'mapa_ndvi.png',
} as const;
export const ALL_OUTPUTS = { ...CORE_OUTPUTS, ...OPTIONAL_OUTPUTS } as const;
export type OutputKind = keyof typeof ALL_OUTPUTS;
export type OptionalOutputKind = keyof typeof OPTIONAL_OUTPUTS;
export type Visualization = 'rgb' | 'false_color' | 'ndvi';
export type VisualizationManifest = { rgb: 'map'; false_color?: 'false_color'; ndvi?: 'ndvi' };

export type SceneQuality = {
  total_pixels: number;
  eligible_pixels: number;
  input_invalid_pixels: number;
  scl_excluded_pixels: number | null;
  scl_applied: boolean;
  eligible_percent: number;
  ndvi_defined_pixels: number;
};
export type AnalysisProvenance = {
  crs: string;
  resolution: { x: number; y: number; unit: string };
  bands: string[];
  model_version: string;
  parameters: { threshold: number; min_area_ha: number; coherence: boolean };
  input_sha256: string;
  scl_sha256: string | null;
  model_sha256: string;
  analysis_fingerprint: string;
  date_source: 'sample_metadata' | 'user_supplied' | 'unknown';
  area_method: 'geodesic_wgs84';
};
export type ResultExtensions = {
  schema_version: 2;
  visualizations: VisualizationManifest;
  quality: SceneQuality;
  provenance: AnalysisProvenance;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function boundedText(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function visualizationManifest(value: unknown): VisualizationManifest | null {
  if (!record(value) || value.rgb !== 'map') return null;
  if (Object.keys(value).some(key => !['rgb', 'false_color', 'ndvi'].includes(key))) return null;
  if (value.false_color !== undefined && value.false_color !== 'false_color') return null;
  if (value.ndvi !== undefined && value.ndvi !== 'ndvi') return null;
  return value as VisualizationManifest;
}

/** Invalid extensions never make a legacy/previous result unusable in the UI. */
export function resultExtensions(value: unknown): ResultExtensions | null {
  if (!record(value) || value.schema_version !== 2) return null;
  if (!visualizationManifest(value.visualizations) || !record(value.quality) || !record(value.provenance)) return null;
  const q = value.quality;
  if (![q.total_pixels, q.eligible_pixels, q.input_invalid_pixels, q.ndvi_defined_pixels].every(count)
    || !positive(q.total_pixels) || typeof q.scl_applied !== 'boolean'
    || (q.scl_applied ? !count(q.scl_excluded_pixels) : q.scl_excluded_pixels !== null)) return null;
  const total = q.total_pixels as number, eligible = q.eligible_pixels as number;
  if ((q.input_invalid_pixels as number) + (q.scl_excluded_pixels as number | null ?? 0) + eligible !== total
    || (q.ndvi_defined_pixels as number) > eligible
    || typeof q.eligible_percent !== 'number' || !Number.isFinite(q.eligible_percent)
    || Math.abs(q.eligible_percent - Math.round(eligible / total * 1000) / 10) > 1e-8
    || value.valid_pixels !== eligible) return null;
  const p = value.provenance;
  if (!boundedText(p.crs, 5000) || !record(p.resolution) || !positive(p.resolution.x) || !positive(p.resolution.y)
    || !boundedText(p.resolution.unit) || !Array.isArray(p.bands) || p.bands.join(',') !== 'B02,B03,B04,B08'
    || !boundedText(p.model_version) || p.model_version !== value.method || !record(p.parameters)
    || typeof p.parameters.threshold !== 'number' || !Number.isFinite(p.parameters.threshold)
    || p.parameters.threshold < 0.1 || p.parameters.threshold > 0.99
    || typeof p.parameters.min_area_ha !== 'number' || !Number.isFinite(p.parameters.min_area_ha) || p.parameters.min_area_ha < 0
    || typeof p.parameters.coherence !== 'boolean'
    || !hash(p.input_sha256) || !hash(p.model_sha256) || !hash(p.analysis_fingerprint)
    || (q.scl_applied ? !hash(p.scl_sha256) : p.scl_sha256 !== null)
    || !['sample_metadata', 'user_supplied', 'unknown'].includes(String(p.date_source))
    || p.area_method !== 'geodesic_wgs84') return null;
  return value as unknown as ResultExtensions;
}

/** Only fixed, allowlisted artifact keys can ever become signed Storage paths. */
export function optionalOutputKinds(value: unknown): OptionalOutputKind[] {
  const manifest = resultExtensions(value)?.visualizations;
  return (Object.keys(OPTIONAL_OUTPUTS) as OptionalOutputKind[]).filter(kind => manifest?.[kind] === kind);
}

export function availableVisualizations(value: unknown): VisualizationManifest {
  return resultExtensions(value)?.visualizations ?? { rgb: 'map' };
}

/** Completion is strict even though the reader degrades gracefully for old rows. */
export function requiredOutputKinds(value: unknown): OutputKind[] {
  if (!record(value)) throw new Error('Invalid result');
  if (value.schema_version !== undefined && value.schema_version !== 1 && value.schema_version !== 2)
    throw new Error('Unsupported result schema');
  if (value.schema_version === 2 && !resultExtensions(value)) throw new Error('Invalid result extensions');
  return [...Object.keys(CORE_OUTPUTS) as (keyof typeof CORE_OUTPUTS)[], ...optionalOutputKinds(value)];
}
