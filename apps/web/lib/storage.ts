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

export function storageAdmin(signal?: AbortSignal) {
  const { url, key } = config();
  const scopedFetch: typeof fetch = (input, init) => fetch(input, {
    ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal!]) : signal,
  });
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(signal ? { global: { fetch: scopedFetch } } : {}),
  });
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
let verifiedBucket: { signature: string; until: number } | undefined;
let verification: Promise<void> | undefined;

/** Signed upload tokens otherwise allow uploads up to the project quota, even
 * when the browser lies about its declared file size. Fail closed on misconfig. */
export async function verifyStorageBucket() {
  const {url,bucket}=config();
  const signature=url+'|'+bucket;
  if(verifiedBucket?.signature===signature && verifiedBucket.until>Date.now())return;
  if(!verification) verification=(async()=>{
    const {data,error}=await storageAdmin().storage.getBucket(bucket);
    if(error || !data || data.public || !data.file_size_limit || Number(data.file_size_limit)>MAX_IMAGE_BYTES)
      throw new Error('Storage exige bucket privado com limite por arquivo de até 12 MiB.');
    verifiedBucket={signature,until:Date.now()+30_000};
  })().finally(()=>{verification=undefined;});
  await verification;
}

export async function signedUpload(path: string) {
  await verifyStorageBucket();
  const { data, error } = await storageAdmin().storage.from(bucketName()).createSignedUploadUrl(path);
  if (error || !data) throw new Error('Não foi possível autorizar o upload para Storage.');
  return data;
}
export async function signedRead(path: string, expirySeconds = 600) {
  await verifyStorageBucket();
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
  const limit=4*1024*1024;
  const response=await fetch(await signedRead(path,60),{signal:AbortSignal.timeout(20_000),cache:'no-store'});
  if(!response.ok || !response.body)throw new Error('Arquivo JSON não encontrado no Storage.');
  if(Number(response.headers.get('content-length'))>limit){await response.body.cancel();throw new Error('JSON excede o limite de 4 MiB.');}
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let length=0;
  try {
    while(true){
      const {value,done}=await reader.read();if(done)break;
      length+=value.byteLength;
      if(length>limit){await reader.cancel();throw new Error('JSON excede o limite de 4 MiB.');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
}
