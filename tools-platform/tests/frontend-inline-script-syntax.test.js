const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontendDir = path.join(__dirname, '../frontend');

function listHtml(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listHtml(full);
        return entry.name.endsWith('.html') ? [full] : [];
    });
}

// 内联脚本的语法错误会让整段页面逻辑静默失效，契约测试按正则查源码时发现不了。
test('every classic inline <script> in frontend html compiles', () => {
    const failures = [];
    for (const file of listHtml(frontendDir)) {
        const html = fs.readFileSync(file, 'utf8');
        const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRe.exec(html))) {
            const [, attrs, code] = match;
            if (/\bsrc\s*=/i.test(attrs) || !code.trim()) continue;
            const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
            if (type && !/^(?:text|application)\/javascript$/i.test(type)) continue;
            try {
                new vm.Script(code, { filename: path.relative(frontendDir, file) });
            } catch (error) {
                const line = html.slice(0, match.index).split('\n').length;
                failures.push(`${path.relative(frontendDir, file)}:${line} ${error.message}`);
            }
        }
    }
    assert.deepEqual(failures, []);
});
