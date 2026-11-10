const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { board, transaction, cleanupExpiredRequirementImages, startImageCleanupSchedule, stopImageCleanupSchedule } = require('../backend/models/requirements-board');

test('cleanupExpiredRequirementImages cleans up images for old closed requirements and writes logs', async () => {
    await board();

    // Insert test requirements with different statuses, dates, and images
    let oldClosedId, recentClosedId, oldRejectedId, oldOpenId, noImageId;

    await transaction(async query => {
        // 1. Old Closed (40 days old, status: 需求评价, has 2 images) -> SHOULD BE CLEANED
        const r1 = await query.run(
            `INSERT INTO Requirements (title, description, category, status, creator, images, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-40 days'), datetime('now', '-40 days'))`,
            ['Old Closed Req', 'Desc', '全局通用', '需求评价', 'alice', JSON.stringify([
                { name: '1.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
                { name: '2.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
            ])]
        );
        oldClosedId = r1.id;

        // 2. Recent Closed (5 days old, status: 需求评价, has 1 image) -> SHOULD NOT BE CLEANED
        const r2 = await query.run(
            `INSERT INTO Requirements (title, description, category, status, creator, images, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-5 days'), datetime('now', '-5 days'))`,
            ['Recent Closed Req', 'Desc', '全局通用', '需求评价', 'bob', JSON.stringify([
                { name: 'recent.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
            ])]
        );
        recentClosedId = r2.id;

        // 3. Old Rejected (35 days old, status: 已拒绝, has 1 image) -> SHOULD BE CLEANED
        const r3 = await query.run(
            `INSERT INTO Requirements (title, description, category, status, creator, images, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-35 days'), datetime('now', '-35 days'))`,
            ['Old Rejected Req', 'Desc', '全局通用', '已拒绝', 'charlie', JSON.stringify([
                { name: 'rej.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
            ])]
        );
        oldRejectedId = r3.id;

        // 4. Old Open (60 days old, status: 需求实现中, has 1 image) -> SHOULD NOT BE CLEANED (Not closed)
        const r4 = await query.run(
            `INSERT INTO Requirements (title, description, category, status, creator, images, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-60 days'), datetime('now', '-60 days'))`,
            ['Old Open Req', 'Desc', '全局通用', '需求实现中', 'david', JSON.stringify([
                { name: 'open.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
            ])]
        );
        oldOpenId = r4.id;

        // 5. Old Closed without images (45 days old, status: 需求评价, images = '[]') -> Ignored
        const r5 = await query.run(
            `INSERT INTO Requirements (title, description, category, status, creator, images, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-45 days'), datetime('now', '-45 days'))`,
            ['Old Closed No Images', 'Desc', '全局通用', '需求评价', 'eve', '[]']
        );
        noImageId = r5.id;
    });

    // Run cleanup with default 30 days retention
    const stats = await cleanupExpiredRequirementImages({ retentionDays: 30 });
    assert.equal(stats.cleanedCount, 2, 'Should clean exactly 2 requirements (old closed + old rejected)');
    assert.equal(stats.imagesFreed, 3, 'Should free 3 images total (2 from r1, 1 from r3)');

    // Verify database state after cleanup
    const query = await board();

    const rowOldClosed = await query.get('SELECT images FROM Requirements WHERE id = ?', [oldClosedId]);
    assert.equal(rowOldClosed.images, '[]', 'Old closed requirement images must be reset to []');

    const rowOldRejected = await query.get('SELECT images FROM Requirements WHERE id = ?', [oldRejectedId]);
    assert.equal(rowOldRejected.images, '[]', 'Old rejected requirement images must be reset to []');

    const rowRecentClosed = await query.get('SELECT images FROM Requirements WHERE id = ?', [recentClosedId]);
    assert.notEqual(rowRecentClosed.images, '[]', 'Recent closed requirement images must remain intact');
    assert.equal(JSON.parse(rowRecentClosed.images).length, 1);

    const rowOldOpen = await query.get('SELECT images FROM Requirements WHERE id = ?', [oldOpenId]);
    assert.notEqual(rowOldOpen.images, '[]', 'Old open requirement images must remain intact');
    assert.equal(JSON.parse(rowOldOpen.images).length, 1);

    // Verify RequirementLogs entries
    const logsOldClosed = await query.all('SELECT * FROM RequirementLogs WHERE req_id = ? AND operator = "system"', [oldClosedId]);
    assert.equal(logsOldClosed.length, 1, 'Must write 1 system log entry for old closed requirement');
    assert.equal(logsOldClosed[0].old_status, '需求评价');
    assert.equal(logsOldClosed[0].new_status, '需求评价');
    assert.ok(logsOldClosed[0].remark.includes('自动清理 2 张图片'));

    const logsOldRejected = await query.all('SELECT * FROM RequirementLogs WHERE req_id = ? AND operator = "system"', [oldRejectedId]);
    assert.equal(logsOldRejected.length, 1, 'Must write 1 system log entry for old rejected requirement');
    assert.equal(logsOldRejected[0].old_status, '已拒绝');
    assert.equal(logsOldRejected[0].new_status, '已拒绝');
    assert.ok(logsOldRejected[0].remark.includes('自动清理 1 张图片'));

    // Re-running cleanup should be idempotent (nothing to clean)
    const statsSecondRun = await cleanupExpiredRequirementImages({ retentionDays: 30 });
    assert.equal(statsSecondRun.cleanedCount, 0);
    assert.equal(statsSecondRun.imagesFreed, 0);

    // Clean up test rows
    await transaction(async q => {
        await q.run(`DELETE FROM Requirements WHERE id IN (?, ?, ?, ?, ?)`, [oldClosedId, recentClosedId, oldRejectedId, oldOpenId, noImageId]);
        await q.run(`DELETE FROM RequirementLogs WHERE req_id IN (?, ?, ?, ?, ?)`, [oldClosedId, recentClosedId, oldRejectedId, oldOpenId, noImageId]);
    });
});

test('startImageCleanupSchedule and stopImageCleanupSchedule manage recurring timer', () => {
    const timer = startImageCleanupSchedule({ intervalMs: 100000 });
    assert.ok(timer, 'Timer must be returned');
    stopImageCleanupSchedule();
});

test('RequirementsClient auto-compression and validation tests', async () => {
    const context = {
        window: {},
        crypto: {
            subtle: {
                digest: async () => new Uint8Array(32)
            },
            getRandomValues: arr => arr
        },
        TextEncoder,
        TextDecoder,
        atob: str => Buffer.from(str, 'base64').toString('binary'),
        btoa: str => Buffer.from(str, 'binary').toString('base64')
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/requirements-client.js'), 'utf8'), context);
    const client = context.window.RequirementsClient;
    assert.ok(client);

    // 1. Validation tests
    const validJpg = { name: 'test.jpg', type: 'image/jpeg', size: 1024 * 1024 };
    const validPng = { name: 'test.png', type: 'image/png', size: 15 * 1024 * 1024 };
    const validWebp = { name: 'test.webp', type: 'image/webp', size: 500 * 1024 };
    const validGif = { name: 'test.gif', type: 'image/gif', size: 2 * 1024 * 1024 };
    const oversized = { name: 'huge.jpg', type: 'image/jpeg', size: 25 * 1024 * 1024 };
    const invalidType = { name: 'bad.exe', type: 'application/x-msdownload', size: 1024 };

    assert.equal(client.validImages([validJpg, validPng, validWebp, validGif]), true, 'Normal images under 20MB are valid');
    assert.equal(client.validImages([oversized]), false, 'Oversized image (>20MB) is rejected');
    assert.equal(client.validImages([invalidType]), false, 'Invalid MIME type is rejected');
    assert.equal(client.validImages([validJpg, validPng, validWebp, validGif, validJpg, validPng, validWebp]), false, 'Over 6 images is rejected');

    // 2. GIF preservation test
    const gifBuffer = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');
    const gifFile = {
        name: 'anim.gif',
        type: 'image/gif',
        size: gifBuffer.length,
        arrayBuffer: async () => gifBuffer.buffer.slice(gifBuffer.byteOffset, gifBuffer.byteOffset + gifBuffer.byteLength)
    };
    const compressedGif = await client.compressImage(gifFile);
    assert.equal(compressedGif.type, 'image/gif', 'GIF format must be preserved');
    assert.equal(compressedGif.name, 'anim.gif');
    assert.deepEqual(Buffer.from(compressedGif.bytes), gifBuffer, 'GIF bytes must be preserved intact');

    // 3. Fallback when DOM/Canvas is absent
    const pngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e527defc0000000049454e44ae426082', 'hex');
    const pngFile = {
        name: 'test.png',
        type: 'image/png',
        size: pngBuffer.length,
        arrayBuffer: async () => pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength)
    };
    const compressedFallback = await client.compressImage(pngFile);
    assert.equal(compressedFallback.name, 'test.png');
    assert.equal(compressedFallback.type, 'image/png');
    assert.deepEqual(Buffer.from(compressedFallback.bytes), pngBuffer);

    // 4. Encode images integration
    const encoded = await client.encodeImages([pngFile, gifFile]);
    assert.equal(encoded.length, 2);
    assert.equal(encoded[0].name, 'test.png');
    assert.equal(encoded[0].type, 'image/png');
    assert.equal(typeof encoded[0].data, 'string');
    assert.equal(encoded[1].name, 'anim.gif');
    assert.equal(encoded[1].type, 'image/gif');
});

test('RequirementsClient compressImage resizes and converts to WebP when Canvas is available', async () => {
    let drawn = false;
    let convertedFormat = null;
    let convertedQuality = null;

    const mockCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            drawImage: (source, x, y, w, h) => {
                drawn = true;
                assert.equal(w, 1920, 'Width must be clamped to 1920');
                assert.equal(h, 1080, 'Height must be scaled proportionally');
            }
        }),
        toDataURL: format => format === 'image/webp' ? 'data:image/webp;base64,...' : '',
        toBlob: (callback, format, quality) => {
            convertedFormat = format;
            convertedQuality = quality;
            const fakeCompressed = Buffer.from('RIFF....WEBPfakecompresseddata');
            callback({
                size: fakeCompressed.length,
                arrayBuffer: async () => fakeCompressed.buffer.slice(fakeCompressed.byteOffset, fakeCompressed.byteOffset + fakeCompressed.byteLength)
            });
        }
    };

    const context = {
        window: {},
        document: {
            createElement: tag => tag === 'canvas' ? mockCanvas : {}
        },
        createImageBitmap: async () => ({
            width: 3840,
            height: 2160,
            close: () => {}
        }),
        TextEncoder,
        TextDecoder,
        atob: str => Buffer.from(str, 'base64').toString('binary'),
        btoa: str => Buffer.from(str, 'binary').toString('base64')
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/requirements-client.js'), 'utf8'), context);
    const client = context.window.RequirementsClient;

    const largeFile = {
        name: 'huge-screenshot.png',
        type: 'image/png',
        size: 8 * 1024 * 1024, // 8MB uncompressed
        arrayBuffer: async () => new ArrayBuffer(8 * 1024 * 1024)
    };

    const result = await client.compressImage(largeFile);
    assert.ok(drawn, 'Canvas drawImage must be executed');
    assert.equal(convertedFormat, 'image/webp', 'Should convert to WebP format');
    assert.equal(convertedQuality, 0.82, 'Should use 0.82 quality');
    assert.equal(result.type, 'image/webp');
    assert.equal(result.name, 'huge-screenshot.webp', 'File extension should be updated to .webp');
    assert.ok(result.bytes.length < largeFile.size, 'Compressed output must be smaller than original');
});
