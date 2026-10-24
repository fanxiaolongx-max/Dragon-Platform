const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),acorn=require('acorn');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ai-business-targets-'));
process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');
const sqlite3=require('../backend/node_modules/sqlite3');
const service=require('../backend/models/ai-business-config-service');
async function create(file, statements) {
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const db=new sqlite3.Database(file);
    try {for(const [sql,args=[]] of statements) await new Promise((resolve,reject)=>db.run(sql,args,error=>error?reject(error):resolve()));}
    finally{await new Promise(resolve=>db.close(resolve));}
}
test.before(async()=>{
    const schema=[
        'CREATE TABLE uiv_scripts (id,name,category,url,payload_json,updated_at)',
        'CREATE TABLE uiv_categories (name,created_at)',
        'CREATE TABLE custom_tools (slug,name,description,tags_json,href,file_path,public_access,sort_order,updated_at)',
        'CREATE TABLE sla_targets (target_key,label,target_type,weight,auto_fill,is_percent,exceed_by,bonus,extra_config_json,updated_at)',
        'CREATE TABLE sla_groups (id,group_key,name,sort_order,updated_at)',
        'CREATE TABLE sla_group_items (id,group_id,item_name,item_sort_order)',
        'CREATE TABLE sla_prefs (pref_key,pref_kind,payload_json,updated_at)',
        'CREATE TABLE sla_categories (name,created_at)',
        'CREATE TABLE sys_dictionaries (dict_key,dict_value,category,updated_at)'
    ].map(sql=>[sql]);
    for(let i=1;i<=58;i++)schema.push(['INSERT INTO sla_targets VALUES (?,?,?,?,?,?,?,?,?,?)',[
        `target-${i}`,i===1?'IBMS':`指标${String(i).padStart(2,'0')}`,i%2?'≥':'≤',i,null,i%2,0,0,
        JSON.stringify({'5':i,'12':i+100,categoryRules:{fixture:'rules '.repeat(80)}}),'2026-10-22 00:00:00'
    ]]);
    await create(service.TOOLS_DB_PATH,schema);
    await create(service.REPORT_DB_PATH,[['CREATE TABLE PlatformConfig (key_name,value_json,updated_at)']]);
});
test.after(()=>{service.clearCache();fs.rmSync(temp,{recursive:true,force:true});});

test('the exact screenshot question retrieves all 58 current target rules, rather than four ranked excerpts',async()=>{
    const result=await service.search('请根据数据库内存储的真实情况 看下指标目标值都是多少');
    assert.equal(result.mode,'full-target-list');
    assert.equal(result.status.targetRuleCount,58);
    const rows=result.results[0].content.split('\n').slice(2).map(line=>JSON.parse(line));
    assert.equal(rows.length,58);
    assert.equal(new Set(rows.map(row=>row.record)).size,58);
    assert.equal(rows.find(row=>row.record==='target-58').months['12'],158);
});

test('common whole-list phrasings work while named metrics still use focused retrieval',async()=>{
    for(const question of ['指标目标值分别是什么','请列出各项指标目标值','全部指标目标规则','What are the target values for each metric?'])
        assert.equal((await service.search(question)).mode,'full-target-list',question);
    assert.notEqual((await service.search('IBMS 指标目标值都是多少')).mode,'full-target-list');
    assert.notEqual((await service.search('IBMS 每个月的目标值是多少')).mode,'full-target-list');
    assert.notEqual((await service.search('本月指标得分是多少')).mode,'full-target-list');
});

test('the actual grounding builder delivers the last record beyond 18K to the model context',async()=>{
    const source=fs.readFileSync(path.join(__dirname,'../backend/routes/ai.js'),'utf8');
    const node=acorn.parse(source,{ecmaVersion:'latest'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='buildExpertGrounding');
    const context={
        planProjectKnowledgeSearch:()=>({performed:false,pathHints:[]}),selectRelevantKnowledge:()=>({items:[],threshold:0,topScore:0}),
        aiKnowledgeService:{getStatus:async()=>({}),formatResultsForPrompt:()=>''},
        aiReportAnalysisService:{analyzeQuestion:async()=>null,formatAnalysisForPrompt:()=>''},
        aiBusinessConfigService:service,aiToolDataService:{analyzeQuestion:async()=>null},buildMetricGraphGrounding:async()=>null,
        KNOWLEDGE_CONTEXT_MAX_CHARS:17000,DATA_CONTEXT_MAX_CHARS:17000,BUSINESS_CONFIG_CONTEXT_MAX_CHARS:18000,console
    };
    vm.createContext(context);vm.runInContext(source.slice(node.start,node.end),context);
    const full=await context.buildExpertGrounding('请根据数据库内存储的真实情况 看下指标目标值都是多少');
    assert.ok(full.businessConfigPrompt.length>18000);
    assert.match(full.businessConfigPrompt,/"record":"target-58"/);
    assert.equal((full.businessConfigPrompt.match(/"record":/g)||[]).length,58);
    const focused=await context.buildExpertGrounding('IBMS 每个月的目标值是多少');
    assert.ok(focused.businessConfigPrompt.length<=18000,'ordinary retrieval retains its existing budget');
});
