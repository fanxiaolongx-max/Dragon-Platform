const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createCrashMonitor } = require('../desktop-crash-monitor');

function setup(logRoot) {
    const app = Object.assign(new EventEmitter(), { paths: {}, setPath(name, value) { this.paths[name] = value; }, getVersion: () => '1.2.3' });
    const proc = Object.assign(new EventEmitter(), { pid: 4242 });
    const reporter = { started: null, start(options) { this.started = options; } };
    const lines = [];
    const monitor = createCrashMonitor({ app, crashReporter: reporter, logRoot, proc, log: (...a) => lines.push(['log', a.join(' ')]), error: (...a) => lines.push(['error', a.join(' ')]) });
    monitor.start();
    return { app, proc, reporter, lines, monitor };
}

test('异常结束会在下次启动时报告，正常退出不会', () => {
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-monitor-'));
    const first = setup(logRoot);
    assert.equal(first.reporter.started.uploadToServer, false);
    assert.equal(first.app.paths.crashDumps, first.monitor.dumpDir);
    assert.equal(first.lines.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(first.monitor.markerPath, 'utf-8')).pid, 4242);

    // 进程直接消失：标记残留，转储目录多了一个文件
    fs.writeFileSync(path.join(first.monitor.dumpDir, 'a.dmp'), 'x');
    const second = setup(logRoot);
    assert.match(second.lines[0][1], /上次运行未正常退出（pid 4242，版本 1\.2\.3/);
    assert.match(second.lines[0][1], /新增崩溃转储 1 个/);

    second.app.emit('quit', {}, 0);
    second.proc.emit('exit', 0);
    assert.equal(fs.existsSync(second.monitor.markerPath), false);
    assert.equal(second.lines.filter(([, text]) => text.includes('未经正常退出流程')).length, 0);
    assert.equal(setup(logRoot).lines.length, 0);
});

test('绕过 app.quit 的退出和渲染进程崩溃都会留下记录', () => {
    const { app, proc, lines } = setup(fs.mkdtempSync(path.join(os.tmpdir(), 'crash-monitor-')));
    app.emit('render-process-gone', {}, { getURL: () => 'http://localhost:3030/' }, { reason: 'crashed', exitCode: -1073741819 });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'clean-exit' });
    proc.emit('unhandledRejection', new Error('boom'));
    proc.emit('exit', 0);
    assert.match(lines[0][1], /渲染进程结束 reason=crashed exitCode=-1073741819 url=http:\/\/localhost:3030\//);
    assert.match(lines[1][1], /Unhandled Rejection/);
    assert.match(lines[2][1], /进程未经正常退出流程结束 code=0/);
    assert.equal(lines.length, 3);
});

test('桌宠默认停用：不建宠物窗口，也不在加载时引入全局键盘钩子', () => {
    const manager = fs.readFileSync(path.join(__dirname, '../desktop-pet/pet-manager.js'), 'utf8');
    const hook = fs.readFileSync(path.join(__dirname, '../desktop-pet/pet-keyboard-hook.js'), 'utf8');
    assert.match(manager, /const PET_DISABLED = process\.env\.DRAGON_DESKTOP_PET !== '1';/);
    assert.match(manager, /function createPetWindow\(\) \{\n    if \(PET_DISABLED\) return null;/);
    assert.match(manager, /function isPetEnabled\(\) \{\n    if \(PET_DISABLED\) return false;/);
    assert.equal(/^(const|let|var) .*require\('uiohook-napi'\)/m.test(hook), false);
});
