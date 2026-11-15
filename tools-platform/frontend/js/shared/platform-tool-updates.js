// Shared platform capability: platform-tool-updates. See docs/frontend-architecture.md.
let builtinToolsSyncChecking = false;
let builtinToolsCompareAbort = null;
const BUILTIN_TOOLS_SYNC_SNOOZE_KEY = 'builtin_tools_sync_snooze_date_v1';

function getBuiltinToolsSyncLocalDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isBuiltinToolsSyncSnoozedToday() {
    try {
        return localStorage.getItem(BUILTIN_TOOLS_SYNC_SNOOZE_KEY) === getBuiltinToolsSyncLocalDate();
    } catch (_) {
        return false;
    }
}

function snoozeBuiltinToolsSyncForToday() {
    try {
        localStorage.setItem(BUILTIN_TOOLS_SYNC_SNOOZE_KEY, getBuiltinToolsSyncLocalDate());
    } catch (_) { /* 隐私模式或存储受限时仍允许关闭当前弹窗 */ }
}

function formatBuiltinToolBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function builtinToolStatusMeta(status) {
    return {
        missing: { label: navLocaleText('新增系统工具', 'New System Tool'), tone: 'new' },
        adopt: { label: navLocaleText('接管同版工具', 'Adopt Identical Version'), tone: 'adopt' },
        update: { label: navLocaleText('内容有差异', 'Content Differs'), tone: 'update' },
        conflict: { label: navLocaleText('同名工具冲突', 'Name Conflict'), tone: 'conflict' }
    }[status] || { label: navLocaleText('存在差异', 'Has Differences'), tone: 'update' };
}

function builtinToolChangeLabel(type) {
    return {
        added: navLocaleText('新增', 'Added'),
        modified: navLocaleText('修改', 'Modified'),
        removed: navLocaleText('删除', 'Deleted'),
        preserved: navLocaleText('保留', 'Preserved'),
        unchanged: navLocaleText('未变', 'Unchanged')
    }[type] || type;
}

function renderBuiltinToolDiff(tool) {
    const visibleChanges = (tool.changes || []).filter(item => item.type !== 'unchanged');
    const unchangedCount = tool.counts && tool.counts.unchanged || 0;
    const metadataRow = tool.metadataChanged
        ? `<div class="builtin-sync-file-row is-metadata">
            <span class="builtin-sync-change is-modified">${navEscape(navLocaleText('版本', 'Version'))}</span>
            <code title="${navEscape(navLocaleText('系统工具版本标识', 'System tool version metadata'))}">${navEscape(navLocaleText('系统工具版本标识', 'System tool version metadata'))}</code>
            <span class="builtin-sync-file-size">${navEscape(navLocaleText('需要同步', 'Sync required'))}</span>
        </div>`
        : '';
    if (!visibleChanges.length && !unchangedCount && !metadataRow) {
        return `<div class="builtin-sync-empty-diff">${navEscape(navLocaleText('仅更新系统工具标识，不改动工具文件。', 'Only updates tool metadata; tool files are unchanged.'))}</div>`;
    }
    const rows = visibleChanges.map(item => `
        <div class="builtin-sync-file-row">
            <span class="builtin-sync-change is-${navEscape(item.type)}">${navEscape(builtinToolChangeLabel(item.type))}</span>
            <code title="${navEscape(item.path)}">${navEscape(item.path)}</code>
            <span class="builtin-sync-file-size">${formatBuiltinToolBytes(item.oldSize)} → ${formatBuiltinToolBytes(item.newSize)}</span>
        </div>
    `).join('');
    const unchanged = unchangedCount
        ? `<div class="builtin-sync-unchanged">${navEscape(navLocaleText(`${unchangedCount} 个相同文件不会重复说明`, `${unchangedCount} identical file(s) omitted`))}</div>`
        : '';
    return rows + metadataRow + unchanged;
}

function closeBuiltinToolsSyncModal() {
    const modal = document.getElementById('builtinToolsSyncModal');
    if (modal?.dataset.applying === '1') return;
    if (builtinToolsCompareAbort) {
        try { builtinToolsCompareAbort.abort(); } catch (_) {}
        builtinToolsCompareAbort = null;
    }
    builtinToolsSyncChecking = false;
    if (modal) modal.remove();
}

