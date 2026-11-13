// 平台审计日志（控制库 platform_audit_log，与各团队业务库里的 audit_log 无关）：登录、账号增删、密码变更、超级管理员进入/离开团队。只有超级管理员能查看。
const { run, all, get } = require('./control-db');

const MAX_ROWS = 20000;
let initPromise = null;
let writesSincePrune = 0;

async function ensureReady() {
    if (!initPromise) initPromise = (async () => {
        await run(`CREATE TABLE IF NOT EXISTS platform_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            actor TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT '',
            target TEXT NOT NULL DEFAULT '',
            ip TEXT NOT NULL DEFAULT '',
            detail TEXT NOT NULL DEFAULT '',
            platform TEXT NOT NULL DEFAULT '',
            device TEXT NOT NULL DEFAULT '',
            client_version TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL DEFAULT ''
        )`);
        await run('CREATE INDEX IF NOT EXISTS idx_platform_audit_log_at ON platform_audit_log(at)');

        // 迁移已有表，补齐平台与设备字段
        const existingCols = await all("PRAGMA table_info(platform_audit_log)").catch(() => []);
        const colNames = new Set(existingCols.map(c => c.name));
        if (!colNames.has('platform')) await run("ALTER TABLE platform_audit_log ADD COLUMN platform TEXT NOT NULL DEFAULT ''").catch(() => {});
        if (!colNames.has('device')) await run("ALTER TABLE platform_audit_log ADD COLUMN device TEXT NOT NULL DEFAULT ''").catch(() => {});
        if (!colNames.has('client_version')) await run("ALTER TABLE platform_audit_log ADD COLUMN client_version TEXT NOT NULL DEFAULT ''").catch(() => {});
        if (!colNames.has('device_id')) await run("ALTER TABLE platform_audit_log ADD COLUMN device_id TEXT NOT NULL DEFAULT ''").catch(() => {});
        await run('CREATE INDEX IF NOT EXISTS idx_platform_audit_log_platform ON platform_audit_log(platform)').catch(() => {});
    })().catch(error => { initPromise = null; throw error; });
    return initPromise;
}

/** 提取真实客户端 IP，优先读取 Cloudflare / 反向代理透传头 */
function clientIp(req) {
    if (!req) return '';
    const cf = req.headers?.['cf-connecting-ip'];
    if (cf && typeof cf === 'string' && cf.trim()) return cf.trim().slice(0, 64);
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded.replace(/^::ffff:/, '').slice(0, 64);
    const realIp = String(req.headers?.['x-real-ip'] || '').trim();
    if (realIp) return realIp.replace(/^::ffff:/, '').slice(0, 64);
    const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
    return ip.replace(/^::ffff:/, '').slice(0, 64);
}

