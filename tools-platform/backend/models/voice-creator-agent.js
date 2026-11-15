// Fish Audio 高拟真声音创作与文字转语音（TTS）专用原生工具集
// 支持 12 款官方安全声音、情感控制与交互式音色选择。
// 凭证由宿主机保险箱（AES-256-GCM 独立加密）按需动态读取，绝不进入 Git 仓库，绝不泄露于 AI 上下文。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const agentLoop = require('./agent-loop');

const PLATFORM_ROOT = path.resolve(__dirname, '../..');
const AUDIO_OUTPUT_DIR = path.join(PLATFORM_ROOT, 'outputs', 'audio');

const OFFICIAL_VOICES = [
    {
        id: '74c6aba5cbf94a15bbdc547ffce5cb38',
        name: '语彤',
        nameEn: 'Yutong',
        title: '语彤 Yutong',
        gender: '女性',
        age: '年轻',
        accent: '大陆普通话',
        description: '声音清晰自然，表达利落，适合语音助手、客服和日常播报。',
        tags: ['female', 'young', 'conversational', 'professional', 'clear', 'confident', 'zh-cn'],
        isDefault: true
    },
    {
        id: '5d29a99739c14d4ca3e4fe42193105b2',
        name: '梓轩',
        nameEn: 'Zixuan',
        title: '梓轩 Zixuan',
        gender: '男性',
        age: '年轻',
        accent: '大陆普通话',
        description: '声音清晰自然，表达利落，适合语音助手、客服和日常播报。',
        tags: ['male', 'young', 'conversational', 'professional', 'clear', 'confident', 'zh-cn']
    },
    {
        id: '8b1b2413e55e495f82471aa2248561c3',
        name: '晓彤',
        nameEn: 'Xiaotong',
        title: '晓彤 Xiaotong',
        gender: '女性',
        age: '年轻',
        accent: '大陆普通话',
        description: '二十岁出头的大陆口音女性声音。清晰明快，充满亲和力。耐心语言导师，最适合教学辅导与知识讲解。',
        tags: ['female', 'young', 'educational', 'teacher', 'friendly', 'clear', 'zh-cn']
    },
    {
        id: 'fdc29e5149ea49c7b21c2556c5f05ce2',
        name: '建国',
        nameEn: 'Jianguo',
        title: '建国 Jianguo',
        gender: '男性',
        age: '中年',
        accent: '大陆普通话 (北京)',
        description: '四十多岁的大陆口音男性声音。温和沉稳、磁性亲切。最适合陪伴类应用、电台与轻松的日常漫谈对话。',
        tags: ['male', 'middle-aged', 'conversational', 'warm', 'friendly', 'smooth', 'calm', 'zh-cn']
    },
    {
        id: '91ec588cf8ef443a9c0d5b21d0c1fa36',
        name: '詩涵',
        nameEn: 'Shihan',
        title: '詩涵 Shihan',
        gender: '女性',
        age: '年轻',
        accent: '台湾普通话',
        description: '聲音清晰自然，表達俐落，適合語音助理、客服和日常播報。',
        tags: ['female', 'young', 'conversational', 'professional', 'clear', 'confident', 'zh-tw']
    },
    {
        id: 'd675c275d1d44e57b4ef3840c5a23209',
        name: '浩然',
        nameEn: 'Haoran',
        title: '浩然 Haoran',
        gender: '男性',
        age: '年轻',
        accent: '大陆普通话',
        description: '声音清晰自然，表达利落，充满活力与职场专业感。',
        tags: ['male', 'young', 'professional', 'clear', 'zh-cn']
    },
    {
        id: 'e98fa6cdad6946bf8d9bb8f9cb8c2532',
        name: '冰冰',
        nameEn: 'Bingbing',
        title: '冰冰 Bingbing',
        gender: '女性',
        age: '年轻',
        accent: '大陆普通话',
        description: '声音清晰自然，表达利落，适合新闻早报与专业播报。',
        tags: ['female', 'young', 'professional', 'clear', 'zh-cn']
    },
    {
        id: '1e85fd1e0d3e4cc2b79fbca800e7e3fe',
        name: '承翰',
        nameEn: 'Chenghan',
        title: '承翰 Chenghan',
        gender: '男性',
        age: '年轻',
        accent: '台湾普通话',
        description: '聲音清晰自然，表達俐落，語調溫和有禮。',
        tags: ['male', 'young', 'conversational', 'professional', 'clear', 'zh-tw']
    },
    {
        id: 'ebfc2bf5a84747bab0bfcba1a6c63f79',
        name: '雨薇',
        nameEn: 'Yuwei',
        title: '雨薇 Yuwei',
        gender: '女性',
        age: '年轻',
        accent: '台湾普通话',
        description: '三十岁出头的台湾口音女性声音。温柔细腻、亲近自然。最适合情感电台、治愈陪伴与生活随谈。',
        tags: ['female', 'young', 'conversational', 'warm', 'soft', 'intimate', 'zh-tw']
    },
    {
        id: 'e7af89da8abc4fbdacd9a10ab9881933',
        name: '家豪',
        nameEn: 'Chia-Hao',
        title: '家豪 Chia-Hao',
        gender: '男性',
        age: '年轻',
        accent: '普通话',
        description: '声音清晰自然，表达利落，适合语音助手与日常客服。',
        tags: ['male', 'young', 'professional', 'clear']
    },
    {
        id: '49066cb45f0a427484ade915a4474534',
        name: '雅婷',
        nameEn: 'Ya-Ting',
        title: '雅婷 Ya-Ting',
        gender: '女性',
        age: '年轻',
        accent: '普通话',
        description: '声音清晰自然，表达利落，亲切自然。',
        tags: ['female', 'young', 'professional', 'clear']
    },
    {
        id: 'e27c0811319145f7832b3c3508401ea5',
        name: '柏翰',
        nameEn: 'Bohan',
        title: '柏翰 Bohan',
        gender: '男性',
        age: '年轻',
        accent: '台湾普通话',
        description: '二十多岁的台湾口音男性声音。专业自信、沉着从容。最适合技术支持、专家顾问与客户服务。',
        tags: ['male', 'young', 'professional', 'clear', 'confident', 'energetic', 'zh-tw']
    }
];

