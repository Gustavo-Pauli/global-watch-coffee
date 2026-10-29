import { sessionUserId } from '@/lib/session';
import { ownAnalysis, failStaleJobs } from '@/lib/analyses';
import { outputPath, readJson } from '@/lib/storage';
export const runtime='nodejs';
export async function GET(_request: Request, context: {params:Promise<{id:string}>}) {
  const owner=await sessionUserId();
  if (!owner) return Response.json({detail:'Não autorizado.'},{status:401});
  const {id}=await context.params;
  await failStaleJobs(owner);
  const row=await ownAnalysis(owner,id);
  if (!row) return Response.json({detail:'Análise não encontrada.'},{status:404});
  if (row.status==='error') return Response.json({detail:'Falha no processamento geoespacial.',status:'error',code:row.error_code},{status:422});
  if (row.status !=='ready') {
    // Prevent indefinite spinner if Render restarted while job was running.
    return Response.json({analysis:{id:row.id,status:row.status,scene:row.scene,date:row.acquisition_date},result:null,geojson:null},
      {status:202,headers:{'Cache-Control':'no-store'}});
  }
  try {
    const geojson=await readJson(outputPath(owner,id,'geojson'));
    return Response.json({
      analysis:{id:row.id,status:row.status,scene:row.scene,date:row.acquisition_date},
      result:row.result,geojson,
    },{headers:{'Cache-Control':'private, no-store'}});
  } catch {
    return Response.json({detail:'Resultados no Storage temporariamente indisponíveis.'},{status:503});
  }
}
