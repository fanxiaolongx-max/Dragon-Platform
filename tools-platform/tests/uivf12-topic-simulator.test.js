const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const copySource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/copy.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(projectRoot, 'frontend/css/uivf12.css'), 'utf8');
const pageSource = fs.readFileSync(path.join(projectRoot, 'frontend/pages/uivf12.html'), 'utf8');
const netcareSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/netcare-analysis.js'), 'utf8');
const datafabSource = fs.readFileSync(path.join(projectRoot, 'frontend/js/uivf12/datafab-analysis.js'), 'utf8');

test('site picker offers simulation only for sites with a topic runtime', () => {
    assert.match(copySource, /function getTopicSimulatorConfig/);
    assert.match(copySource, /origin === 'https:\/\/netcare\.huawei\.com'/);
    assert.match(copySource, /origin === 'https:\/\/datafab-pro\.gtsdata\.huawei\.com'/);
    assert.match(copySource, /simulator \? `<button type="button" class="uiv-site-script-simulate"/);
    assert.match(copySource, /(?:\$\{UIVT\('uiv\.siteScript\.simulate'\)\}|模拟浮窗)<\/button>/);
    assert.match(copySource, /class="uiv-site-script-buttons">\$\{simulator[\s\S]*uiv-site-script-copy/);
});

test('topic simulator reuses the production renderers in offline-only mode', () => {
    assert.match(copySource, /function openTopicFloatingSimulator/);
    assert.match(copySource, /config\.api\.installForSimulation/);
    assert.match(copySource, /离线模拟模式不会请求正式站点/);
    assert.match(copySource, /archiveImportedTopicSnapshot\(snapshot, onUploadProgress\)/);
    assert.match(copySource, /\/api\/topic-snapshots/);
    assert.match(netcareSource, /const simulationMode = Boolean\(options && options\.simulation\)/);
    assert.match(datafabSource, /const simulationMode = Boolean\(options && options\.simulation\)/);
    assert.match(netcareSource, /installForSimulation\(root, options\)/);
    assert.match(datafabSource, /installForSimulation\(root, options\)/);
    assert.match(netcareSource, /Simulation does not call live APIs/);
    assert.match(datafabSource, /Simulation does not call live APIs/);
    assert.match(cssSource, /\.uiv-topic-simulator-overlay/);
});

test('simulator assets are cache-busted on the UIVF12 page', () => {
    assert.match(pageSource, /uivf12\.css\?v=20261010-01/);
    assert.match(pageSource, /netcare-analysis\.js\?v=20261011-02/);
    assert.match(pageSource, /datafab-analysis\.js\?v=20260911-03/);
    assert.match(pageSource, /copy\.js\?v=20261010-01/);
    assert.match(pageSource, /custom-tool-upload\.js\?v=20261010-02/);
});
