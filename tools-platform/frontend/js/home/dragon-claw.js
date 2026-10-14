// 首页 Dragon Claw 智能体：落地页（问候 + 输入框 + 工具推荐轮播）与对话视图。
// - 工具推荐来自首页工具卡片（js/home/workspace.js 的 HomeWorkspace.getTools），点击后本地生成介绍，不请求模型；
// - 自由对话复用全局助手（js/shared/ai-assistant.js）的流式请求、Markdown 与依据渲染，
//   以 agent=dragon-claw-home 调用 /api/ai/chat，后端据此切换为不限领域的全能智能体人设。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            badge: '全能智能体', newChat: '新对话',
            resumeTitle: '继续上次对话', resumeMeta: '{time} · {count} 条消息', resumeAction: '继续对话', resumeBanner: '已恢复上次对话 · {time}', resumeDivider: '以上是历史记录，继续输入即可接着聊', resumeFailed: '上次对话加载失败，请稍后再试', toolOutput: '查看输出', toolInterrupted: '未完成', sessionTitle: '历史会话', sessionSearch: '搜索会话内容…', sessionEmpty: '还没有历史会话', sessionNoMatch: '没有匹配的会话', sessionLoading: '正在加载…', sessionMeta: '{time} · {count} 条消息', sessionArchived: '已归档', sessionCurrent: '当前', sessionHint: '↑↓ 选择 · Enter 打开 · Esc 关闭', sessionLoadFailed: '历史会话加载失败，请稍后再试', slashSession: '查看并恢复历史会话', slashNew: '开始新对话', slashHint: 'Enter 执行 · Tab 补全', resumeDirMissing: '上次的目录「{name}」无法打开，对话已恢复，请重新选择目录', externalTag: '外部', commandTag: '命令', commandChangeHint: '由智能体执行的命令产生的改动，可撤销', riskTitle: '此命令可能访问工作目录之外或敏感文件，每次都需要你确认', revertConflictTitle: '文件已被再次修改', revertConflictMessage: '{path} 在这次改动之后又被修改过（手动或其他程序）。撤销会把文件恢复到改动前，后续修改将一起丢失。', revertConflictConfirm: '仍然撤销', binaryChange: '二进制', binaryChangeHint: '二进制文件（如数据库、图片）内容有变化，没有可比较的文本行', externalChange: '工作区里的其他改动（手动或其他程序修改），可查看差异，不能在这里撤销', backToTools: '浏览工具', browseTools: '浏览全部工具',
            tagline: '我是 Dragon Claw，你的全能智能体。问我任何问题，或者让我带你用好平台里的工具。',
            hint: 'Enter 发送 · Shift + Enter 换行', placeholder: '给 Dragon Claw 发消息…',
            send: '发送', stop: '停止生成', you: '你',
            greetEarly: '夜深了', greetMorning: '早上好', greetNoon: '中午好', greetAfternoon: '下午好', greetEvening: '晚上好',
            spotFrequent: '你常用的', spotRandom: '随手推荐', spotAsk: '想感受一下「{name}」吗？',
            spotGo: '带我看看', spotOpen: '直接打开', spotMore: '也可以试试', spotPrev: '上一个', spotNext: '下一个',
            tryTool: '想体验一下「{name}」', introCan: '它能帮你做什么', introGroup: '分类：{group}', introUpdated: '{time}更新',
            introOpen: '打开 {name}', introAskLogic: '讲讲它的实现逻辑', introAskHow: '怎么上手使用？',
            introFooter: '点下面的按钮就能直接使用；想了解实现细节或使用技巧，也可以继续问我。',
            askLogic: '请结合项目源码，解释「{name}」（{href}）的实现逻辑、主要处理流程和关键文件。',
            askHow: '「{name}」（{href}）应该怎么上手使用？请给出具体操作步骤和注意事项。',
            promptLogic: '解释「{name}」的代码逻辑', promptMetrics: '本月哪些指标还没达标？',
            promptMail: '帮我写一封礼貌的催办提醒邮件', promptCode: '用 Python 写一个 Excel 去重脚本',
            stopped: '已停止生成', copy: '复制', copied: '已复制', unavailable: '智能体组件尚未加载，请稍后重试或刷新页面。',
            modelLabel: '选择模型', modelMenuTitle: '模型', modelMenuHint: '切换后从下一条消息开始生效',
            modelDefault: '默认模型', modelNextMessage: '已切换到 {name}，从下一条消息开始生效',
            modelSwitched: '已切换到 {name}', modelCurrent: '当前模型：{name}',
            // 工作区（本地目录上下文）
            workspace: '工作区', panelTitle: '工作区', envTitle: '环境', contextTitle: '上下文', changesTitle: '更改',
            chooseDir: '选择本地目录', chooseDirShort: '选择本地目录作为上下文', chooseDirHint: '让 Dragon Claw 读取、搜索并修改该目录下的文件，可执行命令。',
            useLastDir: '继续使用 {name}', changeDir: '更换', clearDir: '不使用工作区',
            pickerHelp: '输入路径即可联想子目录；清空输入框查看家目录与根目录。↑↓ 选择，Tab 补全，Enter 确认。',
            typedPathPlaceholder: '例如 ~/Projects/my-app 或 /Volumes/…', pickerEmptyHint: '从家目录或根目录开始，也可以直接粘贴完整路径',
            selectThisDir: '选择此目录', showHidden: '显示隐藏目录', noMatches: '没有匹配的子目录', noPermission: '没有权限读取该目录',
            dirReady: '目录存在，可以选择', notDir: '这是文件，不是目录', dirNotFound: '目录不存在，继续输入或从联想中选择',
            groupHome: '家目录', groupRoot: '根目录', recentDirs: '最近使用', workspaceReady: '已切换到工作区 {name}',
            branch: '分支', noBranch: '非 Git 仓库', permission: '权限模式',
            modeAsk: '请求批准', modeAskDesc: '写入、删除、重命名和命令都先征求你的同意', modeAuto: '帮我批准', modeAutoDesc: '读写文件自动执行；删除、重命名和命令仍需确认', modeFull: '完全访问', modeFullDesc: '全部自动执行，不再询问；命令以本机账号权限运行，不限于工作目录', readOnlyMode: '只读', readOnlyDesc: '当前账号不是管理员：可以查看和搜索文件，不能修改、删除、重命名或执行命令',
            modeChanged: '权限模式已切换为「{mode}」', approvalTitle: 'Dragon Claw 请求：{tool}', allow: '允许', deny: '拒绝', alwaysAllow: '本次会话总是允许',
            approved: '已允许', approvedAlways: '已允许（本次会话不再询问）', denied: '已拒绝', approvalTimeout: '审批超时，未执行', approvalAborted: '任务已中止', inDir: '目录：', recursive: '递归删除',
            tool_list_directory: '列出目录', tool_read_file: '读取文件', tool_search: '搜索', tool_list_databases: '列出数据库', tool_database_schema: '查看数据库结构', tool_read_database_table: '读取业务表', tool_write_file: '写入文件', tool_edit_file: '编辑文件', tool_delete_path: '删除', tool_rename_path: '移动/重命名', tool_run_command: '执行命令',
            ctxUsed: '已使用 {percent}%', ctxMessages: '对话消息', ctxDirectory: '目录上下文', ctxSystem: '系统提示', ctxTools: '工具定义', ctxFree: '剩余空间',
            ctxEmpty: '发送第一条消息后显示上下文占用', ctxNoWorkspace: '选择目录后，这里显示上下文占用明细', ctxSourceProvider: '以模型返回的实际用量为准，分项按估算比例折算', ctxSourceEstimate: '按字符数估算（约 3.5 字符 / Token）',
            noChanges: '本次会话尚未修改文件', viewDiff: '查看差异', revert: '撤销', reverted: '已撤销 {path}', diffEmpty: '（无文本差异）', createPr: '创建 PR',
            prChecking: '正在检查 git 与 gh…', prNoSession: '会话已过期，请重新发送一条消息后再创建 PR', prNoGit: '未找到 git，无法创建 PR', prNotGit: '当前目录不是 Git 仓库，无法创建 PR', prNoGh: '未检测到 GitHub CLI（gh）。请先安装：https://cli.github.com，再执行 gh auth login', prGhNotAuthed: 'gh 尚未登录，请先在终端执行 gh auth login', prNoRemote: '仓库没有 origin 远程，无法推送', prNoChanges: '本次会话没有可提交的改动',
            prFormTitle: '创建 Pull Request', prTitleLabel: '标题', prTitlePlaceholder: '例如：修复 README 首行', prBodyLabel: '说明（可选）', prBodyPlaceholder: '默认列出本次会话改动的文件', prBranchLabel: '新分支', prBaseBranch: '当前分支 {branch}', prFilesHint: '将只提交本次会话改动的 {count} 个文件', prSubmit: '开始创建', prCancel: '取消',
            prStepBranch: '新建分支', prStepAdd: '暂存本会话改动', prStepCommit: '提交', prStepPush: '推送到 origin', prStepCreate: '调用 gh pr create',
            prRunning: '正在创建 PR…', prDone: 'PR 已创建', prOpen: '打开 PR', prFailedAt: '「{step}」失败，流程已停止', prDeniedAt: '「{step}」被拒绝，流程已停止', prAborted: '创建 PR 已中止', prRetry: '重试', prClose: '关闭',
            workspaceDisabled: '工作区仅在本机或管理员账号下可用'
        },
        'en-US': {
            badge: 'All-round agent', newChat: 'New chat',
            resumeTitle: 'Continue last chat', resumeMeta: '{time} · {count} messages', resumeAction: 'Continue', resumeBanner: 'Resumed your last chat · {time}', resumeDivider: 'Earlier messages above. Keep typing to continue.', resumeFailed: 'Could not load the last chat. Try again later.', toolOutput: 'Show output', toolInterrupted: 'Not finished', sessionTitle: 'Chat history', sessionSearch: 'Search conversations…', sessionEmpty: 'No previous chats yet', sessionNoMatch: 'No matching chats', sessionLoading: 'Loading…', sessionMeta: '{time} · {count} messages', sessionArchived: 'Archived', sessionCurrent: 'Current', sessionHint: '↑↓ to move · Enter to open · Esc to close', sessionLoadFailed: 'Could not load chat history. Try again later.', slashSession: 'Browse and resume previous chats', slashNew: 'Start a new chat', slashHint: 'Enter to run · Tab to complete', resumeDirMissing: 'The previous folder "{name}" could not be opened. The chat is restored; choose a folder again.', externalTag: 'External', commandTag: 'Command', commandChangeHint: 'Changed by a command the agent ran; can be undone', riskTitle: 'This command may reach outside the folder or touch sensitive files, so it always asks', revertConflictTitle: 'File changed again', revertConflictMessage: '{path} was modified again after this change (by hand or another program). Undoing restores the earlier version and discards those later edits.', revertConflictConfirm: 'Undo anyway', binaryChange: 'Binary', binaryChangeHint: 'A binary file (such as a database or image) changed; there are no text lines to compare', externalChange: 'Other changes in the working tree (manual or by other programs). You can view the diff but not undo it here.', backToTools: 'Browse tools', browseTools: 'Browse all tools',
            tagline: 'I’m Dragon Claw, your all-round agent. Ask me anything, or let me show you around the tools on this platform.',
            hint: 'Enter to send · Shift + Enter for a new line', placeholder: 'Message Dragon Claw…',
            send: 'Send', stop: 'Stop generating', you: 'You',
            greetEarly: 'Working late', greetMorning: 'Good morning', greetNoon: 'Good afternoon', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening',
            spotFrequent: 'Your frequent tool', spotRandom: 'Picked for you', spotAsk: 'Want to try “{name}”?',
            spotGo: 'Show me', spotOpen: 'Open it', spotMore: 'Or try', spotPrev: 'Previous', spotNext: 'Next',
            tryTool: 'I’d like to try “{name}”', introCan: 'What it can do for you', introGroup: 'Category: {group}', introUpdated: 'updated {time}',
            introOpen: 'Open {name}', introAskLogic: 'Explain how it works', introAskHow: 'How do I get started?',
            introFooter: 'Use the button below to open it right away, or keep asking me about how it works.',
            askLogic: 'Using the project source code, explain how “{name}” ({href}) is implemented: its main flow and key files.',
            askHow: 'How do I get started with “{name}” ({href})? Give concrete steps and caveats.',
            promptLogic: 'Explain the code behind “{name}”', promptMetrics: 'Which metrics missed target this month?',
            promptMail: 'Draft a polite follow-up reminder email', promptCode: 'Write a Python script to dedupe an Excel file',
            stopped: 'Generation stopped', copy: 'Copy', copied: 'Copied', unavailable: 'The agent is still loading. Please retry in a moment or refresh the page.',
            modelLabel: 'Choose model', modelMenuTitle: 'Model', modelMenuHint: 'Changes apply from your next message',
            modelDefault: 'Default model', modelNextMessage: 'Switched to {name}. Applies from your next message.',
            modelSwitched: 'Switched to {name}', modelCurrent: 'Current model: {name}',
            workspace: 'Workspace', panelTitle: 'Workspace', envTitle: 'Environment', contextTitle: 'Context', changesTitle: 'Changes',
            chooseDir: 'Choose a local directory', chooseDirShort: 'Use a local directory as context', chooseDirHint: 'Let Dragon Claw read, search and edit files in that directory and run commands.',
            useLastDir: 'Continue with {name}', changeDir: 'Change', clearDir: 'Stop using workspace',
            pickerHelp: 'Type a path to see matching subdirectories; clear the box to browse home and root. ↑↓ to move, Tab to complete, Enter to confirm.',
            typedPathPlaceholder: 'e.g. ~/Projects/my-app or /Volumes/…', pickerEmptyHint: 'Start from your home or root directory, or paste a full path',
            selectThisDir: 'Use this directory', showHidden: 'Show hidden directories', noMatches: 'No matching subdirectories', noPermission: 'No permission to read this directory',
            dirReady: 'Directory exists and can be selected', notDir: 'This is a file, not a directory', dirNotFound: 'Directory not found; keep typing or pick a suggestion',
            groupHome: 'Home', groupRoot: 'Root', recentDirs: 'Recent', workspaceReady: 'Workspace switched to {name}',
            branch: 'Branch', noBranch: 'Not a Git repository', permission: 'Permissions',
            modeAsk: 'Ask to approve', modeAskDesc: 'Writes, deletes, renames and commands always ask first', modeAuto: 'Approve for me', modeAutoDesc: 'Reads and writes run automatically; deletes, renames and commands still ask', modeFull: 'Full access', modeFullDesc: 'Everything runs without asking; commands run with this computer account\'s permissions, not limited to the folder', readOnlyMode: 'Read-only', readOnlyDesc: 'This account is not an administrator: you can view and search files, but not edit, delete, rename or run commands',
            modeChanged: 'Permission mode set to "{mode}"', approvalTitle: 'Dragon Claw wants to {tool}', allow: 'Allow', deny: 'Deny', alwaysAllow: 'Always allow this session',
            approved: 'Allowed', approvedAlways: 'Allowed (no more prompts this session)', denied: 'Denied', approvalTimeout: 'Approval timed out, not executed', approvalAborted: 'Task stopped', inDir: 'in', recursive: 'recursive',
            tool_list_directory: 'list directory', tool_read_file: 'read file', tool_search: 'search', tool_list_databases: 'list databases', tool_database_schema: 'inspect database schema', tool_read_database_table: 'read business table', tool_write_file: 'write file', tool_edit_file: 'edit file', tool_delete_path: 'delete', tool_rename_path: 'move/rename', tool_run_command: 'run command',
            ctxUsed: '{percent}% used', ctxMessages: 'Messages', ctxDirectory: 'Directory context', ctxSystem: 'System prompt', ctxTools: 'Tool definitions', ctxFree: 'Free space',
            ctxEmpty: 'Context usage appears after your first message', ctxNoWorkspace: 'Pick a directory to see the context breakdown here', ctxSourceProvider: 'Based on the model’s reported usage; parts scaled from estimates', ctxSourceEstimate: 'Estimated from characters (≈3.5 chars per token)',
            noChanges: 'No files changed in this session', viewDiff: 'View diff', revert: 'Revert', reverted: 'Reverted {path}', diffEmpty: '(no text difference)', createPr: 'Create PR',
            prChecking: 'Checking git and gh…', prNoSession: 'Session expired. Send a message first, then create the PR', prNoGit: 'git was not found, cannot create a PR', prNotGit: 'This directory is not a Git repository', prNoGh: 'GitHub CLI (gh) not found. Install it from https://cli.github.com and run gh auth login', prGhNotAuthed: 'gh is not signed in. Run gh auth login in a terminal first', prNoRemote: 'The repository has no origin remote to push to', prNoChanges: 'No changes from this session to commit',
            prFormTitle: 'Create Pull Request', prTitleLabel: 'Title', prTitlePlaceholder: 'e.g. Fix README headline', prBodyLabel: 'Description (optional)', prBodyPlaceholder: 'Defaults to the list of files changed in this session', prBranchLabel: 'New branch', prBaseBranch: 'from {branch}', prFilesHint: 'Only the {count} file(s) changed in this session will be committed', prSubmit: 'Create', prCancel: 'Cancel',
            prStepBranch: 'Create branch', prStepAdd: 'Stage session changes', prStepCommit: 'Commit', prStepPush: 'Push to origin', prStepCreate: 'Run gh pr create',
            prRunning: 'Creating PR…', prDone: 'PR created', prOpen: 'Open PR', prFailedAt: '"{step}" failed, flow stopped', prDeniedAt: '"{step}" was denied, flow stopped', prAborted: 'PR creation aborted', prRetry: 'Retry', prClose: 'Close',
            workspaceDisabled: 'Workspace is available on this machine or for admins only'
        }
    };
    const AVATAR = '/assets/dragon-claw-avatar.jpg';
    const SPOTLIGHT_SIZE = 8;
    const CONTEXT_MAX_CHARS = 11000;
    const MODEL_STORAGE_KEY = 'dragon_claw_model';
    const LAST_CHAT_KEY = 'dragon_claw_last_chat'; // 本浏览器里当前用户最近一次对话的 sessionId（服务端会话不分用户，不能从列表里猜）

    const state = {
        messages: [],
        sessionId: null,
        controller: null,
        focusedTool: null,
        spotlight: [],
        spotIndex: 0,
        spotSignature: '',
        models: [],
        defaultModelId: '',
        modelId: '',
        toastTimer: null,
        resume: null
    };
    const el = {};
    const workspace = () => window.DragonClawWorkspace || null;

    function lang() {
        return window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN';
    }

    function tx(key, params = {}) {
        const template = TEXT[lang()][key] ?? TEXT['zh-CN'][key] ?? key;
        return Object.keys(params).reduce((text, name) => text.replaceAll(`{${name}}`, params[name]), template);
    }

    // 供 workspace-panel.js 共用同一套文案与轻提示
    window.DragonClawText = { tx, toast: text => showToast(text) };

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function assistant() {
        return window.ToolsAIAssistant?.requestStreamingChat ? window.ToolsAIAssistant : null;
    }

    // 全局助手由 navbar.js 异步加载；对话前等待其就绪。
    function waitForAssistant(timeoutMs = 10000) {
        if (assistant()) return Promise.resolve(assistant());
        return new Promise(resolve => {
            const startedAt = Date.now();
            const timer = setInterval(() => {
                if (assistant() || Date.now() - startedAt > timeoutMs) {
                    clearInterval(timer);
                    resolve(assistant());
                }
            }, 120);
        });
    }

    function renderMarkdown(text) {
        const api = window.ToolsAIAssistant;
        if (api?.renderMarkdown) return api.renderMarkdown(text);
        return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
    }

    function tools() {
        return window.HomeWorkspace?.getTools?.() || [];
    }

    function prefersReducedMotion() {
        return matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // ── 落地页文案 ─────────────────────────────
    function greeting() {
        const hour = new Date().getHours();
        const key = hour < 5 ? 'greetEarly' : hour < 11 ? 'greetMorning' : hour < 13 ? 'greetNoon' : hour < 18 ? 'greetAfternoon' : 'greetEvening';
        const user = localStorage.getItem('tools_user') || '';
        return user ? `${tx(key)}，${user}` : tx(key);
    }

    function applyTexts() {
        el.root.querySelectorAll('[data-dc-i18n]').forEach(node => { node.textContent = tx(node.dataset.dcI18n); });
        el.greeting.textContent = lang() === 'en-US' ? greeting().replace('，', ', ') : greeting();
        el.input.placeholder = tx('placeholder');
        el.input.setAttribute('aria-label', tx('placeholder'));
        updateSendButton();
        renderPrompts();
        renderSpotlight();
    }

    function renderPrompts() {
        const featured = state.spotlight[0];
        const prompts = [
            featured ? { label: tx('promptLogic', { name: featured.title }), prompt: tx('askLogic', { name: featured.title, href: featured.href }), tool: featured.id } : null,
            { label: tx('promptMetrics') },
            { label: tx('promptMail') },
            { label: tx('promptCode') }
        ].filter(Boolean);
        el.prompts.innerHTML = prompts.map(item => `<button type="button" class="dc-prompt" data-dc-ask="${escapeHtml(item.prompt || item.label)}" data-dc-display="${escapeHtml(item.label)}"${item.tool ? ` data-dc-tool="${escapeHtml(item.tool)}"` : ''}>${escapeHtml(item.label)}</button>`).join('');
    }

    // ── 工具推荐轮播 ───────────────────────────
    function shuffle(list) {
        const copy = list.slice();
        for (let index = copy.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(Math.random() * (index + 1));
            [copy[index], copy[swap]] = [copy[swap], copy[index]];
        }
        return copy;
    }

    function buildSpotlight() {
        const all = tools().filter(tool => tool.href && tool.title);
        const signature = all.map(tool => tool.id).sort().join('|');
        if (!all.length || signature === state.spotSignature) return;
        state.spotSignature = signature;
        const byId = new Map(all.map(tool => [tool.id, tool]));
        const recent = (window.HomeWorkspace?.recentIds?.() || []).map(id => byId.get(id)).filter(Boolean);
        const frequent = recent.slice(0, 4).map(tool => ({ ...tool, frequent: true }));
        const frequentIds = new Set(frequent.map(tool => tool.id));
        state.spotlight = [...frequent, ...shuffle(all.filter(tool => !frequentIds.has(tool.id)))].slice(0, SPOTLIGHT_SIZE);
        state.spotIndex = 0;
        renderPrompts();
        renderSpotlight();
    }

    function renderSpotlight() {
        const items = state.spotlight;
        if (!items.length) {
            el.spotlight.hidden = true;
            return;
        }
        const tool = items[state.spotIndex % items.length];
        const others = [1, 2, 3].map(step => items[(state.spotIndex + step) % items.length]).filter(item => item && item.id !== tool.id);
        el.spotlight.hidden = false;
        el.spotlight.style.setProperty('--spot-color', tool.color || '#64ffda');
        el.spotlight.innerHTML = `
            <div class="dc-spot-blob" aria-hidden="true"><span></span><span></span></div>
            <div class="dc-spot-card">
                <div class="dc-spot-icon" aria-hidden="true">${escapeHtml(tool.icon || '✨')}</div>
                <div class="dc-spot-copy">
                    <div class="dc-spot-kicker">${escapeHtml(tool.frequent ? tx('spotFrequent') : tx('spotRandom'))} · ${escapeHtml(tool.group)}</div>
                    <div class="dc-spot-title">${escapeHtml(tx('spotAsk', { name: tool.title }))}</div>
                    <div class="dc-spot-desc">${escapeHtml(tool.description)}</div>
                </div>
                <div class="dc-spot-actions">
                    <button type="button" class="dc-spot-go" data-spot-go="${escapeHtml(tool.id)}">${escapeHtml(tx('spotGo'))}</button>
                    <a class="dc-spot-open" href="${escapeHtml(tool.href)}">${escapeHtml(tx('spotOpen'))} <span aria-hidden="true">↗</span></a>
                </div>
            </div>
            <div class="dc-spot-foot">
                <div class="dc-spot-nav">
                    <button type="button" class="dc-spot-arrow" data-spot-step="-1" aria-label="${escapeHtml(tx('spotPrev'))}">‹</button>
                    <div class="dc-spot-dots">${items.map((item, index) => `<button type="button" class="dc-spot-dot${index === state.spotIndex % items.length ? ' is-active' : ''}" data-spot-index="${index}" aria-label="${escapeHtml(item.title)}"></button>`).join('')}</div>
                    <button type="button" class="dc-spot-arrow" data-spot-step="1" aria-label="${escapeHtml(tx('spotNext'))}">›</button>
                </div>
                <div class="dc-spot-more"><span>${escapeHtml(tx('spotMore'))}</span>${others.map(item => `<button type="button" class="dc-spot-chip" data-spot-go="${escapeHtml(item.id)}">${escapeHtml(item.icon || '')} ${escapeHtml(item.title)}</button>`).join('')}</div>
            </div>
            <div class="dc-spot-progress" aria-hidden="true"><span></span></div>`;
        // 进度条动画结束即切到下一个；悬停/聚焦时 CSS 暂停动画，等于暂停轮播。
        el.spotlight.querySelector('.dc-spot-progress span')?.addEventListener('animationend', () => stepSpotlight(1));
    }

    function stepSpotlight(step, absoluteIndex) {
        const count = state.spotlight.length;
        if (!count) return;
        const next = absoluteIndex ?? (state.spotIndex + step + count) % count;
        if (prefersReducedMotion()) {
            state.spotIndex = next;
            renderSpotlight();
            return;
        }
        const card = el.spotlight.querySelector('.dc-spot-card');
        card?.classList.add('is-leaving');
        setTimeout(() => {
            state.spotIndex = next;
            renderSpotlight();
            el.spotlight.querySelector('.dc-spot-card')?.classList.add('is-entering');
        }, card ? 320 : 0);
    }

    // ── 模型选择（参考 ChatGPT / Claude Code：输入框旁弹出菜单，切换从下一条消息生效）──
    function readStoredModel() {
        try { return localStorage.getItem(MODEL_STORAGE_KEY) || ''; } catch { return ''; }
    }

    function storeModel(id) {
        try { localStorage.setItem(MODEL_STORAGE_KEY, id); } catch { /* 存储不可用时仅本次有效 */ }
    }

    function currentModel() {
        return state.models.find(item => item.id === state.modelId)
            || state.models.find(item => item.id === state.defaultModelId)
            || state.models[0]
            || null;
    }

    async function loadModels() {
        try {
            const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
            const res = await fetch('/api/ai/models', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            state.models = Array.isArray(data.models) ? data.models : [];
            state.defaultModelId = data.defaultId || state.models[0]?.id || '';
        } catch {
            state.models = [];
        }
        // 记住的选择失效（被管理员删除或改名）时回退到默认模型。
        const stored = readStoredModel();
        state.modelId = state.models.some(item => item.id === stored) ? stored : state.defaultModelId;
        renderModelPicker();
    }

    function renderModelPicker() {
        const model = currentModel();
        el.model.hidden = !model;
        if (!model) return;
        el.modelName.textContent = model.name;
        el.modelBtn.title = tx('modelCurrent', { name: model.name });
        el.modelBtn.setAttribute('aria-label', `${tx('modelLabel')} · ${model.name}`);
        el.modelBtn.disabled = state.models.length < 2;
        el.modelMenu.setAttribute('aria-label', tx('modelLabel'));
        el.modelMenu.innerHTML = `
            <div class="dc-model-menu-head"><b>${escapeHtml(tx('modelMenuTitle'))}</b><span>${escapeHtml(tx('modelMenuHint'))}</span></div>
            ${state.models.map(item => {
                const selected = item.id === model.id;
                const description = item.description || (item.id === state.defaultModelId ? tx('modelDefault') : '');
                return `<button type="button" class="dc-model-option${selected ? ' is-selected' : ''}" role="option" aria-selected="${selected}" data-dc-model="${escapeHtml(item.id)}">
                    <span class="dc-model-option-text"><span class="dc-model-option-name">${escapeHtml(item.name)}</span>${description ? `<span class="dc-model-option-desc">${escapeHtml(description)}</span>` : ''}</span>
                    <svg class="dc-model-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>`;
            }).join('')}`;
    }

    function modelMenuOpen() {
        return !el.modelMenu.hidden;
    }

    function toggleModelMenu(open = !modelMenuOpen()) {
        if (open && el.modelBtn.disabled) return;
        el.modelMenu.hidden = !open;
        el.modelBtn.setAttribute('aria-expanded', String(open));
        el.model.classList.toggle('is-open', open);
        if (!open) return;
        // 上方空间不足时向下展开（落地页输入框靠上时）。
        const rect = el.modelBtn.getBoundingClientRect();
        el.model.classList.toggle('opens-down', rect.top < el.modelMenu.offsetHeight + 24);
        (el.modelMenu.querySelector('.is-selected') || el.modelMenu.querySelector('[data-dc-model]'))?.focus();
    }

    function selectModel(id) {
        const next = state.models.find(item => item.id === id);
        toggleModelMenu(false);
        el.modelBtn.focus();
        if (!next || next.id === state.modelId) return;
        state.modelId = next.id;
        storeModel(next.id);
        renderModelPicker();
        // 正在生成的回复不受影响；对话中提示从下一条消息起生效。
        const inConversation = Boolean(state.controller || state.messages.length);
        showToast(tx(inConversation ? 'modelNextMessage' : 'modelSwitched', { name: next.name }));
    }

    function showToast(text) {
        clearTimeout(state.toastTimer);
        el.toast.textContent = text;
        el.toast.classList.add('is-visible');
        state.toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2600);
    }

    function bindModelPicker() {
        el.modelBtn.addEventListener('click', () => toggleModelMenu());
        el.modelMenu.addEventListener('click', event => {
            const option = event.target.closest('[data-dc-model]');
            if (option) selectModel(option.dataset.dcModel);
        });
        el.modelMenu.addEventListener('keydown', event => {
            const options = [...el.modelMenu.querySelectorAll('[data-dc-model]')];
            const index = options.indexOf(document.activeElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                options[(index + step + options.length) % options.length]?.focus();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                toggleModelMenu(false);
                el.modelBtn.focus();
            } else if (event.key === 'Tab') {
                toggleModelMenu(false);
            }
        });
        document.addEventListener('pointerdown', event => {
            if (modelMenuOpen() && !el.model.contains(event.target)) toggleModelMenu(false);
        });
    }

    // ── 对话视图 ───────────────────────────────
    function setChatting(chatting) {
        if (document.body.classList.contains('dc-chatting') === chatting) return;
        document.body.classList.toggle('dc-chatting', chatting);
        window.dispatchEvent(new CustomEvent('home:chat-state', { detail: { chatting } }));
        if (chatting) window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function nearBottom() {
        return el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 80;
    }

    function scrollThread(force = false) {
        if (force || nearBottom()) el.thread.scrollTop = el.thread.scrollHeight;
    }

    function addMessage(role, text = '') {
        const message = document.createElement('div');
        message.className = `dc-msg dc-msg--${role}`;
        message.innerHTML = role === 'ai'
            ? `<img class="dc-msg-avatar" src="${AVATAR}" alt=""><div class="dc-msg-main"><div class="dc-msg-body"></div></div>`
            : `<div class="dc-msg-main"><div class="dc-msg-body"></div></div>`;
        const body = message.querySelector('.dc-msg-body');
        if (role === 'user') body.textContent = text;
        el.thread.appendChild(message);
        scrollThread(true);
        return message;
    }

    function showThinking(message) {
        message.querySelector('.dc-msg-body').innerHTML = '<span class="dc-thinking" aria-label="…"><i></i><i></i><i></i></span>';
    }

    // 平滑的逐段渲染，流式与本地介绍共用。
    function createRenderer(message) {
        const body = message.querySelector('.dc-msg-body');
        let received = '';
        let visible = '';
        let timer = null;
        let resolveIdle = null;
        message.classList.add('is-streaming');
        const paint = () => {
            timer = null;
            const pending = received.length - visible.length;
            if (pending <= 0) {
                resolveIdle?.();
                return;
            }
            const step = pending > 800 ? 120 : pending > 240 ? 42 : pending > 60 ? 14 : Math.max(1, Math.ceil(pending / 4));
            visible = received.slice(0, visible.length + step);
            body.innerHTML = renderMarkdown(visible) || '&nbsp;';
            scrollThread();
            timer = setTimeout(paint, 26);
        };
        return {
            append(delta) {
                received += String(delta || '');
                if (!timer) timer = setTimeout(paint, 16);
            },
            idle() {
                if (!timer && visible.length >= received.length) return Promise.resolve();
                return new Promise(resolve => { resolveIdle = resolve; });
            },
            finish(finalText) {
                if (timer) clearTimeout(timer);
                timer = null;
                received = String(finalText ?? received);
                visible = received;
                body.innerHTML = renderMarkdown(received);
                message.classList.remove('is-streaming');
                resolveIdle?.();
                return received;
            },
            current: () => received
        };
    }

    function addMessageTools(message, text, extraHtml = '') {
        const bar = document.createElement('div');
        bar.className = 'dc-msg-tools';
        bar.innerHTML = `${extraHtml}<button type="button" class="dc-msg-tool" data-dc-copy>${escapeHtml(tx('copy'))}</button>`;
        bar.querySelector('[data-dc-copy]').dataset.dcCopy = text;
        message.querySelector('.dc-msg-main').appendChild(bar);
    }

    function toolIntro(tool) {
        const lines = [`**${tool.icon ? `${tool.icon} ` : ''}${tool.title}** — ${tool.description}`];
        if (tool.tags.length) {
            lines.push('', `**${tx('introCan')}**`, ...tool.tags.slice(0, 5).map(tag => `- ${tag}`));
        }
        const meta = [tx('introGroup', { group: tool.group }), tool.updatedText ? tx('introUpdated', { time: tool.updatedText }) : ''].filter(Boolean).join(' · ');
        lines.push('', `> ${meta}`, '', tx('introFooter'));
        return lines.join('\n');
    }

    async function introduceTool(toolId) {
        const tool = tools().find(item => item.id === toolId) || state.spotlight.find(item => item.id === toolId);
        if (!tool || state.controller) return;
        state.focusedTool = tool;
        setChatting(true);
        const question = tx('tryTool', { name: tool.title });
        addMessage('user', question);
        const reply = addMessage('ai');
        showThinking(reply);
        await new Promise(resolve => setTimeout(resolve, prefersReducedMotion() ? 0 : 420));
        const intro = toolIntro(tool);
        const renderer = createRenderer(reply);
        renderer.append(intro);
        await renderer.idle();
        renderer.finish(intro);
        state.messages.push({ role: 'user', content: question }, { role: 'model', content: intro });
        const actions = `
            <a class="dc-action dc-action--primary" href="${escapeHtml(tool.href)}">${escapeHtml(tx('introOpen', { name: tool.title }))} <span aria-hidden="true">↗</span></a>
            <button type="button" class="dc-action" data-dc-ask="${escapeHtml(tx('askLogic', { name: tool.title, href: tool.href }))}" data-dc-display="${escapeHtml(tx('introAskLogic'))}">${escapeHtml(tx('introAskLogic'))}</button>
            <button type="button" class="dc-action" data-dc-ask="${escapeHtml(tx('askHow', { name: tool.title, href: tool.href }))}" data-dc-display="${escapeHtml(tx('introAskHow'))}">${escapeHtml(tx('introAskHow'))}</button>`;
        const actionRow = document.createElement('div');
        actionRow.className = 'dc-actions';
        actionRow.innerHTML = actions;
        reply.querySelector('.dc-msg-main').appendChild(actionRow);
        scrollThread(true);
        el.input.focus();
    }

    // 提供给模型的上下文：平台工具目录 + 当前聚焦工具，便于推荐时给出真实链接。
    function buildContext() {
        const catalog = tools().map(tool => `- ${tool.title}｜${tool.href}｜${tool.group}｜${tool.description.slice(0, 90)}`);
        const focus = state.focusedTool
            ? `当前对话聚焦的工具：${state.focusedTool.title}（${state.focusedTool.href}）— ${state.focusedTool.description}\n\n`
            : '';
        let context = `${focus}平台工具目录（名称｜路径｜分类｜简介）：\n`;
        for (const line of catalog) {
            if (context.length + line.length > CONTEXT_MAX_CHARS) break;
            context += `${line}\n`;
        }
        return context;
    }

    // ── 工具数据：浏览器本地部分 ─────────────────────
    // 服务端快照/状态/数据库由后端直接读取；只存在用户浏览器 localStorage 的工具数据由这里随问题附带，
    // 后端（ai-tool-data-service.js）再统一匹配工具并压缩成摘要。键名来自 /api/ai/tool-local-keys。
    const DATA_INTENT_RE = /多少|几[个次人笔条天]|统计|数据|人次|人数|次数|总[数计共额]|一共|合计|汇总|平均|趋势|对比|分布|排名|最[多少高低]|上个?月|本月|这个月|最近|最新|\d{1,2}\s*月|明细|名单|记录|快照|情况|分析|how many|count|total|trend|data|records?/i;
    const LOCAL_VALUE_MAX_CHARS = 60000;
    let localKeysPromise = null;

    function loadLocalKeys() {
        if (!localKeysPromise) {
            localKeysPromise = (window.API?.get ? window.API.get('/api/ai/tool-local-keys') : Promise.resolve({ keys: {} }))
                .then(data => data?.keys || {})
                .catch(() => {
                    localKeysPromise = null;
                    return {};
                });
        }
        return localKeysPromise;
    }

    function textGrams(value) {
        const text = String(value || '').toLowerCase().replace(/[^a-z0-9㐀-鿿]+/g, '');
        const grams = new Set();
        for (let index = 0; index < text.length - 1; index += 1) grams.add(text.slice(index, index + 2));
        return grams;
    }

    // 粗筛可能相关的工具（宽松；精确匹配由后端完成）。
    function likelyTools(question) {
        const questionGrams = textGrams(question);
        return tools()
            .filter(tool => tool.id.startsWith('custom:'))
            .map(tool => {
                const grams = textGrams(tool.title);
                let shared = 0;
                grams.forEach(gram => { if (questionGrams.has(gram)) shared += 1; });
                const focused = state.focusedTool?.id === tool.id;
                return { tool, score: focused ? 99 : shared };
            })
            .filter(item => item.score >= 2)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(item => item.tool);
    }

    async function collectClientToolData(question) {
        if (!DATA_INTENT_RE.test(question)) return [];
        const candidates = likelyTools(question);
        if (!candidates.length) return [];
        const keysBySlug = await loadLocalKeys();
        const entries = [];
        for (const tool of candidates) {
            const slug = tool.id.slice('custom:'.length);
            for (const key of keysBySlug[slug] || []) {
                // 以 _ : . - 结尾的是键名前缀（如 salary_calc_2026），取最多 5 个实际键。
                const actualKeys = /[_:.-]$/.test(key)
                    ? Object.keys(localStorage).filter(name => name.startsWith(key)).slice(0, 5)
                    : [key];
                actualKeys.forEach(name => {
                    const value = localStorage.getItem(name);
                    if (value && value.length > 2) entries.push({ slug, key: name, value: value.slice(0, LOCAL_VALUE_MAX_CHARS) });
                });
            }
        }
        return entries.slice(0, 12);
    }

    function updateSendButton() {
        const generating = Boolean(state.controller);
        el.form.classList.toggle('is-generating', generating);
        el.send.setAttribute('aria-label', generating ? tx('stop') : tx('send'));
        el.send.title = generating ? tx('stop') : tx('send');
        el.send.disabled = !generating && !el.input.value.trim();
    }

    // 斜杠命令：/session [关键词] 打开历史会话，/new 新对话；其他以 / 开头的内容照常发送
    const SLASH_COMMANDS = [
        { name: '/session', aliases: ['/sessions', '/history'], text: 'slashSession' },
        { name: '/new', aliases: [], text: 'slashNew' }
    ];

    function runSlashCommand(content) {
        const match = content.match(/^(\/[a-z]+)(?:\s+(.*))?$/i);
        if (!match) return false;
        const name = match[1].toLowerCase();
        const command = SLASH_COMMANDS.find(item => item.name === name || item.aliases.includes(name));
        if (!command) return false;
        el.input.value = '';
        autoResize();
        hideSlashHints();
        if (command.name === '/session') openSessionPicker(match[2] || '');
        else if (command.name === '/new') newChat();
        return true;
    }

    async function send(text, displayText = text) {
        const content = String(text || '').trim();
        if (!content || state.controller) return;
        if (runSlashCommand(content)) return;
        setChatting(true);
        addMessage('user', String(displayText || content).trim());
        el.input.value = '';
        autoResize();
        state.messages.push({ role: 'user', content });
        const reply = addMessage('ai');
        showThinking(reply);
        const controller = new AbortController();
        state.controller = controller;
        updateSendButton();

        const api = await waitForAssistant();
        if (!api) {
            reply.querySelector('.dc-msg-body').innerHTML = renderMarkdown(`⚠️ ${tx('unavailable')}`);
            state.messages.pop();
            state.controller = null;
            updateSendButton();
            return;
        }
        const renderer = createRenderer(reply);
        // 发送时锁定模型：生成过程中切换只影响下一条消息。
        const model = currentModel();
        const workspacePayload = workspace()?.getWorkspacePayload?.() || null;
        let started = false;
        try {
            const clientToolData = await collectClientToolData(`${state.messages.slice(-3, -1).map(item => item.role === 'user' ? item.content : '').join('\n')}\n${content}`);
            const data = await api.requestStreamingChat({
                toolSlug: state.focusedTool?.id || '',
                clientToolData,
                messages: state.messages.slice(-12),
                context: buildContext(),
                pageTitle: 'Dragon Claw · 首页',
                pagePath: '/',
                uiLanguage: lang() === 'en-US' ? 'en' : 'zh',
                sessionId: state.sessionId,
                agent: 'dragon-claw-home',
                ...(model ? { modelId: model.id } : {}),
                // 工作区（本地目录）模式：后端走工具调用循环，事件由面板渲染
                ...(workspacePayload ? { workspace: workspacePayload } : {})
            }, {
                signal: controller.signal,
                onDelta: delta => {
                    if (!delta) return;
                    started = true;
                    renderer.append(delta);
                },
                onEvent: event => workspace()?.handleEvent(reply, event)
            });
            if (data.sessionId) {
                state.sessionId = data.sessionId;
                rememberLastChat(data.sessionId, workspacePayload ? { agentSessionId: data.agentSessionId || workspacePayload.agentSessionId, root: data.agent?.root || workspacePayload.root } : null);
            }
            if (workspacePayload) workspace()?.applyDone(data);
            const finalText = renderer.finish(data.reply || renderer.current());
            state.messages.push({ role: 'model', content: finalText });
            const grounding = api.renderGrounding ? api.renderGrounding(data.grounding) : '';
            if (grounding) reply.querySelector('.dc-msg-main').insertAdjacentHTML('beforeend', grounding);
            const modelName = data.model?.name || model?.name;
            addMessageTools(reply, finalText, modelName ? `<span class="dc-msg-model" title="${escapeHtml(tx('modelCurrent', { name: modelName }))}">${escapeHtml(modelName)}</span>` : '');
        } catch (error) {
            const partial = renderer.finish();
            if (error?.name === 'AbortError') {
                if (partial) {
                    state.messages.push({ role: 'model', content: partial });
                    reply.querySelector('.dc-msg-main').insertAdjacentHTML('beforeend', `<div class="dc-msg-note">${escapeHtml(tx('stopped'))}</div>`);
                } else {
                    reply.remove();
                    state.messages.pop();
                }
            } else {
                if (!started) state.messages.pop();
                reply.querySelector('.dc-msg-body').innerHTML = renderMarkdown(`${partial ? `${partial}\n\n` : ''}> ⚠️ ${error?.message || error}`);
            }
        } finally {
            if (state.controller === controller) state.controller = null;
            updateSendButton();
            scrollThread();
        }
    }

    // ── 接着上次对话 ─────────────────────────────
    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function currentUser() {
        try { return localStorage.getItem('tools_user') || ''; } catch { return ''; }
    }

    function readLastChat() {
        try {
            const saved = JSON.parse(localStorage.getItem(LAST_CHAT_KEY) || 'null');
            return saved && saved.sessionId && saved.user === currentUser() ? saved : null;
        } catch {
            return null;
        }
    }

    // agent：这次对话用过的工作区智能体会话 { agentSessionId, root }，续接时一并接回，模型才记得做过的工具操作
    function rememberLastChat(sessionId, agent = null) {
        if (!sessionId) return;
        const previous = readLastChat();
        const keptAgent = agent?.agentSessionId && agent?.root ? agent : (previous?.sessionId === sessionId ? previous.agent : null);
        try {
            localStorage.setItem(LAST_CHAT_KEY, JSON.stringify({ sessionId, user: currentUser(), updatedAt: Date.now(), ...(keptAgent ? { agent: keptAgent } : {}) }));
        } catch { /* 存储不可用时不提供续接 */ }
    }

    function forgetLastChat() {
        try { localStorage.removeItem(LAST_CHAT_KEY); } catch { /* ignore */ }
    }

    // 数据库时间是 UTC 的 "YYYY-MM-DD HH:MM:SS"
    function formatChatTime(value) {
        const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(String(value)) ? value : `${String(value || '').replace(' ', 'T')}Z`);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString(lang() === 'en-US' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function hideResumeCard() {
        if (el.resume) el.resume.hidden = true;
    }

    async function refreshResumeCard() {
        hideResumeCard();
        state.resume = null;
        const saved = readLastChat();
        if (!saved || !el.resume || saved.sessionId === state.sessionId) return;
        try {
            const res = await fetch(`/api/ai/sessions/${encodeURIComponent(saved.sessionId)}/messages`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const items = ((await res.json()).items || []).filter(item => item && (item.role === 'user' || item.role === 'model') && item.content);
            if (!items.length) {
                forgetLastChat();
                return;
            }
            if (state.messages.length || saved.sessionId === state.sessionId) return; // 期间已开始聊天
            const lastQuestion = [...items].reverse().find(item => item.role === 'user')?.content || '';
            const time = formatChatTime(items[items.length - 1].created_at);
            state.resume = { sessionId: saved.sessionId, items, time, agent: saved.agent || null };
            el.resume.innerHTML = `
                <span class="dc-resume-icon" aria-hidden="true">↺</span>
                <span class="dc-resume-text">
                    <b>${escapeHtml(tx('resumeTitle'))}</b>
                    <span class="dc-resume-question" title="${escapeHtml(lastQuestion)}">${escapeHtml(lastQuestion)}</span>
                    <small>${escapeHtml(tx('resumeMeta', { time, count: items.length }))}</small>
                </span>
                <button type="button" class="dc-action dc-action--primary" data-dc-resume>${escapeHtml(tx('resumeAction'))}</button>`;
            el.resume.hidden = false;
        } catch {
            hideResumeCard();
        }
    }

    function addHistoryMessage(role, text, events = []) {
        const message = addMessage(role === 'model' ? 'ai' : 'user', text);
        message.classList.add('dc-msg--history');
        if (role === 'model') {
            message.querySelector('.dc-msg-body').innerHTML = renderMarkdown(text);
            // 工具调用、审批、命令输出：按入库记录重放
            if (Array.isArray(events) && events.length) workspace()?.replayEvents?.(message, events);
        }
        return message;
    }

    function resumeChat(resume = state.resume) {
        if (!resume || state.controller) return;
        state.messages = resume.items.map(item => ({ role: item.role === 'model' ? 'model' : 'user', content: String(item.content) }));
        state.sessionId = resume.sessionId;
        state.focusedTool = null;
        if (resume.agent) workspace()?.resumeWorkspace?.(resume.agent);
        el.thread.innerHTML = `<div class="dc-history-banner"><span aria-hidden="true">↺</span>${escapeHtml(tx('resumeBanner', { time: resume.time }))}</div>`;
        resume.items.forEach(item => addHistoryMessage(item.role, String(item.content), item.events));
        rememberLastChat(resume.sessionId, resume.agent);
        el.thread.insertAdjacentHTML('beforeend', `<div class="dc-history-divider"><span>${escapeHtml(tx('resumeDivider'))}</span></div>`);
        hideResumeCard();
        setChatting(true);
        scrollThread(true);
        el.input.focus({ preventScroll: true });
    }

    // ── 斜杠命令提示 ─────────────────────────────
    function hideSlashHints() {
        if (el.slash) el.slash.hidden = true;
    }

    function renderSlashHints() {
        const value = el.input.value;
        if (!value.startsWith('/') || /\s/.test(value.trim()) && !/^\/\S+\s*$/.test(value)) return hideSlashHints();
        const typed = value.trim().toLowerCase();
        const list = SLASH_COMMANDS.filter(item => [item.name, ...item.aliases].some(name => name.startsWith(typed) || typed.startsWith(name)));
        if (!list.length) return hideSlashHints();
        el.slash.innerHTML = `${list.map(item => `<button type="button" class="dc-slash-item" role="option" data-dc-slash="${item.name}"><b>${item.name}</b><span>${escapeHtml(tx(item.text))}</span></button>`).join('')}<div class="dc-slash-hint">${escapeHtml(tx('slashHint'))}</div>`;
        el.slash.hidden = false;
    }

    // ── /session 历史会话 ────────────────────────
    const sessionPicker = { el: null, items: [], active: 0, timer: null, seq: 0 };

    function closeSessionPicker() {
        if (!sessionPicker.el) return;
        sessionPicker.el.remove();
        sessionPicker.el = null;
        el.input.focus({ preventScroll: true });
    }

    function renderSessionList() {
        const list = sessionPicker.el?.querySelector('.dc-session-list');
        if (!list) return;
        if (!sessionPicker.items.length) {
            const empty = sessionPicker.el.querySelector('.dc-session-search').value.trim() ? tx('sessionNoMatch') : tx('sessionEmpty');
            list.innerHTML = `<div class="dc-session-empty">${escapeHtml(empty)}</div>`;
            return;
        }
        list.innerHTML = sessionPicker.items.map((item, index) => {
            const title = item.firstQuestion || item.lastQuestion || item.id;
            const folder = item.agent?.root ? item.agent.root.split(/[\\/]/).filter(Boolean).pop() : '';
            return `<button type="button" class="dc-session-item${index === sessionPicker.active ? ' is-active' : ''}" role="option" aria-selected="${index === sessionPicker.active}" data-dc-session="${index}">
                <span class="dc-session-title">${escapeHtml(title)}${item.id === state.sessionId ? `<em class="dc-session-tag is-current">${escapeHtml(tx('sessionCurrent'))}</em>` : ''}${item.archived ? `<em class="dc-session-tag">${escapeHtml(tx('sessionArchived'))}</em>` : ''}</span>
                ${item.lastQuestion && item.lastQuestion !== item.firstQuestion ? `<span class="dc-session-last">${escapeHtml(item.lastQuestion)}</span>` : ''}
                <span class="dc-session-meta">${escapeHtml(tx('sessionMeta', { time: formatChatTime(item.updatedAt), count: item.messageCount }))}${folder ? ` · 📁 ${escapeHtml(folder)}` : ''}</span>
            </button>`;
        }).join('');
        list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    }

    async function loadSessionList(query = '') {
        const seq = ++sessionPicker.seq;
        const list = sessionPicker.el?.querySelector('.dc-session-list');
        if (list && !sessionPicker.items.length) list.innerHTML = `<div class="dc-session-empty">${escapeHtml(tx('sessionLoading'))}</div>`;
        try {
            const res = await fetch(`/api/ai/sessions?mine=1&pagePath=%2F&limit=50&query=${encodeURIComponent(query)}`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (seq !== sessionPicker.seq || !sessionPicker.el) return;
            sessionPicker.items = Array.isArray(data.items) ? data.items : [];
            sessionPicker.active = 0;
            renderSessionList();
        } catch {
            if (list && seq === sessionPicker.seq) list.innerHTML = `<div class="dc-session-empty">${escapeHtml(tx('sessionLoadFailed'))}</div>`;
        }
    }

    async function openSession(item) {
        if (!item || state.controller) return;
        try {
            const res = await fetch(`/api/ai/sessions/${encodeURIComponent(item.id)}/messages`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const items = ((await res.json()).items || []).filter(row => row && (row.role === 'user' || row.role === 'model') && row.content);
            if (!items.length) return showToast(tx('sessionLoadFailed'));
            closeSessionPicker();
            const local = readLastChat();
            const agent = item.agent || (local?.sessionId === item.id ? local.agent : null);
            workspace()?.resetSession?.(); // 先离开当前智能体会话，再接回该对话的
            el.thread.innerHTML = '';
            resumeChat({ sessionId: item.id, items, time: formatChatTime(items[items.length - 1].created_at), agent });
        } catch {
            showToast(tx('sessionLoadFailed'));
        }
    }

    function openSessionPicker(query = '') {
        if (sessionPicker.el) closeSessionPicker();
        const overlay = document.createElement('div');
        overlay.className = 'dc-session-picker';
        overlay.innerHTML = `
            <div class="dc-session-backdrop" data-dc-session-close></div>
            <div class="dc-session-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(tx('sessionTitle'))}">
                <div class="dc-session-head"><b>${escapeHtml(tx('sessionTitle'))}</b><button type="button" class="dc-session-close" data-dc-session-close aria-label="×">×</button></div>
                <input type="search" class="dc-session-search" placeholder="${escapeHtml(tx('sessionSearch'))}" value="${escapeHtml(query)}" autocomplete="off" spellcheck="false">
                <div class="dc-session-list" role="listbox"></div>
                <div class="dc-session-foot">${escapeHtml(tx('sessionHint'))}</div>
            </div>`;
        document.body.appendChild(overlay);
        sessionPicker.el = overlay;
        sessionPicker.items = [];
        const search = overlay.querySelector('.dc-session-search');
        overlay.addEventListener('click', event => {
            if (event.target.closest('[data-dc-session-close]')) return closeSessionPicker();
            const button = event.target.closest('[data-dc-session]');
            if (button) openSession(sessionPicker.items[Number(button.dataset.dcSession)]);
        });
        search.addEventListener('input', () => {
            clearTimeout(sessionPicker.timer);
            sessionPicker.timer = setTimeout(() => loadSessionList(search.value), 220);
        });
        search.addEventListener('keydown', event => {
            const count = sessionPicker.items.length;
            if (event.key === 'Escape') { event.preventDefault(); closeSessionPicker(); }
            else if (event.key === 'ArrowDown' && count) { event.preventDefault(); sessionPicker.active = (sessionPicker.active + 1) % count; renderSessionList(); }
            else if (event.key === 'ArrowUp' && count) { event.preventDefault(); sessionPicker.active = (sessionPicker.active - 1 + count) % count; renderSessionList(); }
            else if (event.key === 'Enter' && !event.isComposing && count) { event.preventDefault(); openSession(sessionPicker.items[sessionPicker.active]); }
        });
        search.focus();
        loadSessionList(query);
    }

    function newChat() {
        state.controller?.abort();
        workspace()?.resetSession?.();
        state.messages = [];
        state.sessionId = null;
        state.focusedTool = null;
        el.thread.innerHTML = '';
        setChatting(false);
        refreshResumeCard(); // 刚离开的对话可以再接回去
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        el.input.focus();
    }

    function autoResize() {
        el.input.style.height = 'auto';
        el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
        updateSendButton();
    }

    function openKnowledgeGraphFrom(trigger) {
        const api = window.ToolsAIAssistant;
        if (!api?.openKnowledgeGraph) return;
        if (trigger.dataset.graphOptions) {
            try {
                api.openKnowledgeGraph(JSON.parse(trigger.dataset.graphOptions));
                return;
            } catch {
                // 退回知识来源视图
            }
        }
        let sources = [];
        try { sources = JSON.parse(trigger.dataset.knowledgeSources || '[]'); } catch { sources = []; }
        api.openKnowledgeGraph({ mode: 'knowledge', sources });
    }

    function bindEvents() {
        el.form.addEventListener('submit', event => {
            event.preventDefault();
            if (state.controller) state.controller.abort();
            else send(el.input.value);
        });
        el.input.addEventListener('input', () => {
            autoResize();
            renderSlashHints();
        });
        el.input.addEventListener('keydown', event => {
            if (event.key === 'Tab' && !el.slash.hidden) {
                const first = el.slash.querySelector('[data-dc-slash]');
                if (first) {
                    event.preventDefault();
                    el.input.value = `${first.dataset.dcSlash} `;
                    renderSlashHints();
                }
                return;
            }
            if (event.key === 'Escape' && !el.slash.hidden) {
                hideSlashHints();
                return;
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                if (!state.controller) send(el.input.value);
            }
        });

        el.root.addEventListener('click', async event => {
            const target = event.target;
            const go = target.closest('[data-spot-go]');
            if (go) return introduceTool(go.dataset.spotGo);
            const stepBtn = target.closest('[data-spot-step]');
            if (stepBtn) return stepSpotlight(Number(stepBtn.dataset.spotStep));
            const dot = target.closest('[data-spot-index]');
            if (dot) return stepSpotlight(0, Number(dot.dataset.spotIndex));
            if (target.closest('[data-dc-resume]')) return resumeChat();
            const slash = target.closest('[data-dc-slash]');
            if (slash) return runSlashCommand(slash.dataset.dcSlash);
            const ask = target.closest('[data-dc-ask]');
            if (ask) {
                if (ask.dataset.dcTool) state.focusedTool = tools().find(tool => tool.id === ask.dataset.dcTool) || state.focusedTool;
                return send(ask.dataset.dcAsk, ask.dataset.dcDisplay || ask.dataset.dcAsk);
            }
            const copy = target.closest('[data-dc-copy]');
            if (copy) {
                try {
                    await navigator.clipboard.writeText(copy.dataset.dcCopy || '');
                    copy.textContent = tx('copied');
                    setTimeout(() => { copy.textContent = tx('copy'); }, 1400);
                } catch {
                    // 剪贴板不可用时忽略
                }
                return;
            }
            const graph = target.closest('.dc-thread [data-open-knowledge-graph]');
            if (graph) {
                event.stopPropagation();
                openKnowledgeGraphFrom(graph);
            }
        });

        el.newChat.addEventListener('click', newChat);
        el.back.addEventListener('click', () => {
            setChatting(false);
            requestAnimationFrame(() => window.HomeWorkspace?.scrollToTools?.());
        });
        el.scrollHint.addEventListener('click', () => window.HomeWorkspace?.scrollToTools?.());

        window.addEventListener('home:show-agent', () => {
            if (state.messages.length) setChatting(true);
            else window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
            el.input.focus({ preventScroll: true });
        });
        window.addEventListener('home:show-tools', () => setChatting(false));
        window.addEventListener('home:tools-updated', buildSpotlight);
        window.addEventListener('tools:languagechange', () => {
            applyTexts();
            if (!state.messages.length) refreshResumeCard();
            renderModelPicker();
        });
    }

    function init() {
        el.root = document.getElementById('dragonClaw');
        if (!el.root) return;
        el.thread = document.getElementById('dcThread');
        el.form = document.getElementById('dcComposer');
        el.input = document.getElementById('dcInput');
        el.send = document.getElementById('dcSend');
        el.prompts = document.getElementById('dcPrompts');
        el.spotlight = document.getElementById('dcSpotlight');
        el.greeting = document.getElementById('dcGreeting');
        el.newChat = document.getElementById('dcNewChat');
        el.back = document.getElementById('dcBackToTools');
        el.scrollHint = document.getElementById('dcScrollHint');
        el.model = document.getElementById('dcModel');
        el.modelBtn = document.getElementById('dcModelBtn');
        el.modelName = document.getElementById('dcModelName');
        el.modelMenu = document.getElementById('dcModelMenu');
        el.toast = document.getElementById('dcToast');
        el.slash = document.createElement('div');
        el.slash.className = 'dc-slash';
        el.slash.hidden = true;
        el.slash.setAttribute('role', 'listbox');
        el.form.appendChild(el.slash);
        el.resume = document.createElement('div');
        el.resume.className = 'dc-resume';
        el.resume.id = 'dcResume';
        el.resume.hidden = true;
        el.form.insertAdjacentElement('afterend', el.resume);
        bindEvents();
        bindModelPicker();
        loadModels();
        applyTexts();
        buildSpotlight();
        refreshResumeCard();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
