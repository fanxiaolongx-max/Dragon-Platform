// AI 内容边界：文件、搜索、Diff、命令结果和持久历史使用同一套凭据过滤。
// 这是内容保护，不是 Shell 沙箱；不能识别经过任意编码或没有标签的未知秘密。
const REDACTED = '[REDACTED]';
const FIELD = '(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|password(?:[_-]?hash)?|passwd|secret(?:[_-]?key)?|token|authorization|cookie|set-cookie|private[_-]?key)';
const QUOTED_FIELD = new RegExp(`((?:["']?${FIELD}["']?)\\s*[:=]\\s*)(["'])(?:\\\\.|(?!\\2)[^\\r\\n])*?\\2`, 'gi');
const BARE_FIELD = new RegExp(`((?:["']?${FIELD}["']?)\\s*[:=]\\s*)(?!["'\\s]|\\[REDACTED\\])([^\\s,;}\\]<>]+)`, 'gi');
const SENSITIVE_FIELD = new RegExp(`^(?:[a-z0-9]+[_-])*(?:${FIELD})$`, 'i');

function redactText(value, { secrets = [] } = {}) {
    let text = String(value ?? '');
    for (const secret of secrets) {
        if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join(REDACTED);
    }
    text = text
        .replace(/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g, REDACTED)
        .replace(/^(\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*).*$/gim, `$1${REDACTED}`)
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, match => `${match.split(/\s/)[0]} ${REDACTED}`)
        .replace(/(https?:\/\/|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/)([^\s/@:]+):([^\s/@]+)@/gi, `$1${REDACTED}@`)
        .replace(QUOTED_FIELD, (_match, prefix, quote) => `${prefix}${quote}${REDACTED}${quote}`)
        .replace(BARE_FIELD, (_match, prefix) => `${prefix}${REDACTED}`)
        .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, REDACTED);
    return text;
}

function redactValue(value, options) {
    if (typeof value === 'string') return redactText(value, options);
    if (Array.isArray(value)) return value.map(item => redactValue(item, options));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        // thoughtSignature 是供应商协议的不透明签名，必须原样回传，不能当作凭据修改。
        /^(?:thoughtSignature|thought_signature)$/.test(key) ? item : SENSITIVE_FIELD.test(key) ? REDACTED : redactValue(item, options)
    ]));
}

function containsSensitiveText(value, options) {
    const text = String(value ?? '');
    return redactText(text, options) !== text;
}

module.exports = { REDACTED, redactText, redactValue, containsSensitiveText };
