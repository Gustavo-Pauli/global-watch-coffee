"use client";

import { useEffect, useRef, useState } from "react";
import { availableVisualizations, type Visualization } from "@/lib/analysis-artifacts";
import { requestSignal } from "@/lib/client-api";
import type { AnalysisResult } from "@/features/analyses/types";

/** Blob URLs stay local to one analysis. A failed mode never replaces a usable image. */
export function useRaster(id: string, result: AnalysisResult | undefined) {
  const [visualization, setVisualization] = useState<Visualization>("rgb");
  const [rendered, setRendered] = useState<Visualization>("rgb");
  const [overlay, setOverlay] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const cache = useRef(new Map<Visualization, string>());
  const current = useRef<Visualization>("rgb");
  const failed = useRef<Visualization | null>(null);
  const modes = availableVisualizations(result);
  const kind = modes[visualization];

  useEffect(() => {
    const urls = cache.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [id, result]);

  useEffect(() => {
    if (!result || !kind) return;
    const controller = new AbortController();
    const cached = cache.current.get(visualization);
    if (cached) {
      setOverlay(cached);
      current.current = visualization;
      setRendered(visualization);
      setLoading(false);
      return;
    }
    setLoading(true);
    async function load() {
      try {
        const response = await fetch(`/api/analyses/${id}/files/${kind}`, {
          credentials: "same-origin", cache: "no-store",
          signal: requestSignal(controller.signal, 60_000),
        });
        if (!response.ok) throw new Error("Imagem indisponível");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
        if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
        cache.current.set(visualization, url);
        setOverlay(url);
        current.current = visualization;
        setRendered(visualization);
        failed.current = null;
      } catch {
        if (controller.signal.aborted) return;
        failed.current = visualization;
        setError("Não foi possível carregar a imagem. Tente novamente.");
        setVisualization(current.current);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [id, result, kind, visualization, revision]);

  return { overlay, visualization, rendered, loading, error, modes,
    select: (value: Visualization) => { failed.current = null; setError(""); setVisualization(value); },
    retry: () => { setError(""); if (failed.current) setVisualization(failed.current); setRevision(value => value + 1); } };
}
