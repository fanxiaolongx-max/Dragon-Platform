'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-knowledge-ai-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const pool = require('../backend/models/tenant-sqlite-pool');
const platformDb = require('../backend/models/platform-db');
const appDb = require('../backend/models/app-db');
const sessions = require('../backend/models/auth-sessions-repository');
const aiSettingsRepo = require('../backend/models/ai-settings-repository');
const aiProviderClient = require('../backend/models/ai-provider-client');
const { checkAuth } = require('../backend/middleware/auth');
const { tenantMiddleware } = require('../backend/models/tenant-context');
const knowledgeAi = require('../backend/models/datacom-knowledge-ai');
const router = require('../backend/routes/datacom-knowledge');

const endpoint = '/api/datacom-knowledge';
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api', checkAuth, tenantMiddleware);
app.use(endpoint, router);

// 替换平台 AI：按提示词返回固定内容，并分段触发 onDelta
let aiAvailable = true;
let lastPrompt = '';
let replyFor = () => '答案正文\n<<<META>>>\n{"title":"P-bit 防环","brief":"ABR 缺省 P=0 防止回灌"}';
aiSettingsRepo.getRuntimeSettings = async () => ({ hasApiKey: aiAvailable, keyLooksValid: aiAvailable, provider: 'test', model: 'stub', maxOutputTokens: 2048 });
aiProviderClient.createClient = () => ({
    async generateText({ prompt, systemInstruction, onDelta }) {
        lastPrompt = `${systemInstruction}\n${prompt}`;
        const text = replyFor(prompt);
        for (let i = 0; i < text.length; i += 7) onDelta?.(text.slice(i, i + 7));
        return { text };
    }
});

function api(method, url, token = 'ai-admin') {
    return request(app)[method](`${endpoint}${url}`).set('Authorization', `Bearer ${token}`);
}

function events(response) {
    return response.text.trim().split('\n').map(line => JSON.parse(line));
}

test.before(async () => {
    const expiry = Date.now() + 600000;
    await sessions.saveSession('ai-admin', 'admin', 'admin', expiry);
    await sessions.saveSession('ai-viewer', 'viewer', 'user', expiry);
    await sessions.saveSession('ai-other', 'other', 'user', expiry);
});

