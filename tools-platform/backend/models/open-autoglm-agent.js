// Open-AutoGLM 原生手机自动化控制工具集
// 允许智能体在任何会话（包括手机 App 端、Web 端、未挂载工作区的普通对话）中直接通过 REST API
// 控制 Android 手机：查设备、实时截屏并在对话中回显图片、运行手机端 AI 任务、模拟点击滑动输入按键手势。
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://yutang.fanxiaolong.uk';
const DEFAULT_API_KEY = 'ak_autoglm_0OBKNPasZ6yvBV4zT_5lYieMsrw7nXHczbn-P1K4qj8';

const PLATFORM_ROOT = path.resolve(__dirname, '../..');
const MEDIA_OUTPUT_DIR = path.join(PLATFORM_ROOT, 'outputs', 'autoglm');

function getBaseUrl() {
    return (process.env.AUTOGLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getApiKey() {
    return process.env.AUTOGLM_API_KEY || DEFAULT_API_KEY;
}

function authHeaders() {
    return {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json'
    };
}

function ensureMediaDir() {
    if (!fs.existsSync(MEDIA_OUTPUT_DIR)) {
        fs.mkdirSync(MEDIA_OUTPUT_DIR, { recursive: true });
    }
}

/** 获取设备列表 */
async function listDevices() {
    const url = `${getBaseUrl()}/api/v1/devices`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`获取设备列表失败 (${res.status}): ${text || res.statusText}`);
    }
    return res.json();
}

