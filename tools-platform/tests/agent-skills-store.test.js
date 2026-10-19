const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-store-'));
process.env.TOOLS_DATA_DIR = temp;
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'report');

const JSZip = require('jszip');
const store = require('../backend/models/agent-skills-store');
const { runWithTenant } = require('../backend/models/tenant-context');
const { closeDatabase } = require('../backend/models/app-db');

test.after(async () => {
    await closeDatabase().catch(() => {});
    fs.rmSync(temp, { recursive: true, force: true });
});

const draft = (id, extra = '') => `---\nid: ${id}\nname: 周报助手\nname_en: Weekly report\ndescription: 生成周报\ndescription_en: Write a weekly report\nicon: 📅\nworkspace: false\n${extra}---\n\n# 周报\n\n目标：写周报。`;

async function skillZip(files) {
    const zip = new JSZip();
    Object.entries(files).forEach(([name, content]) => zip.file(name, content));
    return zip.generateAsync({ type: 'nodebuffer' });
}

test('a chat draft becomes a tenant Skill that can be @-mentioned like a built-in one', async () => {
    const saved = await store.createFromMarkdown(draft('weekly-report'), { createdBy: 'admin' });
    assert.deepEqual([saved.id, saved.name, saved.icon, saved.builtIn], ['weekly-report', '周报助手', '📅', false]);
    const ids = (await store.listAll()).map(item => item.id);
    assert.ok(ids.includes('weekly-report') && ids.includes('create-skill') && ids.includes('debug'));

    const loaded = await store.loadAll('帮我写本周的 @weekly-report，顺便 @nope');
    assert.deepEqual(loaded.selected.map(item => item.id), ['weekly-report']);
    assert.deepEqual(loaded.unknown, ['nope']);
    assert.match(loaded.prompt, /### @weekly-report\n# 周报/);
    assert.match(loaded.prompt, /不改变账号权限和审批模式/);
    assert.doesNotMatch(loaded.prompt, /name_en:|^---$/m);
});

test('ids are validated: built-in ids are reserved and duplicates need an explicit overwrite', async () => {
    await assert.rejects(store.createFromMarkdown(draft('debug')), { code: 'SKILL_ID_RESERVED', statusCode: 409 });
    await assert.rejects(store.createFromMarkdown(draft('weekly-report')), { code: 'SKILL_EXISTS', statusCode: 409 });
    const replaced = await store.createFromMarkdown(draft('weekly-report').replace('周报助手', '周报 2'), { overwrite: true });
    assert.equal(replaced.name, '周报 2');
    await assert.rejects(store.createFromMarkdown('---\nid: x\n---\n'), /缺少正文/);
    const slugged = await store.createFromMarkdown('---\nid: My Fancy Skill!\nname: 花式\n---\n\n步骤');
    assert.equal(slugged.id, 'my-fancy-skill');
});

test('standard Agent Skill packages import with reference files; binaries and metadata files are skipped', async () => {
    const buffer = await skillZip({
        'pdf-tools/SKILL.md': '---\nname: pdf-tools\ndescription: >\n  Extract text from PDFs\n  and fill forms.\n---\n\n# PDF\nSee references/guide.md',
        'pdf-tools/references/guide.md': '# Guide\nstep 1',
        'pdf-tools/logo.png': 'binary',
        '__MACOSX/._SKILL.md': 'junk'
    });
    const preview = await store.previewArchive(buffer, { archiveName: 'pdf-tools.zip' });
    assert.deepEqual([preview.id, preview.description, preview.fileCount, preview.skippedFiles, preview.exists], ['pdf-tools', 'Extract text from PDFs and fill forms.', 1, 1, false]);
    const imported = await store.importArchive(buffer, { overrides: { name: 'PDF 助手' } });
    assert.deepEqual([imported.id, imported.name, imported.source], ['pdf-tools', 'PDF 助手', 'import']);
    const loaded = await store.loadAll('@pdf-tools 提取文字');
    assert.match(loaded.prompt, /附带文件：references\/guide\.md/);

    const exported = await store.exportZip('pdf-tools');
    const back = await JSZip.loadAsync(exported.buffer);
    assert.deepEqual(Object.keys(back.files).filter(name => !name.endsWith('/')).sort(), ['pdf-tools/SKILL.md', 'pdf-tools/references/guide.md']);
    const roundTrip = await store.previewArchive(exported.buffer, { archiveName: exported.filename });
    assert.deepEqual([roundTrip.id, roundTrip.name, roundTrip.exists], ['pdf-tools', 'PDF 助手', true]);

    await assert.rejects(store.importArchive(await skillZip({ 'index.html': '<p>x</p>' })), { code: 'SKILL_MD_MISSING' });
    await assert.rejects(store.importArchive(Buffer.from('not a zip')), /无法读取压缩包/);
});

test('built-in Skills can be renamed and hidden without touching their files, and restored', async () => {
    await store.rename('debug', '故障排查');
    await store.remove('code-review');
    const visible = await store.listAll();
    assert.equal(visible.find(item => item.id === 'debug').name, '故障排查');
    assert.equal(visible.some(item => item.id === 'code-review'), false);
    assert.equal((await store.listAll({ includeHidden: true })).find(item => item.id === 'code-review').hidden, true);
    assert.equal((await store.loadAll('@code-review 看看', { hasWorkspace: true })).selected.length, 0, 'hidden Skills cannot be loaded');
    const md = await (await JSZip.loadAsync((await store.exportZip('debug')).buffer)).file('debug/SKILL.md').async('string');
    assert.match(md, /^name: 故障排查$/m);
    const source = fs.readFileSync(path.join(__dirname, '../backend/agent-skills/debug/SKILL.md'), 'utf8');
    assert.match(source, /^name: 排查故障$/m, 'source SKILL.md is unchanged');

    assert.ok(await store.restoreBuiltins() >= 1);
    const restored = await store.listAll();
    assert.equal(restored.find(item => item.id === 'debug').name, '排查故障');
    assert.ok(restored.some(item => item.id === 'code-review'));

    await store.remove('weekly-report');
    assert.equal((await store.listAll()).some(item => item.id === 'weekly-report'), false);
    await assert.rejects(store.remove('weekly-report'), { code: 'SKILL_NOT_FOUND' });
});

test('custom Skills that need a workspace keep the same guard as built-in ones', async () => {
    await store.createFromMarkdown(draft('repo-audit', '').replace('workspace: false', 'workspace: true'));
    await assert.rejects(store.loadAll('@repo-audit 检查'), { code: 'SKILL_WORKSPACE_REQUIRED' });
    assert.equal((await store.loadAll('@repo-audit 检查', { hasWorkspace: true })).selected[0].id, 'repo-audit');
});

test('custom Skills are isolated per tenant', async () => {
    await store.createFromMarkdown(draft('tenant-only'));
    await runWithTenant('acme', async () => {
        const ids = (await store.listAll()).map(item => item.id);
        assert.equal(ids.includes('tenant-only'), false);
        assert.ok(ids.includes('debug'), 'built-ins are available in every tenant');
        assert.equal((await store.loadAll('@tenant-only hi')).selected.length, 0);
    });
});

test('routes, home page and chat are wired to the Skill catalog', () => {
    const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.match(read('backend/server.js'), /app\.use\('\/api\/agent-skills', require\('\.\/routes\/agent-skills'\)\)/);
    assert.match(read('backend/routes/ai.js'), /agentSkillsStore\.loadAll\(/);
    const index = read('frontend/index.html');
    assert.match(index, /\/js\/home\/skills-tools\.js/);
    assert.match(index, /accept="[^"]*\.md/);
    assert.match(index, /\/api\/agent-skills\/preview/);
    assert.match(read('frontend/js/home/dragon-claw-skills.js'), /```skill/);
    assert.match(read('frontend/js/home/workspace.js'), /SKILLS_GROUP = '__skills'/);
    assert.ok(fs.existsSync(path.join(__dirname, '../backend/agent-skills/create-skill/SKILL.md')));
});
