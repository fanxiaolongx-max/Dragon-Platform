/**
 * shared/api.js - 前端统一 API 请求模块
 */

const API_BASE = window.location.origin;
const lastDataSourceByPath = {};
// 只合并工具目录的进行中请求；请求结束即释放，不缓存已完成的业务数据。
const pendingCustomToolGets = new Map();
const DATA_SOURCE_MODE_KEY = 'tools_data_source_modes';

const dataSourceEvents = [];
let dataSourcePinned = false;
const dataSourceText = (zh,en) => window.ToolsI18n?.getLanguage()==='en-US'?en:zh;
function formatSourceLabel(source) {
    if (!source) return 'unknown';
    return source==='sqlite'?'SQLite':source==='json'?'JSON':String(source).toUpperCase();
}
function ensureDataSourceBadge() {
    let badge = document.getElementById('dataSourceBadge');
    if (badge) return badge;
    const style=document.createElement('style');style.textContent=`
    #dataSourceBadge{position:fixed;left:16px;bottom:16px;z-index:99999;max-width:min(260px,calc(100vw - 32px));padding:7px 11px;border:1px solid #7891ab66;border-radius:10px;background:#172b40ed;color:#e2e8f0;font:11px/1.5 system-ui,sans-serif;box-shadow:0 5px 20px #0002;backdrop-filter:blur(12px);text-align:left;cursor:pointer;transition:opacity .25s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #dataSourceBadge[hidden]{display:none}\n    #dataSourceBadge:hover,#dataSourceBadge:focus-visible{background:#26425d;color:#fff}
    #dataSourceDetail{position:fixed;left:16px;bottom:54px;z-index:100000;box-sizing:border-box;width:min(480px,calc(100vw - 32px));max-height:min(540px,calc(100vh - 100px));padding:16px;border:1px solid #809ab466;border-radius:14px;background:#172b40f5;color:#e2e8f0;font:12px/1.6 system-ui,sans-serif;box-shadow:0 10px 32px #0003;backdrop-filter:blur(16px);overflow:auto;overflow-wrap:anywhere}
    #dataSourceDetail header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}#dataSourceDetail button{border:1px solid #8ba2ba66;border-radius:7px;background:#26425d;color:#fff;padding:3px 9px;cursor:pointer}#dataSourceDetail ol{margin:0;padding:0;list-style:none}#dataSourceDetail li{border-top:1px solid #809ab433;padding:9px 0}#dataSourceDetail small{display:block;color:#b8cadc}#dataSourceDetail code{display:block;font-size:11px;white-space:normal}
    `;document.head.append(style);
    badge=document.createElement('button');badge.id='dataSourceBadge';badge.type='button';badge.hidden=true;badge.setAttribute('aria-expanded','false');badge.onclick=()=>{dataSourcePinned=true;clearTimeout(badge._fadeTimer);renderDataSourceDetails();};document.body.append(badge);
    return badge;
}
function closeDataSourceDetails(){dataSourcePinned=false;document.getElementById('dataSourceDetail')?.remove();const badge=document.getElementById('dataSourceBadge');if(badge){clearTimeout(badge._fadeTimer);badge.hidden=true;badge.setAttribute('aria-expanded','false');}}
function renderDataSourceDetails(){
    let panel=document.getElementById('dataSourceDetail');if(!panel){panel=document.createElement('section');panel.id='dataSourceDetail';panel.setAttribute('aria-label',dataSourceText('数据来源详情','Data source details'));document.body.append(panel);}panel.replaceChildren();
    const head=document.createElement('header'),title=document.createElement('strong'),close=document.createElement('button');title.textContent=dataSourceText('数据来源 · 最近请求','Data sources · Recent requests');close.textContent='×';close.setAttribute('aria-label',dataSourceText('关闭','Close'));close.onclick=closeDataSourceDetails;head.append(title,close);panel.append(head);
    const list=document.createElement('ol');for(const item of dataSourceEvents.slice().reverse()){const row=document.createElement('li'),source=document.createElement('strong'),url=document.createElement('code'),time=document.createElement('small');source.textContent=formatSourceLabel(item.source);url.textContent=item.path;time.textContent='GET · '+item.time;row.append(source,time,url);for(const [key,value]of Object.entries(item.extras)){const detail=document.createElement('small');detail.textContent=key+': '+String(value).slice(0,300);row.append(detail);}list.append(row);}panel.append(list);document.getElementById('dataSourceBadge').setAttribute('aria-expanded','true');
}
function updateDataSourceHint(path, source) {
    if (!source || !document.body) return;
    const badge=ensureDataSourceBadge(),safePath=String(path||'').split('?')[0],now=new Date().toLocaleTimeString(undefined,{hour12:false});
    dataSourceEvents.push({path:safePath,source,time:now,extras:lastDataSourceByPath[path]?.extras||{}});if(dataSourceEvents.length>8)dataSourceEvents.shift();
    badge.textContent=dataSourceText('来源：','Source: ')+formatSourceLabel(source)+' · '+now;badge.title=dataSourceText('点击展开来源详情并保持显示','Click to open and keep source details visible');badge.hidden=false;clearTimeout(badge._fadeTimer);
    if(dataSourcePinned)renderDataSourceDetails();else badge._fadeTimer=setTimeout(()=>{badge.hidden=true;},3600);
    console.info(`[DATA SOURCE] ${safePath} <- ${formatSourceLabel(source)}`);
}
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&dataSourcePinned)closeDataSourceDetails();});
window.addEventListener('tools:languagechange',()=>{if(dataSourcePinned)renderDataSourceDetails();});

