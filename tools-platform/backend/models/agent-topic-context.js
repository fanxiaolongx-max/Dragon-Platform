// 只对当前提问做本地匹配。短指代（如“继续”）借用上一条用户提问，显式换题不继承旧主题。
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const stop = new Set('这个 那个 之前 话题 原来 上个 回到 刚才 继续 帮我 我们 需要 使用 统一 默认 本次 以后 任务 结果 请问 一个 一下 按照 生成 帮忙 上次 the and for with this that please'.split(' '));

function terms(value) {
    const parts = segmenter.segment(String(value || '').toLowerCase().slice(0, 2000));
    return new Set(Array.from(parts, p => p.segment).filter(word => word.length >= 2 && /\p{L}/u.test(word) && !stop.has(word)));
}

const continuation = /^(?:(?:请)?(?:继续(?:吧|说|写|往下)?|接着(?:来|说|写)|按刚才的口径(?:再算一次)?|和上次一样)|(?:please\s+)?(?:continue|go on)(?:\s+please)?)[。.!！?？\s]*$/i;

const returnTopic = /^(?:现在|我们|请)?(?:回到|回头看|切回|换回|接着之前的|back to|return to|resume the earlier)/i;
const switchTopic = /^(?:现在|我们|先|请)?(?:换(?:个|一个)?话题|换到(?:另一个|新)任务|切换到(?:另一个|新)话题|另一个(?:独立)?问题|新问题[，,:：]|new (?:topic|unrelated question)\b|switch(?:ing)? topics\b)/i;

function startsIndependentTopic(question) {
    const text = String(question || '').trim();
    return switchTopic.test(text) && !/沿用|参照|参考刚才|用刚才|接着之前|as before|using the previous/i.test(text);
}

// 只裁剪发给模型的副本。用户切回旧任务时解除边界，保留历史、撤销和恢复快照。
function activeTopicRows(rows, question) {
    if (startsIndependentTopic(question)) return [];
    if (!rows.some(row => row.role === 'user' && startsIndependentTopic(row.content))) return rows;
    // 按轮分组，切回已有主题时继续写入那个分组。A→B→A→C→A 也能恢复最早的 A。
    const groups = [];
    let current = [];
    const activate = group => {
        const previous = groups.indexOf(group);
        if (previous >= 0) groups.splice(previous, 1);
        groups.unshift(group);
        current = group;
    };
    activate(current);
    const resolveReturn = text => {
        const words = terms(text.replace(returnTopic, ''));
        let best = null, score = 0;
        for (const group of groups) {
            for (const row of group) {
                if (row.role !== 'user' || returnTopic.test(row.content.trim())) continue;
                const matched = topicScore(row.content, words);
                if (matched > score) { best = group; score = matched; }
            }
        }
        if (best) return best;
        return groups.length === 2 && /刚才|原来|之前|上个|previous/i.test(text) ? groups[1] : null;
    };
    for (const row of rows) {
        if (row.role === 'user') {
            const text = row.content.trim();
            if (startsIndependentTopic(text)) activate([]);
            else if (returnTopic.test(text)) activate(resolveReturn(text) || []);
        }
        current.push(row);
    }
    if (returnTopic.test(question.trim())) return resolveReturn(question.trim()) || [];
    return current;
}

function topicQuery(question, history = []) {
    if (!continuation.test(question.trim())) return question;
    return history.slice().reverse().find(row => row.role === 'user'
        && row.content?.trim() && !continuation.test(row.content.trim()))?.content || question;
}

function topicScore(scope, queryTerms) {
    let score = 0;
    for (const word of terms(scope)) if (queryTerms.has(word)) score++;
    return score;
}