let cachedVaultKey = null;
let lastVaultCheck = 0;

/** 从环境变量或 Dragon Claw 保险箱安全获取 API Key */
async function getApiKey(owner = 'admin') {
    if (process.env.FISH_AUDIO_API_KEY && process.env.FISH_AUDIO_API_KEY.trim()) {
        return process.env.FISH_AUDIO_API_KEY.trim();
    }
    const now = Date.now();
    if (cachedVaultKey && (now - lastVaultCheck < 30000)) {
        return cachedVaultKey;
    }
    try {
        const { vault } = require('./password-vault');
        const v = vault();
        const owners = [owner, 'admin', 'f84300033'].filter(Boolean);
        for (const o of owners) {
            const secret = await v.getSecret(o, 'FISH_AUDIO_API_KEY');
            if (secret && secret.value && secret.value.trim()) {
                cachedVaultKey = secret.value.trim();
                lastVaultCheck = now;
                return cachedVaultKey;
            }
        }
    } catch (_) {}
    return cachedVaultKey || '';
}

/** 超级管理员权限与开放校验（非公开技能严密隔离） */
async function canUseVoiceCreator(user) {
    if (!user) return true; // CLI/内部调用
    const { isSuperAdmin } = require('../middleware/auth');
    if (isSuperAdmin(user)) return true;
    const { hasEntryAccess } = require('./tool-distribution');
    return hasEntryAccess('skill:voice-creator');
}

/** 匹配声音名称或 ID */
function findVoice(query) {
    if (!query) return OFFICIAL_VOICES[0];
    const q = String(query).trim().toLowerCase();
    return OFFICIAL_VOICES.find(v =>
        v.id === q
        || v.name.toLowerCase() === q
        || v.nameEn.toLowerCase() === q
        || v.title.toLowerCase().includes(q)
    ) || null;
}

