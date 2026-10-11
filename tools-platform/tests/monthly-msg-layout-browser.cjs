/* Run: node_modules/.bin/electron tests/monthly-msg-layout-browser.cjs */
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express'),CFB=require('cfb');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-msg-layout-'));app.setPath('userData',path.join(temp,'profile'));
let win,server,payload,message,blocked=false,downloadCount=0;const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(fn,...args)=>win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);
async function until(fn){for(let index=0;index<300;index++){if(await fn())return;await wait(100);}throw new Error('MSG export check timed out');}
app.whenReady().then(async()=>{
 const engine=require('../frontend/js/monthly-designer/document-engine'),report=engine.defaults();report.id='msg-fixture';report.logo='/assets/monthly-logos/02.svg';report.sections=report.sections.slice(0,1);report.sections[0].title.zh='样式回归标题';
 report.sections[0].blocks[0].text.zh='正文保留';report.sections[0].blocks[0].span=4;
 for(let index=0;index<2;index++){const block=engine.block('table');block.span=4;block.title.zh='数据表 '+index;block.binding={kind:'file',mode:'pinned',fileId:'file',sheetId:'sheet',sheetName:'Sheet1'};report.sections[0].blocks.push(block);}
 const nextSection=engine.defaults().sections[1];nextSection.blocks[0].text.zh='第二模块';report.sections.push(nextSection);
 const web=express();web.use(express.json({limit:'50mb'}));
 web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));
 web.get('/api/sla/prefs/i18nMap',(_,res)=>res.json({}));web.get('/api/sla/categories',(_,res)=>res.json([]));
 web.get('/api/upload/source-catalog',(_,res)=>res.json({files:[{id:'file',batch_id:'batch',name:'fixture.csv',source_key:'fixture',kind:'original',created_at:'2026-10-10T12:00:00Z',parse_status:'ready',sheets:[{id:'sheet',name:'Sheet1',headers:['客户','数值'],rowCount:1}],metricLabels:[]}],snapshots:[],batches:[{id:'batch',created_at:'2026-10-10T12:00:00Z',target_month:9}]}));
 web.get('/api/upload/monthly-documents',(_,res)=>res.json([{id:report.id,name:report.name}]));web.get('/api/upload/monthly-documents/:id',(_,res)=>res.json({document:report}));
 web.get('/api/upload/source-sheets/:id',(_,res)=>res.json({headers:['客户','数值'],rows:[{客户:'测试客户',数值:42}]}));
 web.use('/api/report-msg',(req,res,next)=>{if(blocked){res.status(403).send('proxy blocked');return;}payload=req.body.envelope?JSON.parse(decodeURIComponent(Buffer.from(req.body.envelope,'base64').toString('utf8'))):req.body;const send=res.send.bind(res);res.send=value=>{if(Buffer.isBuffer(value))message=value;return send(value);};next();},require('../backend/routes/report-msg'));
 web.use(express.static(path.join(__dirname,'../frontend')));server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});
 win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.session.on('will-download',(_,item)=>item.setSavePath(path.join(temp,'export-'+(++downloadCount)+'.'+(blocked?'eml':'msg'))));
 await win.loadURL(`http://127.0.0.1:${server.address().port}/pages/monthly-designer.html`);
 await until(()=>evaluate(()=>window.MonthlyDesigner?.getDocument().id==='msg-fixture'&&!document.getElementById('monthlyDocument').inert&&document.querySelector('.table-cell-edit')?.textContent==='客户'));
 await evaluate(()=>{const text=document.querySelector('.document-block-text .document-edit');text.innerHTML='<span style="font-size:8px;color:#c00000;font-weight:bold">正文保留</span>';text.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action=msg]').click();});
 await until(()=>Promise.resolve(!!message));
 assert.ok(payload.inlineImages.length>=1,'Logo becomes an embedded attachment');assert.match(payload.html,/src="cid:report-image-/);assert.doesNotMatch(payload.html,/src="data:/);
 const results=await evaluate(html=>{
  const doc=new DOMParser().parseFromString(html,'text/html');const title=Array.from(doc.querySelectorAll('h2')).find(node=>node.textContent==='样式回归标题');const backgrounds=[];for(let parent=title;parent;parent=parent.parentElement){backgrounds.push(parent.getAttribute('bgcolor')||parent.style.backgroundColor);}
  const text=Array.from(doc.querySelectorAll('span')).find(node=>node.textContent==='正文保留');
  return {logo:!!doc.querySelector('img'),titleColor:title.style.color,backgrounds,textSize:text.style.fontSize,textColor:text.style.color,textWeight:text.style.fontWeight,gridCells:Array.from(doc.querySelectorAll('td[colspan="4"]')).map(cell=>({width:cell.getAttribute('width'),style:cell.style.width})),nav:!!doc.querySelector('a[href^="#section-"]'),controls:!!doc.querySelector('[data-controls]'),flex:doc.querySelectorAll('[style*="display: flex"],[style*="display: grid"]').length};
 },payload.html);
 assert.equal(results.logo,true);assert.equal(results.titleColor,'rgb(255, 255, 255)');assert.ok(results.backgrounds.includes('#173c60'),'Dark section heading background survives');assert.equal(results.textSize,'8px');assert.equal(results.textColor,'rgb(192, 0, 0)');assert.equal(results.textWeight,'700');assert.ok(results.gridCells.length>=3);assert.ok(results.gridCells.every(cell=>cell.width==='33%'&&cell.style==='33%'));assert.equal(results.nav,true,'Quick navigation survives export');assert.equal(results.controls,false);assert.equal(results.flex,0);
 const compound=CFB.read(message,{type:'buffer'});assert.match(Buffer.from(CFB.find(compound,'/__substg1.0_10130102').content).toString('utf8'),/cid:report-image-/);
 const ids=compound.FullPaths.filter(name=>name.endsWith('/__substg1.0_3712001F')).map(name=>Buffer.from(CFB.find(compound,name).content).toString('utf16le').replace(/\0+$/,''));for(const image of payload.inlineImages)assert.ok(ids.includes(image.cid),'MSG Content-ID matches HTML');
 blocked=true;await evaluate(()=>document.querySelector('[data-action=msg]').click());await until(()=>Promise.resolve(fs.existsSync(path.join(temp,'export-2.eml'))));
 const eml=fs.readFileSync(path.join(temp,'export-2.eml'),'utf8');assert.match(eml,/Content-ID: <report-image-/);assert.match(eml,/Content-Disposition: inline/);assert.match(eml,/X-Unsent: 1/);
 console.log('Local EML fallback preserves inline images.');
 console.log('Full monthly MSG export passed: logo/CID attachments, section background, 3-column widths, rich-text font/color, no editor controls or flex/grid.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{win?.destroy();server?.closeAllConnections();server?.close();app.exit(process.exitCode||0);});
