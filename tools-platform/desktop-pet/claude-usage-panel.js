'use strict';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CHINESE_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function panelResetAt(detail, weekly, now) {
    if (typeof detail !== 'string') return null;
    const zh = /^(?:(?:周|星期)([日天一二三四五六])\s*)?(上午|下午)?\s*(\d{1,2}):(\d{2})\s*重置$/.exec(detail.trim());
    const en = /^Resets?\s+(?:(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)[, ]+)?(?:at\s+)?(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(detail.trim());
    if (!zh && !en) return null;

    const day = zh ? CHINESE_WEEKDAYS.indexOf(zh[1] === '天' ? '日' : zh[1]) :
        WEEKDAYS.indexOf(en[1]?.slice(0, 3).toLowerCase());
    const meridiem = zh ? ({ 上午: 'AM', 下午: 'PM' })[zh[2]] : en[4]?.toUpperCase();
    let hour = Number(zh ? zh[3] : en[2]);
    const minute = Number(zh ? zh[4] : en[3]);
    if (weekly !== (day >= 0) || hour > 23 || minute > 59) return null;
    if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
    }

    const reset = new Date(now);
    reset.setHours(hour, minute, 0, 0);
    if (weekly) reset.setDate(reset.getDate() + (day - reset.getDay() + 7) % 7);
    if (reset.getTime() <= now) reset.setDate(reset.getDate() + (weekly ? 7 : 1));
    // The 5-hour clock is shown to minute precision. Reject stale or ambiguous times.
    if (!weekly && reset.getTime() - now > 5 * 3600000) return null;
    return reset.toISOString();
}

function panelUsageData(panel, now = Date.now()) {
    const data = { subscription_type: panel?.plan };
    for (const key of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) {
        const reading = panel?.readings?.[key];
        if (!Number.isFinite(reading?.usedPercent) || reading.usedPercent < 0 || reading.usedPercent > 100) continue;
        data[key] = { utilization: reading.usedPercent, resets_at: panelResetAt(reading.detail, key !== 'five_hour', now) };
    }

    const credits = panel?.readings?.extra_usage;
    const amounts = /^(?:已用 (?:US\$|USD\s*)([\d,.]+)\s*[，,]\s*共 (?:US\$|USD\s*)([\d,.]+)|(?:US\$|USD\s*)([\d,.]+)\s*(?:of|\/)\s*(?:US\$|USD\s*)([\d,.]+) used)$/i.exec(credits?.detail || '');
    if (amounts) {
        const [used, limit] = (amounts[1] ? amounts.slice(1, 3) : amounts.slice(3, 5))
            .map(value => Math.round(Number(value.replace(/,/g, '')) * 100));
        if (Number.isSafeInteger(used) && Number.isSafeInteger(limit) && used >= 0 && limit > 0) {
            data.extra_usage = { used_credits: used, monthly_limit: limit, currency: 'USD' };
        }
    }
    return data;
}

module.exports = { panelUsageData };
