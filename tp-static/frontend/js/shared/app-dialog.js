/* 平台统一弹窗：替代浏览器原生 alert / confirm / prompt（样式割裂、阻塞页面、无法本地化）。
 * 用法（均返回 Promise）：
 *   await AppDialog.alert('已保存', { title: '提示', tone: 'success' });
 *   if (await AppDialog.confirm('确认删除？', { tone: 'danger', confirmText: '删除' })) { ... }
 *   const reason = await AppDialog.prompt('请输入原因', { defaultValue: '' });  // 取消返回 null
 * 已加载导航栏（navbar.js）的页面直接复用 showNavbarConfirm / showNavbarFormDialog，保持全站一致；
 * 独立页面（如 License 签发页）使用本文件自带的同风格弹窗。 */
(function () {
    'use strict';
    if (window.AppDialog) return;

    const TONE_ICON = { success: '✓', error: '!', danger: '!', warning: '!', info: 'i' };
    const TONE_EYEBROW = { success: '完成', error: '出错了', danger: '请确认', warning: '请确认', info: '提示' };
    let active = null;

    function injectStyle() {
        if (document.getElementById('appDialogStyle')) return;
        const style = document.createElement('style');
        style.id = 'appDialogStyle';
        style.textContent = `
            .app-dialog { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 20px; background: rgba(2, 6, 23, .72); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); opacity: 0; transition: opacity .16s ease; font-family: Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
            .app-dialog.open { opacity: 1; }
            .app-dialog-card { width: min(440px, 100%); display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 4px 14px; padding: 22px 22px 18px; border: 1px solid #2b3d5a; border-radius: 16px; background: linear-gradient(180deg, #111e31, #0c1727); color: #dbeafe; box-shadow: 0 28px 80px rgba(0, 0, 0, .55); transform: translateY(8px) scale(.98); transition: transform .18s cubic-bezier(.2,.8,.2,1); }
            .app-dialog.open .app-dialog-card { transform: none; }
            .app-dialog-icon { grid-row: 1 / 3; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; font: 800 18px/1 inherit; background: rgba(56, 189, 248, .14); color: #7dd3fc; }
            .app-dialog[data-tone="success"] .app-dialog-icon { background: rgba(52, 211, 153, .14); color: #6ee7b7; }
            .app-dialog[data-tone="error"] .app-dialog-icon, .app-dialog[data-tone="danger"] .app-dialog-icon { background: rgba(248, 113, 113, .14); color: #fca5a5; }
            .app-dialog[data-tone="warning"] .app-dialog-icon { background: rgba(251, 191, 36, .14); color: #fcd34d; }
            .app-dialog-eyebrow { color: #67e8f9; font-size: 10.5px; font-weight: 800; letter-spacing: .14em; }
            .app-dialog-title { margin: 2px 0 0; font-size: 16px; font-weight: 750; color: #f1f5f9; }
            .app-dialog-message { grid-column: 2; margin: 8px 0 0; color: #a9bad0; font-size: 13px; line-height: 1.7; white-space: pre-line; word-break: break-word; }
            .app-dialog.has-details .app-dialog-card { width: min(880px, 100%); max-height: calc(100dvh - 40px); overflow: auto; }
            .app-dialog-details { grid-column: 1 / -1; min-width: 0; max-width: 100%; margin: 12px 0 0; padding: 12px; max-height: 40dvh; overflow: auto; white-space: pre; background: #091321; border: 1px solid #2b3d5a; border-radius: 8px; color: #c6d5e7; font: 12px/1.6 ui-monospace, monospace; }
            .app-dialog-label { grid-column: 2; margin-top: 12px; color: #b9c9dc; font-size: 12px; font-weight: 700; }
            .app-dialog-label + .app-dialog-input { margin-top: 6px; }
            .app-dialog-input { grid-column: 2; width: 100%; box-sizing: border-box; margin-top: 12px; padding: 9px 11px; border: 1px solid #3a4a64; border-radius: 9px; background: #091321; color: #dbeafe; font: inherit; font-size: 13px; resize: vertical; }
            .app-dialog-input:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56, 189, 248, .15); }
            .app-dialog-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 9px; margin-top: 18px; }
            .app-dialog-btn { min-width: 76px; padding: 9px 16px; border: 1px solid #3a4a64; border-radius: 9px; background: #17243a; color: #c6d5e7; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
            .app-dialog-btn:hover { border-color: #52647f; color: #fff; }
            .app-dialog-btn.primary { border-color: transparent; background: #2563eb; color: #fff; }
            .app-dialog[data-tone="danger"] .app-dialog-btn.primary, .app-dialog[data-tone="error"] .app-dialog-btn.primary { background: #b91c1c; }
            .app-dialog[data-tone="success"] .app-dialog-btn.primary { background: #047857; }
            .app-dialog-btn:focus-visible, .app-dialog-input:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
            @media (max-width: 520px) { .app-dialog { align-items: end; padding: 0; } .app-dialog-card { width: 100%; border-radius: 18px 18px 0 0; } .app-dialog-actions .app-dialog-btn { flex: 1; } }
            @media (prefers-reduced-motion: reduce) { .app-dialog, .app-dialog-card { transition: none; } }
            .app-dialog-host { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; }
            .app-dialog-host::backdrop { background: transparent; }
        `;
        document.head.appendChild(style);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // 自带弹窗：kind = alert | confirm | prompt
    function open(kind, message, options = {}) {
        injectStyle();
        if (active) active.close(kind === 'prompt' ? null : false);
        const tone = options.tone || (kind === 'confirm' ? 'warning' : 'info');
        const previousFocus = document.activeElement;
        const root = document.createElement('div');
        root.className = 'app-dialog' + (options.details ? ' has-details' : '');
        root.dataset.tone = tone;
        root.innerHTML = `
            <section class="app-dialog-card" role="${kind === 'alert' ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="appDialogTitle">
                <div class="app-dialog-icon" aria-hidden="true">${escapeHtml(options.icon || TONE_ICON[tone] || '?')}</div>
                <div><div class="app-dialog-eyebrow">${escapeHtml(options.eyebrow || TONE_EYEBROW[tone] || '提示')}</div><h3 class="app-dialog-title" id="appDialogTitle">${escapeHtml(options.title || (kind === 'prompt' ? '请输入' : kind === 'confirm' ? '确认操作' : '提示'))}</h3></div>
                ${message ? `<p class="app-dialog-message">${escapeHtml(message)}</p>` : ''}
                ${options.details ? `<pre class="app-dialog-details" tabindex="0">${escapeHtml(options.details)}</pre>` : ''}
                ${kind === 'prompt' && options.label ? `<label class="app-dialog-label" for="appDialogInput">${escapeHtml(options.label)}</label>` : ''}
                ${kind === 'prompt' ? (options.multiline
                    ? `<textarea class="app-dialog-input" id="appDialogInput" rows="3" maxlength="${Number(options.maxLength) || 500}" placeholder="${escapeHtml(options.placeholder || '')}">${escapeHtml(options.defaultValue || '')}</textarea>`
                    : `<input class="app-dialog-input" id="appDialogInput" type="text" maxlength="${Number(options.maxLength) || 500}" placeholder="${escapeHtml(options.placeholder || '')}" value="${escapeHtml(options.defaultValue || '')}">`) : ''}
                <div class="app-dialog-actions">
                    ${kind === 'alert' ? '' : `<button type="button" class="app-dialog-btn" data-dialog="cancel">${escapeHtml(options.cancelText || '取消')}</button>`}
                    <button type="button" class="app-dialog-btn primary" data-dialog="ok">${escapeHtml(options.confirmText || (kind === 'alert' ? '知道了' : '确定'))}</button>
                </div>
            </section>`;
        // 页面已有 showModal() 打开的原生 <dialog> 时，其余区域是 inert 且被顶层遮挡：把弹窗也放进顶层 <dialog> 才能显示并操作
        const targetContainer = (document.fullscreenElement && document.fullscreenElement !== document.documentElement && document.fullscreenElement !== document.body)
            ? document.fullscreenElement
            : document.body;
        const modalHost = hasOpenModalDialog() ? document.createElement('dialog') : null;
        if (modalHost) {
            modalHost.className = 'app-dialog-host';
            modalHost.addEventListener('cancel', event => event.preventDefault());
            modalHost.appendChild(root);
            targetContainer.appendChild(modalHost);
            modalHost.showModal();
        } else {
            targetContainer.appendChild(root);
        }
        const input = root.querySelector('.app-dialog-input');
        return new Promise(resolve => {
            const close = value => {
                if (!root.isConnected) return;
                document.removeEventListener('keydown', onKey, true);
                root.classList.remove('open');
                setTimeout(() => { if (modalHost && modalHost.open) modalHost.close(); (modalHost || root).remove(); }, 160);
                if (active && active.root === root) active = null;
                if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus();
                resolve(value);
            };
            const ok = () => close(kind === 'prompt' ? input.value : kind === 'confirm' ? true : undefined);
            const cancel = () => close(kind === 'prompt' ? null : kind === 'confirm' ? false : undefined);
            const onKey = event => {
                if (event.key === 'Escape') { event.preventDefault(); cancel(); }
                else if (event.key === 'Enter' && !(input && input.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey)) {
                    if (document.activeElement && document.activeElement.dataset.dialog === 'cancel') return;
                    event.preventDefault(); ok();
                }
            };
            document.addEventListener('keydown', onKey, true);
            root.addEventListener('click', event => {
                if (event.target === root) { if (kind !== 'alert') cancel(); else ok(); }
                const action = event.target.closest('[data-dialog]');
                if (action) action.dataset.dialog === 'ok' ? ok() : cancel();
            });
            active = { root, close };
            requestAnimationFrame(() => {
                root.classList.add('open');
                (input || root.querySelector(kind === 'confirm' && tone === 'danger' ? '[data-dialog="cancel"]' : '[data-dialog="ok"]')).focus();
                if (input && input.select) input.select();
            });
        });
    }

    function hasOpenModalDialog() {
        try { return Boolean(document.querySelector('dialog:modal')); }
        catch (_) { return Boolean(document.querySelector('dialog[open]')); }
    }
    // 导航栏弹窗是普通层级的 div，无法盖住 showModal() 的顶层 <dialog>，此时改用自带弹窗
    const hasNavbarDialogs = () => typeof window.showNavbarConfirm === 'function' && !hasOpenModalDialog();

    // 原生弹窗总在最上层；部分页面自有模态框（如 UIVF12、月报）层级高于导航栏弹窗，委托期间临时抬高到顶层
    function liftWhileOpen(modalId, promise) {
        const modal = document.getElementById(modalId);
        if (!modal) return promise;
        const token = {};
        modal.__appDialogLift = token;
        modal.style.zIndex = '2147483646';
        return promise.finally(() => {
            if (modal.__appDialogLift !== token) return;
            modal.__appDialogLift = null;
            modal.style.zIndex = '';
        });
    }

    window.AppDialog = {
        alert(message, options = {}) {
            if (hasNavbarDialogs()) {
                return liftWhileOpen('navbarConfirmModal', window.showNavbarNotice({ title: options.title || '提示', message, hint: options.hint, tone: options.tone || 'info', confirmText: options.confirmText })).then(() => undefined);
            }
            return open('alert', message, options);
        },
        confirm(message, options = {}) {
            if (hasNavbarDialogs() && !options.details) {
                return liftWhileOpen('navbarConfirmModal', window.showNavbarConfirm({ title: options.title || '确认操作', message, hint: options.hint, tone: options.tone || 'warning', confirmText: options.confirmText, cancelText: options.cancelText }));
            }
            return open('confirm', message, options);
        },
        prompt(message, options = {}) {
            if (typeof window.showNavbarFormDialog === 'function' && !hasOpenModalDialog()) {
                return liftWhileOpen('navbarFormDialogModal', window.showNavbarFormDialog({
                    title: options.title || '请输入', message, hint: options.hint, tone: options.tone || 'info',
                    confirmText: options.confirmText, cancelText: options.cancelText,
                    fields: [{ name: 'value', label: options.label || '', value: options.defaultValue || '', placeholder: options.placeholder || '', multiline: Boolean(options.multiline), maxLength: options.maxLength }]
                })).then(values => (values ? String(values.value ?? '') : null));
            }
            return open('prompt', message, options);
        }
    };
})();
