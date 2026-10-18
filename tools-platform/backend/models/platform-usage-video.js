const navSettings = require('./nav-settings-repository');

function isPlatformUsageQuestion(question) {
    const text = String(question || '');
    return /平台|本系统|工具中台|UIVF12|SLA|月报|报表|脚本仓库|催办|dragon\s*(claw|platform)?|tools\s*platform/i.test(text)
        && /如何|怎么|怎样|使用|操作|教程|指南|介绍|入门|功能|能做什么|how|use|guide|tutorial|getting started|introduction|features/i.test(text);
}

async function getUsageVideoFooter(question, language) {
    if (!isPlatformUsageQuestion(question)) return '';
    const { platformGuideVideoUrl: url } = await navSettings.getSettings();
    if (!url) return '';
    // Encode Markdown delimiters without changing the URL destination.
    const safeUrl = url.replace(/[()<>]/g, char => '%' + char.charCodeAt(0).toString(16));
    return language === 'en' || /^en[-_]/i.test(language || '')
        ? `\n\n📺 [Watch the platform introduction video](${safeUrl})`
        : `\n\n📺 [观看平台使用介绍视频](${safeUrl})`;
}
module.exports = { isPlatformUsageQuestion, getUsageVideoFooter };
