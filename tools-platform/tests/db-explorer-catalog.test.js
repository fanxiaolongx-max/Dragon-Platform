const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describeTable } = require('../backend/models/db-explorer-catalog');

test('every table declared by current platform schemas has bilingual purpose and category documentation', () => {
    const names = new Set();
    for (const folder of ['models', 'routes']) {
        const root = path.join(__dirname, '../backend', folder);
        for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
            const file = path.join(entry.parentPath, entry.name);
            const source = fs.readFileSync(file, 'utf8');
            for (const match of source.matchAll(/CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s*\(/g)) names.add(match[1]);
        }
    }
    assert.ok(names.size > 100);
    for (const name of names) {
        const metadata = describeTable(name);
        assert.equal(metadata.documented, true, `Missing purpose: ${name}`);
        for (const field of ['description', 'descriptionEn', 'categoryLabel', 'categoryLabelEn', 'source']) assert.ok(metadata[field], `${name}: ${field}`);
        assert.ok(fs.existsSync(path.join(__dirname, '..', metadata.source)), `${name}: source exists`);
    }
    assert.equal(describeTable('chat_messages_fts_data').documented, true);
    assert.equal(describeTable('extension_table').documented, false);
    assert.match(describeTable('extension_table').description, /尚未登记/);
});
