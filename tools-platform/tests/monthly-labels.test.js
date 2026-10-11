const test=require('node:test'),assert=require('node:assert/strict'),L=require('../frontend/js/monthly-designer/labels');
test('fixes known default template mistranslations while respecting custom English',()=>{
 assert.equal(L.pair({zh:'License管理',en:'Risk governance'},'en'),'License management');
 assert.equal(L.pair({zh:'报告时间',en:'Reporting period'},'en'),'Report date');
 assert.equal(L.pair({zh:'License管理',en:'License review'},'en'),'License review');
 assert.equal(L.pair({zh:'TEST',en:''},'en'),'TEST');
 assert.equal(L.pair({zh:'License管理',en:'Risk governance'},'zh'),'License管理');
});
test('tenant indicator translations override fallbacks; unmapped source names remain intact',()=>{
 assert.equal(L.translate('高危命令拦截'),'High-risk command interception');
 assert.equal(L.translate('高危命令拦截',{'高危命令拦截':'Custom interception metric'}),'Custom interception metric');
 assert.equal(L.translate('2026-10 · 金额 · 求和'),'2026-10 · Amount · Sum');
 assert.equal(L.translate('未配置的自定义字段'),'未配置的自定义字段');
});