/** 截取屏幕并保存到 outputs 目录，返回给前端展示 */
async function getScreenshot(deviceId) {
    ensureMediaDir();
    let targetId = deviceId;
    if (!targetId) {
        const devs = await listDevices();
        if (!devs.devices || devs.devices.length === 0) {
            throw new Error('未检测到任何已连接的 Android 设备，请先确认手机通过 USB/WiFi 接入 Open-AutoGLM');
        }
        targetId = devs.devices[0].id;
    }

    const url = `${getBaseUrl()}/api/v1/devices/${encodeURIComponent(targetId)}/screenshot?format=raw`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`截取手机屏幕失败 (${res.status}): ${text || res.statusText}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const filename = `phone_screen_${Date.now()}.png`;
    const savePath = path.join(MEDIA_OUTPUT_DIR, filename);
    fs.writeFileSync(savePath, buffer);

    return {
        success: true,
        deviceId: targetId,
        imagePath: savePath,
        sizeBytes: buffer.length,
        markdown: `![手机实时屏幕](${savePath})`
    };
}

/** 运行自动化 AI 任务 */
async function runTask({ task, deviceId, timeout = 1800, forceRun = false, wait = false }) {
    if (!task) throw new Error('任务描述不能为空');
    let targetId = deviceId;
    if (!targetId) {
        const devs = await listDevices();
        if (devs.devices && devs.devices.length > 0) {
            targetId = devs.devices[0].id;
        }
    }

    const url = `${getBaseUrl()}/api/v1/tasks/run`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            task,
            device_id: targetId,
            timeout,
            force_run: forceRun
        })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`启动任务失败 (${res.status}): ${text || res.statusText}`);
    }
    const data = await res.json();
    if (!wait || !data.task_id) return data;

    // 如果需要等待任务执行完成，轮询状态
    const taskId = data.task_id;
    const deadline = Date.now() + (Math.min(timeout, 300) * 1000);
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await getTaskStatus(taskId);
        if (['finished', 'success', 'failed', 'stopped', 'error'].includes(status.status)) {
            return status;
        }
    }
    return { ...data, note: '任务仍在后台执行中，可通过 open_autoglm_task_status 查询' };
}

/** 查询任务状态 */
async function getTaskStatus(taskId) {
    if (!taskId) throw new Error('taskId 不能为空');
    const url = `${getBaseUrl()}/api/v1/tasks/${encodeURIComponent(taskId)}`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`查询任务状态失败 (${res.status}): ${text || res.statusText}`);
    }
    return res.json();
}

/** 模拟手势或按键操作 */
async function performAction({ action, deviceId, x, y, x1, y1, x2, y2, durationMs = 300, text, key, command }) {
    if (!action) throw new Error('action 不能为空');
    let targetId = deviceId;
    if (!targetId) {
        const devs = await listDevices();
        if (devs.devices && devs.devices.length > 0) {
            targetId = devs.devices[0].id;
        }
    }
    if (!targetId) throw new Error('未检测到可用 Android 设备');

    const body = { action };
    if (action === 'tap') {
        if (x === undefined || y === undefined) throw new Error('tap 动作需要 x 和 y 坐标');
        body.x = Math.round(Number(x));
        body.y = Math.round(Number(y));
    } else if (action === 'swipe') {
        if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) throw new Error('swipe 动作需要 x1, y1, x2, y2 坐标');
        body.x1 = Math.round(Number(x1));
        body.y1 = Math.round(Number(y1));
        body.x2 = Math.round(Number(x2));
        body.y2 = Math.round(Number(y2));
        body.duration_ms = durationMs;
    } else if (action === 'text') {
        if (text === undefined) throw new Error('text 动作需要输入文本内容');
        body.text = String(text);
    } else if (action === 'key') {
        if (!key) throw new Error('key 动作需要按键名称（home/back/enter/power）');
        body.key = String(key);
    } else if (action === 'shell') {
        if (!command) throw new Error('shell 动作需要执行的 adb 命令');
        body.command = String(command);
    }

    const url = `${getBaseUrl()}/api/v1/devices/${encodeURIComponent(targetId)}/action`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const respText = await res.text().catch(() => '');
        throw new Error(`执行手势动作失败 (${res.status}): ${respText || res.statusText}`);
    }
    return res.json();
}

function definitions() {
    return [
        {
            name: 'open_autoglm_get_screenshot',
            description: '截取连接的 Android 手机当前的实时屏幕画面，并将图片保存到平台中供展示与模型分析。当用户询问“查看一下当前屏幕”、“截个屏”、“看看手机当前画面”、“截图看看”时，必须调用此工具！若用户发送复合指令（如“打卡设置 截图看看”），应在自动化任务完成后调用此工具截取最新画面。',
            parameters: {
                type: 'object',
                properties: {
                    device_id: { type: 'string', description: '设备序列号 ID。留空则自动选择当前已连接的第一台设备。' }
                }
            }
        },
        {
            name: 'open_autoglm_list_devices',
            description: '获取当前连接到 Open-AutoGLM 的 Android 设备列表（包含型号、设备ID、连接状态与分辨率）。',
            parameters: {
                type: 'object',
                properties: {}
            }
        },
        {
            name: 'open_autoglm_run_task',
            description: '在 Android 手机上执行自主 AI 自动化任务（例如“打开设置”、“打卡设置”、“打开微信给某某发送一条消息”、“在抖音搜索某内容”等端到端操作）。',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: '手机端自动化任务指令（如“打开系统设置”、“打开钉钉打卡界面”等），越详细越好。' },
                    device_id: { type: 'string', description: '目标设备序列号 ID。留空则自动选择默认设备。' },
                    wait: { type: 'boolean', description: '是否等待任务执行结束。默认 true。' }
                },
                required: ['task']
            }
        },
        {
            name: 'open_autoglm_action',
            description: '向 Android 手机发送指定的手势交互或物理按键指令（支持点击 tap、滑动 swipe、输入文字 text、按键 key、执行 ADB shell 等）。',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['tap', 'swipe', 'text', 'key', 'shell', 'unlock', 'lock'], description: '动作类型' },
                    device_id: { type: 'string', description: '设备序列号 ID' },
                    x: { type: 'integer', description: '点击的 X 坐标（tap 时使用）' },
                    y: { type: 'integer', description: '点击的 Y 坐标（tap 时使用）' },
                    x1: { type: 'integer', description: '滑动起始 X 坐标（swipe 时使用）' },
                    y1: { type: 'integer', description: '滑动起始 Y 坐标（swipe 时使用）' },
                    x2: { type: 'integer', description: '滑动终点 X 坐标（swipe 时使用）' },
                    y2: { type: 'integer', description: '滑动终点 Y 坐标（swipe 时使用）' },
                    durationMs: { type: 'integer', description: '滑动持续毫秒数（默认 300）' },
                    text: { type: 'string', description: '输入的文本内容（text 时使用）' },
                    key: { type: 'string', enum: ['home', 'back', 'enter', 'power'], description: '按键名称（key 时使用）' },
                    command: { type: 'string', description: 'ADB Shell 命令字符串（shell 时使用，如 dumpsys battery）' }
                },
                required: ['action']
            }
        },
        {
            name: 'open_autoglm_task_status',
            description: '查询 Open-AutoGLM 后台任务的执行进度、日志与完成状态。',
            parameters: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: '任务 ID' }
                },
                required: ['task_id']
            }
        },
        {
            name: 'open_autoglm',
            description: 'Open-AutoGLM 快捷控制工具（兼容通用指令）。可直接传入 task 执行手机端 AI 任务（如打开设置、操作App），或指定 screenshot 获取屏幕截图。',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: '需要在手机上执行的操作任务，如“打开设置”、“进入打卡界面”等' },
                    action: { type: 'string', description: '动作类型：run（执行任务）、screenshot（截图）、tap、swipe 等' },
                    screenshot: { type: 'boolean', description: '是否执行截屏' },
                    device_id: { type: 'string', description: '目标设备 ID' }
                }
            }
        }
    ];
}

function buildPrompt() {
    return `## Open-AutoGLM 手机自动化控制原生工具
你拥有以下原生工具，可直接与用户的 Android 手机交互，无需在终端中运行外部命令，亦无需选择工作空间目录：
- open_autoglm_run_task：让手机端 AI 执行端到端自动化操作（如“打开设置”、“打卡设置”、“进入微信发消息”等）。
- open_autoglm_get_screenshot：截取手机实时屏幕。执行后你必须在回复中使用 Markdown 图片语法展示给用户：\`![手机实时屏幕](imagePath)\`（将 imagePath 替换为工具返回的实际路径）。如果需要分析屏幕中的具体文字或UI，可接着调用 view_image 查看该路径。
- open_autoglm_list_devices：查询已连接设备列表。
- open_autoglm_action：点击坐标、滑动、输入文字、按返回/Home键。
- open_autoglm_task_status：查询任务进度与结果。
- open_autoglm：通用快捷调用工具。

【执行复合指令规范】：
当用户指令同时包含操作与截图（例如“打卡设置 截图看看”、“打开系统设置看一眼”、“搜索某内容并截图”等）：
1. 第一步：先调用 open_autoglm_run_task（例如 task: "打开设置" 或 "打卡设置"）在手机上执行该任务；
2. 第二步：任务完成后，紧接着调用 open_autoglm_get_screenshot 截取手机操作后的最新画面；
3. 第三步：在回复中以 Markdown 图片格式 \`![手机实时屏幕](imagePath)\` 展示截图，并向用户汇报操作进展。

【容错说明】：
用户输入的“打卡设置”往往是“打开设置”的语音/拼音输入，或者是“考勤打卡设置”，请按最合理意图调用 open_autoglm_run_task 执行，切勿因词面歧义拒绝执行！

【铁律】：当用户说“查看一下当前屏幕”或“帮我操作手机”时，直接调用上述原生工具，严禁向用户输出终端命令行让他们自己去运行！`;
}

