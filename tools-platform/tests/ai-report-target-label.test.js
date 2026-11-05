const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const renderers=['frontend/js/ai-report/widgets.js','backend/data/hosted-apps/aiops-report/app/static/air/widgets.js'].filter(file=>fs.existsSync(path.join(__dirname,'..',file)));
for(const file of renderers){
 function render(option){
  let output;const window={echarts:{init:()=>({setOption:value=>{output=value;},renderToSVGString:()=>'<svg />',dispose(){}})}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{window});
  const element={dataset:{widget:'w0'},style:{height:'180px'},closest:()=>({dataset:{cell:'c1'}})};
  window.AiReportWidgets.freeze({querySelectorAll:()=>[element]},()=>({type:'chart',spec:{option}}));
  return output;
 }
 test(file+': existing outside target label moves above horizontal line, keeping values and missing data',()=>{
  const option={grid:{top:8},xAxis:{data:['TE','ORG','ET','VDF']},yAxis:{max:100},series:[{type:'line',data:[100,100,100,null],markLine:{label:{formatter:'目标 ≥ {c}%',offset:[40,0],align:'left'},data:[{yAxis:100}]}}]};
  const before=JSON.stringify(option),out=render(option),mark=out.series[0].markLine.data[0];
  assert.equal(mark.label.position,'insideEndTop');assert.equal(mark.label.align,'right');assert.equal(mark.label.verticalAlign,'bottom');assert.equal(JSON.stringify(mark.label.offset),'[0,0]');assert.equal(mark.label.formatter,'目标 ≥ {c}%');assert.equal(mark.yAxis,100);assert.equal(out.grid.top,24);
  assert.equal(JSON.stringify(out.series[0].data),'[100,100,100,null]');assert.equal(JSON.stringify(option),before);
 });
 test(file+': hidden labels, custom inside positions, vertical lines and statistics survive',()=>{
  const out=render({xAxis:{},yAxis:{},series:{type:'bar',markLine:{label:{show:false},data:[{yAxis:100},{yAxis:90,label:{show:true,position:'start'}},{yAxis:80,label:{show:true,position:'insideMiddleBottom'}},{xAxis:1},{type:'average'}]}}});
  const data=out.series.markLine.data;
  assert.equal(data[0].label.show,false);assert.equal(data[1].label.position,'insideEndTop');assert.equal(data[2].label.position,'insideMiddleBottom');assert.equal(data[3].label,undefined);assert.equal(data[4].type,'average');
 });
 test(file+': coordinate-pair thresholds get the same bounded label defaults',()=>{
  const out=render({xAxis:{},yAxis:{},series:[{type:'line',markLine:{data:[[{coord:[0,100],label:{formatter:'目标 100%'}},{coord:[3,100]}]]}}]});
  assert.equal(out.series[0].markLine.data[0][0].label.position,'insideEndTop');assert.equal(out.series[0].markLine.data[0][1].label.position,'insideEndTop');
 });
}
if(renderers.length===2)test('both applications keep the same target-label policy while widget capabilities evolve independently',()=>{
 const policy=file=>{const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');return source.slice(source.indexOf('    function targetLabels('),source.indexOf('    function chartOption('));};
 assert.equal(policy(renderers[0]),policy(renderers[1]));
});
