import { getExperimentAccess } from '@/lib/experiment-access';
import { experimentFailure, experimentJson } from '@/lib/experiments';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { const { allowed } = await getExperimentAccess(request.headers); return experimentJson({ allowed }); }
  catch (error) { return experimentFailure(error); }
}