async function fetchBuiltinToolsPreviewWithProgress(onProgress, signal) {
    try {
        const response = await fetch('/api/custom-tools/builtin-sync/preview-stream?manual=1', {
            headers: { ...getAuthHeaderForNav() },
            signal
        });
        if (response.ok && response.body?.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let result = null;
            const consume = line => {
                if (!line.trim()) return;
                const event = JSON.parse(line);
                if (event.type === 'progress') onProgress(event);
                else if (event.type === 'result') result = event.data;
                else if (event.type === 'error') throw new Error(event.error);
            };
            while (true) {
                const { done, value } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                let newline;
                while ((newline = buffer.indexOf('\n')) !== -1) {
                    consume(buffer.slice(0, newline));
                    buffer = buffer.slice(newline + 1);
                }
                if (done) break;
            }
            consume(buffer);
            if (result) return result;
        }
    } catch (err) {
        if (signal?.aborted) throw err;
        // 降级为普通请求
    }
    return await API.get('/api/custom-tools/builtin-sync/preview?manual=1');
}

function renderBuiltinToolsCompareProgress(modal, event) {
    if (!modal || modal.dataset.loading !== '1') return;
    const total = Math.max(1, Number(event.total) || 1);
    const current = Math.min(total, Math.max(0, Number(event.current) || 0));
    const percent = Math.round((current / total) * 100);
    const titleEl = modal.querySelector('.builtin-sync-loading-title');
    const percentEl = modal.querySelector('.builtin-sync-loading-percent');
    const barEl = modal.querySelector('.builtin-sync-loading-bar');
    const barFill = modal.querySelector('.builtin-sync-loading-bar i');
    const detailEl = modal.querySelector('.builtin-sync-loading-detail');
    const resultEl = modal.querySelector('.builtin-sync-result');
    if (titleEl) {
        titleEl.textContent = navLocaleText(
            `正在比对系统内置工具 · ${current}/${total}`,
            `Comparing bundled tools · ${current}/${total}`
        );
    }
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (barEl) barEl.setAttribute('aria-valuenow', String(percent));
    if (barFill) barFill.style.transform = `scaleX(${current / total})`;
    const toolText = event.name || event.slug ? `${event.name || event.slug}${event.slug && event.name !== event.slug ? ` (${event.slug})` : ''}` : '';
    if (detailEl) {
        detailEl.textContent = toolText ? navLocaleText(`正在检查：${toolText}`, `Checking: ${toolText}`) : navLocaleText('正在检索文件指纹与修改…', 'Scanning fingerprints and changes…');
    }
    if (resultEl && toolText) {
        resultEl.textContent = navLocaleText(`比对进度 (${current}/${total})：${toolText}`, `Progress (${current}/${total}): ${toolText}`);
    }
}

function renderBuiltinToolsCompareError(modal, error, onRetry) {
    if (!modal) return;
    modal.dataset.loading = '0';
    const list = modal.querySelector('.builtin-sync-list');
    if (list) {
        list.innerHTML = `
            <div class="builtin-sync-error-card">
                <strong>⚠️ ${navEscape(navLocaleText('读取内置工具比对失败', 'Failed to Compare Bundled Tools'))}</strong>
                <p>${navEscape(error?.message || navLocaleText('网络连接超时或服务未就绪，请重试。', 'Connection timed out or service unavailable. Please retry.'))}</p>
                <div><button type="button" class="builtin-sync-retry">${navEscape(navLocaleText('重新比对', 'Retry Comparison'))}</button></div>
            </div>
        `;
        list.querySelector('.builtin-sync-retry')?.addEventListener('click', () => {
            if (typeof onRetry === 'function') onRetry();
        });
    }
    const resultEl = modal.querySelector('.builtin-sync-result');
    if (resultEl) resultEl.textContent = navLocaleText('比对失败，请重试。', 'Comparison failed. Please retry.');
}

async function applyBuiltinToolsWithProgress(body, onProgress) {
    const response = await fetch('/api/custom-tools/builtin-sync/apply-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        if (typeof handleResponse === 'function') return handleResponse(response);
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    if (!response.body?.getReader) throw new Error(navLocaleText('当前浏览器不支持更新进度，请重新检查更新状态。', 'This browser cannot display update progress. Please check update status again.'));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result;
    const consume = line => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === 'progress') onProgress(event);
        else if (event.type === 'result') result = event.data;
        else if (event.type === 'error') throw new Error(event.error);
    };
    try {
        while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let newline;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                consume(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1);
            }
            if (done) break;
        }
        consume(buffer);
        if (!result) throw new Error(navLocaleText('更新连接中断，服务端可能仍在处理，请稍后重新检查。', 'The connection ended. The server may still be updating; check again shortly.'));
        return result;
    } finally {
        reader.releaseLock();
    }
}

