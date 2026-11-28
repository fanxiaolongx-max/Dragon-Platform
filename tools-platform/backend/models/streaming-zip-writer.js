const fs = require('fs');
const zlib = require('zlib');

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function updateCrc32(chunk, seed = 0) {
    if (typeof zlib.crc32 === 'function') {
        return zlib.crc32(chunk, seed) >>> 0;
    }
    let crc = (seed ^ 0xffffffff) >>> 0;
    for (let i = 0; i < chunk.length; i += 1) {
        crc = CRC32_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(dateInput) {
    const date = dateInput instanceof Date && Number.isFinite(dateInput.getTime())
        ? dateInput
        : new Date();
    const year = Math.min(2107, Math.max(1980, date.getFullYear()));
    const dosTime = ((date.getHours() & 0x1f) << 11)
        | ((date.getMinutes() & 0x3f) << 5)
        | ((date.getSeconds() >> 1) & 0x1f);
    const dosDate = (((year - 1980) & 0x7f) << 9)
        | (((date.getMonth() + 1) & 0x0f) << 5)
        | (date.getDate() & 0x1f);
    return { dosTime, dosDate };
}

function writeBuffer(stream, buffer) {
    if (!buffer.length) return Promise.resolve();
    if (stream.write(buffer)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const onDrain = () => {
            stream.removeListener('error', onError);
            resolve();
        };
        const onError = err => {
            stream.removeListener('drain', onDrain);
            reject(err);
        };
        stream.once('drain', onDrain);
        stream.once('error', onError);
    });
}

function buildZip64Extra({ uncompressedSize, compressedSize, localHeaderOffset, needUncomp, needComp, needOffset }) {
    const fields = [];
    if (needUncomp) fields.push(BigInt(uncompressedSize));
    if (needComp) fields.push(BigInt(compressedSize));
    if (needOffset) fields.push(BigInt(localHeaderOffset));
    if (!fields.length) return Buffer.alloc(0);
    const buf = Buffer.alloc(4 + fields.length * 8);
    buf.writeUInt16LE(0x0001, 0);
    buf.writeUInt16LE(fields.length * 8, 2);
    fields.forEach((value, idx) => buf.writeBigUInt64LE(value, 4 + idx * 8));
    return buf;
}

/**
 * Sequential streaming ZIP writer.
 * Reads and compresses one file at a time directly to disk so large archives
 * use constant memory and at most 2 file descriptors regardless of total size.
 */
async function writeStreamingZip(outputPath, entries, options = {}) {
    const level = Number.isInteger(options.level) ? options.level : 6;
    const out = fs.createWriteStream(outputPath);
    let streamError = null;
    out.on('error', err => { streamError = err; });

    let offset = 0;
    const centralEntries = [];

    const emit = async buffer => {
        if (streamError) throw streamError;
        await writeBuffer(out, buffer);
        offset += buffer.length;
    };

    try {
        for (const entry of entries) {
            const nameBuf = Buffer.from(String(entry.zipPath), 'utf8');
            const { dosTime, dosDate } = toDosDateTime(entry.mtime);
            const localHeaderOffset = offset;

            if (entry.buffer !== undefined) {
                const raw = Buffer.isBuffer(entry.buffer) ? entry.buffer : Buffer.from(entry.buffer);
                const uncompressedSize = raw.length;
                const crc = updateCrc32(raw, 0);
                const useDeflate = uncompressedSize > 0;
                const compressed = useDeflate ? zlib.deflateRawSync(raw, { level }) : raw;
                const compressedSize = compressed.length;
                const isZip64Sizes = uncompressedSize >= 0xffffffff || compressedSize >= 0xffffffff;
                const extra = buildZip64Extra({
                    uncompressedSize,
                    compressedSize,
                    localHeaderOffset: 0,
                    needUncomp: isZip64Sizes,
                    needComp: isZip64Sizes,
                    needOffset: false
                });
                const header = Buffer.alloc(30);
                header.writeUInt32LE(0x04034b50, 0);
                header.writeUInt16LE(isZip64Sizes ? 45 : 20, 4);
                header.writeUInt16LE(0x0800, 6); // UTF-8
                header.writeUInt16LE(useDeflate ? 8 : 0, 8);
                header.writeUInt16LE(dosTime, 10);
                header.writeUInt16LE(dosDate, 12);
                header.writeUInt32LE(crc >>> 0, 14);
                header.writeUInt32LE(isZip64Sizes ? 0xffffffff : compressedSize, 18);
                header.writeUInt32LE(isZip64Sizes ? 0xffffffff : uncompressedSize, 22);
                header.writeUInt16LE(nameBuf.length, 26);
                header.writeUInt16LE(extra.length, 28);
                await emit(header);
                await emit(nameBuf);
                if (extra.length) await emit(extra);
                if (compressed.length) await emit(compressed);

                centralEntries.push({
                    nameBuf,
                    dosTime,
                    dosDate,
                    flags: 0x0800,
                    method: useDeflate ? 8 : 0,
                    crc,
                    compressedSize,
                    uncompressedSize,
                    localHeaderOffset
                });
                continue;
            }

            const stat = fs.statSync(entry.absPath);
            if (stat.size === 0) {
                const header = Buffer.alloc(30);
                header.writeUInt32LE(0x04034b50, 0);
                header.writeUInt16LE(20, 4);
                header.writeUInt16LE(0x0800, 6); // UTF-8, STORE, no data descriptor
                header.writeUInt16LE(0, 8);
                header.writeUInt16LE(dosTime, 10);
                header.writeUInt16LE(dosDate, 12);
                header.writeUInt32LE(0, 14);
                header.writeUInt32LE(0, 18);
                header.writeUInt32LE(0, 22);
                header.writeUInt16LE(nameBuf.length, 26);
                header.writeUInt16LE(0, 28);
                await emit(header);
                await emit(nameBuf);

                centralEntries.push({
                    nameBuf,
                    dosTime,
                    dosDate,
                    flags: 0x0800,
                    method: 0,
                    crc: 0,
                    compressedSize: 0,
                    uncompressedSize: 0,
                    localHeaderOffset
                });
                continue;
            }

            // Stream file -> DEFLATE with data descriptor so memory stays bounded.
            const zip64Descriptor = stat.size >= 0xffffff00;
            const header = Buffer.alloc(30);
            header.writeUInt32LE(0x04034b50, 0);
            header.writeUInt16LE(zip64Descriptor ? 45 : 20, 4);
            header.writeUInt16LE(0x0808, 6); // UTF-8 + data descriptor
            header.writeUInt16LE(8, 8); // DEFLATE
            header.writeUInt16LE(dosTime, 10);
            header.writeUInt16LE(dosDate, 12);
            header.writeUInt32LE(0, 14);
            header.writeUInt32LE(0, 18);
            header.writeUInt32LE(0, 22);
            header.writeUInt16LE(nameBuf.length, 26);
            header.writeUInt16LE(0, 28);
            await emit(header);
            await emit(nameBuf);

            let crc = 0;
            let uncompressedSize = 0;
            let compressedSize = 0;

            await new Promise((resolve, reject) => {
                const readStream = fs.createReadStream(entry.absPath);
                const deflater = zlib.createDeflateRaw({ level });
                let settled = false;
                const fail = err => {
                    if (settled) return;
                    settled = true;
                    readStream.destroy();
                    deflater.destroy();
                    reject(err);
                };

                readStream.on('data', chunk => {
                    crc = updateCrc32(chunk, crc);
                    uncompressedSize += chunk.length;
                });
                readStream.on('error', fail);
                deflater.on('error', fail);

                deflater.on('data', chunk => {
                    if (streamError) {
                        fail(streamError);
                        return;
                    }
                    compressedSize += chunk.length;
                    offset += chunk.length;
                    if (!out.write(chunk)) {
                        deflater.pause();
                        out.once('drain', () => {
                            if (!settled) deflater.resume();
                        });
                    }
                });
                deflater.on('end', () => {
                    if (settled) return;
                    if (streamError) return fail(streamError);
                    settled = true;
                    resolve();
                });

                readStream.pipe(deflater);
            });

            if (zip64Descriptor || compressedSize >= 0xffffffff || uncompressedSize >= 0xffffffff) {
                const desc = Buffer.alloc(24);
                desc.writeUInt32LE(0x08074b50, 0);
                desc.writeUInt32LE(crc >>> 0, 4);
                desc.writeBigUInt64LE(BigInt(compressedSize), 8);
                desc.writeBigUInt64LE(BigInt(uncompressedSize), 16);
                await emit(desc);
            } else {
                const desc = Buffer.alloc(16);
                desc.writeUInt32LE(0x08074b50, 0);
                desc.writeUInt32LE(crc >>> 0, 4);
                desc.writeUInt32LE(compressedSize >>> 0, 8);
                desc.writeUInt32LE(uncompressedSize >>> 0, 12);
                await emit(desc);
            }

            centralEntries.push({
                nameBuf,
                dosTime,
                dosDate,
                flags: 0x0808,
                method: 8,
                crc,
                compressedSize,
                uncompressedSize,
                localHeaderOffset
            });
        }

        const centralDirOffset = offset;
        for (const item of centralEntries) {
            const needUncomp = item.uncompressedSize >= 0xffffffff;
            const needComp = item.compressedSize >= 0xffffffff;
            const needOffset = item.localHeaderOffset >= 0xffffffff;
            const needsZip64 = needUncomp || needComp || needOffset;
            const extra = buildZip64Extra({
                uncompressedSize: item.uncompressedSize,
                compressedSize: item.compressedSize,
                localHeaderOffset: item.localHeaderOffset,
                needUncomp,
                needComp,
                needOffset
            });
            const cd = Buffer.alloc(46);
            cd.writeUInt32LE(0x02014b50, 0);
            cd.writeUInt16LE(needsZip64 ? 45 : 20, 4);
            cd.writeUInt16LE(needsZip64 ? 45 : 20, 6);
            cd.writeUInt16LE(item.flags, 8);
            cd.writeUInt16LE(item.method, 10);
            cd.writeUInt16LE(item.dosTime, 12);
            cd.writeUInt16LE(item.dosDate, 14);
            cd.writeUInt32LE(item.crc >>> 0, 16);
            cd.writeUInt32LE(needComp ? 0xffffffff : (item.compressedSize >>> 0), 20);
            cd.writeUInt32LE(needUncomp ? 0xffffffff : (item.uncompressedSize >>> 0), 24);
            cd.writeUInt16LE(item.nameBuf.length, 28);
            cd.writeUInt16LE(extra.length, 30);
            cd.writeUInt16LE(0, 32);
            cd.writeUInt16LE(0, 34);
            cd.writeUInt16LE(0, 36);
            cd.writeUInt32LE(0, 38);
            cd.writeUInt32LE(needOffset ? 0xffffffff : (item.localHeaderOffset >>> 0), 42);
            await emit(cd);
            await emit(item.nameBuf);
            if (extra.length) await emit(extra);
        }
        const centralDirSize = offset - centralDirOffset;
        const entryCount = centralEntries.length;
        const needsZip64Eocd = entryCount >= 0xffff || centralDirSize >= 0xffffffff || centralDirOffset >= 0xffffffff;

        if (needsZip64Eocd) {
            const zip64EocdOffset = offset;
            const zip64Eocd = Buffer.alloc(56);
            zip64Eocd.writeUInt32LE(0x06064b50, 0);
            zip64Eocd.writeBigUInt64LE(44n, 4);
            zip64Eocd.writeUInt16LE(45, 12);
            zip64Eocd.writeUInt16LE(45, 14);
            zip64Eocd.writeUInt32LE(0, 16);
            zip64Eocd.writeUInt32LE(0, 20);
            zip64Eocd.writeBigUInt64LE(BigInt(entryCount), 24);
            zip64Eocd.writeBigUInt64LE(BigInt(entryCount), 32);
            zip64Eocd.writeBigUInt64LE(BigInt(centralDirSize), 40);
            zip64Eocd.writeBigUInt64LE(BigInt(centralDirOffset), 48);
            await emit(zip64Eocd);

            const locator = Buffer.alloc(20);
            locator.writeUInt32LE(0x07064b50, 0);
            locator.writeUInt32LE(0, 4);
            locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
            locator.writeUInt32LE(1, 16);
            await emit(locator);
        }

        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(0, 4);
        eocd.writeUInt16LE(0, 6);
        eocd.writeUInt16LE(Math.min(0xffff, entryCount), 8);
        eocd.writeUInt16LE(Math.min(0xffff, entryCount), 10);
        eocd.writeUInt32LE(Math.min(0xffffffff, centralDirSize) >>> 0, 12);
        eocd.writeUInt32LE(Math.min(0xffffffff, centralDirOffset) >>> 0, 16);
        eocd.writeUInt16LE(0, 20);
        await emit(eocd);

        await new Promise((resolve, reject) => {
            if (streamError) return reject(streamError);
            out.once('finish', resolve);
            out.once('error', reject);
            out.end();
        });
    } catch (err) {
        out.destroy();
        throw err;
    }
}

module.exports = { writeStreamingZip, updateCrc32 };
