// The packed extension loads netcare-settings.js before the RFC page; vm tests run the page the same way.
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '../../backend/builtin-tools/f12-to-extension');
const packer = require(path.join(dir, 'packer-core.js'));

module.exports = packer.netcareSettingsScript() + '\n' + fs.readFileSync(path.join(dir, 'netcare-rfc-word.js'), 'utf8');
