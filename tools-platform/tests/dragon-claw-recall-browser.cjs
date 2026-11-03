// Run: node_modules/.bin/electron tests/dragon-claw-recall-browser.cjs
// ↑ / ↓ in an empty composer recalls recent questions: the current conversation's last 5, or in a new chat
// the last 5 of the most recent plain conversation (no connector, no multi-agent discussion). Isolated profile.
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'dragon-recall-ui-'));
app.setPath('userData',path.join(temp,'profile'));
app.disableHardwareAcceleration();
setTimeout(()=>{console.error('Recall UI timed out');app.exit(1);},60000).unref();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const home=read('frontend/index.html'),start=home.indexOf('<section class="dc"');
const section=home.slice(start,home.indexOf('</section>',start)+10);
let win,server;
const evaluate=fn=>win.webContents.executeJavaScript(`(${fn.toString()})()`,true);
app.whenReady().then(async()=>{
    server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url.startsWith('/api/')?'application/json':'text/html; charset=utf-8');res.end(req.url.startsWith('/api/')?JSON.stringify({models:[],items:[]}):`<style>${read('frontend/css/dragon-claw.css')}body{background:#101b30;margin:0;font-family:system-ui}.dc{--navbar-h:0px;margin:20px}.dc-quick,.dc-scroll-hint{display:none}</style>${section}`);}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on('console-message',(_,level,message)=>{if(level===3)console.error('Renderer:',message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await win.webContents.executeJavaScript(`
        localStorage.setItem('tools_token','t');
        window.calls=[];window.messageFetches=[];
        window.ToolsI18n={getLanguage:()=>'zh-CN'};window.HomeWorkspace={getTools:()=>[]};
        window.ToolsAIAssistant={requestStreamingChat:async(payload,handlers)=>{
            calls.push(payload);handlers.onEvent({type:'start',sessionId:'chat-live'});
            handlers.onDelta('ok');return {sessionId:'chat-live',reply:'ok'};
        }};
        const user=(content,events=[])=>({role:'user',content,events});
        const sessions={
            's-conn':[user('带连接器的问题',[{type:'connector',id:'erp'}]),{role:'model',content:'a',events:[]}],
            's-group':[user('讨论组问题')],
            's-plain':['q1','q2','q3','q2','q4','q5','q6'].map(text=>user(text))
        };
        const nativeFetch=window.fetch.bind(window);
        const json=data=>Promise.resolve({ok:true,status:200,json:async()=>data});
        window.fetch=(url,options={})=>{
            url=String(url);
            if(url.startsWith('/api/ai/sessions?'))return json({items:[{id:'s-conn',updatedAt:3},{id:'s-group',discussionMode:'group',updatedAt:2},{id:'s-plain',updatedAt:1}]});
            const m=url.match(/^\\/api\\/ai\\/sessions\\/([^/]+)\\/messages/);
            if(m){messageFetches.push(m[1]);return json({items:sessions[decodeURIComponent(m[1])]||[]});}
            if(url.startsWith('/api/'))return json({items:[]});
            return nativeFetch(url,options);
        };
        window.typeText=value=>{const input=document.getElementById('dcInput');input.value=value;input.setSelectionRange(value.length,value.length);input.dispatchEvent(new Event('input',{bubbles:true}));};
        window.press=key=>document.getElementById('dcInput').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
        ${read('frontend/js/home/dragon-claw.js')}
        void 0;
    `);
    const waitFor=expression=>win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})resolve();else if(++n>150)reject(new Error(${JSON.stringify(expression)}));else setTimeout(poll,20)};poll()})`);
    const menu=()=>evaluate(()=>{const m=document.getElementById('dcSlashMenu');return {open:!m.hidden,items:[...m.querySelectorAll('[data-dc-recall]')].map(n=>n.textContent),active:[...m.querySelectorAll('[data-dc-recall]')].findIndex(n=>n.classList.contains('is-active'))};});
    const value=()=>evaluate(()=>document.getElementById('dcInput').value);

    // New chat: the latest plain conversation's last 5 distinct questions, newest first; connector / group chats skipped.
    await evaluate(()=>press('ArrowUp'));
    await waitFor(`!document.getElementById('dcSlashMenu').hidden && document.querySelector('[data-dc-recall]')`);
    let m=await menu();
    assert.deepEqual(m.items,['q6','q5','q4','q2','q3']);
    assert.equal(m.active,0,'↑ starts at the most recent');
    assert.ok(await evaluate(()=>!messageFetches.includes('s-group')),'group discussions are not even fetched');
    assert.match(await evaluate(()=>document.getElementById('dcSlashMenu').textContent),/最近的问题[\s\S]*Enter 填入/);
    fs.writeFileSync(path.join(temp,'recall-new-chat.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate(()=>press('ArrowDown'));
    assert.equal((await menu()).active,1);
    await evaluate(()=>press('Enter'));
    assert.equal(await value(),'q5','Enter fills the question');
    assert.equal((await menu()).open,false);
    assert.equal(await evaluate(()=>calls.length),0,'filling never sends');

    // ↓ starts at the oldest; Esc closes without changing the input.
    await evaluate(()=>typeText(''));
    await evaluate(()=>press('ArrowDown'));
    await waitFor(`document.querySelector('[data-dc-recall]')`);
    assert.equal((await menu()).active,4);
    await evaluate(()=>press('Escape'));
    assert.equal((await menu()).open,false);assert.equal(await value(),'');

    // With text in the box the arrows stay ordinary caret keys.
    await evaluate(()=>{typeText('已有内容');press('ArrowUp');});
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal((await menu()).open,false);

    // In a conversation: only this conversation's own questions.
    for (const q of ['第一个问题','第二个问题','第三个问题']) {
        await evaluate(new Function(`typeText(${JSON.stringify(q)});press('Enter');`));
        await waitFor(`!document.getElementById('dcInput').value`);
        await new Promise(resolve=>setTimeout(resolve,80));
    }
    await waitFor('calls.length===3');
    await evaluate(()=>press('ArrowUp'));
    await waitFor(`document.querySelector('[data-dc-recall]')`);
    m=await menu();
    assert.deepEqual(m.items,['第三个问题','第二个问题','第一个问题']);
    fs.writeFileSync(path.join(temp,'recall-conversation.png'),(await win.webContents.capturePage()).toPNG());
    // Clicking an entry fills it too.
    await evaluate(()=>document.querySelector('[data-dc-recall="1"]').click());
    assert.equal(await value(),'第二个问题');
    assert.equal(await evaluate(()=>calls.length),3);
    console.log('PASS: empty composer ↑/↓ recalls recent questions — new chat uses the latest plain conversation (connector/group skipped), a conversation uses its own; ↑ newest first, ↓ oldest first, Enter/click fill without sending, Esc closes, typed text keeps normal arrows. Screenshots: '+temp);
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1);});
