// Pure JavaScript codecs and pixel operations; runs in a worker, including in app.asar.
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const ICON_SIZES = [16, 32, 48, 64, 128, 256];
const MAX_PIXELS = 16 * 1024 * 1024;
const clamp = value => Math.max(0, Math.min(255, value));
const bitmap = (width, height, data = Buffer.alloc(width * height * 4)) => ({ width, height, data });

function decodeImage(bytes) {
    const input = Buffer.from(bytes);
    let image;
    if (input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        if (input.length < 24 || input.readUInt32BE(16) * input.readUInt32BE(20) > MAX_PIXELS) {
            throw new Error('Image exceeds 16 megapixels');
        }
        image = PNG.sync.read(input);
    } else if (input[0] === 255 && input[1] === 216) {
        image = jpeg.decode(input, { useTArray: true, maxResolutionInMP: 16, maxMemoryUsageInMB: 256 });
    } else {
        throw new Error('Unsupported image: upload PNG/JPEG, or use the page to convert WEBP');
    }
    if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) throw new Error('Invalid image dimensions');
    return bitmap(image.width, image.height, Buffer.from(image.data));
}

const encodePng = image => PNG.sync.write(image, { colorType: 6 });

function blurMask(mask, width, height, sigma) {
    const radius = Math.ceil(sigma * 3);
    const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)));
    const sum = kernel.reduce((total, weight) => total + weight, 0);
    const temp = new Float32Array(mask.length);
    const output = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let value = 0;
        for (let k = -radius; k <= radius; k++) value += mask[y * width + Math.max(0, Math.min(width - 1, x + k))] * kernel[k + radius];
        temp[y * width + x] = value / sum;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let value = 0;
        for (let k = -radius; k <= radius; k++) value += temp[Math.max(0, Math.min(height - 1, y + k)) * width + x] * kernel[k + radius];
        output[y * width + x] = Math.round(value / sum);
    }
    return output;
}

function removeWhiteBackground(image) {
    const { width, height, data } = image;
    // Already-transparent artwork must retain its alpha and enclosed white details.
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return bitmap(width, height, Buffer.from(data));
    const size = width * height;
    const visited = new Uint8Array(size);
    const nearWhite = new Uint8Array(size);
    const queue = new Uint32Array(size);
    let head = 0, tail = 0;
    for (let i = 0; i < size; i++) {
        const p = i * 4;
        const distance = (255 - data[p]) ** 2 + (255 - data[p + 1]) ** 2 + (255 - data[p + 2]) ** 2;
        nearWhite[i] = distance < 28 ** 2 ? (distance < 15 ** 2 ? 2 : 1) : 0;
    }
    const seed = index => {
        if (!visited[index] && nearWhite[index]) { visited[index] = 1; queue[tail++] = index; }
    };
    for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { seed(y * width); seed(y * width + width - 1); }
    // Preserve the original lower text-region counter treatment (e.g. P, O).
    for (let i = Math.floor(height * 0.65) * width; i < size; i++) if (nearWhite[i] === 2) seed(i);
    while (head < tail) {
        const i = queue[head++], x = i % width;
        if (x > 0) seed(i - 1);
        if (x < width - 1) seed(i + 1);
        if (i >= width) seed(i - width);
        if (i < size - width) seed(i + width);
    }
    const mask = Uint8Array.from(visited, value => value ? 0 : 255);
    const blurred = blurMask(mask, width, height, 0.8);
    const output = Buffer.alloc(data.length);
    for (let i = 0; i < size; i++) {
        const p = i * 4;
        const alpha = visited[i] && blurred[i] < 12.75 ? 0 : blurred[i];
        const safe = Math.max(alpha / 255, 0.05);
        for (let c = 0; c < 3; c++) output[p + c] = Math.floor(clamp((data[p + c] - (1 - safe) * 255) / safe));
        output[p + 3] = alpha;
    }
    return bitmap(width, height, output);
}

function lanczos(value) {
    value = Math.abs(value);
    if (value < 1e-8) return 1;
    if (value >= 3) return 0;
    return 3 * Math.sin(Math.PI * value) * Math.sin(Math.PI * value / 3) / (Math.PI * value) ** 2;
}

