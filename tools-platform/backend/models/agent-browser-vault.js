// 保险箱与浏览器页面的对接（经 CDP）：
// - 服务器浏览器：每个页面注入一段「隔离世界」脚本，发现登录表单就向后端要凭据自动填充，提交登录时把账号密码存进保险箱。
//   网页自己的脚本看不到这段脚本，也调不到它用的通道（binding 只对隔离世界开放）。
// - AI 的 browser_login：同样在隔离世界里把凭据填进表单并提交，密码不经过模型，也不出现在工具结果里。
// 站点一律以浏览器当前主框架的真实地址为准，不采信页面脚本传来的任何地址。
'use strict';
const { vault, originOf, maskUsername } = require('./password-vault');

const WORLD = 'dragon-vault';
const BINDING = '__dragonVault';

// 登录表单识别、填充与提交。保持自包含：会被序列化后注入页面。
function loginHelpers() {
    const visible = input => input && !input.disabled && !input.readOnly && input.getClientRects().length > 0;
    const hint = input => `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label') || ''}`;
    const textLike = input => visible(input) && ['text', 'email', 'tel', ''].includes(input.type) && !/captcha|verify|verification|otp|验证码|校验|search|搜索/i.test(hint(input));
    function fields() {
        const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
        if (passwords.length !== 1 || passwords[0].autocomplete === 'new-password') return null;
        const password = passwords[0], scope = password.form || document;
        const candidates = [...scope.querySelectorAll('input')].filter(textLike);
        const username = candidates.find(input => input.autocomplete === 'username') || candidates.filter(input => input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
        return username ? { username, password, scope } : null;
    }
    // 两步登录的第一步：页面上只有一个账号输入框，还没有密码框
    function usernameOnly() {
        if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return null;
        const candidates = [...document.querySelectorAll('input')].filter(textLike).filter(input => input.autocomplete === 'username' || input.type === 'email' || /user|account|login|email|账号|帐号|用户名|邮箱|手机/i.test(hint(input)));
        return candidates.length === 1 ? { username: candidates[0], scope: candidates[0].form || document } : null;
    }
    function setValue(input, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        input.focus();
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const buttonText = button => (button.innerText || button.value || button.textContent || '').replace(/\s+/g, ' ').trim();
    const buttons = scope => [...scope.querySelectorAll('button,input[type="submit"],[role="button"]')].filter(visible);
    function loginButton(scope) {
        const list = buttons(scope);
        return list.find(button => /^(?:登\s*[录入]|登录系统|立即登录|sign\s*in|log\s*in|login)$/i.test(buttonText(button))) || list.find(button => button.type === 'submit') || null;
    }
    function nextButton(scope) {
        const list = buttons(scope);
        return list.find(button => /^(?:下一步|继续|next|continue)$/i.test(buttonText(button))) || list.find(button => button.type === 'submit') || null;
    }
    function needsVerification(scope) {
        return [...scope.querySelectorAll('input,iframe')].some(input => {
            if (!visible(input)) return false;
            if (input.tagName === 'IFRAME') return /captcha|recaptcha|hcaptcha/i.test(input.src);
            return /captcha|otp|verification|verify.?code|sms|验证码|动态码|短信/i.test(hint(input)) || (input.required && ((input.type === 'checkbox' && !input.checked) || (!['submit', 'button', 'checkbox', 'radio', 'hidden'].includes(input.type) && !input.value)));
        }) || !!scope.querySelector('[class*="captcha"],[id*="captcha"]');
    }
    const usable = button => button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    return { fields, usernameOnly, setValue, loginButton, nextButton, needsVerification, usable };
}

// 页面内常驻脚本：发现登录表单 → probe；用户提交 → save。只在主框架运行。
function pageAgent(bindingName, helpers) {
    if (window.top !== window || window.__dragonVaultInstalled) return;
    window.__dragonVaultInstalled = true;
    const { fields, setValue, loginButton, needsVerification, usable } = helpers();
    const documentId = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
    let requested = false, filled = false, capture = false, scanTimer, observer, lastSaved = '';
    const send = (action, credentials) => { try { window[bindingName](JSON.stringify({ action, document: documentId, ...(credentials ? { credentials } : {}) })); } catch (_error) { /* 通道不可用时什么都不做 */ } };
    function scan() { if (!requested && fields()) { requested = true; observer?.disconnect(); send('probe'); } }
    window.__dragonVaultState = state => {
        if (!state || state.document !== documentId || state.origin !== location.origin) return;
        capture = state.capture === true;
        if (filled || !state.credentials) return;
        const form = fields();
        if (!form || (form.username.value && form.username.value !== state.credentials.username) || form.password.value) return;
        filled = true;
        setValue(form.username, state.credentials.username);
        setValue(form.password, state.credentials.password);
        lastSaved = `${state.credentials.username}\n${state.credentials.password}`;
        // 等前端校验跑完再提交；只提交一次，不替用户勾选协议或处理验证码
        setTimeout(() => {
            if (!state.autoSubmit || !form.password.isConnected || needsVerification(form.scope)) return;
            const button = loginButton(form.scope);
            if (!usable(button) || form.username.value !== state.credentials.username || form.password.value !== state.credentials.password) return;
            button.click();
        }, 700);
    };
    function remember(event) {
        if (!capture || !event.isTrusted) return;
        const form = fields();
        if (!form?.username.value || !form.password.value) return;
        if (event.type === 'click') {
            const target = event.target.closest?.('button,input[type="submit"],[role="button"]');
            if (!target || target !== loginButton(form.scope)) return;
        }
        if (event.type === 'keydown' && event.key !== 'Enter') return;
        const key = `${form.username.value}\n${form.password.value}`;
        if (key === lastSaved) return;
        lastSaved = key;
        send('save', { username: form.username.value, password: form.password.value });
    }
    document.addEventListener('submit', remember, true);
    document.addEventListener('click', remember, true);
    document.addEventListener('keydown', remember, true);
    const start = () => {
        observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 200); });
        observer.observe(document.documentElement, { subtree: true, childList: true });
        scan();
    };
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}

