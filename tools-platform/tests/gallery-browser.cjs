// Real UI and gallery routes, isolated SQLite data; no external AI calls or production data.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'picture-island-browser-'));
process.env.TOOLS_DATA_DIR = path.join(root, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(root, 'reports');
app.setPath('userData', path.join(root, 'profile'));
app.disableHardwareAcceleration();
const express = require('express');
const { runWithTenant } = require('../backend/models/tenant-context');
const i18n = require('../backend/models/custom-tool-i18n-service');
const toolDir = path.join(__dirname, '../backend/builtin-tools/picture-island');
let win, server, role = 'admin';
const errors = [];
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description) {
    for (let i = 0; i < 300; i++) { if (await evaluate(fn)) return; await wait(40); }
    throw new Error('Timed out: ' + description);
}
async function screenshots(name) { win.webContents.invalidate(); await win.webContents.capturePage(); await wait(160); const target = path.join(root, name + '.png'); fs.writeFileSync(target, (await win.webContents.capturePage()).toPNG()); console.log('Screenshot: ' + target); }
async function prepareFiles(names) {
    await evaluate(names => {
        const transfer = new DataTransfer();
        names.forEach((name, index) => {
            const c = document.createElement('canvas'); c.width = 720; c.height = 960;
            const ctx = c.getContext('2d'); ctx.fillStyle = index ? '#e6e9b7' : '#dcd5fa'; ctx.fillRect(0, 0, 720, 960);
            ctx.fillStyle = '#333148'; ctx.font = '18px sans-serif'; ctx.fillText('PICTURE ISLAND / DESIGN ARCHIVE', 55, 80);
            ctx.font = 'bold 88px sans-serif'; ctx.fillText('AUTUMN', 50, 230); ctx.fillText(index ? 'REVISED.' : 'IN BLOOM.', 50, 330);
            ctx.beginPath(); ctx.arc(index ? 410 : 360, 580, 175, 0, Math.PI * 2); ctx.fillStyle = index ? '#6c7860' : '#7563c5'; ctx.fill();
            ctx.fillStyle = '#333148'; ctx.font = '25px sans-serif'; ctx.fillText('10.30 — 11.20 / A SEASON TO REMEMBER', 55, 865);
            const mime = name.endsWith('.webp') ? 'image/webp' : 'image/png';
            const bytes = Uint8Array.from(atob(c.toDataURL(mime).split(',')[1]), ch => ch.charCodeAt(0));
            transfer.items.add(new File([bytes], name, { type: mime }));
        });
        document.getElementById('files').files = transfer.files; document.getElementById('files').dispatchEvent(new Event('change'));
    }, names);
}
async function downloadedBy(action) {
    const completed = new Promise((resolve, reject) => win.webContents.session.once('will-download', (_event,item) => {
        const target = path.join(root,item.getFilename()); item.setSavePath(target);
        item.once('done', (_event,state) => state === 'completed' ? resolve(fs.readFileSync(target)) : reject(new Error('Download '+state)));
    }));
    await action(); return completed;
}
const timeout = setTimeout(() => { console.error('Browser test timed out'); app.exit(1); }, 90000);
app.whenReady().then(async () => {
    const web = express(); web.use(express.json());
    web.use((req, _res, next) => { req.user = { username:'fixture', role }; runWithTenant('default', next); });
    web.use('/api/gallery', require('../backend/routes/gallery'));
    web.get('/custom-tools/picture-island/index.html', (_req,res) => res.type('html').send(i18n.injectLanguageRuntime(fs.readFileSync(path.join(toolDir,'index.html'),'utf8'),'picture-island')));
    web.use('/custom-tools/picture-island', express.static(toolDir));
    web.use(express.static(path.join(__dirname,'../frontend')));
    web.use('/api', (_req,res) => res.json({}));
    web.use((err,_req,res,_next) => res.status(500).json({ error:err.message }));
    server = await new Promise(resolve => { const listening = web.listen(0,'127.0.0.1',()=>resolve(listening)); });
    win = new BrowserWindow({ show:false,width:1440,height:1080,webPreferences:{ contextIsolation:true,nodeIntegration:false,backgroundThrottling:false } });
    win.webContents.on('console-message', (_event,level,message) => { if (level>=3) errors.push(message); });
    const url = `http://127.0.0.1:${server.address().port}/custom-tools/picture-island/index.html`;
    await win.webContents.session.cookies.set({ url, name:'tools_token', value:'fixture-session' });
    await win.loadURL(url);
    await evaluate(()=>{ localStorage.setItem('picture_island_theme','light'); });
    await win.loadURL(url);
    await until(()=>!document.getElementById('emptyUpload').hidden,'empty library ready');
    await evaluate(()=>document.getElementById('uploadButton').click());
    await prepareFiles(['海报初稿.png','海报定稿.png']);
    await evaluate(()=>{ document.getElementById('uploadTarget').value='new-series'; document.getElementById('uploadTarget').dispatchEvent(new Event('change')); document.getElementById('seriesTitle').value='秋日海报'; document.getElementById('uploadCategory').value='posters'; document.getElementById('uploadForm').requestSubmit(); });
    await until(()=>!document.getElementById('uploadDialog').open,'batch upload completed');
    assert.equal(await evaluate(()=>document.querySelectorAll('.card').length),1);
    assert.match(await evaluate(()=>document.querySelector('.version-badge').textContent),/^2/);
    await screenshots('desktop-light');
    await evaluate(()=>document.querySelector('[data-open]').click());
    await until(()=>document.getElementById('detailDialog').open,'detail open');
    assert.equal(await evaluate(()=>document.getElementById('applyAi').hidden),true,'pending AI results cannot be applied');
    await evaluate(()=>{ document.getElementById('viewMode').value='side'; document.getElementById('viewMode').dispatchEvent(new Event('change')); });
    assert.equal(await evaluate(()=>document.getElementById('figureB').hidden),false);
    assert.notEqual(await evaluate(()=>document.getElementById('versionA').value),await evaluate(()=>document.getElementById('versionB').value));
    await screenshots('desktop-comparison');
    await evaluate(()=>{ document.getElementById('viewMode').value='overlay'; document.getElementById('viewMode').dispatchEvent(new Event('change')); document.getElementById('opacity').value='25'; document.getElementById('opacity').dispatchEvent(new Event('input')); });
    assert.equal(await evaluate(()=>document.getElementById('figureB').style.opacity),'0.25');
    await evaluate(()=>document.getElementById('detailNewCategory').click());
    await evaluate(()=>{ document.getElementById('categoryName').value='年度活动'; document.getElementById('categoryForm').requestSubmit(); });
    await until(()=>!document.getElementById('categoryDialog').open,'category created');
    await evaluate(()=>{ document.getElementById('metaTags').value='秋天,品牌'; document.getElementById('metaNote').value='客户已确认定稿'; document.getElementById('metaForm').requestSubmit(); });
    await until(()=>document.getElementById('toast').textContent==='已保存','metadata saved');
    await evaluate(()=>document.getElementById('favorite').click());
    await until(()=>document.getElementById('favorite').textContent.includes('已收藏'),'favorite saved');
    const original = await downloadedBy(()=>evaluate(()=>document.getElementById('downloadOriginal').click()));
    assert.equal(original.subarray(1,4).toString(),'PNG');
    await evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
    const compressed = await downloadedBy(()=>evaluate(()=>document.getElementById('share').click()));
    assert.equal(compressed[0],255); assert.equal(compressed[1],216);
    await evaluate(()=>document.getElementById('detailDialog').close());
    await evaluate(()=>document.getElementById('uploadButton').click());
    await prepareFiles(['餐厅菜单.webp']);
    await evaluate(()=>{document.getElementById('uploadScope').value='life';document.getElementById('uploadCategory').value='menus';document.getElementById('uploadForm').requestSubmit();});
    await until(()=>!document.getElementById('uploadDialog').open,'WebP original and generated raster uploaded');
    assert.equal(await evaluate(()=>document.querySelectorAll('.card').length),2);
    await evaluate(()=>{ document.getElementById('search').value='客户已确认'; document.getElementById('search').dispatchEvent(new Event('input')); });
    await until(()=>document.querySelectorAll('.card').length===1 && document.getElementById('resultCount').textContent.includes('1'),'notes searchable');
    await evaluate(()=>{ document.getElementById('language').click(); document.getElementById('theme').click(); });
    await until(()=>document.getElementById('viewTitle').textContent==='All pictures','platform language runtime integration');
    assert.equal(await evaluate(()=>document.documentElement.dataset.theme),'dark');
    win.setSize(390,844); await wait(180);
    assert.ok(await evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page has no horizontal overflow');
    await screenshots('mobile-dark-english');
    await evaluate(()=>document.querySelector('[data-open]').click());
    await until(()=>document.getElementById('detailDialog').open,'mobile detail');
    assert.ok(await evaluate(()=>{ const d=document.getElementById('detailDialog'); return d.scrollWidth<=d.clientWidth+1; }),'mobile dialog has no horizontal overflow');
    await screenshots('mobile-detail');
    await evaluate(()=>{ document.getElementById('detailDialog').close(); document.getElementById('language').click(); });
    await until(()=>document.getElementById('viewTitle').textContent==='全部图片','switch back to Chinese');
    role='viewer'; await win.loadURL(url);
    await until(()=>document.querySelectorAll('.card').length===2,'reader view loaded');
    assert.equal(await evaluate(()=>document.getElementById('uploadButton').hidden),true);
    await evaluate(()=>document.querySelector('[data-open]').click());
    await until(()=>document.getElementById('detailDialog').open,'reader detail');
    assert.equal(await evaluate(()=>document.getElementById('metaTitle').disabled),true);
    assert.equal(await evaluate(()=>document.getElementById('analyze').hidden),true);
    assert.deepEqual(errors,[]);
    console.log('PASS: real uploads, categories, favorites, search, version comparison, i18n, themes, mobile layout and reader permissions');
}).then(async()=>{clearTimeout(timeout); await require('../backend/models/app-db').closeDatabase(); await require('../backend/models/tenant-sqlite-pool').closeAll(); server?.close(); win?.destroy(); app.exit(0);}).catch(async error=>{console.error(error); if(win)await screenshots('failure').catch(()=>{});app.exit(1);});