async function execute(name, args = {}) {
    try {
        const cleanName = String(name || '').toLowerCase().replace(/-/g, '_');
        if (cleanName === 'open_autoglm_get_screenshot' || cleanName === 'open_autoglm_screenshot' || cleanName === 'screenshot') {
            const result = await getScreenshot(args.device_id);
            return {
                content: `手机实时屏幕已成功截取！\n本地图片路径：${result.imagePath}\n展示图片语法：${result.markdown}\n\n请在回复中包含 ${result.markdown} 以便用户在界面上直接看到该画面。`,
                summary: `截取屏幕 ${path.basename(result.imagePath)}`,
                isError: false
            };
        }
        if (cleanName === 'open_autoglm_list_devices' || cleanName === 'open_autoglm_devices') {
            const data = await listDevices();
            return {
                content: JSON.stringify(data, null, 2),
                summary: `已查询设备列表 (${data.count || 0} 台)`,
                isError: false
            };
        }
        if (cleanName === 'open_autoglm_run_task' || cleanName === 'open_autoglm_run') {
            const taskText = args.task || args.instruction || args.cmd;
            const res = await runTask({
                task: taskText,
                deviceId: args.device_id,
                timeout: args.timeout,
                forceRun: args.force_run,
                wait: args.wait !== false
            });
            let extraScreenshotText = '';
            // 如果用户指令中包含“截图/截屏/看/瞧”等期望看到屏幕的词，且任务已完成，自动截一张最新屏幕附上
            if (taskText && /截图|截屏|看|瞧|瞧瞧|屏幕/.test(taskText) && res.status !== 'failed') {
                try {
                    const snap = await getScreenshot(args.device_id);
                    extraScreenshotText = `\n\n已自动获取操作完成后的最新手机屏幕：\n本地路径：${snap.imagePath}\n展示语法：${snap.markdown}\n请务必在回复中包含 ${snap.markdown}`;
                } catch (snapErr) {
                    console.warn('[autoglm] 任务后自动截屏失败:', snapErr.message);
                }
            }
            return {
                content: `${JSON.stringify(res, null, 2)}${extraScreenshotText}`,
                summary: `手机任务 ${res.task_id ? res.task_id.slice(0, 10) : '已完成'}: ${res.status || 'success'}${extraScreenshotText ? ' (已附截图)' : ''}`,
                isError: false
            };
        }
        if (cleanName === 'open_autoglm_action') {
            const res = await performAction(args);
            return {
                content: JSON.stringify(res, null, 2),
                summary: `手势执行: ${args.action}`,
                isError: false
            };
        }
        if (cleanName === 'open_autoglm_task_status') {
            const res = await getTaskStatus(args.task_id);
            return {
                content: JSON.stringify(res, null, 2),
                summary: `任务状态: ${res.status || 'unknown'}`,
                isError: false
            };
        }
        if (cleanName === 'open_autoglm') {
            // 通用别名调度：根据参数智能分发到截屏、执行任务或手势
            if (args.screenshot === true || args.action === 'screenshot' || (args.task && /截屏|截图|当前屏幕/.test(args.task) && !/打开|点击|滑动|打卡/.test(args.task))) {
                return execute('open_autoglm_get_screenshot', args);
            }
            if (args.action && ['tap', 'swipe', 'text', 'key', 'shell'].includes(args.action)) {
                return execute('open_autoglm_action', args);
            }
            const taskText = args.task || args.instruction || args.command || args.text || (typeof args === 'string' ? args : '');
            if (taskText) {
                return execute('open_autoglm_run_task', { task: taskText, device_id: args.device_id, wait: args.wait !== false });
            }
            return execute('open_autoglm_get_screenshot', args);
        }
        return {
            content: `未知的 Open-AutoGLM 工具: ${name}`,
            summary: `未知工具 ${name}`,
            isError: true
        };
    } catch (error) {
        return {
            content: `Open-AutoGLM 操作失败: ${error.message}`,
            summary: `操作失败: ${String(error.message).slice(0, 80)}`,
            isError: true
        };
    }
}

