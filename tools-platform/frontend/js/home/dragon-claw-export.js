/**
 * Dragon Claw 对话导出为网页快照：克隆当前对话区，把用到的样式、图片和对话里的文件都内联进一个 HTML，
 * 离线打开与聊天界面一致，可直接转发。超过上限的大文件不打包，卡片上注明。
 * 由 js/home/dragon-claw.js 的「导出日志」菜单调用：window.DragonClawExport.buildHtml(...)
 */
(function () {
    if (window.DragonClawExport) return;

    const FILE_LIMIT = 25 * 1024 * 1024;   // 单个文件/图片超过此大小不打包
    const TOTAL_LIMIT = 120 * 1024 * 1024; // 整份快照内联内容的总上限
    const CSS_ASSET_LIMIT = 300 * 1024;    // 样式里引用的小图标/字体内联上限
    const VIEW_LIMIT = 512 * 1024;         // 工作区文件卡片附带「查看内容」的上限

    const T = {
        zh: { skipped: '超过 {size}，未打包进快照', missing: '文件不存在或无权限，未打包', view: '查看内容', exported: '导出于 {time}', note: '此网页由 Dragon Claw 导出，离线可看；图片与文件已打包在页面内。', trimmed: '只导出了最近 {days} 天内、最多 {count} 条消息，更早的记录未包含' },
        en: { skipped: 'Larger than {size}; not included', missing: 'Missing or no access; not included', view: 'View content', exported: 'Exported {time}', note: 'Exported from Dragon Claw. Works offline; images and files are embedded in this page.', trimmed: 'Only the last {days} days (up to {count} messages) are included; earlier messages are left out' }
    };
    const lang = () => String(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
    const t = (key, params = {}) => T[lang()][key].replace(/\{(\w+)\}/g, (_m, name) => params[name] ?? '');

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }
    function formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    const sameOrigin = url => { try { return new URL(url, location.href).origin === location.origin; } catch { return false; } };
    const absolute = url => { try { return new URL(url, location.href).href; } catch { return url; } };
    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    // 同一地址只下载一次；总量超出后其余文件不再打包
    function createInliner() {
        const cache = new Map();
        let used = 0;
        const skipped = new Set();
        async function fetchBlob(url, limit, knownSize) {
            if (Number.isFinite(knownSize) && (knownSize > limit || used + knownSize > TOTAL_LIMIT)) return { skipped: true, size: knownSize };
            const res = await fetch(url, { credentials: 'same-origin', headers: sameOrigin(url) ? authHeaders() : {} });
            if (!res.ok) return { missing: true };
            const blob = await res.blob();
            if (blob.size > limit || used + blob.size > TOTAL_LIMIT) return { skipped: true, size: blob.size };
            used += blob.size;
            return { dataUrl: await blobToDataUrl(blob), size: blob.size };
        }
        return {
            inline(url, { limit = FILE_LIMIT, size, key = url } = {}) {
                if (!cache.has(key)) {
                    cache.set(key, fetchBlob(absolute(url), limit, size).catch(() => ({ missing: true })).then(result => {
                        if (result.skipped) skipped.add(key);
                        return result;
                    }));
                }
                return cache.get(key);
            },
            skippedCount: () => skipped.size
        };
    }

    // ── 样式：只保留快照里用得到的规则 ──
    const DYNAMIC_PSEUDO = /::?(?:before|after|placeholder|marker|selection|first-letter|first-line|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+|hover|active|visited|focus-visible|focus-within|focus|target)(?![\w-])/g;
    function selectorUsed(selectorText, doc) {
        return selectorText.split(',').some(part => {
            const plain = part.replace(DYNAMIC_PSEUDO, '').trim();
            if (!plain) return true;
            try { return Boolean(doc.querySelector(plain)); } catch { return true; }
        });
    }
    function pruneRules(rules, doc, base, keyframes) {
        const out = [];
        for (const rule of rules) {
            if (rule instanceof CSSStyleRule) {
                if (selectorUsed(rule.selectorText, doc)) out.push(fixUrls(rule.cssText, base));
            } else if (rule instanceof CSSImportRule) {
                try { if (rule.styleSheet) out.push(pruneRules(rule.styleSheet.cssRules, doc, rule.styleSheet.href || base, keyframes)); } catch { /* 跨域样式表读不到规则 */ }
            } else if (rule instanceof CSSKeyframesRule) {
                keyframes.push(rule);
            } else if (rule.cssRules) {
                const inner = pruneRules(rule.cssRules, doc, base, keyframes);
                if (inner) out.push(`${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{\n${inner}\n}`);
            } else {
                out.push(fixUrls(rule.cssText, base));
            }
        }
        return out.filter(Boolean).join('\n');
    }
    function fixUrls(cssText, base) {
        return cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, url) => /^(?:data:|#)/.test(url) ? match : `url("${new URL(url, base).href}")`);
    }
    async function collectCss(doc, inliner) {
        const keyframes = [];
        const parts = [];
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            if (rules) parts.push(pruneRules(rules, doc, sheet.href || location.href, keyframes));
        }
        let css = parts.filter(Boolean).join('\n');
        css += '\n' + keyframes.filter(rule => css.includes(rule.name)).map(rule => rule.cssText).join('\n');
        // 样式里的同源小图标、字体内联；拿不到的保留原地址
        const urls = [...new Set([...css.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]).filter(url => !url.startsWith('data:') && sameOrigin(url)))];
        const resolved = await Promise.all(urls.map(url => inliner.inline(url, { limit: CSS_ASSET_LIMIT })));
        urls.forEach((url, index) => { if (resolved[index].dataUrl) css = css.split(`url("${url}")`).join(`url("${resolved[index].dataUrl}")`); });
        return css;
    }

    // ── 对话内容 ──
    // 只留最近一段：最多 maxMessages 条、不早于 since；从一条提问开始，不以半截回答开头。返回是否丢掉了更早的内容
    function trimToRecent(content, { since = -Infinity, maxMessages = Infinity } = {}) {
        const rows = [...content.children].filter(node => node.classList.contains('dc-msg'));
        let start = Math.max(0, rows.length - maxMessages);
        while (start < rows.length - 1 && Number(rows[start].dataset.dcTime) < since) start++;
        const firstUser = rows.slice(start).findIndex(node => node.classList.contains('dc-msg--user'));
        if (firstUser > 0) start += firstUser;
        const first = rows[start];
        if (!first || start === 0) return false;
        while (first.previousSibling) first.previousSibling.remove();
        return true;
    }

    function stripInteractive(root) {
        root.querySelectorAll([
            '.dc-history-more', '.dc-history-loading', '.dc-history-banner', '.dc-history-divider', '.dc-thinking',
            '[data-dc-message-toggle]', '[data-dc-copy]', '[data-dc-retry]',
            '.dc-plan-actions', '.dc-skill-draft', '.dc-cmd-link', '.desktop-agent-thinking', '.desktop-agent-history-load', '[data-desktop-back]', 'script'
        ].join(',')).forEach(node => node.remove());
        root.querySelectorAll('.is-collapsed, .is-streaming').forEach(node => node.classList.remove('is-collapsed', 'is-streaming'));
        root.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        root.querySelectorAll('[aria-controls]').forEach(node => node.removeAttribute('aria-controls'));
        root.querySelectorAll('button').forEach(button => { button.disabled = true; button.tabIndex = -1; });
    }

    function copyCanvases(source, clone) {
        const originals = source.querySelectorAll('canvas');
        clone.querySelectorAll('canvas').forEach((canvas, index) => {
            const img = document.createElement('img');
            try { img.src = originals[index].toDataURL('image/png'); } catch { return; }
            img.className = canvas.className;
            img.style.cssText = canvas.style.cssText;
            img.width = originals[index].clientWidth || canvas.width;
            canvas.replaceWith(img);
        });
    }

    async function inlineImages(root, inliner) {
        await Promise.all([...root.querySelectorAll('img')].map(async img => {
            img.removeAttribute('loading');
            img.removeAttribute('srcset');
            const src = img.getAttribute('src') || '';
            if (!src || src.startsWith('data:')) return;
            const result = await inliner.inline(src);
            if (result.dataUrl) {
                img.src = result.dataUrl;
                img.removeAttribute('data-download'); // 平台预览用的下载地址，快照里用不到，免得同一张图再存一份
            } else {
                img.src = absolute(src);
            }
        }));
    }

    async function inlineFileChips(root, inliner) {
        await Promise.all([...root.querySelectorAll('.ai-file-chip[data-ai-file]')].map(async chip => {
            const path = chip.dataset.aiFile;
            const name = chip.querySelector('.ai-file-chip-download')?.getAttribute('download') || path.split(/[\\/]/).pop();
            const meta = chip.querySelector('.ai-file-chip-meta');
            const info = await fetch(`/api/agent-files/stat?path=${encodeURIComponent(path)}`, { credentials: 'same-origin', headers: authHeaders() })
                .then(res => res.ok ? res.json() : null).catch(() => null);
            const result = info ? await inliner.inline(`/api/agent-files/raw?path=${encodeURIComponent(path)}&download=1`, { size: info.size, key: `file:${path}` }) : { missing: true };
            chip.querySelectorAll('a').forEach(link => {
                if (result.dataUrl) {
                    link.href = result.dataUrl;
                    link.setAttribute('download', name);
                } else {
                    link.removeAttribute('href');
                    link.removeAttribute('download');
                }
            });
            // 界面上可能已补过大小，去掉后重新写一次
            if (meta && info) meta.textContent = [...meta.textContent.split(' · ').filter(part => part && !/^\d+(?:\.\d+)? (?:B|KB|MB)$/.test(part)), formatSize(info.size)].join(' · ');
            if (!result.dataUrl) {
                chip.classList.add('is-missing');
                chip.querySelector('.ai-file-chip-download')?.remove();
                const reason = result.skipped ? t('skipped', { size: formatSize(FILE_LIMIT) }) : t('missing');
                chip.title = reason;
                if (meta) meta.textContent = [meta.textContent, reason].filter(Boolean).join(' · ');
            }
        }));
    }

    // 工作区写入的文件卡片：附带下载与「查看内容」；界面上已展开的预览/代码原样保留
    async function inlineFileCards(source, root, inliner) {
        const originals = source.querySelectorAll('.dc-file-card');
        await Promise.all([...root.querySelectorAll('.dc-file-card')].map(async (card, index) => {
            const original = originals[index];
            const { path, root: dir, session } = card.dataset;
            let data = null;
            if (path && dir && session) {
                data = await fetch(`/api/agent-workspace/file/${encodeURIComponent(session)}?root=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`, { credentials: 'same-origin', headers: authHeaders() })
                    .then(res => res.ok ? res.json() : null).catch(() => null);
            }
            card.querySelector('.dc-file-tabs')?.remove();
            card.querySelectorAll('.dc-file-btn').forEach(button => button.remove());
            card.classList.remove('is-expanded');
            const head = card.querySelector('.dc-file-head');
            const body = card.querySelector('.dc-file-body');
            if (!data) {
                if (body?.hidden) body.remove();
                return;
            }
            const meta = card.querySelector('.dc-file-meta');
            if (meta && !meta.textContent) meta.textContent = formatSize(data.size);
            const blobUrl = URL.createObjectURL(new Blob([data.content], { type: 'text/plain;charset=utf-8' }));
            const result = await inliner.inline(blobUrl, { key: `card:${dir}:${path}` });
            URL.revokeObjectURL(blobUrl);
            if (result.dataUrl && head) {
                const link = document.createElement('a');
                link.className = 'dc-file-btn';
                link.href = result.dataUrl;
                link.download = path.split(/[\\/]/).pop();
                link.textContent = '↓';
                head.appendChild(link);
            }
            if (body && !body.hidden) {
                // 展开中的 HTML/SVG 预览：iframe 内容由脚本写入，克隆不带，改用 srcdoc 写回
                const frame = body.querySelector('iframe');
                if (frame) frame.srcdoc = original?.querySelector('iframe')?.srcdoc || data.content;
                return;
            }
            body?.remove();
            if (data.content.length > VIEW_LIMIT) return;
            const details = document.createElement('details');
            details.className = 'dc-export-file-view';
            details.innerHTML = `<summary>${esc(t('view'))}</summary><pre class="dc-file-code"><code>${esc(data.content)}</code></pre>`;
            card.appendChild(details);
        }));
    }

    function absolutizeLinks(root) {
        root.querySelectorAll('a[href]').forEach(link => {
            const href = link.getAttribute('href');
            if (/^(?:data:|blob:|#|mailto:)/i.test(href)) return;
            link.href = absolute(href);
            if (!link.hasAttribute('download')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        });
    }

    // 快照页的布局覆盖：对话不再限高滚动，铺满整页
    const OVERRIDES = `
html, body { margin: 0; min-height: 100%; background: var(--v2-bg, #ffffff); color: var(--v2-ink, #1f2328); }
html { color-scheme: light; }
html[data-theme="dark"] { color-scheme: dark; }
html[data-theme="dark"], html[data-theme="dark"] body { background: var(--v2-bg, #0a0f1e); color: var(--v2-ink, #e2e8f0); }
body.dc-export { overflow: auto !important; }
.dc-export-shell { display: block !important; position: static !important; width: auto !important; max-width: none !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; transform: none !important; grid-template-columns: none !important; }
body.dc-export .dc { height: auto !important; min-height: 100vh !important; max-height: none !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; overflow: visible !important; }
body.dc-export .dc-thread { flex: none !important; overflow: visible !important; height: auto !important; max-height: none !important; }
body.dc-export .dc-chat-head { position: sticky; top: 0; z-index: 5; background: var(--v2-bg, #ffffff); backdrop-filter: none; animation: none; }
body.dc-export .dc-msg, body.dc-export .dc-ambient span { animation: none !important; }
.dc-export-meta { display: grid; gap: 2px; min-width: 0; text-align: right; color: var(--dc-muted, #8b9ab3); font-size: 12px; }
.dc-export-meta b { overflow: hidden; color: var(--dc-text, #e2e8f0); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.dc-export-stats { margin: 0 auto 26px; padding: 14px 16px; border: 1px solid var(--v2-line, rgba(148, 163, 184, 0.25)); border-radius: 14px; background: var(--v2-bg, transparent); color: var(--dc-text, inherit); font-size: 12.5px; overflow-x: auto; }
.dc-export-stats h2 { margin: 0 0 10px; font-size: 14px; font-weight: 650; }
.dc-export-stats table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.dc-export-stats th, .dc-export-stats td { padding: 6px 8px; border-bottom: 1px solid var(--v2-line, rgba(148, 163, 184, 0.2)); text-align: left; white-space: nowrap; }
.dc-export-stats td:nth-child(2) { white-space: normal; min-width: 160px; }
.dc-export-stats th { color: var(--dc-muted, #64748b); font-weight: 600; }
.dc-export-stats tfoot td { font-weight: 650; border-bottom: 0; }
.dc-export-stats .dc-export-stats-detail td { padding-top: 0; border-bottom-style: dashed; }
.dc-export-stats details summary { cursor: pointer; color: var(--dc-muted, #64748b); }
.dc-export-stats details table { margin: 6px 0 4px; font-size: 12px; }
.dc-export-trimmed { width: fit-content; max-width: 100%; margin: 0 auto 22px; padding: 5px 12px; border: 1px dashed rgba(148, 163, 184, 0.3); border-radius: 999px; color: var(--dc-muted, #8b9ab3); font-size: 12px; text-align: center; }
.dc-export-foot { padding: 8px 20px 28px; color: var(--dc-faint, #64748b); font-size: 12px; text-align: center; }
.dc-export-file-view { border-top: 1px solid rgba(148, 163, 184, 0.14); }
.dc-export-file-view > summary { padding: 7px 12px; color: var(--dc-muted, #8b9ab3); font-size: 12px; cursor: pointer; }
.dc-export-file-view > pre { max-height: 480px; margin: 0; overflow: auto; }
.dc-export-zoom { position: fixed; inset: 0; z-index: 99; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(2, 6, 23, 0.88); cursor: zoom-out; }
.dc-export-zoom img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; }
img[data-ai-zoom] { cursor: zoom-in; }
button:disabled { cursor: default; }
@media (max-width: 640px) { .dc-export-meta { display: none; } }`;

    // 快照里唯一的脚本：点图片放大
    const ZOOM_SCRIPT = `document.addEventListener('click',function(e){var z=document.querySelector('.dc-export-zoom');if(z){z.remove();return;}var img=e.target.closest&&e.target.closest('img[data-ai-zoom]');if(!img)return;var box=document.createElement('div');box.className='dc-export-zoom';var big=new Image();big.src=img.src;big.alt=img.alt;box.appendChild(big);document.body.appendChild(box);});document.addEventListener('keydown',function(e){if(e.key==='Escape'){var z=document.querySelector('.dc-export-zoom');if(z)z.remove();}});`;

    // 同一张图（头像、重复引用的截图）只存一份：出现多次的 data URL 放进脚本表，由页面加载时回填
    function dedupeImages(doc) {
        const groups = new Map();
        doc.querySelectorAll('img[src^="data:"]').forEach(img => {
            const src = img.getAttribute('src');
            if (src.length < 2048) return;
            if (!groups.has(src)) groups.set(src, []);
            groups.get(src).push(img);
        });
        const table = {};
        groups.forEach((imgs, src) => {
            if (imgs.length < 2) return;
            const key = `i${Object.keys(table).length}`;
            table[key] = src;
            imgs.forEach(img => {
                img.removeAttribute('src');
                img.dataset.dcSrc = key;
            });
        });
        if (!Object.keys(table).length) return '';
        return `(function(){var M=${JSON.stringify(table).replace(/</g, '\\u003c')};document.querySelectorAll('img[data-dc-src]').forEach(function(i){i.src=M[i.getAttribute('data-dc-src')];});})();`;
    }

    // section.dc 外层的祖先只保留标签和类名，让 `body.dc-chatting .dc-thread` 这类选择器照常生效
    function buildShell(doc, section) {
        let inner = null;
        let outer = null;
        for (let node = section.parentElement; node && node !== document.body; node = node.parentElement) {
            const copy = doc.createElement(node.tagName.toLowerCase());
            if (node.id) copy.id = node.id;
            if (node.className) copy.className = node.className;
            copy.classList.add('dc-export-shell');
            if (inner) copy.appendChild(outer); else inner = copy;
            outer = copy;
        }
        return { inner, outer };
    }

    // 导出开头的模型速度统计：每条回复一行（最低 / 平均 / 最高 tok/s、轮次、token、耗时），展开看每一轮的明细
    const ST = {
        zh: { title: '模型调用统计', reply: '回复', question: '问题', model: '模型', rounds: '轮次', tokens: '输入 / 输出 token', speed: '最低 / 平均 / 最高 tok/s', time: '耗时', round: '轮', start: '开始', ttft: '首字', duration: '耗时', tps: 'tok/s', total: '合计', est: '估算', detail: '每轮明细' },
        en: { title: 'Model call statistics', reply: 'Reply', question: 'Question', model: 'Model', rounds: 'Calls', tokens: 'In / out tokens', speed: 'Min / avg / max tok/s', time: 'Time', round: 'Call', start: 'Start', ttft: 'First token', duration: 'Duration', tps: 'tok/s', total: 'Total', est: 'est.', detail: 'Per-call details' }
    };
    const st = key => ST[lang()][key];
    const fmt1 = value => (Number.isFinite(value) ? (value >= 100 ? Math.round(value) : Math.round(value * 10) / 10) : '-');
    const secs = ms => (Number.isFinite(ms) && ms >= 0 ? `${(ms / 1000).toFixed(1)}s` : '-');
    function speedStats(thread, keep) {
        const rows = [];
        let lastQuestion = '';
        for (const message of thread.querySelectorAll('.dc-msg')) {
            if (message.classList.contains('dc-msg--user')) { lastQuestion = message.querySelector('.dc-msg-body')?.textContent.replace(/\s+/g, ' ').trim() || ''; continue; }
            const rounds = (message.dcRounds || []).filter(Boolean);
            if (rounds.length) rows.push({ question: lastQuestion, rounds });
        }
        const list = keep >= 0 ? rows.slice(-keep || rows.length) : rows;
        if (!list.length) return '';
        const sum = (items, key) => items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
        const summary = rounds => {
            const speeds = rounds.map(r => Number(r.tps)).filter(v => v > 0);
            const gen = sum(rounds, 'generationMs');
            return { min: speeds.length ? Math.min(...speeds) : NaN, max: speeds.length ? Math.max(...speeds) : NaN, avg: gen > 0 ? sum(rounds, 'outputTokens') / (gen / 1000) : NaN };
        };
        const all = list.flatMap(row => row.rounds);
        const total = summary(all);
        const body = list.map((row, index) => {
            const s = summary(row.rounds);
            const models = [...new Set(row.rounds.map(r => r.model).filter(Boolean))].join(', ');
            const q = row.question.length > 48 ? `${row.question.slice(0, 48)}…` : row.question;
            const detail = row.rounds.map(r => `<tr><td>${esc(r.index)}</td><td>${esc(r.at ? new Date(r.at).toLocaleTimeString(lang() === 'en' ? 'en-US' : 'zh-CN', { hour12: false }) : '-')}</td><td>${esc(r.model || '-')}</td><td>${esc(r.inputTokens || 0)} / ${esc(r.outputTokens || 0)}${r.estimated ? ` (${esc(st('est'))})` : ''}</td><td>${esc(secs(r.ttftMs))}</td><td>${esc(secs(r.ms))}</td><td>${esc(fmt1(Number(r.tps)))}</td></tr>`).join('');
            return `<tr><td>${index + 1}</td><td title="${esc(row.question)}">${esc(q)}</td><td>${esc(models || '-')}</td><td>${row.rounds.length}</td><td>${sum(row.rounds, 'inputTokens')} / ${sum(row.rounds, 'outputTokens')}</td><td>${esc(fmt1(s.min))} / ${esc(fmt1(s.avg))} / ${esc(fmt1(s.max))}</td><td>${esc(secs(sum(row.rounds, 'ms')))}</td></tr>
                <tr class="dc-export-stats-detail"><td></td><td colspan="6"><details><summary>${esc(st('detail'))}</summary><table><thead><tr><th>${esc(st('round'))}</th><th>${esc(st('start'))}</th><th>${esc(st('model'))}</th><th>${esc(st('tokens'))}</th><th>${esc(st('ttft'))}</th><th>${esc(st('duration'))}</th><th>${esc(st('tps'))}</th></tr></thead><tbody>${detail}</tbody></table></details></td></tr>`;
        }).join('');
        return `<section class="dc-export-stats"><h2>${esc(st('title'))}</h2><table>
            <thead><tr><th>${esc(st('reply'))}</th><th>${esc(st('question'))}</th><th>${esc(st('model'))}</th><th>${esc(st('rounds'))}</th><th>${esc(st('tokens'))}</th><th>${esc(st('speed'))}</th><th>${esc(st('time'))}</th></tr></thead>
            <tbody>${body}</tbody>
            <tfoot><tr><td></td><td>${esc(st('total'))}</td><td></td><td>${all.length}</td><td>${sum(all, 'inputTokens')} / ${sum(all, 'outputTokens')}</td><td>${esc(fmt1(total.min))} / ${esc(fmt1(total.avg))} / ${esc(fmt1(total.max))}</td><td>${esc(secs(sum(all, 'ms')))}</td></tr></tfoot>
        </table></section>`;
    }

    async function buildHtml({ thread, range = {}, onProgress = () => {} }) {
        const section = thread.closest('.dc');
        const inliner = createInliner();
        const content = thread.cloneNode(true);
        copyCanvases(thread, content);
        stripInteractive(content);
        const trimmed = trimToRecent(content, range) || Boolean(range.olderHidden);
        const question = content.querySelector('.dc-msg--user .dc-msg-body')?.textContent.replace(/\s+/g, ' ').trim() || '';
        const title = question.length > 60 ? `${question.slice(0, 60)}…` : question || 'Dragon Claw';

        onProgress('files');
        await Promise.all([
            inlineImages(content, inliner),
            inlineFileChips(content, inliner),
            inlineFileCards(thread, content, inliner)
        ]);
        absolutizeLinks(content);

        const doc = document.implementation.createHTMLDocument(title || 'Dragon Claw');
        doc.documentElement.lang = document.documentElement.lang || (lang() === 'en' ? 'en' : 'zh-CN');
        doc.documentElement.className = document.documentElement.className;
        // Preserve selector context before collectCss prunes unused rules. Without data-ui
        // and #dragonClaw, the v2 theme bridge is discarded and legacy dark rules win.
        for (const name of ['data-ui', 'data-theme']) {
            if (document.documentElement.hasAttribute(name)) doc.documentElement.setAttribute(name, document.documentElement.getAttribute(name));
        }
        doc.body.className = document.body.className;
        doc.body.classList.remove('ai-file-preview-open', 'ai-preview-resizing', 'dc-file-expanded');
        doc.body.classList.add('dc-chatting', 'dc-export');

        const box = doc.createElement('section');
        box.className = section.className;
        if (section.id) box.id = section.id;
        const avatar = section.querySelector('.dc-chat-avatar');
        const avatarSrc = avatar ? (await inliner.inline(avatar.getAttribute('src'))).dataUrl || absolute(avatar.getAttribute('src')) : '';
        const time = new Date().toLocaleString(lang() === 'en' ? 'en-US' : 'zh-CN', { hour12: false });
        box.innerHTML = `
            <div class="dc-ambient" aria-hidden="true"><span></span><span></span><span></span></div>
            <header class="dc-chat-head">
                <div class="dc-chat-title">
                    ${avatarSrc ? `<img src="${esc(avatarSrc)}" alt="" class="dc-chat-avatar">` : ''}
                    <span class="dc-chat-name">Dragon Claw</span>
                    <span class="dc-chat-badge">${esc(section.querySelector('.dc-chat-badge')?.textContent || '')}</span>
                </div>
                <div class="dc-export-meta"><b>${esc(title)}</b><span>${esc(t('exported', { time }))}</span></div>
            </header>`;
        const threadBox = doc.importNode(content, true);
        threadBox.removeAttribute('aria-live');
        // 统计表放在对话最前面；只截取了最近一段时只统计导出范围内的回复
        const stats = speedStats(thread, trimmed ? content.querySelectorAll('.dc-msg--ai .dc-msg-speed').length : -1);
        if (stats) threadBox.insertAdjacentHTML('afterbegin', stats);
        if (trimmed) threadBox.insertAdjacentHTML('afterbegin', `<div class="dc-export-trimmed">${esc(t('trimmed', { days: range.days ?? '', count: range.maxMessages ?? '' }))}</div>`);
        box.appendChild(threadBox);
        const foot = doc.createElement('div');
        foot.className = 'dc-export-foot';
        foot.textContent = t('note');
        box.appendChild(foot);

        const { inner, outer } = buildShell(doc, section);
        if (inner) {
            inner.appendChild(box);
            doc.body.appendChild(outer);
        } else {
            doc.body.appendChild(box);
        }

        onProgress('styles');
        const css = await collectCss(doc, inliner);
        const style = doc.createElement('style');
        style.textContent = `${css}\n${OVERRIDES}`;
        doc.head.insertAdjacentHTML('afterbegin', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
        doc.head.appendChild(style);
        const script = doc.createElement('script');
        script.textContent = dedupeImages(doc) + ZOOM_SCRIPT;
        doc.body.appendChild(script);

        return { html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`, skipped: inliner.skippedCount(), title };
    }

    window.DragonClawExport = { buildHtml };
})();
