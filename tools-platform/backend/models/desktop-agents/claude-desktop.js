// Claude Desktop stores readable Code transcripts locally, but its current
// public/native interface does not acknowledge an exact target input. A deep
// link can open a side discussion while accessibility exposes the project
// composer. Do not type into that composer or substitute a CLI conversation.
async function status() { return { canSend: false, reason: 'Claude 桌面历史可查看；当前版本尚无可确认原会话目标的发送连接，暂为只读' }; }
async function send() { throw Object.assign(new Error('Claude 桌面暂仅支持查看，请在 Claude 原会话中继续'), { code: 'DESKTOP_UNSUPPORTED' }); }
module.exports = { status, send };
