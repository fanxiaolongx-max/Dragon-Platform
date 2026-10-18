(function(host) {
    'use strict';
    function segments(points, maxGap) {
        const result=[];
        let last=null;
        for (const point of points) {
            if (!Number.isFinite(point.at) || !Number.isFinite(point.remaining) || point.remaining<0 || point.remaining>100) continue;
            if (!last || point.at-last.at>maxGap || point.at<=last.at ||
                (point.resetsAt && last.resetsAt && point.resetsAt!==last.resetsAt) || point.remaining>last.remaining+0.1) result.push([]);
            result[result.length-1].push(point);last=point;
        }
        return result;
    }
    function paths(points, from, to, step, used=false, width=712, height=280) {
        const x=at=>56+Math.max(0,Math.min(1,(at-from)/(to-from)))*(width-80);
        const y=value=>22+(100-(used?100-value:value))*(height-62)/100;
        return segments(points,Math.max(10*60000,step*3)).map(segment=>({
            d:segment.map((p,i)=>(i?'L':'M')+x(p.at).toFixed(2)+','+y(p.remaining).toFixed(2)).join(' '),
            points:segment.map(p=>({...p,x:x(p.at),y:y(p.remaining)}))
        }));
    }
    const api={segments,paths};
    if(host)host.PetQuotaChart=api;else module.exports=api;
})(typeof window!=='undefined'?window:null);
