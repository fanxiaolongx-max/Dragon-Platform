const fs = require('fs');
const path = require('path');
const repo = require('./department-reward-penalty-repository');
const { getDataDir } = require('./tenant-context');
const tools = require('./custom-tools-repository');
const { collectMeetingData, collectIncentiveData, staticRuntimeSource } = require('./static-snapshot-data');
const { checkDemoSize } = require('./snapshot-size-policy');

const EVIDENCE = /^\/api\/department-reward-penalty\/evidence\/([a-f0-9-]{36}\.(?:pdf|png|jpg|txt|zip|rar|7z|tar|gz|eml|msg))$/i;
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', txt: 'text/plain', zip: 'application/zip', eml: 'message/rfc822' };
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

async function loadSource() {
    const sourcePath = await tools.getToolFilePath('department-reward-penalty');
    if (!sourcePath) throw new Error('负向事件管理工具尚未安装');
    const html = fs.readFileSync(sourcePath, 'utf8');
    const apiMarker = "const API = '/api/department-reward-penalty';";
    const requestMarker = "async function request(path,options){const response=await fetch(API+path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'请求失败');return data;}";
    if (!html.includes(apiMarker) || !html.includes(requestMarker)) throw new Error('工具页面版本与独立快照不兼容，请先更新快照适配器');
    return { html, apiMarker, requestMarker };
}

async function collectSnapshot(tenantId, evidenceMode, demoBudget) {
    const data = await repo.list();
    const evidenceDir = path.join(getDataDir(tenantId), 'department-reward-penalty-evidence');
    let evidenceBytes = 0;
    const evidenceFiles = new Map();
    const embedEvidence = url => {
        const match = EVIDENCE.exec(url);
        if (!match) return url;
        const filename = match[1];
        let bytes = evidenceFiles.get(filename);
        if (!bytes) {
            const file = path.join(evidenceDir, filename);
            if (demoBudget) {
                const total = evidenceBytes + fs.statSync(file).size;
                checkDemoSize(evidenceMode === 'inline' ? 4 * Math.ceil(total / 3) : total, demoBudget);
            }
            bytes = fs.readFileSync(file);
            evidenceFiles.set(filename, bytes);
            evidenceBytes += bytes.length;
        }
        if (evidenceMode === 'inline' && evidenceBytes > 100 * 1024 * 1024) throw new Error('证据附件超过 100 MB，无法生成单文件快照');
        if (evidenceMode === 'files') return './data/evidence/' + filename;
        const ext = filename.split('.').pop().toLowerCase();
        return 'data:' + (MIME[ext] || 'application/octet-stream') + ';base64,' + bytes.toString('base64') + '#' + filename;
    };
    for (const record of data.records) {
        const attachments = Array.isArray(record.attachments) ? record.attachments : String(record.attachment || '').split(';').filter(Boolean);
        const embedded = attachments.map(embedEvidence);
        record.attachments = embedded;
        // The page prefers attachments[]; keeping a second base64 copy in the legacy field
        // would needlessly double large evidence files in the exported HTML.
        record.attachment = '';
        if (record.revokeAttachment) record.revokeAttachment = embedEvidence(record.revokeAttachment);
    }
    return { snapshot: { ...data, canEdit: true, username: '' }, evidenceFiles };
}

async function collectAuditJson(trailingNewline) {
    // Serialize one page at a time. Keeping the entire parsed audit and then
    // escaping it as one large string can exceed the server's memory limit.
    const parts = [Buffer.from('[')];
    let hasRows = false;
    for (let page = 1;; page++) {
        const result = await repo.listAudit({ page, pageSize: 50 });
        if (result.rows.length) {
            const json = safeJson(result.rows);
            parts.push(Buffer.from((hasRows ? ',' : '') + json.slice(1, -1)));
            hasRows = true;
        }
        if (page >= result.totalPages) break;
    }
    // Keep identical business data byte-for-byte stable so scheduled runs do not create empty commits.
    parts.push(Buffer.from(trailingNewline ? ']\n' : ']'));
    return Buffer.concat(parts);
}

const { injectGatekeeper } = require('./snapshot-gatekeeper');