// 将用户直接限定统计/执行范围的句子与模型概括分开保存，避免多轮改写丢失排除条件。
function retainUserConstraints(summary, entries, previous = '') {
    const prefix = '用户原话依据：';
    const preserved = new Map();
    const remember = line => {
        if (line.startsWith(prefix)) preserved.set(line.slice(prefix.length).trim(), true);
    };
    previous.split('\n').forEach(remember);
    for (const row of entries) {
        const content = String(row.content || '');
        if (row.role !== 'user') continue;
        for (const sentence of content.split(/[。！？\n]/u)) {
            if (!/(?:仅|只)(?:统计|计算|计入|包含|允许|使用|限于)|排除|不得计入|only (?:count|include|use)|exclude /i.test(sentence)) continue;
            const quote = sentence.trim().slice(0, 260);
            if (quote) preserved.set((row.id ? '[' + row.id + '] ' : '') + quote, true);
        }
    }
    const sections = summary.split(/\n(?=## )/);
    for (const quote of Array.from(preserved.keys()).slice(-6)) {
        if (summary.includes(prefix + quote)) continue;
        const words = terms(quote);
        let best = 0, bestScore = 0;
        for (let i = 0; i < sections.length; i++) {
            const title = sections[i].split('\n', 1)[0].replace(/^##\s*/, '').trim();
            const score = topicScore(title, words) + (title.length >= 2 && quote.includes(title) ? 1 : 0);
            if (score > bestScore) { best = i; bestScore = score; }
        }
        if (bestScore || sections.length === 1) sections[best] += '\n' + prefix + quote;
        else sections.push('## ' + quote.slice(0, 80) + '\n' + prefix + quote);
    }
    return sections.join('\n');
}

const taskSummaryGuide = '按独立任务分别用“## 主题关键词”开段。同一主题合并更新；保留目标、用户确认的约束、已验证结果和待办。关键数字及结论附输入中已有的消息编号、工具调用编号或文件路径；保留其他尚未完成的任务，切勿自造来源。';

const vagueReference = /刚才|之前|上次|刚刚|原来那个|earlier|previous/i;

function summaryForTurn(summary, query, history = []) {
    // 旧会话、手动压缩以及没有标准标题的摘要仍可原样恢复。
    if (!summary.startsWith('## ')) return summary;
    const sections = summary.split(/\n(?=## )/);
    const words = terms(query);
    if (/所有任务|各个任务|总结.*(?:对话|进度)|哪些.*(?:任务|待办)|summarize.*conversation/i.test(query)) return summary;
    const headings = sections.map(section => section.split('\n', 1)[0]);
    if (sections.length > 1 && vagueReference.test(query)) {
        // “之前那个”只带入能定位的主题。如果两个项目都可能，只提供标题供澄清。
        const distinctive = headings.map(heading => [...terms(heading)].filter(word =>
            headings.filter(other => terms(other).has(word)).length === 1));
        const candidates = text => distinctive.flatMap((words, i) => words.some(word => text.toLowerCase().includes(word)) ? [i] : []);
        let found = candidates(query);
        if (!found.length) {
            for (const row of [...history].reverse()) {
                if (row.role !== 'user' || !row.content || row.content === query) continue;
                found = candidates(row.content);
                if (found.length || startsIndependentTopic(row.content)) break;
            }
        }
        if (found.length === 1) return sections[found[0]];
        const titles = (found.length ? found.map(i => headings[i]) : headings).slice(0, 6);
        return '候选话题（仅标题）：' + JSON.stringify(titles.map(title => title.slice(3, 83))) +
            '。如果最近对话仍不能唯一确定用户指的是哪个，请只问一句确认。';
    }
    const matches = sections.filter((section, i) => {
        const title = headings[i].slice(3).trim();
        return (title.length >= 2 && query.includes(title)) || topicScore(title, words);
    });
    if (matches.length) return matches.join('\n');
    if (sections.length === 1 && (!words.size || vagueReference.test(query))) return summary;
    const related = sections.filter(section => topicScore(section, words) >= 2);
    return related.join('\n');
}

module.exports = { startsIndependentTopic, activeTopicRows, returnTopic, terms, topicScore, topicQuery, retainUserConstraints, taskSummaryGuide, summaryForTurn };
