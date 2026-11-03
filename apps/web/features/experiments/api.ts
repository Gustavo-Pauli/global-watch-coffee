"use client";

import { requestSignal } from "@/lib/client-api";

export class LabRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function labJSON<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: requestSignal(init.signal) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new LabRequestError(typeof body?.detail === "string" ? body.detail : "Não foi possível carregar os dados do estudo.", response.status);
  if (body === null) throw new LabRequestError("O serviço retornou uma resposta incompleta.", 502);
  return body as T;
}

export const labDate = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "Não observado";
export const labNumber = (value: number, digits = 1) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
export const labTiming = {
  observed_new_recent_loss: "Mudança nova observada na série",
  left_censored_possible_loss_since_baseline: "Já alterado na primeira observação útil",
  mixed_censoring_candidate: "Intervalos de mudança misturados",
};
