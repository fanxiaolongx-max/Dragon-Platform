// node_modules/.bin/electron tests/datacom-teaching-browser.cjs
// 隔离静态快照验证；不读取、修改运行数据库。
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-teaching-'));
app.setPath('userData', path.join(temp, 'profile'));
const root = path.join(__dirname, '../backend/builtin-tools/datacom-protocol-expert');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'knowledge-seed.json')));
const layoutArticle = {
    ...seed.articles[0], id: 'layout-regression', title: '区块操作栏布局检查', visuals: [], version: 1,
    summary: '检查流程图、代码、表格和图片的操作栏。', keyPoints: [], tags: [], aiFields: [],
    bodyMd: '# 布局检查\n\n```mermaid\nflowchart LR\n A[起点] --> B[终点]\n```\n\n```text\n首行代码不可遮挡\n第二行\n```\n\n| 表头不可遮挡 | 数值 |\n| --- | --- |\n| 内容 | 42 |\n\n![图片不可遮挡](/layout-image.svg)',
};
let server, win;
const errors = [];
const evaluate = (fn, ...args) =>
    win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn) {
    for (let i = 0; i < 120; i++) {
        if (await evaluate(fn)) return;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw Error('Timeout: ' + fn);
}
async function navigate(hash) {
    await evaluate((hash) => {
        location.hash = hash;
    }, hash);
}
async function shot(name) {
    if (!process.env.DATACOM_SHOTS) return;
    await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await new Promise((r) => setTimeout(r, 350));
    fs.mkdirSync(process.env.DATACOM_SHOTS, { recursive: true });
    fs.writeFileSync(
        path.join(process.env.DATACOM_SHOTS, `${name}.png`),
        (await win.webContents.capturePage()).toPNG(),
    );
}
app.whenReady()
    .then(async () => {
        const web = express();
        const dictionary = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../backend/custom-tool-i18n/datacom-protocol-expert.json')),
        );
        web.get('/i18n-runtime.js', (_req, res) =>
            res.sendFile(path.join(__dirname, '../frontend/js/shared/custom-tool-i18n-runtime.js')),
        );
        web.get('/live', (_req, res) =>
            res
                .type('html')
                .send(
                    fs
                        .readFileSync(path.join(root, 'index.html'), 'utf8')
                        .replace(
                            '</head>',
                            `<script>window.__TOOLS_CUSTOM_I18N__={translations:${JSON.stringify(dictionary).replace(/</g, '\\u003c')}};</script><script src="/i18n-runtime.js"></script></head>`,
                        ),
                ),
        );
        web.get('/api/datacom-knowledge', (_req, res) =>
            res.json({ ...seed, articles: [...seed.articles, layoutArticle], tenantId: 'default', canWrite: true, username: 'test' }),
        );
        web.get('/api/datacom-knowledge/annotations', (req, res) => res.json({
            annotations: req.query.articleId === layoutArticle.id ? ['mermaid', 'code', 'table', 'image'].map((block) => ({
                id: `layout-${block}`, articleId: layoutArticle.id, kind: 'note', title: '布局检查笔记',
                quote: '测试引用', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turns: [],
                anchor: { type: 'block', block, index: 0 },
            })) : [],
        }));
        web.get('/layout-image.svg', (_req, res) => res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="#3167b1"/></svg>'));
        web.get('/api/datacom-knowledge/ai/status', (_req, res) => res.json({ available: false }));
        web.get('/api/datacom-knowledge/articles/:id', (req, res) =>
            res.json({ article: [...seed.articles, layoutArticle].find((a) => a.id === req.params.id) }),
        );
        web.get('/', (_req, res) =>
            res
                .type('html')
                .send(
                    fs
                        .readFileSync(path.join(root, 'index.html'), 'utf8')
                        .replace(
                            '</head>',
                            `<script>window.__DATACOM_SNAPSHOT__={data:${JSON.stringify(seed).replace(/</g, '\\u003c')}};</script></head>`,
                        ),
                ),
        );
        web.use(express.static(root));
        server = await new Promise((r) => {
            const s = web.listen(0, '127.0.0.1', () => r(s));
        });
        win = new BrowserWindow({
            show: false,
            width: 1500,
            height: 1060,
            webPreferences: { contextIsolation: true, nodeIntegration: false },
        });
        win.webContents.on('console-message', (_e, level, message) => {
            if (level >= 3 && !message.includes('Content-Security-Policy')) errors.push(message);
        });
        await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
        await until(() => !!document.querySelector('.dk-hero'));
        assert.ok(await evaluate(() => {
            const tabs = document.querySelector('.dk-nav-mode');
            const button = tabs.querySelector('button');
            return tabs.children.length === 1 && button.clientWidth >= tabs.clientWidth - 10;
        }), 'readonly directory must fill the switcher without an empty second slot');
        await evaluate(() =>
            document.addEventListener('dk:visual-mounted', (e) => {
                window.testVisual = e.detail.handle;
            }),
        );
        const definitions = await evaluate(async () => {
            const a = await import('/assets/ospf-lessons.js'),
                b = await import('/assets/junos-lessons.js');
            return [...a.ospfLessons, ...b.junosLessons].map((d) => ({
                id: d.id,
                options: JSON.parse(JSON.stringify(d.options)),
            }));
        });
        for (const d of definitions) {
            await navigate('#/lab/' + d.id);
            await until(() => !!document.querySelector('#labHost .dk-teaching'));
            assert.equal(await evaluate(() => document.querySelectorAll('#labHost canvas').length), 0);
            assert.ok(await evaluate(() => document.querySelector('.dk-diagram').getBoundingClientRect().width >= 650));
            for (const o of d.options || [])
                for (const value of o.choices ? o.choices.map((c) => c.value) : [o.min, o.max]) {
                    await evaluate(
                        (key, value) => {
                            window.testVisual.setOptions({ [key]: value });
                            const n = document.querySelectorAll('[data-step]').length;
                            for (let i = 0; i < n; i++) {
                                window.testVisual.restore({
                                    options: window.testVisual.getContext().options,
                                    t: i / n,
                                });
                                if (
                                    !document.querySelector('.dk-diagram') ||
                                    !document.querySelector('.dk-step-result').textContent
                                )
                                    throw Error('Missing frame');
                            }
                        },
                        o.id,
                        value,
                    );
                }
            await evaluate(() => {
                window.testVisual.restore({ t: 0.45 });
                const saved = window.testVisual.getContext();
                window.testVisual.restore({ t: 0 });
                window.testVisual.restore(saved);
                if (Math.abs(window.testVisual.getContext().t - saved.t) > 0.0001) throw Error('Restore mismatch');
            });
            await evaluate(() => {
                document.querySelector('[data-step="0"]').click();
                document.querySelector('[data-act="next"]').click();
            });
            assert.equal(
                await evaluate(() => document.querySelector('[data-step="1"]').getAttribute('aria-current')),
                'step',
            );
            await evaluate(() => {
                window.testVisual.setOptions({});
                const part = document.querySelector('[data-part]');
                if (part) part.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            if (['policy-engine', 'rib-vrf', 'nssa-pbit', 'area-flood', 'dr-pseudonode'].includes(d.id)) {
                await evaluate(
                    (options) => window.testVisual.setOptions(Object.fromEntries(options.map((o) => [o.id, o.value]))),
                    d.options,
                );
                await evaluate(() => document.querySelector('[data-step="1"]').click());
                await shot(d.id);
            }
            if (d.id === 'fsm-ladder') {
                await evaluate(() => window.testVisual.setOptions({ mode: 'p2p' }));
                await shot('fsm-dark');
            }
            if (d.id === 'packet-explode') {
                await evaluate(() => {
                    window.testVisual.setOptions({ type: 1, auth: 'null' });
                    document.querySelector('[data-step="2"]').click();
                    document.querySelector('[data-part]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
                });
                await shot('packet-dark');
            }
            if (d.id === 'te-cspf') {
                await evaluate(() => {
                    window.testVisual.setOptions({ bw: 500, color: 'any', srlg: 'on' });
                    document.querySelector('[data-step="2"]').click();
                });
                await shot('te-dark');
            }
        }
        await navigate('#/lab/fsm-ladder');
        await until(() => !!document.querySelector('[data-option="mode"]'));
        await evaluate(() => document.querySelector('[data-act="play"]').click());
        await new Promise((r) => setTimeout(r, 350));
        assert.ok(await evaluate(() => window.testVisual.getContext().t > 0));
        await evaluate(() => document.querySelector('[data-act="play"]').click());
        const paused = await evaluate(() => window.testVisual.getContext().t);
        await new Promise((r) => setTimeout(r, 120));
        assert.equal(await evaluate(() => window.testVisual.getContext().t), paused);
        await evaluate(() => document.querySelector('#themeBtn').click());
        await shot('fsm-light');
        win.setSize(390, 844);
        await new Promise((r) => setTimeout(r, 100));
        assert.ok(
            await evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
            'mobile viewport overflow',
        );
        await shot('fsm-mobile');
        win.setSize(1500, 1060);
        for (const id of ['checksum-lab', 'timer-lab', 'lsa-arbiter', 'prefix-matcher', 'rid-lab']) {
            await navigate('#/lab/' + id);
            await until(() => !!document.querySelector('.dk-lab-guide'));
            assert.equal(await evaluate(() => document.querySelectorAll('.dk-lab-guide>div').length), 3);
            await shot(id);
        }
        await navigate('#/lab/prefix-matcher');
        await until(() => !!document.querySelector('[data-r="prefix"]'));
        await evaluate(() => {
            const e = document.querySelector('[data-r="prefix"]');
            e.value = '999.1.1.1';
            e.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.ok(await evaluate(() => document.querySelector('[data-out]').textContent.includes('有效 IPv4')));
        await evaluate(() => {
            const e = document.querySelector('[data-r="prefix"]');
            e.value = '1.1.0.0';
            e.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.ok(await evaluate(() => !!document.querySelector('.dk-len-axis')));
        await navigate('#/map');
        await until(() => !!document.querySelector('.dk-map-cluster'));
        assert.equal(await evaluate(() => document.querySelectorAll('.dk-map-article').length), seed.articles.length);
        await shot('map-light');
        await evaluate(() => document.querySelector('.dk-map-article').click());
        assert.ok(await evaluate(() => !!document.querySelector('.dk-map-detail .dk-diagram')));
        await shot('map-detail');
        await evaluate(() => document.querySelector('[data-mode="path"]').click());
        assert.ok(await evaluate(() => !!document.querySelector('.dk-map-path')));
        await evaluate(() => {
            const e = document.querySelector('[data-map-search]');
            e.value = 'no-such-topic';
            e.dispatchEvent(new Event('input', { bubbles: true }));
        });
        assert.ok(await evaluate(() => document.querySelector('.dk-map-count').textContent.startsWith('0 /')));
        await navigate('#/a/ospf-packets');
        await until(() => !!document.querySelector('.dk-reading-guide'));
        await until(() => !!document.querySelector('#articleStage .dk-lesson-layout'));
        assert.ok(await evaluate(() => {
            const stage = document.querySelector('#articleStage .dk-teaching');
            const layout = stage.querySelector('.dk-lesson-layout');
            return stage.clientWidth > 940 || getComputedStyle(layout).gridTemplateColumns.split(' ').length === 1;
        }), 'embedded lesson must stack its explanation in a narrow article column');
        await evaluate(() => document.querySelector('#articleStage').scrollIntoView({ block: 'start' }));
        await shot('article-embedded');
        const rfc = await evaluate(() => !!document.querySelector('[data-rfc]'));
        if (rfc) {
            await evaluate(() => document.querySelector('[data-rfc]').click());
            await until(() => !!document.querySelector('#modalRoot .dk-field'));
            await shot('rfc-modal');
            await evaluate(() => document.querySelector('[data-close]').click());
        }
        await navigate('#/a/ospf-fsm');
        await until(() => !!document.querySelector('.dk-mermaid-tools'));
        await evaluate(() => document.querySelector('[data-zoom="in"]').click());
        assert.equal(await evaluate(() => document.querySelector('.dk-mermaid-drawing').style.width), '125%');
        for (const article of seed.articles.filter((a) => a.bodyMd.includes('```mermaid'))) {
            await navigate('#/a/' + article.id);
            await until(() => !!document.querySelector('#articleBody'));
            await until(() => !document.querySelector('.dk-mermaid.is-pending'));
            assert.equal(
                await evaluate(() => document.querySelectorAll('.dk-mermaid.is-failed').length),
                0,
                `Mermaid failed in ${article.id}`,
            );
        }
        await win.loadURL(`http://127.0.0.1:${server.address().port}/live#/lab/fsm-ladder`);
        await until(() => !!document.querySelector('.dk-lesson-controls [data-visual-ai="qa"]'));
        assert.equal(await evaluate(() => document.querySelectorAll('.dk-nav-mode button').length), 2);
        assert.ok(await evaluate(() => document.querySelector('[data-nav-mode="notes"]').textContent.includes('笔记问答')));
        await evaluate(() => document.querySelector('[data-nav-mode="notes"]').click());
        await until(() => !!document.querySelector('.dk-review'));
        await evaluate(() => document.querySelector('[data-nav-mode="dir"]').click());
        await navigate('#/lab/fsm-ladder');
        await until(() => !!document.querySelector('.dk-lesson-controls [data-visual-ai="qa"]'));
        await evaluate(() => {
            document.querySelector('[data-step="1"]').click();
            document.querySelector('[data-visual-ai="qa"]').click();
        });
        await until(() => !!document.querySelector('.dk-ai-pop .dk-ai-quote'));
        assert.ok(
            await evaluate(() => document.querySelector('.dk-ai-quote').textContent.includes('确认双向')),
            'AI must use the teaching step context',
        );
        await evaluate(() => document.querySelector('.dk-ai-pop [data-close]').click());
        await evaluate(() => window.ToolsCustomI18n.setLanguage('en'));
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(await evaluate(() => document.querySelector('[data-act="play"]').textContent), 'Play');
        await shot('fsm-english');
        await evaluate(() => window.ToolsCustomI18n.setLanguage('zh'));
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(await evaluate(() => document.querySelector('[data-act="play"]').textContent), '播放演示');
        await navigate('#/a/layout-regression');
        await until(() => document.querySelectorAll('#articleBody .dk-block-badge').length === 4 && !!document.querySelector('.dk-mermaid-viewport'));
        for (const width of [1500, 860, 390]) {
            win.setSize(width, 1060);
            for (const theme of ['light', 'dark']) {
                await evaluate((theme) => {
                    document.documentElement.dataset.theme = theme;
                    window.ToolsCustomI18n.setLanguage(theme === 'light' ? 'zh' : 'en');
                }, theme);
                await evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
                const failures = await evaluate(() => {
                    const failures = [];
                    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
                    const header = document.querySelector('.dk-topbar');
                    const headerItems = [...header.children].filter((node) => node.getBoundingClientRect().width > 0);
                    for (const item of headerItems) {
                        const rect = item.getBoundingClientRect();
                        if (rect.right > innerWidth || rect.left < 0 || rect.bottom > header.getBoundingClientRect().bottom + 1) failures.push('header control clipped');
                        if (headerItems.some((other) => other !== item && overlaps(rect, other.getBoundingClientRect()))) failures.push('header control overlaps');
                    }
                    if (document.querySelector('#toolsCustomLanguageButton').parentElement !== header) failures.push('language button overlays content');
                    document.querySelectorAll('#articleBody .dk-block-ai').forEach((bar) => {
                        const host = bar.parentElement;
                        const buttons = [...bar.querySelectorAll('button')];
                        const content = [...host.children].filter((node) => node !== bar);
                        if (getComputedStyle(bar).position === 'absolute') failures.push('floating block action bar');
                        for (const button of buttons) {
                            const rect = button.getBoundingClientRect();
                            if (content.some((node) => overlaps(rect, node.getBoundingClientRect()))) failures.push('action covers block content');
                            if (buttons.some((other) => other !== button && overlaps(rect, other.getBoundingClientRect()))) failures.push('action covers another button');
                            if (rect.left < bar.getBoundingClientRect().left - 1 || rect.right > bar.getBoundingClientRect().right + 1) failures.push('action exceeds row width');
                        }
                    });
                    if (document.documentElement.scrollWidth > innerWidth + 2) failures.push('page overflows');
                    return failures;
                });
                if (failures.length) await shot('block-actions-failure');
                assert.deepEqual(failures, [], `AI toolbar overlap at ${width}px / ${theme}: ${JSON.stringify(failures)}`);
                if (width === 390 && theme === 'light') {
                    await evaluate(() => document.querySelector('.dk-mermaid').scrollIntoView({ block: 'center' }));
                    await shot('block-actions-mobile');
                }
            }
        }
        win.setSize(1500, 1060);
        await evaluate(() => {
            document.querySelector('.dk-mermaid-tools [data-zoom="in"]').click();
            document.querySelector('.dk-mermaid .dk-block-ai [data-block-ai="qa"]').click();
        });
        await until(() => !!document.querySelector('.dk-ai-pop .dk-ai-quote'));
        assert.ok(await evaluate(() => document.querySelector('.dk-ai-quote').textContent.includes('flowchart LR')));
        assert.equal(await evaluate(() => document.querySelector('.dk-mermaid-drawing').style.width), '125%');
        await evaluate(() => document.querySelector('.dk-ai-pop [data-close]').click());
        await evaluate(() => document.querySelector('.dk-mermaid').scrollIntoView({ block: 'center' }));
        await shot('block-actions-fixed');
        assert.deepEqual(errors, []);
        console.log(
            '11 lessons: every option and step; seek/restore, play/pause, all 5 labs, map, article, RFC, Mermaid, dark/light/mobile passed.',
        );
    })
    .then(() => {
        process.exitCode = 0;
    })
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (win) win.destroy();
        if (server) await new Promise((r) => server.close(r));
        fs.rmSync(temp, { recursive: true, force: true });
        app.exit(process.exitCode);
    });
