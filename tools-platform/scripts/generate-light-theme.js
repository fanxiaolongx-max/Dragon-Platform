#!/usr/bin/env node
// 为写死深色的工具生成「亮色覆盖样式」：读取工具的 CSS（.css 文件或 HTML 里的 <style>），
// 把深色中性底色换成浅色、浅色文字换成深色、白色半透明边框换成黑色半透明，保留品牌强调色（必要时加深以保证白底上的对比度）。
// 生成的规则全部加上 html[data-platform-theme="light"] 前缀：平台切到深色主题时（frontend/js/shared/platform-theme.js）仍是工具原样。
//
// 用法：
//   node scripts/generate-light-theme.js <input.css|input.html> [--out file.css]
//   node scripts/generate-light-theme.js <input.html> --inject   # 写回 HTML：在 </head> 前放入 <style id="platform-light-theme">
//     --css <file.css>        另外转换页面引用的样式文件（可重复）
//     --tailwind              扫描同目录 HTML / JS 里用到的 Tailwind 灰阶类（zinc/slate/gray/neutral/white/black），生成浅色对应
//     --exclude "<selector>"  这些区域内不改（如幻灯片画布 #deck），可重复
//     --skip "<regex>"        选择器匹配的样式规则不转换（内容区的主题样式）
// 生成后请在浏览器里逐个界面检查（含弹窗、提示、不常出现的状态），个别颜色在工具里手工微调。
'use strict';
const fs = require('fs');
const path = require('path');

const PREFIX = 'html[data-platform-theme="light"]';
const COLOR_PROPS = /^(color|background|background-color|background-image|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|column-rule-color|text-decoration-color|scrollbar-color|-webkit-text-fill-color|--[\w-]+)$/i;

