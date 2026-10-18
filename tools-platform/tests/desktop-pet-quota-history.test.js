const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'pet-quota-history-'));
process.env.TOOLS_DATA_DIR=sandbox;
process.env.TOOLS_DESKTOP_RUNTIME='1';
const db=require('../backend/models/app-db');
const repo=require('../backend/models/pet-quota-history-repository');
const {runWithTenant,tenantMiddleware}=require('../backend/models/tenant-context');
const chart=require('../desktop-pet/quota-trend-chart');
const DAY=86400000;
const quota=(at,remaining=80,reset=at+DAY)=>({codex:{status:'live',updatedAt:at,
    accountEmail:'must-not-save@example.test',token:'must-not-save',groups:[{id:'codex',label:'Codex',windows:[
        {id:'5h',remainingPercent:remaining,resetsAt:new Date(reset).toISOString(),durationMinutes:300},
        {id:'weekly',remainingPercent:null}]}]}});
test.after(async()=>{await db.closeDatabase();fs.rmSync(sandbox,{recursive:true,force:true});});

test('stores only valid fresh measurements, deduplicates cached timestamps, and survives reopen',async()=>{
    const now=Date.now(),q=quota(now);
    await Promise.all([repo.record('owner','machine-a',q,now),repo.record('owner','machine-a',q,now)]);
    await repo.record('owner','machine-a',{codex:{...q.codex,status:'cached'}},now);
    await repo.record('owner','machine-a',quota(now-16*60000),now);
    await repo.record('owner','machine-a',quota(now+2*60000),now);
    for(const value of [null,'90',NaN,-1,101])await repo.record('owner','machine-a',quota(now,value),now);
    await db.closeDatabase();
    const result=await repo.history('owner','machine-a','codex',1,now);
    assert.equal(result.series.length,1);assert.equal(result.series[0].points.length,1);
    assert.equal(result.series[0].points[0].remaining,80);assert.equal(result.firstSampleAt,now);
    const stored=await db.all('SELECT * FROM desktop_pet_quota_samples');
    assert.doesNotMatch(JSON.stringify(stored),/must-not-save/);
});
test('history is isolated by tenant, owner and installation',async()=>{
    const now=Date.now();
    await repo.record('owner','machine-b',quota(now,42),now);
    await repo.record('other','machine-a',quota(now,24),now);
    await runWithTenant('quota-a',async()=>{
        await repo.record('owner','machine-a',quota(now,12),now);
        assert.equal((await repo.history('owner','machine-a','codex',1,now)).series[0].points[0].remaining,12);
    });
    await runWithTenant('quota-b',async()=>assert.equal((await repo.history('owner','machine-a','codex',1,now)).series.length,0));
    assert.equal((await repo.history('owner','machine-b','codex',1,now)).series[0].points[0].remaining,42);
    assert.equal((await repo.history('other','machine-a','codex',1,now)).series[0].points[0].remaining,24);
    await assert.rejects(repo.history('owner',"' OR 1=1",'codex'),/INVALID_QUOTA_SCOPE/);
    await assert.rejects(repo.history('owner','machine-a','unknown'),/INVALID_QUOTA_QUERY/);
    await assert.rejects(repo.history('owner','machine-a','codex',91),/INVALID_QUOTA_QUERY/);
});
test('range downsampling keeps reset periods and retention removes only this installation’s old samples',async()=>{
    const now=Date.now(),old=now-91*DAY;
    await repo.record('retention','one',quota(old),old);
    await repo.record('retention','two',quota(old),old);
    await repo.record('retention','one',quota(now-1000,0,now+DAY),now);
    await repo.record('retention','one',quota(now,100,now+2*DAY),now);
    const result=await repo.history('retention','one','codex',30,now);
    assert.equal(result.series[0].points.length,2,'reset samples in the same bucket survive');
    assert.equal(result.firstSampleAt,now-1000);
    assert.equal((await db.get('SELECT COUNT(*) n FROM desktop_pet_quota_samples WHERE owner=? AND device=?',['retention','two'])).n,1);
    assert.equal((await repo.history('retention','two','codex',1,now)).series.length,0,'range does not fill old data forward');
});
test('plot breaks on resets, recovered quota and missing collection; zero is a real point',()=>{
    const reset='2026-10-19T00:00:00Z',r='2026-10-20T00:00:00Z';
    const points=[{at:0,remaining:10,resetsAt:reset},{at:60000,remaining:0,resetsAt:reset},
        {at:120000,remaining:100,resetsAt:r},{at:180000,remaining:90,resetsAt:r},
        {at:20*60000,remaining:85,resetsAt:r},{at:21*60000,remaining:88,resetsAt:r}];
    assert.deepEqual(chart.segments(points,10*60000).map(p=>p.length),[2,2,1,1]);
    assert.ok(Math.abs(chart.paths(points,0,DAY,60000)[0].points[1].y-240)<1e-8);
    assert.equal(chart.paths(points,0,DAY,60000,true)[0].points[1].y,22);
});
test('quota history API gates desktop/auth/admin, validates ranges and uses the session tenant and owner',async()=>{
    const express=require('../backend/node_modules/express'),app=express();
    app.use(express.json());app.use((req,res,next)=>{
        const username=req.headers['x-user'] || (req.headers.authorization==='Bearer history-test-token'?'route-user':null);
        if(username)req.user={username,role:req.headers['x-role']||'admin',tenantId:req.headers['x-tenant']||'default'};
        Object.defineProperty(req.socket,'remoteAddress',{configurable:true,value:req.headers['x-remote']?'192.0.2.1':'127.0.0.1'});next();
    });
    app.use(tenantMiddleware);app.use('/api/desktop-pet',require('../backend/routes/desktop-pet'));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}/api/desktop-pet/quota-history`,headers={'x-user':'route-user','content-type':'application/json'};
    const body=JSON.stringify({device:'route-machine',quotas:quota(Date.now(),33)});
    try {
        assert.equal((await fetch(base)).status,401);
        assert.equal((await fetch(base,{headers:{...headers,'x-remote':'1'}})).status,403);
        assert.equal((await fetch(base,{method:'POST',headers:{...headers,'x-role':'viewer'},body})).status,403);
        assert.equal((await fetch(base,{method:'POST',headers:{...headers,origin:'https://evil.test'},body})).status,403);
        assert.equal((await fetch(base,{method:'POST',headers,body})).status,200);
        const query='?device=route-machine&provider=codex&days=1';
        const response=await fetch(base+query,{headers});assert.equal(response.headers.get('cache-control'),'no-store');
        assert.equal((await response.json()).history.series[0].points[0].remaining,33);
        assert.equal((await(await fetch(base+query,{headers:{...headers,'x-user':'another'}})).json()).history.series.length,0);
        assert.equal((await(await fetch(base+query,{headers:{...headers,'x-tenant':'quota-b'}})).json()).history.series.length,0);
        assert.equal((await fetch(base+query.replace('days=1','days=0'),{headers})).status,400);
        assert.equal((await fetch(base+query.replace('days=1','days=NaN'),{headers})).status,400);
        const {requestHistory}=require('../desktop-pet/quota-history-client');
        const origin=new URL(base).origin;
        await requestHistory(origin,'history-test-token','client-machine',null,quota(Date.now(),21));
        const viaClient=await requestHistory(origin,'history-test-token','client-machine',{provider:'codex',days:1});
        assert.equal(viaClient.series[0].points[0].remaining,21);
        await assert.rejects(requestHistory('https://example.com','history-test-token','client-machine',{}),/LOCAL_QUOTA_SERVER_REQUIRED/);
    } finally {await new Promise(r=>server.close(r));}
});
