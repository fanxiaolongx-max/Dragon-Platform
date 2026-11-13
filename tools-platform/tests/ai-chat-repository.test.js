const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-ai-chat-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');

const repo = require('../backend/models/ai-chat-repository');
const { closeDatabase } = require('../backend/models/app-db');

test('ai-chat-repository: global cross-page session archive and retrieval', async t => {
    t.after(async () => {
        await closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    await repo.ensureReady();

    // 1. 在两个不同页面各创建一个活跃会话
    const session1Id = await repo.addMessage({
        pagePath: '/pages/meeting-attendance.html',
        pageTitle: '会议考勤分析',
        role: 'user',
        content: '请帮我提取考勤表里的客户群和工号'
    });
    await repo.addMessage({
        sessionId: session1Id,
        pagePath: '/pages/meeting-attendance.html',
        pageTitle: '会议考勤分析',
        role: 'model',
        content: '好的，正在提取客户群与工号信息。'
    });

    const session2Id = await repo.addMessage({
        pagePath: '/pages/sla-rules.html',
        pageTitle: 'SLA规则配置',
        role: 'user',
        content: '当前SLA规则达标率是多少？'
    });
    await repo.addMessage({
        sessionId: session2Id,
        pagePath: '/pages/sla-rules.html',
        pageTitle: 'SLA规则配置',
        role: 'model',
        content: '当前SLA规则达标率为95.6%。'
    });

    // 2. 验证单页面查询 listSessions 仅返回本页会话
    const page1Sessions = await repo.listSessions({ pagePath: '/pages/meeting-attendance.html' });
    assert.equal(page1Sessions.length, 1);
    assert.equal(page1Sessions[0].id, session1Id);

    const page2Sessions = await repo.listSessions({ pagePath: '/pages/sla-rules.html' });
    assert.equal(page2Sessions.length, 1);
    assert.equal(page2Sessions[0].id, session2Id);

    // 3. 验证全局跨页面 listArchivedSessions 默认返回租户内所有页面的历史会话（无论 active 还是 archived）
    const allSessions = await repo.listArchivedSessions();
    assert.equal(allSessions.total, 2);
    assert.equal(allSessions.items.length, 2);
    assert.equal(allSessions.items[0].id, session2Id); // 最新的排在前面
    assert.equal(allSessions.items[1].id, session1Id);
    assert.equal(allSessions.items[0].is_archived, 0);
    assert.equal(allSessions.items[1].is_archived, 0);

    // 4. 验证关键词全文搜索（页面标题、路径、消息内容）
    const searchByTitle = await repo.listArchivedSessions({ query: '会议考勤' });
    assert.equal(searchByTitle.total, 1);
    assert.equal(searchByTitle.items[0].id, session1Id);

    const searchByContent = await repo.listArchivedSessions({ query: '达标率' });
    assert.equal(searchByContent.total, 1);
    assert.equal(searchByContent.items[0].id, session2Id);

    // 5. 验证状态筛选：未归档前，archivedOnly / status='archived' 应返回 0
    const archivedOnlyBefore = await repo.listArchivedSessions({ archivedOnly: true });
    assert.equal(archivedOnlyBefore.total, 0);
    assert.equal(archivedOnlyBefore.items.length, 0);

    // 6. 手动将 session1 归档
    await repo.setSessionArchived(session1Id, true);
    const session1AfterArchive = await repo.getSession(session1Id);
    assert.equal(session1AfterArchive.is_archived, 1);

    // 7. 验证全局跨页面查询依然同时包含 session1 (archived) 与 session2 (active)
    const afterArchiveAll = await repo.listArchivedSessions();
    assert.equal(afterArchiveAll.total, 2);
    const item1 = afterArchiveAll.items.find(item => item.id === session1Id);
    const item2 = afterArchiveAll.items.find(item => item.id === session2Id);
    assert.equal(item1.is_archived, 1);
    assert.equal(item2.is_archived, 0);

    // 8. 验证按状态筛选
    const archivedOnly = await repo.listArchivedSessions({ status: 'archived' });
    assert.equal(archivedOnly.total, 1);
    assert.equal(archivedOnly.items[0].id, session1Id);

    const activeOnly = await repo.listArchivedSessions({ status: 'active' });
    assert.equal(activeOnly.total, 1);
    assert.equal(activeOnly.items[0].id, session2Id);

    // 9. 恢复 session1 归档
    await repo.setSessionArchived(session1Id, false);
    const session1Restored = await repo.getSession(session1Id);
    assert.equal(session1Restored.is_archived, 0);
});

test('ai-chat-repository: scratch directories are never exposed or persisted as session workspace', async () => {
    assert.equal(repo.isScratchDirectory('/private/var/folders/24/T/dragon-claw-scratch/5926f323fced0775'), true);
    assert.equal(repo.isScratchDirectory('/tmp/dragon-claw-scratch/5926f323fced0775'), true);
    assert.equal(repo.isScratchDirectory('/data/tenant/scratch/5926f323fced0775'), true);
    assert.equal(repo.isScratchDirectory('/Volumes/512G/my-project'), false);

    const normalId = await repo.addMessage({ pagePath: '/', role: 'user', content: 'Normal chat', owner: 'testuser' });
    await repo.setSessionAgent(normalId, { agentSessionId: 'scratch-1', root: '/tmp/dragon-claw-scratch/12345', owner: 'testuser' });
    let sessions = await repo.listOwnedSessions({ owner: 'testuser', pagePath: '/' });
    let session = sessions.find(s => s.id === normalId);
    assert.equal(session?.agent, null, 'scratch directory was not saved to session');

    await repo.setSessionAgent(normalId, { agentSessionId: 'real-1', root: '/Users/dragon/project', owner: 'testuser' });
    sessions = await repo.listOwnedSessions({ owner: 'testuser', pagePath: '/' });
    session = sessions.find(s => s.id === normalId);
    assert.deepEqual(session?.agent, { agentSessionId: 'real-1', root: '/Users/dragon/project' });
});
