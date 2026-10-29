import { originAllowed } from '@/lib/origin';
import { sessionUserId } from '@/lib/session';
import { workerFetch, relayJson, failureResponse } from '@/lib/worker';
import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export const maxDuration = 120;
// Vercel Functions limita o payload a 4,5 MB; reservar margem para SCL + formulário.
const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_SCL = 256 * 1024;
function tif(f: File) { return /\.tiff?$/i.test(f.name); }
export async function POST(request: Request) {
  if (!originAllowed(request)) return Response.json({ detail: 'Origem não autorizada.' }, { status: 403 });
  const owner = await sessionUserId();
  if (!owner) return Response.json({ detail: 'Entre com Google.' }, { status: 401 });
  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_IMAGE + MAX_SCL + 1024 * 1024)
    return Response.json({ detail: 'Upload excede o limite.' }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return Response.json({ detail: 'Formulário inválido.' }, { status: 400 }); }
  const image = form.get('image');
  const scl = form.get('scl');
  const date = form.get('date');
  if (!(image instanceof File) || !tif(image)) return Response.json({ detail: 'Envie um GeoTIFF.' }, { status: 415 });
  if (!image.size || image.size > MAX_IMAGE) return Response.json({ detail: 'Imagem acima do limite de 4 MB nesta implantação.' }, { status: 413 });
  if (scl && (!(scl instanceof File) || !tif(scl) || scl.size > MAX_SCL))
    return Response.json({ detail: 'Máscara SCL inválida.' }, { status: 422 });
  if (date && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))))
    return Response.json({ detail: 'Data inválida.' }, { status: 422 });
  if (!await rateLimit(owner, 'analysis', 5, 3600))
    return Response.json({ detail: 'Limite de 5 análises por hora.' }, { status: 429 });
  const forwarded = new FormData();
  forwarded.append('image', image, image.name);
  if (scl instanceof File) forwarded.append('scl', scl, scl.name);
  if (typeof date === 'string' && date) forwarded.append('date', date);
  try {
    const res = await workerFetch(owner, '/internal/analysis/upload', { method: 'POST', body: forwarded });
    return relayJson(res);
  } catch (error) { return failureResponse(error); }
}
