import { requireExperimentUser } from '@/lib/experiment-access';
import { experimentFailure, experimentJson, loadExperimentBundle, publicExperimentStudy } from '@/lib/experiments';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireExperimentUser(request); const { id } = await context.params;
    return experimentJson(publicExperimentStudy(await loadExperimentBundle(id))); }
  catch (error) { return experimentFailure(error); }
}
