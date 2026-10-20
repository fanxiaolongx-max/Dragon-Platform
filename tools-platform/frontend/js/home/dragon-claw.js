// 首页 Dragon Claw 智能体：落地页（问候 + 输入框 + 工具推荐轮播）与对话视图。
// - 工具推荐来自首页工具卡片（js/home/workspace.js 的 HomeWorkspace.getTools），点击后本地生成介绍，不请求模型；
// - 自由对话复用全局助手（js/shared/ai-assistant.js）的流式请求、Markdown 与依据渲染，
//   以 agent=dragon-claw-home 调用 /api/ai/chat，后端据此切换为不限领域的全能智能体人设。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            ctxCompacted: '上下文已压缩，下次回复后更新占用',
            slashCompact: '压缩当前对话上下文，保留完整历史', compactRunning: '正在压缩上下文…', compactEmpty: '先开始一段对话，再压缩上下文', compactSmall: '上下文已较精简，无需压缩', compactDone: '上下文已压缩，完整历史和工具记录仍保留', compactFailed: '压缩失败，未清除历史记录',
            datacomTitle: '数通协议专家', datacomDescription: '协议图解 · 交互实验 · 视频讲解',
            badge: '全能智能体', newChat: '新对话', history: '历史',
            chatToday: '今天', chatYesterday: '昨天', chatWeek: '7 天内', chatMonth: '30 天内', chatOlder: '更早', chatEmpty: '还没有对话，发一条消息开始吧', chatNoMatch: '没有匹配的对话', chatLoadFailed: '历史对话加载失败', chatRetry: '重试', chatBusy: '正在回复中，请先停止当前回复再切换对话', chatCount: '{count} 条', chatFolderTitle: '本地目录：{root}',
            activityThinking: '正在思考…', activityTool: '正在{tool}…', activityOrganizing: '正在整理结果…', activityResponding: '正在生成回复…', activityApproval: '等待你的批准…',
            resumeTitle: '继续上次对话', resumeMeta: '{time} · {count} 条消息', resumeAction: '继续对话', resumeBanner: '已恢复上次对话 · {time}', resumeDivider: '以上是历史记录，继续输入即可接着聊', resumeFailed: '上次对话加载失败，请稍后再试', toolOutput: '查看输出', toolInterrupted: '未完成', sessionTitle: '历史会话', sessionSearch: '搜索会话内容…', sessionEmpty: '还没有历史会话', sessionNoMatch: '没有匹配的会话', sessionLoading: '正在加载…', sessionMeta: '{time} · {count} 条消息', sessionArchived: '已归档', sessionCurrent: '当前', sessionHint: '↑↓ 选择 · Enter 打开 · Esc 关闭', sessionLoadFailed: '历史会话加载失败，请稍后再试', slashSession: '查看并恢复历史会话', slashNew: '开始新对话', slashHint: '↑↓ 选择 · Enter 执行 · Tab 补全', resumeDirMissing: '上次的目录「{name}」无法打开，对话已恢复，请重新选择目录', externalTag: '外部', commandTag: '命令', commandChangeHint: '由智能体执行的命令产生的改动，可撤销', riskTitle: '此命令可能访问工作目录之外或敏感文件，当前审批模式需要你确认', revertConflictTitle: '文件已被再次修改', revertConflictMessage: '{path} 在这次改动之后又被修改过（手动或其他程序）。撤销会把文件恢复到改动前，后续修改将一起丢失。', revertConflictConfirm: '仍然撤销', binaryChange: '二进制', binaryChangeHint: '二进制文件（如数据库、图片）内容有变化，没有可比较的文本行', externalChange: '工作区里的其他改动（手动或其他程序修改），可查看差异，不能在这里撤销', backToTools: '浏览工具', browseTools: '浏览全部工具',
            tagline: '我是 Dragon Claw，你的全能智能体。问我任何问题，或者让我带你用好平台里的工具。',
            hint: 'Enter 发送 · Shift + Enter 换行', placeholder: '给 Dragon Claw 发消息…',
            send: '发送', stop: '停止生成', you: '你',
            greetEarly: '夜深了', greetMorning: '早上好', greetNoon: '中午好', greetAfternoon: '下午好', greetEvening: '晚上好',
            spotFrequent: '你常用的', spotRandom: '随手推荐', spotAsk: '想感受一下「{name}」吗？',
            spotGo: '带我看看', spotOpen: '直接打开', spotGem: '隐藏小功能', spotGemAsk: '发现一个小功能：「{name}」', spotGemOpen: '去试试', introWhere: '在哪里找到它：', spotMore: '也可以试试', spotPrev: '上一个', spotNext: '下一个',
            tryTool: '想体验一下「{name}」', introCan: '它能帮你做什么', introGroup: '分类：{group}', introUpdated: '{time}更新',
            introOpen: '打开 {name}', introAskLogic: '讲讲它的实现逻辑', introAskHow: '怎么上手使用？',
            introFooter: '点下面的按钮就能直接使用；想了解实现细节或使用技巧，也可以继续问我。',
            askLogic: '请结合项目源码，解释「{name}」（{href}）的实现逻辑、主要处理流程和关键文件。',
            askHow: '「{name}」（{href}）应该怎么上手使用？请给出具体操作步骤和注意事项。',
            promptLogic: '解释「{name}」的代码逻辑', promptMetrics: '本月哪些指标还没达标？',
            promptMail: '帮我写一封礼貌的催办提醒邮件', promptCode: '用 Python 写一个 Excel 去重脚本',
            stopped: '已停止生成', copy: '复制', copied: '已复制', retry: '重新发送', skillPickDir: '选择工作目录', usageText: '输入 {input} · 输出 {output} tokens', usageTitle: '本次回复消耗：输入 {input} tokens，输出 {output} tokens', historyMore: '加载更早的消息', historyLoading: '正在加载更早的消息…', historyFailed: '加载失败，点击重试', unavailable: '智能体组件尚未加载，请稍后重试或刷新页面。',
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
            tool_list_directory: '列出目录', tool_read_file: '读取文件', tool_search: '搜索', tool_list_databases: '列出数据库', tool_database_schema: '查看数据库结构', tool_read_database_table: '读取业务表', tool_write_file: '写入文件', tool_edit_file: '编辑文件', tool_delete_path: '删除', tool_rename_path: '移动/重命名', tool_run_command: '执行命令', tool_welink_list_targets: '查看 WeLink 联系人', tool_welink_send_message: '发送 WeLink 消息',
            ctxUsed: '已使用 {percent}%', ctxMessages: '对话消息', ctxDirectory: '目录上下文', ctxSystem: '系统提示', ctxTools: '工具定义', ctxFree: '剩余空间',
            ctxEmpty: '发送第一条消息后显示上下文占用', ctxNoWorkspace: '选择目录后，这里显示上下文占用明细', ctxSourceProvider: '以模型返回的实际用量为准，分项按估算比例折算', ctxSourceEstimate: '按字符数估算（约 3.5 字符 / Token）',
            filePreview: '预览', fileCode: '代码', fileExpand: '放大', fileCollapse: '还原', fileDownload: '下载', fileLoading: '正在读取文件…', fileLines: '{count} 行', fileSandboxHint: '预览在隔离沙箱中运行，无法访问平台登录信息；同目录的相对资源不会加载', fileShowHint: '查看 {path}', noChanges: '本次会话尚未修改文件', viewDiff: '查看差异', revert: '撤销', reverted: '已撤销 {path}', diffEmpty: '（无文本差异）', createPr: '创建 PR',
            prChecking: '正在检查 git 与 gh…', prNoSession: '会话已过期，请重新发送一条消息后再创建 PR', prNoGit: '未找到 git，无法创建 PR', prNotGit: '当前目录不是 Git 仓库，无法创建 PR', prNoGh: '未检测到 GitHub CLI（gh）。请先安装：https://cli.github.com，再执行 gh auth login', prGhNotAuthed: 'gh 尚未登录，请先在终端执行 gh auth login', prNoRemote: '仓库没有 origin 远程，无法推送', prNoChanges: '本次会话没有可提交的改动',
            prFormTitle: '创建 Pull Request', prTitleLabel: '标题', prTitlePlaceholder: '例如：修复 README 首行', prBodyLabel: '说明（可选）', prBodyPlaceholder: '默认列出本次会话改动的文件', prBranchLabel: '新分支', prBaseBranch: '当前分支 {branch}', prFilesHint: '将只提交本次会话改动的 {count} 个文件', prSubmit: '开始创建', prCancel: '取消',
            prStepBranch: '新建分支', prStepAdd: '暂存本会话改动', prStepCommit: '提交', prStepPush: '推送到 origin', prStepCreate: '调用 gh pr create',
            prRunning: '正在创建 PR…', prDone: 'PR 已创建', prOpen: '打开 PR', prFailedAt: '「{step}」失败，流程已停止', prDeniedAt: '「{step}」被拒绝，流程已停止', prAborted: '创建 PR 已中止', prRetry: '重试', prClose: '关闭',
            workspaceDisabled: '工作区仅在本机或管理员账号下可用'
        },
        'en-US': {
            ctxCompacted: 'Context compacted. Usage updates after the next reply.',
            slashCompact: 'Compact context while keeping the full history', compactRunning: 'Compacting context…', compactEmpty: 'Start a conversation before compacting its context', compactSmall: 'The context is already compact', compactDone: 'Context compacted. Full chat and tool history kept.', compactFailed: 'Could not compact context. History was not deleted.',
            datacomTitle: 'Datacom Protocol Expert', datacomDescription: 'Visual guides · Interactive labs · Videos',
            badge: 'All-round agent', newChat: 'New chat', history: 'History',
            chatToday: 'Today', chatYesterday: 'Yesterday', chatWeek: 'Previous 7 days', chatMonth: 'Previous 30 days', chatOlder: 'Older', chatEmpty: 'No chats yet. Send a message to start.', chatNoMatch: 'No matching chats', chatLoadFailed: 'Could not load chats', chatRetry: 'Retry', chatBusy: 'A reply is still being generated. Stop it before switching chats.', chatCount: '{count}', chatFolderTitle: 'Local folder: {root}',
            activityThinking: 'Thinking…', activityTool: 'Working: {tool}…', activityOrganizing: 'Putting results together…', activityResponding: 'Composing a reply…', activityApproval: 'Waiting for your approval…',
            resumeTitle: 'Continue last chat', resumeMeta: '{time} · {count} messages', resumeAction: 'Continue', resumeBanner: 'Resumed your last chat · {time}', resumeDivider: 'Earlier messages above. Keep typing to continue.', resumeFailed: 'Could not load the last chat. Try again later.', toolOutput: 'Show output', toolInterrupted: 'Not finished', sessionTitle: 'Chat history', sessionSearch: 'Search conversations…', sessionEmpty: 'No previous chats yet', sessionNoMatch: 'No matching chats', sessionLoading: 'Loading…', sessionMeta: '{time} · {count} messages', sessionArchived: 'Archived', sessionCurrent: 'Current', sessionHint: '↑↓ to move · Enter to open · Esc to close', sessionLoadFailed: 'Could not load chat history. Try again later.', slashSession: 'Browse and resume previous chats', slashNew: 'Start a new chat', slashHint: '↑↓ to choose · Enter to run · Tab to complete', resumeDirMissing: 'The previous folder "{name}" could not be opened. The chat is restored; choose a folder again.', externalTag: 'External', commandTag: 'Command', commandChangeHint: 'Changed by a command the agent ran; can be undone', riskTitle: 'This command may reach outside the folder or touch sensitive files; your current approval mode requires confirmation', revertConflictTitle: 'File changed again', revertConflictMessage: '{path} was modified again after this change (by hand or another program). Undoing restores the earlier version and discards those later edits.', revertConflictConfirm: 'Undo anyway', binaryChange: 'Binary', binaryChangeHint: 'A binary file (such as a database or image) changed; there are no text lines to compare', externalChange: 'Other changes in the working tree (manual or by other programs). You can view the diff but not undo it here.', backToTools: 'Browse tools', browseTools: 'Browse all tools',
            tagline: 'I’m Dragon Claw, your all-round agent. Ask me anything, or let me show you around the tools on this platform.',
            hint: 'Enter to send · Shift + Enter for a new line', placeholder: 'Message Dragon Claw…',
            send: 'Send', stop: 'Stop generating', you: 'You',
            greetEarly: 'Working late', greetMorning: 'Good morning', greetNoon: 'Good afternoon', greetAfternoon: 'Good afternoon', greetEvening: 'Good evening',
            spotFrequent: 'Your frequent tool', spotRandom: 'Picked for you', spotAsk: 'Want to try “{name}”?',
            spotGo: 'Show me', spotOpen: 'Open it', spotGem: 'Hidden gem', spotGemAsk: 'Did you know about “{name}”?', spotGemOpen: 'Try it', introWhere: 'Where to find it:', spotMore: 'Or try', spotPrev: 'Previous', spotNext: 'Next',
            tryTool: 'I’d like to try “{name}”', introCan: 'What it can do for you', introGroup: 'Category: {group}', introUpdated: 'updated {time}',
            introOpen: 'Open {name}', introAskLogic: 'Explain how it works', introAskHow: 'How do I get started?',
            introFooter: 'Use the button below to open it right away, or keep asking me about how it works.',
            askLogic: 'Using the project source code, explain how “{name}” ({href}) is implemented: its main flow and key files.',
            askHow: 'How do I get started with “{name}” ({href})? Give concrete steps and caveats.',
            promptLogic: 'Explain the code behind “{name}”', promptMetrics: 'Which metrics missed target this month?',
            promptMail: 'Draft a polite follow-up reminder email', promptCode: 'Write a Python script to dedupe an Excel file',
            stopped: 'Generation stopped', copy: 'Copy', copied: 'Copied', retry: 'Send again', skillPickDir: 'Choose a folder', usageText: 'In {input} · Out {output} tokens', usageTitle: 'This reply used {input} input tokens and {output} output tokens', historyMore: 'Load earlier messages', historyLoading: 'Loading earlier messages…', historyFailed: 'Could not load. Click to retry', unavailable: 'The agent is still loading. Please retry in a moment or refresh the page.',
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
            tool_list_directory: 'list directory', tool_read_file: 'read file', tool_search: 'search', tool_list_databases: 'list databases', tool_database_schema: 'inspect database schema', tool_read_database_table: 'read business table', tool_write_file: 'write file', tool_edit_file: 'edit file', tool_delete_path: 'delete', tool_rename_path: 'move/rename', tool_run_command: 'run command', tool_welink_list_targets: 'list WeLink contacts', tool_welink_send_message: 'send a WeLink message',
            ctxUsed: '{percent}% used', ctxMessages: 'Messages', ctxDirectory: 'Directory context', ctxSystem: 'System prompt', ctxTools: 'Tool definitions', ctxFree: 'Free space',
            ctxEmpty: 'Context usage appears after your first message', ctxNoWorkspace: 'Pick a directory to see the context breakdown here', ctxSourceProvider: 'Based on the model’s reported usage; parts scaled from estimates', ctxSourceEstimate: 'Estimated from characters (≈3.5 chars per token)',
            filePreview: 'Preview', fileCode: 'Code', fileExpand: 'Expand', fileCollapse: 'Restore', fileDownload: 'Download', fileLoading: 'Reading file…', fileLines: '{count} lines', fileSandboxHint: 'The preview runs in an isolated sandbox without access to your sign-in; relative assets next to the file are not loaded', fileShowHint: 'View {path}', noChanges: 'No files changed in this session', viewDiff: 'View diff', revert: 'Revert', reverted: 'Reverted {path}', diffEmpty: '(no text difference)', createPr: 'Create PR',
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
        restoring: false,
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
    let resumeEpoch = 0;
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

    // 藏在各工具内部的小功能（F12 插件、Python 脚本、浮窗脚本，js/home/capabilities.js），按工具的结构包装后参与推荐
    function capabilityTools() {
        return (window.HomeCapabilities?.items?.() || []).map(item => ({
            id: `cap:${item.id}`,
            title: item.displayName || item.name,
            description: item.description || '',
            href: item.href,
            icon: item.icon,
            group: item.groupLabel,
            color: item.color,
            tags: [],
            updatedText: '',
            capability: true,
            where: item.where
        }));
    }

    // 每次进入首页轮播第一张是一个「隐藏小功能」，优先挑最近没展示过的，轮完一遍再从头
    const GEM_SEEN_KEY = 'dragon_claw_gem_seen';

    function pickGem(caps) {
        if (!caps.length) return null;
        if (state.gemId) {
            const kept = caps.find(item => item.id === state.gemId);
            if (kept) return kept;
        }
        let seen = [];
        try { seen = JSON.parse(localStorage.getItem(GEM_SEEN_KEY) || '[]'); } catch { seen = []; }
        if (!Array.isArray(seen)) seen = [];
        let pool = caps.filter(item => !seen.includes(item.id));
        if (!pool.length) {
            seen = [];
            pool = caps;
        }
        const gem = shuffle(pool)[0];
        state.gemId = gem.id;
        try { localStorage.setItem(GEM_SEEN_KEY, JSON.stringify([...seen, gem.id].slice(-60))); } catch { /* 无痕模式下每次随机 */ }
        return gem;
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
        const featured = state.spotlight.find(item => !item.capability); // 「解释代码逻辑」只针对工具
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
        const caps = capabilityTools().filter(tool => tool.href && tool.title);
        const signature = [...all, ...caps].map(tool => tool.id).sort().join('|');
        if (!all.length || signature === state.spotSignature) return;
        state.spotSignature = signature;
        const byId = new Map(all.map(tool => [tool.id, tool]));
        const recent = (window.HomeWorkspace?.recentIds?.() || []).map(id => byId.get(id)).filter(Boolean);
        const frequent = recent.slice(0, 3).map(tool => ({ ...tool, frequent: true }));
        const frequentIds = new Set(frequent.map(tool => tool.id));
        const gem = pickGem(caps);
        // 其余位置以工具为主，穿插两个小功能
        const rest = shuffle(all.filter(tool => !frequentIds.has(tool.id)));
        const extraCaps = shuffle(caps.filter(item => item !== gem)).slice(0, 2);
        extraCaps.forEach((item, index) => rest.splice(Math.min(rest.length, 2 + index * 3), 0, item));
        state.spotlight = [...(gem ? [gem] : []), ...frequent, ...rest].slice(0, SPOTLIGHT_SIZE);
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
                    ${tool.capability
                        ? `<div class="dc-spot-kicker is-gem"><span class="dc-spot-gem">✦ ${escapeHtml(tx('spotGem'))}</span><span>${escapeHtml(tool.group)}</span></div>
                    <div class="dc-spot-title">${escapeHtml(tx('spotGemAsk', { name: tool.title }))}</div>`
                        : `<div class="dc-spot-kicker">${escapeHtml(tool.frequent ? tx('spotFrequent') : tx('spotRandom'))} · ${escapeHtml(tool.group)}</div>
                    <div class="dc-spot-title">${escapeHtml(tx('spotAsk', { name: tool.title }))}</div>`}
                    <div class="dc-spot-desc">${escapeHtml(tool.description)}</div>
                    ${tool.capability && tool.where ? `<div class="dc-spot-where" title="${escapeHtml(tool.where)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14s4.5-4.1 4.5-7.4A4.5 4.5 0 0 0 3.5 6.6C3.5 9.9 8 14 8 14Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="6.6" r="1.6" fill="currentColor"/></svg><span>${escapeHtml(tool.where)}</span></div>` : ''}
                </div>
                <div class="dc-spot-actions">
                    <button type="button" class="dc-spot-go" data-spot-go="${escapeHtml(tool.id)}">${escapeHtml(tx('spotGo'))}</button>
                    <a class="dc-spot-open" href="${escapeHtml(tool.href)}">${escapeHtml(tx(tool.capability ? 'spotGemOpen' : 'spotOpen'))} <span aria-hidden="true">↗</span></a>
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

    function beginHistoryLoading() {
        el.thread.setAttribute('aria-busy', 'true');
        el.thread.innerHTML = `<div class="dc-history-loading" role="status" aria-label="${escapeHtml(tx('sessionLoading'))}">
            <div class="dc-history-skeleton" aria-hidden="true">
                <div class="dc-skeleton-question"><i></i><i></i></div>
                <div class="dc-skeleton-answer"><b></b><div><i></i><i></i><i></i><i></i></div></div>
                <div class="dc-skeleton-question"><i></i></div>
                <div class="dc-skeleton-answer"><b></b><div><i></i><i></i><i></i></div></div>
            </div></div>`;
        el.thread.scrollTop = 0;
    }

    function finishHistoryLoading(reveal = true) {
        el.thread.removeAttribute('aria-busy');
        if (reveal && !prefersReducedMotion()) {
            el.thread.animate?.([{ opacity: .45 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
        }
    }

    // 历史页先在片段中组装，避免每条消息插入后读取 scrollHeight 强制布局。
    let messageBatch = null;
    function batchMessages(render) {
        const fragment = document.createDocumentFragment();
        const previous = messageBatch;
        messageBatch = fragment;
        try { render(); } finally { messageBatch = previous; }
        (previous || el.thread).appendChild(fragment);
    }

    // before：向上加载历史时插到该节点之前，不滚动
    function addMessage(role, text = '', { before = null } = {}) {
        const message = document.createElement('div');
        message.className = `dc-msg dc-msg--${role}`;
        message.innerHTML = role === 'ai'
            ? `<img class="dc-msg-avatar" src="${AVATAR}" alt=""><div class="dc-msg-main"><div class="dc-msg-body"></div></div>`
            : `<div class="dc-msg-main"><div class="dc-msg-body"></div></div>`;
        const body = message.querySelector('.dc-msg-body');
        if (role === 'user') body.textContent = text;
        if (before) {
            el.thread.insertBefore(message, before);
        } else {
            (messageBatch || el.thread).appendChild(message);
            if (!messageBatch) scrollThread(true);
        }
        return message;
    }

    // 状态属于本次回复的临时 UI，不进入正文、聊天历史或模型上下文。
    function showThinking(message) {
        const main = message.querySelector('.dc-msg-main');
        const row = document.createElement('div');
        row.className = 'dc-activity';
        row.setAttribute('role', 'status');
        row.setAttribute('aria-live', 'polite');
        row.setAttribute('aria-atomic', 'true');
        row.innerHTML = '<span class="dc-activity-orbit" aria-hidden="true"><i></i><i></i><i></i></span><span class="dc-activity-text"></span>';
        main.appendChild(row);
        message.setAttribute('aria-busy', 'true');
        const running = new Map();
        const approvals = new Set();
        let disposed = false;
        let gapTimer = null;
        const clearGap = () => { clearTimeout(gapTimer); gapTimer = null; };
        const show = (key, values) => {
            if (disposed || !message.isConnected) return;
            clearGap();
            message.classList.remove('is-writing');
            row.hidden = false;
            row.classList.toggle('is-waiting', key === 'activityApproval');
            row.querySelector('.dc-activity-text').textContent = tx(key, values);
            scrollThread();
        };
        const refresh = () => {
            if (approvals.size) show('activityApproval');
            else if (running.size) show('activityTool', { tool: tx(`tool_${[...running.values()].at(-1)}`) });
            else show('activityOrganizing');
        };
        show('activityThinking');
        return {
            event(event) {
                if (disposed || !event) return;
                if (event.type === 'tool_start') { running.set(event.callId, event.tool); refresh(); }
                else if (event.type === 'approval') { approvals.add(event.callId); refresh(); }
                else if (event.type === 'approval_result') { approvals.delete(event.callId); refresh(); }
                else if (event.type === 'tool_result') { running.delete(event.callId); approvals.delete(event.callId); refresh(); }
            },
            status() {
                if (!running.size && !approvals.size) show('activityThinking');
            },
            streaming() {
                if (disposed) return;
                clearGap();
                row.hidden = true;
                message.classList.add('is-writing');
                // 连续输出时用正文光标；输出暂歇时恢复轻量状态，避免看起来卡住。
                gapTimer = setTimeout(() => {
                    if (running.size || approvals.size) refresh();
                    else show('activityResponding');
                }, 1000);
            },
            finish() {
                disposed = true;
                clearGap();
                row.remove();
                message.removeAttribute('aria-busy');
                message.classList.remove('is-writing');
            }
        };
    }

    // 平滑的逐段渲染，流式与本地介绍共用。
    function createRenderer(message, activity) {
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
                activity?.streaming();
                received += String(delta || '');
                if (!timer) timer = setTimeout(paint, 16);
            },
            idle() {
                if (!timer && visible.length >= received.length) return Promise.resolve();
                return new Promise(resolve => { resolveIdle = resolve; });
            },
            finish(finalText) {
                activity?.finish();
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

    // ── 消息操作：图标按钮（复制 / 重新发送）+ 模型名 + 本次 Token 消耗 ──
    const ICON_ATTRS = 'viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
    const ICONS = {
        copy: `<svg ${ICON_ATTRS}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
        check: `<svg ${ICON_ATTRS}><path d="M20 6 9 17l-5-5"/></svg>`,
        retry: `<svg ${ICON_ATTRS}><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/></svg>`
    };
    const retryPayloads = new WeakMap();

    // 1234 → 1,234；12345 → 12.3K；1234567 → 1.23M
    function formatTokenCount(value) {
        const number = Math.max(0, Math.round(Number(value) || 0));
        const trim = text => text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        if (number < 10000) return number.toLocaleString('en-US');
        if (number < 1000000) return `${trim((number / 1000).toFixed(number < 100000 ? 1 : 0))}K`;
        return `${trim((number / 1000000).toFixed(2))}M`;
    }

    function iconButton(icon, label, attrs) {
        return `<button type="button" class="dc-msg-tool dc-msg-icon" ${attrs} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${ICONS[icon]}</button>`;
    }

    function addMessageTools(message, text, { modelName = '', usage = null } = {}) {
        const bar = document.createElement('div');
        bar.className = 'dc-msg-tools';
        const input = Number(usage?.inputTokens || 0);
        const output = Number(usage?.outputTokens || 0);
        bar.innerHTML = `${iconButton('copy', tx('copy'), 'data-dc-copy')}
            ${modelName ? `<span class="dc-msg-model" title="${escapeHtml(tx('modelCurrent', { name: modelName }))}">${escapeHtml(modelName)}</span>` : ''}
            ${input || output ? `<span class="dc-msg-usage" title="${escapeHtml(tx('usageTitle', { input: input.toLocaleString(), output: output.toLocaleString() }))}">${escapeHtml(tx('usageText', { input: formatTokenCount(input), output: formatTokenCount(output) }))}</span>` : ''}`;
        bar.querySelector('[data-dc-copy]').dataset.dcCopy = text;
        message.querySelector('.dc-msg-main').appendChild(bar);
    }

    // 用户消息：复制显示的文字；重新发送用原始内容（快捷提问的显示文字与实际问题可能不同）
    function addUserTools(message, content, displayText = content) {
        const bar = document.createElement('div');
        bar.className = 'dc-msg-tools';
        bar.innerHTML = `${iconButton('retry', tx('retry'), 'data-dc-retry')}${iconButton('copy', tx('copy'), 'data-dc-copy')}`;
        bar.querySelector('[data-dc-copy]').dataset.dcCopy = displayText;
        retryPayloads.set(message, { content, displayText });
        message.querySelector('.dc-msg-main').appendChild(bar);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // 非安全上下文（http 局域网访问）没有 Clipboard API：退回 execCommand
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
            document.body.appendChild(area);
            area.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch { ok = false; }
            area.remove();
            return ok;
        }
    }

    function toolIntro(tool) {
        const lines = [`**${tool.icon ? `${tool.icon} ` : ''}${tool.title}** — ${tool.description}`];
        if (tool.where) lines.push('', `**${tx('introWhere')}** ${tool.where}`);
        if (tool.tags?.length) {
            lines.push('', `**${tx('introCan')}**`, ...tool.tags.slice(0, 5).map(tag => `- ${tag}`));
        }
        const meta = [tx('introGroup', { group: tool.group }), tool.updatedText ? tx('introUpdated', { time: tool.updatedText }) : ''].filter(Boolean).join(' · ');
        lines.push('', `> ${meta}`, '', tx('introFooter'));
        return lines.join('\n');
    }

    async function introduceTool(toolId) {
        const tool = tools().find(item => item.id === toolId) || state.spotlight.find(item => item.id === toolId)
            || capabilityTools().find(item => item.id === toolId);
        if (!tool || state.controller) return;
        state.focusedTool = tool;
        setChatting(true);
        const question = tx('tryTool', { name: tool.title });
        addMessage('user', question);
        const reply = addMessage('ai');
        const activity = showThinking(reply);
        await new Promise(resolve => setTimeout(resolve, prefersReducedMotion() ? 0 : 420));
        const intro = toolIntro(tool);
        const renderer = createRenderer(reply, activity);
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
        // 藏在工具内部的插件与脚本：便于回答「平台有哪些插件 / 某个脚本在哪」
        const caps = capabilityTools().map(item => `- ${item.title}｜${item.href}｜${item.group}｜${item.where}｜${item.description.slice(0, 80)}`);
        if (caps.length && context.length < CONTEXT_MAX_CHARS - 200) {
            context += `\n平台插件与脚本（名称｜入口｜类别｜位置｜简介）：\n`;
            for (const line of caps) {
                if (context.length + line.length > CONTEXT_MAX_CHARS) break;
                context += `${line}\n`;
            }
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
        el.send.disabled = state.restoring || (!generating && !el.input.value.trim());
    }

    // 斜杠命令：/session [关键词] 打开历史会话，/new 新对话；其他以 / 开头的内容照常发送
    const SLASH_COMMANDS = [
        { name: '/session', aliases: ['/sessions', '/history'], text: 'slashSession' },
        { name: '/new', aliases: [], text: 'slashNew' },
        { name: '/compact', aliases: ['/compress'], text: 'slashCompact' }
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
        else if (command.name === '/compact') compactContext();
        return true;
    }

    async function compactContext() {
        if (state.controller || state.restoring) return;
        if (!state.sessionId) return showToast(tx('compactEmpty'));
        const id = state.sessionId;
        const controller = new AbortController();
        state.controller = controller;
        el.input.disabled = true;
        updateSendButton();
        const notice = document.createElement('div');
        notice.className = 'dc-msg-note';
        notice.setAttribute('role', 'status');
        notice.textContent = tx('compactRunning');
        el.thread.appendChild(notice);
        scrollThread(true);
        try {
            const model = currentModel();
            const response = await fetch('/api/ai/compact', { method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: id, ...(model ? { modelId: model.id } : {}) }), signal: controller.signal });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || tx('compactFailed'));
            if (controller.signal.aborted || !notice.isConnected || state.sessionId !== id || state.controller !== controller) return;
            notice.textContent = tx(data.performed ? 'compactDone' : 'compactSmall');
            if (data.performed) {
                state.messages = state.messages.slice(-2);
                workspace()?.applyCompaction?.(data);
            }
        } catch (error) {
            if (!notice.isConnected || state.sessionId !== id) return;
            if (error.name === 'AbortError') notice.remove();
            else notice.textContent = `⚠️ ${tx('compactFailed')}: ${error.message}`;
        } finally {
            if (state.controller === controller) {
                state.controller = null;
                el.input.disabled = false;
                updateSendButton();
                el.input.focus({ preventScroll: true });
            }
        }
    }

    async function send(text, displayText = text) {
        const content = String(text || '').trim();
        if (!content || state.controller || state.restoring) return;
        if (runSlashCommand(content)) return;
        setChatting(true);
        const shownText = String(displayText || content).trim();
        const userMessage = addMessage('user', shownText);
        addUserTools(userMessage, content, shownText);
        window.DragonClawSkills?.decorateUser?.(userMessage);
        el.input.value = '';
        el.input.dispatchEvent(new Event('input')); // 同步输入框相关提示（Skill 未识别提示、斜杠菜单）
        state.messages.push({ role: 'user', content });
        const reply = addMessage('ai');
        const activity = showThinking(reply);
        const controller = new AbortController();
        state.controller = controller;
        updateSendButton();

        const api = await waitForAssistant();
        if (!api) {
            activity.finish();
            reply.querySelector('.dc-msg-body').innerHTML = renderMarkdown(`⚠️ ${tx('unavailable')}`);
            state.messages.pop();
            state.controller = null;
            updateSendButton();
            return;
        }
        const renderer = createRenderer(reply, activity);
        // 发送时锁定模型：生成过程中切换只影响下一条消息。
        const model = currentModel();
        const workspacePayload = workspace()?.getWorkspacePayload?.() || null;
        const keptSkills = window.DragonClawSkills?.activeIds?.() || [];
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
                // 会话内保持的 Skill（输入框上方标签）；本条消息里的 @id 由后端直接解析
                ...(keptSkills.length ? { skills: keptSkills } : {}),
                ...(model ? { modelId: model.id } : {}),
                // 工作区（本地目录）模式：后端走工具调用循环，事件由面板渲染
                ...(workspacePayload ? { workspace: workspacePayload } : {})
            }, {
                signal: controller.signal,
                onDelta: delta => {
                    if (!delta || controller.signal.aborted || !reply.isConnected) return;
                    started = true;
                    renderer.append(delta);
                },
                onStatus: () => activity.status(),
                onEvent: event => {
                    if (controller.signal.aborted || !reply.isConnected) return;
                    if (event.type === 'start' && event.sessionId) {
                        state.sessionId = event.sessionId;
                        rememberLastChat(event.sessionId, workspacePayload ? { agentSessionId: workspacePayload.agentSessionId, root: workspacePayload.root } : null);
                    }
                    window.DragonClawSkills?.handleEvent(reply, event);
                    workspace()?.handleEvent(reply, event, workspacePayload);
                    activity.event(event);
                }
            });
            if (controller.signal.aborted || !reply.isConnected) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            if (data.sessionId) {
                state.sessionId = data.sessionId;
                rememberLastChat(data.sessionId, workspacePayload ? { agentSessionId: data.agentSessionId || workspacePayload.agentSessionId, root: data.agent?.root || workspacePayload.root } : null);
            }
            if (workspacePayload) workspace()?.applyDone(data);
            const finalText = renderer.finish(data.reply || renderer.current());
            state.messages.push({ role: 'model', content: finalText });
            const grounding = api.renderGrounding ? api.renderGrounding(data.grounding) : '';
            if (grounding) reply.querySelector('.dc-msg-main').insertAdjacentHTML('beforeend', grounding);
            addMessageTools(reply, finalText, { modelName: data.model?.name || model?.name || '', usage: data.usage });
            window.DragonClawSkills?.offerSave?.(reply, finalText); // @create-skill 的草稿：回复下方提供「保存为技能」
        } catch (error) {
            const partial = renderer.finish();
            if (!reply.isConnected) return;
            if (error?.name === 'AbortError') {
                if (partial || reply.querySelector('.dc-tool-log')?.childElementCount) {
                    state.messages.push({ role: 'model', content: partial || tx('stopped') });
                    reply.querySelector('.dc-msg-main').insertAdjacentHTML('beforeend', `<div class="dc-msg-note">${escapeHtml(tx('stopped'))}</div>`);
                } else {
                    reply.remove();
                    state.messages.pop();
                }
            } else {
                if (!started) state.messages.pop();
                reply.querySelector('.dc-msg-body').innerHTML = renderMarkdown(`${partial ? `${partial}\n\n` : ''}> ⚠️ ${error?.message || error}`);
                // 选用的 Skill 需要工作目录：直接给出选择入口，选好后可用用户消息的「重新发送」
                if (error?.code === 'SKILL_WORKSPACE_REQUIRED' && workspace()?.openPicker) {
                    reply.querySelector('.dc-msg-main').insertAdjacentHTML('beforeend', `<div class="dc-actions"><button type="button" class="dc-action dc-action--primary" data-dc-pick-dir>📂 ${escapeHtml(tx('skillPickDir'))}</button></div>`);
                }
            }
        } finally {
            activity.finish();
            workspace()?.finishMessage?.(reply);
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
        markActiveChat();
        scheduleChatListRefresh();
    }

    function forgetLastChat() {
        scheduleChatListRefresh();
        try { localStorage.removeItem(LAST_CHAT_KEY); } catch { /* ignore */ }
    }

    // 数据库时间是 UTC 的 "YYYY-MM-DD HH:MM:SS"
    function parseChatTime(value) {
        return new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(String(value)) ? value : `${String(value || '').replace(' ', 'T')}Z`);
    }

    function formatChatTime(value) {
        const date = parseChatTime(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString(lang() === 'en-US' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function hideResumeCard() {
        if (el.resume) el.resume.hidden = true;
    }

    // 历史消息分页：恢复对话只取最近一页，向上滚动再按 before 游标取更早的（大会话不一次性渲染）
    const HISTORY_PAGE_SIZE = 30;

    async function fetchHistoryPage(sessionId, before = '') {
        const query = `limit=${HISTORY_PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
        const res = await fetch(`/api/ai/sessions/${encodeURIComponent(sessionId)}/messages?${query}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const raw = Array.isArray(data.items) ? data.items : [];
        return {
            items: raw.filter(item => item && (item.role === 'user' || item.role === 'model') && item.content),
            cursor: raw[0]?.id || '', // 游标取原始第一条，空内容行也不会被重复读取
            hasMore: Boolean(data.hasMore),
            total: Number(data.total) || raw.length
        };
    }

    async function refreshResumeCard() {
        hideResumeCard();
        state.resume = null;
        const saved = readLastChat();
        if (!saved || !el.resume || saved.sessionId === state.sessionId) return;
        try {
            const page = await fetchHistoryPage(saved.sessionId);
            const items = page.items;
            if (!items.length) {
                forgetLastChat();
                return;
            }
            if (state.messages.length || saved.sessionId === state.sessionId) return; // 期间已开始聊天
            const lastQuestion = [...items].reverse().find(item => item.role === 'user')?.content || '';
            const time = formatChatTime(items[items.length - 1].created_at);
            state.resume = { sessionId: saved.sessionId, items, cursor: page.cursor, hasMore: page.hasMore, total: page.total, time, agent: saved.agent || null };
            el.resume.innerHTML = `
                <span class="dc-resume-icon" aria-hidden="true">↺</span>
                <span class="dc-resume-text">
                    <b>${escapeHtml(tx('resumeTitle'))}</b>
                    <span class="dc-resume-question" title="${escapeHtml(lastQuestion)}">${escapeHtml(lastQuestion)}</span>
                    <small>${escapeHtml(tx('resumeMeta', { time, count: page.total }))}</small>
                </span>
                <button type="button" class="dc-action dc-action--primary" data-dc-resume>${escapeHtml(tx('resumeAction'))}</button>`;
            el.resume.hidden = false;
        } catch {
            forgetLastChat();
            hideResumeCard();
        }
    }

    function addHistoryMessage(role, text, events = [], item = {}, before = null) {
        const message = addMessage(role === 'model' ? 'ai' : 'user', text, { before });
        message.classList.add('dc-msg--history');
        if (role === 'model') {
            message.querySelector('.dc-msg-body').innerHTML = renderMarkdown(text);
            // 工具调用、审批、命令输出：按入库记录重放
            if (Array.isArray(events) && events.length) workspace()?.replayEvents?.(message, events);
            const skillIds = (Array.isArray(events) ? events : []).find(event => event?.type === 'skills')?.skills;
            if (skillIds?.length) window.DragonClawSkills?.badge?.(message, skillIds);
            addMessageTools(message, text, { modelName: item.model_name || '', usage: { inputTokens: item.input_tokens, outputTokens: item.output_tokens } });
            window.DragonClawSkills?.offerSave?.(message, text);
        } else {
            addUserTools(message, text);
            window.DragonClawSkills?.decorateUser?.(message);
        }
        return message;
    }

    // 顶部哨兵：滚到附近自动加载更早一页，也可点击；插入后保持当前阅读位置不跳动
    const historyPaging = { sessionId: '', cursor: '', hasMore: false, loading: false, observer: null, sentinel: null };

    function resetHistoryPaging() {
        historyPaging.observer?.disconnect();
        historyPaging.sentinel?.remove();
        Object.assign(historyPaging, { sessionId: '', cursor: '', hasMore: false, loading: false, observer: null, sentinel: null });
    }

    function mountHistorySentinel(anchor) {
        const sentinel = document.createElement('button');
        sentinel.type = 'button';
        sentinel.className = 'dc-history-more';
        sentinel.dataset.dcHistoryMore = '';
        sentinel.textContent = tx('historyMore');
        el.thread.insertBefore(sentinel, anchor);
        historyPaging.sentinel = sentinel;
        if ('IntersectionObserver' in window) {
            historyPaging.observer = new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) loadOlderHistory();
            }, { root: el.thread, rootMargin: '240px 0px 0px 0px' });
            historyPaging.observer.observe(sentinel);
        }
    }

    async function loadOlderHistory() {
        if (historyPaging.loading || !historyPaging.hasMore || !historyPaging.sentinel) return;
        const sessionId = historyPaging.sessionId;
        historyPaging.loading = true;
        historyPaging.sentinel.textContent = tx('historyLoading');
        historyPaging.sentinel.classList.remove('is-error');
        try {
            const page = await fetchHistoryPage(sessionId, historyPaging.cursor);
            if (historyPaging.sessionId !== sessionId || state.sessionId !== sessionId || !historyPaging.sentinel) return; // 期间换了对话
            const anchor = historyPaging.sentinel.nextSibling;
            const previousHeight = el.thread.scrollHeight;
            const previousTop = el.thread.scrollTop;
            page.items.forEach(item => addHistoryMessage(item.role, String(item.content), item.events, item, anchor));
            el.thread.scrollTop = previousTop + (el.thread.scrollHeight - previousHeight);
            state.messages = [...page.items.map(item => ({ role: item.role === 'model' ? 'model' : 'user', content: String(item.content) })), ...state.messages];
            historyPaging.cursor = page.cursor;
            historyPaging.hasMore = page.hasMore && Boolean(page.cursor);
            if (historyPaging.hasMore) {
                historyPaging.sentinel.textContent = tx('historyMore');
            } else {
                historyPaging.observer?.disconnect();
                historyPaging.sentinel.remove();
                historyPaging.observer = null;
                historyPaging.sentinel = null;
            }
        } catch {
            if (historyPaging.sentinel) {
                historyPaging.sentinel.textContent = tx('historyFailed');
                historyPaging.sentinel.classList.add('is-error');
            }
        } finally {
            historyPaging.loading = false;
        }
        // 哨兵仍在视口内（一页太短）时继续加载
        if (historyPaging.sentinel && !historyPaging.loading && historyPaging.sentinel.getBoundingClientRect().bottom > el.thread.getBoundingClientRect().top - 240
            && !historyPaging.sentinel.classList.contains('is-error')) {
            requestAnimationFrame(() => loadOlderHistory());
        }
    }

    async function resumeChat(resume = state.resume, pendingEpoch = null) {
        if (!resume || state.controller || (state.restoring && pendingEpoch === null)) return;
        const epoch = pendingEpoch ?? ++resumeEpoch;
        state.restoring = true;
        el.input.disabled = true;
        updateSendButton();
        exitExternal();
        hideResumeCard();
        setChatting(true);
        if (!el.thread.hasAttribute('aria-busy')) beginHistoryLoading();
        try {
            await workspace()?.resumeWorkspace?.(resume.agent || {});
            if (epoch !== resumeEpoch) return;
            state.messages = resume.items.map(item => ({ role: item.role === 'model' ? 'model' : 'user', content: String(item.content) }));
            state.sessionId = resume.sessionId;
            state.focusedTool = null;
            resetHistoryPaging();
            window.DragonClawSkills?.reset?.();
            el.thread.innerHTML = `<div class="dc-history-banner"><span aria-hidden="true">↺</span>${escapeHtml(tx('resumeBanner', { time: resume.time }))}</div>`;
            batchMessages(() => resume.items.forEach(item => addHistoryMessage(item.role, String(item.content), item.events, item)));
            Object.assign(historyPaging, { sessionId: resume.sessionId, cursor: resume.cursor || '', hasMore: Boolean(resume.hasMore && resume.cursor) });
            if (historyPaging.hasMore) mountHistorySentinel(el.thread.querySelector('.dc-history-banner').nextSibling);
            rememberLastChat(resume.sessionId, resume.agent);
            el.thread.insertAdjacentHTML('beforeend', `<div class="dc-history-divider"><span>${escapeHtml(tx('resumeDivider'))}</span></div>`);
            hideResumeCard();
            setChatting(true);
            scrollThread(true);
        } catch (error) {
            if (epoch === resumeEpoch) {
                el.thread.innerHTML = `<div class="dc-session-empty">${escapeHtml(tx('resumeFailed'))}</div>`;
                showToast(error?.message || tx('resumeFailed'));
            }
        } finally {
            if (epoch === resumeEpoch) {
                finishHistoryLoading();
                state.restoring = false;
                el.input.disabled = false;
                updateSendButton();
                el.input.focus({ preventScroll: true });
            }
        }
    }

    // ── 斜杠命令提示 ─────────────────────────────
    // 当前菜单项与高亮下标：↑↓ 移动，Enter 执行、Tab 补全的都是高亮项
    const slashMenu = { items: [], active: 0 };

    function hideSlashHints() {
        if (el.slash) el.slash.hidden = true;
        slashMenu.items = [];
        el.input?.removeAttribute('aria-activedescendant');
        el.input?.setAttribute('aria-expanded', 'false');
    }

    function slashMenuOpen() {
        return Boolean(el.slash && !el.slash.hidden && slashMenu.items.length);
    }

    function renderSlashHints() {
        const value = el.input.value;
        if (!value.startsWith('/') || /\s/.test(value.trim()) && !/^\/\S+\s*$/.test(value)) return hideSlashHints();
        const typed = value.trim().toLowerCase();
        const list = SLASH_COMMANDS.filter(item => [item.name, ...item.aliases].some(name => name.startsWith(typed) || typed.startsWith(name)));
        if (!list.length) return hideSlashHints();
        // 继续输入时尽量保持原来高亮的命令
        const previous = slashMenu.items[slashMenu.active]?.name;
        slashMenu.items = list;
        slashMenu.active = Math.max(0, list.findIndex(item => item.name === previous));
        el.slash.innerHTML = `${list.map((item, index) => `<button type="button" class="dc-slash-item" role="option" id="dcSlashOpt${index}" data-dc-slash="${item.name}" data-dc-slash-index="${index}" tabindex="-1"><b>${item.name}</b><span>${escapeHtml(tx(item.text))}</span></button>`).join('')}<div class="dc-slash-hint">${escapeHtml(tx('slashHint'))}</div>`;
        el.slash.hidden = false;
        el.input.setAttribute('aria-expanded', 'true');
        setSlashActive(slashMenu.active);
    }

    function setSlashActive(index) {
        const count = slashMenu.items.length;
        if (!count) return;
        slashMenu.active = (index + count) % count;
        el.slash.querySelectorAll('[data-dc-slash-index]').forEach(node => {
            const active = Number(node.dataset.dcSlashIndex) === slashMenu.active;
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-selected', String(active));
            if (active) node.scrollIntoView({ block: 'nearest' });
        });
        el.input.setAttribute('aria-activedescendant', `dcSlashOpt${slashMenu.active}`);
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
        const epoch = ++resumeEpoch;
        closeSessionPicker();
        exitExternal();
        workspace()?.resetSession?.();
        resetHistoryPaging();
        window.DragonClawSkills?.reset?.();
        state.messages = [];
        state.sessionId = null;
        state.focusedTool = null;
        state.restoring = true;
        el.input.disabled = true;
        updateSendButton();
        hideResumeCard();
        setChatting(true);
        beginHistoryLoading();
        markActiveChat();
        try {
            const page = await fetchHistoryPage(item.id);
            if (epoch !== resumeEpoch) return;
            const items = page.items;
            if (!items.length) throw new Error('Empty session');
            const local = readLastChat();
            const agent = item.agent || (local?.sessionId === item.id ? local.agent : null);
            await resumeChat({ sessionId: item.id, items, cursor: page.cursor, hasMore: page.hasMore, total: page.total, time: formatChatTime(items[items.length - 1].created_at), agent }, epoch);
        } catch {
            if (epoch !== resumeEpoch) return;
            finishHistoryLoading(false);
            el.thread.innerHTML = `<div class="dc-session-empty">${escapeHtml(tx('sessionLoadFailed'))}<button type="button" class="dc-ghost-btn" data-dc-session-retry>${escapeHtml(tx('chatRetry'))}</button></div>`;
            el.thread.querySelector('[data-dc-session-retry]').addEventListener('click', () => openSession(item));
            state.restoring = false;
            el.input.disabled = false;
            updateSendButton();
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

    // ── 侧栏历史对话（对话模式左侧面板） ────────────
    const chatList = { items: [], loaded: false, failed: false, seq: 0, timer: null, searchTimer: null };

    function chatGroupKey(date) {
        const startOfDay = value => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
        const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
        if (days <= 0) return 'chatToday';
        if (days === 1) return 'chatYesterday';
        if (days < 7) return 'chatWeek';
        if (days < 30) return 'chatMonth';
        return 'chatOlder';
    }

    function chatItemTime(date, group) {
        const locale = lang() === 'en-US' ? 'en-US' : 'zh-CN';
        if (group === 'chatToday' || group === 'chatYesterday') return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
        return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    }

    function renderChatList() {
        if (!el.chatList) return;
        if (!chatList.loaded) {
            el.chatList.innerHTML = '<div class="home-chat-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
            return;
        }
        if (chatList.failed) {
            el.chatList.innerHTML = `<div class="home-chat-empty">${escapeHtml(tx('chatLoadFailed'))}<button type="button" class="home-chat-retry" data-chat-retry>${escapeHtml(tx('chatRetry'))}</button></div>`;
            return;
        }
        if (!chatList.items.length) {
            el.chatList.innerHTML = `<div class="home-chat-empty">${escapeHtml(tx(el.chatSearch?.value.trim() ? 'chatNoMatch' : 'chatEmpty'))}</div>`;
            return;
        }
        let currentGroup = '';
        const html = [];
        chatList.items.forEach((item, index) => {
            const date = parseChatTime(item.updatedAt);
            const valid = !Number.isNaN(date.getTime());
            const group = valid ? chatGroupKey(date) : 'chatOlder';
            if (group !== currentGroup) {
                currentGroup = group;
                html.push(`<div class="home-chat-group">${escapeHtml(tx(group))}</div>`);
            }
            const title = String(item.firstQuestion || item.lastQuestion || item.id).replace(/\s+/g, ' ').trim();
            const root = item.agent?.root || '';
            const folder = root ? `<svg class="home-chat-folder" viewBox="0 0 16 16" aria-label="${escapeHtml(tx('chatFolderTitle', { root }))}"><title>${escapeHtml(tx('chatFolderTitle', { root }))}</title><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>` : '';
            html.push(`<button type="button" class="home-chat-item${item.id === state.sessionId ? ' is-active' : ''}" role="listitem" data-chat-index="${index}" title="${escapeHtml(title)}"${item.id === state.sessionId ? ' aria-current="true"' : ''}>
                <span class="home-chat-title">${escapeHtml(title)}</span>
                <span class="home-chat-meta">${folder}<span>${valid ? escapeHtml(chatItemTime(date, group)) : ''}</span></span>
            </button>`);
        });
        el.chatList.innerHTML = html.join('');
    }

    function markActiveChat() {
        el.chatList?.querySelectorAll('[data-chat-index]').forEach(button => {
            const active = chatList.items[Number(button.dataset.chatIndex)]?.id === state.sessionId;
            button.classList.toggle('is-active', active);
            if (active) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
        });
    }

    async function loadChatList() {
        if (!el.chatList) return;
        const seq = ++chatList.seq;
        const query = el.chatSearch?.value.trim() || '';
        try {
            const res = await fetch(`/api/ai/sessions?mine=1&pagePath=%2F&limit=80&query=${encodeURIComponent(query)}`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (seq !== chatList.seq) return;
            chatList.items = Array.isArray(data.items) ? data.items : [];
            chatList.failed = false;
        } catch {
            if (seq !== chatList.seq) return;
            chatList.failed = !chatList.items.length; // 已有列表时刷新失败就保留旧列表
        }
        chatList.loaded = true;
        renderChatList();
    }

    function scheduleChatListRefresh(delay = 600) {
        if (!el.chatList) return;
        clearTimeout(chatList.timer);
        chatList.timer = setTimeout(loadChatList, delay);
    }

    function openChatFromList(item) {
        if (!item) return;
        if (item.id === state.sessionId && state.messages.length) {
            setChatting(true);
            el.input.focus({ preventScroll: true });
            return;
        }
        if (state.controller) return showToast(tx('chatBusy'));
        openSession(item);
    }

    function bindChatList() {
        if (!el.chatList) return;
        el.chatList.addEventListener('click', event => {
            if (event.target.closest('[data-chat-retry]')) {
                chatList.loaded = false;
                renderChatList();
                return loadChatList();
            }
            const button = event.target.closest('[data-chat-index]');
            if (button) openChatFromList(chatList.items[Number(button.dataset.chatIndex)]);
        });
        // ↑↓ 在列表中移动焦点
        el.chatList.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const buttons = [...el.chatList.querySelectorAll('[data-chat-index]')];
            const index = buttons.indexOf(document.activeElement);
            if (index < 0) return;
            event.preventDefault();
            buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        });
        el.chatSearch?.addEventListener('input', () => {
            clearTimeout(chatList.searchTimer);
            chatList.searchTimer = setTimeout(loadChatList, 220);
        });
        el.chatSearch?.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                el.chatSearch.value = '';
                loadChatList();
                el.chatSearch.blur();
            } else if (event.key === 'ArrowDown') {
                const first = el.chatList.querySelector('[data-chat-index]');
                if (first) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });
        document.getElementById('homeChatNew')?.addEventListener('click', () => {
            window.HomeMode?.set?.('chat');
            newChat();
        });
        renderChatList();
        loadChatList();
    }

    function newChat() {
        exitExternal();
        resumeEpoch += 1;
        finishHistoryLoading(false);
        state.restoring = false;
        el.input.disabled = false;
        state.controller?.abort();
        workspace()?.resetSession?.({ clearWorkspace: true });
        state.messages = [];
        state.sessionId = null;
        state.focusedTool = null;
        resetHistoryPaging();
        window.DragonClawSkills?.reset?.(); // 保持的 Skill 只属于当前对话
        el.thread.innerHTML = '';
        updateSendButton();
        setChatting(false);
        markActiveChat();
        refreshResumeCard(); // 刚离开的对话可以再接回去
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        el.input.focus();
    }

    // ── 外部只读对话：WeLink 等频道的合并时间线（js/home/welink-threads.js）借用对话区渲染 ──
    // 进入时离开当前对话、禁用输入框；新对话 / 打开个人历史时自动退出并回调 onExit。
    const external = { active: false, onExit: null };

    function enterExternal({ onExit } = {}) {
        if (state.controller) {
            showToast(tx('chatBusy'));
            return null;
        }
        const previous = external.active ? external.onExit : null;
        external.onExit = null;
        previous?.({ switching: true });
        resumeEpoch += 1;
        finishHistoryLoading(false);
        state.restoring = false;
        workspace()?.resetSession?.();
        state.messages = [];
        state.sessionId = null;
        state.focusedTool = null;
        resetHistoryPaging();
        window.DragonClawSkills?.reset?.();
        el.thread.innerHTML = '';
        external.active = true;
        external.onExit = onExit || null;
        document.body.classList.add('dc-external-view');
        el.input.disabled = true;
        updateSendButton();
        hideResumeCard();
        hideSlashHints();
        setChatting(true);
        markActiveChat();
        return {
            thread: el.thread,
            beginLoading: beginHistoryLoading,
            finishLoading: finishHistoryLoading,
            batchMessages,
            appendToBatch: node => (messageBatch || el.thread).appendChild(node),
            renderMarkdown,
            avatar: AVATAR,
            addMessage: (role, text, options) => addMessage(role, text, options),
            addCopy: (message, text) => addMessageTools(message, text),
            scrollToBottom: () => scrollThread(true),
            formatTime: formatChatTime
        };
    }

    function exitExternal() {
        if (!external.active) return;
        external.active = false;
        const callback = external.onExit;
        external.onExit = null;
        document.body.classList.remove('dc-external-view');
        el.input.disabled = false;
        updateSendButton();
        callback?.({ switching: false });
    }

    // 「全部工具 → 技能」卡片：切到对话、新建对话并在输入框填入 @技能（js/home/skills-tools.js）
    function startWithSkill(id) {
        const skillId = String(id || '').toLowerCase();
        if (!/^[a-z][a-z0-9-]{0,40}$/.test(skillId)) return;
        window.HomeMode?.set?.('chat');
        if (state.controller) return showToast(tx('chatBusy'));
        if (state.messages.length || state.sessionId) newChat();
        el.input.value = `@${skillId} `;
        autoResize();
        el.input.dispatchEvent(new Event('input', { bubbles: true }));
        el.input.focus({ preventScroll: true });
        el.input.setSelectionRange(el.input.value.length, el.input.value.length);
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
            if (slashMenuOpen() && !event.isComposing) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSlashActive(slashMenu.active + (event.key === 'ArrowDown' ? 1 : -1));
                    return;
                }
                const item = slashMenu.items[slashMenu.active];
                if (event.key === 'Tab') {
                    event.preventDefault();
                    el.input.value = `${item.name} `;
                    renderSlashHints();
                    return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (!state.controller) runSlashCommand(item.name);
                    return;
                }
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
                if (!(await copyText(copy.dataset.dcCopy || ''))) return;
                copy.innerHTML = ICONS.check;
                copy.classList.add('is-done');
                copy.title = tx('copied');
                copy.setAttribute('aria-label', tx('copied'));
                clearTimeout(copy._dcTimer);
                copy._dcTimer = setTimeout(() => {
                    copy.innerHTML = ICONS.copy;
                    copy.classList.remove('is-done');
                    copy.title = tx('copy');
                    copy.setAttribute('aria-label', tx('copy'));
                }, 1400);
                return;
            }
            const retry = target.closest('[data-dc-retry]');
            if (retry) {
                const payload = retryPayloads.get(retry.closest('.dc-msg'));
                if (payload && !state.controller && !state.restoring) send(payload.content, payload.displayText);
                return;
            }
            if (target.closest('[data-dc-history-more]')) return loadOlderHistory();
            if (target.closest('[data-dc-pick-dir]')) return workspace()?.openPicker?.();
            const graph = target.closest('.dc-thread [data-open-knowledge-graph]');
            if (graph) {
                event.stopPropagation();
                openKnowledgeGraphFrom(graph);
            }
        });

        el.newChat.addEventListener('click', newChat);
        // 对话与工具是两种互斥模式（js/home/home-mode.js）：离开对话不清空当前对话，切回来原样继续
        el.back.addEventListener('click', () => window.HomeMode?.set?.('tools', { focus: true }));
        el.history?.addEventListener('click', () => openSessionPicker());
        document.getElementById('homeHistoryBtn')?.addEventListener('click', () => openSessionPicker());
        window.addEventListener('home:mode', event => {
            if (event.detail?.mode !== 'chat') return;
            if (state.messages.length) setChatting(true);
            scheduleChatListRefresh(0);
        });
        window.addEventListener('home:tools-updated', buildSpotlight);
        window.addEventListener('home:capabilities', buildSpotlight);
        window.addEventListener('tools:languagechange', () => {
            applyTexts();
            const loading = el.thread.querySelector('.dc-history-loading');
            if (loading) loading.setAttribute('aria-label', tx('sessionLoading'));
            if (!state.messages.length && !state.restoring && !external.active) refreshResumeCard();
            renderModelPicker();
            renderChatList();
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
        el.history = document.getElementById('dcHistoryBtn');
        el.chatList = document.getElementById('homeChatList');
        el.chatSearch = document.getElementById('homeChatSearch');
        el.model = document.getElementById('dcModel');
        el.modelBtn = document.getElementById('dcModelBtn');
        el.modelName = document.getElementById('dcModelName');
        el.modelMenu = document.getElementById('dcModelMenu');
        el.toast = document.getElementById('dcToast');
        el.slash = document.createElement('div');
        el.slash.className = 'dc-slash';
        el.slash.hidden = true;
        el.slash.setAttribute('role', 'listbox');
        el.slash.id = 'dcSlashMenu';
        el.input.setAttribute('aria-controls', 'dcSlashMenu');
        el.input.setAttribute('aria-autocomplete', 'list');
        // 鼠标移过时同步高亮，键盘与鼠标不会出现两个高亮项
        el.slash.addEventListener('pointermove', event => {
            const option = event.target.closest('[data-dc-slash-index]');
            if (option && Number(option.dataset.dcSlashIndex) !== slashMenu.active) setSlashActive(Number(option.dataset.dcSlashIndex));
        });
        el.slash.addEventListener('mousedown', event => event.preventDefault()); // 点选时输入框不失焦
        el.form.appendChild(el.slash);
        el.resume = document.createElement('div');
        el.resume.className = 'dc-resume';
        el.resume.id = 'dcResume';
        el.resume.hidden = true;
        el.form.insertAdjacentElement('afterend', el.resume);
        bindEvents();
        bindChatList();
        window.DragonClaw = { startWithSkill, enterExternal, exitExternal, newChat, lang, isExternal: () => external.active };
        // 其他页面或新标签打开的 /?skill=<id>：直接进入该技能的新对话
        const linkedSkill = new URLSearchParams(location.search).get('skill');
        if (linkedSkill) {
            const url = new URL(location.href);
            url.searchParams.delete('skill');
            history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
            setTimeout(() => startWithSkill(linkedSkill));
        }
        bindModelPicker();
        loadModels();
        applyTexts();
        buildSpotlight();
        refreshResumeCard();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
