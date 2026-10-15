const path = require('node:path');
const { Worker } = require('node:worker_threads');

const activeTargets = new Set();

function runApplyWorker(options, onProgress) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, '../workers/builtin-tools-apply-worker.js'), { workerData: options });
        let settled = false;
        worker.on('message', event => {
            if (event.type === 'progress') onProgress(event);
            else {
                settled = true;
                if (event.type === 'result') resolve(event.data);
                else reject(Object.assign(new Error(event.error || '处理系统工具更新失败'), { status: event.status || 500 }));
            }
        });
        worker.once('error', error => { settled = true; reject(error); });
        worker.once('exit', code => {
            if (!settled) reject(new Error(`系统工具更新工作线程退出（${code}）`));
        });
        // Never terminate a running apply on an HTTP disconnect or arbitrary timeout:
        // it may be between the backup and atomic directory replacement.
    });
}

async function applyBuiltinToolsInWorker(options, { onProgress = () => {}, finalize = async result => result } = {}) {
    const target = path.resolve(options.targetDir);
    if (activeTargets.has(target)) {
        throw Object.assign(new Error('系统工具正在更新，请等待当前更新完成'), { status: 409 });
    }
    activeTargets.add(target);
    try {
        const result = await runApplyWorker(options, onProgress);
        // Keep the tenant's lock until its SQLite registry has also been reconciled.
        return await finalize(result);
    } finally {
        activeTargets.delete(target);
    }
}

module.exports = { applyBuiltinToolsInWorker };
