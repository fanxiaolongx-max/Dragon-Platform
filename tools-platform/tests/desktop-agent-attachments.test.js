const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('desktop history preserves local images/files without exposing hidden prompts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-attachments-'));
    const previous = process.env.TOOLS_DESKTOP_AGENT_HOME;
    process.env.TOOLS_DESKTOP_AGENT_HOME = root;
    try {
        const dir = path.join(root, '.codex/sessions');
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, 'fixture.jsonl');
        const messages = [
            { role: 'user', content: [{ type: 'input_text', text: '# Files mentioned by the user:\n\n## report.pdf: /tmp/report.pdf\n\n## My request:\n看看附件\n<image name=[Image #1] path="/tmp/a &amp; b.png"></image>' }] },
            { role: 'user', content: [{ type: 'local_image', path: '/tmp/only.png' }] },
            { role: 'user', content: [{ type: 'input_text', text: '<environment_context>secret <image path="/tmp/hidden.png"></image></environment_context>' }] },
            { role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: '已完成' }] },
            { role: 'user', content: [{ type: 'input_text', text: '<image name=[Image #2] path="https://example.com/test.png"></image>' }] }
        ];
        await fs.writeFile(file, messages.map(payload => JSON.stringify({ type: 'response_item', payload: { type: 'message', ...payload } })).join('\n'));
        const { items } = await require('../backend/models/desktop-agents/catalog').transcript({ provider: 'codex', file });
        assert.equal(items.length, 4);
        assert.equal(items[0].content, '看看附件');
        assert.deepEqual(items[0].attachments.map(x => x.path), ['/tmp/a & b.png', '/tmp/report.pdf']);
        assert.equal(items[1].attachments[0].path, '/tmp/only.png');
        assert.equal(items[2].content, '已完成');
        assert.equal(items[3].attachments, undefined);
        const project = path.join(root, '.claude/projects/fixture');
        await fs.mkdir(project, { recursive: true });
        await fs.writeFile(path.join(project, 'claude.jsonl'), JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Image: source: /tmp/claude.png]' }] } }));
        const claude = await require('../backend/models/desktop-agents/catalog').transcript({ provider: 'claudecode', nativeId: 'claude' });
        assert.equal(claude.items[0].attachments[0].path, '/tmp/claude.png');
    } finally {
        if (previous === undefined) delete process.env.TOOLS_DESKTOP_AGENT_HOME;
        else process.env.TOOLS_DESKTOP_AGENT_HOME = previous;
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('Claude inline images become previewable local attachments on the correct message', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-image-history-'));
    const previous = process.env.TOOLS_DESKTOP_AGENT_HOME;
    process.env.TOOLS_DESKTOP_AGENT_HOME = root;
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
    const block = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') } };
    let cached;
    try {
        const folder = path.join(root, '.claude/projects/fixture');
        await fs.mkdir(folder, { recursive: true });
        const events = [
            { type: 'user', uuid: 'u', message: { role: 'user', content: [{ type: 'text', text: '看这张图片' }, block] } },
            { type: 'assistant', uuid: 'a', message: { role: 'assistant', content: [block] } },
            { type: 'user', isMeta: true, message: { role: 'user', content: [block] } },
            { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: [block] }] } },
            { type: 'user', uuid: 'bad', message: { role: 'user', content: [{ type: 'text', text: '文字保留' }, { type:'image', source:{type:'base64',media_type:'image/png',data:'not-an-image'} }] } }
        ];
        await fs.writeFile(path.join(folder, 'images.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));
        const catalog = require('../backend/models/desktop-agents/catalog');
        const session = { provider: 'claudecode', nativeId: 'images' };
        const first = await catalog.transcript(session), second = await catalog.transcript(session);
        assert.deepEqual(first.items.map(i => [i.id,i.role]), [['u','user'],['a','assistant'],['bad','user']]);
        cached = first.items[0].attachments[0].path;
        assert.deepEqual(await fs.readFile(cached), image);
        assert.equal(first.items[1].attachments[0].path, cached, 'identical bytes reuse a cache file, keeping the assistant role');
        assert.equal(second.items[0].attachments[0].path, cached, 'polls retain stable paths');
        assert.equal(first.items[2].attachments, undefined);
        assert.equal(JSON.stringify(first).includes(image.toString('base64')), false);
        const { materialize } = require('../backend/models/desktop-agents/claude-images');
        assert.equal(await materialize({type:'base64',media_type:'image/svg+xml',data:Buffer.from('<svg/>').toString('base64')}), null);
        assert.equal(await materialize({type:'base64',media_type:'image/jpeg',data:image.toString('base64')}), null);
    } finally {
        if (previous === undefined) delete process.env.TOOLS_DESKTOP_AGENT_HOME;
        else process.env.TOOLS_DESKTOP_AGENT_HOME = previous;
        await fs.rm(root, { recursive: true, force: true });
        if (cached) await fs.unlink(cached).catch(() => {});
    }
});
