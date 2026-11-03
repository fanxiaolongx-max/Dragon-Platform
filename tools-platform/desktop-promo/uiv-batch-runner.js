// Execute the workbench's generated batch commands in the existing Dragon browser.
// No Node evaluation of script content; all JavaScript runs in the sandboxed page.
'use strict';

const SUPPORTED = new Set(['echo', 'store', 'open', 'pause', 'executeScript', 'gotoIf_v2', 'gotoLabel', 'label', 'while_v2', 'endWhile']);

function prepareMacro(macro) {
    if (!macro || !Array.isArray(macro.Commands) || !macro.Commands.length) throw new Error('批脚本为空 / Empty batch');
    const labels = new Map(), loops = new Map(), stack = [];
    macro.Commands.forEach((command, index) => {
        if (!SUPPORTED.has(command.Command)) throw new Error(`桌面批处理不支持第 ${index + 1} 条命令，请导出后使用 UI.Vision / Unsupported command; export to UI.Vision`);
        if (command.Command === 'open' && !/^https?:\/\//i.test(command.Target)) throw new Error('只允许 HTTP(S) 站点 / HTTP(S) sites only');
        if (command.Command === 'label') {
            if (labels.has(command.Target)) throw new Error('重复标签 / Duplicate label');
            labels.set(command.Target, index);
        }
        if (command.Command === 'while_v2') stack.push(index);
        if (command.Command === 'endWhile') {
            const start = stack.pop();
            if (start === undefined) throw new Error('循环不匹配 / Unmatched loop');
            loops.set(start, index); loops.set(index, start);
        }
    });
    if (stack.length) throw new Error('循环不匹配 / Unmatched loop');
    for (const command of macro.Commands) {
        const label = command.Command === 'gotoLabel' ? command.Target : command.Command === 'gotoIf_v2' ? command.Value : null;
        if (label !== null && !labels.has(label)) throw new Error('跳转标签不存在 / Missing label');
    }
    return { labels, loops };
}

// Generated commands use both bare ${variable} and quoted '${variable}'. Replace
// only known macro variables; leave JavaScript's own template literals intact.
function substitute(source, variables, javascript = false) {
    return String(source || '').replace(/(['"])\$\{([^{}]+)\}\1|\$\{([^{}]+)\}/g, (match, quote, quoted, bare) => {
        const name = quoted || bare;
        if (!Object.hasOwn(variables, name)) return match;
        const value = variables[name] ?? '';
        return javascript ? JSON.stringify(value) : String(value);
    });
}

async function runMacro(macro, page, { wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    const { labels, loops } = prepareMacro(macro);
    const variables = Object.create(null);
    const wc = page.webContents;
    async function execute(source) {
        if (wc.isDestroyed()) throw new Error('运行标签已关闭 / Run tab closed');
        return new Promise((resolve, reject) => {
            const finish = (error, result) => {
                clearTimeout(timer); wc.removeListener('destroyed', closed);
                error ? reject(error) : resolve(result);
            };
            const closed = () => finish(new Error('运行标签已关闭 / Run tab closed'));
            const timer = setTimeout(() => finish(new Error('命令执行超时 / Command timed out')), Math.max(1, Number(variables['!TIMEOUT_WAIT']) || 900) * 1000);
            wc.once('destroyed', closed);
            wc.executeJavaScript(`(async function(){\n${source}\n}).call(window)`, true).then(result => finish(null, result), finish);
        });
    }
    for (let index = 0; index < macro.Commands.length; index++) {
        if (wc.isDestroyed()) return;
        const command = macro.Commands[index];
        const target = substitute(command.Target, variables, command.Command === 'executeScript' || command.Command === 'gotoIf_v2' || command.Command === 'while_v2');
        switch (command.Command) {
        case 'store': variables[command.Value] = target; break;
        case 'open': {
            // Enterprise SPAs can keep network requests alive indefinitely. Wait
            // for DOM readiness, with the macro's bounded page-load timeout.
            await new Promise((resolve, reject) => {
                const finish = error => {
                    clearTimeout(timer); wc.removeListener('dom-ready', ready); wc.removeListener('destroyed', closed);
                    error ? reject(error) : resolve();
                };
                const ready = () => finish();
                const closed = () => finish(new Error('运行标签已关闭 / Run tab closed'));
                const timer = setTimeout(() => finish(), Math.max(1, Number(variables['!TIMEOUT_PAGELOAD']) || 25) * 1000);
                wc.once('dom-ready', ready); wc.once('destroyed', closed);
                wc.loadURL(target).catch(error => {
                    if (error.code !== 'ERR_ABORTED') finish(variables['!ERRORIGNORE'] === 'true' ? null : error);
                });
            });
            break;
        }
        case 'pause': {
            let remaining = Math.max(0, Math.min(Number(target) || 0, 86400000));
            while (remaining > 0 && !wc.isDestroyed()) { const step = Math.min(remaining, 250); await wait(step); remaining -= step; }
            break;
        }
        case 'executeScript': {
            const result = await execute(target);
            if (command.Value) variables[command.Value] = result ?? '';
            break;
        }
        case 'gotoIf_v2': if (await execute(`return Boolean(${target});`)) index = labels.get(command.Value); break;
        case 'gotoLabel': index = labels.get(command.Target); break;
        case 'while_v2': if (!(await execute(`return Boolean(${target});`))) index = loops.get(index); break;
        case 'endWhile': index = loops.get(index) - 1; break;
        // Progress is rendered by the generated executeScript commands. Avoid
        // echoing results here: site responses can contain credentials.
        case 'echo': case 'label': break;
        }
    }
}

function createUivBatchRunner({ openPage, onError }) {
    let active = null;
    return {
        async start(macro) {
            prepareMacro(macro);
            if (active) throw new Error('已有批脚本正在运行，请先停止或关闭运行标签 / A batch is already running');
            const job = {};
            active = job;
            try {
                const page = await openPage({ name: macro.Name || 'UIVF12', url: 'about:blank' });
                page.webContents.once('destroyed', () => { if (active === job) active = null; });
                job.done = runMacro(macro, page).catch(() => {
                    // Do not surface raw page errors: they may contain tokens.
                    if (!page.webContents.isDestroyed()) onError(page);
                }).finally(() => { if (active === job) active = null; });
                return { mode: 'desktop-native', success: true };
            } catch (error) { if (active === job) active = null; throw error; }
        }
    };
}

module.exports = { prepareMacro, substitute, runMacro, createUivBatchRunner };
