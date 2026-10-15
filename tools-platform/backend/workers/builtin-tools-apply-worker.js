const { parentPort, workerData } = require('node:worker_threads');
const { applyBuiltinToolDecisions } = require('../models/builtin-tools-sync');

let lastFileProgressAt = 0;
try {
    const result = applyBuiltinToolDecisions({
        ...workerData,
        onProgress(event) {
            // Large inventories should not flood the browser with per-file messages.
            const now = Date.now();
            if (event.stage === 'copying' && event.filesCompleted > 0
                && event.filesCompleted < event.filesTotal && now - lastFileProgressAt < 80) return;
            lastFileProgressAt = now;
            parentPort.postMessage({ type: 'progress', ...event });
        }
    });
    parentPort.postMessage({ type: 'result', data: result });
} catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message || String(error), status: error.status || 500 });
}
