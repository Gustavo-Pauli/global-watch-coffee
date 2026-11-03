import { requireExperimentUser } from '@/lib/experiment-access';
import { experimentFailure, experimentJson, loadExperimentBundle } from '@/lib/experiments';
import { getExperimentReviews, saveExperimentReview } from '@/lib/experiment-reviews';
import { originAllowed } from '@/lib/origin';
import { BodyError, readJsonBody } from '@/lib/request';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const user = await requireExperimentUser(request); const { id } = await context.params;
    return experimentJson(await getExperimentReviews(await loadExperimentBundle(id), user.id)); }
  catch (error) { return experimentFailure(error); }
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const user = await requireExperimentUser(request);
    if (!originAllowed(request)) return experimentJson({ detail: 'Origem não permitida.' }, 403);
    const body = await readJsonBody(request); const { id } = await context.params;
    return experimentJson({ review: await saveExperimentReview(await loadExperimentBundle(id), user.id, body) }); }
  catch (error) { return error instanceof BodyError ? experimentJson({ detail: error.message }, error.status) : experimentFailure(error); }
}
