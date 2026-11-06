window.exportYuxiangExcel = async function() {
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

        // Filter out Others group metrics
        const labelGroupLookup = window._currentLabelToGroup || {};
        const mainMetrics = orderedMetrics.filter(m => labelGroupLookup[m.label] !== 'Others');
        mainMetrics.forEach(m => {
            const labelEn = rt(m.label, true) || m.label;
            const targetData = labelToTargetMap[m.label];
            const target = targetData && targetData[targetMonth] !== undefined ? targetData[targetMonth] : '';
            const metricData = { label: m.label, labelEn, target };
            
            targetCats.forEach(cat => {
                const cell = window._currentCatData[cat] && window._currentCatData[cat].values ? window._currentCatData[cat].values[m.label] : null;
                const weight = Number(m.weight) || 0;
                
                let achv = '';
                let score = 0;
                
                
                let achv = '';
                let score = 0;
                
                if (cell) {
                    if (cell.isFailing) {
                        achv = cell.raw;
                    } else {
                        achv = cell.raw;
                    }
                    score = cell.earnedScore !== undefined ? cell.earnedScore : (cell.isFailing ? 0 : (weight + (cell.bonusScore || 0)));
                }
                
                metricData[cat] = { achv, score, isFailing: cell ? cell.isFailing : false };
            });
            payload.metrics.push(metricData);
        });

        // Add manual adjustments
        manualAdjustItems.forEach((item, idx) => {
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

        // Merge 全量EOS & 日志回传 & 拓扑与预案
                            rowData[`score_${cat}`] = '--';
                        } else {
                            const earned = cell.earnedScore !== undefined ? cell.earnedScore : (cell.isFailing ? 0 : (weight + (cell.bonusScore || 0)));
                            rowData[`score_${cat}`] = Number.isInteger(earned) ? earned : +earned.toFixed(2);
                        }
                    });
                    
                    const row = sheet.addRow(rowData);
                    row.height = 25; // Professional row height
                    
                    // Highlight global failing cell
                    if (m.isWarn) {
                        const globalColObj = sheet.getColumn('global');
                        const globalCell = row.getCell(globalColObj.number);
                        globalCell.font = { name: 'Microsoft YaHei', size: 11, color: { argb: 'FFD32F2F' }, bold: true };
                        globalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
                    }
                    
                    // Highlight failing cells
                    categories.forEach(cat => {
                        const cell = catData[cat].values[m.label] || {};
                        if (cell.isFailing) {
                            const valColObj = sheet.getColumn(`val_${cat}`);
                       
                const a2str = newObj[cat].achv !== undefined && newObj[cat].achv !== '' ? String(newObj[cat].achv).trim() : '--';
                
                if (baseObj[cat].achv === '' && newObj[cat].achv === '') {
                    baseObj[cat].achv = '';
                } else {
                    baseObj[cat].achv = `${a1str} & ${a2str}`;
                }
                
                const s1 = parseFloatSafe(baseObj[cat].score);
                const s2 = parseFloatSafe(newObj[cat].score);
                baseObj[cat].score = s1 + s2;
                
                baseObj[cat].isFailing = baseObj[cat].isFailing || newObj[cat].isFailing;
            });
        };

            } catch (err) {
                console.error("Excel generation error:", err);
            }
        }

        if (btn) btn.innerHTML = rt('report.common.saveToDbBusy');
        const res = await postReportSaveWithCompression(payload);
        if (btn) btn.innerHTML = rt('report.action.saveDb');
        
        if (res.success) {
            showToast(rt('report.toast.savedDb'), 'success');
        } else {
            showToast(res.error || rt('report.toast.saveDbFailed'), 'error');
        }
    } catch (e) {
        showToast(`${rt('report.toast.saveDbRequestFailed')}: ${e.message}`, 'error');
        console.error(e);
    }
};
                });
                const totalRow = sheet.addRow(totalRowData);
                totalRow.height = 30;
                totalRow.font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: 'FF333333' } };
                totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF59D' } };
                // Also add borders to total row
                totalRow.eachCell((cell) => {
                    cell.border = {
                        top: {style:'thin', color: {argb:'FFBDBDBD'}},
                        left: {style:'thin', color: {argb:'FFBDBDBD'}},
                        bottom: {style:'thin', color: {argb:'FFBDBDBD'}},
                        right: {style:'thin', color: {argb:'FFBDBDBD'}}
                    };
                });
                
                const buffer = await workbook.xlsx.writeBuffer();
                let binary = '';
                const bytes = new Uint8Array(buffer);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                payload.excel_data = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + window.btoa(binary);
            } catch (err) {
                console.error("Excel generation error:", err);
            }
        }

        if (btn) btn.innerHTML = rt('report.common.saveToDbBusy');
        const res = await postReportSaveWithCompression(payload);
        if (btn) btn.innerHTML = rt('report.action.saveDb');
        
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
