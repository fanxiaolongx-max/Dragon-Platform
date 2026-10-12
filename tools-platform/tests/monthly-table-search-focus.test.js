const test=require('node:test'),assert=require('node:assert/strict'),{build,text}=require('../frontend/js/monthly-designer/table-search-focus');
test('all current matches are located without changing rows, including late rows, Unicode and nested content',()=>{
 const table={headers:['客户','详情'],rows:[{客户:'Other',详情:{name:'Needle'}},{客户:'ＮＥＥＤＬＥ',详情:''},{客户:'needle',详情:'Needle'}]},saved=JSON.stringify(table),matches=build(table,{query:'needle',hit:{kind:'content',rowNumber:3,field:'客户'}});assert.deepEqual([...matches.rows.keys()],[0,1,2]);assert.deepEqual([...matches.rows.get(2)],[0,1]);assert.deepEqual([...matches.columns],[1,0]);assert.equal(JSON.stringify(table),saved);assert.equal(text({name:'Needle'}),'{"name":"Needle"}');
});
test('header matches mark columns without incorrectly promoting every row',()=>{
 const matches=build({headers:['network_name','amount'],rows:[{network_name:'Egypt',amount:20}]},{query:'network_name',hit:{kind:'column',field:'network_name'}});assert.equal(matches.rows.size,0);assert.deepEqual([...matches.columns],[0]);
});
test('original content highlights its current row/column through saved chained header mappings',()=>{
 const matches=build({headers:['客户','值'],rows:[{客户:'埃及',值:1},{客户:'埃及',值:2}]},{query:'Old Egypt',hit:{kind:'original-content',field:'old_name',rowNumber:2}},[{kind:'header',from:'old_name',to:'network_name'},{kind:'header',from:'network_name',to:'客户'}]);assert.deepEqual([...matches.rows.keys()],[1]);assert.deepEqual([...matches.rows.get(1)],[0]);
});
test('invalid anchors and changed current values never highlight an unrelated row',()=>{
 const table={headers:['x'],rows:[{x:'changed'}]};assert.equal(build(table,{query:'old',hit:{kind:'content',field:'x',rowNumber:1}}).rows.size,0);assert.equal(build(table,{query:'old',hit:{kind:'original-content',field:'x',rowNumber:100}}).rows.size,0);assert.equal(build(table,null).rows.size,0);
});

test('saved mapping aliases without an original archive still identify the current column',()=>{
 const matches=build({headers:['客户'],rows:[{客户:'埃及'}]},{query:'old_name',hit:{kind:'mapping',field:'old_name → 客户'}},[{kind:'header',from:'old_name',to:'客户'}]);assert.deepEqual([...matches.columns],[0]);assert.equal(matches.rows.size,0);
});
