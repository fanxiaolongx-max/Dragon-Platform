const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-grounding-relevance-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const sqlite3 = require('../backend/node_modules/sqlite3');
const service = require('../backend/models/ai-business-config-service');

async function create(file, statements) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new sqlite3.Database(file);
    try { for (const [sql, args = []] of statements) await new Promise((resolve, reject) => db.run(sql, args, error => (error ? reject(error) : resolve()))); }
    finally { await new Promise(resolve => db.close(resolve)); }
}

test.before(async () => {
    const urls = Array.from({ length: 20 }, (_, index) => `https://bi.example.com/report/${index} 页面 描述`).join('\n');
    await create(service.TOOLS_DB_PATH, [
        ['CREATE TABLE uiv_scripts (id,name,category,url,payload_json,updated_at)'],
        ['CREATE TABLE uiv_categories (name,created_at)'],
        ['CREATE TABLE custom_tools (slug,name,description,tags_json,href,file_path,public_access,sort_order,updated_at)'],
        ['CREATE TABLE sla_targets (target_key,label,target_type,weight,auto_fill,is_percent,exceed_by,bonus,extra_config_json,updated_at)'],
        ['CREATE TABLE sla_groups (id,group_key,name,sort_order,updated_at)'],
        ['CREATE TABLE sla_group_items (id,group_id,item_name,item_sort_order)'],
        ['CREATE TABLE sla_prefs (pref_key,pref_kind,payload_json,updated_at)'],
        ['CREATE TABLE sla_categories (name,created_at)'],
        ['CREATE TABLE sys_dictionaries (dict_key,dict_value,category,updated_at)'],
        ['INSERT INTO uiv_scripts VALUES (?,?,?,?,?,?)', ['s1', 'PBI_自动抓取_逃生演练', 'PBI', 'https://bi.example.com', JSON.stringify({ code: urls }), '2026-10-01 00:00:00']],
        ['INSERT INTO sys_dictionaries VALUES (?,?,?,?)', ['未发客户延期邮件', 'Customer delay email not sent', 'i18n', '2026-10-01 00:00:00']]
    ]);
    await create(service.REPORT_DB_PATH, [['CREATE TABLE PlatformConfig (key_name,value_json,updated_at)']]);
});
test.after(() => { service.clearCache(); fs.rmSync(temp, { recursive: true, force: true }); });

test('business config retrieval ignores external URLs and words that only appear inside unrelated records', async () => {
    assert.deepEqual((await service.search('打开 https://example.com 截一张图，一句话描述页面')).results, [], 'a question about an external page is not about platform config');
    assert.deepEqual((await service.search('帮我写一封邮件给领导')).results, [], 'a common two-character word in a long request does not count');
    assert.deepEqual((await service.search('帮我翻译一下这段英文')).results, [], 'general translation is not a dictionary lookup');
    assert.equal((await service.search('逃生演练')).results[0].title, 'UIVF12 脚本：PBI_自动抓取_逃生演练');
    assert.equal((await service.search('逃生演练的抓取脚本是怎么写的')).results[0].title, 'UIVF12 脚本：PBI_自动抓取_逃生演练');
    assert.ok((await service.search('未发客户延期邮件的英文名称')).results.some(item => /未发客户延期邮件/.test(item.title)));
});

test('project knowledge is searched for platform questions, not for questions about external web pages', () => {
    const { planProjectKnowledgeSearch: plan } = require('../backend/models/ai-knowledge-plan');
    assert.equal(plan('打开 https://example.com 截一张图，一句话描述页面').performed, false);
    assert.equal(plan('打开 https://hn.algolia.com/?q=mcp 从网络请求里找搜索接口').performed, false);
    assert.equal(plan('这个页面怎么用').performed, true);
    assert.equal(plan('平台的报表页面在哪').performed, true);
    assert.equal(plan('月报接口的计算逻辑在哪个文件').performed, true);
    assert.equal(plan('本平台怎么对接 https://example.com 的接口').performed, true, 'mentioning the platform keeps the search');
});
