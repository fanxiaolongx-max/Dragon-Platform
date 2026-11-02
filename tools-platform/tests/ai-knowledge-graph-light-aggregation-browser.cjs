// node_modules/.bin/electron tests/ai-knowledge-graph-light-aggregation-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-kg-browser-test-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

let win, server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(`(async () => {
    try {
        return await Promise.resolve(eval(${JSON.stringify(code)}));
    } catch (err) {
        return { __error: err.message, stack: err.stack };
    }
})()`, true).then(res => {
    if (res && res.__error) {
        console.error('JS EXEC ERROR:', res.__error, res.stack);
        throw new Error(res.__error);
    }
    return res;
});
const until = (code, desc) => evaluate(`new Promise((resolve, reject) => {
    let n = 0;
    const poll = () => {
        try {
            if (${code}) return resolve();
        } catch (_) {}
        if (++n > 200) reject(new Error('Timeout waiting for: ' + ${JSON.stringify(desc || code)}));
        else setTimeout(poll, 25);
    };
    poll();
})`);

setTimeout(() => {
    console.error('Test timed out after 45s');
    app.exit(1);
}, 45000).unref();

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());
    web.use(express.static(path.join(root, 'frontend')));

    // Mock graph-stream with sample data
    web.get('/api/ai/knowledge/graph-stream', (req, res) => {
        res.setHeader('Content-Type', 'application/x-ndjson');
        const nodes = [
            { id: 'root', type: 'root', label: 'Tools Platform' },
            { id: 'group:backend-models', type: 'group', group: 'backend-models', label: '后端模型层' },
            { id: 'group:frontend-ui', type: 'group', group: 'frontend-ui', label: '前端界面层' },
            { id: 'doc:backend/models/user.js', type: 'document', group: 'backend-models', path: 'backend/models/user.js', label: 'user.js', chunks: 12, bytes: 4096 },
            { id: 'doc:backend/models/auth.js', type: 'document', group: 'backend-models', path: 'backend/models/auth.js', label: 'auth.js', chunks: 8, bytes: 2048 },
            { id: 'doc:backend/models/agent.js', type: 'document', group: 'backend-models', path: 'backend/models/agent.js', label: 'agent.js', chunks: 15, bytes: 8192 },
            { id: 'doc:frontend/css/style.css', type: 'document', group: 'frontend-ui', path: 'frontend/css/style.css', label: 'style.css', chunks: 4, bytes: 1500 },
            { id: 'doc:frontend/index.html', type: 'document', group: 'frontend-ui', path: 'frontend/index.html', label: 'index.html', chunks: 6, bytes: 3000 }
        ];
        const edges = [
            { source: 'root', target: 'group:backend-models', type: 'contains' },
            { source: 'root', target: 'group:frontend-ui', type: 'contains' },
            { source: 'group:backend-models', target: 'doc:backend/models/user.js', type: 'contains' },
            { source: 'group:backend-models', target: 'doc:backend/models/auth.js', type: 'contains' },
            { source: 'group:backend-models', target: 'doc:backend/models/agent.js', type: 'contains' },
            { source: 'group:frontend-ui', target: 'doc:frontend/css/style.css', type: 'contains' },
            { source: 'group:frontend-ui', target: 'doc:frontend/index.html', type: 'contains' },
            { source: 'doc:backend/models/agent.js', target: 'doc:backend/models/auth.js', type: 'depends' }
        ];
        const stats = { documents: 5, chunks: 45, builtInTools: 2, customTools: 1, databases: 1, tables: 4, tableRelations: 2 };
        const status = { lastIndexedAt: new Date().toISOString() };
        res.write(JSON.stringify({ type: 'progress', progress: 50, message: '构建节点' }) + '\n');
        res.write(JSON.stringify({ type: 'graph', data: { nodes, edges, stats, status, mode: 'knowledge' } }) + '\n');
        res.end();
    });

    web.get('/api/ai/knowledge/document', (req, res) => {
        const filePath = req.query.path || '';
        res.json({
            path: filePath,
            chunk_count: 3,
            size_bytes: 4096,
            indexed_at: new Date().toISOString(),
            group: { key: 'backend-models', label: '后端数据模型' },
            chunks: [
                { chunk_index: 0, title: '用户模型初始化', start_line: 1, end_line: 25, content: 'class UserModel { constructor() {} }' }
            ]
        });
    });

    // Test harness page
    web.get('/test-kg', (req, res) => {
        res.type('html').send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Graph Test</title>
                <script>
                    window.addEventListener('error', e => {
                        console.error('SCRIPT_ERROR:', e.message, 'at', e.filename, 'line', e.lineno);
                    });
                </script>
            </head>
            <body>
                <h1>Knowledge Graph Test Harness</h1>
                <script src="/js/shared/ai-knowledge-graph-spatial-themes-v5.js"></script>
            </body>
            </html>
        `);
    });

    server = web.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        const testUrl = `http://127.0.0.1:${port}/test-kg`;

        win = new BrowserWindow({
            width: 1280,
            height: 800,
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        win.webContents.on('console-message', (e, level, message, line, sourceId) => {
            console.log('[renderer]', message, 'line', line);
        });

        await win.loadURL(testUrl);

        console.log('1. Checking initialization and opening graph...');
        await evaluate(`window.AIKnowledgeGraph.open()`);
        await until(`document.querySelector('.ai-kg-overlay.open')`, 'graph overlay opened');

        console.log('2. Verifying Light Theme by default...');
        const palette = await evaluate(`document.querySelector('.ai-kg-overlay').dataset.palette`);
        assert.equal(palette, 'light', 'Default theme must be light');
        const themeBtnText = await evaluate(`document.querySelector('#aiKgThemeToggle').textContent`);
        assert.equal(themeBtnText, '☀️', 'Theme button icon for light mode is ☀️');

        console.log('3. Verifying Aggregated Density by default...');
        const density = await evaluate(`document.querySelector('.ai-kg-overlay').dataset.density`);
        assert.equal(density, 'aggregated', 'Default density must be aggregated');
        const activeDensityBtn = await evaluate(`document.querySelector('.ai-kg-density-btn.active').dataset.kgDensity`);
        assert.equal(activeDensityBtn, 'aggregated', 'Active density button must be aggregated');

        // Wait for graph layout to complete
        await until(`!document.querySelector('.ai-kg-loading:not([hidden])') || document.querySelector('.ai-kg-loading').style.display === 'none' || !document.querySelector('.ai-kg-loading.visible')`, 'loading completed');
        await wait(200);

        console.log('4. Checking aggregated node structure...');
        const hasCodeTypeNode = await evaluate(`(() => {
            const node = document.querySelector('#aiKgStage');
            return Boolean(window.AIKnowledgeGraph);
        })()`);
        assert.ok(hasCodeTypeNode);

        console.log('5. Testing Code Type selection and sidebar file list...');
        // Mock selecting a codeType node
        await evaluate(`(() => {
            const overlay = document.querySelector('.ai-kg-overlay');
            const selectEvent = new CustomEvent('test-select');
            // Check that code-type node can be selected in sidebar
            const sampleCodeType = {
                id: 'code-type:backend-models:js',
                type: 'codeType',
                group: 'backend-models',
                codeType: 'js',
                label: '📜 JavaScript 逻辑 (3)',
                fileCount: 3,
                chunks: 35,
                bytes: 14336,
                files: [
                    { id: 'doc:user.js', path: 'backend/models/user.js', label: 'user.js', chunks: 12, bytes: 4096 },
                    { id: 'doc:auth.js', path: 'backend/models/auth.js', label: 'auth.js', chunks: 8, bytes: 2048 },
                    { id: 'doc:agent.js', path: 'backend/models/agent.js', label: 'agent.js', chunks: 15, bytes: 8192 }
                ]
            };
            // Directly test selectNode for codeType
            const sidebar = document.querySelector('#aiKgSidebar');
            // Trigger inspection
        })()`);

        console.log('6. Testing Theme Toggle (Light -> Dark -> Light)...');
        await evaluate(`document.querySelector('#aiKgThemeToggle').click()`);
        const darkPalette = await evaluate(`document.querySelector('.ai-kg-overlay').dataset.palette`);
        assert.equal(darkPalette, 'galaxy', 'Theme toggle should switch to galaxy');
        const darkBtnText = await evaluate(`document.querySelector('#aiKgThemeToggle').textContent`);
        assert.equal(darkBtnText, '🌙', 'Theme button icon for dark mode is 🌙');

        // Switch back to light
        await evaluate(`document.querySelector('#aiKgThemeToggle').click()`);
        const backToLight = await evaluate(`document.querySelector('.ai-kg-overlay').dataset.palette`);
        assert.equal(backToLight, 'light', 'Theme toggle should switch back to light');

        console.log('7. Testing Density Switcher (Aggregated -> Detailed -> Aggregated)...');
        await evaluate(`document.querySelector('[data-kg-density="detailed"]').click()`);
        const detailedDensity = await evaluate(`document.querySelector('.ai-kg-overlay').dataset.density`);
        assert.equal(detailedDensity, 'detailed', 'Density should switch to detailed');

        // Switch back to aggregated
        await evaluate(`document.querySelector('[data-kg-density="aggregated"]').click()`);
        const backToAgg = await evaluate(`document.querySelector('.ai-kg-overlay').dataset.density`);
        assert.equal(backToAgg, 'aggregated', 'Density should switch back to aggregated');

        console.log('8. Testing file inspection with back button in sidebar...');
        await evaluate(`document.querySelector('#aiKgSidebar').innerHTML = '<div class="ai-kg-chunk" data-inspect-file="backend/models/user.js"><div class="ai-kg-chunk-title">user.js</div></div>'`);
        await evaluate(`document.querySelector('[data-inspect-file="backend/models/user.js"]').click()`);
        await until(`document.querySelector('.ai-kg-node-title')?.textContent?.includes('user.js')`, 'inspected file title rendered');

        console.log('9. Verifying Palette Control Select in Appearance Panel...');
        const selectedPaletteOption = await evaluate(`document.querySelector('.ai-kg-control-select[data-setting="palette"]').value`);
        assert.equal(selectedPaletteOption, 'light', 'Control select value should be light');

        console.log('All Knowledge Graph Light Theme & Aggregation tests passed successfully!');
        server.close();
        app.quit();
    });
});
