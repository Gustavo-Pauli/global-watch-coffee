import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';
import { bucketName, OUTPUTS, outputPath, storageAdmin } from '@/lib/storage';
export const runtime='nodejs';
export const maxDuration=60;

/** Daily on Hobby; process the entire bounded daily workload, not just 20 rows. */
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET, actual=request.headers.get('authorization');
  if (!secret || !actual || Buffer.byteLength(actual)!==Buffer.byteLength(`Bearer ${secret}`) ||
      !timingSafeEqual(Buffer.from(actual),Buffer.from(`Bearer ${secret}`)))
    return Response.json({detail:'Não autorizado.'},{status:401});
  const deadline=Date.now()+45_000;
  let cleaned=0,failed=0;
  // At most five new preparations per user/hour can outnumber the 10/day
  // processing quota, so cleanup must paginate abandoned uploads as well.
  const rows=await prisma.analysis.findMany({where:{expiresAt:{lt:new Date()}},orderBy:{expiresAt:'asc'},take:200});
  for (const row of rows) {
    if(Date.now()>deadline) break;
    const paths=[row.imagePath,row.sclPath,...(Object.keys(OUTPUTS) as (keyof typeof OUTPUTS)[])
      .map(kind=>outputPath(row.ownerId,row.id,kind))].filter((p):p is string=>!!p);
    const {error}=await storageAdmin().storage.from(bucketName()).remove(paths);
    if (error) { failed++; continue; }
    cleaned+=(await prisma.analysis.deleteMany({where:{id:row.id,expiresAt:{lt:new Date()}}})).count;
  }
  await prisma.rateLimit.deleteMany({where:{expiresAt:{lt:new Date()}}});
  const remaining=await prisma.analysis.count({where:{expiresAt:{lt:new Date()}}});
  return Response.json({cleaned,failed,remaining},{headers:{'Cache-Control':'no-store'}});
}
