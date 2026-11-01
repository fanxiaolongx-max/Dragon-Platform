// Dragon Claw 工作区：危险命令类别与「不再询问」规则。
// 完全访问不再逐条审批，但命中下面几类的 run_command 仍弹审批卡；用户可按类别选择不再询问：
// 本对话（内存）、这个工作目录、永久（当前租户，含 WeLink 频道等无人值守的对话）。
// 识别是静态的提醒，不是沙箱：写进脚本里的操作识别不到，兜底靠废纸篓与数据库写前备份。
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('./agent-path-guard');
const { _internal: { tokenize } } = require('./agent-command-guard');

const KV_CATEGORY = 'agent';
const KV_KEY = 'danger_rules';
const MAX_RULES = 200;
const SCOPES = ['session', 'workspace', 'global'];

const CATEGORIES = {
    'secret-read': { label: '读取密钥与凭据', description: 'SSH 私钥、云账号凭据、钥匙串、浏览器 Cookie 与登录数据、.env 等密钥文件' },
    'platform-data': { label: '用命令直接动平台数据', description: '用 Shell 直接读写平台数据库、数据目录或备份（平台的数据库工具不受影响）' },
    upload: { label: '把文件或数据发到外部', description: 'curl/wget 上传文件、scp/rsync/sftp 远程传输、nc 发送、对象存储上传等' },
    'delete-outside': { label: '删除工作目录之外的内容', description: '递归删除工作目录以外的路径、工作目录本身或主目录（工作目录内的改动可在「更改」里撤销）' },
    system: { label: '改系统设置或提权', description: 'sudo、launchctl/systemctl、defaults write、crontab、写系统目录、pm2 重启或停止服务、结束进程等' }
};

// 主目录下的凭据位置（相对主目录）
const HOME_SECRETS = ['.ssh', '.aws', '.gnupg', '.kube/config', '.docker/config.json', '.netrc', '.git-credentials', '.npmrc', '.pypirc',
    '.config/gh', '.config/gcloud', '.azure', 'Library/Keychains', 'Library/Cookies',
    'Library/Application Support/Google/Chrome', 'Library/Application Support/Microsoft Edge', 'Library/Application Support/Firefox', 'Library/Application Support/BraveSoftware'];
const SYSTEM_DIRS = ['/etc', '/private/etc', '/System', '/Library', '/usr', '/bin', '/sbin', '/var/db', '/private/var/db'];
const SYSTEM_WRITE_EXEMPT = ['/usr/local'];
const WRITE_VERB = /^(cp|mv|tee|ln|install|rm|rmdir|chmod|chown|chgrp|touch|mkdir|truncate|dd|sed)$/;

function within(base, target) {
    return guard.samePath(base, target) || guard.isInside(base, target);
}

// 不存在的路径取最深的已存在祖先做 realpath，避免符号链接（如 /etc → /private/etc）绕过
function realish(target) {
    let current = target;
    const rest = [];
    for (let i = 0; i < 64; i++) {
        try { return path.join(fs.realpathSync(current), ...rest.reverse()); } catch (_error) { /* 继续向上 */ }
        const parent = path.dirname(current);
        if (parent === current) break;
        rest.push(path.basename(current));
        current = parent;
    }
    return target;
}

function platformDirs() {
    const tenant = require('./tenant-context');
    const dirs = [tenant.BASE_DATA_DIR, tenant.BASE_REPORT_DATA_DIR, path.join(tenant.BASE_DATA_DIR, '../backups')];
    return [...new Set(dirs.flatMap(dir => [path.resolve(dir), realish(path.resolve(dir))]))];
}

