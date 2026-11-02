// Stable presentation titles for old and new chats. Keep the full question in history.
const { redactText } = require('./ai-sensitive-data');

function compact(value) {
    const text = value.replace(/\s+/g, ' ').trim();
    const limit = /[\u3400-\u9fff]/u.test(text) ? 18 : 48;
    if ([...text].length <= limit) return text;
    const words = text.split(' ');
    if (!/[\u3400-\u9fff]/u.test(text) && words.length > 1) {
        let result = '';
        for (const word of words.slice(0, 7)) {
            if ((result + ' ' + word).trim().length > limit) break;
            result = (result + ' ' + word).trim();
        }
        if (result) return result;
    }
    return [...text].slice(0, limit).join('').replace(/[\s，、:：;；的与和及]+$/u, '');
}

function conversationTitle(question) {
    const original = redactText(String(question || '')).slice(0, 8000);
    const url = original.match(/https?:\/\/[^\s<>"'）。，；！？、]+/i)?.[0];
    let text = original
        .replace(/\n?\s*(?:📎\s*)?(?:附件|Attachments?)\s*[:：][\s\S]*$/i, '')
        .replace(/https?:\/\/[^\s<>"'）。，；！？、]+/gi, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/(?:^|\s)@[a-z][\w-]*/gi, ' ')
        .replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim();
    const zh = /[\u3400-\u9fff]/u.test(text);
    if (/^[\d\s()+\-*/×÷=.]+$/.test(text) && /[+\-*/×÷]/.test(text)) return compact('计算 ' + text);
    if (zh) {
        const runtime = text.match(/Node\.js\s*\d+(?:\.\d+)*/i)?.[0];
        if (runtime && /LTS/i.test(text)) return compact(runtime + ' LTS 时间');
        if (/新闻|资讯/.test(text) && /搜|抓取|采集/.test(text)) {
            const subject = /通信|思科|华为|中兴/.test(text) ? '通信厂商' : '';
            return subject + '新闻' + (/搜索|搜一下|搜查/.test(text) ? '搜索' : '采集');
        }
        if (/数据库/.test(text) && /有哪些|什么表|哪些表|看到|概览/.test(text)) return '平台数据库概览';
        if (/指标/.test(text) && /未达标|没达标|不达标/.test(text)) return (/本月/.test(text) ? '本月' : '') + '未达标指标';
        if (/截图|截一张图|截屏/.test(text)) {
            let site = '';
            try { site = url ? new URL(url).hostname.replace(/^www\./, '') + ' ' : ''; } catch { /* Optional URL. */ }
            return compact(site + '网页截图');
        }
        if (/仓库/.test(text) && /调研|分析|审查|研究/.test(text)) {
            let project = '';
            try { const parsed = new URL(url); if (parsed.hostname === 'github.com') project = parsed.pathname.split('/')[2]?.replace(/\.git$/, '').replace(/[-_]/g, ' ') || ''; } catch { /* Optional project. */ }
            return compact(project ? project + ' 调研' : '代码仓库调研');
        }
        if (/图|图片/.test(text) && /推广|文字|识别|是什么|看.*什么/.test(text)) return /推广/.test(text) ? '图片推广内容分析' : '图片内容识别';
        if (/Skill|技能/i.test(text) && /依据|核对/.test(text)) return '研究依据核对 Skill';
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
