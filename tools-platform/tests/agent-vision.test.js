const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-vision-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
// 引擎在后台记录工具调用次数（写临时库），稍等再删目录
test.after(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const vision = require('../backend/models/agent-vision');
const agentLoop = require('../backend/models/agent-loop');
const artifacts = require('../backend/models/agent-artifacts');
const contextStats = require('../backend/models/agent-context-stats');
const providerClient = require('../backend/models/ai-provider-client');
const { redactValue } = require('../backend/models/ai-sensitive-data');

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('vision support is judged from the model name, and a profile can override it', () => {
    for (const model of ['gemini-3.1-flash-lite', 'gpt-4o-mini', 'gpt-5.6-luna', 'claude-sonnet-5-5', 'qwen2.5-vl-72b-instruct', 'glm-4.5v', 'grok-4.7']) {
        assert.equal(vision.supportsVision({ provider: 'openai-compatible', model }), true, model);
    }
    for (const model of ['deepseek-flash', 'deepseek-chat', 'qwen-max', 'text-embedding-3-large']) {
        assert.equal(vision.supportsVision({ provider: 'openai-compatible', model }), false, model);
    }
    assert.equal(vision.supportsVision({ provider: 'gemini', model: 'aragon-alias' }), true, 'every Gemini chat model can see');
    assert.equal(vision.supportsVision({ provider: 'openai-compatible', model: 'deepseek-flash', vision: 'on' }), true);
    assert.equal(vision.supportsVision({ provider: 'gemini', model: 'gemini-2.5-pro', vision: 'off' }), false);
});

test('uploaded images go straight to a vision model, or are described by the image model first', async t => {
    const saved = await artifacts.saveUpload('default::alice', { originalname: '截图.png', buffer: PNG });
    const capable = await vision.forTurn({ chatSettings: { provider: 'gemini', model: 'gemini-3.1-flash-lite' } });
    const attached = await capable.prepare({ role: 'user', content: '看看这张图' }, [saved.path, '/tmp/report.csv']);
    assert.equal(attached.message.images.length, 1);
    assert.equal(attached.message.images[0].mimeType, 'image/png');
    assert.equal(attached.message.content, '看看这张图');

    const original = providerClient.createClient;
    const prompts = [];
    providerClient.createClient = settings => ({ generateText: async options => { prompts.push({ settings, options }); return { text: '一张 1×1 的白色像素图，没有文字。' }; } });
    t.after(() => { providerClient.createClient = original; });
    const settingsRepo = require('../backend/models/ai-settings-repository');
    const originalImage = settingsRepo.getImageRuntimeSettings;
    settingsRepo.getImageRuntimeSettings = async () => ({ provider: 'gemini', model: 'gemini-nano-banana-2.1', apiKey: 'k' });
    t.after(() => { settingsRepo.getImageRuntimeSettings = originalImage; });

    const textOnly = await vision.forTurn({ chatSettings: { provider: 'openai-compatible', model: 'deepseek-flash' } });
    assert.equal(textOnly.capable, false);
    const described = await textOnly.prepare({ role: 'user', content: '看看这张图' }, [saved.path]);
    assert.equal(described.message.images, undefined, 'a text-only model gets no image data');
    assert.match(described.message.content, /^看看这张图\n\n（附件图片「截图\.png」的内容，由看图模型识别：）\n一张 1×1 的白色像素图/);
    assert.equal(prompts[0].settings.model, 'gemini-nano-banana-2.1');
    assert.equal(prompts[0].options.messages[0].images.length, 1);
    await textOnly.prepare({ role: 'user', content: '再看' }, [saved.path]);
    assert.equal(prompts.length, 1, 'the same picture is described once');

    settingsRepo.getImageRuntimeSettings = async () => null;
    const none = await vision.forTurn({ chatSettings: { provider: 'openai-compatible', model: 'deepseek-flash' } });
    const fallback = await none.prepare({ role: 'user', content: '看图' }, [path.join(path.dirname(saved.path), '..', path.basename(path.dirname(saved.path)), '截图.png')]);
    assert.match(fallback.message.content, /无法识别：当前对话模型不能看图，也没有配置绘图模型/);
});

test('view_image attaches the picture for a vision model, describes it otherwise, and only recent pictures stay in context', async () => {
    const saved = await artifacts.saveUpload('default::alice', { originalname: 'a.png', buffer: PNG });
    const requests = [];
    const script = [
        { toolCalls: [{ id: 'v1', name: 'view_image', args: { path: saved.path } }] },
        { toolCalls: [{ id: 'v2', name: 'view_image', args: { path: saved.path } }] },
        { toolCalls: [{ id: 'v3', name: 'view_image', args: { path: saved.path } }] },
        { toolCalls: [{ id: 'x', name: 'view_image', args: { path: '/etc/passwd' } }] },
        { text: '看到了' }
    ];
    const capable = { capable: true, describe: async () => assert.fail('a vision model sees the picture itself') };
    const events = [];
    const result = await agentLoop.runToolLoop({ write: event => events.push(event),
        client: { generateText: async options => { requests.push({ ...options, messages: options.messages.map(item => ({ ...item })) }); return script.shift(); } },
        systemPrompt: 'sys', messages: [{ role: 'user', content: '看图' }], tools: [], vision: capable, artifactOwner: 'default::alice', executeCall: async () => assert.fail('built-in')
    });
    assert.equal(result.text, '看到了');
    assert.deepEqual(events.find(event => event.type === 'tool_result' && event.callId === 'v1').images, [saved.path], 'the tool row shows a thumbnail of the picture');
    assert.ok(requests[0].tools.some(tool => tool.name === 'view_image'));
    const imageTurns = index => requests[index].messages.filter(message => message.images?.length).length;
    assert.equal(imageTurns(1), 1);
    assert.equal(imageTurns(3), 2, 'only the two most recent pictures are sent again');
    assert.match(requests[3].messages.find(message => /图片已移出上下文/.test(message.content || '')).content, /a\.png/);
    assert.match(requests[4].messages.at(-1).toolResults[0].content, /只能看本人上传的图片/);
    assert.equal(result.nonEphemeral.some(message => message.images), false, 'pictures never reach the saved transcript');

    const described = await agentLoop.runToolLoop({
        client: { generateText: async options => (options.messages.at(-1).role === 'tool' ? { text: options.messages.at(-1).toolResults[0].content } : { toolCalls: [{ id: 'v', name: 'view_image', args: { path: saved.path, question: '有字吗' } }] }) },
        systemPrompt: 'sys', messages: [{ role: 'user', content: '看图' }], tools: [], artifactOwner: 'default::alice',
        vision: { capable: false, describe: async (images, { question }) => `识别：${images[0].name} ${question}` }, executeCall: async () => null
    });
    assert.match(described.text, /看图模型对「a\.png」的识别结果）\n识别：a\.png 有字吗/);
    const noVision = await agentLoop.runToolLoop({ client: { generateText: async options => ({ text: options.tools.map(tool => tool.name).join(',') }) }, systemPrompt: 's', messages: [{ role: 'user', content: 'x' }], tools: [], executeCall: async () => null });
    assert.doesNotMatch(noVision.text, /view_image/, 'no view_image without a vision context');
});

test('image data is not counted as text, and redaction leaves it untouched', () => {
    const data = 'sk-'.padEnd(400000, 'A');
    const messages = [{ role: 'user', content: 'hi', images: [{ mimeType: 'image/png', data }] }];
    const estimate = contextStats.estimateRequest('', [], messages);
    assert.ok(estimate > 1000 && estimate < 3000, `about one image, got ${estimate}`);
    const redacted = redactValue(messages, { secrets: ['AAAAAAAA'] });
    assert.equal(redacted[0].images[0].data, data);
});

test('a text-only model gets the image model\'s description of each screenshot', async () => {
    const saved = await artifacts.saveUpload('default::alice', { originalname: 'shot.png', buffer: PNG });
    const script = [{ toolCalls: [{ id: 's', name: 'snap', args: {} }] }, { text: 'done' }];
    const requests = [];
    await agentLoop.runToolLoop({
        client: { generateText: async options => { requests.push({ ...options, messages: [...options.messages] }); return script.shift(); } },
        systemPrompt: 'sys', messages: [{ role: 'user', content: '截图' }], tools: [{ name: 'snap', description: 's', parameters: { type: 'object', properties: {} } }],
        vision: { capable: false, describe: async images => `深色背景，居中文字（${images[0].name}）` },
        executeCall: async () => ({ content: `截图已保存：${saved.path}`, summary: '截图', imagePaths: [saved.path] })
    });
    const result = requests[1].messages.at(-1).toolResults[0].content;
    assert.match(result, /看图模型对截图的识别结果）\n深色背景，居中文字（shot\.png）/);
    assert.equal(requests[1].messages.some(message => message.images), false, 'no image data for a text-only model');
});
