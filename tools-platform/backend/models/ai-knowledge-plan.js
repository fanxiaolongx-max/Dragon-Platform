// 首页问答前是否检索项目知识（代码与文档）：只在问到本平台的实现、页面、功能时检索；讲外部网页时不检索。
function planProjectKnowledgeSearch(question, pagePath = '') {
    const text = String(question || '');
    const implementationIntent = /怎么实现|实现逻辑|代码|文件|接口|api|路由|模块|数据源|存在哪|读取逻辑|计算逻辑|readme|项目结构|脚本实现/i.test(text);
    const operationalDataIntent = /指标|子指标|报表|月报|得分|排名|快照|目标|权重|达标/i.test(text)
        && /当前|最新|实际|多少|哪些|每个月|分月|\d{1,2}\s*月|趋势|差距|对比/i.test(text);
    const pageIntent = /这个页面|当前页面|本页|核心功能|如何使用|怎么用/i.test(text);
    // 「页面」只在明确指平台自己的页面时才算项目问题；「描述这个网页」之类说的是外部网页
    const projectIntent = /项目|客服|助手|功能|前端|后端|数据库|配置文件|(?:平台|工具|系统)[^，。？！,.?!\s]{0,6}页面/i.test(text);
    // 讲外部网址（打开 / 抓取 / 截图某个网站）且没提到本平台时，不检索项目代码
    const externalOnly = /https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(text) && !/平台|本项目|这个项目|我们的(?:系统|项目|代码)|dragon|tools[- ]?platform/i.test(text);
    const performed = !externalOnly && (implementationIntent || pageIntent || (!operationalDataIntent && projectIntent));
    const normalizedPath = String(pagePath || '').split('?')[0].replace(/^\/+|\/+$/g, '');
    const pageFile = !normalizedPath
        ? 'frontend/index.html'
        : `frontend/pages/${normalizedPath.split('/').pop()}.html`;
    return { performed, pathHints: pageIntent ? [pageFile] : [] };
}

module.exports = { planProjectKnowledgeSearch };
