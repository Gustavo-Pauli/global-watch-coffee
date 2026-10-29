import { originAllowed } from '@/lib/origin';
import { sessionUserId } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { createAnalysis, markError, validDate } from '@/lib/analyses';
import { MAX_IMAGE_BYTES, MAX_SCL_BYTES, signedUpload } from '@/lib/storage';
import { jsonBody } from '@/lib/request';
export const runtime='nodejs';

type FileDescriptor = {size: number; name: string};
function validFile(value: unknown, max: number): value is FileDescriptor {
  if (!value || typeof value !== 'object') return false;
  const file=value as Record<string,unknown>;
  return typeof file.size==='number' && Number.isSafeInteger(file.size) && file.size>0 && file.size<=max &&
    typeof file.name==='string' && file.name.length<=255 && /\.tiff?$/i.test(file.name);
}

/** Preauthorizes a direct-to-Storage upload; TIFF bytes NEVER transit through Vercel. */
export async function POST(request: Request) {
  if (!originAllowed(request)) return Response.json({detail:'Origem não autorizada.'},{status:403});
  const owner = await sessionUserId();
  if (!owner) return Response.json({detail:'Entre com Google.'},{status:401});
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  if (!validFile(body.image,MAX_IMAGE_BYTES)) return Response.json({detail:'Imagem TIFF inválida ou acima de 12 MiB.'},{status:422});
  if (body.scl != null && !validFile(body.scl,MAX_SCL_BYTES)) return Response.json({detail:'SCL inválida ou acima de 4 MiB.'},{status:422});
  if (body.date != null && body.date !== '' && !validDate(body.date)) return Response.json({detail:'Data inválida.'},{status:422});
  if (!await rateLimit(owner,'analysis',5,3600)) return Response.json({detail:'Limite de cinco análises por hora.'},{status:429});
  let id: string | undefined;
  try {
    const created = await createAnalysis(owner,null,typeof body.date==='string'&&body.date?body.date:null,!!body.scl); id=created.id;
    return Response.json({id,uploads:{
      image:await signedUpload(created.imagePath!),
      ...(created.sclPath?{scl:await signedUpload(created.sclPath)}:{}),
    }},{status:201});
  } catch (error) {
    if(id) await markError(id,'storage_unavailable');
    console.error('[upload-preparation]',error instanceof Error?error.name:'unknown');
    return Response.json({detail:'Não foi possível preparar o upload.'},{status:503});
  }
}
