// 隔离世界中接收真实 Ctrl/Command+滚轮与视觉视口缩放；不向网页暴露任何 Electron API。
const { ipcRenderer } = require('electron');
(function () {
    let wheelAccum = 0, wheelResetTimer = null;
    window.addEventListener('wheel', event => {
        if (!event.isTrusted || !(event.ctrlKey || event.metaKey) || !event.deltaY) return;
        event.preventDefault();
        if (Math.abs(event.deltaY) >= 20) {
            wheelAccum = 0;
            clearTimeout(wheelResetTimer);
            ipcRenderer.send('dragon-browser:zoom-wheel', event.deltaY < 0 ? 'in' : 'out');
            return;
        }
        wheelAccum += event.deltaY;
        clearTimeout(wheelResetTimer);
        wheelResetTimer = setTimeout(() => { wheelAccum = 0; }, 220);
        if (Math.abs(wheelAccum) >= 20) {
            const direction = wheelAccum < 0 ? 'in' : 'out';
            wheelAccum = 0;
            ipcRenderer.send('dragon-browser:zoom-wheel', direction);
        }
    }, { capture: true, passive: false });

    let zoomState = { percent: 100, factor: 1, visualScale: 1, lang: 'zh-CN', theme: 'light' };
    let host = null, root = null, pill = null, pctNode = null, resetBtn = null;
    let hideTimer = null, resizeTimer = null, seenNonDefault = false;

    const english = () => zoomState.lang === 'en-US';
    function sendVisualScale() {
        const scale = window.visualViewport?.scale;
        if (!Number.isFinite(scale) || scale <= 0) return;
        ipcRenderer.send('dragon-browser:visual-zoom', scale);
        positionHud();
    }
    function ensureHud() {
        if (!document.documentElement) return false;
        if (!host) {
            host = document.createElement('div');
            host.setAttribute('data-dragon-zoom-hud', '1');
            host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
            root = host.attachShadow({ mode: 'closed' });
            root.innerHTML = `<style>:host{all:initial}.hud{position:fixed;top:12px;right:12px;display:inline-flex;align-items:center;gap:4px;padding:4px 6px;border:1px solid rgba(15,23,42,.14);border-radius:999px;background:rgba(255,255,255,.92);color:#0f172a;font:600 12px/1 system-ui,-apple-system,sans-serif;box-shadow:0 6px 20px rgba(15,23,42,.14);backdrop-filter:blur(14px);pointer-events:auto;user-select:none;transition:opacity 160ms ease,transform 140ms ease;opacity:.92}.hud:hover{opacity:1}.hud[hidden]{display:none}.hud[data-theme="dark"]{background:rgba(15,23,42,.92);border-color:rgba(148,163,184,.28);color:#f1f5f9;box-shadow:0 6px 22px rgba(0,0,0,.42)}button{appearance:none;border:0;background:transparent;color:inherit;font:inherit;line-height:1;min-width:22px;height:22px;padding:0 6px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}button:hover{background:rgba(100,116,139,.16)}.hud[data-theme="dark"] button:hover{background:rgba(148,163,184,.2)}.pct{padding:0 4px;font-variant-numeric:tabular-nums;font-weight:700}.reset{font-size:11px;padding:0 8px;background:rgba(15,23,42,.06)}.hud[data-theme="dark"] .reset{background:rgba(255,255,255,.1)}.reset[hidden]{display:none}@media(prefers-color-scheme:dark){.hud:not([data-theme="light"]){background:rgba(15,23,42,.92);border-color:rgba(148,163,184,.28);color:#f1f5f9}}</style><div class="hud" role="status" aria-live="polite" hidden><button type="button" data-zoom="out">−</button><span class="pct">100%</span><button type="button" data-zoom="in">+</button><button type="button" class="reset" data-zoom="reset"></button></div>`;
            pill = root.querySelector('.hud');
            pctNode = root.querySelector('.pct');
            resetBtn = root.querySelector('.reset');
            pill.addEventListener('click', event => {
                const btn = event.target.closest('button[data-zoom]');
                if (!btn) return;
                event.preventDefault();
                event.stopPropagation();
                ipcRenderer.send('dragon-browser:zoom-command', btn.dataset.zoom);
            });
            document.documentElement.append(host);
        } else if (!host.isConnected) {
            document.documentElement.append(host);
        }
        return true;
    }
    function positionHud() {
        if (!pill) return;
        const factor = Number(zoomState.factor) > 0 ? Number(zoomState.factor) : 1;
        const vv = window.visualViewport;
        const vScale = vv && Number.isFinite(vv.scale) && vv.scale > 0 ? vv.scale : (Number(zoomState.visualScale) || 1);
        const total = Math.max(.2, factor * vScale);
        if (vv && vScale > 1.005) {
            pill.style.top = `${Math.max(0, vv.offsetTop + 12 / total)}px`;
            pill.style.right = `${Math.max(0, (document.documentElement?.clientWidth || window.innerWidth) - (vv.offsetLeft + vv.width) + 12 / total)}px`;
        } else {
            pill.style.top = `${12 / factor}px`;
            pill.style.right = `${12 / factor}px`;
        }
        pill.style.transformOrigin = 'top right';
        pill.style.transform = `scale(${1 / total})`;
    }
    function renderHud(announce) {
        const percent = Math.max(10, Math.round(Number(zoomState.percent) || 100));
        if (percent !== 100) seenNonDefault = true;
        if (percent === 100 && !announce && !seenNonDefault) return;
        if (!ensureHud()) return;
        clearTimeout(hideTimer);
        pill.dataset.theme = zoomState.theme === 'dark' ? 'dark' : 'light';
        pctNode.textContent = `${percent}%`;
        pill.querySelector('[data-zoom="out"]').setAttribute('aria-label', english() ? 'Zoom out' : '缩小');
        pill.querySelector('[data-zoom="in"]').setAttribute('aria-label', english() ? 'Zoom in' : '放大');
        resetBtn.textContent = english() ? 'Reset' : '重置';
        resetBtn.hidden = percent === 100;
        host.dataset.dragonZoomPercent = String(percent);
        positionHud();
        if (percent !== 100) {
            pill.hidden = false;
            host.dataset.dragonZoomVisible = 'true';
        } else {
            pill.hidden = false;
            host.dataset.dragonZoomVisible = 'true';
            hideTimer = setTimeout(() => {
                if (pill && Math.round(Number(zoomState.percent) || 100) === 100) {
                    pill.hidden = true;
                    host.dataset.dragonZoomVisible = 'false';
                    seenNonDefault = false;
                }
            }, 1400);
        }
    }

    ipcRenderer.on('dragon-browser:zoom-state', (_event, value) => {
        if (!value || typeof value !== 'object') return;
        const changed = value.percent !== zoomState.percent;
        zoomState = { ...zoomState, ...value };
        renderHud(Boolean(value.announce || changed));
    });
    window.visualViewport?.addEventListener('resize', sendVisualScale);
    window.visualViewport?.addEventListener('scroll', positionHud);
    window.addEventListener('resize', () => {
        positionHud();
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => ipcRenderer.send('dragon-browser:zoom-query'), 60);
    });
    document.addEventListener('DOMContentLoaded', () => {
        ipcRenderer.send('dragon-browser:zoom-query');
        if ((zoomState.percent || 100) !== 100) renderHud(false);
    }, { once: true });
})();

