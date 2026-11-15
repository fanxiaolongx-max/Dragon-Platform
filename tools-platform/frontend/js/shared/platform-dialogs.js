// Shared platform capability: platform-dialogs. See docs/frontend-architecture.md.
function ensurePlatformConfirmDialog() {
    let modal = document.getElementById('platformConfirmModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'platformConfirmModal';
    modal.className = 'nav-confirm-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="nav-confirm-backdrop" onclick="resolvePlatformConfirm(false)"></div>
        <section class="nav-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="platformConfirmTitle" aria-describedby="platformConfirmMessage platformConfirmHint">
            <div class="nav-confirm-icon" aria-hidden="true">!</div>
            <div class="nav-confirm-copy">
                <span class="nav-confirm-eyebrow"></span>
                <h3 id="platformConfirmTitle"></h3>
                <p id="platformConfirmMessage"></p>
                <div class="nav-confirm-hint" id="platformConfirmHint"></div>
            </div>
            <div class="nav-confirm-actions">
                <button type="button" class="nav-confirm-cancel" onclick="resolvePlatformConfirm(false)"></button>
                <button type="button" class="nav-confirm-submit" onclick="resolvePlatformConfirm(true)"></button>
            </div>
        </section>
    `;
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            window.resolvePlatformConfirm(false);
        }
    });
    document.body.appendChild(modal);
    return modal;
}

function showPlatformConfirm({ title, message, hint, cancelText, confirmText, eyebrow, icon, tone = 'warning', notice = false }) {
    const modal = ensurePlatformConfirmDialog();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl !== document.documentElement && fsEl !== document.body) {
        fsEl.appendChild(modal);
    } else if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    if (navConfirmResolver) {
        navConfirmResolver(false);
        navConfirmResolver = null;
    }
    navDialogPreviousFocus = document.activeElement;
    modal.dataset.tone = tone;
    modal.querySelector('.nav-confirm-icon').textContent = icon || ({ success: '✓', error: '!', danger: '!', info: 'i' }[tone] || '?');
    modal.querySelector('.nav-confirm-eyebrow').textContent = eyebrow || navT(`nav.dialog.${tone === 'danger' ? 'warning' : tone}`);
    modal.querySelector('#platformConfirmTitle').textContent = title || '';
    modal.querySelector('#platformConfirmMessage').textContent = message || '';
    const hintElement = modal.querySelector('#platformConfirmHint');
    hintElement.textContent = hint || '';
    hintElement.hidden = !hint;
    const cancel = modal.querySelector('.nav-confirm-cancel');
    const submit = modal.querySelector('.nav-confirm-submit');
    cancel.hidden = notice;
    cancel.textContent = cancelText || navT('nav.dialog.cancel');
    submit.textContent = confirmText || navT(notice ? 'nav.dialog.close' : 'nav.dialog.confirm');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => (notice ? submit : cancel)?.focus());
    return new Promise(resolve => {
        navConfirmResolver = resolve;
    });
}

function showPlatformNotice({ title, message, hint = '', tone = 'info', confirmText, eyebrow, icon }) {
    return showPlatformConfirm({ title, message, hint, tone, confirmText, eyebrow, icon, notice: true });
}

window.resolvePlatformConfirm = function (confirmed) {
    const modal = document.getElementById('platformConfirmModal');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    const resolve = navConfirmResolver;
    navConfirmResolver = null;
    if (resolve) resolve(Boolean(confirmed));
    if (navDialogPreviousFocus instanceof HTMLElement && document.contains(navDialogPreviousFocus)) {
        navDialogPreviousFocus.focus();
    }
    navDialogPreviousFocus = null;
};

function ensurePlatformFormDialog() {
    let modal = document.getElementById('platformFormDialogModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'platformFormDialogModal';
    modal.className = 'nav-confirm-modal nav-form-dialog-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="nav-confirm-backdrop" onclick="resolvePlatformFormDialog(false)"></div>
        <section class="nav-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="platformFormDialogTitle" aria-describedby="platformFormDialogMessage">
            <div class="nav-confirm-icon" aria-hidden="true">✎</div>
            <div class="nav-confirm-copy">
                <span class="nav-confirm-eyebrow"></span>
                <h3 id="platformFormDialogTitle"></h3>
                <p id="platformFormDialogMessage"></p>
                <form class="nav-dialog-fields" id="platformFormDialogFields" novalidate></form>
                <div class="nav-confirm-hint" id="platformFormDialogHint"></div>
            </div>
            <div class="nav-confirm-actions">
                <button type="button" class="nav-confirm-cancel" onclick="resolvePlatformFormDialog(false)"></button>
                <button type="button" class="nav-confirm-submit" onclick="resolvePlatformFormDialog(true)"></button>
            </div>
        </section>`;
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            window.resolvePlatformFormDialog(false);
        }
    });
    modal.querySelector('#platformFormDialogFields').addEventListener('submit', event => {
        event.preventDefault();
        window.resolvePlatformFormDialog(true);
    });
    document.body.appendChild(modal);
    return modal;
}

