// 跟进任务的提醒时间计算（纯函数，便于测试）。
// - 工作日历默认埃及：周日到周四、开罗时间 09:00–18:00；
// - 紧急任务允许非工作日跟进，但只在每天 09:00–21:00 之间，避免深夜打扰；
// - 以「天」为单位的间隔落在第 N 个工作日的上午，以「分钟/小时」为单位的间隔顺延到下一个可提醒窗口。

const URGENCIES = ['low', 'normal', 'high', 'urgent'];
const MODES = ['auto', 'interval', 'random'];
const DAY = 1440;

const DEFAULT_CALENDAR = {
    timezone: 'Africa/Cairo',
    workdays: [0, 1, 2, 3, 4], // 0 = 周日
    workStart: '09:00',
    workEnd: '18:00',
    urgentStart: '09:00',
    urgentEnd: '21:00',
    morning: '10:00'
};

// AI 未给出频率时，按紧急度决定间隔（分钟）
const AUTO_INTERVAL = { urgent: 120, high: DAY, normal: 2 * DAY, low: 5 * DAY };

function minutesOf(value, fallback) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return minutesOf(fallback, '09:00');
    return Math.min(24 * 60, Number(match[1]) * 60 + Number(match[2]));
}

function normalizeCalendar(input = {}) {
    const workdays = Array.isArray(input.workdays) ? [...new Set(input.workdays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))] : null;
    const timezone = typeof input.timezone === 'string' && isValidZone(input.timezone) ? input.timezone : DEFAULT_CALENDAR.timezone;
    const time = (key) => (/^\d{1,2}:\d{2}$/.test(String(input[key] || '')) ? String(input[key]) : DEFAULT_CALENDAR[key]);
    const calendar = {
        timezone,
        workdays: workdays && workdays.length ? workdays.sort() : DEFAULT_CALENDAR.workdays.slice(),
        workStart: time('workStart'),
        workEnd: time('workEnd'),
        urgentStart: time('urgentStart'),
        urgentEnd: time('urgentEnd'),
        morning: time('morning')
    };
    if (minutesOf(calendar.workEnd) <= minutesOf(calendar.workStart)) Object.assign(calendar, { workStart: DEFAULT_CALENDAR.workStart, workEnd: DEFAULT_CALENDAR.workEnd });
    if (minutesOf(calendar.urgentEnd) <= minutesOf(calendar.urgentStart)) Object.assign(calendar, { urgentStart: DEFAULT_CALENDAR.urgentStart, urgentEnd: DEFAULT_CALENDAR.urgentEnd });
    return calendar;
}

function isValidZone(zone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

const formatters = new Map();
function zoneParts(date, timezone) {
    if (!formatters.has(timezone)) {
        formatters.set(timezone, new Intl.DateTimeFormat('en-US', {
            timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
        }));
    }
    const parts = Object.fromEntries(formatters.get(timezone).formatToParts(date).map(part => [part.type, part.value]));
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        minutes: Number(parts.hour) * 60 + Number(parts.minute),
        weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
        seconds: Number(parts.second)
    };
}

// 时区内某日某分钟 → UTC 时间。偏移量（含夏令时）迭代两次求得。
function fromZone(year, month, day, minutes, timezone) {
    const naive = Date.UTC(year, month - 1, day, 0, minutes);
    let guess = naive;
    for (let i = 0; i < 2; i += 1) {
        const parts = zoneParts(new Date(guess), timezone);
        const shown = Date.UTC(parts.year, parts.month - 1, parts.day, 0, parts.minutes);
        guess += naive - shown;
    }
    return new Date(guess);
}

// 时区内的日期加减 n 天（按日历日，不受夏令时影响）
function addDays(parts, days) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
}

function windowFor(calendar, offHours) {
    return offHours
        ? { days: [0, 1, 2, 3, 4, 5, 6], start: minutesOf(calendar.urgentStart), end: minutesOf(calendar.urgentEnd) }
        : { days: calendar.workdays, start: minutesOf(calendar.workStart), end: minutesOf(calendar.workEnd) };
}

/** 把时间顺延到最近的可提醒时刻（已在窗口内则原样返回）。 */
function alignToWindow(date, calendar, offHours = false) {
    const cal = normalizeCalendar(calendar);
    const win = windowFor(cal, offHours);
    const parts = zoneParts(date, cal.timezone);
    if (win.days.includes(parts.weekday) && parts.minutes >= win.start && parts.minutes < win.end) return new Date(date.getTime());
    for (let offset = 0; offset <= 8; offset += 1) {
        const day = addDays(parts, offset);
        if (!win.days.includes(day.weekday)) continue;
        if (offset === 0 && parts.minutes >= win.start) continue;
        return fromZone(day.year, day.month, day.day, win.start, cal.timezone);
    }
    return new Date(date.getTime());
}

