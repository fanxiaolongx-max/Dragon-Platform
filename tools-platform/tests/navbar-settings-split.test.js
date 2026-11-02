const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

// 全局设置各页签的代码在 navbar-settings.js，首次打开设置时才加载；navbar.js 在 19 个页面上随页面加载。
const dir = path.join(__dirname, '../frontend/js/shared');
const coreSource = fs.readFileSync(path.join(dir, 'navbar.js'), 'utf8');
const packSource = fs.readFileSync(path.join(dir, 'navbar-settings.js'), 'utf8');
const parse = source => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });

function topLevelNames(ast) {
    const names = new Set();
    for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names.add(node.id.name);
        else if (node.type === 'VariableDeclaration') node.declarations.forEach(d => d.id.type === 'Identifier' && names.add(d.id.name));
        else if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
            && node.expression.left.object?.name === 'window' && node.expression.left.property?.name !== '__navSettingsPackLoaded') names.add(node.expression.left.property.name);
    }
    return names;
}

function enclosingFunctions(ast, name) {
    const owners = [];
    (function walk(node, owner) {
        if (!node || typeof node.type !== 'string') return;
        const next = node.type === 'FunctionDeclaration' ? node.id.name : owner;
        if (node.type === 'Identifier' && node.name === name) owners.push(owner);
        for (const key of Object.keys(node)) {
            if (key === 'loc') continue;
            const value = node[key];
            if (Array.isArray(value)) value.forEach(child => walk(child, next));
            else if (value && typeof value.type === 'string') walk(value, next);
        }
    })(ast, '<top-level>');
    return owners;
}

test('settings pack loads on demand with a content version and marks itself loaded', () => {
    assert.match(coreSource, /loadNavLazyScript\('\/js\/shared\/navbar-settings\.js'/);
    assert.match(packSource, /window\.__navSettingsPackLoaded = true;\s*$/);
});

test('core and settings pack declare disjoint names, and only the dispatcher calls into the pack', () => {
    const core = parse(coreSource);
    const pack = parse(packSource);
    const coreNames = topLevelNames(core);
    const packNames = topLevelNames(pack);
    assert.deepEqual([...packNames].filter(name => coreNames.has(name)), [], 'a name defined in both files would shadow or throw');

    // 设置页渲染函数都在 pack 里，核心文件只在 renderNavSettingsContent（先 await 加载）和设置弹窗打开时的刷新里调用
    const allowedCallers = new Set(['renderNavSettingsContent', 'pollSnapshotProgress']);
    for (const name of packNames) {
        const owners = enclosingFunctions(core, name);
        assert.deepEqual(owners.filter(owner => !allowedCallers.has(owner)), [], `${name} is used by navbar.js before the settings pack loads`);
    }
    const dispatched = [...coreSource.matchAll(/return (render\w+Settings)\(content\)/g)].map(match => match[1]);
    assert.ok(dispatched.length >= 15);
    dispatched.forEach(name => assert.ok(packNames.has(name), `${name} lives in navbar-settings.js`));
});

test('settings pack runs no page-load work beyond defining functions and state', () => {
    const allowed = new Set(['FunctionDeclaration', 'VariableDeclaration', 'ClassDeclaration']);
    for (const node of parse(packSource).body) {
        if (allowed.has(node.type)) continue;
        const isWindowAssignment = node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression'
            && node.expression.left.type === 'MemberExpression' && node.expression.left.object.name === 'window';
        assert.ok(isWindowAssignment, `unexpected top-level statement at navbar-settings.js:${node.loc.start.line}`);
    }
});
