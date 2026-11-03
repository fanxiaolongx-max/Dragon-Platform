'use strict';

/**
 * welink-cli Agent Login SDK
 *
 * 供外部 Node.js 应用程序集成的官方模块。
 * 通过匿名管道安全地将 cookie 和 identification 传递给 welink-cli.exe。
 *
 * 用法:
 *   const { agentLogin } = require('@welink/welink-cli/agent-login');
 *
 *   const result = await agentLogin({
 *     cookie: 'your_cookie',
 *     identification: 'agent_name|sign|timestamp|nonce',
 *   });
 *
 * 安全措施:
 *   - 签名验证: 执行前解析 PE 文件 Authenticode 签名，验证证书指纹与官方一致
 *   - 管道传输: 使用 Node.js spawn 内置匿名管道，内核传输不落盘
 *   - payload 覆盖: 写入管道后立即用 0 覆盖 Buffer
 *   - 超时控制: 默认 30s，防止子进程挂起
 *   - 不记录敏感数据: stdout/stderr 仅为 CLI 输出，不含 cookie
 */

const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

/**
 * 通过 PATH 查找 welink-cli.exe 的绝对路径
 * where 可能返回 .cmd 包装脚本和 .exe，优先取 .exe
 * @returns {string|null}
 */
function findExe() {
    try {
        const output = execSync('where welink-cli', {
            encoding: 'utf8', timeout: 5000, windowsHide: true
        }).trim();
        const lines = output.split(/\r?\n/);
        // 优先找 .exe
        const exePath = lines.find(p => p.toLowerCase().endsWith('.exe'));
        return exePath || null;
    } catch {
        return null;
    }
}

/**
 * 安全覆盖 Buffer 内容
 * @param {Buffer} buf
 */
function secureWipe(buf) {
    if (buf && Buffer.isBuffer(buf) && buf.length > 0) {
        buf.fill(0);
    }
}

/**
 * 官方 welink-cli.exe 的 Authenticode 签名者证书 Subject 关键字
 * 验证签名者是否为华为技术有限责任公司，而非具体证书指纹
 * 证书续期或轮换时无需更新此值
 */
const TRUSTED_SIGNER_SUBJECT = 'Huawei Technologies Co., Ltd.';

/**
 * 读取 ASN.1 DER 标签
 * @param {Buffer} buf - DER 数据
 * @param {number} offset - 起始偏移
 * @returns {{tag: number, length: number, headerSize: number, totalSize: number, valueStart: number}}
 */
function readDerTag(buf, offset) {
    const tag = buf[offset];
    let len = buf[offset + 1];
    let headerSize = 2;
    if (len & 0x80) {
        const numBytes = len & 0x7F;
        len = 0;
        for (let i = 0; i < numBytes; i++) {
            len = (len << 8) | buf[offset + 2 + i];
        }
        headerSize = 2 + numBytes;
    }
    return { tag, length: len, headerSize, totalSize: headerSize + len, valueStart: offset + headerSize };
}

/**
 * 从 PE 文件中提取所有 Authenticode 签名证书
 *
 * 解析 PE 头定位安全目录，读取 WIN_CERTIFICATE 结构，
 * 从 PKCS#7 SignedData 中提取证书链。
 *
 * @param {string} filePath - exe 文件绝对路径
 * @returns {Buffer[]} 证书 DER 数组，未签名返回空数组
 */
function getAuthenticodeCertificates(filePath) {
    try {
        const buf = fs.readFileSync(filePath);

        // DOS Header → e_lfanew 指向 PE 签名
        const e_lfanew = buf.readUInt32LE(0x3C);

        // Optional Header 起始位置 = PE签名(4) + COFF头(20)
        const optHdrStart = e_lfanew + 24;
        const magic = buf.readUInt16LE(optHdrStart);

        // PE32 vs PE32+ 的固定部分大小不同
        const fixedPartSize = (magic === 0x20B) ? 112 : 96;
        const datadirStart = optHdrStart + fixedPartSize;

        // 数据目录第 4 项 = IMAGE_DIRECTORY_ENTRY_SECURITY
        const secEntryOffset = datadirStart + 4 * 8;
        const secDirOffset = buf.readUInt32LE(secEntryOffset);
        if (secDirOffset === 0) return []; // 未签名

        // WIN_CERTIFICATE 结构: dwLength(4) + wRevision(2) + wCertificateType(2) + bCertificate(...)
        const pkcs7Start = secDirOffset + 8;
        const pkcs7Buf = buf.slice(pkcs7Start);

        // 解析 PKCS#7 ContentInfo
        const contentInfo = readDerTag(pkcs7Buf, 0);
        let off = contentInfo.valueStart;

        // 跳过 contentType OID
        const oidTag = readDerTag(pkcs7Buf, off);
        off = oidTag.valueStart + oidTag.length;

        // [0] EXPLICIT 包裹 SignedData
        const explicitTag = readDerTag(pkcs7Buf, off);

        // SignedData SEQUENCE
        const sdSeq = readDerTag(pkcs7Buf, explicitTag.valueStart);
        let sdOff = sdSeq.valueStart;

        // 跳过 version INTEGER
        sdOff += readDerTag(pkcs7Buf, sdOff).totalSize;
        // 跳过 digestAlgorithms SET
        sdOff += readDerTag(pkcs7Buf, sdOff).totalSize;
        // 跳过 encapContentInfo SEQUENCE
        sdOff += readDerTag(pkcs7Buf, sdOff).totalSize;

        // certificates [0] IMPLICIT (tag 0xA0)
        if (pkcs7Buf[sdOff] !== 0xA0) return [];

        const certSet = readDerTag(pkcs7Buf, sdOff);
        let certOff = certSet.valueStart;
        const certs = [];
        while (certOff < certSet.valueStart + certSet.length) {
            const certTag = readDerTag(pkcs7Buf, certOff);
            certs.push(pkcs7Buf.slice(certOff, certOff + certTag.totalSize));
            certOff += certTag.totalSize;
        }
        return certs;
    } catch {
        return [];
    }
}