function readSourceModeMap() {
    try {
        return JSON.parse(localStorage.getItem(DATA_SOURCE_MODE_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function writeSourceModeMap(map) {
    localStorage.setItem(DATA_SOURCE_MODE_KEY, JSON.stringify(map));
}

function extractDataSourceMeta(res, path) {
    const meta = {
        primary: res.headers.get('X-Data-Source') || null,
        extras: {}
    };

    for (const [headerName, headerValue] of res.headers.entries()) {
        const lower = headerName.toLowerCase();
        if (!lower.startsWith('x-data-source-')) continue;
        const key = lower.replace('x-data-source-', '');
        if (!key) continue;
        meta.extras[key] = headerValue;
    }

    if (path && (meta.primary || Object.keys(meta.extras).length > 0)) {
        lastDataSourceByPath[path] = meta;
    }

    return meta;
}

function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('tools_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
        const isDesktop = Boolean(window.electronAPI || window.process?.type === 'renderer' || navigator.userAgent.includes('Electron'));
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        headers['X-Client-Platform'] = isDesktop ? 'desktop' : (isMobile ? 'mobile_web' : 'web');
    }
    return headers;
}

async function handleResponse(res, requestMeta = {}) {
    const body = await res.json().catch(() => ({}));
    const isPlatformAuthFailure = res.status === 401
        && ['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(body.code);

    if (isPlatformAuthFailure) {
        // Only platform authentication failures may clear the current session.
        // A downstream service (for example an AI provider) can also return 401.
        localStorage.removeItem('tools_token');
        localStorage.removeItem('tools_user');
        localStorage.removeItem('tools_role');
        if (typeof document !== 'undefined') {
            document.cookie = 'tools_token=; path=/; max-age=0';
        }
        if ((window.__TP_STATIC_PATH__ || window.location.pathname) !== './login.html') {
            const currentParams = new URLSearchParams(window.location.search);
            const loginParams = new URLSearchParams();
            ['welcome', 'version', 'from'].forEach(key => {
                const value = currentParams.get(key);
                if (value) loginParams.set(key, value);
            });
            const suffix = loginParams.toString() ? `?${loginParams.toString()}` : '';
            window.location.href = `/login.html${suffix}`;
        }
    }
    
    if (!res.ok) {
        const err = new Error(body.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = body;
        throw err;
    }

    if (requestMeta.method !== 'GET' && /^\/api\/custom-tools(?:\/|$)/.test(requestMeta.path || '')) {
        pendingCustomToolGets.clear();
    }

    const sourceMeta = extractDataSourceMeta(res, requestMeta.path || '');
    const source = sourceMeta.primary;

    if (source && requestMeta.method === 'GET') {
        updateDataSourceHint(requestMeta.path || '', source);
    }

    return body;
}

const API = {
    get: async function(path) {
        const headers = getAuthHeaders();
        const request = async () => {
            const res = await fetch(`${API_BASE}${path}`, { headers });
            return handleResponse(res, { method: 'GET', path });
        };
        if (path !== '/api/custom-tools') return request();
        const key = JSON.stringify([headers.Authorization || '', localStorage.getItem('tools_user'), localStorage.getItem('tools_tenant_id') || 'default']);
        let pending = pendingCustomToolGets.get(key);
        if (!pending) {
            pending = request().finally(() => {
                if (pendingCustomToolGets.get(key) === pending) pendingCustomToolGets.delete(key);
            });
            pendingCustomToolGets.set(key, pending);
        }
        // 调用方仍持有独立的数据副本，避免互相修改目录元数据。
        return JSON.parse(JSON.stringify(await pending));
    },
    post: async function(path, body, { onEvent } = {}) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok || !res.headers.get('Content-Type')?.includes('application/x-ndjson')) return handleResponse(res, { method: 'POST', path });
        const reader = res.body.getReader(), decoder = new TextDecoder();
        let buffer = '', result, completed = false;
        const consume = line => {
            if (!line.trim()) return;
            const event = JSON.parse(line);
            if (event.type === 'result') { result = event; completed = true; }
            else onEvent?.(event);
        };
        try {
            while (true) {
                const { value, done } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                let end;
                while ((end = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
                if (done) break;
            }
            if (buffer.trim()) consume(buffer);
            if (!completed) throw new Error('连接中断，未收到最终结果 / Connection closed before the final result');
            // Reuse the existing auth/error contract for errors delivered after stream headers.
            onEvent?.({ type: 'complete', requestId: result.requestId, status: result.status, ms: result.ms });
            const reply = await handleResponse(new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } }), { method: 'POST', path });
            return reply;
        } finally { reader.releaseLock(); }
    },
    put: async function(path, body) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        return handleResponse(res, { method: 'PUT', path });
    },
    delete: async function(path) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        return handleResponse(res, { method: 'DELETE', path });
    },
    deleteWithBody: async function(path, body) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        return handleResponse(res, { method: 'DELETE', path });
    },
    patch: async function(path, body) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        return handleResponse(res, { method: 'PATCH', path });
    },
    logHistory: async function(tool, action, detail = '') {
        try {
            await this.post('/api/upload/history', { tool, action, detail });
        } catch (e) {
            // 历史记录失败不影响主流程
        }
    },
    getLastDataSource: function(path) {
        const meta = lastDataSourceByPath[path];
        return meta ? meta.primary : null;
    },
    getLastDataSourceMeta: function(path) {
        return lastDataSourceByPath[path] || null;
    },
    getSourceMode: function(scope = 'default') {
        const map = readSourceModeMap();
        const mode = map[scope];
        return ['auto', 'sqlite'].includes(mode) ? mode : 'auto';
    },
    setSourceMode: function(scope = 'default', mode = 'auto') {
        const normalized = ['auto', 'sqlite'].includes(mode) ? mode : 'auto';
        const map = readSourceModeMap();
        map[scope] = normalized;
        writeSourceModeMap(map);
        return normalized;
    }
};

