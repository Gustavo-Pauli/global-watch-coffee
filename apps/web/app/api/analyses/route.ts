import { sessionUserId } from '@/lib/session';
import { prisma } from '@/lib/db';
import { failStaleJobs } from '@/lib/analyses';
export const runtime='nodejs';
export async function GET() {
  const owner=await sessionUserId();
  if (!owner) return Response.json({detail:'Entre com Google.'},{status:401});
  await failStaleJobs(owner);
  const rows=await prisma.analysis.findMany({
    where: { ownerId: owner, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }, take: 30,
    select: { id: true, scene: true, acquisitionDate: true, status: true, createdAt: true },
  });
  return Response.json(rows.map(row=>({id:row.id,scene:row.scene,date:row.acquisitionDate?.toISOString().slice(0,10)??null,
    status:row.status,created:Math.floor(row.createdAt.getTime()/1000)})),{
    headers:{'Cache-Control':'private, no-store'}
  });
}
