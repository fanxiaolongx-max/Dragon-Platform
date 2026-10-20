// Run: node_modules/.bin/electron tests/dragon-claw-compact-browser.cjs
// Full current home script in Chromium; scripted HTTP/model responses, isolated browser profile.
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'dragon-compact-ui-'));
app.setPath('userData',path.join(temp,'profile'));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const home=read('frontend/index.html'),start=home.indexOf('<section class="dc"');
const section=home.slice(start,home.indexOf('</section>',start)+10);
let win,server;
const evaluate=fn=>win.webContents.executeJavaScript(`(${fn.toString()})()`,true);
app.whenReady().then(async()=>{
    server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url.startsWith('/api/')?'application/json':'text/html; charset=utf-8');res.end(req.url.startsWith('/api/')?JSON.stringify({models:[],items:[]}):`<style>${read('frontend/css/dragon-claw.css')}body{background:#101b30;margin:0;font-family:system-ui}.dc{--navbar-h:0px;margin:20px}.dc-quick,.dc-scroll-hint{display:none}</style>${section}`);}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await win.webContents.executeJavaScript(`
        window.calls=[];window.compactCalls=[];window.applied=[];window.locale='zh-CN';window.chatId='chat-A';
        window.ToolsI18n={getLanguage:()=>locale};window.HomeWorkspace={getTools:()=>[]};
        window.DragonClawWorkspace={getWorkspacePayload:()=>null,resetSession(){},handleEvent(){},applyCompaction(data){applied.push(data)}};
        window.ToolsAIAssistant={requestStreamingChat:async(payload,handlers)=>{calls.push(payload);handlers.onEvent({type:'start',sessionId:chatId});handlers.onDelta('Answer');return {sessionId:chatId,reply:'Answer'}}};
        const nativeFetch=window.fetch.bind(window);
        window.fetch=(url,options)=>{
            if(url!=='/api/ai/compact')return nativeFetch(url,options);
            compactCalls.push(JSON.parse(options.body));
            return new Promise((resolve,reject)=>{
                window.finishCompact=(data={performed:true},ok=true)=>resolve({ok,json:async()=>data});
                options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
            });
        };
        window.typeText=value=>{const input=document.getElementById('dcInput');input.value=value;input.setSelectionRange(value.length,value.length);input.dispatchEvent(new Event('input',{bubbles:true}));};
        window.press=key=>document.getElementById('dcInput').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
        ${read('frontend/js/home/dragon-claw.js')}
        void 0;
    `);
    const waitFor=expression=>win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})resolve();else if(++n>100)reject(new Error(${JSON.stringify(expression)}));else setTimeout(poll,20)};poll()})`);
    await evaluate(()=>{typeText('/co');press('Enter')});
    assert.equal(await evaluate(()=>compactCalls.length),0);
    assert.match(await evaluate(()=>document.getElementById('dcToast').textContent),/先开始/);
    for(let i=0;i<3;i++){
        await win.webContents.executeJavaScript(`typeText('question ${i}');press('Enter')`);
        await waitFor(`calls.length===${i+1} && !document.querySelector('.dc-composer.is-generating')`);
    }
    const count=await evaluate(()=>document.querySelectorAll('.dc-msg').length);
    await evaluate(()=>{typeText('/');});
    assert.ok((await evaluate(()=>document.getElementById('dcSlashMenu').textContent)).includes('/compact'));
    await evaluate(()=>{typeText('/compact ');});
    assert.equal(await evaluate(()=>document.getElementById('dcSlashMenu').hidden),true,'a space after the command closes the hint');
    await evaluate(()=>{typeText('/comp');press('Tab')});
    assert.equal(await evaluate(()=>document.getElementById('dcInput').value),'/compact ');
    assert.equal(await evaluate(()=>document.getElementById('dcSlashMenu').hidden),true,'Tab completion closes the hint');
    await evaluate(()=>{typeText('/compact');press('Enter')});
    assert.equal(await evaluate(()=>document.getElementById('dcInput').disabled),true);
    assert.equal(await evaluate(()=>calls.length),3,'a slash command never becomes a model question');
    assert.equal(await evaluate(()=>compactCalls[0].sessionId),'chat-A');
    await evaluate(()=>finishCompact({performed:true,agentSessionId:'agent-A',root:'/fixture'}));
    await waitFor("!document.getElementById('dcInput').disabled");
    assert.equal(await evaluate(()=>document.querySelectorAll('.dc-msg').length),count,'visible history is retained');
    assert.equal(await evaluate(()=>applied.length),1);
    assert.match(await evaluate(()=>document.getElementById('dcThread').textContent),/上下文已压缩/);
    await evaluate(()=>{typeText('continue');press('Enter')});
    await waitFor("calls.length===4 && !document.querySelector('.dc-composer.is-generating')");
    assert.equal(await evaluate(()=>calls.at(-1).messages.length),3,'client also stops resending old messages');
    await evaluate(()=>{typeText('/compact');press('Enter')});
    await evaluate(()=>finishCompact({error:'provider unavailable'},false));
    await waitFor("!document.getElementById('dcInput').disabled");
    assert.match(await evaluate(()=>document.getElementById('dcThread').textContent),/provider unavailable/);
    await evaluate(()=>{typeText('/compact');press('Enter');document.getElementById('dcSend').click()});
    await waitFor("!document.getElementById('dcInput').disabled");
    assert.doesNotMatch(await evaluate(()=>document.getElementById('dcThread').textContent),/正在压缩上下文/);
    await evaluate(()=>{typeText('/compact');press('Enter');document.getElementById('dcNewChat').click();chatId='chat-B';});
    await evaluate(()=>finishCompact({performed:true}));
    await waitFor("!document.getElementById('dcInput').disabled");
    assert.equal(await evaluate(()=>document.getElementById('dcThread').textContent),'','late compact results cannot pollute a new chat');
    await evaluate(()=>{locale='en-US';window.dispatchEvent(new Event('tools:languagechange'));typeText('new question');press('Enter')});
    await waitFor("calls.length===5 && !document.querySelector('.dc-composer.is-generating')");
    await evaluate(()=>{typeText('/compress');press('Enter')});
    await evaluate(()=>finishCompact({performed:false,reason:'no-compressible-messages'}));
    await waitFor("!document.getElementById('dcInput').disabled");
    assert.match(await evaluate(()=>document.getElementById('dcThread').textContent),/already compact/);
    process.stdout.write('PASS: /compact menu/keyboard, empty chat, progress/stop, preserved history, reduced payload, failure, stale/new chat isolation, English and /compress alias.\n');
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);if(win&&!win.isDestroyed())win.destroy();server?.close();app.exit(1)});
