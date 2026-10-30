import type { Facts } from './chat';

const NUMBER = '-?\\d+(?:\\.\\d{3})*,\\d+|-?\\d+(?:[.,]\\d+)?';
const COUNT = '\\d+(?:\\.\\d{3})*';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const parseNumber = (text: string) => Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
const roundedMatch = (value: number, expected: number | null | undefined) => expected != null &&
  [expected, ...[1, 2, 3].map(digits => Number(expected.toFixed(digits)))].includes(value);

/** A nearby polygon determines the subject; IDs cannot authorize another field. */
function polygonSubject(text: string, offset: number, facts: Facts) {
  const prefix = text.slice(0, offset).split(/[;!?\n]|\.(?!\d)/).at(-1) ?? '';
  const mention = Array.from(prefix.matchAll(/pol[ií]gono\s*(\d+)/gi)).at(-1);
  const id = mention ? Number(mention[1]) : facts.subject_polygon_id;
  return id === undefined ? undefined : facts.polygons.find(polygon => polygon.id === id);
}

function qualityCount(label: string, facts: Facts): number | null {
  const q = facts.quality;
  if (!q) return null;
  if (/ndvi|índice/i.test(label)) return q.ndvi_defined_pixels;
  if (/scl/i.test(label)) return q.scl_excluded_pixels;
  if (/total|totais/i.test(label)) return q.total_pixels;
  if (/inválid|nodata|no.data/i.test(label)) return q.input_invalid_pixels;
  if (/excluíd|mascarad/i.test(label)) return q.total_pixels - q.eligible_pixels;
  if (/elegíve|válid/i.test(label)) return q.eligible_pixels;
  return null;
}

