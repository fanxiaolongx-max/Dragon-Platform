const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const picomatch = require('picomatch');

const root = path.join(__dirname, '..');
const read = relPath => fs.readFileSync(path.join(root, relPath), 'utf8');

test('home page hosts the workspace panel, picker and scripts in the right order', () => {
    const html = read('frontend/index.html');
    ['dcWorkspacePanel', 'wspEnvBody', 'wspCtxBody', 'wspChangesBody', 'wspDirPicker', 'wspPickerInput', 'wspPickerList', 'dcWorkspaceToggle', 'dcWorkspaceChip', 'dcWorkspaceFab']
        .forEach(id => assert.match(html, new RegExp(`id="${id}"`), `${id} exists`));
    assert.match(html, /href="\/css\/workspace-panel\.css"/);
    assert.ok(html.indexOf('href="/css/dragon-claw.css"') < html.indexOf('href="/css/workspace-panel.css"'));
    assert.ok(html.indexOf('src="/js/home/workspace.js"') < html.indexOf('src="/js/home/workspace-panel.js"'));
    assert.ok(html.indexOf('src="/js/home/workspace-panel.js"') < html.indexOf('src="/js/home/dragon-claw.js"'), 'panel API must exist before the chat script runs');
    assert.doesNotMatch(html, /workspace-panel\.(css|js)\?v=/);
    assert.match(html, /role="combobox"/);
});

