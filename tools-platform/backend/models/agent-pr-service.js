// Dragon Claw 工作区：「创建 PR」流程。
// 预检：工作目录是 git 仓库、有 gh CLI 且已登录、有远程；
// 执行：新建分支 → 只提交本会话改动 → 推送 → gh pr create，每一步都是一条 run_command，按权限模式走审批。
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const toolsService = require('./agent-tools-service');

const IS_WIN = process.platform === 'win32';
const STEP_TIMEOUT_MS = 180000;
const PREFLIGHT_TIMEOUT_MS = 15000;

const GIT_CANDIDATES = IS_WIN
    ? ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']
    : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];
const GH_CANDIDATES = IS_WIN
    ? ['C:\\Program Files\\GitHub CLI\\gh.exe', 'C:\\Program Files (x86)\\GitHub CLI\\gh.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe')]
    : ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', '/home/linuxbrew/.linuxbrew/bin/gh'];

/** 桌面版从 Finder/开始菜单启动时 PATH 很短：先按 PATH 找，找不到再试常见安装位置。 */
function findExecutable(name, candidates) {
    const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
        for (const ext of exts) {
            const candidate = path.join(dir, name + ext);
            if (fs.existsSync(candidate)) return { path: candidate, onPath: true };
        }
    }
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return { path: candidate, onPath: false };
    }
    return { path: '', onPath: false };
}

/** 命令里写什么：PATH 里找得到就写短名，否则写绝对路径（run_command 的 shell 与本进程共享 PATH）。 */
function commandName(found, name) {
    return found.onPath ? name : found.path;
}

function exec(file, args, { cwd, timeoutMs = PREFLIGHT_TIMEOUT_MS } = {}) {
    return new Promise(resolve => {
        execFile(file, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } }, (error, stdout, stderr) => {
            resolve({ ok: !error, code: error ? error.code : 0, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
        });
    });
}

/** 预检：返回能否创建 PR 以及不能时的原因码。 */
async function preflight(root, { changes = [] } = {}) {
    const gitFound = findExecutable('git', GIT_CANDIDATES);
    const ghFound = findExecutable('gh', GH_CANDIDATES);
    const git = gitFound.path;
    const gh = ghFound.path;
    const result = {
        ok: false,
        reason: '',
        isGit: false,
        toplevel: '',
        branch: '',
        hasRemote: false,
        remote: '',
        gitCommand: git ? commandName(gitFound, 'git') : '',
        hasGh: Boolean(gh),
        ghPath: gh,
        ghCommand: gh ? commandName(ghFound, 'gh') : '',
        ghVersion: '',
        ghAuth: false,
        changedFiles: changes.length,
        suggestedBranch: suggestBranchName(changes)
    };
    if (!git) {
        result.reason = 'NO_GIT';
        return result;
    }
    const top = await exec(git, ['rev-parse', '--show-toplevel'], { cwd: root });
    if (!top.ok) {
        result.reason = 'NOT_GIT';
        return result;
    }
    result.isGit = true;
    result.toplevel = top.stdout;
    const branch = await exec(git, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
    result.branch = branch.ok ? branch.stdout : '';
    const remote = await exec(git, ['remote', 'get-url', 'origin'], { cwd: root });
    result.hasRemote = remote.ok && Boolean(remote.stdout);
    result.remote = remote.ok ? remote.stdout : '';
    if (!gh) {
        result.reason = 'NO_GH';
        return result;
    }
    const version = await exec(gh, ['--version']);
    result.ghVersion = (version.stdout.match(/gh version (\S+)/) || [])[1] || '';
    const auth = await exec(gh, ['auth', 'status'], { cwd: root });
    result.ghAuth = auth.ok;
    if (!auth.ok) {
        result.reason = 'GH_NOT_AUTHED';
        return result;
    }
    if (!result.hasRemote) {
        result.reason = 'NO_REMOTE';
        return result;
    }
    if (!changes.length) {
        result.reason = 'NO_CHANGES';
        return result;
    }
    result.ok = true;
    result.reason = 'OK';
    return result;
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff._-]+/g, '-')
        .replace(/[.]{2,}/g, '.')
        .replace(/^[-.]+|[-.]+$/g, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 48);
}

function suggestBranchName(changes = []) {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const first = changes[0] ? slugify(path.basename(String(changes[0].path || '')).replace(/\.[^.]+$/, '')) : '';
    return `dragon-claw/${stamp}${first ? `-${first}` : ''}`;
}

