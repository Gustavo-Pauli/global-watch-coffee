import type { FeatureCollection } from "geojson";

export type Bounds = [[number, number], [number, number]];
export type AnalysisStatus = "uploading" | "processing" | "ready" | "error";
export type AnalysisResult = {
  method: string;
  acquisition_date: string | null;
  candidate_polygon_count: number;
  candidate_area_ha: number;
  valid_pixels: number;
  leaflet_bounds: Bounds;
  ndvi_median: number | null;
  limitations: string;
  model_score_not_calibrated: boolean;
};
export type AnalysisData = {
  analysis: {
    id: string;
    status: AnalysisStatus;
    scene: string | null;
    date: string | null;
  };
  result: AnalysisResult;
  geojson: FeatureCollection;
};
export type HistoryItem = {
  id: string;
  scene: string | null;
  date: string | null;
  status: AnalysisStatus;
  created: number;
};
export type WorkStage =
  | "preparing"
  | "uploading"
  | "processing"
  | "opening"
  | null;
export type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  mode?: string;
  reason?: string;
};

export function chatFallbackLabel(reason?: string) {
  if (reason === 'unsupported_numbers' || reason === 'unsupported_claims') return 'Resposta por regras · texto da IA não validado';
  if (reason === 'provider_quota') return 'Resposta por regras · limite da IA atingido';
  if (reason === 'provider_timeout') return 'Resposta por regras · IA demorou a responder';
  if (reason === 'not_configured' || reason === 'provider_configuration') return 'Resposta por regras · IA não configurada';
  if (reason === 'invalid_response') return 'Resposta por regras · resposta da IA incompleta';
  return 'Resposta por regras · IA indisponível';
}
export type DownloadKind = "geojson" | "classified" | "tif" | "rgb" | "result";

export const SCENES = [
  {
    value: "august",
    label: "Agosto",
    date: "2025-08-16",
    description: "Imagem Sentinel-2",
  },
  {
    value: "july",
    label: "Julho",
    date: "2025-07-21",
    description: "Imagem Sentinel-2",
  },
  {
    value: "october",
    label: "Outubro",
    date: "2025-10-25",
    description: "Imagem Sentinel-2",
  },
] as const;

export function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}
export function formatDate(value: string | null, long = false) {
  if (!value) return "Data não informada";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: long ? "long" : "short",
    year: "numeric",
  }).format(date);
}
export function formatCompactDate(value: string | null) {
  if (!value) return "Sem data";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
export function sceneLabel(scene: string | null) {
  return (
    SCENES.find((item) => item.value === scene)?.description ?? "Imagem enviada"
  );
}
export function sceneDate(scene: string | null, date: string | null) {
  return date ?? SCENES.find((item) => item.value === scene)?.date ?? null;
}
export function analysisTitle(id: string) {
  return `Análise ${id.slice(0, 8)}`;
}
export const STATUS_LABELS: Record<AnalysisStatus, string> = {
  uploading: "Aguardando envio",
  processing: "Processando",
  ready: "Concluída",
  error: "Falha no processamento",
};
