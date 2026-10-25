const fs = require('fs');
const path = require('path');

const MENU_FILE = '.tools-platform-menu.json';
const START = '<!-- tools-platform:menu:start -->';
const END = '<!-- tools-platform:menu:end -->';
const GUIDE_START = '<!-- tools-platform:guide:start -->';
const GUIDE_END = '<!-- tools-platform:guide:end -->';
const bad = message => Object.assign(new Error(message), { status: 400 });
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const escapeTable = value => String(value).replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[`*_!]/g, '\\$&').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();

function validateItem(item) {
    if (!item || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(item.slug)
        || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80
        || (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 300))
        || typeof item.href !== 'string' || !/^\.\/[\w./-]+\.html$/.test(item.href)
        || item.href.slice(2).split('/').some(part => !part || part === '.' || part === '..')
        || (item.publicAccess !== undefined && typeof item.publicAccess !== 'boolean')
        || (item.fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(item.fingerprint))
        || (item.updatedAt !== undefined && (typeof item.updatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(item.updatedAt) || !Number.isFinite(Date.parse(item.updatedAt))))) {
        throw bad('仓库工具菜单清单格式无效，请检查 ' + MENU_FILE);
    }
    return {
        slug: item.slug,
        name: item.name.trim(),
        description: String(item.description || '').replace(/\s+/g, ' ').trim(),
        href: item.href,
        encrypted: Boolean(item.encrypted),
        ...(item.publicAccess ? { publicAccess: true } : {}),
        ...(item.batchExcluded ? { batchExcluded: true } : {}),
        ...(item.fingerprint ? { fingerprint: item.fingerprint } : {}),
        ...(item.updatedAt ? { updatedAt: item.updatedAt } : {})
    };
}

function renderGuide(items) {
    const rows = items.map(item => {
        const lock = item.encrypted ? ' 🔒' : (item.publicAccess ? ' 🌐' : '');
        const accessDesc = item.publicAccess ? '（免登录公开访问）' : (item.encrypted ? '（受密码保护）' : '');
        const desc = (item.description || '查看最新只读数据快照') + accessDesc;
        return `| ${escapeTable(item.name)}${lock} | \`${item.slug}\` | ${escapeTable(desc)} | [打开页面](${item.href}) |`;
    }).join('\n');
    return `${GUIDE_START}
## 已发布工具

本仓库集中托管平台主页和工具的只读静态页面。请先在首页使用推送时同步的平台账号登录；账号、密码和页面数据的修改需再次推送后生效。工具统一登录，不再分别设置密码。站点需使用 HTTPS。

| 工具 | 标识（slug） | 简介 | 页面 |
| --- | --- | --- | --- |
${rows}

> 工具页面仅供查看；需要修改业务数据时，请返回 Tools Platform 联系管理员。
${GUIDE_END}`;
}

function updateGuide(markdown, section, fileName) {
    const starts = markdown.split(GUIDE_START).length - 1;
    const ends = markdown.split(GUIDE_END).length - 1;
    if (starts !== ends || starts > 1) throw bad('仓库说明中的工具目录标记不完整或重复，请人工检查 ' + fileName);
    if (starts === 1) {
        const start = markdown.indexOf(GUIDE_START);
        const end = markdown.indexOf(GUIDE_END);
        if (end < start) throw bad('仓库说明中的工具目录标记顺序有误，请人工检查 ' + fileName);
        return markdown.slice(0, start) + section + markdown.slice(end + GUIDE_END.length);
    }
    return markdown + (markdown.endsWith('\n') ? '\n' : '\n\n') + section + '\n';
}

function chooseGuideFile(checkout) {
    // Keep updating the guide we previously managed, even if another Markdown
    // file is later added to the repository.
    for (const name of ['repository-guide.md', 'README.md']) {
        const file = path.join(checkout, name);
        if (fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() && fs.readFileSync(file, 'utf8').includes(GUIDE_START)) return name;
    }
    for (const name of ['repository-guide.md', 'README.md']) {
        if (fs.lstatSync(path.join(checkout, name), { throwIfNoEntry: false })) return name;
    }
    return 'README.md';
}

