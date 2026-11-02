// node_modules/.bin/electron tests/login-footer-dialogs-browser.cjs
// Real login DOM/CSS and real local test video; no authentication or external media requests.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const express = require('express'), { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'login-footer-dialogs-'));
app.setPath('userData', path.join(temp,'profile')); app.disableHardwareAcceleration();
const media = path.join(temp,'fixture.mp4');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x172431:s=640x360:r=12','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',media]);
let win, server, videoRequests = 0, failVideo = false, newWindows = 0;
const evaluate = code => win.webContents.executeJavaScript(`(()=>eval(${JSON.stringify(code)}))()`,true);
const until = code => evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${code})resolve();else if(++n>250)reject(new Error(${JSON.stringify(code)}));else setTimeout(poll,20)};poll()})`);
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function capture(name) { await evaluate(`document.getAnimations().forEach(animation=>{try{animation.finish()}catch{}})`); await wait(250); fs.writeFileSync(path.join(temp,name+'.png'),(await win.webContents.capturePage()).toPNG()); }
async function open(kind) { await evaluate(`const link=document.querySelector('.footer-links a[onclick*="${kind}"]');link.focus();link.click();`); await until('legalModal.classList.contains("open")'); }
setTimeout(()=>app.exit(1),60000).unref();
app.whenReady().then(async()=>{
    const web=express();
    web.get(['/','/login.html'],(_,res)=>res.type('html').send(fs.readFileSync(path.join(root,'frontend/pages/login.html'),'utf8').replace('<head>',`<head><script>localStorage.setItem('tools_lang','zh-CN');window.fixtureErrors=[];window.addEventListener('error',e=>fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));</script>`)));
    web.get('/api/app-version',(_,res)=>res.json({version:'fixture'}));
    web.get('/api/platform-identity',(_,res)=>res.json({platformName:'Dragon 工具平台',platformNameEn:'Dragon Platform'}));
    web.use('/api',(_,res)=>res.json({}));
    web.get('/assets/promotions/project-evolution-galaxy-hd.mp4',(_,res)=>{videoRequests++;res.setHeader('Cache-Control','no-store');if(failVideo)return res.status(503).end();res.sendFile(media,{cacheControl:false})});
    web.use(express.static(path.join(root,'frontend')));
    server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener))});
    win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !/503|ERR_ABORTED/.test(message)) console.log(message); });
    win.webContents.setWindowOpenHandler(()=>{newWindows++;return {action:'deny'}});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/login.html`);
    await until('!!window.ProjectEvolutionPlayer');
    assert.equal(videoRequests,0,'login never preloads the video');
    const pageUrl=win.webContents.getURL();
    for(const kind of ['privacy','terms']){
        await open(kind);
        assert.equal(await evaluate('document.body.style.overflow'),'hidden');
        assert.equal(await evaluate('document.querySelector(".login-wrapper").inert'),true);
        const style=await evaluate(`(()=>{const title=getComputedStyle(legalModalTitle),body=getComputedStyle(legalModalBody),heading=getComputedStyle(legalModalBody.querySelector('h2'));return {title:title.webkitTextFillColor,body:body.color,heading:heading.color,scrolls:legalModalBody.scrollHeight>legalModalBody.clientHeight}})()`);
        assert.equal(style.title,'rgb(31, 35, 40)'); assert.equal(style.body,'rgb(75, 85, 99)');assert.equal(style.heading,'rgb(31, 35, 40)');assert.equal(style.scrolls,true);
        await capture(kind+'-light');
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));`);
        assert.equal(await evaluate('legalModal.contains(document.activeElement)'),true);
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`);
        assert.equal(await evaluate('legalModal.getAttribute("aria-hidden")'),'true');
        assert.equal(await evaluate('document.querySelector(".login-wrapper").inert'),false);
        assert.equal(await evaluate(`document.activeElement.matches('.footer-links a[onclick*="${kind}"]')`),true);
    }
    await open('evolution');
    await until('!!document.querySelector(".legal-video-player video")&&document.querySelector(".legal-video-player video").currentTime>0');
    assert.equal(win.webContents.getURL(),pageUrl);assert.equal(newWindows,0);
    assert.equal(await evaluate('legalModalTitle.textContent'),'项目演进');
    await capture('evolution-light');
    await evaluate(`window.closedVideo=document.querySelector('.legal-video-player video');ToolsI18n.setLanguage('en-US');`);
    assert.equal(await evaluate('legalModalTitle.textContent'),'Project evolution');
    assert.equal(await evaluate('document.title.includes("Sign In")'),true,'video dialog preserves login page title');
    await evaluate(`document.querySelector('.legal-close').click()`);
    assert.equal(await evaluate('closedVideo.paused&&!closedVideo.isConnected'),true,'close stops playback and releases the player');
    assert.equal(await evaluate('!!document.querySelector(".legal-video-player source")'),false);
    await win.webContents.session.clearCache();
    failVideo=true; await open('evolution');
    // Use a fresh URL so Chromium's decoded media cache cannot reuse the previous successful clip.
    await evaluate(`const video=document.querySelector('.legal-video-player video');video.querySelector('source').src+='?fixture=failed';video.load();`);
    try { await until('!document.querySelector(".legal-video-status").hidden&&!document.querySelector(".legal-video-status button").hidden'); }
    catch(error) { console.log({videoRequests,failVideo,details:await evaluate(`(()=>{const video=document.querySelector('.legal-video-player video');return {html:document.querySelector('.legal-video-status').outerHTML,time:video.currentTime,src:video.currentSrc,ready:video.readyState,error:video.error?.code}})()`)});throw error; }
    assert.equal(await evaluate('document.querySelector(".legal-video-status button").textContent'),'Retry');
    failVideo=false;
    await evaluate(`document.querySelector('.legal-video-status button').click()`);
    await until('document.querySelector(".legal-video-player video").currentTime>0');
    await evaluate('legalModal.click()');
    assert.equal(await evaluate('legalModal.classList.contains("open")'),false,'backdrop dismisses');
    for(const [width,theme,language] of [[1280,'dark','zh-CN'],[390,'light','en-US']]){
        win.setContentSize(width,900);await until(`innerWidth===${width}`);
        await evaluate(`document.documentElement.dataset.theme='${theme}';ToolsI18n.setLanguage('${language}');`);
        for(const kind of ['privacy','evolution']){
            await open(kind);
            const box=await evaluate(`(()=>{const r=document.querySelector('.legal-dialog').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
            assert.ok(box.x>=0&&box.y>=0&&box.right<=box.w&&box.bottom<=box.h,JSON.stringify(box));assert.equal(box.overflow,false);
            await capture(`${kind}-${width}-${theme}`);
            await evaluate('closeLegalModal()');
        }
    }
    assert.deepEqual(await evaluate('fixtureErrors'),[]);
    console.log('PASS: three matching footer dialogs; readable legal content; real inline video playback/retry; no new window or login preload; Escape/backdrop/focus/scroll restoration; dark/light, language change and 390px. Screenshots: '+temp);
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
