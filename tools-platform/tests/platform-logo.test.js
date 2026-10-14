const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const image = require('../backend/models/platform-logo-image');
const { logoStorage, resolveLogoAsset, createLogoAssetMiddleware, generateAndSaveLogo } = require('../backend/models/platform-logo-runtime');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-logo-js-test-'));
const root = path.resolve(__dirname, '..');
process.env.TOOLS_DATA_DIR = path.join(scratch, 'data');
test.after(async () => {
    const module = require.cache[require.resolve('../backend/models/platform-db')];
    if (module) await module.exports.closeDatabase();
    fs.rmSync(scratch, { recursive: true, force: true });
});

function fixture(width = 64, height = 64) {
    const bitmap = image.bitmap(width, height, Buffer.alloc(width * height * 4, 255));
    for (let y = 10; y < Math.min(51, height); y++) for (let x = 12; x < Math.min(53, width); x++) {
        bitmap.data.set([34, 102, 187, 255], (y * width + x) * 4);
    }
    for (let y = 18; y < Math.min(26, height); y++) for (let x = 25; x < Math.min(36, width); x++) {
        bitmap.data.set([255, 255, 255, 255], (y * width + x) * 4);
    }
    return bitmap;
}

function validateIco(bytes) {
    assert.equal(bytes.readUInt16LE(2), 1);
    assert.equal(bytes.readUInt16LE(4), 6);
    for (let i = 0; i < 6; i++) {
        const offset = 6 + i * 16, size = bytes[offset] || 256;
        assert.equal(size, image.ICON_SIZES[i]);
        const length = bytes.readUInt32LE(offset + 8), start = bytes.readUInt32LE(offset + 12);
        assert.ok(start + length <= bytes.length);
        const png = PNG.sync.read(bytes.subarray(start, start + length));
        assert.equal(png.width, size); assert.equal(png.height, size);
    }
}

test('matting removes outer white, preserves enclosed white artwork and colored boundary pixels', () => {
    const source = fixture();
    source.data.set([34, 102, 187, 255], 0);
    const output = image.removeWhiteBackground(source);
    assert.equal(output.data[(3 * 64 + 3) * 4 + 3], 0);
    assert.equal(output.data[(21 * 64 + 30) * 4 + 3], 255);
    assert.ok(output.data[3] > 100, 'foreground touching boundary must not be erased');
    assert.ok(output.data[(10 * 64 + 12) * 4 + 3] > 0);
});

test('already transparent artwork keeps semitransparency and internal white details', () => {
    const source = fixture();
    source.data[3] = 0;
    source.data[7] = 128;
    assert.deepEqual(image.removeWhiteBackground(source).data, source.data);
});

test('cropBottomTextRegion detects gap and crops bottom text band while leaving single mark intact', () => {
    const single = fixture(100, 100);
    assert.equal(image.cropBottomTextRegion(single).height, 100);

    const withText = image.bitmap(100, 100, Buffer.alloc(100 * 100 * 4, 0));
    for (let y = 10; y <= 50; y++) for (let x = 30; x <= 70; x++) {
        withText.data.set([50, 100, 200, 255], (y * 100 + x) * 4);
    }
    for (let y = 70; y <= 85; y++) for (let x = 20; x <= 80; x++) {
        withText.data.set([20, 20, 20, 255], (y * 100 + x) * 4);
    }
    const cropped = image.cropBottomTextRegion(withText);
    assert.ok(cropped.height <= 69, `Cropped height should be above text band: ${cropped.height}`);
    assert.ok(cropped.height >= 50, `Cropped height should retain main mark: ${cropped.height}`);
});

test('codecs decode PNG/JPEG and reject malformed or oversized inputs before processing', () => {
    const source = fixture();
    assert.equal(image.decodeImage(image.encodePng(source)).width, 64);
    assert.equal(image.decodeImage(jpeg.encode(source, 95).data).height, 64);
    assert.throws(() => image.decodeImage(Buffer.from('bad')), /Unsupported/);
    const huge = image.encodePng(source);
    huge.writeUInt32BE(1000000, 16);
    assert.throws(() => image.decodeImage(huge), /megapixels/);
});

test('CLI starts without Python or external commands', () => {
    const proc = spawnSync(process.execPath, [path.join(root, 'scripts/run-platform-logo.js'), '--help'], {
        env: { ...process.env, PATH: '', TOOLS_LOGO_PYTHON: '/missing-python' }, encoding: 'utf8'
    });
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stdout, /Generate and update/);
});

