// Markdown 渲染：marked + Obsidian 风格扩展（callout、[[双链]]、$公式$）+ 懒加载 Mermaid + 安全清洗。
import { isRfcDiagram } from './rfc-parser.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const LATEX_SYMBOLS = [
    [/\\longrightarrow/g, '⟶'], [/\\rightarrow|\\to\b/g, '→'], [/\\leftarrow/g, '←'], [/\\leftrightarrow/g, '↔'], [/\\Rightarrow/g, '⇒'],
    [/\\cdot/g, '·'], [/\\times/g, '×'], [/\\leq?\b/g, '≤'], [/\\geq?\b/g, '≥'], [/\\neq?\b/g, '≠'], [/\\approx/g, '≈'],
    [/\\vert\{\}|\\vert/g, '|'], [/\\mu/g, 'μ'], [/\\log/g, 'log'], [/\\cdots|\\dots|\\ldots/g, '…'], [/\\quad|\\qquad/g, ' '],
    [/\\left|\\right/g, ''], [/\\,|\\;|\\!/g, ' '], [/\\\{/g, '{'], [/\\\}/g, '}'], [/\\%/g, '%'], [/\\infty/g, '∞'], [/\\sum/g, '∑']
];

// 轻量 LaTeX：覆盖知识库中出现的分式、上下标、求和、取模与常用符号
export function latexLite(source) {
    let text = esc(source.trim());
    text = text.replace(/\\xrightarrow\{([^{}]*)\}/g, (_, label) => ` —${label}→ `);
    text = text.replace(/\\text\{([^{}]*)\}/g, '$1').replace(/\\mathrm\{([^{}]*)\}/g, '$1').replace(/\\operatorname\{([^{}]*)\}/g, '$1');
    text = text.replace(/\\pmod\{([^{}]*)\}/g, ' (mod $1)');
    for (let i = 0; i < 3; i += 1) text = text.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '<span class="frac"><span>$1</span><span>$2</span></span>');
    LATEX_SYMBOLS.forEach(([pattern, value]) => { text = text.replace(pattern, value); });
    text = text.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>').replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
    text = text.replace(/\^([A-Za-z0-9+-])/g, '<sup>$1</sup>').replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
    return text.replace(/\\([A-Za-z]+)/g, '$1');
}

const CALLOUTS = {
    info: ['ℹ️', '信息'], note: ['📝', '笔记'], tip: ['💡', '提示'], important: ['📌', '重点'], warning: ['⚠️', '注意'], danger: ['⛔', '危险'],
    check: ['✅', '结论'], question: ['❓', '追问'], abstract: ['📋', '摘要'], example: ['🧪', '示例'], success: ['✅', '成功'], quote: ['❝', '引用']
};

let configured = false;
let resolveArticle = () => null;

