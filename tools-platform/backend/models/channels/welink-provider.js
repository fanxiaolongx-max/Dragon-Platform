// WeLink 第三方智能体 Provider：实现 @wecode/bridge-runtime-sdk 的 ThirdPartyAgentProvider SPI。
// SDK 在自己的网络回调里调用这些方法，没有请求级租户上下文，所以每个方法都显式 runWithTenant。
// runMessage 的 facts 由生产者在租户上下文中写入队列，SDK 侧只负责消费，避免上下文丢失。
const crypto = require('crypto');
const { runWithTenant } = require('../tenant-context');
const configRepo = require('./welink-config-repository');
const targetsRepo = require('./channel-targets-repository');
const followupsRepo = require('./channel-followups-repository');
const access = require('./welink-access');
const dragonClawBridge = require('./dragon-claw-channel-bridge');

const CHANNEL = 'welink';
const SLASH_COMMANDS = [
    { command: '/help', description: '查看助理能力与命令' },
    { command: '/new', description: '开启新对话（清空上下文）' },
    { command: '/whoami', description: '查看我的账号与当前会话信息' },
    { command: '/status', description: '查看助理运行状态' }
];

class FactQueue {
    constructor() {
        this.items = [];
        this.waiters = [];
        this.done = false;
    }

    push(item) {
        if (this.done) return;
        const waiter = this.waiters.shift();
        if (waiter) waiter({ value: item, done: false });
        else this.items.push(item);
    }

    end() {
        this.done = true;
        while (this.waiters.length) this.waiters.shift()({ value: undefined, done: true });
    }

    [Symbol.asyncIterator]() {
        return {
            next: () => {
                if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
                if (this.done) return Promise.resolve({ value: undefined, done: true });
                return new Promise(resolve => this.waiters.push(resolve));
            },
            return: () => {
                this.end();
                return Promise.resolve({ value: undefined, done: true });
            }
        };
    }
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function errorMessage(error) {
    return String(error?.message || error || '未知错误').slice(0, 300);
}

class WeLinkProvider {
    /**
     * @param {object} options
     * @param {string} options.tenantId
     * @param {() => object} [options.getRuntimeStatus] 供 /status 命令展示
     * @param {(entry:object) => void} [options.log]
     * @param {string} [options.channel] 频道标识；微信等频道复用本 Provider 的消息处理（访问控制、命令、回复、日志）
     * @param {string} [options.label] 频道显示名，用于提示词与命令回复
     * @param {{getConfig:Function}} [options.configRepo] 该频道的配置仓库
     * @param {(account:string) => string|null} [options.defaultUserName] 联系人的默认显示名（频道拿不到昵称时使用，如微信 bot 的绑定人）
     * @param {boolean} [options.accountIsReadable] 账号本身可读（WeLink 工号）时没有备注也用账号称呼；微信这类不透明 ID 设为 false
     */
    constructor({ tenantId, getRuntimeStatus, log, channel = CHANNEL, label = 'WeLink', configRepo: repo = configRepo, defaultUserName, accountIsReadable = true } = {}) {
        this.defaultUserName = defaultUserName || (() => null);
        this.accountIsReadable = accountIsReadable;
        this.tenantId = tenantId || 'default';
        this.channel = channel;
        this.label = label;
        this.configRepo = repo;
        this.getRuntimeStatus = getRuntimeStatus || (() => null);
        this.log = log || (() => {});
        this.outbound = null;
        this.activeRuns = new Map();
        this.stats = { inbound: 0, denied: 0, replies: 0, failures: 0, lastInboundAt: null, lastError: null };
    }

    inTenant(callback) {
        return runWithTenant(this.tenantId, callback);
    }

    async initialize(context) {
        this.outbound = context?.outbound || null;
    }

    async health() {
        return { online: true };
    }

    async createSession(input = {}) {
        return this.inTenant(async () => {
            const toolSessionId = newId('wl');
            const conversation = access.resolveConversation(input);
            await targetsRepo.upsertSession(this.channel, {
                toolSessionId,
                title: input.title || '',
                kind: conversation.kind,
                targetId: conversation.kind === 'group' ? conversation.groupId : conversation.senderAccount,
                senderAccount: conversation.senderAccount,
                ext: input.extParameters ? { platformExtParam: input.extParameters.platformExtParam || null, assistantId: input.assistantId || null } : null
            });
            this.log({ level: 'info', message: 'session created', toolSessionId, kind: conversation.kind });
            return { toolSessionId, ...(input.title ? { title: String(input.title) } : {}) };
        });
    }

