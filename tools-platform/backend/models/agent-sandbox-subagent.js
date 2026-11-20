// 共享工作区隔离命令子智能体（sandbox_task）：
// 当非原归属人在共享对话的远程工作区中需要执行终端命令（run_command）时，
// 在当前用户自己的临时隔离目录中拉起一个独立子智能体执行，执行完后将新增/修改的安全产物回写至共享工作区。
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const subagentUi = require('./agent-subagent');
const guard = require('./agent-path-guard');
const toolsService = require('./agent-tools-service');
const tenantContext = require('./tenant-context');
const boundary = require('./team-boundary');
const { redactText, redactValue } = require('./ai-sensitive-data');

const MAX_STEPS = 25;
const MAX_COPY_FILES = 80;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next']);
const SANDBOX_TOOL_NAMES = new Set([
    'list_directory', 'read_file', 'search', 'write_file', 'edit_file', 'multi_edit',
    'delete_path', 'rename_path', 'zip_files', 'unzip_file', 'read_document', 'query_data',
    'diff_files', 'run_command'
]);

const DEFINITION = {
    name: 'sandbox_task',
    description: '在当前共享工作区（已禁直接 run_command）中需要执行终端命令、运行脚本、构建或测试时，自动创建一个归属当前用户的独立临时隔离沙箱子智能体去执行，执行结果与产出文件会自动同步回共享对话工作区。',
    parameters: {
        type: 'object',
        properties: {
            description: { type: 'string', description: '3–15 字的任务标题（如“运行 Python 脚本处理数据”）' },
            prompt: { type: 'string', description: '独立执行指令：写明必要的范围、用户约定、输入文件、命令及预期产出。仅传影响本次执行的背景。' },
            inputFiles: {
                type: 'array',
                description: '可选：需要带入隔离沙箱的共享工作区相对路径清单（不传则自动带入安全工作文件）',
                items: { type: 'string' }
            }
        },
        required: ['description', 'prompt']
    }
};

const SYSTEM_PROMPT = `你是 Dragon Claw 为共享对话协作临时拉起的「隔离沙箱执行子智能体」。
- 你当前所在的目录是专为当前成员分配的独立临时沙箱目录，可以安全使用文件工具和 \`run_command\` 执行命令或脚本。
- 新生成或修改的结果文件请直接保存在当前沙箱工作目录下（使用相对路径），系统会在你完成后自动把安全产物回传到共享工作区。
- 完成后给出简洁、清晰的结论，说明执行了什么命令、关键输出/结论以及新生成或修改的相对文件路径。`;

let seq = 0;

function isSafeRelative(rel) {
    if (!rel || path.isAbsolute(rel)) return false;
    const parts = rel.split(/[\\/]/).filter(Boolean);
    if (!parts.length || parts.some(p => p === '..' || SKIP_DIRS.has(p) || p.startsWith('.'))) return false;
    try { guard.assertNotSecretFile(rel); return true; } catch { return false; }
}

async function collectFiles(rootDir, { onlyPaths = [] } = {}) {
    const picked = [];
    let totalBytes = 0;
    if (onlyPaths.length) {
        for (const raw of onlyPaths.slice(0, MAX_COPY_FILES)) {
            const abs = guard.resolveInsideRoot(rootDir, String(raw || ''));
            const rel = path.relative(rootDir, abs);
            if (!isSafeRelative(rel)) continue;
            const st = await fsp.stat(abs).catch(() => null);
            if (!st || !st.isFile() || st.size > MAX_FILE_BYTES || totalBytes + st.size > MAX_TOTAL_BYTES) continue;
            totalBytes += st.size;
            picked.push({ rel, abs, size: st.size, mtimeMs: st.mtimeMs });
        }
        return picked;
    }
    const queue = [''];
    while (queue.length && picked.length < MAX_COPY_FILES) {
        const curRel = queue.shift();
        const curAbs = curRel ? path.join(rootDir, curRel) : rootDir;
        const entries = await fsp.readdir(curAbs, { withFileTypes: true }).catch(() => []);
        for (const ent of entries) {
            if (ent.name.startsWith('.') || SKIP_DIRS.has(ent.name) || ent.isSymbolicLink()) continue;
            const rel = curRel ? path.join(curRel, ent.name) : ent.name;
            if (ent.isDirectory()) { queue.push(rel); continue; }
            if (!ent.isFile() || !isSafeRelative(rel)) continue;
            const abs = path.join(rootDir, rel);
            const st = await fsp.stat(abs).catch(() => null);
            if (!st || st.size > MAX_FILE_BYTES || totalBytes + st.size > MAX_TOTAL_BYTES) continue;
            totalBytes += st.size;
            picked.push({ rel, abs, size: st.size, mtimeMs: st.mtimeMs });
            if (picked.length >= MAX_COPY_FILES) break;
        }
    }
    return picked;
}