/** 分支名：只保留 git 允许的安全字符。 */
function sanitizeBranch(value, fallback) {
    const cleaned = String(value || '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^A-Za-z0-9._/\u4e00-\u9fff-]+/g, '-')
        .replace(/\/{2,}/g, '/')
        .replace(/(^|\/)[.-]+|[.-]+(\/|$)/g, '$1$2')
        .replace(/\.lock(\/|$)/g, '$1')
        .replace(/\.{2,}/g, '.')
        .replace(/^\/+|\/+$/g, '')
        .slice(0, 100);
    return cleaned || fallback;
}

function quoteArg(value) {
    const text = String(value ?? '');
    if (IS_WIN) return `"${text.replace(/"/g, '""').replace(/%/g, '%%')}"`;
    return `'${text.replace(/'/g, `'\\''`)}'`;
}

function quoteCommand(file, args) {
    const command = /[\s"']/.test(file) ? quoteArg(file) : file;
    return [command, ...args.map(arg => (/^[A-Za-z0-9._\/:=@-]+$/.test(arg) ? arg : quoteArg(arg)))].join(' ');
}

/** 根据会话变更列表生成五步命令。 */
function buildPlan({ changes = [], title, body, branch, gitPath = 'git', ghPath = 'gh' }) {
    const cleanTitle = String(title || '').trim().replace(/\r?\n+/g, ' ').slice(0, 200);
    if (!cleanTitle) {
        const error = new Error('请填写 PR 标题');
        error.code = 'AGENT_PR_TITLE_REQUIRED';
        error.statusCode = 400;
        throw error;
    }
    const branchName = sanitizeBranch(branch, suggestBranchName(changes));
    const paths = [];
    changes.forEach(item => {
        [item.from, item.path].filter(Boolean).forEach(filePath => {
            const normalized = String(filePath).replace(/\\/g, '/');
            if (!paths.includes(normalized)) paths.push(normalized);
        });
    });
    if (!paths.length) {
        const error = new Error('本次会话没有可提交的改动');
        error.code = 'AGENT_PR_NO_CHANGES';
        error.statusCode = 400;
        throw error;
    }
    const cleanBody = String(body || '').trim().slice(0, 4000);
    const commitBody = cleanBody || `由 Dragon Claw 工作区创建。\n\n改动文件：\n${paths.map(item => `- ${item}`).join('\n')}`;
    const steps = [
        { step: 'branch', command: quoteCommand(gitPath, ['checkout', '-b', branchName]) },
        { step: 'add', command: quoteCommand(gitPath, ['add', '-A', '--', ...paths]) },
        // 指定路径提交：只提交本会话改动的文件，用户事先暂存的其他改动保持暂存、不进入这个提交
        { step: 'commit', command: quoteCommand(gitPath, ['commit', '-m', cleanTitle, '-m', commitBody, '--', ...paths]) },
        { step: 'push', command: quoteCommand(gitPath, ['push', '-u', 'origin', branchName]) },
        { step: 'create', command: quoteCommand(ghPath, ['pr', 'create', '--head', branchName, '--title', cleanTitle, '--body', commitBody]) }
    ];
    return { title: cleanTitle, body: commitBody, branch: branchName, paths, steps };
}

function extractPrUrl(text) {
    const match = String(text || '').match(/https?:\/\/\S+\/pull\/\d+/);
    return match ? match[0] : '';
}

/**
 * 执行创建 PR 流程。每步先 write pr_step(pending)，走审批（classify 为 ask 时等待用户），再以 run_command 执行。
 * @returns {{ ok, url, branch, steps, failedStep? }}
 */
async function runPrFlow({ session, run, plan, write, signal, classify, requestApproval }) {
    const toolCtx = { root: session.root, changeLog: null, signal, onProcess: child => run.processes.add(child) };
    const total = plan.steps.length;
    const progress = [];
    let url = '';
    for (let index = 0; index < total; index += 1) {
        const { step, command } = plan.steps[index];
        const callId = `pr-${run.id.slice(0, 8)}-${index + 1}`;
        write({ type: 'pr_step', runId: run.id, step, index: index + 1, total, command, status: 'pending' });
        if (signal?.aborted) {
            progress.push({ step, status: 'aborted' });
            write({ type: 'pr_step', runId: run.id, step, index: index + 1, total, command, status: 'aborted' });
            return { ok: false, url, branch: plan.branch, steps: progress, failedStep: step, reason: 'aborted' };
        }
        let decision = classify(session, 'run_command');
        if (decision === 'ask') {
            const answer = await requestApproval(run, { id: callId, name: 'run_command', args: { command } }, { command, cwd: session.root });
            if (answer === 'always') session.alwaysAllow.add('run_command');
            write({ type: 'approval_result', runId: run.id, callId, decision: answer });
            decision = answer === 'allow' || answer === 'always' ? 'allow' : answer;
        }
        if (decision !== 'allow') {
            const status = decision === 'abort' ? 'aborted' : decision === 'timeout' ? 'timeout' : 'denied';
            progress.push({ step, status });
            write({ type: 'pr_step', runId: run.id, step, index: index + 1, total, command, status });
            return { ok: false, url, branch: plan.branch, steps: progress, failedStep: step, reason: status };
        }
        const startedAt = Date.now();
        write({ type: 'tool_start', runId: run.id, callId, tool: 'run_command', args: { command } });
        const outcome = await toolsService.execute(toolCtx, 'run_command', { command, timeoutMs: STEP_TIMEOUT_MS });
        write({ type: 'tool_result', runId: run.id, callId, tool: 'run_command', ok: !outcome.isError, summary: String(outcome.summary || '').slice(0, 200), truncated: Boolean(outcome.truncated), durationMs: Date.now() - startedAt });
        const output = String(outcome.content || '');
        if (step === 'create') url = extractPrUrl(output);
        if (outcome.isError) {
            progress.push({ step, status: 'failed', output: output.slice(-4000) });
            write({ type: 'pr_step', runId: run.id, step, index: index + 1, total, command, status: 'failed', output: output.slice(-4000) });
            return { ok: false, url, branch: plan.branch, steps: progress, failedStep: step, reason: 'failed' };
        }
        progress.push({ step, status: 'done' });
        write({ type: 'pr_step', runId: run.id, step, index: index + 1, total, command, status: 'done', url: url || undefined });
    }
    return { ok: true, url, branch: plan.branch, steps: progress };
}

module.exports = { preflight, buildPlan, runPrFlow, suggestBranchName, sanitizeBranch, quoteArg, quoteCommand, extractPrUrl, findExecutable, _internal: { GIT_CANDIDATES, GH_CANDIDATES } };
