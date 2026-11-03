// Decode transport wrappers only. Never repair escapes, infer paths, or evaluate model text:
// a guessed JSON repair can silently change both Windows filenames and file contents.
function parseToolArgs(raw) {
    if (raw == null || (typeof raw === 'string' && !raw.trim())) return {};
    let value = raw;
    for (let depth = 0; depth < 6; depth++) {
        if (typeof value === 'string') {
            let text = value.trim();
            const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
            if (fenced) text = fenced[1].trim();
            try { value = JSON.parse(text); } catch { break; }
            continue;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) break;
        const keys = Object.keys(value);
        const wrapper = keys.find(key => key === '_raw' || key === '__raw');
        if (!wrapper) return value;
        // Mixed wrapped/direct fields are ambiguous: do not choose a write target silently.
        if (keys.length !== 1) break;
        value = value[wrapper];
    }
    return { __raw: typeof raw === 'string' ? raw : JSON.stringify(raw) };
}

function requireToolArgs(raw) {
    const args = parseToolArgs(raw);
    if (Object.hasOwn(args, '__raw')) {
        const error = new Error('工具参数不是有效的 JSON 对象。请重新调用工具，直接传入参数字段，不要使用 _raw / __raw 包装。例如 write_file 使用 {"path":"docs/result.html","content":"完整文件内容"}。Windows 和 macOS 均建议使用相对工作目录的路径及 / 分隔符；JSON 字符串内的反斜杠和换行必须正确转义。未执行本次操作。');
        error.code = 'AGENT_TOOL_ARGS_PARSE';
        throw error;
    }
    return args;
}

module.exports = { parseToolArgs, requireToolArgs };