function addDemoNotice(html, level) {
    const label = level === 'latest' ? '只读演示 · 当前数据，不含历史审计 / Read-only demo · Current data without audit history'
        : level === 'empty' ? '只读演示 · 无业务数据 / Read-only demo · No business data' : '';
    return label ? html.replace(/<body\b[^>]*>/i, tag => tag + `<p role="status" style="text-align:center;margin:8px">${label}</p>`) : html;
}

async function buildSnapshot(tenantId, options = {}) {
    let { html, apiMarker, requestMarker } = await loadSource();
    const { snapshot, related, auditJson } = await collectDemo(tenantId, 'inline', options);
    const enc = options.encryption?.enabled && (options.encryption?.passwordHash || options.encryption?.hash) ? options.encryption : null;
    const offlineJson = safeJson(snapshot).slice(0, -1) + ',"audit":' + auditJson.toString('utf8') + '}';
    html = html.replace(apiMarker, () => apiMarker + '\nconst OFFLINE_SNAPSHOT = ' + offlineJson + ';\nconst TP_RELATED_SNAPSHOT = ' + safeJson(related) + ';\n' + staticRuntimeSource('TP_RELATED_SNAPSHOT', { incentive: true }) + '\nconst originalOfflineFetch = window.fetch.bind(window); window.fetch = (url, options = {}) => { if(String(url).startsWith("data:") || String(url).startsWith("blob:")) return originalOfflineFetch(url, options); const response = tpStaticApiResponse(url, options); if(response) return Promise.resolve(response); console.warn("[只读快照] 网络请求已拦截:", url); return Promise.resolve(tpStaticReadonlyResponse()); };');
    const offlineRequest = `async function request(path,options){
  if(typeof window !== 'undefined' && typeof window.tpIsUnlocked === 'function' && !window.tpIsUnlocked()) { throw new Error('请先输入访问密码解锁页面'); }
  if(options?.method && options.method !== 'GET') { await uiAlert('无权限，仅供查看。请联系管理员。','只读快照','warning','🔒'); throw new Error('无权限，仅供查看。请联系管理员。'); }
  if(path === '/') return OFFLINE_SNAPSHOT;
  if(path.startsWith('/audit')) { const params = new URLSearchParams(path.split('?')[1] || ''); const size = Math.min(200,Math.max(1,Number(params.get('pageSize')) || 20)); const total = OFFLINE_SNAPSHOT.audit.length; const totalPages = Math.max(1,Math.ceil(total/size)); const page = Math.min(totalPages,Math.max(1,Number(params.get('page')) || 1)); return {rows:OFFLINE_SNAPSHOT.audit.slice((page-1)*size,page*size),total,page,pageSize:size,totalPages}; }
  if(path === '/security') return {hasCustomPin:true};
  if(path === '/snapshot-mappings') return OFFLINE_SNAPSHOT.snapshotMappings || { roles: [], customerGroups: [], businessUnits: [] };
  await uiAlert('无权限，仅供查看。请联系管理员。','只读快照','warning','🔒'); throw new Error('无权限，仅供查看。请联系管理员。');
}`;
    html = html.replace(requestMarker, offlineRequest);
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src data:; object-src blob: data:; frame-src blob: data:; form-action 'none'; base-uri 'none'">`);
    html = addDemoNotice(html, options.demoLevel);
    if (enc) html = injectGatekeeper(html, enc);
    return html;
}

async function collectDemo(tenantId, evidenceMode, { demoLevel: level, demoBudget }) {
    if (level === 'empty') return {
        snapshot: { personnel: [], rules: [], records: [], roles: [], deductions: [], deductionCategories: [],
            customerGroups: [], businessUnits: [], canEdit: true, username: '' },
        evidenceFiles: new Map(), related: {}, auditJson: Buffer.from('[]')
    };
    if (demoBudget && level !== 'latest') checkDemoSize(await repo.getAuditPayloadBytes(), demoBudget);
    const { snapshot, evidenceFiles } = await collectSnapshot(tenantId, evidenceMode, demoBudget);
    if (level === 'latest') return { snapshot, evidenceFiles, related: {}, auditJson: Buffer.from('[]') };
    const [meetingData, incentiveData] = await Promise.all([collectMeetingData(), collectIncentiveData()]);
    const related = {
        meeting: { roster: meetingData.roster, attendance: meetingData.attendance },
        incentive: { roster: incentiveData.roster }
    };
    return { snapshot, evidenceFiles, related, auditJson: await collectAuditJson(evidenceMode === 'files') };
}

