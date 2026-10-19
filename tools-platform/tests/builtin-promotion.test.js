const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 全部指向临时目录：「转为内置」不能改动仓库里的 builtin-tools / agent-skills / builtin-scripts
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-promotion-'));
const dirs = {
    data: path.join(temp, 'data'),
    report: path.join(temp, 'report'),
    tools: path.join(temp, 'builtin-tools'),
    skills: path.join(temp, 'agent-skills'),
    scripts: path.join(temp, 'builtin-scripts')
};
fs.mkdirSync(dirs.tools, { recursive: true });
fs.cpSync(path.join(__dirname, '../backend/agent-skills'), dirs.skills, { recursive: true });
process.env.TOOLS_DATA_DIR = dirs.data;
process.env.TOOLS_REPORT_DATA_DIR = dirs.report;
process.env.TOOLS_BUILTIN_TOOLS_DIR = dirs.tools;
process.env.TOOLS_AGENT_SKILLS_DIR = dirs.skills;
process.env.TOOLS_BUILTIN_SCRIPTS_DIR = dirs.scripts;

const promotion = require('../backend/models/builtin-promotion');
const customTools = require('../backend/models/custom-tools-repository');
const toolSync = require('../backend/models/builtin-tools-sync');
const skillStore = require('../backend/models/agent-skills-store');
const builtinSkills = require('../backend/models/agent-skills');
const bundled = require('../backend/models/bundled-scripts');
const f12Presets = require('../backend/models/f12-script-presets-repository');
const pythonScripts = require('../backend/models/python-script-repository');
const { runWithTenant } = require('../backend/models/tenant-context');
const { closeDatabase } = require('../backend/models/app-db');

test.after(async () => {
    await closeDatabase().catch(() => {});
    fs.rmSync(temp, { recursive: true, force: true });
});

const repoRoot = path.join(__dirname, '..');
test('the real source directories are not touched by this test', () => {
    assert.equal(customTools.BUILTIN_TOOLS_DIR, dirs.tools);
    assert.equal(builtinSkills.SKILLS_DIR, dirs.skills);
    assert.equal(bundled.ROOT, dirs.scripts);
    assert.equal(promotion.status().writable, true);
});

test('a custom HTML tool becomes a managed built-in, ships to other tenants, and can be demoted again', async () => {
    const created = await customTools.createTool({ name: '采购比价', icon: '💹', description: '比较报价', htmlContent: '<!doctype html><html><body>quote</body></html>' });
    const slug = created.slug;
    assert.equal((await customTools.getTool(slug)).builtIn, false);

    const promoted = await promotion.promote('tool', slug);
    assert.equal(promoted.builtIn, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(dirs.tools, slug, '.tool-manifest.json'), 'utf8'));
    assert.deepEqual([manifest.version, manifest.tool.slug, manifest.tool.name, manifest.history], [1, slug, '采购比价', null]);
    assert.equal(manifest.builtIn, undefined, 'source manifest carries no runtime flags');
    assert.equal((await customTools.getTool(slug)).builtIn, true);
    // 当前租户的运行副本已是受管内置，启动同步不会再提示差异
    const source = toolSync.validateBundledTool(dirs.tools, slug);
    assert.equal(toolSync.compareBundledTool(source, customTools.getCustomToolsDir()).status, 'unchanged');
    await assert.rejects(promotion.promote('tool', slug), { code: 'ALREADY_BUILTIN' });

    // 其他租户初始化时自动安装
    await runWithTenant('acme', async () => {
        const installed = toolSync.initializeBuiltinTools({ sourceDir: dirs.tools, targetDir: customTools.getCustomToolsDir(), stateFile: path.join(dirs.data, 'tenants/acme/decisions.json') });
        assert.deepEqual(installed.installed, [slug]);
    });

    const demoted = await promotion.demote('tool', slug);
    assert.equal(demoted.builtIn, false);
    assert.equal(fs.existsSync(path.join(dirs.tools, slug)), false);
    assert.ok(fs.existsSync(path.join(demoted.backup, 'index.html')), 'source is backed up before removal');
    const tool = await customTools.getTool(slug);
    assert.equal(tool.builtIn, false, 'tool stays usable as a custom tool');
    assert.ok(fs.existsSync(path.join(customTools.getCustomToolsDir(), slug, 'index.html')));
    const acmeManifest = JSON.parse(fs.readFileSync(path.join(dirs.data, 'tenants/acme/custom-tools', slug, '.tool-manifest.json'), 'utf8'));
    assert.equal(acmeManifest.builtIn, undefined, 'other tenants lose the built-in flag too');
    await assert.rejects(promotion.demote('tool', slug), { code: 'NOT_BUILTIN' });
});

