// 首页对话的附加工具组：浏览器（桌面端 Dragon 浏览器 / 服务端本机 Chrome），以及之后的 MCP 服务。
// 各组整组按需加载（系统提示只列名称，tool_search 加载），审批按工具类别：
// - 工作区：经 agent-tool-registry 的 extraToolsets 接入，走工作区的审批卡与权限模式；
// - 不选目录的对话：forChat() 建一个只含附加工具的登记表，审批卡走同一套 /api/agent-workspace/approvals。
// 只给管理员（打开网址可访问服务端能访问的内网地址）。
const browser = require('./agent-browser');

/** 当前可用的附加工具组；owner 为 租户::账号 */
async function toolsets({ owner, readOnly }) {
    if (readOnly || !owner) return [];
    const sets = [];
    const where = browser.available();
    if (where) {
        const ctx = { owner };
        sets.push({
            id: 'browser',
            label: `浏览器（${where.kind === 'desktop' ? 'Dragon 浏览器，页面显示在桌面上' : `本机 ${where.label}，无界面`}）：打开网页、读页面、点击输入、抓网络请求与控制台`,
            definitions: browser.definitions(),
            kindOf: name => browser.kindOf(name),
            preview: (name, args) => browser.preview(ctx, name, args),
            alwaysKey: (name, args) => browser.alwaysKey(name, args),
            execute: call => browser.execute(ctx, call.name, call.args && typeof call.args === 'object' ? call.args : {})
        });
    }
    // MCP 服务：每个已连接的服务一组（只给默认租户的管理员；连不上的服务这一轮跳过）
    sets.push(...await require('./agent-mcp').toolsets({ readOnly }).catch(error => { console.warn('[agent] MCP 工具不可用：', error.message || error); return []; }));
    return sets;
}

/**
 * 不选目录的对话：返回 { definitions(), prompt, handles(name), execute(call, { start }), end() }；没有可用工具组时返回 null。
 * 审批：读取类直接执行，其余弹审批卡（「总是允许」在本对话内有效）。
 */
async function forChat({ owner, chatSessionId, readOnly, write, signal, sensitiveValues = [] }) {
    const sets = await toolsets({ owner, readOnly });
    if (!sets.length) return null;
    const manager = require('./agent-run-manager');
    const registry = await require('./agent-tool-registry').create({ session: manager.chatSession(owner, chatSessionId), core: false, extraToolsets: sets, sensitiveValues });
    const run = manager.beginChatRun({ owner, chatSessionId, write, signal });
    return {
        definitions: () => registry.definitions(),
        prompt: registry.catalogPrompt(),
        handles: name => registry.isMeta(name) || Boolean(registry.toolset(name)),
        async execute(call, { start }) {
            start();
            if (registry.isMeta(call.name)) return registry.runMeta(call);
            const set = registry.toolset(call.name);
            registry.noteCall(call.name);
            const decision = await manager.decideCall(run, call, { kind: set.kindOf(call.name, call.args), preview: () => set.preview(call.name, call.args), key: set.alwaysKey?.(call.name, call.args) });
            if (decision.outcome) return decision.outcome;
            return set.execute(call);
        },
        end: () => run.end()
    };
}

module.exports = { toolsets, forChat };
