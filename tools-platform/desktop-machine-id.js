const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { encodeMachineCode } = require('./backend/models/desktop-machine-code');

// 设备指纹 = 多项系统/硬件唯一标识的 SHA-256（截取 128 位），每次启动现场采集、不缓存，
// 因此复制用户数据目录或整个绿色版文件夹到另一台电脑后指纹会不同，绑定的 License 随之失效。
//   Windows：注册表 MachineGuid（随系统安装生成）+ SMBIOS 主板 UUID（防整盘克隆）
//   macOS：IOPlatformUUID（硬件 UUID）
//   Linux：/etc/machine-id + DMI product_uuid（可读时）
// 全部采集失败时退回用户目录下的随机设备 ID（source=fallback），签发后台会提示该机器码为弱标识。
const FINGERPRINT_NAMESPACE = 'dragon-platform-desktop-machine-v1';
const PLACEHOLDER_UUIDS = new Set([
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '03000200-0400-0500-0006-000700080009' // 部分主板出厂未写入 UUID 时的占位值
]);

function run(file, args, timeout = 6000) {
    return new Promise(resolve => {
        execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
            resolve(error ? '' : String(stdout || ''));
        });
    });
}

function normalizeId(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text.length < 8 || PLACEHOLDER_UUIDS.has(text) || /^[0f-]+$/.test(text)) return '';
    return text;
}

function readFile(file) {
    try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

async function collectWindows() {
    const [guidOut, uuidOut] = await Promise.all([
        run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']),
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID'], 8000)
    ]);
    const guid = (guidOut.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/) || [])[1];
    return [['machine-guid', normalizeId(guid)], ['smbios-uuid', normalizeId(uuidOut)]];
}

async function collectMac() {
    const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    const uuid = (out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/) || [])[1];
    return [['platform-uuid', normalizeId(uuid)]];
}

async function collectLinux() {
    return [
        ['machine-id', normalizeId(readFile('/etc/machine-id') || readFile('/var/lib/dbus/machine-id'))],
        ['product-uuid', normalizeId(readFile('/sys/class/dmi/id/product_uuid'))]
    ];
}

function fallbackDeviceId(fallbackDir) {
    const file = path.join(fallbackDir || os.homedir(), '.dragon-platform-device-id');
    let value = normalizeId(readFile(file));
    if (!value) {
        value = crypto.randomUUID();
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 });
        } catch (_) { /* 写不进去时本次仍可显示，但每次启动会变化 */ }
    }
    return value;
}

function fingerprintOf(platform, identifiers) {
    const material = [FINGERPRINT_NAMESPACE, platform, ...identifiers.map(([name, value]) => `${name}=${value}`)].join('|');
    return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

async function getDesktopMachineIdentity({ platform = process.platform, fallbackDir } = {}) {
    const collector = platform === 'win32' ? collectWindows : platform === 'darwin' ? collectMac : collectLinux;
    let identifiers = (await collector().catch(() => [])).filter(([, value]) => value);
    let source = platform;
    if (!identifiers.length) {
        identifiers = [['fallback-device-id', fallbackDeviceId(fallbackDir)]];
        source = 'fallback';
    }
    const machineId = fingerprintOf(platform, identifiers);
    const host = os.hostname();
    const identity = {
        machineId,
        host,
        platform,
        arch: process.arch,
        source,
        signals: identifiers.map(([name]) => name)
    };
    identity.machineCode = encodeMachineCode(identity);
    return identity;
}

module.exports = { getDesktopMachineIdentity, fingerprintOf, normalizeId };
