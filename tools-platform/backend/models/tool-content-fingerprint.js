'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = '.tool-manifest.json';
function stableJson(value) {
    if (Array.isArray(value)) return value.map(stableJson);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
}

function canonicalContent(relativePath, content) {
    if (relativePath === MANIFEST_NAME) {
        const manifest = JSON.parse(content.toString('utf8'));
        delete manifest.builtIn;
        delete manifest.system;
        delete manifest.market;
        delete manifest.history;
        if (manifest.tool && typeof manifest.tool === 'object') {
            const tool = { ...manifest.tool };
            delete tool.publicAccess;
            delete tool.updatedAt;
            delete tool.createdAt;
            delete tool.nameEn;
            delete tool.descriptionEn;
            if (!Array.isArray(tool.tags) || tool.tags.length === 0) delete tool.tags;
            if (!tool.href || tool.href === `/tools/${tool.slug}`) delete tool.href;
            if (!tool.filePath || tool.filePath === `/custom-tools/${tool.slug}/index.html`) delete tool.filePath;
            manifest.tool = tool;
        }
        return Buffer.from(JSON.stringify(stableJson(manifest)), 'utf8');
    }
    if (content.includes(0)) return content;
    try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
        return Buffer.from(decoded.replace(/\r\n?/g, '\n'), 'utf8');
    } catch (_) {
        return content;
    }
}

function fingerprintFiles(rootDir, files) {
    const hash = crypto.createHash('sha256');
    const resolvedRoot = path.resolve(rootDir);
    for (const relativePath of [...files].sort()) {
        const absolutePath = path.resolve(rootDir, relativePath);
        if (!absolutePath.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Unsafe tool path: ${relativePath}`);
        hash.update(relativePath);
        hash.update('\0');
        hash.update(canonicalContent(relativePath, fs.readFileSync(absolutePath)));
        hash.update('\0');
    }
    return hash.digest('hex');
}

module.exports = { canonicalContent, fingerprintFiles };
