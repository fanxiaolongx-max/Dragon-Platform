// Real launcher/editor UI with local HTTP fixtures; no installed apps or business data.
// Run with Playwright on NODE_PATH (set PLAYWRIGHT_CHANNEL=chrome for local Chrome).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const source = '<!doctype html>\n<html>\n<head>\n<style>\n/* toolbar */\n:root { --navbar-h:0px; --font:"Segoe UI"; }\nbody { color:#a5d6ff; margin:12px; }\n</style>\n</head>\n<body>\n<script>\n'
    + Array.from({length: 760}, (_, i) => `const value${i} = ${i}; // 中文注释与 HTML <tag> 字符`).join('\n')
    + '\n</script>\n<img src=x onerror="window.__sourceExecuted=true">\n</body>\n</html>\n';
const errors = [];
let strictContract=false, deploymentCalls=0;
const deploymentSql='CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY);\n'+('-- <img src=x onerror=alert(1)> preview only\n'.repeat(180));
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/launcher') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html><head><link rel="stylesheet" href="/css/hosted-app-launcher.css"></head><body data-hosted-app="fixture"><script src="/js/shared/app-dialog.js"></script><script src="/js/shared/ide-highlighter.js"></script><script src="/js/hosted-app-launcher.js"></script></body></html>');
    } else if (url.pathname === '/app-fixture') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<style>body{margin:0}header{height:52px;background:#102b47;display:flex;justify-content:flex-end;align-items:center}button{margin-right:8px;height:32px}</style><header><button id="save" onclick="this.textContent=\'已保存\'">保存</button></header>');
    } else if (url.pathname.endsWith('/launch')) json({app:{status:'running',isAdmin:true,name:'Fixture',entryUrl:'/app-fixture',databaseContract:strictContract?'digital-human':'platform'}});
    else if (url.pathname.endsWith('/database-script')) {
        if(req.method==='POST'){deploymentCalls++;json({success:true,deployment:{skipped:false}});}
        else json({script:{kind:url.searchParams.get('kind'),file:'db/'+url.searchParams.get('kind')+'.sqlite.sql',hash:'fixture-hash',sql:deploymentSql,applied:false}});
    }
    else if (url.pathname.endsWith('/editor/tree')) json({tree:[{name:'index.html',path:'static/index.html',isDir:false,isBinary:false}]});
    else if (url.pathname.endsWith('/editor/git/status')) json({status:{branch:'main',clean:true}});
    else if (url.pathname.endsWith('/editor/file')) json({file:{path:'static/index.html',name:'index.html',ext:'html',content:source,isBinary:false}});
    else {
        const file = path.resolve(root, 'frontend' + url.pathname);
        if (!file.startsWith(path.join(root,'frontend') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode=404; res.end(); return; }
        res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');
        res.end(fs.readFileSync(file));
    }
});
let browser;
(async () => {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
    const page = await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.goto('http://127.0.0.1:'+server.address().port+'/launcher');
    await page.locator('#haBar:not([hidden])').waitFor();
    const app = page.frameLocator('.ha-frame');
    await app.locator('#save').click();
    await app.locator('#save').filter({hasText:'已保存'}).waitFor();
    assert.equal(await app.locator('#save').innerText(),'已保存','Save must remain directly clickable');
    assert.equal(await page.locator('#haMenu').isVisible(),false);
    for (const [width,height] of [[1280,800],[390,640]]) {
        await page.setViewportSize({width,height});
        for (const theme of ['dark','light']) {
            await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
            const pill = await page.locator('#haPill').boundingBox();
            assert(pill.y>=64 && pill.y+pill.height<height,'Runtime indicator must sit below the application toolbar');
        }
    }
    await page.setViewportSize({width:1280,height:800});
    const runtimeButton=await page.locator('#haPill').boundingBox();
    await page.mouse.click(Math.min(runtimeButton.x+runtimeButton.width/2,1268),runtimeButton.y+runtimeButton.height/2);
    await page.locator('#haMenu [data-action="ide"]').click();
    await page.locator('[data-tree-path="static/index.html"]').click();
    await page.waitForFunction(() => document.querySelector('#haIdeCode .tok-tag'));
    assert.equal(await page.locator('#haIdeLanguage').innerText(),'HTML');
    assert.equal(await page.locator('#haIdeTextarea').inputValue(),source);
    assert.equal(await page.locator('#haIdeCode').textContent(),source+'\n');
    assert(await page.locator('#haIdeCode .tok-keyword').count()>700,'Embedded JavaScript must retain its highlights');
    assert(await page.locator('#haIdeCode .tok-number').count()>700,'CSS and JavaScript numbers must be highlighted');
    assert.equal(await page.locator('#haIdeCode img').count(),0,'Source markup must remain inert');
    assert.equal(await page.evaluate(() => window.__sourceExecuted),undefined);
    const colors = await page.evaluate(() => ['.tok-tag','.tok-keyword','.tok-number'].map(selector => getComputedStyle(document.querySelector('#haIdeCode '+selector)).color));
    assert(new Set(colors).size>=2,'Highlight colors must be visible');
    await page.locator('#haIdeTextarea').evaluate(el => { el.scrollTop=12000; el.scrollLeft=80; el.dispatchEvent(new Event('scroll')); });
    assert.deepEqual(await page.evaluate(() => {
        const input=document.getElementById('haIdeTextarea'), pre=document.getElementById('haIdePre');
        return [pre.scrollTop,pre.scrollLeft,input.scrollTop,input.scrollLeft];
    }),[12000,0,12000,0]);
    const edited=source.replace('--navbar-h:0px','--navbar-h:8px');
    await page.locator('#haIdeTextarea').focus();
    await page.locator('#haIdeTextarea').evaluate(el => { const at=el.value.indexOf('0px'); el.setSelectionRange(at,at+1); });
    await page.keyboard.insertText('8');
    assert.equal(await page.locator('#haIdeCode').textContent(),edited+'\n');
    assert(await page.locator('#haIdeCode .tok-tag').count()>0);
    strictContract=true;
    await page.goto('http://127.0.0.1:'+server.address().port+'/launcher');
    await page.locator('#haBar:not([hidden])').waitFor();
    const clickRuntime=async()=>{const r=await page.locator('#haPill').boundingBox();const width=page.viewportSize().width;await page.mouse.click(Math.min(r.x+r.width/2,width-12),r.y+r.height/2);};
    await clickRuntime();
    await page.locator('[data-action="schema-init"]').click();
    await page.locator('.app-dialog-details').waitFor();
    assert.equal(await page.locator('.app-dialog-details').textContent(),deploymentSql);
    assert.equal(await page.locator('.app-dialog-details img').count(),0);
    await page.setViewportSize({width:390,height:640});
    const preview=await page.locator('.app-dialog-card').boundingBox();
    assert(preview.x>=0 && preview.x+preview.width<=391 && preview.y>=0 && preview.y+preview.height<=641,'SQL preview must fit narrow screens');
    await page.locator('[data-dialog="cancel"]').click();
    assert.equal(deploymentCalls,0,'Cancel must not execute deployment');
    await page.locator('.app-dialog').waitFor({state:'detached'});
    await page.setViewportSize({width:1280,height:800});
    await clickRuntime(); await page.locator('[data-action="schema-upgrade"]').click();
    await page.locator('[data-dialog="ok"]').click();
    await page.waitForFunction(()=>!document.querySelector('.app-dialog.open'));
    assert.equal(deploymentCalls,1,'Explicit confirmation must execute deployment once');
    if(process.env.HOSTED_EDITOR_SCREENSHOT) await page.screenshot({path:process.env.HOSTED_EDITOR_SCREENSHOT});
    assert.deepEqual(errors,[]);
    console.log('PASS: long HTML with embedded CSS/JavaScript keeps highlighting and source alignment; editing, scrolling, dark/light and narrow-screen indicator position and explicit SQL deployment preview/cancel/confirm verified.');
})().catch(error => { console.error(String(error).split('Call log:')[0]); process.exitCode=1; }).finally(async () => { await browser?.close(); server.close(); });
