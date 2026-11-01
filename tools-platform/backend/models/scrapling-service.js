// Dragon Claw Scrapling 爬虫与自适应解析服务
// - 优先使用 Scrapling 隐身 Fetcher 极速抓取公开 URL（内置 TLS/JA3 指纹伪装，过 Cloudflare）；
// - 支持从 Dragon 浏览器已打开的标签页（含已登录会话态、Cookie、内网 SSO）实时提取 DOM 并进行高精度结构化清洗。
const path = require('path');
const { spawn } = require('child_process');

const HELPER_SCRIPT = path.resolve(__dirname, '../scripts/scrapling-helper.py');
const PYTHON_BIN = process.env.PYTHON_PATH || 'python3';

let isAvailableCache = null;
let lastCheckTime = 0;

function available() {
    const now = Date.now();
    if (isAvailableCache !== null && now - lastCheckTime < 60000) {
        return isAvailableCache;
    }
    try {
        const { execSync } = require('child_process');
        execSync(`${PYTHON_BIN} -c "import scrapling"`, { stdio: 'ignore', timeout: 3000 });
        isAvailableCache = true;
    } catch (_e) {
        isAvailableCache = false;
    }
    lastCheckTime = now;
    return isAvailableCache;
}

function runHelper(command, args = [], inputData = null, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
        const cmdArgs = [HELPER_SCRIPT, command, ...args];
        const proc = spawn(PYTHON_BIN, cmdArgs, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let timer = null;

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                proc.kill('SIGKILL');
                reject(new Error(`Scrapling 执行超时（${timeoutMs}ms）`));
            }, timeoutMs);
        }

        proc.stdout.on('data', chunk => {
            stdout += chunk.toString();
        });

        proc.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });

        proc.on('close', code => {
            if (timer) clearTimeout(timer);
            if (code !== 0 && !stdout.trim()) {
                return reject(new Error(stderr.trim() || `Python 辅助脚本异常退出，代码: ${code}`));
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                if (!parsed.ok) {
                    return reject(new Error(parsed.error || 'Scrapling 执行失败'));
                }
                resolve(parsed);
            } catch (err) {
                reject(new Error(`解析 Scrapling 输出失败: ${err.message}\n原始输出: ${stdout.slice(0, 300)}`));
            }
        });

        proc.on('error', err => {
            if (timer) clearTimeout(timer);
            reject(err);
        });

        if (inputData !== null && inputData !== undefined) {
            proc.stdin.write(String(inputData));
        }
        proc.stdin.end();
    });
}

/**
 * 隐身抓取指定 URL
 */
async function fetchUrl({ url, css, xpath, mode = 'markdown', maxChars = 40000, timeoutMs = 20000 }) {
    const args = ['--url', String(url), '--mode', mode, '--max-chars', String(maxChars)];
    if (css) args.push('--css', String(css));
    if (xpath) args.push('--xpath', String(xpath));
    return runHelper('fetch', args, null, timeoutMs);
}

/**
 * 从 HTML 字符串（如 Dragon 浏览器标签页获取的实时 DOM）结构化提取数据
 */
async function parseHtml({ html, css, xpath, mode = 'markdown', maxChars = 40000, timeoutMs = 15000 }) {
    const args = ['--mode', mode, '--max-chars', String(maxChars)];
    if (css) args.push('--css', String(css));
    if (xpath) args.push('--xpath', String(xpath));
    return runHelper('parse', args, html, timeoutMs);
}

module.exports = {
    available,
    fetchUrl,
    parseHtml,
    _internal: { runHelper, HELPER_SCRIPT }
};
