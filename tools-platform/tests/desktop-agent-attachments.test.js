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