function resizeImage(image, width, height = width) {
    if (width === image.width && height === image.height) return bitmap(width, height, Buffer.from(image.data));
    const weights = (source, target) => Array.from({ length: target }, (_, dst) => {
        const scale = source / target, filterScale = Math.max(1, scale), center = (dst + 0.5) * scale - 0.5;
        const entries = [];
        let sum = 0;
        for (let index = Math.max(0, Math.ceil(center - 3 * filterScale)); index <= Math.min(source - 1, Math.floor(center + 3 * filterScale)); index++) {
            const weight = lanczos((index - center) / filterScale);
            entries.push([index, weight]); sum += weight;
        }
        return entries.map(([index, weight]) => [index, weight / sum]);
    });
    const horizontal = weights(image.width, width), vertical = weights(image.height, height);
    const temp = new Float32Array(width * image.height * 4);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4;
        for (const [sx, weight] of horizontal[x]) {
            const src = (y * image.width + sx) * 4, alpha = image.data[src + 3] / 255;
            for (let c = 0; c < 3; c++) temp[dst + c] += image.data[src + c] * alpha * weight;
            temp[dst + 3] += image.data[src + 3] * weight;
        }
    }
    const output = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4, values = [0, 0, 0, 0];
        for (const [sy, weight] of vertical[y]) for (let c = 0; c < 4; c++) values[c] += temp[(sy * width + x) * 4 + c] * weight;
        const alpha = clamp(values[3]);
        for (let c = 0; c < 3; c++) output[dst + c] = alpha > 0.5 ? Math.round(clamp(values[c] * 255 / alpha)) : 0;
        output[dst + 3] = Math.round(alpha);
    }
    return bitmap(width, height, output);
}

function composite(destination, source, left = 0, top = 0) {
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const dx = x + left, dy = y + top;
        if (dx < 0 || dy < 0 || dx >= destination.width || dy >= destination.height) continue;
        const src = (y * source.width + x) * 4, dst = (dy * destination.width + dx) * 4;
        const sa = source.data[src + 3] / 255, da = destination.data[dst + 3] / 255, alpha = sa + da * (1 - sa);
        for (let c = 0; c < 3; c++) destination.data[dst + c] = alpha ? Math.round((source.data[src + c] * sa + destination.data[dst + c] * da * (1 - sa)) / alpha) : 0;
        destination.data[dst + 3] = Math.round(alpha * 255);
    }
    return destination;
}

function darkEnhancement(image) {
    const { width, height, data } = image;
    const expanded = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let max = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const sx = Math.max(0, Math.min(width - 1, x + dx)), sy = Math.max(0, Math.min(height - 1, y + dy));
            max = Math.max(max, data[(sy * width + sx) * 4 + 3]);
        }
        expanded[y * width + x] = max;
    }
    const blurred = blurMask(expanded, width, height, 3);
    const glow = bitmap(width, height);
    for (let i = 0; i < blurred.length; i++) {
        glow.data.set([160, 210, 255, Math.floor(Math.min(120, blurred[i] * 0.35 * (1 - data[i * 4 + 3] / 255)))], i * 4);
    }
    return composite(glow, image);
}

function portableBadge(image) {
    // Draw at 2x for antialiased outlines without depending on a system font.
    const canvas = bitmap(512, 512);
    composite(canvas, resizeImage(image, 432), 24, 20);
    for (let y = 352; y <= 496; y++) for (let x = 352; x <= 496; x++) {
        const cx = Math.max(388, Math.min(460, x)), cy = Math.max(388, Math.min(460, y));
        if ((x - cx) ** 2 + (y - cy) ** 2 > 36 ** 2) continue;
        const innerX = Math.max(388, Math.min(460, x)), innerY = Math.max(388, Math.min(460, y));
        const inner = x >= 362 && x <= 486 && y >= 362 && y <= 486 && (x - innerX) ** 2 + (y - innerY) ** 2 <= 26 ** 2;
        canvas.data.set(inner ? [16, 185, 129, 255] : [255, 255, 255, 255], (y * 512 + x) * 4);
    }
    // Bold vector P, centered inside the badge.
    for (let y = 383; y < 461; y++) for (let x = 401; x < 449; x++) {
        const stem = x < 416;
        const bowl = y < 427 && (y < 397 || y >= 414 || x >= 435);
        if (stem || bowl) canvas.data.set([255, 255, 255, 255], (y * 512 + x) * 4);
    }
    return resizeImage(canvas, 256);
}

function encodeIco(image) {
    const frames = ICON_SIZES.map(size => encodePng(resizeImage(image, size)));
    const header = Buffer.alloc(6 + frames.length * 16);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
    let offset = header.length;
    frames.forEach((frame, index) => {
        const entry = 6 + index * 16, size = ICON_SIZES[index];
        header[entry] = size === 256 ? 0 : size; header[entry + 1] = header[entry];
        header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(frame.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
        offset += frame.length;
    });
    return Buffer.concat([header, ...frames]);
}

function decodeBmp(bytes) {
    bytes = Buffer.from(bytes);
    if (bytes.toString('ascii', 0, 2) !== 'BM' || bytes.readUInt32LE(30) !== 0) throw new Error('Invalid splash template');
    const width = bytes.readInt32LE(18), signedHeight = bytes.readInt32LE(22), height = Math.abs(signedHeight), bits = bytes.readUInt16LE(28);
    if (width !== 620 || height !== 340 || ![24, 32].includes(bits)) throw new Error('Invalid splash dimensions');
    const offset = bytes.readUInt32LE(10), stride = Math.ceil(width * bits / 32) * 4, image = bitmap(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const src = offset + (signedHeight > 0 ? height - y - 1 : y) * stride + x * bits / 8;
        image.data.set([bytes[src + 2], bytes[src + 1], bytes[src], 255], (y * width + x) * 4);
    }
    return image;
}

function encodeBmp(image) {
    const stride = Math.ceil(image.width * 3 / 4) * 4, output = Buffer.alloc(54 + stride * image.height);
    output.write('BM'); output.writeUInt32LE(output.length, 2); output.writeUInt32LE(54, 10); output.writeUInt32LE(40, 14);
    output.writeInt32LE(image.width, 18); output.writeInt32LE(image.height, 22); output.writeUInt16LE(1, 26); output.writeUInt16LE(24, 28);
    output.writeUInt32LE(stride * image.height, 34);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const src = (y * image.width + x) * 4, dst = 54 + (image.height - y - 1) * stride + x * 3;
        output[dst] = image.data[src + 2]; output[dst + 1] = image.data[src + 1]; output[dst + 2] = image.data[src];
    }
    return output;
}

