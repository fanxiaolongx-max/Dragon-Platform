// AI 内容边界：文件、搜索、Diff、命令结果和持久历史使用同一套凭据过滤。
// 这是内容保护，不是 Shell 沙箱；不能识别经过任意编码或没有标签的未知秘密。
const REDACTED = '[REDACTED]';
const FIELD = '(?:api[ _-]?key|api[ _-]?token|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|client[ _-]?secret|password(?:[_-]?hash)?|passwd|secret(?:[ _-]?key)?|token|authorization|cookie|set-cookie|private[ _-]?key|密码|口令|密钥|令牌|私钥)';
const ASSIGNMENT = `(["']?${FIELD}(?:["'](?:\\s*\\])?)?\\s*[:：=]\\s*)`;
const QUOTED_FIELD = new RegExp(`${ASSIGNMENT}(["'])(?:\\\\.|(?!\\2)[^\\r\\n])*?\\2`, 'gi');
const UNTERMINATED_FIELD = new RegExp(`${ASSIGNMENT}(["'])(?:\\\\.|(?!\\2)[^\\r\\n])*$`, 'gim');
const BARE_FIELD = new RegExp(`${ASSIGNMENT}(?!["'\\s]|\\[REDACTED\\])([^\\s,;}\\]<>]+)`, 'gi');
const COMPOUND_ACCOUNT_PASSWORD = /(["']?(?:账号|用户(?:名)?|account|user(?:name)?)\s*(?:[/／&＆与和]|\s+)?(?:密码|口令|passwd|password)["']?\s*[:：=]\s*)(?!\[REDACTED\])([^\s/\\,;}\]<>]+)(\s*[/／:：|\s]\s*)(?!\[REDACTED\])([^\s,;}\]<>]+)/gi;
const SENSITIVE_FIELD = new RegExp(`^(?:[a-z0-9]+[_-])*(?:${FIELD})$`, 'i');

function redactText(value, { secrets = [] } = {}) {
    let text = String(value ?? '');
    for (const secret of secrets) {
        if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join(REDACTED);
    }
    // 工具结果/payload_json 是序列化 JSON：先逐字段脱敏，避免把代码中的 \"\" 等
    // JSON 转义误当作 Token 值，或破坏嵌套脚本的引号和反斜杠。
    if (/^\s*[\[{]/.test(text)) {
        try {
            const parsed = JSON.parse(text);
            const safe = redactValue(parsed, { secrets });
            return JSON.stringify(safe) === JSON.stringify(parsed) ? text : JSON.stringify(safe);
        } catch { /* 非 JSON（如 JavaScript 源码）继续按文本处理 */ }
    }
    // 「账号密码: admin / xxx」或「账号/密码：admin/xxx」先保留用户名，仅脱敏密码部分，避免误把 admin 当成密码
    const preservedCompound = [];
    text = text.replace(COMPOUND_ACCOUNT_PASSWORD, (_match, prefix, user, sep) => {
        const placeholder = `\u0000CRED_KEEP_${preservedCompound.length}\u0000`;
        preservedCompound.push(`${prefix}${user}${sep}${REDACTED}`);
        return placeholder;
    });
    text = text
        .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?(?:-----END (?:[A-Z ]*PRIVATE KEY)-----|$)/g, REDACTED)
        .replace(/^(\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*).*$/gim, `$1${REDACTED}`)
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, match => `${match.split(/\s/)[0]} ${REDACTED}`)
        .replace(/(https?:\/\/|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/)([^\s/@:]+):([^\s/@]+)@/gi, `$1$2:${REDACTED}@`)
        .replace(QUOTED_FIELD, (match, prefix, quote) => match.length === prefix.length + 2 ? match : `${prefix}${quote}${REDACTED}${quote}`)
        .replace(UNTERMINATED_FIELD, (_match, prefix, quote) => `${prefix}${quote}${REDACTED}${quote}`)
        .replace(BARE_FIELD, (_match, prefix) => `${prefix}${REDACTED}`)
        .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, REDACTED);
    if (preservedCompound.length) {
        text = text.replace(/\u0000CRED_KEEP_(\d+)\u0000/g, (_, idx) => preservedCompound[Number(idx)] ?? '');
    }
    return text;
}

function redactValue(value, options) {
    if (typeof value === 'string') return redactText(value, options);
    if (Array.isArray(value)) return value.map(item => redactValue(item, options));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        // thoughtSignature 是供应商协议的不透明签名，必须原样回传，不能当作凭据修改；images 是发给模型看的图片数据（base64），不逐字扫描。
        /^(?:thoughtSignature|thought_signature|images)$/.test(key) ? item : SENSITIVE_FIELD.test(key) ? REDACTED : redactValue(item, options)
    ]));
}

function containsSensitiveText(value, options) {
    const text = String(value ?? '');
    return redactText(text, options) !== text;
}

module.exports = { REDACTED, redactText, redactValue, containsSensitiveText };
