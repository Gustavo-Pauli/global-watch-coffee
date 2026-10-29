import { originAllowed } from '@/lib/origin';
import { sessionUserId } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { createAnalysis, validDate } from '@/lib/analyses';
import { MAX_IMAGE_BYTES, MAX_SCL_BYTES, signedUpload } from '@/lib/storage';
export const runtime='nodejs';

/** Preauthorizes a direct-to-Storage upload; TIFF bytes NEVER transit through Vercel. */
export async function POST(request: Request) {
  if (!originAllowed(request)) return Response.json({detail:'Origem não autorizada.'},{status:403});
  const owner = await sessionUserId();
  if (!owner) return Response.json({detail:'Entre com Google.'},{status:401});
  const body = await request.json().catch(()=>null);
  const size = body?.image?.size;
  const sclSize = body?.scl?.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE_BYTES ||
      typeof body?.image?.name !== 'string' || !/\.tiff?$/i.test(body.image.name))
    return Response.json({detail:'Imagem TIFF inválida ou acima de 12 MB.'},{status:422});
  if (body.scl != null && (!Number.isSafeInteger(sclSize) || sclSize < 1 || sclSize > MAX_SCL_BYTES ||
      typeof body.scl.name !== 'string' || !/\.tiff?$/i.test(body.scl.name)))
    return Response.json({detail:'SCL inválida ou acima de 4 MB.'},{status:422});
  if (body.date != null && body.date !== '' && !validDate(body.date))
    return Response.json({detail:'Data inválida.'},{status:422});
  if (!await rateLimit(owner,'analysis',5,3600)) return Response.json({detail:'Limite de cinco análises por hora.'},{status:429});
  try {
    const {id,imagePath,sclPath} = await createAnalysis(owner,null,body.date||null,!!body.scl);
    return Response.json({id,uploads:{
      image:await signedUpload(imagePath!),
      ...(sclPath?{scl:await signedUpload(sclPath)}:{}),
    }},{status:201});
  } catch (error) {
    console.error('[upload-preparation]',error instanceof Error?error.name:'unknown');
    return Response.json({detail:'Não foi possível preparar o upload.'},{status:503});
  }
}
