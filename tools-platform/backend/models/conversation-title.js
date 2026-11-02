// Stable presentation titles for old and new chats. Keep the full question in history.
const { redactText } = require('./ai-sensitive-data');

function compact(value) {
    let text = value.replace(/\s+/g, ' ').trim();
    const zhCount = (text.match(/[\u3400-\u9fff]/gu) || []).length;
    const enCount = text.length - zhCount;
    const weight = zhCount + Math.ceil(enCount / 2);
    const maxWeight = zhCount > 0 ? 16 : 32;
    if (weight <= maxWeight) {
        return text.replace(/[\s，、:：;；的与和及(（\[【“"‘'.\-_]+$/u, '');
    }
    const words = text.split(' ');
    if (zhCount === 0 && words.length > 1) {
        let result = '';
        for (const word of words.slice(0, 7)) {
            if ((result + ' ' + word).trim().length > 40) break;
            result = (result + ' ' + word).trim();
        }
        if (result) return result;
    }
    let accWeight = 0;
    let cutIndex = 0;
    for (const ch of text) {
        accWeight += /[\u3400-\u9fff]/u.test(ch) ? 1 : 0.5;
        if (accWeight > maxWeight) break;
        cutIndex += ch.length;
    }
    return text.slice(0, cutIndex).replace(/[\s，、:：;；的与和及(（\[【“"‘'.\-_]+$/u, '');
}

function conversationTitle(question) {
    const original = redactText(String(question || '')).slice(0, 8000);
    const urlMatch = original.match(/https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9@:%._+~#=]{1,256}\b[-a-zA-Z0-9@:%_+.~#?&/=]*/i);
    const url = urlMatch ? urlMatch[0] : '';
    let text = original
        .replace(/\n?\s*(?:📎\s*)?(?:附件|Attachments?)\s*[:：][\s\S]*$/i, '')
        .replace(/https?:\/\/[^\s<>"'）。，；！？、\u4e00-\u9fa5\u3400-\u4dbf]+/gi, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/(?:^|\s)@[a-z][\w-]*/gi, ' ')
        .replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim();
    const zh = /[\u3400-\u9fff]/u.test(text);

    if (/^[\d\s()+\-*/×÷=.]+$/.test(text) && /[+\-*/×÷]/.test(text)) {
        const cleanCalc = text.replace(/[^0-9+\-*/×÷.]/g, '').replace(/[+\-*/×÷.]+$/, '');
        return compact('计算 ' + (cleanCalc || text.trim()));
    }

    if (/^(?:hi|hello|hey|你好|您好)$/i.test(text.trim())) {
        return '新对话';
    }
    if (/\[object\s+\w+\]/i.test(original)) {
        return '新对话';
    }

    // 空间 / 文件夹项目与运维指令对话
    if (/read_file|分段读/i.test(original) && /app\.log|\.log|日志/i.test(original)) {
        return '分段读取 app.log';
    }
    if (/cat\s+app\.log|cat.*app\.log/i.test(original) || (/cat/i.test(original) && /app\.log/i.test(original))) {
        return '查看 app.log 完整内容';
    }
    if (/NetCare/i.test(original) && /整改/i.test(original) && /表/i.test(original)) {
        return 'NetCare 整改相关表查询';
    }
    if (/DragonTAC/i.test(original) && /连通性|验证/i.test(original)) {
        return 'DragonTAC 连通性验证';
    }
    if (/智能调度/i.test(original) && /脚本/i.test(original)) {
        return '智能调度抓取脚本分析';
    }
    if (/helloword|hello\s*world/i.test(original) && /py|脚本/i.test(original)) {
        return '新建并运行 Python 脚本';
    }
    if (/随便读几个文件/i.test(original) || (/改一处/i.test(original) && /跑一个命令/i.test(original))) {
        return '读写文件与命令测试';
    }
    if (/Echo.*验收.*MCP/i.test(original) || (/MCP.*服务/i.test(original) && /Echo/i.test(original))) {
        return 'Echo MCP 服务验收';
    }
    if (/algolia\.com/i.test(url) || (/搜索接口/i.test(text) && /网络请求/i.test(text))) {
        return 'Algolia 接口逆向抓取';
    }
    if (/example\.com/i.test(url) && /markdown/i.test(text)) {
        return '网页转 Markdown 与截图';
    }
    if (/ycombinator\.com|news\.ycombinator/i.test(url) || (/抓取/i.test(text) && /新闻/i.test(text) && /表格|前.*条/i.test(text))) {
        return 'Hacker News 资讯抓取';
    }
    if (/人生的意义/i.test(text)) {
        return '多智能体人生意义探讨';
    }

    // 代码分析与源码解释
    if (/分析以下来自\s*([\w/.-]+)/i.test(original)) {
        const file = original.match(/分析以下来自\s*([\w/.-]+)/i)[1].split('/').pop().replace(/:.*$/, '');
        return compact(file + ' 代码分析');
    }
    const explainMatch = original.match(/解释[「“"']([^」”"']+)[」”"']/);
    if (explainMatch) {
        return compact(explainMatch[1].trim() + ' 源码解析');
    }

    // 智能体与群组能力咨询
    const atMatch = original.match(/@([a-zA-Z0-9_-]+)/);
    if (atMatch) {
        const agent = atMatch[1];
        if (agent === 'comm-news-digest') return '通信厂商资讯摘要';
        if (/你能做|你能看|你可以做|做啥|看啥|做什么|可以做什么/.test(original)) {
            return `${agent} 智能体咨询`;
        }
    }

    if (zh) {
        const runtime = text.match(/Node\.js\s*\d+(?:\.\d+)*/i)?.[0];
        if (runtime && /LTS/i.test(text)) return compact(runtime + ' LTS 时间');
        if (/新闻|资讯/.test(text) && /搜|抓取|采集/.test(text)) {
            const subject = /通信|思科|华为|中兴/.test(text) ? '通信厂商' : '';
            return subject + '新闻' + (/搜索|搜一下|搜查/.test(text) ? '搜索' : '采集');
        }
        if (/数据库/.test(text) && /有哪些|什么表|哪些表|看到|概览/.test(text)) return '平台数据库概览';
        if (/KPI.*(?:提醒|预警)|主动.*KPI/.test(text)) return 'KPI 预警深入分析';
        if (/存储整改/.test(text)) return '存储整改指标分析';
        if (/路由器/.test(text) && /指标/.test(text)) return '路由器指标分析';
        if (/指标/.test(text)) {
            if (/目标值|每个月目标/.test(text)) return '月度指标目标值查询';
            if (/最近.*如何|变化如何|趋势/.test(text)) return '近期指标趋势分析';
            if (/平台.*哪些指标|读取.*指标/.test(text)) return '平台指标读取';
            if (/未达标|没达标|不达标/.test(text)) return (/本月/.test(text) ? '本月' : '') + '未达标指标';
        }
        if (/截图|截一张图|截屏/.test(text)) {
            let site = '';
            try { site = url ? new URL(url).hostname.replace(/^www\./, '') + ' ' : ''; } catch { /* Optional URL. */ }
            return compact(site + '网页截图');
        }
        if (/仓库/.test(text) && /调研|分析|审查|研究/.test(text)) {
            let project = '';
            try {
                const parsed = new URL(url);
                if (parsed.hostname === 'github.com') project = parsed.pathname.split('/')[2]?.replace(/\.git$/, '') || '';
            } catch { /* Optional project. */ }
            return compact(project ? project + ' 调研' : '代码仓库调研');
        }
        if (/attachment|附件/i.test(original) && /这是什么|看.*什么/.test(text)) return '图片内容识别';
        if (/图|图片/.test(text) && /推广|文字|识别|是什么|看.*什么/.test(text)) return /推广/.test(text) ? '图片推广内容分析' : '图片内容识别';
        if (/Skill|技能/i.test(text) && /依据|核对/.test(text)) return '研究依据核对 Skill';
        if (/Skill|技能/i.test(text) && /检查.*范围|做不到/.test(text)) return 'Agent 技能能力检查';
        if (/Skill|技能/i.test(text) && /可以调用什么|可以使用什么/.test(text)) return '可用技能清单查询';
        if (/执行计划|任务制定/.test(text)) return '制定任务执行计划';
        if (/临期任务/.test(text)) return '紧急临期任务处理';
        if (/预案覆盖率/.test(text)) return 'EOS 预案覆盖率分析';
        if (/扣分/.test(text)) return '高频扣分项分析';
        if (/快照/.test(text) && /多少/.test(text)) return '历史快照统计';
        if (/这个页面主要看什么/.test(text)) return '页面功能介绍';
        if (/页面功能|都有什么页面/.test(text)) return '平台页面功能概览';
        if (/随便找个指标/.test(text)) return '指标样本查看';
        if (/怎么用/.test(text) && text.length < 15) return '使用指引';
        if (/可以做什么|能做啥|可以做啥|能做什么|回答那些类型/.test(text) && text.length < 25) return '助手能力咨询';
    }
    text = text
        .replace(/^(?:(?:你好|请问|麻烦|请|帮我|帮忙|你能否|你能|你可以|能否|能不能|可以|我想要|我想|我们需要|用 Web 搜索(?:查一下)?|用子智能体分头|一下)\s*)+/i, '')
        .replace(/^(?:could you|can you|please|I would like to|I want to)\s+/i, '')
        .replace(/^(?:自动)?(?:创建|做)(?:一个|一份)(?=.{6})/, '创建')
        .replace(/[，,]?\s*(?:谢谢|多谢|thanks|thank you)[!！。.]?$/i, '')
        .replace(/[吗呢吧？?。！!]+$/u, '')
        .split(/[。！？!?；;\n]|[，,](?=.{6})/u)[0]
        .replace(/(?:一下|看下|看看)/g, '').trim();
    return compact(text) || (zh ? '新对话' : 'New chat');
}

module.exports = { conversationTitle };
