// node_modules/.bin/electron tests/datacom-localization-browser.cjs
// Public seed and isolated browser profile only; never reads tenant databases.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-localization-'));
app.setPath('userData', path.join(temp, 'profile'));
const root = path.join(__dirname, '../backend/builtin-tools/datacom-protocol-expert');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'knowledge-seed.json')));
let server, win;
const errors = [];
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn) {
    for (let i = 0; i < 200; i++) {
        if (await evaluate(fn)) return;
        await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw Error('Timed out: ' + fn);
}
async function navigate(hash, selector) {
    await evaluate(hash => { location.hash = hash; }, hash);
    await until(selector === '#articleBody' ? () => !!document.querySelector('#articleBody h1, #articleBody h2') : () => !document.querySelector('.dk-loading'));
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
app.whenReady().then(async () => {
    const web = express();
    web.get('/i18n-runtime.js', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/js/shared/custom-tool-i18n-runtime.js')));
    web.get('/', (req, res) => res.type('html').send(fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('</head>', `${req.query.platform ? '<script src="/i18n-runtime.js"></script>' : ''}<script>window.__DATACOM_SNAPSHOT__={data:${JSON.stringify(seed).replace(/</g, '\\u003c')}};</script></head>`)));
    web.use(express.static(root));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    win = new BrowserWindow({ show: false, width: 1450, height: 1050, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until(() => !!document.querySelector('.dk-hero'));
    await evaluate(async () => {
        const { applyLanguage } = await import('/assets/i18n.js');
        window.checkLanguage = (root = document.body) => {
            applyLanguage(root);
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
            let node;
            while ((node = walker.nextNode())) {
                const parent = node.nodeType === 3 ? node.parentElement : node;
                if (!parent || parent.closest('script,style,#langBtn,[data-tools-i18n-ignore],textarea,[contenteditable="true"],.dk-mermaid-src,video')) continue;
                const values = node.nodeType === 3 ? [node.nodeValue] : ['title', 'placeholder', 'aria-label', 'alt', 'label'].map(name => node.getAttribute(name));
                values.forEach(value => { if (/[\u3400-\u9fff]/.test(value || '')) window.untranslated.add(value.trim()); });
            }
        };
        window.untranslated = new Set();
        document.querySelector('#langBtn').click();
    });
    assert.equal(await evaluate(() => document.documentElement.lang), 'en-US');
    for (const hash of ['#/', '#/labs', '#/outline', '#/outline-list', '#/map']) {
        await navigate(hash);
        await evaluate(() => window.checkLanguage());
    }
    for (const article of seed.articles) {
        await navigate('#/a/' + article.id, '#articleBody');
        await until(() => !document.querySelector('.dk-mermaid.is-pending'));
        await evaluate(() => window.checkLanguage());
        assert.equal(await evaluate(() => document.querySelectorAll('.dk-mermaid.is-failed').length), 0, article.id + ': Mermaid must render in English');
    }
    await evaluate(async () => {
        const [{ ospfLessons }, { junosLessons }, { createTeachingStage }, { rfcLesson }, { isRfcDiagram }] = await Promise.all([
            import('/assets/ospf-lessons.js'), import('/assets/junos-lessons.js'), import('/assets/teaching-stage.js'), import('/assets/packet-lesson.js'), import('/assets/rfc-parser.js')
        ]);
        const host = document.createElement('div'); document.body.append(host);
        const checkStage = definition => {
            const handle = createTeachingStage(host, definition);
            let variants = [{}];
            for (const o of definition.options || []) {
                const values = o.choices ? o.choices.map(c => c.value) : [o.min, o.max];
                variants = variants.flatMap(base => values.map(value => ({ ...base, [o.id]: value })));
            }
            for (const options of variants) {
                handle.setOptions(options);
                const n = host.querySelectorAll('[data-step]').length;
                for (let i = 0; i < n; i++) {
                    handle.restore({ options, t: i / n });
                    window.checkLanguage(host);
                    for (const part of host.querySelectorAll('[data-part]')) {
                        part.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        window.checkLanguage(host);
                        if (/字段含义请结合原文/.test(host.textContent)) throw Error('Placeholder object description');
                    }
                }
            }
            handle.dispose(); host.replaceChildren();
        };
        for (const definition of [...ospfLessons, ...junosLessons]) checkStage(definition);
        for (const a of window.__DATACOM_SNAPSHOT__.data.articles) {
            for (const m of a.bodyMd.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
                if (isRfcDiagram(m[1])) checkStage(rfcLesson(m[1], a.title, a.bodyMd));
            }
        }
        host.remove();
    });
    const untranslated = await evaluate(() => [...window.untranslated]);
    if (untranslated.length && process.env.DATACOM_I18N_MISSING) fs.writeFileSync(process.env.DATACOM_I18N_MISSING, JSON.stringify(untranslated, null, 2));
    assert.deepEqual(untranslated, [], 'English must cover notes, diagrams, object explanations and accessibility labels');
    await navigate('#/a/ospf-packets', '#articleBody');
    const before = await evaluate(() => document.querySelector('#articleBody').textContent);
    await evaluate(() => document.querySelector('#langBtn').click());
    await until(() => !document.querySelector('.dk-mermaid.is-pending'));
    assert.equal(await evaluate(() => document.documentElement.lang), 'zh-CN');
    assert.ok(await evaluate(() => document.querySelector('#articleBody').textContent.includes('数据库描述')));
    await evaluate(() => document.querySelector('#langBtn').click());
    await until(() => !document.querySelector('.dk-mermaid.is-pending'));
    assert.equal(await evaluate(() => document.querySelector('#articleBody').textContent), before, 'Repeated switches must restore the same English copy');
    await evaluate(() => { const s = document.querySelector('#searchInput'); s.value = 'fragmentation'; s.dispatchEvent(new Event('input')); });
    await until(() => !!document.querySelector('#searchResults a'));
    assert.ok(await evaluate(() => document.querySelector('#searchResults').textContent.toLowerCase().includes('fragmentation')));
    for (const width of [1450, 390]) {
        win.setSize(width, 1000);
        for (const theme of ['light', 'dark']) {
            await evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
            assert.ok(await evaluate(() => document.querySelector('#langBtn').getBoundingClientRect().right <= innerWidth));
        }
    }
    await evaluate(async () => {
        const { applyLanguage, originalSelection, translate } = await import('/assets/i18n.js');
        const phrase = '保留字段顺序与位宽；横向读位，纵向读偏移。';
        const host = document.createElement('p'); host.textContent = phrase; document.body.append(host);
        applyLanguage(host);
        const node = host.firstChild;
        const range = document.createRange(); range.setStart(node, 2); range.setEnd(node, node.length - 2);
        if (originalSelection(range, host).exact !== phrase) throw Error('Translated selections lost their original source');
        host.setAttribute('aria-label', '展开目录'); applyLanguage(host);
        host.setAttribute('aria-label', '收起目录'); applyLanguage(host);
        if (host.getAttribute('aria-label') !== translate('收起目录')) throw Error('Dynamic accessibility label was stale');
        host.remove();
    });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/?platform=1`);
    await until(() => !!document.querySelector('.dk-hero') && !!window.ToolsCustomI18n);
    for (const expected of ['zh-CN', 'en-US']) {
        await evaluate(() => document.querySelector('#langBtn').click());
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(await evaluate(() => document.documentElement.lang), expected, 'Native and platform controls must not toggle each other back');
    }
    await evaluate(() => window.ToolsCustomI18n.setLanguage('zh'));
    assert.equal(await evaluate(() => document.documentElement.lang), 'zh-CN');
    await evaluate(() => window.ToolsCustomI18n.setLanguage('en'));
    assert.equal(await evaluate(() => document.documentElement.lang), 'en-US');
    win.setSize(1450, 1050);
    await navigate('#/a/ospf-packets', '#articleBody');
    await evaluate(() => {
        const code = [...document.querySelectorAll('.dk-code')].find(figure => figure.querySelector('code').textContent.includes('Interface MTU'));
        code.querySelector('[data-rfc]').click();
        document.querySelector('#modalRoot [data-part="l0-field-0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.doesNotMatch(await evaluate(() => document.querySelector('#modalRoot').textContent), /[\u3400-\u9fff]/, 'RFC modal titles and selected source explanation must be English');
    const explanation = await evaluate(() => document.querySelector('#modalRoot .dk-part-copy').textContent);
    for (const term of ['1500', '9000', 'ospf mtu-enable', 'Original description']) assert.ok(explanation.includes(term), term);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('#toolsCustomLanguageButton')).display), 'none');
    if (process.env.DATACOM_SHOTS) {
        fs.mkdirSync(process.env.DATACOM_SHOTS, { recursive: true });
        await evaluate(() => document.querySelector('#modalRoot .dk-part-copy').scrollIntoView({ block: 'start' }));
        fs.writeFileSync(path.join(process.env.DATACOM_SHOTS, 'mtu-english.png'), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    console.log(`${seed.articles.length} bilingual notes, Mermaid, every teaching option/step/object, RFC diagrams, round trips, English search and narrow/dark layouts passed`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    win?.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
});
