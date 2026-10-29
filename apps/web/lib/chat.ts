export type Facts = {
  date: string | null;
  candidate_polygon_count: number;
  candidate_area_ha: number;
  ndvi_median: number | null;
  polygons: { id: number; area_ha: number }[];
  limitations: string;
};

export function reportFacts(data: unknown): Facts {
  const record = data as { result?: Record<string, unknown>; geojson?: { features?: {properties?: Record<string, unknown>}[] } };
  if (!record.result || !record.geojson?.features) throw new Error('Resultado ausente.');
  const r = record.result;
  return {
    date: typeof r.acquisition_date === 'string' ? r.acquisition_date : null,
    candidate_polygon_count: Number(r.candidate_polygon_count),
    candidate_area_ha: Number(r.candidate_area_ha),
    ndvi_median: r.ndvi_median === null ? null : Number(r.ndvi_median),
    limitations: String(r.limitations || 'Classificação exploratória, sem validação de campo.'),
    polygons: record.geojson.features.slice(0, 250).map(f => ({
      id: Number(f.properties?.id), area_ha: Number(f.properties?.area_ha),
    })),
  };
}

function br(n: number, decimals = 2) { return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }

export function explain(question: string, facts: Facts) {
  const q = question.toLowerCase();
  const idMatch = q.match(/pol[ií]gono\s*(?:n[úu]mero\s*)?(\d+)/);
  if (idMatch && /hectare|área|tamanho/.test(q)) {
    const polygon = facts.polygons.find(p => p.id === Number(idMatch[1]));
    return polygon ? `O polígono ${polygon.id} tem ${br(polygon.area_ha)} ha estimados. Café não confirmado.` : 'Esse polígono não está presente nos resultados.';
  }
  if (/quanto|hectare|área|tamanho|polígono|poligono/.test(q))
    return `Foram gerados ${facts.candidate_polygon_count} polígonos candidatos, somando ${br(facts.candidate_area_ha)} hectares. Não são cafezais comprovados.`;
  if (/ndvi|índice|vegetação/.test(q))
    return `O NDVI mediano da cena válida é ${facts.ndvi_median === null ? 'indisponível' : br(facts.ndvi_median,3)}. Isso não comprova que a vegetação é café.`;
  if (/limita|erro|precisão|confiança|certeza|floresta/.test(q))
    return `${facts.limitations} Não há verdade de campo; escores do modelo não equivalem a probabilidades calibradas.`;
  if (/data|quando|imagem/.test(q)) return `Data informada: ${facts.date ?? 'não fornecida'}.`;
  return 'A análise é exploratória. Posso explicar áreas candidatas, índices espectrais, polígonos e limitações, mas não confirmar café sem dados independentes.';
}

export function numericsSupported(answer: string, facts: Facts) {
  const known = JSON.stringify(facts).match(/\d+(?:[.,]\d+)?/g) ?? [];
  const allowed = new Set(known.map(v => v.replace(',', '.')));
  for (const m of answer.match(/\d+(?:[.,]\d+)?/g) ?? []) {
    if (m === '2') continue; // Sentinel-2
    if (!allowed.has(m.replace(',', '.'))) return false;
  }
  return true;
}