test('source generator writes 13 valid assets without modifying the real project', async () => {
    const outputRoot = path.join(scratch, 'source output');
    for (const dir of ['desktop-pet/assets', 'iosapp/iosApp/Assets.xcassets/AppIcon.appiconset']) fs.mkdirSync(path.join(outputRoot, dir), { recursive: true });
    const files = await generateAndSaveLogo(image.encodePng(fixture()), { storage: logoStorage({ root: outputRoot, env: {} }) });
    assert.equal(files.length, 13);
    const assets = path.join(outputRoot, 'frontend/assets');
    for (const [name, size] of [['logo.png', 1024], ['logo-raw.png', 1024], ['icon-mac.png', 1024], ['icon-windows.png', 256], ['icon-windows-portable.png', 256], ['icon.png', 32]]) {
        const png = PNG.sync.read(fs.readFileSync(path.join(assets, name)));
        assert.equal(png.width, size); assert.equal(png.height, size);
    }
    const raw = PNG.sync.read(fs.readFileSync(path.join(assets, 'logo-raw.png')));
    assert.equal(raw.data[3], 0);
    assert.equal(raw.data[(340 * 1024 + 480) * 4 + 3], 255);
    for (const name of ['icon.ico', 'icon-windows.ico', 'icon-windows-portable.ico']) validateIco(fs.readFileSync(path.join(assets, name)));
    const bmp = image.decodeBmp(fs.readFileSync(path.join(assets, 'portable-splash.bmp')));
    assert.equal(bmp.width, 620); assert.equal(bmp.height, 340);
    const original = image.decodeBmp(fs.readFileSync(path.join(root, 'frontend/assets/portable-splash.bmp')));
    assert.deepEqual(bmp.data.subarray(150 * 620 * 4), original.data.subarray(150 * 620 * 4), 'localized splash typography is retained');
});

test('disabling matting preserves opaque background; rectangular artwork retains proportions', async () => {
    const storage = logoStorage({ root: path.join(scratch, 'no effects'), env: {} });
    await generateAndSaveLogo(image.encodePng(fixture()), { storage, removeBg: false, darkEnhance: false });
    const png = PNG.sync.read(fs.readFileSync(path.join(storage.directory, 'logo.png')));
    assert.equal(png.data[3], 255);
    assert.equal(png.data[0], 255);
    const rectangle = image.bitmap(128, 64, Buffer.alloc(128 * 64 * 4, 255));
    await generateAndSaveLogo(image.encodePng(rectangle), { storage, removeBg: false, darkEnhance: false });
    const rectangular = PNG.sync.read(fs.readFileSync(path.join(storage.directory, 'logo.png')));
    assert.equal(rectangular.data[3], 0, 'square canvas should have transparent padding');
    assert.equal(rectangular.data[(512 * 1024 + 512) * 4 + 3], 255);
});

test('desktop mode writes only user data and serves overrides after restart with bundled fallback', async () => {
    const packagedRoot = path.join(scratch, 'application', 'app.asar');
    const bundled = path.join(packagedRoot, 'frontend/assets');
    fs.mkdirSync(bundled, { recursive: true });
    const original = image.encodePng(fixture());
    fs.writeFileSync(path.join(bundled, 'logo.png'), original);
    const options = { root: packagedRoot, env: { TOOLS_DESKTOP_RUNTIME: '1', TOOLS_BRANDING_DIR: path.join(scratch, 'user data/branding') } };
    let storage = logoStorage(options);
    assert.equal(resolveLogoAsset('logo.png', storage), path.join(bundled, 'logo.png'));
    assert.equal(resolveLogoAsset('../secret', storage), null);
    fs.chmodSync(bundled, 0o555);
    try {
        const files = await generateAndSaveLogo(original, { storage });
        assert.equal(files.length, 10);
        assert.ok(files.every(file => file.startsWith(storage.directory)));
        assert.deepEqual(fs.readFileSync(path.join(bundled, 'logo.png')), original);
        storage = logoStorage(options);
        assert.equal(resolveLogoAsset('logo.png', storage), path.join(storage.directory, 'logo.png'));
        const app = require('express')();
        app.use(createLogoAssetMiddleware(options));
        const request = require('supertest');
        const png = await request(app).get('/assets/logo.png?v=old');
        assert.equal(png.status, 200); assert.match(png.headers['cache-control'], /no-cache/);
        assert.deepEqual(png.body, fs.readFileSync(path.join(storage.directory, 'logo.png')));
        const icon = await request(app).get('/favicon.ico');
        assert.equal(icon.status, 200); validateIco(icon.body);
        assert.equal((await request(app).get('/assets/unrelated.png')).status, 404);
    } finally { fs.chmodSync(bundled, 0o755); }
});