// browser_login 的一步：填账号密码并（可选）提交。返回状态，不返回任何凭据。
function fillOnce(helpers, credentials, submit) {
    const { fields, usernameOnly, setValue, loginButton, nextButton, needsVerification, usable } = helpers();
    const form = fields();
    if (form) {
        setValue(form.username, credentials.username);
        setValue(form.password, credentials.password);
        if (!submit) return { status: 'filled' };
        if (needsVerification(form.scope)) return { status: 'needs-verification' };
        return new Promise(resolve => setTimeout(() => {
            const button = loginButton(form.scope);
            if (usable(button)) { button.click(); return resolve({ status: 'submitted' }); }
            if (form.password.form?.requestSubmit) { form.password.form.requestSubmit(); return resolve({ status: 'submitted' }); }
            resolve({ status: 'filled' });
        }, 400));
    }
    const first = usernameOnly();
    if (!first) return { status: 'no-form' };
    setValue(first.username, credentials.username);
    return new Promise(resolve => setTimeout(() => {
        const button = nextButton(first.scope);
        if (usable(button)) { button.click(); return resolve({ status: 'username-step' }); }
        resolve({ status: 'no-form' });
    }, 300));
}

const PAGE_AGENT_SOURCE = `(${pageAgent})(${JSON.stringify(BINDING)}, ${loginHelpers});`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 浏览器归属（租户::账号）→ 保险箱归属（账号）。账号名全平台唯一。 */
function vaultOwnerOf(browserOwner) {
    const text = String(browserOwner || ''), at = text.indexOf('::');
    return (at >= 0 ? text.slice(at + 2) : text) || null;
}

/** 把刚填过的密码从任何要给模型 / 界面看的文本里抹掉（含 URL 编码和 JSON 转义后的形态）。 */
function maskSecrets(text, secrets) {
    let output = String(text ?? '');
    for (const secret of secrets || []) {
        if (!secret) continue;
        for (const form of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1), Buffer.from(secret, 'utf8').toString('base64')])) {
            if (form.length >= 4) output = output.split(form).join('[保险箱密码]');
        }
    }
    return output;
}

/**
 * 给页面装上自动保存 / 自动填充。
 * cdp(method, params)：不受命令中断影响的 CDP 通道；context()：返回 { owner, secrets, notify } 或 null（页面此刻没有归属时什么都不做）。
 */
