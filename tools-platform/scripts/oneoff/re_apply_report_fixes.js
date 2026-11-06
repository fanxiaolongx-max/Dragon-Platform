const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/frontend/js/report/report.js';
let content = fs.readFileSync(file, 'utf8');

// 1. mergeTwoMetrics & concatenation
const badMerge = `        const mergeTwoMetrics = (baseObj, newObj, newLabel) => {
            baseObj.label = newLabel;
            
            ['TE', 'ORG', 'ET', 'VDF'].forEach(cat => {
                const s1 = parseFloatSafe(baseObj[cat].score);
                const s2 = parseFloatSafe(newObj[cat].score);
                baseObj[cat].score = s1 + s2;
                
                baseObj[cat].isFailing = baseObj[cat].isFailing || newObj[cat].isFailing;
            });
        };`;
const goodMerge = `        const mergeTwoMetrics = (baseObj, newObj, newLabel) => {
            baseObj.label = newLabel;
            
            const t1str = baseObj.target !== undefined && baseObj.target !== '' ? String(baseObj.target).trim() : '--';
            const t2str = newObj.target !== undefined && newObj.target !== '' ? String(newObj.target).trim() : '--';
            baseObj.target = t1str + " & " + t2str;
            
            ['TE', 'ORG', 'ET', 'VDF'].forEach(cat => {
                const a1str = baseObj[cat].achv !== undefined && baseObj[cat].achv !== '' ? String(baseObj[cat].achv).trim() : '--';
                const a2str = newObj[cat].achv !== undefined && newObj[cat].achv !== '' ? String(newObj[cat].achv).trim() : '--';
                
                if (baseObj[cat].achv === '' && newObj[cat].achv === '') {
                    baseObj[cat].achv = '';
                } else {
                    baseObj[cat].achv = a1str + " & " + a2str;
                }
                
                const s1 = parseFloatSafe(baseObj[cat].score);
                const s2 = parseFloatSafe(newObj[cat].score);
                baseObj[cat].score = s1 + s2;
                
                baseObj[cat].isFailing = baseObj[cat].isFailing || newObj[cat].isFailing;
            });
        };`;
if (content.includes(badMerge)) {
    content = content.replace(badMerge, goodMerge);
    console.log("Restored mergeTwoMetrics");
}

// 2. target >= logic
const badTarget = `            const targetData = labelToTargetMap[m.label];
            const target = targetData && targetData[targetMonth] !== undefined ? targetData[targetMonth] : '';
            const metricData = { label: m.label, labelEn, target };`;
const goodTarget = `            const targetData = labelToTargetMap[m.label];
            let target = targetData && targetData[targetMonth] !== undefined ? targetData[targetMonth] : '';
            if (target !== '' && targetData) {
                if (targetData.type === 'gte') target = '≥ ' + target;
                else if (targetData.type === 'lte') target = '≤ ' + target;
            }
            const metricData = { label: m.label, labelEn, target };`;
if (content.includes(badTarget)) {
    content = content.replace(badTarget, goodTarget);
    console.log("Restored target logic");
}

// 3. The export original metrics fix
const badExportMerge = `        payload.metrics.forEach(md => {
            if (md.label === '全量EOS-产品') {
                eosProduct = md;
                mergedMetrics.push(eosProduct);
            } else if (md.label === '全量EOS-版本') {
                if (eosProduct) {
                    mergeTwoMetrics(eosProduct, md, '全量EOS (合并)');
                } else {
                    mergedMetrics.push(md);
                }
            } else if (md.label === '日志回传') {
                logBase = md;
                mergedMetrics.push(logBase);
            } else if (md.label === '日志回传备案') {
                if (logBase) {
                    mergeTwoMetrics(logBase, md, '日志回传 (合并)');
                } else {
                    mergedMetrics.push(md);
                }
            } else if (md.label === '拓扑') {
                topoBase = md;
                mergedMetrics.push(topoBase);
            } else if (md.label === '预案') {
                if (topoBase) {
                    mergeTwoMetrics(topoBase, md, '拓扑与预案 (合并)');
                } else {
                    mergedMetrics.push(md);
                }
            } else {
                mergedMetrics.push(md);
            }
        });`;
const goodExportMerge = `        // Push ALL original metrics individually first
        mergedMetrics.push(...JSON.parse(JSON.stringify(payload.metrics)));
        
        // Then append the merged versions
        const eosProductItem = payload.metrics.find(m => m.label === '全量EOS-产品');
        const eosVersionItem = payload.metrics.find(m => m.label === '全量EOS-版本');
        if (eosProductItem && eosVersionItem) {
            const mergedEos = JSON.parse(JSON.stringify(eosProductItem));
            mergeTwoMetrics(mergedEos, eosVersionItem, '全量EOS (合并)');
            mergedMetrics.push(mergedEos);
        }

        const logBaseItem = payload.metrics.find(m => m.label === '日志回传');
        const logBaseItem2 = payload.metrics.find(m => m.label === '日志回传备案');
        if (logBaseItem && logBaseItem2) {
            const mergedLog = JSON.parse(JSON.stringify(logBaseItem));
            mergeTwoMetrics(mergedLog, logBaseItem2, '日志回传 (合并)');
            mergedMetrics.push(mergedLog);
        }

        const topoBaseItem = payload.metrics.find(m => m.label === '拓扑');
        const topoBaseItem2 = payload.metrics.find(m => m.label === '预案');
        if (topoBaseItem && topoBaseItem2) {
            const mergedTopo = JSON.parse(JSON.stringify(topoBaseItem));
            mergeTwoMetrics(mergedTopo, topoBaseItem2, '拓扑与预案 (合并)');
            mergedMetrics.push(mergedTopo);
        }`;
if (content.includes(badExportMerge)) {
    content = content.replace(badExportMerge, goodExportMerge);
    console.log("Restored export merge logic");
}

fs.writeFileSync(file, content);
