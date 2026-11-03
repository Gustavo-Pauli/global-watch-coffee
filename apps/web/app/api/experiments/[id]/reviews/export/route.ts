import { requireExperimentUser } from '@/lib/experiment-access';
import { EXPERIMENT_HEADERS, experimentFailure, loadExperimentBundle } from '@/lib/experiments';
import { exportExperimentReviews, getExperimentReviews } from '@/lib/experiment-reviews';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const user = await requireExperimentUser(request); const { id } = await context.params;
    const study = await loadExperimentBundle(id), { reviews } = await getExperimentReviews(study, user.id);
    return Response.json(exportExperimentReviews(study, user.id, reviews), { headers: { ...EXPERIMENT_HEADERS,
      'Content-Disposition': `attachment; filename="${study.id}-own-references.json"` } }); }
  catch (error) { return experimentFailure(error); }
}
