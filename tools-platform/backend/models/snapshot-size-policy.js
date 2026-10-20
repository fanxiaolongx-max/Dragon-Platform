'use strict';
const HEAVY_BYTES = 10 * 1024 * 1024;
const HEAVY_FILES = 100;
const MAX_GIT_FILE_BYTES = 45 * 1024 * 1024;
const PAYLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const sizeOf = value => Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value ?? ''), 'utf8');
function measure(output) {
    const htmlBytes = sizeOf(output.html);
    let totalBytes = htmlBytes, maxFileBytes = htmlBytes;
    for (const content of output.files?.values() || []) {
        const size = sizeOf(content);
        totalBytes += size;
        maxFileBytes = Math.max(maxFileBytes, size);
    }
    return classify({ htmlBytes, totalBytes, maxFileBytes, dataFilesCount: output.files?.size || 0, fileCount: 1 + (output.files?.size || 0) });
}
function classify(stats) {
    const isHeavy = stats.totalBytes >= HEAVY_BYTES || stats.fileCount >= HEAVY_FILES;
    return { ...stats, isHeavy, warningLevel: isHeavy ? 'danger' : stats.totalBytes >= 3 * 1024 * 1024 || stats.fileCount >= 30 ? 'warning' : 'normal' };
}
module.exports = { HEAVY_BYTES, HEAVY_FILES, MAX_GIT_FILE_BYTES, PAYLOAD_CHUNK_BYTES, measure, classify };
