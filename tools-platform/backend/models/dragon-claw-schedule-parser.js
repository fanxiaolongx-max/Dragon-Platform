// Dragon Claw「/schedule」的时间解析（纯函数，便于测试）：从「时间 + 指令」里取出开头的时间表达式。
//   一次性：10m / 2h / 1d、10分钟后、半小时后、in 30 minutes、15:30、明天 9:00、下午3点半、2026-11-01 09:00、tomorrow 9am
//   周期：每天 9:00、每个工作日 9:00、每周一、三 9:00、每隔 2 小时、daily 9:00、weekdays 9:00、every monday 9:00、every 2h
// 周期规则复用运营计划的 ops-schedule（daily / weekly / interval），时区按用户浏览器、工作日按平台工作日历。
const opsSchedule = require('./channels/ops-schedule');
const followupSchedule = require('./channels/followup-schedule');

const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_DAYS = 366;
const MIN_INTERVAL = 30;
const MAX_INTERVAL = 7 * 1440;

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_WEEKDAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const EN_WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const UNIT_MINUTES = { m: 1, min: 1, mins: 1, minute: 1, minutes: 1, 分: 1, 分钟: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, 小时: 60, 个小时: 60, 钟头: 60, 个钟头: 60, d: 1440, day: 1440, days: 1440, 天: 1440 };

function parseError(message) {
    return Object.assign(new Error(message), { code: 'SCHEDULE_PARSE_FAILED', statusCode: 400 });
}

/** 「12」「十二」「二十五」「半」→ 数字。 */
function toNumber(text) {
    const value = String(text || '').trim();
    if (!value) return NaN;
    if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
    if (value === '半') return 0.5;
    if (!/^[零〇一二两三四五六七八九十]+$/.test(value)) return NaN;
    if (!value.includes('十')) return value.split('').reduce((sum, char) => sum * 10 + CN_DIGITS[char], 0);
    const [tens, ones] = value.split('十');
    return (tens ? CN_DIGITS[tens] : 1) * 10 + (ones ? CN_DIGITS[ones] : 0);
}

const NUM = '(\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十]+|半)';
const UNIT = '(minutes?|mins?|hours?|hrs?|days?|个小时|个钟头|小时|钟头|分钟|分|天|[mhd])';
// 钟点：15:30、9点、9点半、9点15、下午3点、9am、9:30pm
const CLOCK = '(?:(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚|明早|明晚)\\s*)?(\\d{1,2}|[零〇一二两三四五六七八九十]+)(?:\\s*[:：]\\s*(\\d{2})|\\s*点\\s*(?:(半|\\d{1,2})分?)?|\\s*时)?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';