const agentLoop = require('./agent-loop');
const SKILL_ID = 'open-autoglm';

async function runTurn({ client: aiClient, systemInstruction, messages, signal, onDelta, onEvent, maxOutputTokens, temperature, model, extras = null, vision = null }) {
    const result = await agentLoop.runToolLoop({
        extras,
        vision,
        client: aiClient, model, systemPrompt: `${systemInstruction}\n${buildPrompt()}`, messages, tools: definitions(),
        write: event => (event.type === 'delta' ? onDelta?.(event.delta) : onEvent?.(event)),
        signal, maxOutputTokens, temperature, task: String(messages.at(-1)?.content || ''), callIdPrefix: 'autoglm',
        executeCall: async (call, { start }) => {
            const args = call.args && typeof call.args === 'object' ? call.args : {};
            start({ tool: call.name, args });
            const outcome = await execute(call.name, args);
            return { ...outcome, output: String(outcome.content || '').slice(0, 4000) };
        },
        toolsUnsupported: () => ({ note: '（当前模型不支持工具调用，Open-AutoGLM 工具不可用。）' })
    });
    return { text: result.text, usage: result.usage, toolLog: result.toolLog, ...(result.toolsUnsupported ? { toolsUnsupported: true } : {}) };
}

module.exports = {
    SKILL_ID,
    definitions,
    buildPrompt,
    execute,
    runTurn,
    listDevices,
    getScreenshot,
    runTask,
    performAction,
    getTaskStatus
};
