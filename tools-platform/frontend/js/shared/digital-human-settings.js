// 全局设置 › 频道对接 › 数字人：数字人基座（NetCare 业务库 / 应用库）的连接配置。
// 粘贴参考工程的 .env 配置文本一键导入，或逐项修改（默认 beta 基座域名）；连通性测试逐步显示基座返回。
// 由 channel-settings.js 在切到「数字人」标签时加载，复用其 .nch-* 样式。数据查看在 /netcare-explorer。
(function () {
    'use strict';
    if (window.ToolsDigitalHuman) return;

    const API = '/api/digital-human';
    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const FIELDS = [
        { key: 'baseQueryUrl', env: 'BASE_QUERY_URL', label: ['基座查询地址', 'Base query URL'], wide: true, hint: ['…/digital-human/api/dh/query；换基座只改这里的域名', 'Change the domain here to switch base'] },
        { key: 'businessDatasourceName', env: 'BUSINESS_DATASOURCE_NAME', label: ['业务库数据源（只读）', 'Business datasource (read-only)'] },
        { key: 'businessSchema', env: 'BUSINESS_SCHEMA', label: ['业务库 schema', 'Business schema'], hint: ['默认 netcare', 'Default netcare'] },
        { key: 'appDatasourceId', env: 'APP_DATASOURCE_ID', label: ['应用库数据源 ID', 'App datasource ID'] },
        { key: 'appSchema', env: 'APP_SCHEMA', label: ['应用 schema', 'App schema'] },
        { key: 'appUuid', env: 'APP_UUID', label: ['应用身份 x-app-id', 'App identity x-app-id'] },
        { key: 'appLevel', env: 'APP_LEVEL', label: ['应用级别 x-app-level', 'App level x-app-level'] },
        { key: 'appName', env: 'APP_NAME', label: ['应用名称', 'App name'] },
        { key: 'timeoutSec', env: 'HTTP_TIMEOUT', label: ['超时（秒）', 'Timeout (s)'], type: 'number' },
        { key: 'maxRows', label: ['单次最多取数行数', 'Max rows per query'], type: 'number', hint: ['基座单页 1000 行，超过自动分页', 'Base pages are 1000 rows; larger results page automatically'] }
    ];
    const state = { root: null, config: null, draft: null, dirty: false, busy: '', notice: null, importText: '', parsed: null, test: null };

    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function request(method, path, body) {
        const res = await fetch(`${API}${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() }, body: body !== undefined ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { raw: data.raw });
        return data;
    }

    const time = iso => (iso ? new Date(iso).toLocaleString() : '—');

    // ── 渲染 ─────────────────────────────────────────────
    function renderStatus() {
        const config = state.config;
        const last = config.lastTest;
        const appReady = config.appDatasourceId && config.appSchema;
        return `<section class="nch-card">
            <h4>🤖 ${esc(L('数字人基座', 'Digital human base'))}</h4>
            <p class="nch-desc">${esc(L('平台直接请求基座 REST API（不经过 FastAPI）：NetCare 业务库只读，应用 schema 可读写。启用后可在「NetCare 数据探查」页核对表结构，在首页 Dragon Claw 用 @netcare-data 查询。', 'The platform calls the base REST API directly: the NetCare business database is read-only and the app schema is read-write. Once enabled, review tables in NetCare Explorer and query from Dragon Claw with @netcare-data.'))}</p>
            <div class="nch-status">
                <span class="nch-pill ${config.enabled ? 'ok' : ''}"><i></i>${esc(config.enabled ? L('已启用', 'Enabled') : L('未启用', 'Disabled'))}</span>
                <span class="nch-pill ${last ? (last.ok ? 'ok' : 'bad') : ''}"><i></i>${esc(last ? `${last.ok ? L('上次测试通过', 'Last test passed') : L('上次测试失败', 'Last test failed')} · ${time(last.at)}` : L('尚未测试', 'Not tested'))}</span>
                <span class="nch-pill ${appReady ? 'ok' : 'warn'}"><i></i>${esc(appReady ? L('应用库已配置', 'App schema configured') : L('应用库未配置', 'App schema not configured'))}</span>
                <div class="nch-actions">
                    <a class="nch-btn" href="/netcare-explorer" style="display:inline-flex;align-items:center;text-decoration:none">${esc(L('打开 NetCare 数据探查 →', 'Open NetCare Explorer →'))}</a>
                    <button type="button" class="nch-btn primary" data-dh-action="test" ${state.busy ? 'disabled' : ''}>${esc(state.busy === 'test' ? L('测试中…', 'Testing…') : L('测试连接', 'Test connection'))}</button>
                </div>
            </div>
            ${state.notice ? `<div class="nch-alert ${state.notice.type === 'ok' ? 'ok' : state.notice.type === 'bad' ? 'bad' : 'info'}">${esc(state.notice.text)}${state.notice.raw ? `<pre class="nch-code" style="white-space:pre-wrap">${esc(state.notice.raw)}</pre>` : ''}</div>` : ''}
            ${renderTest()}
        </section>`;
    }

    function renderTest() {
        const test = state.test || (state.config.lastTest ? { ...state.config.lastTest, fromSaved: true } : null);
        if (!test?.steps?.length) return '';
        return `<div class="nch-table-wrap"><table class="nch-table">
            <thead><tr><th>${esc(L('步骤', 'Step'))}</th><th>${esc(L('结果', 'Result'))}</th><th>${esc(L('耗时', 'Time'))}</th><th>${esc(L('说明', 'Detail'))}</th></tr></thead>
            <tbody>${test.steps.map(step => `<tr>
                <td>${esc(step.label)}</td>
                <td><span class="nch-badge ${step.skipped ? 'warn' : step.ok ? 'ok' : 'bad'}">${esc(step.skipped ? L('跳过', 'Skipped') : step.ok ? L('通过', 'OK') : L('失败', 'Failed'))}</span></td>
                <td>${esc(step.durationMs != null ? `${step.durationMs} ms` : '')}</td>
                <td class="nch-text">${esc(step.ok ? step.summary || '' : step.error || '')}${step.raw ? `<details><summary class="nch-muted" style="cursor:pointer">${esc(L('基座原始返回', 'Raw base response'))}</summary><pre class="nch-code" style="white-space:pre-wrap;max-height:220px">${esc(step.raw)}</pre></details>` : ''}</td>
            </tr>`).join('')}</tbody>
        </table></div>${test.fromSaved ? `<p class="nch-muted" style="margin:6px 0 0">${esc(L(`以上为 ${time(test.at)} 的测试结果`, `Results from ${time(test.at)}`))}</p>` : ''}`;
    }

    function renderImport() {
        const parsed = state.parsed;
        return `<section class="nch-card">
            <h4>📥 ${esc(L('配置导入', 'Import configuration'))}</h4>
            <p class="nch-desc">${esc(L('粘贴写报告服务的 .env 配置文本（可从截图识别后粘贴），识别 BASE_QUERY_URL、APP_DATASOURCE_ID、APP_SCHEMA、APP_UUID、APP_LEVEL、BUSINESS_DATASOURCE_NAME、HTTP_TIMEOUT、HTTP_VERIFY_SSL；PORT、CORS 等 FastAPI 自身配置会被忽略。', 'Paste the .env text of the report service. Base URL, datasource, schema and identity keys are imported; FastAPI-only keys such as PORT and CORS are ignored.'))}</p>
            <label class="nch-field nch-wide"><textarea data-dh-import style="height:150px;font-family:ui-monospace,Menlo,monospace;font-size:12px" placeholder="BASE_QUERY_URL=https://…/digital-human/api/dh/query&#10;APP_DATASOURCE_ID=2&#10;APP_SCHEMA=…&#10;APP_UUID=…&#10;APP_LEVEL=BUSINESS&#10;BUSINESS_DATASOURCE_NAME=…">${esc(state.importText)}</textarea></label>
            <div class="nch-row">
                <label class="nch-switch"><input type="checkbox" data-dh-import-enable checked> ${esc(L('导入后启用', 'Enable after import'))}</label>
                <div class="nch-actions">
                    <button type="button" class="nch-btn" data-dh-action="parse" ${state.busy ? 'disabled' : ''}>${esc(L('解析预览', 'Preview'))}</button>
                    <button type="button" class="nch-btn primary" data-dh-action="import" ${state.busy ? 'disabled' : ''}>${esc(state.busy === 'import' ? L('导入中…', 'Importing…') : L('导入并保存', 'Import and save'))}</button>
                </div>
            </div>
            ${parsed ? `<div class="nch-alert ${parsed.warnings.length ? '' : 'info'}">
                ${parsed.applied.length ? `<div>${esc(L(`识别到 ${parsed.applied.length} 项：`, `${parsed.applied.length} keys recognized: `))}</div><div class="nch-kv">${parsed.applied.map(item => `<div><b>${esc(item.key)}</b>${esc(item.value)}</div>`).join('')}</div>` : ''}
                ${parsed.ignored.length ? `<div style="margin-top:6px">${esc(L('已忽略（FastAPI 自身配置）：', 'Ignored (FastAPI-only): '))}<code>${esc(parsed.ignored.join(', '))}</code></div>` : ''}
                ${parsed.unknown.length ? `<div style="margin-top:6px">${esc(L('未识别：', 'Unrecognized: '))}<code>${esc(parsed.unknown.join(', '))}</code></div>` : ''}
                ${parsed.warnings.map(text => `<div style="margin-top:6px">⚠ ${esc(text)}</div>`).join('')}
            </div>` : ''}
        </section>`;
    }

    function renderConfig() {
        const draft = state.draft;
        return `<section class="nch-card">
            <h4>⚙️ ${esc(L('连接配置', 'Connection'))}</h4>
            <p class="nch-desc">${esc(L('应用身份（x-app-id / x-app-level）随每个请求发送给基座；业务库任何写操作都会被拒绝。', 'The app identity headers are sent with every base request; writes to the business database are always rejected.'))}</p>
            <div class="nch-grid">
                <label class="nch-switch nch-wide"><input type="checkbox" data-dh-field="enabled" ${draft.enabled ? 'checked' : ''}> ${esc(L('启用数字人对接', 'Enable the digital human base'))}</label>
                ${FIELDS.map(field => `<label class="nch-field ${field.wide ? 'nch-wide' : ''}">
                    <span>${esc(L(field.label[0], field.label[1]))}${field.env ? ` <small>${esc(field.env)}</small>` : ''}</span>
                    <input type="${field.type || 'text'}" data-dh-field="${field.key}" value="${esc(draft[field.key] ?? '')}" spellcheck="false" autocomplete="off">
                    ${field.hint ? `<small>${esc(L(field.hint[0], field.hint[1]))}</small>` : ''}
                </label>`).join('')}
                <label class="nch-switch"><input type="checkbox" data-dh-field="verifySsl" ${draft.verifySsl ? 'checked' : ''}> ${esc(L('校验 SSL 证书（HTTP_VERIFY_SSL，基座自签证书时保持关闭）', 'Verify SSL certificate (keep off for the self-signed base)'))}</label>
            </div>
        </section>
        <div class="nch-savebar">
            <span data-dh-role="save-state" class="${state.dirty ? 'dirty' : ''}">${esc(state.dirty ? L('有未保存的修改', 'Unsaved changes') : (state.config.updatedAt ? L(`上次保存：${time(state.config.updatedAt)}`, `Last saved: ${time(state.config.updatedAt)}`) : L('尚未保存', 'Not saved yet')))}</span>
            <button type="button" class="nch-btn" data-dh-action="reset" ${state.busy ? 'disabled' : ''}>${esc(L('放弃修改', 'Discard'))}</button>
            <button type="button" class="nch-btn primary" data-dh-action="save" ${state.busy ? 'disabled' : ''}>${esc(state.busy === 'save' ? L('保存中…', 'Saving…') : L('保存配置', 'Save'))}</button>
        </div>`;
    }

    function render() {
        const root = state.root;
        if (!root || !root.isConnected) return;
        if (!state.config) {
            root.innerHTML = `<div class="nav-settings-empty">${esc(L('正在加载数字人配置…', 'Loading digital human settings…'))}</div>`;
            return;
        }
        // 保留导入框里正在输入的文字
        const importBox = root.querySelector('[data-dh-import]');
        if (importBox) state.importText = importBox.value;
        root.innerHTML = renderStatus() + renderImport() + renderConfig();
    }

    // ── 交互 ─────────────────────────────────────────────
    function readDraft() {
        const draft = { ...state.draft };
        state.root.querySelectorAll('[data-dh-field]').forEach(input => {
            const key = input.dataset.dhField;
            draft[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim();
        });
        return draft;
    }

    async function run(busy, fn) {
        state.busy = busy;
        render();
        try {
            await fn();
        } catch (error) {
            state.notice = { type: 'bad', text: error.message || String(error), raw: error.raw || '' };
        } finally {
            state.busy = '';
            render();
        }
    }

    async function onClick(event) {
        const button = event.target.closest('[data-dh-action]');
        if (!button || !state.root.contains(button) || state.busy) return;
        const action = button.dataset.dhAction;
        const importText = state.root.querySelector('[data-dh-import]')?.value || '';
        state.importText = importText;
        if (action === 'parse') {
            return run('parse', async () => {
                state.parsed = await request('POST', '/config/parse', { text: importText });
                state.notice = null;
            });
        }
        if (action === 'import') {
            const enable = Boolean(state.root.querySelector('[data-dh-import-enable]')?.checked);
            return run('import', async () => {
                const result = await request('POST', '/config/import', { text: importText, enable });
                state.parsed = result;
                state.config = result.config;
                state.draft = { ...result.config };
                state.dirty = false;
                state.notice = { type: 'ok', text: L(`已导入 ${result.applied.length} 项配置${enable ? '并启用' : ''}，可以点击「测试连接」验证。`, `Imported ${result.applied.length} keys${enable ? ' and enabled' : ''}. Click Test connection to verify.`) };
            });
        }
        if (action === 'save') {
            const draft = readDraft();
            return run('save', async () => {
                const result = await request('PUT', '/config', draft);
                state.config = result.config;
                state.draft = { ...result.config };
                state.dirty = false;
                state.notice = { type: 'ok', text: L('配置已保存', 'Saved') };
            });
        }
        if (action === 'reset') {
            state.draft = { ...state.config };
            state.dirty = false;
            state.notice = null;
            return render();
        }
        if (action === 'test') {
            const draft = readDraft();
            return run('test', async () => {
                state.test = await request('POST', '/test', { config: draft });
                state.config = { ...state.config, lastTest: { at: state.test.at, ok: state.test.ok, steps: state.test.steps } };
                state.notice = state.test.ok
                    ? { type: 'ok', text: L(`连接正常${state.dirty ? '（以上用未保存的配置测试，记得保存）' : ''}`, `Connection OK${state.dirty ? ' (tested with unsaved changes — remember to save)' : ''}`) }
                    : { type: 'bad', text: L('部分步骤失败，请查看下表的错误说明与基座原始返回。', 'Some steps failed; see the errors and raw responses below.') };
            });
        }
        return undefined;
    }

    function onInput(event) {
        if (!event.target.matches?.('[data-dh-field]')) return;
        state.draft = readDraft();
        state.dirty = true;
        const label = state.root.querySelector('[data-dh-role="save-state"]');
        if (label) {
            label.textContent = L('有未保存的修改', 'Unsaved changes');
            label.classList.add('dirty');
        }
    }

    async function renderInto(root) {
        Object.assign(state, { root, config: null, draft: null, dirty: false, busy: '', notice: null, parsed: null, test: null });
        render();
        if (!root.dataset.dhBound) {
            root.dataset.dhBound = '1';
            root.addEventListener('click', event => { onClick(event).catch(error => window.showToast?.(error.message)); });
            root.addEventListener('input', onInput);
            root.addEventListener('change', onInput);
        }
        try {
            const data = await request('GET', '/config');
            state.config = data.config;
            state.draft = { ...data.config };
            render();
        } catch (error) {
            if (root === state.root && root.isConnected) root.innerHTML = `<div class="nav-settings-empty">${esc(L('加载失败：', 'Failed to load: '))}${esc(error.message)}</div>`;
        }
    }

    window.ToolsDigitalHuman = { render: renderInto };
})();