function definitions() {
    return [
        {
            name: 'voice_creator_list_voices',
            description: '获取所有 12 种 Fish Audio 官方安全 AI 声音列表（语彤、梓轩、晓彤、建国、詩涵、浩然、冰冰、承翰、雨薇、家豪、雅婷、柏翰），包含音色特点、性别、年龄、口音风格与适用场景。在用户未明确指定音色时，调用此工具获取列表引导用户选择。',
            parameters: {
                type: 'object',
                properties: {
                    gender: { type: 'string', enum: ['全部', '女性', '男性'], description: '可选，按性别筛选' },
                    accent: { type: 'string', description: '可选，按口音筛选（如 大陆普通话、台湾普通话）' }
                }
            }
        },
        {
            name: 'voice_creator_generate',
            description: '基于 Fish Audio API 将文本合成为高拟真语音音频。支持情感标签控制（如 [happy]、[whisper]、<whisper>...</whisper>）、音色选择与多种音频格式，自动保存音频并返回在线播放器与下载链接。',
            parameters: {
                type: 'object',
                properties: {
                    text: { type: 'string', description: '需要转换成语音的文本内容。可包含情感标签如 [shaky breath]、[whisper]、<whisper>轻声私语</whisper> 等增强表现力。' },
                    voice: { type: 'string', description: '声音名称（如 语彤、梓轩、晓彤、建国、雨薇 等）或声音 ID。若用户未指定，默认使用【语彤】。' },
                    format: { type: 'string', enum: ['mp3', 'wav', 'opus'], description: '音频输出格式，默认为 mp3' },
                    model: { type: 'string', description: '底层模型，默认 s2.1-pro-free' }
                },
                required: ['text']
            }
        }
    ];
}

function buildPrompt() {
    return `### 🎙️ 创建声音（Fish Audio 声音合成与语音创作）
- 你已拥有 Fish Audio 原生高拟真声音创作工具：
  - voice_creator_list_voices: 列出 12 种官方安全声音（语彤、梓轩、晓彤、建国、詩涵、浩然、冰冰、承翰、雨薇、家豪、雅婷、柏翰）及其风格。
  - voice_creator_generate: 将文字转换为高拟真语音音频文件。
- **与用户交互选择声音流程**：
  1. **用户未明确指定音色时**：请主动列出核心推荐音色，引导用户选择（例如：清晰自然【语彤·女】/【梓轩·男】、知识教学【晓彤·女】、沉稳日常陪伴【建国·中年男】、温柔治愈【雨薇·台女】、专业技术【柏翰·台男】等），询问用户偏好的风格。
  2. **用户已指定音色或表达“直接生成/用默认”时**：直接调用 \`voice_creator_generate\` 执行生成。
- **表现力技巧**：文本中支持融入情感标记，如 \`[happy]\`、\`[whisper]\`、\`[sigh]\`、\`<whisper>...</whisper>\` 提升拟真度。
- **回复要求**：语音生成成功后，请在回复中展示音频播放控件：
  \`<audio controls src="/api/agent-files/view?path=本地文件路径"></audio>\`
  并附上音色名称、试听/下载链接与文件详情。`;
}

