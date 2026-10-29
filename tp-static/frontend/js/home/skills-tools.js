// 首页「全部工具 → 技能」：内置与自定义 Skill 以工具卡片形式出现在 #toolsGrid（分组与搜索由 js/home/workspace.js 统一处理）。
// 点击卡片：切到对话模式、新建对话并在输入框填入 @技能（js/home/dragon-claw.js 的 DragonClaw.startWithSkill）。
// 卡片操作：完善技能（⚡）、版本历史与回退（⏱）、下载（所有人）、改名与删除（管理员）。
// 数据来自 /api/agent-skills（backend/routes/agent-skills.js）；对话里保存或导入新技能后派发 skills:changed 自动刷新。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            builtin: '内置技能', custom: '自定义技能', imported: '导入技能', workspace: '需工作目录', defaultDesc: '在对话里 @ 使用这个技能',
            download: '下载 SKILL 包', rename: '重命名', delete: '删除', renameTitle: '重命名技能', renamePrompt: '新的技能名称',
            save: '保存', deleteTitle: '删除技能', deleteBuiltin: '内置技能「{name}」会从列表和 @ 菜单中隐藏，之后可在「技能」分类标题处恢复。确定删除吗？',
            deleteCustom: '确定删除技能「{name}」吗？删除后对话里将无法再 @{id}。', confirmDelete: '删除', renamed: '已重命名', deleted: '已删除技能',
            downloaded: '已下载 {file}', failed: '操作失败：{message}', restore: '恢复内置技能 {n}', restored: '已恢复内置技能',
            useHint: '点击开始对话并使用 @{id}',
            improve: '完善技能', history: '版本历史与回退', customized: '已自定义',
            historyTitle: '技能版本历史 · @{id}',
            rollback: '回退到此版本',
            rollbackConfirm: '确定将技能「{name}」回退到该版本吗？当前版本会自动备份。',
            rollbackSuccess: '技能已成功回退',
            resetToDefault: '恢复内置初始版本',
            resetConfirm: '确定清除自定义修改，恢复为内置初始版本吗？当前版本会自动备份。',
            resetSuccess: '已恢复为内置初始版本',
            viewContent: '查看正文', hideContent: '收起正文',
            noBackups: '暂无历史备份版本（修改或完善技能时会自动备份）',
            close: '关闭'
        },
        'en-US': {
            builtin: 'Built-in Skill', custom: 'Custom Skill', imported: 'Imported Skill', workspace: 'Needs a folder', defaultDesc: 'Use this Skill with @ in chat',
            download: 'Download SKILL package', rename: 'Rename', delete: 'Delete', renameTitle: 'Rename Skill', renamePrompt: 'New Skill name',
            save: 'Save', deleteTitle: 'Delete Skill', deleteBuiltin: 'The built-in Skill “{name}” will be hidden from the list and the @ menu. You can restore it from the Skills heading. Delete it?',
            deleteCustom: 'Delete the Skill “{name}”? @{id} will no longer work in chat.', confirmDelete: 'Delete', renamed: 'Renamed', deleted: 'Skill deleted',
            downloaded: 'Downloaded {file}', failed: 'Failed: {message}', restore: 'Restore built-in Skills {n}', restored: 'Built-in Skills restored',
            useHint: 'Click to start a chat with @{id}',
            improve: 'Improve Skill', history: 'Version History & Rollback', customized: 'Customized',
            historyTitle: 'Skill History · @{id}',
            rollback: 'Rollback to this version',
            rollbackConfirm: 'Rollback Skill “{name}” to this version? Current version will be backed up.',
            rollbackSuccess: 'Skill rolled back successfully',
            resetToDefault: 'Reset to Built-in Default',
            resetConfirm: 'Clear customizations and reset to built-in default? Current version will be backed up.',
            resetSuccess: 'Reset to built-in default',
            viewContent: 'View Content', hideContent: 'Hide Content',
            noBackups: 'No backups yet (auto-created on update)',
            close: 'Close'
        }
    };

    const state = { items: [], hidden: 0 };
    let grid;

    function lang() {
        return window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN';
    }

    function tx(key, params = {}) {
        const template = TEXT[lang()][key] ?? TEXT['zh-CN'][key] ?? key;
        return Object.keys(params).reduce((text, name) => text.replaceAll(`{${name}}`, params[name]), template);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function isAdmin() {
        try { return localStorage.getItem('tools_role') === 'admin'; } catch { return false; }
    }

    function toast(message, type = 'success') {
        if (typeof window.showToast === 'function') window.showToast(message, type);
    }

    function displayName(item) {
        return lang() === 'en-US' ? item.nameEn || item.name : item.name;
    }

    function displayDescription(item) {
        return (lang() === 'en-US' ? item.descriptionEn || item.description : item.description) || tx('defaultDesc');
    }

    function renderCards() {
        if (!grid) return;
        grid.querySelectorAll(':scope > [data-skill-card="1"]').forEach(card => card.remove());
        const admin = isAdmin();
        state.items.forEach(item => {
            const card = document.createElement('a');
            card.href = `/?skill=${encodeURIComponent(item.id)}`;
            card.className = 'tool-card custom-tool skill-card';
            card.dataset.skillCard = '1';
            card.dataset.skillId = item.id;
            card.dataset.updatedAt = item.updatedAt || '';
            card.title = tx('useHint', { id: item.id });
            const kind = item.builtIn ? tx('builtin') : item.source === 'import' ? tx('imported') : tx('custom');
            card.innerHTML = `
                <div class="custom-tool-actions">
                    <button type="button" class="custom-tool-action action-improve" data-skill-action="improve" title="${escapeHtml(tx('improve'))}">⚡</button>
                    <button type="button" class="custom-tool-action action-history" data-skill-action="history" title="${escapeHtml(tx('history'))}">⏱</button>
                    <button type="button" class="custom-tool-action" data-skill-action="download" title="${escapeHtml(tx('download'))}">↓</button>
                    ${admin ? `
                        ${window.BuiltinPromotion?.button('skill', item.id, { builtIn: item.builtIn, name: displayName(item) }) || ''}
                        <button type="button" class="custom-tool-action" data-skill-action="rename" title="${escapeHtml(tx('rename'))}">✎</button>
                        <button type="button" class="custom-tool-action delete" data-skill-action="delete" title="${escapeHtml(tx('delete'))}">×</button>` : ''}
                </div>
                <div class="card-icon">${escapeHtml(item.icon || '✨')}</div>
                <div class="card-title">${escapeHtml(displayName(item))}<span class="tool-kind-badge skill-mention-badge">@${escapeHtml(item.id)}</span></div>
                <div class="card-desc">${escapeHtml(displayDescription(item))}</div>
                <div class="card-features">
                    <span class="feature-tag">${escapeHtml(kind)}</span>
                    ${item.customized ? `<span class="feature-tag feature-tag--customized">${escapeHtml(tx('customized'))}</span>` : ''}
                    ${item.workspace ? `<span class="feature-tag">${escapeHtml(tx('workspace'))}</span>` : ''}
                </div>
                <div class="card-impact"></div>`;
            grid.appendChild(card);
        });
        renderRestore();
    }

    // 分组标题由 workspace.js 每次重排时重建，重排后（home:tools-updated）再补上恢复按钮
    function renderRestore() {
        const head = grid?.querySelector(':scope > .home-group-head[data-group="__skills"]');
        if (!head) return;
        head.querySelector('.skill-restore')?.remove();
        if (!isAdmin() || !state.hidden) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'skill-restore';
        button.textContent = tx('restore', { n: state.hidden });
        button.addEventListener('click', restoreBuiltins);
        head.appendChild(button);
    }

    async function load() {
        try {
            const data = await window.API.get(`/api/agent-skills${isAdmin() ? '?includeHidden=1' : ''}`);
            const items = Array.isArray(data.items) ? data.items : [];
            state.items = items.filter(item => !item.hidden);
            state.hidden = items.filter(item => item.hidden).length;
        } catch {
            state.items = []; // 技能目录读取失败时只是不显示技能分类
            state.hidden = 0;
        }
        renderCards();
    }

    async function download(id) {
        try {
            const token = localStorage.getItem('tools_token');
            const response = await fetch(`/api/agent-skills/${encodeURIComponent(id)}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${response.status}`);
            }
            const blob = await response.blob();
            let filename = `${id}.zip`;
            try { filename = decodeURIComponent(response.headers.get('X-Skill-Export-Filename') || filename); } catch { /* 保留默认文件名 */ }
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(link.href), 1500);
            toast(tx('downloaded', { file: filename }));
        } catch (error) {
            toast(tx('failed', { message: error.message }), 'error');
        }
    }

    async function rename(item) {
        const name = await window.AppDialog.prompt(tx('renamePrompt'), { title: tx('renameTitle'), defaultValue: item.name, maxLength: 80, confirmText: tx('save') });
        if (name === null || !name.trim() || name.trim() === item.name) return;
        try {
            await window.API.patch(`/api/agent-skills/${encodeURIComponent(item.id)}/name`, { name: name.trim() });
            toast(tx('renamed'));
            window.dispatchEvent(new CustomEvent('skills:changed', { detail: { id: item.id } }));
        } catch (error) {
            window.AppDialog.alert(tx('failed', { message: error.message }), { tone: 'error' });
        }
    }

    async function remove(item) {
        const message = item.builtIn ? tx('deleteBuiltin', { name: displayName(item) }) : tx('deleteCustom', { name: displayName(item), id: item.id });
        if (!await window.AppDialog.confirm(message, { title: tx('deleteTitle'), tone: 'danger', confirmText: tx('confirmDelete') })) return;
        try {
            await window.API.delete(`/api/agent-skills/${encodeURIComponent(item.id)}`);
            toast(tx('deleted'));
            window.dispatchEvent(new CustomEvent('skills:changed', { detail: { id: item.id } }));
        } catch (error) {
            window.AppDialog.alert(tx('failed', { message: error.message }), { tone: 'error' });
        }
    }

    async function restoreBuiltins() {
        try {
            await window.API.post('/api/agent-skills/restore-builtins', {});
            toast(tx('restored'));
            window.dispatchEvent(new CustomEvent('skills:changed'));
        } catch (error) {
            window.AppDialog.alert(tx('failed', { message: error.message }), { tone: 'error' });
        }
    }

    // 完善技能：切到对话并在输入框填入 @improve-skill @目标技能
    function improve(item) {
        window.HomeMode?.set?.('chat');
        if (typeof window.DragonClaw?.newChat === 'function') window.DragonClaw.newChat();
        const input = document.getElementById('dcInput');
        if (input) {
            input.value = `@improve-skill @${item.id} `;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus({ preventScroll: true });
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }

    // 版本历史与回退弹窗
    async function showHistory(item) {
        const overlay = document.createElement('div');
        overlay.className = 'skill-history-overlay';
        overlay.innerHTML = `
            <div class="skill-history-card">
                <div class="skill-history-header">
                    <div class="skill-history-title-wrap">
                        <span class="skill-history-icon">⏱</span>
                        <div>
                            <h3 class="skill-history-title">${escapeHtml(tx('historyTitle', { id: item.id }))}</h3>
                            <small style="color: #94a3b8;">${escapeHtml(displayName(item))}${item.customized ? ` · <b style="color: #38bdf8;">${escapeHtml(tx('customized'))}</b>` : ''}</small>
                        </div>
                    </div>
                    <div class="skill-history-header-actions">
                        ${item.customized && isAdmin() ? `<button type="button" class="skill-btn skill-btn--danger" data-skill-reset="1">${escapeHtml(tx('resetToDefault'))}</button>` : ''}
                        <button type="button" class="skill-history-close" aria-label="${escapeHtml(tx('close'))}">✕</button>
                    </div>
                </div>
                <div class="skill-history-body">
                    <div style="color: #94a3b8; font-size: 13px; text-align: center; padding: 20px;">正在加载版本记录…</div>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        const close = () => { overlay.remove(); };
        overlay.querySelector('.skill-history-close')?.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const bodyEl = overlay.querySelector('.skill-history-body');

        // 恢复内置初始默认
        overlay.querySelector('[data-skill-reset="1"]')?.addEventListener('click', async () => {
            if (!await window.AppDialog.confirm(tx('resetConfirm'), { title: tx('resetToDefault'), tone: 'danger', confirmText: tx('resetToDefault') })) return;
            try {
                await window.API.post(`/api/agent-skills/${encodeURIComponent(item.id)}/reset`);
                toast(tx('resetSuccess'));
                close();
                window.dispatchEvent(new CustomEvent('skills:changed', { detail: { id: item.id } }));
            } catch (error) {
                window.AppDialog.alert(tx('failed', { message: error.message }), { tone: 'error' });
            }
        });

        try {
            const data = await window.API.get(`/api/agent-skills/${encodeURIComponent(item.id)}/backups`);
            const backups = Array.isArray(data.backups) ? data.backups : [];
            if (!backups.length) {
                bodyEl.innerHTML = `<div class="skill-history-empty">${escapeHtml(tx('noBackups'))}</div>`;
                return;
            }

            bodyEl.innerHTML = '';
            backups.forEach(b => {
                const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleString(lang() === 'en-US' ? 'en-US' : 'zh-CN') : '-';
                const row = document.createElement('div');
                row.className = 'skill-history-item';
                row.dataset.backupId = String(b.id);
                row.innerHTML = `
                    <div class="skill-history-item-top">
                        <span class="skill-history-item-summary">${escapeHtml(b.summary || tx('history'))}</span>
                        <span class="skill-history-item-time">${escapeHtml(dateStr)}</span>
                    </div>
                    <div class="skill-history-item-meta">
                        <span>${escapeHtml(b.name)}</span>
                        ${b.createdBy ? `<span>${escapeHtml(b.createdBy)}</span>` : ''}
                    </div>
                    <div class="skill-history-item-actions">
                        <button type="button" class="skill-btn" data-backup-action="view">${escapeHtml(tx('viewContent'))}</button>
                        ${isAdmin() ? `<button type="button" class="skill-btn skill-btn--primary" data-backup-action="rollback">${escapeHtml(tx('rollback'))}</button>` : ''}
                    </div>
                    <pre class="skill-history-preview" style="display: none;"></pre>`;

                const previewEl = row.querySelector('.skill-history-preview');
                const viewBtn = row.querySelector('[data-backup-action="view"]');
                let loadedContent = null;

                viewBtn?.addEventListener('click', async () => {
                    if (previewEl.style.display !== 'none') {
                        previewEl.style.display = 'none';
                        viewBtn.textContent = tx('viewContent');
                        return;
                    }
                    if (!loadedContent) {
                        viewBtn.textContent = '…';
                        try {
                            const res = await window.API.get(`/api/agent-skills/${encodeURIComponent(item.id)}/backups/${b.id}`);
                            loadedContent = res.backup?.markdown || res.backup?.body || '';
                        } catch (err) {
                            loadedContent = `加载失败: ${err.message}`;
                        }
                    }
                    previewEl.textContent = loadedContent;
                    previewEl.style.display = 'block';
                    viewBtn.textContent = tx('hideContent');
                });

                row.querySelector('[data-backup-action="rollback"]')?.addEventListener('click', async () => {
                    const confirmMsg = tx('rollbackConfirm', { name: displayName(item) });
                    if (!await window.AppDialog.confirm(confirmMsg, { title: tx('rollback'), tone: 'warning', confirmText: tx('rollback') })) return;
                    try {
                        await window.API.post(`/api/agent-skills/${encodeURIComponent(item.id)}/rollback/${b.id}`);
                        toast(tx('rollbackSuccess'));
                        close();
                        window.dispatchEvent(new CustomEvent('skills:changed', { detail: { id: item.id } }));
                    } catch (err) {
                        window.AppDialog.alert(tx('failed', { message: err.message }), { tone: 'error' });
                    }
                });

                bodyEl.appendChild(row);
            });
        } catch (error) {
            bodyEl.innerHTML = `<div class="skill-history-empty" style="color: #f87171;">${escapeHtml(tx('failed', { message: error.message }))}</div>`;
        }
    }

    function onGridClick(event) {
        const card = event.target.closest('a[data-skill-card="1"]');
        if (!card || !grid.contains(card)) return;
        const item = state.items.find(entry => entry.id === card.dataset.skillId);
        const action = event.target.closest('[data-skill-action]');
        if (action) {
            event.preventDefault();
            event.stopPropagation();
            if (!item) return;
            const act = action.dataset.skillAction;
            if (act === 'improve') improve(item);
            else if (act === 'history') showHistory(item);
            else if (act === 'download') download(item.id);
            else if (act === 'rename') rename(item);
            else if (act === 'delete') remove(item);
            return;
        }
        // 新标签打开（Ctrl/⌘/中键）时走 /?skill= 链接，由 dragon-claw.js 处理
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        window.DragonClaw?.startWithSkill?.(card.dataset.skillId);
    }

    function init() {
        grid = document.getElementById('toolsGrid');
        if (!grid || !window.API) return;
        grid.addEventListener('click', onGridClick, true);
        window.addEventListener('skills:changed', load);
        window.addEventListener('home:tools-updated', renderRestore);
        window.addEventListener('tools:languagechange', renderCards);
        load();
    }

    window.HomeSkills = { reload: load, items: () => state.items.slice(), improve, showHistory };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
