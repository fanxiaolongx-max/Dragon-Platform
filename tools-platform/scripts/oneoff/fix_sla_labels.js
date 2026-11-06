const { all, run } = require('./models/app-db');

async function fixLabels() {
    try {
        console.log('[FixLabels] Starting...');

        // 1. Fetch all sla_prefs
        const prefs = await all("SELECT pref_key, payload_json FROM sla_prefs WHERE pref_key LIKE 'sla_prefs_other_%'");
        
        const labelMap = {};

        prefs.forEach(row => {
            const secId = row.pref_key.replace('sla_prefs_', '');
            try {
                const payload = JSON.parse(row.payload_json || '{}');
                if (payload.customMetrics && Array.isArray(payload.customMetrics)) {
                    // recursively find all metrics and submetrics
                    const extractLabels = (metrics) => {
                        for (const m of metrics) {
                            if (m.id && m.label) {
                                labelMap[`${secId}_${m.id}`] = m.label;
                            }
                            if (m.subMetrics && Array.isArray(m.subMetrics)) {
                                extractLabels(m.subMetrics);
                            }
                        }
                    };
                    extractLabels(payload.customMetrics);
                }
            } catch (e) {
                console.error(`Failed to parse pref_key: ${row.pref_key}`, e.message);
            }
        });

        console.log(`[FixLabels] Extracted ${Object.keys(labelMap).length} labels from sla_prefs.`);

        // 2. Fetch targets with missing labels
        const targets = await all("SELECT target_key FROM sla_targets WHERE label IS NULL OR label = ''");
        
        let updateCount = 0;
        for (const row of targets) {
            const tk = row.target_key;
            if (labelMap[tk]) {
                const label = labelMap[tk];
                await run("UPDATE sla_targets SET label = ? WHERE target_key = ?", [label, tk]);
                console.log(`Updated target_key: ${tk} with label: ${label}`);
                updateCount++;
            }
        }

        console.log(`[FixLabels] Successfully updated ${updateCount} targets.`);

    } catch (err) {
        console.error('[FixLabels] Error:', err);
    } finally {
        process.exit(0);
    }
}

fixLabels();
