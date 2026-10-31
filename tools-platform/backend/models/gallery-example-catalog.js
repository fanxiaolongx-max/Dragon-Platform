const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.join(__dirname,'../builtin-gallery');
const manifestPath = path.join(directory,'catalog.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validate(catalog) {
    if (catalog.version !== 1 || !Array.isArray(catalog.items) || !Array.isArray(catalog.albums)
        || !/^https:\/\/github\.com\/fanxiaolongx-max\/Dragon-Platform-Media\/releases\/download\/gallery-examples-[a-z0-9-]+$/.test(catalog.baseUrl)) throw Error('Invalid gallery example catalog');
    for (const [file,asset] of Object.entries(catalog.assets)) {
        if (!/^gallery-example-[a-f0-9]{16}\.(png|jpg|webp)$/.test(file) || !/^[a-f0-9]{16}\.jpg$/.test(asset.thumbnail)
            || !/^[a-f0-9]{64}$/.test(asset.sha256) || !/^[a-f0-9]{64}$/.test(asset.thumbnailSha256)
            || !Number.isInteger(asset.size) || asset.size<1 || asset.size>25*1024*1024
            || !['image/png','image/jpeg','image/webp'].includes(asset.mime) || !(asset.width>0 && asset.height>0)) throw Error('Invalid gallery example asset');
    }
    const ids = new Set();
    for (const item of catalog.items) {
        if (!/^sample-item-[0-9]+$/.test(item.id) || ids.has(item.id) || !item.title || !['work','life'].includes(item.scope)) throw Error('Invalid gallery example item');
        ids.add(item.id);
        if (item.albumId && !catalog.albums.some(album=>album.id===item.albumId)) throw Error('Invalid gallery example album');
        for (const version of item.versions) {
            if (!catalog.assets[version.file] || ids.has(version.id) || !/^sample-version-[a-f0-9]{16}$/.test(version.id)) throw Error('Invalid gallery example version');
            ids.add(version.id);
        }
    }
    return catalog;
}
let cached;
function read() { return cached ||= validate(JSON.parse(fs.readFileSync(manifestPath,'utf8'))); }
function asset(key) { const catalog=read(),meta=catalog.assets[key];if(!meta)throw Error('Unknown gallery example');return {...meta,url:`${catalog.baseUrl}/${key}`}; }
function thumbnail(key) {
    const meta=asset(key),bytes=fs.readFileSync(path.join(directory,'thumbnails',meta.thumbnail));
    if (digest(bytes)!==meta.thumbnailSha256) throw Error('Gallery thumbnail checksum mismatch');
    return bytes;
}
function checkManifest() {
    const catalog=read();for(const key of Object.keys(catalog.assets))thumbnail(key);
    return catalog;
}
module.exports = {read,validate,asset,thumbnail,checkManifest,digest,directory,manifestPath};