function configure() {
    if (configured) return;
    configured = true;
    const { marked } = window;
    marked.use({
        gfm: true,
        breaks: false,
        extensions: [
            {
                name: 'wikilink', level: 'inline',
                start: src => src.indexOf('[['),
                tokenizer(src) {
                    const match = /^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/.exec(src);
                    if (match) return { type: 'wikilink', raw: match[0], target: match[1].trim(), alias: (match[2] || '').trim() };
                    return undefined;
                },
                renderer(token) {
                    const article = resolveArticle(token.target);
                    const text = esc(token.alias || token.target);
                    return article ? `<a class="dk-wikilink" href="#/a/${article.id}">${text}</a>` : `<span class="dk-wikilink is-missing" title="知识库中暂无该条目">${text}</span>`;
                }
            },
            {
                name: 'mathBlock', level: 'block',
                start: src => src.indexOf('$$'),
                tokenizer(src) {
                    const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
                    if (match) return { type: 'mathBlock', raw: match[0], text: match[1] };
                    return undefined;
                },
                renderer: token => `<div class="dk-math-block">${latexLite(token.text)}</div>`
            },
            {
                name: 'mathInline', level: 'inline',
                start: src => src.indexOf('$'),
                tokenizer(src) {
                    const block = /^\$\$([^$]+?)\$\$/.exec(src);
                    if (block) return { type: 'mathInline', raw: block[0], text: block[1] };
                    const match = /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/.exec(src);
                    if (match) return { type: 'mathInline', raw: match[0], text: match[1] };
                    return undefined;
                },
                renderer: token => `<span class="dk-math">${latexLite(token.text)}</span>`
            }
        ],
        renderer: {
            code(code, lang) {
                const language = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
                if (language === 'mermaid') return `<div class="dk-mermaid is-pending"><pre class="dk-mermaid-src">${esc(code)}</pre></div>`;
                const rfc = isRfcDiagram(code);
                const highlighted = esc(code).split('\n').map(line => /^\s*(#|!|\/\/)/.test(line) ? `<span class="cm">${line}</span>` : line.replace(/(--&gt;.*)$/, '<span class="cm">$1</span>')).join('\n');
                return `<figure class="dk-code${rfc ? ' is-rfc' : ''}"><figcaption><span>${esc(language || 'text')}</span>${rfc ? '<button type="button" class="dk-code-btn" data-rfc>🧊 按位查看</button>' : ''}<button type="button" class="dk-code-btn" data-copy>复制</button></figcaption><pre><code>${highlighted}</code></pre></figure>`;
            }
        }
    });
}

function sanitize(root) {
    root.querySelectorAll('script, iframe, object, embed, style, link, meta, base, form').forEach(node => node.remove());
    root.querySelectorAll('*').forEach(node => {
        [...node.attributes].forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'style' || name === 'srcdoc') node.removeAttribute(attr.name);
            if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*(javascript|data|vbscript):/i.test(attr.value)) node.removeAttribute(attr.name);
        });
    });
}

function upgradeCallouts(root) {
    root.querySelectorAll('blockquote').forEach(quote => {
        const first = quote.firstElementChild;
        if (!first || first.tagName !== 'P') return;
        const match = /^\s*\[!(\w+)\]([+-]?)\s*([^\n]*)\n?/.exec(first.innerHTML);
        if (!match) return;
        const type = match[1].toLowerCase();
        const [icon, label] = CALLOUTS[type] || ['💬', type];
        first.innerHTML = first.innerHTML.slice(match[0].length);
        if (!first.textContent.trim()) first.remove();
        const box = document.createElement('div');
        box.className = `dk-callout is-${CALLOUTS[type] ? type : 'note'}`;
        box.innerHTML = `<div class="dk-callout-title"><span>${icon}</span>${match[3] || label}</div><div class="dk-callout-body"></div>`;
        const content = box.querySelector('.dk-callout-body');
        while (quote.firstChild) content.appendChild(quote.firstChild);
        quote.replaceWith(box);
    });
}

const slug = (text, index) => `h-${index}-${String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)}`;

