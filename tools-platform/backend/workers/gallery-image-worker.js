const { parentPort, workerData } = require('node:worker_threads');
const jpeg = require('jpeg-js');
const { decodeImage, resizeImage } = require('../models/platform-logo-image');
const { jpegOrientation, orient } = require('../models/gallery-image-orientation');
try {
    const bytes = Buffer.from(workerData);
    const image = orient(decodeImage(bytes), jpegOrientation(bytes));
    const scaled = (edge, quality) => {
        const ratio = Math.min(1, edge / Math.max(image.width, image.height));
        const result = resizeImage(image, Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
        // JPEG has no alpha. Composite transparent artwork on white, preserving its visible details.
        for (let i = 0; i < result.data.length; i += 4) {
            const a = result.data[i + 3] / 255;
            for (let c = 0; c < 3; c++) result.data[i + c] = Math.round(result.data[i + c] * a + 255 * (1 - a));
            result.data[i + 3] = 255;
        }
        return jpeg.encode(result, quality).data;
    };
    parentPort.postMessage({ ok: true, width: image.width, height: image.height,
        thumbnail: scaled(384, 72), preview: scaled(1600, 84), balanced: scaled(1024, 78), precise: scaled(1536, 88) });
} catch (_) { parentPort.postMessage({ ok: false }); }