    async listSlashCommands() {
        return this.inTenant(async () => {
            const config = await this.configRepo.getConfig();
            return { slashCommands: config.slashCommandsEnabled ? SLASH_COMMANDS.slice() : [] };
        });
    }

    runMessage(input = {}) {
        const runId = String(input.runId || newId('run'));
        const queue = new FactQueue();
        const controller = new AbortController();
        this.activeRuns.set(runId, { controller, toolSessionId: input.toolSessionId });
        let settle;
        const resultPromise = new Promise(resolve => { settle = resolve; });
        this.inTenant(() => this.produceRun(input, runId, queue, controller.signal))
            .then(result => settle(result))
            .catch(error => {
                this.stats.failures += 1;
                this.stats.lastError = errorMessage(error);
                this.log({ level: 'error', message: `runMessage failed: ${errorMessage(error)}`, runId });
                settle({ outcome: 'failed', error: { code: 'internal_error', message: errorMessage(error) } });
            })
            .finally(() => {
                this.activeRuns.delete(runId);
                queue.end();
            });
        return Promise.resolve({ runId, facts: queue, result: () => resultPromise });
    }

    async produceRun(input, runId, queue, signal) {
        const toolSessionId = String(input.toolSessionId || '');
        const text = String(input.text || '');
        const messageId = newId('msg');
        const partId = `${messageId}_text`;
        const config = await this.configRepo.getConfig();
        let stored = toolSessionId ? await targetsRepo.getSession(this.channel, toolSessionId) : null;
        const conversation = access.resolveConversation(input, stored);
        const targetId = conversation.kind === 'group' ? conversation.groupId : conversation.senderAccount;
        await targetsRepo.upsertSession(this.channel, {
            toolSessionId,
            kind: conversation.kind,
            targetId,
            senderAccount: conversation.senderAccount,
            ext: input.extParameters ? { platformExtParam: input.extParameters.platformExtParam || null } : null
        });
        stored = await targetsRepo.getSession(this.channel, toolSessionId);
        if (conversation.kind === 'group') {
            await targetsRepo.touchTarget(this.channel, { kind: 'group', id: conversation.groupId, displayName: stored?.title || null, toolSessionId });
            await targetsRepo.touchTarget(this.channel, { kind: 'user', id: conversation.senderAccount, toolSessionId: null });
        } else {
            await targetsRepo.touchTarget(this.channel, { kind: 'user', id: conversation.senderAccount, displayName: this.defaultUserName(conversation.senderAccount), toolSessionId });
        }
        // 发送人称呼：备注优先；账号不可读（微信 ID）时不把它当名字念出来
        const senderTarget = conversation.senderAccount ? await targetsRepo.getTarget(this.channel, 'user', conversation.senderAccount) : null;
        conversation.senderName = senderTarget && senderTarget.name !== conversation.senderAccount ? senderTarget.name : '';
        conversation.greetName = senderTarget?.alias || (this.accountIsReadable ? conversation.senderAccount : '');
        this.stats.inbound += 1;
        this.stats.lastInboundAt = new Date().toISOString();

        const verdict = access.checkInbound(config.access, conversation);
        const baseLog = { toolSessionId, kind: conversation.kind, targetId, sender: conversation.senderAccount };
        if (!verdict.allowed) {
            this.stats.denied += 1;
            await targetsRepo.logMessage(this.channel, { ...baseLog, direction: 'in', text, status: 'denied', error: access.describeDenial(verdict) });
            if (!input.context?.suppressReply && config.deniedReply) {
                queue.push({ type: 'message.start', messageId });
                queue.push({ type: 'text.done', messageId, partId, content: config.deniedReply });
                queue.push({ type: 'message.done', messageId, reason: 'denied' });
            }
            return { outcome: 'completed' };
        }
        await targetsRepo.logMessage(this.channel, { ...baseLog, direction: 'in', text, status: 'ok' });

        queue.push({ type: 'message.start', messageId });
        const trimmed = text.trim();
        if (trimmed.length && trimmed.length <= 30 && !trimmed.startsWith('/') && !stored?.aiSessionId) {
            queue.push({ type: 'session.title', title: trimmed });
        }
        const command = trimmed.split(/\s+/)[0].toLowerCase();
        if (config.slashCommandsEnabled && SLASH_COMMANDS.some(item => item.command === command)) {
            const reply = await this.handleSlashCommand(command, { toolSessionId, conversation, stored });
            queue.push({ type: 'text.done', messageId, partId, content: reply });
            queue.push({ type: 'message.done', messageId });
            await targetsRepo.logMessage(this.channel, { ...baseLog, direction: 'out', text: reply, status: 'ok', trigger: 'reply', source: command });
            this.stats.replies += 1;
            return { outcome: 'completed' };
        }
        if (config.replyEngine === 'rule') {
            const reply = this.ruleReply(trimmed, conversation);
            queue.push({ type: 'text.done', messageId, partId, content: reply });
            queue.push({ type: 'message.done', messageId });
            await targetsRepo.logMessage(this.channel, { ...baseLog, direction: 'out', text: reply, status: 'ok', trigger: 'reply', source: 'rule' });
            this.stats.replies += 1;
            return { outcome: 'completed' };
        }
        return this.dragonClawReply({ config, text, messageId, partId, queue, signal, conversation, stored, toolSessionId, baseLog });
    }