test('chat script sends the workspace payload, forwards events and shares its texts', () => {
    const agent = read('frontend/js/home/dragon-claw.js');
    const panel = read('frontend/js/home/workspace-panel.js');
    const assistant = read('frontend/js/shared/ai-assistant.js');
    assert.match(agent, /window\.DragonClawText = \{ tx/);
    assert.match(agent, /workspace: workspacePayload/);
    assert.match(agent, /onEvent: event => \{[\s\S]*?workspace\(\)\?\.handleEvent\(reply, event, workspacePayload\);\s*activity\.event\(event\);/);
    assert.match(agent, /workspace\(\)\?\.applyDone\(data\)/);
    assert.match(agent, /workspace\(\)\?\.resetSession\?\.\(\)/);
    assert.match(assistant, /onEvent\?\.\(event\)/);
    assert.match(assistant, /async function requestStreamingChat\(payload, \{ signal, onDelta, onStatus, onEvent \}\)/);
    assert.match(panel, /\/api\/agent-workspace/);
    assert.match(panel, /\/suggest\?input=/);
    assert.match(panel, /approvals\/\$\{encodeURIComponent\(event\.id\)\}/);
    assert.match(panel, /window\.DragonClawWorkspace = \{/);
    // 新标签页（sessionStorage 为空）重选同一目录时沿用服务端记住的会话 id；New Chat 仍新开 id
    assert.match(panel, /adoptSessionId\(data\.agentSessionId\) \|\| newSessionId\(\)/);
    assert.match(panel, /resetSession\(\{ clearWorkspace = false \} = \{\}\) \{[\s\S]*?state\.agentSessionId = newSessionId\(\);/);
    const routeSrc = read('backend/routes/agent-workspace.js');
    assert.match(routeSrc, /runManager\.findLatestSessionId\(req\.user, getTenantId\(\), root\)/);
    assert.match(routeSrc, /prefs, agentSessionId \}\)/);
    assert.match(panel, /\/pr\/\$\{encodeURIComponent\(state\.agentSessionId\)\}\/preflight/);
    assert.match(panel, /data-wsp-pr="start"/);
    assert.match(panel, /data-wsp-pr-form/);
    assert.doesNotMatch(panel, /createPrSoon/);
    assert.match(panel, /handleEvent\(prLog, event\)/, 'PR approvals reuse the chat approval cards');
    ['getWorkspacePayload', 'resetSession', 'handleEvent', 'applyDone', 'openPicker'].forEach(name => assert.match(panel, new RegExp(`${name}`)));
    // 面板用到的每个文案键都要在 TEXT 表的中英文里各出现一次
    const used = new Set([...panel.matchAll(/tx\('([A-Za-z_]+)'/g)].map(match => match[1]));
    const zh = agent.slice(agent.indexOf("'zh-CN': {"), agent.indexOf("'en-US': {"));
    const en = agent.slice(agent.indexOf("'en-US': {"), agent.indexOf('const AVATAR'));
    for (const key of used) {
        assert.match(zh, new RegExp(`\\b${key}:`), `${key} has zh text`);
        assert.match(en, new RegExp(`\\b${key}:`), `${key} has en text`);
    }
    ['tool_list_directory', 'tool_read_file', 'tool_search', 'tool_write_file', 'tool_edit_file', 'tool_delete_path', 'tool_rename_path', 'tool_run_command', 'modeAsk', 'modeAuto', 'modeFull', 'ctxMessages', 'ctxDirectory', 'ctxSystem', 'ctxTools', 'ctxFree']
        .forEach(key => { assert.match(zh, new RegExp(`\\b${key}:`)); assert.match(en, new RegExp(`\\b${key}:`)); });
});

test('server mounts the workspace router, allowlists it and the layout gains a third column', () => {
    const server = read('backend/server.js');
    assert.match(server, /app\.use\('\/api\/agent-workspace', require\('\.\/routes\/agent-workspace'\)\)/);
    assert.match(server, /\/\^\\\/agent-workspace\(\?:\\\/\.\*\)\?\$\/\.test\(req\.path\)\) return next\(\);/);
    assert.ok(server.indexOf("test(req.path)) return next(); // 路由内按本机") < server.indexOf("if (req.method !== 'GET') {"));
    const ai = read('backend/routes/ai.js');
    assert.match(ai, /agentRunManager\.runAgentTurn\(/);
    assert.match(ai, /isAgentWorkspaceAllowed\(req\)/);
    assert.match(ai, /agentSessionId: agentSession\.id/);
    const layout = read('frontend/css/home-workspace.css');
    assert.match(layout, /body\.dc-workspace-open \.home-content\.home-workspace \{ grid-template-columns: var\(--ws-side\) minmax\(0, 1fr\) var\(--ws-panel-w\); \}/);
    // 宽屏自适应：三栏宽度随视口伸展，且不再保留整体 max-width 上限
    assert.match(layout, /--ws-side: clamp\(248px, [^)]+\);/);
    assert.match(layout, /--ws-panel-w: clamp\(320px, [^)]+\);/);
    assert.match(layout, /max-width: none;/);
    const css = read('frontend/css/workspace-panel.css');
    assert.match(css, /@media \(max-width: 860px\)[\s\S]*\.home-workspace-panel \{[\s\S]*position: fixed/);
});

test('desktop packaging keeps the new agent files', () => {
    const { build } = require('../package.json');
    const excluded = picomatch(build.files.filter(p => p.startsWith('!')).map(p => p.slice(1)), { dot: true });
    const included = picomatch(build.files.filter(p => !p.startsWith('!')), { dot: true });
    for (const file of [
        'backend/models/agent-run-manager.js', 'backend/models/agent-tools-service.js', 'backend/models/agent-path-guard.js',
        'backend/models/agent-change-log.js', 'backend/models/agent-workspace-access.js', 'backend/routes/agent-workspace.js',
        'backend/models/agent-transcript-repository.js', 'backend/models/agent-pr-service.js',
        'frontend/js/home/workspace-panel.js', 'frontend/css/workspace-panel.css'
    ]) {
        assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
        assert.ok(included(file) && !excluded(file), `${file} is packaged`);
    }
});

test('workspace panel scrolls instead of clipping cards and keeps approval buttons legible and aligned', () => {
    const css = read('frontend/css/workspace-panel.css');
    // 面板是限高的纵向 flex：卡片不能被压缩，否则 PR 表单底部按钮会被裁掉且不出现滚动条
    assert.match(css, /\.home-workspace-panel > \* \{ flex-shrink: 0; \}/);
    // 面板在 .dc 之外，复用的审批卡依赖 --dc-accent 等变量画「允许」按钮
    for (const name of ['--dc-accent', '--dc-accent-2', '--dc-text', '--dc-muted', '--dc-faint']) {
        assert.match(css.slice(css.indexOf('.home-workspace-panel {'), css.indexOf('}', css.indexOf('.home-workspace-panel {'))), new RegExp(`${name}:`), name);
    }
    // 窄卡片：允许 / 拒绝等宽并排，「总是允许」独占一行
    assert.match(css, /\.dc-approval \{ container-type: inline-size; \}/);
    const narrow = css.slice(css.indexOf('@container (max-width: 340px)'));
    assert.match(narrow, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(narrow, /\[data-decision="always"\] \{ grid-column: 1 \/ -1; order: 1; \}/);
    // PR 卡里的「取消 / 关闭」是文字按钮，不沿用 26px 图标按钮宽度
    assert.match(css, /\.wsp-pr-actions \.wsp-btn-quiet \{ width: auto;/);
    // 主按钮渐变带兜底色，变量缺失时也不会变成深底深字
    assert.match(read('frontend/css/dragon-claw.css'), /\.dc-action--primary \{[^}]*var\(--dc-accent, #64ffda\), var\(--dc-accent-2, #60a5fa\)/);
});

test('home chat can resume the last conversation with its agent session, distinct from a new chat', () => {
    const js = read('frontend/js/home/dragon-claw.js');
    // 本浏览器按用户记住最近一次对话（服务端会话不分用户，不能从列表里猜）
    assert.match(js, /const LAST_CHAT_KEY = 'dragon_claw_last_chat'/);
    assert.match(js, /saved\.user === currentUser\(\)/);
    assert.match(js, /fetch\(`\/api\/ai\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/messages\?\$\{query\}`/);
    assert.match(js, /const page = await fetchHistoryPage\(saved\.sessionId\);/);
    // 回复后记下会话与工作区智能体会话；续接时接回，模型才记得工具操作
    assert.match(js, /rememberLastChat\(data\.sessionId, workspacePayload \?/);
    assert.match(js, /await workspace\(\)\?\.resumeWorkspace\?\.\(resume\.agent \|\| \{\}\)/);
    // 续接视图：顶部标记、历史淡化、分隔线；新对话后可再接回刚离开的对话
    assert.match(js, /dc-history-banner/);
    assert.match(js, /classList\.add\('dc-msg--history'\)/);
    assert.match(js, /dc-history-divider/);
    assert.match(js, /refreshResumeCard\(\); \/\/ 刚离开的对话可以再接回去/);
    for (const key of ['resumeTitle', 'resumeMeta', 'resumeAction', 'resumeBanner', 'resumeDivider']) {
        assert.equal(js.split(`${key}: '`).length - 1, 2, `${key} has zh and en texts`);
    }
    const css = read('frontend/css/dragon-claw.css');
    assert.match(css, /body\.dc-chatting \.dc-resume,/, 'the resume card only shows on the new-chat landing');
    assert.match(css, /\.dc-msg--history \{ opacity: 0\.72;/);
    const panel = read('frontend/js/home/workspace-panel.js');
    // 正在用别的目录时不接回旧会话：带旧 id 换目录会让服务端作废旧转录
    assert.match(panel, /adoptSession\(\{ agentSessionId, root \} = \{\}\) \{\n\s+if \(!agentSessionId \|\| !root \|\| \(state\.root && state\.root !== root\)\) return false;/);
});

test('resuming selects the old folder, restores context and shows live changes including manual edits', () => {
    const panel = read('frontend/js/home/workspace-panel.js');
    // 恢复对话：目录不同就自动选回；打不开时提示，对话照常恢复
    assert.match(panel, /async resumeWorkspace\(\{ agentSessionId, root \} = \{\}\)/);
    assert.match(panel, /await selectDirectory\(root, ticket\);[\s\S]*?clearDirectory\(\);\n\s+this\.resetSession\(\);\n\s+toast\(tx\('resumeDirMissing'/);
    assert.match(panel, /API\}\/state\/\$\{encodeURIComponent\(id\)\}\?root=/);
    // 实时更改：回到页面、面板打开时定时刷新；外部改动用标签代替撤销，PR 只在有本会话改动时出现
    assert.match(panel, /window\.addEventListener\('focus', refreshChanges\)/);
    assert.match(panel, /setInterval\(\(\) => \{ if \(state\.open && document\.visibilityState === 'visible'\) refreshChanges\(\); \}, 15000\)/);
    assert.match(panel, /isReadOnly\(\) \? '' : item\.source === 'git'\n\s+\? `<span class="wsp-change-ext"/);
    assert.match(panel, /!isReadOnly\(\) && \(list\.some\(item => item\.source !== 'git'\) \|\| state\.pr\) \? renderPr\(\) : ''/);
    const js = read('frontend/js/home/dragon-claw.js');
    for (const key of ['resumeDirMissing', 'externalTag', 'externalChange']) {
        assert.equal(js.split(`${key}: '`).length - 1, 2, `${key} has zh and en texts`);
    }
    assert.match(read('frontend/css/workspace-panel.css'), /\.wsp-change-ext \{/);
});

test('read-only accounts, binary changes and the sidebar search box render properly', () => {
    const server = read('backend/server.js');
    assert.match(server, /req\.method === 'POST' && req\.path === '\/ai\/chat'\) return next\(\);/, 'logged-in users can chat; write tools are gated per role');
    const panel = read('frontend/js/home/workspace-panel.js');
    assert.match(panel, /isReadOnly\(\)\n\s+\? `<div class="wsp-readonly">/);
    assert.match(panel, /\$\{isReadOnly\(\) \? '' : item\.source === 'git'/, 'no undo buttons for read-only accounts');
    assert.match(panel, /item\.binary\n\s+\? `<span class="wsp-change-stat wsp-change-bin"/);
    const js = read('frontend/js/home/dragon-claw.js');
    for (const key of ['readOnlyMode', 'readOnlyDesc', 'binaryChange', 'binaryChangeHint']) assert.equal(js.split(`${key}: '`).length - 1, 2, key);
    assert.doesNotMatch(js, /工作目录内全部自动执行，不再询问/, 'full access no longer claims commands are confined to the folder');
    const home = read('frontend/css/home-workspace.css');
    assert.match(home, /\.home-sidebar > \* \{ flex-shrink: 0; \}/);
    assert.match(home, /\.home-search \{[^}]*height: 44px;/);
});

test('risky commands show their reasons without "always allow", and undo conflicts ask first', () => {
    const panel = read('frontend/js/home/workspace-panel.js');
    assert.match(panel, /if \(risk\) detail \+= `<div class="dc-approval-risk">/);
    assert.match(panel, /\$\{risk \? '' : `<button type="button" class="dc-action" data-decision="always">/);
    assert.match(panel, /error\.code === 'AGENT_CHANGE_CONFLICT' && !force/);
    assert.match(panel, /\{ path: filePath, root: target\.root, force \}/, 'undo works after a restart by passing the folder');
    assert.match(panel, /item\.source === 'command' \? `<em class="wsp-change-src"/);
    const js = read('frontend/js/home/dragon-claw.js');
    for (const key of ['commandTag', 'riskTitle', 'revertConflictTitle', 'revertConflictMessage', 'revertConflictConfirm']) assert.equal(js.split(`${key}: '`).length - 1, 2, key);
});

test('/session lists my chats and resuming replays tool cards and command output', () => {
    const js = read('frontend/js/home/dragon-claw.js');
    assert.match(js, /\{ name: '\/session', aliases: \['\/sessions', '\/history'\], text: 'slashSession' \}/);
    assert.match(js, /if \(runSlashCommand\(content\)\) return;/, 'slash commands never reach the model');
    assert.match(js, /fetch\(`\/api\/ai\/sessions\?mine=1&pagePath=%2F&limit=50&query=/);
    assert.match(js, /resume\.items\.forEach\(item => addHistoryMessage\(item\.role, String\(item\.content\), item\.events, item\)\)/);
    assert.match(js, /workspace\(\)\?\.replayEvents\?\.\(message, events\)/);
    for (const key of ['sessionTitle', 'sessionSearch', 'sessionEmpty', 'sessionHint', 'slashSession', 'slashNew', 'toolOutput', 'toolInterrupted']) assert.equal(js.split(`${key}: '`).length - 1, 2, key);
    const panel = read('frontend/js/home/workspace-panel.js');
    assert.match(panel, /replayEvents\(messageEl, events = \[\]\) \{/);
    assert.match(panel, /if \(!event \|\| event\.type === 'change'\) continue;/, 'replay does not touch the live change list');
    assert.match(panel, /openCards\.forEach\(card => \{ if \(card && !card\.classList\.contains\('is-settled'\)\) settleCard\(card, 'abort'\); \}\);/);
    assert.match(panel, /if \(event\.output\) row\.insertAdjacentHTML\('afterend', `<details class="dc-tool-output">/);
    const css = read('frontend/css/dragon-claw.css');
    assert.match(css, /\.dc-session-picker \{/);
    assert.match(css, /\.dc-slash \{/);
});

test('resumed chats load history page by page and keep the reading position', () => {
    const js = read('frontend/js/home/dragon-claw.js');
    assert.match(js, /const HISTORY_PAGE_SIZE = 30;/);
    assert.match(js, /limit=\$\{HISTORY_PAGE_SIZE\}\$\{before \? `&before=/);
    assert.match(js, /new IntersectionObserver\(/, 'scrolling near the top loads the previous page');
    assert.match(js, /el\.thread\.scrollTop = previousTop \+ \(el\.thread\.scrollHeight - previousHeight\);/);
    assert.match(js, /state\.messages = \[\.\.\.page\.items\.map\(/, 'older turns are prepended to the model context in order');
    assert.match(js, /resetHistoryPaging\(\);\n        window\.DragonClawSkills\?\.reset\?\.\(\);[^\n]*\n        el\.thread\.innerHTML = '';/, 'a new chat drops the old paging state and kept Skills');
    for (const key of ['historyMore', 'historyLoading', 'historyFailed', 'retry', 'usageText', 'usageTitle']) assert.equal(js.split(`${key}: '`).length - 1, 2, key);
});

test('messages use icon actions: copy and resend on user messages, copy plus model and token usage on replies', () => {
    const js = read('frontend/js/home/dragon-claw.js');
    assert.match(js, /const userMessage = addMessage\('user', shownText\);\n        addUserTools\(userMessage, content, shownText\);/);
    assert.match(js, /iconButton\('retry', tx\('retry'\), 'data-dc-retry'\)/);
    assert.match(js, /addMessageTools\(reply, finalText, \{ modelName: data\.model\?\.name \|\| model\?\.name \|\| '', usage: data\.usage \}\);/);
    assert.match(js, /document\.execCommand\('copy'\)/, 'copy still works over plain http');
    const css = read('frontend/css/dragon-claw.css');
    assert.match(css, /\.dc-msg-icon \{/);
    assert.match(css, /@media \(hover: none\) \{ \.dc-msg-tools \{ opacity: 1; \} \}/);
    const format = new Function(`${js.match(/function formatTokenCount[\s\S]*?\n    \}/)[0]}; return formatTokenCount;`)();
    assert.deepEqual([0, 856, 1234, 12345, 123456, 1234567, 10000].map(format), ['0', '856', '1,234', '12.3K', '123K', '1.23M', '10K']);
});

test('slash menu supports arrow-key selection; Enter runs and Tab completes the highlighted command', () => {
    const js = read('frontend/js/home/dragon-claw.js');
    assert.match(js, /if \(event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'\) \{/);
    assert.match(js, /setSlashActive\(slashMenu\.active \+ \(event\.key === 'ArrowDown' \? 1 : -1\)\);/);
    // Exercise the menu and dispatcher together: side commands remain usable while a reply is generating.
    const commands = js.slice(js.indexOf('    const SLASH_COMMANDS = ['), js.indexOf('    async function compactContext()'));
    const keydown = js.match(/el\.input\.addEventListener\('keydown', (event => \{[\s\S]*?)\n        \}\);/)[1] + '\n}';
    const calls = [];
    const state = { controller: null };
    const el = { input: { value: '/s', focus() {} } };
    const slashMenu = { items: [{ name: '/session' }], active: 0 };
    const onKeydown = new Function('state', 'el', 'slashMenu', 'calls', `
        const autoResize = () => {}, hideSlashHints = () => {}, updateSendButton = () => {};
        const slashMenuOpen = () => true;
        const openSessionPicker = arg => calls.push(['session', arg]);
        const newChat = () => calls.push(['new']);
        const compactContext = () => calls.push(['compact']);
        const createSchedule = arg => calls.push(['schedule', arg]);
        const openSchedulePanel = () => calls.push(['schedules']);
        const startPlan = arg => calls.push(['plan', arg]);
        const askBtw = arg => calls.push(['btw', arg]);
        const external = { active: false };
        const sendExternal = () => {};
        ${commands}
        return ${keydown};
    `)(state, el, slashMenu, calls);
    const enter = () => onKeydown({ key: 'Enter', preventDefault() {} });
    enter();
    assert.deepEqual(calls.splice(0), [['session', '']], 'Enter runs the highlighted command, not the typed prefix');
    state.controller = {};
    for (const name of ['/session', '/new', '/compact']) {
        slashMenu.items[0].name = name;
        el.input.value = name;
        enter();
        assert.deepEqual(calls, [], `${name} stays blocked during generation`);
        assert.equal(el.input.value, name, 'blocked commands preserve the input');
    }
    slashMenu.items[0].name = '/schedule';
    el.input.value = '/s';
    enter();
    assert.deepEqual(calls.splice(0), [['schedules']], '/schedule opens during generation');
    slashMenu.items[0].name = '/btw';
    el.input.value = '/b';
    enter();
    assert.equal(el.input.value, '/btw ', '/btw completes the command so a question can be entered');
    assert.deepEqual(calls, [], 'a side question is not sent without arguments');
    assert.match(js, /el\.input\.value = `\$\{item\.name\} `;/, 'Tab completes the highlighted command');
    assert.match(js, /slashMenuOpen\(\) && !event\.isComposing/, 'IME composition keeps its own arrow/enter keys');
    assert.match(js, /el\.input\.setAttribute\('aria-activedescendant', `dcSlashOpt\$\{slashMenu\.active\}`\);/);
    for (const text of ["slashHint: '↑↓ 选择 · Enter 执行 · Tab 补全'", "slashHint: '↑↓ to choose · Enter to run · Tab to complete'"]) assert.ok(js.includes(text), text);
    assert.match(read('frontend/css/dragon-claw.css'), /\.dc-slash-item\.is-active \{ box-shadow: inset 2px 0 0/);
});
