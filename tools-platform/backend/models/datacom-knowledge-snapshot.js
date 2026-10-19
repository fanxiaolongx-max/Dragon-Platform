'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const repo = require('./datacom-knowledge-repository');
const { runWithTenant } = require('./tenant-context');
const { safeJson } = require('./static-snapshot-data');
const { injectGatekeeper } = require('./snapshot-gatekeeper');
const { injectLanguageRuntime } = require('./custom-tool-i18n-service');

const SLUG = 'datacom-protocol-expert';
const ROOT = path.join(__dirname, '../builtin-tools', SLUG);
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const scriptUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

// 使用浏览器原生 import map 内嵌模块，下载的单文件仍可离线运行 Three.js 和实验室。
// 每个模块只嵌入一次，避免把共享的 Three.js 重复写入每条依赖链。
function inlineAssets(html) {
    const imports = {};
    function visit(name) {
        const id = `datacom/${name}`;
        if (Object.hasOwn(imports, id)) return id;
        imports[id] = '';
        let source = read(name);
        const nodes = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
        const replacements = [];
        for (const node of nodes) {
            if (!node.source) continue;
            const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), node.source.value));
            if (!node.source.value.startsWith('.') || !dependency.startsWith('assets/')) {
                throw new Error(`知识库模块包含不支持的依赖：${node.source.value}`);
            }
            replacements.push({ start: node.source.start, end: node.source.end, id: visit(dependency) });
        }
        for (const replacement of replacements.reverse()) {
            source = source.slice(0, replacement.start) + JSON.stringify(replacement.id) + source.slice(replacement.end);
        }
        imports[id] = scriptUrl(source);
        return id;
    }
    const entry = visit('assets/app.js');
    html = html.replace('<link rel="stylesheet" href="./assets/app.css">', () => `<style>${read('assets/app.css')}</style>`);
    html = html.replace('<script src="./assets/vendor/marked.min.js"></script>', () =>
        `<script src="${scriptUrl(read('assets/vendor/marked.min.js'))}"></script>\n<script src="${scriptUrl(read('assets/vendor/mermaid.min.js'))}"></script>`);
    return html.replace('<script type="module" src="./assets/app.js"></script>', () =>
        `<script type="importmap">${safeJson({ imports })}</script>\n<script type="module">import ${JSON.stringify(entry)};</script>`);
}

function render(data, pages, options) {
    let html = read('index.html');
    if (!pages) html = inlineAssets(html);
    const config = pages ? { url: './data/knowledge.json' } : { data };
    html = html.replace('</head>', () => `<script>window.__DATACOM_SNAPSHOT__=${safeJson(config)};</script>\n</head>`);
    html = injectLanguageRuntime(html, SLUG, { inlineRuntime: true, standalone: true, filePath: path.join(ROOT, 'index.html') });
    if (options.encryption?.enabled && (options.encryption.passwordHash || options.encryption.hash)) {
        html = injectGatekeeper(html, options.encryption, SLUG);
    }
    return html;
}

function collectAssets() {
    const files = new Map();
    function walk(dir) {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const name = path.posix.join(dir, entry.name);
            if (entry.isDirectory()) walk(name);
            else if (entry.isFile()) files.set(name, fs.readFileSync(path.join(ROOT, name)));
        }
    }
    walk('assets');
    files.set('THIRD_PARTY_NOTICES.md', read('THIRD_PARTY_NOTICES.md'));
    return files;
}

async function buildSnapshot(tenantId, options = {}) {
    return runWithTenant(tenantId, async () => render(await repo.loadCatalog({ withBody: true }), false, options));
}

async function buildPagesSnapshot(tenantId, options = {}) {
    return runWithTenant(tenantId, async () => {
        const data = await repo.loadCatalog({ withBody: true });
        const files = collectAssets();
        files.set('data/knowledge.json', safeJson(data) + '\n');
        return { html: render(null, true, options), files };
    });
}

module.exports = { buildSnapshot, buildPagesSnapshot };