    async dragonClawReply({ config, text, messageId, partId, queue, signal, conversation, stored, toolSessionId, baseLog }) {
        let streamed = '';
        let finalText = '';
        let failure = null;
        let usage = null;
        const conversationRef = { kind: conversation.kind === 'group' ? 'group' : 'user', id: conversation.kind === 'group' ? conversation.groupId : conversation.senderAccount };
        // 运营群组：叠加群画像、互动要求与运营话术规范（延迟加载，避免与运营服务循环依赖）
        const opsNote = await require('./ops-service').interactionNote(this.channel, conversationRef.kind, conversationRef.id).catch(() => '');
        await dragonClawBridge.runTurn({
            channel: this.channel,
            account: conversation.senderAccount,
            conversation: conversationRef.id ? conversationRef : null,
            toolSessionId,
            text,
            aiSessionId: stored?.aiSessionId || '',
            modelId: config.modelId,
            signal,
            contextNote: `本次对话来自 ${this.label} ${conversation.kind === 'group' ? '群聊' : '单聊'}，发送人：${conversation.senderName || '未设置备注'}（账号 ${conversation.senderAccount || '未知'}）。${this.accountIsReadable ? '' : '称呼对方时用备注名或直接说「你」，不要在回复里复述账号 ID。'}回复会显示在 ${this.label} 聊天窗口中，请使用简洁的 Markdown；不要输出平台内部相对链接以外的可执行内容。${opsNote ? `\n\n${opsNote}` : ''}`,
            onEvent: event => {
                if (event.type === 'start' && event.sessionId) {
                    if (event.sessionId !== stored?.aiSessionId) targetsRepo.bindAiSession(this.channel, toolSessionId, event.sessionId).catch(() => {});
                    // 每个平台对话是该群/人时间线上的一段；/new 或换会话后从新段落开始
                    if (conversationRef.id) followupsRepo.addSegment(this.channel, { ...conversationRef, toolSessionId, aiSessionId: event.sessionId }).catch(() => {});
                } else if (event.type === 'delta' && event.delta) {
                    streamed += event.delta;
                    queue.push({ type: 'text.delta', messageId, partId, content: String(event.delta) });
                } else if (event.type === 'done') {
                    finalText = String(event.reply || streamed);
                    usage = { tokens: event.usage || event.tokens || null, cost: Number(event.cost) || 0 };
                } else if (event.type === 'error') {
                    failure = String(event.error || 'Dragon Claw 回复失败');
                } else if (event.type === 'http-json' && event.status >= 400) {
                    failure = String(event.body?.error || `Dragon Claw 回复失败（HTTP ${event.status}）`);
                }
            }
        });
        if (signal.aborted) {
            queue.push({ type: 'text.done', messageId, partId, content: `${streamed}${streamed ? '\n\n' : ''}（已停止生成）` });
            queue.push({ type: 'message.done', messageId, reason: 'aborted' });
            await targetsRepo.logMessage(this.channel, { ...baseLog, direction: 'out', text: streamed, status: 'aborted', trigger: 'reply', source: 'dragon-claw' });
            return { outcome: 'aborted' };
        }
        if (failure) {
            this.stats.failures += 1;
            this.stats.lastError = failure;
            const content = `${streamed}${streamed ? '\n\n' : ''}⚠️ ${failure}`;
            queue.push({ type: 'text.done', messageId, partId, content });
            queue.push({ type: 'message.done', messageId, reason: 'error' });
            await targetsRepo.logMessage(this.channel, { ...baseLog, direction: 'out', text: content, status: 'error', trigger: 'reply', source: 'dragon-claw', error: failure });
            return { outcome: 'failed', error: { code: 'provider_unavailable', message: failure.slice(0, 300), retryable: true } };
        }
        const content = finalText || streamed || '（无回复内容）';
        queue.push({ type: 'text.done', messageId, partId, content });
        queue.push({ type: 'message.done', messageId, ...(usage?.tokens ? { tokens: usage.tokens } : {}), ...(usage ? { cost: usage.cost } : {}) });
        await targetsRepo.logMessage(this.channel, { ...baseLog, direction: 'out', text: content, status: 'ok', trigger: 'reply', source: 'dragon-claw' });
        this.stats.replies += 1;
        return { outcome: 'completed', usage: usage || undefined };
    }

