// 会话列表的拼音搜索：全拼、首字母及二者混合（如 weifuwu / wfw / weifw → 微服务）。
// 词库 chat-pinyin-dict.json 由 macOS CFStringTransform 离线生成（拼音 → 汉字串），
// 覆盖 CJK 基本区与扩展 A，运行时不依赖外部服务。
const DICT = require('./chat-pinyin-dict.json');

// 常见多音字补充读音，主要照顾人名、群名里的姓氏和高频词。
const EXTRA_READINGS = {
    重: ['chong'], 行: ['hang'], 长: ['zhang'], 乐: ['le'], 单: ['shan', 'chan'], 曾: ['ceng'],
    朝: ['chao'], 调: ['tiao'], 都: ['dou'], 还: ['huan'], 会: ['kuai'], 解: ['xie'], 区: ['ou'],
    仇: ['qiu'], 查: ['zha'], 沈: ['chen'], 盛: ['cheng'], 朴: ['piao'], 尉: ['yu'], 覃: ['qin'],
    缪: ['miao'], 翟: ['zhai'], 种: ['chong'], 召: ['shao'], 华: ['hua'], 柏: ['bai'], 藏: ['zang'],
    车: ['ju'], 传: ['zhuan'], 大: ['dai'], 弹: ['dan'], 得: ['dei'], 发: ['fa'], 分: ['fen'],
    干: ['gan'], 给: ['ji'], 好: ['hao'], 和: ['he', 'huo'], 角: ['jue'], 觉: ['jiao'],
    看: ['kan'], 空: ['kong'], 了: ['liao'], 率: ['lv'], 便: ['pian'], 期: ['ji'],
    强: ['jiang'], 曲: ['qu'], 省: ['xing'], 数: ['shuo'], 系: ['ji'], 相: ['xiang'],
    要: ['yao'], 应: ['ying'], 只: ['zhi'], 中: ['zhong'], 转: ['zhuan'], 着: ['zhao', 'zhe'],
    参: ['shen', 'cen'], 差: ['chai', 'ci'], 冲: ['chong'], 处: ['chu'], 斗: ['dou'], 度: ['duo'],
    供: ['gong'], 降: ['xiang'], 结: ['jie'], 据: ['ju'], 量: ['liang'], 落: ['la', 'lao'],
    模: ['mu'], 宁: ['ning'], 片: ['pian'], 剥: ['bo'], 塞: ['sai', 'se'], 属: ['zhu'], 校: ['jiao'],
    血: ['xie'], 叶: ['xie'], 员: ['yun'], 载: ['zai'], 正: ['zheng'], 殷: ['yan']
};

const READINGS = new Map();
for (const [syllable, chars] of Object.entries(DICT)) {
    for (const char of chars) {
        if (!READINGS.has(char)) READINGS.set(char, [syllable]);
        else if (!READINGS.get(char).includes(syllable)) READINGS.get(char).push(syllable);
    }
}
for (const [char, extras] of Object.entries(EXTRA_READINGS)) {
    const list = READINGS.get(char) || [];
    for (const syllable of extras) if (!list.includes(syllable)) list.push(syllable);
    READINGS.set(char, list);
}

const HAN_RE = /[㐀-鿿]/;

function normalizePinyinQuery(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// 只有纯字母/数字（可夹空格、撇号、横线）的查询才走拼音匹配；含汉字的查询保持原有 LIKE 语义。
function isPinyinQuery(value) {
    const text = String(value ?? '').normalize('NFKC').trim();
    return /[a-z]/i.test(text) && /^[a-z0-9\s'_\-.]+$/i.test(text);
}

function initialsOf(syllable) {
    const two = syllable.slice(0, 2);
    return two === 'zh' || two === 'ch' || two === 'sh' ? [syllable[0], two] : [syllable[0]];
}

// 把文本拆成可匹配的单元：汉字单元带全部读音，字母数字按单字符原样匹配，其他符号忽略。
const segmentCache = new Map();
function segmentsOf(text) {
    const key = String(text ?? '');
    const cached = segmentCache.get(key);
    if (cached) return cached;
    const segments = [];
    for (const char of key.normalize('NFKC').toLowerCase()) {
        if (/[a-z0-9]/.test(char)) segments.push({ literal: char });
        else if (HAN_RE.test(char)) {
            const syllables = READINGS.get(char);
            if (!syllables) segments.push({ skip: true });
            else segments.push({ syllables, initials: [...new Set(syllables.flatMap(initialsOf))] });
        }
    }
    if (segmentCache.size > 20000) segmentCache.clear();
    segmentCache.set(key, segments);
    return segments;
}

// 从 segments[start] 起能否连续消费完 query：每个汉字可消费全拼或声母（含 zh/ch/sh），
// query 末尾允许只输入最后一个字全拼的前缀（边打字边搜索）。
function matchFrom(segments, start, query) {
    const memo = new Map();
    const visit = (segIndex, queryIndex) => {
        if (queryIndex === query.length) return true;
        if (segIndex >= segments.length) return false;
        const memoKey = segIndex * 1024 + queryIndex;
        if (memo.has(memoKey)) return memo.get(memoKey);
        const segment = segments[segIndex];
        const rest = query.slice(queryIndex);
        let ok = false;
        if (segment.literal) {
            ok = rest[0] === segment.literal && visit(segIndex + 1, queryIndex + 1);
        } else if (segment.syllables) {
            for (const syllable of segment.syllables) {
                if (rest.startsWith(syllable) && visit(segIndex + 1, queryIndex + syllable.length)) { ok = true; break; }
                if (syllable.startsWith(rest)) { ok = true; break; }
            }
            if (!ok) {
                for (const initial of segment.initials) {
                    if (rest.startsWith(initial) && visit(segIndex + 1, queryIndex + initial.length)) { ok = true; break; }
                }
            }
        }
        memo.set(memoKey, ok);
        return ok;
    };
    return visit(start, 0);
}

function pinyinMatches(text, rawQuery) {
    const query = normalizePinyinQuery(rawQuery);
    if (!query || query.length > 512) return false;
    const segments = segmentsOf(text);
    if (!segments.some(segment => segment.syllables)) return false;
    for (let start = 0; start < segments.length; start += 1) {
        if (segments[start].skip) continue;
        if (matchFrom(segments, start, query)) return true;
    }
    return false;
}

module.exports = { isPinyinQuery, pinyinMatches, normalizePinyinQuery };
