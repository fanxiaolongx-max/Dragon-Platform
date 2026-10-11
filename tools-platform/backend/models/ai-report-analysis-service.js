const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { getReportDataDir } = require('./report-store');
const { getDataDir } = require('./store');

const getReportDbPath = () => path.join(getReportDataDir(), 'report.db');
const getToolsDbPath = () => path.join(getDataDir(), 'tools.db');
const MAX_METRIC_ROWS = 5000;
const MAX_HISTORY_POINTS = 62;
const DATA_SCOPE_RE = /报表|月报|指标|目标|得分|排名|趋势|差距|gap|快照|客户群|合规率|运营|异常|短板|(?:20\d{2}\s*年\s*)?\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?(?:的)?数据/i;
const DATA_ACTION_RE = /当前|最新|本月|上月|未达标|达标|多少|哪些|怎么样|如何|情况|现状|表现|分析|总结|对比|变化|下降|上升|改善|异常|排名|趋势|差距|gap|(?:20\d{2}[-/.])?(?:1[0-2]|0?[1-9])\s*月/i;
const IMPLEMENTATION_QUESTION_RE = /怎么实现|代码|文件|接口|(?:api|后端|前端)\s*路由|路由(?:实现|代码|文件|配置|定义)|数据源|存在哪|读取逻辑|计算逻辑/i;
const TARGET_CONFIG_QUESTION_RE = /(?:\d{1,2}\s*月|每(?:个)?月|分月|月度).{0,12}(?:目标|阈值|要求)|(?:目标|阈值|要求).{0,12}(?:\d{1,2}\s*月|每(?:个)?月|分月|月度)|目标值|目标配置|预警配置/i;
const PERFORMANCE_QUESTION_RE = /实际|当前(?:值|实际|多少|为|是)|完成值|达标情况|未达标|得分|差距|趋势|快照|入库|报表|月报/i;
const METRIC_HISTORY_QUESTION_RE = /最近|近\s*(?:\d+|几|两|三|四|五|六|七|八|九|十)?\s*次|历次|历史.{0,8}(?:快照|指标|数值)|每次快照|逐次|变化|趋势/i;
const METRIC_DISCOVERY_QUESTION_RE = /(?:随便|任意|随机|帮我)?\s*(?:找|挑|选|举|看)\s*(?:一|个|一个)?[^\n。，,]{0,10}(?:有值|有数据|实际值)?[^\n。，,]{0,6}指标|(?:随便|任意|随机).{0,12}指标|找个有值的指标/i;
const MANUAL_ADJUST_QUESTION_RE = /手动加减分|人工加减分|人工调整|手工调整|发生次数|加分项目|扣分项目|实际(?:加|扣)分|加分|扣分/i;
const MANUAL_ADJUST_RANKING_RE = /(?:哪个|哪些|哪项).{0,12}(?:加分|扣分).{0,12}(?:最多|最少|频繁|最高|最低|排行)|(?:加分|扣分).{0,12}(?:哪个|哪些|哪项).{0,12}(?:最多|最少|频繁|最高|最低)|(?:加分|扣分).{0,8}(?:频率|排行|排名)/i;
const MANUAL_ADJUST_HISTORY_RE = /(?:最近|近)\s*(?:\d+|几|两|三|四|五|六|七|八|九|十)\s*(?:次|天)|历次|历史|逐次|趋势|变化/i;

function openReadOnlyDb() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(getReportDbPath())) return resolve(null);
        const db = new sqlite3.Database(getReportDbPath(), sqlite3.OPEN_READONLY, error => {
            if (error) return reject(error);
            resolve(db);
        });
    });
}

function openReadOnlyToolsDb() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(getToolsDbPath())) return resolve(null);
        const db = new sqlite3.Database(getToolsDbPath(), sqlite3.OPEN_READONLY, error => {
            if (error) return reject(error);
            resolve(db);
        });
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

function closeDb(db) {
    return new Promise(resolve => {
        if (!db) return resolve();
        db.close(() => resolve());
    });
}

function parseRequestedMonth(question) {
    const text = String(question || '');
    const explicit = text.match(/(?:^|[^\d])(?:20\d{2}\s*(?:年|[-/.])\s*)?(1[0-2]|0?[1-9])\s*月/);
    if (explicit) return Number(explicit[1]);
    const iso = text.match(/20\d{2}[-/.](1[0-2]|0[1-9])(?:\D|$)/);
    return iso ? Number(iso[1]) : null;
}

function parseRequestedDate(question) {
    const text = String(question || '');
    const chinese = text.match(/(?:(20\d{2})\s*年\s*)?(1[0-2]|0?[1-9])\s*月\s*(3[01]|[12]\d|0?[1-9])\s*日?/);
    const iso = text.match(/(20\d{2})[-/.](1[0-2]|0[1-9])[-/.](3[01]|[12]\d|0[1-9])(?:\D|$)/);
    const match = chinese || iso;
    if (!match) return null;
    const year = Number(match[1]) || new Date().getFullYear();
    const month = Number(match[2]);
    const day = Number(match[3]);
    const value = new Date(Date.UTC(year, month - 1, day));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shouldAnalyze(question) {
    const text = String(question || '');
    // A target-definition question belongs to the live SLA configuration store,
    // not to report snapshots. Only retain report analysis when the user also asks
    // about actual performance, scoring, or historical snapshots.
    if (TARGET_CONFIG_QUESTION_RE.test(text) && !PERFORMANCE_QUESTION_RE.test(text)) return false;
    if (MANUAL_ADJUST_QUESTION_RE.test(text)
        && (DATA_ACTION_RE.test(text) || MANUAL_ADJUST_RANKING_RE.test(text))) return true;
    if (!DATA_SCOPE_RE.test(text)) return false;
    if (METRIC_DISCOVERY_QUESTION_RE.test(text)) return true;
    if (IMPLEMENTATION_QUESTION_RE.test(text) && !DATA_ACTION_RE.test(text)) return false;
    return DATA_ACTION_RE.test(text);
}

function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const scale = 10 ** digits;
    return Math.round(number * scale) / scale;
}

function isMissingMetricValue(value) {
    return /^(?:|--|-|n\/?a|null|undefined)$/i.test(String(value ?? '').trim());
}