function renderBuiltinToolsSyncProgress(modal, event) {
    const previous = modal.syncProgress || {};
    const progress = { ...previous, ...event };
    const total = Math.max(1, Number(progress.total) || 0);
    const completed = Number(progress.completed) || 0;
    const fileFraction = progress.stage === 'copying' && progress.filesTotal
        ? progress.filesCompleted / progress.filesTotal : 0;
    const percent = progress.stage === 'done' ? 100
        : progress.stage === 'indexing' ? 96
            : progress.stage === 'saving' ? 92
                : progress.stage === 'validating' ? 10 * (progress.checked || 0) / total
                    : 10 + 80 * (completed + fileFraction) / total;
    // Phase weights describe overall progress; advance only on actual worker events.
    progress.percent = Math.min(100, Math.max(previous.percent || 0, Math.round(percent)));
    modal.syncProgress = progress;
    const labels = {
        validating: navLocaleText(`正在校验版本 · ${progress.checked || 0}/${progress.total || 0}`, `Checking versions · ${progress.checked || 0}/${progress.total || 0}`),
        backing_up: navLocaleText('正在备份旧版与保留用户文件', 'Backing up old version and preserving user files'),
        copying: navLocaleText(`正在复制程序文件 · ${progress.filesCompleted || 0}/${progress.filesTotal || 0}`, `Copying application files · ${progress.filesCompleted || 0}/${progress.filesTotal || 0}`),
        tool_complete: navLocaleText(`已处理 ${completed}/${progress.total || 0} 个工具`, `Processed ${completed}/${progress.total || 0} tools`),
        saving: navLocaleText('正在保存处理结果', 'Saving update results'),
        indexing: navLocaleText('正在刷新工具索引', 'Refreshing tool index'),
        done: navLocaleText('处理完成', 'Complete')
    };
    const panel = modal.querySelector('.builtin-sync-progress');
    panel.hidden = false;
    panel.querySelector('.builtin-sync-progress-label').textContent = labels[progress.stage] || labels.validating;
    panel.querySelector('.builtin-sync-progress-percent').textContent = `${progress.percent}%`;
    const bar = panel.querySelector('[role="progressbar"]');
    bar.setAttribute('aria-valuenow', String(progress.percent));
    bar.setAttribute('aria-label', navLocaleText('系统工具更新进度', 'System tool update progress'));
    bar.querySelector('i').style.transform = `scaleX(${progress.percent / 100})`;
    const tool = lastBuiltinToolsSyncPreview?.pending?.find(item => item.slug === progress.slug);
    const toolPosition = ['backing_up', 'copying'].includes(progress.stage)
        ? navLocaleText(`第 ${completed + 1}/${progress.total} 个`, `Tool ${completed + 1}/${progress.total}`) : '';
    panel.querySelector('.builtin-sync-progress-detail').textContent = progress.slug && !['saving', 'indexing', 'done'].includes(progress.stage)
        ? [tool?.name || progress.slug, toolPosition, progress.slug].filter(Boolean).join(' · ')
        : navLocaleText('请保持页面打开，完成后将自动刷新。', 'Keep this page open. It will refresh when the update finishes.');
}

