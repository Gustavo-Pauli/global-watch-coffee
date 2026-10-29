import { prisma } from '@/lib/db';
import { cleanupExpired, cleanupRepository, cronAuthorized } from '@/lib/cleanup';
import { bucketName, storageAdmin } from '@/lib/storage';
export const runtime='nodejs';
export const maxDuration=60;

/** Daily on Hobby; process the entire bounded daily workload, not just 20 rows. */
export async function GET(request:Request) {
  if (!cronAuthorized(request, process.env.CRON_SECRET))
    return Response.json({detail:'Não autorizado.'},{status:401});
  const result = await cleanupExpired({
    repository: cleanupRepository(prisma),
    removeObjects: async (paths, timeoutMs) => {
      const { error } = await storageAdmin(AbortSignal.timeout(timeoutMs)).storage.from(bucketName()).remove(paths);
      if (error) throw error;
    },
  });
  return Response.json(result, {headers:{'Cache-Control':'no-store'}});
}
