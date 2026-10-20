const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-tool-snapshot-'));
process.env.TOOLS_DATA_DIR = temp;

const db = require('../backend/models/app-db');
const surveys = require('../backend/models/survey-repository');
const presets = require('../backend/models/f12-script-presets-repository');
const snapshot = require('../backend/models/catalog-tool-snapshot');
const f12Snapshot = require('../backend/models/f12-static-packer');
const packer = require('../backend/builtin-tools/f12-to-extension/packer-core');
const JSZip = require('jszip');
const publishing = require('../backend/models/snapshot-publish-service');

test.after(async () => {
    await db.closeDatabase();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('both tools are registered but disabled by default', async () => {
    const settings = await publishing.getSettings();
    for (const slug of ['tool-mqp55fna', 'f12-to-extension']) {
        assert.ok(publishing.providers.has(slug));
        assert.equal(settings.tools.find(tool => tool.toolSlug === slug).enabled, false);
    }
});

test('survey snapshot includes every record and uses a self-contained read-only page', async () => {
    const template = await surveys.saveTemplate({ id: 'snapshot-survey', name: '快照表', fields: [{ key: 'answer', label: '答复', type: 'text' }] });
    for (let i = 0; i < 501; i++) await surveys.createSubmission({ templateId: template.id, answers: { answer: `reply-${i}` } }, 'tester');
    const output = await snapshot.buildPagesSnapshot('tool-mqp55fna', 'default');
    const data = JSON.parse(output.files.get('data/surveys.json'));
    assert.equal(data.submissions.length, 501);
    assert.equal(data.templates.find(item => item.id === template.id).name, '快照表');
    assert.doesNotMatch(output.html, /reply-500/);
    assert.match(output.html, /cache:'no-store'/);
    const single = await snapshot.buildSnapshot('tool-mqp55fna', 'default');
    assert.match(single, /reply-500/);
    assert.doesNotMatch(single, /\/api\/surveys/);
    for (const source of [...single.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])) new vm.Script(source);
});

test('F12 snapshot carries saved and built-in scripts plus offline packer assets', async () => {
    await presets.savePreset({ name: 'Snapshot Script', description: 'safe description', matches: 'https://private.example/*', code: 'console.log("saved script");', world: 'MAIN' });
    const output = await f12Snapshot.buildPagesSnapshot('default');
    const data = JSON.parse(output.files.get('data/f12-presets.json'));
    const saved = data.saved.find(item => item.name === 'Snapshot Script');
    assert.equal(saved.code, 'console.log("saved script");');
    assert.equal(saved.matches, 'https://private.example/*');
    assert.ok(data.builtins.find(item => item.id === 'sv-cfc-monitor').code.length > 100);
    const rfc = data.builtins.find(item => item.id === 'netcare-rfc-word');
    assert.equal(rfc.world, 'MAIN');
    assert.equal(rfc.allFrames, true);
    assert.equal(rfc.manualLaunch, true);
    assert.equal(rfc.includePopup, true);
    const rfcPackage = packer.buildPackage({ ...rfc, version: '1.0.0', license: { enabled: false } });
    assert.equal(rfcPackage.manifest.content_scripts[0].all_frames, true);
    assert.ok(data.builtins.find(item => item.id === 'chrome-capture-pro').isFullExtension);
    assert.ok(data.builtins.find(item => item.id === 'ppo-traffic-autofill').isFullExtension);
    assert.ok(output.files.get('data/chrome-capture-pro.template.zip').length > 100000);
    assert.ok(output.files.get('data/ppo-traffic-autofill.template.zip').length > 100000);
    assert.ok(output.files.has('data/assets/packer-core.js'));
    assert.ok(output.files.has('data/assets/exam-store-guide.js'));
    assert.match(output.html, /examStoreGuideActions/);
    assert.ok(output.files.has('data/assets/jszip.min.js'));
    assert.ok(output.files.has('data/assets/static-packer-runtime.js'));
    const single = await f12Snapshot.buildSnapshot('default');
    assert.match(single, /EXAM_STORE_SUBMISSION_GUIDE\.md/);
    assert.match(single, /Snapshot Script/);
    assert.match(single, /saved script/);
    assert.match(single, /templateBase64/);
    assert.doesNotMatch(output.html, /\/api\/custom-tools/);
    for (const source of [...single.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])) new vm.Script(source);

    const generated = packer.buildPackage({
        name: saved.name, version: '1.0.0', description: saved.description, matches: saved.matches,
        world: saved.world, code: saved.code, packageTarget: 'store', license: { enabled: false }
    });
    const zip = new JSZip();
    for (const [name, content] of Object.entries(generated.files)) zip.file(name, content);
    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    assert.equal(JSON.parse(await reopened.file('manifest.json').async('string')).manifest_version, 3);
    assert.equal(await reopened.file('content.js').async('string'), saved.code);
});

test('scoped Pages publishing encrypts surveys and excludes script/plugin tools', async () => {
    const bare = path.join(temp, 'remote.git');
    const mirror = path.join(temp, 'mirror');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', bare]);
    execFileSync('git', ['clone', bare, mirror]);
    fs.writeFileSync(path.join(mirror, 'keep.txt'), 'keep');
    execFileSync('git', ['-C', mirror, 'add', 'keep.txt']);
    execFileSync('git', ['-C', mirror, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
    execFileSync('git', ['-C', mirror, 'push', '-u', 'origin', 'HEAD:main']);
    await publishing.saveSettings({ repoDir: mirror, branch: 'main', file: '{toolSlug}/index.html', publishMode: 'pages' });
    for (const slug of ['tool-mqp55fna']) {
        const started = await publishing.startJob('default', { toolSlug: slug });
        let job;
        for (let attempt = 0; attempt < 100; attempt++) {
            job = await publishing.getJob(started.id);
            if (job.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(job.status, 'success', JSON.stringify(job.entries));
    }
    const files = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main']).toString();
    const portal = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:tp-static/site.json']).toString());
    assert.ok(portal.files['tool-mqp55fna/data/surveys.json']);
    assert.doesNotMatch(files, /f12-to-extension/);
    const excluded = await publishing.startJob('default', { toolSlug: 'f12-to-extension' });
    let job;
    for (let i = 0; i < 100; i++) { job = await publishing.getJob(excluded.id); if (job.status !== 'running') break; await new Promise(r => setTimeout(r, 30)); }
    assert.equal(job.status, 'failed');
    assert.ok(job.entries.some(entry => entry.message.includes('脚本与插件')));
});
