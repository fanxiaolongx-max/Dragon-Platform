const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process'),express=require('express');
const sandbox=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-git-')));process.env.TOOLS_DATA_DIR=path.join(sandbox,'data');process.env.TOOLS_REPORT_DATA_DIR=path.join(sandbox,'reports');
const repo=path.join(sandbox,'repo');fs.mkdirSync(repo);
const git=(...args)=>execFileSync('git',['-c',`core.hooksPath=${os.devNull}`,...args],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git('init','-b','main');fs.writeFileSync(path.join(repo,'README.md'),'fixture\n');git('add','README.md');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--no-gpg-sign','-m','Initial');git('branch','feature');
const router=require('../backend/routes/agent-workspace'),manager=require('../backend/models/agent-run-manager'),prefs=require('../backend/models/agent-workspace-repository'),pool=require('../backend/models/tenant-sqlite-pool'),db=require('../backend/models/app-db'),{runWithTenant}=require('../backend/models/tenant-context');
let server,base;
test.before(async()=>{const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={username:'alice',role:req.headers['x-role']||'admin'};runWithTenant(req.headers['x-tenant']||'default',next);});app.use(router);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{server.close();await pool.closeAll();await db.closeDatabase();fs.rmSync(sandbox,{recursive:true,force:true});});
async function call(method,url,body,headers={}){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};}
test('Git metadata reports real local branches and main-worktree identity; viewer writes are denied',async()=>{
 const meta=await call('GET','/git?root='+encodeURIComponent(repo));assert.equal(meta.status,200);assert.equal(meta.body.git,true);assert.equal(meta.body.branch,'main');assert.equal(meta.body.isWorktree,false);assert.deepEqual(meta.body.branches.map(b=>b.name),['feature','main']);assert.equal(meta.body.worktrees[0].root,repo);
 for(const url of ['/git/branch','/git/worktree','/create'])assert.equal((await call('POST',url,{root:repo,branch:'feature',path:path.join(sandbox,'viewer-dir')},{'x-role':'viewer'})).status,403);
 const plain=await call('GET','/git?root='+encodeURIComponent(sandbox));assert.equal(plain.body.git,false);
});
test('branch switching preserves dirty files, blocks active tasks, validates refs and supports new branches',async()=>{
 fs.writeFileSync(path.join(repo,'uncommitted.txt'),'keep me');
 const dirty=await call('POST','/git/branch',{root:repo,branch:'feature'});assert.equal(dirty.status,409);assert.equal(dirty.body.code,'WORKSPACE_DIRTY');assert.equal(git('branch','--show-current'),'main');assert.equal(fs.readFileSync(path.join(repo,'uncommitted.txt'),'utf8'),'keep me');
 fs.unlinkSync(path.join(repo,'uncommitted.txt'));
 const session=manager.ensureSession({agentSessionId:'workspace-busy-fixture',user:{username:'alice',role:'admin'},tenantId:'default',root:repo,permissionMode:'ask'});session.activeRun={};
 try{assert.equal((await call('POST','/git/branch',{root:repo,branch:'feature'})).body.code,'WORKSPACE_BUSY');}finally{session.activeRun=null;}
 const release=manager.reserveWorkspaceMutation(repo);try{assert.throws(()=>manager.beginRun(session,()=>{},new AbortController().signal),error=>error.code==='WORKSPACE_BUSY');}finally{release();}
 for(const branch of ['--detach','../escape','missing','main; touch injected'])assert.equal((await call('POST','/git/branch',{root:repo,branch})).status,400);
 assert.equal((await call('POST','/git/branch',{root:repo,branch:'feature'})).body.branch,'feature');
 assert.equal((await call('POST','/git/branch',{root:repo,branch:'codex/new-workspace',create:true})).body.branch,'codex/new-workspace');
 assert.equal((await call('POST','/git/branch',{root:repo,branch:'main'})).body.branch,'main');
});
test('worktrees create isolated branches/directories from HEAD and retain source changes; owner/tenant paths differ',async()=>{
 fs.writeFileSync(path.join(repo,'local-only.txt'),'original changes');
 const first=await call('POST','/git/worktree',{root:repo});assert.equal(first.status,200);assert.equal(first.body.git.isWorktree,true);assert.match(first.body.git.branch,/^codex\/workspace-/);assert.equal(git('branch','--show-current'),'main');assert.equal(fs.existsSync(path.join(first.body.root,'local-only.txt')),false);assert.equal(fs.readFileSync(path.join(repo,'local-only.txt'),'utf8'),'original changes');
 fs.unlinkSync(path.join(repo,'local-only.txt'));
 assert.equal((await call('POST','/git/branch',{root:repo,branch:first.body.git.branch})).body.code,'WORKSPACE_BRANCH_IN_USE');
 const second=await call('POST','/git/worktree',{root:repo}, {'x-tenant':'other'});assert.equal(second.status,200);assert.notEqual(path.dirname(first.body.root),path.dirname(second.body.root));
 const selected=await call('POST','/select',{path:first.body.root});assert.equal(selected.body.git.isWorktree,true);assert.equal(selected.body.gitBranch,first.body.git.branch);
 assert.equal((await runWithTenant('default',()=>prefs.getPrefs('alice'))).lastDirectory,first.body.root);assert.equal((await runWithTenant('other',()=>prefs.getPrefs('alice'))).lastDirectory,'');
});
test('new workspace creation never overwrites an existing directory',async()=>{
 const directory=path.join(sandbox,'new-workspace');assert.equal((await call('POST','/create',{path:directory})).body.root,directory);
 fs.writeFileSync(path.join(directory,'keep.txt'),'keep');assert.equal((await call('POST','/create',{path:directory})).status,409);assert.equal(fs.readFileSync(path.join(directory,'keep.txt'),'utf8'),'keep');
 assert.equal((await call('POST','/create',{path:'relative/path'})).status,400);
});
