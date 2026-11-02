const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const hostedPath=path.join(__dirname,'../backend/data/hosted-apps/aiops-report/app/static/air/report-model.js');
const models=[require('../frontend/js/ai-report/report-model')];
if(fs.existsSync(hostedPath)) models.push(require(hostedPath));
for(const [i,M]of models.entries()){
 test('presentation '+i+': confirmed text-only requirement replaces old cards and survives exception confirmation',()=>{
  const chat=[{role:'user',text:'不需要图表，几句话总结就行'},{role:'ai',text:'是否仅这个格子例外？'},{role:'user',text:'只在这个格子例外'},{role:'user',text:'只呈现一句话'}];
  const rule=M.presentationOf('指标卡展示：显示风险数量',chat);assert.equal(rule.mode,'text');assert.equal(rule.maxSentences,1);
  assert.match(M.presentationConflict('指标卡展示：计算并展示存量。文字总结一句话。',rule),/指标卡/);
  const prompt=M.withPresentation('数据源：重叠收缩；按报告月份计算存量。\n【格子内部布局】kpi chart',rule);
  assert.doesNotMatch(prompt,/kpi chart/);assert.equal(M.presentationOf(prompt).maxSentences,1);
  const recipe={sources:[{id:'s1'}],compute:'unchanged',render:'old cards',narrative:null};const fixed=M.presentationRecipe(recipe,prompt);
  assert.equal(fixed.compute,recipe.compute);assert.strictEqual(fixed.sources,recipe.sources);assert.match(fixed.render,/return ""/);assert.match(fixed.narrative.prompt,/最多 1 句/);assert.equal(recipe.render,'old cards');
  assert.match(M.summaryConflict('本月有 894 个。待消减为零。',prompt),/1 句/);assert.equal(M.summaryConflict('本月存量 894 个，其中待消减为零。',prompt),'');
 });
 test('presentation '+i+': text constraints are reversible and do not mistake a chart caption for text-only output',()=>{
  const text=M.withPresentation('数据源保持原样',{mode:'text',maxSentences:1});
  const restored=M.presentationOf(text,[{role:'user',text:'改成柱状图，显示运营商分布'}]);assert.equal(restored.mode,'auto');assert.match(M.presentationConflict(text,restored),/可视化/);
  assert.doesNotMatch(M.withPresentation('生成柱状图',restored),/展示约束/);
  for(const prompt of ['显示表格，只保留一段文字总结','柱状图下面写一句话总结','只修改图表标题','不需要额外总结，用表格展示明细'])assert.equal(M.presentationOf(prompt).mode,'auto',prompt);
 });
}

test('summary rejects stale KPI instructions then accepts the confirmed local exception',async()=>{
 const route=require('../backend/routes/ai-report');let calls=0;
 const client={generateChat:async options=>{calls++;if(calls===2)assert.match(options.messages.at(-1).content,/删除冲突/);return {text:JSON.stringify({prompt:calls===1?'指标卡展示：显示存量。文字总结一句话。':'数据取重叠收缩，按报告月份计算存量，仅显示一句文字总结。'})};}};
 const prompt=await route.summarizePrompt(client,{month:'2026-10',prompt:'指标卡展示：显示存量',chat:[{role:'user',text:'不要图表，只要一句话总结'},{role:'user',text:'只在这个格子例外'}]});
 assert.equal(calls,2);assert.match(prompt,/【展示约束】/);assert.equal(models[0].presentationOf(prompt).mode,'text');
});

test('layout revisions release stale slot constraints only for pending layout requests',()=>{
 for(const M of models){
  const old='按报告月份取指标。\n【尺寸约束】高 308px。\n【格子内部布局】chart 宽 100%；table 宽 100%。';
  assert.equal(M.layoutRevision([{role:'user',text:'表格和柱状图左右分布'}]),true);
  assert.equal(M.horizontalChartTable('图表与表格采用左右并排布局'),true);
  assert.equal(M.horizontalChartTable('指标卡左右排列。下面放图表和表格。'),false);
  assert.equal(M.layoutRevision([{role:'user',text:'表格和柱状图左右分布'},{kind:'prompt',text:old},{role:'user',text:'标题改为稽查率'}]),false);
  assert.equal(M.withoutLayout(old),'按报告月份取指标。\n【尺寸约束】高 308px。');
 }
});
test('summary removes obsolete layout markers on a new layout request while retaining data and cell size',async()=>{
 const route=require('../backend/routes/ai-report');
 const old='取指标稽查率。\n【尺寸约束】高 308px。\n【格子内部布局】chart 宽 100%；table 宽 100%。';
 const client={generateChat:async options=>{
  assert.doesNotMatch(options.messages[0].content,/【格子内部布局】/);
  assert.match(options.messages[0].content,/高 308px/);
  return {text:JSON.stringify({prompt:'取指标稽查率，图表和表格左右并排。\n【格子内部布局】chart 宽 100%；table 宽 100%。'})};
 }};
 const prompt=await route.summarizePrompt(client,{month:'2026-10',prompt:old,chat:[{role:'ai',kind:'prompt',text:old},{role:'user',text:'表格和柱状图左右分布'}]});
 assert.match(prompt,/左右并排/);assert.doesNotMatch(prompt,/【格子内部布局】/);
});