test.after(async () => {
    await pool.closeAll();
    await appDb.closeDatabase();
    await platformDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('rendered selections map back to the markdown source', () => {
    const md = '## 规则\n\n只有 **P-bit = 1** 且 `FA != 0` 的 7 类 LSA 才翻译。\n\n另一段：只有 **P-bit = 1** 才行。';
    const hit = knowledgeAi.locateQuote(md, { exact: '只有 P-bit = 1 且 FA != 0 的 7 类', prefix: '规则', suffix: 'LSA 才翻译' });
    assert.equal(hit.original, '只有 **P-bit = 1** 且 `FA != 0` 的 7 类');
    assert.equal(md.slice(hit.start, hit.end), hit.original);
    const second = knowledgeAi.locateQuote(md, { exact: '只有 P-bit = 1', prefix: '另一段：', suffix: '才行' });
    assert.ok(second.start > hit.end, '用前后文区分重复出现的文字');
    assert.equal(knowledgeAi.locateQuote(md, { exact: '不存在的句子' }), null);
    const meta = knowledgeAi.splitMeta('正文内容\n<<<META>>>\n```json\n{"title":"标题","brief":"要点"}\n```');
    assert.deepEqual({ body: meta.body, title: meta.title, brief: meta.brief }, { body: '正文内容', title: '标题', brief: '要点' });
});

test('any logged-in user can ask; answers stream, get an AI title and are saved as highlights', async () => {
    await request(app).post(`${endpoint}/ai/ask`).send({}).expect(401);
    const status = await api('get', '/ai/status', 'ai-viewer').expect(200);
    assert.equal(status.body.available, true);
    assert.equal(status.body.canRewrite, false);

    const anchor = { type: 'text', field: 'body', exact: 'Init', prefix: '', suffix: '' };
    const response = await api('post', '/ai/ask', 'ai-viewer').send({ mode: 'qa', question: '为什么停在 Init？', articleId: 'ospf-fsm', anchor }).expect(200);
    const list = events(response);
    assert.equal(list[0].type, 'start');
    assert.ok(list.filter(item => item.type === 'delta').length > 2, '分段推送');
    const done = list.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.annotation.title, 'P-bit 防环');
    assert.equal(done.annotation.brief, 'ABR 缺省 P=0 防止回灌');
    assert.equal(done.annotation.turns[0].a, '答案正文');
    assert.equal(done.annotation.createdBy, 'viewer');
    assert.match(lastPrompt, /OSPF 邻居状态机/, '提示词带上文章上下文');

    const follow = events(await api('post', '/ai/ask', 'ai-viewer').send({ mode: 'qa', question: '再举个例子', annotationId: done.annotation.id }).expect(200)).at(-1);
    assert.equal(follow.annotation.id, done.annotation.id);
    assert.equal(follow.annotation.turns.length, 2);
    assert.match(lastPrompt, /为什么停在 Init/, '追问带上历史问答');

    const listed = await api('get', '/annotations?articleId=ospf-fsm', 'ai-other').expect(200);
    assert.equal(listed.body.annotations.length, 1);
    await api('delete', `/annotations/${done.annotation.id}`, 'ai-other').expect(403);
    await api('put', `/annotations/${done.annotation.id}`, 'ai-viewer').send({ title: '我的标题', content: '人工修订' }).expect(200);
    const edited = (await api('get', '/annotations?articleId=ospf-fsm').expect(200)).body.annotations[0];
    assert.equal(edited.title, '我的标题');
    assert.equal(edited.turns.at(-1).a, '人工修订');
});

test('notes on 3D scenes keep the scene state for jumping back', async () => {
    const response = await api('post', '/ai/ask', 'ai-viewer').send({
        mode: 'note', articleId: null, quote: 'R3 ABR',
        visualContext: '3D 场景：OSPF 区域与 LSA 泛洪\n选中部件：R3 ABR',
        anchor: { type: 'visual', visualId: 'area-flood', partId: 'R3', partName: 'R3 ABR', t: 0.42, options: { lsa: 5, area2: 'nssa', junk: { nested: true } } }
    }).expect(200);
    const done = events(response).at(-1);
    assert.equal(done.annotation.anchor.visualId, 'area-flood');
    assert.equal(done.annotation.anchor.t, 0.42);
    assert.deepEqual(done.annotation.anchor.options, { lsa: 5, area2: 'nssa', junk: '[object Object]' });
    assert.match(lastPrompt, /选中部件：R3 ABR/);
    const byVisual = await api('get', '/annotations?visualId=area-flood').expect(200);
    assert.equal(byVisual.body.annotations.length, 1);
});

test('only admins can rewrite; applying checks the revision and records the change', async () => {
    const denied = events(await api('post', '/ai/ask', 'ai-viewer').send({ mode: 'rewrite', articleId: 'ospf-router-id', anchor: { type: 'text', field: 'body', exact: '进程下手工配置' } }).expect(200)).at(-1);
    assert.equal(denied.type, 'error');
    assert.equal(denied.code, 'DATACOM_FORBIDDEN');

    replyFor = () => '进程视图下手工指定（最高优先级）\n<<<META>>>\n{"title":"改写","brief":"措辞更清晰"}';
    const { body: before } = await api('get', '/articles/ospf-router-id').expect(200);
    const proposal = events(await api('post', '/ai/ask').send({ mode: 'rewrite', articleId: 'ospf-router-id', anchor: { type: 'text', field: 'body', exact: '进程下手工配置 (最高优)', prefix: '1.', suffix: '：在系统视图下' } }).expect(200)).at(-1);
    assert.equal(proposal.type, 'done', JSON.stringify(proposal));
    assert.equal(proposal.rewrite.original, '进程下手工配置 (最高优)', '只替换加粗标记内的文字，保留原格式');
    assert.equal(proposal.rewrite.replacement, '进程视图下手工指定（最高优先级）');

    await api('post', '/ai/apply', 'ai-viewer').send({ articleId: 'ospf-router-id', rewrite: proposal.rewrite }).expect(403);
    const applied = await api('post', '/ai/apply').send({ articleId: 'ospf-router-id', rewrite: proposal.rewrite, title: proposal.title, brief: proposal.brief }).expect(200);
    assert.equal(applied.body.revision, before.article.revision + 1);
    assert.equal(applied.body.annotation.kind, 'rewrite');
    assert.equal(applied.body.annotation.turns[0].before, '进程下手工配置 (最高优)');
    const { body: after } = await api('get', '/articles/ospf-router-id').expect(200);
    assert.match(after.article.bodyMd, /\*\*进程视图下手工指定（最高优先级）\*\*/);
    assert.doesNotMatch(after.article.bodyMd, /进程下手工配置 \(最高优\)/);

    const stale = await api('post', '/ai/apply').send({ articleId: 'ospf-router-id', rewrite: proposal.rewrite }).expect(409);
    assert.equal(stale.body.code, 'DATACOM_REVISION_CONFLICT');
});

test('a missing AI configuration is reported instead of failing silently', async () => {
    aiAvailable = false;
    const result = events(await api('post', '/ai/ask', 'ai-viewer').send({ mode: 'qa', question: 'x', articleId: 'ospf-fsm', anchor: { type: 'article' } }).expect(200)).at(-1);
    assert.equal(result.type, 'error');
    assert.equal(result.code, 'DATACOM_AI_UNAVAILABLE');
    aiAvailable = true;
});
