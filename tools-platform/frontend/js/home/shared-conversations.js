// 共享对话（首页 Dragon Claw）：右键对话「共享」→ 选择账号 / 常用群组 / 最近使用 → 发送邀请，底部可复制共享链接；
// 被邀请者登录后看到横幅（接受 / 拒绝 / 稍后），错过的在左下角消息中心里处理；接受后侧栏最上方出现可折叠的「共享对话」分类。
// 共享的只是上下文：之后每个人的新提问、文件和命令都在自己的账号与团队沙箱里执行。
// 后端：/api/shared-conversations（backend/models/shared-conversations.js）。后端还没有该接口时（未重启），入口全部隐藏。
(function () {
    'use strict';
    if (window.HomeSharedConversations) return;
    const API = '/api/shared-conversations';
    const PENDING_KEY = 'tools_pending_share';
    const BANNER_KEY = 'tools_shared_banner_seen';
    const en = () => (window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '').startsWith('en');
    const L = (zh, english) => (en() ? english : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const toast = message => (window.showToast ? window.showToast(message) : console.info(message));
    const me = () => { try { return localStorage.getItem('tools_user') || ''; } catch { return ''; } };
    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // 应用挂在网关子路径下时（数字人基座版 window.DH_BASE）：共享链接带上子路径；桌面版为空
    const appBase = () => String(window.DH_BASE || '').replace(/\/+$/, '');

    // 链接 /?share=<token>：先记下来（没登录时会被带去登录页），登录回到首页后再加入
    try {
        const url = new URL(location.href);
        const token = url.searchParams.get('share');
        if (token) {
            localStorage.setItem(PENDING_KEY, token);
            url.searchParams.delete('share');
            history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
        }
    } catch { /* 无痕模式 */ }

    const state = { available: null, inbox: [], skillRequests: [], mine: [], bySession: new Map(), sessionDetails: new Map(), sessionFetching: new Set(), closedLocally: new Set(), accounts: null, groups: [], recent: { users: [], groups: [] }, host: null, banner: null, bannerQueue: [], dialog: null, syncing: false, timers: {} };

    async function api(method, path, body) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        const res = await fetch(`${API}${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code });
        return data;
    }

    // ── 头像：账号首字 + 由账号算出的色相，深浅主题都清楚 ──
    function hue(name) { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; }
    function avatar(name, label = name, size = '') {
        const text = String(label || name || '?').trim();
        const initial = /^[a-z0-9]/i.test(text) ? text.slice(0, 2).toUpperCase() : Array.from(text)[0] || '?';
        return `<span class="shc-avatar${size ? ` is-${size}` : ''}" style="--shc-h:${hue(name)}" aria-hidden="true">${esc(initial)}</span>`;
    }
    const icon = {
        share: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="12" cy="3.5" r="1.8"/><circle cx="4" cy="8" r="1.8"/><circle cx="12" cy="12.5" r="1.8"/><path d="M5.6 7.1 10.4 4.4M5.6 8.9l4.8 2.7"/></svg>',
        people: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.5" r="2.3"/><path d="M1.8 13.2c.5-2.3 2.2-3.6 4.2-3.6s3.7 1.3 4.2 3.6"/><path d="M10.6 3.4a2.2 2.2 0 0 1 0 4.2M11.6 9.8c1.4.4 2.3 1.6 2.6 3.4"/></svg>',
        link: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.7 9.3a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.3 6.7a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg>',
        check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.4 3 3 6-6.4"/></svg>',
        clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.3"/></svg>',
        plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>',
        close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
        search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.3"/><path d="m10.2 10.2 3.3 3.3"/></svg>'
    };

    // ── 样式 ──
    function ensureStyle() {
        if (document.getElementById('sharedConversationsStyle')) return;
        const style = document.createElement('style');
        style.id = 'sharedConversationsStyle';
        style.textContent = `
.shc-ico svg,.shc-dialog svg,.shc-banner svg,.shc-inbox svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;flex:none}
.shc-avatar{--shc-h:210;display:inline-grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;font:600 11px/1 system-ui,-apple-system,sans-serif;letter-spacing:-.02em;color:hsl(var(--shc-h) 55% 32%);background:hsl(var(--shc-h) 70% 90%);box-shadow:inset 0 0 0 1px hsl(var(--shc-h) 40% 50% / .18)}
.shc-avatar.is-sm{width:20px;height:20px;font-size:9.5px}
.shc-avatar.is-lg{width:34px;height:34px;font-size:13px}
html[data-theme="dark"] .shc-avatar{color:hsl(var(--shc-h) 70% 82%);background:hsl(var(--shc-h) 35% 26%)}
.shc-overlay{position:fixed;inset:0;z-index:2600;display:grid;place-items:center;padding:16px;background:rgba(15,17,21,.28);backdrop-filter:blur(2px);opacity:0;transition:opacity .2s ease}
.shc-overlay.show{opacity:1}
.shc-dialog{width:min(520px,100%);max-height:min(720px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--v2-bg,#fff);color:var(--v2-ink,#1f2328);border:1px solid var(--v2-line,#e7e7ea);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.06);transform:translateY(10px) scale(.97);transition:transform .26s cubic-bezier(.2,.9,.25,1.15);overflow:hidden}
.shc-overlay.show .shc-dialog{transform:none}
.shc-head{display:flex;align-items:flex-start;gap:12px;padding:18px 18px 10px}
.shc-head-ico{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:color-mix(in srgb,var(--v2-accent,#10a37f) 12%,transparent);color:var(--v2-accent,#10a37f);flex:none}
.shc-head h3{margin:0;font-size:15.5px;font-weight:600}
.shc-head p{margin:3px 0 0;font-size:12.5px;color:var(--v2-ink3,#8a9099);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px}
.shc-head>div{flex:1;min-width:0}
.shc-x{border:0;background:transparent;color:var(--v2-ink3,#8a9099);padding:6px;border-radius:8px;cursor:pointer;display:grid;place-items:center}
.shc-x:hover{background:var(--v2-chip,#f2f2f4);color:var(--v2-ink,#1f2328)}
.shc-body{flex:1;min-height:0;overflow:auto;padding:4px 18px 12px}
.shc-picker{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:42px;padding:6px 10px;border:1px solid var(--v2-line-strong,#d6d6db);border-radius:12px;background:var(--v2-bg,#fff);transition:border-color .15s,box-shadow .15s;cursor:text}
.shc-picker:focus-within{border-color:var(--v2-accent,#10a37f);box-shadow:0 0 0 3px color-mix(in srgb,var(--v2-accent,#10a37f) 16%,transparent)}
.shc-picker>.shc-ico{color:var(--v2-ink3,#8a9099);display:flex}
.shc-picker input,.shc-picker input:focus,.shc-picker input:focus-visible{flex:1;min-width:120px;border:0!important;outline:0!important;box-shadow:none!important;background:transparent;color:inherit;font:inherit;font-size:13.5px;padding:4px 2px}
.shc-chip{display:inline-flex;align-items:center;gap:5px;max-width:180px;padding:2px 4px 2px 3px;border-radius:999px;background:var(--v2-chip,#f2f2f4);font-size:12.5px;animation:shcPop .2s cubic-bezier(.2,.9,.3,1.3)}
.shc-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shc-chip button{border:0;background:transparent;color:var(--v2-ink3,#8a9099);cursor:pointer;padding:2px;border-radius:50%;display:grid;place-items:center}
.shc-chip button:hover{background:var(--v2-line,#e7e7ea);color:var(--v2-ink,#1f2328)}
.shc-chip button svg{width:12px;height:12px}
@keyframes shcPop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
.shc-label{display:flex;align-items:center;gap:6px;margin:14px 0 7px;font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--v2-ink3,#8a9099)}
.shc-label .shc-ico{display:flex}
.shc-label svg{width:13px;height:13px}
.shc-label em{font-style:normal;font-weight:500;margin-left:auto}
.shc-suggest{display:flex;flex-wrap:wrap;gap:6px}
.shc-pill{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 10px 4px 4px;border:1px solid var(--v2-line,#e7e7ea);border-radius:999px;background:var(--v2-bg,#fff);color:inherit;font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s,border-color .15s,transform .12s;animation:shcIn .24s ease both;animation-delay:calc(var(--i,0) * 22ms)}
.shc-pill:hover{background:var(--v2-chip,#f2f2f4)}
.shc-pill:active{transform:scale(.96)}
.shc-pill.is-on{border-color:color-mix(in srgb,var(--v2-accent,#10a37f) 55%,transparent);background:color-mix(in srgb,var(--v2-accent,#10a37f) 9%,var(--v2-bg,#fff))}
.shc-pill.is-group{padding-left:9px}
.shc-pill .shc-n{color:var(--v2-ink3,#8a9099);font-size:11.5px}
.shc-pill .shc-del{display:none;margin:-2px -4px -2px 0;padding:2px;border-radius:50%;color:var(--v2-ink3,#8a9099)}
.shc-pill:hover .shc-del{display:grid}
.shc-pill .shc-del:hover{background:var(--v2-line,#e7e7ea);color:var(--v2-danger,#ef4444)}
.shc-pill .shc-del svg{width:11px;height:11px}
.shc-pill.is-new{border-style:dashed;color:var(--v2-ink2,#4b5563);padding-left:8px}
@keyframes shcIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.shc-list{position:relative;max-height:236px;overflow:auto;margin:0 -6px;padding:2px 6px;border-radius:10px;scroll-behavior:smooth}
.shc-row{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;animation:shcIn .2s ease both;animation-delay:calc(var(--i,0) * 14ms)}
.shc-row:hover,.shc-row.is-active{background:var(--v2-hover,var(--v2-chip,#f2f2f4))}
.shc-row-text{flex:1;min-width:0;display:grid}
.shc-row-text b{font-weight:500;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shc-row-text small{font-size:11.5px;color:var(--v2-ink3,#8a9099);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shc-row mark{background:color-mix(in srgb,var(--v2-accent,#10a37f) 22%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.shc-check{display:grid;place-items:center;width:18px;height:18px;border-radius:6px;border:1.5px solid var(--v2-line-strong,#d6d6db);color:#fff;flex:none;transition:background .15s,border-color .15s,transform .15s}
.shc-check svg{width:12px;height:12px;stroke-width:2;opacity:0;transform:scale(.6);transition:opacity .15s,transform .18s cubic-bezier(.2,.9,.3,1.4)}
.shc-row.is-on .shc-check{background:var(--v2-accent,#10a37f);border-color:var(--v2-accent,#10a37f)}
.shc-row.is-on .shc-check svg{opacity:1;transform:none}
.shc-row.is-member{cursor:default;opacity:.62}
.shc-tag{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--v2-chip,#f2f2f4);color:var(--v2-ink2,#4b5563);flex:none}
.shc-tag.is-ok{color:var(--v2-accent,#10a37f);background:color-mix(in srgb,var(--v2-accent,#10a37f) 12%,transparent)}
.shc-empty{padding:18px 8px;text-align:center;font-size:12.5px;color:var(--v2-ink3,#8a9099)}
.shc-more{height:28px;display:grid;place-items:center;font-size:11.5px;color:var(--v2-ink3,#8a9099)}
.shc-newgroup{display:flex;gap:6px;margin-top:8px;animation:shcIn .2s ease}
.shc-newgroup input{flex:1;min-width:0;border:1px solid var(--v2-line-strong,#d6d6db);border-radius:9px;padding:6px 10px;background:var(--v2-bg,#fff);color:inherit;font:inherit;font-size:13px;outline:0}
.shc-newgroup input:focus{border-color:var(--v2-accent,#10a37f)}
.shc-members{display:grid;gap:2px}
.shc-member{display:flex;align-items:center;gap:9px;padding:5px 6px;border-radius:9px;font-size:13px}
.shc-member>span:nth-child(2){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shc-member .shc-x{padding:3px;opacity:0;transition:opacity .15s}
.shc-member:hover .shc-x{opacity:1}
.shc-foot{border-top:1px solid var(--v2-line,#e7e7ea);padding:12px 18px 16px;background:color-mix(in srgb,var(--v2-chip,#f2f2f4) 45%,var(--v2-bg,#fff))}
.shc-link{display:flex;align-items:center;gap:8px;padding:5px 5px 5px 10px;border:1px solid var(--v2-line,#e7e7ea);border-radius:11px;background:var(--v2-bg,#fff)}
.shc-link>.shc-ico{color:var(--v2-ink3,#8a9099);display:flex}
.shc-link input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--v2-ink2,#4b5563);font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis}
.shc-link.is-error{border-color:color-mix(in srgb,var(--v2-danger,#ef4444) 45%,transparent);background:color-mix(in srgb,var(--v2-danger,#ef4444) 5%,var(--v2-bg,#fff))}
.shc-link.is-error>.shc-ico,.shc-link.is-error input{color:var(--v2-danger,#ef4444)}
.shc-hint{margin:7px 2px 0;font-size:11.5px;line-height:1.55;color:var(--v2-ink3,#8a9099)}
.shc-actions{display:flex;align-items:center;gap:8px;margin-top:12px}
.shc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 14px;border:1px solid var(--v2-line-strong,#d6d6db);border-radius:9px;background:var(--v2-bg,#fff);color:var(--v2-ink,#1f2328);font:inherit;font-size:13px;cursor:pointer;transition:background .15s,transform .1s,filter .15s,opacity .15s;white-space:nowrap}
.shc-btn:hover{background:var(--v2-chip,#f2f2f4)}
.shc-btn:active{transform:scale(.97)}
.shc-btn:disabled{opacity:.45;cursor:default;transform:none}
.shc-btn.primary{background:var(--v2-accent,#10a37f);border-color:var(--v2-accent,#10a37f);color:#fff}
.shc-btn.primary:hover{filter:brightness(1.06)}
.shc-btn.ghost{border-color:transparent;background:transparent;color:var(--v2-ink2,#4b5563)}
.shc-btn.ghost:hover{background:var(--v2-chip,#f2f2f4)}
.shc-btn.danger{border-color:transparent;background:transparent;color:var(--v2-danger,#ef4444);padding:0 8px}
.shc-btn.danger:hover{background:color-mix(in srgb,var(--v2-danger,#ef4444) 9%,transparent)}
.shc-btn.sm{min-height:28px;padding:0 10px;font-size:12.5px}
.shc-btn.is-done{color:var(--v2-accent,#10a37f)}
.shc-spacer{flex:1}
.shc-count{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:rgba(255,255,255,.25);font-size:11px;font-weight:600}
@media (max-width:560px){.shc-overlay{align-items:end;padding:0}.shc-dialog{border-radius:16px 16px 0 0;max-height:92vh}.shc-head p{max-width:240px}}
.shc-banner{position:fixed;top:14px;left:50%;z-index:2550;width:min(460px,calc(100vw - 24px));display:flex;gap:12px;align-items:flex-start;padding:14px 14px 12px;border:1px solid var(--v2-line,#e7e7ea);border-radius:14px;background:var(--v2-bg,#fff);color:var(--v2-ink,#1f2328);box-shadow:0 18px 48px rgba(0,0,0,.16);transform:translate(-50%,-140%);transition:transform .38s cubic-bezier(.2,.9,.25,1.1)}
.shc-banner.show{transform:translate(-50%,0)}
.shc-banner-text{flex:1;min-width:0}
.shc-banner-text strong{display:block;font-size:13.5px;font-weight:600;line-height:1.4}
.shc-banner-text p{margin:3px 0 0;font-size:12px;color:var(--v2-ink3,#8a9099);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shc-banner .shc-actions{margin-top:10px}
.shc-banner .shc-queue{margin-left:auto;font-size:11.5px;color:var(--v2-ink3,#8a9099)}
.shc-inbox{width:min(1060px,100% - 80px);margin:8px auto 4px}
.shc-inbox[hidden]{display:none}
.shc-inbox-head{display:flex;align-items:center;gap:8px;margin:10px 0 8px;font-size:12.5px;font-weight:500;color:var(--v2-ink3,#8a9099)}
.shc-inbox-head b{background:var(--v2-accent,#10a37f);color:#fff;border-radius:999px;padding:0 7px;font-size:11px;line-height:18px}
.shc-card{display:flex;gap:12px;align-items:center;border:1px solid color-mix(in srgb,var(--v2-accent,#10a37f) 28%,var(--v2-line,#e7e7ea));background:color-mix(in srgb,var(--v2-accent,#10a37f) 4%,var(--v2-bg,#fff));border-radius:12px;padding:12px;margin-bottom:10px;animation:shcIn .22s ease both;transition:opacity .25s,transform .25s}
.shc-card.is-leaving{opacity:0;transform:translateX(16px)}
.shc-card .shc-banner-text strong{font-weight:500}
.shc-card .shc-actions{margin:0;flex:none}
@media (max-width:700px){.shc-inbox{width:calc(100% - 32px)}.shc-card{flex-wrap:wrap}.shc-card .shc-actions{width:100%;justify-content:flex-end}}
.dc-msg-author{display:flex;align-items:center;gap:6px;margin:0 0 5px;font-size:11.5px;color:var(--v2-ink3,#8a9099);animation:shcIn .2s ease}
.dc-msg--user .dc-msg-author{justify-content:flex-end}
.dc-msg-author b{font-weight:600;color:var(--v2-ink2,#4b5563)}
.dc-msg-author .shc-avatar{width:18px;height:18px;font-size:9px}
.shc-thread-bar{position:relative;display:flex;align-items:center;gap:8px;width:fit-content;max-width:calc(100% - 24px);margin:0 auto 6px;padding:5px 6px 5px 10px;border:1px solid var(--v2-line,#e7e7ea);border-radius:999px;background:color-mix(in srgb,var(--v2-bg,#fff) 88%,transparent);backdrop-filter:blur(8px);font-size:12px;color:var(--v2-ink2,#4b5563);animation:shcIn .25s ease}
.shc-thread-bar .shc-stack{display:flex}
.shc-thread-bar .shc-stack .shc-avatar{width:20px;height:20px;font-size:9px;margin-left:-5px;box-shadow:0 0 0 2px var(--v2-bg,#fff)}
.shc-thread-bar .shc-stack .shc-avatar:first-child{margin-left:0}
.shc-thread-bar .shc-live{width:7px;height:7px;border-radius:50%;background:var(--v2-accent,#10a37f);box-shadow:0 0 0 0 color-mix(in srgb,var(--v2-accent,#10a37f) 50%,transparent);animation:shcLive 2.2s ease-in-out infinite}
@keyframes shcLive{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--v2-accent,#10a37f) 45%,transparent)}50%{box-shadow:0 0 0 5px transparent}}
.shc-thread-bar button{border:0;background:transparent;color:inherit;font:inherit;font-size:12px;padding:3px 8px;border-radius:999px;cursor:pointer}
.shc-thread-bar button:hover{background:var(--v2-chip,#f2f2f4)}
.home-chat-shared-ico{display:inline-grid;place-items:center;width:16px;height:16px;flex:none;margin-right:6px;color:var(--v2-accent,#10a37f)}
.home-chat-shared-ico svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.home-chat-item.has-shared-unread .home-chat-title{font-weight:600}
.home-chat-item.has-shared-unread .home-chat-meta::before{content:'';display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;background:var(--v2-accent,#10a37f);vertical-align:middle}
.shc-card.is-skill{border-color:color-mix(in srgb,#f59e0b 36%,var(--v2-line,#e7e7ea));background:color-mix(in srgb,#f59e0b 6%,var(--v2-bg,#fff))}
.shc-cap-bar{flex:none;display:grid;grid-template-rows:0fr;width:min(860px,calc(100% - 24px));max-width:240px;margin:0 auto;border:1px solid color-mix(in srgb,var(--v2-accent,#10a37f) 28%,var(--v2-line,#e7e7ea));border-radius:999px;background:color-mix(in srgb,var(--v2-card,var(--v2-bg,#fff)) 94%,var(--v2-accent,#10a37f) 6%);box-shadow:0 8px 24px rgba(0,0,0,.12);font-size:12px;color:var(--v2-ink2,#4b5563);opacity:0;overflow:hidden;transform-origin:center top;transition:grid-template-rows .34s cubic-bezier(.22,1,.36,1),max-width .36s cubic-bezier(.22,1,.36,1),border-radius .34s cubic-bezier(.22,1,.36,1),opacity .24s ease,margin-top .3s ease}
.shc-cap-bar.is-open{grid-template-rows:1fr;max-width:min(860px,calc(100% - 24px));margin-top:8px;border-radius:14px;opacity:1}
.shc-cap-bar.is-closing{grid-template-rows:0fr;max-width:220px;margin-top:0;border-radius:999px;opacity:0;pointer-events:none}
.shc-cap-inner{min-height:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 12px}
body:not(.dc-chatting) .shc-cap-bar{display:none}
.shc-cap-title{font-weight:600;color:var(--v2-ink,#1f2328);display:inline-flex;align-items:center;gap:5px}
.shc-cap-item{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;border:1px solid var(--v2-line,#e7e7ea);background:var(--v2-bg,#fff)}
.shc-cap-item code{font-size:11.5px;font-weight:600;color:var(--v2-ink,#1f2328)}
.shc-cap-note{font-size:11.5px;color:var(--v2-ink3,#8a9099)}
.shc-cap-close{margin-left:auto;width:24px;height:24px;border:0;border-radius:999px;background:transparent;color:var(--v2-ink3,#8a9099);font-size:15px;line-height:1;cursor:pointer;display:grid;place-items:center;flex:none;transition:background .15s,color .15s}
.shc-cap-close:hover{background:var(--v2-chip,#f2f2f4);color:var(--v2-ink,#1f2328)}
@media (prefers-reduced-motion: reduce){.shc-overlay,.shc-dialog,.shc-banner,.shc-card,.shc-row,.shc-pill,.shc-chip,.dc-msg-author,.shc-thread-bar,.shc-cap-bar{animation:none!important;transition:none!important}}
`;
        document.head.appendChild(style);
    }

    // ── 数据：可用性、邀请、Skill 审批、我的共享对话 ──
    function emit() {
        window.dispatchEvent(new CustomEvent('tools:shared-inbox', { detail: { total: count() } }));
    }
    function count() { return state.available ? (state.inbox.length + state.skillRequests.length) : 0; }

    async function refreshInbox() {
        try {
            const data = await api('GET', '/inbox');
            state.available = true;
            state.inbox = data.items || [];
            state.skillRequests = data.skillRequests || [];
        } catch (error) {
            if ([401, 403, 404].includes(error.status)) { state.available = false; state.inbox = []; state.skillRequests = []; }
        }
        emit();
        renderInbox();
        queueBanners();
    }

    async function refreshMine() {
        if (state.available === false) return;
        try {
            const data = await api('GET', '/mine');
            const before = JSON.stringify(state.mine.map(item => [item.sessionId, item.unread, item.members.length, item.title, item.status]));
            state.mine = (data.items || []).filter(item => item && item.status === 'active' && !state.closedLocally.has(item.sessionId));
            state.bySession = new Map(state.mine.map(item => [item.sessionId, item]));
            for (const sid of [...state.sessionDetails.keys()]) {
                if (!state.bySession.has(sid)) state.sessionDetails.delete(sid);
            }
            if (JSON.stringify(state.mine.map(item => [item.sessionId, item.unread, item.members.length, item.title, item.status])) !== before) {
                window.dispatchEvent(new CustomEvent('home:conversation-list-changed', { detail: { source: 'mine' } }));
            }
            renderThreadBar();
        } catch { /* 保留旧列表 */ }
    }

    // ── 横幅：登录后收到的新邀请与私有 Skill 审批请求 ──
    function seenBanners() { try { return new Set(JSON.parse(sessionStorage.getItem(BANNER_KEY) || '[]')); } catch { return new Set(); } }
    function markBanner(id) { const seen = seenBanners(); seen.add(id); try { sessionStorage.setItem(BANNER_KEY, JSON.stringify([...seen].slice(-100))); } catch { /* ignore */ } }
    function queueBanners(force = []) {
        const seen = seenBanners();
        for (const item of state.inbox) {
            const key = item.shareId;
            if ((seen.has(key) && !force.includes(key)) || state.bannerQueue.some(row => row.key === key) || state.banner?.key === key) continue;
            state.bannerQueue.push({ kind: 'invite', key, item });
        }
        for (const req of state.skillRequests) {
            const key = `skill:${req.id}`;
            if ((seen.has(key) && !force.includes(key)) || state.bannerQueue.some(row => row.key === key) || state.banner?.key === key) continue;
            state.bannerQueue.push({ kind: 'skill', key, item: req });
        }
        if (!state.banner) showNextBanner();
    }
    function inviteLine(item) {
        return item.via === 'link'
            ? L(`通过链接打开了 ${item.ownerName} 共享的对话`, `You opened a conversation shared by ${item.ownerName}`)
            : L(`${item.invitedByName || item.ownerName} 邀请你加入共享对话`, `${item.invitedByName || item.ownerName} invited you to a shared conversation`);
    }
    function inviteMeta(item) {
        return [L(`${item.messageCount} 条消息`, `${item.messageCount} messages`), L(`${item.memberCount} 人已加入`, `${item.memberCount} joined`)].join(' · ');
    }
    function skillRequestLine(item) {
        return L(`${item.requestedByName || item.requestedBy} 申请在共享对话中使用你的私有技能`, `${item.requestedByName || item.requestedBy} requested access to your skill in shared chat`);
    }
    function skillRequestMeta(item) {
        return L(`@${item.skillId}（${item.skillName || item.skillId}） · 同意后仅共享给本对话成员`, `@${item.skillId} (${item.skillName || item.skillId}) · shared with chat members only`);
    }
    function showNextBanner() {
        const entry = state.bannerQueue.shift();
        if (!entry) return;
        const exists = entry.kind === 'skill'
            ? state.skillRequests.some(row => row.id === entry.item.id)
            : state.inbox.some(row => row.shareId === entry.item.shareId);
        if (!exists) { if (state.bannerQueue.length) showNextBanner(); return; }
        ensureStyle();
        markBanner(entry.key);
        const node = document.createElement('div');
        node.className = 'shc-banner';
        node.setAttribute('role', 'alertdialog');
        const item = entry.item;
        if (entry.kind === 'skill') {
            node.setAttribute('aria-label', L('私有技能授权申请', 'Skill access approval'));
            node.innerHTML = `${avatar(item.requestedBy, item.requestedByName, 'lg')}
                <div class="shc-banner-text"><strong>${esc(skillRequestLine(item))}</strong><p>「${esc(item.title || '')}」 · ${esc(skillRequestMeta(item))}</p>
                <div class="shc-actions"><button type="button" class="shc-btn primary sm" data-shc-skill-respond="approve">${esc(L('同意并共享', 'Approve & share'))}</button><button type="button" class="shc-btn sm" data-shc-skill-respond="reject">${esc(L('拒绝', 'Reject'))}</button><button type="button" class="shc-btn ghost sm" data-shc-later>${esc(L('稍后', 'Later'))}</button>${state.bannerQueue.length ? `<span class="shc-queue">${esc(L(`还有 ${state.bannerQueue.length} 个`, `${state.bannerQueue.length} more`))}</span>` : ''}</div></div>`;
        } else {
            node.setAttribute('aria-label', L('共享对话邀请', 'Shared conversation invite'));
            node.innerHTML = `${avatar(item.invitedBy || item.owner, item.invitedByName || item.ownerName, 'lg')}
                <div class="shc-banner-text"><strong>${esc(inviteLine(item))}</strong><p>「${esc(item.title)}」 · ${esc(inviteMeta(item))}</p>
                <div class="shc-actions"><button type="button" class="shc-btn primary sm" data-shc-respond="accept">${esc(L('接受并打开', 'Accept & open'))}</button><button type="button" class="shc-btn sm" data-shc-respond="decline">${esc(L('拒绝', 'Decline'))}</button><button type="button" class="shc-btn ghost sm" data-shc-later>${esc(L('稍后', 'Later'))}</button>${state.bannerQueue.length ? `<span class="shc-queue">${esc(L(`还有 ${state.bannerQueue.length} 个`, `${state.bannerQueue.length} more`))}</span>` : ''}</div></div>`;
        }
        document.body.appendChild(node);
        state.banner = { node, item, key: entry.key, kind: entry.kind };
        requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('show')));
        node.addEventListener('click', async event => {
            if (event.target.closest('[data-shc-later]')) { hideBanner(); toast(L('可以随时在左下角消息中心里处理', 'You can respond later from the message center')); return; }
            const skillBtn = event.target.closest('[data-shc-skill-respond]');
            if (skillBtn) {
                node.querySelectorAll('button').forEach(button => { button.disabled = true; });
                const ok = await respondSkill(item, skillBtn.dataset.shcSkillRespond);
                if (ok) hideBanner(); else node.querySelectorAll('button').forEach(button => { button.disabled = false; });
                return;
            }
            const respondBtn = event.target.closest('[data-shc-respond]');
            if (!respondBtn) return;
            node.querySelectorAll('button').forEach(button => { button.disabled = true; });
            const ok = await respond(item, respondBtn.dataset.shcRespond);
            if (ok) hideBanner(); else node.querySelectorAll('button').forEach(button => { button.disabled = false; });
        });
        clearTimeout(state.timers.banner);
        state.timers.banner = setTimeout(() => { if (state.banner?.node === node && !node.matches(':hover,:focus-within')) hideBanner(); }, 20000);
    }
    function hideBanner() {
        const current = state.banner;
        if (!current) return;
        state.banner = null;
        current.node.classList.remove('show');
        setTimeout(() => { current.node.remove(); showNextBanner(); }, reduced() ? 0 : 380);
    }

    async function respond(item, action) {
        try {
            const result = await api('POST', `/invites/${encodeURIComponent(item.shareId)}/respond`, { action });
            state.inbox = state.inbox.filter(row => row.shareId !== item.shareId);
            emit();
            renderInbox();
            if (action === 'accept' && result.sessionId) {
                state.closedLocally.delete(result.sessionId);
                await refreshMine();
                toast(L(`已加入共享对话「${item.title}」`, `Joined “${item.title}”`));
                window.dispatchEvent(new CustomEvent('tools:close-messages'));
                openSession(result.sessionId);
            } else if (action === 'decline') toast(L('已拒绝邀请', 'Invite declined'));
            else toast(L('已忽略，之后仍可通过共享链接加入', 'Ignored. You can still join from the link.'));
            return true;
        } catch (error) {
            toast(error.message);
            if (error.status === 404 || error.status === 409) { state.inbox = state.inbox.filter(row => row.shareId !== item.shareId); emit(); renderInbox(); return true; }
            return false;
        }
    }

    async function respondSkill(item, action) {
        try {
            const result = await api('POST', `/skill-requests/${encodeURIComponent(item.id)}/respond`, { action });
            state.skillRequests = state.skillRequests.filter(row => row.id !== item.id);
            state.sessionDetails.delete(item.sessionId);
            emit();
            renderInbox();
            if (currentSession()) await loadSessionDetails(currentSession(), true);
            window.DragonClawSkills?.refresh?.();
            if (action === 'approve') {
                toast(L(`已同意并在共享对话内授权 @${item.skillId}（覆盖 ${result.grantedCount || 1} 位成员）`, `Approved @${item.skillId} for shared chat members`));
            } else {
                toast(L(`已拒绝 @${item.skillId} 的共享授权申请`, `Declined @${item.skillId} access request`));
            }
            return true;
        } catch (error) {
            toast(error.message);
            if ([403, 404, 409].includes(error.status)) {
                state.skillRequests = state.skillRequests.filter(row => row.id !== item.id);
                emit();
                renderInbox();
                return true;
            }
            return false;
        }
    }

    function openSession(sessionId) {
        const go = () => window.DragonClaw?.openChat?.({ id: sessionId });
        if (window.DragonClaw?.openChat) go();
        else window.addEventListener('load', go, { once: true });
    }

    // ── 消息中心：顶部列出待处理的共享邀请与私有 Skill 授权审批 ──
    function renderInto(host) {
        if (!host) return;
        ensureStyle();
        if (state.host !== host) {
            state.host = host;
            host.addEventListener('click', async event => {
                const skillBtn = event.target.closest('[data-shc-skill-respond]');
                if (skillBtn) {
                    const card = skillBtn.closest('[data-request-id]');
                    const item = state.skillRequests.find(row => row.id === card?.dataset.requestId);
                    if (!item) return;
                    card.querySelectorAll('button').forEach(node => { node.disabled = true; });
                    card.classList.add('is-leaving');
                    if (!await respondSkill(item, skillBtn.dataset.shcSkillRespond)) {
                        card.classList.remove('is-leaving');
                        card.querySelectorAll('button').forEach(node => { node.disabled = false; });
                    }
                    return;
                }
                const button = event.target.closest('[data-shc-respond]');
                if (!button) return;
                const card = button.closest('[data-share-id]');
                const item = state.inbox.find(row => row.shareId === card?.dataset.shareId);
                if (!item) return;
                card.querySelectorAll('button').forEach(node => { node.disabled = true; });
                card.classList.add('is-leaving');
                if (!await respond(item, button.dataset.shcRespond)) { card.classList.remove('is-leaving'); card.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
            });
        }
        renderInbox();
    }
    function renderInbox() {
        const host = state.host;
        if (!host?.isConnected) return;
        host.classList.add('shc-inbox');
        const hasAny = state.inbox.length > 0 || state.skillRequests.length > 0;
        host.hidden = !hasAny;
        if (!hasAny) { host.innerHTML = ''; return; }
        const inviteHtml = state.inbox.length ? `<div class="shc-inbox-head"><span class="shc-ico">${icon.people}</span>${esc(L('共享对话邀请', 'Shared conversation invites'))}<b>${state.inbox.length}</b></div>` + state.inbox.map((item, index) => `
            <div class="shc-card" data-share-id="${esc(item.shareId)}" style="animation-delay:${index * 30}ms">${avatar(item.invitedBy || item.owner, item.invitedByName || item.ownerName, 'lg')}
                <div class="shc-banner-text"><strong>「${esc(item.title)}」</strong><p>${esc(inviteLine(item))} · ${esc(inviteMeta(item))}</p></div>
                <div class="shc-actions"><button type="button" class="shc-btn primary sm" data-shc-respond="accept">${esc(L('接受', 'Accept'))}</button><button type="button" class="shc-btn sm" data-shc-respond="decline">${esc(L('拒绝', 'Decline'))}</button><button type="button" class="shc-btn ghost sm" data-shc-respond="ignore">${esc(L('忽略', 'Ignore'))}</button></div>
            </div>`).join('') : '';
        const skillHtml = state.skillRequests.length ? `<div class="shc-inbox-head"><span class="shc-ico">${icon.share}</span>${esc(L('私有技能授权审批', 'Private skill access requests'))}<b>${state.skillRequests.length}</b></div>` + state.skillRequests.map((item, index) => `
            <div class="shc-card is-skill" data-request-id="${esc(item.id)}" style="animation-delay:${index * 30}ms">${avatar(item.requestedBy, item.requestedByName, 'lg')}
                <div class="shc-banner-text"><strong>「${esc(item.title || '')}」 · @${esc(item.skillId)}（${esc(item.skillName || item.skillId)}）</strong><p>${esc(skillRequestLine(item))} · ${esc(L('同意后仅向本共享对话成员开放', 'Shared only with members of this conversation'))}</p></div>
                <div class="shc-actions"><button type="button" class="shc-btn primary sm" data-shc-skill-respond="approve">${esc(L('同意并共享', 'Approve'))}</button><button type="button" class="shc-btn sm" data-shc-skill-respond="reject">${esc(L('拒绝', 'Reject'))}</button></div>
            </div>`).join('') : '';
        host.innerHTML = inviteHtml + skillHtml;
    }

    // ── 共享链接加入 ──
    async function consumePendingLink() {
        let token = '';
        try { token = localStorage.getItem(PENDING_KEY) || ''; } catch { token = ''; }
        if (!token || !me() || state.available === false) return;
        try {
            const result = await api('POST', `/link/${encodeURIComponent(token)}`);
            try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
            if (result.status === 'accepted' && result.sessionId) { await refreshMine(); openSession(result.sessionId); return; }
            await refreshInbox();
            queueBanners([result.shareId]);
        } catch (error) {
            if (error.status === 401) return; // 还没登录：留着，登录后再加入
            try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
            window.AppDialog?.alert ? window.AppDialog.alert(error.message, { title: L('无法打开共享对话', 'Cannot open shared conversation'), tone: 'error' }) : toast(error.message);
        }
    }

    // ── 侧栏：共享对话分类 ──
    function isShared(sessionId) { return state.bySession.has(sessionId); }
    function info(sessionId) { return state.bySession.get(sessionId) || null; }
    function listItems() { return state.mine.slice(); }
    function rowIcon() { return `<span class="home-chat-shared-ico" title="${esc(L('共享对话', 'Shared conversation'))}">${icon.people}</span>`; }

    // ── 打开中的共享对话：顶部成员条 + 缺失能力与待审批栏 + 定时同步 ──
    function currentSession() { return window.DragonClaw?.isExternal?.() ? '' : (window.DragonClaw?.currentSessionId?.() || ''); }
    async function loadSessionDetails(sessionId, force = false) {
        if (!sessionId || !isShared(sessionId)) return null;
        if (!force && state.sessionDetails.has(sessionId)) return state.sessionDetails.get(sessionId);
        if (state.sessionFetching.has(sessionId)) return state.sessionDetails.get(sessionId) || null;
        state.sessionFetching.add(sessionId);
        try {
            const prevMissing = (state.sessionDetails.get(sessionId)?.missingCapabilities?.skills || []).length;
            const res = await api('GET', `/session/${encodeURIComponent(sessionId)}`);
            if (res?.share) {
                state.sessionDetails.set(sessionId, res.share);
                const nextMissing = (res.share.missingCapabilities?.skills || []).length;
                if (prevMissing > nextMissing) window.DragonClawSkills?.refresh?.();
                renderThreadBar();
                return res.share;
            }
        } catch { /* ignore */ } finally { state.sessionFetching.delete(sessionId); }
        return null;
    }
    async function sendSkillRequest(sessionId, skillId) {
        const sid = sessionId || currentSession();
        if (!sid || !skillId) return null;
        const res = await api('POST', `/session/${encodeURIComponent(sid)}/skill-requests`, {
            skillId,
            linkBase: location.origin + appBase()
        });
        if (res?.share) state.sessionDetails.set(sid, res.share);
        if (res?.alreadyAvailable) {
            toast(L('该技能现已可用', 'Skill is already available'));
            window.DragonClawSkills?.refresh?.();
        } else if (res?.deduplicated) {
            toast(L('已存在待审批申请，请等待归属人确认', 'Approval request is already pending'));
        } else {
            toast(L('已向技能归属人发送授权申请', 'Sent skill authorization request to owner'));
        }
        renderThreadBar();
        return res;
    }

    async function promptSkillRequest(skillId, overrideMeta = null) {
        const sid = currentSession();
        if (!sid || !isShared(sid) || !skillId) return false;
        const cleanId = String(skillId).replace(/^@/, '').trim().toLowerCase();
        const detail = state.sessionDetails.get(sid) || await loadSessionDetails(sid);
        const found = (detail?.missingCapabilities?.skills || []).find(item => item.id === cleanId);
        const skill = found ? { ...overrideMeta, ...found } : overrideMeta;
        if (!skill) return false;
        const label = skill.name && skill.name !== skill.id ? `@${skill.id}（${skill.name}）` : `@${skill.id}`;
        const ownerLabel = skill.ownerName || skill.owner || L('平台管理员', 'Owner');
        if (skill.status === 'pending') {
            toast(L(`已向 ${ownerLabel} 提交了 ${label} 的使用申请，请等待审批`, `Pending approval for ${label} from ${ownerLabel}`));
            return false;
        }
        if (!skill.canRequest) {
            toast(L(`${label} 在当前共享对话中暂不可用（${skill.reason || '权限受限'}）`, `${label} is unavailable here`));
            return false;
        }
        const ok = window.AppDialog?.confirm
            ? await window.AppDialog.confirm(
                L(`当前共享对话需要使用私有技能 ${label}。是否向技能归属人「${ownerLabel}」发起授权申请？`, `This shared conversation uses private skill ${label}. Send an access request to ${ownerLabel}?`),
                { title: L('申请使用私有技能', 'Request private skill access'), confirmText: L('发送申请', 'Request access'), cancelText: L('暂不申请', 'Not now') }
            )
            : window.confirm(L(`是否向「${ownerLabel}」申请使用 ${label}？`, `Request access to ${label} from ${ownerLabel}?`));
        if (!ok) return false;
        try {
            await sendSkillRequest(sid, skill.id);
        } catch (error) {
            toast(error.message);
        }
        return false;
    }

    async function checkSkillBeforeSend(sessionId, text, { keptSkills = [] } = {}) {
        if (!sessionId || !isShared(sessionId)) return true;
        const detail = state.sessionDetails.get(sessionId) || await loadSessionDetails(sessionId);
        const missing = detail?.missingCapabilities?.skills || [];
        if (!missing.length) return true;
        const mentioned = new Set((Array.isArray(keptSkills) ? keptSkills : []).map(id => String(id || '').replace(/^@/, '').trim().toLowerCase()).filter(Boolean));
        for (const m of String(text || '').matchAll(/(?:^|[\s(（[【"'`])@([a-z][a-z0-9_-]{0,63})\b/gi)) {
            mentioned.add(String(m[1]).toLowerCase());
        }
        const hit = missing.find(item => mentioned.has(String(item.id || '').toLowerCase()));
        if (!hit) return true;
        return promptSkillRequest(hit.id, hit);
    }

    const dismissedCapSigs = new Set();
    function closeCapBar(capBar, sig) {
        if (!capBar || capBar.classList.contains('is-closing')) return;
        if (sig) dismissedCapSigs.add(sig);
        capBar.classList.remove('is-open');
        capBar.classList.add('is-closing');
        setTimeout(() => { if (capBar.classList.contains('is-closing')) capBar.remove(); }, reduced() ? 0 : 360);
    }

    function renderCapabilitiesBar(thread, sessionId, detail, bar) {
        const host = thread.parentElement || thread;
        let capBar = host.querySelector(':scope > .shc-cap-bar') || thread.querySelector(':scope > .shc-cap-bar');
        const pendingForMe = detail?.pendingSkillRequests || [];
        // 历史缺失能力仅在用户主动触发或调用对应技能时弹窗申请，平时不常驻顶栏打扰；仅归属人有待审批申请时显示审批卡
        if (!pendingForMe.length) { capBar?.remove(); return; }
        const capSig = JSON.stringify([sessionId, pendingForMe, en()]);
        if (dismissedCapSigs.has(capSig)) { capBar?.remove(); return; }
        ensureStyle();
        const created = !capBar;
        if (!capBar) {
            capBar = document.createElement('div');
            capBar.className = 'shc-cap-bar';
            capBar.addEventListener('click', async event => {
                if (event.target.closest('[data-shc-cap-close]')) {
                    closeCapBar(capBar, capBar.dataset.sig);
                    return;
                }
                const respBtn = event.target.closest('[data-shc-skill-respond]');
                if (respBtn) {
                    const card = respBtn.closest('[data-request-id]');
                    const cur = state.sessionDetails.get(currentSession());
                    const item = (cur?.pendingSkillRequests || []).find(row => row.id === card?.dataset.requestId)
                        || state.skillRequests.find(row => row.id === card?.dataset.requestId);
                    if (!item) return;
                    respBtn.disabled = true;
                    await respondSkill(item, respBtn.dataset.shcSkillRespond);
                }
            });
        }
        if (host === thread) { if (bar.nextElementSibling !== capBar) bar.after(capBar); }
        else if (capBar.parentElement !== host || capBar.nextElementSibling !== thread) { thread.before(capBar); }
        if (capBar.dataset.sig === capSig) return;
        capBar.dataset.sig = capSig;
        const ownerCards = pendingForMe.map(req => `
            <div class="shc-cap-item" data-request-id="${esc(req.id)}">
                <span>${esc(L(`${req.requestedByName || req.requestedBy} 申请使用`, `${req.requestedByName || req.requestedBy} requests`))} <code>@${esc(req.skillId)}</code></span>
                <button type="button" class="shc-btn primary sm" data-shc-skill-respond="approve">${esc(L('同意并共享', 'Approve'))}</button>
                <button type="button" class="shc-btn ghost sm" data-shc-skill-respond="reject">${esc(L('拒绝', 'Reject'))}</button>
            </div>`).join('');
        capBar.innerHTML = `<div class="shc-cap-inner"><span class="shc-cap-title">${esc(L('待我审批的技能共享', 'Pending skill approvals'))}</span>${ownerCards}<button type="button" class="shc-cap-close" data-shc-cap-close title="${esc(L('收起提示', 'Dismiss'))}" aria-label="${esc(L('收起提示', 'Dismiss'))}">×</button></div>`;
        if (created) {
            capBar.classList.remove('is-closing');
            requestAnimationFrame(() => requestAnimationFrame(() => capBar.classList.add('is-open')));
        } else {
            capBar.classList.remove('is-closing');
            capBar.classList.add('is-open');
        }
    }
    function renderThreadBar() {
        const thread = document.getElementById('dcThread');
        if (!thread) return;
        const sessionId = currentSession();
        const share = info(sessionId);
        const detail = state.sessionDetails.get(sessionId);
        const sharedWs = (share?.status === 'active') ? (share.sharedWorkspace || detail?.sharedWorkspace || null) : null;
        window.DragonClawWorkspace?.setSharedWorkspace?.(sharedWs);
        let bar = thread.querySelector(':scope > .shc-thread-bar');
        thread.classList.toggle('is-shared-thread', Boolean(share));
        if (!share) { bar?.remove(); thread.querySelector(':scope > .shc-cap-bar')?.remove(); thread.parentElement?.querySelector(':scope > .shc-cap-bar')?.remove(); return; }
        ensureStyle();
        if (!bar) { bar = document.createElement('div'); bar.className = 'shc-thread-bar'; thread.prepend(bar); bar.addEventListener('click', event => { if (event.target.closest('[data-shc-manage]')) openDialog({ sessionId: currentSession(), title: info(currentSession())?.title }); }); }
        else if (bar !== thread.firstElementChild) thread.prepend(bar);
        const joined = share.members.filter(member => member.status === 'accepted');
        const signature = JSON.stringify([share.id, joined.map(member => member.username), share.status, en()]);
        if (bar.dataset.sig !== signature) {
            bar.dataset.sig = signature;
            bar.innerHTML = `<span class="shc-live" aria-hidden="true"></span><span class="shc-stack">${joined.slice(0, 5).map(member => avatar(member.username, member.name, 'sm')).join('')}</span><span>${esc(share.status === 'active' ? L(`共享中 · ${joined.length} 人`, `Shared · ${joined.length}`) : L('已停止共享', 'Sharing stopped'))}</span>${share.status === 'active' ? `<button type="button" data-shc-manage>${esc(L('成员与邀请', 'Members'))}</button>` : ''}`;
        }
        if (!detail) loadSessionDetails(sessionId);
        renderCapabilitiesBar(thread, sessionId, detail, bar);
    }

    function decorateMessage(message, events) {
        const author = (Array.isArray(events) ? events : []).find(event => event?.type === 'shared_author');
        if (!author || !message || message.querySelector('.dc-msg-author')) return;
        ensureStyle();
        const isAi = message.classList.contains('dc-msg--ai');
        const label = isAi ? L(`${author.name || author.author} 的 AI 回答`, `Answered for ${author.name || author.author}`) : (author.name || author.author);
        const node = document.createElement('div');
        node.className = 'dc-msg-author';
        node.innerHTML = `${avatar(author.author, author.name)}<span><b>${esc(label)}</b>${!isAi && author.name && author.name !== author.author ? ` · ${esc(author.author)}` : ''}</span>`;
        message.querySelector('.dc-msg-main')?.prepend(node);
    }
    // 共享对话里自己发的消息也标出账号，大家看到的是同一套署名
    function decorateOwn(thread) {
        if (!thread.classList.contains('is-shared-thread')) return;
        const mine = me();
        for (const message of thread.querySelectorAll('.dc-msg--user:not([data-shc-own])')) {
            message.dataset.shcOwn = '';
            if (message.querySelector('.dc-msg-author')) continue;
            const node = document.createElement('div');
            node.className = 'dc-msg-author';
            node.innerHTML = `<span><b>${esc(L('我', 'Me'))}</b> · ${esc(mine)}</span>${avatar(mine)}`;
            message.querySelector('.dc-msg-main')?.prepend(node);
        }
    }

    function handleSyncClose(sessionId, result) {
        const firstTime = !state.closedLocally.has(sessionId);
        state.closedLocally.add(sessionId);
        state.sessionDetails.delete(sessionId);
        state.mine = state.mine.filter(item => item.sessionId !== sessionId);
        state.bySession.delete(sessionId);
        window.dispatchEvent(new CustomEvent('home:conversation-list-changed', { detail: { source: 'mine' } }));
        if (result?.revoked) {
            window.dispatchEvent(new CustomEvent('home:session-revoked', { detail: { sessionId } }));
        }
        renderThreadBar();
        refreshMine();
        if (firstTime) {
            toast(result?.revoked
                ? L('发起者已停止共享，该对话已收回', 'Sharing was stopped by the owner and this conversation has been removed')
                : L('发起者已停止共享，当前对话已转为各自独立对话', 'Sharing was stopped by the owner'));
        }
    }

    let lastSession = '';
    async function syncActive(force = false) {
        const sessionId = currentSession();
        if (sessionId !== lastSession) { lastSession = sessionId; renderThreadBar(); }
        if (!sessionId || !isShared(sessionId) || state.syncing || (document.hidden && !force)) return;
        state.syncing = true;
        try {
            const data = await api('POST', `/session/${encodeURIComponent(sessionId)}/sync`);
            if (data.result?.pulled || state.pendingAppend === sessionId) {
                state.pendingAppend = sessionId;
                if (await window.DragonClaw?.appendSharedMessages?.(sessionId)) state.pendingAppend = '';
            }
            if (data.result?.closed) {
                handleSyncClose(sessionId, data.result);
                return;
            }
            if (data.result?.pulled) {
                refreshMine();
                loadSessionDetails(sessionId, true);
            } else if (!state.sessionDetails.has(sessionId)) {
                loadSessionDetails(sessionId);
            }
        } catch { /* 下次再试 */ } finally { state.syncing = false; }
    }

    // ── 共享面板 ──
    function loadPinyin() {
        if (window.ToolsPinyinSearch) return Promise.resolve();
        return new Promise(resolve => {
            const script = document.createElement('script');
            script.src = '/js/shared/pinyin-search.js';
            script.onload = resolve; script.onerror = resolve;
            document.head.appendChild(script);
        });
    }
    function matches(account, query) {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return account.username.toLowerCase().includes(q) || account.name.toLowerCase().includes(q)
            || Boolean(window.ToolsPinyinSearch?.isPinyinQuery?.(q) && window.ToolsPinyinSearch.pinyinMatches(account.name, q));
    }
    function highlight(text, query) {
        const q = query.trim();
        const index = q ? String(text).toLowerCase().indexOf(q.toLowerCase()) : -1;
        if (index < 0) return esc(text);
        return `${esc(text.slice(0, index))}<mark>${esc(text.slice(index, index + q.length))}</mark>${esc(text.slice(index + q.length))}`;
    }

    // 对话标题里可能带附件链接 [名称](<路径>)：只保留名称
    const cleanTitle = value => String(value || '').replace(/\[([^\]]*)\]\(<[^>]*>\)/g, '$1').replace(/\s*\[[^\]]*$/, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    async function openDialog({ sessionId, title = '' } = {}) {
        if (!sessionId) return;
        title = cleanTitle(title);
        if (state.available === false) return toast(L('当前服务还不支持共享对话，请升级或重启服务后再试', 'Sharing is not available on this server yet'));
        ensureStyle();
        closeDialog(true);
        const d = { sessionId, title, selected: new Map(), query: '', limit: 40, active: -1, share: null, busy: false, creatingGroup: false };
        state.dialog = d;
        const overlay = document.createElement('div');
        overlay.className = 'shc-overlay';
        overlay.innerHTML = `<div class="shc-dialog" role="dialog" aria-modal="true" aria-labelledby="shcTitle">
            <div class="shc-head"><span class="shc-head-ico">${icon.share}</span><div><h3 id="shcTitle">${esc(L('共享对话', 'Share conversation'))}</h3><p>${esc(title || L('当前对话', 'This conversation'))}</p></div><button type="button" class="shc-x" data-shc-close aria-label="${esc(L('关闭', 'Close'))}">${icon.close}</button></div>
            <div class="shc-body">
                <label class="shc-picker"><span class="shc-ico">${icon.search}</span><span class="shc-chips" style="display:contents"></span><input type="text" autocomplete="off" spellcheck="false" placeholder="${esc(L('输入账号名或姓名搜索（支持拼音）', 'Search accounts by name or pinyin'))}" aria-label="${esc(L('搜索账号', 'Search accounts'))}" role="combobox" aria-expanded="true" aria-controls="shcList"></label>
                <div class="shc-suggest-wrap"></div>
                <div class="shc-label"><span class="shc-ico">${icon.people}</span><span class="shc-list-title">${esc(L('全部账号', 'All accounts'))}</span><em class="shc-list-count"></em></div>
                <div class="shc-list" id="shcList" role="listbox" aria-multiselectable="true"><div class="shc-empty">${esc(L('正在加载账号…', 'Loading accounts…'))}</div></div>
                <div class="shc-members-wrap"></div>
            </div>
            <div class="shc-foot">
                <div class="shc-link"><span class="shc-ico">${icon.link}</span><input type="text" readonly value="${esc(L('正在生成共享链接…', 'Generating link…'))}" aria-label="${esc(L('共享链接', 'Share link'))}"><button type="button" class="shc-btn sm" data-shc-copy disabled>${esc(L('复制链接', 'Copy link'))}</button></div>
                <p class="shc-hint">${esc(L('对方点开链接、登录平台后即可接受共享。对话上下文、历史附件、工具生成的 HTML/文件及图片都会同步为对方可读的副本；之后的提问与生成各自在自己账号下执行，并实时互相可见。', 'Anyone with an account can open the link and accept after signing in. Conversation history, attachments, generated HTML/files and images sync as readable copies; new questions and edits run under each person’s own account and sync live.'))}</p>
                <div class="shc-actions"><span class="shc-leave"></span><span class="shc-spacer"></span><button type="button" class="shc-btn ghost" data-shc-close>${esc(L('取消', 'Cancel'))}</button><button type="button" class="shc-btn primary" data-shc-send disabled>${esc(L('发送邀请', 'Send invites'))}</button></div>
            </div></div>`;
        document.body.appendChild(overlay);
        d.overlay = overlay;
        d.input = overlay.querySelector('.shc-picker input');
        d.list = overlay.querySelector('.shc-list');
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));
        setTimeout(() => d.input.focus({ preventScroll: true }), 60);
        bindDialog(d);
        const [accounts, groups, recent, prepared] = await Promise.allSettled([
            state.accounts ? Promise.resolve({ items: state.accounts }) : api('GET', '/accounts'),
            api('GET', '/groups'), api('GET', '/recent'),
            api('POST', `/session/${encodeURIComponent(sessionId)}/prepare`, { title }),
            loadPinyin()
        ]);
        if (state.dialog !== d) return;
        if (accounts.status === 'fulfilled') state.accounts = accounts.value.items || [];
        if (groups.status === 'fulfilled') state.groups = groups.value.items || [];
        if (recent.status === 'fulfilled') state.recent = recent.value;
        if (prepared.status === 'fulfilled') {
            d.share = prepared.value.share;
            d.prepareError = '';
        } else {
            d.prepareError = prepared.reason?.message || L('无法生成共享链接', 'Could not create a link');
            const linkBox = overlay.querySelector('.shc-link');
            const link = linkBox?.querySelector('input');
            linkBox?.classList.add('is-error');
            if (link) link.value = d.prepareError;
        }
        if (accounts.status === 'rejected') d.list.innerHTML = `<div class="shc-empty">${esc(accounts.reason?.message || L('账号列表加载失败', 'Could not load accounts'))}</div>`;
        renderDialog(d);
    }

    function memberStatus(username, d) { return d.share?.members?.find(member => member.username === username && ['accepted', 'pending'].includes(member.status))?.status || ''; }

    function renderDialog(d) {
        renderChips(d);
        renderSuggest(d);
        renderList(d);
        renderMembers(d);
        const linkBox = d.overlay.querySelector('.shc-link');
        const link = linkBox.querySelector('input');
        const copy = d.overlay.querySelector('[data-shc-copy]');
        if (d.share?.link) { linkBox.classList.remove('is-error'); link.value = new URL(appBase() + d.share.link, location.origin).href; copy.disabled = false; }
        else if (d.prepareError) { linkBox.classList.add('is-error'); }
        const leave = d.overlay.querySelector('.shc-leave');
        const joined = d.share?.members?.filter(member => member.username !== me() && ['accepted', 'pending'].includes(member.status)).length;
        leave.innerHTML = d.share && (joined || !d.share.isOwner) ? `<button type="button" class="shc-btn danger sm" data-shc-leave>${esc(d.share.isOwner ? L('停止共享', 'Stop sharing') : L('退出共享', 'Leave'))}</button>` : '';
        updateSend(d);
    }
    function updateSend(d) {
        const button = d.overlay.querySelector('[data-shc-send]');
        const n = d.selected.size;
        button.disabled = !n || d.busy || !d.share;
        button.title = !d.share && d.prepareError ? d.prepareError : '';
        button.innerHTML = `${esc(d.busy ? L('正在发送…', 'Sending…') : L('发送邀请', 'Send invites'))}${n && !d.busy ? ` <span class="shc-count">${n}</span>` : ''}`;
    }
    function renderChips(d) {
        const host = d.overlay.querySelector('.shc-chips');
        const existing = new Set([...host.querySelectorAll('[data-chip]')].map(node => node.dataset.chip));
        host.innerHTML = [...d.selected.values()].map(account => `<span class="shc-chip" data-chip="${esc(account.username)}"${existing.has(account.username) ? ' style="animation:none"' : ''}>${avatar(account.username, account.name, 'sm')}<span>${esc(account.name)}</span><button type="button" data-shc-unpick="${esc(account.username)}" aria-label="${esc(L(`移除 ${account.name}`, `Remove ${account.name}`))}">${icon.close}</button></span>`).join('');
    }
    function accountOf(username) {
        return state.accounts?.find(account => account.username === username) || null;
    }
    function renderSuggest(d) {
        const host = d.overlay.querySelector('.shc-suggest-wrap');
        if (d.query.trim()) { host.innerHTML = ''; return; }
        const users = (state.recent.users || []).filter(user => accountOf(user.username) && !memberStatus(user.username, d));
        const recentGroups = state.recent.groups || [];
        const otherGroups = state.groups.filter(group => !recentGroups.some(row => row.id === group.id));
        let i = 0;
        const groupPill = group => `<button type="button" class="shc-pill is-group${group.members.every(name => d.selected.has(name) || memberStatus(name, d)) ? ' is-on' : ''}" data-shc-group="${esc(group.id)}" style="--i:${i++}" title="${esc(group.members.map(name => accountOf(name)?.name || name).join('、'))}"><span class="shc-ico">${icon.people}</span><span>${esc(group.name)}</span><span class="shc-n">${group.members.length}</span><span class="shc-del" data-shc-delgroup="${esc(group.id)}" role="button" aria-label="${esc(L('删除群组', 'Delete group'))}">${icon.close}</span></button>`;
        const parts = [];
        if (users.length || recentGroups.length) {
            parts.push(`<div class="shc-label"><span class="shc-ico">${icon.clock}</span>${esc(L('最近共享过', 'Recently shared with'))}</div><div class="shc-suggest">${recentGroups.map(groupPill).join('')}${users.map(user => { const account = accountOf(user.username); return `<button type="button" class="shc-pill${d.selected.has(user.username) ? ' is-on' : ''}" data-shc-pick="${esc(user.username)}" style="--i:${i++}">${avatar(user.username, account.name, 'sm')}<span>${esc(account.name)}</span></button>`; }).join('')}</div>`);
        }
        parts.push(`<div class="shc-label"><span class="shc-ico">${icon.people}</span>${esc(L('常用群组', 'Saved groups'))}</div><div class="shc-suggest">${otherGroups.map(groupPill).join('')}<button type="button" class="shc-pill is-new" data-shc-newgroup style="--i:${i++}"><span class="shc-ico">${icon.plus}</span><span>${esc(d.selected.size ? L(`把已选的 ${d.selected.size} 人存为群组`, `Save ${d.selected.size} selected as group`) : L('新建群组（先勾选成员）', 'New group (select people first)'))}</span></button></div>`);
        if (d.creatingGroup) parts.push(`<div class="shc-newgroup"><input type="text" maxlength="40" placeholder="${esc(L('群组名称，如「北美研发」', 'Group name'))}" data-shc-groupname><button type="button" class="shc-btn primary sm" data-shc-savegroup>${esc(L('保存', 'Save'))}</button><button type="button" class="shc-btn ghost sm" data-shc-cancelgroup>${esc(L('取消', 'Cancel'))}</button></div>`);
        host.innerHTML = parts.join('');
        if (d.creatingGroup) setTimeout(() => host.querySelector('[data-shc-groupname]')?.focus(), 30);
    }
    function filtered(d) {
        const list = (state.accounts || []).filter(account => matches(account, d.query));
        // 搜索时：精确 / 前缀命中排前面；不搜索时：最近用过的排前面
        const q = d.query.trim().toLowerCase();
        const recentRank = new Map((state.recent.users || []).map((user, index) => [user.username, index]));
        return list.sort((a, b) => {
            if (q) {
                const rank = account => (account.username.toLowerCase() === q || account.name.toLowerCase() === q ? 0 : account.username.toLowerCase().startsWith(q) || account.name.toLowerCase().startsWith(q) ? 1 : 2);
                return rank(a) - rank(b) || a.username.localeCompare(b.username, undefined, { numeric: true });
            }
            return (recentRank.has(a.username) ? recentRank.get(a.username) : 999) - (recentRank.has(b.username) ? recentRank.get(b.username) : 999) || a.username.localeCompare(b.username, undefined, { numeric: true });
        });
    }
    function renderList(d, keepScroll = false) {
        if (!state.accounts) return;
        const rows = filtered(d);
        d.rows = rows;
        const top = d.list.scrollTop;
        d.overlay.querySelector('.shc-list-title').textContent = d.query.trim() ? L('搜索结果', 'Results') : L('全部账号', 'All accounts');
        d.overlay.querySelector('.shc-list-count').textContent = rows.length ? L(`${rows.length} 个`, `${rows.length}`) : '';
        if (!rows.length) { d.list.innerHTML = `<div class="shc-empty">${esc(d.query ? L('没有匹配的账号', 'No matching accounts') : L('平台上还没有其他账号', 'No other accounts yet'))}</div>`; return; }
        const shown = rows.slice(0, d.limit);
        d.list.innerHTML = shown.map((account, index) => {
            const status = memberStatus(account.username, d);
            const on = d.selected.has(account.username);
            return `<button type="button" class="shc-row${on ? ' is-on' : ''}${status ? ' is-member' : ''}${index === d.active ? ' is-active' : ''}" role="option" aria-selected="${on}" data-shc-row="${esc(account.username)}" style="--i:${keepScroll ? 0 : Math.min(index, 12)}"${status ? ' aria-disabled="true"' : ''}>
                ${avatar(account.username, account.name)}<span class="shc-row-text"><b>${highlight(account.name, d.query)}</b><small>${highlight(account.username, d.query)}</small></span>
                ${status ? `<span class="shc-tag${status === 'accepted' ? ' is-ok' : ''}">${esc(status === 'accepted' ? L('已加入', 'Joined') : L('待接受', 'Pending'))}</span>` : `<span class="shc-check">${icon.check}</span>`}</button>`;
        }).join('') + (rows.length > shown.length ? `<div class="shc-more" data-shc-more>${esc(L('继续下滑加载更多…', 'Scroll for more…'))}</div>` : '');
        if (keepScroll) d.list.scrollTop = top;
    }
    function renderMembers(d) {
        const host = d.overlay.querySelector('.shc-members-wrap');
        const members = (d.share?.members || []).filter(member => ['accepted', 'pending'].includes(member.status));
        if (members.length < 2 && !members.some(member => member.username !== me())) { host.innerHTML = ''; return; }
        host.innerHTML = `<div class="shc-label"><span class="shc-ico">${icon.share}</span>${esc(L('共享成员', 'Members'))}<em>${members.length}</em></div><div class="shc-members">${members.map(member => `<div class="shc-member">${avatar(member.username, member.name, 'sm')}<span>${esc(member.name)}${member.username === me() ? ` <span class="shc-n">(${esc(L('我', 'me'))})</span>` : ''}</span><span class="shc-tag${member.status === 'accepted' ? ' is-ok' : ''}">${esc(member.role === 'owner' ? L('发起者', 'Owner') : member.status === 'accepted' ? L('已加入', 'Joined') : L('待接受', 'Pending'))}</span>${d.share.isOwner && member.username !== me() ? `<button type="button" class="shc-x" data-shc-remove="${esc(member.username)}" aria-label="${esc(L('移除', 'Remove'))}">${icon.close}</button>` : ''}</div>`).join('')}</div>`;
    }

    function toggle(d, username, force) {
        const account = accountOf(username);
        if (!account || memberStatus(username, d)) return;
        const on = force ?? !d.selected.has(username);
        if (on) d.selected.set(username, account); else d.selected.delete(username);
    }

    function bindDialog(d) {
        const { overlay } = d;
        overlay.addEventListener('mousedown', event => { if (event.target === overlay) d.backdrop = true; });
        overlay.addEventListener('click', async event => {
            if (event.target === overlay && d.backdrop) return closeDialog();
            d.backdrop = false;
            const target = event.target;
            if (target.closest('[data-shc-close]')) return closeDialog();
            const delGroup = target.closest('[data-shc-delgroup]');
            if (delGroup) {
                event.stopPropagation();
                const group = state.groups.find(row => row.id === delGroup.dataset.shcDelgroup);
                const ok = window.AppDialog?.confirm ? await window.AppDialog.confirm(L(`删除常用群组「${group?.name || ''}」？不影响已发出的邀请。`, `Delete group “${group?.name || ''}”?`), { title: L('删除群组', 'Delete group'), confirmText: L('删除', 'Delete'), tone: 'danger' }) : true;
                if (!ok) return;
                await api('DELETE', `/groups/${encodeURIComponent(delGroup.dataset.shcDelgroup)}`).catch(error => toast(error.message));
                state.groups = state.groups.filter(row => row.id !== delGroup.dataset.shcDelgroup);
                state.recent.groups = (state.recent.groups || []).filter(row => row.id !== delGroup.dataset.shcDelgroup);
                return renderSuggest(d);
            }
            const row = target.closest('[data-shc-row]');
            if (row) { toggle(d, row.dataset.shcRow); renderChips(d); renderSuggest(d); renderList(d, true); updateSend(d); d.input.focus({ preventScroll: true }); return; }
            const pick = target.closest('[data-shc-pick]');
            if (pick) { toggle(d, pick.dataset.shcPick); renderChips(d); renderSuggest(d); renderList(d, true); updateSend(d); return; }
            const unpick = target.closest('[data-shc-unpick]');
            if (unpick) { event.preventDefault(); toggle(d, unpick.dataset.shcUnpick, false); renderChips(d); renderSuggest(d); renderList(d, true); updateSend(d); d.input.focus(); return; }
            const group = target.closest('[data-shc-group]');
            if (group) {
                const item = state.groups.find(row => row.id === group.dataset.shcGroup) || (state.recent.groups || []).find(row => row.id === group.dataset.shcGroup);
                if (!item) return;
                const all = item.members.filter(name => accountOf(name) && !memberStatus(name, d));
                const on = !all.every(name => d.selected.has(name));
                all.forEach(name => toggle(d, name, on));
                d.groupIds = new Set([...(d.groupIds || [])]);
                if (on) d.groupIds.add(item.id); else d.groupIds.delete(item.id);
                renderChips(d); renderSuggest(d); renderList(d, true); updateSend(d);
                return;
            }
            if (target.closest('[data-shc-newgroup]')) {
                if (!d.selected.size) { toast(L('先在下面勾选要加入群组的人', 'Select people first')); d.input.focus(); return; }
                d.creatingGroup = true; return renderSuggest(d);
            }
            if (target.closest('[data-shc-cancelgroup]')) { d.creatingGroup = false; return renderSuggest(d); }
            if (target.closest('[data-shc-savegroup]')) return saveGroup(d);
            if (target.closest('[data-shc-copy]')) return copyLink(d, target.closest('[data-shc-copy]'));
            if (target.closest('[data-shc-send]')) return send(d);
            const remove = target.closest('[data-shc-remove]');
            if (remove) {
                try {
                    const result = await api('POST', `/session/${encodeURIComponent(d.sessionId)}/remove`, { username: remove.dataset.shcRemove });
                    d.share = result.share; renderDialog(d); refreshMine();
                } catch (error) { toast(error.message); }
                return;
            }
            if (target.closest('[data-shc-leave]')) return leave(d);
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); if (d.creatingGroup) { d.creatingGroup = false; renderSuggest(d); } else closeDialog(); return; }
            if (event.target.matches('[data-shc-groupname]') && event.key === 'Enter') { event.preventDefault(); saveGroup(d); return; }
            if (event.target !== d.input) return;
            const rows = d.rows || [];
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const max = Math.min(rows.length, d.limit) - 1;
                if (max < 0) return;
                d.active = event.key === 'ArrowDown' ? Math.min(max, d.active + 1) : Math.max(0, d.active - 1);
                if (d.active >= d.limit - 3 && rows.length > d.limit) d.limit += 40;
                renderList(d, true);
                d.list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
            } else if (event.key === 'Enter') {
                event.preventDefault();
                const row = rows[d.active >= 0 ? d.active : 0];
                if (row && (d.active >= 0 || d.query.trim())) { toggle(d, row.username); d.query = ''; d.input.value = ''; d.active = -1; renderChips(d); renderSuggest(d); renderList(d); updateSend(d); }
                else if (d.selected.size) send(d);
            } else if (event.key === 'Backspace' && !d.input.value && d.selected.size) {
                const last = [...d.selected.keys()].at(-1);
                d.selected.delete(last); renderChips(d); renderSuggest(d); renderList(d, true); updateSend(d);
            }
        });
        d.input.addEventListener('input', () => { d.query = d.input.value; d.limit = 40; d.active = d.query.trim() ? 0 : -1; d.list.scrollTop = 0; renderSuggest(d); renderList(d); });
        // 渐进加载：列表滚到底部附近再渲染下一批
        d.list.addEventListener('scroll', () => {
            if (d.list.scrollTop + d.list.clientHeight < d.list.scrollHeight - 60 || !d.rows || d.rows.length <= d.limit) return;
            d.limit += 40; renderList(d, true);
        }, { passive: true });
    }

    async function saveGroup(d) {
        const input = d.overlay.querySelector('[data-shc-groupname]');
        const name = input?.value.trim();
        if (!name) { input?.focus(); return; }
        try {
            const { item } = await api('POST', '/groups', { name, members: [...d.selected.keys()] });
            state.groups = [item, ...state.groups];
            d.groupIds = new Set([...(d.groupIds || []), item.id]);
            d.creatingGroup = false;
            renderSuggest(d);
            toast(L(`已保存常用群组「${item.name}」`, `Saved group “${item.name}”`));
        } catch (error) { toast(error.message); }
    }

    async function copyLink(d, button) {
        const value = d.overlay.querySelector('.shc-link input').value;
        try { await navigator.clipboard.writeText(value); }
        catch { const input = d.overlay.querySelector('.shc-link input'); input.select(); document.execCommand?.('copy'); }
        button.classList.add('is-done');
        button.innerHTML = `${icon.check}${esc(L('已复制', 'Copied'))}`;
        clearTimeout(d.copyTimer);
        d.copyTimer = setTimeout(() => { if (button.isConnected) { button.classList.remove('is-done'); button.textContent = L('复制链接', 'Copy link'); } }, 1800);
    }

    async function send(d) {
        if (!d.selected.size || d.busy) return;
        d.busy = true; updateSend(d);
        try {
            const result = await api('POST', `/session/${encodeURIComponent(d.sessionId)}/invite`, { title: d.title, usernames: [...d.selected.keys()], groupIds: [...(d.groupIds || [])], linkBase: location.origin + appBase() });
            state.closedLocally.delete(d.sessionId);
            const names = result.invited.map(name => accountOf(name)?.name || name);
            toast(names.length ? L(`已邀请 ${names.slice(0, 3).join('、')}${names.length > 3 ? ` 等 ${names.length} 人` : ''}，对方登录后会收到通知`, `Invited ${names.length} people`) : L('所选成员都已在共享中', 'Everyone selected is already in this conversation'));
            d.share = result.share;
            d.selected.clear();
            d.groupIds = new Set();
            api('GET', '/recent').then(recent => { state.recent = recent; if (state.dialog === d) renderSuggest(d); }).catch(() => {});
            await refreshMine();
            d.busy = false;
            renderDialog(d);
            setTimeout(() => { if (state.dialog === d && !d.selected.size) closeDialog(); }, 650);
        } catch (error) {
            d.busy = false; updateSend(d);
            window.AppDialog?.alert ? window.AppDialog.alert(error.message, { title: L('邀请失败', 'Could not invite'), tone: 'error' }) : toast(error.message);
        }
    }

    async function leave(d) {
        const owner = d.share?.isOwner;
        const message = owner
            ? L('停止共享后，其他成员列表中的该共享对话将被收回并移除，仅保留你自己的原对话。确定停止？', 'Stopping sharing will revoke and remove this conversation from other members’ lists, keeping only your original conversation. Stop sharing?')
            : L('退出后你保留本地的对话副本，但不再收到其他成员的新消息。确定退出？', 'You keep your copy, but will stop receiving new messages. Leave?');
        const ok = window.AppDialog?.confirm ? await window.AppDialog.confirm(message, { title: owner ? L('停止共享', 'Stop sharing') : L('退出共享', 'Leave'), confirmText: owner ? L('停止共享', 'Stop') : L('退出', 'Leave'), tone: 'danger' }) : true;
        if (!ok) return;
        try {
            await api('POST', `/session/${encodeURIComponent(d.sessionId)}/leave`);
            state.closedLocally.add(d.sessionId);
            state.sessionDetails.delete(d.sessionId);
            state.mine = state.mine.filter(item => item.sessionId !== d.sessionId);
            state.bySession.delete(d.sessionId);
            window.dispatchEvent(new CustomEvent('home:conversation-list-changed', { detail: { source: 'mine' } }));
            await refreshMine();
            renderThreadBar();
            closeDialog();
            toast(owner ? L('已停止共享', 'Sharing stopped') : L('已退出共享对话', 'Left the shared conversation'));
        } catch (error) { toast(error.message); }
    }

    function closeDialog(immediate = false) {
        const d = state.dialog;
        if (!d) return;
        state.dialog = null;
        d.overlay.classList.remove('show');
        setTimeout(() => d.overlay.remove(), immediate || reduced() ? 0 : 200);
    }

    // ── 启动 ──
    function init() {
        ensureStyle();
        refreshInbox().then(() => { if (state.available) { refreshMine(); consumePendingLink(); } });
        const loop = () => {
            clearTimeout(state.timers.loop);
            state.timers.loop = setTimeout(async () => { await syncActive(); loop(); }, isShared(currentSession()) ? 4000 : 8000);
        };
        loop();
        clearInterval(state.timers.slow);
        state.timers.slow = setInterval(() => { if (!document.hidden) { refreshInbox(); refreshMine(); } }, 30000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshInbox(); refreshMine(); syncActive(true); } });
        const resetForAuth = () => {
            const hadMine = state.mine.length > 0;
            state.accounts = null; state.mine = []; state.bySession.clear(); state.sessionDetails.clear(); state.sessionFetching.clear(); state.closedLocally.clear(); state.inbox = []; state.skillRequests = []; state.bannerQueue = []; state.available = null;
            window.DragonClawWorkspace?.setSharedWorkspace?.(null);
            if (hadMine) window.dispatchEvent(new CustomEvent('home:conversation-list-changed', { detail: { source: 'mine' } }));
            refreshInbox().then(() => { if (state.available) { refreshMine(); consumePendingLink(); } });
        };
        window.addEventListener('tools:authchange', resetForAuth);
        window.addEventListener('storage', event => { if (!event.key || ['tools_user', 'tools_tenant_id', 'tools_token'].includes(event.key)) resetForAuth(); });
        window.addEventListener('tools:languagechange', () => { renderInbox(); const thread = document.getElementById('dcThread'); const bar = thread?.querySelector('.shc-thread-bar'); if (bar) bar.dataset.sig = ''; renderThreadBar(); });
        const thread = document.getElementById('dcThread');
        if (thread) new MutationObserver(() => { if (currentSession() !== lastSession) { lastSession = currentSession(); renderThreadBar(); } else if (info(currentSession()) && !thread.querySelector(':scope > .shc-thread-bar')) renderThreadBar(); decorateOwn(thread); }).observe(thread, { childList: true });
    }

    function onSessionDeleted(sessionId) {
        if (!sessionId) return;
        state.sessionDetails.delete(sessionId);
        state.mine = state.mine.filter(item => item.sessionId !== sessionId);
        state.bySession.delete(sessionId);
        renderThreadBar();
        window.dispatchEvent(new CustomEvent('home:conversation-list-changed', { detail: { source: 'mine' } }));
    }

    window.HomeSharedConversations = {
        openDialog, renderInto, count, isShared, info, items: listItems, rowIcon, decorateMessage, refresh: () => Promise.all([refreshInbox(), refreshMine()]),
        promptSkillRequest, checkSkillBeforeSend, onSessionDeleted,
        // 侧栏右键「共享」只给 Dragon Claw 自己的对话：第三方 Agent、频道对话不共享
        available: () => state.available !== false,
        beforeOpen: async sessionId => {
            if (!isShared(sessionId)) return;
            try {
                const res = await api('POST', `/session/${encodeURIComponent(sessionId)}/sync`);
                if (res?.result?.closed) {
                    handleSyncClose(sessionId, res.result);
                    if (res.result.revoked) throw Object.assign(new Error('SHARE_REVOKED'), { revoked: true });
                    return;
                }
                await refreshMine();
            } catch (error) {
                if (error?.revoked) throw error;
            }
        },
        sync: syncActive
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
