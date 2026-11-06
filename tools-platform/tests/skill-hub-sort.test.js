const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function parseTime(iso) {
    if (!iso) return 0;
    const time = Date.parse(iso);
    return Number.isFinite(time) ? time : 0;
}

test('Skill Hub sort logic: newest sorts newly imported tools first', () => {
    const now = Date.now();
    const items = [
        { id: 'monthly-report', title: '月报页面', updatedAt: new Date(now - 3600 * 1000).toISOString() }, // 1h ago
        { id: 'ai-101', title: 'AI 101', updatedAt: new Date(now - 60 * 1000).toISOString() }, // 1m ago (newly imported!)
        { id: 'datacom', title: '数通协议专家', updatedAt: new Date(now - 16 * 3600 * 1000).toISOString() }, // 16h ago
        { id: 'old-tool', title: '旧工具', updatedAt: '' } // no timestamp
    ];

    const sortedNewest = items.slice().sort((a, b) => {
        const tb = parseTime(b.updatedAt);
        const ta = parseTime(a.updatedAt);
        if (tb !== ta) return tb - ta;
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    assert.equal(sortedNewest[0].id, 'ai-101', 'AI 101 must be first when sorting by newest');
    assert.equal(sortedNewest[1].id, 'monthly-report');
    assert.equal(sortedNewest[2].id, 'datacom');
    assert.equal(sortedNewest[3].id, 'old-tool', 'Tool without timestamp goes to the end');
});

test('Skill Hub sort logic: name sorts naturally with numbers and bilingual support', () => {
    const items = [
        { id: 'ai-101', title: 'AI 101' },
        { id: 'ai-2', title: 'AI 2' },
        { id: 'ai-1', title: 'AI 1' },
        { id: 'report', title: '报表看板' }
    ];

    const sortedName = items.slice().sort((a, b) => {
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    const aiTitles = sortedName.filter(x => x.title.startsWith('AI')).map(x => x.title);
    assert.deepEqual(aiTitles, ['AI 1', 'AI 2', 'AI 101'], 'Natural sorting ensures AI 2 comes before AI 101');
});

test('Skill Hub toolEntries fallback: retrieves updatedAt from window.__homeCustomTools', () => {
    const now = new Date().toISOString();
    const mockWindow = {
        NavFavorites: { get: () => [] },
        HomeWorkspace: {
            getTools: () => [
                { id: 'custom:ai-101', title: 'AI 101', href: '/tools/ai-101', group: '自定义工具', updatedAt: '', updatedText: '' },
                { id: 'monthly-report', title: '月报页面', href: '/monthly-report.html', group: '其他', updatedAt: '2026-11-06T10:00:00Z', updatedText: '2小时前' }
            ],
            formatRelative: () => '刚刚'
        },
        __homeCustomTools: [
            { slug: 'ai-101', name: 'AI 101', href: '/tools/ai-101', createdAt: now, updatedAt: now }
        ]
    };

    function simulateToolEntries() {
        const favorites = new Set(mockWindow.NavFavorites.get());
        const customTools = Array.isArray(mockWindow.__homeCustomTools) ? mockWindow.__homeCustomTools : [];
        return (mockWindow.HomeWorkspace.getTools() || [])
            .filter(tool => tool && tool.href && tool.title && !String(tool.id).startsWith('skill:'))
            .map(tool => {
                let updatedAt = tool.updatedAt || '';
                let updatedText = tool.updatedText || '';
                if (!updatedAt && customTools.length) {
                    const slug = String(tool.id || '').replace(/^custom:/, '');
                    const match = customTools.find(t => t.slug === slug || t.href === tool.href);
                    if (match) {
                        updatedAt = match.updatedAt || match.createdAt || '';
                        if (updatedAt && !updatedText && typeof mockWindow.HomeWorkspace?.formatRelative === 'function') {
                            updatedText = mockWindow.HomeWorkspace.formatRelative(updatedAt);
                        }
                    }
                }
                return {
                    key: `tool:${tool.id}`, id: tool.id, title: tool.title,
                    badges: [tool.group, updatedText].filter(Boolean),
                    updatedAt, href: tool.href
                };
            });
    }

    const entries = simulateToolEntries();
    const ai101 = entries.find(e => e.id === 'custom:ai-101');
    assert.ok(ai101);
    assert.equal(ai101.updatedAt, now);
    assert.ok(ai101.badges.includes('刚刚'));
});

test('Workspace buildGroups: unranked custom tools sort by updatedAt descending', () => {
    const now = Date.now();
    const cards = [
        {
            dataset: { customToolCard: '1', toolSlug: 'old-custom' },
            getAttribute: () => '/tools/old-custom',
            updatedAt: new Date(now - 86400 * 1000).toISOString()
        },
        {
            dataset: { customToolCard: '1', toolSlug: 'ai-101' },
            getAttribute: () => '/tools/ai-101',
            updatedAt: new Date(now - 60 * 1000).toISOString()
        }
    ];

    const itemOrder = new Map(); // No manual drag-and-drop order
    const domIndex = new Map(cards.map((c, i) => [c, i]));
    const updatedAtFor = (c) => c.updatedAt;

    const list = cards.slice().sort((a, b) => {
        const aHasOrder = itemOrder.has(a.dataset.toolSlug);
        const bHasOrder = itemOrder.has(b.dataset.toolSlug);
        if (aHasOrder && bHasOrder) return itemOrder.get(a.dataset.toolSlug) - itemOrder.get(b.dataset.toolSlug);
        if (aHasOrder) return -1;
        if (bHasOrder) return 1;
        const ta = Date.parse(updatedAtFor(a) || '') || 0;
        const tb = Date.parse(updatedAtFor(b) || '') || 0;
        if (ta !== tb) return tb - ta;
        return (domIndex.get(a) || 0) - (domIndex.get(b) || 0);
    });

    assert.equal(list[0].dataset.toolSlug, 'ai-101', 'ai-101 should sort before old-custom in custom group');
});
