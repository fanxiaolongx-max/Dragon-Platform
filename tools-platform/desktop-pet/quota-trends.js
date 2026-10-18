(function() {
    'use strict';
    const ipc=require('electron').ipcRenderer;
    const $=id=>document.getElementById(id);
    let selection={provider:'codex',groupId:'codex',windowId:'5h'}, data=null, sequence=0, failed=false, busy=false;
    const colors=['#74cdb8','#d6b479','#a49de0','#dc9a80','#73b9d9','#ca9cc0'];
    const english=()=>window.PetI18n.getLanguage()==='en-US';
    const tr=(zh,en)=>english()?en:zh;
    function date(at,short=false) {return at?new Date(at).toLocaleString(english()?'en-US':'zh-CN',short?{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}:{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';}
    const key=s=>s.groupId+':'+s.windowId;
    function label(s) {
        const period=s.windowId==='5h'?tr('5 小时','5 hours'):s.windowId==='weekly'?tr('每周','Weekly'):s.windowLabel?tr('每周 · ','Weekly · ')+s.windowLabel:s.durationMinutes?s.durationMinutes+' min':s.windowId;
        const name=selection.provider==='antigravity'?(s.groupId==='gemini'?'Gemini':s.groupId==='third-party'?'Claude / GPT':s.groupLabel):s.groupLabel || (selection.provider==='codex'?'Codex':'Claude Code');
        return name+' · '+period;
    }
    function option(select,value,text) {const o=document.createElement('option');o.value=value;o.textContent=text;select.appendChild(o);}
    function localize() {
        document.documentElement.lang=english()?'en-US':'zh-CN';
        document.title=$('title').textContent=tr('额度使用趋势','Quota trends');
        $('refresh').textContent=busy?tr('正在更新…','Updating…'):tr('刷新额度','Refresh quotas');
        const texts={providerLabel:['服务商','Provider'],seriesLabel:['额度 / 模型组','Quota / model group'],rangeLabel:['时间范围','Time range'],daysLabel:['天数','Days'],remainingLabel:['最新剩余','Latest remaining'],samplesLabel:['图中采样点','Plotted samples'],updatedLabel:['最新采样时间','Latest sample'],chartTitle:['额度随时间的变化','Quota over time']};
        for(const[id,words]of Object.entries(texts))$(id).textContent=tr(...words);
        $('cadence').textContent=tr('自动读取：Codex / Antigravity 60 秒 · Claude Code 120 秒；图表每 30 秒同步本地记录。记录额度比例，非 token 数。','Reads: Codex / Antigravity every 60s · Claude Code every 120s. Chart syncs every 30s. Quota percentages, not token counts.');
        $('scope').textContent=tr('曲线是账户或模型共享池的额度百分比，不是精确 token 数。Antigravity 的 Gemini、Claude / GPT 按共享池显示；Claude 若返回 Opus、Sonnet 独立周额度，也会出现在列表中。','These percentages describe account or shared model quotas, not exact token counts. Antigravity exposes Gemini and Claude / GPT pools. Separate weekly Opus / Sonnet quotas appear when Claude provides them.');
        $('retention').textContent=tr('仅在应用运行且桌宠、对话或趋势窗口可见时采集；保存最近 90 天。无法补回启用前或应用关闭期间的历史。','Collected while the app runs with a visible pet, chat or trends window; retained for 90 days. Earlier history and app-closed periods cannot be backfilled.');
        const range=$('range').value||'1';$('range').replaceChildren();
        for(const[v,zh,en]of [['1','近 24 小时','Last 24 hours'],['7','近 7 天','Last 7 days'],['30','近 30 天','Last 30 days'],['custom','自定义天数','Custom days']])option($('range'),v,tr(zh,en));
        $('range').value=range;
        const metric=$('metric').value||'remaining';$('metric').replaceChildren();
        option($('metric'),'remaining',tr('剩余比例 %','Remaining %'));option($('metric'),'used',tr('已用比例 %','Used %'));$('metric').value=metric;
        updateSeries();draw();
    }
    function updateSeries() {
        const previous=$('series').value||selection.groupId+':'+selection.windowId;
        $('series').replaceChildren();
        const series=data?.series||[];
        for(const s of series)option($('series'),key(s),label(s));
        const selectedKey=selection.groupId+':'+selection.windowId;
        if(!series.some(s=>key(s)===selectedKey))option($('series'),selectedKey,label({...selection}));
        if(series.filter(s=>s.windowId===selection.windowId).length>1)option($('series'),'compare',tr('同周期额度对比','Compare pools'));
        $('series').value=[...$('series').options].some(o=>o.value===previous)?previous:selectedKey;
    }
    function svg(name,attrs={},text) {
        const node=document.createElementNS('http://www.w3.org/2000/svg',name);
        for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));
        if(text!==undefined)node.textContent=text;
        return node;
    }
    function draw() {
        const chart=$('chart');chart.replaceChildren();$('legend').replaceChildren();
        const width=Math.max(300,chart.clientWidth||712);
        chart.setAttribute('viewBox','0 0 '+width+' 280');
        const now=Date.now(),from=data?.from||now-86400000,to=data?.to||now;
        for(const value of [0,25,50,75,100]) {
            const y=22+(100-value)*2.18;
            chart.append(svg('line',{x1:56,y1:y,x2:width-24,y2:y,class:'grid'}),svg('text',{x:44,y:y+3,'text-anchor':'end'},value+'%'));
        }
        const ticks=width<500?2:4;
        for(let i=0;i<=ticks;i++)chart.append(svg('text',{x:56+i*(width-80)/ticks,y:266,'text-anchor':i===0?'start':i===ticks?'end':'middle'},date(from+(to-from)*i/ticks,true)));
        const chosen=(data?.series||[]).filter(s=>$('series').value==='compare'?s.windowId===selection.windowId:key(s)===$('series').value);
        const all=chosen.flatMap(s=>s.points),latest=all.reduce((a,p)=>!a||p.at>a.at?p:a,null);
        $('latest').textContent=chosen.length===1&&latest?latest.remaining+'%':'—';
        $('samples').textContent=String(all.length);$('updated').textContent=date(latest?.at);
        $('empty').hidden=all.length>1||busy||failed;
        $('empty').textContent=all.length===1?tr('已记录第一个采样点，后续刷新会逐渐形成曲线。','First sample recorded. Future reads will build the curve.'):tr('此时间段暂无记录，历史会从启用后开始积累。','No samples in this period. History builds from activation.');
        chosen.forEach((s,index)=>{
            const color=colors[index%colors.length];
            for(const segment of window.PetQuotaChart.paths(s.points,from,to,data.step,$('metric').value==='used',width)) {
                chart.appendChild(svg('path',{d:segment.d,fill:'none',stroke:color,'stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'}));
                for(const point of segment.points) {
                    const dot=svg('circle',{cx:point.x,cy:point.y,r:segment.points.length===1?3:2,fill:color});
                    dot.appendChild(svg('title',{},label(s)+'\n'+date(point.at)+'\n'+tr('剩余 ','Remaining ')+point.remaining+'%'+(point.resetsAt?'\n'+tr('重置：','Resets: ')+date(point.resetsAt):'')));chart.appendChild(dot);
                }
            }
            const legend=document.createElement('span'),mark=document.createElement('i');mark.style.background=color;legend.append(mark,document.createTextNode(label(s)));$('legend').appendChild(legend);
        });
        chart.setAttribute('aria-label',tr('额度百分比时间曲线','Quota percentage over time'));
        $('status').textContent=failed?tr('本地历史暂时不可用，请稍后刷新重试。','Local history is unavailable. Refresh to retry.'):busy?tr('正在同步本地记录…','Syncing local history…'):tr('悬停采样点查看数值；重置、额度回升或较长停采会断开曲线。长范围图按时间桶取最后一个点。','Hover over points for details. Resets, quota increases and sampling gaps break the line. Longer ranges use the last sample per time bucket.');
        $('coverage').textContent=data?.firstSampleAt?tr('此服务商开始记录于：','Recording this provider since: ')+date(data.firstSampleAt):tr('尚未采集到此服务商的有效额度。','No valid quota samples for this provider yet.');
    }
    async function load(refresh=false) {
        const days=$('range').value==='custom'?Number($('days').value):Number($('range').value||1);
        if(!Number.isInteger(days)||days<1||days>90){$('days').setCustomValidity(tr('请输入 1–90 的整数','Enter an integer from 1 to 90'));$('days').reportValidity();return;}
        $('days').setCustomValidity('');
        const version=++sequence;busy=true;failed=false;$('refresh').disabled=true;localize();
        try {const result=await ipc.invoke('pet-quota-history',{provider:selection.provider,days,refresh});if(version!==sequence)return;data=result;}
        catch(_){if(version!==sequence)return;data=null;failed=true;}
        if(version!==sequence)return;busy=false;$('refresh').disabled=false;localize();
    }
    function select(next) {
        if(!next)return;
        selection=next;$('provider').value=next.provider;data=null;$('series').replaceChildren();localize();load();
    }
    $('provider').addEventListener('change',()=>select({provider:$('provider').value,groupId:$('provider').value==='antigravity'?'gemini':$('provider').value,windowId:selection.windowId}));
    $('series').addEventListener('change',()=>{const chosen=data?.series.find(s=>key(s)===$('series').value);if(chosen)selection={...selection,groupId:chosen.groupId,windowId:chosen.windowId};draw();});
    $('range').addEventListener('change',()=>{$('customWrap').hidden=$('range').value!=='custom';load();});
    $('days').addEventListener('change',()=>load());$('metric').addEventListener('change',draw);$('refresh').addEventListener('click',()=>load(true));
    window.addEventListener('pet:languagechange',localize);
    window.addEventListener('resize',draw);
    ipc.on('pet-quota-trends-selection',(_event,next)=>select(next));
    ipc.invoke('pet-quota-trends-ready').then(select).catch(()=>{failed=true;localize();});
    setInterval(()=>{if(!document.hidden&&!busy)load();},30000);
    localize();
})();
