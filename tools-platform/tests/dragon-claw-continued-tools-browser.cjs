// Run: node_modules/.bin/electron tests/dragon-claw-continued-tools-browser.cjs
// A continued AI reply's hover bar (model · tok/s · rounds) sits just below the hovered line near the pointer,
// never over that line, and is translucent. Real Chromium layout, isolated profile, no network.
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'dragon-continued-tools-'));
app.setPath('userData',path.join(temp,'profile'));
app.disableHardwareAcceleration();
setTimeout(()=>{console.error('Continued tools UI timed out');app.exit(1);},30000).unref();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const home=read('frontend/index.html'),start=home.indexOf('<section class="dc"');
const section=home.slice(start,home.indexOf('</section>',start)+10);
let win,server;
app.whenReady().then(async()=>{
    server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url.startsWith('/api/')?'application/json':'text/html; charset=utf-8');res.end(req.url.startsWith('/api/')?JSON.stringify({models:[],items:[]}):`<style>${read('frontend/css/dragon-claw.css')}${read('frontend/css/desktop-agents.css')}body{background:#101b30;margin:0;font-family:system-ui}.dc{--navbar-h:0px;margin:20px}.dc-quick,.dc-scroll-hint{display:none}</style>${section}`);}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await win.webContents.executeJavaScript(`
        localStorage.setItem('tools_token','t');
        window.ToolsI18n={getLanguage:()=>'zh-CN'};window.HomeWorkspace={getTools:()=>[]};
        ${read('frontend/js/home/dragon-claw.js')}
        // Two consecutive AI replies; the first carries the floating tools bar.
        const thread=document.getElementById('dcThread');
        document.querySelector('.dc').classList.add('is-chatting');document.body.classList.add('dc-chatting');
        thread.innerHTML='<div class="dc-msg dc-msg--ai is-continued" id="m1"><div class="dc-msg-body"><p id="para">'+'第一行到第三行的长段落内容，用来确认悬浮条不会挡住鼠标所在的这一行。'.repeat(6)+'</p></div><div class="dc-msg-tools"><button type="button" class="dc-msg-copy">复制</button><span class="dc-msg-model">claude-opus-5-5</span><span class="dc-msg-speed">49.9/83.9/91.7 tok/s · 15 轮</span></div></div><div class="dc-msg dc-msg--ai"><div class="dc-msg-body">下一条回复</div></div>';
        void 0;
    `);
    const evaluate=code=>win.webContents.executeJavaScript(code,true);
    await win.webContents.debugger.attach('1.3');
    const move=(x,y)=>win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await new Promise(resolve=>setTimeout(resolve,700)); // let the message entrance animation settle
    // Hover the second visual line of the paragraph.
    const lines=await evaluate(`(()=>{const r=document.createRange();r.selectNodeContents(document.getElementById('para'));const rows=[];for(const rect of r.getClientRects()){if(!rows.length||Math.abs(rows.at(-1).top-rect.top)>2)rows.push({top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right});}return rows})()`);
    assert.ok(lines.length >= 3, 'paragraph wraps onto several lines: '+lines.length);
    const line=lines[1],x=Math.round(line.left+(line.right-line.left)*0.6),y=Math.round((line.top+line.bottom)/2);
    await move(x-20,y);await move(x,y);await new Promise(resolve=>setTimeout(resolve,250));
    const bar=await evaluate(`(()=>{const t=document.querySelector('#m1 .dc-msg-tools');const r=t.getBoundingClientRect();const s=getComputedStyle(t);return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,opacity:+s.opacity,bg:s.backgroundColor,blur:s.backdropFilter}})()`);
    assert.equal(bar.opacity, 1, 'visible on hover');
    assert.ok(bar.top >= line.bottom && bar.top <= line.bottom + 8, 'just below the hovered line '+JSON.stringify({bar,line}));
    assert.ok(bar.left <= x && bar.right >= x, 'under the pointer horizontally '+JSON.stringify({bar,x}));
    const alpha=Number((bar.bg.match(/rgba?\(([^)]+)\)/)?.[1]||'').split(',')[3]);
    assert.ok(alpha > 0.5 && alpha < 0.85, 'translucent background '+bar.bg);
    assert.match(bar.blur, /blur/);
    fs.writeFileSync(path.join(temp,'continued-tools.png'),(await win.webContents.capturePage()).toPNG());
    // Moving down onto the bar keeps it still so its buttons can be clicked.
    await move(x,Math.round((bar.top+bar.bottom)/2));await new Promise(resolve=>setTimeout(resolve,150));
    const after=await evaluate(`document.querySelector('#m1 .dc-msg-tools').getBoundingClientRect().top`);
    assert.equal(after, bar.top, 'bar stays put once the pointer is on it');
    // Hovering the first line moves it below that line instead.
    const first=lines[0];
    await move(x,Math.round((first.top+first.bottom)/2));await new Promise(resolve=>setTimeout(resolve,150));
    const top=await evaluate(`document.querySelector('#m1 .dc-msg-tools').getBoundingClientRect().top`);
    assert.ok(top >= first.bottom && top <= first.bottom + 8, 'follows to the first line');
    console.log('PASS: continued reply hover bar sits just below the hovered line near the pointer, never over it, translucent with blur, and stays put when the pointer reaches it. Screenshot: '+temp);
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1);});