test('write failures roll back previous assets and release processing lock', async () => {
    const storage = logoStorage({ root: path.join(scratch, 'rollback'), env: {} });
    fs.mkdirSync(storage.directory, { recursive: true });
    fs.writeFileSync(path.join(storage.directory, 'logo.png'), 'previous logo');
    fs.mkdirSync(path.join(storage.directory, 'icon-mac.png'));
    await assert.rejects(generateAndSaveLogo(image.encodePng(fixture()), { storage }), /directory|EISDIR/i);
    assert.equal(fs.readFileSync(path.join(storage.directory, 'logo.png'), 'utf8'), 'previous logo');
    assert.equal(fs.existsSync(path.join(storage.directory, 'logo-raw.png')), false);
    fs.rmdirSync(path.join(storage.directory, 'icon-mac.png'));
    await generateAndSaveLogo(image.encodePng(fixture()), { storage });
    assert.equal(PNG.sync.read(fs.readFileSync(path.join(storage.directory, 'logo.png'))).width, 1024);
});

test('upload route enforces admin rights and returns structured errors without overwriting icons', async () => {
    const options = { root: path.join(scratch, 'upload'), env: {} };
    const app = require('express')();
    app.use((req, res, next) => { req.requestId = 'logo-test'; if (req.headers['x-test-admin']) req.user = { role: 'admin' }; next(); });
    app.use('/api/platform-logo', require('../backend/routes/platform-logo').createLogoRouter(options));
    const request = require('supertest');
    assert.equal((await request(app).post('/api/platform-logo/upload').attach('logo', image.encodePng(fixture()), 'logo.png')).status, 403);
    const invalid = await request(app).post('/api/platform-logo/upload').set('x-test-admin', '1').attach('logo', Buffer.from('bad'), 'logo.png');
    assert.equal(invalid.status, 400); assert.equal(invalid.body.code, 'LOGO_PROCESSING_FAILED'); assert.equal(invalid.body.requestId, 'logo-test');
    const result = await request(app).post('/api/platform-logo/upload').set('x-test-admin', '1').field('removeBg', 'false').field('darkEnhance', 'false').attach('logo', image.encodePng(fixture()), 'logo.png');
    assert.equal(result.status, 200); assert.equal(result.body.assetCount, 10);
    const status = await request(app).get('/api/platform-logo/status');
    assert.equal(status.body.storageMode, 'source'); assert.equal(status.body.hasLogo, true); assert.ok(status.body.fileSizes.windows > 0);

    const JSZip = require('jszip');
    assert.equal((await request(app).get('/api/platform-logo/download-bundle')).status, 403);
    const binaryParser = (res, cb) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const bundleRes = await request(app).get('/api/platform-logo/download-bundle').set('x-test-admin', '1').buffer().parse(binaryParser);
    assert.equal(bundleRes.status, 200);
    assert.equal(bundleRes.headers['content-type'], 'application/zip');
    assert.match(bundleRes.headers['content-disposition'], /(?:tools-platform|thoth-platform|dragon-platform|dragon|eg-cs-hub)-brand-assets-.*\.zip/);
    const archive = await JSZip.loadAsync(bundleRes.body);
    assert.ok(archive.file('logo.png'));
    assert.ok(archive.file('icon-mac.png'));
    assert.ok(archive.file('icon-windows.ico'));
    assert.ok(archive.file('icon-windows-portable.ico'));
    assert.ok(archive.file('portable-splash.bmp'));
    assert.ok(archive.file('README.txt'));
    const readmeContent = await archive.file('README.txt').async('string');
    assert.match(readmeContent, /Brand & Icon Assets Bundle/);
    assert.ok(archive.file('store-assets/store-icon-128x128.png'));
    const storeIcon = PNG.sync.read(await archive.file('store-assets/store-icon-128x128.png').async('nodebuffer'));
    assert.equal(storeIcon.width, 128); assert.equal(storeIcon.height, 128); assert.equal(storeIcon.data[3], 0);
    for (const [name, width, height] of [['small-promo-440x280.png', 440, 280], ['marquee-1400x560.png', 1400, 560]]) {
        const bytes = await archive.file('store-assets/' + name).async('nodebuffer');
        assert.equal(bytes[24], 8); assert.equal(bytes[25], 2, 'RGB PNG has no alpha channel');
        const png = PNG.sync.read(bytes); assert.equal(png.width, width); assert.equal(png.height, height);
    }
    assert.equal((await request(app).post('/api/platform-logo/download-bundle').attach('screenshots', image.encodePng(fixture()), 'screen.png')).status, 403);
    const submit = () => request(app).post('/api/platform-logo/download-bundle').set('x-test-admin', '1');
    assert.equal((await submit()).status, 400);
    assert.equal((await submit().attach('screenshots', Buffer.from('not an image'), 'fake.png')).status, 400);
    let tooMany = submit();
    for (let i = 0; i < 6; i++) tooMany = tooMany.attach('screenshots', image.encodePng(fixture()), 'screen.png');
    assert.equal((await tooMany).status, 400);
    const fullBundle = await submit().attach('screenshots', image.encodePng(fixture(100, 64)), 'screen.png')
        .attach('screenshots', jpeg.encode(fixture(), 95).data, 'screen.jpg').buffer().parse(binaryParser);
    assert.equal(fullBundle.status, 200);
    const fullArchive = await JSZip.loadAsync(fullBundle.body);
    for (let i = 1; i <= 2; i++) {
        const bytes = await fullArchive.file(`store-assets/screenshot-0${i}-1280x800.png`).async('nodebuffer');
        assert.equal(bytes[25], 2); const png = PNG.sync.read(bytes);
        assert.equal(png.width, 1280); assert.equal(png.height, 800);
        assert.ok(png.data.every((value, index) => index % 4 !== 3 || value === 255));
    }
    assert.equal(fullArchive.file('store-assets/screenshot-03-1280x800.png'), null);
});