test('a custom Skill becomes a built-in SKILL.md (with its files) and back', async () => {
    const zipSkill = '---\nid: weekly-report\nname: 周报助手\nname_en: Weekly report\ndescription: 生成周报\ndescription_en: Weekly report\nicon: 📅\nworkspace: false\n---\n\n# 周报\n\n目标：写周报。';
    await skillStore.createFromMarkdown(zipSkill);
    const promoted = await promotion.promote('skill', 'weekly-report');
    assert.equal(promoted.builtIn, true);
    const raw = fs.readFileSync(path.join(dirs.skills, 'weekly-report/SKILL.md'), 'utf8');
    assert.match(raw, /^name: 周报助手$/m);
    assert.match(raw, /^icon: 📅$/m);
    const listed = (await skillStore.listAll()).filter(item => item.id === 'weekly-report');
    assert.equal(listed.length, 1, 'no duplicate custom row');
    assert.equal(listed[0].builtIn, true);
    assert.equal((await skillStore.loadAll('@weekly-report 本周')).selected[0].id, 'weekly-report');
    await runWithTenant('acme', async () => {
        assert.ok((await skillStore.listAll()).some(item => item.id === 'weekly-report' && item.builtIn), 'built-ins are shared by every tenant');
    });

    const demoted = await promotion.demote('skill', 'weekly-report');
    assert.equal(demoted.builtIn, false);
    assert.equal(fs.existsSync(path.join(dirs.skills, 'weekly-report')), false);
    const custom = await skillStore.getCustom('weekly-report');
    assert.deepEqual([custom.name, custom.icon, custom.builtIn], ['周报助手', '📅', false]);
    assert.match(custom.body, /目标：写周报/);
    await runWithTenant('acme', async () => {
        assert.equal((await skillStore.listAll()).some(item => item.id === 'weekly-report'), false);
    });
});

test('F12 server scripts and Python scripts are exported to bundled files and seeded into new tenants', async () => {
    const preset = await f12Presets.savePreset({ name: '千聊提取', description: '提取', matches: 'https://example.com/*', code: 'console.log(1)' });
    await pythonScripts.saveScript({ id: 'excel-dedupe', name: 'Excel 去重', description: '按列去重', version: '1.2.0', code: 'print(1)' });

    await promotion.promote('f12', preset.id);
    await promotion.promote('python', 'excel-dedupe');
    assert.ok(bundled.bundledIds('f12').has(preset.id));
    assert.ok(bundled.bundledIds('python').has('excel-dedupe'));
    await assert.rejects(promotion.promote('python', pythonScripts.DEFAULT_SCRIPT_ID), { code: 'ALREADY_BUILTIN' });
    await assert.rejects(promotion.demote('python', pythonScripts.DEFAULT_SCRIPT_ID), { code: 'NOT_BUILTIN' });

    await runWithTenant('acme', async () => {
        await bundled.ensureSeeded();
        const seeded = await f12Presets.getPreset(preset.id);
        assert.deepEqual([seeded.name, seeded.code], ['千聊提取', 'console.log(1)']);
        const script = await pythonScripts.getScript('excel-dedupe');
        assert.deepEqual([script.name, script.current_version, script.code], ['Excel 去重', '1.2.0', 'print(1)']);
    });

    // 用户改过的同名脚本不会被内置版本覆盖
    await runWithTenant('beta', async () => {
        await f12Presets.savePreset({ name: '千聊提取', matches: 'https://mine.example/*', code: 'mine()' });
        await bundled.ensureSeeded();
        const mine = (await f12Presets.listPresets()).filter(item => item.name === '千聊提取');
        assert.deepEqual(mine.map(item => item.code), ['mine()']);
    });

    await promotion.demote('f12', preset.id);
    await promotion.demote('python', 'excel-dedupe');
    assert.equal(bundled.bundledIds('f12').size + bundled.bundledIds('python').size, 0);
    assert.ok(await f12Presets.getPreset(preset.id), 'demoting keeps the tenant copy');
});

test('core built-in tools that platform features depend on cannot be demoted', async () => {
    fs.cpSync(path.join(__dirname, '../backend/builtin-tools/python-updater'), path.join(dirs.tools, 'python-updater'), { recursive: true });
    await assert.rejects(promotion.demote('tool', 'python-updater'), { code: 'BUILTIN_LOCKED' });
    assert.ok(fs.existsSync(path.join(dirs.tools, 'python-updater/index.html')));
    assert.deepEqual(promotion.status().lockedTools.sort(), ['f12-to-extension', 'python-updater']);
});

test('unsupported kinds, bad ids and read-only sources are rejected', async () => {
    await assert.rejects(promotion.promote('uiv', 'x'), /不支持/);
    await assert.rejects(promotion.promote('tool', '../etc'), /无效的工具标识/);
    await assert.rejects(promotion.promote('python', '../../x'), /无效的脚本标识/);
    assert.equal(fs.existsSync(path.join(repoRoot, 'backend/builtin-scripts/f12', '../../x.json')), false);
});
