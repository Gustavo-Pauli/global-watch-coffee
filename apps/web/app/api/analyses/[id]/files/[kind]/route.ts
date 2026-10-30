import { sessionUserId } from '@/lib/session';
import { ownAnalysis } from '@/lib/analyses';
import { ALL_OUTPUTS, OUTPUTS, type OutputKind, outputPath, signedRead } from '@/lib/storage';
import { optionalOutputKinds } from '@/lib/analysis-artifacts';
export const runtime='nodejs';
export async function GET(_request: Request,context:{params:Promise<{id:string;kind:string}>}) {
  const owner=await sessionUserId();
  if (!owner) return Response.json({detail:'Não autorizado.'},{status:401});
  const {id,kind}=await context.params;
  if (!Object.prototype.hasOwnProperty.call(ALL_OUTPUTS,kind))
    return Response.json({detail:'Arquivo desconhecido.'},{status:404});
  const row=await ownAnalysis(owner,id);
  if (!row || row.status!=='ready') return Response.json({detail:'Arquivo não disponível.'},{status:404});
  if (!Object.prototype.hasOwnProperty.call(OUTPUTS, kind) && !optionalOutputKinds(row.result).includes(kind as 'false_color' | 'ndvi'))
    return Response.json({detail:'Visualização não disponível nesta análise.'},{status:404});
  try {
    // Only AFTER the owner check. Time-limited redirect avoids Vercel response-size limits.
    const signed=await signedRead(outputPath(owner,id,kind as OutputKind),60);
    return new Response(null,{status:302,headers:{Location:signed,'Cache-Control':'private, no-store'}});
  } catch {return Response.json({detail:'Arquivo expirado ou indisponível.'},{status:404});}
}