// Password handling stays in the isolated preload world. The webpage receives
// neither IPC access nor a credential API; filling behaves like a password manager.
(function () {
    const documentId = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
    let requested = false, filled = false, managed = false, scanTimer, submitTimer, observer;
    const visible = input => input && !input.disabled && !input.readOnly && input.getClientRects().length > 0;
    function fields() {
        const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
        if (passwords.length !== 1 || passwords[0].autocomplete === 'new-password') return null;
        const password = passwords[0], scope = password.form || document;
        const candidates = [...scope.querySelectorAll('input')].filter(input => visible(input) && ['text', 'email', 'tel', ''].includes(input.type) && !/captcha|verify|verification|otp|验证码|校验/i.test(input.name + ' ' + input.id + ' ' + input.placeholder));
        const username = candidates.find(input => input.autocomplete === 'username') || candidates.filter(input => input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
        return username ? { username, password, scope } : null;
    }
    function send(action, credentials) { ipcRenderer.send('dragon-browser:login', { action, document: documentId, ...(credentials ? { credentials } : {}) }); }
    function scan() {
        if (!requested && fields()) { requested = true; observer?.disconnect(); send('probe'); }
    }
    function setValue(input, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function loginButton(scope) {
        return [...scope.querySelectorAll('button,input[type="submit"],[role="button"]')].find(button => visible(button) && (/^(?:登\s*[录入]|登录系统|立即登录|sign\s*in|log\s*in|login)$/i.test((button.innerText || button.value || button.textContent || '').trim()) || (button.type === 'submit' && button.tagName === 'INPUT')));
    }
    function needsVerification(scope) {
        return [...scope.querySelectorAll('input,iframe')].some(input => {
            if (!visible(input)) return false;
            if (input.tagName === 'IFRAME') return /captcha|recaptcha|hcaptcha/i.test(input.src);
            return /captcha|otp|verification|verify.?code|sms|验证码|动态码|短信/i.test(input.name + ' ' + input.id + ' ' + input.placeholder) || (input.required && ((input.type === 'checkbox' && !input.checked) || (!['submit', 'button', 'checkbox', 'radio', 'hidden'].includes(input.type) && !input.value)));
        }) || !!scope.querySelector('[class*="captcha"],[id*="captcha"]');
    }
    ipcRenderer.on('dragon-browser:login-state', (_event, state) => {
        if (state.document !== documentId || state.origin !== location.origin || filled) return;
        managed = state.enabled === true;
        if (!managed || !state.credentials) return;
        const form = fields();
        if (!form || (form.username.value && form.username.value !== state.credentials.username) || form.password.value) return;
        filled = true;
        setValue(form.username, state.credentials.username);
        setValue(form.password, state.credentials.password);
        // Recheck after framework validation. Submit at most once; never check
        // consent boxes or solve secondary verification on the user's behalf.
        submitTimer = setTimeout(() => {
            if (!state.autoSubmit || !form.password.isConnected || needsVerification(form.scope)) return;
            const button = loginButton(form.scope);
            if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
            if (form.username.value !== state.credentials.username || form.password.value !== state.credentials.password) return;
            button.click();
        }, 700);
    });
    function remember(event) {
        if (!managed || !event.isTrusted) return;
        const form = fields(); if (!form?.username.value || !form.password.value) return;
        if (event.type === 'click') {
            const target = event.target.closest('button,input[type="submit"],[role="button"]');
            if (!target || target !== loginButton(form.scope)) return;
        }
        if (event.type === 'keydown' && event.key !== 'Enter') return;
        send('save', { username: form.username.value, password: form.password.value });
    }
    document.addEventListener('submit', remember, true);
    document.addEventListener('click', remember, true);
    document.addEventListener('keydown', remember, true);
    window.addEventListener('DOMContentLoaded', () => {
        observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 200); });
        observer.observe(document.documentElement, { subtree: true, childList: true });
        scan();
    }, { once: true });
    window.addEventListener('pagehide', () => { clearTimeout(scanTimer); clearTimeout(submitTimer); }, { once: true });
})();

