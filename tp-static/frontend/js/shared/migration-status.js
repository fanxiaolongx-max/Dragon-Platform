(function () {
    const STORAGE_KEY_PREFIX = 'tools_migration_report_seen_';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function shouldShow(report) {
        if (!report || report.status === 'not-run') return false;
        if (!report.hasLegacyJson && !report.migratedCount && !report.failedCount) return false;
        const key = STORAGE_KEY_PREFIX + (report.startedAt || 'unknown');
        return localStorage.getItem(key) !== '1';
    }

    function markSeen(report) {
        const key = STORAGE_KEY_PREFIX + (report.startedAt || 'unknown');
        localStorage.setItem(key, '1');
    }

    function statusClass(status) {
        if (status === 'success') return 'ok';
        if (status === 'failed') return 'bad';
        return 'skip';
    }

    function statusText(status) {
        if (status === 'success') return '成功';
        if (status === 'failed') return '失败';
        return '跳过';
    }

    function renderSample(sample) {
        if (sample === null || sample === undefined) return '<span class="migration-muted">无旧文件内容</span>';
        return `<pre class="migration-sample">${escapeHtml(JSON.stringify(sample, null, 2))}</pre>`;
    }

    function injectStyles() {
        if (document.getElementById('migrationStatusStyles')) return;
        const style = document.createElement('style');
        style.id = 'migrationStatusStyles';
        style.textContent = `
            .migration-overlay {
                position: fixed;
                inset: 0;
                z-index: 20000;
                background: rgba(2, 6, 23, 0.72);
                backdrop-filter: blur(12px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                box-sizing: border-box;
            }
            .migration-modal {
                width: min(1120px, 100%);
                max-height: min(84vh, 820px);
                overflow: hidden;
                background: #0f172a;
                border: 1px solid rgba(148, 163, 184, 0.35);
                box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
                border-radius: 8px;
                color: #e2e8f0;
                display: flex;
                flex-direction: column;
            }
            .migration-head {
                padding: 18px 20px;
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
                display: flex;
                justify-content: space-between;
                gap: 16px;
                align-items: flex-start;
            }
            .migration-title {
                margin: 0 0 6px;
                font-size: 18px;
                font-weight: 800;
            }
            .migration-subtitle {
                color: #94a3b8;
                font-size: 12px;
                line-height: 1.6;
            }
            .migration-close {
                border: 1px solid rgba(148, 163, 184, 0.35);
                background: rgba(15, 23, 42, 0.9);
                color: #e2e8f0;
                border-radius: 8px;
                height: 34px;
                min-width: 72px;
                cursor: pointer;
                font-weight: 700;
            }
            .migration-body {
                overflow: auto;
                padding: 16px 20px 20px;
            }
            .migration-summary {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 10px;
                margin-bottom: 14px;
            }
            .migration-card {
                border: 1px solid rgba(148, 163, 184, 0.18);
                background: rgba(15, 23, 42, 0.72);
                border-radius: 8px;
                padding: 10px 12px;
            }
            .migration-label {
                color: #94a3b8;
                font-size: 11px;
                margin-bottom: 4px;
            }
            .migration-value {
                font-size: 20px;
                font-weight: 800;
            }
            .migration-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
            }
            .migration-table th,
            .migration-table td {
                border-bottom: 1px solid rgba(148, 163, 184, 0.14);
                padding: 10px 8px;
                text-align: left;
                vertical-align: top;
            }
            .migration-table th {
                position: sticky;
                top: 0;
                background: #111c31;
                color: #cbd5e1;
                z-index: 1;
            }
            .migration-pill {
                display: inline-flex;
                align-items: center;
                border-radius: 999px;
                padding: 3px 8px;
                font-weight: 800;
                font-size: 11px;
            }
            .migration-pill.ok { background: rgba(34, 197, 94, 0.14); color: #86efac; }
            .migration-pill.bad { background: rgba(239, 68, 68, 0.16); color: #fca5a5; }
            .migration-pill.skip { background: rgba(148, 163, 184, 0.16); color: #cbd5e1; }
            .migration-muted { color: #94a3b8; }
            .migration-sample {
                max-width: 360px;
                max-height: 140px;
                overflow: auto;
                margin: 0;
                padding: 8px;
                border-radius: 6px;
                background: rgba(2, 6, 23, 0.58);
                color: #dbeafe;
                font-size: 11px;
                line-height: 1.5;
                white-space: pre-wrap;
            }
            @media (max-width: 760px) {
                .migration-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .migration-table { min-width: 860px; }
            }
        `;
        document.head.appendChild(style);
    }

    function showReport(report) {
        injectStyles();
        const overlay = document.createElement('div');
        overlay.className = 'migration-overlay';
        overlay.innerHTML = `
            <div class="migration-modal" role="dialog" aria-modal="true" aria-label="旧数据自动迁移结果">
                <div class="migration-head">
                    <div>
                        <h2 class="migration-title">旧 JSON 自动迁移结果</h2>
                        <div class="migration-subtitle">
                            启动时间：${escapeHtml(report.startedAt || '-')} · 完成时间：${escapeHtml(report.finishedAt || '-')}<br>
                            内容预览已脱敏，密码哈希、Token、API Key 不会明文显示。
                        </div>
                    </div>
                    <button type="button" class="migration-close">关闭</button>
                </div>
                <div class="migration-body">
                    <div class="migration-summary">
                        <div class="migration-card"><div class="migration-label">总状态</div><div class="migration-value">${escapeHtml(statusText(report.status))}</div></div>
                        <div class="migration-card"><div class="migration-label">成功迁移</div><div class="migration-value">${Number(report.migratedCount || 0)}</div></div>
                        <div class="migration-card"><div class="migration-label">失败</div><div class="migration-value">${Number(report.failedCount || 0)}</div></div>
                        <div class="migration-card"><div class="migration-label">跳过</div><div class="migration-value">${Number(report.skippedCount || 0)}</div></div>
                    </div>
                    <table class="migration-table">
                        <thead>
                            <tr>
                                <th>状态</th>
                                <th>数据项</th>
                                <th>旧 JSON</th>
                                <th>目标表/KV</th>
                                <th>数量</th>
                                <th>说明</th>
                                <th>内容预览</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(report.steps || []).map(step => `
                                <tr>
                                    <td><span class="migration-pill ${statusClass(step.status)}">${escapeHtml(step.statusLabel || statusText(step.status))}</span></td>
                                    <td>${escapeHtml(step.label || step.key)}</td>
                                    <td>${escapeHtml(step.sourceFile || '-')}<br><span class="migration-muted">${step.legacyPresent ? '已发现' : '不存在'}</span></td>
                                    <td>${escapeHtml(step.target || '-')}</td>
                                    <td>JSON: ${step.sourceCount ?? '-'}<br>迁移前: ${step.beforeCount ?? '-'}<br>迁移后: ${step.afterCount ?? '-'}</td>
                                    <td>${escapeHtml(step.message || '')}</td>
                                    <td>${renderSample(step.sample)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = () => {
            markSeen(report);
            overlay.remove();
        };
        overlay.querySelector('.migration-close').addEventListener('click', close);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
    }

    async function checkMigrationStatus() {
        try {
            const res = await fetch('/api/migration-status', { cache: 'no-store' });
            if (!res.ok) return;
            const report = await res.json();
            if (shouldShow(report)) showReport(report);
        } catch (err) {
            console.warn('[migration-status] failed:', err.message);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkMigrationStatus);
    } else {
        checkMigrationStatus();
    }
})();