// ── 颜色解析与换算 ──
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
function parseColor(text) {
    const value = text.trim().toLowerCase();
    if (NAMED[value]) return NAMED[value].slice();
    let m = /^#([0-9a-f]{3,8})$/.exec(value);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
        if (h.length !== 6 && h.length !== 8) return null;
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value);
    if (m) {
        const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        return [+m[1], +m[2], +m[3], alpha];
    }
    return null;
}
function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}
function fromHsl([h, s, l]) {
    if (s === 0) return [l, l, l].map(v => Math.round(v * 255));
    const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map(v => Math.round(v * 255));
}
function fmt([r, g, b, a]) {
    return a >= 0.999 ? `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}` : `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
}
const isAccent = ([h, s, l]) => s > 0.35 && l > 0.25 && l < 0.8;

// role: 'bg' 背景 / 'text' 文字 / 'line' 边框描边 / 'shadow' 阴影
function convert(color, role) {
    const [r, g, b, a] = color;
    const hsl = toHsl([r, g, b]);
    const [h, s, l] = hsl;
    if (role === 'shadow') {
        if (l < 0.2) return [15, 23, 42, Math.min(a, 0.12)];          // 深色投影在白底上改成很淡的投影
        if (isAccent(hsl)) return [r, g, b, Math.min(a, 0.25)];       // 发光效果减弱
        return [15, 23, 42, Math.min(a, 0.08)];
    }
    if (isAccent(hsl)) {
        // 强调色：背景保留；文字 / 边框在白底上加深到可读
        if (role === 'bg') return color;
        return [...fromHsl([h, Math.min(1, s), Math.min(l, role === 'text' ? 0.38 : 0.5)]), a];
    }
    if (role === 'bg') {
        if (a < 0.5 && l > 0.35) return [15, 23, 42, Math.min(0.06, Math.max(0.03, a * 0.6))];   // 深底上的浅色半透明蒙层 → 浅底上的淡灰蒙层
        const nl = l < 0.5 ? 1 - l * 0.35 : Math.max(0.9, 1 - l + 0.85);      // 深色底 → 接近白的浅底，层次保留
        return [...fromHsl([h, Math.min(s, 0.35), Math.min(0.995, nl)]), a];
    }
    if (role === 'line') {
        if (a < 1 && l > 0.35) return [15, 23, 42, Math.min(0.16, Math.max(0.08, a * 0.8))];   // 半透明浅色线 → 半透明深色细线
        if (l > 0.7) return [226, 232, 240, 1];
        return [...fromHsl([h, Math.min(s, 0.3), Math.max(0.82, 1 - l)]), a];
    }
    // 文字：浅色字 → 深色字（越亮越深），中灰 → 偏深的灰
    const nl = l > 0.5 ? Math.max(0.12, Math.min(0.42, 1.08 - l)) : Math.min(l, 0.42);   // 次要文字也保证在白底上看得清
    return [...fromHsl([h, Math.min(s, 0.45), nl]), a];
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;
function convertValue(prop, value, context) {
    const p = prop.toLowerCase();
    let role = 'text';
    if (/background|^--.*(bg|background|surface|panel|card|base|body)/i.test(p)) role = 'bg';
    else if (/border|outline|stroke|column-rule|^--.*(border|line|divider)/i.test(p)) role = 'line';
    else if (/shadow/.test(p)) role = 'shadow';
    else if (p === 'fill') role = context.textLike ? 'text' : 'bg';
    else if (/^--/.test(p)) {
        // 变量按取值判断：很暗的多半是底色，很亮的多半是文字
        const c = parseColor((value.match(COLOR_TOKEN) || [''])[0]);
        if (c) { const l = toHsl(c)[2]; role = l < 0.3 ? 'bg' : l > 0.65 ? 'text' : 'text'; }
    }
    // 强调色底上的白字保留
    if (role === 'text' && context.accentBg) return null;
    let changed = false;
    const out = value.replace(COLOR_TOKEN, token => {
        const c = parseColor(token);
        if (!c) return token;
        if (/^--/.test(p) && isAccent(toHsl(c))) return token;   // 变量里的强调色两种主题通用
        const next = fmt(convert(c, role));
        if (next !== fmt(c)) changed = true;
        return next;
    });
    return changed ? out : null;
}

// ── 极简 CSS 解析：规则 / @media @supports 等嵌套块 / 跳过 @keyframes @font-face ──
function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@(?:import|charset|namespace)\s+(?:url\((?:"[^"]*"|'[^']*'|[^)]*)\)|"[^"]*"|'[^']*')[^;{}]*;/gi, '');   // @import 的 url 里可能带分号
}
function parseBlocks(css) {
    const items = [];
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf('{', i);
        if (open < 0) break;
        const prelude = css.slice(i, open).trim();
        let depth = 1, j = open + 1, quote = '';
        for (; j < css.length && depth; j++) {
            const ch = css[j];
            if (quote) { if (ch === quote && css[j - 1] !== '\\') quote = ''; continue; }
            if (ch === '"' || ch === "'") quote = ch;
            else if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        const body = css.slice(open + 1, j - 1);
        const cleanPrelude = prelude.replace(/^[\s;]*(?:@(?:import|charset)[^;]*;\s*)*/g, '').trim();
        items.push({ prelude: cleanPrelude, body });
        i = j;
    }
    return items;
}
function declarations(body) {
    const list = [];
    let buf = '', depth = 0, quote = '';
    for (const ch of body) {
        if (quote) { buf += ch; if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ';' && depth === 0) { list.push(buf); buf = ''; continue; }
        buf += ch;
    }
    if (buf.trim()) list.push(buf);
    return list.map(d => { const k = d.indexOf(':'); return k < 0 ? null : [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }).filter(Boolean);
}
function prefixSelector(selector) {
    return selector.split(/,(?![^(]*\))/).map(part => {
        const s = part.trim();
        if (!s) return s;
        if (/^:root\b/.test(s)) return `${PREFIX}${s.slice(5)}`;
        if (/^html\b/.test(s)) return `${PREFIX}${s.slice(4).replace(/^\[data-theme[^\]]*\]/, '')}`;
        return `${PREFIX} ${s}`;
    }).join(', ');
}
function transform(css, skip = null) {
    const out = [];
    for (const { prelude, body } of parseBlocks(stripComments(css))) {
        if (!prelude) continue;
        if (/^@(?:-webkit-)?keyframes|^@font-face|^@page|^@property/i.test(prelude)) continue;
        if (/^@media|^@supports|^@container|^@layer/i.test(prelude)) {
            if (/prefers-color-scheme\s*:\s*dark/i.test(prelude)) continue;   // 原本的深色分支交给 platform-theme.js
            const inner = transform(body, skip);
            if (inner.trim()) out.push(`${prelude} {\n${inner}}\n`);
            continue;
        }
        if (prelude.startsWith('@')) continue;
        if (skip && skip.test(prelude)) continue;   // 内容区（幻灯片等）保持原样
        const decls = declarations(body);
        const bgDecl = decls.find(([k]) => /^background(-color)?$/i.test(k));
        const bgColor = bgDecl && parseColor((bgDecl[1].match(COLOR_TOKEN) || [''])[0]);
        const context = { accentBg: Boolean(bgColor && bgColor[3] > 0.6 && isAccent(toHsl(bgColor))) || /linear-gradient\([^)]*#(?:[0-9a-f]{6})/i.test(bgDecl?.[1] || '') && /#fff\b|white/i.test(decls.find(([k]) => k === 'color')?.[1] || ''),
            textLike: /text|label|icon|svg|path/i.test(prelude) };
        const changed = [];
        for (const [prop, value] of decls) {
            if (!COLOR_PROPS.test(prop)) continue;
            const next = convertValue(prop, value, context);
            if (next) changed.push(`    ${prop}: ${next.replace(/\s*!important\s*$/i, '')} !important;`);
        }
        if (changed.length) out.push(`${prefixSelector(prelude)} {\n${changed.join('\n')}\n}\n`);
    }
    return out.join('');
}

// ── Tailwind 灰阶工具类 → 浅色 ──
const TW_SHADES = { 50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a', 900: '#18181b', 950: '#09090b' };
// 深色界面里的灰阶 → 浅色界面里的灰阶（底色 / 文字 / 线条各一套）
const TW_LIGHT = {
    bg: { 950: '#f6f7f9', 900: '#ffffff', 800: '#f3f4f6', 700: '#e7e8eb', 600: '#d9dbe0', 500: '#c4c7cc', 400: '#a1a1aa', 300: '#e4e4e7', 200: '#f4f4f5', 100: '#fafafa', 50: '#ffffff', white: '#ffffff', black: '#ffffff' },
    text: { 950: '#18181b', 900: '#18181b', 800: '#27272a', 700: '#3f3f46', 600: '#71717a', 500: '#6b6b75', 400: '#55555e', 300: '#3f3f46', 200: '#27272a', 100: '#18181b', 50: '#18181b', white: '#18181b', black: '#18181b' },
    line: { 950: '#e4e4e7', 900: '#e4e4e7', 800: '#e4e4e7', 700: '#dcdce0', 600: '#d0d0d6', 500: '#a1a1aa', 400: '#a1a1aa', 300: '#d4d4d8', 200: '#e4e4e7', 100: '#f4f4f5', 50: '#fafafa', white: '#e4e4e7', black: '#e4e4e7' }
};
function twEscape(token) { return token.replace(/[:/.[\]]/g, m => `\\${m}`); }
function tailwindOverrides(dir, excludes) {
    const files = [];
    const walk = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory() && !/^(node_modules|vendor|reference|assets)$/.test(entry.name)) walk(full);
        else if (/\.(html?|js)$/i.test(entry.name) && !/\.min\.js$/.test(entry.name)) files.push(full);
    } };
    walk(dir);
    const tokens = new Set();
    const re = /(?<![\w-])((?:hover:|focus:|group-hover:|focus-within:|active:)?)(bg|text|border|border-[trblxy]|divide|ring|placeholder|from|via|to)-(zinc|slate|gray|neutral|white|black)(?:-(\d{2,3}))?(?:\/(\d{1,3}))?(?![\w-])/g;
    for (const file of files) for (const m of fs.readFileSync(file, 'utf8').matchAll(re)) tokens.add(m[0]);
    const not = excludes.map(sel => `:not(${sel} *):not(${sel})`).join('');
    const rules = [];
    for (const token of [...tokens].sort()) {
        const m = /^((?:hover:|focus:|group-hover:|focus-within:|active:)?)(bg|text|border|border-[trblxy]|divide|ring|placeholder|from|via|to)-(zinc|slate|gray|neutral|white|black)(?:-(\d{2,3}))?(?:\/(\d{1,3}))?$/.exec(token);
        if (!m) continue;
        const [, variant, kind, family, shade, alpha] = m;
        const key = family === 'white' || family === 'black' ? family : shade;
        if (!key || (!TW_SHADES[key] && family !== 'white' && family !== 'black')) continue;
        const role = kind === 'text' || kind === 'placeholder' ? 'text' : kind === 'bg' || ['from', 'via', 'to'].includes(kind) ? 'bg' : 'line';
        // 彩色底上的白字保留（按钮等）
        if (kind === 'text' && family === 'white') {
            rules.push(`${PREFIX} .${twEscape(token)}:not([class*="bg-"]):not([class*="from-"])${not}, ${PREFIX} [class*="bg-zinc"].${twEscape(token)}${not}, ${PREFIX} [class*="bg-slate"].${twEscape(token)}${not}, ${PREFIX} [class*="bg-gray"].${twEscape(token)}${not} { color: ${TW_LIGHT.text.white} !important; }`);
            continue;
        }
        let color = parseColor(TW_LIGHT[role][key]);
        if (alpha) color = role === 'bg' ? [15, 23, 42, Math.min(0.08, Number(alpha) / 100 * 0.12)].map((v, i) => (i === 3 ? Math.max(0.03, v) : v)) : [...color.slice(0, 3), Math.max(0.5, Number(alpha) / 100)];
        if (role === 'bg' && alpha && Number(alpha) >= 70) color = parseColor(TW_LIGHT.bg[key]).slice(0, 3).concat(Number(alpha) / 100);
        const value = fmt(color);
        const state = variant === 'hover:' ? ':hover' : variant === 'focus:' ? ':focus' : variant === 'active:' ? ':active' : variant === 'focus-within:' ? ':focus-within' : '';
        const base = variant === 'group-hover:' ? `${PREFIX} .group:hover .${twEscape(token)}` : `${PREFIX} .${twEscape(token)}${state}`;
        const prop = kind === 'bg' ? 'background-color' : kind === 'text' ? 'color' : kind === 'placeholder' ? null : kind === 'ring' ? '--tw-ring-color' : kind === 'divide' ? null : ['from', 'via', 'to'].includes(kind) ? `--tw-gradient-${kind}` : `${kind.replace(/^border-([trblxy])$/, (x, side) => `border-${{ t: 'top', r: 'right', b: 'bottom', l: 'left', x: 'left', y: 'top' }[side]}`)}-color`;
        if (kind === 'placeholder') rules.push(`${base}::placeholder${not ? '' : ''} { color: ${value} !important; }`);
        else if (kind === 'divide') rules.push(`${base}${not} > * + * { border-color: ${value} !important; }`);
        else if (kind === 'from') rules.push(`${base}${not} { --tw-gradient-from: ${value} !important; --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, transparent) !important; }`);
        else rules.push(`${base}${not} { ${prop}: ${value} !important; }`);
    }
    return rules.join('\n') + '\n';
}

function main() {
    const [input, ...args] = process.argv.slice(2);
    if (!input) { console.error('usage: generate-light-theme.js <file.css|file.html> [--out file] [--inject]'); process.exit(1); }
    const source = fs.readFileSync(input, 'utf8');
    const isHtml = /\.html?$/i.test(input);
    const listArg = flag => args.flatMap((arg, i) => (arg === flag && args[i + 1] ? [args[i + 1]] : []));
    const extraCss = listArg('--css').map(file => fs.readFileSync(path.resolve(path.dirname(input), file), 'utf8'));
    const css = (isHtml ? [...source.matchAll(/<style\b(?![^>]*id=["']platform-light-theme)[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n') : source) + '\n' + extraCss.join('\n');
    const tailwind = args.includes('--tailwind') ? tailwindOverrides(path.dirname(input), listArg('--exclude')) : '';
    const result = `/* 亮色覆盖：由 scripts/generate-light-theme.js 从 ${path.basename(input)} 生成，平台亮色主题时生效；改原样式后请重新生成 */\n${PREFIX} { color-scheme: light; }\n${transform(css, listArg('--skip')[0] ? new RegExp(listArg('--skip')[0]) : null)}${tailwind}`;
    if (args.includes('--inject') && isHtml) {
        const block = `<style id="platform-light-theme">\n${result}</style>`;
        const cleaned = source.replace(/\s*<style id="platform-light-theme">[\s\S]*?<\/style>/i, '');
        const at = cleaned.search(/<\/head>/i);
        fs.writeFileSync(input, at < 0 ? block + cleaned : cleaned.slice(0, at) + block + '\n' + cleaned.slice(at));
        console.log(`injected ${result.split('\n').length} lines into ${input}`);
        return;
    }
    const outIndex = args.indexOf('--out');
    if (outIndex >= 0) { fs.writeFileSync(args[outIndex + 1], result); console.log(`wrote ${args[outIndex + 1]}`); }
    else process.stdout.write(result);
}

if (require.main === module) main();
module.exports = { transform, convert, parseColor };
