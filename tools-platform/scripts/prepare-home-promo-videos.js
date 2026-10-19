const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'backend/home-promo-videos.json');
const CHUNK_SIZE = 512 * 1024;
const BASE_URL = 'https://github.com/fanxiaolongx-max/Dragon-Platform-Media/releases/download/home-videos-20261019';
const EOS_BASE_URL = 'https://github.com/fanxiaolongx-max/Dragon-Platform-Media/releases/download/eos-guide-20261019';
const EOS_EN_BASE_URL = 'https://github.com/fanxiaolongx-max/Dragon-Platform-Media/releases/download/eos-guide-en-20261019';
// Each later media release keeps its own tag; earlier files and cache identities stay untouched.
const RELEASE_URLS = {
    'eos-report-guide.mp4': EOS_BASE_URL, 'eos-report-guide-hd.mp4': EOS_BASE_URL,
    'eos-report-guide-en.mp4': EOS_EN_BASE_URL, 'eos-report-guide-en-hd.mp4': EOS_EN_BASE_URL
};
// Preserve the original release URLs and cache identities when adding EOS.
const FILES = ['netcare-rfc-ai-guide', 'operation-incentive-guide', 'platform-guide']
    .flatMap(base => ['', '-en'].flatMap(language => ['', '-hd'].map(quality => `${base}${language}${quality}.mp4`)))
    .concat(['eos-report-guide.mp4', 'eos-report-guide-hd.mp4', 'eos-report-guide-en.mp4', 'eos-report-guide-en-hd.mp4']);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function assertFastStart(bytes, name) {
    let offset = 0;
    while (offset + 8 <= bytes.length) {
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        let size = bytes.readUInt32BE(offset);
        if (size === 1 && offset + 16 <= bytes.length) size = Number(bytes.readBigUInt64BE(offset + 8));
        if (type === 'moov') return;
        if (type === 'mdat') throw new Error(`${name}: moov must precede mdat for progressive playback`);
        if (!Number.isSafeInteger(size) || size < 8) break;
        offset += size;
    }
    throw new Error(`${name}: missing MP4 metadata`);
}

function buildManifest() {
    const assets = {};
    for (const name of FILES) {
        const bytes = fs.readFileSync(path.join(projectRoot, 'frontend/assets/promotions', name));
        assertFastStart(bytes, name);
        const chunks = [];
        for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) chunks.push(digest(bytes.subarray(offset, offset + CHUNK_SIZE)));
        assets[name] = { size: bytes.length, sha256: digest(bytes), chunks };
        if (RELEASE_URLS[name]) assets[name].url = `${RELEASE_URLS[name]}/${name}`;
    }
    return { baseUrl: BASE_URL, chunkSize: CHUNK_SIZE, assets };
}

function checkManifest() {
    const expected = buildManifest();
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (JSON.stringify(expected) !== JSON.stringify(saved)) {
        throw new Error('Home video sources changed. Publish a new media release and regenerate its manifest before packaging.');
    }
    return expected;
}

if (require.main === module) {
    try {
        if (process.argv.includes('--write')) fs.writeFileSync(manifestPath, JSON.stringify(buildManifest(), null, 2) + '\n');
        else checkManifest();
        console.log(`Home promo videos verified: ${FILES.length} files, progressive MP4 metadata and SHA-256 chunks.`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { buildManifest, checkManifest, assertFastStart };
