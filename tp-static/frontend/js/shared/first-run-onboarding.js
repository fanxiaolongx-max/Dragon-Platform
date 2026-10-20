/**
 * First-run quick-start prompt shared by source, installed and portable builds.
 * The decision is stored by the backend in its active data directory, so it is
 * independent of browser cache and Electron packaging mode.
 */
(function initFirstRunOnboardingModule() {
    const MODAL_ID = 'defaultQuickStartModal';
    const README_URL = 'https://github.com/fanxiaolongx-max/privacy-policy#默认快速上手包';

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
            eyebrow: 'SYSTEM READY · BUILD & DEPENDENCIES',
            title: 'Tools Platform Workspace Ready',
            intro: 'Local workspace initialized. Current build version, runtime environment, and built-in third-party dependencies are detailed below. You can optionally import baseline defaults.',
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
            skipped: 'Preferences saved. Entering workspace with clean configuration.',
            chooseOne: 'Select at least one baseline item to import, or click "Do Not Import".',
            failed: 'Setup failed: '
        } : {
            eyebrow: '环境就绪 · 构建与依赖信息',
            title: 'Tools Platform 本地工作区已就绪',
            intro: '本地服务已成功启动。以下为本次代码构建的版本详细信息、运行环境及内置第三方依赖，您可按需选择是否导入开箱即用的默认规则库。',
            versionLabel: '构建版本',
            buildTimeLabel: '构建时间',
            runtimeLabel: '运行环境',
            depsTitle: '内置核心组件与三方依赖',
            safeNotice: '安全保障：导入仅补充缺失项，同名脚本和同标识规则保留本地版本，操作前会自动生成安全快照备份。',
            selectHint: '可选初始化基础包：',
            scriptsOption: '默认智能调度脚本仓库 (14个生产脚本)',
            rulesOption: '全量指标与考勤基线规则 (含目标/权重/分组)',
            import: '导入选中的默认内容',
            skip: '不导入，直接使用',
            importing: '正在备份现有配置并导入…',
            skipping: '正在保存选择…',
            success: '默认内容已导入，正在重新加载工作区…',
            skipped: '已保存选择，以纯净环境进入工作空间。',
            chooseOne: '请至少选择一项需要导入的内容，或直接点击“不导入”。',
            failed: '首次启动选择保存失败：'
        };
    }

    function addStyles() {
        if (document.getElementById('defaultQuickStartStyles')) return;
        const style = document.createElement('style');
        style.id = 'defaultQuickStartStyles';
        style.textContent = `
            .quick-start-overlay{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:24px;background:rgba(2,6,23,.82);backdrop-filter:blur(14px)}
            .quick-start-card{width:min(780px,100%);max-height:calc(100vh - 48px);overflow-y:auto;border:1px solid rgba(125,211,252,.28);border-radius:24px;background:linear-gradient(145deg,#0f172a 0%,#111827 58%,#172554 100%);color:#e2e8f0;box-shadow:0 32px 100px rgba(0,0,0,.58);font-family:Inter,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
            .quick-start-head{padding:26px 30px 18px;border-bottom:1px solid rgba(148,163,184,.14)}
            .quick-start-eyebrow{color:#67e8f9;font-size:11px;font-weight:900;letter-spacing:.18em}
            .quick-start-head h2{margin:8px 0 8px;color:#fff;font-size:24px;font-weight:760;line-height:1.2}
            .quick-start-head p{margin:0;color:#94a3b8;font-size:12px;line-height:1.6}
            .quick-start-body{padding:20px 30px 26px}
            .quick-start-meta-banner{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:12px 16px;border:1px solid rgba(56,189,248,.2);border-radius:14px;background:rgba(15,23,42,.7);margin-bottom:16px}
            .meta-item{display:flex;flex-direction:column;gap:3px}
            .meta-item.full{grid-column:1/-1}
            .meta-lbl{color:#64748b;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
            .meta-val{color:#f1f5f9;font-size:12px;font-weight:600}
            .meta-val.highlight{color:#38bdf8;font-weight:800;font-size:13px}
            .meta-val.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:#94a3b8}
            .quick-start-deps-section{margin-bottom:16px}
            .deps-heading{margin-bottom:8px;color:#94a3b8;font-size:11px;font-weight:800;letter-spacing:.05em}
            .deps-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
            .dep-pill{padding:9px 12px;border:1px solid rgba(148,163,184,.14);border-radius:10px;background:rgba(15,23,42,.55);transition:border-color .18s ease}
            .dep-pill:hover{border-color:rgba(56,189,248,.35)}
            .dep-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px}
            .dep-name{color:#e2e8f0;font-size:11px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
            .dep-ver{color:#38bdf8;font-size:10px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:rgba(56,189,248,.12);padding:1px 6px;border-radius:999px;border:1px solid rgba(56,189,248,.22)}
            .dep-role{color:#94a3b8;font-size:10px;line-height:1.4}
            .quick-start-safe-strip{display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border:1px solid rgba(52,211,153,.2);border-radius:10px;background:rgba(6,78,59,.18);color:#a7f3d0;font-size:11px;line-height:1.5;margin-bottom:16px}
            .safe-icon{flex-shrink:0;font-size:13px}
            .quick-start-select-title{margin-bottom:8px;color:#cbd5e1;font-size:11px;font-weight:800}
            .quick-start-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}
            .quick-start-option{display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid rgba(56,189,248,.24);border-radius:11px;background:rgba(14,116,144,.1);color:#e0f2fe;font-size:12px;font-weight:700;cursor:pointer}
            .quick-start-option input{width:16px;height:16px;accent-color:#06b6d4}
            .quick-start-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
            .quick-start-actions button{min-height:38px;padding:0 16px;border-radius:10px;font-size:12px;font-weight:800;cursor:pointer}
            .quick-start-skip{border:1px solid rgba(148,163,184,.28);background:transparent;color:#cbd5e1}
            .quick-start-import{border:0;background:linear-gradient(135deg,#0891b2,#2563eb);color:#fff;box-shadow:0 10px 24px rgba(37,99,235,.28)}
            .quick-start-actions button:disabled{opacity:.55;cursor:wait}
            .quick-start-result{min-height:18px;margin-top:10px;color:#a5f3fc;font-size:11px;text-align:right}
            .quick-start-result.error{color:#fda4af}
            @media(max-width:650px){
                .quick-start-overlay{padding:12px}
                .quick-start-head,.quick-start-body{padding-left:16px;padding-right:16px}
                .deps-grid,.quick-start-options{grid-template-columns:1fr}
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

                    <div class="quick-start-deps-section">
                        <div class="deps-heading">${t.depsTitle}</div>
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
                    </div>

                    <div class="quick-start-safe-strip">
                        <span class="safe-icon">🛡️</span>
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
        document.body.appendChild(modal);

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
                    if (typeof window.checkBuiltinToolsSync === 'function') window.checkBuiltinToolsSync();
                }, 650);
            } catch (error) {
                showResult(`${t.failed}${error.message || ''}`, true);
                setBusy(false);
            }
        });
    }

    async function check() {
        if (localStorage.getItem('tools_role') !== 'admin' || typeof API === 'undefined') return;
        try {
            const status = await API.get('/api/onboarding/defaults/status');
            if (status && status.required) openModal(status);
        } catch (error) {
            console.warn('[quick-start] 读取首次启动状态失败：', error.message);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(check, 450), { once: true });
    else setTimeout(check, 450);
})();
