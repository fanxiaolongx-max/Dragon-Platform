const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isValidUtf8, decodeUtf8Strict, trimPartialUtf8 } = require('../backend/models/safe-utf8');

test('strict UTF-8 decoding returns null for other encodings instead of throwing', () => {
    const gbk = Buffer.from('c4e3bac3cac0bde7', 'hex'); // “你好世界” 的 GBK 字节
    assert.equal(isValidUtf8(gbk), false);
    assert.equal(decodeUtf8Strict(gbk), null);
    assert.equal(decodeUtf8Strict(Buffer.from('你好 world')), '你好 world');
    assert.equal(decodeUtf8Strict(Buffer.from('﻿带 BOM')), '带 BOM');
    assert.equal(decodeUtf8Strict(new Uint8Array(Buffer.from('字节数组'))), '字节数组');
    assert.equal(decodeUtf8Strict(Buffer.alloc(0)), '');
    assert.equal(decodeUtf8Strict(Buffer.from([0xe4, 0xbd])), null);
});

test('a UTF-8 slice cut in the middle of a character is still recognised as UTF-8', () => {
    const text = Buffer.from('命令行输出：华为路由器 display cpu-defend');
    for (let start = 0; start < 4; start += 1) {
        for (let end = text.length - 4; end <= text.length; end += 1) {
            const piece = trimPartialUtf8(text.subarray(start, end));
            assert.notEqual(decodeUtf8Strict(piece), null, `${start}-${end}`);
        }
    }
});

test('command output in GBK or truncated UTF-8 is decoded without the crashing decoder', () => {
    const { decodeProcessBuffer } = require('../backend/models/agent-tools-service');
    assert.equal(decodeProcessBuffer(Buffer.from('c4e3bac3cac0bde7', 'hex')), '你好世界');
    assert.equal(decodeProcessBuffer(Buffer.from('检索关键词').subarray(0, 14)), '检索关键');
});

test('backend code never uses the fatal TextDecoder that crashes the desktop app', () => {
    const offenders = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (['node_modules', 'data', 'backups', 'builtin-tools', 'defaults', 'factory-reset-archives'].includes(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js') && entry.name !== 'safe-utf8.js' && /fatal:\s*true/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(path.join(__dirname, '..'), full));
        }
    };
    walk(path.join(__dirname, '..', 'backend'));
    for (const file of fs.readdirSync(path.join(__dirname, '..'))) {
        if (/\.js$/.test(file) && /fatal:\s*true/.test(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))) offenders.push(file);
    }
    assert.deepEqual(offenders, [], '改用 backend/models/safe-utf8.js');
});

function resolveElectronBinary() {
    try {
        const electronPath = require('electron');
        if (typeof electronPath === 'string' && fs.existsSync(electronPath)) return electronPath;
    } catch (_) {
        return null;
    }
    return null;
}

const electronBin = resolveElectronBinary();

// 桌面端实际用的运行时：同样的非法字节，在这里不会让进程崩溃
test('the desktop runtime survives invalid bytes through the safe decoder', { skip: !electronBin }, () => {
    const script = `const { decodeUtf8Strict } = require(${JSON.stringify(path.join(__dirname, '..', 'backend', 'models', 'safe-utf8.js'))});
        const crypto = require('crypto'); let bad = 0;
        for (let i = 0; i < 1500; i += 1) if (decodeUtf8Strict(crypto.randomBytes(1 + Math.floor(Math.random() * 65536))) === null) bad += 1;
        console.log('ok ' + bad);`;
    const result = spawnSync(electronBin, ['-e', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, `signal=${result.signal} ${result.stderr}`);
    assert.match(result.stdout, /^ok 1500/);
});
