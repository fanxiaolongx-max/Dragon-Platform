const { PNG } = require('pngjs');
const { bitmap, decodeImage, encodePng, resizeImage } = require('./platform-logo-image');

function place(target, source, left, top) {
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const dx = x + left, dy = y + top;
        if (dx < 0 || dy < 0 || dx >= target.width || dy >= target.height) continue;
        const from = (y * source.width + x) * 4, to = (dy * target.width + dx) * 4;
        const a = source.data[from + 3] / 255;
        for (let c = 0; c < 3; c++) target.data[to + c] = Math.round(source.data[from + c] * a + target.data[to + c] * (1 - a));
        target.data[to + 3] = 255;
    }
    return target;
}

function promo(logo, width, height) {
    const output = bitmap(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        const glow = Math.exp(-((x / width - 0.5) ** 2 * 9 + (y / height - 0.48) ** 2 * 6));
        const ring = Math.abs(Math.hypot((x - width / 2), (y - height / 2)) - height * 0.36) < 1 ? 13 : 0;
        output.data.set([Math.round(9 + glow * 10 + ring), Math.round(19 + glow * 30 + ring), Math.round(39 + glow * 51 + ring), 255], p);
    }
    const size = Math.round(height * 0.62), fitted = resizeImage(logo, size);
    return PNG.sync.write(place(output, fitted, Math.round((width - size) / 2), Math.round((height - size) / 2)), { colorType: 2 });
}

function screenshot(bytes) {
    const source = decodeImage(bytes);
    const width = Math.max(1, Math.min(source.width, Math.round(source.height * 1.6)));
    const height = Math.max(1, Math.min(source.height, Math.round(source.width / 1.6)));
    const cropped = bitmap(width, height), left = Math.floor((source.width - width) / 2), top = Math.floor((source.height - height) / 2);
    for (let y = 0; y < height; y++) source.data.copy(cropped.data, y * width * 4, ((y + top) * source.width + left) * 4, ((y + top) * source.width + left + width) * 4);
    const fitted = resizeImage(cropped, 1280, 800);
    // Fill the full canvas without stretching; flatten any alpha onto white.
    const output = bitmap(1280, 800, Buffer.alloc(1280 * 800 * 4, 255));
    return PNG.sync.write(place(output, fitted, Math.round((1280 - fitted.width) / 2), Math.round((800 - fitted.height) / 2)), { colorType: 2 });
}

function generateStoreAssets(logoBytes, screenshots = []) {
    if (screenshots.length > 5) throw new Error('最多选择 5 张截图 / Select up to 5 screenshots');
    const logo = decodeImage(logoBytes), icon = bitmap(128, 128), fitted = resizeImage(logo, 96);
    for (let y = 0; y < 96; y++) fitted.data.copy(icon.data, ((y + 16) * 128 + 16) * 4, y * 96 * 4, (y + 1) * 96 * 4);
    const assets = {
        'store-assets/store-icon-128x128.png': encodePng(icon),
        'store-assets/small-promo-440x280.png': promo(logo, 440, 280),
        'store-assets/marquee-1400x560.png': promo(logo, 1400, 560)
    };
    if (!screenshots || screenshots.length === 0) {
        assets['store-assets/screenshot-01-1280x800.png'] = promo(logo, 1280, 800);
    } else {
        screenshots.forEach((bytes, index) => { assets[`store-assets/screenshot-${String(index + 1).padStart(2, '0')}-1280x800.png`] = screenshot(bytes); });
    }
    return assets;
}

module.exports = { generateStoreAssets };