function openBuiltinToolsSyncModal(preview, selectedSlugs) {
    if (document.getElementById('builtinToolsSyncModal')?.dataset.applying === '1') return;
    const tools = Array.isArray(preview?.pending) ? preview.pending : [];
    const manual = preview?.manual === true;
    const loading = preview?.loading === true;
    if (!tools.length && !manual && !loading) return;
    lastBuiltinToolsSyncPreview = preview;

    let modal = document.getElementById('builtinToolsSyncModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'builtinToolsSyncModal';
        modal.className = 'builtin-sync-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'builtinToolsSyncTitle');
        document.body.appendChild(modal);
    }
    delete modal.dataset.needsRefresh;
    delete modal.dataset.applying;
    modal.dataset.loading = loading ? '1' : '0';

    if (loading) {
        modal.innerHTML = `
            <div class="builtin-sync-window">
                <header class="builtin-sync-head">
                    <div>
                        <div class="builtin-sync-kicker">SYSTEM TOOLS UPDATE</div>
                        <h2 id="builtinToolsSyncTitle">${navEscape(navLocaleText('正在比对系统内置工具…', 'Comparing Bundled Tools…'))}</h2>
                        <p>${navEscape(navLocaleText('正在检索系统随包内置工具并与当前环境比对差异，请稍候…', 'Scanning bundled tools and comparing differences with in-use versions, please wait…'))}</p>
                    </div>
                    <button type="button" class="builtin-sync-close" aria-label="${navEscape(navLocaleText('稍后处理', 'Dismiss'))}">×</button>
                </header>
                <div class="builtin-sync-safe-note">
                    <span>🛡️</span>
                    <div><strong>${navEscape(navLocaleText('工具业务数据不会被覆盖', 'Tool business data will not be overwritten'))}</strong><br>${navEscape(navLocaleText('仅同步工具程序文件；用户额外文件会保留，被替换的旧目录也会备份到数据目录。', 'Only tool application files are synced. Custom user files are preserved, and replaced folders are backed up to the data directory.'))}</div>
                </div>
                <div class="builtin-sync-toolbar">
                    <span>${navEscape(navLocaleText('正在比对中…', 'Comparing...'))}</span>
                </div>
                <div class="builtin-sync-list">
                    <div class="builtin-sync-loading">
                        <div class="builtin-sync-loading-card">
                            <div class="builtin-sync-loading-head">
                                <div class="builtin-sync-spinner" aria-hidden="true"></div>
                                <div class="builtin-sync-loading-title">${navEscape(navLocaleText('正在比对系统内置工具…', 'Comparing bundled tools…'))}</div>
                                <div class="builtin-sync-loading-percent">0%</div>
                            </div>
                            <div class="builtin-sync-loading-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                                <i></i>
                            </div>
                            <div class="builtin-sync-loading-detail">${navEscape(navLocaleText('准备开始比对…', 'Preparing comparison…'))}</div>
                        </div>
                        <div class="builtin-sync-skeleton-list" aria-hidden="true">
                            <div class="builtin-sync-skeleton-card"></div>
                            <div class="builtin-sync-skeleton-card"></div>
                            <div class="builtin-sync-skeleton-card"></div>
                        </div>
                    </div>
                </div>
                <footer class="builtin-sync-footer">
                    <div class="builtin-sync-feedback">
                        <span class="builtin-sync-result" aria-live="polite">${navEscape(navLocaleText('正在比对系统内置工具与本地工具差异…', 'Comparing bundled tools with in-use versions…'))}</span>
                    </div>
                    <button type="button" class="builtin-sync-later">${navEscape(navLocaleText('关闭', 'Close'))}</button>
                    <button type="button" class="builtin-sync-today" hidden>${navEscape(navLocaleText('今天不再提醒', 'Don\'t Remind Today'))}</button>
                    <button type="button" class="builtin-sync-apply" disabled>${navEscape(navLocaleText('强制使用随包版本', 'Use Bundled Versions'))}</button>
                </footer>
            </div>
        `;
        const close = () => closeBuiltinToolsSyncModal();
        modal.querySelector('.builtin-sync-close').addEventListener('click', close);
        modal.querySelector('.builtin-sync-later').addEventListener('click', close);
        modal.addEventListener('click', event => {
            if (event.target === modal) close();
        });
        return;
    }

    const toolCards = tools.map(tool => {
        const status = builtinToolStatusMeta(tool.status);
        const counts = tool.counts || {};
        const diffCount = (counts.added || 0) + (counts.modified || 0) + (counts.removed || 0) + (counts.preserved || 0);
        const diffSummary = diffCount
            ? navLocaleText(`${diffCount} 项文件差异`, `${diffCount} file difference(s)`)
            : tool.metadataChanged
                ? navLocaleText('仅版本标识不同', 'Only version metadata differs')
                : navLocaleText('无文件差异', 'No file differences');
        const conflictNotice = tool.status === 'conflict'
            ? `<div class="builtin-sync-conflict-note">${navEscape(navLocaleText('此目录不是系统管理版本，可能是同名自定义工具，请结合版本和大小确认是否替换。', 'This directory is not system-managed and may be a custom tool with the same name. Review its release information and size before replacing.'))}</div>`
            : tool.localChanges ? `<div class="builtin-sync-conflict-note">${navEscape(navLocaleText('检测到本地修改或旧版校验信息不完整，请结合下方版本信息确认。处理前不会修改当前工具，旧目录会先备份。', 'Local changes or incomplete legacy verification data were detected. Review the release information below; applying a selection backs up the old folder first.'))}</div>` : '';
        const toolInfoDiff = tool.toolInfoChanged && tool.oldTool && tool.newTool
            ? `<div class="builtin-sync-info-diff">
                <span>${navEscape(navLocaleText('旧信息', 'Old'))}：${navEscape(tool.oldTool.icon)} ${navEscape(tool.oldTool.name)}</span>
                <span>→</span>
                <span>${navEscape(navLocaleText('新信息', 'New'))}：${navEscape(tool.newTool.icon)} ${navEscape(tool.newTool.name)}</span>
            </div>`
            : '';
        const isChecked = selectedSlugs ? selectedSlugs.has(tool.slug) : !manual && Boolean(tool.recommended);
        return `
            <article class="builtin-sync-card ${tool.status === 'conflict' ? 'is-conflict' : ''}" data-sync-slug="${navEscape(tool.slug)}">
                <label class="builtin-sync-tool-head">
                    <input type="checkbox" class="builtin-sync-choice" data-sync-slug="${navEscape(tool.slug)}" ${isChecked ? 'checked' : ''}>
                    <span class="builtin-sync-icon">${navEscape(tool.icon)}</span>
                    <span class="builtin-sync-tool-copy">
                        <strong>${navEscape(tool.name)}</strong>
                        <small>${navEscape(tool.slug)}</small>
                    </span>
                    <span class="builtin-sync-status is-${status.tone}">${navEscape(status.label)}</span>
                </label>
                ${conflictNotice}
                ${tool.recommendation ? `<div class="builtin-sync-versions">${navEscape(navLocaleText('建议依据', 'Recommendation'))}：${navEscape(({
                    'missing': navLocaleText('缺少内置工具或可接管的旧版', 'Missing tool or matching legacy version'),
                    'current-newer': navLocaleText('当前版本号或更新时间更新，建议保留', 'Current version or timestamp is newer; keep current'),
                    'custom-conflict': navLocaleText('同名自定义工具，需手动确认', 'Custom tool with the same name; review required'),
                    'market-choice': navLocaleText('保留已选择的市场版本', 'Keep the selected market release'),
                    'newer-larger': navLocaleText('内置版本更新，整体程序体积也有增加', 'Bundled release is newer and its program size increased'),
                    'newer-release': navLocaleText('内置版本号或更新时间更新', 'Bundled version or timestamp is newer'),
                    'larger-release': navLocaleText('版本信息未显示降级，内置整体程序体积增加', 'No older release metadata; bundled program size increased'),
                    'current-larger': navLocaleText('当前程序体积更大，且内置版本信息未显示更新，建议保留', 'Current program size is larger with no newer bundled metadata; keep current'),
                    'local-changes': navLocaleText('有本地修改，暂不建议覆盖', 'Local changes need review'),
                    'content-update': navLocaleText('程序内容更新', 'Program contents changed')
                })[tool.recommendation.reason] || '')}</div>` : ''}
                ${toolInfoDiff}
                ${`<div class="builtin-sync-versions">${navEscape(navLocaleText('当前来源', 'Current source'))}：${navEscape(tool.currentSource === 'market' ? navLocaleText('工具市场', 'Tool market') : navLocaleText('本地工具', 'Local tool'))} · ${navEscape(tool.currentReleaseVersion || '—')} · ${navEscape(tool.currentUpdatedAt || tool.currentVersion || '—')} → ${navEscape(navLocaleText('随包内置', 'Bundled'))} · ${navEscape(tool.bundledReleaseVersion || '—')} · ${navEscape(tool.bundledUpdatedAt || tool.bundledVersion || '—')}</div>`}
                <div class="builtin-sync-metrics">
                    <span>${navEscape(navLocaleText('当前使用', 'In use'))} <b>${formatBuiltinToolBytes(tool.currentReleaseBytes ?? tool.oldBytes)}</b></span>
                    <span class="builtin-sync-arrow">→</span>
                    <span>${navEscape(navLocaleText('随包内置', 'Bundled'))} <b>${formatBuiltinToolBytes(tool.bundledReleaseBytes ?? tool.newBytes)}</b></span>
                    <span class="builtin-sync-counts">+${counts.added || 0} / ~${counts.modified || 0} / −${counts.removed || 0} / ${navEscape(navLocaleText('保留', 'Preserved'))} ${counts.preserved || 0}</span>
                </div>
                <details class="builtin-sync-details" ${tool.status === 'conflict' ? 'open' : ''}>
                    <summary>${navEscape(navLocaleText(`查看当前与随包版本比对（${diffSummary}）`, `Compare in-use and bundled versions (${diffSummary})`))}</summary>
                    <div class="builtin-sync-file-list"></div>
                </details>
            </article>
        `;
    }).join('') || `<div class="builtin-sync-empty-diff">${navEscape(navLocaleText('当前工具与随包内置版本一致，没有需要替换的工具。', 'Installed tools match the bundled versions. No replacement is needed.'))}</div>`;

    modal.innerHTML = `
        <div class="builtin-sync-window">
            <header class="builtin-sync-head">
                <div>
                    <div class="builtin-sync-kicker">SYSTEM TOOLS UPDATE</div>
                    <h2 id="builtinToolsSyncTitle">${navEscape(manual ? navLocaleText('内置工具差异比对', 'Compare Bundled Tools') : navLocaleText('发现系统内置工具差异', 'Built-in System Tools Updates Available'))}</h2>
                    <p>${navEscape(manual ? navLocaleText('按需选择工具，强制使用当前主程序随包版本（可能是旧版）。未选择的工具保持不变。', 'Select tools to replace with this app’s bundled versions, which may be older. Unselected tools remain unchanged.') : navLocaleText('请选择要覆盖或安装的工具。未勾选项会保留现状，并在该内置版本不变时不再提醒。', 'Select tools to update or install. Unselected tools will remain as-is and won\'t prompt again unless updated.'))}</p>
                </div>
                <button type="button" class="builtin-sync-close" aria-label="${navEscape(navLocaleText('稍后处理', 'Dismiss'))}">×</button>
            </header>
            <div class="builtin-sync-safe-note">
                <span>🛡️</span>
                <div><strong>${navEscape(navLocaleText('工具业务数据不会被覆盖', 'Tool business data will not be overwritten'))}</strong><br>${navEscape(navLocaleText('仅同步工具程序文件；用户额外文件会保留，被替换的旧目录也会备份到数据目录。', 'Only tool application files are synced. Custom user files are preserved, and replaced folders are backed up to the data directory.'))}</div>
            </div>
            <div class="builtin-sync-toolbar">
                <span>${navEscape(navLocaleText(`共 ${tools.length} 个待处理工具`, `${tools.length} pending tool(s)`))}</span>
                <button type="button" data-sync-select="recommended">${navEscape(navLocaleText('选择建议项', 'Select Recommended'))}</button>
                <button type="button" data-sync-select="none">${navEscape(navLocaleText('全部取消', 'Deselect All'))}</button>
            </div>
            <div class="builtin-sync-list">${toolCards}</div>
            <footer class="builtin-sync-footer">
                <div class="builtin-sync-feedback">
                <div class="builtin-sync-progress" hidden>
                    <div class="builtin-sync-progress-head"><strong class="builtin-sync-progress-label" aria-live="polite"></strong><span class="builtin-sync-progress-percent">0%</span></div>
                    <div class="builtin-sync-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
                    <div class="builtin-sync-progress-detail"></div>
                </div>
                <span class="builtin-sync-result" aria-live="polite">${navEscape(manual ? navLocaleText('默认不选；强制替换前会备份当前目录，业务数据库与用户额外文件保留。', 'Nothing is selected by default. Current folders are backed up before replacement; business databases and extra user files are preserved.') : navLocaleText('冲突项默认保留旧版，您仍可手动勾选覆盖。', 'Conflicts keep old version by default. You can manually select to overwrite.'))}</span>
                </div>
                <button type="button" class="builtin-sync-later">${navEscape(manual ? navLocaleText('关闭', 'Close') : navLocaleText('稍后提醒', 'Remind Later'))}</button>
                <button type="button" class="builtin-sync-today" ${manual ? 'hidden' : ''}>${navEscape(navLocaleText('今天不再提醒', 'Don\'t Remind Today'))}</button>
                <button type="button" class="builtin-sync-apply" ${!tools.length ? 'disabled' : ''}>${navEscape(manual ? navLocaleText('强制使用随包版本', 'Use Bundled Versions') : navLocaleText('按选择处理', 'Apply Selected'))}</button>
            </footer>
        </div>
    `;
    document.body.appendChild(modal);

    // Collapsed comparisons can contain thousands of files; create rows on demand.
    modal.querySelectorAll('.builtin-sync-details').forEach((details, index) => {
        const renderDiff = () => {
            if (!details.open || details.dataset.loaded) return;
            details.dataset.loaded = '1';
            details.querySelector('.builtin-sync-file-list').innerHTML = renderBuiltinToolDiff(tools[index]);
        };
        details.addEventListener('toggle', renderDiff);
        renderDiff();
    });

    const close = () => closeBuiltinToolsSyncModal();
    modal.querySelector('.builtin-sync-close').addEventListener('click', close);
    modal.querySelector('.builtin-sync-later').addEventListener('click', close);
    modal.querySelector('.builtin-sync-today').addEventListener('click', () => {
        snoozeBuiltinToolsSyncForToday();
        close();
    });
    modal.addEventListener('click', event => {
        if (event.target === modal) close();
    });
    modal.querySelector('[data-sync-select="recommended"]').addEventListener('click', () => {
        modal.querySelectorAll('.builtin-sync-choice').forEach((input, index) => {
            input.checked = Boolean(tools[index] && tools[index].recommended);
        });
    });
    modal.querySelector('[data-sync-select="none"]').addEventListener('click', () => {
        modal.querySelectorAll('.builtin-sync-choice').forEach(input => {
            input.checked = false;
        });
    });
    modal.querySelector('.builtin-sync-apply').addEventListener('click', async event => {
        const button = event.currentTarget;
        const resultNode = modal.querySelector('.builtin-sync-result');
        if (modal.dataset.applying === '1') return;
        if (modal.dataset.needsRefresh === '1') {
            button.disabled = true;
            try {
                const refreshed = await API.get(manual ? '/api/custom-tools/builtin-sync/preview?manual=1' : '/api/custom-tools/builtin-sync/preview');
                if (refreshed.pending?.length || manual) openBuiltinToolsSyncModal(refreshed);
                else window.location.reload();
            } catch (error) {
                resultNode.textContent = error.message;
            } finally { button.disabled = false; }
            return;
        }
        const selected = new Set(
            [...modal.querySelectorAll('.builtin-sync-choice:checked')].map(input => input.dataset.syncSlug)
        );
        const applySlugs = tools.filter(tool => selected.has(tool.slug)).map(tool => tool.slug);
        if (manual && !applySlugs.length) {
            resultNode.textContent = navLocaleText('请先勾选需要替换的工具。', 'Select tools to replace first.');
            return;
        }
        const skipSlugs = manual ? [] : tools.filter(tool => !selected.has(tool.slug)).map(tool => tool.slug);
        const expectedFingerprints = Object.fromEntries(tools.map(tool => [tool.slug, tool.fingerprint]));
        modal.dataset.applying = '1';
        modal.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
        button.textContent = navLocaleText('正在处理…', 'Processing…');
        resultNode.textContent = '';
        renderBuiltinToolsSyncProgress(modal, { stage: 'validating', checked: 0, completed: 0, total: tools.length });
        try {
            const result = await applyBuiltinToolsWithProgress({
                applySlugs,
                skipSlugs,
                expectedFingerprints,
                ...(manual ? { forceBundled: true } : {})
            }, progress => renderBuiltinToolsSyncProgress(modal, progress));
            renderBuiltinToolsSyncProgress(modal, { stage: 'done' });
            const changed = result.installed.length + result.adopted.length + result.updated.length;
            const failed = Array.isArray(result.invalid) ? result.invalid : [];
            resultNode.textContent = failed.length
                ? navLocaleText(
                    `部分处理失败：${failed.map(item => `${item.slug}（${item.error}）`).join('；')}。成功 ${changed} 个，保留 ${result.skipped.length} 个。`,
                    `Partial failure: ${failed.map(item => `${item.slug} (${item.error})`).join('; ')}. Succeeded: ${changed}, Kept: ${result.skipped.length}.`
                )
                : navLocaleText(
                    `处理完成：更新/安装 ${changed} 个，保留 ${result.skipped.length} 个。`,
                    `Complete: updated/installed ${changed}, kept ${result.skipped.length}.`
                );
            if (changed) {
                setTimeout(() => window.location.reload(), failed.length ? 1800 : 650);
            } else if (failed.length) {
                enableRecheck();
            } else {
                modal.dataset.applying = '0';
                setTimeout(close, 650);
            }
            if (failed.length) modal.querySelector('.builtin-sync-progress').classList.add('is-error');
        } catch (error) {
            resultNode.textContent = navLocaleText(`处理失败：${error.message || '未知错误'}`, `Processing failed: ${error.message || 'Unknown error'}`);
            modal.querySelector('.builtin-sync-progress').classList.add('is-error');
            enableRecheck();
        }
        function enableRecheck() {
            modal.dataset.applying = '0';
            modal.dataset.needsRefresh = '1';
            button.disabled = false;
            button.textContent = navLocaleText('重新检查', 'Check Again');
            modal.querySelector('.builtin-sync-close').disabled = false;
            modal.querySelector('.builtin-sync-later').disabled = false;
            modal.querySelector('.builtin-sync-today').disabled = false;
        }
    });
    setTimeout(() => modal.querySelector('.builtin-sync-choice')?.focus(), 0);
}

