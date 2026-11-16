const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyToolMobileLayout, classifyToolMobileLayoutFile } = require('../backend/models/tool-mobile-layout');

test('distinguishes narrow designs from wide tables', () => {
    assert.equal(classifyToolMobileLayout('<style>main{max-width:520px}</style><main>Birthday</main>'), 'responsive');
    assert.equal(classifyToolMobileLayout('<meta name="viewport" content="width=device-width"><table></table>'), 'desktop');
    assert.equal(classifyToolMobileLayout('<style>@media(max-width:600px){.grid{display:block}}</style>'), 'responsive');
});
test('accepts an explicit author declaration', () => {
    assert.equal(classifyToolMobileLayout('<meta name="tools-mobile-layout" content="responsive"><table></table>'), 'responsive');
    assert.equal(classifyToolMobileLayout('<meta name="tools-mobile-layout" content="desktop"><style>main{max-width:520px}</style>'), 'desktop');
});
test('ignores table mentions inside scripts and comments and caches file reads', () => {
    const htmlWithScriptTable = '<style>main{max-width:520px}</style><main>Ok</main><script>const x = "<table></table>";</script>';
    assert.equal(classifyToolMobileLayout(htmlWithScriptTable), 'responsive');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-mobile-layout-'));
    const file = path.join(tmpDir, 'index.html');
    try {
        fs.writeFileSync(file, '<style>main{max-width:520px}</style><main>Mobile</main>', 'utf8');
        assert.equal(classifyToolMobileLayoutFile(file), 'responsive');
        fs.writeFileSync(file, '<main><table><tr><td>Wide</td></tr></table></main>', 'utf8');
        // Bump mtime cleanly to avoid 1ms granularity cache hit on fast filesystems
        const nextTime = new Date(Date.now() + 5000);
        fs.utimesSync(file, nextTime, nextTime);
        assert.equal(classifyToolMobileLayoutFile(file), 'desktop');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
