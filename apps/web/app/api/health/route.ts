export const runtime = 'nodejs';
// Public liveness only; do not expose credentials, DB metadata or environment.
export async function GET() {
  return Response.json({status:'ok',service:'global-watch-web'}, {headers:{'Cache-Control':'no-store'}});
}