function parseRequestedHistoryCount(question) {
    const text = String(question || '');
    if (/整月|全月|整个(?:月|月份)|月内全部|逐日|每一天|每日/i.test(text)) return 31;
    const match = text.match(/(?:最近|近)\s*(\d{1,2}|几|两|三|四|五|六|七|八|九|十)\s*次/);
    if (!match) return 6;
    const wordNumbers = { 几: 6, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const count = Number(match[1]) || wordNumbers[match[1]] || 6;
    return Math.max(2, Math.min(MAX_HISTORY_POINTS, count));
}

function metricValueNumber(value) {
    if (isMissingMetricValue(value)) return null;
    const normalized = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return normalized ? finiteOrNull(normalized[0]) : null;
}

function buildMetricStats(metrics) {
    const total = metrics.length;
    const failing = metrics.filter(item => Number(item.is_failing) === 1);
    return {
        totalMetrics: total,
        failingMetrics: failing.length,
        passingMetrics: Math.max(0, total - failing.length),
        complianceRate: total ? round(((total - failing.length) / total) * 100) : null
    };
}

function numericMagnitude(value) {
    const matched = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return matched ? Math.abs(Number(matched[0])) : 0;
}

function getManualMetricLabels(snapshot) {
    const raw = parseSnapshotRaw(snapshot);
    return new Set((Array.isArray(raw.topMetrics) ? raw.topMetrics : [])
        .filter(item => item && (
            item.isManual === true
            || String(item.id || '').startsWith('manual_m_')
            || item.colX === '手动指标'
            || item.colZ === '手动指标'
        ))
        .map(item => String(item.label || '').trim())
        .filter(Boolean));
}

function buildProactiveAlertCandidates(metrics = [], limit = 12) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 12));
    const seen = new Set();
    return metrics
        .filter(item => Number(item?.is_failing) === 1 && item.metric_label && item.cat_name)
        .map(item => ({
            kind: 'kpi',
            customerGroup: String(item.cat_name).trim(),
            metric: String(item.metric_label).trim(),
            target: String(item.target_val ?? '').trim(),
            actual: String(item.raw_val ?? '').trim(),
            gap: String(item.gap ?? '').trim(),
            weight: finiteOrNull(item.weight),
            earnedScore: finiteOrNull(item.earned_score),
            completionRatio: finiteOrNull(item.completion_ratio),
            sourceType: item.is_manual ? 'manual' : 'imported',
            priority: (item.is_manual ? 0 : 1000000)
                + (Number(item.weight) || 0) * 1000
                + numericMagnitude(item.gap) * 10
                + Math.max(0, 1 - (Number(item.completion_ratio) || 0))
        }))
        .sort((a, b) => b.priority - a.priority
            || a.metric.localeCompare(b.metric, 'zh-CN')
            || a.customerGroup.localeCompare(b.customerGroup, 'zh-CN'))
        .filter(item => {
            // 同一指标可能有多个未达标客户群，预警只选优先级最高的一个代表。
            const key = item.metric;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, safeLimit)
        .map(({ priority, ...item }) => item);
}

const PROACTIVE_TASK_TYPE_LABELS = {
    rectification: '整改',
    risk: '风险',
    special: '专项',
    sr: 'SR',
    vulnerability: '漏洞'
};

function cleanProactiveTaskText(value, fallback) {
    return String(value || fallback || '').replace(/^[\s🔧🧯📞⚠️⭐]+/u, '').replace(/\s*合集\s*$/, '').trim();
}

function getProactiveTaskOwner(ticket) {
    const data = ticket && ticket.data && typeof ticket.data === 'object' ? ticket.data : {};
    const owner = data.fullname || data.cur_assignee || data.task_owner || data.sr_owner || data.owner
        || data.owner_name || data.handler || data.assignee || data.responsible_person
        || data['责任人'] || data['负责人'] || data['当前处理人'];
    return cleanProactiveTaskText(owner, '未明确负责人');
}

function buildProactiveTaskCandidates(tickets = [], limit = 12) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 12));
    const grouped = new Map();
    tickets.forEach(ticket => {
        const days = Number(ticket && ticket._slaDays);
        if (!Number.isFinite(days) || days < 0 || days > 7) return;
        const collection = String(ticket.collection || 'other').trim() || 'other';
        const taskType = cleanProactiveTaskText(ticket.title, PROACTIVE_TASK_TYPE_LABELS[collection] || '临期任务');
        const owner = getProactiveTaskOwner(ticket);
        const key = `${owner}\u0000${taskType}`;
        const current = grouped.get(key) || {
            kind: 'task',
            owner,
            taskType,
            count: 0,
            dueWindowDays: 7,
            nearestDays: days,
            // 兼容尚未刷新、仍按 KPI 字段渲染气泡的旧页面，避免出现 undefined。
            customerGroup: owner,
            metric: `${taskType}类临期任务`,
            actual: '',
            target: '7天内处理'
        };
        current.count += 1;
        current.actual = `${current.count}个`;
        current.nearestDays = Math.min(current.nearestDays, days);
        grouped.set(key, current);
    });
    return [...grouped.values()]
        .sort((a, b) => a.nearestDays - b.nearestDays || b.count - a.count || a.owner.localeCompare(b.owner, 'zh-CN'))
        .slice(0, safeLimit);
}

async function getProactiveAlerts({ limit = 12 } = {}) {
    const db = await openReadOnlyDb();
    if (!db) {
        return { available: false, reason: '报表数据库尚未创建', items: [] };
    }
    try {
        const snapshot = await dbGet(
            db,
            `SELECT id, snapshot_id, month, created_at, stored_at, raw_data_json
             FROM ReportSnapshots ORDER BY id DESC LIMIT 1`
        );
        if (!snapshot) return { available: false, reason: '尚无入库报表', items: [] };
        const manualMetricLabels = getManualMetricLabels(snapshot);
        const rows = await dbAll(
            db,
            `SELECT cat_name, metric_label, weight, target_val, raw_val, is_failing,
                    gap, earned_score, completion_ratio
             FROM ReportMetricData
             WHERE snapshot_id = ? AND (month = ? OR month IS NULL) AND is_failing = 1
             LIMIT ?`,
            [snapshot.snapshot_id, snapshot.month, MAX_METRIC_ROWS]
        );
        const sourceAwareRows = rows.map(item => ({
            ...item,
            is_manual: manualMetricLabels.has(String(item.metric_label || '').trim())
        }));
        const raw = parseSnapshotRaw(snapshot);
        const taskItems = buildProactiveTaskCandidates(Array.isArray(raw.expiringTickets) ? raw.expiringTickets : [], limit);
        const kpiItems = buildProactiveAlertCandidates(sourceAwareRows, limit);
        return {
            available: true,
            snapshot: {
                snapshotId: snapshot.snapshot_id,
                month: snapshot.month,
                createdAt: snapshot.created_at,
                storedAt: snapshot.stored_at || null
            },
            totalFailing: rows.length,
            totalExpiringSoon: taskItems.reduce((sum, item) => sum + item.count, 0),
            items: [...taskItems, ...kpiItems],
            selectionRule: '未来 7 天临期任务与 KPI 提醒交替穿插；KPI 内优先数据导入指标，手动录入指标仅作为后备。',
            source: 'data/report.db: ReportSnapshots, ReportMetricData',
            readOnly: true
        };
    } finally {
        await closeDb(db);
    }
}