/** 从 from 起往后数 n 个可提醒日，落在该日上午（不早于窗口开始）。 */
function nthDayMorning(from, days, calendar, offHours) {
    const cal = normalizeCalendar(calendar);
    const win = windowFor(cal, offHours);
    const morning = Math.min(Math.max(minutesOf(cal.morning), win.start), win.end - 1);
    const parts = zoneParts(from, cal.timezone);
    let counted = 0;
    for (let offset = 1; offset <= days * 3 + 8; offset += 1) {
        const day = addDays(parts, offset);
        if (!win.days.includes(day.weekday)) continue;
        counted += 1;
        if (counted >= days) return fromZone(day.year, day.month, day.day, morning, cal.timezone);
    }
    return new Date(from.getTime() + days * DAY * 60000);
}

function intervalFor(task, random = Math.random) {
    const mode = MODES.includes(task.scheduleMode) ? task.scheduleMode : 'auto';
    if (mode === 'interval' && Number(task.intervalMinutes) > 0) return Math.max(15, Math.round(Number(task.intervalMinutes)));
    if (mode === 'random') {
        const min = Math.max(15, Number(task.randomMinMinutes) || 60);
        const max = Math.max(min, Number(task.randomMaxMinutes) || min * 3);
        return Math.round(min + (max - min) * random());
    }
    return AUTO_INTERVAL[URGENCIES.includes(task.urgency) ? task.urgency : 'normal'];
}

/** 紧急任务默认允许非工作日跟进；其他紧急度按任务上的显式设置。 */
function allowsOffHours(task) {
    if (task.allowOffHours === true || task.allowOffHours === 1) return true;
    if (task.allowOffHours === false || task.allowOffHours === 0) return false;
    return task.urgency === 'urgent';
}

/**
 * 计算下一次提醒时间。
 * @param {object} task urgency / scheduleMode / intervalMinutes / randomMinMinutes / randomMaxMinutes / allowOffHours
 * @param {Date} from 起算时间（创建或上次提醒的时间）
 * @param {object} [calendar]
 * @param {() => number} [random] 随机模式的随机源（测试注入）
 */
function nextReminder(task, from = new Date(), calendar = DEFAULT_CALENDAR, random = Math.random) {
    const offHours = allowsOffHours(task);
    const minutes = intervalFor(task, random);
    if (minutes >= DAY && minutes % DAY === 0 && task.scheduleMode !== 'random') {
        return nthDayMorning(from, minutes / DAY, calendar, offHours);
    }
    return alignToWindow(new Date(from.getTime() + minutes * 60000), calendar, offHours);
}

function describeInterval(task) {
    const mode = MODES.includes(task.scheduleMode) ? task.scheduleMode : 'auto';
    if (mode === 'random') return `随机（${task.randomMinMinutes || 60}–${task.randomMaxMinutes || (task.randomMinMinutes || 60) * 3} 分钟）`;
    const minutes = intervalFor(task, () => 0);
    const text = minutes % DAY === 0 ? `每 ${minutes / DAY} 个工作日` : minutes % 60 === 0 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`;
    return `${mode === 'auto' ? '按紧急度 · ' : ''}${text}${allowsOffHours(task) ? '（含非工作日）' : ''}`;
}

/** 当前时间在该时区的可读文本，例如「2026-10-20 周二 14:05（Africa/Cairo）」。 */
function describeNow(date = new Date(), calendar = DEFAULT_CALENDAR) {
    const cal = normalizeCalendar(calendar);
    const parts = zoneParts(date, cal.timezone);
    const pad = value => String(value).padStart(2, '0');
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} 周${'日一二三四五六'[parts.weekday]} ${pad(Math.floor(parts.minutes / 60))}:${pad(parts.minutes % 60)}（${cal.timezone}）`;
}

module.exports = {
    URGENCIES,
    MODES,
    DEFAULT_CALENDAR,
    AUTO_INTERVAL,
    normalizeCalendar,
    zoneParts,
    fromZone,
    alignToWindow,
    nextReminder,
    allowsOffHours,
    describeInterval,
    describeNow
};
