const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');

const {
    ensureBuiltinToolAssets,
    ensureToolAudioReady,
    downloadToolAudioBundle,
    unpackToolBundle,
    REMOTE_MEDIA_BUNDLES
} = require('../backend/models/builtin-assets-unpacker');

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('unpackToolBundle extracts mp3 files from a zip buffer', async t => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpacker-test-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const zip = new JSZip();
    zip.file('test1.mp3', Buffer.from('audio-content-1'));
    zip.file('test2.mp3', Buffer.from('audio-content-2'));
    zip.file('ignore.txt', Buffer.from('text-file'));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    const bundlePath = path.join(tmpDir, 'audio.bundle.zip');
    fs.writeFileSync(bundlePath, zipBuffer);

    const extracted = await unpackToolBundle(tmpDir, bundlePath);
    assert.strictEqual(extracted, 2, '应成功解压 2 个 mp3 文件');
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'test1.mp3'), 'utf8'), 'audio-content-1');
    assert.strictEqual(fs.readFileSync(path.join(tmpDir, 'test2.mp3'), 'utf8'), 'audio-content-2');
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'ignore.txt')), false, '非 mp3 文件不应被解压');
});

test('downloadToolAudioBundle verifies sha256 checksum and rejects corrupt downloads', async t => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const toolDir = path.join(tmpDir, 'tool-mtakhxqm');
    fs.mkdirSync(toolDir, { recursive: true });

    // Mock fetch with invalid payload
    const mockFetch = async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('tampered-or-invalid-bytes')
    });

    await assert.rejects(
        () => downloadToolAudioBundle('tool-mtakhxqm', {
            toolDir,
            fetchImpl: mockFetch,
            timeoutMs: 2000
        }),
        /音频包校验失败/
    );
});

test('downloadToolAudioBundle succeeds with valid sha256', async t => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valid-download-test-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const toolDir = path.join(tmpDir, 'tool-mtakhxqm');
    fs.mkdirSync(toolDir, { recursive: true });

    const zip = new JSZip();
    zip.file('word.mp3', Buffer.from('sample-audio'));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const validHash = sha256(zipBuffer);

    const originalMeta = REMOTE_MEDIA_BUNDLES['tool-mtakhxqm'];
    REMOTE_MEDIA_BUNDLES['tool-mtakhxqm'] = {
        ...originalMeta,
        sha256: validHash
    };
    t.after(() => {
        REMOTE_MEDIA_BUNDLES['tool-mtakhxqm'] = originalMeta;
    });

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => zipBuffer
    });

    const downloadedPath = await downloadToolAudioBundle('tool-mtakhxqm', {
        toolDir,
        fetchImpl: mockFetch,
        timeoutMs: 2000
    });

    assert.ok(fs.existsSync(downloadedPath), '下载文件应存在');
    assert.strictEqual(sha256(fs.readFileSync(downloadedPath)), validHash, '哈希必须一致');
});

test('ensureBuiltinToolAssets marks tools without local bundle as on_demand when download is disabled', async t => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-test-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const toolDir = path.join(tmpDir, 'tool-mtakhxqm');
    const audioDir = path.join(toolDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });

    const results = await ensureBuiltinToolAssets({
        sourceDir: tmpDir,
        download: false
    });

    const classroom = results.find(r => r.tool === 'tool-mtakhxqm');
    assert.ok(classroom, '必须检查 tool-mtakhxqm');
    assert.strictEqual(classroom.status, 'on_demand');
    assert.ok(classroom.note.includes('按需从媒体仓库下载'));
});
