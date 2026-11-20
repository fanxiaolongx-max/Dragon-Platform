// 全局智能体状态雷达（借鉴 Herdr 的跨终端/跨 Agent 状态追踪）：
// 聚合「需要你审批」「平台正在生成」「桌面 Agent 忙碌/待选择」「后台终端运行」到一个轻巧状态胶囊中，支持一键直达或就地放行。
(function () {
    'use strict';
    if (window.DragonAgentRadar) return;

    const L = (zh, en) => /^en/i.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const esc = val => String(val ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    let wrap, pill, popover, open = false;

    function collect() {
        const blocked = [];
        const working = [];
        const terminals = [];

        // 1. 待人工审批（ApprovalInbox）
        const approvals = window.ApprovalInbox?.items?.() || [];
        for (const item of approvals) {
            blocked.push({
                kind: 'approval',
                id: item.id,
                code: item.code || '',
                title: item.toolName || L('待批准操作', 'Pending approval'),
                detail: item.summary || item.detail || '',
                sessionId: item.chatSessionId || ''
            });
        }

        // 2. 平台当前对话生成状态
        const dcStatus = window.DragonClaw?.getRunStatus?.();
        if (dcStatus?.generating) {
            working.push({
                kind: 'platform',
                title: 'Dragon Claw',
                detail: L('正在生成 / 执行工具…', 'Generating / running tools…'),
                sessionId: dcStatus.sessionId || ''
            });
        }

        // 3. 桌面 Agent 忙碌与待选择（Codex / Claude Code / Antigravity / WorkBuddy）
        const desktopItems = window.HomeDesktopAgents?.getItems?.() || [];
        for (const item of desktopItems) {
            if (item.needsChoice || item.interactionPending) {
                blocked.push({
                    kind: 'desktop-choice',
                    provider: item.provider,
                    id: item.id,
                    title: `${item.providerName || item.provider} · ${L('等你选择', 'Needs choice')}`,
                    detail: item.title || item.id
                });
            } else if (item.busy || window.HomeDesktopAgents?.isBusy?.(item.provider, item.id)) {
                working.push({
                    kind: 'desktop',
                    provider: item.provider,
                    id: item.id,
                    title: item.providerName || item.provider,
                    detail: item.title || item.id
                });
            }
        }

        // 4. DragonTAC 讨论组活动状态
        const tacJob = window.HomeAgentDiscussion?.getActiveJob?.();
        if (tacJob && ['queued', 'running'].includes(tacJob.status)) {
            working.push({
                kind: 'discussion',
                title: tacJob.strategy === 'parallel' ? L('DragonTAC · 并行竞速', 'DragonTAC · Parallel race') : L('DragonTAC · 讨论中', 'DragonTAC · Discussing'),
                detail: `${(tacJob.reports || []).filter(r => r.status === 'done').length}/${(tacJob.reports || []).length} ${L('完成', 'done')}`,
                sessionId: tacJob.sessionId || ''
            });
        }

        // 5. 终端会话
        const term = window.DragonTerminalSidebar?.getSummary?.();
        if (term?.agentRunning > 0) {
            terminals.push({
                kind: 'terminal-agent',
                title: L('Agent 命令终端', 'Agent Terminal'),
                detail: L(`${term.agentRunning} 条命令执行中`, `${term.agentRunning} command(s) running`)
            });
        }
        if (term?.activeShells > 0) {
            terminals.push({
                kind: 'terminal-shell',
                title: L('交互式终端', 'Interactive Shells'),
                detail: L(`${term.activeShells} 个会话在线`, `${term.activeShells} active shell(s)`)
            });
        }

        return { blocked, working, terminals };
    }

    function syncMount(hasActivity) {
        if (!wrap) return;
        const chatting = document.body.classList.contains('dc-chatting');
        const actions = document.querySelector('.dc-chat-actions');
        const dcRoot = document.getElementById('dragonClaw');
        if (chatting && actions) {
            wrap.classList.remove('is-floating');
            wrap.hidden = false;
            if (wrap.parentElement !== actions) actions.prepend(wrap);
        } else if (!chatting && dcRoot) {
            wrap.classList.add('is-floating');
            wrap.hidden = !hasActivity;
            if (wrap.parentElement !== dcRoot) dcRoot.append(wrap);
        }
    }

    function render() {
        if (!pill || !popover) return;
        const { blocked, working, terminals } = collect();
        const blockedCount = blocked.length;
        const workingCount = working.length;
        const termCount = terminals.length;
        syncMount(blockedCount + workingCount + termCount > 0);

        pill.classList.toggle('is-blocked', blockedCount > 0);
        pill.classList.toggle('is-working', blockedCount === 0 && workingCount > 0);

        const dot = '<span class="dc-radar-dot" aria-hidden="true"></span>';
        if (blockedCount > 0 && workingCount > 0) {
            pill.innerHTML = `${dot}<span>${esc(L(`${workingCount} 运行 · ${blockedCount} 待确认`, `${workingCount} active · ${blockedCount} blocked`))}</span>`;
        } else if (blockedCount > 0) {
            pill.innerHTML = `${dot}<span>${esc(L(`${blockedCount} 待你确认`, `${blockedCount} needs input`))}</span>`;
        } else if (workingCount > 0) {
            pill.innerHTML = `${dot}<span>${esc(L(`${workingCount} 个智能体运行中`, `${workingCount} running`))}</span>`;
        } else if (termCount > 0) {
            pill.innerHTML = `${dot}<span>${esc(L('终端在线', 'Terminal active'))}</span>`;
        } else {
            pill.innerHTML = `${dot}<span>${esc(L('雷达就绪', 'Radar idle'))}</span>`;
        }
        pill.title = L('查看全局智能体与终端状态雷达', 'View global agent & terminal status radar');

        if (!open) return;
        const section = (label, list, cls) => {
            if (!list.length) return '';
            return `<div class="dc-radar-group ${cls}">
                <div class="dc-radar-group-title">${esc(label)}</div>
                ${list.map(item => `
                    <button type="button" class="dc-radar-item" data-radar-kind="${esc(item.kind)}" data-radar-session="${esc(item.sessionId || '')}" data-radar-provider="${esc(item.provider || '')}" data-radar-id="${esc(item.id || '')}">
                        <span class="dc-radar-item-main">
                            <b>${esc(item.title)}</b>
                            <small>${esc(item.detail)}</small>
                        </span>
                        <span class="dc-radar-jump" aria-hidden="true">↗</span>
                    </button>`).join('')}
            </div>`;
        };
        const empty = !blockedCount && !workingCount && !termCount;
        popover.innerHTML = `
            <div class="dc-radar-head">
                <strong>${esc(L('智能体状态雷达', 'Agent Status Radar'))}</strong>
                <small>${esc(L('实时汇总阻塞、运行与终端', 'Live blocked, running & shell states'))}</small>
            </div>
            ${empty
                ? `<div class="dc-radar-empty">${esc(L('当前所有智能体与终端均空闲', 'All agents and terminals are idle'))}</div>`
                : section(L('等你处理 / 阻塞', 'Needs your attention'), blocked, 'is-blocked')
                  + section(L('正在运行', 'Working'), working, 'is-working')
                  + section(L('终端进程', 'Terminals'), terminals, 'is-terminal')}`;
    }

    function setOpen(next) {
        open = typeof next === 'boolean' ? next : !open;
        if (!popover || !pill) return;
        popover.hidden = !open;
        pill.setAttribute('aria-expanded', String(open));
        if (open) render();
    }

    function handleJump(btn) {
        const kind = btn.dataset.radarKind;
        const sessionId = btn.dataset.radarSession;
        const provider = btn.dataset.radarProvider;
        const id = btn.dataset.radarId;
        setOpen(false);
        if (kind === 'approval') {
            if (sessionId) window.DragonClaw?.openChat?.(sessionId);
            else document.getElementById('v2AlertsBtn')?.click?.();
        } else if ((kind === 'desktop' || kind === 'desktop-choice') && provider && id) {
            window.HomeDesktopAgents?.open?.(provider, id);
        } else if ((kind === 'platform' || kind === 'discussion') && sessionId) {
            window.DragonClaw?.openChat?.(sessionId);
        } else if (kind === 'terminal-agent' || kind === 'terminal-shell') {
            window.DragonTerminalSidebar?.open?.();
        }
    }

    function init() {
        const actions = document.querySelector('.dc-chat-actions');
        if (!actions) return;
        wrap = document.createElement('div');
        wrap.className = 'dc-radar-wrap';
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'dc-ghost-btn dc-radar-pill';
        pill.setAttribute('aria-haspopup', 'dialog');
        pill.setAttribute('aria-expanded', 'false');
        popover = document.createElement('div');
        popover.className = 'dc-radar-popover';
        popover.setAttribute('role', 'dialog');
        popover.hidden = true;
        wrap.append(pill, popover);
        actions.prepend(wrap);

        pill.addEventListener('click', e => { e.stopPropagation(); setOpen(); });
        popover.addEventListener('click', e => {
            const btn = e.target.closest('[data-radar-kind]');
            if (btn) handleJump(btn);
        });
        document.addEventListener('pointerdown', e => { if (open && wrap && !wrap.contains(e.target)) setOpen(false); });
        document.addEventListener('keydown', e => { if (open && e.key === 'Escape') { setOpen(false); pill.focus(); } });

        for (const evt of ['dragon-claw:radar-refresh', 'dragon-claw:status-change', 'tools:approval-inbox', 'home:desktop-agents-updated', 'home:desktop-agents-busy', 'tools:languagechange']) {
            window.addEventListener(evt, render);
        }
        new MutationObserver(render).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        render();
        window.DragonAgentRadar = { refresh: render, open: () => setOpen(true), close: () => setOpen(false) };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
