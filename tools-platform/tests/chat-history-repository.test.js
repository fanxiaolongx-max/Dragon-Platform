const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-chat-history-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const repo = require('../backend/models/chat-history-repository');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const { getDataDir, runWithTenant } = require('../backend/models/tenant-context');

function writeChat(name, content) {
    const filePath = path.join(sandbox, name);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

test('chat parser recognizes exported headers and nested conversation categories', () => {
    assert.deepEqual(repo.parseHeader('张三(zhang001) 2026-08-01 09:10:11'), {
        senderName: '张三',
        senderId: 'zhang001',
        messageTime: '2026-08-01 09:10:11'
    });
    assert.equal(repo.parseHeader('+++ USCDB/*MEID:81 MENAME:AbuUSCDBUPCF01*/ 2026-01-05 14:43:14'), null);
    assert.equal(repo.parseHeader('ticket close due date = 2026-08-01 17:03:33'), null);
    assert.equal(repo.isExcludedHeaderLine('\u200B+++ UPCF/*MEID:232*/ 2025-12-25 03:02:59'), true);
    assert.equal(repo.parseHeader('这是正文'), null);
    assert.equal(repo.classifyConversation('聊天记录/单聊/华北/张三.txt'), 'single');
    assert.equal(repo.classifyConversation('HistoryRecord（文字）/联系人/高驰(g00365464).txt'), 'single');
    assert.equal(repo.classifyConversation('聊天记录/群组/项目群.txt'), 'group');
    assert.equal(repo.classifyConversation('HistoryRecord（文字）/固定群/项目交付群(123456).txt'), 'group');
    assert.equal(repo.classifyConversation('聊天记录/讨论组/故障讨论.txt'), 'discussion');
    assert.equal(repo.normalizeRelativePath('../聊天记录/单聊/张三.txt'), '聊天记录/单聊/张三.txt');
});

test('chat history imports, searches, preserves personal state and isolates tenants', async t => {
    t.after(async () => {
        await tenantPool.closeAll();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    const filePath = writeChat('zhangsan.txt', [
        '\uFEFF张三(zhang001) 2026-08-01 09:10:11',
        '你好，这是第一条',
        '这是第二行',
        '我(my001) 2026-08-01 09:12:00',
        '收到，稍后处理',
        '张三(zhang001) 2026-08-02 10:00:00',
        '项目已经完成'
    ].join('\n'));

    const imported = await repo.importTxtFile({
        filePath,
        relativePath: '聊天记录/单聊/华北/张三.txt',
        modifiedAt: Date.now()
    });
    assert.equal(imported.messageCount, 3);
    assert.equal(imported.conversationType, 'single');
    assert.equal(fs.existsSync(path.join(getDataDir(), 'chat-history.db')), true);

    await new Promise((resolve, reject) => tenantPool.getConnection(repo.DB_FILENAME).run(
        'UPDATE chat_conversations SET conversation_type=? WHERE id=?',
        ['other', imported.conversationId],
        error => error ? reject(error) : resolve()
    ));
    assert.equal(await repo.syncConversationTypes(), 1);
    assert.equal((await repo.getConversation(imported.conversationId, 'alice')).conversation_type, 'single');

    await repo.saveUserSettings('alice', { mySenderId: 'my001' });
    const serviceStatus = repo.getServiceStatus();
    assert.equal(serviceStatus.ready, true);
    assert.equal(serviceStatus.initialization.phase, 'ready');
    assert.equal(serviceStatus.database.exists, true);
    const conversations = await repo.listConversations('alice');
    assert.equal(conversations.total, 1);
    assert.equal(conversations.items[0].unread_count, 2);
    assert.equal(conversations.items[0].conversation_type, 'single');
    for (const q of ['张三', '华北', 'zhangsan', 'zs', 'zhangs', 'huabei', 'hb']) {
        assert.equal((await repo.listConversations('alice', { q })).total, 1, `会话搜索应命中：${q}`);
    }
    for (const q of ['lisi', 'zx', '李四']) {
        assert.equal((await repo.listConversations('alice', { q })).total, 0, `会话搜索不应命中：${q}`);
    }

    const messages = await repo.listMessages(imported.conversationId, 'alice', { limit: 20 });
    assert.equal(messages.items.length, 3);
    assert.equal(messages.items[0].content, '你好，这是第一条\n这是第二行');
    const newestMessagePage = await repo.listMessages(imported.conversationId, 'alice', { limit: 2 });
    assert.equal(newestMessagePage.items.length, 2);
    assert.equal(newestMessagePage.hasMore, true);
    const olderMessagePage = await repo.listMessages(imported.conversationId, 'alice', { limit: 2, before: newestMessagePage.nextBefore });
    assert.equal(olderMessagePage.items.length, 1);
    assert.equal(olderMessagePage.hasMore, false);
    const favoriteKey = messages.items[0].stable_key;
    await repo.setFavorite('alice', favoriteKey, true);
    await repo.setPinned('alice', imported.conversationId, true);
    await repo.markRead('alice', imported.conversationId);
    assert.equal((await repo.listConversations('alice')).items[0].unread_count, 0);
    assert.equal((await repo.listConversations('alice')).items[0].pinned, 1);

    const search = await repo.searchMessages('alice', { keyword: '项目已经', favorites: '' });
    assert.equal(search.total, 1);
    assert.equal(search.items[0].sender_id, 'zhang001');
    const senderSearch = await repo.searchMessages('alice', { senderId: 'zhang001' });
    assert.equal(senderSearch.total, 2);
    assert.equal(senderSearch.items.every(item => item.sender_id === 'zhang001'), true);
    const firstSenderSearchPage = await repo.searchMessages('alice', { senderId: 'zhang001', limit: 1, offset: 0 });
    const secondSenderSearchPage = await repo.searchMessages('alice', { senderId: 'zhang001', limit: 1, offset: 1 });
    assert.equal(firstSenderSearchPage.items.length, 1);
    assert.equal(secondSenderSearchPage.items.length, 1);
    assert.notEqual(firstSenderSearchPage.items[0].id, secondSenderSearchPage.items[0].id);
    const favoriteSearch = await repo.searchMessages('alice', { favorites: '1' });
    assert.equal(favoriteSearch.total, 1);

    fs.appendFileSync(filePath, '\n我(my001) 2026-08-03 11:00:00\n谢谢');
    const updated = await repo.importTxtFile({
        filePath,
        relativePath: '聊天记录/单聊/华北/张三.txt',
        modifiedAt: Date.now()
    });
    assert.equal(updated.messageCount, 4);
    assert.equal((await repo.searchMessages('alice', { favorites: '1' })).total, 1);
    const skipped = await repo.importTxtFile({ filePath, relativePath: '聊天记录/单聊/华北/张三.txt' });
    assert.equal(skipped.skipped, true);

    const overview = await repo.getOverviewStats('alice');
    assert.equal(overview.summary.message_count, 4);
    assert.equal(overview.summary.identified_messages, 4);
    assert.equal(overview.summary.unidentified_messages, 0);
    assert.equal(overview.summary.recognition_rate, '100.0%');

    const relationshipGraph = await repo.getRelationshipGraph('alice');
    assert.equal(relationshipGraph.mode, 'chat');
    assert.equal(relationshipGraph.configured, true);
    assert.equal(relationshipGraph.nodes.find(node => node.id === 'chat-root').senderId, 'my001');
    assert.equal(relationshipGraph.stats.conversations, 1);
    assert.equal(relationshipGraph.stats.people, 1);
    assert.equal(relationshipGraph.nodes.some(node => node.type === 'chatConversation' && node.conversationType === 'single'), true);
    assert.equal(relationshipGraph.nodes.some(node => node.type === 'chatPerson' && node.senderId === 'zhang001'), true);
    assert.equal(relationshipGraph.edges.some(edge => edge.source === 'chat-root' && edge.activity > 0), true);

    await repo.invalidateAnalyticsCache();
    const uncachedOverview = await repo.getOverviewStats('alice');
    const cachedOverview = await repo.getOverviewStats('alice');
    assert.equal(uncachedOverview.analyticsCache.hit, false);
    assert.equal(cachedOverview.analyticsCache.hit, true);
    assert.equal(cachedOverview.analyticsCache.dataVersion, uncachedOverview.analyticsCache.dataVersion);

    const directory = await repo.listPersonDirectory();
    assert.equal(directory.total, 2);
    assert.deepEqual(directory.items.map(d => d.sender_id).sort(), ['my001', 'zhang001']);
    assert.equal(directory.items.find(d => d.sender_id === 'zhang001').sender_name, '张三');
    const firstDirectoryPage = await repo.listPersonDirectory({ limit: 1, offset: 0 });
    const secondDirectoryPage = await repo.listPersonDirectory({ limit: 1, offset: 1 });
    assert.equal(firstDirectoryPage.total, 2);
    assert.equal(firstDirectoryPage.items.length, 1);
    assert.equal(secondDirectoryPage.items.length, 1);
    assert.notEqual(firstDirectoryPage.items[0].sender_id, secondDirectoryPage.items[0].sender_id);

    await repo.updatePersonDirectory('zhang001', { senderName: '张三丰', aliasNames: '三丰' });
    const updatedDir = await repo.listPersonDirectory({ q: '三丰' });
    assert.equal(updatedDir.total, 1);
    assert.equal(updatedDir.items[0].sender_name, '张三丰');
    const updatedMessages = await repo.listMessages(imported.conversationId, 'alice');
    assert.equal(updatedMessages.items.find(m => m.sender_id === 'zhang001').sender_name, '张三丰');

    // Test unidentified messages and recognition rate
    const unidentPath = writeChat('unident.txt', [
        '系统通知 2026-08-04 15:00:00',
        '服务重启完成',
        '王工(wang001) 2026-08-04 15:01:00',
        '已确认恢复正常'
    ].join('\n'));
    await repo.importTxtFile({ filePath: unidentPath, relativePath: '聊天记录/群组/报警通知.txt' });
    const unidentStats = await repo.getUnidentifiedMessages();
    assert.equal(unidentStats.total, 1);
    assert.equal(unidentStats.items[0].sender_name, '系统通知');
    assert.equal(unidentStats.items[0].issue_type, '缺失工号（仅有昵称）');

    const overviewAfterUnident = await repo.getOverviewStats('alice');
    assert.equal(overviewAfterUnident.analyticsCache.hit, false, '导入新数据后应使旧分析缓存失效');
    assert.ok(overviewAfterUnident.analyticsCache.dataVersion > cachedOverview.analyticsCache.dataVersion);
    assert.equal(overviewAfterUnident.summary.unidentified_messages, 1);
    assert.equal(overviewAfterUnident.summary.identified_messages, 5);

    // Test group conversation stats
    const groupStats = await repo.getGroupStats();
    assert.equal(groupStats.items.length >= 1, true);
    assert.equal(groupStats.total >= groupStats.items.length, true);
    assert.equal(groupStats.offset, 0);
    const alertGroup = groupStats.items.find(g => g.display_name === '报警通知');
    assert.ok(alertGroup);
    assert.equal(alertGroup.conversation_type, 'group');
    assert.equal(alertGroup.message_count, 2);
    assert.equal(alertGroup.sender_count, 2);
    assert.equal(alertGroup.top_speaker_name, '王工');
    assert.equal(alertGroup.top_speaker_count, 1);
    assert.equal((await repo.getGroupStats({ q: '报警' })).items.length, 1);
    assert.equal((await repo.getGroupStats({ type: 'discussion' })).items.length, 0);

    // Test group detailed operational analysis
    const groupAnalysis = await repo.getGroupDetailedAnalysis(alertGroup.conversation_id);
    assert.ok(groupAnalysis);
    assert.equal(groupAnalysis.conversation.display_name, '报警通知');
    assert.equal(groupAnalysis.overview.total_messages, 2);
    assert.equal(groupAnalysis.overview.sender_count, 2);
    assert.ok(groupAnalysis.diagnosis.summary.length > 0);
    assert.equal(groupAnalysis.hourly_distribution.length, 24);
    assert.equal(groupAnalysis.members.length, 2);
    assert.ok(groupAnalysis.members[0].persona_role);
    assert.equal(groupAnalysis.conversation.persona_style, 'operations');

    const savedPersonaStyle = await repo.saveGroupPersonaStyle(alertGroup.conversation_id, 'nature');
    assert.equal(savedPersonaStyle.personaStyle, 'nature');
    assert.equal((await repo.getGroupDetailedAnalysis(alertGroup.conversation_id)).conversation.persona_style, 'nature');
    assert.equal((await repo.saveGroupPersonaStyle(alertGroup.conversation_id, 'pets')).personaStyle, 'pets');
    assert.equal((await repo.saveGroupPersonaStyle(alertGroup.conversation_id, 'dessert')).personaStyle, 'dessert');
    await repo.saveGroupPersonaStyle(alertGroup.conversation_id, 'nature');
    await assert.rejects(
        repo.saveGroupPersonaStyle(alertGroup.conversation_id, 'unknown-style'),
        /不支持的运营角色画像风格/
    );
    assert.equal(await repo.saveGroupPersonaStyle(imported.conversationId, 'team'), null);

    // Test data isolation & cleanup test
    const testDataPath = writeChat('test_data.txt', '测试小李(test001) 2026-08-05 10:00:00\n这是模拟测试消息');
    await repo.importTxtFile({ filePath: testDataPath, relativePath: '测试数据/01-架构组/模拟.txt' });
    const markedTestPath = writeChat('marked_test.txt', '测试陈工(marked001) 2026-08-05 11:00:00\n显式标记的测试消息');
    await repo.importTxtFile({
        filePath: markedTestPath,
        relativePath: '聊天记录/单聊/显式标记测试.txt',
        dataKind: 'test'
    });
    const legacyTestPath = writeChat('legacy_test.txt', '赵运维(zhao_ops) 2026-08-28 14:15:00\n【P1 告警】网关服务 504 Gateway Timeout 比例突增至 12%');
    await repo.importTxtFile({
        filePath: legacyTestPath,
        relativePath: '聊天记录/讨论组/线上生产事故排查紧急讨论组.txt'
    });
    const sameNameRealPath = writeChat('same_name_real.txt', '王经理(real001) 2026-08-06 09:00:00\n这是同名的真实会话，不包含测试数据特征');
    await repo.importTxtFile({
        filePath: sameNameRealPath,
        relativePath: '聊天记录/单聊/产品设计部/王经理-产品总监.txt'
    });
    assert.equal((await repo.listConversations('alice')).total, 6);
    const deleteTestResult = await repo.deleteTestDataSources();
    assert.equal(deleteTestResult.deletedCount, 3);
    assert.equal(deleteTestResult.sources.includes('聊天记录/讨论组/线上生产事故排查紧急讨论组.txt'), true);
    assert.equal((await repo.listConversations('alice')).total, 3);
    const retainedSameNameSource = (await repo.listSources({ q: '王经理-产品总监' })).items[0];
    assert.ok(retainedSameNameSource, '仅名称命中旧测试清单时不应误删真实会话');
    await repo.deleteSource(retainedSameNameSource.id);
    assert.equal((await repo.listConversations('alice')).total, 2);
    // Real conversations remain intact
    assert.equal((await repo.listConversations('alice')).items.some(c => c.display_name === '张三'), true);

    // Test paginated listSources
    const sourcesPaged = await repo.listSources({ limit: 1, page: 1 });
    assert.equal(sourcesPaged.total, 2);
    assert.equal(sourcesPaged.totalPages, 2);
    assert.equal(sourcesPaged.items.length, 1);
    const sourcesSearch = await repo.listSources({ q: '张三' });
    assert.equal(sourcesSearch.total, 1);
    assert.equal(sourcesSearch.items[0].display_name, '张三');
    const sourcesType = await repo.listSources({ type: 'group' });
    assert.equal(sourcesType.total, 1);
    assert.equal(sourcesType.items[0].conversation_type, 'group');

    const people = await repo.getPeopleStats('alice');
    assert.deepEqual(people.items.map(item => item.sender_id).filter(Boolean).sort(), ['my001', 'wang001', 'zhang001']);
    const firstPeoplePage = await repo.getPeopleStats('alice', { limit: 1, offset: 0 });
    const secondPeoplePage = await repo.getPeopleStats('alice', { limit: 1, offset: 1 });
    assert.equal(firstPeoplePage.total, 4);
    assert.equal(firstPeoplePage.items.length, 1);
    assert.equal(secondPeoplePage.items.length, 1);
    assert.notEqual(firstPeoplePage.items[0].sender_id, secondPeoplePage.items[0].sender_id);

    await runWithTenant('tenant-b', async () => {
        assert.equal((await repo.listConversations('alice')).total, 0);
        const groupPath = writeChat('group.txt', '李四(li001) 2026-08-04 12:00:00\n群消息');
        const tenantGroup = await repo.importTxtFile({ filePath: groupPath, relativePath: '聊天记录/群组/交付群.txt' });
        assert.equal((await repo.listConversations('alice')).items[0].conversation_type, 'group');
        assert.equal((await repo.getGroupDetailedAnalysis(tenantGroup.conversationId)).conversation.persona_style, 'operations');
        await repo.saveGroupPersonaStyle(tenantGroup.conversationId, 'team');
        assert.equal((await repo.getGroupDetailedAnalysis(tenantGroup.conversationId)).conversation.persona_style, 'team');
        assert.equal(await repo.saveGroupPersonaStyle(alertGroup.conversation_id, 'energy'), null);
        assert.equal(fs.existsSync(path.join(getDataDir(), 'chat-history.db')), true);
    });

    await runWithTenant('parser-rules', async () => {
        const scriptPath = writeChat('script-output.txt', [
            '薛丹(x00518959) 2026-01-05 20:43:00',
            'LST PODHEALCTRL:;',
            '+++ USCDB/*MEID:81 MENAME:AbuUSCDBUPCF01*/ 2026-01-05 14:43:14',
            'O&M #919',
            'RETCODE = 0 Operation succeeded'
        ].join('\n'));
        const first = await repo.importTxtFile({ filePath: scriptPath, relativePath: '聊天记录/单聊/薛丹.txt' });
        assert.equal(first.messageCount, 1);
        const scriptMessages = await repo.listMessages(first.conversationId, 'alice');
        assert.match(scriptMessages.items[0].content, /\+\+\+ USCDB/);
        assert.match(scriptMessages.items[0].content, /RETCODE = 0/);

        const defaults = await repo.listParserExclusionRules();
        assert.equal(defaults.length >= 4, true);
        const custom = await repo.createParserExclusionRule({
            name: '自定义脚本标记',
            matchType: 'contains',
            pattern: 'CUSTOM-SCRIPT',
            enabled: true
        });
        assert.equal(custom.pattern, 'CUSTOM-SCRIPT');
        const reparsed = await repo.importTxtFile({ filePath: scriptPath, relativePath: '聊天记录/单聊/薛丹.txt' });
        assert.equal(reparsed.skipped, false);
        const disabled = await repo.updateParserExclusionRule(custom.id, { enabled: false });
        assert.equal(disabled.enabled, 0);
        assert.equal((await repo.deleteParserExclusionRule(custom.id)).id, custom.id);
        await assert.rejects(
            repo.createParserExclusionRule({ name: '坏正则', matchType: 'regex', pattern: '[', enabled: true }),
            /正则表达式无效/
        );
    });

    await runWithTenant('legacy-chat-schema', async () => {
        const connection = tenantPool.getConnection(repo.DB_FILENAME);
        await new Promise((resolve, reject) => connection.run(`CREATE TABLE chat_sources (
            id TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL UNIQUE,
            source_hash TEXT NOT NULL DEFAULT '',
            file_size INTEGER NOT NULL DEFAULT 0,
            modified_at INTEGER NOT NULL DEFAULT 0,
            imported_at TEXT NOT NULL,
            message_count INTEGER NOT NULL DEFAULT 0
        )`, error => error ? reject(error) : resolve()));
        await repo.ensureReady();
        const columns = await new Promise((resolve, reject) => connection.all(
            'PRAGMA table_info(chat_sources)',
            (error, rows) => error ? reject(error) : resolve(rows)
        ));
        assert.equal(columns.some(column => column.name === 'parser_signature'), true);
        assert.equal(columns.some(column => column.name === 'data_kind'), true);
    });

    assert.equal((await repo.listConversations('alice')).total, 2);
    assert.equal((await repo.getGroupDetailedAnalysis(alertGroup.conversation_id)).conversation.persona_style, 'nature');
    assert.equal((await repo.listParserExclusionRules()).some(rule => rule.name === '自定义脚本标记'), false);
});
