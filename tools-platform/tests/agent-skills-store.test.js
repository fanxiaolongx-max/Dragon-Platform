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
    assert.ok(fs.existsSync(path.join(__dirname, '../backend/agent-skills/improve-skill/SKILL.md')));
});

test('skills can be improved with automatic backups and rolled back', async () => {
    // 1. 自定义技能完善与回退
    const v1 = draft('audit-tool', '').replace('周报助手', '审计初版');
    await store.createFromMarkdown(v1, { createdBy: 'alice' });

    // 完善技能（覆盖保存，应自动备份 v1）
    const v2 = v1.replace('审计初版', '审计完善版 v2').replace('目标：写周报。', '目标：执行整改与深度审计流程。');
    const updated = await store.createFromMarkdown(v2, { createdBy: 'bob', overwrite: true });
    assert.equal(updated.name, '审计完善版 v2');

    // 检查备份列表
    const backups = await store.listBackups('audit-tool');
    assert.ok(backups.length >= 1, 'v1 should be backed up');
    assert.equal(backups[0].name, '审计初版');
    assert.match(backups[0].summary, /完善技能前自动备份/);

    // 再次完善到 v3
    const v3 = v2.replace('审计完善版 v2', '审计超强版 v3');
    await store.createFromMarkdown(v3, { createdBy: 'carol', overwrite: true });

    const backupsV3 = await store.listBackups('audit-tool');
    assert.equal(backupsV3.length, 2);
    assert.equal(backupsV3[0].name, '审计完善版 v2');
    assert.equal(backupsV3[1].name, '审计初版');

    // 读取某个备份详情
    const v1Backup = await store.getBackup('audit-tool', backupsV3[1].id);
    assert.equal(v1Backup.name, '审计初版');
    assert.match(v1Backup.body, /目标：写周报。/);

    // 回退到 v1
    const rolledBack = await store.rollback('audit-tool', backupsV3[1].id, { createdBy: 'alice' });
    assert.equal(rolledBack.name, '审计初版');
    assert.match(rolledBack.body, /目标：写周报。/);

    // 回退前自动留下了备份（v3 变成了新的最新备份）
    const backupsAfterRollback = await store.listBackups('audit-tool');
    assert.equal(backupsAfterRollback.length, 3);
    assert.equal(backupsAfterRollback[0].name, '审计超强版 v3');
    assert.match(backupsAfterRollback[0].summary, /回退到备份/);
});

test('built-in skills can be customized with automatic backup of pristine version and reset to default', async () => {
    // 未加 overwrite 时依旧保护保留标识
    await assert.rejects(store.createFromMarkdown(draft('debug')), { code: 'SKILL_ID_RESERVED' });

    // 完善/覆盖内置技能（加 overwrite: true）
    const improvedDebug = draft('debug').replace('周报助手', '增强排查').replace('目标：写周报。', '目标：结合整改和网络探查进行快速定位。');
    const customized = await store.createFromMarkdown(improvedDebug, { createdBy: 'operator', overwrite: true });
    assert.equal(customized.builtIn, true);
    assert.equal(customized.customized, true);

    // 目录中显示已自定义
    const debugInCatalog = (await store.listAll()).find(item => item.id === 'debug');
    assert.equal(debugInCatalog.name, '增强排查');
    assert.equal(debugInCatalog.customized, true);

    // 对话加载使用的是完善后的自定义正文
    const loaded = await store.loadAll('@debug 查看问题', { hasWorkspace: true });
    assert.match(loaded.prompt, /结合整改和网络探查进行快速定位/);

    // 自动备份了内置初始版本
    const debugBackups = await store.listBackups('debug');
    assert.ok(debugBackups.length >= 1);
    assert.match(debugBackups[0].summary, /内置初始版本/);

    // 恢复内置技能默认版本
    const reset = await store.resetToBuiltin('debug', { createdBy: 'operator' });
    assert.equal(reset.customized, false);
    assert.match(reset.body, /排查故障/);

    // 目录中恢复为未自定义
    const debugAfterReset = (await store.listAll()).find(item => item.id === 'debug');
    assert.equal(debugAfterReset.customized, false);

    // 对话加载恢复为内置正文
    const loadedAfterReset = await store.loadAll('@debug 查看问题', { hasWorkspace: true });
    assert.match(loadedAfterReset.prompt, /排查故障/);
});
