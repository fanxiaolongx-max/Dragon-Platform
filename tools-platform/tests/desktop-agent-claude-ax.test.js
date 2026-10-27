// Claude Desktop UI-automation send path, driven by a fake accessibility driver.
// No real window is touched: each fake action changes an in-memory window model.
const test = require('node:test'), assert = require('node:assert/strict');
const claude = require('../backend/models/desktop-agents/claude-desktop');

const TARGET = { id: 'local_22222222-2222-4222-8222-222222222222', title: 'Native Claude title' };
function fakeWindow(overrides = {}) {
    const w = { current: 'Another chat', rows: ['新建', '搜索', 'Another chat', 'Native Claude title 由 Claude 从 Parent 发起', 'Native Claude title 2'], composers: ['\n'], busy: false, opens: {}, calls: [], ...overrides };
    const snapshot = () => ({ ok: true, frontmost: w.calls.includes('paste'), elements: [
        { role: 'AXHeading', title: 'Claude Code', desc: '' },
        ...w.rows.map(title => ({ role: 'AXButton', title, desc: '' })),
        ...(w.current ? [{ role: 'AXHeading', title: '', desc: w.current }, { role: 'AXButton', title: '', desc: w.current + '，重命名会话' }] : []),
        { role: 'AXHeading', title: '您说：earlier message', desc: '' },
        ...w.composers.map(value => ({ role: 'AXTextArea', title: '', desc: '提示词', value })),
        ...(w.busy ? [{ role: 'AXButton', title: '', desc: '停止' }] : [])
    ] });
    w.driver = {
        status: async () => ({ ok: true, trusted: w.trusted ?? true, running: w.running ?? true }),
        snapshot: async () => { w.calls.push('snapshot'); return snapshot(); },
        press: async title => { w.calls.push('press:' + title); w.current = w.opens[title] ?? title.replace(/ 由 Claude 从 .*$/, ''); return { ok: true, previous: 'com.tencent.xinWeChat' }; },
        paste: async text => { w.calls.push('paste'); w.composers = [w.pasteResult ?? text + '\n']; if (w.switchAfterPaste) w.current = 'Another chat'; return { ok: true, previous: w.calls.some(c => c.startsWith('press:')) ? 'com.anthropic.claudefordesktop' : 'com.google.Chrome' }; },
        restore: async previous => { w.calls.push('restore:' + previous); return { ok: true }; },
        submit: async previous => { w.calls.push('submit:' + previous); w.composers = ['\n']; return { ok: true }; }
    };
    return w;
}
const send = (w, text = 'Hello Claude') => claude.send(TARGET, text, { driver: w.driver, wait: async () => { } });

test('parse finds the session heading, sidebar rows, composer and the stop button', () => {
    const view = claude.parse({ frontmost: true, elements: [
        { role: 'AXHeading', title: '导航', desc: '' }, { role: 'AXButton', title: 'Chat A', desc: '' },
        { role: 'AXHeading', title: '', desc: 'Chat A' }, { role: 'AXButton', title: '', desc: 'Chat A，重命名会话' },
        { role: 'AXHeading', title: 'Claude 已回复：done', desc: '' }, { role: 'AXTextArea', title: '', desc: '提示词', value: '\n' }, { role: 'AXButton', title: '', desc: '停止' }
    ] });
    assert.deepEqual(view, { frontmost: true, current: 'Chat A', rows: ['Chat A'], composers: ['\n'], busy: true });
    assert.equal(claude.rowFor(['Chat A', 'Chat A 由 Claude 从 X 发起'].slice(1), 'Chat A'), 'Chat A 由 Claude 从 X 发起');
    assert.throws(() => claude.rowFor(['Chat A', 'Chat A 由 Claude 从 X 发起'], 'Chat A'), { code: 'DESKTOP_TARGET_UNCONFIRMED' });
    assert.throws(() => claude.rowFor(['Chat B'], 'Chat A'), { code: 'DESKTOP_TARGET_UNCONFIRMED' });
});

