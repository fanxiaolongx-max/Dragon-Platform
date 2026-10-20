const { parentPort, workerData } = require('node:worker_threads');
const builtinToolsSync = require('../models/builtin-tools-sync');

try {
    const preview = builtinToolsSync.previewBuiltinTools({
        ...workerData,
        onProgress: workerData?.trackProgress
            ? progress => parentPort.postMessage({ type: 'progress', ...progress })
            : undefined
    });
    parentPort.postMessage({ ok: true, preview });
} catch (error) {
    parentPort.postMessage({
        ok: false,
        error: error.message || String(error),
        status: error.status || 500
    });
}
