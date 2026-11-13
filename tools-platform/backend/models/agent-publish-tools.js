// 对话里的两个「交付」工具（与基座 Web 版同名同参数）：
//   publish_html_tool  把对话里生成的单页 HTML 发布成平台的自定义工具（与「导入工具」同一套存储，发布后出现在工具中心）；
//   send_notification  把一段文字推送到管理员在「频道对接」里配置的默认推送范围（WeLink / 微信）。
//                      基座 Web 版发的是基座通知（邮件）；主线版没有邮件网关，用频道推送对齐，范围与 /api/channels/:channel/push 相同。
// 两个工具都是写操作：走对话的审批卡（请求批准 / 帮我批准 / 完全访问，以及「本次会话不再询问」）。
const repo = require('./custom-tools-repository');
const { isSuperAdmin } = require('../middleware/auth');
const { DEFAULT_TENANT_ID, getTenantId } = require('./tenant-context');

const MAX_HTML_BYTES = 4 * 1024 * 1024;
const CHANNEL_LABEL = { welink: 'WeLink', weixin: '微信' };

const DEFINITIONS = [
    {
        name: 'publish_html_tool',
        description: '把一个自包含的单页 HTML 发布为平台里的自定义工具，返回访问链接。只有用户确认要发布时才调用；HTML 要内联全部样式和脚本。发布后在工具中心可见，执行前会请用户确认。',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '工具名称' },
                description: { type: 'string', description: '一句话说明' },
                icon: { type: 'string', description: '一个表情' },
                html: { type: 'string', description: '完整的 HTML 文档（含 <html>）' }
            },
            required: ['name', 'html']
        }
    },
    {
        name: 'send_notification',
        description: '把一段文字推送到管理员在「频道对接」里配置的默认推送范围（WeLink 群 / 联系人，或微信联系人）。仅管理员可用；只发到默认推送范围，不能指定其他人。执行前会请用户确认。',
        parameters: {
            type: 'object',
            properties: {
                channel: { type: 'string', description: 'welink（默认）或 weixin' },
                text: { type: 'string', description: '要发送的正文，简明扼要' }
            },
            required: ['text']
        }
    }
];

const fail = (message, code = 'PUBLISH_ERROR') => Object.assign(new Error(message), { code });
const isAdmin = user => Boolean(user && user.role === 'admin');

function checkHtml(args) {
    const name = String(args.name || '').trim().slice(0, 80);
    const html = String(args.html || '');
    if (!name) throw fail('工具名称不能为空');
    if (!/<html[\s>]/i.test(html)) throw fail('html 必须是完整的 HTML 文档（含 <html> 标签）');
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw fail('HTML 不能超过 4 MB');
    return { name, html };
}

async function pushScope(channel) {
    const configRepo = require(channel === 'weixin' ? './channels/weixin-config-repository' : './channels/welink-config-repository');
    const config = await configRepo.getConfig();
    return Array.isArray(config?.push?.defaultTargets) ? config.push.defaultTargets : [];
}

function toolset({ user }) {
    return {
        id: 'publish_tools',
        label: '交付：把生成的 HTML 发布成平台工具；把消息推送到频道的默认推送范围',
        definitions: DEFINITIONS,
        kindOf: () => 'write',
        alwaysKey: name => name,
        async preview(name, args = {}) {
            if (name === 'publish_html_tool') {
                const { name: toolName, html } = checkHtml(args);
                return { path: `发布自定义工具「${toolName}」`, message: `${String(args.description || '').slice(0, 200)}\n（HTML ${Math.round(Buffer.byteLength(html, 'utf8') / 1024)} KB）` };
            }
            const channel = args.channel === 'weixin' ? 'weixin' : 'welink';
            const targets = await pushScope(channel);
            return { channel: CHANNEL_LABEL[channel], targets: targets.map(t => t.name || t.id).join('、') || '（未配置默认推送范围）', message: String(args.text || '').slice(0, 2000) };
        },
        async execute(call) {
            const args = call.args && typeof call.args === 'object' ? call.args : {};
            try {
                if (call.name === 'publish_html_tool') {
                    if (!isSuperAdmin(user) && getTenantId() === DEFAULT_TENANT_ID) throw fail('不能往系统空间发布工具；请在自己的团队空间里发布', 'FORBIDDEN');
                    const { name, html } = checkHtml(args);
                    const tool = await repo.createTool({ name, htmlContent: html, description: String(args.description || '').slice(0, 400), icon: args.icon });
                    return { content: `已发布：${tool.name}，访问地址 ${tool.href}（工具中心里也能找到）。给用户链接时用 Markdown：[${tool.name}](${tool.href})`, summary: `已发布 ${tool.name}` };
                }
                if (call.name === 'send_notification') {
                    if (!isAdmin(user)) throw fail('发送通知需要管理员权限', 'FORBIDDEN');
                    const channel = args.channel === 'weixin' ? 'weixin' : 'welink';
                    const text = String(args.text || '').trim();
                    if (!text) throw fail('通知内容不能为空');
                    const targets = await pushScope(channel);
                    if (!targets.length) throw fail(`${CHANNEL_LABEL[channel]} 还没有配置默认推送范围，请管理员在「全局设置 › 频道对接」里配置`, 'NO_TARGETS');
                    const result = await require('./channels').push({ channel, text: text.slice(0, 4000), targets, trigger: 'system', source: `dragon-claw:${user?.username || ''}` });
                    return { content: `已推送到 ${CHANNEL_LABEL[channel]} 默认推送范围（${targets.length} 个会话）。${JSON.stringify(result).slice(0, 500)}`, summary: `已推送 ${targets.length} 个会话` };
                }
                return { content: `未知工具：${call.name}`, summary: '未知工具', isError: true };
            } catch (error) {
                return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
            }
        }
    };
}

module.exports = { toolset, DEFINITIONS };