test('status stays read-only unless enabled, and reports permission and running state', async () => {
    assert.equal((await claude.status({}, { driver: fakeWindow().driver })).canSend, false);
    assert.match((await claude.status({ claudeAutomation: true }, { driver: fakeWindow({ trusted: false }).driver })).reason, /辅助功能/);
    assert.match((await claude.status({ claudeAutomation: true }, { driver: fakeWindow({ running: false }).driver })).reason, /未运行/);
    assert.equal((await claude.status({ claudeAutomation: true }, { driver: fakeWindow().driver })).canSend, true);
    const broken = { status: async () => { throw Object.assign(Error('需要 Xcode 命令行工具'), { code: 'DESKTOP_UNSUPPORTED' }); } };
    assert.deepEqual(await claude.status({ claudeAutomation: true }, { driver: broken }), { canSend: false, reason: '需要 Xcode 命令行工具' });
});

test('opens the exact session, confirms the heading and composer, then sends and switches back', async () => {
    const w = fakeWindow();
    await send(w);
    assert.deepEqual(w.calls.filter(c => c !== 'snapshot'), ['press:Native Claude title 由 Claude 从 Parent 发起', 'paste', 'submit:com.tencent.xinWeChat'], 'focus returns to the app used before Claude was opened');
    const already = fakeWindow({ current: TARGET.title });
    await send(already);
    assert.equal(already.calls.some(c => c.startsWith('press:')), false, 'an already open session is not re-opened');
    assert.equal(already.calls.at(-1), 'submit:com.google.Chrome');
});

test('nothing is typed when the target cannot be confirmed or the session is not ready', async () => {
    const cases = [
        [{ rows: ['Native Claude title', 'Native Claude title 由 Claude 从 X 发起'] }, 'DESKTOP_TARGET_UNCONFIRMED'],
        [{ rows: ['Something else'] }, 'DESKTOP_TARGET_UNCONFIRMED'],
        [{ opens: { 'Native Claude title 由 Claude 从 Parent 发起': 'Wrong chat' } }, 'DESKTOP_TARGET_UNCONFIRMED'],
        [{ current: TARGET.title, composers: ['half-written draft'] }, 'DESKTOP_DRAFT'],
        [{ current: TARGET.title, busy: true }, 'DESKTOP_BUSY'],
        [{ current: TARGET.title, composers: ['\n', '\n'] }, 'DESKTOP_TARGET_UNCONFIRMED']
    ];
    for (const [state, code] of cases) {
        const w = fakeWindow(state);
        await assert.rejects(send(w), { code }, JSON.stringify(state));
        assert.equal(w.calls.includes('paste'), false, 'no input for ' + JSON.stringify(state));
        assert.equal(w.calls.some(c => c.startsWith('submit')), false);
        if (w.calls.some(c => c.startsWith('press:')))
            assert.equal(w.calls.at(-1), 'restore:com.tencent.xinWeChat', 'a refused send hands the foreground back');
    }
});

test('a composer that does not read back the exact text, or a switched session, is never submitted', async () => {
    for (const state of [{ current: TARGET.title, pasteResult: 'Hello Cl' }, { current: TARGET.title, switchAfterPaste: true }]) {
        const w = fakeWindow(state);
        await assert.rejects(send(w), /未发送/);
        assert.equal(w.calls.some(c => c.startsWith('submit')), false);
        assert.equal(w.calls.at(-1), 'restore:com.google.Chrome');
    }
});

test('readback may merge empty paragraphs without changing message characters or indentation', async () => {
    const expected='[DragonTAC:fixture]\n\nRules\n\n  exact indentation\n\n';
    const w=fakeWindow({current:TARGET.title,pasteResult:'[DragonTAC:fixture]\nRules\n  exact indentation'});
    await send(w,expected);
    assert.equal(w.calls.some(c=>c.startsWith('submit')),true);
    const changed=fakeWindow({current:TARGET.title,pasteResult:'[DragonTAC:fixture]\nRules\nwrong text'});
    await assert.rejects(send(changed,expected),{code:'DESKTOP_REJECTED'});
    assert.equal(changed.calls.some(c=>c.startsWith('submit')),false);
});
