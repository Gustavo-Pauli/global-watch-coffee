import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { OUTPUTS, exists, outputPath, readJson } from './storage';
import { validDate } from './analyses';
import { requiredOutputKinds } from './analysis-artifacts';

export function parsedWorkerResult(value: unknown) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid result');
  const r=value as Record<string,unknown>;
  if(typeof r.candidate_area_ha!=='number'||!Number.isFinite(r.candidate_area_ha)||r.candidate_area_ha<0 ||
    typeof r.candidate_polygon_count!=='number'||!Number.isSafeInteger(r.candidate_polygon_count)||r.candidate_polygon_count<0)
    throw new Error('Invalid result');
  if(r.acquisition_date!=null && !validDate(r.acquisition_date)) throw new Error('Invalid acquisition date');
  requiredOutputKinds(r);
  return {
    result:value as Prisma.InputJsonValue,
    acquisitionDate:typeof r.acquisition_date==='string'?new Date(r.acquisition_date+'T00:00:00.000Z'):undefined,
  };
}

/** Retry-safe, compare-and-set completion. Never trust computed values in callbacks. */
export async function completeAnalysis(id: string, status: 'ready'|'error') {
  const record=await prisma.analysis.findFirst({where:{id,expiresAt:{gt:new Date()}},select:{ownerId:true,status:true}});
  if (!record) return {status:409,detail:'Tarefa não encontrada ou expirada.'};
  if(record.status===status) return {status:200};
  if(record.status!=='processing')return {status:409,detail:'Tarefa já finalizada.'};
  let result: Prisma.InputJsonValue | undefined;
  let acquisitionDate: Date | undefined;
  if(status==='ready') {
    try {
      for (const kind of Object.keys(OUTPUTS) as (keyof typeof OUTPUTS)[])
        if (!await exists(outputPath(record.ownerId,id,kind))) throw new Error('Output missing');
      const value=await readJson(outputPath(record.ownerId,id,'result'));
      ({result,acquisitionDate}=parsedWorkerResult(value));
      for (const kind of requiredOutputKinds(value))
        if (!(kind in OUTPUTS) && !await exists(outputPath(record.ownerId, id, kind))) throw new Error('Visualization missing');
    } catch { return {status:503,detail:'Arquivos incompletos.'}; }
  }
  const {count}=await prisma.analysis.updateMany({where:{id,status:'processing',expiresAt:{gt:new Date()}},
    data:{status,result,acquisitionDate,errorCode:status==='error'?'processing_failed':null,updatedAt:new Date()}});
  if(count===1)return {status:200};
  const current=await prisma.analysis.findUnique({where:{id},select:{status:true}});
  return current?.status===status?{status:200}:{status:409,detail:'Tarefa já finalizada.'};
}