test('concurrent logo uploads are rejected while the event loop remains responsive', async () => {
    const storage = logoStorage({ root: path.join(scratch, 'concurrent'), env: {} });
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const work = generateAndSaveLogo(image.encodePng(fixture()), { storage });
    await assert.rejects(generateAndSaveLogo(image.encodePng(fixture()), { storage }), { code: 'LOGO_BUSY' });
    try { await work; assert.ok(ticks > 2, 'pixel processing must not block the server event loop'); }
    finally { clearInterval(timer); }
});

test('real Electron ASAR can generate icons with no Python, PATH commands or writable application resources', async t => {
    let electron, asar;
    try { electron = require('electron'); asar = require('@electron/asar'); }
    catch (_) { t.skip('Electron development runtime unavailable'); return; }
    if (!fs.existsSync(electron)) { t.skip('Electron executable unavailable'); return; }
    const content = path.join(scratch, 'packaged-source');
    for (const relative of ['backend/models/platform-logo-runtime.js', 'backend/models/platform-logo-image.js',
        'backend/workers/platform-logo-worker.js', 'frontend/assets/portable-splash.bmp']) {
        const target = path.join(content, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, relative), target);
    }
    for (const dependency of ['pngjs', 'jpeg-js']) {
        fs.cpSync(path.dirname(require.resolve(`${dependency}/package.json`)), path.join(content, 'node_modules', dependency), { recursive: true });
    }
    const archive = path.join(scratch, 'actual-app.asar');
    await asar.createPackage(content, archive);
    const before = fs.readFileSync(archive);
    const input = path.join(scratch, 'asar-input.png');
    fs.writeFileSync(input, image.encodePng(fixture()));
    const runner = path.join(scratch, 'asar-runner.cjs');
    fs.writeFileSync(runner, `
const fs = require('fs');
const runtime = require(process.argv[2] + '/backend/models/platform-logo-runtime.js');
(async () => {
    const storage = runtime.logoStorage({root:process.argv[2],env:{TOOLS_DESKTOP_RUNTIME:'1',TOOLS_BRANDING_DIR:process.argv[3]}});
    const files = await runtime.generateAndSaveLogo(fs.readFileSync(process.argv[4]), {storage});
    console.log(JSON.stringify({count:files.length,allInUserData:files.every(file=>file.startsWith(storage.directory))}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
`);
    const result = spawnSync(electron, [runner, archive, path.join(scratch, 'packaged-user-data/branding'), input], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: '', TOOLS_LOGO_PYTHON: '/missing-python' }, encoding: 'utf8', timeout: 30000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { count: 10, allInUserData: true });
    assert.deepEqual(fs.readFileSync(archive), before, 'ASAR contents must remain unchanged');
});
