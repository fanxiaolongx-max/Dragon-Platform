/* Shared catalog for the packer and homepage shortcuts. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F12BuiltinScripts = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    return {
      'sv-cfc-monitor': {
        file: './default-f12.js',
        name: 'SV/CFC 满意度监控',
        nameEn: 'SV/CFC Satisfaction Monitor',
        description: '监控 SV/CFC 餐厅满意度，分析问卷明细并复核评分。',
        matches: 'https://w3.huawei.com/*',
        world: 'MAIN',
        includePopup: true
      },
      'exam-question-bank': {
        file: './exam-question-bank-assistant.js',
        name: '题库与答题助手',
        nameEn: 'Question Bank and Exam Assistant',
        description: '抓取考试题目、维护本地题库并辅助自动答题。',
        matches: 'https://w3.huawei.com/*\nhttps://ilearning.huawei.com/*',
        world: 'ISOLATED',
        includePopup: true,
        manualLaunch: true
      },
      'authorized-media-exporter': {
        file: './authorized-media-exporter.js',
        name: '授权媒体下载脚本生成器',
        nameEn: 'Authorized Media Exporter',
        description: '扫描当前页面已直接暴露的视频地址，并生成可审阅的 ffmpeg 批量下载脚本；不解密或绕过 DRM。',
        matches: '<all_urls>',
        world: 'MAIN',
        includePopup: true,
        manualLaunch: true,
        runAt: 'document_idle'
      },
      'netcare-rfc-word': {
        file: './netcare-rfc-word.js',
        name: 'NetCare RFC 方案与 AI 审计',
        nameEn: 'NetCare RFC Plans and AI Audit',
        description: '批量下载 RFC 方案，提取章节与附件并执行 AI 审计；支持审计快照、Excel 和材料 ZIP 导出。',
        matches: 'https://netcare-ae.gts.huawei.com/p/netcare/index.html*\nhttps://netcare-ae.gts.huawei.com/opcenter/*\nhttps://netcare.huawei.com/p/netcare/index.html*\nhttps://netcare.huawei.com/opcenter/*\nhttps://netcare-de.gts.huawei.com/p/netcare/index.html*\nhttps://netcare-de.gts.huawei.com/opcenter/*\nhttps://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*\nhttps://*.kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*',
        world: 'MAIN',
        allFrames: true,
        includePopup: true,
        manualLaunch: true,
        runAt: 'document_idle'
      },
      'chrome-capture-pro': {
        type: 'template',
        templateZip: './chrome-capture-pro.template.zip',
        name: 'Chrome Capture Pro',
        nameEn: 'Chrome Capture Pro',
        description: '全功能屏幕录制、区域与长截图、GIF/视频编辑及画板标注工具。',
        matches: '<all_urls>',
        world: 'MAIN',
        includePopup: true,
        manualLaunch: false,
        isFullExtension: true,
        overviewCode: `// ========================================================
// 📸 Chrome Capture Pro (Dragon Edition)
// --------------------------------------------------------
// 全功能专业级浏览器屏幕录制与截图套件：
// • 区域截图 (Alt+C) / 可视区域截图 (Alt+S) / 滚动长截图 (Alt+Shift+S)
// • 标签页录屏 (Alt+R) / 桌面录屏 / 60FPS / 4K超清画质
// • 内置专业 GIF / 视频多轨帧编辑器与 Fabric.js 画板涂鸦
// • 本地离线 ECDSA P-256 License 签名授权与在线管理
// ========================================================`
      },
      'ppo-traffic-autofill': {
        type: 'template',
        templateZip: './ppo-traffic-autofill.template.zip',
        name: 'PPO 交通违章表单自动填表器',
        nameEn: 'PPO Traffic Form Autofill',
        description: '在 PPO 交通违章网站辅助填写表单。',
        matches: '*://www.ppo.gov.eg/*\n*://ppo.gov.eg/*\n*://*.ppo.gov.eg/*',
        world: 'ISOLATED',
        includePopup: true,
        isFullExtension: true,
        overviewCode: '// PPO 交通违章表单自动填表器：完整扩展模板（含 Popup、后台脚本与资源文件）。'
      },
      'overseas-salary-calculator': {
        type: 'template',
        templateZip: './overseas-salary-calculator.template.zip',
        name: '驻外薪资换汇计算器',
        nameEn: 'Overseas Salary Calculator',
        description: '专为驻外员工打造的薪资换汇与盈亏核算工具，实时获取官方汇率，精准测算 USD → EGP → CNY 汇差得失。',
        matches: '<all_urls>',
        world: 'MAIN',
        includePopup: true,
        isFullExtension: true,
        overviewCode: '// 💼 驻外薪资换汇计算器：完整独立扩展模板（含 Popup 交互界面、实时汇率拉取与多币种核算）。'
      }
    };
});
