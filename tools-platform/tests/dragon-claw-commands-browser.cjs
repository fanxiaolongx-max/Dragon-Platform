// Run: node_modules/.bin/electron tests/dragon-claw-commands-browser.cjs
// /schedule /plan /btw on the full home script in Chromium; scripted HTTP/model responses, isolated browser profile.
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'dragon-commands-ui-'));
app.setPath('userData',path.join(temp,'profile'));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const home=read('frontend/index.html'),start=home.indexOf('<section class="dc"');
const section=home.slice(start,home.indexOf('</section>',start)+10);
let win,server;
const evaluate=fn=>win.webContents.executeJavaScript(`(${fn.toString()})()`,true);
app.whenReady().then(async()=>{
    server=http.createServer((req,res)=>{if(req.url.startsWith('/js/shared/pinyin-search.js')){res.setHeader('Content-Type','text/javascript');return res.end(read('frontend/js/shared/pinyin-search.js'));}res.setHeader('Content-Type',req.url.startsWith('/api/')?'application/json':'text/html; charset=utf-8');res.end(req.url.startsWith('/api/')?JSON.stringify({models:[],items:[]}):`<style>${read('frontend/css/dragon-claw.css')}body{background:#101b30;margin:0;font-family:system-ui}.dc{--navbar-h:0px;margin:20px}.dc-quick,.dc-scroll-hint{display:none}</style>${section}`);}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    win.webContents.on('console-message',(_,level,message)=>{if(level===3)console.error('Renderer:',message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await win.webContents.executeJavaScript(`
        localStorage.setItem('tools_token','t');
        window.calls=[];window.scheduleCalls=[];window.locale='zh-CN';window.chatId='chat-A';window.holds=[];
        window.schedules=[];
        window.ToolsI18n={getLanguage:()=>locale};window.HomeWorkspace={getTools:()=>[]};
        window.DragonClawWorkspace={getWorkspacePayload:()=>({agentSessionId:'agent-A',root:'/fixture',permissionMode:'full'}),resetSession(){},handleEvent(){},applyDone(){},finishMessage(){}};
        // persist:false 的 /btw 立刻回答；主对话可用 holdMain 挂起，模拟生成中
        window.holdMain=false;
        window.ToolsAIAssistant={requestStreamingChat:async(payload,handlers)=>{
            calls.push(payload);
            if(payload.persist===false){handlers.onDelta('BTW answer');return {reply:'BTW answer'};}
            handlers.onEvent({type:'start',sessionId:chatId});
            if(holdMain) await new Promise((resolve,reject)=>{holds.push(resolve);handlers.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));});
            handlers.onDelta('1. step one');return {sessionId:chatId,reply:'1. step one\\n2. step two'};
        }};
        const nativeFetch=window.fetch.bind(window);
        const json=(data,status=200)=>Promise.resolve({ok:status<400,status,json:async()=>data});
        window.fetch=(url,options={})=>{
            if(url==='/api/channels/available')return json({items:[{id:'welink',label:'WeLink',connected:true},{id:'weixin',label:'微信',connected:true}]});
            if(String(url).startsWith('/api/channels/welink/targets'))return json({items:[{kind:'group',id:'grp-1',name:'运维值班群',canPush:true},{kind:'user',id:'zhang.san',name:'张三',canPush:true}]});
            if(String(url).startsWith('/api/channels/weixin/targets'))return json({items:[{kind:'group',id:'wx-grp',name:'微信群',canPush:true},{kind:'user',id:'wx-li',name:'李四',canPush:true}]});
            if(String(url).startsWith('/api/asset-version'))return json({});
            if(!String(url).startsWith('/api/ai/schedules'))return nativeFetch(url,options);
            scheduleCalls.push({url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
            if(options.method==='POST'){
                const body=JSON.parse(options.body);
                if(!/明天/.test(body.text))return json({error:'没认出时间'},400);
                const item={id:'dcs_1',instruction:'汇总告警',kind:'once',status:'active',description:'一次性',nextRunAt:'2026-10-26T06:00:00.000Z',sessionId:body.sessionId,runCount:0,targets:body.targets.map(t=>({...t,name:t.id==='grp-1'?'运维值班群':'李四'})),lastPush:null};
                schedules=[item];return json({item},201);
            }
            if(options.method==='DELETE'){schedules=schedules.map(item=>({...item,status:'cancelled',nextRunAt:null}));return json({item:schedules[0]});}
            const since=new URL(url,location.href).searchParams.get('since');
            return json({items:since?schedules.filter(item=>item.lastRunAt>since):schedules,active:schedules.filter(item=>item.status==='active').length,serverTime:new Date().toISOString()});
        };
        window.typeText=value=>{const input=document.getElementById('dcInput');input.value=value;input.setSelectionRange(value.length,value.length);input.dispatchEvent(new Event('input',{bubbles:true}));};
        window.press=key=>document.getElementById('dcInput').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
        ${read('frontend/js/home/dragon-claw.js')}
        void 0;
    `);
    const waitFor=expression=>win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})resolve();else if(++n>150)reject(new Error(${JSON.stringify(expression)}));else setTimeout(poll,20)};poll()})`);

    // 菜单里能看到三个新命令；/plan 选中后只补全命令名
    await evaluate(()=>typeText('/'));
    const menu=await evaluate(()=>document.getElementById('dcSlashMenu').textContent);
    for(const name of ['/schedule','/plan','/btw'])assert.ok(menu.includes(name),name);
    await evaluate(()=>{typeText('/pl');press('Enter')});
    assert.equal(await evaluate(()=>document.getElementById('dcInput').value),'/plan ');
    assert.equal(await evaluate(()=>calls.length),0);

    // /plan：发出计划提示、显示原命令、工作区本轮改为 ask；回复后出现确认按钮
    await evaluate(()=>{typeText('/plan 重构登录模块');press('Enter')});
    await waitFor("calls.length===1 && document.querySelector('.dc-plan-actions')");
    const plan=await evaluate(()=>({content:calls[0].messages.at(-1).content,mode:calls[0].workspace.permissionMode,shown:document.querySelector('.dc-msg--user .dc-msg-body').textContent}));
    assert.match(plan.content,/暂时不要执行/);
    assert.match(plan.content,/任务：重构登录模块/);
    assert.equal(plan.mode,'ask');
    assert.equal(plan.shown,'/plan 重构登录模块');
    await evaluate(()=>document.querySelector('[data-dc-plan-revise]').click());
    assert.equal(await evaluate(()=>document.getElementById('dcInput').value),'/plan 调整：');
    await evaluate(()=>document.querySelector('[data-dc-plan-go]').click());
    await waitFor("calls.length===2 && !document.querySelector('.dc-composer.is-generating')");
    const go=await evaluate(()=>({content:calls[1].messages.at(-1).content,mode:calls[1].workspace.permissionMode,actions:document.querySelectorAll('.dc-plan-actions').length}));
    assert.match(go.content,/计划已确认/);
    assert.equal(go.mode,'full','execution goes back to the chosen approval mode');
    assert.equal(go.actions,0,'confirm buttons disappear once used');

    // /btw：主对话生成中也能问；不保存、不带 sessionId/工作区，也不进入主对话上下文
    await evaluate(()=>{holdMain=true;typeText('写一份周报');press('Enter')});
    await waitFor("calls.length===3 && document.querySelector('.dc-composer.is-generating')");
    await evaluate(()=>typeText('/btw 现在几点'));
    assert.equal(await evaluate(()=>document.querySelector('.dc-composer').classList.contains('is-generating')),false,'send button stays a send button for /btw');
    await evaluate(()=>press('Enter'));
    await waitFor("calls.length===4 && document.querySelector('.dc-btw-a').textContent.includes('BTW answer')");
    const btw=await evaluate(()=>({p:calls[3]}));
    assert.equal(btw.p.persist,false);
    assert.equal(btw.p.sessionId,undefined);
    assert.equal(btw.p.workspace,undefined);
    assert.equal(btw.p.messages.at(-1).role,'user');
    assert.match(btw.p.messages.at(-1).content,/写一份周报[\s\S]*现在几点/,'pending main question is folded in so roles alternate');
    assert.notEqual(btw.p.messages.at(-2)?.role,'user');
    await evaluate(()=>{holds.forEach(resolve=>resolve());holdMain=false;});
    await waitFor("!document.querySelector('.dc-composer.is-generating')");
    await evaluate(()=>{typeText('下一个问题');press('Enter')});
    await waitFor("calls.length===5 && !document.querySelector('.dc-composer.is-generating')");
    const history=await evaluate(()=>calls[4].messages.map(item=>item.content).join('\\n'));
    assert.doesNotMatch(history,/现在几点|BTW answer/,'side question never reaches the main context');
    assert.equal(await evaluate(()=>document.getElementById('dcThread').textContent.includes('BTW answer')),false);
    await evaluate(()=>press('Escape'));
    assert.equal(await evaluate(()=>document.querySelector('.dc-btw')),null);

    // /schedule：发送当前对话、时区；失败时原文放回输入框；不带参数打开面板，可取消
    await evaluate(()=>{typeText('/schedule 随便 汇总告警');press('Enter')});
    await waitFor("document.getElementById('dcThread').textContent.includes('没认出时间')");
    assert.equal(await evaluate(()=>document.getElementById('dcInput').value),'/schedule 随便 汇总告警');
    // 推送到：输入 /schedule 后出现，选择 WeLink 群和微信联系人（微信群不可选）
    await waitFor("!document.querySelector('.dc-push-bar').hidden"); // push bar shows while the failed /schedule is back in the input
    await evaluate(()=>typeText('今天天气'));
    assert.equal(await evaluate(()=>document.querySelector('.dc-push-bar').hidden),true);
    await evaluate(()=>typeText('/schedule 明天 9:00 汇总告警'));
    await waitFor("!document.querySelector('.dc-push-bar').hidden");
    await evaluate(()=>document.querySelector('[data-dc-push-pick]').click());
    await waitFor("document.querySelectorAll('.dc-push-item').length===2");
    await evaluate(()=>{const s=document.querySelector('.dc-push-card .dc-session-search');s.value='yunwei';s.dispatchEvent(new Event('input'));});
    await waitFor("document.querySelectorAll('.dc-push-item').length===1 && document.querySelector('.dc-push-item').textContent.includes('运维值班群')"); // pinyin search
    await evaluate(()=>{const s=document.querySelector('.dc-push-card .dc-session-search');s.value='值班';s.dispatchEvent(new Event('input'));});
    await waitFor("document.querySelectorAll('.dc-push-item').length===1");
    await evaluate(()=>document.querySelector('.dc-push-item').click());
    await evaluate(()=>document.querySelector('[data-dc-push-tab="weixin"]').click());
    await evaluate(()=>{const s=document.querySelector('.dc-push-card .dc-session-search');s.value='';s.dispatchEvent(new Event('input'));});
    await waitFor("document.querySelectorAll('.dc-push-item').length===1");
    assert.match(await evaluate(()=>document.querySelector('.dc-push-item').textContent),/李四/,'WeChat groups are not offered');
    await evaluate(()=>document.querySelector('.dc-push-item').click());
    assert.match(await evaluate(()=>document.querySelector('.dc-push-count').textContent),/2/);
    await evaluate(()=>document.querySelector('.dc-push-foot [data-dc-push-close]').click());
    assert.equal(await evaluate(()=>document.querySelectorAll('.dc-push-chip').length),2);
    await evaluate(()=>press('Enter'));
    await waitFor("document.querySelector('.dc-cmd-note [data-dc-schedules]')");
    const post=await evaluate(()=>scheduleCalls.find(call=>call.method==='POST'&&/明天/.test(call.body.text)).body);
    assert.equal(post.text,'明天 9:00 汇总告警');
    assert.deepEqual(post.targets,[{channel:'welink',kind:'group',id:'grp-1'},{channel:'weixin',kind:'user',id:'wx-li'}]);
    assert.match(await evaluate(()=>[...document.querySelectorAll('.dc-cmd-note')].map(n=>n.textContent).join('|')),/推送给 运维值班群、李四/);
    assert.equal(await evaluate(()=>document.querySelector('.dc-push-bar').hidden),true,'selection clears after creating');
    assert.equal(post.sessionId,'chat-A');
    assert.ok(post.timezone);
    assert.equal(await evaluate(()=>calls.length),5,'/schedule never becomes a model question');
    await evaluate(()=>{typeText('/schedule');press('Enter')});
    await waitFor("document.querySelector('[data-dc-schedule-cancel]')");
    assert.match(await evaluate(()=>document.querySelector('.dc-schedule-card').textContent),/汇总告警[\s\S]*等待执行[\s\S]*推送给 运维值班群、李四/);
    await evaluate(()=>document.querySelector('[data-dc-schedule-cancel]').click());
    await waitFor("document.querySelector('.dc-schedule-card').textContent.includes('已取消')");
    assert.equal(await evaluate(()=>scheduleCalls.some(call=>call.method==='DELETE'&&call.url.endsWith('/dcs_1'))),true);
    await evaluate(()=>document.querySelector('[data-dc-schedule-close]').click());
    assert.equal(await evaluate(()=>document.querySelector('.dc-schedule-card')),null);

    process.stdout.write('PASS: slash menu, /plan prompt + ask mode + confirm/revise, /btw during generation without persistence or context, /schedule create/error/list/cancel, push-to picker with pinyin search.\n');
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);if(win&&!win.isDestroyed())win.destroy();server?.close();app.exit(1)});
