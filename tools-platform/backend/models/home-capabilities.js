// 首页「插件与脚本」目录：把藏在各工具内部的小功能（F12 插件、Python 脚本、数据抓取浮窗脚本）汇总成统一条目。
// 每类由一个 provider 从各自的仓库实时读取，新增脚本/插件后首页入口自动出现；新增一类功能只需在 PROVIDERS 里追加一项。
// 单个 provider 出错只影响该类（返回空），不影响其它类和首页。
const f12PresetsRepository = require('./f12-script-presets-repository');
const pythonScriptRepository = require('./python-script-repository');
const uivScriptsRepository = require('./uiv-scripts-repository');
const bundledScripts = require('./bundled-scripts');

const F12_PACKER_HREF = '/tools/f12-to-extension';
const PYTHON_PACKER_HREF = '/tools/python-updater';
const DATA_CAPTURE_HREF = '/uivf12';
const DESCRIPTION_MAX = 160;

function clip(value, max = DESCRIPTION_MAX) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toIso(value) {
    if (!value) return '';
    const text = String(value);
    const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function loadF12BuiltinCatalog() {
    try {
        return require('../builtin-tools/f12-to-extension/builtin-catalog.js') || {};
    } catch {
        return {};
    }
}

// 与 frontend/js/uivf12/copy.js 的站点归类保持一致
function uivScriptOrigin(script) {
    const fromCode = code => (String(code || '').match(/URL:\s*(https?:\/\/[^\s]+)/) || [])[1] || (String(code || '').match(/fetch\("([^"]+)"/) || [])[1] || '';
    for (const candidate of [script.openUrl, script.url, fromCode(script.code), fromCode(script.consoleCode)]) {
        try {
            const parsed = new URL(candidate);
            if (['http:', 'https:'].includes(parsed.protocol)) return parsed.origin;
        } catch { /* 尝试下一个 */ }
    }
    return '';
}

function uivSiteName(origin, lang) {
    let host = '';
    try { host = new URL(origin).hostname.toLowerCase(); } catch { /* ignore */ }
    const en = lang === 'en-US';
    if (host === 'netcare.huawei.com') return en ? 'NetCare China' : 'NetCare 中国';
    if (host === 'netcare-ae.gts.huawei.com') return en ? 'NetCare Middle East' : 'NetCare 中东';
    if (host === 'netcare-de.gts.huawei.com') return en ? 'NetCare Germany' : 'NetCare 德国';
    if (host.includes('datafab')) return 'DataFab';
    return host;
}

const PROVIDERS = [
    {
        kind: 'f12',
        icon: '🧩',
        color: '#38bdf8',
        label: 'F12 浏览器插件',
        labelEn: 'F12 browser plugins',
        where: '「F12扩展打包」→ 选择脚本',
        whereEn: 'F12 Extension Packager → script picker',
        href: F12_PACKER_HREF,
        async list({ isAdmin }) {
            const items = Object.entries(loadF12BuiltinCatalog()).map(([id, preset]) => ({
                id: `f12:builtin:${id}`,
                name: preset.name || id,
                nameEn: preset.nameEn || preset.name || id,
                description: clip(preset.description),
                href: `${F12_PACKER_HREF}?script=${encodeURIComponent(id)}`,
                badge: preset.isFullExtension ? 'extension' : 'script',
                builtIn: true,
                builtInLocked: true, // 打包器源码自带，不能取消
                updatedAt: ''
            }));
            // 服务器脚本库只对管理员开放（与打包器接口权限一致）
            if (isAdmin) {
                await bundledScripts.ensureSeeded();
                const bundledIds = bundledScripts.bundledIds('f12');
                const presets = await f12PresetsRepository.listPresets();
                const builtinNames = new Set(items.map(item => item.name));
                presets.filter(preset => !builtinNames.has(preset.name)).forEach(preset => items.push({
                    id: `f12:server:${preset.id}`,
                    name: preset.name,
                    nameEn: preset.nameEn || preset.name,
                    description: clip(preset.description) || '服务器脚本库中的自定义 F12 脚本，可一键打包成浏览器插件',
                    href: `${F12_PACKER_HREF}?script=${encodeURIComponent(`server:${preset.id}`)}`,
                    badge: 'server',
                    promoteId: preset.id,
                    builtIn: bundledIds.has(preset.id),
                    updatedAt: toIso(preset.updatedAt || preset.updated_at)
                }));
            }
            return items;
        }
    },
    {
        kind: 'python',
        icon: '🐍',
        color: '#fbbf24',
        label: 'Python 脚本',
        labelEn: 'Python scripts',
        where: '「Python脚本更新器」→ 脚本列表',
        whereEn: 'Python Script Updater → script list',
        href: PYTHON_PACKER_HREF,
        async list() {
            await bundledScripts.ensureSeeded();
            const bundledIds = bundledScripts.bundledIds('python');
            const scripts = await pythonScriptRepository.listScripts();
            return scripts.map(script => ({
                id: `python:${script.id}`,
                name: script.name,
                nameEn: script.name,
                description: clip(script.description),
                href: `${PYTHON_PACKER_HREF}?script=${encodeURIComponent(script.id)}`,
                badge: script.current_version ? `v${script.current_version}` : '',
                promoteId: script.id,
                builtIn: script.id === pythonScriptRepository.DEFAULT_SCRIPT_ID || bundledIds.has(script.id),
                builtInLocked: script.id === pythonScriptRepository.DEFAULT_SCRIPT_ID, // 随 Python 打包器源码内置
                updatedAt: toIso(script.updated_at)
            }));
        }
    },
    {
        kind: 'float',
        icon: '🪟',
        color: '#a78bfa',
        label: '数据抓取浮窗脚本',
        labelEn: 'Data capture floating scripts',
        where: '「数据抓取」→ 左下角「📋 浮窗脚本」',
        whereEn: 'Data Capture → “📋 Floating scripts” at the bottom left',
        href: `${DATA_CAPTURE_HREF}?siteScripts=1`,
        async list({ lang }) {
            const { items } = await uivScriptsRepository.listScripts();
            const sites = new Map();
            (items || []).forEach(script => {
                const origin = uivScriptOrigin(script);
                if (!origin) return;
                if (!sites.has(origin)) sites.set(origin, []);
                sites.get(origin).push(script);
            });
            return [...sites.entries()].map(([origin, scripts]) => {
                const name = uivSiteName(origin, 'zh-CN');
                const nameEn = uivSiteName(origin, 'en-US');
                const sample = scripts.slice(0, 3).map(script => script.name).filter(Boolean).join('、');
                const latest = scripts.map(script => toIso(script.updatedAt)).filter(Boolean).sort().pop() || '';
                return {
                    id: `float:${origin}`,
                    name: `${name} 浮窗`,
                    nameEn: `${nameEn} floating panel`,
                    description: clip(lang === 'en-US'
                        ? `${scripts.length} capture scripts in one floating panel, e.g. ${sample}`
                        : `在 ${name} 页面打开浮窗，一键运行 ${scripts.length} 个抓取脚本，例如：${sample}`),
                    href: `${DATA_CAPTURE_HREF}?siteScripts=1`,
                    badge: String(scripts.length),
                    updatedAt: latest
                };
            }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        }
    }
];

async function listCapabilities({ isAdmin = false, lang = 'zh-CN' } = {}) {
    const groups = await Promise.all(PROVIDERS.map(async provider => {
        let items = [];
        try {
            items = await provider.list({ isAdmin, lang });
        } catch (error) {
            console.warn(`[home-capabilities] ${provider.kind} provider failed:`, error.message);
        }
        const { list, ...meta } = provider;
        return {
            ...meta,
            count: items.length,
            items: items.map(item => ({ ...item, kind: provider.kind, icon: provider.icon, color: provider.color }))
        };
    }));
    return { groups: groups.filter(group => group.count > 0), generatedAt: new Date().toISOString() };
}

module.exports = { listCapabilities, PROVIDERS };
