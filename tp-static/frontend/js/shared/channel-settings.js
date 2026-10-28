// 全局设置 › 频道对接：WeLink / 微信助理的连接配置、扫码授权、连通性测试、黑白名单、推送范围、联系人与日志；
// WeLink 另有个人身份（welink-cli）卡片，见 welink-cli-settings.js；「数字人」标签是基座对接配置，见 digital-human-settings.js。
// 两个频道只有「运行状态」「连接配置」不同，助理行为、访问控制、主动推送、联系人、日志共用同一套卡片。
// 由 navbar.js 在切换到 channels 标签时按需加载；依赖 channels.js（目标选择器与 API）与 qr-code.js。
(function () {
    'use strict';
    if (window.ToolsChannelSettings) return;

    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    // 本文件由 navbar.js 按需加载：优先用统一弹窗 AppDialog，未加载时直接复用导航栏弹窗（同一套样式）
    const confirmDialog = (message, options = {}) => (window.AppDialog
        ? window.AppDialog.confirm(message, { cancelText: L('取消', 'Cancel'), ...options })
        : window.showNavbarConfirm({ message, cancelText: L('取消', 'Cancel'), ...options }));
    const promptDialog = (message, options = {}) => (window.AppDialog
        ? window.AppDialog.prompt(message, { cancelText: L('取消', 'Cancel'), ...options })
        : window.showNavbarFormDialog({ title: options.title, message, cancelText: L('取消', 'Cancel'), fields: [{ name: 'value', value: options.defaultValue || '', maxLength: options.maxLength }] })
            .then(values => (values ? String(values.value ?? '') : null)));
    const STATE_LABEL = {
        idle: ['未连接', 'Disconnected'],
        starting: ['连接中', 'Connecting'],
        ready: ['已连接', 'Connected'],
        reconnecting: ['重连中', 'Reconnecting'],
        stopping: ['断开中', 'Stopping'],
        failed: ['连接失败', 'Failed']
    };
    const MODE_LABEL = {
        all: ['所有人可用', 'Everyone'],
        whitelist: ['仅白名单', 'Allowlist only'],
        blacklist: ['黑名单禁止', 'Blocklist']
    };

    const CHANNEL_TABS = [
        { id: 'welink', icon: '💼', label: ['WeLink', 'WeLink'] },
        { id: 'weixin', icon: '💬', label: ['微信', 'WeChat'] },
        { id: 'ops', icon: '📣', label: ['运营', 'Ops'] }, // 自动化运营群组（channel-ops-settings.js）
        { id: 'digital-human', icon: '🤖', label: ['数字人', 'Digital Human'] } // 数字人基座对接（digital-human-settings.js）
    ];
    // 独立面板：自己加载数据和绑定事件，不走频道的配置 / 状态 / 保存栏
    const PANELS = {
        ops: { src: './tp-static/frontend/js/shared/channel-ops-settings.js', global: 'ToolsChannelOps' },
        'digital-human': { src: './tp-static/frontend/js/shared/digital-human-settings.js', global: 'ToolsDigitalHuman' }
    };
    const CHANNEL_STORE_KEY = 'tools_channel_settings_tab';

    const view = {
        channel: (() => { try { const saved = localStorage.getItem(CHANNEL_STORE_KEY); return ['weixin', 'ops', 'digital-human'].includes(saved) ? saved : 'welink'; } catch (_) { return 'welink'; } })(),
        content: null,
        config: null,
        draft: null,
        status: null,
        models: [],
        dirty: false,
        busy: '',
        notice: null,
        testResult: null,
        qr: null,
        targetFilter: { kind: 'all', q: '' },
        targets: [],
        messages: [],
        // 消息日志按需分页：滚动到日志卡片才加载第一页，表格滚到底再加载下一页
        messageLog: { loaded: false, loading: false, hasMore: false, total: 0, error: '', expanded: new Set(), observer: null, epoch: 0 },
        pollTimer: null
    };
    const MESSAGE_PAGE_SIZE = 30;
    const MESSAGE_PREVIEW_CHARS = 300;

    const api = (method, path, body) => window.ToolsChannels.request(method, path, body, view.channel);
    const isWeixin = () => view.channel === 'weixin';
    const isPanel = () => Boolean(PANELS[view.channel]);
    const channelLabel = () => (isWeixin() ? L('微信', 'WeChat') : 'WeLink');
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

    // 按需加载的组件带上内容版本号（与 navbar 的 loadNavLazyScript 一致），更新后浏览器不会继续用旧缓存
    async function loadScript(src, globalName) {
        if (window[globalName]) return;
        let url = src;
        try {
            const res = await fetch(`/api/asset-version?path=${encodeURIComponent(src)}`, { cache: 'no-store' });
            const data = res.ok ? await res.json() : null;
            if (data && data.version) url = `${src}?v=${encodeURIComponent(data.version)}`;
        } catch (_) { /* 拿不到版本号时按原地址加载 */ }
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`${src} load failed`));
            document.head.appendChild(script);
        });
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function ensureStyle() {
        if (document.getElementById('tools-channel-settings-style')) return;
        const style = document.createElement('style');
        style.id = 'tools-channel-settings-style';
        style.textContent = `
.nch{display:flex;flex-direction:column;gap:14px;padding-bottom:70px;color:#0f172a}
.nch-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:14px 16px}
.nch-card h4{margin:0 0 4px;font-size:14px;font-weight:850;display:flex;align-items:center;gap:8px}
.nch-card>p.nch-desc{margin:0 0 12px;color:#64748b;font-size:12px;line-height:1.6}
.nch-status{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.nch-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:800;background:#f1f5f9;color:#475569}
.nch-pill i{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block}
.nch-pill.ok{background:#dcfce7;color:#166534}.nch-pill.warn{background:#fef3c7;color:#92400e}.nch-pill.bad{background:#fee2e2;color:#991b1b}
.nch-actions{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}
.nch-sdk-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0}
.nch-sdk-row .nch-muted{flex:1 1 260px;min-width:0;word-break:break-all}
.nch-btn{height:30px;padding:0 12px;border-radius:7px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap}
.nch-btn:hover:not(:disabled){border-color:#93c5fd;color:#1d4ed8}
.nch-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
.nch-btn.danger{color:#b91c1c}
.nch-btn:disabled{opacity:.5;cursor:not-allowed}
.nch-alert{margin-top:10px;padding:10px 12px;border-radius:9px;font-size:12px;line-height:1.6;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412}
.nch-alert.info{background:#eff6ff;border-color:#bfdbfe;color:#1e3a8a}
.nch-alert.ok{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
.nch-alert.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.nch-alert code{font-size:11px;background:rgba(15,23,42,.06);padding:1px 4px;border-radius:4px;word-break:break-all}
.nch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px 14px}
.nch-field{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0}
.nch-field>span{color:#475569;font-weight:700}
.nch-field small{color:#94a3b8;font-weight:500;line-height:1.5}
.nch-field input,.nch-field select,.nch-field textarea{height:32px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:13px;background:#fff;color:#0f172a;min-width:0}
.nch-field textarea{height:64px;padding:8px 10px;resize:vertical;font-family:inherit}
.nch-wide{grid-column:1/-1}
.nch-switch{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;cursor:pointer;user-select:none}
.nch-switch input{width:16px;height:16px;flex:0 0 16px;margin:0;cursor:pointer}
.nch-steps{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;font-size:12px}
.nch-steps li{display:grid;grid-template-columns:20px 110px minmax(0,1fr);gap:6px;align-items:start}
.nch-steps li span:last-child{color:#64748b;word-break:break-all}
.nch-qr{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-top:12px;padding:12px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc}
.nch-qr-img{width:184px;height:184px;background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:4px}
.nch-qr-img svg{width:100%;height:100%}
.nch-qr-info{flex:1 1 220px;font-size:12px;line-height:1.7;color:#334155;min-width:0}
.nch-qr-info a{color:#2563eb;word-break:break-all}
.nch-access{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.nch-access-col{border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#f8fafc;min-width:0}
.nch-access-col h5{margin:0 0 8px;font-size:13px;font-weight:850}
.nch-seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;margin-bottom:10px;max-width:100%}
.nch-seg button{border:0;background:#fff;color:#334155;padding:0 10px;height:28px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.nch-seg button.active{background:#2563eb;color:#fff}
.nch-chips{display:flex;flex-wrap:wrap;gap:6px;min-height:28px;align-items:center}
.nch-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:3px 4px 3px 9px;border-radius:999px;background:#e0e7ff;color:#3730a3;font-size:12px;font-weight:700}
.nch-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nch-chip button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 4px}
.nch-chip.black{background:#fee2e2;color:#991b1b}
.nch-chip.group{background:#dcfce7;color:#166534}
.nch-muted{color:#94a3b8;font-size:12px}
.nch-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.nch-row input:not([type="checkbox"]):not([type="radio"]){flex:1 1 160px;min-width:0;height:30px;border:1px solid #cbd5e1;border-radius:7px;padding:0 8px;font-size:12px}
.nch-row .nch-switch{white-space:nowrap;flex-shrink:0}
.nch-row .nch-switch input{flex:0 0 16px;width:16px;height:16px;min-width:16px;max-width:16px;padding:0;border:0}
.nch-table-wrap{overflow:auto;max-height:340px;border:1px solid #e2e8f0;border-radius:10px;margin-top:10px}
.nch-table{width:100%;border-collapse:collapse;font-size:12px}
.nch-table th,.nch-table td{padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:left;vertical-align:top}
.nch-table th{position:sticky;top:0;background:#f8fafc;color:#475569;font-weight:800;z-index:1;white-space:nowrap}
.nch-table td.nch-text{max-width:360px;white-space:pre-wrap;word-break:break-word;color:#334155}
.nch-table .nch-id{color:#94a3b8;font-size:11px;word-break:break-all}
.nch-badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:800;background:#f1f5f9;color:#475569;white-space:nowrap}
.nch-badge.ok{background:#dcfce7;color:#166534}.nch-badge.bad{background:#fee2e2;color:#991b1b}.nch-badge.warn{background:#fef3c7;color:#92400e}
.nch-link{border:0;background:none;color:#2563eb;cursor:pointer;font-size:12px;padding:0 4px}
.nch-link.danger{color:#b91c1c}
.nch-code{margin:8px 0 0;padding:10px 12px;border-radius:8px;background:#0f172a;color:#e2e8f0;font-size:11px;line-height:1.6;overflow:auto;white-space:pre}
.nch-diag pre{max-height:320px;overflow:auto;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px;font-size:11px;white-space:pre-wrap;word-break:break-all}
.nch-tabs{display:flex;gap:8px;flex-wrap:wrap}
.nch-tab{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:13px;font-weight:800;cursor:pointer}
.nch-tab.active{background:#0f172a;border-color:#0f172a;color:#fff}
.nch-tab i{width:7px;height:7px;border-radius:50%;background:#cbd5e1;display:inline-block}
.nch-tab i.ok{background:#22c55e}
.nch-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 14px;margin-top:10px;font-size:12px}
.nch-kv div{min-width:0;word-break:break-all}.nch-kv b{color:#475569;margin-right:6px}
.nch-savebar{position:sticky;bottom:0;display:flex;gap:10px;align-items:center;justify-content:flex-end;padding:10px 12px;margin-top:-4px;border:1px solid #e2e8f0;border-radius:12px;background:rgba(255,255,255,.96);box-shadow:0 -6px 18px rgba(15,23,42,.06);z-index:2}
.nch-savebar span{margin-right:auto;font-size:12px;color:#64748b}
.nch-savebar span.dirty{color:#b45309;font-weight:800}
@media (max-width:640px){.nch-actions{margin-left:0}.nch-steps li{grid-template-columns:20px minmax(0,1fr)}.nch-steps li span:last-child{grid-column:2}}
`;
        document.head.appendChild(style);
    }

    // ── 数据 ─────────────────────────────────────────────
    async function loadAll() {
        if (isPanel()) {
            // 独立面板（运营 / 数字人）自己加载数据；这里只占位，避免频道相关逻辑读到空配置
            Object.assign(view, { config: {}, draft: {}, status: {}, dirty: false });
            await loadScript(PANELS[view.channel].src, PANELS[view.channel].global);
            return;
        }
        const [config, status, models] = await Promise.all([
            api('GET', '/config'),
            api('GET', '/status'),
            fetch('/api/ai/models', { headers: authHeaders() }).then(res => (res.ok ? res.json() : { items: [] })).catch(() => ({ items: [] }))
        ]);
        view.config = config;
        view.draft = clone(config);
        view.draft.sk = '';
        view.draft.token = '';
        view.status = status;
        view.models = Array.isArray(models.items) ? models.items : (Array.isArray(models.models) ? models.models : []);
        view.dirty = false;
        resetMessageLog();
        await loadTargets();
    }

    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function loadTargets() {
        try {
            const params = new URLSearchParams({ limit: '500' });
            if (view.targetFilter.kind !== 'all') params.set('kind', view.targetFilter.kind);
            if (view.targetFilter.q) params.set('q', view.targetFilter.q);
            view.targets = (await api('GET', `/targets?${params}`)).items || [];
        } catch (_) {
            view.targets = [];
        }
    }

    function resetMessageLog() {
        const log = view.messageLog;
        log.observer?.disconnect();
        Object.assign(log, { loaded: false, loading: false, hasMore: false, total: 0, error: '', observer: null, epoch: log.epoch + 1 });
        log.expanded.clear();
        view.messages = [];
    }

    // reset：重新取第一页（刷新、测试推送后）；否则按最后一条 id 取更早一页
    async function loadMessages({ reset = false } = {}) {
        const log = view.messageLog;
        if (log.loading && !reset) return;
        if (!reset && log.loaded && !log.hasMore) return;
        const epoch = reset ? ++log.epoch : log.epoch;
        const before = reset ? 0 : view.messages[view.messages.length - 1]?.id || 0;
        log.loading = true;
        log.error = '';
        rerenderMessageLog();
        try {
            const data = await api('GET', `/messages?limit=${MESSAGE_PAGE_SIZE}${before ? `&before=${before}` : ''}`);
            if (epoch !== log.epoch) return; // 期间刷新过，丢弃旧请求
            const items = Array.isArray(data.items) ? data.items : [];
            view.messages = reset ? items : [...view.messages, ...items.filter(item => !view.messages.some(row => row.id === item.id))];
            if (reset) log.expanded.clear();
            Object.assign(log, { loaded: true, hasMore: Boolean(data.hasMore), total: Number(data.total) || view.messages.length });
        } catch (error) {
            if (epoch === log.epoch) log.error = error.message || String(error);
        } finally {
            if (epoch === log.epoch) {
                log.loading = false;
                // 刷新回到最新一页的顶部，避免沿用旧滚动位置立刻触发下一页
                rerenderMessageLog({ toTop: reset });
            }
        }
    }

    async function refreshStatus() {
        if (isPanel()) return;
        try {
            view.status = await api('GET', '/status');
            renderStatusCard();
        } catch (_) { /* 轮询失败忽略 */ }
    }

    function markDirty() {
        view.dirty = true;
        const bar = view.content?.querySelector('[data-role="save-state"]');
        if (bar) { bar.textContent = L('有未保存的修改', 'Unsaved changes'); bar.classList.add('dirty'); }
    }

    function setNotice(kind, text) {
        view.notice = text ? { kind, text } : null;
        renderStatusCard();
    }

    async function runAction(name, task) {
        if (view.busy) return;
        view.busy = name;
        renderStatusCard();
        try {
            await task();
        } catch (error) {
            setNotice('bad', error.message);
        } finally {
            view.busy = '';
            renderStatusCard();
        }
    }

    // ── 渲染 ─────────────────────────────────────────────
    function statePill(status, name = L('网关', 'Gateway')) {
        const state = status?.runtime?.state || 'idle';
        const cls = state === 'ready' ? 'ok' : (['starting', 'reconnecting', 'stopping'].includes(state) ? 'warn' : (state === 'failed' ? 'bad' : ''));
        const label = STATE_LABEL[state] || [state, state];
        return `<span class="nch-pill ${cls}"><i></i>${esc(name)}：${esc(L(label[0], label[1]))}</span>`;
    }

    function renderWeixinStatusHtml() {
        const status = view.status || {};
        const summary = status.summary || {};
        const running = Boolean(status.runtime && status.runtime.state !== 'idle');
        const busy = view.busy;
        const failure = status.runtime?.failureReason || status.lastError?.message;
        const test = view.testResult;
        const oc = status.openclaw || {};
        const conflict = oc.sameToken && oc.pluginEnabled;
        return `
            <div class="nch-status">
                <span class="nch-pill ${status.configured ? 'ok' : 'bad'}"><i></i>${esc(status.configured ? L('已登录 bot', 'Bot linked') : L('未登录', 'Not linked'))}</span>
                ${statePill(status, L('长轮询', 'Polling'))}
                <span class="nch-pill ${status.enabled ? 'ok' : ''}"><i></i>${esc(status.enabled ? L('已启用', 'Enabled') : L('未启用', 'Disabled'))}</span>
                <span class="nch-muted">${esc(L(`联系人 ${summary.users || 0}（可推送 ${summary.pushableUsers || 0}）`, `Contacts ${summary.users || 0} (${summary.pushableUsers || 0} pushable)`))}</span>
                <div class="nch-actions">
                    <button type="button" class="nch-btn primary" data-action="test" ${busy ? 'disabled' : ''}>${esc(busy === 'test' ? L('测试中…', 'Testing…') : L('测试连通性', 'Test connection'))}</button>
                    ${running
                        ? `<button type="button" class="nch-btn" data-action="restart" ${busy ? 'disabled' : ''}>${esc(busy === 'restart' ? L('重启中…', 'Restarting…') : L('重启连接', 'Restart'))}</button>
                           <button type="button" class="nch-btn danger" data-action="disconnect" ${busy ? 'disabled' : ''}>${esc(L('断开', 'Disconnect'))}</button>`
                        : `<button type="button" class="nch-btn" data-action="connect" ${busy || !status.configured ? 'disabled' : ''}>${esc(busy === 'connect' ? L('连接中…', 'Connecting…') : L('立即连接', 'Connect'))}</button>`}
                </div>
            </div>
            <div class="nch-kv">
                <div><b>Bot</b>${esc(status.bot?.id || '—')}</div>
                <div><b>${esc(L('绑定微信', 'Owner'))}</b>${esc(status.bot?.ownerUserId || '—')}</div>
                <div><b>${esc(L('凭据来源', 'Source'))}</b>${esc(({ qrcode: L('平台扫码', 'QR login'), openclaw: L('OpenClaw 导入', 'From OpenClaw'), manual: L('手动', 'Manual') })[status.bot?.source] || '—')}</div>
                <div><b>${esc(L('最近轮询', 'Last poll'))}</b>${esc(status.lastPollAt ? window.ToolsChannels.relativeTime(status.lastPollAt) : '—')}</div>
            </div>
            <div class="nch-sdk-row">
                <span class="nch-muted">${esc(oc.available
                    ? L(`本机 OpenClaw 已登录微信 bot ${oc.accountId}${oc.sameToken ? '（与平台当前使用的是同一个）' : ''}；OpenClaw 微信插件：${oc.pluginEnabled === false ? '已暂停' : '运行中'}`, `Local OpenClaw has WeChat bot ${oc.accountId}${oc.sameToken ? ' (same as the platform)' : ''}; OpenClaw WeChat plugin: ${oc.pluginEnabled === false ? 'paused' : 'running'}`)
                    : L('未检测到本机 OpenClaw 的微信登录信息，可直接用下方「扫码登录」。', 'No local OpenClaw WeChat login found; use QR login below.'))}</span>
                ${oc.available ? `<button type="button" class="nch-btn ${status.configured ? '' : 'primary'}" data-action="openclaw-import" ${busy ? 'disabled' : ''}>${esc(busy === 'openclaw-import' ? L('导入中…', 'Importing…') : L('导入 OpenClaw 微信凭据', 'Import from OpenClaw'))}</button>` : ''}
                ${oc.available && oc.pluginEnabled !== false ? `<button type="button" class="nch-btn ${conflict ? 'primary' : ''}" data-action="openclaw-pause" ${busy ? 'disabled' : ''}>${esc(busy === 'openclaw-pause' ? L('暂停中…', 'Pausing…') : L('暂停 OpenClaw 微信', 'Pause OpenClaw WeChat'))}</button>` : ''}
                ${oc.available && oc.pluginEnabled === false ? `<button type="button" class="nch-link" data-action="openclaw-resume" ${busy ? 'disabled' : ''}>${esc(L('恢复 OpenClaw 微信', 'Resume OpenClaw WeChat'))}</button>` : ''}
            </div>
            ${conflict ? `<div class="nch-alert">⚠️ ${esc(L('OpenClaw 微信插件仍在使用同一个 bot：一个 bot 同时只能由一个客户端收消息，两边会互相抢收。请点击「暂停 OpenClaw 微信」，优先保障本平台。', 'OpenClaw is still polling the same bot; only one client can receive messages. Pause the OpenClaw WeChat plugin.'))}</div>` : ''}
            ${status.stale ? `<div class="nch-alert info">${esc(L('连接参数已修改，当前连接仍使用旧配置；点击「重启连接」生效。', 'Connection settings changed; restart the connection to apply them.'))}</div>` : ''}
            ${failure && status.runtime?.state !== 'ready' ? `<div class="nch-alert bad">${esc(L('最近错误：', 'Last error: '))}${esc(failure)}</div>` : ''}
            ${view.notice ? `<div class="nch-alert ${esc(view.notice.kind)}">${esc(view.notice.text)}</div>` : ''}
            ${test ? `<div class="nch-alert ${test.ok ? 'ok' : 'bad'}"><b>${esc(test.ok ? L('连通性测试通过', 'Connection test passed') : L('连通性测试未通过', 'Connection test failed'))}</b>
                <ul class="nch-steps">${test.steps.map(step => `<li><span>${step.ok ? '✅' : '❌'}</span><b>${esc(step.label)}</b><span>${esc(step.detail)}</span></li>`).join('')}</ul></div>` : ''}`;
    }

    function renderStatusCardHtml() {
        if (isWeixin()) return renderWeixinStatusHtml();
        const status = view.status || {};
        const sdk = status.sdk || {};
        const summary = status.summary || {};
        const running = Boolean(status.runtime && status.runtime.state !== 'idle');
        const busy = view.busy;
        // SDK 缺失时只展示上面的安装/导入提示，不重复显示同一原因的连接错误
        const failure = sdk.available ? (status.runtime?.failureReason || status.lastError?.message) : '';
        const test = view.testResult;
        return `
            <div class="nch-status">
                ${sdk.available
                    ? `<span class="nch-pill ok" title="${esc(sdk.packageDir || '')}"><i></i>SDK ${esc(/unknown/.test(sdk.version || '') ? L('版本未知', 'unknown version') : (sdk.version || ''))} · ${esc(({ imported: L('已导入', 'imported'), builtin: L('平台内置', 'built-in'), global: L('全局安装', 'global'), custom: L('自定义路径', 'custom path') })[sdk.source] || L('项目依赖', 'local'))}</span>`
                    : `<span class="nch-pill bad"><i></i>${esc(L('SDK 未安装', 'SDK missing'))}</span>`}
                ${statePill(status)}
                <span class="nch-pill ${status.enabled ? 'ok' : ''}"><i></i>${esc(status.enabled ? L('已启用', 'Enabled') : L('未启用', 'Disabled'))}</span>
                ${status.assistantInfo?.name ? `<span class="nch-pill">🤖 ${esc(status.assistantInfo.name)}</span>` : ''}
                <span class="nch-muted">${esc(L(`人员 ${summary.users || 0}（可推送 ${summary.pushableUsers || 0}） · 群组 ${summary.groups || 0}（可推送 ${summary.pushableGroups || 0}）`, `People ${summary.users || 0} (${summary.pushableUsers || 0} pushable) · Groups ${summary.groups || 0} (${summary.pushableGroups || 0} pushable)`))}</span>
                <div class="nch-actions">
                    <button type="button" class="nch-btn" data-action="recheck" ${busy ? 'disabled' : ''}>${esc(busy === 'recheck' ? L('检测中…', 'Checking…') : L('重新检测 SDK', 'Re-detect SDK'))}</button>
                    <button type="button" class="nch-btn primary" data-action="test" ${busy ? 'disabled' : ''}>${esc(busy === 'test' ? L('测试中…', 'Testing…') : L('测试连通性', 'Test connection'))}</button>
                    ${running
                        ? `<button type="button" class="nch-btn" data-action="restart" ${busy ? 'disabled' : ''}>${esc(busy === 'restart' ? L('重启中…', 'Restarting…') : L('重启连接', 'Restart'))}</button>
                           <button type="button" class="nch-btn danger" data-action="disconnect" ${busy ? 'disabled' : ''}>${esc(L('断开', 'Disconnect'))}</button>`
                        : `<button type="button" class="nch-btn" data-action="connect" ${busy || !sdk.available ? 'disabled' : ''}>${esc(busy === 'connect' ? L('连接中…', 'Connecting…') : L('立即连接', 'Connect'))}</button>`}
                </div>
            </div>
            <div class="nch-sdk-row">
                <span class="nch-muted">${esc(sdk.available
                    ? L(`SDK 来源：${sdk.packageDir || ''}${sdk.importedAt ? `（${new Date(sdk.importedAt).toLocaleString()} 导入）` : ''}`, `SDK source: ${sdk.packageDir || ''}${sdk.importedAt ? ` (imported ${new Date(sdk.importedAt).toLocaleString()})` : ''}`)
                    : L('内网环境可直接导入 SDK：选择 welink-cli 或 Bot 工程里的 @wecode 文件夹即可。', 'Offline? Import the SDK by choosing the @wecode folder from welink-cli or a bot project.'))}</span>
                <button type="button" class="nch-btn ${sdk.available ? '' : 'primary'}" data-action="sdk-import-folder" ${busy ? 'disabled' : ''}>${esc(busy === 'sdk-import' ? L('导入中…', 'Importing…') : (sdk.available ? L('更新 SDK（文件夹）', 'Update SDK (folder)') : L('导入 SDK 文件夹', 'Import SDK folder')))}</button>
                <button type="button" class="nch-btn" data-action="sdk-import-file" ${busy ? 'disabled' : ''}>${esc(L('选择 index.js', 'Choose index.js'))}</button>
                ${sdk.source === 'imported' ? `<button type="button" class="nch-link danger" data-action="sdk-remove" ${busy ? 'disabled' : ''}>${esc(L('移除已导入', 'Remove imported'))}</button>` : ''}
                <input type="file" data-role="sdk-folder" webkitdirectory directory multiple hidden>
                <input type="file" data-role="sdk-file" accept=".js,.mjs" hidden>
            </div>
            ${!sdk.available ? `<div class="nch-alert">⚠️ ${esc(L(sdk.hint || '', sdk.hintEn || sdk.hint || ''))}${sdk.customPathInvalid ? `<br>${esc(L('当前填写的 SDK 路径下未找到 SDK。', 'No SDK found under the configured SDK path.'))}` : ''}</div>` : ''}
            ${status.stale ? `<div class="nch-alert info">${esc(status.staleReason === 'sdk'
                ? L('SDK 已更新，当前连接仍在使用旧版本；点击「重启连接」生效。', 'The SDK was updated; restart the connection to use it.')
                : L('连接参数已修改，当前连接仍使用旧配置；点击「重启连接」生效。', 'Connection settings changed; restart the connection to apply them.'))}</div>` : ''}
            ${failure && status.runtime?.state !== 'ready' ? `<div class="nch-alert bad">${esc(L('最近错误：', 'Last error: '))}${esc(failure)}</div>` : ''}
            ${view.notice ? `<div class="nch-alert ${esc(view.notice.kind)}">${esc(view.notice.text)}</div>` : ''}
            ${test ? `<div class="nch-alert ${test.ok ? 'ok' : 'bad'}"><b>${esc(test.ok ? L('连通性测试通过', 'Connection test passed') : L('连通性测试未通过', 'Connection test failed'))}</b>
                <ul class="nch-steps">${test.steps.map(step => `<li><span>${step.ok ? '✅' : '❌'}</span><b>${esc(step.label)}</b><span>${esc(step.detail)}</span></li>`).join('')}</ul></div>` : ''}`;
    }

    function renderStatusCard() {
        const el = view.content?.querySelector('[data-role="status-card"]');
        if (el) el.innerHTML = `<h4>📡 ${esc(L('运行状态', 'Status'))}</h4>${renderStatusCardHtml()}`;
    }

    function field(label, inner, hint, wide) {
        return `<label class="nch-field ${wide ? 'nch-wide' : ''}"><span>${esc(label)}</span>${inner}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
    }

    function input(path, value, attrs = '') {
        return `<input data-path="${esc(path)}" value="${esc(value ?? '')}" ${attrs}>`;
    }

    function renderWeixinConnectionCard() {
        const d = view.draft;
        const qr = view.qr;
        return `
            <h4>🔌 ${esc(L('连接配置', 'Connection'))}</h4>
            <p class="nch-desc">${esc(L('平台通过微信 ClawBot（iLink 协议，与 OpenClaw 微信插件同一套接口）接入个人微信：可直接导入本机 OpenClaw 已登录的 bot，或在这里扫码登录一个。配置按租户隔离。', 'The platform connects to personal WeChat via ClawBot (iLink, the same API as the OpenClaw WeChat plugin): import the bot already linked in local OpenClaw, or scan to link one here. Settings are per tenant.'))}</p>
            <label class="nch-switch" style="margin-bottom:12px"><input type="checkbox" data-path="enabled" ${d.enabled ? 'checked' : ''}> ${esc(L('启用微信助理（保存后自动连接，平台重启后自动恢复）', 'Enable WeChat assistant (connects after saving and on platform start)'))}</label>
            <div class="nch-grid">
                ${field('Bot Token', `<input type="password" data-path="token" value="" maxlength="500" autocomplete="new-password" placeholder="${esc(view.config.hasToken ? L(`已保存 ${view.config.maskedToken}，留空不修改`, `Saved ${view.config.maskedToken}; leave blank to keep`) : L('未设置，建议扫码或从 OpenClaw 导入', 'Not set; scan or import from OpenClaw'))}">`, L('只在服务端保存，界面与日志只显示掩码', 'Stored server-side only; masked in UI and logs'))}
                ${field(L('接口地址', 'API base URL'), input('baseUrl', d.baseUrl, 'maxlength="500"'), L('扫码或导入时自动填写，一般无需修改', 'Filled by login/import; usually unchanged'))}
                ${field('Bot Agent', input('botAgent', d.botAgent, 'maxlength="120"'), L('上报给微信的客户端标识（Name/Version）', 'Client identity reported to WeChat (Name/Version)'))}
            </div>
            <div class="nch-row">
                <button type="button" class="nch-btn primary" data-action="qr" ${qr && qr.running ? 'disabled' : ''}>📱 ${esc(qr && qr.running ? L('等待扫码…', 'Waiting for scan…') : L('扫码登录', 'Scan to link'))}</button>
                ${view.config.hasToken ? `<button type="button" class="nch-btn danger" data-action="clear-token">${esc(L('清除已保存 Token', 'Clear saved token'))}</button>` : ''}
                <span class="nch-muted">${esc(L('用手机微信扫码并确认，成功后自动保存凭据并连接。', 'Scan with WeChat and confirm; credentials are saved and connected automatically.'))}</span>
            </div>
            ${qr ? renderQr(qr) : ''}`;
    }

    function renderConnectionCard() {
        if (isWeixin()) return renderWeixinConnectionCard();
        const d = view.draft;
        const qr = view.qr;
        return `
            <h4>🔌 ${esc(L('连接配置', 'Connection'))}</h4>
            <p class="nch-desc">${esc(L('平台作为第三方智能助理接入 WeLink 网关。推荐使用「扫码授权」自动创建助理并获取 AK/SK；也可手动填写。配置按租户隔离，与 AI 配置一致。', 'The platform registers as a third-party assistant on the WeLink gateway. Scan-to-authorize creates the assistant and fills AK/SK automatically, or enter them manually. Settings are per tenant, like AI settings.'))}</p>
            <label class="nch-switch" style="margin-bottom:12px"><input type="checkbox" data-path="enabled" ${d.enabled ? 'checked' : ''}> ${esc(L('启用 WeLink 助理（保存后自动连接，平台重启后自动恢复）', 'Enable WeLink assistant (connects after saving and on platform start)'))}</label>
            <div class="nch-grid">
                ${field(L('环境', 'Environment'), `<select data-path="environment"><option value="prod" ${d.environment === 'prod' ? 'selected' : ''}>${esc(L('生产 prod', 'Production (prod)'))}</option><option value="uat" ${d.environment === 'uat' ? 'selected' : ''}>${esc(L('测试 uat', 'Test (uat)'))}</option></select>`)}
                ${field('Channel', input('channel', d.channel, 'maxlength="100" placeholder="GDEClaw"'), L('业务渠道标识，由 WeLink 侧分配', 'Business channel assigned by WeLink'))}
                ${field('Tool Version', input('toolVersion', d.toolVersion, 'maxlength="40"'))}
                ${field('AK', input('ak', d.ak, 'maxlength="200" autocomplete="off" spellcheck="false"'))}
                ${field('SK', `<input type="password" data-path="sk" value="" maxlength="200" autocomplete="new-password" placeholder="${esc(view.config.hasSk ? L(`已保存 ${view.config.maskedSk}，留空不修改`, `Saved ${view.config.maskedSk}; leave blank to keep`) : L('未设置', 'Not set'))}">`, L('只在服务端保存，界面与日志只显示掩码', 'Stored server-side only; masked in UI and logs'))}
                ${field(L('网关地址（可选）', 'Gateway URL (optional)'), input('gatewayUrl', d.gatewayUrl, 'maxlength="500" placeholder="默认使用 SDK 内置地址"'))}
                ${field(L('SDK 路径（可选）', 'SDK path (optional)'), input('sdkPath', d.sdkPath, 'maxlength="500" placeholder="welink-cli 安装目录或 node_modules"'), L('留空时依次使用平台内置 SDK、项目依赖、npm 全局目录', 'Blank = built-in SDK, then project and npm global modules'), true)}
            </div>
            <div class="nch-row">
                <button type="button" class="nch-btn primary" data-action="qr" ${qr && qr.running ? 'disabled' : ''}>📱 ${esc(qr && qr.running ? L('等待扫码…', 'Waiting for scan…') : L('扫码授权', 'Scan to authorize'))}</button>
                ${view.config.hasSk ? `<button type="button" class="nch-btn danger" data-action="clear-sk">${esc(L('清除已保存 SK', 'Clear saved SK'))}</button>` : ''}
                <span class="nch-muted">${esc(L('扫码使用上方填写的环境与 Channel，确认后自动保存凭据。', 'Uses the environment and Channel above; credentials are saved after confirmation.'))}</span>
            </div>
            ${qr ? renderQr(qr) : ''}`;
    }

    function renderQr(qr) {
        const display = qr.display || {};
        let image = '';
        if (qr.type === 'qrcode_generated' && (display.weUrl || display.qrcode || qr.qrcode)) {
            try {
                image = window.ToolsQrCode ? window.ToolsQrCode.toSvg(display.weUrl || display.qrcode || qr.qrcode, { scale: 4, border: 2 }) : '';
            } catch (_) { image = ''; }
        }
        const messages = {
            starting: L('正在生成二维码…', 'Generating QR code…'),
            qrcode_generated: isWeixin() ? L('请使用手机微信扫描二维码并确认。', 'Scan with WeChat and confirm.') : L('请使用 WeLink 扫描二维码并确认授权。', 'Scan with WeLink and confirm.'),
            need_verifycode: qr.retry ? L('数字不匹配，请重新输入手机微信上显示的数字：', 'Mismatch. Re-enter the number shown in WeChat:') : L('请输入手机微信上显示的数字以继续：', 'Enter the number shown in WeChat to continue:'),
            scanned: L('已扫码，请在手机上确认授权…', 'Scanned. Confirm on your phone…'),
            expired: L('二维码已过期，正在刷新…', 'QR expired, refreshing…'),
            cancelled: L('已在手机上取消授权。', 'Authorization cancelled.'),
            confirmed: isWeixin() ? L('登录成功，凭据已保存。', 'Linked. Credentials saved.') : L('授权成功，AK/SK 已保存。', 'Authorized. AK/SK saved.'),
            failed: L('授权失败：', 'Authorization failed: '),
            error: L('授权失败：', 'Authorization failed: ')
        };
        const failDetail = qr.type === 'failed' ? (qr.serviceError?.message || qr.serviceError?.error || qr.reasonCode || '') : (qr.type === 'error' ? qr.error : '');
        return `<div class="nch-qr">
            ${image ? `<div class="nch-qr-img">${image}</div>` : ''}
            <div class="nch-qr-info">
                <b>${esc(messages[qr.type] || qr.type)}${esc(failDetail || '')}</b>
                ${qr.expiresAt ? `<div>${esc(L('有效期至', 'Expires'))} ${esc(new Date(qr.expiresAt).toLocaleTimeString())}</div>` : ''}
                ${display.pcUrl ? `<div><a href="${esc(display.pcUrl)}" target="_blank" rel="noopener">${esc(L('在 WeLink 桌面端打开授权', 'Open in WeLink desktop'))}</a></div>` : ''}
                ${display.weUrl ? `<div class="nch-muted">${esc(display.weUrl)}</div>` : ''}
                ${qr.type === 'need_verifycode' ? `<div class="nch-row"><input data-role="qr-verify-code" inputmode="numeric" maxlength="12" placeholder="${esc(L('手机上显示的数字', 'Number on phone'))}"><button type="button" class="nch-btn primary" data-action="qr-verify">${esc(L('提交', 'Submit'))}</button></div>` : ''}
                ${qr.assistantInfo ? `<div>🤖 ${esc(qr.assistantInfo.name || '')} ${qr.assistantInfo.desc ? `· ${esc(qr.assistantInfo.desc)}` : ''}</div>` : ''}
            </div>
        </div>`;
    }

    function renderBehaviorCard() {
        const d = view.draft;
        const modelOptions = view.models.map(model => `<option value="${esc(model.id)}" ${d.modelId === model.id ? 'selected' : ''}>${esc(model.name || model.id)}</option>`).join('');
        return `
            <h4>🧠 ${esc(L('助理行为', 'Assistant behavior'))}</h4>
            <p class="nch-desc">${esc(L(`${channelLabel()} 用户的消息默认交给 Dragon Claw 回答（只读平台知识与数据，不开放工作区与写操作），对话记录按「${view.channel}:账号」保存在聊天记录中心。`, `Messages are answered by Dragon Claw by default (read-only platform knowledge and data, no workspace or write tools). Conversations are saved in the chat history center as "${view.channel}:<account>".`))}</p>
            <div class="nch-grid">
                ${field(L('回复引擎', 'Reply engine'), `<select data-path="replyEngine"><option value="dragon-claw" ${d.replyEngine === 'dragon-claw' ? 'selected' : ''}>Dragon Claw ${esc(L('智能回复', 'AI reply'))}</option><option value="rule" ${d.replyEngine === 'rule' ? 'selected' : ''}>${esc(L('规则回复（不调用模型）', 'Rule reply (no model)'))}</option></select>`)}
                ${field(L('对话模型', 'Model'), `<select data-path="modelId"><option value="">${esc(L('跟随当前激活方案', 'Follow active profile'))}</option>${modelOptions}</select>`, L('来自「AI 助手」中的模型映射', 'From model aliases in AI settings'))}
                <label class="nch-switch" style="align-self:end;height:32px"><input type="checkbox" data-path="slashCommandsEnabled" ${d.slashCommandsEnabled ? 'checked' : ''}> ${esc(L('启用斜杠命令 /help /new /whoami /status', 'Enable slash commands /help /new /whoami /status'))}</label>
                ${field(L('无权限时的回复', 'Reply when access is denied'), `<textarea data-path="deniedReply" maxlength="500">${esc(d.deniedReply)}</textarea>`, L('留空则静默不回复', 'Leave blank to stay silent'), true)}
            </div>`;
    }

    function chipList(items, kind, cls, removeAction) {
        if (!items.length) return `<span class="nch-muted">${esc(L('名单为空', 'Empty'))}</span>`;
        const names = new Map(view.targets.map(item => [`${item.kind}:${item.id}`, item.name]));
        return items.map((id, index) => {
            const name = names.get(`${kind}:${id}`);
            return `<span class="nch-chip ${cls}" title="${esc(id)}"><span>${esc(name && name !== id ? `${name} (${id})` : id)}</span><button type="button" aria-label="remove" data-action="${removeAction}" data-index="${index}">×</button></span>`;
        }).join('');
    }

    function renderAccessColumn(scope) {
        const rule = view.draft.access[scope];
        const kind = scope === 'users' ? 'user' : 'group';
        const listKey = rule.mode === 'blacklist' ? 'blacklist' : 'whitelist';
        const listLabel = rule.mode === 'blacklist' ? L('黑名单', 'Blocklist') : L('白名单', 'Allowlist');
        return `<div class="nch-access-col">
            <h5>${scope === 'users' ? '👤 ' + esc(L('人员', 'People')) : '👥 ' + esc(L('群组', 'Groups'))}</h5>
            <div class="nch-seg">${['all', 'whitelist', 'blacklist'].map(mode => `<button type="button" class="${rule.mode === mode ? 'active' : ''}" data-action="access-mode" data-scope="${scope}" data-mode="${mode}">${esc(L(MODE_LABEL[mode][0], MODE_LABEL[mode][1]))}</button>`).join('')}</div>
            ${rule.mode === 'all'
                ? `<div class="nch-muted">${esc(scope === 'users' ? L('所有人员都可以使用助理。', 'Everyone can use the assistant.') : L('所有群都可以使用助理。', 'All groups can use the assistant.'))}${rule.whitelist.length || rule.blacklist.length ? esc(L(`（已保存白名单 ${rule.whitelist.length} / 黑名单 ${rule.blacklist.length}，切换模式即可启用）`, ` (saved: ${rule.whitelist.length} allowed / ${rule.blacklist.length} blocked)`)) : ''}</div>`
                : `<div class="nch-muted" style="margin-bottom:6px">${esc(listLabel)} · ${rule[listKey].length}</div>
                   <div class="nch-chips">${chipList(rule[listKey], kind, rule.mode === 'blacklist' ? 'black' : (kind === 'group' ? 'group' : ''), `access-remove-${scope}`)}</div>
                   <div class="nch-row">
                       <button type="button" class="nch-btn" data-action="access-pick" data-scope="${scope}">${esc(L('从历史选择', 'Pick from history'))}</button>
                       <input data-role="access-input-${scope}" maxlength="200" placeholder="${esc(scope === 'users' ? L('输入账号，回车添加', 'Account, Enter to add') : L('输入群 ID，回车添加', 'Group ID, Enter to add'))}">
                       ${rule[listKey].length ? `<button type="button" class="nch-link danger" data-action="access-clear" data-scope="${scope}">${esc(L('清空', 'Clear'))}</button>` : ''}
                   </div>`}
        </div>`;
    }

    function renderAccessCard() {
        return `
            <h4>🛡️ ${esc(L('访问控制（黑白名单）', 'Access control'))}</h4>
            <p class="nch-desc">${esc(L('消息需同时通过人员规则与群组规则（群聊时）才会被处理；主动推送同样遵守。白名单模式下只有名单内可用，黑名单模式下名单内被禁止。不知道账号或群 ID 时，可让对方给助理发送 /whoami 查看。', 'A message must pass the people rule and, in groups, the group rule. Pushes follow the same rules. Ask someone to send /whoami to the assistant to find their account or group ID.'))}</p>
            <div class="nch-access">${renderAccessColumn('users')}${renderAccessColumn('groups')}</div>`;
    }

    function renderPushCard() {
        const push = view.draft.push;
        const names = new Map(view.targets.map(item => [`${item.kind}:${item.id}`, item]));
        const chips = push.defaultTargets.length
            ? push.defaultTargets.map((item, index) => {
                const known = names.get(`${item.kind}:${item.id}`);
                return `<span class="nch-chip ${item.kind === 'group' ? 'group' : ''}" title="${esc(item.id)}"><span>${item.kind === 'group' ? '👥' : '👤'} ${esc(known?.name || item.id)}${known && !known.canPush ? ' ⚠️' : ''}</span><button type="button" aria-label="remove" data-action="push-remove" data-index="${index}">×</button></span>`;
            }).join('')
            : `<span class="nch-muted">${esc(L('未设置默认推送范围', 'No default recipients'))}</span>`;
        return `
            <h4>📨 ${esc(L('主动推送', 'Proactive push'))}</h4>
            <p class="nch-desc">${esc(isWeixin() ? L('平台其他页面、后台任务可调用推送能力（channel: \'weixin\'）。未指定对象时推送到下方默认范围。只有给助理发过消息的微信联系人才能接收推送（⚠️ 表示暂无可用会话）；微信助理暂不支持向群推送。', 'Other pages and jobs can push with channel \'weixin\'. Only contacts who have messaged the assistant can receive pushes (⚠️ = none yet); group push is not supported.') : L('平台其他页面、后台任务与 Dragon Claw 可调用推送能力。未指定对象时推送到下方默认范围。只有与助理单聊过的人员、使用过助理的群才能接收推送（⚠️ 表示暂无可用会话）。', 'Other pages, background jobs and Dragon Claw can push messages. Without explicit recipients, messages go to the default scope below. Only people who have chatted with the assistant and groups that used it can receive pushes (⚠️ = no session yet).'))}</p>
            <div class="nch-muted" style="margin-bottom:6px">${esc(L('默认推送范围', 'Default recipients'))} · ${push.defaultTargets.length}</div>
            <div class="nch-chips">${chips}</div>
            <div class="nch-row">
                <button type="button" class="nch-btn" data-action="push-pick">${esc(L('从历史选择', 'Pick from history'))}</button>
                ${push.defaultTargets.length ? `<button type="button" class="nch-link danger" data-action="push-clear">${esc(L('清空', 'Clear'))}</button>` : ''}
            </div>
            <label class="nch-switch" style="margin-top:12px"><input type="checkbox" data-path="push.allowUserPush" ${push.allowUserPush ? 'checked' : ''}> ${esc(L('允许普通登录用户调用推送（仅限默认推送范围内的目标）', 'Allow non-admin users to push (default recipients only)'))}</label>
            <div class="nch-grid" style="margin-top:12px">
                ${field(L('测试推送内容', 'Test message'), `<textarea data-role="test-push-text" maxlength="2000">${esc(L('这是一条来自平台的测试推送 ✅', 'Test push from the platform ✅'))}</textarea>`, '', true)}
            </div>
            <div class="nch-row">
                <button type="button" class="nch-btn primary" data-action="push-test-default">${esc(L('发送到默认范围', 'Send to default scope'))}</button>
                <button type="button" class="nch-btn" data-action="push-test-pick">${esc(L('选择对象发送…', 'Choose recipients…'))}</button>
                <span class="nch-muted" data-role="push-result"></span>
            </div>
            <details style="margin-top:10px"><summary class="nch-muted" style="cursor:pointer">${esc(L('开发者调用方式', 'Developer usage'))}</summary>
<pre class="nch-code">// 前端页面（引入 /js/shared/channels.js）
const targets = await ToolsChannels.pickTargets({ channel: '${view.channel}', pushableOnly: true });
await ToolsChannels.push({ channel: '${view.channel}', text: '**月报已发布**', targets, source: '月报' });

// 后端模块（请求上下文内，或先 runWithTenant）
const channels = require('./models/channels');
await channels.push({ channel: '${view.channel}', text: '告警：xxx', targets: [{ kind: '${isWeixin() ? 'user' : 'group'}', id: '${isWeixin() ? '微信用户ID' : '群ID'}' }] });

// Dragon Claw（工作区模式）可调用工具 welink_list_targets / welink_send_message（需审批）</pre></details>`;
    }

    function renderTargetsCard() {
        const rows = view.targets.map(item => `<tr>
            <td>${item.kind === 'group' ? '👥 ' + esc(L('群组', 'Group')) : '👤 ' + esc(L('人员', 'Person'))}</td>
            <td><b>${esc(item.name)}</b><div class="nch-id">${esc(item.id)}</div></td>
            <td>${esc(window.ToolsChannels.relativeTime(item.lastActiveAt))}<div class="nch-id">${esc(new Date(item.lastActiveAt).toLocaleString())}</div></td>
            <td>${esc(item.messageCount)}</td>
            <td>${item.canPush ? `<span class="nch-badge ok">${esc(L('可推送', 'Yes'))}</span>` : `<span class="nch-badge">${esc(item.kind === 'user' ? L('未单聊', 'No DM') : L('无会话', 'No session'))}</span>`}</td>
            <td style="white-space:nowrap"><button type="button" class="nch-link" data-action="target-alias" data-kind="${esc(item.kind)}" data-id="${esc(item.id)}">${esc(L('备注', 'Alias'))}</button><button type="button" class="nch-link danger" data-action="target-delete" data-kind="${esc(item.kind)}" data-id="${esc(item.id)}">${esc(L('删除', 'Delete'))}</button></td>
        </tr>`).join('');
        return `
            <h4>👥 ${esc(L('联系人与群组', 'Contacts & groups'))}</h4>
            <p class="nch-desc">${esc(L('与助理互动过的人员和群组，按最近活跃由近及远排序。可设置备注方便在名单与推送中识别。', 'People and groups that have used the assistant, most recent first. Add aliases to recognise them in lists.'))}</p>
            <div class="nch-row" style="margin-top:0">
                <div class="nch-seg" style="margin:0">${['all', 'user', 'group'].map(kind => `<button type="button" class="${view.targetFilter.kind === kind ? 'active' : ''}" data-action="target-kind" data-kind="${kind}">${esc(kind === 'all' ? L('全部', 'All') : kind === 'user' ? L('人员', 'People') : L('群组', 'Groups'))}</button>`).join('')}</div>
                <input type="search" data-role="target-q" value="${esc(view.targetFilter.q)}" placeholder="${esc(L('搜索账号、名称或备注', 'Search'))}">
                <button type="button" class="nch-btn" data-action="target-refresh">${esc(L('刷新', 'Refresh'))}</button>
            </div>
            <div class="nch-table-wrap"><table class="nch-table">
                <thead><tr><th>${esc(L('类型', 'Type'))}</th><th>${esc(L('名称 / ID', 'Name / ID'))}</th><th>${esc(L('最近活跃', 'Last active'))}</th><th>${esc(L('消息', 'Msgs'))}</th><th>${esc(L('推送', 'Push'))}</th><th></th></tr></thead>
                <tbody>${rows || `<tr><td colspan="6" class="nch-muted">${esc(L('暂无记录', 'No records yet'))}</td></tr>`}</tbody>
            </table></div>`;
    }

    function renderMessageLog() {
        const statusBadge = status => {
            if (status === 'ok') return `<span class="nch-badge ok">${esc(L('成功', 'OK'))}</span>`;
            if (status === 'denied') return `<span class="nch-badge warn">${esc(L('已拒绝', 'Denied'))}</span>`;
            if (status === 'aborted') return `<span class="nch-badge">${esc(L('已中止', 'Aborted'))}</span>`;
            return `<span class="nch-badge bad">${esc(L('失败', 'Error'))}</span>`;
        };
        const log = view.messageLog;
        const rows = view.messages.map(item => {
            const long = item.text.length > MESSAGE_PREVIEW_CHARS;
            const open = log.expanded.has(item.id);
            return `<tr>
            <td style="white-space:nowrap">${esc(new Date(item.createdAt).toLocaleString())}</td>
            <td style="white-space:nowrap">${item.direction === 'in' ? '⬇️ ' + esc(L('收到', 'In')) : '⬆️ ' + esc(item.trigger === 'reply' ? L('回复', 'Reply') : L('推送', 'Push'))}</td>
            <td>${item.kind === 'group' ? '👥' : '👤'} ${esc(item.targetId)}${item.sender && item.sender !== item.targetId ? `<div class="nch-id">${esc(item.sender)}</div>` : ''}</td>
            <td>${statusBadge(item.status)}${item.error ? `<div class="nch-id">${esc(item.error)}</div>` : ''}</td>
            <td class="nch-text">${esc(long && !open ? `${item.text.slice(0, MESSAGE_PREVIEW_CHARS)}…` : item.text)}${long ? ` <button type="button" class="nch-link" data-action="message-expand" data-id="${esc(item.id)}">${esc(open ? L('收起', 'Less') : L('展开全文', 'Show all'))}</button>` : ''}${item.source ? `<div class="nch-id">${esc(item.source)}</div>` : ''}</td>
        </tr>`;
        }).join('');
        // 末行：加载状态 / 加载更多（滚到底自动触发）/ 已全部显示
        const footer = !log.loaded && !log.error
            ? `<tr data-role="messages-more"><td colspan="5" class="nch-muted">${esc(log.loading ? L('正在加载消息日志…', 'Loading message log…') : L('滚动到这里时加载', 'Loads when scrolled into view'))}</td></tr>`
            : log.error
                ? `<tr data-role="messages-more"><td colspan="5" class="nch-muted">${esc(L('加载失败：', 'Failed to load: '))}${esc(log.error)} <button type="button" class="nch-link" data-action="${log.loaded ? 'messages-more' : 'messages-refresh'}">${esc(L('重试', 'Retry'))}</button></td></tr>`
                : !view.messages.length
                    ? `<tr><td colspan="5" class="nch-muted">${esc(L('暂无消息', 'No messages yet'))}</td></tr>`
                    : log.hasMore
                        ? `<tr data-role="messages-more"><td colspan="5" class="nch-muted">${log.loading ? esc(L('正在加载更早的消息…', 'Loading earlier messages…')) : `<button type="button" class="nch-link" data-action="messages-more">${esc(L(`加载更多（已显示 ${view.messages.length} / 共 ${log.total} 条）`, `Load more (${view.messages.length} of ${log.total})`))}</button>`}</td></tr>`
                        : `<tr><td colspan="5" class="nch-muted">${esc(L(`已显示全部 ${view.messages.length} 条`, `All ${view.messages.length} shown`))}</td></tr>`;
        return `
            <h4>🧾 ${esc(L('消息日志', 'Message log'))} <button type="button" class="nch-link" data-action="messages-refresh">${esc(L('刷新', 'Refresh'))}</button>${log.loaded ? `<span class="nch-muted" style="font-weight:400;font-size:12px;margin-left:6px">${esc(L(`共 ${log.total} 条`, `${log.total} total`))}</span>` : ''}</h4>
            <div class="nch-table-wrap" data-role="messages-log"><table class="nch-table">
                <thead><tr><th>${esc(L('时间', 'Time'))}</th><th>${esc(L('方向', 'Direction'))}</th><th>${esc(L('对象', 'Target'))}</th><th>${esc(L('状态', 'Status'))}</th><th>${esc(L('内容', 'Content'))}</th></tr></thead>
                <tbody>${rows}${footer}</tbody>
            </table></div>`;
    }

    function renderMessagesCard() {
        return `<div data-role="messages-log-area">${renderMessageLog()}</div>
            <details class="nch-diag" style="margin-top:12px" data-role="diag"><summary class="nch-muted" style="cursor:pointer">${esc(L('诊断信息（网关状态、调用轨迹、运行日志）', 'Diagnostics (gateway state, traces, logs)'))}</summary><pre data-role="diag-body">${esc(L('展开后加载…', 'Loads when expanded…'))}</pre></details>`;
    }

    function render() {
        const content = view.content;
        if (!content || !view.draft) return;
        const tabs = `<div class="nch-tabs">${CHANNEL_TABS.map(tab => `<button type="button" class="nch-tab ${tab.id === view.channel ? 'active' : ''}" data-action="channel-tab" data-channel="${tab.id}">${tab.icon} ${esc(L(tab.label[0], tab.label[1]))}${tab.id === view.channel && !PANELS[tab.id] ? `<i class="${view.status?.connected ? 'ok' : ''}"></i>` : ''}</button>`).join('')}</div>`;
        if (isPanel()) {
            content.innerHTML = `<div class="nch">${tabs}<div data-role="panel-root" style="display:flex;flex-direction:column;gap:14px"></div></div>`;
            window[PANELS[view.channel].global].render(content.querySelector('[data-role="panel-root"]'));
            return;
        }
        content.innerHTML = `
            <div class="nch">
                ${tabs}
                <section class="nch-card" data-role="status-card"></section>
                <section class="nch-card">${renderConnectionCard()}</section>
                ${isWeixin() ? '' : '<section class="nch-card" data-role="welink-cli-card"></section>'}
                <section class="nch-card">${renderBehaviorCard()}</section>
                <section class="nch-card" data-role="access-card">${renderAccessCard()}</section>
                <section class="nch-card" data-role="push-card">${renderPushCard()}</section>
                <section class="nch-card" data-role="targets-card">${renderTargetsCard()}</section>
                <section class="nch-card" data-role="messages-card">${renderMessagesCard()}</section>
                <div class="nch-savebar">
                    <span data-role="save-state" class="${view.dirty ? 'dirty' : ''}">${esc(view.dirty ? L('有未保存的修改', 'Unsaved changes') : (view.config.updatedAt ? L(`上次保存：${new Date(view.config.updatedAt).toLocaleString()}`, `Last saved: ${new Date(view.config.updatedAt).toLocaleString()}`) : L('尚未保存过配置', 'Not saved yet')))}</span>
                    <button type="button" class="nch-btn" data-action="reload">${esc(L('放弃修改', 'Discard'))}</button>
                    <button type="button" class="nch-btn primary" data-action="save">${esc(L('保存配置', 'Save'))}</button>
                </div>
            </div>`;
        renderStatusCard();
        bindMessageLog();
        renderWelinkCliCard();
    }

    // 个人身份（welink-cli）卡片独立维护状态，按需加载（welink-cli-settings.js）
    function renderWelinkCliCard() {
        const el = view.content?.querySelector('[data-role="welink-cli-card"]');
        if (!el) return;
        loadScript('./tp-static/frontend/js/shared/welink-cli-settings.js', 'ToolsWelinkCli')
            .then(() => { if (document.body.contains(el)) window.ToolsWelinkCli.render(el); })
            .catch(error => { el.innerHTML = `<p class="nch-desc">${esc(error.message)}</p>`; });
    }

    function rerenderSection(role, html) {
        const el = view.content?.querySelector(`[data-role="${role}"]`);
        if (el) el.innerHTML = html;
        if (role === 'messages-card') bindMessageLog();
    }

    // 只重绘日志表格：保留诊断面板的展开状态与表格滚动位置
    function rerenderMessageLog({ toTop = false } = {}) {
        const area = view.content?.querySelector('[data-role="messages-log-area"]');
        if (!area) return;
        const scrollTop = toTop ? 0 : area.querySelector('[data-role="messages-log"]')?.scrollTop || 0;
        area.innerHTML = renderMessageLog();
        const wrap = area.querySelector('[data-role="messages-log"]');
        if (wrap) wrap.scrollTop = scrollTop;
        bindMessageLog();
    }

    // 日志卡片进入视口才取第一页；表格内滚到末行附近再取下一页。不支持 IntersectionObserver 时直接加载，末行按钮可手动翻页
    function bindMessageLog() {
        const log = view.messageLog;
        log.observer?.disconnect();
        log.observer = null;
        const sentinel = view.content?.querySelector('[data-role="messages-more"]');
        if (!sentinel || log.loading || log.error || (log.loaded && !log.hasMore)) return;
        if (!('IntersectionObserver' in window)) {
            if (!log.loaded) loadMessages({ reset: true });
            return;
        }
        const wrap = view.content.querySelector('[data-role="messages-log"]');
        log.observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            log.observer?.disconnect();
            log.observer = null;
            loadMessages({ reset: !log.loaded });
        }, { root: log.loaded ? wrap : null, rootMargin: log.loaded ? '0px 0px 120px 0px' : '0px 0px 200px 0px' });
        log.observer.observe(sentinel);
    }

    // ── 交互 ─────────────────────────────────────────────
    function setPath(path, value) {
        const parts = path.split('.');
        let cursor = view.draft;
        parts.slice(0, -1).forEach(part => { cursor = cursor[part]; });
        cursor[parts.at(-1)] = value;
        markDirty();
    }

    function addAccessId(scope, id) {
        const rule = view.draft.access[scope];
        const key = rule.mode === 'blacklist' ? 'blacklist' : 'whitelist';
        const value = String(id || '').trim();
        if (!value || rule[key].includes(value)) return;
        rule[key].push(value);
        markDirty();
    }

    async function save(extra = {}) {
        const payload = clone(view.draft);
        if (!payload.sk) delete payload.sk;
        if (!payload.token) delete payload.token;
        Object.assign(payload, extra);
        const result = await api('PUT', '/config', payload);
        view.config = result.config;
        view.draft = clone(result.config);
        view.draft.sk = '';
        view.draft.token = '';
        view.status = result.status;
        view.dirty = false;
        render();
        const st = result.status || {};
        if (st.enabled && !st.connected && !isWeixin() && !st.sdk?.available) setNotice('ok', L('配置已保存（SDK 就绪后即可连接）', 'Settings saved (connect once the SDK is available)'));
        else if (st.lastError && st.enabled && !st.connected) setNotice('bad', L(`已保存，但连接失败：${st.lastError.message}`, `Saved, but connection failed: ${st.lastError.message}`));
        else setNotice('ok', L('配置已保存', 'Settings saved'));
    }

    async function runQr() {
        if (view.dirty) await save();
        view.qr = { type: 'starting', running: true };
        render();
        try {
            const res = await fetch(`/api/channels/${view.channel}/qrcode-auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(isWeixin() ? {} : { environment: view.draft.environment, channel: view.draft.channel })
            });
            if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let final = null;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                lines.filter(Boolean).forEach(line => {
                    const event = JSON.parse(line);
                    if (event.type === 'snapshot') {
                        // 等待输入验证码时保留已生成的二维码，避免重绘时清掉输入框外的内容
                        view.qr = { ...event.snapshot, running: !['confirmed', 'cancelled', 'failed'].includes(event.snapshot.type) };
                    }
                    if (event.type === 'error') view.qr = { type: 'error', error: event.error, running: false };
                    if (event.type === 'done') final = event;
                });
                rerenderConnection();
            }
            if (view.qr) view.qr.running = false;
            if (final?.saved) {
                await loadAll();
                view.qr = { type: 'confirmed', assistantInfo: isWeixin() ? null : view.config.assistantInfo, running: false };
                render();
                return;
            }
        } catch (error) {
            view.qr = { type: 'error', error: error.message, running: false };
        }
        rerenderConnection();
    }

    function rerenderConnection() {
        const card = view.content?.querySelector('[data-action="qr"]')?.closest('.nch-card');
        if (card) card.innerHTML = renderConnectionCard();
    }

    async function sendTestPush(targets) {
        const text = view.content.querySelector('[data-role="test-push-text"]')?.value || '';
        const resultEl = view.content.querySelector('[data-role="push-result"]');
        resultEl.textContent = L('发送中…', 'Sending…');
        try {
            const result = await window.ToolsChannels.push({ channel: view.channel, text, targets, source: L('频道对接 · 测试推送', 'Channels · test push') });
            const failures = result.results.filter(item => !item.ok).map(item => `${item.name}：${item.error}`);
            resultEl.textContent = L(`成功 ${result.sent}，失败 ${result.failed}`, `${result.sent} sent, ${result.failed} failed`) + (failures.length ? ` — ${failures.slice(0, 3).join('；')}` : '');
            if (view.messageLog.loaded) await loadMessages({ reset: true });
        } catch (error) {
            resultEl.textContent = error.message;
        }
    }

    // 从所选文件夹（或单个文件）中找出 bridge-runtime-sdk 的 dist/index.js、index.d.ts 与 package.json
    async function readSdkFiles(fileList) {
        const files = Array.from(fileList || []);
        const rel = file => String(file.webkitRelativePath || file.name).replace(/\\/g, '/');
        let candidates = files.filter(file => /(^|\/)dist\/index\.m?js$/.test(rel(file)));
        if (!candidates.length && files.length === 1 && /\.m?js$/i.test(files[0].name)) candidates = files;
        const preferred = candidates.filter(file => rel(file).includes('bridge-runtime-sdk/'));
        if (preferred.length) candidates = preferred;
        if (!candidates.length) throw new Error(L('所选内容里没有找到 bridge-runtime-sdk/dist/index.js，请选择 @wecode 或 bridge-runtime-sdk 文件夹。', 'No bridge-runtime-sdk/dist/index.js found. Choose the @wecode or bridge-runtime-sdk folder.'));
        if (candidates.length > 1) throw new Error(L('找到多个 dist/index.js，请直接选择 bridge-runtime-sdk 文件夹。', 'Several dist/index.js files found. Choose the bridge-runtime-sdk folder itself.'));
        const entry = candidates[0];
        const dir = rel(entry).replace(/[^/]*$/, '');
        const pkgDir = dir.replace(/dist\/$/, '');
        const types = files.find(file => rel(file) === `${dir}index.d.ts`);
        const pkg = files.find(file => rel(file) === `${pkgDir}package.json`) || files.find(file => rel(file) === `${dir}package.json`);
        return {
            entry: await entry.text(),
            types: types ? await types.text() : '',
            packageJson: pkg ? await pkg.text() : '',
            fileName: rel(entry)
        };
    }

    async function importSdkFrom(fileList) {
        if (!fileList || !fileList.length) return;
        await runAction('sdk-import', async () => {
            view.notice = null;
            const payload = await readSdkFiles(fileList);
            const result = await api('POST', '/sdk/import', payload);
            view.status = result.status;
            const caps = result.sdk.capabilities || {};
            const running = result.status?.runtime && result.status.runtime.state !== 'idle';
            const shownVersion = /unknown/.test(result.sdk.version || '') ? L('（版本未知）', ' (unknown version)') : ` ${result.sdk.version}`;
            setNotice('ok', L(`已导入 SDK${shownVersion}${caps.qrcodeAuth ? '（支持扫码授权）' : '（不含扫码授权）'}${running ? '，点击「重启连接」后生效' : ''}`,
                `Imported SDK${shownVersion}${caps.qrcodeAuth ? ' (QR auth supported)' : ' (no QR auth)'}${running ? '; restart the connection to apply' : ''}`));
        });
    }

    async function switchChannel(channel) {
        if (!CHANNEL_TABS.some(tab => tab.id === channel) || channel === view.channel) return undefined;
        if (view.dirty && !await confirmDialog(L('当前频道有未保存的修改，切换后将丢失。继续？', 'Unsaved changes will be lost. Continue?'), { title: L('切换频道', 'Switch channel'), confirmText: L('切换', 'Switch') })) return undefined;
        view.channel = channel;
        try { localStorage.setItem(CHANNEL_STORE_KEY, channel); } catch (_) { /* 仅记住选项卡 */ }
        Object.assign(view, { notice: null, testResult: null, qr: null, busy: '', targetFilter: { kind: 'all', q: '' } });
        view.content.innerHTML = `<div class="nav-settings-empty">${esc(L('正在加载频道对接配置…', 'Loading channel settings…'))}</div>`;
        await loadAll();
        return render();
    }

    async function onClick(event) {
        const button = event.target.closest('[data-action]');
        if (!button || !view.content.contains(button)) return;
        const action = button.dataset.action;
        const scope = button.dataset.scope;
        if (action === 'recheck') return runAction('recheck', async () => { view.status = await api('POST', '/sdk/recheck'); setNotice(view.status.sdk.available ? 'ok' : 'bad', view.status.sdk.available ? L('已检测到 SDK', 'SDK detected') : ''); });
        if (action === 'sdk-import-folder' || action === 'sdk-import-file') {
            const input = view.content.querySelector(`[data-role="${action === 'sdk-import-folder' ? 'sdk-folder' : 'sdk-file'}"]`);
            input.value = '';
            input.onchange = () => importSdkFrom(input.files);
            input.click();
            return undefined;
        }
        if (action === 'sdk-remove') {
            if (!await confirmDialog(L('移除已导入的 SDK？之后将回退到平台内置或 welink-cli 安装的版本。', 'Remove the imported SDK? The built-in or welink-cli version will be used instead.'), { title: L('移除 SDK', 'Remove SDK'), tone: 'danger', confirmText: L('移除', 'Remove') })) return undefined;
            return runAction('sdk-remove', async () => { const result = await api('DELETE', '/sdk/import'); view.status = result.status; setNotice('ok', L('已移除导入的 SDK', 'Imported SDK removed')); });
        }
        if (action === 'test') return runAction('test', async () => { view.notice = null; view.testResult = await api('POST', '/test'); view.status = await api('GET', '/status'); });
        if (action === 'connect' || action === 'restart' || action === 'disconnect') {
            return runAction(action, async () => { view.notice = null; view.status = await api('POST', `/${action}`); });
        }
        if (action === 'save') return runAction('save', () => save());
        if (action === 'reload') return runAction('reload', async () => { await loadAll(); render(); });
        if (action === 'clear-sk') {
            if (!await confirmDialog(L('确定清除已保存的 SK？清除后无法连接网关。', 'Clear the saved SK? The gateway connection will stop working.'), { title: L('清除 SK', 'Clear SK'), tone: 'danger', confirmText: L('清除', 'Clear') })) return;
            return runAction('save', () => save({ clearSk: true }));
        }
        if (action === 'qr') return runQr();
        if (action === 'channel-tab') return switchChannel(button.dataset.channel);
        if (action === 'qr-verify') {
            const code = view.content.querySelector('[data-role="qr-verify-code"]')?.value || '';
            await api('POST', '/qrcode-auth/verify', { code });
            view.qr = { ...view.qr, type: 'scanned' };
            return rerenderConnection();
        }
        if (action === 'clear-token') {
            if (!await confirmDialog(L('确定清除已保存的微信 bot token？清除后微信助理将无法收发消息。', 'Clear the saved WeChat bot token? The assistant will stop working.'), { title: L('清除 Token', 'Clear token'), tone: 'danger', confirmText: L('清除', 'Clear') })) return undefined;
            return runAction('save', () => save({ clearToken: true }));
        }
        if (action === 'openclaw-import') {
            if (view.config.hasToken && !await confirmDialog(L('用本机 OpenClaw 已登录的微信 bot 覆盖当前凭据？', 'Replace the current credentials with the bot linked in local OpenClaw?'), { title: L('导入 OpenClaw 凭据', 'Import from OpenClaw'), confirmText: L('导入', 'Import') })) return undefined;
            return runAction('openclaw-import', async () => {
                if (view.dirty) await save();
                const result = await api('POST', '/openclaw/import');
                await loadAll();
                render();
                const oc = result.status?.openclaw || {};
                setNotice('ok', L(`已导入 OpenClaw 微信 bot ${result.accountId}${oc.pluginEnabled !== false ? '。OpenClaw 仍在收这个 bot 的消息，请点击「暂停 OpenClaw 微信」' : ''}${result.status?.enabled ? '' : '；勾选「启用微信助理」并保存后开始收消息'}`, `Imported OpenClaw bot ${result.accountId}${oc.pluginEnabled !== false ? '. OpenClaw is still polling it; pause the OpenClaw WeChat plugin' : ''}`));
            });
        }
        if (action === 'openclaw-pause' || action === 'openclaw-resume') {
            const pause = action === 'openclaw-pause';
            if (!await confirmDialog(pause
                ? L('暂停 OpenClaw 的微信插件并重启 OpenClaw 网关？OpenClaw 将不再收发微信消息，其他频道不受影响（网关重启期间短暂不可用）。', 'Disable the OpenClaw WeChat plugin and restart the OpenClaw gateway? Other OpenClaw channels keep working.')
                : L('恢复 OpenClaw 的微信插件并重启 OpenClaw 网关？若与本平台使用同一个 bot，两边会抢收消息。', 'Re-enable the OpenClaw WeChat plugin and restart its gateway? If it shares the bot with the platform, both will compete for messages.'),
            { title: pause ? L('暂停 OpenClaw 微信', 'Pause OpenClaw WeChat') : L('恢复 OpenClaw 微信', 'Resume OpenClaw WeChat'), tone: pause ? 'danger' : undefined, confirmText: pause ? L('暂停', 'Pause') : L('恢复', 'Resume') })) return undefined;
            return runAction(action, async () => {
                const result = await api('POST', `/openclaw/${pause ? 'pause' : 'resume'}`);
                view.status = result.status;
                setNotice(result.restartNote ? 'bad' : 'ok', result.restartNote
                    ? L(`已修改 OpenClaw 配置，但网关重启失败，请手动执行 openclaw gateway restart：${result.restartNote}`, `Config changed but gateway restart failed: ${result.restartNote}`)
                    : (pause ? L('已暂停 OpenClaw 微信插件，OpenClaw 网关已重启', 'OpenClaw WeChat plugin paused; gateway restarted') : L('已恢复 OpenClaw 微信插件', 'OpenClaw WeChat plugin resumed')));
            });
        }
        if (action === 'access-mode') {
            view.draft.access[scope].mode = button.dataset.mode;
            markDirty();
            return rerenderSection('access-card', renderAccessCard());
        }
        if (action === 'access-pick') {
            const rule = view.draft.access[scope];
            const key = rule.mode === 'blacklist' ? 'blacklist' : 'whitelist';
            const kind = scope === 'users' ? 'user' : 'group';
            const picked = await window.ToolsChannels.pickTargets({
                channel: view.channel,
                title: `${scope === 'users' ? L('人员', 'People') : L('群组', 'Groups')} · ${key === 'blacklist' ? L('黑名单', 'Blocklist') : L('白名单', 'Allowlist')}`,
                kind,
                lockKind: true,
                selected: rule[key].map(id => ({ kind, id }))
            });
            if (!picked) return;
            rule[key] = picked.map(item => item.id);
            markDirty();
            return rerenderSection('access-card', renderAccessCard());
        }
        if (action === 'access-clear') {
            const rule = view.draft.access[scope];
            rule[rule.mode === 'blacklist' ? 'blacklist' : 'whitelist'] = [];
            markDirty();
            return rerenderSection('access-card', renderAccessCard());
        }
        if (action.startsWith('access-remove-')) {
            const target = action.slice('access-remove-'.length);
            const rule = view.draft.access[target];
            rule[rule.mode === 'blacklist' ? 'blacklist' : 'whitelist'].splice(Number(button.dataset.index), 1);
            markDirty();
            return rerenderSection('access-card', renderAccessCard());
        }
        if (action === 'push-pick') {
            const picked = await window.ToolsChannels.pickTargets({
                channel: view.channel,
                title: L('默认推送范围', 'Default recipients'),
                description: L('可多选人员与群组，按最近使用由近及远排序；支持全选、反选与过滤。', 'Choose people and groups, most recent first; select all, invert and filter are supported.'),
                selected: view.draft.push.defaultTargets,
                pushableOnly: true
            });
            if (!picked) return;
            view.draft.push.defaultTargets = picked.map(item => ({ kind: item.kind, id: item.id }));
            markDirty();
            return rerenderSection('push-card', renderPushCard());
        }
        if (action === 'push-remove') {
            view.draft.push.defaultTargets.splice(Number(button.dataset.index), 1);
            markDirty();
            return rerenderSection('push-card', renderPushCard());
        }
        if (action === 'push-clear') {
            view.draft.push.defaultTargets = [];
            markDirty();
            return rerenderSection('push-card', renderPushCard());
        }
        if (action === 'push-test-default') {
            if (view.dirty) await save();
            return sendTestPush(undefined);
        }
        if (action === 'push-test-pick') {
            const picked = await window.ToolsChannels.pickTargets({ channel: view.channel, title: L('选择测试推送对象', 'Choose test recipients'), pushableOnly: true });
            if (picked && picked.length) return sendTestPush(picked.map(item => ({ kind: item.kind, id: item.id })));
            return undefined;
        }
        if (action === 'target-kind') {
            view.targetFilter.kind = button.dataset.kind;
            await loadTargets();
            return rerenderSection('targets-card', renderTargetsCard());
        }
        if (action === 'target-refresh') {
            await Promise.all([loadTargets(), refreshStatus()]);
            return rerenderSection('targets-card', renderTargetsCard());
        }
        if (action === 'target-alias') {
            const current = view.targets.find(item => item.kind === button.dataset.kind && item.id === button.dataset.id);
            const alias = await promptDialog(L('设置备注（留空清除）', 'Alias (blank to clear)'), { title: L('设置备注', 'Set alias'), defaultValue: current?.alias || '', maxLength: 80 });
            if (alias === null) return undefined;
            await api('PUT', `/targets/${encodeURIComponent(button.dataset.kind)}/${encodeURIComponent(button.dataset.id)}`, { alias });
            await loadTargets();
            rerenderSection('targets-card', renderTargetsCard());
            rerenderSection('access-card', renderAccessCard());
            return rerenderSection('push-card', renderPushCard());
        }
        if (action === 'target-delete') {
            if (!await confirmDialog(L('删除该记录？对方再次使用助理时会重新出现；删除后在其再次发消息前无法向其推送。', 'Delete this record? It reappears when they use the assistant again; pushes to it stop until then.'), { title: L('删除记录', 'Delete record'), tone: 'danger', confirmText: L('删除', 'Delete') })) return undefined;
            await api('DELETE', `/targets/${encodeURIComponent(button.dataset.kind)}/${encodeURIComponent(button.dataset.id)}`);
            await loadTargets();
            return rerenderSection('targets-card', renderTargetsCard());
        }
        if (action === 'messages-refresh') return loadMessages({ reset: true });
        if (action === 'messages-more') return loadMessages();
        if (action === 'message-expand') {
            const id = Number(button.dataset.id);
            if (view.messageLog.expanded.has(id)) view.messageLog.expanded.delete(id);
            else view.messageLog.expanded.add(id);
            return rerenderMessageLog();
        }
        return undefined;
    }

    function onInput(event) {
        const el = event.target;
        if (el.dataset.path) {
            setPath(el.dataset.path, el.type === 'checkbox' ? el.checked : el.value);
            return;
        }
        if (el.dataset.role === 'target-q') {
            clearTimeout(view.searchTimer);
            view.searchTimer = setTimeout(async () => {
                view.targetFilter.q = el.value;
                await loadTargets();
                const card = view.content.querySelector('[data-role="targets-card"] tbody');
                if (card) {
                    const fresh = document.createElement('div');
                    fresh.innerHTML = renderTargetsCard();
                    card.replaceWith(fresh.querySelector('tbody'));
                }
            }, 250);
        }
    }

    function onKeydown(event) {
        const el = event.target;
        const match = /^access-input-(users|groups)$/.exec(el.dataset.role || '');
        if (match && event.key === 'Enter') {
            event.preventDefault();
            addAccessId(match[1], el.value);
            rerenderSection('access-card', renderAccessCard());
            view.content.querySelector(`[data-role="access-input-${match[1]}"]`)?.focus();
        }
    }

    async function onToggle(event) {
        const details = event.target;
        if (details.dataset?.role !== 'diag' || !details.open) return;
        const body = details.querySelector('[data-role="diag-body"]');
        try {
            const diag = await api('GET', '/diagnostics');
            body.textContent = JSON.stringify({ runtime: diag.runtime, provider: diag.status?.provider, logs: diag.logs }, null, 2);
        } catch (error) {
            body.textContent = error.message;
        }
    }

    function startPolling() {
        clearInterval(view.pollTimer);
        view.pollTimer = setInterval(() => {
            if (!view.content || !document.body.contains(view.content) || !view.content.querySelector('.nch')) {
                clearInterval(view.pollTimer);
                return;
            }
            if (!view.busy) refreshStatus();
        }, 5000);
    }

    async function renderInto(content) {
        ensureStyle();
        view.content = content;
        content.innerHTML = `<div class="nav-settings-empty">${esc(L('正在加载频道对接配置…', 'Loading channel settings…'))}</div>`;
        try {
            await Promise.all([loadScript('./tp-static/frontend/js/shared/channels.js', 'ToolsChannels'), loadScript('./tp-static/frontend/js/shared/qr-code.js', 'ToolsQrCode')]);
            await loadAll();
        } catch (error) {
            content.innerHTML = `<div class="nav-settings-empty">${esc(L('加载失败：', 'Failed to load: '))}${esc(error.message)}</div>`;
            return;
        }
        if (!content.dataset.channelSettingsBound) {
            content.dataset.channelSettingsBound = '1';
            content.addEventListener('click', event => { if (view.content === content && content.querySelector('.nch')) onClick(event).catch(error => setNotice('bad', error.message)); });
            content.addEventListener('input', event => { if (content.querySelector('.nch')) onInput(event); });
            content.addEventListener('change', event => { if (content.querySelector('.nch') && event.target.matches('select,input[type=checkbox]')) onInput(event); });
            content.addEventListener('keydown', event => { if (content.querySelector('.nch')) onKeydown(event); });
            content.addEventListener('toggle', event => { if (content.querySelector('.nch')) onToggle(event); }, true);
        }
        render();
        startPolling();
    }

    window.ToolsChannelSettings = { render: renderInto };
})();
