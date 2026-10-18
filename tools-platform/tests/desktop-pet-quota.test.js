const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { parseCodexQuota,readCodexQuota } = require('../desktop-pet/codex-quota');
const { parseClaudeQuota,readClaudeQuota } = require('../desktop-pet/claude-quota');
const { readDesktopClaudeCredential,selectDesktopEntry } = require('../desktop-pet/claude-desktop-quota');
const { parseAntigravityQuota,parseProcesses,createAntigravityReader } = require('../desktop-pet/antigravity-quota');
const { cachedReader,unavailable } = require('../desktop-pet/quota-common');
const view = require('../desktop-pet/quota-view');
const reset = '2099-01-01T00:00:00Z';
const codexData = () => ({rateLimitsByLimitId:{codex:{primary:{usedPercent:6,windowDurationMins:300,resetsAt:4070908800},secondary:{usedPercent:82,windowDurationMins:10080,resetsAt:4070908800}}}});
const agData = () => ({response:{groups:[{displayName:'Gemini Models',buckets:[{window:'5h',remainingFraction:0,resetTime:reset},{window:'weekly',remainingFraction:.97313654,resetTime:reset}]},{displayName:'Claude and GPT models',buckets:[{window:'weekly',remainingFraction:1,resetTime:reset}]}]}});

test('Codex uses actual window durations, zero remains exhausted, unknown windows stay separate', () => {
    const data=codexData(),q=parseCodexQuota(data);
    assert.deepEqual(q.groups[0].windows.map(w=>[w.id,w.remainingPercent]),[['5h',94],['weekly',18]]);
    data.rateLimitsByLimitId.codex.primary={usedPercent:100,windowDurationMins:15,resetsAt:null};
    const other=parseCodexQuota(data);assert.equal(other.groups[0].windows[0].id,'other');assert.equal(other.groups[0].windows[0].remainingPercent,0);
    const display=view.current({codex:other},'codex:codex',false,false);assert.equal(display.val,null);
    assert.equal(parseCodexQuota({}).active,false);
});

test('missing, invalid or over-range values never manufacture 100% quota',()=>{
    const q=parseAntigravityQuota(agData());assert.equal(q.gemini5h,0);assert.equal(q.geminiWeekly,97.3);assert.equal(q.claude5h,null);
    assert.equal(q.claudeWeekly,100);assert.equal(q.gemini5hReset,'2099-01-01T00:00:00.000Z');
    assert.equal(parseAntigravityQuota({response:{}}).active,false);
    for(const value of [undefined,null,'0',NaN,Infinity,-1,101]) {
        assert.equal(parseClaudeQuota({five_hour:{utilization:value}}).active,false);
        assert.equal(parseCodexQuota({rateLimits:{primary:{usedPercent:value,windowDurationMins:300}}}).active,false);
    }
    assert.equal(parseClaudeQuota({five_hour:{utilization:0},seven_day:{utilization:100}}).groups[0].windows[1].remainingPercent,0);
});

test('cache coalesces concurrent reads, preserves timestamps, expires reset windows and clears on sign-out',async()=>{
    let now=1000,count=0,fail=false,status='unavailable';
    const read=cachedReader('codex',async()=>{count++;if(fail)return unavailable('codex',status);return{...parseCodexQuota(codexData()),updatedAt:now};},100,()=>now);
    const [a,b]=await Promise.all([read(),read()]);assert.equal(count,1);assert.equal(a,b);
    await read();assert.equal(count,1);
    now=1200;fail=true;const cached=await read();assert.equal(cached.status,'cached');assert.equal(cached.updatedAt,1000);
    now=1400;status='signed_out';assert.equal((await read()).active,false);
    now=1600;status='unavailable';assert.equal((await read()).status,'unavailable');
    const expired=cachedReader('codex',async()=>{if(fail)throw Error('private diagnostic');return{...parseCodexQuota(codexData()),updatedAt:1000,groups:[{id:'codex',windows:[{id:'5h',remainingPercent:50,resetsAt:new Date(1100).toISOString()}]}]};},1,()=>now);
    fail=false;now=1000;await expired();fail=true;now=1200;assert.equal((await expired()).groups[0].windows[0].remainingPercent,null);
    now=20*60000;assert.equal((await expired()).status,'unavailable');
});

