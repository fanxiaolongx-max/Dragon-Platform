const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-ai-db-chat-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const tenant = require('../backend/models/tenant-context');
const sessions = require('../backend/models/auth-sessions-repository');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const chat = require('../backend/models/ai-chat-repository');
const agent = require('../backend/models/ai-database-agent');
const database = require('../backend/models/agent-database-service');
const router = require('../backend/routes/ai');

test('home administrator can commit and verify database edits without a workspace, with tenant and role boundaries', async t => {
    const originals = [settings.getRuntimeSettings, settings.getRedactionSecrets, provider.createClient];
    settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, maxOutputTokens: 2048 });
    settings.getRedactionSecrets = async () => [];
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenant.tenantMiddleware);
    app.use('/api/ai', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/ai/chat`;
    t.after(async () => {
        [settings.getRuntimeSettings, settings.getRedactionSecrets, provider.createClient] = originals;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await pool.closeAll();
        await appDb.closeDatabase();
        await platformDb.closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    for (const id of ['default', 'other']) {
        await tenant.runWithTenant(id, async () => {
            await appDb.run('CREATE TABLE assistant_items (id INTEGER PRIMARY KEY, label TEXT)');
            await appDb.run('INSERT INTO assistant_items VALUES (1, ?)', [`${id} before`]);
        });
        await sessions.saveSession(`admin-${id}`, `admin-${id}`, 'admin', Date.now() + 60000, id);
    }
    await sessions.saveSession('viewer-default', 'viewer', 'viewer', Date.now() + 60000, 'default');
    const request = (token, body) => fetch(url, { method: 'POST', headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'
    }, body: JSON.stringify({ agent: 'dragon-claw-home', pagePath: '/', messages: [{ role: 'user', content: '将 assistant_items 中 id 为 1 的 label 改为 changed 并核对' }], ...body }) });

    for (const id of ['default', 'other']) {
        let step = 0;
        const target = { database: 'platform:tools.db', table: 'assistant_items' };
        const calls = [
            ['list_databases', {}], ['database_schema', target], ['read_database_table', target],
            ['update_database_rows', { ...target, values: '{"label":"changed"}', filters: [{ column: 'id', op: 'eq', value: 1 }] }],
            ['read_database_table', target]
        ];
        provider.createClient = () => ({ model: 'mock', generateText: async options => {
            assert.ok(options.tools.some(tool => tool.name === 'update_database_rows'));
            assert.equal(options.tools.some(tool => tool.name === 'run_command' || tool.name === 'write_file'), false);
            assert.match(options.systemInstruction, /无需选择工作目录/);
            assert.doesNotMatch(options.systemInstruction, /你没有修改业务数据的权限/);
            if (step === 1) {
                const listed = JSON.parse(options.messages.at(-1).toolResults[0].content);
                assert.equal(listed.databases.find(item => item.id === 'platform:tools.db').writable, true);
                assert.equal(listed.databases.some(item => item.source === 'local'), false);
            }
            if (step === 3) {
                const read = JSON.parse(options.messages.at(-1).toolResults[0].content);
                assert.equal(read.writable, true);
                assert.equal(read.rows[0].label, `${id} before`);
            }
            if (step === 4) assert.equal(JSON.parse(options.messages.at(-1).toolResults[0].content).changes, 1);
            if (step === calls.length) {
                assert.equal(JSON.parse(options.messages.at(-1).toolResults[0].content).rows[0].label, 'changed');
                return { text: '已修改并回读核对。', toolCalls: [] };
            }
            const [name, args] = calls[step++];
            return { toolCalls: [{ id: `call-${step}`, name, args }] };
        } });
        const response = await request(`admin-${id}`, { stream: id === 'default' });
        assert.equal(response.status, 200);
        let done;
        if (id === 'default') {
            const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
            assert.equal(events.filter(event => event.type === 'tool_result' && event.ok).length, 5);
            done = events.find(event => event.type === 'done');
            assert.ok(done);
            await tenant.runWithTenant('other', async () => assert.equal((await appDb.get('SELECT label FROM assistant_items WHERE id=1')).label, 'other before'));
        } else done = await response.json();
        assert.match(done.reply, /已修改并回读核对/);
        await tenant.runWithTenant(id, async () => {
            assert.equal((await appDb.get('SELECT label FROM assistant_items WHERE id=1')).label, 'changed');
            const history = await chat.listMessages(done.sessionId, { owner: `admin-${id}` });
            assert.equal(history[1].events.filter(event => event.type === 'tool_result').length, 5);
        });
    }

    let plainCalls = 0;
    provider.createClient = () => ({ generateChat: async options => {
        plainCalls++;
        assert.match(options.systemInstruction, /你没有修改业务数据的权限/);
        return { text: '当前对话只读' };
    }, generateText: async () => assert.fail('read-only paths must not receive database write tools') });
    assert.equal((await request('viewer-default', { persist: false, readOnly: false })).status, 200);
    assert.equal((await request('admin-default', { persist: false, agent: 'page-assistant' })).status, 200);
    assert.equal(plainCalls, 2);

    // 不写 @：普通对话和已选 Downloads 目录的 full 工作区都自动加载脚本流程并真正复制入库。
    await appDb.run('CREATE TABLE uiv_scripts (id TEXT PRIMARY KEY, name TEXT, category TEXT, url TEXT, payload_json TEXT, updated_at TEXT)');
    await require('../backend/models/uiv-categories-repository').addCategory('PBI');
    const sourceScript = { id: 'pbi-source', name: 'PBI示例', url: 'https://example.com/data', category: 'PBI',
        payload: '{}', code: 'return 1;', consoleCode: 'return 1;' };
    await appDb.run('INSERT INTO uiv_scripts VALUES (?, ?, ?, ?, ?, ?)', [sourceScript.id, sourceScript.name, sourceScript.category, sourceScript.url, JSON.stringify(sourceScript), 'before']);
    const workspaceRoot = fs.mkdtempSync(path.join(sandbox, 'Downloads-'));
    for (const withWorkspace of [false, true]) {
        let step = 0;
        let nudged = false;
        let newId;
        provider.createClient = () => ({ model: 'mock', generateText: async options => {
            assert.match(options.systemInstruction, /### @script-data/);
            assert.ok(options.tools.some(tool => tool.name === 'save_uiv_script'));
            if (!nudged) {
                nudged = true;
                return { text: '我已检查结构，可以直接写入。' };
            }
            if (step++ === 0) return { toolCalls: [{ id: 'read-source', name: 'read_uiv_script', args: { id: sourceScript.id } }] };
            if (step === 2) {
                const source = JSON.parse(options.messages.at(-1).toolResults[0].content);
                return { toolCalls: [{ id: 'save-clone', name: 'save_uiv_script', args: { action: 'clone', sourceId: sourceScript.id,
                    expectedRevision: source.revision, changes: JSON.stringify({ name: withWorkspace ? 'PBI目录副本' : 'PBI普通副本' }) } }] };
            }
            if (step === 3) {
                const result = JSON.parse(options.messages.at(-1).toolResults[0].content);
                assert.equal(result.committed && result.verified, true);
                newId = result.id;
                return { toolCalls: [{ id: 'read-clone', name: 'read_uiv_script', args: { id: newId } }] };
            }
            assert.equal(JSON.parse(options.messages.at(-1).toolResults[0].content).id, newId);
            return { text: '副本已保存并核对。' };
        } });
        const copied = await request('admin-default', { stream: true,
            messages: [{ role: 'user', content: '复制 PBI示例 抓取脚本为一个新副本' }],
            ...(withWorkspace ? { workspace: { root: workspaceRoot, agentSessionId: 'script-workspace-test', permissionMode: 'full' } } : {}) });
        const events = (await copied.text()).trim().split('\n').map(line => JSON.parse(line));
        assert.ok(events.find(event => event.type === 'start').skills.some(skill => skill.id === 'script-data'));
        assert.match(events.find(event => event.type === 'done')?.reply || JSON.stringify(events), /副本已保存并核对/);
        assert.equal(events.some(event => event.type === 'approval'), false);
        assert.ok(await appDb.get('SELECT id FROM uiv_scripts WHERE id = ?', [newId]));
        if (!withWorkspace) {
            const done = events.find(event => event.type === 'done');
            let correctionStep = 0;
            provider.createClient = () => ({ model: 'mock', generateText: async options => {
                assert.match(options.systemInstruction, /### @script-data/, 'server history selects the Skill even when the client sends no context or chips');
                if (correctionStep++ === 0) return { text: '已还原地区参数，脚本现已就绪。' };
                if (correctionStep === 2) return { toolCalls: [{ id: 'verify-correction', name: 'read_uiv_script', args: { id: newId } }] };
                assert.equal(JSON.parse(options.messages.at(-1).toolResults[0].content).id, newId);
                return { text: '已核对数据库当前状态，本轮没有修改。' };
            } });
            const correction = await request('admin-default', { sessionId: done.sessionId,
                messages: [{ role: 'user', content: '地区部不用改，你再试一次' }] });
            assert.equal(correction.status, 200);
            assert.match((await correction.json()).reply, /本轮没有修改/);
            assert.equal(correctionStep, 3, 'an unsupported success claim is followed by a real read before the final answer');
        }
    }

    // 服务层也拒绝把无目录普通对话当成服务器任意文件访问入口。
    await assert.rejects(database.schema({ readOnly: false }, { database: 'local:/tmp/unselected.db' }), /先选择工作目录/);
    await assert.rejects(agent.runTurn({ ctx: { readOnly: true } }), /仅对管理员/);
    const denied = await agent.runTurn({ ctx: { readOnly: false }, systemInstruction: '', messages: [{ role: 'user', content: 'test' }], client: {
        generateText: async options => options.messages.at(-1).role === 'user'
            ? { toolCalls: [{ id: 'bad', name: 'write_file', args: { path: path.join(sandbox, 'must-not-exist'), content: 'bad' } }] }
            : (assert.equal(options.messages.at(-1).toolResults[0].isError, true), { text: '工具不可用' })
    } });
    assert.equal(denied.toolLog[0].ok, false);
    assert.equal(fs.existsSync(path.join(sandbox, 'must-not-exist')), false);
});

test('unsupported models report unavailable tools and aborts stop before provider calls', async () => {
    const result = await agent.runTurn({ ctx: { readOnly: false }, messages: [{ role: 'user', content: '修改数据' }], systemInstruction: '', client: {
        generateText: async () => { throw Object.assign(new Error('unsupported'), { code: 'AI_TOOLS_UNSUPPORTED' }); },
        generateChat: async options => {
            assert.match(options.systemInstruction, /本轮无法读取或修改数据库/);
            return { text: '请切换支持工具调用的模型' };
        }
    } });
    assert.equal(result.toolsUnsupported, true);
    assert.deepEqual(result.toolLog, []);
    await assert.rejects(agent.runTurn({ ctx: { readOnly: false }, systemInstruction: '', messages: [], signal: AbortSignal.abort(), client: {
        generateText: async () => assert.fail('aborted turn must not call provider')
    } }), { name: 'AbortError' });
});
