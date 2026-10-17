const fs = require('fs');
const path = require('path');
const { injectGatekeeper } = require('./snapshot-gatekeeper');
const { safeJson } = require('./static-snapshot-data');

const SOURCE_DIR = path.join(__dirname, '../builtin-tools/f12-to-extension');
const JSZIP_FILE = path.join(__dirname, '../../frontend/js/shared/jszip.min.js');
const RUNTIME_FILE = path.join(__dirname, 'f12-static-packer-runtime.js');
const TEMPLATE_FILE = 'chrome-capture-pro.template.zip';
const PPO_TEMPLATE_FILE = 'ppo-traffic-autofill.template.zip';
const SALARY_TEMPLATE_FILE = 'overseas-salary-calculator.template.zip';
const BUILTINS = [
    { id: 'sv-cfc-monitor', file: 'default-f12.js', name: 'SV/CFC 满意度监控', description: '监控 SV/CFC 餐厅满意度，分析问卷明细并复核评分。', matches: 'https://w3.huawei.com/*', world: 'MAIN', includePopup: true },
    { id: 'exam-question-bank', file: 'exam-question-bank-assistant.js', name: '题库与答题助手', description: '抓取考试题目、维护本地题库并辅助自动答题。', matches: 'https://w3.huawei.com/*\nhttps://ilearning.huawei.com/*', world: 'ISOLATED', includePopup: true, manualLaunch: true },
    { id: 'authorized-media-exporter', file: 'authorized-media-exporter.js', name: '授权媒体下载脚本生成器', description: '扫描当前页面已直接暴露的视频地址，并生成可审阅的下载脚本。', matches: '<all_urls>', world: 'MAIN', includePopup: true, manualLaunch: true },
    { id: 'netcare-rfc-word', file: 'netcare-rfc-word.js', name: 'NetCare RFC 方案与 AI 审计', description: '批量下载 RFC 方案，提取章节与附件并执行 AI 审计；支持审计快照、Excel 和材料 ZIP 导出。', matches: 'https://netcare-ae.gts.huawei.com/p/netcare/index.html*\nhttps://netcare.huawei.com/p/netcare/index.html*\nhttps://netcare-de.gts.huawei.com/p/netcare/index.html*\nhttps://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*', world: 'MAIN', allFrames: true, includePopup: true, manualLaunch: true, runAt: 'document_idle' },
    { id: 'chrome-capture-pro', name: 'Chrome Capture Pro', description: '屏幕录制、截图与标注扩展模板。', matches: '<all_urls>', world: 'MAIN', includePopup: true, isFullExtension: true },
    { id: 'ppo-traffic-autofill', name: 'PPO 交通违章表单自动填表器', description: '在 PPO 交通违章网站辅助填写表单。', matches: '*://www.ppo.gov.eg/*\n*://ppo.gov.eg/*\n*://*.ppo.gov.eg/*', world: 'ISOLATED', includePopup: true, isFullExtension: true },
    { id: 'overseas-salary-calculator', name: '驻外薪资换汇计算器', description: '专为驻外员工打造的薪资换汇与盈亏核算工具，实时获取官方汇率，精准测算 USD → EGP → CNY 汇差得失。', matches: '<all_urls>', world: 'MAIN', includePopup: true, isFullExtension: true }
];

async function collect() {
    const saved = await require('./f12-script-presets-repository').listPresets();
    const builtins = BUILTINS.map(item => ({
        ...item,
        code: item.file ? (item.id === 'exam-question-bank' ? `globalThis.TPExamVault = (${require('../builtin-tools/f12-to-extension/exam-vault.js').toString()})();\n` : '') + fs.readFileSync(path.join(SOURCE_DIR, item.file), 'utf8') : ''
    })).map(({ file, ...item }) => item);
    return { builtins, saved };
}

