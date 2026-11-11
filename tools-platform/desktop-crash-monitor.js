// 桌面端运行黑盒：主进程无日志消失时，下次启动能说清上次是怎么结束的。
// - running.json：启动时写入、正常退出时删除；启动时发现残留即说明上次是异常结束。
// - 原生崩溃转储保存在本地 logs/crash-dumps（不上传）。
// - 渲染进程 / 子进程崩溃、未处理的 Promise 拒绝、绕过 app.quit 的 process.exit 都写进日志。
const nodeFs = require('fs');
const path = require('path');

function createCrashMonitor({ app, crashReporter, logRoot, fs = nodeFs, proc = process, log = console.log, error = console.error }) {
    const markerPath = path.join(logRoot, 'running.json');
    const dumpDir = path.join(logRoot, 'crash-dumps');
    let cleanExit = false;

    function countDumps(sinceMs) {
        let count = 0;
        const stack = [dumpDir];
        while (stack.length) {
            const dir = stack.pop();
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { continue; }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) stack.push(full);
                else if (/\.dmp$/i.test(entry.name)) {
                    try { if (fs.statSync(full).mtimeMs >= sinceMs) count += 1; } catch (_error) { /* 已删除 */ }
                }
            }
        }
        return count;
    }

    function reportPreviousRun() {
        let previous = null;
        try { previous = JSON.parse(fs.readFileSync(markerPath, 'utf-8')); } catch (_error) { return; }
        let markerMtimeMs = Number.POSITIVE_INFINITY;
        try { markerMtimeMs = fs.statSync(markerPath).mtimeMs; } catch (_error) { /* 使用 marker 记录的启动时间 */ }
        const startedMs = Date.parse(previous.startedAt) || 0;
        // Linux 细粒度 Date.now() 可能超前内核文件系统粗粒度时间戳几个毫秒，取二者较早值避免漏计刚启动后写入的转储文件。
        const sinceMs = Math.min(startedMs, Number.isFinite(markerMtimeMs) ? markerMtimeMs : startedMs);
        const dumps = countDumps(sinceMs);
        error(`[Electron] 上次运行未正常退出（pid ${previous.pid}，版本 ${previous.version || '未知'}，启动于 ${previous.startedAt}）。`
            + '可能原因：原生崩溃、进程被外部结束（含命令行 taskkill）、系统关机或注销。'
            + `期间新增崩溃转储 ${dumps} 个，目录：${dumpDir}。上次日志的最后几行就是结束前在做的事。`);
    }

    function start() {
        try {
            fs.mkdirSync(dumpDir, { recursive: true });
            app.setPath('crashDumps', dumpDir);
            crashReporter.start({ uploadToServer: false, submitURL: '', productName: 'Dragon Claw' });
        } catch (err) {
            error('[Electron] 崩溃转储未能启用:', err.message || err);
        }
        reportPreviousRun();
        try {
            fs.writeFileSync(markerPath, JSON.stringify({ pid: proc.pid, version: app.getVersion(), startedAt: new Date().toISOString() }));
        } catch (_error) { /* 日志目录不可写时不影响启动 */ }

        proc.on('unhandledRejection', reason => error('[Electron] Unhandled Rejection:', reason));
        app.on('render-process-gone', (_event, contents, details = {}) => {
            let url = '';
            try { url = contents.getURL(); } catch (_error) { /* 已销毁 */ }
            error(`[Electron] 渲染进程结束 reason=${details.reason} exitCode=${details.exitCode} url=${url}`);
        });
        app.on('child-process-gone', (_event, details = {}) => {
            if (details.reason === 'clean-exit') return;
            error(`[Electron] 子进程结束 type=${details.type} name=${details.name || details.serviceName || ''} reason=${details.reason} exitCode=${details.exitCode}`);
        });
        app.on('quit', (_event, exitCode) => {
            cleanExit = true;
            try { fs.unlinkSync(markerPath); } catch (_error) { /* 已删除 */ }
            log(`[Electron] 正常退出 code=${exitCode}`);
        });
        // 后端里的 process.exit 会绕过 app.quit，窗口直接消失；这里留下退出码。
        proc.on('exit', code => { if (!cleanExit) error(`[Electron] 进程未经正常退出流程结束 code=${code}`); });
    }

    return { start, markerPath, dumpDir };
}

module.exports = { createCrashMonitor };