/** 解析请求客户端类型、操作系统、设备型号与版本号 */
function parseClientInfo(req) {
    if (!req) return { platform: 'web', device: '', clientVersion: '', deviceId: '' };

    const ua = String(req.headers?.['user-agent'] || '');
    const headerPlatform = String(req.headers?.['x-client-platform'] || '').trim().toLowerCase();
    const headerVersion = String(req.headers?.['x-client-version'] || '').trim();
    const headerDeviceId = String(req.headers?.['x-device-id'] || '').trim();
    const headerDeviceModel = String(req.headers?.['x-device-model'] || '').trim();

    let platform = '';
    let device = headerDeviceModel;
    let clientVersion = headerVersion;
    const deviceId = headerDeviceId.slice(0, 80);

    // 1. 识别平台类别：ios / android / desktop / mobile_web / web
    if (headerPlatform && ['ios', 'android', 'desktop', 'web', 'mobile_web'].includes(headerPlatform)) {
        platform = headerPlatform;
    } else if (/Electron\/|DragonClaw-Desktop/i.test(ua)) {
        platform = 'desktop';
    } else if (/(iosApp|CFNetwork|Darwin)/i.test(ua) && !/Macintosh/i.test(ua)) {
        platform = 'ios';
    } else if (/okhttp/i.test(ua)) {
        platform = 'android';
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
        platform = /DragonClaw/i.test(ua) ? 'ios' : 'mobile_web';
    } else if (/Android/i.test(ua)) {
        platform = /DragonClaw/i.test(ua) ? 'android' : 'mobile_web';
    } else if (/Ktor/i.test(ua)) {
        // Ktor client 来自移动端 App（iOS Darwin 或 Android OkHttp）
        // iOS 引擎基于 NSURLSession，会注入 accept-language 或在 accept-encoding 声明 deflate/br
        // Android 引擎基于 OkHttp，默认仅请求 gzip，无 accept-language
        const acceptLang = String(req.headers?.['accept-language'] || '');
        const acceptEnc = String(req.headers?.['accept-encoding'] || '');
        const isIos = Boolean(acceptLang || acceptEnc.includes('deflate') || acceptEnc.includes('br'));
        platform = isIos ? 'ios' : 'android';
    } else if (/Mobile|HarmonyOS/i.test(ua)) {
        platform = 'mobile_web';
    } else {
        platform = 'web';
    }

    // 2. 识别设备类型与操作系统
    if (!device) {
        if (/iPhone/i.test(ua)) {
            const m = ua.match(/iPhone OS ([\d_]+)/i);
            const osVer = m ? m[1].replace(/_/g, '.') : '';
            device = osVer ? `iPhone (iOS ${osVer})` : 'iPhone';
        } else if (/iPad/i.test(ua)) {
            const m = ua.match(/OS ([\d_]+)/i);
            const osVer = m ? m[1].replace(/_/g, '.') : '';
            device = osVer ? `iPad (iPadOS ${osVer})` : 'iPad';
        } else if (/Android/i.test(ua)) {
            const m = ua.match(/Android ([\d.]+)(?:;\s*([^;)]+))?/i);
            const osVer = m?.[1] || '';
            const model = m?.[2] ? m[2].trim() : '';
            device = model ? `${model} (Android ${osVer})` : (osVer ? `Android ${osVer}` : 'Android Device');
        } else if (/okhttp/i.test(ua)) {
            device = 'Android Device';
        } else if (/Ktor/i.test(ua)) {
            device = platform === 'ios' ? 'iPhone / iPad' : 'Android Device';
        } else if (/(iosApp|CFNetwork|Darwin)/i.test(ua) && !/Macintosh/i.test(ua)) {
            device = 'Apple Device';
        } else if (/Macintosh|Mac OS X/i.test(ua)) {
            const m = ua.match(/Mac OS X ([\d_]+)/i);
            const osVer = m ? m[1].replace(/_/g, '.') : '';
            device = osVer ? `Mac (macOS ${osVer})` : 'Mac';
        } else if (/Windows/i.test(ua)) {
            const m = ua.match(/Windows NT ([\d.]+)/i);
            const nt = m?.[1];
            const winVer = nt === '10.0' ? '10/11' : nt === '6.3' ? '8.1' : nt === '6.1' ? '7' : nt || '';
            device = winVer ? `Windows ${winVer}` : 'Windows PC';
        } else if (/Linux/i.test(ua)) {
            device = 'Linux';
        } else {
            device = '未知设备';
        }
    }

    // 3. 识别客户端/浏览器版本
    if (!clientVersion) {
        if (/DragonClaw\/([\d.]+)/i.test(ua)) {
            clientVersion = `Dragon Claw v${ua.match(/DragonClaw\/([\d.]+)/i)[1]}`;
        } else if (/Electron\/([\d.]+)/i.test(ua)) {
            clientVersion = `Electron v${ua.match(/Electron\/([\d.]+)/i)[1]}`;
        } else if (/Edg\/([\d.]+)/i.test(ua)) {
            clientVersion = `Edge ${ua.match(/Edg\/([\d.]+)/i)[1]}`;
        } else if (/Chrome\/([\d.]+)/i.test(ua)) {
            clientVersion = `Chrome ${ua.match(/Chrome\/([\d.]+)/i)[1]}`;
        } else if (/Version\/([\d.]+).*Safari/i.test(ua)) {
            clientVersion = `Safari ${ua.match(/Version\/([\d.]+)/i)[1]}`;
        } else if (/Firefox\/([\d.]+)/i.test(ua)) {
            clientVersion = `Firefox ${ua.match(/Firefox\/([\d.]+)/i)[1]}`;
        } else if (/CFNetwork\/([\d.]+)/i.test(ua)) {
            clientVersion = `CFNetwork ${ua.match(/CFNetwork\/([\d.]+)/i)[1]}`;
        } else if (/okhttp\/([\d.]+)/i.test(ua)) {
            clientVersion = `OkHttp ${ua.match(/okhttp\/([\d.]+)/i)[1]}`;
        } else if (/Ktor/i.test(ua)) {
            clientVersion = 'Dragon Claw Mobile (v1.0)';
        } else {
            clientVersion = ua ? ua.slice(0, 40) : '-';
        }
    }

    return {
        platform,
        device: device.slice(0, 80),
        clientVersion: clientVersion.slice(0, 80),
        deviceId
    };
}

