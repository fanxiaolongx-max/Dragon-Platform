const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('UI.Vision extension zip file exists in downloads directory and is readable', () => {
    const zipPath = path.join(__dirname, '../frontend/downloads/uivision-extension-9.6.1.zip');
    assert.ok(fs.existsSync(zipPath), 'Zip file should exist in frontend/downloads');
    const stat = fs.statSync(zipPath);
    assert.ok(stat.size > 8000000, `Zip file size (${stat.size}) should be around ~8.5MB`);
});

test('uivf12.html contains extension guide modal and script reference', () => {
    const htmlPath = path.join(__dirname, '../frontend/pages/uivf12.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(html.includes('id="btnDownloadUivExtension"'), 'Header should contain btnDownloadUivExtension');
    assert.ok(html.includes('id="uivExtensionGuideOverlay"'), 'HTML should contain uivExtensionGuideOverlay');
    assert.ok(html.includes('extension-guide.js'), 'HTML should load extension-guide.js');
    assert.ok(html.includes('uivision-extension-9.6.1.zip'), 'HTML should reference uivision-extension-9.6.1.zip');
    assert.ok(html.includes('chrome://extensions/'), 'HTML should contain chrome://extensions/ guide');
});

test('extension-guide.js exports UIVExtensionGuide controller', () => {
    const jsPath = path.join(__dirname, '../frontend/js/uivf12/extension-guide.js');
    const js = fs.readFileSync(jsPath, 'utf8');
    assert.ok(js.includes('window.UIVExtensionGuide ='), 'Should expose window.UIVExtensionGuide');
    assert.ok(js.includes('open,'), 'Should expose open method');
    assert.ok(js.includes('download,'), 'Should expose download method');
    assert.ok(js.includes('copyUrl,'), 'Should expose copyUrl method');
    assert.ok(js.includes('copyAllSteps,'), 'Should expose copyAllSteps method');
    assert.ok(js.includes('openOfficialStore,'), 'Should expose openOfficialStore method');
    assert.ok(js.includes('switchStore,'), 'Should expose switchStore method');
});

test('extension-guide supports official Chrome & Edge stores and browser detection', () => {
    const jsPath = path.join(__dirname, '../frontend/js/uivf12/extension-guide.js');
    const js = fs.readFileSync(jsPath, 'utf8');
    assert.ok(js.includes('CHROME_STORE_URL'), 'Should define CHROME_STORE_URL');
    assert.ok(js.includes('EDGE_STORE_URL'), 'Should define EDGE_STORE_URL');
    assert.ok(js.includes('https://chromewebstore.google.com/detail/uivision/gcbalfbdmfieckjlnblleoemohcganoc'), 'Must include exact Chrome store URL');
    assert.ok(js.includes('https://microsoftedge.microsoft.com/addons/detail/uivision-rpa-'), 'Must include Edge Add-ons store URL');
});