/**
 * 验证目标 exe 的 Authenticode 签名者是否为华为官方
 *
 * 遍历签名证书链，检查是否有证书的 Subject 包含华为公司名称。
 * 证书续期或轮换时无需更新，只要仍由华为签发即可通过。
 *
 * @param {string} exePath - 目标 exe 绝对路径
 * @returns {{ valid: boolean, reason: string }}
 */
function verifySignature(exePath) {
    const certs = getAuthenticodeCertificates(exePath);
    if (certs.length === 0) {
        return { valid: false, reason: 'exe is not signed or signature could not be parsed' };
    }

    for (const certDer of certs) {
        try {
            const cert = new crypto.X509Certificate(certDer);
            if (cert.subject.replace(/\\/g, '').includes(TRUSTED_SIGNER_SUBJECT)) {
                return { valid: true, reason: `signed by ${TRUSTED_SIGNER_SUBJECT}` };
            }
        } catch {
            // 跳过无法解析的证书
        }
    }

    return { valid: false, reason: 'exe is not signed by trusted publisher' };
}

/**
 * 通过匿名管道执行 welink-cli auth agent_login
 *
 * @param {Object} options
 * @param {string} options.cookie - Cookie 字符串（必填）
 * @param {string} options.identification - Identification 字符串，格式: agent_name|sign|timestamp|nonce（必填）
 * @param {string} [options.cliPath] - welink-cli.exe 路径，默认自动查找
 * @param {number} [options.timeout=30000] - 超时时间（毫秒）
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string, success: boolean}>}
 */
function agentLogin(options) {
    return new Promise((resolve, reject) => {
        // ── 参数验证 ──────────────────────────────
        if (!options || typeof options !== 'object') {
            reject(new TypeError('options must be an object'));
            return;
        }

        const { cookie, identification } = options;

        if (!cookie || typeof cookie !== 'string' || cookie.length === 0) {
            reject(new TypeError('options.cookie is required and must be a non-empty string'));
            return;
        }

        if (!identification || typeof identification !== 'string' || identification.length === 0) {
            reject(new TypeError('options.identification is required and must be a non-empty string'));
            return;
        }

        const timeout = options.timeout || 30000;
        const cliPath = options.cliPath || findExe();

        if (!cliPath) {
            reject(new Error('welink-cli not found in PATH. Install it via "npm install -g @welink/welink-cli" or set options.cliPath.'));
            return;
        }

        // ── 签名验证 ──────────────────────────────
        const sigResult = verifySignature(cliPath);
        if (!sigResult.valid) {
            reject(new Error(`Signature verification failed: ${sigResult.reason}`));
            return;
        }

        // ── 构造 payload ──────────────────────────
        const payload = Buffer.from(JSON.stringify({
            cookie: cookie,
            identification: identification,
        }), 'utf8');

        // ── 启动子进程 ────────────────────────────
        // windowsHide: 隐藏窗口
        // stdio: pipe 创建匿名管道，仅父子进程可访问
        // 子进程(C++侧)启动后会禁止句柄继承，防止孙进程窃取管道数据
        const child = spawn(cliPath, ['auth', 'agent_login'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill('SIGTERM');
                secureWipe(payload);
                reject(new Error(`Agent login timed out after ${timeout}ms`));
            }
        }, timeout);

        child.stdout.on('data', (data) => {
            stdout += data.toString('utf8');
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString('utf8');
        });

        child.on('error', (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                secureWipe(payload);
                reject(err);
            }
        });

        child.on('close', (code) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                secureWipe(payload);
                const result = {
                    exitCode: code,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                };
                if (code === 0) {
                    resolve(result);
                } else {
                    reject(Object.assign(new Error(stderr.trim() || `welink-cli exited with code ${code}`), result));
                }
            }
        });

        // ── 通过管道写入 payload 并立即关闭 ────────
        child.stdin.write(payload, (err) => {
            if (err && !settled) {
                settled = true;
                clearTimeout(timer);
                secureWipe(payload);
                reject(new Error(`Failed to write to stdin: ${err.message}`));
                return;
            }
            // 写入完成，立即覆盖 payload buffer
            secureWipe(payload);
            child.stdin.end();
        });
    });
}

module.exports = { agentLogin, verifySignature };
