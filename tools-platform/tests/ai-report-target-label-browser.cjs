// node_modules/.bin/electron tests/ai-report-target-label-browser.cjs
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'target-label-'));app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();let win;
app.whenReady().then(async()=>{
 win=new BrowserWindow({show:false,width:1000,height:700});await win.loadURL('data:text/html,<html><body></body></html>');
 await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../frontend/js/vendor/echarts.min.js'),'utf8'));
 for(const file of ['frontend/js/ai-report/widgets.js','backend/data/hosted-apps/aiops-report/app/static/air/widgets.js']){
  if(!fs.existsSync(path.join(__dirname,'..',file)))continue;
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
  for(const width of [388,260])for(const max of [100,120]){
   const result=await win.webContents.executeJavaScript(`(()=>{
    document.body.innerHTML='<article class="air-report"><div data-cell="c"><div data-widget="w0" style="width:${width}px;height:180px"></div></div></article>';
    const root=document.querySelector('article'),element=document.querySelector('[data-widget]');
    const widget={id:'w0',type:'chart',spec:{option:{animation:false,grid:{top:8,right:16,left:8,bottom:6,containLabel:true},xAxis:{type:'category',data:['TE','ORG','ET','VDF']},yAxis:{type:'value',min:0,max:${max}},series:[{type:'line',data:[100,100,100,null],markLine:{symbol:'none',label:{formatter:'目标 ≥ {c}%',position:'end',offset:[40,0]},data:[{yAxis:100}]}}]}}};
    AiReportWidgets.hydrate(root,()=>widget);
    const canvas=document.querySelector('.kit-chart-canvas');canvas.style.cssText='width:100%;height:180px';
    const chart=echarts.getInstanceByDom(canvas);chart.resize();chart.getZr().flush();
    const label=[...canvas.querySelectorAll('text')].find(t=>t.textContent.includes('目标'));
    const box=label.getBoundingClientRect(),bounds=canvas.getBoundingClientRect(),grid=chart.getModel().getComponent('grid').coordinateSystem.getRect();
    const lineY=chart.convertToPixel({yAxisIndex:0},100)+bounds.top;
    const live={inside:box.left>=bounds.left+grid.x-1&&box.right<=bounds.left+grid.x+grid.width+1,above:box.bottom<=lineY+1,visible:box.top>=bounds.top-1,text:label.textContent};
    AiReportWidgets.dispose();element.removeAttribute('data-hydrated');AiReportWidgets.freeze(root,()=>widget);
    const frozen=[...element.querySelectorAll('text')].find(t=>t.textContent.includes('目标')),svg=element.querySelector('svg');svg.style.width='100%';
    const f=frozen.getBoundingClientRect(),s=svg.getBoundingClientRect();
    return {live,staticInside:f.left>=s.left-1&&f.right<=s.right+1&&f.top>=s.top-1};
   })()`);
   assert.deepEqual(result,{live:{inside:true,above:true,visible:true,text:'目标 ≥ 100%'},staticInside:true},file+' '+width+' max '+max);
  }
 }
 console.log('PASS: both renderers, 388px/260px cells, target at plot top and below it, live and static SVG.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{win?.destroy();app.exit(process.exitCode||0);});
