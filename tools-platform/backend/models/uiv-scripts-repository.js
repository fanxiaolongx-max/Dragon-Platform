const { run, get, all } = require('./app-db');
const { v4: uuidv4 } = require('uuid');


let initPromise = null;

async function replaceScriptsInDbRaw(scripts) {
    await run('BEGIN TRANSACTION');
    try {
        await run('DELETE FROM uiv_scripts');
        for (const script of scripts) {
            await run(
                `INSERT INTO uiv_scripts (id, name, category, url, payload_json, updated_at)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [
                    script.id,
                    script.name,
                    script.category || '',
                    script.url || '',
                    JSON.stringify(script)
                ]
            );
        }
        await run('COMMIT');
    } catch (err) {
        await run('ROLLBACK').catch(() => {});
        throw err;
    }
}

async function ensureReady() {
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS uiv_scripts (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    category TEXT,
                    url TEXT,
                    payload_json TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            const row = await get('SELECT COUNT(1) AS count FROM uiv_scripts');
            if (row && row.count > 0) return;

            
        })().catch(err => {
            initPromise = null;
            throw err;
        });
    }

    return initPromise;
}

function normalizeScript(item) {
    const normalized = { ...item };
    if (!normalized.id) {
        normalized.id = 'script_' + uuidv4().replace(/-/g, '').slice(0, 9);
        normalized.createdAt = new Date().toISOString();
        normalized.updatedAt = new Date().toISOString();
    }
    return normalized;
}

async function listFromDb() {
    await ensureReady();
    const rows = await all(`
        SELECT payload_json
        FROM uiv_scripts
        ORDER BY rowid ASC
    `);
    return rows.map(row => {
        try {
            return JSON.parse(row.payload_json);
        } catch(e) {
            console.error('[uiv-scripts] Bad JSON payload in DB:', e.message);
            return null;
        }
    }).filter(Boolean);
}

async function listScripts() {
    const items = await listFromDb();
    return { items, source: 'sqlite' };
}

async function upsertScriptInDb(script) {
    await ensureReady();
    await run(
        `INSERT INTO uiv_scripts (id, name, category, url, payload_json, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            url = excluded.url,
            payload_json = excluded.payload_json,
            updated_at = CURRENT_TIMESTAMP`,
        [
            script.id,
            script.name,
            script.category || '',
            script.url || '',
            JSON.stringify(script)
        ]
    );
}

async function replaceScriptsInDb(scripts) {
    await ensureReady();
    await replaceScriptsInDbRaw(scripts);
}

async function saveScripts(items) {
    const incoming = Array.isArray(items) ? items.map(normalizeScript) : [];

    try {
        for (const item of incoming) {
            item.updatedAt = new Date().toISOString();
            await upsertScriptInDb(item);
        }
    } catch (err) {
        console.error('[uiv-scripts] SQLite save failed:', err.message);
    }

    return incoming;
}

async function deleteScriptById(id) {
    try {
        await ensureReady();
        await run('DELETE FROM uiv_scripts WHERE id = ?', [id]);
    } catch (err) {
        console.error('[uiv-scripts] SQLite delete sync failed:', err.message);
    }
    return [];
}

async function moveScriptCategory(id, category) {
    await ensureReady();
    const row = await get('SELECT payload_json FROM uiv_scripts WHERE id = ?', [id]);
    if (!row) return null;

    const script = JSON.parse(row.payload_json);
    script.category = category;
    script.updatedAt = new Date().toISOString();

    await upsertScriptInDb(script);

    return script;
}

function generateSchemaHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

function getCandidateBaseNames(name) {
    const clean = String(name || '').trim().replace(/\.csv$/i, '');
    const set = new Set();
    if (clean) {
        set.add(clean);
        if (clean.endsWith('_Latest')) {
            set.add(clean.replace(/_Latest$/, ''));
        } else {
            set.add(`${clean}_Latest`);
        }
    }
    return Array.from(set);
}

async function syncRulesOnScriptRename(oldName, cleanNewName) {
    if (!oldName || !cleanNewName || oldName === cleanNewName) {
        return { synced: false, count: 0 };
    }

    const oldCandidates = getCandidateBaseNames(oldName);
    const oldCandidateHashes = oldCandidates.map(c => generateSchemaHash(c));
    const oldCandidatePrefKeys = new Set(oldCandidateHashes.map(h => `sla_prefs_other_${h}`));

    const cleanNewBase = cleanNewName.replace(/\.csv$/i, '');
    const newBaseName = /_Latest$/i.test(cleanNewBase) ? cleanNewBase : `${cleanNewBase}_Latest`;
    const newHash = generateSchemaHash(newBaseName);
    const newPrefKey = `sla_prefs_other_${newHash}`;
    const newSecId = `other_${newHash}`;

    let syncedCount = 0;

    try {
        // 1. Sync matching preferences in sla_prefs
        const rows = await all("SELECT pref_key, pref_kind, payload_json FROM sla_prefs WHERE pref_key LIKE 'sla_prefs_other_%'");
        const matchingRows = [];

        for (const row of rows) {
            let payload;
            try {
                payload = JSON.parse(row.payload_json);
            } catch (_) {
                continue;
            }

            const meta = payload?._sourceMeta || {};
            const matchesKey = oldCandidatePrefKeys.has(row.pref_key);
            const matchesMetaBase = oldCandidates.includes(meta.baseName);
            const matchesFiles = Array.isArray(meta.sourceFiles) && meta.sourceFiles.some(f => oldCandidates.some(c => f.startsWith(c)));
            const matchesPrefix = meta.matchedPrefix && oldCandidates.some(c => meta.matchedPrefix.startsWith(c));
            const matchesTitle = meta.title && oldCandidates.some(c => meta.title.includes(c));

            if (matchesKey || matchesMetaBase || matchesFiles || matchesPrefix || matchesTitle) {
                matchingRows.push({ row, payload });
            }
        }

        for (const { row, payload } of matchingRows) {
            const oldPrefKey = row.pref_key;
            const oldSecId = oldPrefKey.replace(/^sla_prefs_/, '');

            const existingAliases = Array.isArray(payload._sourceMeta?.aliases) ? payload._sourceMeta.aliases : [];
            const existingPreviousHashes = Array.isArray(payload._sourceMeta?.previousHashes) ? payload._sourceMeta.previousHashes : [];
            const previousHashes = Array.from(new Set([...existingPreviousHashes, oldPrefKey, ...oldCandidatePrefKeys]));
            const aliases = Array.from(new Set([...existingAliases, ...oldCandidates]));

            payload._sourceMeta = {
                ...(payload._sourceMeta || {}),
                secId: newSecId,
                mode: 'other',
                title: `📁 独立表: ${newBaseName}`,
                schemaHash: newPrefKey,
                baseName: newBaseName,
                sourceFiles: [`${newBaseName}.csv`],
                matchedPrefix: `${newBaseName}*`,
                previousHashes,
                aliases,
                updatedAt: new Date().toISOString()
            };

            if (Array.isArray(payload.customMetrics)) {
                payload.customMetrics.forEach(rule => {
                    if (rule.sourceSecId === oldSecId) rule.sourceSecId = newSecId;
                    if (Array.isArray(rule.subMetrics)) {
                        rule.subMetrics.forEach(sub => {
                            if (sub.sourceSecId === oldSecId) sub.sourceSecId = newSecId;
                        });
                    }
                });
            }

            await run(
                `INSERT INTO sla_prefs (pref_key, pref_kind, payload_json, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(pref_key) DO UPDATE SET
                    pref_kind = excluded.pref_kind,
                    payload_json = excluded.payload_json,
                    updated_at = CURRENT_TIMESTAMP`,
                [newPrefKey, row.pref_kind || 'schema', JSON.stringify(payload)]
            );

            if (oldPrefKey !== newPrefKey) {
                await run('DELETE FROM sla_prefs WHERE pref_key = ?', [oldPrefKey]);
            }

            syncedCount++;

            // 2. Update other table rules that cross-reference oldSecId
            const otherRows = await all("SELECT pref_key, payload_json FROM sla_prefs WHERE pref_key != ?", [newPrefKey]);
            for (const otherRow of otherRows) {
                let changed = false;
                let otherPayload;
                try { otherPayload = JSON.parse(otherRow.payload_json); } catch (_) { continue; }
                if (Array.isArray(otherPayload?.customMetrics)) {
                    otherPayload.customMetrics.forEach(rule => {
                        if (rule.sourceSecId === oldSecId) {
                            rule.sourceSecId = newSecId;
                            changed = true;
                        }
                        if (Array.isArray(rule.subMetrics)) {
                            rule.subMetrics.forEach(sub => {
                                if (sub.sourceSecId === oldSecId) {
                                    sub.sourceSecId = newSecId;
                                    changed = true;
                                }
                            });
                        }
                    });
                }
                if (changed) {
                    await run("UPDATE sla_prefs SET payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE pref_key = ?", [JSON.stringify(otherPayload), otherRow.pref_key]);
                }
            }

            // 3. Update warning targets in sla_targets
            const targetRows = await all("SELECT target_key, label, target_type, weight, auto_fill, is_percent, exceed_by, bonus, extra_config_json FROM sla_targets WHERE target_key LIKE ?", [`${oldSecId}_%`]);
            for (const tr of targetRows) {
                const newTargetKey = tr.target_key.replace(`${oldSecId}_`, `${newSecId}_`);
                await run(
                    `INSERT INTO sla_targets (target_key, label, target_type, weight, auto_fill, is_percent, exceed_by, bonus, extra_config_json, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                     ON CONFLICT(target_key) DO UPDATE SET
                        label = excluded.label,
                        target_type = excluded.target_type,
                        weight = excluded.weight,
                        auto_fill = excluded.auto_fill,
                        is_percent = excluded.is_percent,
                        exceed_by = excluded.exceed_by,
                        bonus = excluded.bonus,
                        extra_config_json = excluded.extra_config_json,
                        updated_at = CURRENT_TIMESTAMP`,
                    [
                        newTargetKey,
                        tr.label || '',
                        tr.target_type || 'number',
                        tr.weight ?? 0,
                        tr.auto_fill ?? 0,
                        tr.is_percent ?? 0,
                        tr.exceed_by ?? 0,
                        tr.bonus ?? 0,
                        tr.extra_config_json || '{}'
                    ]
                );
                await run("DELETE FROM sla_targets WHERE target_key = ?", [tr.target_key]);
            }
        }

        // 4. Update monthly table cleaning rules in source_table_rules
        try {
            const tableRules = require('../../frontend/js/monthly-designer/source-table-rules');
            const oldTypeKey = tableRules.typeKey({ name: oldName });
            const newTypeKey = tableRules.typeKey({ name: cleanNewName });
            if (oldTypeKey && newTypeKey && oldTypeKey !== newTypeKey) {
                const ruleRow = await get("SELECT rules_json FROM source_table_rules WHERE type_key = ?", [oldTypeKey]);
                if (ruleRow) {
                    await run(
                        `INSERT INTO source_table_rules (type_key, rules_json, updated_at)
                         VALUES (?, ?, CURRENT_TIMESTAMP)
                         ON CONFLICT(type_key) DO UPDATE SET
                            rules_json = excluded.rules_json,
                            updated_at = excluded.updated_at`,
                        [newTypeKey, ruleRow.rules_json]
                    );
                    await run("DELETE FROM source_table_rules WHERE type_key = ?", [oldTypeKey]);
                    syncedCount++;
                }
            }
        } catch (e) {
            console.warn('[uiv-scripts] source_table_rules sync skipped:', e.message);
        }

    } catch (err) {
        console.error('[uiv-scripts] Rule sync on rename failed:', err);
    }

    return { synced: syncedCount > 0, count: syncedCount, newBaseName, newPrefKey, newSecId };
}

async function renameScript(id, newName) {
    await ensureReady();
    const row = await get('SELECT payload_json FROM uiv_scripts WHERE id = ?', [id]);
    if (!row) return null;

    let script;
    try {
        script = JSON.parse(row.payload_json);
    } catch (e) {
        return null;
    }
    const oldName = script.name;
    const cleanNewName = String(newName || '').trim();
    if (!cleanNewName) return null;

    script.name = cleanNewName;
    script.originalFileName = cleanNewName;
    script.updatedAt = new Date().toISOString();

    if (script.code && typeof script.code === 'string') {
        try {
            const parsed = JSON.parse(script.code);
            if (parsed && typeof parsed === 'object' && parsed.Name) {
                parsed.Name = cleanNewName;
                script.code = JSON.stringify(parsed, null, 2);
            }
        } catch (_) {}
    }

    if (script.consoleCode && typeof script.consoleCode === 'string') {
        const baseWithoutCsv = cleanNewName.replace(/\.csv$/i, '');
        const outputFileName = /_Latest$/i.test(baseWithoutCsv) ? `${baseWithoutCsv}.csv` : `${baseWithoutCsv}_Latest.csv`;
        script.consoleCode = script.consoleCode.replace(
            /((?:let|const|var)\s+finalOutputName\s*=\s*)("(?:\\.|[^"\\])*")/g,
            `$1${JSON.stringify(outputFileName)}`
        );
    }

    await upsertScriptInDb(script);

    // Synchronize metric extraction rules in sla_prefs, sla_targets, source_table_rules
    const syncResult = await syncRulesOnScriptRename(oldName, cleanNewName);

    return {
        ...script,
        oldName,
        ruleSyncCount: syncResult.count,
        ruleSyncResult: syncResult
    };
}

async function deleteScriptsByCategory(category) {
    try {
        await ensureReady();
        await run('DELETE FROM uiv_scripts WHERE category = ?', [category]);
    } catch (err) {
        console.error('[uiv-scripts] SQLite category delete sync failed:', err.message);
    }
    return [];
}

async function replaceAllScripts(scripts) {
    const normalized = Array.isArray(scripts) ? scripts.map(normalizeScript) : [];

    await replaceScriptsInDb(normalized);

    return normalized;
}

module.exports = {
    ensureReady,
    listScripts,
    saveScripts,
    deleteScriptById,
    moveScriptCategory,
    renameScript,
    deleteScriptsByCategory,
    replaceAllScripts,
    syncRulesOnScriptRename,
    generateSchemaHash
};
