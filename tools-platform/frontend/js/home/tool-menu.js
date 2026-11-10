// 统一工具/技能右键菜单与操作菜单（卡片右下角「···」按钮、卡片右键、内嵌工具栏「···」按钮）
// 支持自定义工具（下载、收藏、设为内置、重命名、删除、新窗口、复制链接）、技能（完善、历史回退、下载、重命名、删除/隐藏、在对话中使用）、内置工具与插件。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            moreOptions: '更多操作',
            shareAll: '全员开放', unshareAll: '关闭开放', accessSaved: '开放设置已保存', publish: '申请发布', publishReason: '说明这次完善的内容，将提交到需求广场审核。', publishSent: '发布申请已提交', personalHide: '从我的列表移除', personalHideHint: '你可以在应用市场恢复此条目。',
            useSkill: '在对话中使用',
            improveSkill: '完善技能',
            skillHistory: '版本历史与回退',
            downloadSkill: '下载技能包',
            downloadTool: '下载工具',
            downloadApp: '下载应用',
            rename: '重命名',
            deleteTool: '删除工具',
            deleteSkill: '删除技能',
            hideSkill: '隐藏技能',
            promote: '转为内置',
            demote: '取消内置',
            updateTool: '更新工具',
            addFavorite: '收藏工具',
            removeFavorite: '取消收藏',
            openNewTab: '在新标签页打开',
            copyLink: '复制链接',
            copySkillAt: '复制 @ 技能指令',
            reload: '刷新工具',
            openPlugin: '前往查看',
            favAdded: '已收藏「{name}」',
            favRemoved: '已取消收藏「{name}」',
            copied: '已复制链接到剪贴板',
            copiedSkillAt: '已复制 @{id} 到剪贴板'
        },
        'en-US': {
            moreOptions: 'More options',
            shareAll: 'Share with everyone', unshareAll: 'Stop sharing', accessSaved: 'Access settings saved', publish: 'Request publication', publishReason: 'Describe your improvements. The request will be reviewed in the requests board.', publishSent: 'Publication request submitted', personalHide: 'Remove from my list', personalHideHint: 'You can restore this item from the tool market.',
            useSkill: 'Use in chat',
            improveSkill: 'Improve Skill',
            skillHistory: 'Version history',
            downloadSkill: 'Download Skill',
            downloadTool: 'Download tool',
            downloadApp: 'Download app',
            rename: 'Rename',
            deleteTool: 'Delete tool',
            deleteSkill: 'Delete Skill',
            hideSkill: 'Hide Skill',
            promote: 'Make built-in',
            demote: 'Remove from built-ins',
            updateTool: 'Update tool',
            addFavorite: 'Add to favorites',
            removeFavorite: 'Remove from favorites',
            openNewTab: 'Open in new tab',
            copyLink: 'Copy link',
            copySkillAt: 'Copy @ Skill command',
            reload: 'Reload tool',
            openPlugin: 'Open',
            favAdded: '“{name}” added to favorites',
            favRemoved: '“{name}” removed from favorites',
            copied: 'Link copied to clipboard',
            copiedSkillAt: 'Copied @{id} to clipboard'
        }
    };

    const SVG_ICONS = {
        more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
        chat: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4 3.5V15h-.5A1.5 1.5 0 0 1 5 13.5v-8Z"/>',
        sparkles: '<path d="M12 4.5 13.6 9l4.4 1.5-4.4 1.5L12 16.5 10.4 12 6 10.5 10.4 9 12 4.5ZM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>',
        history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
        edit: '<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 18.5l-4 1 1-4 12.5-12Z"/>',
        trash: '<path d="M4 6h16M10 11v6M14 11v6M5 6l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
        star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
        starFilled: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
        copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        cube: '<path d="m12 2 8 4.5v11l-8 4.5-8-4.5v-11L12 2Zm0 9v11M4 6.5l8 4.5 8-4.5"/>',
        refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
        external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>'
    };

    let activeMenu = null;
    let activeAnchor = null;

    const lang = () => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN');
    function t(key, params = {}) {
        const template = TEXT[lang()][key] ?? TEXT['zh-CN'][key] ?? key;
        return Object.keys(params).reduce((text, name) => text.replaceAll(`{${name}}`, params[name]), template);
    }
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isAdmin = () => { try { return localStorage.getItem('tools_role') === 'admin'; } catch { return false; } };
    const isReadonly = () => document.body.classList.contains('builtin-promotion-readonly');

    function ico(name) {
        return `<span class="v2-ico" data-icon="${name}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG_ICONS[name] || ''}</svg></span>`;
    }

    function toast(message, type = 'success') {
        if (typeof window.showToast === 'function') window.showToast(message, type);
    }

    function close() {
        if (!activeMenu) return;
        activeMenu.remove();
        activeMenu = null;
        if (activeAnchor) {
            activeAnchor.setAttribute('aria-expanded', 'false');
            activeAnchor.classList.remove('is-active');
            activeAnchor = null;
        }
    }

    // 统一解析工具目标信息
    function resolveTarget(options) {
        const { item, card, href, title } = options;

        // 1. 如果传了 skill-hub 里的 item
        if (item) {
            if (item.kind === 'skill') {
                const skillId = item.id || String(item.key || '').replace(/^skill:/, '');
                const skill = (window.HomeSkills?.items?.() || []).find(s => s.id === skillId) || item;
                return {
                    kind: 'skill',
                    id: skillId,
                    name: skill.name || item.title || skillId,
                    skill,
                    href: item.href || `/?skill=${encodeURIComponent(skillId)}`,
                    card
                };
            }
            if (item.kind === 'plugin') {
                return {
                    kind: 'plugin',
                    id: item.key,
                    capabilityId: item.capabilityId,
                    badge: item.capabilityBadge,
                    sharedAccess: item.sharedAccess,
                    name: item.title,
                    href: item.href
                };
            }
            // item.kind === 'tool'
            const toolId = String(item.id || item.key || '').replace(/^tool:/, '');
            const itemHref = item.href || '';
            const slug = toolId.startsWith('custom:')
                ? toolId.slice(7)
                : (toolId.match(/^(?:\/)?(?:tools|custom-tools)\/([^/?#]+)/)?.[1]
                   || itemHref.match(/^(?:\/)?(?:tools|custom-tools)\/([^/?#]+)/)?.[1]
                   || null);
            const customTool = (slug ? (window.__homeCustomTools || []).find(t => t.slug === slug) : null)
                || (window.__homeCustomTools || []).find(t => (itemHref && t.href === itemHref))
                || null;
            const resolvedSlug = slug || customTool?.slug || null;
            return {
                kind: 'tool',
                id: toolId,
                slug: resolvedSlug,
                isCustom: Boolean(resolvedSlug || customTool),
                name: item.title || customTool?.name || toolId,
                href: itemHref || (resolvedSlug ? `/tools/${resolvedSlug}` : ''),
                customTool,
                card
            };
        }

        // 2. 如果传了 DOM 卡片
        if (card) {
            if (card.dataset.skillCard === '1' || card.dataset.skillId) {
                const skillId = card.dataset.skillId;
                const skill = (window.HomeSkills?.items?.() || []).find(s => s.id === skillId) || { id: skillId, name: card.querySelector('.card-title')?.textContent?.trim() };
                return {
                    kind: 'skill',
                    id: skillId,
                    name: skill.name || skillId,
                    skill,
                    href: `/?skill=${encodeURIComponent(skillId)}`,
                    card
                };
            }
            const isCustomCard = card.dataset.customToolCard === '1' || card.classList.contains('custom-tool');
            const cardHref = card.getAttribute('href') || '';
            const slug = card.dataset.toolSlug
                || cardHref.match(/^(?:\/)?(?:tools|custom-tools)\/([^/?#]+)/)?.[1]
                || null;
            const customTool = (slug ? (window.__homeCustomTools || []).find(t => t.slug === slug) : null)
                || (window.__homeCustomTools || []).find(t => (cardHref && t.href === cardHref))
                || null;
            const resolvedSlug = slug || customTool?.slug || null;
            const toolId = card.dataset.originId || (resolvedSlug ? `custom:${resolvedSlug}` : cardHref.replace(/^\//, ''));
            const titleEl = card.querySelector('.card-title')?.cloneNode(true) || card.querySelector('strong')?.cloneNode(true);
            titleEl?.querySelectorAll('.new-badge, .tool-kind-badge, span')?.forEach(n => n.remove());
            const name = customTool?.name || titleEl?.textContent?.trim() || resolvedSlug || toolId;
            return {
                kind: 'tool',
                id: toolId,
                slug: resolvedSlug,
                isCustom: Boolean(isCustomCard || resolvedSlug || customTool),
                name,
                href: cardHref || (resolvedSlug ? `/tools/${resolvedSlug}` : ''),
                customTool,
                card
            };
        }

        // 3. 如果从内嵌打开页面（tool-frame）传了 href
        if (href) {
            let pathname = '';
            try { pathname = new URL(href, location.origin).pathname; } catch { pathname = href; }
            const slugMatch = pathname.match(/^(?:\/)?(?:tools|custom-tools)\/([^/?#]+)/);
            const slug = slugMatch ? slugMatch[1] : null;
            const customTool = (slug ? (window.__homeCustomTools || []).find(t => t.slug === slug) : null)
                || (window.__homeCustomTools || []).find(t => (pathname && t.href === pathname))
                || null;
            const resolvedSlug = slug || customTool?.slug || null;
            const toolId = resolvedSlug ? `custom:${resolvedSlug}` : pathname.replace(/^\//, '');
            return {
                kind: 'tool',
                id: toolId,
                slug: resolvedSlug,
                isCustom: Boolean(resolvedSlug || customTool),
                name: title || customTool?.name || resolvedSlug || toolId,
                href,
                customTool
            };
        }

        return null;
    }

    function distributionAction(target) {
        if (localStorage.getItem('tools_super') !== '1' || !window.isNavSuperAdmin?.() || (localStorage.getItem('tools_tenant_id') || 'default') !== 'default') return null;
        let endpoint, payload, entry;
        if (target.kind === 'tool' && target.slug && target.customTool) {
            entry = target.customTool;
            endpoint = `/api/custom-tools/${encodeURIComponent(target.slug)}/distribution`;
            payload = {};
        } else if (target.kind === 'skill' || target.capabilityId) {
            const skill = target.kind === 'skill';
            entry = skill ? target.skill : target;
            endpoint = '/api/distribution';
            payload = { kind: skill ? 'skill' : 'cap', id: skill ? target.id : target.capabilityId };
        } else return null;
        const sharedAccess = entry?.sharedAccess !== true;
        return {
            id: 'distribution', label: t(sharedAccess ? 'shareAll' : 'unshareAll'), icon: 'external',
            run: async () => {
                try {
                    await API.patch(endpoint, { ...payload, sharedAccess });
                    if (entry) entry.sharedAccess = sharedAccess;
                    if (target.card) {
                        target.card.classList.toggle('is-shared-access', sharedAccess);
                    }
                    if (target.kind === 'skill') window.dispatchEvent(new CustomEvent('skills:changed'));
                    if (target.kind === 'plugin') await window.HomeCapabilities?.reload?.();
                    if (target.kind === 'tool') {
                        if (typeof window.reloadHomeCustomTools === 'function') {
                            await window.reloadHomeCustomTools();
                        } else if (typeof window.loadCustomTools === 'function') {
                            await window.loadCustomTools();
                        }
                        await window.refreshCustomToolNavLinks?.();
                        window.dispatchEvent(new CustomEvent('home:tools-updated'));
                    }
                    toast(t('accessSaved'));
                } catch (error) { toast(error.message, 'error'); }
            }
        };
    }

    function updateCapability(target) {
        if (!target.capabilityId.startsWith('f12:builtin:')) {
            if (target.href) window.HomeToolFrame?.open?.(target.href) || window.open(target.href, '_blank', 'noopener');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = target.badge === 'extension' ? '.zip' : '.js';
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) {
                toast(lang() === 'en-US' ? 'File exceeds 8 MB' : '文件超过 8 MB', 'error');
                return;
            }
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                await API.patch('/api/distribution/capability-file', { id: target.capabilityId, data: btoa(binary) });
                toast(t('accessSaved'));
                await window.HomeCapabilities?.reload?.();
            } catch (error) { toast(error.message, 'error'); }
        }, { once: true });
        input.click();
    }

    // 构建动作项列表
    function buildActions(target, options) {
        const actions = [];
        const distribution = distributionAction(target);
        if (distribution) actions.push(distribution);
        const admin = isAdmin();

        if (target.kind === 'skill') {
            const skill = target.skill || {};
            actions.push({
                id: 'use',
                label: t('useSkill'),
                icon: 'chat',
                run: () => {
                    window.HomeMode?.set?.('chat');
                    window.DragonClaw?.startWithSkill?.(target.id);
                }
            });
            actions.push({
                id: 'improve',
                label: t('improveSkill'),
                icon: 'sparkles',
                run: () => {
                    window.HomeSkills?.improve?.(skill);
                }
            });
            if (!skill.shared || skill.personal) actions.push({
                id: 'history',
                label: t('skillHistory'),
                icon: 'history',
                run: () => {
                    window.HomeSkills?.showHistory?.(skill);
                }
            });
            actions.push({
                id: 'download',
                label: t('downloadSkill'),
                icon: 'download',
                run: () => {
                    window.HomeSkills?.download?.(target.id);
                }
            });

            if (admin && !window.isNavSuperAdmin?.() && (!skill.shared || skill.personal)) actions.push({
                id: 'publish', label: t('publish'), icon: 'upload',
                run: async () => {
                    const reason = await window.AppDialog.prompt(t('publishReason'), { title: t('publish'), maxLength: 1000, multiline: true });
                    if (reason === null) return;
                    try {
                        await API.post('/api/requirements/skill-publications', { skillId: target.id, reason });
                        toast(t('publishSent'));
                    } catch (error) { toast(error.message, 'error'); }
                }
            });

            if (admin) {
                actions.push({ divider: true });
                actions.push({
                    id: 'rename',
                    label: t('rename'),
                    icon: 'edit',
                    run: async () => {
                        await window.HomeSkills?.rename?.(skill);
                    }
                });
                actions.push({
                    id: 'delete',
                    label: skill.shared || skill.builtIn ? t('hideSkill') : t('deleteSkill'),
                    icon: 'trash',
                    danger: true,
                    run: async () => {
                        await window.HomeSkills?.remove?.(skill);
                    }
                });
            }

            actions.push({ divider: true });
            actions.push({
                id: 'copySkill',
                label: t('copySkillAt'),
                icon: 'copy',
                run: () => {
                    navigator.clipboard.writeText(`@${target.id}`);
                    toast(t('copiedSkillAt', { id: target.id }));
                }
            });

            return actions;
        }

        if (target.kind === 'tool') {
            const isCustom = target.isCustom && target.slug;
            const customTool = target.customTool || (target.slug ? (window.__homeCustomTools || []).find(t => t.slug === target.slug) : null);
            const isBuiltIn = customTool?.builtIn === true;
            const isHostedApp = customTool?.hostedApp || customTool?.category === 'hosted-app';
            // 开放给全员的托管应用是全员共用的同一个进程：团队账号不能更新、重命名，只能从自己的首页隐藏（后端同样拒绝）
            const sharedHosted = Boolean(isHostedApp && customTool?.shared);
            const favId = target.id || (isCustom ? `custom:${target.slug}` : target.href.replace(/^\//, ''));

            // 1. 收藏 / 取消收藏
            if (window.NavFavorites) {
                const isFav = window.NavFavorites.has(favId);
                actions.push({
                    id: 'fav',
                    label: isFav ? t('removeFavorite') : t('addFavorite'),
                    icon: isFav ? 'starFilled' : 'star',
                    run: () => {
                        const on = window.NavFavorites.toggle(favId);
                        toast(t(on ? 'favAdded' : 'favRemoved', { name: target.name }));
                        try {
                            const Evt = typeof CustomEvent !== 'undefined' ? CustomEvent : window.CustomEvent;
                            if (Evt) window.dispatchEvent(new Evt('home:tools-updated'));
                        } catch { /* noop */ }
                    }
                });
            }

            // 2. 自定义工具下载
            if (isCustom && !customTool?.shared && window.downloadCustomTool) {
                actions.push({
                    id: 'download',
                    label: isHostedApp ? t('downloadApp') : t('downloadTool'),
                    icon: 'download',
                    run: () => {
                        window.downloadCustomTool(target.slug);
                    }
                });
            }

            // 3. 管理员操作：转为内置 / 重命名 / 删除
            if (isCustom && admin) {
                if (!customTool?.shared && !isReadonly() && window.BuiltinPromotion?.toggle) {
                    actions.push({
                        id: 'promote',
                        label: isBuiltIn ? t('demote') : t('promote'),
                        icon: 'cube',
                        run: async () => {
                            await window.BuiltinPromotion.toggle('tool', target.slug, {
                                builtIn: isBuiltIn,
                                name: customTool?.name || target.name,
                                hostedApp: isHostedApp
                            });
                        }
                    });
                }
                if (!sharedHosted && window.openCustomToolUpdateModal) actions.push({
                    id: 'update',
                    label: t('updateTool'),
                    icon: 'upload',
                    run: () => {
                        const handler = window.openCustomToolUpdateModal;
                        if (handler) {
                            handler(target.slug, {
                                name: customTool?.name || target.name,
                                nameEn: customTool?.nameEn || target.nameEn || '',
                                customTool,
                                onUpdated: () => {
                                    if (options.onReload) options.onReload();
                                }
                            });
                        }
                    }
                });
                if (!sharedHosted && window.renameCustomTool) {
                    actions.push({
                        id: 'rename',
                        label: t('rename'),
                        icon: 'edit',
                        run: async () => {
                            const newName = await window.renameCustomTool(target.slug);
                            if (newName && options.onRename) options.onRename(newName);
                        }
                    });
                }
                if (window.deleteCustomTool) {
                    actions.push({
                        id: 'delete',
                        label: sharedHosted ? t('personalHide') : t('deleteTool'),
                        icon: 'trash',
                        danger: true,
                        run: async () => {
                            const deleted = await window.deleteCustomTool(target.slug);
                            if (deleted && options.onDelete) options.onDelete();
                        }
                    });
                }
            }

            actions.push({ divider: true });

            // 4. 刷新（在内嵌页面时可用）
            if (options.onReload) {
                actions.push({
                    id: 'reload',
                    label: t('reload'),
                    icon: 'refresh',
                    run: () => options.onReload()
                });
            }

            // 5. 独立/新窗口打开
            if (target.href) {
                actions.push({
                    id: 'external',
                    label: t('openNewTab'),
                    icon: 'external',
                    run: () => {
                        const directUrl = window.ToolsNavigation?.toolUrl?.(target.href) || target.href;
                        window.open(directUrl, '_blank', 'noopener');
                    }
                });
                actions.push({
                    id: 'copyLink',
                    label: t('copyLink'),
                    icon: 'copy',
                    run: () => {
                        const shell = window.ToolsNavigation?.shellUrl?.(target.href) || target.href;
                        const full = new URL(shell, location.origin).href;
                        navigator.clipboard.writeText(full);
                        toast(t('copied'));
                    }
                });
            }

            return actions;
        }

        if (target.kind === 'plugin') {
            if (target.capabilityId && admin && !window.isNavSuperAdmin?.()) {
                actions.push({
                    id: 'update', label: t('updateTool'), icon: 'upload',
                    run: () => updateCapability(target)
                }, {
                    id: 'rename', label: t('rename'), icon: 'edit',
                    run: async () => {
                        const name = await window.AppDialog.prompt(t('rename'), { defaultValue: target.name, maxLength: 80 });
                        if (!name?.trim()) return;
                        try {
                            await API.patch('/api/distribution/personal', { kind: 'cap', id: target.capabilityId, action: 'rename', name });
                            await window.HomeCapabilities?.reload?.();
                        } catch (error) { toast(error.message, 'error'); }
                    }
                }, {
                    id: 'hide', label: t('personalHide'), icon: 'trash', danger: true,
                    run: async () => {
                        if (!await window.AppDialog.confirm(t('personalHideHint'), { title: t('personalHide') })) return;
                        try {
                            await API.patch('/api/distribution/personal', { kind: 'cap', id: target.capabilityId, action: 'hide' });
                            await window.HomeCapabilities?.reload?.();
                        } catch (error) { toast(error.message, 'error'); }
                    }
                });
            }
            if (target.href) {
                actions.push({
                    id: 'open',
                    label: t('openPlugin'),
                    icon: 'external',
                    run: () => {
                        location.href = target.href;
                    }
                });
                actions.push({
                    id: 'copyLink',
                    label: t('copyLink'),
                    icon: 'copy',
                    run: () => {
                        const full = new URL(target.href, location.origin).href;
                        navigator.clipboard.writeText(full);
                        toast(t('copied'));
                    }
                });
            }
            return actions;
        }

        return actions;
    }

    function open(options = {}) {
        close();
        const target = resolveTarget(options);
        if (!target) return;

        const actions = buildActions(target, options);
        if (!actions.length) return;

        const menu = document.createElement('div');
        menu.className = 'tool-context-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', target.name ? `${target.name} · ${t('moreOptions')}` : t('moreOptions'));

        menu.innerHTML = actions.map(act => {
            if (act.divider) return '<div class="tool-menu-sep" role="separator"></div>';
            return `<button type="button" role="menuitem" data-tool-action="${esc(act.id)}" class="${act.danger ? 'is-danger' : ''}">
                ${ico(act.icon)}
                <span>${esc(act.label)}</span>
            </button>`;
        }).join('');

        menu.addEventListener('click', async event => {
            const btn = event.target.closest('[data-tool-action]');
            if (!btn) return;
            event.preventDefault();
            event.stopPropagation();
            const actId = btn.dataset.toolAction;
            const action = actions.find(a => a.id === actId);
            close();
            if (action?.run) {
                try {
                    await action.run();
                } catch (err) {
                    console.error('[ToolMenu] Action error:', err);
                }
            }
        });

        // 键盘无障碍支持
        menu.addEventListener('keydown', event => {
            const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
            const index = buttons.indexOf(document.activeElement);
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const nextIndex = event.key === 'Home' ? 0
                    : event.key === 'End' ? buttons.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[nextIndex]?.focus();
            } else if (event.key === 'Tab') {
                close();
            }
        });

        document.body.appendChild(menu);
        window.HomeV2?.fillIcons?.(menu);
        activeMenu = menu;

        // 定位计算
        const menuRect = menu.getBoundingClientRect();
        let left = 0;
        let top = 0;

        if (options.anchor) {
            activeAnchor = options.anchor;
            activeAnchor.setAttribute('aria-expanded', 'true');
            activeAnchor.classList.add('is-active');
            const rect = activeAnchor.getBoundingClientRect();
            left = rect.right - menuRect.width;
            top = rect.bottom + 6;
            if (left < 10) left = Math.max(10, rect.left);
            if (left + menuRect.width > window.innerWidth - 10) left = window.innerWidth - menuRect.width - 10;
            if (top + menuRect.height > window.innerHeight - 10) {
                top = Math.max(10, rect.top - menuRect.height - 6);
            }
        } else {
            const x = Number(options.x) || 0;
            const y = Number(options.y) || 0;
            left = x;
            top = y;
            if (left + menuRect.width > window.innerWidth - 10) left = Math.max(10, window.innerWidth - menuRect.width - 10);
            if (top + menuRect.height > window.innerHeight - 10) top = Math.max(10, window.innerHeight - menuRect.height - 10);
        }

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;

        // 默认将焦点置于菜单第一个可操作按钮
        menu.querySelector('button')?.focus({ preventScroll: true });
    }

    // 全局事件监听：点击菜单外关闭、窗口调整大小/失焦（点入 iframe）关闭
    document.addEventListener('pointerdown', event => {
        if (!activeMenu) return;
        if (event.target.closest('.tool-context-menu')) return;
        if (activeAnchor && activeAnchor.contains(event.target)) return;
        close();
    }, true);

    window.addEventListener('blur', () => {
        if (document.activeElement?.matches?.('iframe')) close();
    });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);

    window.HomeToolMenu = {
        open,
        close,
        isOpen: () => Boolean(activeMenu),
        resolveTarget
    };
    window.ToolsActionMenu = window.HomeToolMenu;
})();