/** 按 ; && || | 换行与命令替换切成若干段，每段一组词（去掉开头的 VAR=value 与 sudo 等前缀） */
function segments(command) {
    return String(command || '').split(/;|&&|\|\||\||\n|\$\(|`/).map(part => {
        // 反斜杠转义的空格（Application\ Support）保留在同一个词里
        const words = tokenize(part.replace(/\\ /g, '\u0000')).map(word => word.replace(/\u0000/g, ' '));
        while (words.length && /^[A-Za-z_][\w]*=/.test(words[0])) words.shift();
        return words;
    }).filter(words => words.length);
}

/**
 * 识别命令命中的危险类别。
 * @returns {{ category: string, label: string, reason: string }[]} 每类最多一条
 */
function detect(command, root, { home = os.homedir(), platform = process.platform, dataDirs = null } = {}) {
    const hits = new Map();
    const add = (category, reason) => { if (!hits.has(category)) hits.set(category, { category, label: CATEGORIES[category].label, reason }); };
    const text = String(command || '');
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const resolveToken = token => {
        let value = token.startsWith('-') && token.includes('=') ? token.slice(token.indexOf('=') + 1) : token;
        if (!value || value.startsWith('-') || /^[a-z][\w+.-]*:\/\//i.test(value)) return null;
        value = value.replace(/^@/, '');
        if (value === '~' || value.startsWith('~/')) return pathApi.join(home, value.slice(1));
        value = value.replace(/^\$\{?HOME\}?(?=\/|$)/, home);
        if (pathApi.isAbsolute(value)) return pathApi.resolve(value);
        if (/[\\/]/.test(value) || /\.(db|sqlite3?)$/i.test(value)) return pathApi.resolve(root, value);
        return null;
    };
    const platformRoots = dataDirs || platformDirs();
    const homeSecrets = HOME_SECRETS.map(rel => pathApi.join(home, rel));
    const inSystemDir = target => Boolean(target) && SYSTEM_DIRS.some(dir => within(dir, target)) && !SYSTEM_WRITE_EXEMPT.some(dir => within(dir, target));

    for (const words of segments(text)) {
        let start = 0;
        if (/^(sudo|doas|su)$/.test(words[0])) {
            add('system', `用 ${words[0]} 提升权限执行`);
            start = 1;
            while (words[start]?.startsWith('-')) start += 1;
        }
        const program = pathApi.basename(words[start] || '');
        const args = words.slice(start + 1);
        const flags = args.filter(word => word.startsWith('-'));
        const resolved = args.map(resolveToken).filter(Boolean);

        // 密钥与凭据
        if (program === 'security' && /^(find-generic-password|find-internet-password|dump-keychain|export|find-certificate)$/.test(args[0] || '')) add('secret-read', `读取钥匙串：security ${args[0]}`);
        for (const target of resolved) {
            if (homeSecrets.some(base => within(base, target)) || guard.isSecretFile(target)) { add('secret-read', `涉及凭据位置：${target.replace(home, '~')}`); break; }
        }
        const secretWord = args.find(word => !word.startsWith('-') && guard.isSecretFile(word));
        if (secretWord) add('secret-read', `涉及密钥文件：${secretWord}`);

        // 平台数据目录
        for (const target of resolved) {
            const real = realish(target);
            if (platformRoots.some(base => within(base, target) || within(base, real))) { add('platform-data', `直接访问平台数据：${target}`); break; }
        }

        // 上传与远程传输
        const remoteSpec = args.find(word => /^(?:[\w.-]+@)?[\w.-]+:(?!\/\/)/.test(word) && !/^[a-zA-Z]:[\\/]/.test(word));
        if (program === 'curl' && (args.some(word => /^(-T|--upload-file|-F|--form)$/.test(word) || /^-T./.test(word))
            || /(?:^|\s)(?:-d|--data(?:-binary|-urlencode|-ascii)?)(?:\s+|=)?['"]?@/.test(text))) add('upload', 'curl 上传文件或表单');
        else if (program === 'wget' && args.some(word => /^--(post-file|body-file)\b/.test(word))) add('upload', 'wget 上传文件');
        else if (['scp', 'sftp'].includes(program)) add('upload', `${program} 与远程主机传输文件`);
        else if (program === 'rsync' && remoteSpec) add('upload', `rsync 与远程主机同步：${remoteSpec}`);
        else if (['nc', 'ncat', 'netcat', 'socat', 'ftp', 'smbclient'].includes(program)) add('upload', `${program} 网络传输`);
        else if (program === 'aws' && args[0] === 's3' && /^(cp|sync|mv)$/.test(args[1] || '')) add('upload', `aws s3 ${args[1]}`);
        else if (['gsutil', 'ossutil', 'ossutil64', 'coscmd', 'rclone', 'mc'].includes(program) && /^(cp|sync|mv|copy|move|upload|mirror)$/.test(args[0] || '')) add('upload', `${program} ${args[0]}`);

        // 工作目录之外的递归删除（工作目录内的改动可撤销，不打扰）
        const recursiveRm = program === 'rm' && flags.some(flag => /^-[a-zA-Z]*[rR]/.test(flag) || flag === '--recursive');
        const findDelete = program === 'find' && args.some(word => word === '-delete' || word === 'rm');
        const removeItem = /^remove-item$/i.test(program) && flags.some(flag => /^-r(ecurse)?$/i.test(flag));
        if (recursiveRm || findDelete || removeItem || (program === 'rmdir' && flags.some(flag => /^\/s$/i.test(flag)))) {
            const operandsOf = args.filter(word => !word.startsWith('-'));
            const targets = findDelete ? [operandsOf[0] || '.'] : operandsOf;
            const outside = targets.find(word => {
                if (/\$/.test(word)) return true; // 变量展开，无法判断落点
                const target = resolveToken(word) || pathApi.resolve(root, word);
                // find 从工作目录开始删匹配项不算越界；rm 删工作目录本身算
                if (findDelete) return !within(root, target);
                return guard.samePath(target, root) || !guard.isInside(root, target) || guard.samePath(target, home);
            });
            if (outside) add('delete-outside', `递归删除：${outside}`);
        }

        // 系统设置、服务与进程
        if (program === 'launchctl' && /^(load|unload|bootstrap|bootout|enable|disable|remove|kickstart)$/.test(args[0] || '')) add('system', `launchctl ${args[0]}`);
        else if (program === 'systemctl' && /^(enable|disable|stop|start|restart|mask|kill)$/.test(args[0] || '')) add('system', `systemctl ${args[0]}`);
        else if (program === 'defaults' && /^(write|delete)$/.test(args[0] || '')) add('system', `defaults ${args[0]}`);
        else if (program === 'crontab' && !args.includes('-l')) add('system', '修改定时任务 crontab');
        else if (program === 'pm2' && /^(stop|restart|reload|delete|kill)$/.test(args[0] || '')) add('system', `pm2 ${args[0]}（可能停掉平台服务）`);
        else if (['shutdown', 'reboot', 'halt', 'killall', 'pkill', 'diskutil', 'mkfs', 'csrutil', 'spctl', 'pmset', 'networksetup', 'scutil', 'tmutil', 'nvram'].includes(program)) add('system', `${program} ${args.slice(0, 2).join(' ')}`.trim());
        const operands = args.filter(word => !word.startsWith('-'));
        let writeTargets = [];
        if (/^(cp|mv|ln|install)$/.test(program) || (program === 'sed' && flags.some(flag => /^-i/.test(flag)))) writeTargets = operands.slice(-1);
        else if (WRITE_VERB.test(program) && program !== 'sed' && program !== 'dd') writeTargets = operands;
        else if (program === 'dd') writeTargets = args.filter(word => word.startsWith('of=')).map(word => word.slice(3));
        const systemTarget = writeTargets.map(resolveToken).find(inSystemDir);
        if (systemTarget) add('system', `写入系统目录：${systemTarget}`);
    }
    // 重定向写入系统目录（> /etc/hosts）
    for (const match of text.matchAll(/(?:^|[^<>&\d])>{1,2}\s*(['"]?)([^\s'";&|]+)\1/g)) {
        const target = resolveToken(match[2]);
        if (inSystemDir(target)) add('system', `写入系统目录：${target}`);
    }
    return [...hits.values()];
}

// ── 规则 ─────────────────────────────────────────────────
async function list() {
    const { readKV } = require('./kv-store');
    const rules = await readKV(KV_CATEGORY, KV_KEY, []);
    return Array.isArray(rules) ? rules.filter(rule => CATEGORIES[rule?.category] && ['workspace', 'global'].includes(rule.scope)) : [];
}

/** 新增持久规则（这个工作目录 / 永久）；同类别同范围已存在时不重复 */
async function add({ category, scope, root = '', by = '' }) {
    if (!CATEGORIES[category]) throw Object.assign(new Error('未知的危险类别'), { code: 'AGENT_DANGER_CATEGORY', statusCode: 400 });
    if (!['workspace', 'global'].includes(scope)) throw Object.assign(new Error('范围只能是工作目录或永久'), { code: 'AGENT_DANGER_SCOPE', statusCode: 400 });
    const rules = await list();
    const existing = rules.find(rule => rule.category === category && rule.scope === scope && (scope === 'global' || rule.root === root));
    if (existing) return existing;
    const rule = { id: crypto.randomUUID(), category, scope, ...(scope === 'workspace' ? { root } : {}), by: String(by || ''), createdAt: new Date().toISOString() };
    await require('./kv-store').writeKV(KV_CATEGORY, KV_KEY, [...rules, rule].slice(-MAX_RULES));
    return rule;
}

async function remove(id) {
    const rules = await list();
    const next = rules.filter(rule => rule.id !== id);
    if (next.length === rules.length) throw Object.assign(new Error('规则不存在'), { code: 'AGENT_DANGER_RULE_NOT_FOUND', statusCode: 404 });
    await require('./kv-store').writeKV(KV_CATEGORY, KV_KEY, next);
    return { ok: true };
}

/** 还需要审批的命中项：去掉本对话、这个工作目录、永久已放开的类别 */
function pending(hits, { sessionAllowed = new Set(), rules = [], root = '' } = {}) {
    return hits.filter(hit => !sessionAllowed.has(hit.category)
        && !rules.some(rule => rule.category === hit.category && (rule.scope === 'global' || (rule.scope === 'workspace' && guard.samePath(rule.root, root)))));
}

function catalog() {
    return Object.entries(CATEGORIES).map(([id, item]) => ({ id, ...item }));
}

module.exports = { CATEGORIES, SCOPES, detect, list, add, remove, pending, catalog, _internal: { segments, realish } };
