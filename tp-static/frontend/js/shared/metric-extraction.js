/* Shared extraction semantics for monthly previews and archived import rules. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MetricExtraction=api;})(typeof window==='object'?window:globalThis,function(){
'use strict';
function getMetricRuleConditions(rule) {
    return Array.isArray(rule && rule.conditions)
        ? rule.conditions.filter(item => item && item.column && item.value !== undefined && String(item.value).trim() !== '')
        : [];
}

function metricRuleCellMatches(cellVal, pattern) {
    const str = cellVal !== undefined && cellVal !== null ? String(cellVal).trim() : '';
    const expected = String(pattern === undefined || pattern === null ? '' : pattern).trim();
    if (expected === '[空]') return str === '';
    if (expected === '[非空]') return str !== '';
    return str.includes(expected);
}

function metricRuleRowMatches(row, rule, includePrimary = true) {
    const tests = [];
    if (includePrimary && rule && rule.colX) {
        tests.push(() => metricRuleCellMatches(row && row[rule.colX], rule.valY));
    }
    getMetricRuleConditions(rule).forEach(item => {
        tests.push(() => metricRuleCellMatches(row && row[item.column], item.value));
    });
    if (!tests.length) return true;
    const useOr = rule && rule.type === 'extract_multi' && rule.filterLogic === 'or';
    return useOr ? tests.some(test => test()) : tests.every(test => test());
}

function parseMetricNumericValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? { value, isPercent: false } : null;
    let text = String(value === undefined || value === null ? '' : value).trim();
    if (!text) return null;
    const isPercent = text.endsWith('%');
    if (isPercent) text = text.slice(0, -1).trim();
    const negativeByParentheses = /^\(.*\)$/.test(text);
    if (negativeByParentheses) text = text.slice(1, -1).trim();
    text = text.replace(/[,，\s]/g, '').replace(/^[¥￥$€£]/, '');
    if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(text)) return null;
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return { value: negativeByParentheses ? -number : number, isPercent };
}

function aggregateMetricRowValues(rows, rule) {
    if (rule.aggregation === 'first') return rows?.length ? (rows[0]?.[rule.colZ] ?? '--') : '--';
    const parsed = (rows || []).map(row => parseMetricNumericValue(row && row[rule.colZ])).filter(Boolean);
    if (!parsed.length) return '--';
    const method = rule.aggregation || 'sum';
    let result;
    if (method === 'count') result = parsed.length;
    else if (method === 'avg') result = parsed.reduce((sum, item) => sum + item.value, 0) / parsed.length;
    else if (method === 'max') result = Math.max(...parsed.map(item => item.value));
    else if (method === 'min') result = Math.min(...parsed.map(item => item.value));
    else result = parsed.reduce((sum, item) => sum + item.value, 0);
    result = Number(result.toFixed(12));
    return method !== 'count' && parsed.every(item => item.isPercent) ? `${result}%` : result;
}


function evaluate(rows,rule){
 const indexes=[];const matched=[];
 (rows||[]).forEach((row,index)=>{if(metricRuleRowMatches(row,rule)){indexes.push(index);matched.push(row);}});
 let value;
 if(rule.type==='extract')value=matched.length?(matched[0][rule.colZ]??'--'):'--';
 else if(rule.type==='count')value=matched.filter(row=>metricRuleCellMatches(row[rule.colZ],rule.valK)).length;
 else if(rule.type==='ratio')value=matched.length?Math.round((matched.filter(row=>metricRuleCellMatches(row[rule.colZ],rule.valK)).length/matched.length)*100)+'%':'0%';
 else value=aggregateMetricRowValues(matched,rule);
 return {value,indexes,matchedCount:matched.length,numericCount:matched.filter(row=>parseMetricNumericValue(row[rule.colZ])).length};
}
return {conditions:getMetricRuleConditions,cellMatches:metricRuleCellMatches,rowMatches:metricRuleRowMatches,parseNumber:parseMetricNumericValue,aggregate:aggregateMetricRowValues,evaluate};
});