// 与 frontend/pages/startup.html 的 .crest 保持一致：72px 徽章左上角 (45, 43)，内圈 well 半径 30，Logo 48px 居中。
const SPLASH_CREST = { cx: 81, cy: 79, wellRadius: 29, logo: 48 };

function portableSplash(image, template) {
    // Keep the existing localized typography and gradient ring; repaint only the inner well and logo.
    const splash = decodeBmp(template);
    const { cx, cy, wellRadius, logo } = SPLASH_CREST;
    for (let y = cy - wellRadius; y <= cy + wellRadius; y++) for (let x = cx - wellRadius; x <= cx + wellRadius; x++) {
        if (Math.hypot(x - cx, y - cy) > wellRadius) continue;
        // .well: radial-gradient(circle at 50% 30%, #15233d, #0a1222 72%)
        const t = Math.min(1, Math.hypot(x - cx, y - (cy - 12)) / 37);
        splash.data.set([Math.round(21 - 11 * t), Math.round(35 - 17 * t), Math.round(61 - 27 * t), 255], (y * splash.width + x) * 4);
    }
    return encodeBmp(composite(splash, resizeImage(image, logo), cx - logo / 2, cy - logo / 2));
}

function cropBottomTextRegion(image) {
    const { width, height, data } = image;
    const startY = Math.floor(height * 0.55);
    const counts = [];
    for (let y = startY; y < height; y++) {
        let count = 0;
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 25) count++;
        }
        counts.push({ y, count });
    }
    let textFound = false;
    let gapY = -1;
    let inBottomText = false;
    for (let i = counts.length - 1; i >= 0; i--) {
        const { y, count } = counts[i];
        if (!inBottomText) {
            if (count > width * 0.02) inBottomText = true;
        } else {
            if (count <= Math.max(2, Math.floor(width * 0.005))) {
                gapY = y;
                textFound = true;
                break;
            }
        }
    }
    if (textFound && gapY > startY) {
        const croppedHeight = gapY;
        const output = bitmap(width, croppedHeight, Buffer.alloc(width * croppedHeight * 4));
        data.copy(output.data, 0, 0, width * croppedHeight * 4);
        return output;
    }
    return image;
}

function generateLogoAssets(source, { removeBg = true, darkEnhance = true, cropBottomText = false, splashTemplate } = {}) {
    let input = decodeImage(source);
    if (Math.max(input.width, input.height) > 2048) {
        const scale = 2048 / Math.max(input.width, input.height);
        input = resizeImage(input, Math.max(1, Math.round(input.width * scale)), Math.max(1, Math.round(input.height * scale)));
    }
    let foreground = removeBg ? removeWhiteBackground(input) : input;
    if (cropBottomText) {
        foreground = cropBottomTextRegion(foreground);
    }
    const fit = 1024 / Math.max(foreground.width, foreground.height);
    const raw = composite(bitmap(1024, 1024), resizeImage(foreground,
        Math.max(1, Math.round(foreground.width * fit)), Math.max(1, Math.round(foreground.height * fit))),
        Math.floor((1024 - Math.round(foreground.width * fit)) / 2), Math.floor((1024 - Math.round(foreground.height * fit)) / 2));
    const master = darkEnhance ? darkEnhancement(raw) : raw;
    const windows = resizeImage(master, 256), portable = portableBadge(windows), ico = encodeIco(windows);
    return {
        'logo.png': encodePng(master), 'logo-raw.png': encodePng(raw), 'icon-mac.png': encodePng(master),
        'icon-windows.png': encodePng(windows), 'icon-windows.ico': ico,
        'icon-windows-portable.png': encodePng(portable), 'icon-windows-portable.ico': encodeIco(portable),
        'portable-splash.bmp': portableSplash(master, splashTemplate), 'icon.ico': ico, 'icon.png': encodePng(resizeImage(master, 32))
    };
}

module.exports = { bitmap, decodeImage, encodePng, resizeImage, removeWhiteBackground, darkEnhancement, cropBottomTextRegion, generateLogoAssets, decodeBmp, ICON_SIZES };