/** 记一条审计；失败只打日志，不影响业务 */
async function record(req, { actor, action, tenantId = '', target = '', detail = '', platform = '', device = '', clientVersion = '', deviceId = '' }) {
    try {
        await ensureReady();
        const clientInfo = parseClientInfo(req);
        const resolvedPlatform = platform || clientInfo.platform;
        const resolvedDevice = device || clientInfo.device;
        const resolvedVersion = clientVersion || clientInfo.clientVersion;
        const resolvedDeviceId = deviceId || clientInfo.deviceId;

        await run(`INSERT INTO platform_audit_log (
            actor, action, tenant_id, target, ip, detail, platform, device, client_version, device_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`, [
            String(actor || req?.user?.username || ''),
            String(action),
            String(tenantId || ''),
            String(target || ''),
            clientIp(req),
            typeof detail === 'string' ? detail.slice(0, 1000) : JSON.stringify(detail).slice(0, 1000),
            String(resolvedPlatform || '').slice(0, 32),
            String(resolvedDevice || '').slice(0, 80),
            String(resolvedVersion || '').slice(0, 80),
            String(resolvedDeviceId || '').slice(0, 80)
        ]);
        if (++writesSincePrune >= 200) {
            writesSincePrune = 0;
            await run(`DELETE FROM platform_audit_log WHERE id <= (SELECT MAX(id) FROM platform_audit_log) - ?`, [MAX_ROWS]);
        }
    } catch (error) {
        console.warn('[audit] 写审计日志失败：', error.message);
    }
}

async function list({ page = 1, limit = 20, before = null, actor = '', action = '', platform = '' } = {}) {
    await ensureReady();
    const where = [];
    const params = [];
    if (before) { where.push('id < ?'); params.push(Number(before)); }
    if (actor) { where.push('actor = ?'); params.push(String(actor)); }
    if (action) { where.push('action = ?'); params.push(String(action)); }
    if (platform && platform !== 'all') { where.push('platform = ?'); params.push(String(platform)); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // 计算总数
    const countRow = await get(`SELECT COUNT(*) as count FROM platform_audit_log ${whereClause}`, params);
    const total = Number(countRow?.count || 0);

    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 20));
    const safePage = Math.max(1, Number(page) || 1);
    const offset = (safePage - 1) * safeLimit;

    const queryParams = [...params, safeLimit, offset];
    const rows = await all(`SELECT * FROM platform_audit_log ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`, queryParams);

    const items = rows.map(row => ({
        id: row.id,
        at: row.at,
        actor: row.actor,
        action: row.action,
        tenantId: row.tenant_id,
        target: row.target,
        ip: row.ip,
        detail: row.detail,
        platform: row.platform || 'web',
        device: row.device || '',
        clientVersion: row.client_version || '',
        deviceId: row.device_id || ''
    }));

    return {
        items,
        total,
        page: safePage,
        pageSize: safeLimit,
        totalPages: Math.ceil(total / safeLimit) || 1
    };
}

module.exports = { ensureReady, list, record, clientIp, parseClientInfo };
