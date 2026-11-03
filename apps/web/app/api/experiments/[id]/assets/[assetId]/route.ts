import { requireExperimentUser } from '@/lib/experiment-access';
import { EXPERIMENT_HEADERS, experimentFailure, readExperimentAsset } from '@/lib/experiments';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try { await requireExperimentUser(request); const { id, assetId } = await context.params;
    const asset = await readExperimentAsset(id, assetId);
    return new Response(new Uint8Array(asset.bytes), { headers: { ...EXPERIMENT_HEADERS,
      'Content-Type': asset.mimeType, 'Content-Length': String(asset.bytes.length), 'Content-Security-Policy': "default-src 'none'; sandbox" } }); }
  catch (error) { return experimentFailure(error); }
}
