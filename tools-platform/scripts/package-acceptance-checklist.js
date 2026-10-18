'use strict';
// Produce a single offline HTML file that can also be imported as a custom tool.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../backend/builtin-tools/acceptance-checklist');
function buildStandalone() {
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const script = file => `<script>\n${read(file).replace(/<\/script/gi, '<\\/script')}\n</script>`;
    return read('index.html')
        .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${read('style.css')}\n</style>`)
        .replace('<script src="vendor/exceljs.min.js"></script>', () => `<!-- ExcelJS MIT license: ${read('vendor/EXCELJS-LICENSE').replace(/--/g, '—')} -->\n${script('vendor/exceljs.min.js')}`)
        .replace('<script src="app.js"></script>', () => script('app.js'));
}
if (require.main === module) {
    const destination = process.argv[2];
    if (!destination) throw new Error('Usage: node scripts/package-acceptance-checklist.js /absolute/path/checklist.html');
    fs.writeFileSync(path.resolve(destination), buildStandalone());
    console.log(path.resolve(destination));
}
module.exports = { buildStandalone };
