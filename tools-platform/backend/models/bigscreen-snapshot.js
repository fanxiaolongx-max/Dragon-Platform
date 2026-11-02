const fs = require('fs');
const path = require('path');
const { safeJson } = require('./static-snapshot-data');
const FRONTEND = path.join(__dirname, '../../frontend');
const read = name => fs.readFileSync(path.join(FRONTEND, name), 'utf8');
const inline = source => source.replace(/<\/script/gi, '<\\/script');

// Use the same tenant-aware readers as the live dashboard, including saved scores.
function readData(reader, params = {}, query = {}) {
    return new Promise((resolve, reject) => {
        let status = 200;
        reader({ params, query }, {
            setHeader() {},
            status(value) { status = value; return this; },
            json(value) { if (status >= 400) reject(new Error(value.error || '读取大屏数据失败')); else resolve(value); }
        });
    });
}
async function collect() {
    const readers = require('../routes/db').dashboardReaders;
    const data = {};
    data['/api/db/monthly_report_data'] = await readData(readers.readDashboardMonthlyData);
    data.latestByDate = {};
    for (const row of data['/api/db/monthly_report_data'].trends) {
        const daily = await readData(readers.readDashboardMonthlyData, {}, { startDate: row.date, endDate: row.date });
        data.latestByDate[row.date] = daily.latest_snapshot;
    }
    data['/api/db/snapshots'] = await readData(readers.readDashboardSnapshots);
    for (const key of ['bigscreen_title', 'bigscreen_contact_info', 'bigscreen_owners']) {
        data['/api/db/config/' + key] = await readData(readers.readDashboardConfig, { key });
    }
    const { items: prefs } = await require('./sla-prefs-repository').getPrefsObject();
    data['/api/sla/config'] = { prefs: { i18nMap: prefs.i18nMap || {} } };
    return data;
}
function render(data) {
    let html = read('pages/bigscreen.html');
    html = html.replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g, '')
        .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, tag => {
            const href = tag.match(/href="\/([^\"]+)"/);
            return href ? `<style>${read(href[1])}</style>` : '';
        });
    const runtime = `
const data=${safeJson(data)};
window.API = {
    async get(url) {
        const parsed = new URL(url, 'https://snapshot.invalid');
        const captured = data[parsed.pathname];
        if (captured === undefined) throw new Error('静态快照无此数据 / Snapshot data unavailable');
        const value = JSON.parse(JSON.stringify(captured));
        if (parsed.pathname === '/api/db/monthly_report_data') {
            const start = parsed.searchParams.get('startDate');
            const end = parsed.searchParams.get('endDate');
            if (start && end) {
                value.trends = value.trends.filter(row => row.date >= start && row.date <= end);
                const latest = value.trends.at(-1);
                value.latest_snapshot = latest ? JSON.parse(JSON.stringify(data.latestByDate[latest.date])) : null;
                if (value.latest_snapshot) {
                    const previous = value.trends.at(-2);
                    value.latest_snapshot.previous_metrics = previous ? data.latestByDate[previous.date].metrics : [];
                }
            }
        }
        return value;
    },
    async post() { throw new Error('只读静态看板 / Read-only dashboard'); },
    getLastDataSourceMeta: () => ({ source: 'snapshot' })
};`;
    // Default to the full captured range so old snapshots remain visible over time.
    html = html.replace(/(<option value="90") selected/g, '$1').replace(/<option value="all"/g, '<option selected value="all"');
    html = html.replace('id="ownerConfigBtn"', 'id="ownerConfigBtn" hidden')
        .replace('onclick="BigscreenTitle.open()"', '').replace('onclick="editContactInfo()"', '');
    const scripts = [runtime, read('js/vendor/echarts.min.js'), read('js/shared/toast.js'), read('js/shared/i18n.js'), read('js/report/bigscreen.js')];
    return html.replace('</body>', `<button style="position:fixed;right:16px;bottom:16px;z-index:1000" onclick="ToolsI18n.toggleLanguage()">中文 / English</button>${scripts.map(source => `<script>${inline(source)}</script>`).join('\n')}</body>`);
}
async function buildSnapshot() { return render(await collect()); }
async function buildPagesSnapshot() { return { html: await buildSnapshot(), files: new Map() }; }
module.exports = { collect, render, buildSnapshot, buildPagesSnapshot };
