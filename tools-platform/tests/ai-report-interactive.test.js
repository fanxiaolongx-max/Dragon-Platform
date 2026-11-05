const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('../frontend/js/ai-report/report-model');
function load(file,context={}){vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/js/ai-report/'+file),'utf8'),context);return context;}
test('executable widget keeps HTML and JS as data through worker kit, cleaner and document normalization',()=>{
 const context=load('render-kit.js');const kit=context.AiReportKit;
 const source={html:'<b data-air-element="title">Title</b>',css:'b{color:red}',script:'if (1 < 2) document.querySelector("b").textContent="Ready";'};
 const html=kit.interactive(source,{id:'main',height:220,axes:'preserve'}),widgets=kit._takeWidgets();
 assert.match(html,/data-widget="w0"/);assert.doesNotMatch(html,/<script/);
 const {window}=load('widgets.js',{window:{}});
 const result=model.normalizeOutput({html,widgets:window.AiReportWidgets.cleanSpecs(widgets)});
 assert.equal(result.widgets[0].type,'interactive');assert.equal(result.widgets[0].spec.axes,'preserve');assert.equal(result.widgets[0].spec.script,source.script);assert.equal(result.widgets[0].spec.html,source.html);
});
test('manual edits replace the prompt adjustment section rather than growing repeated instructions',()=>{
 const {window}=load('interactive.js',{window:{}}),api=window.AiReportInteractive;
 const widgets=[{type:'interactive',spec:{history:[{element:'target',label:'目标',action:'move',after:{x:12,y:-8}},{element:'title',action:'text',after:'新版标题'}]}}];
 const first=api.promptWithEdits('按报告月份取数。',widgets),second=api.promptWithEdits(first,widgets);
 assert.equal(first,second);assert.match(second,/按报告月份取数/);assert.match(second,/新版标题/);assert.equal(second.split('【手工展示调整】').length,2);
 const migrated=api.promptWithEdits('展示图表',[{type:'interactive',spec:{history:[{element:'node-0-1',label:'9.8%',action:'move',after:{x:0,y:-35}},{element:'air-chart-main-label-1',label:'9.8%',action:'move',after:{x:30,y:-20}}]}}]);
 assert.match(migrated,/30px、-20px/);assert.doesNotMatch(migrated,/-35px/);
 const doc=api.documentOf({html:'<b>value</b>',script:'document.body.dataset.ran="yes"'},{channel:'test'});
 assert.match(doc,/connect-src 'none'/);assert.match(doc,/script-src 'unsafe-inline' 'unsafe-eval'/);assert.match(doc,/document.body.dataset.ran/);
});
test('compile gives the model current presentation, recorded changes and executable-cell contract',async()=>{
 const route=require('../backend/routes/ai-report');let content;
 const client={generateChat:async options=>{assert.match(options.systemInstruction,/kit.interactive/);assert.match(options.systemInstruction,/内部布局.*自由/);assert.match(options.systemInstruction,/所有新格子默认使用/);assert.match(options.systemInstruction,/不要生成“自由编辑”/);content=options.messages[0].content;return {text:JSON.stringify({type:'recipe',recipe:{sources:[],compute:'function compute(input){return {missing:true};}',render:'function render(result,kit){return kit.text("暂无数据");}',narrative:null}})};}};
 const reply=await route.compileTurn(client,{month:'2026-11',prompt:'清晰展示数据',presentation:[{html:'<p>Current design</p>',changes:[{description:'目标标签放上方'}]}]});
 assert.equal(reply.type,'recipe');assert.match(content,/Current design/);assert.match(content,/目标标签放上方/);
});

test('cell chat retries unnecessary interactive-mode questions instead of asking the user',async()=>{
 const route=require('../backend/routes/ai-report');let calls=0;
 const client={generateChat:async options=>{calls++;assert.match(options.systemInstruction,/所有新格子默认/);return {text:JSON.stringify(calls===1?{type:'ask',question:'您希望如何实现自由拖动和编辑文字？',choices:['仅当前格子','整份月报']}:{type:'ready',text:'按已确认的指标生成柱状图。'})};}};
 const reply=await route.cellTurn(client,{month:'2026-11',prompt:'按确认的指标生成柱状图',chat:[],message:'生成这个格子'});
 assert.equal(reply.type,'ready');assert.equal(calls,2);
});

test('interactive compile rejects legacy static layouts and keeps text-only HTML editable',async()=>{
 const route=require('../backend/routes/ai-report');let calls=0;
 const client={generateChat:async options=>{calls++;if(calls===2)assert.match(JSON.stringify(options.messages),/旧【格子内部布局】/);return {text:JSON.stringify({type:'recipe',recipe:{sources:[],compute:'function compute(input){return {value:100};}',render:calls===1?'function render(result,kit){return kit.text("100%");}':'function render(result,kit){return kit.interactive({html:"<p>100%</p>"});}',narrative:null}})};}};
 const reply=await route.compileTurn(client,{month:'2026-11',prompt:'只显示文字总结，不要图表',interactive:true});
 assert.equal(calls,2);assert.match(reply.recipe.render,/kit.interactive/);assert.equal(reply.recipe.narrative,null);
 assert.match(model.presentationRecipe(reply.recipe,'只显示文字总结，不要图表').render,/kit.interactive/);
});

test('regeneration carries anchored adjustments and all edit history without copying stale DOM offsets',()=>{
 const {window}=load('interactive.js',{window:{}}),api=window.AiReportInteractive;
 const anchor={kind:'relative',target:{id:'title',tag:'H3'},x:.4,y:.2};
 const previous=[{type:'interactive',id:'w0',alias:'content',spec:{edits:{title:{x:8,y:9,text:'New title',anchor},'node-0':{x:50,y:10}},history:[{element:'title',action:'text',after:'New title'},{element:'title',action:'move',after:{x:8,y:9}}]}}];
 const fresh=[{type:'interactive',id:'w0',alias:'content',spec:{html:'<h3>Changed HTML</h3>'}}];api.carryAdjustments(previous,fresh);
 assert.equal(fresh[0].spec.replay.length,1);assert.equal(fresh[0].spec.replay[0].histories.length,2);assert.equal(fresh[0].spec.edits,undefined);
 assert.equal(fresh[0].spec.replay[0].edit.anchor,anchor);
});

test('prompt summarization leaves machine adjustment mapping to the editor',async()=>{
 const route=require('../backend/routes/ai-report');let seen=false;
 const client={generateChat:async options=>{seen=true;assert.doesNotMatch(JSON.stringify(options.messages),/machine-anchor-unique/);assert.match(options.systemInstruction,/不要按新的分类顺序重配旧标签数值/);return {text:JSON.stringify({prompt:'按West、East顺序显示同一来源的柱状图，标签字号16px。'})};}};
 const prompt='显示柱状图。\n【手工展示调整】machine-anchor-unique';
 const result=await route.summarizePrompt(client,{month:'2026-09',prompt,chat:[{role:'ai',kind:'prompt',text:prompt},{role:'user',text:'顺序改West、East，字号16px，保留手工位置'}]});
 assert.ok(seen);assert.doesNotMatch(result,/machine-anchor-unique/);
});

test('component sizing and table geometry are summarized as the latest usable adjustment',()=>{
 const {window}=load('interactive.js',{window:{}}),api=window.AiReportInteractive;
 const widgets=[{type:'interactive',spec:{edits:{title:{size:{kind:'text',fontSize:18}},table:{size:{kind:'box',width:400,height:130}}},history:[{element:'title',label:'标题',action:'resize',after:{kind:'text',fontSize:16}},{element:'table',label:'明细表',action:'resize',after:{kind:'box',width:400,height:130}},{element:'table',label:'明细表',action:'column-width:a',column:'数量',after:{width:120,ratio:.3}},{element:'table',label:'明细表',action:'row-height:a',row:1,after:{height:32}}]}}];
 const prompt=api.promptWithEdits('清晰展示月报',widgets);assert.match(prompt,/字号调整为 18.0px/);assert.match(prompt,/400 × 130px/);assert.match(prompt,/列“数量”宽度调整为 120px.*30.0%/);assert.match(prompt,/第 1 行高度调整为 32px/);assert.equal(api.promptWithEdits(prompt,widgets),prompt);
});

test('legacy multiline adjustment sections are replaced completely and stay idempotent',()=>{
 const {window}=load('interactive.js',{window:{}}),api=window.AiReportInteractive;
 const prompt='保留真实数据\n【手工展示调整】旧组件\n多余旧内容\n\n溢出的旧位移\n【尺寸约束】宽度500px';
 const widgets=[{type:'interactive',spec:{history:[{element:'title',label:'标题\n多行',action:'move',after:{x:4,y:2}},{element:'body',action:'text',after:'第一行\n第二行'}]}}];
 const next=api.promptWithEdits(prompt,widgets);assert.doesNotMatch(next,/多余旧内容|溢出的旧位移/);assert.match(next,/【尺寸约束】宽度500px/);assert.match(next,/第一行\\n第二行/);assert.equal(api.promptWithEdits(next,widgets),next);assert.equal(next.split('【手工展示调整】').length,2);
});
