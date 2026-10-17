const crypto = require('crypto');

// 桌面版机器码：DPMC1.<base64url(JSON)>.<校验位>
// JSON 只含设备指纹（多项硬件/系统唯一标识的哈希，不含原始序列号）与便于管理员识别的设备名、系统信息。
// 校验位用于发现复制粘贴时的截断或误改；真正防篡改的是签发后写入 License 的指纹（受 ECDSA 签名保护）。
const MACHINE_CODE_PREFIX = 'DPMC1';
const MACHINE_ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_CODE_LENGTH = 600;

function checksum(payloadPart) {
    return crypto.createHash('sha256').update(`${MACHINE_CODE_PREFIX}.${payloadPart}`).digest('hex').slice(0, 6);
}

function cleanText(value, max) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function encodeMachineCode({ machineId, host, platform, arch, source } = {}) {
    if (!MACHINE_ID_PATTERN.test(String(machineId || ''))) throw new Error('机器指纹格式无效');
    const payload = {
        v: 1,
        id: machineId,
        host: cleanText(host, 64),
        os: cleanText(platform, 16),
        arch: cleanText(arch, 16),
        src: cleanText(source, 16)
    };
    const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${MACHINE_CODE_PREFIX}.${payloadPart}.${checksum(payloadPart)}`;
}

function decodeMachineCode(code) {
    const raw = String(code || '').replace(/\s+/g, '');
    if (!raw) return { valid: false, reasonCode: 'MACHINE_CODE_REQUIRED' };
    if (raw.length > MAX_CODE_LENGTH) return { valid: false, reasonCode: 'MACHINE_CODE_INVALID' };
    const parts = raw.split('.');
    if (parts.length !== 3 || parts[0] !== MACHINE_CODE_PREFIX) return { valid: false, reasonCode: 'MACHINE_CODE_INVALID' };
    if (checksum(parts[1]) !== parts[2]) return { valid: false, reasonCode: 'MACHINE_CODE_CHECKSUM' };
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!payload || payload.v !== 1 || !MACHINE_ID_PATTERN.test(String(payload.id || ''))) {
            return { valid: false, reasonCode: 'MACHINE_CODE_INVALID' };
        }
        return {
            valid: true,
            code: raw,
            machineId: payload.id,
            host: cleanText(payload.host, 64),
            platform: cleanText(payload.os, 16),
            arch: cleanText(payload.arch, 16),
            source: cleanText(payload.src, 16)
        };
    } catch (_) {
        return { valid: false, reasonCode: 'MACHINE_CODE_INVALID' };
    }
}

function isMachineId(value) {
    return MACHINE_ID_PATTERN.test(String(value || ''));
}

module.exports = { MACHINE_CODE_PREFIX, decodeMachineCode, encodeMachineCode, isMachineId };
