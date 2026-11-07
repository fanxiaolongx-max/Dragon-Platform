const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-browser-view-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const browser = require('../backend/models/agent-browser');
const { runWithTenant } = require('../backend/models/tenant-context');
const express = require('../backend/node_modules/express');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let server, base, captures = 0;
const owners = browser._internal.owners;
function fixture(owner, title, image = png) {
    const page = { id:'same-id', title, url:'https://example.com/', refreshInfo:async()=>{}, screenshot:async full => { assert.equal(full,false); captures++; return image; } };
    owners.set(owner,{ active:page.id, tabs:new Map([[page.id,page]]), browser:{ kind:'server', pages:()=>[page] } });
    return page;
}
test.before(async()=>{
    fixture('default::alice','Alice'); fixture('other::alice','Other tenant'); fixture('default::bob','Bob');
    const app = express();app.use(express.json());
    app.use((req,res,next)=>{
        if (req.headers['x-user']) req.user={username:req.headers['x-user'],role:req.headers['x-role']||'admin'};
        runWithTenant(req.headers['x-tenant']||'default',next);
    });
    app.use(require('../backend/routes/agent-workspace'));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
test.after(()=>{server?.close();owners.clear();fs.rmSync(sandbox,{recursive:true,force:true});});
const get = headers => fetch(base+'/browser/view',{headers});
test('browser view needs login and admin access',async()=>{
    assert.equal((await get({})).status,401);
    assert.equal((await get({'x-user':'alice','x-role':'viewer'})).status,403);
    assert.equal(captures,0);
});
test('browser view uses only the current account and tenant, ignoring supplied owner/tab overrides',async()=>{
    for (const [user,tenant,title] of [['alice','default','Alice'],['bob','default','Bob'],['alice','other','Other tenant']]) {
        const response = await fetch(base+'/browser/view?owner=default::bob&tabId=same-id',{headers:{'x-user':user,'x-tenant':tenant}});
        assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
        const data=await response.json();assert.equal(data.title,title);assert.equal(data.image,`data:image/png;base64,${png.toString('base64')}`);
    }
});
test('viewing without an existing browser does not start one',async()=>{
    const before=owners.size;
    assert.deepEqual(await (await get({'x-user':'nobody'})).json(),{available:false,tabs:[],manual:{active:false}});
    assert.equal(owners.size,before);
});
test('closed pages, oversized screenshots and capture failures are handled without leaking raw errors',async()=>{
    const closed=fixture('default::closed','Closed');owners.get('default::closed').browser.pages=()=>[];
    assert.equal((await browser.view('default::closed')).available,false);
    fixture('default::large','Large',Buffer.alloc(8*1024*1024+1));
    assert.equal((await get({'x-user':'large'})).status,503);
    const page=fixture('default::broken','Broken');page.screenshot=async()=>{throw Error('private backend detail');};
    const response=await get({'x-user':'broken'});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private backend detail/);
});

test('manual control API requires an admin, same-origin access and the current owner token',async()=>{
    const post=(user,body,extra={})=>fetch(base+'/browser/control',{method:'POST',headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{}),...extra},body:JSON.stringify(body)});
    assert.equal((await post(null,{action:'acquire'})).status,401);
    assert.equal((await post('alice',{action:'acquire'},{'x-role':'viewer'})).status,403);
    assert.equal((await post('alice',{action:'acquire'},{origin:'https://other.invalid'})).status,403);
    const response=await post('alice',{action:'acquire',owner:'default::bob'});assert.equal(response.status,200);
    const session=await response.json();assert.equal(owners.get('default::alice').manual.tabId,'same-id');assert.equal(owners.get('default::bob').manual,undefined);
    assert.equal((await post('bob',{action:'release',token:session.token})).status,200,'no control to release for another owner');
    assert.equal(owners.get('default::alice').manual!==null,true,'other owners cannot release Alice control');
    assert.equal((await post('alice',{action:'release',token:session.token},{'x-tenant':'other'})).status,200);
    assert.equal(owners.get('default::alice').manual!==null,true,'same username in another tenant cannot release control');
    const data=await(await get({'x-user':'alice'})).json();assert.equal(data.manual.active,true);assert.equal(Object.hasOwn(data.manual,'token'),false);
    assert.equal((await post('alice',{action:'click',token:'invalid',frameId:data.frameId,x:.5,y:.5})).status,409);
    assert.equal((await post('alice',{action:'release',token:session.token})).status,200);
    assert.equal(owners.get('default::alice').manual,null);
});