async function install(cdp, context) {
    await cdp('Runtime.addBinding', { name: BINDING, executionContextName: WORLD });
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_AGENT_SOURCE, worldName: WORLD, runImmediately: true });
    return async function onBinding(params = {}) {
        if (params.name !== BINDING) return;
        let message;
        try { message = JSON.parse(String(params.payload || '').slice(0, 16 * 1024)); } catch (_error) { return; }
        if (!message || typeof message.document !== 'string' || message.document.length > 100) return;
        const ctx = context();
        const owner = vaultOwnerOf(ctx?.owner);
        if (!owner) return;
        const evaluate = expression => cdp('Runtime.evaluate', { expression, contextId: params.executionContextId, returnByValue: true }).then(result => result.result?.value);
        try {
            const origin = originOf(await evaluate('window.top === window ? location.href : ""'));
            if (!origin) return;
            if (message.action === 'probe') {
                const never = await vault().neverSave(owner, origin);
                const entry = (await vault().find(owner, origin)).find(item => item.autoFill);
                const credentials = entry ? await vault().credentials(owner, origin, { id: entry.id }) : null;
                if (credentials) ctx.secrets?.add(credentials.password);
                const autoSubmit = !!(credentials?.autoSubmit && vault().claimAutoSubmit(owner, origin));
                await evaluate(`window.__dragonVaultState(${JSON.stringify({ document: message.document, origin, capture: !never, autoSubmit,
                    credentials: credentials ? { username: credentials.username, password: credentials.password } : null })})`);
                if (credentials) ctx.notify?.({ kind: 'filled', origin, username: maskUsername(credentials.username) });
            } else if (message.action === 'save') {
                const { username, password } = message.credentials || {};
                if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) return;
                if (await vault().neverSave(owner, origin)) return;
                const known = await vault().credentials(owner, origin, { username: username.trim() });
                ctx.secrets?.add(password);
                // 用户刚亲手登录过：接下来几分钟回到登录页（后退、退出登录）只填写，不再自动提交
                vault().claimAutoSubmit(owner, origin);
                if (known?.password === password) return;
                await vault().save(owner, { origin, username, password });
                ctx.notify?.({ kind: known ? 'updated' : 'saved', origin, username: maskUsername(username) });
            }
        } catch (error) {
            // 绝不把凭据或原始错误带进日志
            console.warn('[vault] browser hook failed:', error?.code || error?.name || 'error');
        }
    };
}

/**
 * 用保险箱凭据登录当前页面（AI 的 browser_login）。
 * 返回 { status, username（打码）, accounts? }；status：submitted / filled / needs-verification / no-form / no-credentials / choose-account。
 */
async function login({ cdp, url, owner, username, submit = true, secrets }) {
    const vaultOwner = vaultOwnerOf(owner), origin = originOf(url);
    if (!vaultOwner || !origin) return { status: 'no-credentials', origin: origin || String(url || '') };
    const entries = await vault().find(vaultOwner, origin);
    if (!entries.length) return { status: 'no-credentials', origin };
    const wanted = username ? entries.find(item => item.username === username || maskUsername(item.username) === username) : entries.length === 1 ? entries[0] : null;
    if (!wanted) return { status: 'choose-account', origin, accounts: entries.map(item => maskUsername(item.username)) };
    const credentials = await vault().credentials(vaultOwner, origin, { id: wanted.id });
    secrets?.add(credentials.password);
    const masked = maskUsername(credentials.username);
    let status = 'no-form';
    // 两步登录：先填账号点下一步，再填密码
    for (let step = 0; step < 2; step += 1) {
        const tree = await cdp('Page.getFrameTree', {});
        const world = await cdp('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: `${WORLD}-fill` });
        // 页面可能在取凭据期间跳走：填之前再核对一次站点
        const check = await cdp('Runtime.evaluate', { expression: 'location.origin', contextId: world.executionContextId, returnByValue: true });
        if (check.result?.value !== origin) return { status: 'no-form', origin, username: masked };
        const result = await cdp('Runtime.evaluate', {
            expression: `(${fillOnce})(${loginHelpers}, ${JSON.stringify({ username: credentials.username, password: credentials.password })}, ${submit ? 'true' : 'false'})`,
            contextId: world.executionContextId, returnByValue: true, awaitPromise: true, userGesture: true
        });
        status = result.exceptionDetails ? 'no-form' : result.result?.value?.status || 'no-form';
        if (status !== 'username-step') break;
        await pause(1500);
    }
    return { status: status === 'username-step' ? 'no-form' : status, origin, username: masked };
}

module.exports = { install, login, maskSecrets, vaultOwnerOf, WORLD, BINDING, PAGE_AGENT_SOURCE };
