export type Facts = {
  date: string | null;
  candidate_polygon_count: number;
  candidate_area_ha: number;
  ndvi_median: number | null;
  polygons: { id: number; area_ha: number }[];
  limitations: string;
  method?: string;
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
    ? 'A classificação usa Random Forest multiclasse, bandas azul, verde, vermelho e infravermelho próximo, NDVI, GNDVI, EVI2 e textura. O treinamento usa rótulos fracos de café e outras classes do MapBiomas, com filtragem espacial. As áreas selecionadas são vetorizadas em polígonos e medidas no CRS projetado. NDVI mediano descreve os pixels válidos da cena inteira, não apenas os polígonos de café. A máscara de qualidade, quando enviada, exclui pixels inválidos, nuvens e sombras. Não foi calculada produtividade, espécie de café, idade, saúde da lavoura, risco climático ou acurácia de campo.'
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
  return {
    date: typeof r.acquisition_date === 'string' ? r.acquisition_date : null,
    candidate_polygon_count: count,
    candidate_area_ha: area,
    ndvi_median: ndvi,
    limitations: String(r.limitations || 'Classificação exploratória, sem validação de campo.'),
    method: typeof r.method === 'string' ? r.method : undefined,
    polygons: record.geojson.features.map(f => ({
      id: Number(f.properties?.id), area_ha: Number(f.properties?.area_ha),
    })).filter(p => Number.isSafeInteger(p.id) && p.id > 0 && Number.isFinite(p.area_ha) && p.area_ha >= 0),
  };
}

/** Keep LLM context bounded while retaining a specifically requested polygon. */
export function contextFacts(question: string, facts: Facts): Facts {
  const requested = Array.from(question.matchAll(/pol[ií]gono\s*(?:n[úu]mero\s*)?(\d+)/gi)).at(-1);
  const polygon = requested ? facts.polygons.find(p => p.id === Number(requested[1])) : undefined;
  const polygons = facts.polygons.slice(0, polygon ? 249 : 250);
  if (polygon && !polygons.some(p => p.id === polygon.id)) polygons.push(polygon);
  return { ...facts, polygons };
}

function br(n: number, decimals = 2) { return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }

export function explain(question: string, facts: Facts) {
  const q = question.toLowerCase();
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

export function numericsSupported(answer: string, facts: Facts) {
  // Formatting may wrap just the value, separating it from its semantic unit.
  // Only remove paired inline markup; validate the normalized content below.
  const plain = answer
    .replace(/`([^`\r\n]+)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)([^\r\n]*?\S)\1/g, '$2')
    .replace(/(\*|_)(?=\S)([^\r\n]*?\S)\1/g, '$2')
    .replace(/[\u00a0\u202f]/g, ' ');
  // A polygon ID or year must never authorize an area/accuracy claim.
  if (/%|\d(?:[.,]\d+)?e[+-]?\d/i.test(plain)) return false;
  const parse = (s: string) => Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  const matches = (value: number, expected: number | null) => expected !== null &&
    [expected, Number(expected.toFixed(1)), Number(expected.toFixed(2)), Number(expected.toFixed(3))].includes(value);
  let valid = true;
  let text = plain.replace(/Sentinel[-\s]?2/gi, 'Sentinel');
  // Natural wording may separate a polygon label from its ID. Keep that
  // semantic label mandatory; a bare number must not authorize a measurement.
  text = text.replace(/(?:pol[ií]gono(?:\s+(?:é|foi|o|de|com|identificado|pelo|n[úu]mero|identificador|identifica[çc][ãa]o|ID|n[º°]\.?)){0,8}|\bID)\s*[:#]?\s*(\d+)/gi, 'polígono $1');
  if (facts.method === 'rf_purified_multiclass_2.0') text = text.replace(/\bEVI[-\s]?2\b/gi, 'EVI');
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  text = text.replace(/(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi, (_, day, month, year) => {
    if (`${year}-${String(months.indexOf(month.toLowerCase()) + 1).padStart(2, '0')}-${day.padStart(2, '0')}` !== facts.date) valid = false;
    return '';
  });
  text = text.replace(/\d{4}-\d{2}-\d{2}/g, date => { if (date !== facts.date) valid = false; return ''; });
  text = text.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (_, d, m, y) => {
    if (`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` !== facts.date) valid = false;
    return '';
  });
  const mapBiomasResolution = /\bMapBiomas\s+(?:(?:de|com)\s+)?(?:resolu[çc][ãa]o\s+(?:espacial\s+)?(?:de\s+)?)?(?:aproximadamente\s+|cerca\s+de\s+)?(\d+)\s*(?:metros?|m)\b(?![²³])/gi;
  const knownResolutions = new Set(Array.from(facts.limitations.matchAll(mapBiomasResolution), match => Number(match[1])));
  text = text.replace(mapBiomasResolution, (_, resolution) => {
    if (!knownResolutions.has(Number(resolution))) valid = false;
    return '';
  });
  const numeric = '-?\\d+(?:\\.\\d{3})*,\\d+|-?\\d+(?:[.,]\\d+)?';
  text = text.replace(new RegExp(`(${numeric})\\s*(?:hectares?|ha)\\b`, 'gi'), (_, value) => {
    const n = parse(value);
    if (![facts.candidate_area_ha, ...facts.polygons.map(p => p.area_ha)].some(area => matches(n, area))) valid = false;
    return '';
  });
  text = text.replace(new RegExp(`NDVI[^\\d\\-+]{0,50}(${numeric})`, 'gi'), (_, value) => {
    if (!matches(parse(value), facts.ndvi_median)) valid = false;
    return '';
  });
  text = text.replace(/(\d+)\s+pol[ií]gonos\b/gi, (_, count) => { if (Number(count) !== facts.candidate_polygon_count) valid = false; return ''; });
  text = text.replace(/pol[ií]gono\s*(?:n[úu]mero\s*)?(\d+)/gi, (_, id) => {
    if (!facts.polygons.some(p => p.id === Number(id))) valid = false;
    return '';
  });
  return valid && !/\d/.test(text);
}

/** Conservative screening, not proof of the semantic truth of arbitrary LLM prose. */
export function unsupportedClaims(answer: string) {
  return answer.split(/[.!?;,\n]|\b(?:mas|porém|contudo|entretanto)\b/i).some(sentence => {
    if (/\b(?:não|sem|nunca)\b/i.test(sentence)) return false;
    return /(?:café|cafezais).*(?:confirmad|comprovad|validad)|(?:confirmad|comprovad|validad).*(?:café|cafezais)|(?:é|são)\s+café\b|(?:precisão|acurácia|confiança)\s+(?:alta|garantida|comprovada)/i.test(sentence);
  });
}
