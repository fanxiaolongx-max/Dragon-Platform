// NetCare 数据探查（/netcare-explorer）：经数字人基座摸清表结构、核对表内容、补标注。
// 左侧表目录（基座 information_schema 实时清单 + 全表盘点种子 + 管理员标注，支持拼音搜索与状态筛选），
// 右侧单表：概览与标注 / 字段画像 / 样例数据 / 结构化查询 / SQL 控制台（业务库只读，应用库可写）。
// 接口：/api/digital-human/*（仅管理员）。
(function () {
    'use strict';

    const API = '/api/digital-human';
    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const STORE_KEY = 'netcare_explorer_view_v1';
    const OPS = ['=', '!=', '>', '>=', '<', '<=', 'like', 'not like', 'in', 'not in', 'between', 'is null', 'is not null'];
    const AGGS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'];
    const STATUS_FILTERS = [
        ['all', '全部', 'All'], ['data', '有数据', 'With data'], ['empty', '空表', 'Empty'], ['new', '新增表', 'New'],
        ['unnamed', '无中文名', 'No Chinese name'], ['unverified', '未核对', 'Not reviewed'], ['verified', '已核对', 'Reviewed'],
        ['review', '标注存疑', 'Label in doubt'], ['missing', '库中已不存在', 'Missing'], ['hidden', '已隐藏', 'Hidden']
    ];
    const TABS = [['overview', '概览与标注', 'Overview'], ['fields', '字段', 'Fields'], ['sample', '样例数据', 'Sample'], ['query', '查询', 'Query'], ['sql', 'SQL', 'SQL']];

    const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (_) { return {}; } })();
    const state = {
        scope: saved.scope === 'app' ? 'app' : 'business',
        q: '', category: '', status: 'all', tab: TABS.some(([id]) => id === saved.tab) ? saved.tab : 'overview',
        catalog: null, loading: false, error: '',
        selected: '', detail: null, detailLoading: false, detailError: '',
        query: null, queryResult: null, queryBusy: false,
        sqlText: '', sqlResult: null, sqlBusy: false,
        count: null, noteBusy: false
    };
    const root = document.getElementById('nxApp');

    function remember() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ scope: state.scope, tab: state.tab })); } catch (_) { /* 仅记住视图 */ }
    }

    async function request(method, path, body) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        const res = await fetch(`${API}${path}`, {
            method,
            headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code, raw: data.raw });
        return data;
    }

    const fmt = value => (Number(value) || 0).toLocaleString();
    const cell = value => {
        if (value === null || value === undefined) return '<td class="null">NULL</td>';
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return `<td title="${esc(text.slice(0, 1000))}">${esc(text.slice(0, 200))}</td>`;
    };

    function rowsTable(rows, { columns } = {}) {
        if (!rows?.length) return `<div class="nx-empty">${esc(L('没有数据', 'No rows'))}</div>`;
        const heads = columns || [...new Set(rows.slice(0, 200).flatMap(row => Object.keys(row)))];
        return `<div class="nx-table-wrap"><table class="nx-table"><thead><tr><th>#</th>${heads.map(name => `<th>${esc(name)}</th>`).join('')}</tr></thead>
            <tbody>${rows.slice(0, 2000).map((row, index) => `<tr><td class="null">${index + 1}</td>${heads.map(name => cell(row[name])).join('')}</tr>`).join('')}</tbody></table></div>
            ${rows.length > 2000 ? `<div class="nx-meta">${esc(L(`页面只显示前 2000 行，共 ${rows.length} 行，可导出 CSV 查看全部`, `Showing 2000 of ${rows.length} rows; export CSV for all`))}</div>` : ''}`;
    }

    function exportCsv(rows, name) {
        if (!rows?.length) return;
        const heads = [...new Set(rows.flatMap(row => Object.keys(row)))];
        const line = values => values.map(value => {
            const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
            return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        }).join(',');
        const blob = new Blob(['﻿' + [line(heads), ...rows.map(row => line(heads.map(head => row[head])))].join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${name}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    }

    // ── 目录与筛选 ───────────────────────────────────────
    function matches(table) {
        const q = state.q.trim().toLowerCase();
        if (q) {
            const text = `${table.name} ${table.nameCn} ${table.module} ${table.category} ${table.description}`.toLowerCase();
            const pinyin = window.ToolsPinyinSearch;
            if (!text.includes(q) && !(pinyin?.isPinyinQuery?.(q) && pinyin.pinyinMatches(`${table.nameCn} ${table.module} ${table.category}`, q))) return false;
        }
        if (state.category && table.category !== state.category) return false;
        switch (state.status) {
            case 'hidden': return table.hidden;
            case 'data': return !table.hidden && !table.empty && table.status !== 'missing';
            case 'empty': return !table.hidden && table.empty && table.status !== 'missing';
            case 'new': return !table.hidden && table.isNew;
            case 'unnamed': return !table.hidden && !table.nameCn;
            case 'unverified': return !table.hidden && !table.verified;
            case 'verified': return !table.hidden && table.verified;
            case 'review': return !table.hidden && Boolean(table.review);
            case 'missing': return !table.hidden && table.status === 'missing';
            default: return !table.hidden;
        }
    }

    function tagsOf(table) {
        const tags = [];
        if (table.status === 'missing') tags.push(['bad', L('库中不存在', 'Missing')]);
        if (table.isNew) tags.push(['new', L('新增', 'New')]);
        if (table.empty && table.status !== 'missing') tags.push(['warn', L('空表', 'Empty')]);
        else if (table.rows) tags.push(['', `≈${fmt(table.rows)}`]);
        if (table.grain) tags.push(['', table.grain]);
        if (table.family) tags.push(['warn', L(`分区族 ${table.family}`, `Family ${table.family}`)]);
        if (table.verified) tags.push(['ok', L('已核对', 'Reviewed')]);
        if (table.review) tags.push(['bad', L('标注存疑', 'In doubt')]);
        return tags;
    }

    function renderList() {
        const tables = state.catalog?.tables || [];
        const shown = tables.filter(matches);
        const categories = [...new Set(tables.map(item => item.category).filter(Boolean))].sort();
        return `<aside class="nx-card nx-list-card">
            <div class="nx-filters">
                <input type="search" data-nx="q" value="${esc(state.q)}" placeholder="${esc(L('搜索表名 / 中文名 / 模块（支持拼音）', 'Search name / label / module'))}">
                <div class="nx-filter-row">
                    <select data-nx="category"><option value="">${esc(L('全部类别', 'All categories'))}</option>${categories.map(item => `<option value="${esc(item)}" ${item === state.category ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select>
                    <select data-nx="status">${STATUS_FILTERS.map(([id, zh, en]) => `<option value="${id}" ${id === state.status ? 'selected' : ''}>${esc(L(zh, en))}</option>`).join('')}</select>
                </div>
            </div>
            ${renderListBody(shown, tables)}
        </aside>`;
    }

    function renderListBody(shown, tables) {
        return `<div class="nx-count" data-nx-role="count">${esc(L(`显示 ${shown.length} / ${tables.length} 张`, `${shown.length} of ${tables.length} tables`))}</div>
            <div class="nx-list" data-nx-role="list">${shown.map(table => `<button type="button" class="nx-item ${table.name === state.selected ? 'active' : ''}" data-nx-table="${esc(table.name)}">
                <div class="nx-item-name">${esc(table.name)}</div>
                <div class="nx-item-cn ${table.nameCn ? '' : 'none'}">${esc(table.nameCn || L('（无中文名）', '(no label)'))}${table.module ? ` · ${esc(table.module)}` : ''}</div>
                <div class="nx-tags">${tagsOf(table).map(([kind, text]) => `<span class="nx-tag ${kind}">${esc(text)}</span>`).join('')}</div>
            </button>`).join('') || `<div class="nx-empty">${esc(L('没有匹配的表', 'No matching tables'))}</div>`}</div>`;
    }

    // 搜索 / 筛选只重绘左侧列表和统计，不动右侧表单里未保存的输入
    function refreshList() {
        const tables = state.catalog?.tables || [];
        const count = root.querySelector('[data-nx-role="count"]');
        const list = root.querySelector('[data-nx-role="list"]');
        if (!count || !list) return render();
        const holder = document.createElement('div');
        holder.innerHTML = renderListBody(tables.filter(matches), tables);
        count.replaceWith(holder.firstElementChild);
        list.replaceWith(holder.lastElementChild);
        const stats = root.querySelector('.nx-stats');
        if (stats) stats.outerHTML = renderStats();
        const status = root.querySelector('[data-nx="status"]');
        if (status) status.value = state.status;
        return undefined;
    }

    function renderStats() {
        const stats = state.catalog?.stats;
        if (!stats) return '';
        const items = [['all', stats.total, '张表', 'tables'], ['data', stats.withData, '有数据', 'with data'], ['empty', stats.empty, '空表', 'empty'], ['new', stats.isNew, '新增表', 'new'],
            ['unnamed', stats.total - stats.named, '无中文名', 'unlabeled'], ['verified', stats.verified, '已核对', 'reviewed'], ['missing', stats.missing, '库中不存在', 'missing']];
        return `<div class="nx-stats">${items.map(([id, value, zh, en]) => `<button type="button" class="nx-stat ${state.status === id ? 'active' : ''}" data-nx-status="${id}"><b>${fmt(value)}</b><span>${esc(L(zh, en))}</span></button>`).join('')}</div>`;
    }

    function renderTop() {
        const catalog = state.catalog;
        const live = catalog?.live;
        return `<div class="nx-top">
            <h1>🧭 ${esc(L('NetCare 数据探查', 'NetCare Explorer'))}</h1>
            <div class="nx-seg">${[['business', L('业务库（只读）', 'Business (read-only)')], ['app', L('应用库', 'App schema')]].map(([id, label]) => `<button type="button" data-nx-scope="${id}" class="${state.scope === id ? 'active' : ''}">${esc(label)}</button>`).join('')}</div>
            ${catalog ? `<span class="nx-pill ${live ? 'ok' : 'bad'}">${esc(live ? L(`在线 · ${catalog.schema}`, `Live · ${catalog.schema}`) : L('离线（显示盘点种子）', 'Offline (audit seed)'))}</span>
                <span class="nx-pill">${esc(L(`更新于 ${new Date(catalog.fetchedAt).toLocaleTimeString()}`, `Fetched ${new Date(catalog.fetchedAt).toLocaleTimeString()}`))}</span>` : ''}
            <span class="nx-spacer"></span>
            <button type="button" class="nx-btn" data-nx-action="refresh" ${state.loading ? 'disabled' : ''}>${esc(state.loading ? L('加载中…', 'Loading…') : L('刷新表清单', 'Refresh'))}</button>
        </div>
        ${catalog && !live ? `<div class="nx-alert bad">${esc(L('无法从基座读取实时表清单：', 'Could not read the live table list: '))}${esc(catalog.error || '')}。${esc(L('请在「全局设置 › 频道对接 › 数字人」检查配置；下方显示全表盘点的种子清单与已有标注。', 'Check Global settings › Channels › Digital Human; the audit seed and saved notes are shown below.'))}</div>` : ''}
        ${catalog?.seedSource && state.scope === 'business' ? `<div class="nx-meta">${esc(L('中文名 / 类别 / 粒度初始来源：', 'Initial labels from: '))}${esc(catalog.seedSource)}${esc(L('；管理员标注优先。', '; admin notes take precedence.'))}</div>` : ''}`;
    }

    // ── 单表详情 ─────────────────────────────────────────
    function currentTable() {
        return state.catalog?.tables.find(item => item.name === state.selected) || null;
    }

    function renderOverview(detail, table) {
        const note = detail?.note || {};
        const columns = detail?.columns || [];
        const suggestions = detail?.suggestions || {};
        const fieldSelect = (key, label, suggested) => {
            const value = note[key] || '';
            return `<label class="nx-field"><span>${esc(label)}${suggested && !value ? ` <small>${esc(L(`建议 ${suggested}`, `Suggested ${suggested}`))}</small>` : ''}</span>
                <select class="nx-select" data-nx-note="${key}"><option value="">${esc(L('（未指定）', '(none)'))}</option>${columns.map(column => `<option value="${esc(column.name)}" ${column.name === (value || '') ? 'selected' : ''}>${esc(column.name)}</option>`).join('')}</select></label>`;
        };
        const seedInfo = detail?.seed || {};
        return `<div class="nx-kv">
                <div><b>${esc(L('类别', 'Category'))}</b>${esc(table?.category || '—')}</div>
                <div><b>${esc(L('粒度', 'Grain'))}</b>${esc(table?.grain || '—')}</div>
                <div><b>${esc(L('估算行数', 'Estimated rows'))}</b>${fmt(table?.rows)} ${state.count ? `<span class="nx-tag ok">${esc(L(`精确 ${fmt(state.count.count)}`, `exact ${fmt(state.count.count)}`))}</span>` : `<button type="button" class="nx-link" data-nx-action="count">${esc(L('精确计数', 'Exact count'))}</button>`}</div>
                <div><b>${esc(L('字段数', 'Columns'))}</b>${fmt(columns.length || table?.columns)}</div>
                <div><b>${esc(L('项目模块（盘点）', 'Project module'))}</b>${esc(seedInfo.module || '—')}</div>
                <div><b>${esc(L('表注释（库内）', 'Table comment'))}</b>${esc(table?.comment || L('无', 'none'))}</div>
                <div><b>${esc(L('盘点备注', 'Audit note'))}</b>${esc(seedInfo.note || '—')}</div>
                ${seedInfo.nameCnOriginal ? `<div><b>${esc(L('同事原标注', 'Original label'))}</b>${esc(seedInfo.nameCnOriginal)}</div>` : ''}
                ${table?.updateTime ? `<div><b>${esc(L('最近更新（库内）', 'Last updated'))}</b>${esc(table.updateTime)}</div>` : ''}
            </div>
            ${detail?.hints?.length ? `<ul class="nx-hints">${detail.hints.map(text => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}
            <div class="nx-section-title">${esc(L('标注（核对后填写，AI 月报 / Dragon Claw 取数时会参考）', 'Notes (used by AI reports and Dragon Claw)'))}</div>
            <div class="nx-form">
                <label class="nx-field"><span>${esc(L('中文名', 'Chinese name'))}</span><input class="nx-input" data-nx-note="nameCn" value="${esc(note.nameCn || table?.nameCn || '')}" maxlength="200"></label>
                <label class="nx-field"><span>${esc(L('业务模块', 'Module'))}</span><input class="nx-input" data-nx-note="module" value="${esc(note.module || table?.module || '')}" maxlength="200"></label>
                ${fieldSelect('timeField', L('时间字段', 'Time field'), suggestions.timeField)}
                ${fieldSelect('regionField', L('地区部字段', 'Region field'), suggestions.regionField)}
                ${fieldSelect('officeField', L('代表处字段', 'Office field'), suggestions.officeField)}
                <label class="nx-field nx-wide"><span>${esc(L('说明（口径、过滤条件、注意事项）', 'Description (definitions, filters, caveats)'))}</span><textarea class="nx-textarea" data-nx-note="description" maxlength="2000">${esc(note.description || '')}</textarea></label>
                <label class="nx-check"><input type="checkbox" data-nx-note="verified" ${note.verified ? 'checked' : ''}> ${esc(L('已核对表内容', 'Content reviewed'))}</label>
                <label class="nx-check"><input type="checkbox" data-nx-note="hidden" ${note.hidden ? 'checked' : ''}> ${esc(L('隐藏（测试表 / 废弃表）', 'Hide (test / obsolete)'))}</label>
            </div>
            <div class="nx-actions">
                <span class="nx-note">${note.updatedAt ? esc(L(`上次标注：${note.updatedBy || ''} ${new Date(note.updatedAt).toLocaleString()}`, `Last noted by ${note.updatedBy || ''} at ${new Date(note.updatedAt).toLocaleString()}`)) : esc(L('尚未标注', 'No notes yet'))}</span>
                <button type="button" class="nx-btn" data-nx-action="apply-suggestions" ${columns.length ? '' : 'disabled'}>${esc(L('套用建议字段', 'Use suggested fields'))}</button>
                <button type="button" class="nx-btn primary" data-nx-action="save-note" ${state.noteBusy ? 'disabled' : ''}>${esc(state.noteBusy ? L('保存中…', 'Saving…') : L('保存标注', 'Save notes'))}</button>
            </div>`;
    }

    function renderFields(detail) {
        const roleLabel = { time: L('时间', 'time'), region: L('地区部', 'region'), office: L('代表处', 'office'), bg: 'BG' };
        return `<div class="nx-table-wrap"><table class="nx-table"><thead><tr>
            <th>#</th><th>${esc(L('字段', 'Column'))}</th><th>${esc(L('类型', 'Type'))}</th><th>${esc(L('注释', 'Comment'))}</th><th>${esc(L('识别', 'Role'))}</th>
            <th>${esc(L('样例非空', 'Filled'))}</th><th>${esc(L('取值形态', 'Value kinds'))}</th><th>${esc(L('占位值', 'Placeholders'))}</th><th>${esc(L('示例', 'Examples'))}</th>
        </tr></thead><tbody>${detail.columns.map((column, index) => `<tr>
            <td class="null">${index + 1}</td><td class="mono">${esc(column.name)}${column.key === 'PRI' ? ' 🔑' : ''}</td><td class="mono">${esc(column.columnType || column.dataType)}</td>
            <td>${esc(column.comment)}</td><td>${column.role ? `<span class="nx-tag new">${esc(roleLabel[column.role] || column.role)}</span>` : ''}</td>
            <td>${column.sampleFilled}/${column.sampleTotal}</td><td>${esc(column.kinds.join(' / '))}</td>
            <td>${column.sentinels.length ? `<span class="nx-tag warn">${esc(column.sentinels.join(' / '))}</span>` : ''}</td>
            <td title="${esc(column.examples.join(' | '))}">${esc(column.examples.join(' | '))}</td>
        </tr>`).join('')}</tbody></table></div>`;
    }

    function defaultQuery(detail) {
        return { columns: '', filters: [], groupBy: '', metrics: [], orderBy: detail?.note?.timeField || detail?.suggestions?.timeField || '', order: 'desc', limit: 200 };
    }

    function renderQuery(detail) {
        const query = state.query || (state.query = defaultQuery(detail));
        const names = detail.columns.map(column => column.name);
        const options = (value, { allowEmpty = true, extra = [] } = {}) => `${allowEmpty ? `<option value="">${esc(L('（选择字段）', '(column)'))}</option>` : ''}${[...extra, ...names].map(name => `<option value="${esc(name)}" ${name === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}`;
        const result = state.queryResult;
        return `<div class="nx-form">
                <label class="nx-field nx-wide"><span>${esc(L('返回字段（逗号分隔，留空为全部；有分组/聚合时忽略）', 'Columns (comma separated; ignored when grouping)'))}</span><input class="nx-input nx-mono" data-nx-q="columns" value="${esc(query.columns)}" placeholder="${esc(names.slice(0, 4).join(', '))}"></label>
            </div>
            <div class="nx-section-title">${esc(L('过滤条件（AND）', 'Filters (AND)'))}</div>
            ${query.filters.map((filter, index) => `<div class="nx-builder-row">
                <select class="nx-select" data-nx-filter="${index}" data-key="column">${options(filter.column)}</select>
                <select class="nx-select nx-op" data-nx-filter="${index}" data-key="op">${OPS.map(op => `<option value="${op}" ${op === filter.op ? 'selected' : ''}>${op}</option>`).join('')}</select>
                <input class="nx-input" data-nx-filter="${index}" data-key="value" value="${esc(filter.value)}" placeholder="${esc(L('值；in 用逗号分隔，between 填 起,止', 'value; comma list for in, from,to for between'))}" ${/null/.test(filter.op) ? 'disabled' : ''}>
                <button type="button" class="nx-link danger" data-nx-action="remove-filter" data-index="${index}">✕</button>
            </div>`).join('')}
            <button type="button" class="nx-link" data-nx-action="add-filter">＋ ${esc(L('添加条件', 'Add filter'))}</button>
            <div class="nx-section-title">${esc(L('分组与聚合（可选）', 'Group & aggregate (optional)'))}</div>
            <div class="nx-form">
                <label class="nx-field"><span>${esc(L('分组字段（逗号分隔）', 'Group by (comma separated)'))}</span><input class="nx-input nx-mono" data-nx-q="groupBy" value="${esc(query.groupBy)}"></label>
            </div>
            ${query.metrics.map((metric, index) => `<div class="nx-builder-row">
                <select class="nx-select nx-op" data-nx-metric="${index}" data-key="agg">${AGGS.map(agg => `<option value="${agg}" ${agg === metric.agg ? 'selected' : ''}>${agg}</option>`).join('')}</select>
                <select class="nx-select" data-nx-metric="${index}" data-key="column">${options(metric.column, { extra: [] })}</select>
                <input class="nx-input" data-nx-metric="${index}" data-key="as" value="${esc(metric.as || '')}" placeholder="${esc(L('别名（可选）', 'alias (optional)'))}">
                <button type="button" class="nx-link danger" data-nx-action="remove-metric" data-index="${index}">✕</button>
            </div>`).join('')}
            <button type="button" class="nx-link" data-nx-action="add-metric">＋ ${esc(L('添加聚合', 'Add aggregate'))}</button>
            <div class="nx-form" style="margin-top:10px">
                <label class="nx-field"><span>${esc(L('排序字段', 'Order by'))}</span><input class="nx-input nx-mono" data-nx-q="orderBy" value="${esc(query.orderBy)}" list="nx-columns"></label>
                <label class="nx-field"><span>${esc(L('方向', 'Direction'))}</span><select class="nx-select" data-nx-q="order"><option value="desc" ${query.order === 'desc' ? 'selected' : ''}>DESC</option><option value="asc" ${query.order === 'asc' ? 'selected' : ''}>ASC</option></select></label>
                <label class="nx-field"><span>${esc(L('最多行数', 'Row limit'))}</span><input class="nx-input" type="number" min="1" data-nx-q="limit" value="${esc(query.limit)}"></label>
            </div>
            <datalist id="nx-columns">${names.map(name => `<option value="${esc(name)}">`).join('')}</datalist>
            <div class="nx-actions">
                <span class="nx-note">${esc(L('字段名按真实表结构校验，值自动转义；超过 1000 行自动分页。', 'Columns are validated against the schema; values are escaped; results over 1000 rows page automatically.'))}</span>
                <button type="button" class="nx-btn" data-nx-action="reset-query">${esc(L('重置', 'Reset'))}</button>
                <button type="button" class="nx-btn primary" data-nx-action="run-query" ${state.queryBusy ? 'disabled' : ''}>${esc(state.queryBusy ? L('查询中…', 'Running…') : L('执行查询', 'Run query'))}</button>
            </div>
            ${result ? resultBlock(result, `${state.selected}-query`) : ''}`;
    }

    function resultBlock(result, name) {
        if (result.error) return `<div class="nx-alert bad" style="margin-top:10px">${esc(result.error)}${result.raw ? `<div class="nx-sql">${esc(result.raw)}</div>` : ''}</div>`;
        return `${result.sql ? `<div class="nx-sql">${esc(result.sql)}</div>` : ''}
            <div class="nx-actions"><span class="nx-note">${esc(L(`${fmt(result.rows.length)} 行${result.truncated ? '（已达上限，结果被截断）' : ''} · ${result.durationMs} ms${result.pages > 1 ? ` · ${result.pages} 页` : ''}`, `${fmt(result.rows.length)} rows${result.truncated ? ' (truncated)' : ''} · ${result.durationMs} ms`))}</span>
            <button type="button" class="nx-btn" data-nx-action="export" data-name="${esc(name)}">${esc(L('导出 CSV', 'Export CSV'))}</button></div>
            ${rowsTable(result.rows)}`;
    }

    function renderSql() {
        const table = state.selected;
        const placeholder = state.scope === 'app' ? `SELECT * FROM ${table || 't_report_template'} LIMIT 50` : `SELECT * FROM netcare.${table || 'common_data_rep'} LIMIT 50`;
        const result = state.sqlResult;
        return `<textarea class="nx-textarea code" data-nx="sql" placeholder="${esc(placeholder)}">${esc(state.sqlText || '')}</textarea>
            <div class="nx-actions">
                <span class="nx-note">${esc(state.scope === 'app'
                    ? L('应用 schema：表名不带库名。查询自动分页；写入只支持单条 INSERT / UPDATE / DELETE（必须带 WHERE），执行前会二次确认。', 'App schema: unqualified table names. Writes support one INSERT / UPDATE / DELETE with WHERE and ask for confirmation.')
                    : L('业务库只读：单条 SELECT / WITH / SHOW / DESC / EXPLAIN；表名写 netcare.表名。未写 LIMIT 时自动分页（建议带 ORDER BY）。⌘/Ctrl+Enter 执行。', 'Business database is read-only: one SELECT / WITH / SHOW / DESC / EXPLAIN. Without LIMIT results page automatically (add ORDER BY). ⌘/Ctrl+Enter to run.'))}</span>
                ${table ? `<button type="button" class="nx-btn" data-nx-action="sql-template">${esc(L('填入当前表', 'Use current table'))}</button>` : ''}
                ${state.scope === 'app' ? `<button type="button" class="nx-btn danger" data-nx-action="sql-execute" ${state.sqlBusy ? 'disabled' : ''}>${esc(L('执行写入', 'Execute write'))}</button>` : ''}
                <button type="button" class="nx-btn primary" data-nx-action="sql-run" ${state.sqlBusy ? 'disabled' : ''}>${esc(state.sqlBusy ? L('执行中…', 'Running…') : L('执行查询', 'Run query'))}</button>
            </div>
            ${result ? (result.kind ? `<div class="nx-alert info" style="margin-top:10px">${esc(L(`${result.kind.toUpperCase()} 已执行，影响 ${result.affectedRows ?? '?'} 行（${result.durationMs} ms）`, `${result.kind.toUpperCase()} executed, ${result.affectedRows ?? '?'} rows affected`))}</div>` : resultBlock(result, `${state.scope}-sql`)) : ''}`;
    }

    function renderDetail() {
        if (!state.selected) {
            return `<section class="nx-card nx-detail">${state.tab === 'sql'
                ? `<div class="nx-tabs">${TABS.filter(([id]) => id === 'sql').map(([id, zh, en]) => `<button type="button" class="nx-tab active" data-nx-tab="${id}">${esc(L(zh, en))}</button>`).join('')}</div>${renderSql()}`
                : `<div class="nx-empty">${esc(L('从左侧选择一张表，查看字段、样例数据并核对标注；也可以直接打开 SQL 控制台。', 'Pick a table on the left to inspect columns and sample rows, or open the SQL console.'))}<br><button type="button" class="nx-btn" style="margin-top:10px" data-nx-tab="sql">${esc(L('打开 SQL 控制台', 'Open SQL console'))}</button></div>`}</section>`;
        }
        const table = currentTable();
        const detail = state.detail;
        let body;
        if (state.tab === 'sql') body = renderSql();
        else if (state.detailLoading) body = `<div class="nx-empty">${esc(L('正在读取表结构与样例…', 'Loading schema and samples…'))}</div>`;
        else if (state.detailError) body = `<div class="nx-alert bad">${esc(state.detailError)}</div>${state.tab === 'overview' && table ? renderOverview(null, table) : ''}`;
        else if (!detail) body = '';
        else if (state.tab === 'fields') body = renderFields(detail);
        else if (state.tab === 'sample') body = `<div class="nx-actions"><span class="nx-note">${esc(L(`前 ${detail.sample.length} 行样例`, `First ${detail.sample.length} rows`))}</span><button type="button" class="nx-btn" data-nx-action="export-sample">${esc(L('导出 CSV', 'Export CSV'))}</button></div>${rowsTable(detail.sample, { columns: detail.columns.map(column => column.name) })}`;
        else if (state.tab === 'query') body = renderQuery(detail);
        else body = renderOverview(detail, table);
        return `<section class="nx-card nx-detail">
            <div class="nx-detail-head"><h2>${esc(state.selected)}</h2>${table?.nameCn ? `<span class="nx-cn">${esc(table.nameCn)}</span>` : ''}
                <span class="nx-tags">${(table ? tagsOf(table) : []).map(([kind, text]) => `<span class="nx-tag ${kind}">${esc(text)}</span>`).join('')}</span></div>
            <div class="nx-tabs">${TABS.map(([id, zh, en]) => `<button type="button" class="nx-tab ${state.tab === id ? 'active' : ''}" data-nx-tab="${id}">${esc(L(zh, en))}</button>`).join('')}</div>
            ${body}
        </section>`;
    }

    function render() {
        if (state.error) {
            root.innerHTML = `${renderTop()}<div class="nx-alert bad">${esc(state.error)}</div>`;
            return;
        }
        if (!state.catalog) {
            root.innerHTML = `${renderTop()}<div class="nx-empty">${esc(L('正在读取表目录…', 'Loading table catalog…'))}</div>`;
            return;
        }
        const listScroll = root.querySelector('[data-nx-role="list"]')?.scrollTop || 0;
        root.innerHTML = `${renderTop()}${renderStats()}<div class="nx-main">${renderList()}${renderDetail()}</div>`;
        const list = root.querySelector('[data-nx-role="list"]');
        if (list) list.scrollTop = listScroll;
    }

    // ── 数据加载 ─────────────────────────────────────────
    async function loadCatalog({ refresh = false } = {}) {
        state.loading = true;
        state.error = '';
        render();
        try {
            state.catalog = await request('GET', `/tables?scope=${state.scope}${refresh ? '&refresh=1' : ''}`);
        } catch (error) {
            state.error = error.status === 403 ? L('NetCare 数据探查目前只开放给管理员。', 'NetCare Explorer is currently available to administrators only.') : error.message;
        } finally {
            state.loading = false;
            render();
        }
    }

    async function selectTable(name) {
        Object.assign(state, { selected: name, detail: null, detailError: '', detailLoading: true, query: null, queryResult: null, count: null });
        if (state.tab === 'sql' && !state.sqlText) state.tab = 'overview';
        render();
        try {
            const detail = await request('GET', `/tables/${encodeURIComponent(name)}?scope=${state.scope}`);
            if (state.selected === name) state.detail = detail;
        } catch (error) {
            if (state.selected === name) state.detailError = error.message;
        } finally {
            if (state.selected === name) {
                state.detailLoading = false;
                render();
            }
        }
    }

    function readNoteForm() {
        const note = {};
        root.querySelectorAll('[data-nx-note]').forEach(input => {
            note[input.dataset.nxNote] = input.type === 'checkbox' ? input.checked : input.value;
        });
        return note;
    }

    function readQueryForm() {
        const query = state.query || defaultQuery(state.detail);
        root.querySelectorAll('[data-nx-q]').forEach(input => { query[input.dataset.nxQ] = input.value; });
        root.querySelectorAll('[data-nx-filter]').forEach(input => { query.filters[Number(input.dataset.nxFilter)][input.dataset.key] = input.value; });
        root.querySelectorAll('[data-nx-metric]').forEach(input => { query.metrics[Number(input.dataset.nxMetric)][input.dataset.key] = input.value; });
        state.query = query;
        return query;
    }

    const splitList = text => String(text || '').split(',').map(item => item.trim()).filter(Boolean);

    async function runQuery() {
        const query = readQueryForm();
        state.queryBusy = true;
        render();
        try {
            state.queryResult = await request('POST', '/query', {
                scope: state.scope, table: state.selected,
                columns: splitList(query.columns),
                filters: query.filters.filter(filter => filter.column).map(filter => ({ column: filter.column, op: filter.op, value: filter.value })),
                groupBy: splitList(query.groupBy),
                metrics: query.metrics.filter(metric => metric.agg).map(metric => ({ agg: metric.agg, column: metric.column || '*', as: metric.as })),
                orderBy: query.orderBy.trim(), order: query.order, limit: Number(query.limit) || 200
            });
        } catch (error) {
            state.queryResult = { error: error.message, raw: error.raw };
        } finally {
            state.queryBusy = false;
            render();
        }
    }

    async function runSql(write) {
        const text = root.querySelector('[data-nx="sql"]')?.value || '';
        state.sqlText = text;
        if (!text.trim()) return;
        if (write) {
            const ok = await window.AppDialog?.confirm(L(`将在应用 schema 执行写入：\n\n${text.slice(0, 600)}\n\n基座不支持撤销，确认执行？`, `Run this write on the app schema?\n\n${text.slice(0, 600)}\n\nThis cannot be undone.`), { title: L('执行写入', 'Execute write'), tone: 'danger', confirmText: L('执行', 'Execute'), cancelText: L('取消', 'Cancel') });
            if (!ok) return;
        }
        state.sqlBusy = true;
        render();
        try {
            state.sqlResult = write ? await request('POST', '/execute', { sql: text }) : await request('POST', '/sql', { scope: state.scope, sql: text });
        } catch (error) {
            state.sqlResult = { error: error.message, raw: error.raw };
        } finally {
            state.sqlBusy = false;
            render();
        }
    }

    // ── 事件 ─────────────────────────────────────────────
    root.addEventListener('click', async event => {
        const tableButton = event.target.closest('[data-nx-table]');
        if (tableButton) return selectTable(tableButton.dataset.nxTable);
        const scope = event.target.closest('[data-nx-scope]')?.dataset.nxScope;
        if (scope && scope !== state.scope) {
            Object.assign(state, { scope, catalog: null, selected: '', detail: null, category: '', status: 'all', sqlResult: null });
            remember();
            return loadCatalog();
        }
        const status = event.target.closest('[data-nx-status]')?.dataset.nxStatus;
        if (status) {
            state.status = state.status === status ? 'all' : status;
            return refreshList();
        }
        const tab = event.target.closest('[data-nx-tab]')?.dataset.nxTab;
        if (tab) {
            if (state.tab === 'query') readQueryForm();
            if (state.tab === 'sql') state.sqlText = root.querySelector('[data-nx="sql"]')?.value || state.sqlText;
            state.tab = tab;
            remember();
            return render();
        }
        const button = event.target.closest('[data-nx-action]');
        if (!button) return undefined;
        const action = button.dataset.nxAction;
        try {
            if (action === 'refresh') return loadCatalog({ refresh: true });
            if (action === 'count') {
                button.disabled = true;
                button.textContent = L('计数中…', 'Counting…');
                state.count = await request('POST', `/tables/${encodeURIComponent(state.selected)}/count`, { scope: state.scope });
                return render();
            }
            if (action === 'apply-suggestions') {
                const suggestions = state.detail?.suggestions || {};
                for (const key of ['timeField', 'regionField', 'officeField']) {
                    const select = root.querySelector(`[data-nx-note="${key}"]`);
                    if (select && !select.value && suggestions[key]) select.value = suggestions[key];
                }
                return undefined;
            }
            if (action === 'save-note') {
                const note = readNoteForm();
                state.noteBusy = true;
                render();
                try {
                    const result = await request('PUT', `/tables/${encodeURIComponent(state.selected)}/notes?scope=${state.scope}`, note);
                    if (state.detail) state.detail.note = result.note;
                    const table = currentTable();
                    if (table) Object.assign(table, { nameCn: result.note.nameCn || table.nameCn, module: result.note.module || table.module, verified: result.note.verified, hidden: result.note.hidden, description: result.note.description });
                    window.showToast?.(L('标注已保存', 'Notes saved'), 'success');
                } finally {
                    state.noteBusy = false;
                    render();
                }
                return undefined;
            }
            if (action === 'add-filter') { readQueryForm().filters.push({ column: '', op: '=', value: '' }); return render(); }
            if (action === 'remove-filter') { readQueryForm().filters.splice(Number(button.dataset.index), 1); return render(); }
            if (action === 'add-metric') { readQueryForm().metrics.push({ agg: 'count', column: '', as: '' }); return render(); }
            if (action === 'remove-metric') { readQueryForm().metrics.splice(Number(button.dataset.index), 1); return render(); }
            if (action === 'reset-query') { state.query = defaultQuery(state.detail); state.queryResult = null; return render(); }
            if (action === 'run-query') return runQuery();
            if (action === 'export') return exportCsv(button.dataset.name.endsWith('-query') ? state.queryResult?.rows : state.sqlResult?.rows, button.dataset.name);
            if (action === 'export-sample') return exportCsv(state.detail?.sample, `${state.selected}-sample`);
            if (action === 'sql-template') {
                state.sqlText = state.scope === 'app' ? `SELECT * FROM ${state.selected} LIMIT 50` : `SELECT * FROM ${state.catalog?.schema || 'netcare'}.${state.selected} LIMIT 50`;
                return render();
            }
            if (action === 'sql-run') return runSql(false);
            if (action === 'sql-execute') return runSql(true);
        } catch (error) {
            window.showToast?.(error.message, 'error');
            render();
        }
        return undefined;
    });

    let searchTimer = null;
    root.addEventListener('input', event => {
        const key = event.target.dataset?.nx;
        if (key === 'q') {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { state.q = event.target.value; refreshList(); }, 150);
        } else if (key === 'sql') {
            state.sqlText = event.target.value;
        }
    });
    root.addEventListener('change', event => {
        const key = event.target.dataset?.nx;
        if (key === 'category' || key === 'status') {
            state[key] = event.target.value;
            refreshList();
        } else if (event.target.matches?.('[data-nx-filter][data-key="op"]')) {
            readQueryForm();
            render();
        }
    });
    root.addEventListener('keydown', event => {
        if (event.target.dataset?.nx === 'sql' && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            runSql(false);
        }
    });
    window.addEventListener('tools:languagechange', render);

    loadCatalog();
})();
