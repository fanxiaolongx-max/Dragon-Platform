// 隔离世界中接收真实 Ctrl/Command+滚轮；不向网页暴露任何 Electron API。
const { ipcRenderer } = require('electron');
window.addEventListener('wheel', event => {
    if (!event.isTrusted || !(event.ctrlKey || event.metaKey) || !event.deltaY) return;
    event.preventDefault();
    ipcRenderer.send('dragon-browser:zoom-wheel', event.deltaY < 0 ? 'in' : 'out');
}, { capture: true, passive: false });

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