export function renderMarkdown(container, markdown, { findArticle } = {}) {
    configure();
    resolveArticle = findArticle || (() => null);
    const html = window.marked.parse(String(markdown || ''));
    const template = document.createElement('template');
    template.innerHTML = html;
    sanitize(template.content);
    container.replaceChildren(template.content);
    upgradeCallouts(container);
    container.querySelectorAll('table').forEach(table => {
        const wrap = document.createElement('div');
        wrap.className = 'dk-table-wrap';
        table.replaceWith(wrap);
        wrap.appendChild(table);
    });
    const toc = [];
    container.querySelectorAll('h1, h2, h3').forEach((heading, index) => {
        heading.id = slug(heading.textContent, index);
        if (heading.tagName !== 'H1') toc.push({ id: heading.id, level: Number(heading.tagName[1]), text: heading.textContent.replace(/^[#\s]+/, '') });
    });
    container.querySelectorAll('a[href^="http"]').forEach(link => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
    return { toc };
}

let mermaidLoading = null;
function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!mermaidLoading) {
        mermaidLoading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = new URL('./vendor/mermaid.min.js', import.meta.url).href;
            script.onload = () => resolve(window.mermaid);
            script.onerror = () => { mermaidLoading = null; reject(new Error('Mermaid 加载失败')); };
            document.head.appendChild(script);
        });
    }
    return mermaidLoading;
}

// Obsidian 能容忍、Mermaid 10 不接受的写法：状态图转移标签里的第二个英文冒号
export function normalizeMermaid(source) {
    if (!/^\s*stateDiagram/m.test(source)) return source;
    return source.split('\n').map(line => {
        const match = /^(\s*[^:]+?-->[^:]+?:\s*)(.*)$/.exec(line);
        return match ? match[1] + match[2].replace(/:/g, '：') : line;
    }).join('\n');
}

let mermaidCounter = 0;
export async function renderMermaid(container, dark) {
    const blocks = [...container.querySelectorAll('.dk-mermaid.is-pending')];
    if (!blocks.length) return;
    let mermaid;
    try {
        mermaid = await loadMermaid();
    } catch (error) {
        blocks.forEach(block => block.classList.add('is-failed'));
        return;
    }
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: { primaryColor: dark ? '#162943' : '#edf5fc', primaryTextColor: dark ? '#e2e8f0' : '#172c43', primaryBorderColor: dark ? '#5177a5' : '#6e98bb', lineColor: dark ? '#8daac9' : '#557791', secondaryColor: dark ? '#17362e' : '#e9f6f1', tertiaryColor: dark ? '#242e43' : '#f5f7fb', fontSize: '15px', background: dark ? '#0d1527' : '#ffffff' }, fontFamily: '"PingFang SC","Microsoft YaHei",system-ui,sans-serif', flowchart: { htmlLabels: true, curve: 'linear', nodeSpacing: 35, rankSpacing: 55, padding: 18 }, sequence: { actorMargin: 65, messageMargin: 40, useMaxWidth: false } });
    for (const block of blocks) {
        if (!block.isConnected) continue;
        // 原文 init 指令里的 'theme': 'base' 会覆盖暗色主题，渲染前去掉以跟随当前主题
        const source = normalizeMermaid(block.querySelector('.dk-mermaid-src').textContent.replace(/%%\{init:[\s\S]*?\}%%/g, ''));
        const id = `dk-mermaid-${mermaidCounter += 1}`;
        try {
            const { svg } = await mermaid.render(id, source);
            // AI 操作栏可能已在异步渲染期间挂载，保留其按钮与笔记标记。
            const actions = block.querySelector(':scope > .dk-block-ai');
            block.dataset.source = source;
            block.innerHTML = `<div class="dk-mermaid-tools"><span>流程示意 · 沿箭头阅读</span><button type="button" data-zoom="out" aria-label="缩小流程图">−</button><button type="button" data-zoom="reset">适应宽度</button><button type="button" data-zoom="in" aria-label="放大流程图">＋</button></div><div class="dk-mermaid-viewport" tabindex="0" aria-label="流程图，可滚动查看"><div class="dk-mermaid-drawing">${svg}</div></div>`;
            if (actions) block.prepend(actions);
            let zoom = 1;
            const drawing = block.querySelector('.dk-mermaid-drawing');
            block.querySelector('.dk-mermaid-tools').addEventListener('click', event => {
                const action = event.target.closest('[data-zoom]')?.dataset.zoom;
                if (!action) return;
                zoom = action === 'reset' ? 1 : Math.max(.5, Math.min(3, zoom + (action === 'in' ? .25 : -.25)));
                drawing.style.width = `${zoom * 100}%`;
            });
            block.classList.remove('is-pending');
        } catch (error) {
            document.getElementById(`d${id}`)?.remove();
            block.classList.remove('is-pending');
            block.classList.add('is-failed');
            block.insertAdjacentHTML('afterbegin', '<div class="dk-mini-note">流程图语法有误，显示源码：</div>');
        }
    }
}