window.API = API;

// JSZip 约 98KB，只在上传 zip 包时才用到，按需加载；加载失败返回 false，由调用方决定降级。
let jsZipPromise = null;
function ensureJSZip() {
    if (window.JSZip) return Promise.resolve(true);
    jsZipPromise ||= new Promise(resolve => {
        const script = document.createElement('script');
        script.src = './tp-static/frontend/js/shared/jszip.min.js';
        script.onload = () => resolve(Boolean(window.JSZip));
        script.onerror = () => { jsZipPromise = null; resolve(false); };
        document.head.append(script);
    });
    return jsZipPromise;
}
window.ensureJSZip = ensureJSZip;

// 页面版本徽标统一显示平台发布版本，资源 ?v= 现由服务端按内容哈希生成，不再代表版本。
let toolsAppVersionPromise = null;
window.ToolsAppVersion = {
    get() {
        if (!toolsAppVersionPromise) {
            toolsAppVersionPromise = fetch('/api/app-version', { cache: 'no-store' })
                .then(res => (res.ok ? res.json() : null))
                .then(data => (data && data.version ? String(data.version) : ''))
                .catch(() => '');
        }
        return toolsAppVersionPromise;
    }
};

// Desktop notices share one compact, theme-aware dialog on every page.
(() => {
    const en = () => (localStorage.getItem('tools_lang') || document.documentElement.lang).startsWith('en');
    const tr = (zh, english) => en() ? english : zh;
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const version = value => value ? `v${String(value).replace(/^v/i, '')}` : '—';
    let active, status = {}, manual = false, dismissed = '';
    function styles() {
        if (document.getElementById('tools-dialog-style')) return;
        const style = document.createElement('style'); style.id = 'tools-dialog-style';
        style.textContent = `
.tools-dialog-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(26,32,44,.22);backdrop-filter:blur(6px);-webkit-app-region:no-drag}
.tools-dialog{--td-bg:#fff;--td-ink:#111827;--td-muted:#6b7280;--td-line:#e8eaee;--td-soft:#f5f6f8;box-sizing:border-box;position:relative;width:min(480px,100%);max-height:calc(100dvh - 40px);overflow:auto;padding:36px;color:var(--td-ink);background:var(--td-bg);border:1px solid var(--td-line);border-radius:24px;box-shadow:0 24px 64px -16px #10182840;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;text-align:left}
html[data-theme="dark"] .tools-dialog{--td-bg:#20242c;--td-ink:#f3f4f6;--td-muted:#a8b0bd;--td-line:#393f4a;--td-soft:#2c323c;color-scheme:dark}
.tools-dialog *{box-sizing:border-box}.tools-dialog h2{font-size:25px;line-height:1.3;margin:18px 0 8px;color:var(--td-ink)}
.tools-dialog-close{position:absolute;right:18px;top:18px;border:0;border-radius:50%;width:30px;height:30px;background:var(--td-soft);color:var(--td-muted);cursor:pointer;font-size:20px}
.tools-dialog-badge{display:flex;gap:12px;align-items:center;color:var(--td-muted);font-size:11px;letter-spacing:.12em}.tools-dialog-badge img{width:44px;height:44px;object-fit:contain;padding:6px;border:1px solid var(--td-line);border-radius:14px;background:var(--td-soft)}
.tools-dialog-version{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:var(--td-muted);font-variant-numeric:tabular-nums}.tools-dialog-version b{color:var(--td-ink)}
.tools-dialog-section{margin-top:24px;padding-top:20px;border-top:1px solid var(--td-line)}.tools-dialog-label{font-size:12px;color:var(--td-muted)}
.tools-dialog-notes{padding-left:18px;margin:12px 0 26px;max-height:220px;overflow:auto;overflow-wrap:anywhere}.tools-dialog-notes li{padding:5px 0}.tools-dialog-notes li::marker{color:var(--td-muted)}
.tools-dialog-actions{display:flex;justify-content:flex-end;gap:12px;margin-top:20px}.tools-dialog button:focus-visible,.tools-dialog textarea:focus-visible{outline:2px solid #588cef;outline-offset:3px}.tools-dialog-btn{border:1px solid var(--td-line);background:var(--td-soft);color:var(--td-ink);padding:10px 20px;min-height:42px;border-radius:12px;cursor:pointer;font:inherit}.tools-dialog-btn.primary{background:var(--td-ink);color:var(--td-bg);border-color:transparent;flex:1}.tools-dialog-btn:disabled{opacity:.45;cursor:default}
.tools-dialog-status{color:var(--td-muted);font-size:13px;margin-top:14px;overflow-wrap:anywhere}.tools-dialog-progress{height:6px;margin-top:16px;border-radius:999px;background:var(--td-soft);overflow:hidden}.tools-dialog-progress[hidden]{display:none}.tools-dialog-progress i{display:block;height:100%;width:0;border-radius:inherit;background:var(--td-ink);transition:width .3s ease}.tools-feedback{width:min(560px,100%);padding:24px}.tools-feedback h2{font-size:17px;margin:0 0 18px}.tools-feedback-editor{border:1px solid var(--td-line);border-radius:13px;padding:10px;transition:border-color .15s ease,box-shadow .15s ease}.tools-feedback-editor:focus-within{border-color:var(--td-muted);box-shadow:0 0 0 3px var(--td-soft)}.tools-feedback textarea{display:block;width:100%;height:190px;resize:vertical;max-height:35vh;background:transparent;color:var(--td-ink);border:0;border-radius:8px;padding:4px;outline:none;font:inherit}.tools-feedback textarea:is(:focus,:focus-visible){outline:none!important;border:0!important;box-shadow:none!important}.tools-feedback-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;color:var(--td-muted);font-size:12px}.tools-feedback-toolbar button{min-height:32px;padding:4px 10px;border-radius:8px}.tools-feedback-previews{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.tools-feedback-image{position:relative}.tools-feedback-image img{display:block;width:58px;height:58px;object-fit:cover;border-radius:8px}.tools-feedback-image button{position:absolute;right:-4px;top:-6px;border:0;border-radius:50%;cursor:pointer}.tools-feedback-privacy{display:flex;gap:8px;color:var(--td-muted);font-size:12px;margin-top:18px}.tools-feedback .primary{flex:0 1 auto}
@media(max-width:540px){.tools-dialog-overlay{padding:12px}.tools-dialog{padding:28px 22px;border-radius:20px}.tools-feedback{padding:22px}.tools-dialog h2{font-size:22px}}
`;
        document.head.append(style);
    }
    function open(content, feedback = false) {
        active?.close(); styles();
        const previous = document.activeElement;
        const overlay = document.createElement('div'); overlay.className = 'tools-dialog-overlay';
        overlay.innerHTML = `<section class="tools-dialog${feedback ? ' tools-feedback' : ''}" role="dialog" aria-modal="true" aria-labelledby="tools-dialog-title" tabindex="-1"><button class="tools-dialog-close" aria-label="${tr('关闭', 'Close')}">×</button>${content}</section>`;
        const close = () => { document.removeEventListener('keydown', keydown); overlay.remove(); if (active?.overlay === overlay) active = null; previous?.isConnected && previous.focus(); };
        const keydown = event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            if (event.key !== 'Tab') return;
            const nodes = [...overlay.querySelectorAll('button:not(:disabled),textarea,input:not([hidden])')].filter(n => n.getClientRects().length);
            const first = nodes[0], last = nodes.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay.firstChild)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        overlay.querySelector('.tools-dialog-close').onclick = close;
        document.addEventListener('keydown', keydown); document.body.append(overlay);
        overlay.querySelector('section').focus(); active = { overlay, close }; return active;
    }
    // Release metadata is untrusted; render only plain text, never publisher HTML.
    function notes(raw) {
        const values = Array.isArray(raw) ? raw.map(n => typeof n === 'string' ? n : n.note || '') : [raw || ''];
        const text = values.join('\n').replace(/<\/(?:p|li|div)>|<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '');
        return text.split(/\r?\n/).map(s => s.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim()).filter(Boolean).slice(0, 30);
    }
    function updateDialog(next, completed = false, from = '') {
        if (active?.kind === 'feedback') return;
        const items = notes(next.releaseNotes);
        const dialog = open(`<div class="tools-dialog-badge"><img src="./tp-static/frontend/assets/logo.png" alt=""><span>VERSION UPDATE</span></div><h2 id="tools-dialog-title">${tr(completed ? '更新已完成' : '发现新版本', completed ? 'Update complete' : 'New version available')}</h2><div class="tools-dialog-version"><span>${escape(version(from || next.version))}</span><span aria-label="${tr('升级至', 'to')}">→</span><b>${escape(version(next.latestVersion))}</b></div><div class="tools-dialog-section"><div class="tools-dialog-label">${tr('本次更新', 'What’s new')}</div><ul class="tools-dialog-notes">${(items.length ? items : [tr('此版本未提供更新说明。', 'No release notes provided for this version.')]).map(n => `<li>${escape(n)}</li>`).join('')}</ul></div><div class="tools-dialog-actions">${completed ? '' : `<button class="tools-dialog-btn" data-later>${tr('稍后提醒', 'Later')}</button>`}<button class="tools-dialog-btn primary" data-update>${tr(completed ? '开始使用' : '立即更新', completed ? 'Continue' : 'Update now')}</button></div><div class="tools-dialog-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden><i></i></div><div class="tools-dialog-status" role="status"></div>`);
        dialog.kind = completed ? 'completed' : 'update';
        dialog.overlay.querySelector('[data-later]')?.addEventListener('click', () => { dismissed = next.latestVersion; dialog.close(); });
        const button = dialog.overlay.querySelector('[data-update]');
        button.onclick = async () => {
            if (completed) return dialog.close();
            button.disabled = true;
            try { handleStatus(await (status.state === 'downloaded' ? window.ToolsUpdater.install() : status.state === 'available' ? window.ToolsUpdater.download() : window.ToolsUpdater.check()), true); }
            catch { dialog.overlay.querySelector('[role="status"]').textContent = tr('更新失败，请稍后重试。', 'Update failed. Please try again.'); button.disabled = false; }
        };
        const closeButton = dialog.overlay.querySelector('.tools-dialog-close');
        closeButton.addEventListener('click', () => { dismissed = next.latestVersion; });
        return dialog;
    }
    function statusMessage(next) {
        if (!en()) return next.message || '';
        return ({ checking: 'Checking for updates…', 'not-available': 'You are up to date.',
            downloading: `Downloading update ${Math.max(0, Math.min(100, Number(next.progress) || 0))}%`,
            downloaded: 'Update downloaded. Restart to install.', installing: 'Restarting to install the update…',
            error: 'Unable to update. Please try again later.', 'dev-unavailable': 'Automatic updates are unavailable in development mode.',
            'portable-manual': 'Download the new portable version from GitHub Releases.' })[next.state] || '';
    }
    function handleStatus(next, force = false) {
        if (!next) return; status = next;
        if (force && ['downloaded', 'downloading'].includes(next.state) && active?.kind !== 'update') updateDialog(next);
        if (next.state === 'available' && (force || manual || (!next.suppressPrompt && dismissed !== next.latestVersion))) updateDialog(next);
        else if (active?.kind === 'update') {
            const message = active.overlay.querySelector('[role="status"]');
            message.textContent = statusMessage(next);
            // 下载进度条：下载中实时推进，下载完成 / 安装中保持满格
            const bar = active.overlay.querySelector('.tools-dialog-progress');
            if (bar) {
                const percent = next.state === 'downloading' ? Math.max(0, Math.min(100, Number(next.progress) || 0)) : 100;
                bar.hidden = !['downloading', 'downloaded', 'installing'].includes(next.state);
                bar.setAttribute('aria-valuenow', String(percent));
                bar.firstElementChild.style.width = `${percent}%`;
            }
            const button = active.overlay.querySelector('[data-update]');
            button.disabled = ['checking', 'downloading', 'installing'].includes(next.state);
            if (next.state === 'downloaded') button.textContent = tr('重启并安装', 'Restart and install');
            if (next.state === 'error') button.textContent = tr('重试', 'Retry');
        } else if (manual && !['checking', 'available'].includes(next.state)) {
            open(`<h2 id="tools-dialog-title">${tr('检查更新', 'Check for updates')}</h2><p role="status">${escape(statusMessage(next))}</p>`);
        }
        if (next.state !== 'checking') manual = false;
    }
    async function checkUpdate() {
        if (!window.ToolsUpdater) { open(`<h2 id="tools-dialog-title">${tr('检查更新', 'Check for updates')}</h2><p>${tr('请在桌面版中检查应用更新。', 'Open the desktop app to check for updates.')}</p>`); return; }
        manual = true;
        const dialog = open(`<h2 id="tools-dialog-title">${tr('检查更新', 'Check for updates')}</h2><p role="status">${tr('正在检查更新…', 'Checking for updates…')}</p>`);
        try { handleStatus(await window.ToolsUpdater.check(), true); }
        catch { manual = false; if (dialog.overlay.isConnected) dialog.overlay.querySelector('[role="status"]').textContent = tr('检查失败，请稍后重试。', 'Check failed. Please try again.'); }
    }
    function feedback() {
        const dialog = open(`<h2 id="tools-dialog-title">${tr('意见反馈', 'Feedback')}</h2><div class="tools-feedback-editor"><textarea maxlength="10000" aria-label="${tr('描述你遇到的问题', 'Describe the problem')}" placeholder="${tr('描述你遇到的问题', 'Describe the problem')}"></textarea><div class="tools-feedback-previews"></div><div class="tools-feedback-toolbar"><button class="tools-dialog-btn" data-images>${tr('上传图片', 'Add images')} (<span data-count>0</span>/6)</button><span><span data-length>0</span>/10000</span></div><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></div><p class="tools-feedback-privacy">${tr('反馈和图片将随你的用户名提交到需求广场，所有登录用户可见。', 'Your feedback and images will be posted under your username and visible to signed-in users.')}</p><div class="tools-dialog-status" role="status"></div><div class="tools-dialog-actions"><button class="tools-dialog-btn primary" data-submit disabled>${tr('提交反馈', 'Submit feedback')}</button></div>`, true);
        dialog.kind = 'feedback';
        const area = dialog.overlay.querySelector('textarea'), input = dialog.overlay.querySelector('[type=file]'), submit = dialog.overlay.querySelector('[data-submit]'), previews = dialog.overlay.querySelector('.tools-feedback-previews');
        let images = [];
        const render = () => {
            previews.innerHTML = images.map((item, i) => `<div class="tools-feedback-image"><img src="${item.url}" alt="${escape(item.name)}"><button data-remove="${i}" aria-label="${tr('移除图片', 'Remove image')}">×</button></div>`).join('');
            dialog.overlay.querySelector('[data-count]').textContent = images.length;
        };
        // DOM removal also covers Escape, switching dialogs and the close button.
        const observer = new MutationObserver(() => { if (!dialog.overlay.isConnected) { images.forEach(i => URL.revokeObjectURL(i.url)); observer.disconnect(); } });
        observer.observe(document.body, { childList: true });
        area.oninput = () => { dialog.overlay.querySelector('[data-length]').textContent = area.value.length; submit.disabled = !area.value.trim(); };
        dialog.overlay.querySelector('[data-images]').onclick = () => input.click();
        // 只有首页和需求页自带 requirements-client.js；其他页面打开反馈框时按需加载
        let client = window.RequirementsClient;
        const clientReady = client ? Promise.resolve() : new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = './tp-static/frontend/js/shared/requirements-client.js';
            script.onload = () => { client = window.RequirementsClient; client ? resolve() : reject(new Error('RequirementsClient unavailable')); };
            script.onerror = () => reject(new Error(tr('反馈组件加载失败，请刷新页面后重试', 'Failed to load the feedback component. Refresh and try again.')));
            document.head.appendChild(script);
        });
        clientReady.catch(() => {});
        const status = dialog.overlay.querySelector('[role="status"]');
        input.onchange = async () => {
            const files = [...input.files];
            input.value = '';
            try { await clientReady; } catch (error) { status.textContent = error.message; return; }
            if (!client.validImages(files, images.length)) {
                status.textContent = tr('最多选择 6 张图片，每张不超过 20 MB（自动压缩，支持 PNG、JPG、WebP、GIF）。', 'Choose up to 6 images, 20 MB each (auto-compressed, PNG, JPG, WebP, GIF supported).');
                return;
            }
            status.textContent = '';
            images.push(...files.map(file => ({ file, name: file.name, url: URL.createObjectURL(file) })));
            render();
        };
        previews.onclick = event => {
            const button = event.target.closest('[data-remove]');
            if (button && !area.disabled) {
                URL.revokeObjectURL(images.splice(Number(button.dataset.remove), 1)[0].url);
                render();
            }
        };
        submit.onclick = async () => {
            const description = area.value.trim();
            if (!description || submit.disabled) return;
            const imageButton = dialog.overlay.querySelector('[data-images]');
            submit.disabled = area.disabled = imageButton.disabled = true;
            status.textContent = tr('正在提交…', 'Submitting…');
            try {
                await clientReady;
                await client.submitPayload({
                    title: description.split('\n')[0].slice(0, 80),
                    description,
                    category: '意见反馈',
                    images: await client.encodeImages(images.map(item => item.file))
                }, 'POST', '/api/requirements', message => { status.textContent = message; });
                status.textContent = tr('已提交到需求广场。', 'Posted to the requests board.');
                if (typeof showToast === 'function') {
                    showToast(tr('意见反馈提交成功', 'Feedback submitted successfully'), 'success');
                }
                setTimeout(() => {
                    dialog.close();
                    if (window.ReqApp?.loadRequirements) {
                        window.ReqApp.loadRequirements();
                    }
                }, 600);
            } catch (error) {
                status.textContent = tr('提交失败：', 'Submission failed: ') + error.message;
                submit.disabled = false;
                area.disabled = imageButton.disabled = false;
            }
        };
        area.focus();
    }
    window.ToolsDialogs = { checkUpdate, feedback };
    async function init() {
        const params = new URLSearchParams(location.search), mode = params.get('welcome');
        if (mode === 'updated' || mode === 'first') {
            const next = new URL(location.href); ['welcome', 'version', 'from'].forEach(k => next.searchParams.delete(k));
            history.replaceState({}, '', next.pathname + next.search + next.hash);
            if (mode === 'updated') {
                let releaseNotes = [];
                try { const res = await fetch('./tp-static/frontend/assets/release-notes.json', { cache: 'no-store' }); if (res.ok) { const data = await res.json(); releaseNotes = en() ? data.en : data.zh; } } catch { /* no notes available */ }
                updateDialog({ latestVersion: params.get('version'), releaseNotes }, true, params.get('from'));
            }
        }
        if (window.ToolsUpdater) {
            window.ToolsUpdater.onStatus(next => handleStatus(next));
            try { handleStatus(await window.ToolsUpdater.getStatus()); } catch { /* startup check will broadcast later */ }
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
