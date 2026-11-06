const { all } = require('./backend/models/app-db');
const fs = require('fs');

async function testAll() {
  const tables = [
    'auth_sessions', 'auth_users', 'frt_snapshots', 'sys_kv_store',
    'praudit_configs', 'sla_categories', 'sla_groups', 'sla_group_items',
    'sys_dictionaries', 'sla_prefs', 'sla_snapshots', 'sla_targets',
    'survey_templates', 'survey_submissions', 'uiv_categories', 'uiv_scripts',
    'upload_history'
  ];

  for (const table of tables) {
    try {
      await all(`SELECT * FROM ${table} LIMIT 1`);
      console.log(`${table}: OK`);
    } catch(e) {
      console.log(`${table}: NOT FOUND or ERROR - ${e.message}`);
    }
  }
}
testAll().then(() => process.exit(0)).catch(() => process.exit(1));