function codexSpawn(reply) {
    const calls=[],child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();child.exitCode=null;
    let killed=0,buffer='';child.kill=()=>{killed++;child.exitCode=0;};
    child.stdin.on('data',data=>{buffer+=data;let index;while((index=buffer.indexOf('\n'))>=0){const msg=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);calls.push(msg);if(msg.id)queueMicrotask(()=>child.stdout.write(JSON.stringify(reply(msg))+'\n'));}});
    return {spawn:()=>child,calls,get killed(){return killed;}};
}
test('Codex handshake reads account mode before quotas, closes only its own child and strips sensitive responses',async()=>{
    const mock=codexSpawn(msg=>({id:msg.id,result:msg.id===3?{account:{type:'chatgpt',email:'private@example.test'}}:msg.id===2?codexData():{}}));
    const q=await readCodexQuota({spawn:mock.spawn,command:{file:'test-codex',args:[]}});
    assert.equal(q.status,'live');assert.equal(mock.killed,1);assert.deepEqual(mock.calls.map(x=>x.method),['initialize','initialized','account/read','account/rateLimits/read']);
    assert.doesNotMatch(JSON.stringify(q),/private|@|token|email/);
    const api=codexSpawn(msg=>({id:msg.id,result:msg.id===3?{account:{type:'apiKey'}}:{}}));
    assert.equal((await readCodexQuota({spawn:api.spawn,command:{file:'test',args:[]}})).status,'api_key');
    assert.equal(api.calls.some(x=>x.method==='account/rateLimits/read'),false);
    const failed=codexSpawn(msg=>msg.id===2?{id:2,error:{message:'Authorization failed SECRET'}}:{id:msg.id,result:msg.id===3?{account:{type:'chatgpt'}}:{}});
    const safe=await readCodexQuota({spawn:failed.spawn,command:{file:'test',args:[]}});assert.equal(safe.status,'auth_required');assert.doesNotMatch(JSON.stringify(safe),/SECRET/);
});
test('a hung Codex child times out without blocking the next probe',async()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();let killed=false;child.kill=()=>{killed=true;child.exitCode=0;};
    const q=await readCodexQuota({spawn:()=>child,command:{file:'test',args:[]},timeout:10});assert.equal(q.status,'unavailable');assert.equal(killed,true);
});

test('Antigravity discovers Windows and Mac listening ports and never forwards local credentials',async()=>{
    const csrf='test-csrf-not-an-account-token';
    for(const platform of ['win32','darwin']) {
        const process=platform==='win32'?JSON.stringify({ProcessId:123,CommandLine:'language_server.exe --csrf_token "'+csrf+'" --https_server_port 0'}):'123 /Applications/Antigravity.app/bin/language_server --csrf_token '+csrf;
        assert.equal(parseProcesses(process,platform)[0].pid,123);
        const requests=[];
        const reader=createAntigravityReader({platform,run:async(_file,args)=>args.join(' ').includes('ps')||args.includes('pid=,args=')?process:args.join(' ').includes('Get-CimInstance')?process:platform==='win32'?'[54321]':'p123\nn127.0.0.1:54321\n',
            requestJson:async(url,options)=>{requests.push({url,options});return agData();}});
        const q=await reader();assert.equal(q.status,'live');assert.equal(requests[0].url,'https://127.0.0.1:54321/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary');
        assert.equal(requests[0].options.headers['x-codeium-csrf-token'],csrf);assert.doesNotMatch(JSON.stringify(q),/test-csrf/);
    }
});

function temporaryDesktop(t) {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-claude-desktop-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const account='11111111-1111-1111-1111-111111111111';fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({lastKnownAccountUuid:account,'oauth:tokenCacheV2':Buffer.from('ciphertext').toString('base64')}));
    return {dir,account};
}
test('Claude Desktop binds to its active account, prioritizes desktop over a different CLI API key and sends no credentials to UI',async t=>{
    const {dir,account}=temporaryDesktop(t),token='desktop-token-only-in-memory';
    const credential=await readDesktopClaudeCredential({directory:dir,platform:'darwin',run:async(_file,args)=>args.includes('pid=,comm=')?'123 '+path.join(dir,'claude-code','1','claude.app','Contents','MacOS','claude'):
        'CLAUDE_CODE_ACCOUNT_UUID='+account+' ANTHROPIC_BASE_URL=https://api.anthropic.com CLAUDE_CODE_OAUTH_TOKEN='+token+' CLAUDE_CODE_SUBSCRIPTION_TYPE=pro'});
    assert.equal(credential.token,token);
    const q=await readClaudeQuota({readDesktop:async()=>credential,run:async()=>JSON.stringify({loggedIn:true,authMethod:'api_key'}),requestJson:async(url,options)=>{
        assert.equal(url,'https://api.anthropic.com/api/oauth/usage');assert.equal(options.headers.Authorization,'Bearer '+token);return{five_hour:{utilization:6,resets_at:reset},seven_day:{utilization:82,resets_at:reset}};
    }});
    assert.equal(q.source,'desktop');assert.equal(q.membership.label,'Pro');assert.deepEqual(q.groups[0].windows.map(w=>w.remainingPercent),[94,18]);assert.doesNotMatch(JSON.stringify(q),/desktop-token|Authorization|accessToken/);
});
test('Windows desktop cache decryption rejects expired, other-account and other-provider entries',async t=>{
    const {dir,account}=temporaryDesktop(t);
    const key='acct:'+account+'|client:org:https://api.anthropic.com:user:profile user:inference';
    const entries={[key]:{token:'subscription-token',subscriptionType:'max',expiresAt:Date.now()+60000},['acct:22222222-2222-2222-2222-222222222222|client:org:https://api.anthropic.com:user:profile']:{token:'other',expiresAt:Date.now()+60000}};
    const q=await readDesktopClaudeCredential({directory:dir,platform:'win32',decrypt:()=>JSON.stringify(entries)});assert.equal(q.token,'subscription-token');assert.equal(q.subscriptionType,'max');
    assert.equal(selectDesktopEntry({[key]:{token:'expired',expiresAt:1}},account),null);
    assert.equal(selectDesktopEntry({[key.replace('api.anthropic.com','example.test')]:entries[key]},account),null);
    assert.equal(selectDesktopEntry(entries,'33333333-3333-3333-3333-333333333333'),null);
});
test('desktop sign-in is not overwritten by CLI mode; CLI OAuth still works without Desktop',async()=>{
    const locked=await readClaudeQuota({readDesktop:async()=>({status:'desktop_session_required'}),run:async()=>JSON.stringify({authMethod:'api_key'})});assert.equal(locked.status,'desktop_session_required');
    const api=await readClaudeQuota({readDesktop:async()=>({status:'not_installed'}),run:async()=>JSON.stringify({authMethod:'api_key'})});assert.equal(api.status,'api_key');
    const q=await readClaudeQuota({readDesktop:async()=>({status:'not_installed'}),token:'cli-token',run:async()=>JSON.stringify({loggedIn:true,authMethod:'oauth'}),requestJson:async()=>({five_hour:{utilization:10}})});
    assert.equal(q.source,'cli');assert.equal(q.groups[0].windows[0].remainingPercent,90);
});
test('quota presentation separates sources, handles missing weekly values and escapes labels as text',()=>{
    const quotas={codex:parseCodexQuota(codexData()),antigravity:parseAntigravityQuota(agData()),claudecode:parseClaudeQuota({five_hour:{utilization:6}})};
    assert.equal(view.current(quotas,'codex:codex',false,false).val,94);
    assert.equal(view.current(quotas,'antigravity:gemini',true,false).val,97.3);
    assert.equal(view.current(quotas,'claudecode:claudecode',true,true).val,null);
    assert.match(view.current(quotas,'codex:codex',true,true).label,/Weekly/);
    const doc={createElement:()=>({children:[],appendChild(x){this.children.push(x);}})};
    const container={ownerDocument:doc,children:[],replaceChildren(){this.children=[];},appendChild(x){this.children.push(x);}};
    quotas.codex.groups[0].label='<img onerror=bad>';
    view.render(container,quotas,false);assert.equal(container.children.length,4);
    assert.match(container.children[0].children[0].textContent,/<img onerror=bad>/);
    assert.match(container.children[0].children[1].textContent,/94%/);
});

