export async function GET() {
  return Response.json({ status: 'ok', app: 'nextjs', googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID) });
}
