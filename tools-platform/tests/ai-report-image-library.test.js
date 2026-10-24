const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'ai-report-image-library-'));
process.env.TOOLS_DATA_DIR=path.join(sandbox,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(sandbox,'reports');
const images=require('../backend/models/ai-report-images');
const library=require('../backend/models/ai-report-image-library');
const selection=require('../backend/models/ai-report-image-selection');
const context=require('../backend/models/tenant-context');
const db=require('../backend/models/app-db');
const express=require('../backend/node_modules/express'),request=require('supertest');
const router=require('../backend/routes/ai-report');
const app=express();app.use(express.json());
app.use((req,res,next)=>{
    const who=req.headers['x-test-user']||'alice';
    if(who!=='anonymous')req.user={username:who,role:who==='viewer'?'viewer':'admin',tenantId:req.headers['x-test-tenant']||'default'};
    context.runWithTenant(req.user?.tenantId||'default',next);
});
app.use('/r',router);
const svg=color=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${color}"/></svg>`);
const save=(name,color)=>images.save({bytes:svg(color),name:name+'.svg',source:'upload',user:'alice'});
test.after(async()=>{await db.closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();fs.rmSync(sandbox,{recursive:true,force:true});});

test('gallery pages have stable boundaries, counts, empty state and a bounded page size',()=>{
    const items=Array.from({length:25},(_,i)=>({id:String(i)}));
    assert.deepEqual(library.page(items,2).items.map(i=>i.id),['8','9','10','11','12','13','14','15']);
    assert.equal(library.page(items,999).page,4);assert.equal(library.page(items,999).items.length,1);
    assert.equal(library.page([],99).page,1);assert.equal(library.page([],99).total,0);
    assert.equal(library.page(items,1,1000).pageSize,24);
});

test('delete is reviewed, explicitly confirmed, reversible and keeps existing report URLs alive',async()=>{
    const image=await save('blue','#0055ff');
    const proposal=(await request(app).post('/r/image-deletions').send({ids:[image.id]}).expect(200)).body;
    assert.equal(proposal.type,'delete_confirmation');assert.equal(proposal.images[0].id,image.id);
    assert.ok((await library.list()).some(i=>i.id===image.id),'proposal is not deletion');
    await request(app).post(`/r/image-deletions/${proposal.proposalId}/confirm`).send({}).expect(400);
    assert.ok((await library.list()).some(i=>i.id===image.id));
    await request(app).post(`/r/image-deletions/${proposal.proposalId}/confirm`).send({confirmed:true}).expect(200);
    assert.equal((await library.list()).some(i=>i.id===image.id),false);
    await request(app).get(image.url.replace('/api/ai-report','/r')).expect(200);
    assert.equal((await images.read(image.id)).bytes.toString(),svg('#0055ff').toString());
    await request(app).post(`/r/image-deletions/${proposal.proposalId}/confirm`).send({confirmed:true}).expect(200);
    await request(app).post(`/r/image-deletions/${proposal.proposalId}/restore`).send({}).expect(200);
    assert.ok((await library.list()).some(i=>i.id===image.id));
});

test('proposals are isolated by owner and tenant, viewers cannot create or apply them',async()=>{
    const image=await save('owner','#0044ee');
    const p=await images.proposeDeletion([image],'alice');
    await request(app).post('/r/image-deletions').set('x-test-user','viewer').send({ids:[image.id]}).expect(403);
    await request(app).post('/r/image-deletions').set('x-test-user','anonymous').send({ids:[image.id]}).expect(401);
    await request(app).post(`/r/image-deletions/${p.id}/confirm`).set('x-test-user','bob').send({confirmed:true}).expect(404);
    await request(app).post(`/r/image-deletions/${p.id}/confirm`).set('x-test-tenant','isolated').send({confirmed:true}).expect(404);
    assert.ok((await library.list()).some(i=>i.id===image.id));
    await context.runWithTenant('isolated',async()=>{
        const own=await save('other-tenant','#00ee44');
        const proposal=await images.proposeDeletion([own],'alice');
        await images.changeDeletion(proposal.id,'alice','confirm');
        assert.equal((await images.visible([own])).length,0);
    });
    assert.ok((await library.list()).some(i=>i.id===image.id));
});

test('expired, cancelled or superseded reviews cannot delete a different or stale set',async()=>{
    const image=await save('expire','#888888');
    const first=await images.proposeDeletion([image],'alice');
    const second=await images.proposeDeletion([image],'alice');
    await assert.rejects(images.changeDeletion(first.id,'alice','confirm'),e=>e.status===409);
    await db.run('UPDATE ai_report_image_deletions SET expires_at=? WHERE id=?',['2000-01-01T00:00:00.000Z',second.id]);
    await assert.rejects(images.changeDeletion(second.id,'alice','confirm'),e=>e.status===410);
    const third=await images.proposeDeletion([image],'alice');
    await images.changeDeletion(third.id,'alice','cancel');
    await assert.rejects(images.changeDeletion(third.id,'alice','confirm'),e=>e.status===409);
    assert.ok((await library.list()).some(i=>i.id===image.id));
    await request(app).post('/r/image-deletions').send({ids:['not-in-this-library']}).expect(409);
});

test('hiding shared platform or legacy entries changes only the current tenant library',async()=>{
    const platform={id:'platform-logo.png',url:'/assets/logo.png',name:'current platform',source:'platform-logo'};
    const p=await images.proposeDeletion([platform],'alice');await images.changeDeletion(p.id,'alice','confirm');
    assert.equal((await images.visible([platform])).length,0);
    await context.runWithTenant('isolated',async()=>assert.equal((await images.visible([platform])).length,1));
    await images.changeDeletion(p.id,'alice','restore');
});

test('undoing an older deletion does not undo a newer deletion of the same image',async()=>{
    const image=await save('later','#009999');
    const first=await images.proposeDeletion([image],'alice');await images.changeDeletion(first.id,'alice','confirm');
    const newer=await images.proposeDeletion([image],'bob');await images.changeDeletion(newer.id,'bob','confirm');
    await images.changeDeletion(first.id,'alice','restore');
    assert.equal((await images.visible([image])).length,0);
    await images.changeDeletion(newer.id,'bob','restore');
    assert.equal((await images.visible([image])).length,1);
});

test('vision selection batches actual image data and validates every returned ID',async()=>{
    const items=Array.from({length:19},(_,i)=>({id:'image-'+i,url:'/fake/'+i,name:'logo '+i}));
    const batches=[];
    const client={async generateChat(options){
        const labels=options.messages.slice(1).map(m=>JSON.parse(m.content.slice('图片标签：'.length)));
        batches.push(labels);
        assert.ok(options.messages.slice(1).every(m=>m.images?.[0].data==='fixture'));
        return {text:JSON.stringify({ids:labels.filter(i=>Number(i.id.split('-')[1])%2===0).map(i=>i.id),ambiguous:false})};
    }};
    const result=await selection.select(client,{items,description:'所有蓝色的',readPicture:async()=>({images:[{mimeType:'image/png',data:'fixture'}]})});
    assert.deepEqual(batches.map(b=>b.length),[8,8,3]);assert.equal(result.items.length,10);
    await assert.rejects(selection.select({async generateChat(){return {text:'{"ids":["invented"],"ambiguous":false}'};}},
        {items:items.slice(0,1),description:'blue',readPicture:async()=>({images:[]})}),e=>e.status===502);
});

test('ambiguous or unreadable pictures produce no deletion candidates',async()=>{
    const items=[{id:'image',name:'blue'}];
    const unclear=await selection.select({async generateChat(){return {text:'{"ids":["image"],"ambiguous":true,"text":"两个相似，请指定"}'};}},
        {items,description:'那一个',readPicture:async()=>({images:[]})});
    assert.equal(unclear.ambiguous,true);assert.deepEqual(unclear.items,[]);
    const missing=await selection.select({async generateChat(){throw Error('must not call');}},
        {items,description:'blue',readPicture:async()=>null});
    assert.equal(missing.ambiguous,true);assert.deepEqual(missing.items,[]);
});

test('AI deletion requires a second user turn and separate explicit confirmation API',async()=>{
    const image=await save('AI-blue','#1133ee'),settings=require('../backend/models/ai-settings-repository'),provider=require('../backend/models/ai-provider-client');
    const originalSettings=settings.getRuntimeSettings,originalClient=provider.createClient;
    let confirm=false,sawPicture=false;
    settings.getRuntimeSettings=async()=>({hasApiKey:true,keyLooksValid:true,provider:'test',model:'test'});
    provider.createClient=()=>({async generateChat({systemInstruction,messages}){
        if(systemInstruction.includes('图片图库的筛选助手')){
            sawPicture=messages.some(m=>m.images?.length||m.content.includes('SVG图形源码'));
            return {text:JSON.stringify({ids:[image.id],ambiguous:false})};
        }
        return {text:JSON.stringify(confirm?{type:'confirm_delete'}:{type:'delete_images',scope:'page',description:'本页蓝色的图片'}),toolCalls:[]};
    }});
    try{
        const result=(await request(app).post('/r/image/chat').send({message:'删除本页蓝色的图片',gallery:{page:1,ids:[image.id]}}).expect(200)).body;
        assert.equal(result.type,'delete_confirmation');assert.ok(sawPicture);
        assert.ok((await library.list()).some(i=>i.id===image.id));
        confirm=true;
        const agreed=(await request(app).post('/r/image/chat').send({message:'是的，确认删除这张',pendingProposalId:result.proposalId}).expect(200)).body;
        // A typed agreement only shows the same list again; deleting still takes the review card's button.
        assert.equal(agreed.type,'delete_confirmation');assert.equal(agreed.proposalId,result.proposalId);assert.ok((await library.list()).some(i=>i.id===image.id));
        await request(app).post(`/r/image-deletions/${agreed.proposalId}/confirm`).send({confirmed:true}).expect(200);
        assert.equal((await library.list()).some(i=>i.id===image.id),false);
    }finally{settings.getRuntimeSettings=originalSettings;provider.createClient=originalClient;}
});

test('chat persistence retains page metadata and deletion review snapshots',()=>{
    const model=require('../frontend/js/ai-report/report-model');
    const item={id:'image',url:'/api/ai-report/images/image',name:'blue'};
    const normalized=model.cell({chat:[{role:'ai',kind:'gallery',text:'page',images:[item],gallery:{page:3,pageSize:8,total:24,totalPages:3}},
        {role:'ai',kind:'image_delete',text:'review',images:[item],proposal:{id:'proposal',status:'pending',expiresAt:'2099-01-01T00:00:00.000Z'},reviewPage:1}]}).chat;
    assert.equal(normalized[0].gallery.page,3);assert.equal(normalized[1].kind,'image_delete');
    assert.equal(normalized[1].proposal.id,'proposal');assert.equal(normalized[1].images[0].id,'image');
});

test('platform logo entries mirror the live setting and are never offered for deletion',async()=>{
    const library=await require('../backend/models/ai-report-image-library').list();
    const platform=library.find(item=>item.source==='platform-logo');
    if(!platform)return; // no platform logo in this data directory
    const response=await request(app).post('/r/image-deletions').send({ids:[platform.id]}).expect(400);
    assert.match(response.body.error,/平台标识/);
});
