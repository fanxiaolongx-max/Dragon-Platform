const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const STALE_PLACEHOLDERS = [
    '更新提示改为简洁弹窗，支持浅色与深色主题。',
    'Compact update dialogs with light and dark theme support.'
];

function validateReleaseNotesStructure(notes) {
    assert.ok(notes && typeof notes === 'object', 'release-notes.json must be a JSON object');
    assert.ok(Array.isArray(notes.zh) && notes.zh.length >= 1, 'release-notes.json must have non-empty "zh" array');
    assert.ok(Array.isArray(notes.en) && notes.en.length >= 1, 'release-notes.json must have non-empty "en" array');

    for (const item of notes.zh) {
        assert.equal(typeof item, 'string', 'each item in "zh" must be a string');
        assert.ok(item.trim().length >= 6, `each item in "zh" must describe real changes (min 6 chars): "${item}"`);
    }

    for (const item of notes.en) {
        assert.equal(typeof item, 'string', 'each item in "en" must be a string');
        assert.ok(item.trim().length >= 6, `each item in "en" must describe real changes (min 6 chars): "${item}"`);
    }
}

function checkNoStalePlaceholders(notes) {
    const zhText = notes.zh.join('\n');
    const enText = notes.en.join('\n');
    for (const stale of STALE_PLACEHOLDERS) {
        assert.ok(!zhText.includes(stale), `release-notes.json must not reuse stale placeholder note: "${stale}"`);
        assert.ok(!enText.includes(stale), `release-notes.json must not reuse stale placeholder note: "${stale}"`);
    }
}

function getPreviousReleaseNotes(repoRoot) {
    try {
        const commit = execSync('git log --grep="chore: release v" -n 1 --format="%H"', {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (commit) {
            try {
                const content = execSync(`git show ${commit}:tools-platform/frontend/assets/release-notes.json`, {
                    cwd: repoRoot,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                });
                return { ref: commit.slice(0, 8), notes: JSON.parse(content) };
            } catch (_) {
                const content = execSync(`git show ${commit}:frontend/assets/release-notes.json`, {
                    cwd: repoRoot,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                });
                return { ref: commit.slice(0, 8), notes: JSON.parse(content) };
            }
        }
    } catch (_) {}

    try {
        const tag = execSync('git tag -l "v*" --sort=-v:refname', {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim().split('\n')[0];
        if (tag) {
            try {
                const content = execSync(`git show ${tag}:tools-platform/frontend/assets/release-notes.json`, {
                    cwd: repoRoot,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                });
                return { ref: tag, notes: JSON.parse(content) };
            } catch (_) {
                const content = execSync(`git show ${tag}:frontend/assets/release-notes.json`, {
                    cwd: repoRoot,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                });
                return { ref: tag, notes: JSON.parse(content) };
            }
        }
    } catch (_) {}

    return null;
}

const notesFile = path.resolve(__dirname, '../frontend/assets/release-notes.json');
const repoRoot = path.resolve(__dirname, '../..');

test('release-notes.json exists and satisfies schema & quality constraints', () => {
    assert.ok(fs.existsSync(notesFile), 'frontend/assets/release-notes.json must exist');
    const raw = fs.readFileSync(notesFile, 'utf8');
    let notes;
    assert.doesNotThrow(() => { notes = JSON.parse(raw); }, 'release-notes.json must be valid JSON');
    validateReleaseNotesStructure(notes);
});

test('release-notes.json must not use stale historical default placeholder notes', () => {
    const notes = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
    checkNoStalePlaceholders(notes);
});

test('release-notes.json must be updated and differ from previous release in git', () => {
    const currentNotes = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
    const previous = getPreviousReleaseNotes(repoRoot);
    if (!previous) {
        // In environments without git history or prior releases, skip diff check
        return;
    }

    const currentZh = currentNotes.zh.map(s => s.trim()).join('\n');
    const previousZh = (previous.notes?.zh || []).map(s => s.trim()).join('\n');
    const currentEn = currentNotes.en.map(s => s.trim()).join('\n');
    const previousEn = (previous.notes?.en || []).map(s => s.trim()).join('\n');

    assert.notEqual(
        currentZh,
        previousZh,
        `release-notes.json (zh) must be updated for this release and cannot be identical to previous release (${previous.ref}). Please write real, concise update points.`
    );
    assert.notEqual(
        currentEn,
        previousEn,
        `release-notes.json (en) must be updated for this release and cannot be identical to previous release (${previous.ref}). Please write real, concise update points.`
    );
});

test('validateReleaseNotes helper correctly catches empty, stale, or unchanged notes', () => {
    assert.throws(() => validateReleaseNotesStructure({ zh: [], en: ['Valid note here.'] }));
    assert.throws(() => validateReleaseNotesStructure({ zh: ['有效说明。'], en: [] }));
    assert.throws(() => validateReleaseNotesStructure({ zh: ['短'], en: ['Valid note here.'] }));
    assert.throws(() => checkNoStalePlaceholders({
        zh: ['更新提示改为简洁弹窗，支持浅色与深色主题。'],
        en: ['Something else entirely.']
    }));
});