window.openBuiltinToolsComparison = async function () {
    // 内嵌工具共用外层平台的比对窗口，避免手动入口再打开一层弹窗。
    if (window.top !== window) {
        try { return window.top.openBuiltinToolsComparison?.(); } catch (_) { return; }
    }
    if (document.getElementById('builtinToolsSyncModal')?.dataset.applying === '1'
        || !isNavSuperAdmin()) return;

    const existingModal = document.getElementById('builtinToolsSyncModal');
    if (existingModal && existingModal.dataset.loading === '1') {
        existingModal.querySelector('.builtin-sync-close')?.focus();
        return;
    }

    builtinToolsSyncChecking = true;

    if (builtinToolsCompareAbort) {
        try { builtinToolsCompareAbort.abort(); } catch (_) {}
        builtinToolsCompareAbort = null;
    }
    const abortController = new AbortController();
    builtinToolsCompareAbort = abortController;

    // 先出画面：立即渲染内置工具差异比对弹窗与加载态
    openBuiltinToolsSyncModal({ manual: true, loading: true });
    const modal = document.getElementById('builtinToolsSyncModal');

    const runScan = async () => {
        try {
            const preview = await fetchBuiltinToolsPreviewWithProgress(progress => {
                renderBuiltinToolsCompareProgress(modal, progress);
            }, abortController.signal);
            if (abortController.signal.aborted) return;
            openBuiltinToolsSyncModal(preview);
        } catch (error) {
            if (abortController.signal.aborted) return;
            renderBuiltinToolsCompareError(modal, error, () => {
                if (modal) {
                    modal.dataset.loading = '1';
                    openBuiltinToolsSyncModal({ manual: true, loading: true });
                }
                runScan();
            });
        } finally {
            builtinToolsSyncChecking = false;
            if (builtinToolsCompareAbort === abortController) builtinToolsCompareAbort = null;
        }
    };

    runScan();
};