    ruleReply(text, conversation) {
        if (/^(你好|您好|hello|hi|嗨|在吗)/i.test(text)) {
            return `👋 你好${conversation.greetName ? `，${conversation.greetName}` : ''}！我是平台助理。输入 /help 查看可用命令。`;
        }
        return `收到：「${text.slice(0, 200)}」\n\n当前助理为规则回复模式，管理员可在「全局设置 › 频道对接」切换为 Dragon Claw 智能回复。输入 /help 查看命令。`;
    }

    async handleSlashCommand(command, { toolSessionId, conversation, stored }) {
        if (command === '/help') {
            return ['📖 可用命令：', ...SLASH_COMMANDS.map(item => `- \`${item.command}\` ${item.description}`), '', '直接发送文字即可与 Dragon Claw 对话，可询问平台工具、指标与报表数据。'].join('\n');
        }
        if (command === '/new') {
            await targetsRepo.bindAiSession(this.channel, toolSessionId, null);
            return '🆕 已开启新对话，之前的上下文不再参与回答。';
        }
        if (command === '/whoami') {
            return [
                '🪪 当前会话信息：',
                `- 账号：${conversation.senderAccount || '未知'}`,
                `- 会话类型：${conversation.kind === 'group' ? '群聊' : '单聊'}`,
                ...(conversation.kind === 'group' ? [`- 群组 ID：${conversation.groupId}`] : []),
                `- 会话 ID：${toolSessionId}`,
                ...(stored?.aiSessionId ? [`- 平台对话：${stored.aiSessionId}`] : [])
            ].join('\n');
        }
        const status = this.getRuntimeStatus() || {};
        return [
            '📊 助理状态：',
            `- 网关：${status.state || 'unknown'}`,
            `- 本次运行收到消息：${this.stats.inbound} 条（拒绝 ${this.stats.denied}）`,
            `- 正在处理：${this.activeRuns.size}`
        ].join('\n');
    }

    async replyQuestion() {
        return { applied: true };
    }

    async replyPermission() {
        return { applied: true };
    }

    async closeSession(input = {}) {
        await this.inTenant(() => targetsRepo.closeSession(this.channel, String(input.toolSessionId || '')));
        return { applied: true };
    }

    async abortSession(input = {}) {
        const runIds = Array.isArray(input.runIds) ? input.runIds : [];
        for (const [runId, run] of this.activeRuns) {
            if (runIds.includes(runId) || (!runIds.length && run.toolSessionId === input.toolSessionId)) run.controller.abort();
        }
        return { applied: true };
    }

    async dispose() {
        for (const run of this.activeRuns.values()) run.controller.abort();
        this.activeRuns.clear();
    }
}

module.exports = { WeLinkProvider, FactQueue, SLASH_COMMANDS, CHANNEL };