test('continuous frames require authentication and stop capturing after disconnect',async()=>{
 assert.equal((await fetch(base+'/browser/stream')).status,401);
 assert.equal((await fetch(base+'/browser/stream',{headers:{'x-user':'alice','x-role':'viewer'}})).status,403);
 const abort=new AbortController();
 const response=await fetch(base+'/browser/stream?owner=default::bob',{headers:{'x-user':'alice'},signal:abort.signal});
 assert.equal(response.headers.get('content-type'),'application/x-ndjson');assert.match(response.headers.get('cache-control'),/no-store/);
 const reader=response.body.getReader();let body='';
 while(body.split('\n').length<3){const {value}=await reader.read();body+=Buffer.from(value).toString();}
 const frames=body.trim().split('\n').map(line=>JSON.parse(line));assert.ok(frames.length>=2);assert.ok(frames.every(frame=>frame.title==='Alice'&&frame.frameId&&!frame.manual.token));
 abort.abort();await reader.cancel().catch(()=>{});
 await new Promise(resolve=>setTimeout(resolve,350));const stopped=captures;await new Promise(resolve=>setTimeout(resolve,400));assert.equal(captures,stopped);
});

test('multipart browser files stay scoped to the manual owner and never accept server paths',async()=>{
 const page=fixture('default::uploader','Uploads');let selected;
 page.evaluate=async()=>({width:800,height:600});page.pendingUpload=()=>({id:'chooser-fixture',multiple:true});
 page.uploadFiles=async files=>{selected=files;};
 const session=await browser.control('default::uploader',{action:'acquire'});
 const upload=async(headers,token=session.token)=>{
  const frame=await browser.view('default::uploader'),form=new FormData();
  form.set('token',token);form.set('frameId',frame.frameId);form.set('chooserId','chooser-fixture');form.set('owner','default::bob');
  form.append('files',new Blob(['private upload fixture']), 'file.txt');
  return fetch(base+'/browser/upload',{method:'POST',headers,body:form});
 };
 assert.equal((await upload({'x-user':'uploader','x-role':'viewer'})).status,403);
 assert.equal((await upload({'x-user':'uploader',origin:'https://bad.invalid'})).status,403);
 assert.equal((await upload({'x-user':'uploader'},'wrong-token')).status,409);
 assert.equal((await upload({'x-user':'uploader','x-tenant':'other'})).status,409);
 assert.equal(selected,undefined);
 const response=await upload({'x-user':'uploader'});assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.files[0].name,'file.txt');assert.equal(result.files[0].path,undefined);
 const artifacts=require('../backend/models/agent-artifacts');assert.ok(artifacts.ownsFile('default::uploader',selected[0]));assert.equal(artifacts.ownsFile('other::uploader',selected[0]),false);assert.equal(artifacts.ownsFile('default::bob',selected[0]),false);
 assert.equal(fs.readFileSync(selected[0],'utf8'),'private upload fixture');
 assert.equal((await fetch(base+'/browser/control',{method:'POST',headers:{'x-user':'uploader','Content-Type':'application/json'},body:JSON.stringify({action:'upload',token:session.token,frameId:(await browser.view('default::uploader')).frameId,chooserId:'chooser-fixture',_uploads:[{path:'/etc/passwd',buffer:{type:'Buffer',data:[65]}}]})})).status,400);
 await browser.control('default::uploader',{action:'release',token:session.token});
});
