// Read-only initial-page contrast audit. No connected APIs or user data.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express');
const audit=require('./helpers/ezscan-contrast-audit.cjs');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'builtin-contrast-'));
app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let win,server;
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());web.use('/api',(_,res)=>res.json({items:[],success:true}));
 web.get('/tool/:slug/',(req,res)=>{const file=path.join(root,'backend/builtin-tools',req.params.slug,'index.html');res.type('html').send(fs.readFileSync(file,'utf8').replace('<head>','<head><script src="/js/shared/platform-theme.js"></script>'))});
 web.use('/js',express.static(path.join(root,'frontend/js')));web.use('/tool',express.static(path.join(root,'backend/builtin-tools')));
 server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s))});
 win=new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const base=`http://127.0.0.1:${server.address().port}`;
 await win.loadURL(base+'/api');
 const slugs=process.env.AUDIT_SLUGS?process.env.AUDIT_SLUGS.split(','):process.env.AUDIT_ALL?fs.readdirSync(path.join(root,'backend/builtin-tools')).filter(s=>fs.existsSync(path.join(root,'backend/builtin-tools',s,'index.html'))):['f12-to-extension','python-updater','network_safety_meeting_summary','tool-mumxi3px','tool-mtpx4vtr'];
 const results=[];
 for(const slug of slugs)for(const theme of ['light','dark']){
  await win.webContents.executeJavaScript(`localStorage.setItem('tools_theme',${JSON.stringify(theme)})`);
  await win.loadURL(base+'/tool/'+slug+'/').catch(()=>{});
  await new Promise(r=>setTimeout(r,700));
  const report=await win.webContents.executeJavaScript(`(() => {
   const report=(${audit.toString()})();
   const nodes=[...document.querySelectorAll('body *')];
   for(const f of report.failures){
    const el=nodes.find(el=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\\s+/).join('.'):'')===f.element);
    if(!el)continue;
    let solid=true;
    for(let n=el;n;n=n.parentElement){const c=getComputedStyle(n);if(c.backgroundImage!=='none'||Number(c.opacity)<1)solid=false;}
    const rgb=f.foreground.match(/[\\d.]+/g).map(Number);
    if(solid&&!f.disabled&&Math.max(...rgb.slice(0,3))-Math.min(...rgb.slice(0,3))<65){
      f.repair={selector:el.id?'#'+CSS.escape(el.id):el.tagName.toLowerCase()+[...el.classList].map(c=>'.'+CSS.escape(c)).join(''),color:f.background.reduce((s,v)=>s+v,0)>420?'#334155':'#e2e8f0'};
    }
   }
   return report;
  })()`);
  results.push({slug,theme,...report});
  if(slug==='f12-to-extension'&&theme==='light')assert.equal(report.failures.filter(f=>/text-slate-|identityHint|packageTargetHint|compatReport/.test(f.element)).length,0,'F12 labels, help and status text remain readable');
  if(slug==='tool-mtpx4vtr')assert.equal(report.failures.length,0,'order-checker supporting text and tab counts are readable');
  if(process.env.VERIFY_SUPPORTING==='1')assert.equal(report.failures.filter(f=>/summary-hint|subtitle|intro-desc|empty-state-desc|section-desc|div\.lbl$|div\.sub$|alphabet-letter-roman|editable-copy|td\.hint/.test(f.element)).length,0,slug+' supporting text contrast');
  console.log(slug,theme,report.measured,report.failures.length);
  if(slug==='f12-to-extension')fs.writeFileSync(path.join(out,slug+'-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));console.log('Report:',out);win.destroy();server.close();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
