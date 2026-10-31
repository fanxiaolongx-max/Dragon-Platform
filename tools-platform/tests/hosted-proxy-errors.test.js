const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hosted-proxy-errors-'));process.env.TOOLS_DATA_DIR=dir;
const proxy=require('../backend/models/hosted-apps/proxy');
test('expired app APIs retain readable CORS JSON errors and preflight never bypasses actual authentication',async()=>{
 const server=http.createServer((req,res)=>{req.url=req.url.replace(/^\/apps/,'');return proxy.handler(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const {token}=proxy.issueToken({tenantId:'default',slug:'fixture',username:'user',role:'user'},Date.now()-13*3600*1000);
  const url='http://127.0.0.1:'+server.address().port+'/apps/fixture/~'+token+'/__platform/adc/chat';
  const preflight=await fetch(url,{method:'OPTIONS',headers:{origin:'null','access-control-request-method':'POST','access-control-request-headers':'content-type,x-aiops-environment-revision'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'*');assert.match(preflight.headers.get('access-control-allow-headers'),/x-aiops/);
  const response=await fetch(url,{method:'POST',headers:{origin:'null','content-type':'application/json'},body:'{}'});
  assert.equal(response.status,401);assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.match((await response.json()).error,/过期/);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
