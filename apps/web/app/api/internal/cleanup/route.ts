import { pool } from '@/lib/auth';
import { bucketName, inputPath, OUTPUTS, outputPath, storageAdmin } from '@/lib/storage';
export const runtime='nodejs';
export const maxDuration=60;

/** Optional Vercel Cron (daily on Hobby). CRON_SECRET must be configured. */
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization')!==`Bearer ${secret}`)
    return Response.json({detail:'Não autorizado.'},{status:401});
  const {rows}=await pool.query<{id:string;owner_id:string;image_path:string|null;scl_path:string|null}>(
    `SELECT id,owner_id,image_path,scl_path FROM app_analyses
     WHERE expires_at<NOW() ORDER BY expires_at LIMIT 20`);
  let cleaned=0;
  for (const row of rows) {
    const paths=[row.image_path,row.scl_path,...(Object.keys(OUTPUTS) as (keyof typeof OUTPUTS)[])
      .map(kind=>outputPath(row.owner_id,row.id,kind))].filter((p):p is string=>!!p);
    const {error}=await storageAdmin().storage.from(bucketName()).remove(paths);
    if (error) continue; // Fail closed: never delete DB metadata if storage cleanup failed.
    await pool.query('DELETE FROM app_analyses WHERE id=$1',[row.id]);
    cleaned++;
  }
  await pool.query('DELETE FROM app_rate_limits WHERE expires_at<NOW()');
  return Response.json({cleaned});
}
