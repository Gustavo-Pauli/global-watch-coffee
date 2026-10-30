import { resultExtensions, type SceneQuality } from './analysis-artifacts';
export { numericsSupported } from './chat-numerics';

export type Facts = {
  date: string | null;
  candidate_polygon_count: number;
  candidate_area_ha: number;
  ndvi_median: number | null;
  polygons: { id: number; area_ha: number; ndvi_mean?: number | null; border?: boolean }[];
  limitations: string;
  method?: string;
  quality?: SceneQuality & { excluded_percent: number };
  subject_polygon_id?: number;
};

export type ChatTurn = { role: 'user' | 'assistant'; text: string };
/** Conversation is untrusted context, never a source of measured facts. */
export function chatHistory(value: unknown): ChatTurn[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) return null;
  if (value.some(turn => !turn || typeof turn !== 'object' || !['user', 'assistant'].includes(turn.role)
    || typeof turn.text !== 'string' || turn.text.trim().length < 1 || turn.text.length > 1200)) return null;
  return value.map(turn => ({ role: turn.role, text: turn.text.trim() }));
}

export function methodContext(facts: Facts) {
  return facts.method === 'rf_purified_multiclass_2.0'
    ? 'A classificação usa Random Forest multiclasse, bandas azul, verde, vermelho e infravermelho próximo, NDVI, GNDVI, EVI2 e textura. O treinamento usa rótulos fracos de café e outras classes do MapBiomas, com filtragem espacial. As áreas selecionadas são vetorizadas em polígonos; os hectares são calculados de forma geodésica no elipsoide WGS84. NDVI mediano descreve os pixels válidos da cena inteira, não apenas os polígonos de café. A máscara de qualidade, quando enviada, exclui pixels inválidos, nuvens e sombras. Não foi calculada produtividade, espécie de café, idade, saúde da lavoura, risco climático ou acurácia de campo.'
    : 'O resultado contém áreas candidatas e índice espectral; detalhes específicos do classificador não estão disponíveis neste contexto.';
}

export function reportFacts(data: unknown): Facts {
  if (!data || typeof data !== 'object') throw new Error('Resultado ausente.');
  const record = data as { result?: Record<string, unknown>; geojson?: { features?: {properties?: Record<string, unknown>}[] } };
  if (!record.result || !Array.isArray(record.geojson?.features)) throw new Error('Resultado ausente.');
  const r = record.result;
  const count = Number(r.candidate_polygon_count);
  const area = Number(r.candidate_area_ha);
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(area) || area < 0)
    throw new Error('Resultado inválido.');
  const ndvi = typeof r.ndvi_median === 'number' && Number.isFinite(r.ndvi_median) ? r.ndvi_median : null;
  const extended = resultExtensions(r);
  return {
    date: typeof r.acquisition_date === 'string' ? r.acquisition_date : null,
    candidate_polygon_count: count,
    candidate_area_ha: area,
    ndvi_median: ndvi,
    limitations: String(r.limitations || 'Classificação exploratória, sem validação de campo.'),
    method: typeof r.method === 'string' ? r.method : undefined,
    ...(extended ? { quality: { ...extended.quality,
      excluded_percent: Math.round((extended.quality.total_pixels - extended.quality.eligible_pixels) / extended.quality.total_pixels * 1000) / 10,
    } } : {}),
    polygons: record.geojson.features.map(f => ({
      id: Number(f.properties?.id), area_ha: Number(f.properties?.area_ha),
      ...(extended ? {
        ndvi_mean: typeof f.properties?.ndvi_mean === 'number' && Number.isFinite(f.properties.ndvi_mean)
          && f.properties.ndvi_mean >= -1 && f.properties.ndvi_mean <= 1 ? f.properties.ndvi_mean : null,
        border: f.properties?.touches_scene_boundary === true,
      } : {}),
    })).filter(p => Number.isSafeInteger(p.id) && p.id > 0 && Number.isFinite(p.area_ha) && p.area_ha >= 0),
  };
}

/** Keep LLM context bounded while retaining a specifically requested polygon. */
export function contextFacts(question: string, facts: Facts): Facts {
  const requested = Array.from(question.matchAll(/(?:pol[ií]gono\s*(?:n[úu]mero\s*|ID\s*)?|\bID\s*)(\d+)/gi)).at(-1);
  const polygon = requested ? facts.polygons.find(p => p.id === Number(requested[1])) : undefined;
  const polygons = facts.polygons.slice(0, polygon ? 249 : 250);
  if (polygon && !polygons.some(p => p.id === polygon.id)) polygons.push(polygon);
  const current = question.split('\n').at(-1) ?? question;
  const globalQuestion = /(?:NDVI|área).*(?:da cena|da imagem|da análise|global)|(?:cena|imagem).*(?:NDVI|área)/i.test(current);
  return { ...facts, polygons, subject_polygon_id: globalQuestion ? undefined : polygon?.id };
}