function clockToTime(period, hourText, minuteText, halfOrMinute, meridiem, { requireMarker = false } = {}) {
    let hours = toNumber(hourText);
    let minutes = minuteText ? Number(minuteText) : (halfOrMinute === '半' ? 30 : (halfOrMinute ? Number(halfOrMinute) : 0));
    if (requireMarker && !minuteText && halfOrMinute === undefined && !period && !meridiem) return null;
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    const pm = /^p/i.test(meridiem || '') || ['下午', '傍晚', '晚上', '今晚', '明晚'].includes(period) || (period === '中午' && hours < 11);
    const am = /^a/i.test(meridiem || '');
    if (pm && hours < 12) hours += 12;
    if (am && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clockRegex(prefix) {
    return new RegExp(`^${prefix}${CLOCK}`, 'i');
}

/** 把匹配到的钟点转成 HH:MM；数字后没有冒号/点/am 等标记的视为非钟点（避免把「3 个任务」当成 3 点）。 */
function clockFrom(match, offset, options) {
    const [period, hour, minute, halfOrMinute, meridiem] = match.slice(offset, offset + 5);
    const hasMarker = Boolean(period || minute || meridiem || /[点时]/.test(match[0].slice(match[0].indexOf(hour) + hour.length)));
    if (options?.requireMarker && !hasMarker) return null;
    return clockToTime(period, hour, minute, halfOrMinute, meridiem);
}

function remainder(text, consumed) {
    return text.slice(consumed).replace(/^[\s,，、:：;；。.-]+/, '').trim();
}

function zoneDayOffset(now, timezone, days) {
    const today = followupSchedule.zoneParts(now, timezone);
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + days));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function atZone({ year, month, day }, time, timezone) {
    const [hours, minutes] = time.split(':').map(Number);
    return followupSchedule.fromZone(year, month, day, hours * 60 + minutes, timezone);
}

function checkOnce(runAt, now) {
    if (!runAt || Number.isNaN(runAt.getTime())) throw parseError('无法识别执行时间');
    if (runAt.getTime() - now.getTime() < MIN_DELAY_MINUTES * 60000 - 1000) throw parseError('执行时间需要晚于现在至少 1 分钟');
    if (runAt.getTime() - now.getTime() > MAX_DELAY_DAYS * 86400000) throw parseError('一次性任务最多预约一年以内');
    return runAt;
}

function parseWeekdays(text) {
    const days = [];
    for (const part of text.split(/[、,，/和及\s]+/).filter(Boolean)) {
        const cn = part.replace(/^(周|星期|礼拜)/, '');
        const range = /^([一二三四五六日天])\s*[到至~-]\s*([一二三四五六日天])$/.exec(cn);
        if (range) {
            let day = CN_WEEKDAYS[range[1]];
            const end = CN_WEEKDAYS[range[2]];
            for (let guard = 0; guard < 7; guard += 1) { days.push(day); if (day === end) break; day = (day + 1) % 7; }
        } else if (CN_WEEKDAYS[cn] !== undefined && cn.length === 1) days.push(CN_WEEKDAYS[cn]);
        else if (EN_WEEKDAYS[part.toLowerCase().slice(0, 3)] !== undefined) days.push(EN_WEEKDAYS[part.toLowerCase().slice(0, 3)]);
        else return null;
    }
    return days.length ? [...new Set(days)].sort() : null;
}

function interval(minutes) {
    const value = Math.round(minutes);
    if (value < MIN_INTERVAL) throw parseError(`周期任务最短间隔 ${MIN_INTERVAL} 分钟`);
    if (value > MAX_INTERVAL) throw parseError('周期任务最长间隔 7 天，更长的请用每周');
    return { type: 'interval', intervalMinutes: value, workdaysOnly: false, times: ['09:00'], weekdays: [] };
}

/** 周期规则：返回 { rule, consumed } 或 null。 */
function parseRecurring(text) {
    let match;
    // 每隔 2 小时 / 每 30 分钟 / every 2h / every 90 minutes
    if ((match = new RegExp(`^(?:每隔|每|every)\\s*${NUM}\\s*${UNIT}(?![a-z])`, 'i').exec(text))) {
        const unit = UNIT_MINUTES[match[2].toLowerCase()];
        return { rule: interval(toNumber(match[1]) * unit), consumed: match[0].length };
    }
    // 每小时 / hourly
    if ((match = /^(?:每小时|每个小时|hourly)/i.exec(text))) return { rule: interval(60), consumed: match[0].length };
    // 每周一、三 9:00 / every monday,wed 9:00
    if ((match = /^(?:每周|每个星期|每星期|每礼拜|every\s+)((?:(?:周|星期)?[一二三四五六日天](?:\s*[到至~-]\s*[一二三四五六日天])?|(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*)(?:\s*[、,，/和及]\s*(?:(?:周|星期)?[一二三四五六日天]|(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*))*)\s*/i.exec(text))) {
        const weekdays = parseWeekdays(match[1]);
        const clock = clockRegex('(?:at\\s+)?').exec(text.slice(match[0].length));
        const time = clock && clockFrom(clock, 1);
        if (!weekdays) throw parseError('无法识别星期几');
        if (!time) throw parseError('请写明每周几的几点执行，例如「每周一 9:00」');
        return { rule: { type: 'weekly', weekdays, times: [time], workdaysOnly: false }, consumed: match[0].length + clock[0].length };
    }
    // 每个工作日 / 工作日 / weekdays / every weekday
    if ((match = /^(?:每个工作日|每工作日|工作日|(?:every\s+)?weekdays?)\s*/i.exec(text))) {
        const clock = clockRegex('(?:at\\s+)?').exec(text.slice(match[0].length));
        const time = clock && clockFrom(clock, 1);
        if (!time) throw parseError('请写明几点执行，例如「每个工作日 9:00」');
        return { rule: { type: 'daily', times: [time], workdaysOnly: true }, consumed: match[0].length + clock[0].length };
    }
    // 每天 / 每日 / 每晚 / daily / every day
    if ((match = /^(?:每天|每日|天天|每晚|每早|daily|every\s*day)\s*/i.exec(text))) {
        const implied = /每晚/.test(match[0]) ? '晚上' : '';
        const clock = clockRegex('(?:at\\s+)?').exec(`${implied}${text.slice(match[0].length)}`);
        const time = clock && clockFrom(clock, 1);
        if (!time) throw parseError('请写明每天几点执行，例如「每天 9:00」');
        return { rule: { type: 'daily', times: [time], workdaysOnly: false }, consumed: match[0].length + clock[0].length - implied.length };
    }
    return null;
}

/** 一次性：返回 { runAt, consumed } 或 null。 */
function parseOnce(text, now, timezone) {
    let match;
    // 10m / 2h / 1d / 10分钟后 / 半小时后 / 2个小时以后 / in 30 minutes
    if ((match = new RegExp(`^(?:in\\s+|过)?${NUM}\\s*${UNIT}(?![a-z])\\s*(?:后|以后|之后|later)?`, 'i').exec(text))) {
        const unit = UNIT_MINUTES[match[2].toLowerCase()];
        const spoken = /后|以后|之后|later|^in\s|^过/i.test(match[0]) || /^[mhd]$/i.test(match[2]) || /^\d/.test(match[1]);
        if (spoken) return { runAt: new Date(now.getTime() + toNumber(match[1]) * unit * 60000), consumed: match[0].length };
    }
    if ((match = /^(?:半小时|半个小时|半个钟头)\s*(?:后|以后|之后)/.exec(text))) return { runAt: new Date(now.getTime() + 30 * 60000), consumed: match[0].length };
    // 2026-11-01 09:00 / 11-01 9:00 / 11月1日 9点
    if ((match = /^(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})[日号]?\s*/.exec(text))) {
        const clock = clockRegex('(?:at\\s+)?').exec(text.slice(match[0].length));
        const time = clock ? clockFrom(clock, 1) : null;
        if (!time) throw parseError('请写明日期后的具体时间，例如「11-01 09:00」');
        const today = followupSchedule.zoneParts(now, timezone);
        let year = match[1] ? Number(match[1]) : today.year;
        let runAt = atZone({ year, month: Number(match[2]), day: Number(match[3]) }, time, timezone);
        if (!match[1] && runAt.getTime() <= now.getTime()) runAt = atZone({ year: year + 1, month: Number(match[2]), day: Number(match[3]) }, time, timezone);
        return { runAt, consumed: match[0].length + clock[0].length };
    }
    // 今天/明天/后天/今晚/明早 + 钟点；tomorrow 9am
    if ((match = /^(今天|今日|今晚|明天|明日|明早|明晚|后天|tonight|today|tomorrow)\s*/i.exec(text))) {
        const word = match[1].toLowerCase();
        const days = /后天/.test(word) ? 2 : (/明|tomorrow/.test(word) ? 1 : 0);
        const implied = { 今晚: '晚上', 明晚: '晚上', 明早: '早上', tonight: '晚上' }[word] || '';
        const clock = clockRegex('(?:at\\s+)?').exec(`${implied}${text.slice(match[0].length)}`);
        const time = clock && clockFrom(clock, 1);
        if (!time) throw parseError('请写明几点执行，例如「明天 9:00」');
        return { runAt: atZone(zoneDayOffset(now, timezone, days), time, timezone), consumed: match[0].length + clock[0].length - implied.length };
    }
    // 只有钟点：15:30 / 下午3点 / at 9pm（今天已过则顺延到明天）
    if ((match = clockRegex('(?:at\\s+)?').exec(text))) {
        const time = clockFrom(match, 1, { requireMarker: true });
        if (time) {
            let runAt = atZone(zoneDayOffset(now, timezone, 0), time, timezone);
            if (runAt.getTime() <= now.getTime()) runAt = atZone(zoneDayOffset(now, timezone, 1), time, timezone);
            return { runAt, consumed: match[0].length };
        }
    }
    return null;
}

/**
 * 解析「/schedule」后面的文字。
 * @returns {{ kind:'once', runAt:Date, instruction:string } | { kind:'recurring', rule:object, instruction:string }}
 */
function parse(input, { now = new Date(), timezone } = {}) {
    const text = String(input || '').trim();
    if (!text) throw parseError('请写明时间和要执行的指令，例如「/schedule 明天 9:00 汇总昨天的告警」');
    const zone = followupSchedule.normalizeCalendar({ timezone }).timezone;
    const recurring = parseRecurring(text);
    if (recurring) {
        const instruction = remainder(text, recurring.consumed);
        if (!instruction) throw parseError('请在时间后面写上要执行的指令');
        return { kind: 'recurring', rule: opsSchedule.normalize(recurring.rule), instruction };
    }
    const once = parseOnce(text, now, zone);
    if (!once) throw parseError('没认出时间。支持如「10分钟后」「明天 9:00」「每天 9:00」「每周一 9:00」「每隔 2 小时」');
    const instruction = remainder(text, once.consumed);
    if (!instruction) throw parseError('请在时间后面写上要执行的指令');
    return { kind: 'once', runAt: checkOnce(once.runAt, now), instruction };
}

/** 周期规则在用户时区下的下一次时间（工作日沿用平台工作日历）。 */
function nextRecurring(rule, from, timezone, workdays) {
    return opsSchedule.nextRun(rule, from, { timezone, ...(workdays ? { workdays } : {}) });
}

function describe(schedule) {
    if (schedule.kind === 'recurring') return opsSchedule.describe(schedule.rule);
    return '一次性';
}

module.exports = { parse, nextRecurring, describe, toNumber, MIN_INTERVAL };
