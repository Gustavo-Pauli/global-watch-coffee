import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const url=process.env.TEST_DATABASE_URL;
if(url && !/(test|audit)/i.test(new URL(url).pathname))throw new Error('TEST_DATABASE_URL must identify a disposable test/audit database');

test('PostgreSQL integration: Prisma ownership, concurrency, quotas, completion, constraints and Better Auth adapter', {skip:!url},async t=>{
  process.env.DATABASE_URL=url!;
  process.env.BETTER_AUTH_SECRET=process.env.BETTER_AUTH_SECRET||'isolated-integration-secret-with-at-least-32-characters';
  process.env.BETTER_AUTH_URL='http://localhost:3000';
  const {prisma}=await import('../lib/db');
  const {createAnalysis,ownAnalysis,claimAnalysis,AnalysisError}=await import('../lib/analyses');
  const {rateLimit}=await import('../lib/rate-limit');
  const {completeAnalysis,parsedWorkerResult}=await import('../lib/completion');
  const {auth}=await import('../lib/auth');
  const owner='audit-'+randomUUID(), other='audit-'+randomUUID();
  const quotaKey=`global:analysis:${Math.floor(Date.now()/86400000)}`;
  try {
    await t.test('atomic limit accepts exactly max simultaneous calls',async()=>{
      const calls=await Promise.all(Array.from({length:32},()=>rateLimit(owner,'concurrency',5,3600)));
      assert.equal(calls.filter(Boolean).length,5);
    });
    await t.test('owner and expiration checks never expose records',async()=>{
      const {id}=await createAnalysis(owner,'august',null,false);
      assert.ok(await ownAnalysis(owner,id));
      assert.equal(await ownAnalysis(other,id),null);
      assert.equal(await ownAnalysis(owner,'../../invalid'),null);
      await prisma.analysis.update({where:{id},data:{expiresAt:new Date(Date.now()-1000)}});
      assert.equal(await ownAnalysis(owner,id),null);
    });
    await t.test('invalid/foreign start attempts cannot exhaust the global quota',async()=>{
      const {id}=await createAnalysis(owner,'august',null,false);
      const before=await prisma.rateLimit.findUnique({where:{key:quotaKey}});
      await assert.rejects(claimAnalysis(other,id),e=>e instanceof AnalysisError&&e.status===404);
      await assert.rejects(claimAnalysis(owner,'not-a-uuid'),e=>e instanceof AnalysisError&&e.status===404);
      assert.deepEqual(await prisma.rateLimit.findUnique({where:{key:quotaKey}}),before);
    });
    await t.test('duplicate starts reserve exactly one slot and transition once',async()=>{
      await prisma.rateLimit.deleteMany({where:{key:quotaKey}});
      const {id}=await createAnalysis(owner,'august',null,false);
      const attempts=await Promise.allSettled([claimAnalysis(owner,id),claimAnalysis(owner,id),claimAnalysis(owner,id)]);
      assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
      assert.equal((await prisma.rateLimit.findUniqueOrThrow({where:{key:quotaKey}})).count,1);
      assert.equal((await prisma.analysis.findUniqueOrThrow({where:{id}})).status,'processing');
    });
    await t.test('quota denial rolls back state transition atomically',async()=>{
      await prisma.rateLimit.upsert({where:{key:quotaKey},create:{key:quotaKey,count:10,expiresAt:new Date(Date.now()+86400000)},update:{count:10}});
      const {id}=await createAnalysis(owner,'august',null,false);
      await assert.rejects(claimAnalysis(owner,id),e=>e instanceof AnalysisError&&e.status===429);
      assert.equal((await prisma.analysis.findUniqueOrThrow({where:{id}})).status,'uploading');
      assert.equal((await prisma.rateLimit.findUniqueOrThrow({where:{key:quotaKey}})).count,10);
    });
    await t.test('completion retries are idempotent; terminal errors cannot become ready',async()=>{
      const {id}=await createAnalysis(owner,'august',null,false);
      await prisma.analysis.update({where:{id},data:{status:'processing'}});
      const completions=await Promise.all([completeAnalysis(id,'error'),completeAnalysis(id,'error')]);
      assert.ok(completions.every(r=>r.status===200));
      assert.equal((await completeAnalysis(id,'ready')).status,409);
    });
    await t.test('completion preserves genuine ISO acquisition date and rejects invalid metadata',()=>{
      const summary={candidate_area_ha:22.661,candidate_polygon_count:3,acquisition_date:'2025-08-16'};
      const parsed=parsedWorkerResult(summary);
      assert.equal(parsed.acquisitionDate?.toISOString(),'2025-08-16T00:00:00.000Z');
      assert.deepEqual(parsed.result,summary);
      assert.equal(parsedWorkerResult({...summary,acquisition_date:null}).acquisitionDate,undefined);
      assert.throws(()=>parsedWorkerResult({...summary,acquisition_date:'16/08/2025'}));
      assert.throws(()=>parsedWorkerResult({...summary,acquisition_date:'2025-02-30'}));
      assert.throws(()=>parsedWorkerResult({...summary,candidate_area_ha:Infinity}));
    });
    await t.test('baseline keeps PostgreSQL status and source CHECK constraints',async()=>{
      await assert.rejects(prisma.analysis.create({data:{id:randomUUID(),ownerId:owner,status:'invented',scene:'august'}}));
      await assert.rejects(prisma.analysis.create({data:{id:randomUUID(),ownerId:owner,status:'uploading'}}));
    });
    await t.test('server-only tables have RLS and no public client grants or policies',async()=>{
      const tables=await prisma.$queryRaw<{relname:string;rls:boolean;publicGrants:number;clientGrants:number;policies:number}[]>`
        SELECT c.relname,c.relrowsecurity AS rls,
          (SELECT count(*)::int FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee=0) AS "publicGrants",
          (SELECT count(*)::int FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl JOIN pg_roles r ON r.oid=acl.grantee WHERE r.rolname IN ('anon','authenticated')) AS "clientGrants",
          (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('user','session','account','verification','app_analyses','app_rate_limits')`;
      assert.equal(tables.length,6);
      for(const table of tables){
        assert.equal(table.rls,true,table.relname);
        assert.equal(table.publicGrants,0,table.relname);
        assert.equal(table.clientGrants,0,table.relname);
        assert.equal(table.policies,0,table.relname);
      }
    });
    await t.test('official Better Auth adapter reads/writes same user and session tables',async()=>{
      await prisma.user.create({data:{id:owner,name:'Integration user',email:`${owner}@example.invalid`,emailVerified:true}});
      const context=await auth.$context;
      const session=await context.internalAdapter.createSession(owner);
      assert.ok(session.token);
      const loaded=await context.internalAdapter.findSession(session.token);
      assert.equal(loaded?.user.id,owner);
      assert.equal(loaded?.session.id,session.id);
      assert.equal((await prisma.session.findUniqueOrThrow({where:{id:session.id}})).userId,owner);
    });
  } finally {
    await prisma.analysis.deleteMany({where:{ownerId:owner}});
    await prisma.rateLimit.deleteMany({where:{OR:[{key:{startsWith:owner+':'}},{key:quotaKey}]}});
    await prisma.user.deleteMany({where:{id:owner}});
    await prisma.$disconnect();
  }
});
