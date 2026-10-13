const { parentPort, workerData } = require('node:worker_threads');
const { generateStoreAssets } = require('../models/platform-store-assets');
try {
    parentPort.postMessage({ assets: generateStoreAssets(workerData.logo, workerData.screenshots) });
} catch (error) {
    parentPort.postMessage({ error: error.message });
}
