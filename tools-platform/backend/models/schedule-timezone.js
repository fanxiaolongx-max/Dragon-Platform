// 仅解析预约时间旁的显式时区；不从提醒正文猜测地点，也不使用固定 UTC 偏移。
const ALIASES = {
    荷兰: 'Europe/Amsterdam', 阿姆斯特丹: 'Europe/Amsterdam',
    埃及: 'Africa/Cairo', 开罗: 'Africa/Cairo',
    中国: 'Asia/Shanghai', 北京: 'Asia/Shanghai', 上海: 'Asia/Shanghai',
    英国: 'Europe/London', 伦敦: 'Europe/London',
    德国: 'Europe/Berlin', 柏林: 'Europe/Berlin',
    法国: 'Europe/Paris', 巴黎: 'Europe/Paris',
    日本: 'Asia/Tokyo', 东京: 'Asia/Tokyo', 新加坡: 'Asia/Singapore',
    印度: 'Asia/Kolkata', 迪拜: 'Asia/Dubai', 沙特: 'Asia/Riyadh',
    纽约: 'America/New_York', 洛杉矶: 'America/Los_Angeles'
};
const IANA = '[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+';
// 供群聊入口在 @助理与指令连写时识别地区时间的起点；不明确的地区也保留给解析器报错。
const REGION_TIME = `(?:(?:按(?:照)?|以|使用))?(?:${Object.keys(ALIASES).sort((a, b) => b.length - a.length).join('|')}|美国|加拿大|澳大利亚|欧洲|当地)(?:当地)?(?:时间|时区)`;
const PREFIX = /^(?:(?:按(?:照)?|以|使用)\s*)?(?:(?:时区|timezone)\s*[:：=]?\s*)?/i;
const TIME_START = /^(?:每|今天|今日|今晚|明|后天|过|in\b|at\b|tomorrow\b|daily\b|every\b|weekdays?\b|hourly\b|today\b|tonight\b|凌晨|早|上午|中午|下午|傍晚|晚上|[零〇一二两三四五六七八九十半\d])/i;
const ACTION_START = /^(?:提醒|叫我|通知|发送|发给|推送|汇总|生成|检查|查看|查询|比较)/;

function timezoneError(message) {
    return Object.assign(new Error(message), { code: 'SCHEDULE_TIMEZONE_INVALID', statusCode: 400 });
}

function resolve(value) {
    const token = value.replace(/(?:当地)?(?:时间|时区)$/, '').trim();
    const zone = ALIASES[token] || token;
    if (!ALIASES[token] && !new RegExp(`^(?:${IANA}|UTC)$`, 'i').test(zone)) {
        throw timezoneError(`无法确定“${value}”的时区，请写明城市（如纽约时间、洛杉矶时间）或地区时区（如 Europe/Amsterdam）`);
    }
    try {
        return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
    } catch {
        throw timezoneError(`无法识别时区“${value}”，请使用如“荷兰时间”或“Europe/Amsterdam”`);
    }
}

/** 读取开头的时区修饰语，返回 { timezone, rest } 或 null。 */
function take(input) {
    const text = String(input || '').replace(/^[\s,，、:：;；]+/, '');
    const wrapped = /^([（(\[])([^（）()\[\]]{1,100})[）)\]]/.exec(text);
    if (wrapped) {
        const inner = take(wrapped[2]);
        if (inner && !inner.rest) return { timezone: inner.timezone, rest: text.slice(wrapped[0].length).trimStart() };
        return null;
    }
    const prefix = PREFIX.exec(text)[0];
    const body = text.slice(prefix.length);
    if (TIME_START.test(body) || ACTION_START.test(body)) return null;
    const token = new RegExp(`^(?:${IANA}(?:时间|时区)?|UTC(?:时间|时区)?|[\\p{Script=Han}]{1,20}?(?:时间|时区))`, 'iu').exec(body);
    if (!token) return null;
    return { timezone: resolve(token[0]), rest: body.slice(token[0].length).replace(/^[\s,，、:：;；]+/, '') };
}

/** 末尾只有用括号、逗号或“按…”明确标注的时区才作为修饰语。 */
function takeSuffix(input) {
    const text = String(input || '');
    const match = /(?:[（(\[][^（）()\[\]]+[）)\]]|[,，;；]\s*[^,，;；]+|\s+按(?:照)?\s*[^,，;；]+)$/.exec(text);
    if (!match) return null;
    const modifier = take(match[0]);
    return modifier && !modifier.rest ? { timezone: modifier.timezone, rest: text.slice(0, match.index).trimEnd() } : null;
}

module.exports = { take, takeSuffix, REGION_TIME };
