const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./store');

let cachedPkgVersion = null;
function getPkgVersion() {
    if (!cachedPkgVersion) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
            cachedPkgVersion = pkg.version || '1.0.0';
        } catch (_) {
            cachedPkgVersion = '1.0.0';
        }
    }
    return cachedPkgVersion;
}

const TRANSLATIONS_DIR = path.join(__dirname, '../custom-tool-i18n');
const RUNTIME_FILE = path.join(__dirname, '../../frontend/js/shared/custom-tool-i18n-runtime.js');

function safeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function readTranslations(slug) {
    const candidates = [
        path.join(__dirname, '../builtin-tools', slug, '.i18n.json'),
        path.join(getDataDir(), 'custom-tools', slug, '.i18n.json'),
        path.join(TRANSLATIONS_DIR, `${slug}.json`)
    ];
    let result = {};
    for (const file of candidates) {
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                Object.assign(result, parsed);
            }
        } catch (_) {}
    }
    return result;
}

function formatLocalTimestamp(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildWatermark(slug, options = {}) {
    let mtime = options.mtime;
    if (!mtime && options.filePath && fs.existsSync(options.filePath)) {
        try {
            mtime = fs.statSync(options.filePath).mtime;
        } catch (_) {}
    }
    if (!mtime && slug) {
        try {
            const customToolsRepo = require('./custom-tools-repository');
            const rootDir = customToolsRepo.getToolRootDir(slug);
            if (rootDir) {
                const target = path.join(rootDir, 'index.html');
                if (fs.existsSync(target)) mtime = fs.statSync(target).mtime;
            }
        } catch (_) {}
    }
    if (!mtime && options.tool?.updatedAt) {
        mtime = new Date(options.tool.updatedAt);
    }
    const resolvedDate = mtime instanceof Date ? mtime : (mtime ? new Date(mtime) : new Date());
    const mtimeIso = !isNaN(resolvedDate.getTime()) ? resolvedDate.toISOString() : '';
    const timeStr = formatLocalTimestamp(resolvedDate);
    const ver = options.version || (options.tool && options.tool.version) || `v${getPkgVersion()}`;
    const toolSlug = slug || options.tool?.slug || 'custom-tool';

    return `<div id="__tools_html_meta_watermark__" class="tools-html-meta-watermark" aria-hidden="true" data-mtime-iso="${mtimeIso}" data-version="${ver}" data-slug="${toolSlug}" title="版本: ${ver} | 最近更新: ${timeStr} | 工具: ${toolSlug}"><span class="tools-watermark-ver">${ver}</span><span class="tools-watermark-sep">·</span><span class="tools-watermark-time">更新: ${timeStr}</span><span class="tools-watermark-sep">·</span><span class="tools-watermark-slug">${toolSlug}</span></div>
<style id="__tools_html_meta_watermark_style__">
.tools-html-meta-watermark {
  position: fixed;
  right: 12px;
  bottom: 3px;
  z-index: 2147483640;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", monospace;
  font-size: 10px;
  line-height: 1.2;
  color: rgba(100, 116, 139, 0.42);
  background: transparent;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.85);
  transition: opacity 0.2s ease;
}
@media (prefers-color-scheme: dark) {
  .tools-html-meta-watermark {
    color: rgba(148, 163, 184, 0.38);
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.7);
  }
}
[data-theme="dark"] .tools-html-meta-watermark,
.dark .tools-html-meta-watermark,
body.dark-theme .tools-html-meta-watermark {
  color: rgba(148, 163, 184, 0.38);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.7);
}
@media print {
  .tools-html-meta-watermark { display: none !important; }
}
@media (max-width: 560px) {
  .tools-html-meta-watermark .tools-watermark-slug,
  .tools-html-meta-watermark .tools-watermark-sep:last-of-type {
    display: none;
  }
}
</style>
<script id="__tools_html_meta_watermark_script__">
(function() {
  try {
    var el = document.getElementById('__tools_html_meta_watermark__');
    if (!el) return;
    if (window.self !== window.top) {
      el.style.right = '84px';
    }
    var iso = el.getAttribute('data-mtime-iso');
    if (iso) {
      var d = new Date(iso);
      if (!isNaN(d.getTime())) {
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var clientStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
                        pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        var timeSpan = el.querySelector('.tools-watermark-time');
        if (timeSpan) timeSpan.textContent = '更新: ' + clientStr;
        var ver = el.getAttribute('data-version') || '';
        var slug = el.getAttribute('data-slug') || '';
        el.title = '版本: ' + ver + ' | 最近更新: ' + clientStr + ' | 工具: ' + slug;
      }
    }
  } catch(_) {}
})();
</script>`;
}

function buildBootstrap(slug, options = {}) {
    const config = {
        slug,
        translations: readTranslations(slug),
        standalone: options.standalone === true
    };
    const configScript = `<script>window.__TOOLS_CUSTOM_I18N__=${safeJson(config)};<\/script>`;
    if (options.inlineRuntime) {
        const runtime = fs.readFileSync(RUNTIME_FILE, 'utf8').replace(/<\/script/gi, '<\\/script');
        return `${configScript}<script>${runtime}<\/script>`;
    }
    return `${configScript}<script src="/js/shared/custom-tool-i18n-runtime.js?v=20261003-01"><\/script>`;
}

function injectBeforeLastBody(html, injection) {
    const matches = [...html.matchAll(/<\/body\s*>/gi)];
    if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const idx = lastMatch.index;
        return html.slice(0, idx) + `${injection}\n` + html.slice(idx);
    }
    return `${html}\n${injection}`;
}

function injectLanguageRuntime(html, slug, options = {}) {
    let source = String(html || '');
    if (source.includes('__tools_html_meta_watermark__')) {
        source = source.replace(/<div id="__tools_html_meta_watermark__"[\s\S]*?<\/div>/gi, '');
        source = source.replace(/<style id="__tools_html_meta_watermark_style__"[\s\S]*?<\/style>/gi, '');
        source = source.replace(/<script id="__tools_html_meta_watermark_script__"[\s\S]*?<\/script>/gi, '');
    }
    const watermark = buildWatermark(slug, options);
    // 直接打开工具也有跨工具草稿提醒；下载的独立 HTML 不依赖平台服务。
    const inbox = options.standalone || /src=["']\/js\/shared\/ops-inbox\.js(?:[?"'])/.test(source) ? '' : '<script src="/js/shared/ops-inbox.js"></script>';

    if (source.includes('__TOOLS_CUSTOM_I18N__')) {
        return injectBeforeLastBody(source, `${watermark}\n${inbox}`);
    }

    const bootstrap = buildBootstrap(slug, options);
    const combined = `${bootstrap}\n${watermark}\n${inbox}`;
    return injectBeforeLastBody(source, combined);
}

module.exports = {
    TRANSLATIONS_DIR,
    readTranslations,
    formatLocalTimestamp,
    buildWatermark,
    injectLanguageRuntime
};
