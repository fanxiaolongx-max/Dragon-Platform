// AI 问答与笔记：选中文字 / 图表 / 代码 / 教学图组件 → 悬浮问答，自动保存为高亮；右侧可调宽的侧栏汇总并可跳回原位置。
import { renderMarkdown, renderMermaid } from './markdown.js';

const ENDPOINT = '/api/datacom-knowledge';
const WIDTH_KEY = 'dk_ai_width';
const OPEN_KEY = 'dk_ai_open';
const KIND = {
    qa: { icon: '✦', label: '问答' },
    note: { icon: '📝', label: '笔记' },
    rewrite: { icon: '✎', label: '改写' }
};
const QUICK = {
    qa: ['用大白话解释', '举个实际例子', '华为和 Juniper 有什么区别？', '为什么要这样设计？', '常见故障怎么排查？'],
    note: ['核心结论', '易错点', '记忆口诀', '与相关知识对比'],
    rewrite: ['更通俗易懂', '更严谨准确', '精简一半', '补充一个例子']
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const squash = value => String(value || '').replace(/\s+/g, ' ').trim();
const storeGet = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
const storeSet = (key, value) => { try { localStorage.setItem(key, value); } catch (_) { /* 隐私模式 */ } };

function ago(iso) {
    const diff = (Date.now() - Date.parse(iso)) / 1000;
    if (!Number.isFinite(diff)) return '';
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
    return iso.slice(0, 10);
}

export function initAiNotes(app) {
    if (app.readOnly) return;
    const ui = {
        state: { status: null, list: [], all: [], scope: 'page', kind: 'all', filter: '', expanded: new Set(), pendingJump: null, visual: null, route: null, article: null },
        toolbar: null, pop: null, tip: null
    };
    const S = ui.state;
    const panel = document.getElementById('aiPanel');
    const toggle = document.getElementById('aiPanelBtn');
    const user = () => ({ name: app.state.username, admin: app.state.canWrite });

    // ---------------- 通用 ----------------
    async function request(path, options = {}) {
        const response = await fetch(`${ENDPOINT}${path}`, {
            method: options.method || 'GET', credentials: 'same-origin',
            headers: options.body ? { 'Content-Type': 'application/json' } : {},
            body: options.body ? JSON.stringify({ tenantId: app.state.tenantId, ...options.body }) : undefined
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error || `请求失败 (${response.status})`), { code: data.code });
        return data;
    }

    // 读取 NDJSON 流：边收边回调，返回最后的 done 事件
    async function stream(body, onDelta, signal) {
        const response = await fetch(`${ENDPOINT}/ai/ask`, {
            method: 'POST', credentials: 'same-origin', signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: app.state.tenantId, ...body })
        });
        if (!response.ok || !response.body) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `请求失败 (${response.status})`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = null;
        for (;;) {
            const { value, done: finished } = await reader.read();
            if (finished) break;
            buffer += decoder.decode(value, { stream: true });
            let index;
            while ((index = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                if (!line) continue;
                const event = JSON.parse(line);
                if (event.type === 'delta') onDelta(event.text);
                if (event.type === 'error') throw Object.assign(new Error(event.error), { code: event.code });
                if (event.type === 'done') done = event;
            }
        }
        if (!done) throw new Error('AI 响应中断，请重试');
        return done;
    }

    const visibleText = raw => String(raw).split('<<<META>>>')[0];
    const anchorLabel = item => {
        const anchor = item.anchor || {};
        if (anchor.type === 'visual') return `🧊 ${app.VISUALS.get(anchor.visualId)?.title.split(' · ')[0] || anchor.visualId}${anchor.partName ? ` · ${anchor.partName}` : ''}`;
        if (anchor.type === 'block') return `${{ mermaid: '📊 流程图', code: '⌨️ 代码块', table: '▦ 表格', image: '🖼 图片' }[anchor.block] || '区块'}${anchor.heading ? ` · ${anchor.heading}` : ''}`;
        if (anchor.type === 'text') return `“${squash(item.quote || anchor.exact).slice(0, 28)}${squash(item.quote || anchor.exact).length > 28 ? '…' : ''}”`;
        return '整篇文章';
    };
    const articleTitle = id => app.state.catalog.articles.find(article => article.id === id);
    function renderMd(container, markdown) {
        renderMarkdown(container, markdown, { findArticle: app.findArticle });
        renderMermaid(container, document.documentElement.dataset.theme !== 'light');
    }

    // ---------------- 选中文字工具条 ----------------
    function selectionInfo() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        if (!container || container.closest('input, textarea, .dk-ai-pop, .dk-ai-panel, .dk-anno-tip, .dk-stage, .dk-modal')) return null;
        const exact = squash(selection.toString());
        if (exact.length < 2) return null;
        let root = container.closest('.dk-summary, .dk-keypoints, #articleBody');
        let field = root?.matches('.dk-summary') ? 'summary' : root?.matches('.dk-keypoints') ? 'keyPoints' : root ? 'body' : null;
        const lab = container.closest('.dk-lab');
        if (!root && !lab) {
            if (!container.closest('.dk-article, .dk-cov-chapter, .dk-page-head, .dk-hero')) return null;
            root = container.closest('.dk-article, .dk-cov-chapter, .dk-page-head, .dk-hero');
        }
        const around = node => {
            const pre = document.createRange();
            pre.setStart(node, 0);
            pre.setEnd(range.startContainer, range.startOffset);
            const post = document.createRange();
            post.setStart(range.endContainer, range.endOffset);
            post.setEnd(node, node.childNodes.length);
            return { prefix: squash(pre.toString()).slice(-60), suffix: squash(post.toString()).slice(0, 60) };
        };
        const context = root ? around(root) : { prefix: '', suffix: '' };
        let heading = '';
        if (field === 'body') {
            const headings = [...root.querySelectorAll('h1, h2, h3, h4')].filter(node => node.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING);
            heading = squash(headings.at(-1)?.textContent || '');
        }
        if (lab && app.state.route?.name === 'lab') {
            return { rect: range.getBoundingClientRect(), exact, anchor: { type: 'visual', visualId: app.state.route.id, partName: '选中文字' }, quote: exact, visualContext: labContext(lab) };
        }
        if (!field || app.state.route?.name !== 'article') {
            return { rect: range.getBoundingClientRect(), exact, anchor: { type: 'article' }, quote: exact, articleId: app.state.route?.name === 'article' ? app.state.route.id : null };
        }
        return { rect: range.getBoundingClientRect(), exact, anchor: { type: 'text', field, exact, ...context, heading }, quote: exact, articleId: app.state.route.id };
    }

    function hideToolbar() { ui.toolbar?.remove(); ui.toolbar = null; }
    function showToolbar(info) {
        hideToolbar();
        const bar = document.createElement('div');
        bar.className = 'dk-ai-toolbar';
        const canRewrite = info.anchor.type === 'text' && user().admin;
        bar.innerHTML = `<button data-mode="qa">✦ 问 AI</button><button data-mode="note">📝 AI 笔记</button>${canRewrite ? '<button data-mode="rewrite">✎ AI 改写</button>' : ''}`;
        document.body.appendChild(bar);
        const width = bar.offsetWidth;
        const top = info.rect.top > 56 ? info.rect.top - 44 : info.rect.bottom + 8;
        bar.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, info.rect.left + info.rect.width / 2 - width / 2))}px`;
        bar.style.top = `${top}px`;
        bar.addEventListener('mousedown', event => event.preventDefault());
        bar.addEventListener('click', event => {
            const mode = event.target.closest('[data-mode]')?.dataset.mode;
            if (!mode) return;
            hideToolbar();
            openPopover({ ...info, mode });
        });
        ui.toolbar = bar;
    }

    document.addEventListener('mouseup', event => {
        if (event.target.closest?.('.dk-ai-toolbar, .dk-ai-pop')) return;
        setTimeout(() => {
            const info = selectionInfo();
            if (info) showToolbar(info); else hideToolbar();
        }, 10);
    });
    document.addEventListener('scroll', hideToolbar, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') { hideToolbar(); closePopover(); hideTip(); }
    });

    // ---------------- 悬浮问答框 ----------------
    let popAbort = null;
    function closePopover() {
        popAbort?.abort();
        popAbort = null;
        ui.pop?.remove();
        ui.pop = null;
    }

    function placePopover(pop, rect) {
        const width = Math.min(520, window.innerWidth - 24);
        pop.style.width = `${width}px`;
        if (!rect) {
            pop.style.left = `${(window.innerWidth - width) / 2}px`;
            pop.style.top = '12vh';
            return;
        }
        const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
        pop.style.left = `${left}px`;
        // 放在空间更大的一侧，并限制高度，保证整个问答框都在窗口内
        const spaceBelow = window.innerHeight - rect.bottom - 24;
        const spaceAbove = rect.top - 72;
        if (spaceBelow >= 420 || spaceBelow >= spaceAbove) {
            pop.style.top = `${rect.bottom + 12}px`;
            pop.style.maxHeight = `${Math.max(260, spaceBelow)}px`;
        } else {
            const height = Math.min(620, spaceAbove);
            pop.style.top = `${rect.top - 12 - height}px`;
            pop.style.maxHeight = `${height}px`;
            pop.style.height = `${height}px`;
        }
    }

    function openPopover(info) {
        closePopover();
        const pop = document.createElement('section');
        pop.className = 'dk-ai-pop';
        pop.setAttribute('role', 'dialog');
        let mode = info.mode || 'qa';
        let annotationId = info.annotationId || null;
        let rewrite = null;
        const available = S.status?.available;
        const render = () => {
            pop.innerHTML = `<header><div class="dk-ai-modes">${Object.entries(KIND).filter(([key]) => key !== 'rewrite' || (info.anchor.type === 'text' && user().admin)).map(([key, item]) => `<button class="${key === mode ? 'is-active' : ''}" data-switch="${key}" ${annotationId ? 'disabled' : ''}>${item.icon} ${key === 'qa' ? '问 AI' : key === 'note' ? 'AI 笔记' : 'AI 改写'}</button>`).join('')}</div>
                <span class="dk-ai-drag" title="拖动">⠿</span><button class="dk-ai-x" data-close aria-label="关闭">×</button></header>
                ${info.quote ? `<blockquote class="dk-ai-quote">${esc(info.quote.length > 220 ? `${info.quote.slice(0, 220)}…` : info.quote)}<small>${esc(anchorLabel({ anchor: info.anchor, quote: info.quote }))}</small></blockquote>` : ''}
                ${available === false ? '<div class="dk-ai-warn">平台尚未配置可用的 AI 模型。请管理员在平台的「AI 设置」中配置模型与 API Key 后再使用。</div>' : ''}
                <div class="dk-ai-chips">${QUICK[mode].map(text => `<button data-quick="${esc(text)}">${esc(text)}</button>`).join('')}</div>
                <form class="dk-ai-ask"><textarea rows="2" placeholder="${annotationId ? '继续追问…' : mode === 'qa' ? '想问什么？例如：为什么 P-bit 必须为 0？（回车发送）' : mode === 'note' ? '可选：笔记的关注点（直接回车即可生成）' : '可选：改写要求（直接回车即可生成）'}"></textarea><button class="dk-btn small" ${available === false ? 'disabled' : ''}>发送</button></form>
                <div class="dk-ai-output" hidden><div class="dk-markdown dk-ai-answer"></div></div>
                <footer class="dk-ai-foot" hidden></footer>`;
        };
        render();
        document.body.appendChild(pop);
        placePopover(pop, info.rect);
        ui.pop = pop;
        pop.querySelector('textarea')?.focus();
        if (info.presetQuestion) pop.querySelector('textarea').value = info.presetQuestion;

        const send = async () => {
            const textarea = pop.querySelector('textarea');
            const question = textarea.value.trim();
            if (mode === 'qa' && !question && !annotationId) { textarea.focus(); textarea.placeholder = '请先输入问题，或点上面的快捷问题'; return; }
            const output = pop.querySelector('.dk-ai-output');
            const answer = pop.querySelector('.dk-ai-answer');
            const foot = pop.querySelector('.dk-ai-foot');
            output.hidden = false;
            foot.hidden = true;
            answer.innerHTML = '<div class="dk-ai-thinking"><i></i><i></i><i></i> AI 正在思考…</div>';
            pop.querySelector('.dk-ai-ask button').disabled = true;
            textarea.disabled = true;
            let raw = '';
            let timer = null;
            const flush = () => { timer = null; renderMarkdown(answer, visibleText(raw), { findArticle: app.findArticle }); answer.parentElement.scrollTop = answer.parentElement.scrollHeight; };
            popAbort = new AbortController();
            try {
                const result = await stream({
                    mode, question, articleId: info.articleId, anchor: info.anchor, quote: info.quote, visualContext: info.visualContext, annotationId
                }, delta => { raw += delta; if (!timer) timer = setTimeout(flush, 90); }, popAbort.signal);
                clearTimeout(timer);
                if (result.rewrite) {
                    rewrite = result;
                    answer.innerHTML = `<div class="dk-ai-diff"><div><b>原文</b><del>${esc(result.rewrite.original)}</del></div><div><b>改写后</b><ins>${esc(result.rewrite.replacement)}</ins></div></div><p class="dk-mini-note">${esc(result.brief)}</p>`;
                    foot.innerHTML = '<button class="dk-btn small" data-apply>✔ 应用到原文</button><button class="dk-btn small ghost" data-retry>重新生成</button><span class="dk-mini-note">应用后可在“历史”中回退</span>';
                } else {
                    const annotation = result.annotation;
                    annotationId = annotation.id;
                    renderMd(answer, annotation.turns.at(-1).a);
                    foot.innerHTML = `<span class="dk-ai-saved">✔ 已保存：${esc(annotation.title)}</span><button class="dk-btn small ghost" data-follow>💬 追问</button><button class="dk-btn small ghost" data-open="${annotation.id}">在侧栏查看</button>`;
                    upsert(annotation);
                    refreshHighlights();
                }
                foot.hidden = false;
            } catch (error) {
                if (error.name === 'AbortError') return;
                answer.innerHTML = `<div class="dk-ai-warn">${esc(error.message)}</div>`;
            } finally {
                popAbort = null;
                if (pop.isConnected) {
                    pop.querySelector('.dk-ai-ask button').disabled = false;
                    textarea.disabled = false;
                    textarea.value = '';
                    if (annotationId) textarea.placeholder = '继续追问…（回车发送）';
                }
            }
        };

        pop.addEventListener('click', async event => {
            if (event.target.closest('[data-close]')) return closePopover();
            const switchTo = event.target.closest('[data-switch]')?.dataset.switch;
            if (switchTo && !annotationId) { mode = switchTo; render(); pop.querySelector('textarea').focus(); return; }
            const quick = event.target.closest('[data-quick]')?.dataset.quick;
            if (quick) { pop.querySelector('textarea').value = quick; send(); return; }
            if (event.target.closest('[data-follow]')) { pop.querySelector('textarea').focus(); return; }
            const openId = event.target.closest('[data-open]')?.dataset.open;
            if (openId) { openPanel(); expandItem(openId); return; }
            if (event.target.closest('[data-retry]')) { send(); return; }
            if (event.target.closest('[data-apply]') && rewrite) {
                try {
                    const result = await request('/ai/apply', { method: 'POST', body: { articleId: info.articleId, rewrite: rewrite.rewrite, title: rewrite.title, brief: rewrite.brief, question: rewrite.question } });
                    app.toast('已按 AI 建议改写原文（可在“历史”中回退）', 'ok');
                    closePopover();
                    upsert(result.annotation);
                    await app.reloadArticle(info.articleId);
                } catch (error) {
                    app.toast(error.message, 'bad');
                }
            }
        });
        pop.addEventListener('submit', event => { event.preventDefault(); send(); });
        pop.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && event.target.matches('textarea')) { event.preventDefault(); send(); }
        });
        // 拖动标题栏移动悬浮框
        pop.addEventListener('pointerdown', event => {
            if (!event.target.closest('.dk-ai-drag')) return;
            const startX = event.clientX - pop.offsetLeft;
            const startY = event.clientY - pop.offsetTop;
            const move = moveEvent => { pop.style.left = `${moveEvent.clientX - startX}px`; pop.style.top = `${moveEvent.clientY - startY}px`; };
            const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up);
        });
        if (info.autoSend) send();
    }

    // ---------------- 高亮与悬停卡片 ----------------
    function textIndex(root) {
        const nodes = [];
        let text = '';
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: node => node.parentElement.closest('svg, script, style, .dk-ai-pop, .dk-block-ai, figcaption, .dk-src-badge') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        let lastSpace = true;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const value = node.nodeValue;
            for (let i = 0; i < value.length; i += 1) {
                const space = /\s/.test(value[i]);
                if (space && lastSpace) continue;
                text += space ? ' ' : value[i];
                nodes.push([node, i]);
                lastSpace = space;
            }
        }
        return { text, nodes };
    }

    function findRange(root, anchor) {
        const { text, nodes } = textIndex(root);
        const needle = squash(anchor.exact);
        if (!needle) return null;
        const hits = [];
        for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) hits.push(i);
        if (!hits.length) return null;
        const before = squash(anchor.prefix);
        const after = squash(anchor.suffix);
        const score = index => {
            const pre = text.slice(Math.max(0, index - before.length), index).trimEnd();
            const post = text.slice(index + needle.length).trimStart();
            let a = 0;
            while (a < pre.length && a < before.length && pre[pre.length - 1 - a] === before[before.length - 1 - a]) a += 1;
            let b = 0;
            while (b < post.length && b < after.length && post[b] === after[b]) b += 1;
            return a + b;
        };
        const index = hits.sort((x, y) => score(y) - score(x))[0];
        const [startNode, startOffset] = nodes[index];
        const [endNode, endOffset] = nodes[index + needle.length - 1];
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset + 1);
        return range;
    }

    function wrapRange(range, attrs) {
        const texts = [];
        const walker = document.createTreeWalker(range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) if (range.intersectsNode(node)) texts.push(node);
        texts.forEach(node => {
            let target = node;
            if (node === range.endContainer && range.endOffset < node.length) node.splitText(range.endOffset);
            if (node === range.startContainer && range.startOffset > 0) target = node.splitText(range.startOffset);
            if (!target.nodeValue.trim()) return;
            const mark = document.createElement('mark');
            Object.entries(attrs).forEach(([key, value]) => mark.setAttribute(key, value));
            target.parentNode.insertBefore(mark, target);
            mark.appendChild(target);
        });
    }

    function clearHighlights() {
        document.querySelectorAll('mark.dk-anno').forEach(mark => mark.replaceWith(...mark.childNodes));
        document.querySelectorAll('.dk-block-badge').forEach(node => node.remove());
    }

    function blockElements() {
        const body = document.getElementById('articleBody');
        return body ? [...body.querySelectorAll('.dk-mermaid, .dk-code, .dk-table-wrap, img')] : [];
    }
    const blockKind = element => element.matches('.dk-mermaid') ? 'mermaid' : element.matches('.dk-code') ? 'code' : element.matches('img') ? 'image' : 'table';

    function refreshHighlights() {
        if (app.state.route?.name !== 'article') return;
        clearHighlights();
        const roots = { body: document.getElementById('articleBody'), summary: document.querySelector('.dk-summary'), keyPoints: document.querySelector('.dk-keypoints ol') };
        S.list.filter(item => item.anchor?.type === 'text').forEach(item => {
            const root = roots[item.anchor.field] || roots.body;
            const range = root && findRange(root, item.anchor);
            if (range) wrapRange(range, { class: `dk-anno is-${item.kind}`, 'data-anno': item.id });
        });
        const blocks = blockElements();
        const grouped = new Map();
        S.list.filter(item => item.anchor?.type === 'block').forEach(item => {
            const element = blocks.filter(block => blockKind(block) === item.anchor.block)[item.anchor.index];
            if (!element) return;
            if (!grouped.has(element)) grouped.set(element, []);
            grouped.get(element).push(item.id);
        });
        grouped.forEach((ids, element) => {
            const badge = document.createElement('button');
            badge.className = 'dk-block-badge';
            badge.dataset.annoList = ids.join(',');
            badge.textContent = `✦ ${ids.length}`;
            const host = element.matches('img') ? element.parentElement : element;
            host.querySelector(':scope > .dk-block-ai')?.prepend(badge);
        });
        updateVisualBadge();
        updateToggle();
    }

    function hideTip() { ui.tip?.remove(); ui.tip = null; }
    function showTip(target, ids) {
        hideTip();
        const items = ids.map(id => S.list.find(item => item.id === id)).filter(Boolean);
        if (!items.length) return;
        const tip = document.createElement('div');
        tip.className = 'dk-anno-tip';
        tip.innerHTML = items.map(item => `<button data-open="${item.id}"><span class="dk-ai-kind is-${item.kind}">${KIND[item.kind]?.icon}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.brief)}</p><small>${esc(item.createdBy)} · ${ago(item.updatedAt)} · 点击查看完整内容</small></div></button>`).join('');
        document.body.appendChild(tip);
        const rect = target.getBoundingClientRect();
        tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, rect.left))}px`;
        tip.style.top = `${rect.bottom + 8 + tip.offsetHeight < window.innerHeight ? rect.bottom + 8 : rect.top - tip.offsetHeight - 8}px`;
        tip.addEventListener('mouseleave', hideTip);
        ui.tip = tip;
    }

    let tipTimer = null;
    document.addEventListener('mouseover', event => {
        const target = event.target.closest?.('mark.dk-anno, .dk-block-badge, [data-visual-anno]');
        if (!target) return;
        clearTimeout(tipTimer);
        tipTimer = setTimeout(() => {
            const ids = target.dataset.anno ? [...new Set([...document.querySelectorAll(`mark.dk-anno`)].filter(mark => mark === target || mark.contains(target) || target.contains(mark)).map(mark => mark.dataset.anno))] : (target.dataset.annoList || target.dataset.visualAnno || '').split(',').filter(Boolean);
            showTip(target, ids);
        }, 220);
    });
    document.addEventListener('mouseout', event => {
        if (!event.target.closest?.('mark.dk-anno, .dk-block-badge, [data-visual-anno]')) return;
        clearTimeout(tipTimer);
        setTimeout(() => { if (ui.tip && !ui.tip.matches(':hover')) hideTip(); }, 260);
    });
    document.addEventListener('click', event => {
        const open = event.target.closest('.dk-anno-tip [data-open]')?.dataset.open;
        if (open) { hideTip(); openPanel(); expandItem(open, { jump: false }); return; }
        const mark = event.target.closest('mark.dk-anno');
        if (mark && !window.getSelection()?.toString()) { openPanel(); expandItem(mark.dataset.anno, { jump: false }); }
        const badge = event.target.closest('.dk-block-badge');
        if (badge) { openPanel(); expandItem(badge.dataset.annoList.split(',')[0], { jump: false }); }
        const blockAsk = event.target.closest('[data-block-ai]');
        if (blockAsk) askBlock(blockAsk);
        const visualAsk = event.target.closest('[data-visual-ai]');
        if (visualAsk) askVisual(visualAsk.dataset.visualAi);
    });

    // ---------------- 图表 / 代码 / 表格 / 图片 ----------------
    function decorateBlocks() {
        const counters = {};
        blockElements().forEach(element => {
            const kind = blockKind(element);
            counters[kind] = (counters[kind] || 0) + 1;
            const host = element.matches('img') ? element.parentElement : element;
            if (host.querySelector(':scope > .dk-block-ai')) return;
            host.classList.add('dk-has-block-ai');
            const tools = document.createElement('div');
            tools.className = 'dk-block-ai';
            tools.innerHTML = `<button data-block-ai="qa" data-kind="${kind}" data-index="${counters[kind] - 1}">✦ 问 AI</button><button data-block-ai="note" data-kind="${kind}" data-index="${counters[kind] - 1}">📝 笔记</button>`;
            host.prepend(tools);
        });
    }

    function askBlock(button) {
        const kind = button.dataset.kind;
        const index = Number(button.dataset.index);
        const element = blockElements().filter(block => blockKind(block) === kind)[index];
        if (!element) return;
        const source = kind === 'mermaid' ? (element.dataset.source || element.textContent) : kind === 'code' ? element.querySelector('code')?.textContent : kind === 'image' ? `图片：${element.getAttribute('alt') || element.getAttribute('src')}` : element.querySelector('table')?.innerText;
        let heading = element;
        while (heading && !/^H[1-4]$/.test(heading.tagName)) heading = heading.previousElementSibling || heading.parentElement?.previousElementSibling;
        const label = { mermaid: '流程图（Mermaid 源码）', code: '代码 / 报文图', table: '表格', image: '图片' }[kind];
        openPopover({
            mode: button.dataset.blockAi, rect: element.getBoundingClientRect().top > 0 ? element.getBoundingClientRect() : null,
            articleId: app.state.route.id, quote: `${label}：\n${String(source || '').slice(0, 3800)}`,
            anchor: { type: 'block', block: kind, index, snippet: squash(source).slice(0, 200), heading: squash(heading?.textContent || '').slice(0, 120) }
        });
    }

    // ---------------- 教学图 / 交互实验室 ----------------
    function labContext(labElement) {
        return `交互实验室：${labElement.querySelector('h3')?.textContent || ''}\n${squash(labElement.innerText).slice(0, 2500)}`;
    }

    function describeVisual(context) {
        if (!context) return '';
        return [`教学场景：${context.title}`, context.subtitle, `参数：${JSON.stringify(context.options)}`, `时间轴：${Math.round(context.t * 100)}%`,
            context.step ? `当前步骤：${context.step.title} —— ${context.step.text}` : '',
            context.part ? `选中部件：${context.part.name}：${context.part.desc}${context.part.rows?.length ? `（${context.part.rows.join('；')}）` : ''}` : '未选中部件'].filter(Boolean).join('\n');
    }

    function askVisual(mode) {
        const current = S.visual;
        if (!current) return;
        const visual = app.VISUALS.get(current.id);
        if (visual.kind === 'lesson') {
            const context = current.handle.getContext();
            openPopover({
                mode, rect: null, articleId: app.state.route?.name === 'article' ? app.state.route.id : null,
                quote: context.part ? `${context.part.name}：${context.part.desc}` : (context.step ? `${context.step.title}：${context.step.text}` : context.title),
                visualContext: describeVisual(context),
                anchor: { type: 'visual', visualId: current.id, partId: context.part?.id || '', partName: context.part?.name || '', stepTitle: context.step?.title || '', t: context.t, options: context.options }
            });
        } else {
            const lab = current.container.querySelector('.dk-lab');
            openPopover({ mode, rect: null, articleId: app.state.route?.name === 'article' ? app.state.route.id : null, quote: visual.title, visualContext: labContext(lab), anchor: { type: 'visual', visualId: current.id, partName: '' } });
        }
    }

    function decorateVisual(detail) {
        S.visual = detail;
        const visual = app.VISUALS.get(detail.id);
        const host = visual.kind === 'lesson' ? detail.handle.root.querySelector('.dk-lesson-controls') : detail.container.querySelector('.dk-lab-head');
        if (!host || host.querySelector('.dk-visual-ai')) return;
        const tools = document.createElement('div');
        tools.className = 'dk-visual-ai';
        tools.innerHTML = `<button data-visual-ai="qa" title="就当前场景、步骤或选中的部件提问">✦ 问 AI</button><button data-visual-ai="note" title="把当前场景整理成笔记">📝 笔记</button><button class="dk-visual-count" hidden></button>`;
        host.appendChild(tools);
        updateVisualBadge();
    }

    function updateVisualBadge() {
        const current = S.visual;
        if (!current) return;
        const host = (current.handle?.root || current.container)?.querySelector('.dk-visual-count');
        if (!host) return;
        const ids = S.list.filter(item => item.anchor?.type === 'visual' && item.anchor.visualId === current.id).map(item => item.id);
        host.hidden = !ids.length;
        host.textContent = `📌 ${ids.length}`;
        host.dataset.visualAnno = ids.join(',');
    }

    // ---------------- 侧栏 ----------------
    function upsert(annotation) {
        [S.list, S.all].forEach(list => {
            const index = list.findIndex(item => item.id === annotation.id);
            if (index >= 0) list.splice(index, 1);
            list.unshift(annotation);
        });
        renderPanel();
        document.dispatchEvent(new CustomEvent('dk:annotations-changed'));
    }

    function updateToggle() {
        if (!toggle) return;
        toggle.querySelector('b').textContent = S.list.length ? String(S.list.length) : '';
    }

    function setWidth(width) {
        const clamped = Math.round(Math.max(300, Math.min(Math.min(780, window.innerWidth * 0.6), width)));
        document.documentElement.style.setProperty('--ai-w', `${clamped}px`);
        storeSet(WIDTH_KEY, String(clamped));
    }

    function openPanel() {
        if (!panel.hidden) return;
        panel.hidden = false;
        document.body.classList.add('has-ai-panel');
        storeSet(OPEN_KEY, '1');
        if (S.scope === 'all') loadAll();
        renderPanel();
    }
    function closePanel() {
        panel.hidden = true;
        document.body.classList.remove('has-ai-panel');
        storeSet(OPEN_KEY, '0');
    }

    async function loadAll() {
        try { S.all = (await request('/annotations?scope=all')).annotations; } catch (error) { app.toast(error.message, 'bad'); }
        renderPanel();
    }

    function filtered() {
        const list = S.scope === 'all' ? S.all : S.list;
        const keyword = S.filter.toLowerCase();
        return list.filter(item => (S.kind === 'all' || item.kind === S.kind) && (!keyword || `${item.title} ${item.brief} ${item.quote}`.toLowerCase().includes(keyword)));
    }

    function itemHtml(item) {
        const expanded = S.expanded.has(item.id);
        const canEdit = user().admin || item.createdBy === user().name;
        const article = item.articleId && articleTitle(item.articleId);
        return `<article class="dk-ai-item is-${item.kind}${expanded ? ' is-open' : ''}" data-item="${item.id}">
            <button class="dk-ai-item-head" data-toggle="${item.id}"><span class="dk-ai-kind is-${item.kind}">${KIND[item.kind]?.icon}</span>
                <div><strong>${esc(item.title)}</strong><p>${esc(item.brief)}</p>
                <small>${S.scope === 'all' && article ? `${esc(article.shortTitle || article.title)} · ` : ''}${esc(anchorLabel(item))} · ${esc(item.createdBy || '匿名')} · ${ago(item.updatedAt)}</small></div><i class="dk-chevron"></i></button>
            ${expanded ? `<div class="dk-ai-item-body">${item.turns.map((turn, index) => `<div class="dk-ai-turn">${turn.q ? `<div class="dk-ai-q"><b>${index ? '追问' : '问'}</b>${esc(turn.q)}</div>` : ''}${turn.before ? `<div class="dk-ai-diff"><div><b>原文</b><del>${esc(turn.before)}</del></div></div>` : ''}<div class="dk-markdown dk-ai-a" data-turn="${index}"></div></div>`).join('')}
                <div class="dk-ai-item-actions"><button data-jump="${item.id}">📍 定位原文</button>${item.kind !== 'rewrite' ? `<button data-followup="${item.id}">💬 追问</button>` : ''}${canEdit ? `<button data-edit="${item.id}">✏️ 编辑</button><button data-remove="${item.id}">🗑 删除</button>` : ''}</div></div>` : ''}
        </article>`;
    }

    function renderPanel() {
        if (!panel || panel.hidden) { updateToggle(); return; }
        const list = filtered();
        const pageLabel = app.state.route?.name === 'article' ? '本文' : app.state.route?.name === 'lab' ? '本实验' : '本页';
        panel.innerHTML = `<div class="dk-ai-resize" title="拖动调整宽度"></div>
            <header class="dk-ai-head"><div><div class="dk-hud-kicker">AI COPILOT</div><h3>AI 问答与笔记</h3></div><button class="dk-icon-btn" data-panel-close aria-label="关闭侧栏">×</button></header>
            ${S.status && !S.status.available ? '<div class="dk-ai-warn">平台尚未配置可用的 AI 模型，提问前请管理员在「AI 设置」中配置。</div>' : ''}
            <form class="dk-ai-panel-ask"><textarea rows="2" placeholder="就${pageLabel}向 AI 提问，或在正文中选中文字提问…"></textarea>
                <div><button class="dk-btn small" data-panel-mode="qa">✦ 提问</button><button class="dk-btn small ghost" data-panel-mode="note">📝 生成本页笔记</button></div></form>
            <div class="dk-ai-filters"><div class="dk-nav-mode"><button class="${S.scope === 'page' ? 'is-active' : ''}" data-scope="page">${pageLabel} · ${S.list.length}</button><button class="${S.scope === 'all' ? 'is-active' : ''}" data-scope="all">全部</button></div>
                <div class="dk-ai-kinds">${[['all', '全部'], ...Object.entries(KIND).map(([key, item]) => [key, `${item.icon} ${item.label}`])].map(([key, label]) => `<button class="${S.kind === key ? 'is-active' : ''}" data-kind="${key}">${label}</button>`).join('')}</div>
                <input class="dk-input slim" data-filter placeholder="搜索标题或内容" value="${esc(S.filter)}"></div>
            <div class="dk-ai-list">${list.map(itemHtml).join('') || `<div class="dk-ai-empty">${S.scope === 'page' ? '这里还没有问答或笔记。<br>在正文中<b>选中文字</b>，或点击图表、教学场景上的 <b>✦ 问 AI</b> 试试。' : '暂无记录'}</div>`}</div>`;
        panel.querySelectorAll('.dk-ai-a').forEach(node => {
            const item = list.find(entry => entry.id === node.closest('[data-item]').dataset.item);
            renderMd(node, item.turns[Number(node.dataset.turn)].a);
        });
        updateToggle();
    }

    function expandItem(id, { jump = true } = {}) {
        S.expanded.add(id);
        if (!S.list.some(item => item.id === id) && S.scope === 'page') S.scope = 'all';
        if (S.scope === 'all' && !S.all.length) loadAll();
        renderPanel();
        panel.querySelector(`[data-item="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (jump) jumpTo(id);
    }

    function pulse(element) {
        element.classList.remove('dk-ai-pulse');
        void element.offsetWidth;
        element.classList.add('dk-ai-pulse');
        setTimeout(() => element.classList.remove('dk-ai-pulse'), 2400);
    }

    // 点击问答/笔记：跳到对应文章与位置；教学场景恢复当时的参数、时间轴和选中部件
    function jumpTo(id) {
        const item = [...S.list, ...S.all].find(entry => entry.id === id);
        if (!item) return;
        const anchor = item.anchor || {};
        const route = app.state.route || {};
        if (item.articleId && !(route.name === 'article' && route.id === item.articleId)) {
            S.pendingJump = id;
            location.hash = `#/a/${item.articleId}`;
            return;
        }
        if (!item.articleId && anchor.type === 'visual' && !(route.name === 'lab' && route.id === anchor.visualId)) {
            S.pendingJump = id;
            location.hash = `#/lab/${anchor.visualId}`;
            return;
        }
        if (anchor.type === 'text') {
            const marks = [...document.querySelectorAll(`mark.dk-anno[data-anno="${id}"]`)];
            if (marks.length) { marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); marks.forEach(pulse); }
            else app.toast('原文已变化，未能精确定位到这段文字', 'info');
        } else if (anchor.type === 'block') {
            const element = blockElements().filter(block => blockKind(block) === anchor.block)[anchor.index];
            if (element) { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); pulse(element); }
        } else if (anchor.type === 'visual') {
            const restore = () => {
                const current = S.visual;
                if (!current || current.id !== anchor.visualId) return false;
                (current.handle.root || current.container).scrollIntoView({ behavior: 'smooth', block: 'center' });
                current.handle.restore?.({ t: anchor.t, options: anchor.options, partId: anchor.partId });
                pulse(current.handle.root || current.container);
                return true;
            };
            if (restore()) return;
            const tab = document.querySelector(`[data-visual="${anchor.visualId}"]`);
            if (tab) { S.pendingJump = id; tab.click(); return; }
            S.pendingJump = id;
            location.hash = `#/lab/${anchor.visualId}`;
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    if (panel) {
        panel.addEventListener('click', async event => {
            if (event.target.closest('[data-panel-close]')) return closePanel();
            const scope = event.target.closest('[data-scope]')?.dataset.scope;
            if (scope) { S.scope = scope; if (scope === 'all') loadAll(); renderPanel(); return; }
            const kind = event.target.closest('[data-kind]')?.dataset.kind;
            if (kind) { S.kind = kind; renderPanel(); return; }
            const toggleId = event.target.closest('[data-toggle]')?.dataset.toggle;
            if (toggleId) {
                if (S.expanded.has(toggleId)) { S.expanded.delete(toggleId); renderPanel(); }
                else expandItem(toggleId);
                return;
            }
            const jumpId = event.target.closest('[data-jump]')?.dataset.jump;
            if (jumpId) return jumpTo(jumpId);
            const follow = event.target.closest('[data-followup]')?.dataset.followup;
            if (follow) {
                const item = [...S.list, ...S.all].find(entry => entry.id === follow);
                return openPopover({ mode: item.kind, rect: null, articleId: item.articleId, anchor: item.anchor, quote: item.quote, annotationId: item.id });
            }
            const editId = event.target.closest('[data-edit]')?.dataset.edit;
            if (editId) {
                const node = panel.querySelector(`[data-item="${editId}"] .dk-ai-item-body`);
                const item = [...S.list, ...S.all].find(entry => entry.id === editId);
                node.innerHTML = `<form class="dk-ai-edit" data-edit-form="${editId}"><input class="dk-input slim" name="title" maxlength="40" value="${esc(item.title)}"><textarea class="dk-input" name="content" rows="10">${esc(item.turns.at(-1).a)}</textarea><div><button class="dk-btn small">保存</button><button type="button" class="dk-btn small ghost" data-toggle="${editId}">取消</button></div></form>`;
                return;
            }
            const removeId = event.target.closest('[data-remove]')?.dataset.remove;
            if (removeId && confirm('确定删除这条问答/笔记吗？')) {
                try {
                    await request(`/annotations/${removeId}?tenantId=${encodeURIComponent(app.state.tenantId)}`, { method: 'DELETE' });
                    S.list = S.list.filter(item => item.id !== removeId);
                    S.all = S.all.filter(item => item.id !== removeId);
                    refreshHighlights();
                    renderPanel();
                    document.dispatchEvent(new CustomEvent('dk:annotations-changed'));
                } catch (error) { app.toast(error.message, 'bad'); }
            }
        });
        panel.addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.target;
            if (form.matches('[data-edit-form]')) {
                try {
                    const { annotation } = await request(`/annotations/${form.dataset.editForm}`, { method: 'PUT', body: { title: form.title.value, content: form.content.value } });
                    upsert(annotation);
                } catch (error) { app.toast(error.message, 'bad'); }
            }
        });
        panel.addEventListener('click', event => {
            const mode = event.target.closest('[data-panel-mode]')?.dataset.panelMode;
            if (!mode) return;
            event.preventDefault();
            const question = panel.querySelector('.dk-ai-panel-ask textarea').value.trim();
            const route = app.state.route || {};
            const base = route.name === 'article'
                ? { articleId: route.id, anchor: { type: 'article' }, quote: '' }
                : route.name === 'lab' && S.visual ? null : { articleId: null, anchor: { type: 'article' }, quote: '' };
            if (!base) { askVisual(mode); return; }
            if (mode === 'qa' && !question) { panel.querySelector('.dk-ai-panel-ask textarea').focus(); return; }
            openPopover({ ...base, mode, rect: null, autoSend: true, presetQuestion: question });
            panel.querySelector('.dk-ai-panel-ask textarea').value = '';
        });
        panel.addEventListener('input', event => {
            if (!event.target.matches('[data-filter]')) return;
            S.filter = event.target.value;
            const caret = event.target.selectionStart;
            renderPanel();
            const input = panel.querySelector('[data-filter]');
            input.focus();
            input.setSelectionRange(caret, caret);
        });
        panel.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && event.target.matches('.dk-ai-panel-ask textarea')) {
                event.preventDefault();
                panel.querySelector('[data-panel-mode="qa"]').click();
            }
        });
        // 左边缘拖动调整侧栏宽度
        panel.addEventListener('pointerdown', event => {
            if (!event.target.closest('.dk-ai-resize')) return;
            event.preventDefault();
            document.body.classList.add('is-resizing');
            const move = moveEvent => setWidth(window.innerWidth - moveEvent.clientX);
            const up = () => { document.body.classList.remove('is-resizing'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up);
        });
    }
    toggle?.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
    setWidth(Number(storeGet(WIDTH_KEY)) || 400);

    // ---------------- 与主应用的生命周期对接 ----------------
    async function loadPage(route) {
        S.list = [];
        try {
            if (route?.name === 'article') S.list = (await request(`/annotations?articleId=${encodeURIComponent(route.id)}`)).annotations;
            else if (route?.name === 'lab') S.list = (await request(`/annotations?visualId=${encodeURIComponent(route.id)}`)).annotations;
        } catch (error) { console.warn('[ai-notes]', error.message); }
    }

    document.addEventListener('dk:route', event => {
        S.route = event.detail.route;
        S.visual = null;
        hideToolbar(); hideTip(); closePopover();
        if (event.detail.route?.name !== 'article') loadPage(event.detail.route).then(() => { renderPanel(); updateVisualBadge(); runPendingJump(); });
    });
    document.addEventListener('dk:article-rendered', async event => {
        await loadPage(app.state.route);
        if (app.state.route?.id !== event.detail.article.id) return;
        decorateBlocks();
        // Mermaid 异步渲染完成后再补一次区块按钮与徽标
        setTimeout(() => { decorateBlocks(); refreshHighlights(); }, 1500);
        refreshHighlights();
        renderPanel();
        runPendingJump();
    });
    document.addEventListener('dk:visual-mounted', event => {
        decorateVisual(event.detail);
        runPendingJump();
    });
    function runPendingJump() {
        if (!S.pendingJump) return;
        const id = S.pendingJump;
        S.pendingJump = null;
        setTimeout(() => jumpTo(id), 350);
    }

    request('/ai/status').then(status => { S.status = status; renderPanel(); }).catch(() => { S.status = { available: false }; });
    if (storeGet(OPEN_KEY) === '1') openPanel();

    // ---------------- 供「笔记问答」复习页使用 ----------------
    let suspended = false;
    const find = id => [...S.list, ...S.all].find(entry => entry.id === id);
    return {
        KIND, ago, anchorLabel, renderMd, user,
        async loadAll() {
            S.all = (await request('/annotations?scope=all')).annotations;
            return S.all;
        },
        jumpTo,
        followUp(id) {
            const item = find(id);
            if (item) openPopover({ mode: item.kind === 'rewrite' ? 'qa' : item.kind, rect: null, articleId: item.articleId, anchor: item.anchor, quote: item.quote, annotationId: item.id });
        },
        async remove(id) {
            await request(`/annotations/${id}?tenantId=${encodeURIComponent(app.state.tenantId)}`, { method: 'DELETE' });
            S.list = S.list.filter(item => item.id !== id);
            S.all = S.all.filter(item => item.id !== id);
            refreshHighlights();
            renderPanel();
        },
        async update(id, { title, content }) {
            const { annotation } = await request(`/annotations/${id}`, { method: 'PUT', body: { title, content } });
            [S.list, S.all].forEach(list => { const index = list.findIndex(item => item.id === id); if (index >= 0) list[index] = annotation; });
            renderPanel();
            return annotation;
        },
        // 复习页占满主区时收起右侧侧栏并禁用开关，离开后按用户原来的偏好恢复
        setSuspended(flag) {
            if (flag === suspended) return;
            suspended = flag;
            if (toggle) { toggle.disabled = flag; toggle.title = flag ? '笔记问答页已全屏展示全部问答与笔记' : 'AI 问答与笔记侧栏'; }
            if (flag) { panel.hidden = true; document.body.classList.remove('has-ai-panel'); }
            else if (storeGet(OPEN_KEY) === '1') openPanel();
        }
    };
}
