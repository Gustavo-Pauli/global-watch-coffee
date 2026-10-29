import { sessionUserId } from '@/lib/session';
import { pool } from '@/lib/auth';
import { failStaleJobs } from '@/lib/analyses';
export const runtime='nodejs';
export async function GET() {
  const owner=await sessionUserId();
  if (!owner) return Response.json({detail:'Entre com Google.'},{status:401});
  await failStaleJobs(owner);
  const {rows}=await pool.query(
    `SELECT id,scene,acquisition_date::TEXT AS date,status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created
     FROM app_analyses WHERE owner_id=$1 AND expires_at>NOW()
     ORDER BY created_at DESC LIMIT 30`,[owner]);
  return Response.json(rows.map(row=>({...row,created:Number(row.created)})),{
    headers:{'Cache-Control':'private, no-store'}
  });
}