async function snapshotDir(dir) {
    const files = await collectFiles(dir);
    return new Map(files.map(item => [item.rel, { size: item.size, mtimeMs: item.mtimeMs, abs: item.abs }]));
}

async function run({
    call, identity, originRoot, user, tenantId, chatSessionId = '', parentSession = null,
    client, model, write, signal, maxOutputTokens, temperature, sensitiveValues = [],
    artifactOwner = '', artifactSession = '', eventFields = {}, allocateRoot, runApproval = null
}) {
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    const description = String(args.description || '').trim().slice(0, 40) || '沙箱执行任务';
    const prompt = String(args.prompt || '').trim().slice(0, 20000);
    if (!prompt) return { content: 'sandbox_task 需要提供清晰的执行指令 (prompt)', summary: '缺少 prompt', isError: true };

    const safeOriginRoot = guard.normalizeRoot(originRoot);
    const runnerKey = `${chatSessionId || 'shared'}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const rawRunnerRoot = allocateRoot({ user, tenantId, chatSessionId: runnerKey });
    await fsp.mkdir(rawRunnerRoot, { recursive: true });
    const runnerRoot = guard.normalizeRoot(rawRunnerRoot);

    const requestedInputs = Array.isArray(args.inputFiles) ? args.inputFiles.map(x => String(x || '').trim()).filter(Boolean) : [];
    const staged = await collectFiles(safeOriginRoot, { onlyPaths: requestedInputs }).catch(() => []);
    for (const item of staged) {
        const dest = guard.resolveInsideRoot(runnerRoot, item.rel);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(item.abs, dest);
    }
    const beforeMap = await snapshotDir(runnerRoot);

    const id = `sb_${++seq}_${crypto.randomBytes(3).toString('hex')}`;
    const who = identity || subagentUi.roster()();
    const base = { type: 'subagent', ...eventFields, id, name: `${who.name} · 沙箱`, emoji: who.emoji, color: who.color, description };
    write({ ...base, phase: 'start', prompt: prompt.slice(0, 2000) });
    const started = Date.now();
    let stepIndex = 0;

    const access = await require('./agent-tool-access').forActor(user, artifactOwner);
    const definitions = toolsService.definitions({ readOnly: false })
        .filter(def => SANDBOX_TOOL_NAMES.has(def.name) && access(def.name));
    const sandboxConfined = boundary.isConfined(user, tenantId);
    const sandboxCtx = {
        root: runnerRoot,
        signal,
        sensitiveValues,
        username: user?.username || '',
        readOnly: false,
        permissionMode: 'auto',
        confined: sandboxConfined,
        tenantId,
        fullResults: true,
        artifactOwner,
        currentUserMessage: prompt
    };

    const executeCall = async (subCall, { start }) => {
        const toolCallId = `${id}_t${++stepIndex}`;
        write({ ...base, phase: 'tool', callId: toolCallId, tool: subCall.name, args: subCall.args || {}, state: 'running' });
        start();
        const t0 = Date.now();
        let outcome;
        try {
            if (!SANDBOX_TOOL_NAMES.has(subCall.name) || !access(subCall.name)) {
                outcome = { content: `沙箱子智能体无权使用工具 ${subCall.name}`, summary: '无权调用该工具', isError: true };
            } else {
                const danger = subCall.name === 'run_command' && runApproval
                    ? runApproval.dangerHits(subCall.name, subCall.args)
                    : [];
                if (danger.length) {
                    const approved = await runApproval.confirmDanger(subCall, danger, runnerRoot);
                    if (!approved) {
                        outcome = { content: '用户拒绝了沙箱内的高风险命令操作', summary: '用户拒绝', isError: true };
                    }
                }
                if (!outcome) {
                    outcome = await toolsService.execute(sandboxCtx, subCall.name, subCall.args);
                }
            }
        } catch (err) {
            outcome = toolsService.errorResult(sandboxCtx, err);
        }
        const ok = !outcome?.isError;
        write({ ...base, phase: 'tool', callId: toolCallId, tool: subCall.name, state: ok ? 'done' : 'failed', summary: String(outcome?.summary || '').slice(0, 120), durationMs: Date.now() - t0 });
        return outcome;
    };

    try {
        const agentLoop = require('./agent-loop');
        const result = await agentLoop.runToolLoop({
            client,
            model,
            systemPrompt: redactText(`${SYSTEM_PROMPT}\n当前独立临时沙箱已预同步工作文件数：${staged.length}`, { secrets: sensitiveValues }),
            messages: [{ role: 'user', content: prompt }],
            tools: definitions,
            executeCall,
            write: event => { if (event?.type === 'status') write({ ...base, phase: 'status', status: event.status }); },
            signal,
            maxSteps: MAX_STEPS,
            callIdPrefix: `${id}_c`,
            maxOutputTokens,
            temperature,
            sensitiveValues,
            task: prompt,
            artifactOwner,
            artifactSession,
            root: runnerRoot,
            builtins: ['calculate'],
            maxEmptyNudges: 1,
            toolAccess: name => SANDBOX_TOOL_NAMES.has(name) && access(name),
            parallelSafe: call => toolsService.kindOf(call.name, call.args || {}) === 'read'
        });

        // 将沙箱中新生成或更新的安全文件同步回共享对话的原始工作目录
        const afterMap = await snapshotDir(runnerRoot);
        const syncedOutputs = [];
        for (const [rel, meta] of afterMap.entries()) {
            const prev = beforeMap.get(rel);
            if (prev && prev.size === meta.size && Math.abs(prev.mtimeMs - meta.mtimeMs) < 5) continue;
            if (!isSafeRelative(rel)) continue;
            const targetAbs = guard.resolveInsideRoot(safeOriginRoot, rel);
            guard.assertNotSecretFile(targetAbs);
            parentSession?.changeLog?.snapshotBefore?.(rel, targetAbs);
            await fsp.mkdir(path.dirname(targetAbs), { recursive: true });
            await fsp.copyFile(meta.abs, targetAbs);
            parentSession?.changeLog?.recordAfter?.(rel);
            syncedOutputs.push(rel);
        }

        const report = String(result.text || '').trim() || '（隔离沙箱任务已完成，未返回文本结论）';
        const syncNote = syncedOutputs.length
            ? `\n\n已将隔离沙箱产出的 ${syncedOutputs.length} 个文件同步回共享工作区：${syncedOutputs.map(f => `\`${f}\``).join('、')}`
            : '';
        const finalReport = redactText(`${report}${syncNote}`, { secrets: sensitiveValues });
        write({ ...base, phase: 'done', ok: true, result: finalReport.slice(0, 4000), durationMs: Date.now() - started, toolCount: result.toolCallCount });
        return {
            content: `${finalReport}\n（由当前用户的独立临时隔离沙箱子智能体执行完成，已回传共享对话）`,
            summary: syncedOutputs.length ? `沙箱执行完成，回传 ${syncedOutputs.length} 个文件` : `沙箱执行完成`,
            syncedOutputs
        };
    } catch (error) {
        const message = String(error?.message || '隔离沙箱子智能体执行失败');
        write({ ...base, phase: 'done', ok: false, error: message, durationMs: Date.now() - started });
        return { content: `隔离沙箱子智能体执行失败：${message}`, summary: '沙箱执行失败', isError: true };
    }
}

module.exports = { DEFINITION, run };