function showPlatformFormDialog({ title, message = '', hint = '', fields = [], cancelText, confirmText, eyebrow, icon = '✎', tone = 'info' }) {
    const modal = ensurePlatformFormDialog();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl !== document.documentElement && fsEl !== document.body) {
        fsEl.appendChild(modal);
    } else if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    if (navFormDialogResolver) {
        navFormDialogResolver(null);
        navFormDialogResolver = null;
    }
    navDialogPreviousFocus = document.activeElement;
    modal.dataset.tone = tone;
    modal.querySelector('.nav-confirm-icon').textContent = icon;
    modal.querySelector('.nav-confirm-eyebrow').textContent = eyebrow || navT('nav.dialog.notice');
    modal.querySelector('#platformFormDialogTitle').textContent = title || '';
    const messageElement = modal.querySelector('#platformFormDialogMessage');
    messageElement.textContent = message;
    messageElement.hidden = !message;
    const hintElement = modal.querySelector('#platformFormDialogHint');
    hintElement.textContent = hint;
    hintElement.hidden = !hint;
    const form = modal.querySelector('#platformFormDialogFields');
    form.innerHTML = fields.map((field, index) => {
        const id = `platformFormField${index}`;
        const dependency = field.enabledWhen;
        const dependencyAttrs = dependency
            ? ` data-enabled-when-name="${navEscape(dependency.field)}" data-enabled-when-value="${navEscape(dependency.value)}"`
            : '';
        const dependencyField = dependency ? fields.find(item => item.name === dependency.field) : null;
        const initiallyEnabled = !dependency || String(dependencyField?.value ?? '') === String(dependency.value);
        const disabledClass = initiallyEnabled ? '' : ' is-disabled';
        const disabledAttr = initiallyEnabled ? '' : ' disabled';
        if (Array.isArray(field.options)) {
            const options = field.options.map(option => {
                const value = String(option.value ?? '');
                const selected = value === String(field.value ?? '') ? ' selected' : '';
                return `<option value="${navEscape(value)}"${selected}>${navEscape(option.label ?? value)}</option>`;
            }).join('');
            return `<label class="nav-dialog-field${disabledClass}" for="${id}"${dependencyAttrs}><span>${navEscape(field.label || '')}</span><select id="${id}" name="${navEscape(field.name || `field${index}`)}" ${field.required ? 'required' : ''}${disabledAttr}>${options}</select></label>`;
        }
        const tag = field.multiline ? 'textarea' : 'input';
        const attrs = [
            `id="${id}"`, `name="${navEscape(field.name || `field${index}`)}"`,
            `placeholder="${navEscape(field.placeholder || '')}"`,
            field.required ? 'required' : '',
            field.maxLength ? `maxlength="${Number(field.maxLength)}"` : '',
            !field.multiline ? `type="${navEscape(field.type || 'text')}"` : '',
            disabledAttr,
            `autocomplete="${navEscape(field.autocomplete || 'off')}"`
        ].filter(Boolean).join(' ');
        const value = navEscape(field.value || '');
        return `<label class="nav-dialog-field${disabledClass}" for="${id}"${dependencyAttrs}><span>${navEscape(field.label || '')}</span>${tag === 'textarea' ? `<textarea ${attrs}>${value}</textarea>` : `<input ${attrs} value="${value}">`}</label>`;
    }).join('');
    const cancel = modal.querySelector('.nav-confirm-cancel');
    const submit = modal.querySelector('.nav-confirm-submit');
    cancel.textContent = cancelText || navT('nav.dialog.cancel');
    submit.textContent = confirmText || navT('nav.dialog.save');
    const syncDependentFields = () => {
        form.querySelectorAll('[data-enabled-when-name]').forEach(label => {
            const source = form.elements.namedItem(label.dataset.enabledWhenName);
            const target = label.querySelector('input, select, textarea');
            const enabled = String(source?.value ?? '') === label.dataset.enabledWhenValue;
            if (target) target.disabled = !enabled;
            label.classList.toggle('is-disabled', !enabled);
        });
    };
    const validate = () => {
        syncDependentFields();
        submit.disabled = !form.checkValidity();
    };
    form.oninput = validate;
    form.onchange = validate;
    validate();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => form.querySelector('input, select, textarea')?.focus());
    return new Promise(resolve => { navFormDialogResolver = resolve; });
}

window.resolvePlatformFormDialog = function (confirmed) {
    const modal = document.getElementById('platformFormDialogModal');
    const form = modal?.querySelector('#platformFormDialogFields');
    if (confirmed && form && !form.checkValidity()) {
        form.querySelector(':invalid')?.focus();
        return;
    }
    const values = confirmed && form ? Object.fromEntries(new FormData(form).entries()) : null;
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    const resolve = navFormDialogResolver;
    navFormDialogResolver = null;
    if (resolve) resolve(values);
    if (navDialogPreviousFocus instanceof HTMLElement && document.contains(navDialogPreviousFocus)) {
        navDialogPreviousFocus.focus();
    }
    navDialogPreviousFocus = null;
};

let alertCenterPollTimer = null;

