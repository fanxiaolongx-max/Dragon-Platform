// 运营计划的定时规则（纯函数，便于测试）。时区与工作日沿用跟进任务的工作日历（默认埃及：周日到周四、开罗时间）。
//   daily    每天 times 中的各个时刻；workdaysOnly=true 时只在工作日
//   weekly   每周 weekdays（0=周日）的 times 时刻
//   interval 每隔 intervalMinutes 分钟；workdaysOnly=true 时顺延到下一个工作时段
const followupSchedule = require('./followup-schedule');

const TYPES = ['daily', 'weekly', 'interval'];
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MIN_INTERVAL = 30;
const MAX_INTERVAL = 7 * 1440;

function parseTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalize(input = {}) {
    const type = TYPES.includes(input.type) ? input.type : 'daily';
    const times = [...new Set((Array.isArray(input.times) ? input.times : [input.times]).map(parseTime).filter(Boolean))].sort().slice(0, 12);
    const weekdays = [...new Set((Array.isArray(input.weekdays) ? input.weekdays : []).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
    const interval = Math.round(Number(input.intervalMinutes) || 0);
    return {
        type,
        times: times.length ? times : ['09:30'],
        weekdays: type === 'weekly' && !weekdays.length ? [0] : weekdays,
        workdaysOnly: input.workdaysOnly !== false,
        intervalMinutes: type === 'interval' ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, interval || 1440)) : null
    };
}

function toMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

/** 下一次运行时间（严格晚于 from）；找不到时返回 null。 */
function nextRun(input, from = new Date(), calendar = followupSchedule.DEFAULT_CALENDAR) {
    const rule = normalize(input);
    const cal = followupSchedule.normalizeCalendar(calendar);
    if (rule.type === 'interval') {
        const next = new Date(from.getTime() + rule.intervalMinutes * 60000);
        return rule.workdaysOnly ? followupSchedule.alignToWindow(next, cal, false) : next;
    }
    const today = followupSchedule.zoneParts(from, cal.timezone);
    for (let offset = 0; offset <= 14; offset += 1) {
        const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
        const weekday = date.getUTCDay();
        const allowed = rule.type === 'weekly' ? rule.weekdays.includes(weekday) : (!rule.workdaysOnly || cal.workdays.includes(weekday));
        if (!allowed) continue;
        for (const time of rule.times) {
            const at = followupSchedule.fromZone(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), toMinutes(time), cal.timezone);
            if (at.getTime() > from.getTime()) return at;
        }
    }
    return null;
}

function describe(input) {
    const rule = normalize(input);
    if (rule.type === 'interval') {
        const minutes = rule.intervalMinutes;
        const span = minutes % 1440 === 0 ? `${minutes / 1440} 天` : (minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`);
        return `每隔 ${span}${rule.workdaysOnly ? '（仅工作时段）' : ''}`;
    }
    const times = rule.times.join('、');
    if (rule.type === 'weekly') return `每${rule.weekdays.map(day => WEEKDAY_NAMES[day]).join('、')} ${times}`;
    return `${rule.workdaysOnly ? '每个工作日' : '每天'} ${times}`;
}

module.exports = { TYPES, normalize, nextRun, describe, parseTime };