test('membership comes from explicit provider metadata, never from usage percentages or unknown plan names',()=>{
    const {membership}=require('../desktop-pet/quota-common');
    assert.deepEqual(membership('plus'),{tier:'plus',label:'Plus',premium:true});
    assert.deepEqual(membership('PRO'),{tier:'pro',label:'Pro',premium:true});
    assert.equal(membership('TEAMS_TIER_PRO').label,'Pro');
    assert.equal(membership('Google AI Ultra').label,'Ultra');
    assert.equal(membership('free').premium,false);
    for(const value of [null,undefined,3,'unknown','expensive','<img onerror=bad>'])assert.equal(membership(value),null);
    assert.equal(parseCodexQuota(codexData()).membership,null);
    assert.equal(parseClaudeQuota({five_hour:{utilization:0}}).membership,null);
    assert.equal(parseAntigravityQuota(agData()).membership,null);
    const data=codexData();data.rateLimitsByLimitId.codex.planType='plus';
    assert.equal(parseCodexQuota(data,'pro').membership.label,'Plus');
    delete data.rateLimitsByLimitId.codex.planType;
    assert.equal(parseCodexQuota(data,'pro').membership.label,'Pro');
    assert.equal(parseClaudeQuota({five_hour:{utilization:10}},'max').membership.label,'Max');
});
test('Codex account plan is preserved while private account fields are discarded',async()=>{
    const mock=codexSpawn(msg=>({id:msg.id,result:msg.id===3?{account:{type:'chatgpt',planType:'plus',email:'private@example.test'}}:msg.id===2?codexData():{}}));
    const q=await readCodexQuota({spawn:mock.spawn,command:{file:'test',args:[]}});
    assert.equal(q.membership.label,'Plus');assert.doesNotMatch(JSON.stringify(q),/private@example|email/);
});
test('Antigravity member details are optional and do not leak account profile or break quota on failure',async()=>{
    const q=parseAntigravityQuota(agData(),{userStatus:{email:'private@example.test',name:'PRIVATE',planStatus:{planInfo:{planName:'Pro',teamsTier:'TEAMS_TIER_PRO'},availablePromptCredits:123}}});
    assert.equal(q.membership.label,'Pro');assert.doesNotMatch(JSON.stringify(q),/PRIVATE|email|123|private@example/);
    const requests=[];
    const reader=createAntigravityReader({platform:'darwin',run:async()=> '123 /app/language_server --csrf_token local-csrf --https_server_port 54321',
        requestJson:async url=>{requests.push(url);if(url.endsWith('GetUserStatus'))throw Error('not supported');return agData();}});
    const fallback=await reader();assert.equal(fallback.status,'live');assert.equal(fallback.membership,null);assert.equal(requests.length,2);
});
