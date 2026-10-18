/* Shared, credential-free account quota presentation for both desktop windows. */
(function(host) {
    'use strict';
    const providers = [['codex','Codex'],['claudecode','Claude Code'],['antigravity','Antigravity']];
    function strings(english) {
        return english ? {live:'Live',cached:'Cached',unavailable:'Read failed',not_installed:'Not installed',signed_out:'Not signed in',api_key:'API Key mode · subscription quota unavailable',auth_required:'Sign in again',offline:'Not running',unsupported:'Quota not provided',rate_limited:'Rate limited',desktop_session_required:'Open a Code session in Claude Desktop',unknown:'Not provided',remaining:'remaining',reset:'Resets',updated:'Updated',five:'5 hours',weekly:'Weekly',choose:'Account quota',loading:'Reading account quotas…'} :
            {live:'实时',cached:'缓存',unavailable:'读取失败',not_installed:'未安装',signed_out:'未登录',api_key:'API Key 模式 · 无订阅额度',auth_required:'需要重新登录',offline:'未运行',unsupported:'未提供额度',rate_limited:'查询受限',desktop_session_required:'请在 Claude 桌面版打开 Code 会话',unknown:'未提供',remaining:'剩余',reset:'重置',updated:'更新于',five:'5 小时',weekly:'每周',choose:'账户额度',loading:'正在读取账户额度…'};
    }
    function time(value,english) {
        const stamp = new Date(value);
        return value && Number.isFinite(stamp.getTime()) ? stamp.toLocaleString(english?'en-US':'zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    }
    function groups(quotas, english) {
        const text = strings(english), entries = [];
        for (const [key,label] of providers) {
            const source = quotas?.[key];
            const list = source?.groups?.length ? source.groups : [{id:key,label,windows:[]}];
            for (const group of list) {
                const windows = ['5h','weekly'].map(id=>group.windows?.find(w=>w.id===id)||{id,remainingPercent:null,resetsAt:null});
                for(const w of group.windows || [])if(!['5h','weekly'].includes(w.id))windows.push(w);
                entries.push({key:key+':'+group.id,provider:key,status:source?.status || 'unavailable',
                    membership:source?.membership || null,
                    label:key === 'antigravity' ? label+' · '+(group.id === 'gemini' ? 'Gemini' : group.id === 'third-party' ? 'Claude / GPT' : group.label) : group.label || label,
                    state:source ? text[source.status] || text.unavailable : text.loading,
                    updated:time(source?.updatedAt,english),
                    windows:windows.map(w=>({...w,
                        value:typeof w.remainingPercent==='number'&&Number.isFinite(w.remainingPercent)?w.remainingPercent:null,
                        title:w.id==='5h'?text.five:w.id==='weekly'?text.weekly:w.label?text.weekly+' · '+w.label:w.durationMinutes?w.durationMinutes+' min':text.choose,
                        reset:time(w.resetsAt,english)}))});
            }
        }
        return entries;
    }
    function current(quotas, source, weekly, english) {
        const text = strings(english), entries = groups(quotas,english);
        const entry = entries.find(e=>e.key===source) || (source==='auto' ? entries.find(e=>e.status==='live'&&e.windows.some(w=>w.value!==null)) || entries.find(e=>e.status==='cached') : null) || entries[0];
        const w = entry.windows.find(w=>w.id===(weekly?'weekly':'5h'));
        return {label:'✦ '+entry.label+'\n'+w.title,val:w.value,empty:text.unknown,
            hint:[entry.state,w.reset?text.reset+' '+w.reset:'',entry.updated?text.updated+' '+entry.updated:''].filter(Boolean).join('\n')};
    }
    function render(container,quotas,english) {
        const text = strings(english), doc = container.ownerDocument;
        container.replaceChildren();
        for(const entry of groups(quotas,english)) {
            const card = doc.createElement('div'); card.className='quota-chip quota-account '+entry.provider;
            function line(value,className) {const el=doc.createElement('span');el.className=className||'';el.textContent=value;card.appendChild(el);}
            line(entry.label+(entry.membership ? ' · '+entry.membership.label : '')+' · '+entry.state,'quota-account-title');
            if(['live','cached','unsupported'].includes(entry.status)) {
                for(const w of entry.windows) {
                    line(w.title+' '+text.remaining+' '+(w.value===null?'—':Math.round(w.value)+'%')+(w.reset?' · '+text.reset+' '+w.reset:''));
                }
            }
            if(entry.updated)line(text.updated+' '+entry.updated,'quota-account-time');
            container.appendChild(card);
        }
    }
    const api={groups,current,render};
    if(host)host.PetQuotaView=api;else if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:null);