function renderHtml(data, pages, options = {}) {
    const csp = pages
        ? "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'"
        : "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'";
    const scripts = pages
        ? '<script src="./data/assets/jszip.min.js"></script><script src="./data/assets/exam-vault.js"></script><script src="./data/assets/exam-store-guide.js"></script><script src="./data/assets/netcare-settings.js"></script><script src="./data/assets/netcare-language.js"></script><script src="./data/assets/netcare-artifacts.js"></script><script src="./data/assets/netcare-backup.js"></script><script src="./data/assets/netcare-renderer-source.js"></script><script src="./data/assets/packer-core.js"></script><script src="./data/assets/static-packer-runtime.js"></script>'
        : `<script>${fs.readFileSync(JSZIP_FILE, 'utf8')}</script><script>${fs.readFileSync(path.join(SOURCE_DIR, 'exam-vault.js'), 'utf8')}</script><script>${fs.readFileSync(path.join(SOURCE_DIR, 'exam-store-guide.js'), 'utf8')}</script><script>${fs.readFileSync(path.join(SOURCE_DIR, 'netcare-settings.js'), 'utf8')}</script><script>${fs.readFileSync(path.join(SOURCE_DIR, 'netcare-language.js'), 'utf8')}</script><script>${fs.readFileSync(path.join(SOURCE_DIR, 'netcare-artifacts.js'), 'utf8')}</script><script>${fs.readFileSync(path.join(SOURCE_DIR, 'netcare-backup.js'), 'utf8')}</script><script>${fs.readFileSync(path.join(SOURCE_DIR, 'netcare-renderer-source.js'), 'utf8')}</script><script>${fs.readFileSync(path.join(SOURCE_DIR, 'packer-core.js'), 'utf8')}</script><script>${fs.readFileSync(RUNTIME_FILE, 'utf8')}</script>`;
    const dataScript = pages
        ? `<script>window.TP_F12_DATA_URL='./data/f12-presets.json';window.TP_F12_TEMPLATE_URL='./data/${TEMPLATE_FILE}';window.TP_F12_PPO_TEMPLATE_URL='./data/${PPO_TEMPLATE_FILE}';window.TP_F12_SALARY_TEMPLATE_URL='./data/${SALARY_TEMPLATE_FILE}';</script>`
        : `<script>window.TP_F12_DATA=${safeJson(data)};</script>`;
    let html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>F12 扩展打包 · 静态版</title><style>
*{box-sizing:border-box}body{margin:0;background:#0e1729;color:#e5edf7;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1300px;margin:auto;padding:24px}header{padding:22px 26px;background:#183557;border:1px solid #345271;border-radius:15px}h1{font-size:23px;margin:0 0 6px}p{margin:0}.hint{color:#aec8df}.grid{display:grid;grid-template-columns:minmax(300px,1fr) minmax(360px,1.2fr);gap:20px;margin-top:20px}.panel{padding:20px;border:1px solid #304861;background:#17263a;border-radius:14px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wide{grid-column:1/-1}label{display:block;font-weight:600;font-size:13px}label>span{display:block;margin-bottom:5px}.check{display:flex;gap:8px;align-items:center;font-weight:400}input,textarea,select{width:100%;padding:9px 10px;background:#0d1b2e;color:#eef5ff;border:1px solid #48627d;border-radius:8px;font:inherit}textarea{resize:vertical}input[type=checkbox]{width:auto}button{padding:11px 18px;border:0;border-radius:9px;background:#367fd2;color:#fff;font:600 14px system-ui;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:hover:not(:disabled){background:#4995ed}.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}.status{white-space:pre-wrap;color:#b7cde2;min-height:22px}.status.error{color:#ffb3ae}.status.ok{color:#a8e9c2}.code{width:100%;min-height:420px;font:12px/1.5 ui-monospace,SFMono-Regular,monospace;tab-size:2}.small{font-size:12px;color:#aec8df}.badge{display:inline-block;background:#365071;color:#dceaff;padding:2px 7px;border-radius:5px;margin-left:8px}@media(max-width:900px){.grid{grid-template-columns:1fr}}@media(max-width:560px){main{padding:10px}.panel,header{padding:15px}.fields{grid-template-columns:1fr}.wide{grid-column:auto}}
</style></head><body><main><header><h1>F12 扩展打包 <span class="badge">静态版 / Static</span></h1><p class="hint">脚本已随快照发布。打包在当前浏览器完成；版本号需手动管理。此页面不签发 License，也不连接平台 API。</p></header><div class="grid"><section class="panel"><div class="fields"><label class="wide"><span>脚本 / Script</span><select id="preset"><option value="">新脚本 / New script</option></select></label><label><span>扩展名称 / Name</span><input id="name" maxlength="75"></label><label><span>版本 / Version</span><input id="version" value="1.0.0" placeholder="1.0.0"></label><label class="wide"><span>描述 / Description</span><input id="description" maxlength="132"></label><label class="wide"><span>匹配网址 / Match patterns（一行一个）</span><textarea id="matches" rows="3" placeholder="https://example.com/*"></textarea></label><label><span>注入环境 / World</span><select id="world"><option value="MAIN">MAIN</option><option value="ISOLATED">ISOLATED</option></select></label><label><span>运行时机 / Run at</span><select id="runAt"><option value="document_idle">document_idle</option><option value="document_start">document_start</option><option value="document_end">document_end</option></select></label><label><span>打包用途 / Package target</span><select id="target"><option value="store">Edge 商店 / Store</option><option value="local">本地安装 / Local</option></select></label><label><span>附加权限 / Optional permissions</span><select id="permissions" multiple size="5"><option value="downloads">downloads</option><option value="cookies">cookies</option><option value="clipboardWrite">clipboardWrite</option><option value="notifications">notifications</option><option value="tabs">tabs</option><option value="alarms">alarms</option></select></label><label class="check"><input id="popup" type="checkbox" checked>生成 Popup / Include popup</label><label class="check"><input id="manual" type="checkbox">点击后启动 / Manual launch</label><label class="check"><input id="allFrames" type="checkbox">注入 iframe / All frames</label></div><p class="small" style="margin-top:12px">License 功能在此版本关闭；Chrome Capture Pro 使用随工具发布的完整模板。商店包会移除 manifest.key。普通脚本的本地包没有固定扩展 ID，重新安装时 ID 可能改变。</p></section><section class="panel"><label for="code"><span>脚本源码 / content.js</span></label><textarea id="code" class="code" spellcheck="false" placeholder="// 粘贴或选择脚本"></textarea><div class="actions"><button id="pack" type="button">检查并下载扩展 ZIP</button><span id="status" class="status" role="status"></span><span id="examStoreGuideActions" hidden style="display:none"></span></div></section></div></main>${dataScript}${scripts}</body></html>`;
    const encryption = options.encryption;
    if (encryption?.enabled && (encryption.passwordHash || encryption.hash)) html = injectGatekeeper(html, encryption, 'f12-to-extension');
    return html;
}

async function buildSnapshot(tenantId, options = {}) {
    const data = await collect();
    data.templateBase64 = fs.readFileSync(path.join(SOURCE_DIR, TEMPLATE_FILE)).toString('base64');
    data.ppoTemplateBase64 = fs.readFileSync(path.join(SOURCE_DIR, PPO_TEMPLATE_FILE)).toString('base64');
    data.salaryTemplateBase64 = fs.readFileSync(path.join(SOURCE_DIR, SALARY_TEMPLATE_FILE)).toString('base64');
    return renderHtml(data, false, options);
}

async function buildPagesSnapshot(tenantId, options = {}) {
    const data = await collect();
    return {
        html: renderHtml(null, true, options),
        files: new Map([
            ['data/f12-presets.json', safeJson(data) + '\n'],
            [`data/${TEMPLATE_FILE}`, fs.readFileSync(path.join(SOURCE_DIR, TEMPLATE_FILE))],
            [`data/${PPO_TEMPLATE_FILE}`, fs.readFileSync(path.join(SOURCE_DIR, PPO_TEMPLATE_FILE))],
            [`data/${SALARY_TEMPLATE_FILE}`, fs.readFileSync(path.join(SOURCE_DIR, SALARY_TEMPLATE_FILE))],
            ['data/assets/jszip.min.js', fs.readFileSync(JSZIP_FILE)],
            ['data/assets/exam-vault.js', fs.readFileSync(path.join(SOURCE_DIR, 'exam-vault.js'))],
            ['data/assets/exam-store-guide.js', fs.readFileSync(path.join(SOURCE_DIR, 'exam-store-guide.js'))],
            ['data/assets/netcare-settings.js', fs.readFileSync(path.join(SOURCE_DIR, 'netcare-settings.js'))],
            ['data/assets/netcare-language.js', fs.readFileSync(path.join(SOURCE_DIR, 'netcare-language.js'))],
            ['data/assets/netcare-artifacts.js', fs.readFileSync(path.join(SOURCE_DIR, 'netcare-artifacts.js'))],
            ['data/assets/netcare-backup.js', fs.readFileSync(path.join(SOURCE_DIR, 'netcare-backup.js'))],
            ['data/assets/netcare-renderer-source.js', fs.readFileSync(path.join(SOURCE_DIR, 'netcare-renderer-source.js'))],
            ['data/assets/packer-core.js', fs.readFileSync(path.join(SOURCE_DIR, 'packer-core.js'))],
            ['data/assets/static-packer-runtime.js', fs.readFileSync(RUNTIME_FILE)]
        ])
    };
}

module.exports = { buildSnapshot, buildPagesSnapshot, collect };