/** 核心文字转语音生成函数 */
async function generateSpeech({ text, voice = '语彤', format = 'mp3', model = 's2.1-pro-free' }, options = {}) {
    if (!text || !String(text).trim()) {
        throw new Error('合成文本不能为空');
    }
    const cleanText = String(text).trim();
    const apiKey = await getApiKey(options.owner);
    if (!apiKey) {
        throw new Error('未配置 Fish Audio API 密钥，请在平台「保险箱 -> API 密钥与 Secret」中录入 FISH_AUDIO_API_KEY');
    }

    const matchedVoice = findVoice(voice) || OFFICIAL_VOICES[0];
    const referenceId = matchedVoice.id;
    const cleanFormat = ['mp3', 'wav', 'opus'].includes(format) ? format : 'mp3';
    const cleanModel = String(model || 's2.1-pro-free').trim();

    const payload = {
        text: cleanText,
        reference_id: referenceId,
        format: cleanFormat
    };

    const startTime = Date.now();
    const response = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'model': cleanModel
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Fish Audio API 请求失败 (${response.status}): ${errorText || response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const durationMs = Date.now() - startTime;

    fs.mkdirSync(AUDIO_OUTPUT_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    const filename = `voice_${matchedVoice.nameEn.toLowerCase()}_${timestamp}_${randomSuffix}.${cleanFormat}`;
    const filePath = path.join(AUDIO_OUTPUT_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    const relativeViewUrl = `/api/agent-files/view?path=${encodeURIComponent(filePath)}`;
    const relativeDownloadUrl = `/api/agent-files/download?path=${encodeURIComponent(filePath)}`;
    const audioHtml = `<audio controls preload="none" src="${relativeViewUrl}"></audio>`;

    return {
        success: true,
        filePath,
        filename,
        viewUrl: relativeViewUrl,
        downloadUrl: relativeDownloadUrl,
        audioHtml,
        voice: {
            id: matchedVoice.id,
            name: matchedVoice.name,
            nameEn: matchedVoice.nameEn,
            title: matchedVoice.title,
            gender: matchedVoice.gender,
            accent: matchedVoice.accent
        },
        format: cleanFormat,
        model: cleanModel,
        sizeBytes: buffer.length,
        sizeKb: Math.round(buffer.length / 1024 * 10) / 10,
        durationMs,
        textPreview: cleanText.length > 50 ? `${cleanText.slice(0, 50)}…` : cleanText
    };
}

async function execute(name, args = {}, options = {}) {
    if (options?.user && !(await canUseVoiceCreator(options.user))) {
        return {
            content: '创建声音（Voice Creator）功能未全员开放，仅超级管理员可用。',
            summary: '未开放访问',
            isError: true
        };
    }

    try {
        if (name === 'voice_creator_list_voices') {
            let list = [...OFFICIAL_VOICES];
            if (args.gender && args.gender !== '全部') {
                list = list.filter(v => v.gender === args.gender);
            }
            if (args.accent) {
                list = list.filter(v => v.accent.includes(args.accent));
            }
            const formatted = list.map(v => ({
                id: v.id,
                name: v.name,
                title: v.title,
                gender: v.gender,
                age: v.age,
                accent: v.accent,
                description: v.description,
                isDefault: !!v.isDefault
            }));

            const textSummary = list.map(v => `• **${v.title}** (${v.gender} · ${v.accent} · ${v.age})：${v.description}`).join('\n');
            return {
                content: JSON.stringify(formatted, null, 2),
                summary: `已查询 ${list.length} 款官方安全音色`,
                displayText: textSummary
            };
        }

        if (name === 'voice_creator_generate' || name === 'create_voice' || name === 'voice_generate') {
            const result = await generateSpeech(args, options);
            const markdownOutput = [
                `🎙️ **声音生成成功！**`,
                `• **音色**：${result.voice.title}（${result.voice.gender} · ${result.voice.accent}）`,
                `• **规格**：${result.format.toUpperCase()} · ${result.sizeKb} KB · 耗时 ${result.durationMs}ms`,
                `• **本地路径**：\`${result.filePath}\``,
                `• **在线试听**：`,
                `${result.audioHtml}`,
                `• [📥 点击直接下载音频](${result.downloadUrl})`
            ].join('\n\n');

            return {
                content: markdownOutput,
                summary: `生成声音：${result.voice.name} · ${result.sizeKb}KB`,
                raw: result
            };
        }

        return { content: `未知的声音创作工具: ${name}`, isError: true };
    } catch (err) {
        return {
            content: `声音创作失败: ${err.message || err}`,
            summary: `声音创作失败`,
            isError: true
        };
    }
}

async function runTurn({ client: aiClient, systemInstruction, messages, signal, onDelta, onEvent, maxOutputTokens, temperature, model, extras = null, vision = null }) {
    const result = await agentLoop.runToolLoop({
        extras,
        vision,
        client: aiClient, model, systemPrompt: `${systemInstruction}\n${buildPrompt()}`, messages, tools: definitions(),
        write: event => (event.type === 'delta' ? onDelta?.(event.delta) : onEvent?.(event)),
        signal, maxOutputTokens, temperature, task: String(messages.at(-1)?.content || ''), callIdPrefix: 'voice',
        executeCall: async (call, { start }) => {
            const args = call.args && typeof call.args === 'object' ? call.args : {};
            start({ tool: call.name, args });
            const outcome = await execute(call.name, args);
            return { ...outcome, output: String(outcome.content || '').slice(0, 4000) };
        },
        toolsUnsupported: () => ({ note: '（当前模型不支持工具调用，声音创作工具不可用。）' })
    });
    return { text: result.text, usage: result.usage, toolLog: result.toolLog, ...(result.toolsUnsupported ? { toolsUnsupported: true } : {}) };
}

module.exports = {
    SKILL_ID: 'voice-creator',
    OFFICIAL_VOICES,
    definitions,
    buildPrompt,
    execute,
    runTurn,
    getApiKey,
    canUseVoiceCreator,
    generateSpeech,
    findVoice,
    kindOf: () => 'read'
};
