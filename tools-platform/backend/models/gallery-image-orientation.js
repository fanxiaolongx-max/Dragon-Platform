// Honor phone JPEG orientation in derivatives without changing the uploaded original.
function jpegOrientation(bytes) {
    if (bytes[0] !== 255 || bytes[1] !== 216) return 1;
    try {
        let offset = 2;
        while (offset + 4 <= bytes.length && bytes[offset] === 255) {
            const marker = bytes[offset + 1];
            if (marker === 218 || marker === 217) break;
            const size = bytes.readUInt16BE(offset + 2), start = offset + 4, end = offset + 2 + size;
            if (size < 2 || end > bytes.length) break;
            if (marker === 225 && bytes.toString('ascii', start, start + 6) === 'Exif\0\0') {
                const base = start + 6, little = bytes.toString('ascii', base, base + 2) === 'II';
                if (!little && bytes.toString('ascii', base, base + 2) !== 'MM') return 1;
                const u16 = n => { if (n < base || n + 2 > end) throw new Error(); return little ? bytes.readUInt16LE(n) : bytes.readUInt16BE(n); };
                const u32 = n => { if (n < base || n + 4 > end) throw new Error(); return little ? bytes.readUInt32LE(n) : bytes.readUInt32BE(n); };
                if (u16(base + 2) !== 42) return 1;
                const directory = base + u32(base + 4), count = u16(directory);
                for (let i = 0; i < Math.min(count, 256); i++) {
                    const entry = directory + 2 + i * 12;
                    if (entry + 12 > end) return 1;
                    if (u16(entry) === 274 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {
                        const value = u16(entry + 8); return value >= 1 && value <= 8 ? value : 1;
                    }
                }
            }
            offset = end;
        }
    } catch (_) { /* Broken optional metadata must not prevent viewing a decodable image. */ }
    return 1;
}
function orient(image, orientation) {
    if (orientation < 2 || orientation > 8) return image;
    const { width: w, height: h } = image, width = orientation >= 5 ? h : w, height = orientation >= 5 ? w : h;
    const data = Buffer.alloc(image.data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let dx = x, dy = y;
        switch (orientation) {
            case 2: dx = w - 1 - x; break;
            case 3: dx = w - 1 - x; dy = h - 1 - y; break;
            case 4: dy = h - 1 - y; break;
            case 5: dx = y; dy = x; break;
            case 6: dx = h - 1 - y; dy = x; break;
            case 7: dx = h - 1 - y; dy = w - 1 - x; break;
            case 8: dx = y; dy = w - 1 - x; break;
        }
        const src = (y * w + x) * 4, dst = (dy * width + dx) * 4;
        for (let c = 0; c < 4; c++) data[dst + c] = image.data[src + c];
    }
    return { width, height, data };
}
module.exports = { jpegOrientation, orient };
