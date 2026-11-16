const fs = require('fs');

const layoutCache = new Map();

// Classify conservatively: a viewport declaration alone does not make a wide
// table usable on a phone. Tool authors can explicitly declare their intent.
function classifyToolMobileLayout(html) {
    const source = String(html || '');
    const meta = [...source.matchAll(/<meta\b[^>]*>/gi)].find(([tag]) => /\bname\s*=\s*["']tools-mobile-layout["']/i.test(tag));
    const explicit = meta && /\bcontent\s*=\s*["'](responsive|desktop)["']/i.exec(meta[0]);
    if (explicit) return explicit[1].toLowerCase();
    const css = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
    const mobileBreakpoints = /@media[^\{]*(?:max-width\s*:\s*(?:[3-7]\d\d)px|width\s*<=\s*(?:[3-7]\d\d)px)/i.test(css);
    const narrowContainer = /(?:main|\.container|\.app|\.wrapper)\s*\{[^}]*max-width\s*:\s*(?:[3-5]\d\d|600)px/i.test(css);
    // Strip scripts and comments before checking markup for wide data tables.
    const markupOnly = source
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    const wideTables = /<table\b/i.test(markupOnly);
    return (mobileBreakpoints || narrowContainer) && !wideTables ? 'responsive' : 'desktop';
}

function classifyToolMobileLayoutFile(filePath) {
    try {
        const stat = fs.statSync(filePath);
        const cached = layoutCache.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached.layout;
        }
        const layout = classifyToolMobileLayout(fs.readFileSync(filePath, 'utf8'));
        if (layoutCache.size > 500) layoutCache.clear();
        layoutCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, layout });
        return layout;
    } catch (_) {
        return 'desktop';
    }
}

module.exports = { classifyToolMobileLayout, classifyToolMobileLayoutFile };
