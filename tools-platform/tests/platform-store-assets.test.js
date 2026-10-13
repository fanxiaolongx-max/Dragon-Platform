const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PNG } = require('pngjs');
const { generateStoreAssets } = require('../backend/models/platform-store-assets');
const image = require('../backend/models/platform-logo-image');

test('transparent, narrow screenshots stay bounded and become opaque RGB images', () => {
    const source = image.encodePng(image.bitmap(1, 30));
    const result = generateStoreAssets(source, [source]);
    const bytes = result['store-assets/screenshot-01-1280x800.png'];
    assert.equal(bytes[25], 2);
    const png = PNG.sync.read(bytes);
    assert.equal(png.width, 1280); assert.equal(png.height, 800);
    assert.deepEqual([...png.data.subarray(0, 4)], [255, 255, 255, 255]);
});

function browser(empty = false) {
    const entries = [], capture = [];
    let removed = false, cleared = false;
    const canvas = { width: 1280, height: 800, getContext: () => ({ getImageData: () => ({ data: empty ? new Uint8Array(256) : Uint8Array.from([...Array(128).fill(0), ...Array(128).fill(255)]) }) }), toBlob: fn => fn({ type: 'image/png' }) };
    const clone = { querySelectorAll: selector => selector === 'input' ? [{ setAttribute() {}, set value(value) { cleared = value === ''; } }] : [{ remove() {} }], createElement: () => ({}), head: { appendChild() {} } };
    const login = { body: {}, images: [], fonts: { ready: Promise.resolve() }, querySelector: () => ({}), head: {} };
    const view = { loadPlatformIdentity: async () => {}, html2canvas: async (body, options) => { capture.push({ body, options }); options.onclone(clone); return canvas; } };
    const frame = { contentDocument: login, contentWindow: view, setAttribute() {}, style: {}, remove: () => { removed = true; } };
    const document = { body: { appendChild: item => queueMicrotask(() => item.onload()) }, createElement: () => frame };
    const window = {};
    const context = { window, document, setTimeout, clearTimeout, FormData: class { append(...args) { entries.push(args); } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/js/shared/store-assets.js'), 'utf8'), context);
    return { window, entries, capture, frame, removed: () => removed, cleared: () => cleared };
}

test('default loads a dedicated login page at 1280x800, clears credentials and removes the frame', async () => {
    const state = browser(); await state.window.ToolsStoreAssets.form([]);
    assert.equal(state.frame.src, '/login.html');
    assert.equal(state.capture.length, 1); assert.equal(state.removed(), true); assert.equal(state.cleared(), true);
    assert.equal(state.entries[0][2], 'login-page.png');
    assert.equal(state.capture[0].options.width, 1280); assert.equal(state.capture[0].options.y, 0);
});

test('blank rendering is rejected instead of silently downloading an empty screenshot', async () => {
    const state = browser(true);
    await assert.rejects(state.window.ToolsStoreAssets.form([]), /screenshot is empty/);
    assert.equal(state.removed(), true); assert.equal(state.entries.length, 0);
});

test('selected product screenshots bypass page capture; invalid files stop before upload', async () => {
    const state = browser(), file = { name: 'extension.png', type: 'image/png', size: 100 };
    await state.window.ToolsStoreAssets.form([file]);
    assert.equal(state.capture.length, 0); assert.equal(state.entries[0][1], file);
    await assert.rejects(state.window.ToolsStoreAssets.form(Array(6).fill(file)), /5/);
    await assert.rejects(state.window.ToolsStoreAssets.form([{ ...file, type: 'image/svg+xml' }]), /PNG\/JPEG/);
    await assert.rejects(state.window.ToolsStoreAssets.form([{ ...file, size: 11 * 1024 * 1024 }]), /10 MB/);
});
