/** Recover source identity from extraction evidence, never from a metric's display language. */
function resolveMetricSource(metric, sections, files, snapshotFiles=[], normalize=String) {
    const list=value=>Array.isArray(value)?value:[];
    const unique=values=>[...new Set(values.filter(Boolean))];
    const fileIds=ids=>unique(list(ids)).filter(id=>files.some(file=>file.id===id));
    const namesToIds=names=>files.filter(file=>list(names).map(normalize).includes(normalize(file.name))).map(file=>file.id);
    const result=(keys,method,ids)=>{
        const selected=sections.filter(section=>keys.includes(section.key));
        const found=ids===undefined?unique(selected.flatMap(section=>Array.isArray(section.sourceFiles)?namesToIds(section.sourceFiles):fileIds(section.fileIds))):fileIds(ids);
        return {fileIds:found,sourceSectionKeys:unique(selected.map(section=>section.key)),sourceLinkStatus:found.length?'resolved':'unresolved',sourceLinkMethod:method};
    };
    if(metric.sourceLinkVersion===2){
        if(Array.isArray(metric.sourceSectionKeys))return result(metric.sourceSectionKeys,'saved-sections');
        return result([],'saved-files',metric.fileIds);
    }
    const rule=metric.rule||{};
    if(rule.scope==='all'){
        const eligible=sections.filter(section=>!section.archiveSupplementary);
        return eligible.length?result(eligible.map(section=>section.key),'cross-table'):result([],'cross-table',namesToIds(metric.sourceFiles||snapshotFiles));
    }
    for(const key of [rule.sourceSecId,metric.sourceSection])if(key&&sections.some(section=>section.key===key))return result([key],'source-section');
    const namespaced=sections.filter(section=>String(metric.key||'').startsWith(section.key+':'));
    if(namespaced.length===1)return result([namespaced[0].key],'section-key');
    const matching=sections.filter(section=>list(section.rules).some(saved=>metric.key===`${section.key}_${saved.id}`||metric.rule?.id&&saved.id===metric.rule.id));
    // Prefer a stable section/rule key when a legacy rule ID occurs in multiple sections.
    const exact=matching.filter(section=>list(section.rules).some(saved=>metric.key===`${section.key}_${saved.id}`));
    if(exact.length===1)return result([exact[0].key],'rule-key');
    if(matching.length===1)return result([matching[0].key],'rule-id');
    const selected=unique(list(metric.sourceSelections).map(selection=>selection.sectionKey)).filter(key=>sections.some(section=>section.key===key));
    if(selected.length)return result(selected,'saved-selections');
    const byLabel=sections.filter(section=>list(section.rules).some(saved=>saved.label&&saved.label===metric.label));
    if(byLabel.length===1)return result([byLabel[0].key],'unique-rule-label');
    const fields=unique([rule.colX,rule.colZ,...list(rule.conditions).map(condition=>condition.col||condition.column)]);
    const byFields=fields.length?sections.filter(section=>fields.every(field=>list(section.headers).includes(field))):[];
    if(byFields.length===1)return result([byFields[0].key],'unique-rule-columns');
    const explicit=namesToIds(metric.sourceFiles);
    const batchNames=unique(list(snapshotFiles).map(normalize));
    const isBatchWide=batchNames.length>0&&batchNames.length===unique(list(metric.sourceFiles).map(normalize)).length&&batchNames.every(name=>list(metric.sourceFiles).map(normalize).includes(name));
    if(explicit.length&&!isBatchWide)return result([],'explicit-files',explicit);
    return result([],'ambiguous',[]);
}
function linkMetric(metric,sections,files,snapshotFiles,normalize){
    const source=resolveMetricSource(metric,sections,files,snapshotFiles,normalize);
    const children=(metric.subMetrics||[]).map(child=>{
        const savedRule=(metric.rule?.subMetrics||[]).find(item=>item.category===child.category);
        const rule=savedRule||{};
        const effectiveRule={...rule,scope:rule.scope||(savedRule?metric.rule?.scope:undefined)};
        const input={...child,key:rule.id?`${rule.sourceSecId||metric.sourceSection}_${rule.id}`:'',label:child.label||rule.label,rule:effectiveRule,sourceSection:child.sourceSection||rule.sourceSecId||(savedRule?metric.sourceSection:undefined)};
        return {...child,...resolveMetricSource(input,sections,files,snapshotFiles,normalize)};
    });
    return {...metric,...source,subMetrics:children};
}
module.exports={resolveMetricSource,linkMetric};
