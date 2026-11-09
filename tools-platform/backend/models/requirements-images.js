const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function isImage(type, data) {
    if (type === 'image/png') return data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    if (type === 'image/jpeg') return data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    if (type === 'image/gif') return /^(GIF87a|GIF89a)$/.test(data.toString('ascii', 0, 6));
    return type === 'image/webp' && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
}

function parseImages(input, existing = []) {
    if (input === undefined) return existing;
    const invalid = () => Object.assign(new Error('最多上传 6 张图片，每张不超过 4 MB（PNG、JPG、WebP、GIF）'), { status: 400, code: 'REQUIREMENT_IMAGE_INVALID' });
    if (!Array.isArray(input) || input.length + existing.length > MAX_IMAGES) throw invalid();
    return [...existing, ...input.map(image => {
        if (typeof image?.data !== 'string' || image.data.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) throw invalid();
        const bytes = Buffer.from(image.data, 'base64');
        if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== image.data || !isImage(image.type, bytes)) throw invalid();
        return { name: String(image.name || 'image').slice(0, 120), type: image.type, data: image.data };
    })];
}

module.exports = { parseImages };
