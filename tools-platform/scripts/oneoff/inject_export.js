const fs = require('fs');
const file = '/Volumes/512G/06-工具开发/privacy-policy/tools-platform/frontend/js/report/report.js';
let content = fs.readFileSync(file, 'utf8');

const exportCode = `
window.exportYuxiangExcel = async function(event) {
    const orderedMetrics = window._currentOrderedMetrics;
    if (!currentSnapshot || !orderedMetrics || !window._currentCatData) {
        return showToast('无数据可导出', 'warn');
    }
    const btn = event.currentTarget;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '⏳ 正在导出...';
    btn.disabled = true;

    try {
        const payload = {
            metrics: [],
            adjustments: [],
            totals: {
                subTotal: { TE: 0, ORG: 0, ET: 0, VDF: 0 },
                adjustTotal: { TE: 0, ORG: 0, ET: 0, VDF: 0 },
                weightInMonth: { TE: 0, ORG: 0, ET: 0, VDF: 0 },
                finalResult: { TE: 0, ORG: 0, ET: 0, VDF: 0 }
            }
        };

        const monthStr = document.getElementById('target-month-select').value || '未知';
        const targetMonth = parseInt(monthStr, 10);
        const targetCats = ['TE', 'ORG', 'ET', 'VDF'];

        const labelGroupLookup = window._currentLabelToGroup || {};
        const mainMetrics = orderedMetrics.filter(m => labelGroupLookup[m.label] !== 'Others');
        mainMetrics.forEach(m => {
            const labelEn = rt(m.label, true) || m.label;
            const targetData = labelToTargetMap[m.label];
            let target = targetData && targetData[targetMonth] !== undefined ? targetData[targetMonth] : '';
            if (target !== '' && targetData) {
                if (targetData.type === 'gte') target = '≥ ' + target;
                else if (targetData.type === 'lte') target = '≤ ' + target;
            }
            const metricData = { label: m.label, labelEn, target };
            
            targetCats.forEach(cat => {
                const cell = window._currentCatData[cat] && window._currentCatData[cat].values ? window._currentCatData[cat].values[m.label] : null;
                const weight = Number(m.weight) || 0;
                
                let achv = '';
                let score = 0;
                
                if (cell) {
                    achv = cell.raw;
                    score = cell.earnedScore !== undefined ? cell.earnedScore : (cell.isFailing ? 0 : (weight + (cell.bonusScore || 0)));
                }
                
                metricData[cat] = { achv, score, isFailing: cell ? cell.isFailing : false };
            });
            payload.metrics.push(metricData);
        });

        // manual adjustments
        (typeof manualAdjustItems !== 'undefined' ? manualAdjustItems : []).forEach((item, idx) => {
            const labelEn = rt(item.name, true) || item.name;
            const adjData = { label: item.name, labelEn };
            
            targetCats.forEach(cat => {
                let score = 0;
                if (currentSnapshot.manualAdjustData && currentSnapshot.manualAdjustData[cat]) {
                    const count = currentSnapshot.manualAdjustData[cat][idx] || 0;
                    if (count > 0) {
                        score = count * item.unit;
                        if (score > item.cap) score = item.cap;
                        if (item.type === '扣分') score = -score;
                    }
                }
                adjData[cat] = { score, count: (currentSnapshot.manualAdjustData && currentSnapshot.manualAdjustData[cat]) ? (currentSnapshot.manualAdjustData[cat][idx] || 0) : 0 };
                payload.totals.adjustTotal[cat] += score;
            });
            payload.adjustments.push(adjData);
        });

        // Totals
        targetCats.forEach(cat => {
            const d = window._currentCatData[cat];
            if (d) {
                payload.totals.subTotal[cat] = d.earnedScore;
                payload.totals.weightInMonth[cat] = d.validWeightSum;
                payload.totals.finalResult[cat] = d.finalScore;
            }
        });

        // MERGE METRICS
        const parseFloatSafe = (val) => {
            if (typeof val === 'string' && val.endsWith('%')) return parseFloat(val);
            if (typeof val === 'string' || typeof val === 'number') {
                const n = parseFloat(val);
                return isNaN(n) ? 0 : n;
            }
            return 0;
        };

        const mergeTwoMetrics = (baseObj, newObj, newLabel) => {
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
        };

        const mergedMetrics = JSON.parse(JSON.stringify(payload.metrics));
        
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
        }
        
        payload.metrics = mergedMetrics;

        const token = localStorage.getItem('tools_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        const response = await fetch('/api/sla/export-yuxiang', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('导出失败: ' + await response.text());
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `每月赛马-分网络_${monthStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    } catch(e) {
        console.error(e);
        showToast('导出失败: ' + e.message, 'error');
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
    }
}
`;

if (!content.includes('window.exportYuxiangExcel =')) {
    const injectionPoint = 'window.saveDashboardToDB = async function(event) {';
    content = content.replace(injectionPoint, exportCode + '\n' + injectionPoint);
    fs.writeFileSync(file, content);
    console.log("Injected exportYuxiangExcel");
} else {
    console.log("Already exists");
}