function renderMenu(items) {
    const links = items.map(item => {
        const badge = item.encrypted ? '<span class="tp-menu-badge" title="访问此工具需输入密码">需密码</span>' : '';
        const version = item.fingerprint && item.updatedAt
            ? `<span class="tp-menu-version"><time datetime="${escapeHtml(item.updatedAt)}">更新于 ${escapeHtml(item.updatedAt.replace('T', ' ').slice(0, 16))} UTC</time><code title="完整 SHA-256：${escapeHtml(item.fingerprint)}">SHA-256 ${escapeHtml(item.fingerprint.slice(0, 12))}</code></span>`
            : '<span class="tp-menu-version tp-menu-version-pending">版本信息待下次推送记录</span>';
        return `        <a class="tp-menu-card" href="${escapeHtml(item.href)}" data-tool-slug="${escapeHtml(item.slug)}"><span class="tp-menu-card-top"><strong title="工具标识：${escapeHtml(item.slug)}">${escapeHtml(item.name)}</strong>${badge}<span class="tp-menu-arrow" aria-hidden="true">↗</span></span><span class="tp-menu-description">${escapeHtml(item.description || '查看最新发布的只读数据快照')}</span><span class="tp-menu-card-footer">${version}</span></a>`;
    }).join('\n');
    return `${START}
<style>
body.tp-publish-home{margin:0;padding:0;background:#f6f8fb}
.tp-publish-menu,.tp-publish-menu *{box-sizing:border-box}
.tp-publish-menu{max-width:1120px;margin:0 auto;padding:clamp(36px,5vw,64px) 24px 72px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b2b42}
.tp-menu-head{display:flex;align-items:end;justify-content:space-between;gap:24px;padding-bottom:25px;margin-bottom:22px;border-bottom:1px solid #e2e8f0}
.tp-menu-kicker{display:block;color:#56718f;font-size:10px;font-weight:750;letter-spacing:.18em}.tp-menu-head h2{margin:8px 0 6px;color:#17263a;font-size:clamp(25px,3vw,31px);font-weight:680;letter-spacing:-.035em;line-height:1.18}.tp-menu-head p{margin:0;color:#687b90;font-size:13px;line-height:1.6}.tp-menu-count{flex:none;padding-bottom:3px;color:#8292a4;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.tp-menu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.tp-menu-card{display:flex;flex-direction:column;min-width:0;min-height:166px;padding:23px 24px 19px;border:1px solid #e0e7ef;border-radius:17px;background:#fff;color:#22344b;text-decoration:none;box-shadow:0 3px 14px rgba(22,46,76,.025);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.tp-menu-card:hover{transform:translateY(-2px);border-color:#bdcfe2;box-shadow:0 15px 34px rgba(31,66,103,.09)}.tp-menu-card:focus-visible{outline:2px solid #3978be;outline-offset:3px}
.tp-menu-card-top{display:flex;align-items:flex-start;gap:10px;min-width:0}.tp-menu-card-top strong{min-width:0;flex:1;color:#1a2a3f;font-size:17px;font-weight:650;line-height:1.4;overflow-wrap:anywhere}.tp-menu-arrow{flex:none;margin-left:auto;color:#6285a8;font-size:18px;line-height:1.2;opacity:.65;transition:transform .18s ease,opacity .18s ease}.tp-menu-card:hover .tp-menu-arrow,.tp-menu-card:focus-visible .tp-menu-arrow{transform:translate(2px,-2px);opacity:1}
.tp-menu-badge{flex:none;margin-top:2px;padding:3px 7px;border:1px solid #dbe4ed;border-radius:6px;background:#f5f8fb;color:#61758a;font-size:10px;font-weight:650;line-height:1.3;white-space:nowrap}
.tp-menu-description{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;margin-top:8px;color:#66798d;font-size:12.5px;line-height:1.6}
.tp-menu-card-footer{display:block;margin-top:auto;padding-top:15px;border-top:1px solid #edf1f5}.tp-menu-version{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;column-gap:10px;row-gap:4px;color:#77899d;font-size:11px;line-height:1.4;font-variant-numeric:tabular-nums}.tp-menu-version time{white-space:nowrap}.tp-menu-version code{color:#57718f;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap}.tp-menu-version-pending{color:#97a5b4}
@media(max-width:760px){.tp-menu-grid{grid-template-columns:1fr}.tp-menu-card{min-height:154px}}
@media(max-width:480px){.tp-publish-menu{padding:32px 18px 48px}.tp-menu-head{align-items:flex-start;gap:12px}.tp-menu-count{padding-top:4px}.tp-menu-card{padding:20px;min-height:156px}}
@media(prefers-reduced-motion:reduce){.tp-menu-card,.tp-menu-arrow{transition:none}.tp-menu-card:hover{transform:none}.tp-menu-card:hover .tp-menu-arrow,.tp-menu-card:focus-visible .tp-menu-arrow{transform:none}}
@media(prefers-color-scheme:dark){body.tp-publish-home{background:#111b2a}.tp-publish-menu{color:#e6eef7}.tp-menu-head{border-color:#2b3a4e}.tp-menu-head h2,.tp-menu-card-top strong{color:#edf4fb}.tp-menu-head p,.tp-menu-description{color:#9eafc0}.tp-menu-count,.tp-menu-version{color:#9dafc1}.tp-menu-card{background:#19283b;border-color:#34455b;color:#e6eef7;box-shadow:none}.tp-menu-card:hover{border-color:#6389b1;box-shadow:0 15px 34px rgba(0,0,0,.18)}.tp-menu-card-footer{border-color:#304157}.tp-menu-badge{background:#23374d;border-color:#3a536c;color:#b2c6d8}.tp-menu-version code{color:#adc9e6}.tp-menu-version-pending{color:#8fa1b4}}
</style>
<nav class="tp-publish-menu" aria-label="只读工具入口">
  <div class="tp-menu-head"><div><span class="tp-menu-kicker">TOOLS / READ ONLY</span><h2>工具入口</h2><p>选择工具，查看最新发布的数据快照</p></div><span class="tp-menu-count">${String(items.length).padStart(2, '0')} 个只读工具</span></div>
  <div class="tp-menu-grid">
${links}
  </div>
</nav>
${END}`;
}

