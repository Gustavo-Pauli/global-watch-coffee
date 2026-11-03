import { requireExperimentUser } from '@/lib/experiment-access';
import { experimentFailure, experimentJson, listExperimentStudies } from '@/lib/experiments';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { await requireExperimentUser(request); return experimentJson({ studies: await listExperimentStudies() }); }
  catch (error) { return experimentFailure(error); }
}
