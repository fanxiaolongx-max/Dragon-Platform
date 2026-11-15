const fs = require('node:fs'), path = require('node:path');
const modules = ["platform-core","platform-dialogs","platform-settings-controller","platform-alerts","platform-services","platform-tool-updates","platform-runtime"];
exports.readPlatformSource = () => modules.map(name => fs.readFileSync(path.join(__dirname, '../../frontend/js/shared', name + '.js'), 'utf8')).join('\n');
