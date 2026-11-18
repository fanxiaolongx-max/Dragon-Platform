// Run: node_modules/.bin/electron tests/welink-live-stream-browser.cjs
// Verifies:
// 1. Channel sidebar list layout: zero overlap across rest, hover/menu-open, pinned, and touch viewports.
// 2. Channel dedicated collapsible Pinned ("置顶") section with strict isolation from regular chat pins.
// 3. Real-time SSE live streaming waterfall, silky collapsible thinking accordion, tool status, DB reconciliation,
//    keycap emoji normalization, and horizontal rule rendering.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'welink-live-ui-'));
app.setPath('userData', path.join(temp, 'profile'));

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
const evaluate = fnOrCode => win.webContents.executeJavaScript(typeof fnOrCode === 'function' ? `(${fnOrCode.toString()})()` : fnOrCode, true);

async function until(check, label, max = 150) {
    for (let i = 0; i < max; i++) {
        if (await check()) return;
        await wait(25);
    }
    throw new Error(`Timed out waiting for: ${label}`);
}

app.whenReady().then(async () => {
    const prefs = [
        { source: 'mine', id: 'mine-pin-1', title: '', pinned: true, pin_order: 0, archived: false, hidden: false }
    ];
    const welinkThreads = [
        {
            channel: 'welink', kind: 'group', id: 'wl-g1',
            name: 'im-group-1024470747533533584-very-long-group-title',
            lastMessage: '@DragonClaw 跟进下这几个任务 1.fab相关表创建与字段设计对齐以及权限确认',
            lastActiveAt: '2026-11-18T10:03:00Z',
            messageCount: 18,
            tasks: { open: 3, done: 1, cancelled: 0 }
        },
        {
            channel: 'welink', kind: 'group', id: 'wl-g2',
            name: 'im-group-1031383948011529326-finished-summary',
            lastMessage: '@Dragon 完成上周汇报汇总并同步给各模块接口人确认无误',
            lastActiveAt: '2026-11-18T10:08:00Z',
            messageCount: 10,
            tasks: { open: 0, done: 2, cancelled: 0 }
        },
        {
            channel: 'welink', kind: 'user', id: 'wl-u1',
            name: 'dwx1545337',
            lastMessage: '@Dragon 总结最近100条群消息重点',
            lastActiveAt: '2026-11-18T10:09:00Z',
            messageCount: 6,
            tasks: { open: 0, done: 0, cancelled: 0 }
        }
    ];
    const weixinThreads = [
        {
            channel: 'weixin', kind: 'user', id: 'wx-u1',
            name: '微信好友小王',
            lastMessage: '好的收到，下午同步进展',
            lastActiveAt: '2026-11-18T09:50:00Z',
            messageCount: 4,
            tasks: { open: 1, done: 0, cancelled: 0 }
        }
    ];

    let liveMessages = [
        { id: 'wl-m1', role: 'user', sender: 'dwx1545337', content: '上一轮问题', sessionId: 'sess-old', createdAt: '2026-11-18T09:00:00Z' },
        { id: 'wl-m2', role: 'model', content: '上一轮回答完成。', sessionId: 'sess-old', createdAt: '2026-11-18T09:00:05Z' }
    ];
    let currentTurnSnapshot = null;
    const sseClients = new Set();
    const broadcastSse = payload => {
        const line = `data: ${JSON.stringify(payload)}\n\n`;
        for (const res of [...sseClients]) {
            try { res.write(line); } catch { sseClients.delete(res); }
        }
    };

    const web = express();
    web.use(express.json());
    web.get('/', (_, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
        html = html.replace(/<body\b[^>]*>/, tag => `${tag}<script>
            document.documentElement.dataset.ui = 'v2';
            document.documentElement.dataset.theme = 'light';
            localStorage.setItem('tools_user', 'dragon');
            localStorage.setItem('tools_role', 'admin');
            localStorage.setItem('tools_tenant_id', 'default');
            localStorage.setItem('tools_token', 'fixture-session');
            localStorage.setItem('tools_lang', 'zh-CN');
        </script>`);
        res.type('html').send(html);
    });

    web.get('/api/auth/me', (_, res) => res.json({ username: 'dragon', role: 'admin', isSuper: true, tenantId: 'default' }));
    web.get('/api/ai/models', (_, res) => res.json({ models: [{ id: 'm1', name: 'Fixture Model', provider: 'openai' }], defaultId: 'm1' }));
    web.get('/api/ai/sessions', (_, res) => res.json({
        items: [
            { id: 'mine-pin-1', title: '普通对话已置顶项', firstQuestion: '普通对话已置顶项', updatedAt: '2026-11-18T10:15:00Z', messageCount: 2 },
            { id: 'mine-regular-1', title: '普通对话任务A', firstQuestion: '普通对话任务A', updatedAt: '2026-11-18T10:12:00Z', messageCount: 2 }
        ]
    }));
    web.get('/api/ai/sessions/:id/messages', (_, res) => res.json({ items: [], hasMore: false }));
    web.get('/api/ai/conversation-list', (_, res) => res.json({ items: prefs }));
    web.put('/api/ai/conversation-list', (req, res) => {
        const { source, id, pinned, archived, hidden, title, order } = req.body || {};
        if (Array.isArray(order)) {
            order.forEach((entryId, idx) => {
                let row = prefs.find(p => p.source === source && p.id === entryId);
                if (!row) {
                    row = { source, id: entryId, pinned: true, pin_order: idx, archived: false, hidden: false, title: '' };
                    prefs.push(row);
                } else {
                    row.pin_order = idx;
                }
            });
            return res.json({ items: prefs.filter(p => p.source === source) });
        }
        let row = prefs.find(p => p.source === source && p.id === id);
        if (!row) {
            row = { source, id, pinned: false, pin_order: prefs.length, archived: false, hidden: false, title: '' };
            prefs.push(row);
        }
        if (pinned !== undefined) row.pinned = Boolean(pinned);
        if (archived !== undefined) row.archived = Boolean(archived);
        if (hidden !== undefined) row.hidden = Boolean(hidden);
        if (title !== undefined) row.title = String(title);
        res.json({ item: row });
    });

    web.get('/api/channels/available', (_, res) => res.json({
        items: [
            { id: 'welink', label: 'WeLink', connected: true, health: { level: 'ok', reason: 'connected' } },
            { id: 'weixin', label: '微信', connected: true, health: { level: 'ok', reason: 'connected' } }
        ],
        summary: { welink: { configured: true, enabled: true, connected: true }, weixin: { configured: true, enabled: true, connected: true } }
    }));
    web.get('/api/channels/welink/threads', (_, res) => res.json({ items: welinkThreads, hasMore: false }));
    web.get('/api/channels/weixin/threads', (_, res) => res.json({ items: weixinThreads, hasMore: false }));
    web.get('/api/channels/:ch/threads/:kind/:id/messages', (req, res) => {
        res.json({
            thread: { kind: req.params.kind, id: req.params.id, name: req.params.id === 'wl-g1' ? welinkThreads[0].name : req.params.id },
            items: liveMessages,
            segments: [{ aiSessionId: 'sess-old', startedAt: '2026-11-18T09:00:00Z' }, { aiSessionId: 'sess-live', startedAt: '2026-11-18T10:19:00Z' }],
            hasMore: false,
            canSend: false
        });
    });
    web.get('/api/channels/:ch/threads/:kind/:id/followups', (_, res) => res.json({ items: [], canManage: false }));
    web.get('/api/channels/:ch/threads/:kind/:id/schedules', (_, res) => res.json({ items: [] }));
    web.get('/api/channels/:ch/threads/:kind/:id/tac', (_, res) => res.json({ items: [] }));
    web.get('/api/channels/:ch/threads/:kind/:id/stream', (req, res) => {
        res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
        res.flushHeaders?.();
        sseClients.add(res);
        res.write(`data: ${JSON.stringify({ type: 'snapshot', turn: currentTurnSnapshot })}\n\n`);
        req.on('close', () => sseClients.delete(res));
    });

    web.get('/api/custom-tools', (_, res) => res.json([]));
    web.use('/api', (_, res) => res.json({ items: [], status: 'ok' }));
    web.use(express.static(path.join(root, 'frontend')));

    server = await new Promise(resolve => { const l = web.listen(0, '127.0.0.1', () => resolve(l)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 820,
        webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    });
    const consoleErrors = [];
    win.webContents.on('console-message', (_, level, message, line, src) => {
        if (level >= 3) console.log('[RENDERER ERR]', src, line, message);
        if (level === 3 && !/Failed to load resource/.test(message)) consoleErrors.push(message);
    });
    const evalWrap = async (label, fnOrCode) => {
        try { return await evaluate(fnOrCode); }
        catch (err) { throw new Error(`Evaluate failed at [${label}]: ${err.message}`); }
    };

    await win.loadURL(baseUrl);
    await until(() => evaluate(() => Boolean(window.HomeWelinkThreads && window.DragonClaw && document.querySelector('#homeChatList .home-chat-item'))), 'initial home chat list');

    // Verify regular chat shows only mine-pin-1 in its Pinned section
    const initMinePins = await evalWrap('initMinePins', () => [...document.querySelectorAll('#homeChatList [data-section="pinned"] .home-chat-title')].map(el => el.textContent.trim()));
    assert.deepEqual(initMinePins, ['普通对话已置顶项']);

    // Switch to Channels ("频道会话") -> WeLink
    await evalWrap('click channels', () => { document.querySelector('.v2-nav-item[data-v2-action="channels"]').click(); });
    await until(() => evaluate(() => document.querySelectorAll('#homeWelinkList .wl-item').length === 3), 'welink thread list');

    // ── 1. Overlap geometry verification (rest + hovered/menu-open) ──
    const restGeometry = await evaluate(() => {
        const rows = [...document.querySelectorAll('#homeWelinkList .conversation-list-row')];
        return rows.map(row => {
            const sub = row.querySelector('.wl-item-sub')?.getBoundingClientRect();
            const title = row.querySelector('.home-chat-title')?.getBoundingClientRect();
            const side = row.querySelector('.wl-item-side')?.getBoundingClientRect();
            const badge = row.querySelector('.wl-badge')?.getBoundingClientRect();
            return {
                id: row.querySelector('.home-chat-title')?.textContent,
                subRight: sub?.right || 0,
                titleRight: title?.right || 0,
                sideLeft: side?.left || 0,
                badgeLeft: badge?.left || side?.left || 0
            };
        });
    });
    for (const r of restGeometry) {
        assert.ok(r.subRight <= r.sideLeft - 2, `Preview overlaps right side on rest (${r.id}: ${r.subRight} > ${r.sideLeft})`);
        assert.ok(r.titleRight <= r.sideLeft - 2, `Title overlaps right side on rest (${r.id}: ${r.titleRight} > ${r.sideLeft})`);
    }

    // Click three-dot button on wl-g1 (row with yellow badge '3') -> check side shifts cleanly left of '...'
    await until(() => evaluate(() => Boolean([...document.querySelectorAll('#homeWelinkList .conversation-list-row')].find(el => el.textContent.includes('1024470747533533584'))?.querySelector('.wl-badge.is-open'))), 'wl-g1 rendered with yellow open badge');
    await wait(250);
    await evaluate(() => {
        const row = [...document.querySelectorAll('#homeWelinkList .conversation-list-row')].find(el => el.textContent.includes('1024470747533533584'));
        row.querySelector('[data-conversation-more]').click();
    });
    await until(() => evaluate(() => Boolean(document.querySelector('#homeWelinkList .conversation-list-row.is-menu-open .wl-badge'))), 'menu opened on wl-g1');
    await wait(220);
    const openMenuGeometry = await evalWrap('openMenuGeometry', () => {
        const row = document.querySelector('#homeWelinkList .conversation-list-row.is-menu-open');
        const sub = row.querySelector('.wl-item-sub').getBoundingClientRect();
        const side = row.querySelector('.wl-item-side').getBoundingClientRect();
        const badge = row.querySelector('.wl-badge').getBoundingClientRect();
        const more = row.querySelector('.conversation-list-more').getBoundingClientRect();
        return {
            subRight: sub.right, sideLeft: side.left, sideRight: side.right,
            badgeRight: badge.right, moreLeft: more.left
        };
    });
    assert.ok(openMenuGeometry.subRight <= openMenuGeometry.sideLeft - 2, `Preview overlaps shifted side when '...' visible (${JSON.stringify(openMenuGeometry)})`);
    assert.ok(openMenuGeometry.sideRight <= openMenuGeometry.moreLeft + 1, `Badge/side overlaps '...' button (${JSON.stringify(openMenuGeometry)})`);
    assert.ok(openMenuGeometry.badgeRight <= openMenuGeometry.moreLeft - 2, `Badge overlaps '...' button (${JSON.stringify(openMenuGeometry)})`);

    // ── 2. Pinning in Channel View + Dedicated Collapsible "置顶" Section + Strict Isolation ──
    await until(() => evaluate(() => Boolean(document.querySelector('.conversation-context-menu [data-conversation-action="pin"]'))), 'context menu pin');
    await evaluate(() => { document.querySelector('.conversation-context-menu [data-conversation-action="pin"]').click(); });
    await until(() => evaluate(() => document.querySelectorAll('#homeChannelPinnedSection [data-wl-pinned-thread]').length === 1), 'channel pinned section updated');

    // Pin the third thread via second pin -> plus verify WeLink count adjusted
    await evaluate(() => {
        const row = [...document.querySelectorAll('#homeWelinkList .conversation-list-row')].find(el => el.textContent.includes('dwx1545337'));
        row.querySelector('[data-conversation-more]').click();
    });
    await until(() => evaluate(() => Boolean(document.querySelector('.conversation-context-menu [data-conversation-action="pin"]'))), 'second pin menu');
    await evaluate(() => { document.querySelector('.conversation-context-menu [data-conversation-action="pin"]').click(); });
    await until(() => evaluate(() => document.querySelectorAll('#homeChannelPinnedSection [data-wl-pinned-thread]').length === 2), 'two pinned channel threads');

    const channelLayout = await evaluate(() => {
        const sec = document.getElementById('homeChannelPinnedSection');
        const list = document.getElementById('homeWelinkList');
        const headText = sec.querySelector('.home-chat-category')?.textContent.replace(/\s+/g, '');
        const groupHeadText = document.querySelector('.v2-group-head[data-group="welink"]')?.textContent.replace(/\s+/g, '');
        return {
            pinnedHidden: sec.hidden,
            pinnedTop: sec.getBoundingClientRect().top,
            welinkTop: list.getBoundingClientRect().top,
            headText,
            groupHeadText,
            pinnedTitles: [...sec.querySelectorAll('[data-chat-title]')].map(el => el.dataset.chatTitle),
            unpinnedTitles: [...list.querySelectorAll('[data-chat-title]')].map(el => el.dataset.chatTitle)
        };
    });
    assert.equal(channelLayout.pinnedHidden, false);
    assert.ok(channelLayout.pinnedTop < channelLayout.welinkTop, 'Channel pinned section renders above WeLink list');
    assert.equal(channelLayout.headText, '置顶(2)');
    assert.equal(channelLayout.groupHeadText, 'WeLink(1)');
    assert.equal(channelLayout.unpinnedTitles.length, 1);
    assert.equal(channelLayout.pinnedTitles.includes('普通对话已置顶项'), false, 'Channel pinned MUST NOT include ordinary chats');

    // Check overlap on pinned rows with hover
    await evaluate(() => {
        document.querySelector('#homeChannelPinnedSection .conversation-list-row')?.classList.add('is-menu-open');
    });
    await wait(200);
    fs.writeFileSync(path.join(temp, 'sidebar-and-pinned.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(() => {
        document.querySelector('#homeChannelPinnedSection .conversation-list-row.is-menu-open')?.classList.remove('is-menu-open');
    });

    // Test collapsing & expanding channel "置顶" section
    await evaluate(() => document.querySelector('[data-wl-pinned-toggle]').click());
    assert.equal(await evaluate(() => document.querySelector('.wl-pinned-list').hidden), true);
    await evaluate(() => document.querySelector('[data-wl-pinned-toggle]').click());
    assert.equal(await evaluate(() => document.querySelector('.wl-pinned-list').hidden), false);

    // Check strict reverse isolation: ordinary chat view MUST NOT show channel pinned threads or channel pinned section
    await evaluate(() => document.querySelector('.v2-nav-item[data-v2-action="newChat"]').click());
    await until(() => evaluate(() => !document.getElementById('homeChatList').hidden), 'back to mine list');
    const mineCheck = await evaluate(() => ({
        channelPinnedHidden: document.getElementById('homeChannelPinnedSection').hidden,
        minePins: [...document.querySelectorAll('#homeChatList [data-section="pinned"] .home-chat-title')].map(el => el.textContent.trim())
    }));
    assert.equal(mineCheck.channelPinnedHidden, true);
    assert.deepEqual(mineCheck.minePins, ['普通对话已置顶项'], 'Ordinary chat pins must NOT include WeLink/WeChat pins');

    // Switch back to WeLink -> click dwx1545337 to open thread timeline & connect SSE
    await evalWrap('reclick channels', () => document.querySelector('.v2-nav-item[data-v2-action="channels"]').click());
    await until(() => evaluate(() => document.querySelectorAll('#homeChannelPinnedSection [data-wl-pinned-thread]').length === 2), 'channels restored');
    await evalWrap('click dwx1545337', () => {
        const btn = [...document.querySelectorAll('#homeChannelPinnedSection [data-wl-pinned-thread]')].find(el => el.textContent.includes('dwx1545337'));
        btn.click();
    });
    await until(() => evaluate(() => Boolean(document.querySelector('.wl-banner'))), 'opened dwx1545337');
    await until(() => sseClients.size === 1, 'SSE stream connected');

    // ── 3. Real-time Waterfall + Silky Thinking Animation + Keycap Emoji + DB Reconciliation ──
    const startedAt = Date.now();
    const liveTurn = {
        turnId: 'live-turn-99',
        channel: 'welink',
        kind: 'user',
        id: 'wl-u1',
        sessionId: 'sess-live',
        sender: 'dwx1545337',
        userText: '@助手 总结最近 100 条群消息',
        startedAt,
        thinkingChunks: [],
        thinkingMs: 0,
        thinkingActive: false,
        statusText: '',
        tools: [],
        compactions: [],
        content: '',
        modelName: 'fixture-model',
        usage: null,
        rounds: [],
        done: false,
        error: ''
    };
    currentTurnSnapshot = liveTurn;
    broadcastSse({ type: 'turn_start', turn: liveTurn });

    await until(() => evaluate(() => Boolean(document.querySelector('.wl-live-ai .dc-activity'))), 'live activity appears immediately');

    broadcastSse({ type: 'thinking', turnId: 'live-turn-99', delta: '首先查看群内最近 100 条消息，分析各方关注的重点问题。' });
    await until(() => evaluate(() => Boolean(document.querySelector('.wl-live-ai .dc-think.is-active'))), 'active thinking appears');

    const activeThinkState = await evaluate(() => {
        const dot = document.querySelector('.wl-live-ai .dc-think-dot');
        const label = document.querySelector('.wl-live-ai .dc-think-label');
        const phase = document.querySelector('.wl-live-ai .dc-think-phase');
        return {
            dotAnim: dot ? getComputedStyle(dot).animationName : '',
            labelColor: label ? getComputedStyle(label).color : '',
            phaseVisible: phase ? !phase.hidden : false
        };
    });
    assert.equal(activeThinkState.dotAnim, 'dc-think-dot-pulse');
    assert.equal(activeThinkState.phaseVisible, true);

    // Click thinking header while live -> expands smoothly
    await evaluate(() => document.querySelector('.wl-live-ai .dc-think-head').click());
    await wait(320);
    assert.equal(await evaluate(() => document.querySelector('.wl-live-ai .dc-think').classList.contains('is-open')), true);
    assert.equal(await evaluate(() => document.querySelector('.wl-live-ai .dc-think-body').hidden), false);
    fs.writeFileSync(path.join(temp, 'channel-live-thinking.png'), (await win.webContents.capturePage()).toPNG());

    // Collapse smoothly
    await evaluate(() => document.querySelector('.wl-live-ai .dc-think-head').click());
    await wait(380);
    assert.equal(await evaluate(() => document.querySelector('.wl-live-ai .dc-think').classList.contains('is-open')), false);
    assert.equal(await evaluate(() => document.querySelector('.wl-live-ai .dc-think-body').hidden), true);

    // Stream tool + waterfall chunks BEFORE done
    broadcastSse({ type: 'tool_start', turnId: 'live-turn-99', callId: 't1', tool: 'welink_history' });
    await until(() => evaluate(() => Boolean(document.querySelector('.wl-live-ai .dc-tool-row.is-running'))), 'live tool spinner');
    broadcastSse({ type: 'tool_result', turnId: 'live-turn-99', callId: 't1', tool: 'welink_history', ok: true, durationMs: 85 });
    await until(() => evaluate(() => Boolean(document.querySelector('.wl-live-ai .dc-tool-row.is-ok'))), 'live tool ok');

    broadcastSse({ type: 'delta', turnId: 'live-turn-99', delta: '看完最近 100 条消息，先给你结论：\n\n---\n\n' });
    await until(() => evaluate(() => document.querySelector('.wl-live-ai .dc-msg-body')?.innerText.includes('先给你结论')), 'first streamed waterfall chunk rendered');
    await until(() => evaluate(() => Boolean(document.querySelector('.wl-live-ai .dc-msg-body hr'))), 'Markdown --- rendered as <hr> while streaming');

    const finalReply = '看完最近 100 条消息，先给你结论：\n\n---\n\n**1\u20E3 TE+AI 峰会演讲**\n\ndwx1545337 透露下周议程：\n- 客户领导对 AI 价值感知强\n- 担心英文/阿语水平跟不上';
    broadcastSse({ type: 'delta', turnId: 'live-turn-99', delta: '**1\u20E3 TE+AI 峰会演讲**\n\ndwx1545337 透露下周议程：\n- 客户领导对 AI 价值感知强\n- 担心英文/阿语水平跟不上' });
    liveMessages = [
        ...liveMessages,
        { id: 'wl-m3', role: 'user', sender: 'dwx1545337', content: '@助手 总结最近 100 条群消息', sessionId: 'sess-live', createdAt: new Date(startedAt - 200).toISOString() },
        { id: 'wl-m4', role: 'model', content: finalReply, sessionId: 'sess-live', createdAt: new Date(startedAt + 1200).toISOString(), modelName: 'fixture-model', usage: { inputTokens: 80, outputTokens: 45 } }
    ];
    broadcastSse({ type: 'done', turnId: 'live-turn-99', sessionId: 'sess-live', reply: finalReply, modelName: 'fixture-model', usage: { inputTokens: 80, outputTokens: 45 } });

    // Wait for DB reconciliation + rendered finished message preserving collapsible thinking card
    await until(() => evaluate(() => !document.querySelector('.wl-live-ai') && document.querySelectorAll('#dcThread .wl-msg').length === 4), 'live turn reconciled into DB messages');

    const finalCheck = await evaluate(() => {
        const lastAi = [...document.querySelectorAll('#dcThread .dc-msg--ai')].at(-1);
        const keycap = lastAi?.querySelector('.ai-emoji-keycap');
        const thinkHead = lastAi?.querySelector('.dc-think-head');
        return {
            hasHr: Boolean(lastAi?.querySelector('hr')),
            keycapText: keycap?.textContent || '',
            keycapFontWeight: keycap ? getComputedStyle(keycap).fontWeight : '',
            keycapFontFamily: keycap ? getComputedStyle(keycap).fontFamily : '',
            hasThink: Boolean(thinkHead),
            thinkText: lastAi?.querySelector('.dc-think-body')?.textContent || ''
        };
    });
    assert.equal(finalCheck.hasHr, true);
    assert.equal(finalCheck.keycapText, '1\uFE0F\u20E3', 'Missing VS16 keycap should normalize to 1️⃣');
    assert.equal(finalCheck.keycapFontWeight, '400', 'Keycap emoji resets bold weight so color emoji glyph renders cleanly');
    assert.match(finalCheck.keycapFontFamily, /Emoji/i);
    assert.equal(finalCheck.hasThink, true, 'Finished thinking block persists after DB reconciliation');
    assert.match(finalCheck.thinkText, /首先查看群内最近 100 条消息/);

    // Expand persisted thinking block to capture final screenshot
    await evaluate(() => [...document.querySelectorAll('#dcThread .dc-msg--ai')].at(-1).querySelector('.dc-think-head').click());
    await wait(340);
    fs.writeFileSync(path.join(temp, 'channel-finished-keycap.png'), (await win.webContents.capturePage()).toPNG());

    // ── 4. Mid-turn click-in catch-up + Touch viewport overlap check ──
    currentTurnSnapshot = {
        turnId: 'mid-turn-42',
        channel: 'welink',
        kind: 'group',
        id: 'wl-g1',
        sessionId: 'sess-mid',
        sender: 'alice',
        userText: '@助手 核对任务进度',
        startedAt: Date.now() - 2500,
        thinkingChunks: [{ text: '正在核对 3 个未关闭任务的状态。' }],
        thinkingMs: 1200,
        thinkingActive: false,
        statusText: '',
        tools: [{ callId: 'm1', tool: 'list_followups', ok: true, durationMs: 35, finished: true }],
        compactions: [],
        content: '已核对前 2 项任务，',
        modelName: 'fixture-model',
        usage: null,
        rounds: [],
        done: false,
        error: ''
    };
    await evalWrap('click wl-g1 mid-turn', () => {
        const btn = [...document.querySelectorAll('#homeChannelPinnedSection [data-wl-pinned-thread]')].find(el => el.textContent.includes('1024470747533533584'));
        btn.click();
    });
    await until(() => evaluate(() => document.querySelector('.wl-live-ai .dc-msg-body')?.innerText.includes('已核对前 2 项任务')), 'mid-turn snapshot resumed immediately');
    assert.ok(await evaluate(() => Boolean(document.querySelector('.wl-live-ai .dc-think'))), 'mid-turn join shows thinking block');
    assert.ok(await evaluate(() => Boolean(document.querySelector('.wl-live-ai .dc-tool-row.is-ok'))), 'mid-turn join shows tool row');
    broadcastSse({ type: 'delta', turnId: 'mid-turn-42', delta: '第 3 项预计今日完成。' });
    await until(() => evaluate(() => document.querySelector('.wl-live-ai .dc-msg-body')?.innerText.includes('第 3 项预计今日完成')), 'subsequent delta streams smoothly after snapshot catch-up');
    broadcastSse({ type: 'done', turnId: 'mid-turn-42', sessionId: 'sess-mid', reply: '已核对前 2 项任务，第 3 项预计今日完成。' });
    currentTurnSnapshot = null;

    // Touch screen check (@media (hover: none))
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }] });
    await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true });
    assert.equal(await evaluate(() => matchMedia('(hover: none)').matches), true);
    await wait(120);
    const touchGeo = await evalWrap('touchGeo', () => {
        const rows = [...document.querySelectorAll('#homeChannelPinnedSection .conversation-list-row, #homeWelinkList .conversation-list-row')];
        return rows.map(row => {
            const sub = row.querySelector('.wl-item-sub')?.getBoundingClientRect();
            const side = row.querySelector('.wl-item-side')?.getBoundingClientRect();
            const more = row.querySelector('.conversation-list-more')?.getBoundingClientRect();
            return { subRight: sub?.right || 0, sideLeft: side?.left || 0, sideRight: side?.right || 0, moreLeft: more?.left || 0 };
        });
    });
    for (const r of touchGeo) {
        assert.ok(r.subRight <= r.sideLeft - 2, `Touch preview overlaps side: ${JSON.stringify(r)}`);
        assert.ok(r.sideRight <= r.moreLeft + 1, `Touch side overlaps '...': ${JSON.stringify(r)}`);
    }

    // Zero runtime console errors
    assert.deepEqual(consoleErrors, [], `Unexpected console errors: ${consoleErrors.join('; ')}`);

    console.log('PASS: channel overlap, channel Pinned isolation & collapse, SSE live streaming, thinking accordion, keycap emoji, and <hr>. Screenshots:', temp);
}).catch(err => {
    console.error(err);
    process.exitCode = 1;
}).finally(() => {
    server?.closeAllConnections?.();
    server?.close?.();
    win?.destroy();
    app.exit(process.exitCode || 0);
});
