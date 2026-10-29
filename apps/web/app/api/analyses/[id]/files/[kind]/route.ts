import { sessionUserId } from '@/lib/session';
import { ownAnalysis } from '@/lib/analyses';
import { OUTPUTS, OutputKind, outputPath, signedRead } from '@/lib/storage';
export const runtime='nodejs';
export async function GET(_request: Request,context:{params:Promise<{id:string;kind:string}>}) {
  const owner=await sessionUserId();
  if (!owner) return Response.json({detail:'Não autorizado.'},{status:401});
  const {id,kind}=await context.params;
  if (!Object.prototype.hasOwnProperty.call(OUTPUTS,kind))
    return Response.json({detail:'Arquivo desconhecido.'},{status:404});
  const row=await ownAnalysis(owner,id);
  if (!row || row.status!=='ready') return Response.json({detail:'Arquivo não disponível.'},{status:404});
  try {
    // Only AFTER the owner check. Time-limited redirect avoids Vercel response-size limits.
    const signed=await signedRead(outputPath(owner,id,kind as OutputKind),60);
    return Response.redirect(signed,302);
  } catch {return Response.json({detail:'Arquivo expirado ou indisponível.'},{status:404});}
}
