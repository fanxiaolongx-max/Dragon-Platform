const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { conversationTitle } = require('../backend/models/conversation-title');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-titles-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const chat = require('../backend/models/ai-chat-repository');
const db = require('../backend/models/app-db');
const preferences = require('../backend/models/conversation-list-repository');
const { runWithTenant } = require('../backend/models/tenant-context');
const pool = require('../backend/models/tenant-sqlite-pool');
test.after(async () => { await pool.closeAll(); await db.closeDatabase(); fs.rmSync(temp, { recursive: true, force: true }); });

test('titles extract a short subject, remove request boilerplate and preserve technical identifiers', () => {
    for (const [question, title] of [
        ['你可以自动创建SKILL吗 我想做一个搜索思科等通信厂商新闻的SKILL', '通信厂商新闻搜索'],
        ['用 Web 搜索查一下 Node.js 26 什么时候进入 LTS，附上出处链接', 'Node.js 26 LTS 时间'],
        ['你能看到我平台数据库有哪些吗', '平台数据库概览'],
        ['本月哪些指标还没达标？', '本月未达标指标'],
        ['打开 https://example.com 截一张图', 'example.com 网页截图'],
        ['创建研究依据核对 Skill，检查结论与依据是否对应、口径是否一致', '研究依据核对 Skill'],
        ['1+1', '计算 1+1'], ['请帮我修复登录失败的问题，谢谢', '修复登录失败的问题'],
        ['用 read_file 分段读 app.log：每次只读 80 行（limit=80），从第 1 行一直读到第 2000 行，一段都不要跳过，也不要用 search 或命令。全部读完后告诉我：ERROR 在第几行、内容，以及你一共读了多少段。', '分段读取 app.log'],
        ['帮我查一下 NetCare 业务库里和“整改”相关的表有哪些（只读）。另外告诉我 platform:report.db 的 ReportSnapshots 表有多少行。', 'NetCare 整改相关表查询'],
        ['用一条命令 cat app.log 看完整内容（不要用 grep 或 search），然后告诉我日志里有没有 ERROR，在第几行、内容是什么。', '查看 app.log 完整内容'],
        ['用子智能体分头调研这个https://github.com/fanxiaolongx-max/Dragon-Platform-online仓库，同时进行：① 完整查询业务和应用数据库流程是啥样的；② AI模型是怎么识别需要调用接口和工具的；③ ai对话数据分别存在哪里。最后汇总成一张表。', 'Dragon-Platform-online 调研'],
        ['@debug 你能做啥', 'debug 智能体咨询']
    ]) assert.equal(conversationTitle(question), title);
    for (const question of ['请帮我优化首页输入框的布局并调整所有菜单及按钮之间的间距和展示效果', 'Please review the authentication middleware and fix the session expiry handling']) {
        const title = conversationTitle(question);
        assert.ok([...title].length <= (/修|首页/.test(question) ? 18 : 48));
        assert.ok(!title.includes('…'));
    }
    assert.ok(!conversationTitle('识别图片\n📎 附件: private-file.jpg').includes('private-file'));
});

test('new and legacy titles persist without changing questions, timestamps, manual names or tenant ownership', async () => {
    const question = '你可以自动创建SKILL吗 我想做一个搜索思科等通信厂商新闻的SKILL';
    const id = await chat.addMessage({ owner: 'alice', pagePath: '/', role: 'user', content: question });
    assert.equal((await db.get('SELECT auto_title FROM ai_chat_sessions WHERE id=?', [id])).auto_title, '通信厂商新闻搜索');
    await chat.addMessage({ sessionId: id, owner: 'alice', pagePath: '/', role: 'user', content: '现在换个话题' });
    await preferences.save('alice', { source: 'mine', id, title: '我的自定义标题' });
    // Simulate an old session that predates title generation.
    await db.run("UPDATE ai_chat_sessions SET auto_title='',updated_at='2025-01-01 00:00:00' WHERE id=?", [id]);
    await chat.addMessage({ owner: 'bob', pagePath: '/', role: 'user', content: '其他用户的原问题' });
    await db.run("UPDATE ai_chat_sessions SET auto_title='' WHERE owner='bob'");
    const rows = await chat.listOwnedSessions({ owner: 'alice', pagePath: '/' });
    assert.equal(rows[0].title, '通信厂商新闻搜索');
    assert.equal(rows[0].firstQuestion, question);
    assert.equal(rows[0].updatedAt, '2025-01-01 00:00:00');
    assert.equal((await preferences.list('alice'))[0].title, '我的自定义标题');
    assert.equal((await db.get("SELECT auto_title FROM ai_chat_sessions WHERE owner='bob'")).auto_title, '');
    assert.equal((await chat.listOwnedSessions({ owner: 'alice', pagePath: '/', query: '厂商新闻搜索' }))[0].id, id);
    await runWithTenant('title-isolated', async () => {
        assert.deepEqual(await chat.listOwnedSessions({ owner: 'alice', pagePath: '/' }), []);
        await chat.addMessage({ owner: 'alice', pagePath: '/', role: 'user', content: '7+7' });
        assert.equal((await chat.listOwnedSessions({ owner: 'alice', pagePath: '/' }))[0].title, '计算 7+7');
    });
    assert.equal((await chat.listOwnedSessions({ owner: 'alice', pagePath: '/' }))[0].title, '通信厂商新闻搜索');
});
