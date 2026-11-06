const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/frontend/js/report/report.js';
let content = fs.readFileSync(file, 'utf8');

const oldLogic1 = `        const mainMetrics = orderedMetrics.filter(m => labelToGroup[m.label] !== 'Others');`;
const newLogic1 = `        const labelGroupLookup = window._currentLabelToGroup || {};
        const mainMetrics = orderedMetrics.filter(m => labelGroupLookup[m.label] !== 'Others');`;

const oldLogic2 = `        // Totals`;
const newLogic2 = `        // Merge 全量EOS
        const mergedMetrics = [];
        let eosProduct = null;
        payload.metrics.forEach(md => {
            if (md.label === '全量EOS-产品') {
                eosProduct = md;
                mergedMetrics.push(eosProduct);
            } else if (md.label === '全量EOS-版本') {
                if (eosProduct) {
                    eosProduct.label = '全量EOS (合并)';
                    const parseFloatSafe = (val) => {
                        if (typeof val === 'string' && val.endsWith('%')) return parseFloat(val);
                        if (typeof val === 'string' || typeof val === 'number') {
                            const n = parseFloat(val);
                            return isNaN(n) ? 0 : n;
                        }
                        return 0;
                    };
                    const isPct = (val) => typeof val === 'string' && val.endsWith('%');
                    
                    const t1 = parseFloatSafe(eosProduct.target);
                    const t2 = parseFloatSafe(md.target);
                    const hasPctTarget = isPct(eosProduct.target) || isPct(md.target);
                    eosProduct.target = hasPctTarget ? (t1+t2)+'%' : (t1+t2);
                    
                    ['TE', 'ORG', 'ET', 'VDF'].forEach(cat => {
                        const a1 = parseFloatSafe(eosProduct[cat].achv);
                        const a2 = parseFloatSafe(md[cat].achv);
                        const hasPctAchv = isPct(eosProduct[cat].achv) || isPct(md[cat].achv);
                        
                        let combinedAchv = '';
                        if (eosProduct[cat].achv === '' && md[cat].achv === '') {
                            combinedAchv = '';
                        } else {
                            combinedAchv = hasPctAchv ? (a1+a2)+'%' : (a1+a2);
                        }
                        eosProduct[cat].achv = combinedAchv;
                        
                        const s1 = parseFloatSafe(eosProduct[cat].score);
                        const s2 = parseFloatSafe(md[cat].score);
                        eosProduct[cat].score = s1 + s2;
                    });
                } else {
                    mergedMetrics.push(md);
                }
            } else {
                mergedMetrics.push(md);
            }
        });
        payload.metrics = mergedMetrics;

        // Totals`;

if (content.includes(oldLogic1) && content.includes(oldLogic2)) {
    content = content.replace(oldLogic1, newLogic1);
    content = content.replace(oldLogic2, newLogic2);
    fs.writeFileSync(file, content);
    console.log("Fixed report.js merging and labelGroup issue");
} else {
    console.log("Could not find targets");
}
