const fs = require('node:fs');
const path = require('node:path');
const { safeJson } = require('./static-snapshot-data');
const FRONTEND = path.join(__dirname, '../../frontend');
const MODULES = {
    uivf12: ['数据抓取', 'Data capture', 'uivf12.html'],
    sla: ['数据导入', 'Data import', 'sla.html'],
    report: ['报表看板', 'Report dashboard', 'report.html'],
    expedite: ['一键催办', 'Follow-up', 'expedite.html'],
    monthly: ['月报页面', 'Monthly reports', 'ai-report.html'],
    'topic-analysis': ['专题分析', 'Topic analysis', 'topic-analysis.html'],
    network_safety_meeting_summary: ['胶片设计', 'Slide design', null]
};
// Only explicit GET endpoints are invoked. No HTTP server, account credentials or
// live configuration APIs are used to build a snapshot.
function readRoute(router, url) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url, 'http://snapshot.invalid');
        let status = 200;
        const timer = setTimeout(() => reject(new Error('Snapshot read timed out: ' + parsed.pathname)), 30000);
        const finish = value => { clearTimeout(timer); status >= 400 ? reject(new Error(value?.error || 'Snapshot read failed')) : resolve(value); };
        const req = { method: 'GET', url: parsed.pathname + parsed.search, originalUrl: url, query: Object.fromEntries(parsed.searchParams), headers: {}, user: { role: 'user' }, get: () => '' };
        const res = { setHeader() {}, getHeader() {}, status(code) { status = code; return this; }, json: finish, send: finish };
        router.handle(req, res, error => { clearTimeout(timer); reject(error || new Error('Unknown snapshot endpoint: ' + url)); });
    });
}
async function collect(slug) {
    if (!MODULES[slug] && slug !== 'monthly-legacy') throw new Error('Unknown platform module');
    const responses = {};
    const add = async (prefix, route, suffix) => { responses[prefix + suffix] = await readRoute(require('../routes/' + route), suffix); return responses[prefix + suffix]; };
    const sla = suffix => add('/api/sla', 'sla', suffix);
    const db = async suffix => {
        require('../routes/db');
        const connection = require('./tenant-sqlite-pool').getConnection('report.db', 'report');
        await new Promise((resolve, reject) => connection.serialize(() => connection.get('PRAGMA schema_version', error => error ? reject(error) : resolve())));
        return add('/api/db', 'db', suffix);
    };
    if (['uivf12', 'sla', 'report', 'expedite', 'monthly-legacy'].includes(slug)) {
        for (const endpoint of ['/config', '/categories', '/groups', '/targets']) await sla(endpoint);
        // Only the latest import is needed for the online demo; keep its original values.
        const latest = (await sla('/snapshots/latest')).snapshot;
        responses['/api/sla/snapshots'] = latest ? [latest] : [];
        if (latest) responses['/api/sla/snapshots/' + latest.id] = latest;
        responses['/api/health'] = { status: 'ok', storage: 'snapshot' };
    }
    if (slug === 'uivf12') {
        await add('/api/uiv', 'uiv', '/scripts');
        responses['/api/uiv/scripts'] = require('./ai-sensitive-data').redactValue(responses['/api/uiv/scripts']);
        const { items } = await require('./uiv-categories-repository').listCategories();
        responses['/api/uiv/categories'] = items;
    }
    if (slug === 'sla') {
        const imports = require('./import-source-repository');
        const latest = responses['/api/sla/snapshots/latest'].snapshot;
        const catalog = await imports.catalog();
        // Keep only originals belonging to the selected latest import.
        catalog.files = (catalog.files || []).filter(file => latest && file.batch_id === latest.sourceBatchId);
        catalog.snapshots = (catalog.snapshots || []).filter(item => latest && item.id === latest.id);
        responses['/api/upload/source-catalog'] = catalog;
        responses['/api/upload/import-settings'] = await imports.getImportSettings();
        if (latest) {
            const archived = await imports.getArchivedSnapshot(latest.id);
            responses['/api/upload/source-snapshots/' + latest.id] = archived || latest;
            for (const file of catalog.files) for (const sheet of file.sheets || []) {
                responses['/api/upload/source-sheets/' + sheet.id] = await imports.getSheet(sheet.id);
            }
        }
        const prefs = responses['/api/sla/config'].prefs || {};
        for (const [key, value] of Object.entries(prefs)) responses['/api/sla/prefs/' + key] = value;
        await sla('/copied-fields');
    }
    if (['report', 'expedite'].includes(slug)) {
        const snapshots = await db('/snapshots');
        responses['/api/db/snapshots'] = snapshots.slice(0, 1);
        await db('/config/report_snapshot_filter');
        if (slug === 'report') {
            const saved = await db('/monthly_report_data');
            const raw = saved.latest_snapshot?.raw_data_json;
            if (raw) {
                const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (Array.isArray(snapshot.topMetrics)) responses['/api/sla/snapshots'] = [snapshot];
            }
            await db('/metric_count_trends?days=90');
            await db('/expiring_warning_trends?days=90');
        } else {
            await db('/config/welink_policy_v2');
            const latest = snapshots[0];
            if (latest) await db('/failing/' + encodeURIComponent(latest.snapshot_id) + '?month=' + encodeURIComponent(latest.month));
        }
    }
    if (slug === 'monthly-legacy') {
        Object.assign(responses, await require('./bigscreen-snapshot').collect());
        await db('/config/monthly_report_titles');
        await db('/config/welink_policy_v2');
    }
    if (slug === 'monthly') {
        const reports = require('./ai-report-repository');
        const list = (await reports.list()).slice(0, 1);
        responses['/api/ai-report/documents'] = list;
        for (const item of list) responses['/api/ai-report/documents/' + item.id] = await reports.read(item.id);
        await add('/api/ai-report', 'ai-report', '/template');
        responses['/api/ai-report/images'] = { items: [], total: 0 };
        responses.legacy = await collect('monthly-legacy');
    }
    if (slug === 'topic-analysis') {
        const repo = require('./topic-snapshots-repository');
        const listed = await repo.listSnapshots({ limit: 200 });
        const seen = new Set();
        listed.items = listed.items.filter(item => !seen.has(item.platform) && seen.add(item.platform));
        listed.total = listed.items.length;
        responses['/api/topic-snapshots'] = listed;
        responses['/api/topic-snapshots/mapping-config'] = { config: await repo.getMappingConfig() };
        for (const item of listed.items) responses['/api/topic-snapshots/' + item.id] = { item: await repo.getSnapshot(item.id) };
        const topic = suffix => add('/api/topic-snapshots', 'topic-snapshots', suffix);
        const eos = await topic('/eos-monthly-report');
        for (const month of eos.months || []) await topic('/eos-monthly-report?month=' + month);
        for (const item of require('../../frontend/js/shared/topic-monthly-engine').list) {
            const result = await topic('/monthly-report?topic=' + item.key);
            for (const month of result.months || []) await topic('/monthly-report?topic=' + item.key + '&month=' + month);
        }
    }
    if (slug === 'network_safety_meeting_summary') {
        const repo = require('./slide-design-repository');
        responses.projects = await Promise.all((await repo.listProjects()).map(item => repo.getProject(item.id)));
        responses.assets = [];
        const count = await repo.countAssets();
        for (let offset = 0; offset < count; offset += 500) {
            for (const asset of await repo.listAssets({ limit: 500, offset })) {
                const thumbnail = await repo.getAssetThumbnail(asset.id);
                responses.assets.push({ name: asset.sourceFilename || asset.fileName, summary: asset.summary, thumbnail: thumbnail && fs.existsSync(thumbnail.absolutePath) ? 'data:image/png;base64,' + fs.readFileSync(thumbnail.absolutePath).toString('base64') : '' });
            }
        }
    }
    return { responses: await embedMedia(responses) };
}
async function embedMedia(value) {
    // Resolve only tenant-owned media APIs referenced by saved content.
    if (Array.isArray(value)) return Promise.all(value.map(embedMedia));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await embedMedia(item)])));
    if (typeof value !== 'string') return value;
    const pattern = /\/api\/(?:ai-report\/images\/[\w-]+|upload\/monthly-logos\/[\w-]+\/image|slide-design\/assets\/[\w-]+\/thumbnail)(?:\?[^\s"'<>\\]*)?/g;
    let text = value;
    for (const url of new Set(value.match(pattern) || [])) {
        let image;
        if (url.startsWith('/api/ai-report/images/')) image = await require('./ai-report-images').read(url.split('/')[4].split('?')[0]);
        else if (url.startsWith('/api/upload/monthly-logos/')) {
            const logo = await require('./import-source-repository').getLogo(url.split('/')[4]);
            if (logo) image = { mime: logo.mime || 'image/png', bytes: logo.image_blob };
        } else {
            const thumbnail = await require('./slide-design-repository').getAssetThumbnail(url.split('/')[4]);
            if (thumbnail && fs.existsSync(thumbnail.absolutePath)) image = { mime: 'image/png', bytes: fs.readFileSync(thumbnail.absolutePath) };
        }
        if (image?.bytes) text = text.split(url).join('data:' + image.mime + ';base64,' + Buffer.from(image.bytes).toString('base64'));
    }
    return text;
}
const read = name => fs.readFileSync(path.join(FRONTEND, name), 'utf8');
function inlineCss(name) {
    return read(name).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, quote, url) => {
        if (/^(data:|https?:|#)/.test(url)) return match;
        const file = url.startsWith('/') ? path.join(FRONTEND, url) : path.resolve(FRONTEND, path.dirname(name), url.split('?')[0]);
        if (!file.startsWith(FRONTEND + path.sep) || !fs.existsSync(file)) return match;
        const type = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[path.extname(file)];
        return type ? 'url("data:' + type + ';base64,' + fs.readFileSync(file).toString('base64') + '")' : match;
    });
}
const script = source => '<script>' + source.replace(/<\/script/gi, '<\\/script') + '</script>';
function runtime(data, slug) {
    return `(${require('../../frontend/js/static-portal/platform-demo').toString()})(${safeJson(data)},${safeJson(slug)},${safeJson(MODULES)});`;
}
function render(slug, data) {
    if (slug === 'network_safety_meeting_summary') return renderSlides(data);
    let html = read('pages/' + (slug === 'monthly-legacy' ? 'monthly.html' : MODULES[slug][2]));
    if (slug === 'monthly') {
        const { legacy, ...responses } = data.responses;
        data = { ...data, responses, legacyHtml: data.legacyHref ? undefined : render('monthly-legacy', { ...legacy, homeHref: data.homeHref }) };
        html = html.replace('href="/monthly/legacy"', 'href="' + (data.legacyHref || '#classic-report') + '"');
    }
    if (slug === 'monthly-legacy') html = html.replace('<body>', '<body><a href="/monthly" class="tp-ai-report-return">AI 月报 / AI report</a>');
    if (slug === 'sla') {
        html = html.replace('await window.SLAUpload.restoreCachedWorkspace();', `const latest = await API.get('/api/sla/snapshots/latest');
                const catalog = await API.get('/api/upload/source-catalog');
                if (latest.snapshot && catalog.files.length) await window.SLAUpload.loadArchivedSnapshot(latest.snapshot);
                else if (latest.snapshot) await openHistoryModal();`);
    }
    if (slug === 'monthly') data.textAssets = { '/js/ai-report/render-kit.js': read('js/ai-report/render-kit.js') };
    const vendors = { 'echarts.min.js': 'js/vendor/echarts.min.js', 'xlsx.full.min.js': 'js/shared/xlsx.full.min.js', 'exceljs.min.js': 'js/shared/exceljs.min.js', 'html2canvas.min.js': 'js/shared/html2canvas.min.js', 'jspdf.umd.min.js': 'js/shared/jspdf.umd.min.js' };
    html = html.replace(/<script\b([^>]*?)src="([^"]+)"[^>]*><\/script>/g, (tag, attrs, url) => {
        if (/\/(?:navbar|platform-logo-upload)\.js/.test(url)) return '';
        let name = url.split('?')[0];
        if (/^https?:/.test(name)) name = vendors[name.split('/').pop().toLowerCase()];
        else name = name.replace(/^\//, '');
        if (!name) throw new Error('Missing offline script: ' + url);
        let source = read(name);
        if (slug === 'monthly' && name === 'js/ai-report/app.js') source = source.replace('preview:false', 'preview:true');
        return script(source);
    });
    html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, tag => {
        const match = tag.match(/href="\/([^"?]+)(?:\?[^"]*)?"/);
        return match ? '<style>' + inlineCss(match[1]) + '</style>' : '';
    });
    return html.replace(/<head([^>]*)>/i, '$&' + script(runtime(data, slug)));
}
function renderSlides(data) {
    // Saved decks are rendered in an opaque sandbox; editing/AI stays on the platform.
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>胶片设计 / Slide design</title><style>body{margin:0;background:#101c2e;color:#eef4ff;font:16px system-ui}main{padding:24px}select,button{padding:10px}iframe{width:100%;height:75vh;border:0;background:white}h1{font-size:24px}</style>${script(runtime(data, 'network_safety_meeting_summary'))}</head><body><main><h1>胶片设计 / Slide design</h1><select id="projects"></select><p id="empty"></p><iframe sandbox="allow-scripts" id="deck" title="Saved slides"></iframe></main><h2>素材库 / Slide library</h2><div id="library"></div>${script(`const assets=${safeJson(data.responses.assets || [])};for(const asset of assets){const card=document.createElement('article');const title=document.createElement('p');title.textContent=asset.name+' · '+(asset.summary||'');card.appendChild(title);if(asset.thumbnail){const image=document.createElement('img');image.src=asset.thumbnail;image.style.maxWidth='320px';card.appendChild(image);}document.getElementById('library').appendChild(card);}const projects=${safeJson(data.responses.projects)};const select=document.getElementById('projects');for(const project of projects)select.add(new Option(project.name,project.id));function show(){const item=projects.find(p=>p.id===select.value);document.getElementById('deck').srcdoc="<meta http-equiv='Content-Security-Policy' content=\\\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:;\\\">"+(item?.deckHtml||'');document.getElementById('empty').textContent=item?'':'暂无已保存项目 / No saved projects';}select.onchange=show;show();`)}</body></html>`;
}
function homeHref(slug, options = {}) {
    return path.posix.relative(path.posix.dirname(options.publishPath || slug + '/index.html'), 'index.html') || './index.html';
}
async function buildSnapshot(slug, options = {}) { return render(slug, { ...await collect(slug), homeHref: homeHref(slug, options) }); }
async function buildPagesSnapshot(slug, options = {}) {
    const data = { ...await collect(slug), homeHref: homeHref(slug, options) };
    const files = new Map();
    if (slug === 'monthly') {
        data.legacyHref = './legacy.html';
        files.set('legacy.html', render('monthly-legacy', { ...data.responses.legacy, homeHref: data.homeHref }));
    }
    return { html: render(slug, data), files };
}
module.exports = { MODULES, collect, render, readRoute, buildSnapshot, buildPagesSnapshot };
