const { readJSON } = require('./models/store');
const uploadHistoryRepo = require('./models/upload-history-repository');
const uivCategoriesRepo = require('./models/uiv-categories-repository');
const uivScriptsRepo = require('./models/uiv-scripts-repository');
const slaCategoriesRepo = require('./models/sla-categories-repository');
const slaGroupsRepo = require('./models/sla-groups-repository');
const slaSnapshotsRepo = require('./models/sla-snapshots-repository');
const slaTargetsRepo = require('./models/sla-targets-repository');
const slaPrefsRepo = require('./models/sla-prefs-repository');
const authUsersRepo = require('./models/auth-users-repository');
const authSessionsRepo = require('./models/auth-sessions-repository');

function sortObjectKeysDeep(value) {
    if (Array.isArray(value)) {
        return value.map(sortObjectKeysDeep);
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortObjectKeysDeep(value[key]);
        }
        return out;
    }
    return value;
}

function stringifyNormalized(value) {
    return JSON.stringify(sortObjectKeysDeep(value));
}

function countItems(value) {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return null;
}

function summarizeDiff(jsonValue, sqliteValue) {
    const jsonText = stringifyNormalized(jsonValue);
    const sqliteText = stringifyNormalized(sqliteValue);
    if (jsonText === sqliteText) return null;

    const maxLen = Math.min(jsonText.length, sqliteText.length);
    let idx = 0;
    while (idx < maxLen && jsonText[idx] === sqliteText[idx]) idx++;

    return {
        first_diff_index: idx,
        json_excerpt: jsonText.slice(Math.max(0, idx - 60), idx + 160),
        sqlite_excerpt: sqliteText.slice(Math.max(0, idx - 60), idx + 160)
    };
}

async function compareTable({ name, getJson, getSqlite }) {
    const jsonValue = await getJson();
    const sqliteValue = await getSqlite();
    const diff = summarizeDiff(jsonValue, sqliteValue);

    const summary = {
        table: name,
        match: !diff,
        json_count: countItems(jsonValue),
        sqlite_count: countItems(sqliteValue)
    };

    if (diff) {
        summary.diff = diff;
    }

    return summary;
}

async function main() {
    const comparisons = [
        {
            name: 'upload_history',
            getJson: async () => readJSON('upload_history.json', []),
            getSqlite: async () => (await uploadHistoryRepo.listHistory({ mode: 'sqlite', limit: 1000 })).items
        },
        {
            name: 'uiv_categories',
            getJson: async () => readJSON('uiv_categories.json', []),
            getSqlite: async () => (await uivCategoriesRepo.listCategories({ mode: 'sqlite' })).items
        },
        {
            name: 'uiv_scripts',
            getJson: async () => readJSON('uiv_scripts.json', []),
            getSqlite: async () => (await uivScriptsRepo.listScripts({ mode: 'sqlite' })).items
        },
        {
            name: 'sla_categories',
            getJson: async () => readJSON('sla_categories.json', []),
            getSqlite: async () => (await slaCategoriesRepo.listCategories({ mode: 'sqlite' })).items
        },
        {
            name: 'sla_groups',
            getJson: async () => readJSON('sla_groups.json', []),
            getSqlite: async () => (await slaGroupsRepo.listGroups({ mode: 'sqlite' })).items
        },
        {
            name: 'sla_snapshots',
            getJson: async () => readJSON('sla_snapshots.json', []),
            getSqlite: async () => (await slaSnapshotsRepo.listSnapshots({ mode: 'sqlite' })).items
        },
        {
            name: 'sla_targets',
            getJson: async () => readJSON('sla_targets.json', {}),
            getSqlite: async () => (await slaTargetsRepo.getTargets({ mode: 'sqlite' })).items
        },
        {
            name: 'sla_prefs',
            getJson: async () => readJSON('sla_prefs.json', {}),
            getSqlite: async () => (await slaPrefsRepo.getPrefsObject({ mode: 'sqlite' })).items
        },
        {
            name: 'auth_users',
            getJson: async () => readJSON('users.json', {}),
            getSqlite: async () => (await authUsersRepo.listUsers({ mode: 'sqlite' })).items
        },
        {
            name: 'auth_sessions',
            getJson: async () => readJSON('sessions.json', {}),
            getSqlite: async () => (await authSessionsRepo.listSessions({ mode: 'sqlite' })).items
        }
    ];

    const results = [];
    for (const item of comparisons) {
        results.push(await compareTable(item));
    }

    console.log(JSON.stringify({
        checked_at: new Date().toISOString(),
        results
    }, null, 2));

    const failed = results.filter(item => !item.match);
    process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
