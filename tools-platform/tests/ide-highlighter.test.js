const test = require('node:test');
const assert = require('node:assert/strict');
const highlighter = require('../frontend/js/shared/ide-highlighter');

function assertSourcePreserved(source, lang = 'html') {
    const rendered = highlighter.highlight(source, lang);
    let depth = 0;
    for (const tag of rendered.match(/<[^>]*>/g) || []) {
        if (tag === '</span>') {
            assert.ok(depth > 0, 'closing span must have an opening span');
            depth--;
        } else {
            assert.match(tag, /^<span class="tok-[a-z]+">$/, 'only highlighter spans may be rendered');
            depth++;
        }
    }
    assert.equal(depth, 0, 'highlighter spans must be balanced');
    const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
    const text = rendered.replace(/<[^>]*>/g, '')
        .replace(/&(?:amp|lt|gt|quot|#39);/g, entity => entities[entity]);
    assert.equal(text, source, 'highlighting must preserve all source text and line breaks');
    return rendered;
}

test('HTML tags and multiline attributes are escaped before adding highlight spans', () => {
    const rendered = assertSourcePreserved('<!doctype html>\r\n<html>\n<body>\n<div\n\tclass = "a > b"\n  data-text=\'&lt; & "quoted"\' disabled>你好</div>\n<br />\n</body>\n</html>\n');
    assert.ok(rendered.includes('&lt;/<span class="tok-tag">body</span>&gt;'));
    assert.ok(rendered.includes('<span class="tok-attr">class</span> = '));
});

test('embedded scripts preserve comparisons, template HTML and thousands of source lines', () => {
    const source = '<html>\n<body>\n<script>\n' + Array.from({ length: 3270 }, (_, i) => (
        `if (i < 5 && total > 0) { el.innerHTML = '<span class="tok-tag">line ${i}</span>'; }`
    )).join('\n') + '\n</script>\n</body>\n</html>';
    const rendered = assertSourcePreserved(source);
    assert.ok(rendered.includes('<span class="tok-keyword">if</span>'));
});

test('HTML comments, style blocks, incomplete tags and raw markup stay inert and retain whitespace', () => {
    for (const source of [
        '<!-- <img src=x onerror="alert(1)">\ncomment -->\n',
        '<style>\nbody { color: red; }\n/* <tag> */\n</STYLE>\n',
        '<div title="x > y">\n<img src=x onerror="alert(1)">\n</div>',
        '<div\n title="unfinished',
        '<!-- unfinished\ncomment',
        '<SCRIPT>\nconst x = a < b;\n',
        'plain a < b && c > d\n\n',
        '<div>\n\n</div>\n'
    ]) assertSourcePreserved(source);
});

test('plain text and existing Python, JavaScript and SQL highlighting preserve source', () => {
    for (const [lang, source] of [
        ['text', '<html>&quot; & <img>\n'],
        ['python', 'def calculate(total: int) -> bool:\n    # comment\n    return total > 0'],
        ['javascript', 'const x = async () => true;\n'],
        ['sql', 'SELECT id, name FROM users WHERE id = 1']
    ]) assertSourcePreserved(source, lang);
});

test('CSS numbers never skip preceding whitespace, comments or identifiers in HTML style blocks', () => {
    const css = '\n/* 顶栏与浮窗 */\n:root { --navbar-h:0px; --font:"Segoe UI"; }\nbody { margin: 12px; color: #a5d6ff; transition: opacity 200ms; }\n';
    const rendered = assertSourcePreserved(css, 'css');
    assert.ok(rendered.includes('<span class="tok-number">12px</span>'));
    assert.ok(rendered.includes('<span class="tok-number">#a5d6ff</span>'));
    assert.ok(rendered.includes('<span class="tok-comment">/* 顶栏与浮窗 */</span>'));
    const html = '<!doctype html>\n<style>' + css + '</style>\n<script>\nconst value = 2;\n</script>\n';
    const mixed = assertSourcePreserved(html);
    assert.ok(mixed.includes('<span class="tok-keyword">const</span>'));
});
