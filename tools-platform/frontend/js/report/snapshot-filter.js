(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportSnapshotFilter=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    const DEFAULT_MIN_SOURCES=20,MAX_MIN_SOURCES=10000;
    const valid=value=>Number.isInteger(value)&&value>=0&&value<=MAX_MIN_SOURCES;
    const normalize=value=>valid(value)?value:DEFAULT_MIN_SOURCES;
    const sourceCount=snapshot=>Array.isArray(snapshot?.files)?snapshot.files.length:typeof snapshot?.files==='string'&&snapshot.files.trim()?1:0;
    const hasMetrics=snapshot=>Array.isArray(snapshot?.topMetrics)&&snapshot.topMetrics.length>0;
    const eligible=(snapshot,minimum=DEFAULT_MIN_SOURCES)=>hasMetrics(snapshot)&&sourceCount(snapshot)>=normalize(minimum);
    return {DEFAULT_MIN_SOURCES,MAX_MIN_SOURCES,valid,normalize,sourceCount,hasMetrics,eligible};
});
