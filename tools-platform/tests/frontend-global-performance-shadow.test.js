'use strict';

// 回归：v1.0.572 的 workspace-panel.js 在 IIFE 里声明了 `function performance(...)`，
// 遮蔽了浏览器全局 performance；Dragon Claw 回答流结束后 applyDone → renderContext
// 播放上下文百分比动画时执行 `performance.now()`，抛出 “performance.now is not a function”，
// 被 dragon-claw.js 的 catch 渲染成回答底部的 ⚠️。
// 这里用 AST 扫描前端脚本：凡是调用 performance.xxx 的文件，不允许在任何作用域声明同名绑定。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const FRONTEND_JS = path.join(__dirname, '..', 'frontend', 'js');

function listScripts(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
            out.push(...listScripts(full));
        } else if (/\.m?js$/.test(entry.name) && !/\.min\.js$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function parse(source) {
    const options = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true };
    try { return acorn.parse(source, { ...options, sourceType: 'script' }); }
    catch { return acorn.parse(source, { ...options, sourceType: 'module' }); }
}

function patternNames(node, names = []) {
    if (!node) return names;
    if (node.type === 'Identifier') names.push(node);
    else if (node.type === 'ObjectPattern') node.properties.forEach(p => patternNames(p.type === 'RestElement' ? p.argument : p.value, names));
    else if (node.type === 'ArrayPattern') node.elements.forEach(el => patternNames(el, names));
    else if (node.type === 'AssignmentPattern') patternNames(node.left, names);
    else if (node.type === 'RestElement') patternNames(node.argument, names);
    return names;
}

// 返回 { bindings: 声明成 `performance` 的位置, uses: 以 performance 为对象的成员访问位置 }
function scan(ast, name) {
    const bindings = [], uses = [];
    const visit = node => {
        if (!node || typeof node.type !== 'string') return;
        switch (node.type) {
            case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
                if (node.id) patternNames(node.id, bindings);
                node.params.forEach(p => patternNames(p, bindings));
                break;
            case 'ClassDeclaration': case 'ClassExpression':
                if (node.id) patternNames(node.id, bindings);
                break;
            case 'VariableDeclarator': patternNames(node.id, bindings); break;
            case 'CatchClause': patternNames(node.param, bindings); break;
            case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier':
                patternNames(node.local, bindings); break;
            case 'MemberExpression':
                if (node.object.type === 'Identifier' && node.object.name === name) uses.push(node.object);
                break;
        }
        for (const key of Object.keys(node)) {
            const child = node[key];
            if (Array.isArray(child)) child.forEach(visit);
            else if (child && typeof child.type === 'string') visit(child);
        }
    };
    visit(ast);
    return { bindings: bindings.filter(id => id.name === name), uses };
}

function lineOf(source, offset) { return source.slice(0, offset).split('\n').length; }

test('scanner catches the v1.0.572 shadowing pattern', () => {
    const buggy = `(() => {
        function performance(message) { return message; }
        function renderContext() { return performance.now(); }
        window.DragonClawWorkspace = { performance, renderContext };
    })();`;
    const { bindings, uses } = scan(parse(buggy), 'performance');
    assert.equal(bindings.length, 1);
    assert.equal(uses.length, 1);
    // 运行时确实会抛出用户看到的报错
    const vm = require('node:vm');
    const ctx = vm.createContext({ window: {}, performance: { now: () => 1 } });
    vm.runInContext(buggy, ctx);
    assert.throws(() => ctx.window.DragonClawWorkspace.renderContext(), /performance\.now is not a function/);
});

test('frontend scripts that call performance.* never shadow the global performance', () => {
    const offenders = [];
    for (const file of listScripts(FRONTEND_JS)) {
        const source = fs.readFileSync(file, 'utf8');
        if (!/\bperformance\s*\./.test(source)) continue;
        let ast;
        try { ast = parse(source); } catch { continue; }
        const { bindings, uses } = scan(ast, 'performance');
        if (bindings.length && uses.length) {
            offenders.push(`${path.relative(path.join(__dirname, '..'), file)}:${bindings.map(id => lineOf(source, id.start)).join(',')}`);
        }
    }
    assert.deepEqual(offenders, [], `these files declare a local "performance" that hides window.performance: ${offenders.join('; ')}`);
});

test('workspace-panel still exposes the metrics updater as DragonClawWorkspace.performance', () => {
    const source = fs.readFileSync(path.join(FRONTEND_JS, 'home', 'workspace-panel.js'), 'utf8');
    assert.match(source, /performance:\s*updatePerformance/);
    assert.match(source, /performance\.now\(\)/, 'context ring animation keeps using the global clock');
});
