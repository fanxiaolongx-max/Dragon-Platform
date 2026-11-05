/**
 * First-run quick-start prompt shared by source, installed and portable builds.
 * The decision is stored by the backend in its active data directory, so it is
 * independent of browser cache and Electron packaging mode.
 */
(function initFirstRunOnboardingModule() {
    // Legal/public pages must remain readable without an authenticated API request.
    if (/^\/(?:pages\/)?(?:privacy|terms|login|cinema)(?:\.html)?\/?$/.test(window.location.pathname)) return;
    const MODAL_ID = 'defaultQuickStartModal';

    function isEnglish() {
        const value = localStorage.getItem('tools_lang') || navigator.language || document.documentElement.lang || '';
        return /^en/i.test(value);
    }

    function formatDateTime(isoString) {
        if (!isoString) return '--';
        try {
            const d = new Date(isoString);
            if (isNaN(d.getTime())) return isoString;
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch (_) {
            return isoString;
        }
    }

    function strings() {
        return isEnglish() ? {
            eyebrow: 'WELCOME · QUICK START',
            title: 'Set up your workspace',
            intro: 'Import default scripts and metric rules to get started, or skip and configure your workspace later.',
            versionLabel: 'Build Version',
            buildTimeLabel: 'Build Time',
            runtimeLabel: 'Runtime Environment',
            depsTitle: 'Built-in Core Packages & Dependencies',
            safeNotice: 'Safety Note: Import only supplements missing items without overwriting existing local configuration. A backup snapshot is created automatically.',
            selectHint: 'Optional Baseline Initializers:',
            scriptsOption: 'Default Scheduling Scripts Repository',
            rulesOption: 'Complete KPI Metric Baseline Rules',
            import: 'Import Selected Defaults',
            skip: 'Do Not Import, Open Directly',
            importing: 'Backing up configuration and initializing defaults…',
            skipping: 'Saving your preferences…',
            success: 'Workspace initialized. Reloading…',
            skipped: 'Preferences saved. Opening your workspace.',
            chooseOne: 'Select at least one baseline item to import, or click "Do Not Import".',
            failed: 'Setup failed: '
        } : {
            eyebrow: '欢迎使用 · 开箱即用',
            title: '准备好开始使用了',
            intro: '导入默认脚本与指标规则，即可开始使用；也可以跳过，稍后在设置中导入。',
            versionLabel: '构建版本',
            buildTimeLabel: '构建时间',
            runtimeLabel: '运行环境',
            depsTitle: '内置核心组件与三方依赖',
            safeNotice: '安全保障：导入仅补充缺失项，同名脚本和同标识规则保留本地版本，操作前会自动生成安全快照备份。',
            selectHint: '可选初始化基础包：',
            scriptsOption: '默认智能调度脚本仓库',
            rulesOption: '全量指标与考勤基线规则 (含目标/权重/分组)',
            import: '导入选中的默认内容',
            skip: '不导入，直接使用',
            importing: '正在备份现有配置并导入…',
            skipping: '正在保存选择…',
            success: '默认内容已导入，正在重新加载工作区…',
            skipped: '已保存选择，开始使用工作区。',
            chooseOne: '请至少选择一项需要导入的内容，或直接点击“不导入”。',
            failed: '首次启动选择保存失败：'
        };
    }

    function addStyles() {
        if (document.getElementById('defaultQuickStartStyles')) return;
        const style = document.createElement('style');
        style.id = 'defaultQuickStartStyles';
        style.textContent = `
            .quick-start-overlay{--qs-bg:#fff;--qs-panel:#f7f7f8;--qs-line:#e7e7ea;--qs-ink:#1f2328;--qs-muted:#62666d;--qs-button:#242424;--qs-button-ink:#fff;position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.38);backdrop-filter:blur(6px);color-scheme:light}
            html[data-theme="dark"] .quick-start-overlay,html[data-platform-theme="dark"] .quick-start-overlay{--qs-bg:#1a1d23;--qs-panel:#15181d;--qs-line:#353a43;--qs-ink:#e6e8eb;--qs-muted:#b3b9c2;--qs-button:#e6e8eb;--qs-button-ink:#16181c;color-scheme:dark}
            .quick-start-overlay,.quick-start-overlay *{box-sizing:border-box}
            .quick-start-card{width:min(660px,100%);min-width:0;max-height:calc(100dvh - 48px);overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--qs-line);border-radius:18px;background:var(--qs-bg);color:var(--qs-ink);box-shadow:0 24px 80px rgba(0,0,0,.2);font-family:Inter,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;overflow-wrap:anywhere}
            .quick-start-head{padding:28px 28px 20px;border-bottom:1px solid var(--qs-line)}
            .quick-start-eyebrow{color:var(--qs-muted);font-size:11px;font-weight:600;letter-spacing:.1em}
            .quick-start-head h2{margin:10px 0;color:var(--qs-ink);font-size:24px;font-weight:650;line-height:1.3}
            .quick-start-head p{margin:0;color:var(--qs-muted);font-size:13px;line-height:1.7}
            .quick-start-body{padding:20px 28px 24px}
            .quick-start-meta-banner{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px;border:1px solid var(--qs-line);border-radius:10px;background:var(--qs-panel);margin-bottom:16px}
            .quick-start-card .meta-item{display:flex;flex-direction:column;gap:4px;min-width:0}
            .quick-start-card .meta-item.full{grid-column:1/-1}
            .quick-start-card .meta-lbl{color:var(--qs-muted);font-size:11px}
            .quick-start-card .meta-val{color:var(--qs-ink);font-size:12px;font-weight:500}
            .quick-start-card .meta-val.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
            .quick-start-deps-section{margin-bottom:16px}
            .quick-start-card .deps-heading{color:var(--qs-muted);font-size:12px;cursor:pointer}
            .quick-start-card .deps-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
            .quick-start-card .dep-pill{min-width:0;padding:10px;border:1px solid var(--qs-line);border-radius:8px;background:var(--qs-panel)}
            .quick-start-card .dep-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px}
            .quick-start-card .dep-name,.quick-start-card .dep-ver{color:var(--qs-ink);font-size:11px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
            .quick-start-card .dep-ver,.quick-start-card .dep-role{color:var(--qs-muted);font-size:11px;line-height:1.5}
            .quick-start-safe-strip{padding:12px;border:1px solid var(--qs-line);border-radius:10px;background:var(--qs-panel);color:var(--qs-muted);font-size:12px;line-height:1.65;margin-bottom:20px}
            .quick-start-select-title{margin-bottom:10px;color:var(--qs-ink);font-size:12px;font-weight:600}
            .quick-start-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}
            .quick-start-option{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--qs-line);border-radius:10px;background:var(--qs-bg);color:var(--qs-ink);font-size:12px;line-height:1.6;cursor:pointer}
            .quick-start-option:has(input:checked){border-color:var(--qs-muted);background:var(--qs-panel)}
            .quick-start-option input{flex-shrink:0;width:16px;height:16px;margin:2px 0 0;accent-color:var(--qs-button);color-scheme:inherit}
            .quick-start-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
            .quick-start-actions button{min-height:40px;padding:9px 16px;border-radius:9px;font-family:inherit;font-size:12px;font-weight:600;line-height:1.5;cursor:pointer}
            .quick-start-skip{border:1px solid var(--qs-line);background:var(--qs-bg);color:var(--qs-ink)}
            .quick-start-import{border:1px solid var(--qs-button);background:var(--qs-button);color:var(--qs-button-ink)}
            .quick-start-actions button:hover{filter:brightness(.92)}
            .quick-start-card :focus-visible{outline:2px solid var(--qs-muted);outline-offset:3px}
            .quick-start-actions button:disabled{opacity:.55;cursor:wait}
            .quick-start-result{min-height:18px;margin-top:10px;color:var(--qs-muted);font-size:12px;line-height:1.5;text-align:right}
            .quick-start-result.error{color:var(--qs-ink);font-weight:600}
            @media(max-width:650px){
                .quick-start-overlay{padding:12px}
                .quick-start-card{max-height:calc(100dvh - 24px);border-radius:14px}
                .quick-start-head,.quick-start-body{padding-left:18px;padding-right:18px}
                .quick-start-card .deps-grid,.quick-start-options{grid-template-columns:1fr}
                .quick-start-actions{flex-direction:column-reverse}
                .quick-start-actions button{width:100%}
            }
        `;
        document.head.appendChild(style);
    }

    function openModal(status) {
        if (document.getElementById(MODAL_ID)) return;
        addStyles();
        const t = strings();
        const build = (status && status.build) || {};
        const versionStr = build.version || (status && status.bundle && status.bundle.version) || '1.0.304';
        const builtAtStr = formatDateTime(build.builtAt || (status && status.bundle && status.bundle.generatedAt));
        const runtimeStr = [
            build.electronVersion ? `Electron ${build.electronVersion}` : '',
            build.nodeVersion ? `Node.js ${build.nodeVersion}` : '',
            build.platformLabel || (build.isPortable ? 'Windows 便携版' : 'Desktop')
        ].filter(Boolean).join(' · ') || 'Node.js · Local Runtime';

        const dependencies = Array.isArray(build.dependencies) && build.dependencies.length > 0 ? build.dependencies : [
            { name: 'exceljs', version: '^4.4.0', role: 'Excel 考勤比对、清洗与多场次导出引擎' },
            { name: 'express', version: '^4.18.2', role: '本地轻量高性能 Web 服务核心' },
            { name: 'sqlite3', version: '^6.0.1', role: '嵌入式离线关系型持久化数据引擎' },
            { name: 'jszip', version: '^3.10.1', role: '多场次数据包打包与解压缩组件' },
            { name: '@tutao/oxmsg', version: '^0.2.3', role: 'Outlook .msg 邮件格式解析与提取' },
            { name: '@google/generative-ai', version: '^0.24.1', role: 'Gemini AI 智能决策与分析模块' },
            { name: 'acorn', version: '^8.17.0', role: 'JavaScript 语法沙箱解析与静态校验' },
            { name: 'cors / multer', version: '^2.8.5 / ^1.4.5', role: '跨域安全与多媒体文件上传中间件' }
        ];

        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'quick-start-overlay';
        modal.innerHTML = `
            <section class="quick-start-card" role="dialog" aria-modal="true" aria-labelledby="quickStartTitle">
                <header class="quick-start-head">
                    <div class="quick-start-eyebrow">${t.eyebrow}</div>
                    <h2 id="quickStartTitle">${t.title}</h2>
                    <p>${t.intro}</p>
                </header>
                <div class="quick-start-body">
                    <div class="quick-start-meta-banner">
                        <div class="meta-item">
                            <span class="meta-lbl">${t.versionLabel}</span>
                            <span class="meta-val highlight">v${versionStr}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-lbl">${t.buildTimeLabel}</span>
                            <span class="meta-val">${builtAtStr}</span>
                        </div>
                        <div class="meta-item full">
                            <span class="meta-lbl">${t.runtimeLabel}</span>
                            <span class="meta-val mono">${runtimeStr}</span>
                        </div>
                    </div>

                    <details class="quick-start-deps-section">
                        <summary class="deps-heading">${t.depsTitle}</summary>
                        <div class="deps-grid">
                            ${dependencies.map(dep => `
                                <div class="dep-pill">
                                    <div class="dep-top">
                                        <span class="dep-name">${dep.name}</span>
                                        <span class="dep-ver">${dep.version}</span>
                                    </div>
                                    <div class="dep-role">${dep.role}</div>
                                </div>
                            `).join('')}
                        </div>
                    </details>

                    <div class="quick-start-safe-strip">
                        <span class="safe-text">${t.safeNotice}</span>
                    </div>

                    <div class="quick-start-select-title">${t.selectHint}</div>
                    <div class="quick-start-options">
                        <label class="quick-start-option"><input type="checkbox" data-quick-start="scripts" checked><span>${t.scriptsOption}</span></label>
                        <label class="quick-start-option"><input type="checkbox" data-quick-start="rules" checked><span>${t.rulesOption}</span></label>
                    </div>
                    <div class="quick-start-actions">
                        <button type="button" class="quick-start-skip">${t.skip}</button>
                        <button type="button" class="quick-start-import">${t.import}</button>
                    </div>
                    <div class="quick-start-result" aria-live="polite"></div>
                </div>
            </section>`;
        const previousFocus = document.activeElement;
        document.body.appendChild(modal);
        modal.querySelector('input').focus({ preventScroll: true });
        modal.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const focusable = [...modal.querySelectorAll('summary, input, button:not(:disabled)')];
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        const buttons = [...modal.querySelectorAll('button')];
        const result = modal.querySelector('.quick-start-result');
        const setBusy = busy => buttons.forEach(button => { button.disabled = busy; });
        const showResult = (message, error = false) => {
            result.textContent = message;
            result.classList.toggle('error', error);
        };

        modal.querySelector('.quick-start-import').addEventListener('click', async () => {
            const importScripts = modal.querySelector('[data-quick-start="scripts"]').checked;
            const importMetricRules = modal.querySelector('[data-quick-start="rules"]').checked;
            if (!importScripts && !importMetricRules) return showResult(t.chooseOne, true);
            setBusy(true);
            showResult(t.importing);
            try {
                await API.post('/api/onboarding/defaults/decision', { action: 'import', importScripts, importMetricRules });
                showResult(t.success);
                setTimeout(() => window.location.reload(), 850);
            } catch (error) {
                showResult(`${t.failed}${error.message || ''}`, true);
                setBusy(false);
            }
        });

        modal.querySelector('.quick-start-skip').addEventListener('click', async () => {
            setBusy(true);
            showResult(t.skipping);
            try {
                await API.post('/api/onboarding/defaults/decision', { action: 'skip' });
                showResult(t.skipped);
                setTimeout(() => {
                    modal.remove();
                    if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
                    if (typeof window.checkBuiltinToolsSync === 'function') window.checkBuiltinToolsSync();
                }, 650);
            } catch (error) {
                showResult(`${t.failed}${error.message || ''}`, true);
                setBusy(false);
            }
        });
    }

    let checking = false;
    let retryCount = 0;
    async function check() {
        if (checking || document.getElementById(MODAL_ID)) return;
        checking = true;
        try {
            // The authenticated server role is authoritative; local role sync may still be pending.
            const status = await API.get('/api/onboarding/defaults/status');
            if (status && status.required) openModal(status);
        } catch (error) {
            console.warn('[quick-start] 读取首次启动状态失败：', error.message);
            if (error.status !== 401 && error.status !== 403 && retryCount < 2) {
                setTimeout(check, 1000 * ++retryCount);
            }
        } finally {
            checking = false;
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(check, 450), { once: true });
    else setTimeout(check, 450);
})();
