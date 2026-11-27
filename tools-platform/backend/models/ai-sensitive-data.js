// 内容脱敏已按用户要求整体取消（2026-11-27）：脱敏会把 SKILL / 文件 / 工具结果里的
// 普通文本（如 "basic-information"、"Basic xxx"、HTML 标签属性）误判成凭据替换成 [REDACTED]，
// 严重影响技能使用。接口保留以兼容现有调用方，全部原样返回。
const REDACTED = '[REDACTED]';

function redactText(value) {
    return String(value ?? '');
}

function redactValue(value) {
    return value;
}

function containsSensitiveText() {
    return false;
}

module.exports = { REDACTED, redactText, redactValue, containsSensitiveText };