function br(n: number, decimals = 2) { return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }

export function explain(question: string, facts: Facts) {
  const q = question.toLowerCase();
  const requested = contextFacts(question, facts).subject_polygon_id ?? facts.subject_polygon_id;
  if (/ndvi/.test(q) && requested && !/mediano|da cena|da imagem|global/.test(q)) {
    const polygon = facts.polygons.find(p => p.id === requested);
    return polygon && polygon.ndvi_mean != null
      ? `O polígono ${polygon.id} tem NDVI médio de ${br(polygon.ndvi_mean, 3)} nos pixels válidos para o índice. Isso não confirma a cultura.`
      : 'O NDVI médio desse polígono não está disponível nesta análise.';
  }
  if (/pixels|qualidade|mascar|scl|nuvens/.test(q) && facts.quality) {
    const quality = facts.quality;
    return `${br(quality.eligible_pixels, 0)} de ${br(quality.total_pixels, 0)} pixels foram elegíveis para a classificação (${br(quality.eligible_percent, 1)}%). ${quality.scl_applied ? 'A máscara SCL foi aplicada.' : 'Não foi enviada máscara SCL.'} Pixels excluídos não representam apenas nuvens.`;
  }
  if (/baix|download|export|geojson/.test(q)) return 'Use Baixar arquivos no alto à direita do mapa. GeoJSON contém os polígonos e suas áreas; Imagem com polígonos exporta o PNG da classificação.';
  if (/campo|verificar|validar/.test(q)) return 'Como orientação para verificar o resultado: compare os limites com a imagem, escolha polígonos para vistoria e confirme a cultura com observação no local ou dados independentes. Essa verificação ainda não foi realizada pela aplicação.';
  if (/método|metodo|como.*(?:cheg|calcul|identific|classific)/.test(q)) return methodContext(facts);
  if (/\b(?:data|quando)\b/.test(q)) return `Data da imagem analisada: ${facts.date ?? 'não fornecida'}. O mapa de fundo pode usar imagens de outras datas.`;
  if (/maior|visita|vistoria/.test(q) && facts.polygons.length) {
    const largest = facts.polygons.reduce((a, b) => a.area_ha >= b.area_ha ? a : b);
    return `O maior é o polígono ${largest.id}, com ${br(largest.area_ha)} ha. O tamanho pode orientar uma primeira vistoria, mas não representa maior confiança na classificação.`;
  }
  const idMatch = q.match(/pol[ií]gono\s*(?:n[úu]mero\s*)?(\d+)/);
  if (idMatch && /hectare|área|tamanho/.test(q)) {
    const polygon = facts.polygons.find(p => p.id === Number(idMatch[1]));
    return polygon ? `O polígono ${polygon.id} tem ${br(polygon.area_ha)} ha estimados. Café não confirmado.` : 'Esse polígono não está presente nos resultados.';
  }
  if (/quanto|hectare|área|tamanho|polígono|poligono/.test(q))
    return `Foram gerados ${facts.candidate_polygon_count} polígonos candidatos, somando ${br(facts.candidate_area_ha)} hectares. ${/limita/.test(q) ? facts.limitations : 'Não são cafezais comprovados.'}`;
  if (/ndvi|índice|vegetação/.test(q))
    return `O NDVI mediano da cena válida é ${facts.ndvi_median === null ? 'indisponível' : br(facts.ndvi_median,3)}. Isso não comprova que a vegetação é café.`;
  if (/limita|erro|precisão|confiança|certeza|floresta/.test(q))
    return `${facts.limitations} Não há verdade de campo; escores do modelo não equivalem a probabilidades calibradas.`;
  if (/data|quando|imagem/.test(q)) return `Data informada: ${facts.date ?? 'não fornecida'}.`;
  return 'A análise é exploratória. Posso explicar áreas candidatas, índices espectrais, polígonos e limitações, mas não confirmar café sem dados independentes.';
}

/** Conservative screening, not proof of the semantic truth of arbitrary LLM prose. */
export function unsupportedClaims(answer: string) {
  return answer.split(/[.!?;,\n]|\b(?:mas|porém|contudo|entretanto)\b/i).some(sentence => {
    if (/\b(?:não|sem|nunca)\b/i.test(sentence)) return false;
    return /(?:café|cafezais).*(?:confirmad|comprovad|validad)|(?:confirmad|comprovad|validad).*(?:café|cafezais)|(?:é|são)\s+café\b|(?:precisão|acurácia|confiança)\s+(?:alta|garantida|comprovada)/i.test(sentence);
  });
}
