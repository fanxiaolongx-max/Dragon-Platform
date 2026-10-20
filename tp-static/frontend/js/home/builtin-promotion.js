// 卡片右上角「☆ 转为内置 / ★ 取消内置」（仅管理员）：自定义 HTML 工具、技能、F12 服务器脚本、Python 脚本。
// 各卡片只输出按钮（BuiltinPromotion.button），点击统一在这里处理：确认 → /api/builtin-promotion → 派发 builtin:changed 让各区块刷新。
// 源码目录不可写（例如打包后的桌面版）时，body 加 builtin-promotion-readonly，按钮隐藏。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            promote: '转为内置（写入项目源码，随项目自带）', demote: '取消内置', locked: '随源码内置，不能取消',
            promoteTitle: '转为内置', demoteTitle: '取消内置',
            promoteBody: '把「{name}」转为内置？\n\n会写入项目源码目录 {path}，提交并推送到 Git 后随项目自带；新环境或其他租户启动时自动安装。',
            demoteBody: '取消「{name}」的内置？\n\n将从项目源码目录 {path} 移除（移除前会备份到数据目录），当前租户保留为自定义内容；其他租户以后不再自动获得。提交到 Git 后生效。',
            promoteOk: '转为内置', demoteOk: '取消内置', promoted: '已转为内置：{path}，记得提交到 Git', demoted: '已取消内置，当前租户保留为自定义', failed: '操作失败：{message}'
        },
        'en-US': {
            promote: 'Make built-in (writes to project source, ships with the project)', demote: 'Remove from built-ins', locked: 'Ships with the source code and cannot be removed',
            promoteTitle: 'Make built-in', demoteTitle: 'Remove from built-ins',
            promoteBody: 'Make “{name}” built-in?\n\nIt is written to {path} in the project source. After you commit and push, it ships with the project and installs automatically in new environments and other tenants.',
            demoteBody: 'Remove “{name}” from built-ins?\n\nIt is removed from {path} in the project source (a backup is kept in the data folder). This tenant keeps it as custom content; other tenants no longer get it. Commit to Git to apply.',
            promoteOk: 'Make built-in', demoteOk: 'Remove', promoted: 'Now built-in: {path}. Remember to commit it', demoted: 'Removed from built-ins; kept as custom here', failed: 'Failed: {message}'
        }
    };
    let lockedTools = new Set(['f12-to-extension', 'python-updater']); // 以 /api/builtin-promotion/status 为准
    const SOURCE_PATHS = { tool: 'backend/builtin-tools/', skill: 'backend/agent-skills/', f12: 'backend/builtin-scripts/f12/', python: 'backend/builtin-scripts/python/' };

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

    /**
     * 卡片按钮 HTML；非管理员返回空串。
     * @param {'tool'|'skill'|'f12'|'python'} kind
     * @param {string} id
     * @param {{ builtIn?: boolean, locked?: boolean, name?: string, className?: string }} options
     */
    function button(kind, id, { builtIn = false, locked = false, name = '', className = 'custom-tool-action' } = {}) {
        if (!isAdmin() || !id) return '';
        if (kind === 'tool' && builtIn && lockedTools.has(id)) locked = true;
        const title = locked ? tx('locked') : builtIn ? tx('demote') : tx('promote');
        return `<button type="button" class="${escapeHtml(className)} builtin-toggle${builtIn ? ' is-builtin' : ''}${locked ? ' is-locked' : ''}" data-builtin-kind="${escapeHtml(kind)}" data-builtin-id="${escapeHtml(id)}" data-builtin-on="${builtIn ? '1' : '0'}" data-builtin-name="${escapeHtml(name)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${locked ? ' aria-disabled="true"' : ''}>${builtIn ? '★' : '☆'}</button>`;
    }

    function toast(message, type = 'success') {
        if (typeof window.showToast === 'function') window.showToast(message, type);
    }

    async function toggle(target) {
        const { builtinKind: kind, builtinId: id, builtinName: name } = target.dataset;
        const builtIn = target.dataset.builtinOn === '1';
        const label = name || id;
        const confirmed = await window.AppDialog.confirm(tx(builtIn ? 'demoteBody' : 'promoteBody', { name: label, path: `${SOURCE_PATHS[kind]}${id}` }), {
            title: tx(builtIn ? 'demoteTitle' : 'promoteTitle'),
            tone: builtIn ? 'danger' : undefined,
            confirmText: tx(builtIn ? 'demoteOk' : 'promoteOk')
        });
        if (!confirmed) return;
        target.disabled = true;
        try {
            const path = `/api/builtin-promotion/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
            const result = builtIn ? await window.API.delete(path) : await window.API.post(path, {});
            toast(builtIn ? tx('demoted') : tx('promoted', { path: result.path || `${SOURCE_PATHS[kind]}${id}` }));
            window.dispatchEvent(new CustomEvent('builtin:changed', { detail: { kind, id, builtIn: !builtIn } }));
        } catch (error) {
            window.AppDialog.alert(tx('failed', { message: error.message }), { tone: 'error' });
        } finally {
            target.disabled = false;
        }
    }

    // 捕获阶段处理：先于卡片链接跳转与各区块自己的点击处理
    document.addEventListener('click', event => {
        const target = event.target.closest?.('[data-builtin-kind]');
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        if (target.classList.contains('is-locked') || target.disabled) return;
        toggle(target);
    }, true);

    // 变化后刷新各区块：工具列表、技能（@ 菜单 + 技能分类）、插件与脚本
    window.addEventListener('builtin:changed', event => {
        const kind = event.detail?.kind;
        if (kind === 'tool' && typeof window.loadCustomTools === 'function') window.loadCustomTools();
        if (kind === 'skill') window.dispatchEvent(new CustomEvent('skills:changed', { detail: { id: event.detail.id } }));
        if (kind === 'f12' || kind === 'python') window.HomeCapabilities?.reload?.();
    });

    async function checkWritable() {
        if (!isAdmin() || !window.API) return;
        try {
            const status = await window.API.get('/api/builtin-promotion/status');
            document.body.classList.toggle('builtin-promotion-readonly', !status.writable);
            if (Array.isArray(status.lockedTools)) lockedTools = new Set(status.lockedTools);
        } catch {
            document.body.classList.add('builtin-promotion-readonly');
        }
    }

    window.BuiltinPromotion = { button };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkWritable, { once: true });
    else checkWritable();
})();
