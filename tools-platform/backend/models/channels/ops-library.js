// 内置运营内容库（backend/ops-content-library.json，受版本控制）：
// - topics：各专题的功能亮点（目前是 AI 月报），每次运行随机抽取，避开该计划最近推过的；
// - angles：运营角度（一招鲜、小测验、场景故事……），random 时每次换一种写法，避免天天一个腔调；
// - presets：内置运营计划模板（提示词 + 素材 + 定时），页面或 Dragon Claw 一键套用。
const fs = require('fs');
const path = require('path');
const opsRepo = require('./ops-repository');

const LIBRARY_PATH = path.join(__dirname, '../../ops-content-library.json');
let cache = null;

function library() {
    if (!cache) cache = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
    return cache;
}

function listTopics() {
    return Object.entries(library().topics).map(([id, topic]) => ({ id, name: topic.name, entry: topic.entry, summary: topic.summary, count: topic.highlights.length }));
}

function getTopic(id) {
    const topics = library().topics;
    return topics[id] ? { id, ...topics[id] } : null;
}

function listAngles() {
    return library().angles.slice();
}

function listPresets() {
    return library().presets.map(preset => ({ ...preset }));
}

function getPreset(id) {
    const preset = library().presets.find(item => item.id === id);
    return preset ? JSON.parse(JSON.stringify(preset)) : null;
}

function shuffle(list, random) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * 为计划随机抽取亮点：最近几次推过的先不选（约覆盖亮点库的七成），都推过一轮后重新开始。
 * @returns {Promise<{topic:object, items:Array}>}
 */
async function pickHighlights(plan, { random = Math.random } = {}) {
    const topic = getTopic(plan.options?.highlightTopic || 'ai-report') || getTopic('ai-report');
    if (!topic) return { topic: null, items: [] };
    const count = Math.min(topic.highlights.length, plan.options?.highlightCount || 1);
    const window = Math.max(1, Math.floor((topic.highlights.length * 0.7) / count));
    const recent = plan.id ? await opsRepo.recentRunMetas(plan.id, window) : [];
    const used = new Set(recent.flatMap(meta => meta.highlightIds || []));
    const fresh = shuffle(topic.highlights.filter(item => !used.has(item.id)), random);
    const stale = shuffle(topic.highlights.filter(item => used.has(item.id)), random);
    return { topic, items: [...fresh, ...stale].slice(0, count) };
}

/** 运营角度：指定 id 时固定使用；random 时随机且尽量不与上一次相同。 */
async function pickAngle(plan, { random = Math.random } = {}) {
    const angles = listAngles();
    const wanted = plan.options?.angle || 'random';
    if (wanted !== 'random') return angles.find(item => item.id === wanted) || null;
    const last = plan.id ? (await opsRepo.recentRunMetas(plan.id, 1))[0]?.angle : '';
    const pool = angles.filter(item => item.id !== last);
    return pool[Math.floor(random() * pool.length)] || angles[0] || null;
}

function resetCache() {
    cache = null;
}

module.exports = { listTopics, getTopic, listAngles, listPresets, getPreset, pickHighlights, pickAngle, resetCache };