// 原生网页保持真实输入；AI 操作期间由主进程的独立透明 BrowserView 拦截人工输入。
(function(){
    let state=null,host=null,root=null,lastSent=0;
    const language=()=>state?.lang==='en-US';
    function render(){
        if(!document.documentElement)return;
        const handoff=state?.manual&&state?.handoff&&state?.expiresAt;
        if(!host&&!handoff)return;
        if(!host){host=document.createElement('div');host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';root=host.attachShadow({mode:'closed'});root.innerHTML='<style>:host{all:initial}.note{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 32px);padding:11px 17px;border:1px solid transparent;border-radius:18px;background:linear-gradient(#fffffff2,#fffffff2) padding-box,linear-gradient(110deg,#7c3aed,#38bdf8,#2dd4bf,#f472b6) border-box;box-shadow:0 4px 24px #7c3aed26;color:#172033;font:12px system-ui;backdrop-filter:blur(16px)}@media(prefers-color-scheme:dark){.note{background:linear-gradient(#182033f0,#182033f0) padding-box,linear-gradient(110deg,#7c3aed,#38bdf8,#2dd4bf,#f472b6) border-box;color:#eef2ff}}</style><div class="note" role="status"></div>';document.documentElement.append(host);}
        host.style.display=handoff?'':'none';
        if(handoff){const seconds=Math.max(0,Math.ceil((state.expiresAt-Date.now())/1000));root.querySelector('.note').textContent=language()?`You are in control · AI resumes in ${seconds}s`:`你正在操作 · ${seconds} 秒后 AI 继续`;}
    }
    ipcRenderer.on('dragon-browser:operator-state',(_event,value)=>{state=value;render();});
    for(const type of ['pointerdown','pointermove','keydown','wheel','touchstart'])document.addEventListener(type,event=>{
        if(!state||!event.isTrusted||state.active&&!state.manual||Date.now()-lastSent<250)return;
        lastSent=Date.now();ipcRenderer.send('dragon-browser:operator-action','activity');
    },{capture:true,passive:true});
    document.addEventListener('DOMContentLoaded',render);setInterval(render,200);
})();
