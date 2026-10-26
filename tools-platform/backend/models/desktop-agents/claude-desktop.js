// Claude Desktop has no public local interface for sending into a chosen session,
// so sending works like a careful user would through macOS accessibility (opt-in,
// macOS only): find the session row by its exact title, open it, confirm the
// window heading names that session, refuse drafts / busy turns / ambiguous
// composers, paste, read the composer back, then press Return. Delivery is only
// reported after service.send finds the message in the session's own transcript.
// The native helper (claude-ax.swift) is compiled on first use and only performs
// single reads or actions; every decision below is testable with a fake driver.
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const SOURCE = path.join(__dirname, 'claude-ax.swift');
const STOP = new Set(['停止', 'Stop', 'Stop response', '停止回复']);
const failure = (code, message) => Object.assign(new Error(message), { code });
const exec = (file, args, timeout) => new Promise((resolve, reject) => execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stderr })) : resolve(stdout)));
let building;
async function helper() {
    if (process.platform !== 'darwin')
        throw failure('DESKTOP_UNSUPPORTED', '模拟操作发送仅支持 macOS');
    if (!building)
        building = (async () => {
            const source = await fs.readFile(SOURCE);
            const binary = path.join(os.tmpdir(), `dragon-claude-ax-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 16)}`);
            try {
                await fs.access(binary);
                return binary;
            }
            catch { }
            const work = path.join(os.tmpdir(), `dragon-claude-ax-${process.pid}-${Date.now()}`);
            await fs.writeFile(work + '.swift', source); // Electron 包内源码先落地，swiftc 读不到 asar
            try {
                await exec('/usr/bin/xcrun', ['swiftc', '-O', '-o', work, work + '.swift'], 180000);
            }
            catch {
                throw failure('DESKTOP_UNSUPPORTED', '需要 Xcode 命令行工具才能启用 Claude 模拟操作（xcode-select --install）');
            }
            finally {
                await fs.rm(work + '.swift', { force: true });
            }
            await fs.rename(work, binary);
            return binary;
        })().catch(error => { building = null; throw error; });
    return building;
}
async function run(command, argument) {
    const output = await exec(await helper(), argument ? [command, JSON.stringify(argument)] : [command], 20000).catch(error => { throw failure('DESKTOP_UNAVAILABLE', 'Claude 桌面操作失败：' + String(error.stderr || error.message).slice(0, 200)); });
    const result = JSON.parse(output);
    if (!result.ok)
        throw failure(result.code || 'DESKTOP_REJECTED', result.error || 'Claude 桌面操作失败');
    return result;
}
const driver = { status: () => run('status'), snapshot: () => run('snapshot'), press: title => run('press', { title }), paste: text => run('paste', { text }), submit: previous => run('submit', { previous }), restore: previous => run('restore', { previous }) };
// Reads the parts of the window the flow relies on. The session heading is the
// only heading with a description but no title; sidebar rows are titled buttons.
function parse(snapshot) {
    const elements = snapshot.elements || [];
    return {
        frontmost: Boolean(snapshot.frontmost),
        current: elements.find(e => e.role === 'AXHeading' && !e.title && e.desc)?.desc || '',
        rows: elements.filter(e => e.role === 'AXButton' && e.title).map(e => e.title),
        composers: elements.filter(e => e.role === 'AXTextArea').map(e => e.value || ''),
        busy: elements.some(e => e.role === 'AXButton' && STOP.has(e.desc))
    };
}
// Sub-sessions are listed as "<title> 由 Claude 从 <parent> 发起".
function rowFor(rows, title) {
    const matches = rows.filter(r => r === title || r.startsWith(title + ' 由 Claude 从 ') || r.startsWith(title + ' Started by Claude from '));
    if (matches.length !== 1)
        throw failure('DESKTOP_TARGET_UNCONFIRMED', matches.length ? 'Claude 侧栏有同名会话，无法确认发送目标' : '请在 Claude 桌面左侧栏中显示这个会话（Code 模式、展开所在项目）后重试');
    return matches[0];
}
const normalize = t => String(t || '').replace(/\r\n/g, '\n').trim();
async function status(cfg = {}, { driver: d = driver } = {}) {
    if (!cfg.claudeAutomation)
        return { canSend: false, reason: 'Claude 桌面历史可查看；在全局设置开启「模拟操作发送」后可从网页发送' };
    try {
        const state = await d.status();
        if (!state.trusted)
            return { canSend: false, reason: '模拟操作需要辅助功能权限：在“系统设置 → 隐私与安全性 → 辅助功能”中允许运行平台服务的程序' };
        if (!state.running)
            return { canSend: false, reason: 'Claude 桌面未运行，可查看已保存记录' };
        return { canSend: true, reason: '模拟操作发送：发送时 Claude 切到前台并打开目标会话，确认后自动切回' };
    }
    catch (error) {
        return { canSend: false, reason: error.message };
    }
}
// 打开会话或粘贴会把 Claude 切到前台；中途停止时把前台还给原来的应用。
async function send(row, text, options = {}) {
    const d = options.driver || driver, focus = { previous: '' };
    try {
        await attempt(row, text, d, options.wait || (ms => new Promise(r => setTimeout(r, ms))), focus);
    }
    catch (error) {
        if (focus.previous)
            await d.restore(focus.previous).catch(() => { });
        throw error;
    }
}
async function attempt(row, text, d, wait, focus) {
    let view = parse(await d.snapshot());
    if (view.current !== row.title) {
        focus.previous = (await d.press(rowFor(view.rows, row.title))).previous || '';
        for (let n = 0; n < 34 && view.current !== row.title; n++) {
            await wait(150);
            view = parse(await d.snapshot());
        }
        if (view.current !== row.title)
            throw failure('DESKTOP_TARGET_UNCONFIRMED', 'Claude 没有打开目标会话，已停止，未输入任何内容');
    }
    if (view.composers.length !== 1)
        throw failure('DESKTOP_TARGET_UNCONFIRMED', `Claude 窗口中有 ${view.composers.length} 个输入框，无法确定发送位置`);
    if (normalize(view.composers[0]))
        throw failure('DESKTOP_DRAFT', 'Claude 输入框有未发送内容，请先在桌面处理');
    if (view.busy)
        throw failure('DESKTOP_BUSY', '原会话正在运行，请等待当前回复结束或使用排队');
    const pasted = await d.paste(text);
    focus.previous ||= pasted.previous || '';
    view = parse(await d.snapshot());
    if (view.current !== row.title)
        throw failure('DESKTOP_TARGET_UNCONFIRMED', '输入后 Claude 已切换会话，未发送；请检查 Claude 输入框');
    if (view.composers.length !== 1 || normalize(view.composers[0]) !== normalize(text))
        throw failure('DESKTOP_REJECTED', 'Claude 输入框内容与待发送文字不一致，未发送；请检查 Claude 输入框');
    const previous = focus.previous;
    focus.previous = ''; // submit 自己切回
    await d.submit(previous);
}
module.exports = { status, send, parse, rowFor, driver, helper };