async function enrichProactiveAlertWithDeepContext(items = [], options = {}) {
    const db = await openReadOnlyDb();
    if (!db) {
        return { available: false, kpiDetails: [], taskDetails: [] };
    }
    try {
        const snapshotId = options.snapshotId;
        let latest = null;
        if (snapshotId) {
            latest = await dbGet(db, `SELECT id, snapshot_id, month, created_at, stored_at, raw_data_json FROM ReportSnapshots WHERE snapshot_id = ? ORDER BY id DESC LIMIT 1`, [snapshotId]);
        }
        if (!latest) {
            latest = await dbGet(db, `SELECT id, snapshot_id, month, created_at, stored_at, raw_data_json FROM ReportSnapshots ORDER BY id DESC LIMIT 1`);
        }
        if (!latest) return { available: false, kpiDetails: [], taskDetails: [] };

        const histSnapshots = await dbAll(
            db,
            `SELECT s.id, s.snapshot_id, s.month, s.created_at, s.raw_data_json
             FROM ReportSnapshots s
             ORDER BY s.id DESC LIMIT 6`
        );
        const prevSnapshots = histSnapshots.filter(s => s.snapshot_id !== latest.snapshot_id);

        const safeItems = Array.isArray(items) ? items : [];
        const kpiItems = safeItems.filter(it => it && it.kind !== 'task');
        const taskItems = safeItems.filter(it => it && it.kind === 'task');

        const kpiDetails = [];
        const taskDetails = [];

        for (const item of kpiItems) {
            const metric = String(item.metric || '').trim();
            const customerGroup = String(item.customerGroup || '').trim();
            if (!metric) continue;

            const currentRows = await dbAll(
                db,
                `SELECT cat_name, raw_val, num_val, target_val, is_failing, gap, earned_score, weight
                 FROM ReportMetricData
                 WHERE snapshot_id = ? AND metric_label = ?
                 ORDER BY cat_name`,
                [latest.snapshot_id, metric]
            );
            const allGroups = currentRows.map(r => ({
                customerGroup: r.cat_name,
                actual: r.raw_val,
                target: r.target_val,
                isFailing: Boolean(Number(r.is_failing) === 1),
                gap: r.gap
            }));
            const failingGroups = allGroups.filter(g => g.isFailing);
            const passingGroups = allGroups.filter(g => !g.isFailing);
            const onlyFailingGroup = failingGroups.length === 1 && failingGroups[0].customerGroup === customerGroup;

            const histRows = await dbAll(
                db,
                `SELECT s.id, s.snapshot_id, s.month, s.created_at, m.cat_name, m.raw_val, m.num_val, m.target_val, m.is_failing, m.gap
                 FROM ReportSnapshots s
                 JOIN ReportMetricData m ON m.snapshot_id = s.snapshot_id
                 WHERE m.metric_label = ? AND m.cat_name = ?
                 ORDER BY s.id DESC LIMIT 6`,
                [metric, customerGroup]
            );

            let history = null;
            if (histRows.length > 1) {
                const prev = histRows[1];
                const currentNum = metricValueNumber(item.actual);
                const prevNum = metricValueNumber(prev.raw_val);
                const delta = (currentNum !== null && prevNum !== null) ? round(currentNum - prevNum) : null;
                const turnedFailing = Number(prev.is_failing) === 0 && Number(item.is_failing ?? 1) === 1;
                const continuousFailing = Number(prev.is_failing) === 1 && Number(item.is_failing ?? 1) === 1;
                history = {
                    prevSnapshotId: prev.snapshot_id,
                    prevMonth: prev.month,
                    prevCreatedAt: prev.created_at,
                    prevVal: prev.raw_val,
                    prevTarget: prev.target_val,
                    prevFailing: Boolean(Number(prev.is_failing) === 1),
                    delta,
                    turnedFailing,
                    continuousFailing,
                    points: histRows.map(r => ({
                        month: r.month,
                        createdAt: r.created_at,
                        actual: r.raw_val,
                        target: r.target_val,
                        isFailing: Number(r.is_failing) === 1,
                        gap: r.gap
                    }))
                };
            }

            kpiDetails.push({
                kind: 'kpi',
                metric,
                customerGroup,
                actual: item.actual,
                target: item.target,
                gap: item.gap,
                weight: item.weight,
                allGroups,
                failingGroups,
                passingGroups,
                onlyFailingGroup,
                history
            });
        }

        for (const item of taskItems) {
            const owner = String(item.owner || '').trim();
            const taskType = String(item.taskType || '').trim();
            if (!owner) continue;

            const rawLatest = parseSnapshotRaw(latest);
            const tickets = Array.isArray(rawLatest.expiringTickets) ? rawLatest.expiringTickets : [];
            const matchedTickets = tickets.filter(t => {
                const o = getProactiveTaskOwner(t);
                const type = cleanProactiveTaskText(t.title, PROACTIVE_TASK_TYPE_LABELS[t.collection] || '临期任务');
                return o === owner && (!taskType || type === taskType || t.title?.includes(taskType));
            });

            const productLines = [...new Set(matchedTickets.map(t => t.data?.product_line_name || t.data?.itr_product_line_name).filter(Boolean))];
            const regions = [...new Set(matchedTickets.map(t => t.data?.region_cn_name || t.data?.country_cn_name || t.data?.repoffice_cn_name).filter(Boolean))];
            const slaDaysList = matchedTickets.map(t => Number(t._slaDays)).filter(Number.isFinite);
            const nearestDays = slaDaysList.length ? Math.min(...slaDaysList) : item.nearestDays || 1;

            let prevCount = null;
            if (prevSnapshots.length) {
                const rawPrev = parseSnapshotRaw(prevSnapshots[0]);
                const prevTickets = Array.isArray(rawPrev.expiringTickets) ? rawPrev.expiringTickets : [];
                const prevMatched = prevTickets.filter(t => getProactiveTaskOwner(t) === owner);
                prevCount = prevMatched.length;
            }

            taskDetails.push({
                kind: 'task',
                owner,
                taskType,
                count: matchedTickets.length || item.count,
                nearestDays,
                productLines,
                regions,
                prevCount
            });
        }

        return {
            available: true,
            snapshot: {
                snapshotId: latest.snapshot_id,
                month: latest.month,
                createdAt: latest.created_at
            },
            kpiDetails,
            taskDetails
        };
    } finally {
        await closeDb(db);
    }
}