/** Conservative, field-scoped validation of measured claims, not semantic proof. */
export function numericsSupported(answer: string, facts: Facts) {
  let text = answer.replace(/`([^`\r\n]+)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)([^\r\n]*?\S)\1/g, '$2')
    .replace(/(\*|_)(?=\S)([^\r\n]*?\S)\1/g, '$2')
    .replace(/[\u00a0\u202f]/g, ' ');
  if (/\d(?:[.,]\d+)?e[+-]?\d/i.test(text)) return false;
  let valid = true;
  text = text.replace(/Sentinel[-\s]?2/gi, 'Sentinel')
    .replace(/(?:pol[ií]gono(?:\s+(?:é|foi|o|de|com|identificado|pelo|n[úu]mero|identificador|identifica[çc][ãa]o|ID|n[º°]\.?)){0,8}|\bID)\s*[:#]?\s*(\d+)/gi, 'polígono $1');
  if (facts.method === 'rf_purified_multiclass_2.0') text = text.replace(/\bEVI[-\s]?2\b/gi, 'EVI').replace(/\bWGS[-\s]?84\b/gi, 'WGS');
  if (facts.method) text = text.replaceAll(facts.method, 'modelo');
  text = text.replace(/(\d{1,2})\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/gi, (_, day, month, year) => {
    if (`${year}-${String(MONTHS.indexOf(month.toLowerCase()) + 1).padStart(2, '0')}-${day.padStart(2, '0')}` !== facts.date) valid = false;
    return '';
  });
  text = text.replace(/\d{4}-\d{2}-\d{2}/g, date => { if (date !== facts.date) valid = false; return ''; });
  text = text.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (_, d, m, y) => {
    if (`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` !== facts.date) valid = false;
    return '';
  });
  const resolution = /\bMapBiomas\s+(?:(?:de|com)\s+)?(?:resolu[çc][ãa]o\s+(?:espacial\s+)?(?:de\s+)?)?(?:aproximadamente\s+|cerca\s+de\s+)?(\d+)\s*(?:metros?|m)\b(?![²³])/gi;
  const known = new Set(Array.from(facts.limitations.matchAll(resolution), match => Number(match[1])));
  text = text.replace(resolution, (_, value) => { if (!known.has(Number(value))) valid = false; return ''; });

  // Percentages are allowed only for explicitly labelled pixel coverage.
  const percent = (value: string, label: string) => {
    const count = qualityCount(label, facts), total = facts.quality?.total_pixels;
    const expected = count === null || !total ? null : Math.round(count / total * 1000) / 10;
    if (!roundedMatch(parseNumber(value), expected)) valid = false;
    return '';
  };
  text = text.replace(new RegExp(`(${NUMBER})\\s*%\\s*(?:dos?\\s+)?pixels?\\s+(?:(?:são|estão|foram)\\s+)?(elegíveis|válidos|excluídos|inválidos|mascarados)(?:\\s+pela\\s+(SCL))?`, 'gi'),
    (_, value, label, scl) => percent(value, scl ? 'scl' : label));
  text = text.replace(new RegExp(`pixels?\\s+(elegíveis|válidos|excluídos|inválidos|mascarados)\\s*[:=]?\\s*(${NUMBER})\\s*%`, 'gi'),
    (_, label, value) => percent(value, label));
  if (/%/.test(text)) return false;

  const pixels = (value: string, label: string) => {
    if (Number(value.replace(/\./g, '')) !== qualityCount(label, facts)) valid = false;
    return '';
  };
  text = text.replace(new RegExp(`(${COUNT})\\s+(?:de|dos)\\s+(${COUNT})\\s+pixels?\\s+(elegíveis|válidos)`, 'gi'),
    (_, value, total, label) => { pixels(total, 'total'); return pixels(value, label); });
  text = text.replace(new RegExp(`(${COUNT})\\s+pixels?\\s+(elegíveis|válidos|excluídos|inválidos|mascarados|totais|definidos para (?:o )?NDVI)(?:\\s+pela\\s+(SCL))?`, 'gi'),
    (_, value, label, scl) => pixels(value, scl ? 'scl' : label));
  text = text.replace(new RegExp(`(?:total\\s+de\\s+pixels?|pixels?\\s+totais)\\s*[:=]?\\s*(${COUNT})`, 'gi'), (_, value) => pixels(value, 'total'));
  text = text.replace(new RegExp(`pixels?\\s+(elegíveis|válidos|excluídos|inválidos|mascarados)\\s*[:=]?\\s*(${COUNT})(?![\\d.,]|\\s*(?:ha\\b|hectare|%))`, 'gi'),
    (_, label, value) => pixels(value, label));
  text = text.replace(new RegExp(`total\\s+de\\s+(${COUNT})\\s+pixels?`, 'gi'), (_, value) => pixels(value, 'total'));

  // Move a direct polygon reference ahead of the index so the general matcher
  // cannot mistake the polygon ID for the measured NDVI value.
  text = text.replace(new RegExp(`NDVI(\\s+(?:médio|mediano))?\\s+(?:do|no|para o)\\s+polígono\\s*(\\d+)([^\\d.;\\n+-]{0,40})(${NUMBER})`, 'gi'),
    (_, aggregation, id, _connector, value) => `polígono ${id}: NDVI${aggregation || ''} ${value}`);
  text = text.replace(new RegExp(`NDVI([^\\d.;\\n\\-+]{0,50})(${NUMBER})`, 'gi'), (match, label, value, offset, source) => {
    const polygon = polygonSubject(source, offset, facts);
    const explicitlyGlobal = /da cena|da imagem|global/i.test(label);
    if (/médio/i.test(label) && (!polygon || explicitlyGlobal)) valid = false;
    const expected = explicitlyGlobal || /mediano/i.test(label)
      ? facts.ndvi_median : polygon ? polygon.ndvi_mean : facts.ndvi_median;
    if (/mediano/i.test(label) && polygon && !explicitlyGlobal) valid = false;
    if (!roundedMatch(parseNumber(value), expected)) valid = false;
    return match.replace(value, '');
  });
  text = text.replace(new RegExp(`(${NUMBER})\\s*(?:hectares?|ha)\\b`, 'gi'), (_, value, offset, source) => {
    const polygon = polygonSubject(source, offset, facts);
    const prefix = source.slice(0, offset);
    const total = /(?:área total|somando|totalizando)[^\d]{0,30}$/i.test(prefix);
    if (!roundedMatch(parseNumber(value), total || !polygon ? facts.candidate_area_ha : polygon.area_ha)) valid = false;
    return '';
  });
  text = text.replace(/(\d+)\s+pol[ií]gonos\b/gi, (_, value) => { if (Number(value) !== facts.candidate_polygon_count) valid = false; return ''; });
  text = text.replace(/pol[ií]gono\s*(?:n[úu]mero\s*)?(\d+)/gi, (_, id) => {
    if (!facts.polygons.some(polygon => polygon.id === Number(id))) valid = false;
    return '';
  });
  return valid && !/\d/.test(text);
}