function updateIndex(html, menu) {
    const starts = html.split(START).length - 1;
    const ends = html.split(END).length - 1;
    if (starts !== ends || starts > 1) throw bad('仓库首页工具菜单标记不完整或重复，请人工检查 index.html');
    if (starts === 1) {
        const start = html.indexOf(START);
        const end = html.indexOf(END);
        if (end < start) throw bad('仓库首页工具菜单标记顺序有误，请人工检查 index.html');
        return html.slice(0, start) + menu + html.slice(end + END.length);
    }
    if (!/<body\b[^>]*>/i.test(html)) throw bad('仓库首页缺少 body 标签，无法安全添加工具菜单');
    return html.replace(/<body\b[^>]*>/i, match => match + '\n' + menu + '\n');
}

function readPublishMenuItems(checkout) {
    const indexFile = path.join(checkout, 'index.html');
    const manifestFile = path.join(checkout, MENU_FILE);
    for (const file of [indexFile, manifestFile]) {
        const stat = fs.lstatSync(file, { throwIfNoEntry: false });
        if (stat && !stat.isFile()) throw bad('仓库首页或菜单清单不是普通文件，已停止发布');
    }
    if (!fs.existsSync(manifestFile)) {
        if (fs.existsSync(indexFile) && fs.readFileSync(indexFile, 'utf8').includes(START)) {
            throw bad('仓库首页已有工具菜单但缺少清单，请先恢复 ' + MENU_FILE);
        }
        return [];
    }
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { throw bad('仓库工具菜单清单不是有效 JSON'); }
    if (parsed?.version !== 1 || !Array.isArray(parsed.items) || parsed.items.length > 200) throw bad('仓库工具菜单清单版本或条目数无效');
    const items = parsed.items.map(validateItem);
    if (new Set(items.map(row => row.slug)).size !== items.length) throw bad('仓库工具菜单清单存在重复 slug');
    return items;
}

function writePublishMenuItems(checkout, items) {
    const indexFile = path.join(checkout, 'index.html');
    const manifestFile = path.join(checkout, MENU_FILE);
    const guideName = chooseGuideFile(checkout);
    const guideFile = path.join(checkout, guideName);
    for (const file of [indexFile, manifestFile, guideFile]) {
        const stat = fs.lstatSync(file, { throwIfNoEntry: false });
        if (stat && !stat.isFile()) throw bad('仓库首页、菜单清单或说明文件不是普通文件，已停止发布');
    }
    const menu = renderMenu(items);
    const current = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';
    const next = current
        ? updateIndex(current, menu)
        : `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>工具入口</title>\n</head>\n<body class="tp-publish-home">\n${menu}\n</body>\n</html>\n`;
    const currentGuide = fs.existsSync(guideFile) ? fs.readFileSync(guideFile, 'utf8') : '';
    const guide = currentGuide
        ? updateGuide(currentGuide, renderGuide(items), guideName)
        : `# 静态工具仓库\n\n本仓库提供工具的只读静态页面，便于通过 Pages 统一访问。\n\n${renderGuide(items)}\n`;
    fs.writeFileSync(indexFile, next);
    fs.writeFileSync(manifestFile, JSON.stringify({ version: 1, items }, null, 2) + '\n');
    fs.writeFileSync(guideFile, guide);
    return { indexFile, manifestFile, guideFile, guideName, items };
}

function updatePublishMenu(checkout, entry) {
    const item = validateItem(entry);
    const items = readPublishMenuItems(checkout);
    const existing = items.findIndex(row => row.slug === item.slug);
    if (item.fingerprint) {
        item.updatedAt = existing >= 0 && items[existing].fingerprint === item.fingerprint && items[existing].updatedAt
            ? items[existing].updatedAt
            : new Date().toISOString();
    }
    if (existing >= 0) items[existing] = item;
    else items.push(item);
    return writePublishMenuItems(checkout, items);
}

function removePublishMenuItems(checkout, slugs) {
    const items = readPublishMenuItems(checkout);
    const removed = items.filter(item => slugs.has(item.slug));
    if (!removed.length) return null;
    const result = writePublishMenuItems(checkout, items.filter(item => !slugs.has(item.slug)));
    return { ...result, removed };
}

module.exports = { updatePublishMenu, removePublishMenuItems, readPublishMenuItems, MENU_FILE };
