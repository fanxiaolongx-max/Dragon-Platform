// WeLink 斜杠命令配置与管理（assistant-command-executor / ace）
// 存储在当前租户的 sys_kv_store 中，支持在线发布、下架与导出 Python 脚手架代码。
const { readKV, writeKV } = require('../kv-store');

const CATEGORY = 'channels';
const KEY = 'welink_slash_commands';

const DEFAULT_COMMANDS = [
    {
        name: 'dragonclaw',
        nameZh: '龙爪平台',
        nameEn: 'dragonclaw',
        descZh: '一键打开龙爪自动化工具平台',
        descEn: 'Dragon Claw Platform',
        type: 1, // 1: 直接打开网页, 2: 聊天网页卡片, 3: 本地 Python 命令
        scopes: ['user', 'group'],
        url: '', // 前端或调用端可填入当前宿主服务地址
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
];

function clean(value, max = 200) {
    return String(value ?? '').trim().slice(0, max);
}

function normalizeScopes(scopes) {
    if (typeof scopes === 'string') {
        const parts = scopes.split(',').map(s => s.trim().toLowerCase());
        const set = new Set();
        if (parts.includes('1') || parts.includes('user')) set.add('user');
        if (parts.includes('2') || parts.includes('group')) set.add('group');
        return set.size ? Array.from(set) : ['user', 'group'];
    }
    if (Array.isArray(scopes)) {
        const valid = scopes.map(s => String(s).trim().toLowerCase()).filter(s => s === 'user' || s === 'group');
        return valid.length ? Array.from(new Set(valid)) : ['user', 'group'];
    }
    return ['user', 'group'];
}

function normalizeCommand(item = {}) {
    const rawName = clean(item.name || item.command, 32).toLowerCase().replace(/^\//, '');
    const name = rawName.replace(/[^a-z0-9_-]/g, '') || 'my_command';
    const type = [1, 2, 3].includes(Number(item.type)) ? Number(item.type) : 1;
    const scopes = normalizeScopes(item.scopes);
    return {
        name,
        nameZh: clean(item.nameZh || item.chineseName || name, 60),
        nameEn: clean(item.nameEn || item.englishName || name, 60),
        descZh: clean(item.descZh || item.description || '', 200),
        descEn: clean(item.descEn || item.descriptionEn || '', 200),
        type,
        scopes,
        url: type === 3 ? '' : clean(item.url || '', 500),
        status: item.status === 'disabled' ? 'disabled' : 'active',
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

async function listCommands() {
    const list = await readKV(CATEGORY, KEY, null);
    if (!Array.isArray(list)) {
        return DEFAULT_COMMANDS.map(c => ({ ...c }));
    }
    return list.map(normalizeCommand);
}

async function getCommand(name) {
    const cleanName = clean(name, 32).toLowerCase().replace(/^\//, '');
    const list = await listCommands();
    return list.find(c => c.name === cleanName) || null;
}

async function saveCommand(input = {}) {
    const item = normalizeCommand(input);
    const list = await listCommands();
    const idx = list.findIndex(c => c.name === item.name);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...item, createdAt: list[idx].createdAt };
    } else {
        list.push(item);
    }
    await writeKV(CATEGORY, KEY, list);
    return item;
}

async function deleteCommand(name) {
    const cleanName = clean(name, 32).toLowerCase().replace(/^\//, '');
    const list = await listCommands();
    const filtered = list.filter(c => c.name !== cleanName);
    await writeKV(CATEGORY, KEY, filtered);
    return { deleted: list.length !== filtered.length };
}

/**
 * 为指定命令生成对应的 assistant_command_executor (ace) Python 脚手架源码
 */
function generateScaffold(cmd) {
    const item = normalizeCommand(cmd);
    const scopeStr = JSON.stringify(item.scopes);
    const typeComment = item.type === 1 
        ? '# 类型 1: 直接打开网页/We码（无需本地长连接服务）' 
        : item.type === 2 
            ? '# 类型 2: 聊天返回网页卡片' 
            : '# 类型 3: 本地 Python 命令（处理消息并回复，需 ace serve 常驻）';

    if (item.type === 1 || item.type === 2) {
        return `"""
WeLink 斜杠命令: ${item.name}
${typeComment}
入口: ${item.scopes.join(', ')}
"""

CONFIG = {
    "name": "${item.name}",
    "chinese_name": "${item.nameZh || item.name}",
    "description": "${item.descZh || ''}",
    "description_en": "${item.descEn || ''}",
    "command_type": ${item.type},
    "scopes": ${scopeStr},
    "url": "${item.url || 'http://127.0.0.1:5200'}"
}
`;
    }

    return `"""
WeLink 斜杠命令: ${item.name}
${typeComment}
入口: ${item.scopes.join(', ')}
"""
import asyncio
import json
import urllib.request

CONFIG = {
    "name": "${item.name}",
    "chinese_name": "${item.nameZh || item.name}",
    "description": "${item.descZh || ''}",
    "description_en": "${item.descEn || ''}",
    "command_type": 3,
    "scopes": ${scopeStr}
}

async def handle(ctx):
    """
    处理 WeLink 斜杠命令事件
    - ctx.raw_text: 完整指令 (例如 "/${item.name} 查告警")
    - ctx.args: 参数列表 (list)
    - ctx.user_account: 发送人员工号
    - ctx.is_group: 是否来自群聊 (bool)
    - ctx.group_id: 群组 ID (群聊时有效)
    - ctx.send_text(str): 向当前对话发送文本
    """
    query = " ".join(ctx.args).strip()
    if not query:
        await ctx.send_text("请输入查询内容，例如：/${item.name} 查今天待参加会议")
        return

    await ctx.send_text(f"⏳ 正在执行：{query} ...")
    
    # 可直接对接 Dragon Claw 本地接口或执行本地 Python 业务逻辑
    # 示例: 向本机 Dragon Claw 发起查询
    try:
        payload = json.dumps({"query": query, "account": ctx.user_account}).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:5200/api/channels/welink/query-proxy",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            await ctx.send_text(data.get("text", "✅ 执行完成。"))
    except Exception as e:
        await ctx.send_text(f"❌ 服务响应异常: {str(e)}")
`;
}

module.exports = {
    listCommands,
    getCommand,
    saveCommand,
    deleteCommand,
    generateScaffold,
    normalizeCommand
};
