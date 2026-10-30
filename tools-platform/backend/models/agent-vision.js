// Dragon Claw 看图：用户上传的图片、浏览器截图、工作目录里的图片。
// - 当前对话模型能看图（Gemini、GPT-4o/4.1/5、Claude、Qwen-VL 等）：图片直接附给对话模型；
// - 不能看图（如 DeepSeek）：用「全局设置 › AI 助手」里正在使用的绘图模型先看图，把识别出的文字、布局与要点交给对话模型；
// - 两者都不行：如实告诉模型与用户需要切换模型或配置绘图模型。
// 模型配置里可用 vision: 'on' | 'off' 覆盖按模型名的判断。图片只发给模型，不写进会话转录。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
// 能看图的模型（按模型名；OpenAI 兼容网关也按模型名判断）
const VISION_RE = /gemini|claude|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|chatgpt-4o|\bo[34](?:-mini)?\b|qwen[\w.-]*-?vl|qvq|qwen[\w.-]*omni|qwen3\.5|glm-?4(?:\.\d)?v|glm-?4\.5v|glm-?5v|grok-(?:4|2-vision|vision)|llama-?4|pixtral|mistral-(?:medium|small)-3|doubao[\w.-]*vision|doubao-seed|kimi[\w.-]*vl|internvl|minicpm-v|step-1v|llava|vision/i;
const NO_VISION_RE = /deepseek(?!-vl)|embedding|whisper|tts|-audio/i;

function supportsVision(settings = {}) {
    const flag = String(settings.vision || '').toLowerCase();
    if (flag === 'on' || flag === 'true') return true;
    if (flag === 'off' || flag === 'false') return false;
    const model = String(settings.model || '');
    if (NO_VISION_RE.test(model)) return false;
    return VISION_RE.test(model) || (settings.provider === 'gemini' && !/gemma|embedding/i.test(model));
}

const isImagePath = file => Boolean(MIME[path.extname(String(file || '')).toLowerCase()]);

/** 读图片为 { mimeType, data(base64), name }；不是图片或太大时抛错 */
function loadImage(file) {
    const mimeType = MIME[path.extname(String(file)).toLowerCase()];
    if (!mimeType) throw Object.assign(new Error(`不是支持的图片格式（png / jpg / webp / gif）：${path.basename(String(file))}`), { code: 'VISION_FORMAT' });
    const stat = fs.statSync(file);
    if (stat.size > MAX_IMAGE_BYTES) throw Object.assign(new Error(`图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB：${path.basename(String(file))}`), { code: 'VISION_TOO_LARGE' });
    const buffer = fs.readFileSync(file);
    return { mimeType, data: buffer.toString('base64'), name: path.basename(String(file)), hash: crypto.createHash('sha1').update(buffer).digest('hex') };
}

const DESCRIBE_PROMPT = '请仔细看这张图片，用简体中文完整描述：图片类型；图中全部可见文字（逐字照录，含表格的行列内容与数字）；界面或版面布局与关键元素的位置；图表的数据与趋势；其他值得注意的细节。只描述看到的内容，不要猜测看不清的部分。';
const cache = new Map(); // 图片哈希 + 问题 → 识别结果（进程内，最多 200 条）

/**
 * 用绘图模型看图，返回文字。settings 为绘图模型的运行配置（ai-settings getImageRuntimeSettings）。
 */
async function describeWithImageModel(settings, images, { question = '', signal } = {}) {
    if (!settings) throw Object.assign(new Error('当前对话模型不能看图，也没有配置绘图模型：请在「全局设置 › AI 助手」切换到能看图的对话模型，或配置绘图模型'), { code: 'VISION_UNAVAILABLE' });
    const key = `${settings.provider}:${settings.model}:${images.map(image => image.hash).join(',')}:${question}`;
    if (cache.has(key)) return cache.get(key);
    const client = require('./ai-provider-client').createClient(settings);
    const prompt = `${DESCRIBE_PROMPT}${question ? `\n\n另外请特别回答：${question}` : ''}`;
    const payload = images.map(({ mimeType, data }) => ({ mimeType, data }));
    let text = '';
    try {
        const result = await client.generateText({ messages: [{ role: 'user', content: prompt, images: payload }], maxOutputTokens: 4096, temperature: 0.2, signal });
        text = String(result.text || '').trim();
    } catch (error) {
        if (signal?.aborted || typeof client.generateImage !== 'function') throw error;
    }
    // Gemini 图片模型有时只走 generateContent 的图文输出：退回 generateImage 取它的文字部分
    if (!text && settings.provider === 'gemini' && typeof client.generateImage === 'function') {
        text = String((await client.generateImage({ prompt: `${prompt}\n只用文字回答，不要生成图片。`, images: payload, signal })).text || '').trim();
    }
    if (!text) throw Object.assign(new Error('看图模型没有返回内容'), { code: 'VISION_EMPTY' });
    cache.set(key, text);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return text;
}

/**
 * 一轮对话的看图能力：{ capable, imageModel, describe(images, opts), prepare(message, files) }。
 * chatSettings 为当前对话模型的运行配置。
 */
async function forTurn({ chatSettings, signal } = {}) {
    const capable = supportsVision(chatSettings || {});
    let imageSettings;
    const imageModel = async () => {
        if (imageSettings === undefined) imageSettings = await require('./ai-settings-repository').getImageRuntimeSettings().catch(() => null);
        return imageSettings;
    };
    return {
        capable,
        imageModel,
        describe: async (images, opts = {}) => describeWithImageModel(await imageModel(), images, { signal, ...opts }),
        /**
         * 本轮用户消息附带的图片：能看图时附到消息上；不能看图时用绘图模型识别成文字附在消息末尾。
         * 返回 { message, note }，note 用于界面状态提示。
         */
        async prepare(message, files) {
            const images = [];
            const problems = [];
            for (const file of files.filter(isImagePath).slice(0, 6)) {
                try { images.push(loadImage(file)); } catch (error) { problems.push(error.message); }
            }
            if (!images.length) return { message, note: problems.join('；') };
            if (capable) return { message: { ...message, images: images.map(({ mimeType, data }) => ({ mimeType, data })) }, note: problems.join('；') };
            const notes = [];
            for (const image of images) {
                try {
                    notes.push(`（附件图片「${image.name}」的内容，由看图模型识别：）\n${await describeWithImageModel(await imageModel(), [image], { signal })}`);
                } catch (error) {
                    notes.push(`（附件图片「${image.name}」无法识别：${error.message}）`);
                }
            }
            return { message: { ...message, content: `${message.content}\n\n${notes.join('\n\n')}` }, note: problems.join('；') };
        }
    };
}

module.exports = { MAX_IMAGE_BYTES, supportsVision, isImagePath, loadImage, describeWithImageModel, forTurn };
