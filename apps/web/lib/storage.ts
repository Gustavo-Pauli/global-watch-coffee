import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const OUTPUTS = {
  geojson: 'candidatos.geojson', classified: 'imagem_classificada.png',
  map: 'imagem_mapa.png', rgb: 'imagem_rgb.png',
  tif: 'classificacao.tif', result: 'resultado.json',
} as const;
export type OutputKind = keyof typeof OUTPUTS;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_SCL_BYTES = 4 * 1024 * 1024;

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY obrigatórios');
  return { url, key, bucket: process.env.SUPABASE_STORAGE_BUCKET || 'geo-private' };
}

export function storageAdmin() {
  const { url, key } = config();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function bucketName() { return config().bucket; }
export function jobPrefix(userId: string, id: string) {
  const opaqueUser = createHash('sha256').update(userId).digest('hex');
  return `users/${opaqueUser}/analyses/${id}`;
}
export function outputPath(userId: string, id: string, kind: OutputKind) {
  return `${jobPrefix(userId, id)}/out/${OUTPUTS[kind]}`;
}
export function inputPath(userId: string, id: string, kind: 'image' | 'scl') {
  return `${jobPrefix(userId, id)}/input/${kind}.tif`;
}
export async function signedUpload(path: string) {
  const { data, error } = await storageAdmin().storage.from(bucketName()).createSignedUploadUrl(path);
  if (error || !data) throw new Error('Não foi possível autorizar o upload para Storage.');
  return data;
}
export async function signedRead(path: string, expirySeconds = 600) {
  const { data, error } = await storageAdmin().storage.from(bucketName()).createSignedUrl(path, expirySeconds);
  if (error || !data) throw new Error('Arquivo indisponível no Storage.');
  return data.signedUrl;
}
export async function exists(path: string, maxBytes?: number) {
  const { data, error } = await storageAdmin().storage.from(bucketName()).info(path);
  if (error || !data) return false;
  return Number(data.size) > 0 && (maxBytes === undefined || Number(data.size) <= maxBytes);
}
export async function readJson(path: string) {
  const { data, error } = await storageAdmin().storage.from(bucketName()).download(path);
  if (error || !data) throw new Error('Arquivo JSON não encontrado no Storage.');
  if (data.size > 4 * 1024 * 1024) throw new Error('GeoJSON excede o limite da visualização no navegador.');
  return JSON.parse(await data.text()) as unknown;
}
