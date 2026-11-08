const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUivImportPath } = require('../desktop-promo/uiv-import-navigation');
const base = 'http://127.0.0.1:3030';
const path = '/sla?uivImportSession=' + 'a'.repeat(32) + '&uivImportToken=' + 'b'.repeat(32) + '&autoImport=1';
test('desktop import accepts only generated same-origin SLA links and preserves month', () => {
    assert.equal(resolveUivImportPath(base + path, base), path);
    assert.equal(resolveUivImportPath(base + path + '&targetMonth=7&unused=value', base), path + '&targetMonth=7');
    assert.equal(resolveUivImportPath(base + path + '&targetMonth=13', base), path);
    assert.equal(resolveUivImportPath(base + path.replace('/sla?', '/pages/sla.html?'), base), path);
});
test('ordinary links, invalid capabilities, remote origins and other local ports keep normal browser behavior', () => {
    for (const url of [base+'/sla', base+'/settings'+path.slice(4), base+path.replace('autoImport=1','autoImport=0'), base+path.replace('a'.repeat(32),'bad'), 'https://example.com'+path, 'http://127.0.0.1:4040'+path, 'http://user:pass@127.0.0.1:3030'+path, 'javascript:alert(1)']) {
        assert.equal(resolveUivImportPath(url, base), null);
    }
    assert.equal(resolveUivImportPath('https://example.com'+path, 'https://example.com'), null);
});