async function buildPagesSnapshot(tenantId, options = {}) {
    let { html, apiMarker, requestMarker } = await loadSource();
    const { snapshot, evidenceFiles, related, auditJson } = await collectDemo(tenantId, 'files', options);
    const enc = options.encryption?.enabled && (options.encryption?.passwordHash || options.encryption?.hash) ? options.encryption : null;
    html = html.replace(apiMarker, apiMarker + `
let PAGES_SNAPSHOT = null;
let TP_RELATED_SNAPSHOT = null;
${staticRuntimeSource('TP_RELATED_SNAPSHOT', { incentive: true })}
const pagesFetch = window.fetch.bind(window);
async function loadRelatedSnapshot(){
  if(!TP_RELATED_SNAPSHOT){
    const response = await pagesFetch('./data/related.json',{cache:'no-store'});
    if(!response.ok) throw new Error('关联数据读取失败：HTTP '+response.status);
    TP_RELATED_SNAPSHOT = await response.json();
  }
  return TP_RELATED_SNAPSHOT;
}
window.fetch = async (url, options = {}) => {
  const raw = String(url || '');
  if(raw.startsWith('./data/') || raw.startsWith('data:') || raw.startsWith('blob:')) return pagesFetch(url, options);
  await loadRelatedSnapshot();
  return tpStaticApiResponse(url, options) || tpStaticReadonlyResponse();
};`);
    const pagesRequest = `async function request(path,options){
  if(typeof window !== 'undefined' && typeof window.tpIsUnlocked === 'function' && !window.tpIsUnlocked()) { throw new Error('请先输入访问密码解锁页面'); }
  if(options?.method && options.method !== 'GET') { await uiAlert('无权限，仅供查看。请联系管理员。','只读页面','warning','🔒'); throw new Error('无权限，仅供查看。请联系管理员。'); }
  if(path === '/') {
    const names = ['state','records','audit'];
    const responses = await Promise.all(names.map(name => pagesFetch('./data/'+name+'.json',{cache:'no-store'})));
    for(const response of responses) if(!response.ok) throw new Error('静态数据读取失败：HTTP '+response.status);
    const [base,records,audit] = await Promise.all(responses.map(response => response.json()));
    PAGES_SNAPSHOT = {...base,records,audit};
    return PAGES_SNAPSHOT;
  }
  if(path.startsWith('/audit')) {
    if(!PAGES_SNAPSHOT) await request('/');
    const params = new URLSearchParams(path.split('?')[1] || '');
    const size = Math.min(200,Math.max(1,Number(params.get('pageSize')) || 20));
    const total = PAGES_SNAPSHOT.audit.length;
    const totalPages = Math.max(1,Math.ceil(total/size));
    const page = Math.min(totalPages,Math.max(1,Number(params.get('page')) || 1));
    return {rows:PAGES_SNAPSHOT.audit.slice((page-1)*size,page*size),total,page,pageSize:size,totalPages};
  }
  if(path === '/security') return {hasCustomPin:true};
  if(path === '/snapshot-mappings') { if(!PAGES_SNAPSHOT) await request('/'); return PAGES_SNAPSHOT.snapshotMappings || { roles: [], customerGroups: [], businessUnits: [] }; }
  await uiAlert('无权限，仅供查看。请联系管理员。','只读页面','warning','🔒'); throw new Error('无权限，仅供查看。请联系管理员。');
}`;
    html = html.replace(requestMarker, pagesRequest);
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src data:; object-src 'self' blob: data:; frame-src 'self' blob: data:; form-action 'none'; base-uri 'none'">`);
    html = addDemoNotice(html, options.demoLevel);
    if (enc) html = injectGatekeeper(html, enc);
    const { records, ...state } = snapshot;
    const files = new Map([
        ['data/state.json', safeJson(state) + '\n'],
        ['data/records.json', safeJson(records) + '\n'],
        ['data/audit.json', auditJson],
        ['data/related.json', safeJson(related) + '\n']
    ]);
    for (const [name, bytes] of evidenceFiles) files.set('data/evidence/' + name, bytes);
    return { html, files };
}

module.exports = { buildSnapshot, buildPagesSnapshot };