function normalizeProactiveAiAnalysis(result) {
    const finishReason = String(result?.finishReason || '').toLowerCase();
    // Providers report exhausted generation budgets differently. Never present
    // their partial output as a completed analysis, even if it ends a sentence.
    if (finishReason && !['stop', 'end_turn', 'stop_sequence'].includes(finishReason)) {
        throw new Error('AI 预警分析未完整生成');
    }
    const message = String(result?.text || '').replace(/\s+/g, ' ').trim();
    // Some compatible providers omit finishReason; also catch title-only and
    // mid-sentence responses. Reject oversized output rather than slicing it.
    if (Array.from(message).length < 40 || message.length > 1200
        || !/[。！？.!?][”’"')）\]]*$/.test(message)) {
        throw new Error('AI 预警分析内容不完整');
    }
    return message;
}

function generateRuleBasedDeepAnalysis(enrichedContext, language = 'zh') {
    const isEn = String(language).toLowerCase().startsWith('en');
    const { kpiDetails, taskDetails } = enrichedContext || {};
    if (kpiDetails && kpiDetails.length) {
        const primary = kpiDetails[0];
        const history = primary.history;
        const parts = [];
        if (history && history.prevVal !== null && history.prevVal !== undefined) {
            const deltaText = history.delta !== null
                ? (history.delta < 0 ? `环比下降${Math.abs(history.delta)}%` : history.delta > 0 ? `环比回升${history.delta}%` : '与上期持平')
                : `上期快照为${history.prevVal}`;
            const statusText = history.turnedFailing ? '由达标转降' : history.continuousFailing ? '持续未达标' : '';
            parts.push(`【趋势对比】${primary.customerGroup}「${primary.metric}」当前${primary.actual}（目标${primary.target}），较上期快照（${history.prevVal}）${deltaText}${statusText ? `且${statusText}` : ''}，差距${primary.gap}。`);
        } else {
            parts.push(`【现状诊断】${primary.customerGroup}「${primary.metric}」当前实际${primary.actual}，目标${primary.target}，差距${primary.gap}。`);
        }
        if (primary.allGroups && primary.allGroups.length > 1) {
            if (primary.onlyFailingGroup) {
                const passSample = primary.passingGroups.slice(0, 2).map(g => `${g.customerGroup}${g.actual}`).join('、');
                parts.push(`【归因分析】细分维度显示${primary.customerGroup}为唯一落后短板，其余客户群（${passSample}）均已达标。`);
            } else {
                const failSample = primary.failingGroups.slice(0, 3).map(g => `${g.customerGroup}(${g.actual})`).join('、');
                parts.push(`【归因分析】多客户群承压，未达标项含${failSample}，存在全局性推进阻力。`);
            }
        }
        parts.push(`【跟进建议】优先聚焦${primary.customerGroup}的不达标断点进行专项调度，锁定闭环节点以拉齐差距。`);
        return parts.join('');
    }
    if (taskDetails && taskDetails.length) {
        const primary = taskDetails[0];
        const parts = [];
        parts.push(`【临期诊断】负责人${primary.owner}未来7天有${primary.count}个${primary.taskType}临期，最紧急任务仅剩${primary.nearestDays}天。`);
        if (primary.productLines && primary.productLines.length) {
            parts.push(`【业务分布】任务主要涉及${primary.productLines.slice(0, 2).join('、')}业务线。`);
        }
        if (primary.prevCount !== null) {
            const diff = primary.count - primary.prevCount;
            parts.push(`【快照对比】较上期快照${diff > 0 ? `新增${diff}个` : diff < 0 ? `消减${Math.abs(diff)}个` : '数量持平'}。`);
        }
        parts.push(`【处置建议】建议今日优先分拨并闭环最短SLA任务，防范超时扣分风险。`);
        return parts.join('');
    }
    return isEn ? 'Deep analysis unavailable.' : '暂无深度分析结果。';
}

function parseSnapshotTopMetrics(snapshot) {
    try {
        const raw = JSON.parse(snapshot?.raw_data_json || '{}');
        return Array.isArray(raw.topMetrics) ? raw.topMetrics : [];
    } catch (_error) {
        return [];
    }
}

function parseSnapshotRaw(snapshot) {
    try {
        const raw = JSON.parse(snapshot?.raw_data_json || snapshot?.payload_json || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch (_error) {
        return {};
    }
}

function normalizeMetricText(value) {
    return String(value || '').toLowerCase().replace(/[\s_\-()（）]/g, '');
}

function metricFamilyBase(value) {
    return normalizeMetricText(value).replace(/20\d{2}$/, '');
}

function metricAsciiAliases(value) {
    return [...new Set(
        String(value || '')
            .toLowerCase()
            .match(/[a-z][a-z0-9]*/g) || []
    )].filter(token => token.length >= 3);
}

function metricChineseAliases(value) {
    const ignored = new Set([
        '指标', '目标', '规则', '次数', '完成', '覆盖', '达标', '整改',
        '业务', '服务', '客户', '项目', '风险', '人员', '订单', '软件', '日志', '月度'
    ]);
    const aliases = new Set();
    // Join Chinese runs separated by an English acronym so that an operator can
    // write "重疾预案" for "重疾EOS预案覆盖率" without losing the match.
    const chineseText = (String(value || '').match(/[\u3400-\u9fff]+/g) || []).join('');
    for (const sequence of chineseText ? [chineseText] : []) {
        for (let start = 0; start < sequence.length - 1; start += 1) {
            for (let end = start + 2; end <= sequence.length; end += 1) {
                const alias = sequence.slice(start, end);
                if (!ignored.has(alias)) aliases.add(alias);
            }
        }
    }
    return [...aliases];
}

function resolveMatchedMetricLabels(labels, question) {
    const query = normalizeMetricText(question);
    if (!query) return { labels: [], mode: 'none', ambiguous: false, candidates: [] };
    const queryYears = new Set(String(question || '').match(/20\d{2}/g) || []);
    const scored = new Map();
    const exactSpans = new Map();
    const add = (label, matchedLength, mode) => {
        const current = scored.get(label);
        if (!current || matchedLength > current.matchedLength) scored.set(label, { label, matchedLength, mode });
    };

    const findSpans = needle => {
        const spans = [];
        let cursor = 0;
        while (needle && (cursor = query.indexOf(needle, cursor)) >= 0) {
            spans.push({ start: cursor, end: cursor + needle.length });
            cursor += Math.max(1, needle.length);
        }
        return spans;
    };

    labels.forEach(label => {
        const normalized = normalizeMetricText(label);
        const familyBase = metricFamilyBase(label);
        const labelYear = String(label).match(/20\d{2}$/)?.[0] || null;
        const spans = findSpans(normalized);
        if (spans.length) {
            exactSpans.set(label, spans);
            add(label, normalized.length, 'exact');
        }
        else if (familyBase.length >= 2 && familyBase !== normalized && query.includes(familyBase)
            && (!queryYears.size || !labelYear || queryYears.has(labelYear))) {
            add(label, familyBase.length, 'year-family');
        }
    });

    // If the user explicitly enumerates overlapping formal names, retain each
    // independent occurrence. Example: "日志回传、日志回传备案、日志稽查".
    // For a single "日志回传备案", the shorter nested "日志回传" remains suppressed.
    const independentExactLabels = [...exactSpans.entries()].filter(([label, spans]) => {
        const labelLength = normalizeMetricText(label).length;
        return spans.some(span => ![...exactSpans.entries()].some(([other, otherSpans]) => {
            if (other === label || normalizeMetricText(other).length <= labelLength) return false;
            return otherSpans.some(otherSpan => otherSpan.start <= span.start && otherSpan.end >= span.end);
        }));
    }).map(([label]) => label);
    if (independentExactLabels.length >= 2) {
        return { labels: independentExactLabels, mode: 'explicit-list', ambiguous: false, candidates: [] };
    }

    const ambiguousGroups = [];
    const collectAliases = (aliasFactory, mode) => {
        const owners = new Map();
        labels.forEach(label => aliasFactory(label).forEach(alias => {
            if (!owners.has(alias)) owners.set(alias, []);
            owners.get(alias).push(label);
        }));
        owners.forEach((ownerLabels, alias) => {
            if (!query.includes(alias)) return;
            if (ownerLabels.length === 1) add(ownerLabels[0], alias.length, mode);
            else ambiguousGroups.push({ alias, labels: ownerLabels, matchedLength: alias.length });
        });
    };
    collectAliases(metricAsciiAliases, 'unique-english-alias');
    collectAliases(metricChineseAliases, 'unique-chinese-alias');

    if (scored.size) {
        const maxLength = Math.max(...[...scored.values()].map(item => item.matchedLength));
        const winners = [...scored.values()].filter(item => item.matchedLength === maxLength);
        return {
            labels: winners.map(item => item.label),
            mode: winners.every(item => item.mode === winners[0].mode) ? winners[0].mode : 'mixed',
            ambiguous: false,
            candidates: []
        };
    }
    if (ambiguousGroups.length) {
        const maxLength = Math.max(...ambiguousGroups.map(item => item.matchedLength));
        const candidates = [...new Set(ambiguousGroups
            .filter(item => item.matchedLength === maxLength)
            .flatMap(item => item.labels))];
        return { labels: [], mode: 'ambiguous-alias', ambiguous: true, candidates };
    }
    return { labels: [], mode: 'none', ambiguous: false, candidates: [] };
}

function findMatchedMetricLabels(labels, question) {
    return resolveMatchedMetricLabels(labels, question).labels;
}

function findMatchedManualAdjustLabels(items, question) {
    const query = normalizeMetricText(question);
    if (!query) return [];
    return [...new Set((items || [])
        .filter(item => item && !item.deleted && String(item.name || '').trim())
        .map(item => String(item.name).trim())
        .filter(label => {
            const normalized = normalizeMetricText(label);
            if (query.includes(normalized)) return true;
            const parts = String(label).split(/[（(\/、]/).map(normalizeMetricText).filter(part => part.length >= 4);
            return parts.some(part => query.includes(part));
        }))];
}

function calcManualAdjustScore(item, count) {
    const unit = Number(item?.unit) || 0;
    const capValue = item?.cap === null || item?.cap === undefined || item?.cap === '' ? null : Number(item.cap);
    const rawScore = Math.max(0, Number(count) || 0) * unit;
    const magnitude = Number.isFinite(capValue) && capValue > 0 ? Math.min(rawScore, capValue) : rawScore;
    if (magnitude === 0) return 0;
    return item?.type === '加分' ? magnitude : -magnitude;
}

function buildManualAdjustmentSnapshot(raw, matchedLabels, metadata, categoryScores = []) {
    const items = Array.isArray(raw?.manualAdjustItems) ? raw.manualAdjustItems : [];
    const adjustData = raw?.manualAdjustData && typeof raw.manualAdjustData === 'object' ? raw.manualAdjustData : {};
    const labels = matchedLabels?.length ? matchedLabels : (MANUAL_ADJUST_QUESTION_RE.test(metadata.question || '')
        ? items.filter(item => item && !item.deleted).map(item => String(item.name || '').trim()).filter(Boolean)
        : []);
    if (!labels.length) return null;
    const customerGroups = [...new Set([
        ...Object.keys(adjustData),
        ...categoryScores.map(item => item.cat_name).filter(Boolean)
    ])];
    const matchedItems = labels.map(label => {
        const index = items.findIndex(item => item && !item.deleted && String(item.name || '').trim() === label);
        if (index < 0) return null;
        const item = items[index];
        const groups = customerGroups.map(customerGroup => {
            const count = Number(adjustData?.[customerGroup]?.[index]) || 0;
            return { customerGroup, count, score: calcManualAdjustScore(item, count) };
        });
        return {
            itemIndex: index,
            name: label,
            type: item.type || null,
            unitScore: finiteOrNull(item.unit),
            scoreCap: item.cap === null || item.cap === undefined || item.cap === '' ? null : finiteOrNull(item.cap),
            description: item.desc || null,
            totalOccurrences: groups.reduce((sum, group) => sum + group.count, 0),
            totalScore: round(groups.reduce((sum, group) => sum + group.score, 0)),
            customerGroups: groups
        };
    }).filter(Boolean);
    if (!matchedItems.length) return null;
    const rankingItem = item => ({
        name: item.name,
        type: item.type,
        totalOccurrences: item.totalOccurrences,
        totalScore: item.totalScore,
        customerGroups: item.customerGroups.filter(group => group.count !== 0 || group.score !== 0)
    });
    const byOccurrences = type => matchedItems
        .filter(item => item.type === type && item.totalOccurrences > 0)
        .sort((a, b) => b.totalOccurrences - a.totalOccurrences
            || Math.abs(b.totalScore) - Math.abs(a.totalScore)
            || a.name.localeCompare(b.name, 'zh-CN'))
        .map(rankingItem);
    return {
        snapshotId: metadata.snapshotId || null,
        month: metadata.month || null,
        snapshotTime: metadata.snapshotTime || null,
        updatedAt: metadata.updatedAt || null,
        state: metadata.state,
        queryMode: MANUAL_ADJUST_RANKING_RE.test(metadata.question || '') ? 'ranking' : 'detail',
        configuredItemCount: items.filter(item => item && !item.deleted).length,
        activeItemCount: matchedItems.filter(item => item.totalOccurrences !== 0 || item.totalScore !== 0).length,
        matchedItems,
        rankings: {
            deductionByOccurrences: byOccurrences('扣分'),
            bonusByOccurrences: byOccurrences('加分'),
            rankingRule: '先按发生次数降序；次数相同时按实际加减分绝对值降序。'
        },
        categorySavedScores: categoryScores.map(item => ({
            customerGroup: item.cat_name,
            manualScore: finiteOrNull(item.manual_score),
            finalScore: finiteOrNull(item.final_score)
        })),
        scoreBasis: metadata.state === 'live-current'
            ? '当前快照已保存发生次数 × 当前快照对应项目规则（与报表页面显示口径一致）'
            : '历史入库快照中保存的发生次数与当时项目规则；客户群汇总分使用入库时保存值',
        readOnly: true
    };
}

async function loadLiveManualAdjustmentContext(question, requestedMonth = null) {
    const db = await openReadOnlyToolsDb();
    if (!db) return null;
    try {
        const [snapshot, prefRow] = await Promise.all([
            dbGet(db, `SELECT id, timestamp, updated_at, payload_json
                       FROM sla_snapshots ORDER BY datetime(timestamp) DESC, id DESC LIMIT 1`),
            dbGet(db, `SELECT payload_json, updated_at FROM sla_prefs WHERE pref_key = 'manualAdjustItems'`)
        ]);
        if (!snapshot || !prefRow) return null;
        const raw = parseSnapshotRaw(snapshot);
        const items = JSON.parse(prefRow.payload_json || '[]');
        raw.manualAdjustItems = Array.isArray(items) ? items : [];
        const month = Number(raw.selectedTargetMonth || raw.targetMonth || requestedMonth) || null;
        if (requestedMonth && month && requestedMonth !== month) return null;
        const matchedLabels = findMatchedManualAdjustLabels(raw.manualAdjustItems, question);
        if (!matchedLabels.length && !MANUAL_ADJUST_QUESTION_RE.test(String(question || ''))) return null;
        return buildManualAdjustmentSnapshot(raw, matchedLabels, {
            question,
            snapshotId: snapshot.id,
            month: month || requestedMonth,
            snapshotTime: snapshot.timestamp,
            updatedAt: snapshot.updated_at,
            state: 'live-current'
        });
    } finally {
        await closeDb(db);
    }
}

function buildMatchedMetrics(metrics, snapshot, question) {
    const labels = [...new Set(metrics.map(item => String(item.metric_label || '').trim()).filter(label => label.length >= 2))];
    const topMetrics = parseSnapshotTopMetrics(snapshot);
    topMetrics.forEach(item => {
        const label = String(item?.label || '').trim();
        if (label.length >= 2 && !labels.includes(label)) labels.push(label);
    });
    const resolution = resolveMatchedMetricLabels(labels, question);
    const matchedMetrics = resolution.labels
        .map(label => {
            const rows = metrics.filter(item => String(item.metric_label || '').trim() === label);
            const topMetric = topMetrics.find(item => String(item?.label || '').trim() === label) || null;
            return {
                metric: label,
                globalValue: topMetric?.value ?? null,
                globalGap: topMetric?.gap ?? null,
                globalWarning: topMetric ? Boolean(topMetric.isWarn) : null,
                weight: finiteOrNull(rows.find(item => item.weight !== null)?.weight),
                target: rows.find(item => item.target_val !== null)?.target_val ?? null,
                customerGroups: rows.map(item => ({
                    customerGroup: item.cat_name,
                    actual: item.raw_val,
                    numericValue: isMissingMetricValue(item.raw_val) ? null : finiteOrNull(item.num_val),
                    missing: isMissingMetricValue(item.raw_val),
                    target: item.target_val,
                    failing: Number(item.is_failing) === 1,
                    gap: item.gap,
                    earnedScore: finiteOrNull(item.earned_score)
                })),
                savedTopMetric: topMetric ? {
                    value: topMetric.value ?? null,
                    gap: topMetric.gap ?? null,
                    isWarn: Boolean(topMetric.isWarn),
                    subMetrics: Array.isArray(topMetric.subMetrics) ? topMetric.subMetrics : []
                } : null
            };
        });
    return { matchedMetrics, resolution };
}

function buildValuedMetricCandidates(metrics, snapshot, limit = 8) {
    const topMetrics = parseSnapshotTopMetrics(snapshot);
    const labels = [...new Set([
        ...topMetrics.map(item => String(item?.label || '').trim()),
        ...metrics.map(item => String(item.metric_label || '').trim())
    ].filter(label => label.length >= 2))];
    return labels.map(label => {
        const rows = metrics.filter(item => String(item.metric_label || '').trim() === label);
        const topMetric = topMetrics.find(item => String(item?.label || '').trim() === label) || null;
        const customerGroups = rows.map(item => ({
            customerGroup: item.cat_name,
            actual: item.raw_val,
            numericValue: isMissingMetricValue(item.raw_val) ? null : finiteOrNull(item.num_val),
            missing: isMissingMetricValue(item.raw_val),
            target: item.target_val,
            failing: item.is_failing === null || item.is_failing === undefined ? null : Number(item.is_failing) === 1,
            gap: item.gap,
            earnedScore: finiteOrNull(item.earned_score)
        }));
        const globalValue = topMetric?.value ?? null;
        const hasGlobalValue = !isMissingMetricValue(globalValue);
        const valuedGroups = customerGroups.filter(item => !item.missing);
        return {
            metric: label,
            globalValue,
            globalNumericValue: metricValueNumber(globalValue),
            globalGap: topMetric?.gap ?? null,
            globalWarning: topMetric ? Boolean(topMetric.isWarn) : null,
            weight: finiteOrNull(rows.find(item => item.weight !== null)?.weight),
            target: rows.find(item => item.target_val !== null)?.target_val ?? null,
            hasGlobalValue,
            valuedGroupCount: valuedGroups.length,
            customerGroups: valuedGroups
        };
    }).filter(item => item.hasGlobalValue || item.valuedGroupCount > 0)
        .sort((a, b) => Number(b.hasGlobalValue) - Number(a.hasGlobalValue)
            || (Number(b.weight) || 0) - (Number(a.weight) || 0)
            || a.metric.localeCompare(b.metric, 'zh-CN'))
        .slice(0, limit);
}

async function loadMatchedMetricHistory(db, snapshot, matchedMetrics, question) {
    if (!snapshot || !matchedMetrics.length || !METRIC_HISTORY_QUESTION_RE.test(String(question || ''))) return [];
    const pointLimit = parseRequestedHistoryCount(question);
    const fullMonthRequested = /整月|全月|整个(?:月|月份)|月内全部|逐日|每一天|每日/i.test(String(question || ''));
    const onlyWithValues = /有值|有数据|非空|可用值/i.test(String(question || ''));
    const labels = [...new Set(matchedMetrics.map(item => item.metric).filter(Boolean))].slice(0, 6);
    const snapshots = await dbAll(
        db,
        `SELECT s.id, s.snapshot_id, s.month, s.created_at, s.stored_at, s.raw_data_json
         FROM ReportSnapshots s
         INNER JOIN (
             SELECT DATE(created_at) AS snapshot_day, MAX(id) AS max_id
             FROM ReportSnapshots
             WHERE month = ?
             GROUP BY DATE(created_at)
         ) daily ON s.id = daily.max_id
         ORDER BY s.id DESC LIMIT ?`,
        [snapshot.month, Math.min(36, pointLimit * 3)]
    );
    if (!snapshots.length) return [];
    const snapshotIds = snapshots.map(item => item.snapshot_id);
    const metricRows = await dbAll(
        db,
        `SELECT snapshot_id, metric_label, cat_name, raw_val, num_val, target_val,
                is_failing, gap, earned_score
         FROM ReportMetricData
         WHERE snapshot_id IN (${snapshotIds.map(() => '?').join(',')})
           AND metric_label IN (${labels.map(() => '?').join(',')})
         ORDER BY id`,
        [...snapshotIds, ...labels]
    );
    return labels.map(label => {
        const points = [];
        for (const item of snapshots) {
            const topMetric = parseSnapshotTopMetrics(item).find(metric => String(metric?.label || '').trim() === label) || null;
            const rows = metricRows.filter(row => row.snapshot_id === item.snapshot_id && row.metric_label === label);
            const customerGroups = rows.map(row => ({
                customerGroup: row.cat_name,
                actual: row.raw_val,
                numericValue: isMissingMetricValue(row.raw_val) ? null : finiteOrNull(row.num_val),
                missing: isMissingMetricValue(row.raw_val),
                target: row.target_val,
                failing: row.is_failing === null || row.is_failing === undefined ? null : Number(row.is_failing) === 1,
                gap: row.gap,
                earnedScore: finiteOrNull(row.earned_score)
            }));
            const globalValue = topMetric?.value ?? null;
            const hasValue = !isMissingMetricValue(globalValue) || customerGroups.some(group => !group.missing);
            if (onlyWithValues && !hasValue) continue;
            points.push({
                snapshotId: item.snapshot_id,
                snapshotDate: String(item.created_at || '').slice(0, 10),
                month: item.month,
                createdAt: item.created_at,
                storedAt: item.stored_at || null,
                globalValue,
                globalNumericValue: metricValueNumber(globalValue),
                globalGap: topMetric?.gap ?? null,
                globalWarning: topMetric ? Boolean(topMetric.isWarn) : null,
                target: rows.find(row => row.target_val !== null && row.target_val !== undefined)?.target_val ?? null,
                customerGroups,
                hasValue
            });
            if (points.length >= pointLimit) break;
        }
        const numericPoints = points.filter(point => point.globalNumericValue !== null);
        const newest = numericPoints[0]?.globalNumericValue ?? null;
        const oldest = numericPoints[numericPoints.length - 1]?.globalNumericValue ?? null;
        const customerGroupNames = [...new Set(points.flatMap(point => (
            point.customerGroups.map(group => group.customerGroup).filter(Boolean)
        )))];
        const customerGroupChanges = customerGroupNames.map(customerGroup => {
            const values = points.map(point => {
                const group = point.customerGroups.find(item => item.customerGroup === customerGroup && !item.missing);
                return group && group.numericValue !== null
                    ? { snapshotId: point.snapshotId, value: group.actual, numericValue: group.numericValue }
                    : null;
            }).filter(Boolean);
            const newestPoint = values[0] || null;
            const oldestPoint = values[values.length - 1] || null;
            return {
                customerGroup,
                newestValue: newestPoint?.value ?? null,
                oldestValue: oldestPoint?.value ?? null,
                changeFromOldestToNewest: newestPoint && oldestPoint
                    ? round(newestPoint.numericValue - oldestPoint.numericValue)
                    : null,
                valuedSnapshots: values.length
            };
        }).filter(item => item.valuedSnapshots > 0);
        return {
            metric: label,
            order: '最新快照优先',
            requestedPoints: pointLimit,
            returnedPoints: points.length,
            coverageMode: fullMonthRequested ? 'full-month-available-days' : 'recent-points',
            coverageNote: fullMonthRequested
                ? '返回该目标月份所有存在入库快照的自然日；没有入库的日期不补值。'
                : null,
            onlyWithValues,
            granularity: 'daily-latest',
            dailySelectionRule: '同一自然日只取最后一次报表入库；最近几次指最近几个有值日期。',
            changeFromOldestToNewest: newest !== null && oldest !== null ? round(newest - oldest) : null,
            trendBasis: numericPoints.length ? 'globalValue' : (customerGroupChanges.length ? 'customerGroups' : 'none'),
            customerGroupChanges,
            points
        };
    });
}

async function loadSnapshotBundle(db, snapshot, { question = '', includeValuedDiscovery = false } = {}) {
    if (!snapshot) return null;
    const month = snapshot.month;
    const categoryScores = await dbAll(
        db,
        `SELECT cat_name, base_score, manual_score, final_score
         FROM ReportCategoryScores
         WHERE snapshot_id = ? AND (month = ? OR month IS NULL)
         ORDER BY final_score DESC
         LIMIT 500`,
        [snapshot.snapshot_id, month]
    );
    const metrics = await dbAll(
        db,
        `SELECT cat_name, metric_label, weight, target_val, raw_val, num_val,
                is_failing, gap, earned_score, proportional_scoring, completion_ratio
         FROM ReportMetricData
         WHERE snapshot_id = ? AND (month = ? OR month IS NULL)
         LIMIT ?`,
        [snapshot.snapshot_id, month, MAX_METRIC_ROWS]
    );
    const stats = buildMetricStats(metrics);
    const metricMatchResult = buildMatchedMetrics(metrics, snapshot, question);
    const matchedMetrics = metricMatchResult.matchedMetrics;
    const valuedMetrics = includeValuedDiscovery ? buildValuedMetricCandidates(metrics, snapshot) : [];
    const failures = metrics
        .filter(item => Number(item.is_failing) === 1)
        .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0))
        .slice(0, 20)
        .map(item => ({
            customerGroup: item.cat_name,
            metric: item.metric_label,
            weight: finiteOrNull(item.weight),
            target: item.target_val,
            actual: item.raw_val,
            numericValue: finiteOrNull(item.num_val),
            gap: item.gap,
            earnedScore: finiteOrNull(item.earned_score),
            proportionalScoring: Number(item.proportional_scoring) === 1,
            completionRatio: finiteOrNull(item.completion_ratio)
        }));
    const rankings = categoryScores.slice(0, 30).map((item, index) => ({
        rank: index + 1,
        customerGroup: item.cat_name,
        baseScore: finiteOrNull(item.base_score),
        manualScore: finiteOrNull(item.manual_score),
        finalScore: finiteOrNull(item.final_score)
    }));
    const raw = parseSnapshotRaw(snapshot);
    const matchedManualLabels = findMatchedManualAdjustLabels(raw.manualAdjustItems || [], question);
    const manualAdjustments = buildManualAdjustmentSnapshot(raw, matchedManualLabels, {
        question,
        snapshotId: snapshot.snapshot_id,
        month,
        snapshotTime: snapshot.created_at,
        updatedAt: snapshot.stored_at || null,
        state: 'stored-report'
    }, categoryScores);
    return {
        snapshot: {
            snapshotId: snapshot.snapshot_id,
            month,
            targetMonth: month,
            createdAt: snapshot.created_at,
            snapshotCreatedAt: snapshot.created_at,
            storedAt: snapshot.stored_at || null,
            reportStoredAt: snapshot.stored_at || null,
            timeMeaning: `${month} 月是报表目标月份；${snapshot.created_at} 是该口径快照的生成时间，两者不是同一字段。`,
            standardTotalScore: finiteOrNull(snapshot.standard_total_score)
        },
        stats,
        metricMatch: {
            mode: metricMatchResult.resolution.mode,
            ambiguous: metricMatchResult.resolution.ambiguous,
            candidates: metricMatchResult.resolution.candidates
        },
        matchedMetrics,
        valuedMetrics,
        suggestedValuedMetric: valuedMetrics[0] || null,
        manualAdjustments,
        rankings,
        topFailures: failures
    };
}

async function loadManualAdjustmentHistory(db, latest, question) {
    if (!latest || !MANUAL_ADJUST_HISTORY_RE.test(String(question || ''))) return [];
    const raw = parseSnapshotRaw(latest);
    const directLabels = findMatchedManualAdjustLabels(raw.manualAdjustItems || [], question);
    const labels = directLabels.length ? directLabels : (MANUAL_ADJUST_QUESTION_RE.test(String(question || ''))
        ? (raw.manualAdjustItems || []).filter(item => item && !item.deleted).map(item => item.name).filter(Boolean)
        : []);
    if (!labels.length) return [];
    const pointLimit = parseRequestedHistoryCount(question);
    const snapshots = await dbAll(
        db,
        `SELECT s.id, s.snapshot_id, s.month, s.created_at, s.stored_at, s.raw_data_json
         FROM ReportSnapshots s
         INNER JOIN (
             SELECT DATE(created_at) AS snapshot_day, MAX(id) AS max_id
             FROM ReportSnapshots WHERE month = ? GROUP BY DATE(created_at)
         ) daily ON s.id = daily.max_id
         ORDER BY s.id DESC LIMIT ?`,
        [latest.month, Math.min(36, pointLimit * 3)]
    );
    const points = [];
    for (const snapshot of snapshots) {
        const snapshotRaw = parseSnapshotRaw(snapshot);
        const snapshotLabels = labels.filter(label => (snapshotRaw.manualAdjustItems || []).some(item => item && !item.deleted && item.name === label));
        if (!snapshotLabels.length) continue;
        const categoryScores = await dbAll(
            db,
            `SELECT cat_name, manual_score, final_score FROM ReportCategoryScores
             WHERE snapshot_id = ? AND (month = ? OR month IS NULL)`,
            [snapshot.snapshot_id, snapshot.month]
        );
        const detail = buildManualAdjustmentSnapshot(snapshotRaw, snapshotLabels, {
            question,
            snapshotId: snapshot.snapshot_id,
            month: snapshot.month,
            snapshotTime: snapshot.created_at,
            updatedAt: snapshot.stored_at || null,
            state: 'stored-report'
        }, categoryScores);
        if (!detail || !detail.matchedItems.some(item => item.totalOccurrences !== 0 || item.totalScore !== 0)) continue;
        points.push(detail);
        if (points.length >= pointLimit) break;
    }
    return points;
}

async function analyzeQuestion(question, { contextQuestion = '', contextTimeQuestion = contextQuestion } = {}) {
    const intentQuestion = contextQuestion ? `${question}\n上一个问题：${contextQuestion}` : question;
    const metricDiscoveryRequested = METRIC_DISCOVERY_QUESTION_RE.test(String(question || ''));
    const matchingQuestion = metricDiscoveryRequested ? String(question || '') : intentQuestion;
    const plannedAnalysis = shouldAnalyze(matchingQuestion);
    if (!plannedAnalysis && IMPLEMENTATION_QUESTION_RE.test(matchingQuestion)) return null;
    const requestedMonth = parseRequestedMonth(question) || parseRequestedMonth(contextTimeQuestion);
    const requestedDate = parseRequestedDate(String(question || ''));
    const liveManualAdjustments = requestedDate
        ? null
        : await loadLiveManualAdjustmentContext(matchingQuestion, requestedMonth);
    const db = await openReadOnlyDb();
    if (!db) {
        if (!plannedAnalysis) return null;
        return {
            available: false,
            reason: '报表数据库尚未创建',
            source: 'data/report.db'
        };
    }

    try {
        if (!plannedAnalysis) {
            const labelRows = await dbAll(db, 'SELECT DISTINCT metric_label FROM ReportMetricData WHERE metric_label IS NOT NULL LIMIT 2000');
            const directResolution = resolveMatchedMetricLabels(labelRows.map(row => row.metric_label), matchingQuestion);
            if (!directResolution.labels.length && !directResolution.ambiguous && !liveManualAdjustments) return null;
        }
        const latestSql = requestedDate
            ? `SELECT id, snapshot_id, month, created_at, stored_at, standard_total_score, raw_data_json
               FROM ReportSnapshots WHERE DATE(created_at) = DATE(?) ORDER BY id DESC LIMIT 1`
            : requestedMonth
                ? `SELECT id, snapshot_id, month, created_at, stored_at, standard_total_score, raw_data_json
                   FROM ReportSnapshots WHERE month = ? ORDER BY id DESC LIMIT 1`
                : `SELECT id, snapshot_id, month, created_at, stored_at, standard_total_score, raw_data_json
                   FROM ReportSnapshots ORDER BY id DESC LIMIT 1`;
        const latest = await dbGet(db, latestSql, requestedDate ? [requestedDate] : (requestedMonth ? [requestedMonth] : []));
        if (!latest) {
            return {
                available: false,
                reason: requestedDate
                    ? `没有找到 ${requestedDate} 当天的入库报表`
                    : (requestedMonth ? `没有找到 ${requestedMonth} 月的入库报表` : '尚无入库报表'),
                requestedMonth,
                requestedDate,
                source: 'data/report.db'
            };
        }

        const current = await loadSnapshotBundle(db, latest, { question: matchingQuestion, includeValuedDiscovery: metricDiscoveryRequested });
        const effectiveMetricDiscovery = metricDiscoveryRequested && !current.matchedMetrics.length;
        if (!effectiveMetricDiscovery) {
            current.valuedMetrics = [];
            current.suggestedValuedMetric = null;
        }
        const metricHistory = await loadMatchedMetricHistory(db, latest, current.matchedMetrics, matchingQuestion);
        const manualAdjustmentHistory = await loadManualAdjustmentHistory(db, latest, matchingQuestion);
        const previous = await dbGet(
            db,
            `SELECT id, snapshot_id, month, created_at, stored_at, standard_total_score, raw_data_json
             FROM ReportSnapshots
             WHERE id < ? AND month = ?
             ORDER BY id DESC LIMIT 1`,
            [latest.id, latest.month]
        );
        const previousBundle = previous ? await loadSnapshotBundle(db, previous, { question: matchingQuestion }) : null;
        const trendRows = await dbAll(
            db,
            `SELECT s.id, s.snapshot_id, s.month, s.created_at, s.standard_total_score,
                    COUNT(m.id) AS total_metrics,
                    SUM(CASE WHEN m.is_failing = 1 THEN 1 ELSE 0 END) AS failing_metrics
             FROM ReportSnapshots s
             LEFT JOIN ReportMetricData m
               ON m.snapshot_id = s.snapshot_id AND (m.month = s.month OR m.month IS NULL)
             WHERE s.month = ?
             GROUP BY s.id
             ORDER BY s.id DESC
             LIMIT 12`,
            [latest.month]
        );
        const trends = trendRows.reverse().map(row => ({
            snapshotId: row.snapshot_id,
            month: row.month,
            createdAt: row.created_at,
            totalScore: finiteOrNull(row.standard_total_score),
            totalMetrics: Number(row.total_metrics) || 0,
            failingMetrics: Number(row.failing_metrics) || 0
        }));

        return {
            available: true,
            requestedMonth,
            requestedDate,
            selectionRule: requestedDate
                ? '指定自然日内的最后一次入库快照'
                : (requestedMonth ? '指定目标月份的最新入库快照' : '全部月份中的最新入库快照'),
            historicalRule: '历史得分使用入库时保存的结果，不按当前目标或计分规则重算。',
            metricDiscovery: effectiveMetricDiscovery ? {
                requested: true,
                selectionRule: '从最新入库报表中筛选全局值或客户群实际值非空的指标，目标值不算实际值。',
                candidateCount: current.valuedMetrics.length,
                suggestedMetric: current.suggestedValuedMetric?.metric || null
            } : null,
            current,
            liveDashboard: liveManualAdjustments ? {
                source: 'backend/data/tools.db: sla_snapshots, sla_prefs',
                description: '报表页面当前所选最新 SLA 快照；页面自动保存的手动加减分发生次数',
                manualAdjustments: liveManualAdjustments
            } : null,
            previous: previousBundle,
            comparison: previousBundle ? {
                totalScoreChange: current.snapshot.standardTotalScore !== null && previousBundle.snapshot.standardTotalScore !== null
                    ? round(current.snapshot.standardTotalScore - previousBundle.snapshot.standardTotalScore)
                    : null,
                failingMetricChange: current.stats.failingMetrics - previousBundle.stats.failingMetrics,
                complianceRateChange: current.stats.complianceRate !== null && previousBundle.stats.complianceRate !== null
                    ? round(current.stats.complianceRate - previousBundle.stats.complianceRate)
                    : null
            } : null,
            metricHistory,
            metricHistoryRule: metricHistory.length
                ? '指定指标历史按快照入库时保存的全局值和客户群值读取；“有值”查询会跳过全局与客户群均无值的快照。'
                : null,
            manualAdjustmentHistory,
            manualAdjustmentHistoryRule: manualAdjustmentHistory.length
                ? '同一自然日只取最后一次报表入库；分值使用该历史快照保存的项目规则和客户群汇总结果。'
                : null,
            trends,
            source: liveManualAdjustments
                ? 'backend/data/tools.db: sla_snapshots, sla_prefs; data/report.db: ReportSnapshots, ReportCategoryScores, ReportMetricData'
                : 'data/report.db: ReportSnapshots, ReportCategoryScores, ReportMetricData',
            readOnly: true
        };
    } finally {
        await closeDb(db);
    }
}

function formatAnalysisForPrompt(analysis) {
    if (!analysis) return '';
    const compactManual = detail => {
        if (!detail || detail.queryMode !== 'ranking') return detail;
        return {
            snapshotId: detail.snapshotId,
            month: detail.month,
            snapshotTime: detail.snapshotTime,
            updatedAt: detail.updatedAt,
            state: detail.state,
            queryMode: detail.queryMode,
            configuredItemCount: detail.configuredItemCount,
            activeItemCount: detail.activeItemCount,
            rankings: detail.rankings,
            scoreBasis: detail.scoreBasis,
            readOnly: detail.readOnly
        };
    };
    const compactMetricHistory = (analysis.metricHistory || []).map(history => ({
        metric: history.metric,
        order: history.order,
        requestedPoints: history.requestedPoints,
        returnedPoints: history.returnedPoints,
        coverageMode: history.coverageMode,
        coverageNote: history.coverageNote,
        onlyWithValues: history.onlyWithValues,
        granularity: history.granularity,
        dailySelectionRule: history.dailySelectionRule,
        changeFromOldestToNewest: history.changeFromOldestToNewest,
        trendBasis: history.trendBasis,
        customerGroupChanges: history.customerGroupChanges,
        points: (history.points || []).map(point => ({
            snapshotDate: point.snapshotDate,
            globalValue: point.globalValue,
            target: point.target,
            hasValue: point.hasValue,
            customerGroups: Object.fromEntries((point.customerGroups || []).map(group => [
                group.customerGroup,
                group.missing ? null : group.actual
            ]))
        }))
    }));
    if ((Array.isArray(analysis.metricHistory) && analysis.metricHistory.length)
        || analysis.current?.manualAdjustments
        || analysis.liveDashboard?.manualAdjustments
        || (Array.isArray(analysis.manualAdjustmentHistory) && analysis.manualAdjustmentHistory.length)) {
        return JSON.stringify({
            available: analysis.available,
            requestedMonth: analysis.requestedMonth,
            requestedDate: analysis.requestedDate,
            selectionRule: analysis.selectionRule,
            historicalRule: analysis.historicalRule,
            current: analysis.current ? {
                snapshot: analysis.current.snapshot,
                metricMatch: analysis.current.metricMatch,
                matchedMetrics: analysis.current.matchedMetrics,
                manualAdjustments: compactManual(analysis.current.manualAdjustments)
            } : null,
            liveDashboard: analysis.liveDashboard ? {
                ...analysis.liveDashboard,
                manualAdjustments: compactManual(analysis.liveDashboard.manualAdjustments)
            } : null,
            metricHistory: compactMetricHistory,
            metricHistoryRule: analysis.metricHistoryRule,
            manualAdjustmentHistory: analysis.manualAdjustmentHistory,
            manualAdjustmentHistoryRule: analysis.manualAdjustmentHistoryRule,
            source: analysis.source,
            readOnly: analysis.readOnly
        }, null, 2);
    }
    return JSON.stringify(analysis, null, 2);
}

module.exports = {
    get REPORT_DB_PATH() { return getReportDbPath(); },
    shouldAnalyze,
    parseRequestedMonth,
    parseRequestedDate,
    analyzeQuestion,
    formatAnalysisForPrompt,
    buildMetricStats,
    buildProactiveAlertCandidates,
    buildProactiveTaskCandidates,
    getProactiveAlerts,
    findMatchedMetricLabels,
    parseRequestedHistoryCount,
    loadMatchedMetricHistory,
    enrichProactiveAlertWithDeepContext,
    generateRuleBasedDeepAnalysis,
    normalizeProactiveAiAnalysis
};
