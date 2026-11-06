const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/frontend/js/report/report.js';
let content = fs.readFileSync(file, 'utf8');

const oldLogic = `        orderedMetrics.forEach(m => {`;
const newLogic = `        // Filter out Others group metrics
        const mainMetrics = orderedMetrics.filter(m => labelToGroup[m.label] !== 'Others');
        mainMetrics.forEach(m => {`;

if (content.includes(oldLogic)) {
    content = content.replace(oldLogic, newLogic);
    fs.writeFileSync(file, content);
    console.log("Fixed frontend payload generation");
} else {
    console.log("Could not find oldLogic");
}
