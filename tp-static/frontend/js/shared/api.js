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
    post: async function(path, body) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        return handleResponse(res, { method: 'POST', path });
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

function initToolsWelcomeExperience() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('welcome');
    if (!['first', 'updated'].includes(mode)) return;

    const version = params.get('version') || '';
    const fromVersion = params.get('from') || '';
    const isUpdated = mode === 'updated';
    const title = isUpdated ? 'Tools Platform 已焕新' : '欢迎来到 Tools Platform';
    const subtitle = isUpdated && fromVersion
        ? `已从 v${fromVersion.replace(/^v/i, '')} 升级到 v${version.replace(/^v/i, '')}`
        : '桌面窗口与系统浏览器已同步就绪';

    const style = document.createElement('style');
    style.textContent = `
        .tools-welcome-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483000;
            display: grid;
            place-items: center;
            overflow: hidden;
            background:
                radial-gradient(circle at 18% 22%, rgba(100,255,218,0.18), transparent 28%),
                radial-gradient(circle at 82% 28%, rgba(74,144,226,0.22), transparent 30%),
                radial-gradient(circle at 50% 86%, rgba(168,85,247,0.18), transparent 34%),
                linear-gradient(135deg, #08111f 0%, #0f172a 46%, #111827 100%);
            color: #e2e8f0;
            font-family: 'Segoe UI', Tahoma, 'PingFang SC', 'Microsoft YaHei', sans-serif;
            opacity: 1;
            transition: opacity 0.65s ease, visibility 0.65s ease;
        }
        .tools-welcome-overlay.hide {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
        }
        .tools-welcome-grid {
            position: absolute;
            inset: -40%;
            background-image:
                linear-gradient(rgba(148,163,184,0.09) 1px, transparent 1px),
                linear-gradient(90deg, rgba(148,163,184,0.09) 1px, transparent 1px);
            background-size: 46px 46px;
            transform: perspective(800px) rotateX(62deg) translateY(12%);
            animation: toolsWelcomeGrid 5.6s linear infinite;
            mask-image: linear-gradient(to bottom, transparent, #000 22%, #000 72%, transparent);
        }
        .tools-welcome-aurora {
            position: absolute;
            width: 78vmin;
            height: 78vmin;
            border-radius: 50%;
            background: conic-gradient(from 180deg, rgba(100,255,218,0), rgba(100,255,218,0.28), rgba(59,130,246,0.26), rgba(168,85,247,0.24), rgba(100,255,218,0));
            filter: blur(28px);
            opacity: 0.72;
            animation: toolsWelcomeSpin 8s linear infinite;
        }
        .tools-welcome-card {
            position: relative;
            width: min(840px, calc(100vw - 36px));
            max-height: calc(100vh - 48px);
            overflow-y: auto;
            overflow-x: hidden;
            display: grid;
            place-items: center;
            text-align: center;
            padding: 36px 30px 28px;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 24px;
            background: linear-gradient(145deg, rgba(15,23,42,0.86), rgba(15,23,42,0.56));
            box-shadow: 0 38px 110px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.16);
            backdrop-filter: blur(24px);
            animation: toolsWelcomeRise 0.82s cubic-bezier(.2,.8,.2,1) both;
        }
        .tools-welcome-card::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.2) 45%, transparent 58%);
            transform: translateX(-120%);
            animation: toolsWelcomeSweep 2.4s ease 0.35s both;
        }
        .tools-welcome-mark {
            width: 82px;
            height: 82px;
            margin: 0 auto 18px;
            display: grid;
            place-items: center;
            border-radius: 26px;
            background: linear-gradient(135deg, rgba(100,255,218,0.22), rgba(74,144,226,0.22));
            border: 1px solid rgba(125,211,252,0.32);
            box-shadow: 0 0 50px rgba(100,255,218,0.28);
            font-size: 40px;
            animation: toolsWelcomePulse 1.8s ease-in-out infinite;
        }
        .tools-welcome-title {
            margin: 0;
            font-size: clamp(30px, 5.5vw, 56px);
            line-height: 1.1;
            font-weight: 950;
            letter-spacing: 0;
            background: linear-gradient(90deg, #e0f2fe, #64ffda 34%, #93c5fd 68%, #c4b5fd);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .tools-welcome-subtitle {
            margin: 14px auto 0;
            max-width: 560px;
            color: #cbd5e1;
            font-size: clamp(14px, 2vw, 18px);
            line-height: 1.6;
        }
        .tools-welcome-meta-row {
            margin-top: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-wrap: wrap;
            gap: 8px;
        }
        .tools-welcome-version {
            display: inline-flex;
            align-items: center;
            min-height: 28px;
            padding: 0 12px;
            border-radius: 999px;
            background: rgba(100,255,218,0.12);
            border: 1px solid rgba(100,255,218,0.28);
            color: #99f6e4;
            font-size: 12px;
            font-weight: 900;
        }
        .tools-welcome-tag {
            display: inline-flex;
            align-items: center;
            min-height: 28px;
            padding: 0 11px;
            border-radius: 999px;
            background: rgba(148, 163, 184, 0.12);
            border: 1px solid rgba(148, 163, 184, 0.22);
            color: #cbd5e1;
            font-size: 11px;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        }
        .tools-welcome-points {
            margin-top: 24px;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
        }
        .tools-welcome-point {
            min-height: 78px;
            display: grid;
            align-content: center;
            gap: 5px;
            padding: 12px;
            border-radius: 14px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.1);
            text-align: left;
        }
        .tools-welcome-point b {
            color: #f8fafc;
            font-size: 13px;
        }
        .tools-welcome-point span {
            color: #94a3b8;
            font-size: 11px;
            line-height: 1.45;
        }
        .tools-welcome-deps-panel {
            margin-top: 18px;
            text-align: left;
            padding: 14px 16px;
            border-radius: 16px;
            background: rgba(15, 23, 42, 0.65);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .tools-welcome-deps-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        .tools-welcome-deps-title {
            color: #94a3b8;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .04em;
        }
        .tools-welcome-deps-badge {
            color: #38bdf8;
            font-size: 10px;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            background: rgba(56, 189, 248, 0.12);
            padding: 2px 7px;
            border-radius: 999px;
            border: 1px solid rgba(56, 189, 248, 0.22);
        }
        .tools-welcome-deps-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
            gap: 8px;
        }
        .tools-welcome-dep-item {
            padding: 7px 10px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.07);
            transition: all .18s ease;
        }
        .tools-welcome-dep-item:hover {
            border-color: rgba(56, 189, 248, 0.35);
            background: rgba(56, 189, 248, 0.08);
        }
        .tools-welcome-dep-name {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            color: #f1f5f9;
            font-size: 11px;
            font-weight: 700;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        }
        .tools-welcome-dep-ver {
            color: #38bdf8;
            font-size: 10px;
        }
        .tools-welcome-dep-role {
            margin-top: 3px;
            color: #94a3b8;
            font-size: 10px;
            line-height: 1.35;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .tools-welcome-enter-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 38px;
            padding: 0 24px;
            border-radius: 999px;
            background: linear-gradient(135deg, #10b981, #06b6d4);
            color: #fff;
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-weight: 800;
            box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35);
            transition: transform .15s ease, box-shadow .15s ease;
        }
        .tools-welcome-enter-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
        }
        .tools-welcome-skip {
            position: absolute;
            top: 18px;
            right: 18px;
            height: 34px;
            padding: 0 13px;
            border: 1px solid rgba(255,255,255,0.16);
            border-radius: 999px;
            background: rgba(15,23,42,0.38);
            color: #cbd5e1;
            cursor: pointer;
            font-size: 12px;
            font-weight: 850;
        }
        .tools-welcome-skip:hover {
            color: #fff;
            border-color: rgba(100,255,218,0.38);
            background: rgba(100,255,218,0.12);
        }
        @keyframes toolsWelcomeGrid {
            from { transform: perspective(800px) rotateX(62deg) translateY(12%); }
            to { transform: perspective(800px) rotateX(62deg) translateY(calc(12% + 46px)); }
        }
        @keyframes toolsWelcomeSpin {
            to { transform: rotate(360deg); }
        }
        @keyframes toolsWelcomeRise {
            from { opacity: 0; transform: translateY(28px) scale(0.96); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toolsWelcomeSweep {
            to { transform: translateX(120%); }
        }
        @keyframes toolsWelcomePulse {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-4px) scale(1.04); }
        }
        @media (max-width: 680px) {
            .tools-welcome-card { min-height: 0; padding: 28px 16px; }
            .tools-welcome-points { grid-template-columns: 1fr; }
            .tools-welcome-mark { width: 68px; height: 68px; border-radius: 20px; font-size: 32px; }
            .tools-welcome-deps-grid { grid-template-columns: 1fr; }
        }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'tools-welcome-overlay';
    overlay.innerHTML = `
        <div class="tools-welcome-grid"></div>
        <div class="tools-welcome-aurora"></div>
        <button type="button" class="tools-welcome-skip">跳过</button>
        <section class="tools-welcome-card" role="dialog" aria-label="${title}">
            <div style="width: 100%;">
                <div class="tools-welcome-mark"><img src="./tp-static/frontend/assets/logo.png?v=20261006" alt="Tools Platform" style="width:54px;height:54px;object-fit:contain;filter:drop-shadow(0 0 14px rgba(59,130,246,0.6));"></div>
                <h1 class="tools-welcome-title">${title}</h1>
                <p class="tools-welcome-subtitle">${subtitle}</p>
                <div class="tools-welcome-meta-row">
                    ${version ? `<div class="tools-welcome-version">v${version.replace(/^v/i, '')}</div>` : ''}
                    <span class="tools-welcome-tag" id="toolsWelcomeBuiltAt" style="display:none"></span>
                    <span class="tools-welcome-tag" id="toolsWelcomePlatform" style="display:none"></span>
                </div>
                <div class="tools-welcome-points">
                    <div class="tools-welcome-point"><b>双入口已就绪</b><span>内置窗口与系统浏览器可同时进入工具页面</span></div>
                    <div class="tools-welcome-point"><b>本地数据留存</b><span>配置、数据库和备份继续保存在用户目录</span></div>
                    <div class="tools-welcome-point"><b>自动更新在线</b><span>后续版本可在全局设置中检查并重启安装</span></div>
                </div>
                <div class="tools-welcome-deps-panel" id="toolsWelcomeDepsPanel" style="display:none">
                    <div class="tools-welcome-deps-head">
                        <span class="tools-welcome-deps-title">📦 内置核心三方依赖与运行组件</span>
                        <span class="tools-welcome-deps-badge" id="toolsWelcomeDepsCount"></span>
                    </div>
                    <div class="tools-welcome-deps-grid" id="toolsWelcomeDepsGrid"></div>
                </div>
                <div style="margin-top: 22px; display: flex; justify-content: center; gap: 12px;">
                    <button type="button" class="tools-welcome-enter-btn">进入工作空间</button>
                </div>
            </div>
        </section>
    `;
    document.body.appendChild(overlay);

    fetch('/api/app-version')
        .then(res => res.json())
        .then(data => {
            const b = data && data.build;
            if (!b) return;
            const builtAtEl = overlay.querySelector('#toolsWelcomeBuiltAt');
            if (builtAtEl && b.builtAt) {
                try {
                    const d = new Date(b.builtAt);
                    const pad = n => String(n).padStart(2, '0');
                    builtAtEl.textContent = `构建: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    builtAtEl.style.display = 'inline-flex';
                } catch (_) {}
            }
            const platformEl = overlay.querySelector('#toolsWelcomePlatform');
            if (platformEl && (b.platformLabel || b.nodeVersion)) {
                platformEl.textContent = `${b.platformLabel || ''}${b.nodeVersion ? ` · Node ${b.nodeVersion}` : ''}`;
                platformEl.style.display = 'inline-flex';
            }
            const depsPanel = overlay.querySelector('#toolsWelcomeDepsPanel');
            const depsGrid = overlay.querySelector('#toolsWelcomeDepsGrid');
            const depsCount = overlay.querySelector('#toolsWelcomeDepsCount');
            if (Array.isArray(b.dependencies) && b.dependencies.length && depsPanel && depsGrid) {
                depsCount.textContent = `${b.dependencies.length} 项`;
                depsGrid.innerHTML = b.dependencies.map(dep => `
                    <div class="tools-welcome-dep-item" title="${dep.role || ''}">
                        <div class="tools-welcome-dep-name">
                            <span>${dep.name}</span>
                            <span class="tools-welcome-dep-ver">${dep.version}</span>
                        </div>
                        <div class="tools-welcome-dep-role">${dep.role || ''}</div>
                    </div>
                `).join('');
                depsPanel.style.display = 'block';
            }
        })
        .catch(() => {});

    const cleanUrl = () => {
        const next = new URL(window.location.href);
        ['welcome', 'version', 'from'].forEach(key => next.searchParams.delete(key));
        window.history.replaceState({}, '', `${next.pathname}${next.search}${next.hash}`);
    };
    const close = () => {
        overlay.classList.add('hide');
        cleanUrl();
        setTimeout(() => {
            overlay.remove();
            style.remove();
        }, 700);
    };

    let closeTimer = null;
    const startCloseTimer = (delayMs) => {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(close, delayMs);
    };
    startCloseTimer(isUpdated ? 9500 : 8000);

    const card = overlay.querySelector('.tools-welcome-card');
    if (card) {
        card.addEventListener('mouseenter', () => {
            if (closeTimer) {
                clearTimeout(closeTimer);
                closeTimer = null;
            }
        });
        card.addEventListener('mouseleave', () => {
            startCloseTimer(4500);
        });
    }

    overlay.querySelector('.tools-welcome-skip')?.addEventListener('click', close);
    overlay.querySelector('.tools-welcome-enter-btn')?.addEventListener('click', close);
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close();
    }, { once: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToolsWelcomeExperience, { once: true });
} else {
    initToolsWelcomeExperience();
}