const BUILTIN_SYNC_CHECK_TTL_MS = 5 * 60 * 1000;

async function builtinSyncCheckCacheKey() {
    let version;
    try { version = await window.ToolsAppVersion?.get(); } catch (_) { return ''; }
    // 包版本变化后重新检查；没有版本信息时不跳过扫描。
    if (!version) return '';
    return 'tools_builtin_sync_check:' + JSON.stringify([
        localStorage.getItem('tools_user') || '',
        localStorage.getItem('tools_tenant_id') || 'default',
        version
    ]);
}

async function checkBuiltinToolsSync() {
    // 导航在首页和工具 iframe 中都会加载；全局自动提醒只由顶层页面负责。
    if (window.top !== window) return;
    const toolMarketOpened = () => window.HomeTools?.marketOpened === true;
    if (toolMarketOpened()) return;
    if (
        builtinToolsSyncChecking
        || !isNavSuperAdmin()
        || isBuiltinToolsSyncSnoozedToday()
        || typeof API === 'undefined'
        || document.getElementById('builtinToolsSyncModal')
        || document.getElementById('defaultQuickStartModal')
        || document.getElementById('navSettingsModal')
    ) return;
    builtinToolsSyncChecking = true;
    try {
        const cacheKey = await builtinSyncCheckCacheKey();
        try {
            const checkedAt = Number(cacheKey && sessionStorage.getItem(cacheKey));
            const age = Date.now() - checkedAt;
            if (checkedAt > 0 && age >= 0 && age < BUILTIN_SYNC_CHECK_TTL_MS) return;
        } catch (_) { /* 无法使用会话存储时按原逻辑扫描 */ }
        const preview = await API.get('/api/custom-tools/builtin-sync/preview');
        // 仅记住“没有待更新项”的成功检查，不复用可能过时的更新清单。
        if (cacheKey && Array.isArray(preview?.pending) && !preview.pending.length) {
            try { sessionStorage.setItem(cacheKey, String(Date.now())); } catch (_) { /* noop */ }
        }
        if (!toolMarketOpened() && !isBuiltinToolsSyncSnoozedToday()
            && !document.getElementById('builtinToolsSyncModal')
            && !document.getElementById('defaultQuickStartModal')
            && !document.getElementById('navSettingsModal')
            && preview && Array.isArray(preview.pending) && preview.pending.length) {
            // 如果所有待处理项都显式带有文件统计且变更均为 0（+0 / ~0 / -0），仅为接管或元数据标识差异，不弹窗打扰用户
            const hasActionableTools = preview.pending.some(tool => {
                if (!tool || !tool.counts) return true;
                const c = tool.counts;
                return (c.added || 0) > 0 || (c.modified || 0) > 0 || (c.removed || 0) > 0;
            });
            if (hasActionableTools) {
                openBuiltinToolsSyncModal(preview);
            }
        }
    } catch (error) {
        console.warn('[custom-tools] 读取系统工具更新失败：', error.message);
    } finally {
        builtinToolsSyncChecking = false;
    }
}

