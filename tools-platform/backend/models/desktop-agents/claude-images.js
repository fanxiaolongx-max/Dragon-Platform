// Claude JSONL stores pasted images inline. Materialize raster bytes for the existing
// authenticated agent-files preview; never return Base64 or expose the history folder.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 8 * 1024 * 1024;
let directory;
async function materialize(source) {
    const extension = TYPES[source?.media_type];
    if (source?.type !== 'base64' || !extension || typeof source.data !== 'string') return null;
    const data = source.data;
    if (!data.length || data.length > Math.ceil(MAX_BYTES / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > MAX_BYTES) return null;
    const valid = extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : extension === 'jpg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : extension === 'webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        : /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6));
    if (!valid) return null;
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    directory ||= fs.mkdtemp(path.join(os.tmpdir(), 'dragon-claw-claude-images-')).catch(error => { directory = null; throw error; });
    const file = path.join(await directory, `${hash}.${extension}`);
    try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return file;
}
module.exports = { materialize };
