const test=require('node:test'),assert=require('node:assert/strict');
const formulas=require('../frontend/js/monthly-designer/metric-formulas'),engine=require('../frontend/js/monthly-designer/document-engine'),templates=require('../frontend/js/monthly-designer/templates');
const definition=()=>({id:'calc-1',keys:['a','b'],expression:'(A - B) / B',digits:2,percent:true,originalText:'[[@metric:a]] [[@metric:b]]',originalRuns:[{text:'[[@metric:a]]',style:{bold:true,color:'#b91c1c'}},{text:' ',style:{}},{text:'[[@metric:b]]',style:{fontSize:18}}]});
const catalog=(a,b)=>({files:[],batches:[],snapshots:[{id:'snapshot',captured_at:'2026-10-10',target_period:'2026-09',kind:'extraction',metrics:[{key:'a',label:'A value',value:a},{key:'b',label:'B value',value:b}],sections:[]}],inlineFormulas:[definition()]});
test('arithmetic supports precedence, parentheses, Unicode operators, powers and bounded functions',()=>{
 assert.equal(formulas.evaluate('A+B*2',5,3),11);assert.equal(formulas.evaluate('(A+B)×2',5,3),16);assert.equal(formulas.evaluate('A÷B',9,3),3);assert.equal(formulas.evaluate('-A^2+B',2,5),1);assert.equal(formulas.evaluate('A + B^2^3',1,2),257);assert.equal(formulas.evaluate('MAX(A,B) - MIN(A,B)',4,9),5);assert.equal(formulas.evaluate('ROUND(ABS(A-B)/3,2)',2,7),1.67);assert.equal(formulas.evaluate('ROUND(A+B,0)',-1,-0.5),-2);assert.equal(formulas.evaluate('ROUND(A+B,2)',1,0.005),1.01);
});
test('metric numeric conversion accepts numbers, grouping and percentages; rejects blanks, labels and nonfinite data',()=>{
 assert.equal(formulas.evaluate('A/B','1,000.5','20%'),5002.5);for(const value of [null,undefined,'','12 rows','1,2',false,Infinity,'Infinity','NaN'])assert.throws(()=>formulas.evaluate('A+B',value,2),{code:'non_numeric'});
 assert.equal(formulas.display(0.123456,2,true),'12.35%');assert.equal(formulas.display(12,2),'12');assert.equal(formulas.display(-0.0001,2),'0');
});
test('parser rejects unsafe syntax, third variables, unbounded nesting and arithmetic errors without executing code',()=>{
 for(const expression of ['A+globalThis.process.exit()','A+B;alert(1)','A[B]','A+C','A+B.constructor','eval(A)+B','A+B%','A+','MIN(A)','ROUND(A,B,1)','('.repeat(30)+'A+B'+')'.repeat(30)])assert.throws(()=>formulas.compile(expression));
 assert.throws(()=>formulas.compile('A+1'),{code:'two_variables_required'});assert.throws(()=>formulas.evaluate('A/B',1,0),{code:'division_by_zero'});assert.throws(()=>formulas.evaluate('A^B',1e200,2),{code:'non_finite'});assert.throws(()=>formulas.evaluate('ROUND(A,B)',1,7),{code:'invalid_precision'});
});
test('only two adjacent metric references form a source; original styles are validated',()=>{
 const item=definition();assert.deepEqual(formulas.sourceKeys(item.originalText),['a','b']);for(const text of ['[[@metric:a]]','[[@metric:a]] + [[@metric:b]]','[[@metric:a]]\n[[@metric:b]]','[[@metric:a]][[@metric:b]][[@metric:c]]','[[@formula:a]][[@metric:b]]'])assert.equal(formulas.sourceKeys(text),null);
 assert.doesNotThrow(()=>formulas.validate([item]));for(const changed of [{keys:['a','b','c']},{digits:7},{expression:'A+C'},{originalText:'literal values 2 3'},{originalRuns:[{text:item.originalText,style:{background:'url(javascript:bad)'}}]}])assert.throws(()=>formulas.validate([{...item,...changed}]));assert.throws(()=>formulas.validate([item,item]));
});
test('document formulas persist through normalize and templates, and recalculate with source values',()=>{
 const doc=engine.defaults();doc.inlineFormulas=[definition()];doc.sections[0].blocks[0].text.zh='Rate [[@formula:calc-1]]';const normalized=engine.normalize(doc);assert.deepEqual(normalized.inlineFormulas,doc.inlineFormulas);const template=templates.capture(doc,catalog(30,20)),created=templates.create(template,catalog(60,20),'2026-09');assert.deepEqual(created.inlineFormulas,doc.inlineFormulas);assert.equal(engine.metricTextParts(doc.sections[0].blocks[0].text.zh,catalog(30,20))[1].value,'50%');assert.equal(engine.metricTextParts(doc.sections[0].blocks[0].text.zh,catalog(60,20))[1].value,'200%');
 const invalid=engine.metricTextParts('[[@formula:calc-1]]',catalog(30,0))[0];assert.equal(invalid.value,'—');assert.equal(invalid.error,'division_by_zero');const missing=engine.metricTextParts('[[@formula:unknown]]',catalog(1,2))[0];assert.equal(missing.missing,true);assert.equal(missing.value,'—');
});
test('component preset import remaps formula identifiers so changing one preset cannot alter another component',()=>{
 const block=engine.block();block.text.zh='[[@formula:calc-1]]';block.textRuns={zh:[{text:block.text.zh,style:{color:'#b91c1c'}}],en:[]};const imported=formulas.importBlock(block,[definition()],[definition()],()=> 'new-id');assert.equal(imported.block.text.zh,'[[@formula:new-id]]');assert.equal(imported.block.textRuns.zh[0].text,'[[@formula:new-id]]');assert.deepEqual(imported.definitions.map(item=>item.id),['calc-1','new-id']);assert.equal(block.text.zh,'[[@formula:calc-1]]');
});
