/* Built-in cell templates for AI reports: tested rendering code with a parameter schema.
   A cell that uses templates keeps three things apart:
     data   — recipe.compute turns this month's data into the shape a template expects (the only code the AI writes);
     view   — which template(s) to use, in which slots, with which parameters (plain JSON, editable without AI);
     layout — slot sizes the user dragged (cell.layout, handled by kit.layout like any other cell).
   Runs in the sandbox worker (render), on the page (parameter panel) and on the server (catalog for prompts). */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AiReportTemplates=api;})(typeof self!=='undefined'?self:typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const VERSION=1;
    const GOOD='#2f9e6f',WARN='#e0a33a',BAD='#d4554f',MUTED='#b8c4d2',INK='#5b6b7d';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    // Rows reach templates wrapped in a proxy that reports fields read on every row but present on none, so optional
    // fields are tested with `in` (which the proxy does not count) before they are read.
    const has=(object,key)=>object!==null&&typeof object==='object'&&key in object;
    const pick=(object,...keys)=>{for(const key of keys)if(has(object,key))return object[key];return undefined;};
    const num=value=>{if(value===null||value===undefined||typeof value==='boolean')return null;const text=String(value).replace(/[,%\s]/g,'');if(!text)return null;const number=typeof value==='number'?value:Number(text);return Number.isFinite(number)?number:null;};
    const round=(value,digits)=>value===null||value===undefined?null:Number(Number(value).toFixed(digits));
    const places=(values,wanted)=>wanted>=0?wanted:values.filter(value=>value!==null).every(Number.isInteger)?0:1;
    const fmt=(value,digits)=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
    const titleHtml=text=>text?`<div class="kit-title">${esc(text)}</div>`:'';
    function fail(template,message){throw new Error(`模板「${template.name.zh}」（${template.id}）：${message}`);}
    const typeName=value=>Array.isArray(value)?'数组':value===null?'null':typeof value==='object'?'对象':typeof value;

    // ── Parameters ────────────────────────────────────────────────────────────────────────────────────────────
    // type: text | number | bool | select. number may be nullable (empty = not set). Labels are [zh, en].
    const PARAMS={
        title:{type:'text',label:['标题','Title'],default:'',max:80},
        unit:{type:'text',label:['单位','Unit'],default:'',max:12},
        decimals:{type:'number',label:['小数位（-1 自动）','Decimals (-1 auto)'],default:-1,min:-1,max:4},
        height:{type:'number',label:['高度（像素）','Height (px)'],default:300,min:140,max:900,step:10},
        showValue:{type:'bool',label:['显示数值','Show values'],default:true},
        sort:{type:'select',label:['排序','Sort'],default:'none',options:[['none','保持原顺序','As given'],['desc','从大到小','Largest first'],['asc','从小到大','Smallest first']]},
        limit:{type:'number',label:['最多显示几项（0 不限）','Max items (0 = all)'],default:0,min:0,max:200},
        orientation:{type:'select',label:['方向','Direction'],default:'vertical',options:[['vertical','竖向柱','Vertical'],['horizontal','横向条','Horizontal']]},
        rule:{type:'select',label:['达标规则','Pass rule'],default:'gte',options:[['gte','越高越好（≥ 目标达标）','Higher is better'],['lte','越低越好（≤ 目标达标）','Lower is better']]},
        target:{type:'number',label:['统一目标值（留空用数据里的）','Common target (blank = from data)'],default:null,nullable:true},
        legend:{type:'select',label:['图例','Legend'],default:'top',options:[['top','顶部','Top'],['bottom','底部','Bottom'],['right','右侧','Right'],['none','不显示','Hidden']]},
        columns:{type:'number',label:['每行几个','Per row'],default:0,min:0,max:6},
        highlight:{type:'select',label:['突出显示','Highlight'],default:'none',options:[['none','不突出','None'],['max','最高','Highest'],['min','最低','Lowest'],['both','最高和最低','Both']]},
        smooth:{type:'bool',label:['平滑曲线','Smooth line'],default:false},
        area:{type:'bool',label:['填充面积','Fill area'],default:false},
        valueLabels:{type:'select',label:['数值标签','Value labels'],default:'last',options:[['none','不显示','None'],['last','只标最后一个','Last point'],['all','全部显示','All']]},
        markExtremes:{type:'bool',label:['标出最高最低','Mark max / min'],default:false},
        percent:{type:'bool',label:['按百分比堆叠','Stack to 100%'],default:false},
        max:{type:'number',label:['满刻度（留空自动）','Scale max (blank = auto)'],default:null,nullable:true},
        warnAt:{type:'number',label:['预警线（% ，低于标黄）','Warning line (%)'],default:90,min:0,max:200},
        donut:{type:'bool',label:['环形','Donut'],default:true},
        labels:{type:'select',label:['标签','Labels'],default:'outside',options:[['outside','外侧','Outside'],['inside','内侧','Inside'],['none','不显示','None']]},
        centerText:{type:'text',label:['中心说明（环形）','Centre caption'],default:'合计',max:20},
        others:{type:'number',label:['超过几项合并为“其他”（0 不合并）','Merge into "Other" after (0 = never)'],default:8,min:0,max:30},
        pageSize:{type:'number',label:['每页行数','Rows per page'],default:10,min:5,max:100},
        maxRows:{type:'number',label:['最多显示行数','Max rows'],default:50,min:1,max:500},
        search:{type:'bool',label:['显示搜索框','Search box'],default:true},
        tone:{type:'select',label:['语气颜色','Tone'],default:'info',options:[['info','说明（蓝）','Info'],['good','正向（绿）','Positive'],['warn','提醒（黄）','Warning'],['bad','风险（红）','Risk']]},
        ordered:{type:'bool',label:['编号列表','Numbered'],default:false},
        currentLabel:{type:'text',label:['本期名称','Current label'],default:'本月',max:12},
        previousLabel:{type:'text',label:['对比期名称','Previous label'],default:'上月',max:12},
        leftUnit:{type:'text',label:['左轴单位','Left unit'],default:'',max:12},
        rightUnit:{type:'text',label:['右轴单位','Right unit'],default:'%',max:12},
        xLabel:{type:'text',label:['横轴名称','X axis name'],default:'',max:20},
        yLabel:{type:'text',label:['纵轴名称','Y axis name'],default:'',max:20},
        guides:{type:'select',label:['象限分隔线','Quadrant lines'],default:'mean',options:[['mean','平均值','Mean'],['none','不画','None']]},
        showLabels:{type:'bool',label:['显示名称','Show names'],default:true},
        showTotal:{type:'bool',label:['末尾显示合计','Total bar at the end'],default:true},
        scheme:{type:'select',label:['配色','Colours'],default:'blue',options:[['blue','蓝色深浅','Blue scale'],['rg','红黄绿（高好）','Red–green (high good)'],['gr','绿黄红（低好）','Green–red (low good)']]},
    };
    const param=(key,overrides={})=>({key,...PARAMS[key],...overrides});

    function cleanParam(def,value){
        if(value===undefined)return def.default;
        if(def.type==='bool')return value===true||value==='true'?true:value===false||value==='false'?false:def.default;
        if(def.type==='number'){
            if(def.nullable&&(value===null||value===''))return null;
            const number=num(value);if(number===null)return def.default;
            return Math.min(def.max??Infinity,Math.max(def.min??-Infinity,number));
        }
        if(def.type==='select')return def.options.some(option=>option[0]===value)?value:def.default;
        return String(value??'').slice(0,def.max||200);
    }

    // ── Data shapes ───────────────────────────────────────────────────────────────────────────────────────────
    const KINDS={
        items:{zh:'分类数值',shape:'[{label, value, target?, previous?, tone?, note?}]',example:[{label:'TE',value:96.2,target:95},{label:'ORG',value:91.5,target:95}]},
        series:{zh:'多系列',shape:'{categories:[分类或月份…], series:[{name, values:[与 categories 等长的数字], type?:"bar"|"line", axis?:"right"}], target?}',example:{categories:['7月','8月','9月'],series:[{name:'回传率',values:[93.1,94.8,96.2]}],target:95}},
        matrix:{zh:'矩阵',shape:'{rows:[行名…], columns:[列名…], values:[[数字…]…], status?:[["good"|"warn"|"bad"|""…]…], targets?:[每列目标…]}',example:{rows:['TE','ORG'],columns:['回传率','及时率'],values:[[96,88],[91,97]],targets:[95,90]}},
        kpis:{zh:'指标卡',shape:'[{label, value, unit?, delta?, deltaLabel?, target?, tone?:"good"|"bad", spark?:[近几期数字], note?}]',example:[{label:'事故数',value:3,unit:'起',delta:-2,tone:'good',spark:[6,5,5,3]}]},
        rows:{zh:'明细行',shape:'[{列名: 值…}] 或 {rows:[…], columns:[{key, label, format?:"number"|"percent"|"text", align?}]}；行里可加 $tone:"bad"|"good"',example:{rows:[{name:'TE',rate:96.2}],columns:[{key:'name',label:'运营商'},{key:'rate',label:'回传率',format:'number'}]}},
        points:{zh:'散点',shape:'[{label, x, y, size?, group?}]',example:[{label:'TE',x:120,y:96.2,size:30}]},
        events:{zh:'事件',shape:'[{date, title, text?, tone?:"good"|"warn"|"bad"}]',example:[{date:'09-12',title:'核心网割接',text:'按计划完成，无业务影响',tone:'good'}]},
        text:{zh:'文字',shape:'"一段文字（**…** 加粗）" 或 {title?, text}',example:'本月回传率 **96.2%**，较上月提升 1.4 个百分点。'},
        list:{zh:'要点',shape:'["一条要点", …] 或 [{label?, text, tone?:"good"|"bad"}]',example:[{label:'TE',text:'回传率 96.2%，已达标',tone:'good'}]},
        tree:{zh:'层级',shape:'{name, children:[{name, value?, children?}]}',example:{name:'全部',children:[{name:'北非',children:[{name:'埃及',value:12},{name:'摩洛哥',value:5}]}]}},
        flow:{zh:'流向',shape:'{nodes?:[名称…], links:[{source, target, value}]}',example:{links:[{source:'热线',target:'一线',value:120},{source:'一线',target:'闭环',value:96}]}},
        groups:{zh:'分组样本',shape:'[{label, values:[每个样本的数字…]}]',example:[{label:'一线',values:[2,3,3,4,5,8,13]},{label:'二线',values:[5,6,7,9,15]}]},
        tasks:{zh:'任务',shape:'[{label, start:"YYYY-MM-DD", end:"YYYY-MM-DD", progress?:0-100, tone?, owner?}]',example:[{label:'核心网扩容',start:'2026-09-01',end:'2026-11-15',progress:60,owner:'张三'}]},
        daily:{zh:'按天',shape:'[{date:"YYYY-MM-DD", value}]',example:[{date:'2026-10-01',value:12},{date:'2026-10-02',value:7}]},
        links:{zh:'跳转链接',shape:'[{label, anchor, no?, note?}]（anchor 取自月报内容来源）',example:[{label:'风险治理',anchor:'#air-chapter-x',no:'01'}]},
    };

    function readItems(template,data){
        if(!Array.isArray(data))fail(template,`数据要是数组 ${KINDS.items.shape}，实际是${typeName(data)}`);
        const items=data.map((row,index)=>{
            if(!row||typeof row!=='object')fail(template,`第 ${index+1} 项不是对象`);
            const label=pick(row,'label','name','category');
            if(label===undefined||label===null||String(label).trim()==='')fail(template,`第 ${index+1} 项缺少 label（分类名称）`);
            return {label:String(label),value:num(pick(row,'value')),target:num(pick(row,'target')),previous:num(pick(row,'previous')),total:pick(row,'total')===true,tone:pick(row,'tone'),note:pick(row,'note')};
        });
        if(items.length&&items.every(item=>item.value===null))fail(template,'每一项的 value 都不是数字（"95%" 这类文字要先在 compute 里转成数字 95）');
        return items;
    }
    function readSeries(template,data){
        if(!data||typeof data!=='object'||Array.isArray(data))fail(template,`数据要是对象 ${KINDS.series.shape}，实际是${typeName(data)}`);
        const categories=pick(data,'categories'),series=pick(data,'series');
        if(!Array.isArray(categories)||!categories.length)fail(template,'缺少 categories（横轴分类或月份）');
        if(!Array.isArray(series)||!series.length)fail(template,'缺少 series（至少一个系列）');
        return {categories:categories.map(String),target:num(pick(data,'target')),series:series.map((item,index)=>{
            const values=pick(item,'values');
            if(!Array.isArray(values))fail(template,`第 ${index+1} 个系列缺少 values 数组`);
            if(values.length!==categories.length)fail(template,`第 ${index+1} 个系列的 values 有 ${values.length} 个，要和 categories 一样是 ${categories.length} 个（没有数据的位置放 null）`);
            return {name:String(pick(item,'name')??`系列${index+1}`),values:values.map(num),type:pick(item,'type'),axis:pick(item,'axis')};
        })};
    }
    function readMatrix(template,data){
        if(!data||typeof data!=='object'||Array.isArray(data))fail(template,`数据要是对象 ${KINDS.matrix.shape}`);
        const rows=pick(data,'rows'),columns=pick(data,'columns'),values=pick(data,'values');
        if(!Array.isArray(rows)||!Array.isArray(columns)||!Array.isArray(values))fail(template,'需要 rows、columns、values 三个数组');
        if(values.length!==rows.length||values.some(row=>!Array.isArray(row)||row.length!==columns.length))fail(template,`values 要是 ${rows.length} 行 × ${columns.length} 列`);
        const status=pick(data,'status'),targets=pick(data,'targets');
        return {rows:rows.map(String),columns:columns.map(String),values:values.map(row=>row.map(num)),status:Array.isArray(status)?status:null,targets:Array.isArray(targets)?targets.map(num):null};
    }
    function readKpis(template,data){
        const list=Array.isArray(data)?data:data&&typeof data==='object'?[data]:null;
        if(!list||!list.length)fail(template,`数据要是数组 ${KINDS.kpis.shape}`);
        return list.map((row,index)=>{
            const label=pick(row,'label','name');if(label===undefined)fail(template,`第 ${index+1} 项缺少 label`);
            // A value read from a column that does not exist disappears from the result (undefined): say so instead of an empty card.
            if(!row||typeof row!=='object'||!('value' in row))fail(template,`「${label}」缺少 value：compute 读取的字段在数据里不存在（没有值时请明确写 value: null）`);
            const spark=pick(row,'spark');
            return {label:String(label),value:pick(row,'value'),number:num(pick(row,'value')),unit:pick(row,'unit')??'',delta:pick(row,'delta'),deltaLabel:pick(row,'deltaLabel'),deltaUnit:pick(row,'deltaUnit'),target:num(pick(row,'target')),tone:pick(row,'tone'),spark:Array.isArray(spark)?spark.map(num):null,note:pick(row,'note')};
        });
    }
    function readRows(template,data){
        const rows=Array.isArray(data)?data:Array.isArray(pick(data,'rows'))?pick(data,'rows'):null;
        if(!rows)fail(template,`数据要是 ${KINDS.rows.shape}`);
        const columns=Array.isArray(data)?null:pick(data,'columns');
        return {rows,columns:Array.isArray(columns)?columns.map(column=>typeof column==='string'?{key:column,label:column}:{key:String(pick(column,'key')),label:String(pick(column,'label')??pick(column,'key')),...(has(column,'format')?{format:column.format}:{}),...(has(column,'align')?{align:column.align}:{})}):null};
    }
    function readPoints(template,data){
        if(!Array.isArray(data))fail(template,`数据要是数组 ${KINDS.points.shape}`);
        return data.map((row,index)=>{const x=num(pick(row,'x')),y=num(pick(row,'y'));if(x===null||y===null)fail(template,`第 ${index+1} 个点的 x / y 不是数字`);return {label:String(pick(row,'label','name')??''),x,y,size:num(pick(row,'size')),group:pick(row,'group')};});
    }

    // ── ECharts helpers (options are plain JSON: the platform renders them with the report theme) ──────────────
    const legendOf=(position,names)=>position==='none'||names.length<2?{show:false}:position==='bottom'?{bottom:0,type:'scroll'}:position==='right'?{right:0,top:'middle',orient:'vertical',type:'scroll'}:{top:0,type:'scroll'};
    function grid({legend='none',count=1,horizontal=false,extraTop=0}={}){
        // Room for the legend plus value labels above the tallest bar, which would otherwise run into it.
        const top=(legend==='top'&&count>1?44:20)+extraTop;
        return {left:8,right:legend==='right'&&count>1?110:horizontal?48:16,top,bottom:legend==='bottom'&&count>1?32:6,containLabel:true};
    }
    function categoryAxis(categories,{horizontal=false,width=600}={}){
        const crowded=!horizontal&&categories.length>8;
        return {type:'category',data:categories,inverse:horizontal,axisTick:{alignWithLabel:true},axisLabel:{interval:0,hideOverlap:true,width:horizontal?120:Math.max(44,Math.floor(width/Math.max(1,categories.length))-6),overflow:'truncate',rotate:crowded?30:0}};
    }
    const valueAxis=(unit='',extra={})=>({type:'value',axisLabel:{formatter:'{value}'+unit},splitLine:{lineStyle:{type:'dashed',color:'#e3e9f0'}},...extra});
    const valueLabel=(show,position,unit)=>({show:!!show,position,formatter:'{c}'+unit,fontSize:11});
    const chart=(kit,option,p)=>kit.chart({tooltip:{trigger:'axis',axisPointer:{type:'shadow'},confine:true},...option},{title:p.title,height:p.height});
    function sorted(items,order){if(order==='desc')return [...items].sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity));if(order==='asc')return [...items].sort((a,b)=>(a.value??Infinity)-(b.value??Infinity));return items;}
    const limited=(items,limit)=>limit>0?items.slice(0,limit):items;
    const passes=(value,target,rule)=>value===null||target===null?null:rule==='lte'?value<=target:value>=target;
    const emptyChart=p=>titleHtml(p.title)+'<div class="kit-empty">无数据</div>';
    function deltaText(item){
        const label=item.deltaLabel===undefined||item.deltaLabel===null?'较上月':String(item.deltaLabel),number=num(item.delta);
        if(number===null)return esc(item.delta);
        if(number===0)return esc(label.startsWith('较')?`与${label.slice(1)}持平`:`${label} 持平`);
        const digits=Math.min(2,(String(Math.abs(number)).split('.')[1]||'').length);
        return esc(`${label} ${number>0?'+':'−'}${fmt(Math.abs(number),digits)}${item.deltaUnit??item.unit??''}`);
    }
    const toneColor=tone=>tone==='good'?GOOD:tone==='bad'?BAD:tone==='warn'?WARN:'var(--air-accent,#2f6fae)';
    function sparkline(values,tone){
        const list=(values||[]).filter(value=>value!==null);if(list.length<2)return '';
        const low=Math.min(...list),high=Math.max(...list),span=high-low||1,step=100/(list.length-1);
        const points=list.map((value,index)=>`${(index*step).toFixed(1)},${(26-(value-low)/span*22).toFixed(1)}`).join(' ');
        return `<svg viewBox="0 0 100 28" preserveAspectRatio="none" width="100%" height="28" role="img"><polyline fill="none" stroke="${toneColor(tone)}" stroke-width="2" vector-effect="non-scaling-stroke" points="${points}"/></svg>`;
    }

    // ── Templates ─────────────────────────────────────────────────────────────────────────────────────────────
    // Each: id, kind (data shape), name, use (when to pick it), params, render(data, p, kit).
    const TEMPLATES=[];
    const define=template=>{template.params=template.params.map(entry=>typeof entry==='string'?param(entry):param(entry[0],entry[1]));TEMPLATES.push(template);};

    define({id:'bar-basic',kind:'items',group:'对比',name:{zh:'柱状对比',en:'Bar comparison'},use:'几个分类之间比大小（各运营商、各部门、各类型的数量或比率）',
        params:['title','unit','decimals','orientation','sort','limit','showValue','highlight','height'],
        render(data,p,kit){
            const items=limited(sorted(readItems(this,data),p.sort),p.limit);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),horizontal=p.orientation==='horizontal';
            const values=items.map(item=>item.value),high=Math.max(...values.filter(v=>v!==null)),low=Math.min(...values.filter(v=>v!==null));
            const mark=value=>(p.highlight==='max'||p.highlight==='both')&&value===high?GOOD:(p.highlight==='min'||p.highlight==='both')&&value===low?BAD:null;
            const series={type:'bar',barMaxWidth:44,data:items.map(item=>{const color=mark(item.value);return color?{value:round(item.value,digits),itemStyle:{color}}:round(item.value,digits);}),label:valueLabel(p.showValue,horizontal?'right':'top',p.unit)};
            return chart(kit,{grid:grid({horizontal}),[horizontal?'yAxis':'xAxis']:categoryAxis(items.map(item=>item.label),{horizontal}),[horizontal?'xAxis':'yAxis']:valueAxis(p.unit),series:[series]},{...p,height:horizontal?Math.max(p.height,items.length*30+40):p.height});
        }});
    define({id:'bar-target',kind:'items',group:'达标',name:{zh:'达标对比柱（目标线 + 未达标标红）',en:'Bars against target'},use:'各分类对照目标值，一眼看出谁没达标（回传率、及时率、达成率等考核指标）',
        params:['title','unit','decimals','rule','target','orientation','sort','showValue','height'],
        render(data,p,kit){
            const items=sorted(readItems(this,data),p.sort);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),horizontal=p.orientation==='horizontal';
            const targets=items.map(item=>p.target??item.target),same=targets.every(value=>value!==null&&value===targets[0]);
            const series=[{type:'bar',name:'实际',barMaxWidth:44,label:valueLabel(p.showValue,horizontal?'right':'top',p.unit),
                data:items.map((item,index)=>{const ok=passes(item.value,targets[index],p.rule);return ok===false?{value:round(item.value,digits),itemStyle:{color:BAD}}:round(item.value,digits);}),
                ...(same&&targets[0]!==null?{markLine:{symbol:'none',silent:true,lineStyle:{type:'dashed',color:INK},label:{position:horizontal?'start':'insideEndTop',distance:6,formatter:'目标 '+fmt(targets[0],places([targets[0]],-1))+p.unit,color:INK},data:[horizontal?{xAxis:targets[0]}:{yAxis:targets[0]}]}}:{})}];
            if(!same&&targets.some(value=>value!==null))series.push({type:'scatter',name:'目标',symbol:'rect',symbolSize:horizontal?[3,22]:[26,3],itemStyle:{color:INK},z:5,data:targets.map(value=>value===null?null:round(value,digits))});
            return chart(kit,{grid:{...grid({horizontal}),top:horizontal?24:12},legend:{show:false},[horizontal?'yAxis':'xAxis']:categoryAxis(items.map(item=>item.label),{horizontal}),[horizontal?'xAxis':'yAxis']:valueAxis(p.unit),series},{...p,height:horizontal?Math.max(p.height,items.length*30+40):p.height});
        }});
    define({id:'rank-bar',kind:'items',group:'排名',name:{zh:'排名条形（前 N 名）',en:'Ranking bars'},use:'排行榜：谁最多 / 最好，前几名重点突出（工单量 TOP10、故障最多的站点）',
        params:['title','unit','decimals',['sort',{default:'desc'}],['limit',{default:10}],'showValue','height'],
        render(data,p,kit){
            const items=limited(sorted(readItems(this,data),p.sort),p.limit);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals);
            const series={type:'bar',barMaxWidth:22,showBackground:true,backgroundStyle:{color:'#f1f4f8',borderRadius:4},itemStyle:{borderRadius:[0,4,4,0]},label:valueLabel(p.showValue,'right',p.unit),
                data:items.map((item,index)=>({value:round(item.value,digits),itemStyle:{opacity:index<3?1:0.55}}))};
            return chart(kit,{grid:grid({horizontal:true}),yAxis:categoryAxis(items.map((item,index)=>`${index+1}. ${item.label}`),{horizontal:true}),xAxis:valueAxis(p.unit,{splitLine:{show:false},axisLabel:{show:false}}),series:[series]},{...p,height:Math.max(160,items.length*30+30)});
        }});
    define({id:'progress-list',kind:'items',group:'达标',name:{zh:'完成进度条',en:'Progress bars'},use:'各项完成了目标的多少（完成率、达成率），到 100% 为满格；未达预警线标黄、明显落后标红',
        params:['title','decimals',['warnAt',{default:90}],['sort',{default:'none'}],'height'],
        render(data,p,kit){
            const items=sorted(readItems(this,data),p.sort).map(item=>({...item,rate:item.target?item.value/item.target*100:item.value}));if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.rate),p.decimals<0?1:p.decimals);
            const colorOf=rate=>rate>=100?GOOD:rate>=p.warnAt?WARN:BAD;
            const series={type:'bar',barMaxWidth:16,showBackground:true,backgroundStyle:{color:'#eef2f6',borderRadius:8},itemStyle:{borderRadius:8},label:{show:true,position:'right',formatter:'{c}%',fontSize:11},
                data:items.map(item=>({value:round(item.rate,digits),itemStyle:{color:colorOf(item.rate)}}))};
            return chart(kit,{grid:{...grid({horizontal:true}),right:56},yAxis:categoryAxis(items.map(item=>item.label),{horizontal:true}),xAxis:{type:'value',max:Math.max(100,...items.map(item=>Math.ceil(item.rate))),show:false},series:[series]},{...p,height:Math.max(140,items.length*32+24)});
        }});
    define({id:'pie-donut',kind:'items',group:'构成',name:{zh:'占比环形图',en:'Share donut'},use:'整体由哪几部分组成、各占多少（工单类型占比、原因分布），分类不宜超过 8 个',
        params:['title','unit','decimals','donut','labels',['legend',{default:'right'}],'others','centerText','height'],
        render(data,p,kit){
            let items=sorted(readItems(this,data),'desc').filter(item=>item.value>0);if(!items.length)return emptyChart(p);
            if(p.others>0&&items.length>p.others){const rest=items.slice(p.others-1);items=[...items.slice(0,p.others-1),{label:'其他',value:rest.reduce((sum,item)=>sum+item.value,0)}];}
            const digits=places(items.map(item=>item.value),p.decimals),total=items.reduce((sum,item)=>sum+item.value,0),side=p.legend==='right';
            const center=[side?'38%':'50%',p.legend==='top'?'56%':'50%'];
            const series={type:'pie',radius:p.donut?['46%','70%']:['0%','70%'],center,avoidLabelOverlap:true,itemStyle:{borderColor:'#fff',borderWidth:2},
                label:p.labels==='none'?{show:false}:{show:true,position:p.labels,formatter:p.labels==='inside'?'{d}%':'{b}\n{d}%',fontSize:11},labelLine:{show:p.labels==='outside'},
                data:items.map(item=>({name:item.label,value:round(item.value,digits)}))};
            const option={tooltip:{trigger:'item',formatter:'{b}：{c}'+p.unit+'（{d}%）',confine:true},legend:legendOf(p.legend,items),series:[series]};
            if(p.donut)option.title={text:fmt(total,digits)+p.unit,subtext:p.centerText,left:center[0],top:'center',textAlign:'center',textStyle:{fontSize:20,fontWeight:600},subtextStyle:{fontSize:12}};
            return kit.chart(option,{title:p.title,height:p.height});
        }});
    define({id:'rose',kind:'items',group:'构成',name:{zh:'南丁格尔玫瑰图',en:'Rose chart'},use:'构成占比但更强调数量差异、版面要醒目时',
        params:['title','unit','decimals',['legend',{default:'bottom'}],'height'],
        render(data,p,kit){
            const items=sorted(readItems(this,data),'desc').filter(item=>item.value>0);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals);
            return kit.chart({tooltip:{trigger:'item',formatter:'{b}：{c}'+p.unit+'（{d}%）',confine:true},legend:legendOf(p.legend,items),series:[{type:'pie',roseType:'area',radius:['14%','72%'],center:['50%',p.legend==='bottom'?'46%':'52%'],itemStyle:{borderRadius:4,borderColor:'#fff',borderWidth:1},label:{formatter:'{b}\n{c}'+p.unit,fontSize:11},data:items.map(item=>({name:item.label,value:round(item.value,digits)}))}]},{title:p.title,height:p.height});
        }});
    define({id:'funnel',kind:'items',group:'流程',name:{zh:'漏斗图',en:'Funnel'},use:'逐级转化或逐步筛减的流程（受理 → 派单 → 处理 → 闭环）',
        params:['title','unit','decimals','height'],
        render(data,p,kit){
            const items=readItems(this,data);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),first=items[0].value||1;
            return kit.chart({tooltip:{trigger:'item',formatter:'{b}：{c}'+p.unit,confine:true},series:[{type:'funnel',left:'8%',right:'8%',top:8,bottom:8,sort:'none',gap:3,label:{position:'inside',fontSize:12},
                data:items.map(item=>({name:item.label,value:round(item.value,digits),label:{formatter:`${item.label}  ${fmt(round(item.value,digits),digits)}${p.unit}（${fmt(item.value/first*100,1)}%）`}}))}]},{title:p.title,height:p.height});
        }});
    define({id:'treemap',kind:'items',group:'构成',name:{zh:'矩形树图',en:'Treemap'},use:'分类很多（10 个以上）的构成，面积代表大小',
        params:['title','unit','decimals','height'],
        render(data,p,kit){
            const items=sorted(readItems(this,data),'desc').filter(item=>item.value>0);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals);
            return kit.chart({tooltip:{trigger:'item',formatter:'{b}：{c}'+p.unit,confine:true},series:[{type:'treemap',roam:false,nodeClick:false,breadcrumb:{show:false},left:0,right:0,top:0,bottom:0,label:{formatter:'{b}\n{c}'+p.unit,fontSize:12},itemStyle:{borderColor:'#fff',borderWidth:2,gapWidth:2},data:items.map(item=>({name:item.label,value:round(item.value,digits)}))}]},{title:p.title,height:p.height});
        }});
    define({id:'pareto',kind:'items',group:'排名',name:{zh:'帕累托图（主要问题）',en:'Pareto'},use:'找出占大头的少数原因（故障原因、投诉类型），柱从大到小 + 累计占比线 + 80% 线',
        params:['title','unit','decimals','showValue','height'],
        render(data,p,kit){
            const items=sorted(readItems(this,data),'desc').filter(item=>item.value>0);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),total=items.reduce((sum,item)=>sum+item.value,0);let running=0;
            const cumulative=items.map(item=>{running+=item.value;return round(running/total*100,1);});
            return chart(kit,{grid:grid({count:2,legend:'top'}),legend:{top:0},xAxis:categoryAxis(items.map(item=>item.label)),yAxis:[valueAxis(p.unit),{type:'value',max:100,axisLabel:{formatter:'{value}%'},splitLine:{show:false}}],
                series:[{type:'bar',name:'数量',barMaxWidth:40,label:valueLabel(p.showValue,'top',p.unit),data:items.map(item=>round(item.value,digits))},
                    {type:'line',name:'累计占比',yAxisIndex:1,symbolSize:6,itemStyle:{color:WARN},label:{show:false},data:cumulative,markLine:{symbol:'none',silent:true,lineStyle:{type:'dashed',color:BAD},label:{formatter:'80%',position:'insideEndTop'},data:[{yAxis:80}]}}]},p);
        }});
    define({id:'waterfall',kind:'items',group:'变化',name:{zh:'瀑布图（变化分解）',en:'Waterfall'},use:'从上月到本月的变化由哪些因素构成（增加项、减少项），total:true 的项画成整根（期初、期末）',
        params:['title','unit','decimals','rule','showTotal','showValue','height'],
        render(data,p,kit){
            const items=readItems(this,data);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),up=p.rule==='lte'?BAD:GOOD,down=p.rule==='lte'?GOOD:BAD;
            const base=[],rise=[],fall=[],totals=[],labels=[];let running=0;
            for(const item of items){
                const value=item.value??0;labels.push(item.label);
                if(item.total){base.push(0);rise.push(null);fall.push(null);totals.push(round(value,digits));running=value;}
                else if(value>=0){base.push(round(running,digits));rise.push(round(value,digits));fall.push(null);totals.push(null);running+=value;}
                else{running+=value;base.push(round(running,digits));rise.push(null);fall.push(round(-value,digits));totals.push(null);}
            }
            if(p.showTotal&&!items[items.length-1].total){labels.push('合计');base.push(0);rise.push(null);fall.push(null);totals.push(round(running,digits));}
            const bar=(name,values,color,prefix)=>({type:'bar',name,stack:'w',barMaxWidth:40,itemStyle:{color},label:{show:p.showValue,position:'top',formatter:prefix+'{c}'+p.unit,fontSize:11},data:values});
            return chart(kit,{grid:grid(),legend:{show:false},xAxis:categoryAxis(labels),yAxis:valueAxis(p.unit),
                series:[{type:'bar',stack:'w',silent:true,itemStyle:{color:'transparent'},emphasis:{disabled:true},tooltip:{show:false},data:base},bar('增加',rise,up,'+'),bar('减少',fall,down,'−'),bar('合计',totals,'#2f6fae','')]},p);
        }});
    define({id:'bar-compare',kind:'items',group:'变化',name:{zh:'本月与上月对比柱',en:'This vs last period'},use:'各分类本月和上月（或去年同期）并排对比，柱顶标出变化（items 每项要有 previous）',
        params:['title','unit','decimals','currentLabel','previousLabel','rule','showValue','height'],
        render(data,p,kit){
            const items=readItems(this,data);if(!items.length)return emptyChart(p);
            const digits=places(items.flatMap(item=>[item.value,item.previous]),p.decimals);
            const current=items.map(item=>{const value=round(item.value,digits);if(item.previous===null||value===null||!p.showValue)return value;const change=round(item.value-item.previous,digits),better=p.rule==='lte'?change<0:change>0;
                return {value,label:{show:true,position:'top',fontSize:11,formatter:`${fmt(value,digits)}${p.unit}  ${change===0?'持平':(change>0?'↑':'↓')+fmt(Math.abs(change),digits)}`,color:change===0?INK:better?GOOD:BAD}};});
            return chart(kit,{grid:grid({count:2,legend:'top'}),legend:{top:0},xAxis:categoryAxis(items.map(item=>item.label)),yAxis:valueAxis(p.unit),
                series:[{type:'bar',name:p.previousLabel,barMaxWidth:30,itemStyle:{color:MUTED},data:items.map(item=>round(item.previous,digits))},{type:'bar',name:p.currentLabel,barMaxWidth:30,data:current}]},p);
        }});

    define({id:'line-trend',kind:'series',group:'趋势',name:{zh:'趋势折线',en:'Trend line'},use:'按月（或按周、按天）看走势，可带目标线；多条线对比几个对象的趋势',
        params:['title','unit','decimals','target','smooth','area','valueLabels','markExtremes',['legend',{default:'top'}],'height'],
        render(data,p,kit){
            const {categories,series,target:dataTarget}=readSeries(this,data),digits=places(series.flatMap(item=>item.values),p.decimals),target=p.target??dataTarget;
            const list=series.map((item,index)=>({type:'line',name:item.name,smooth:p.smooth,symbolSize:6,connectNulls:true,...(p.area?{areaStyle:{opacity:0.12}}:{}),
                label:{show:p.valueLabels==='all',position:'top',formatter:'{c}'+p.unit,fontSize:11},
                data:item.values.map((value,at)=>p.valueLabels==='last'&&at===item.values.length-1&&value!==null?{value:round(value,digits),label:{show:true,position:'top',formatter:'{c}'+p.unit,fontSize:11}}:round(value,digits)),
                ...(p.markExtremes?{markPoint:{symbolSize:36,label:{fontSize:10},data:[{type:'max',name:'最高'},{type:'min',name:'最低'}]}}:{}),
                ...(index===0&&target!==null?{markLine:{symbol:'none',silent:true,lineStyle:{type:'dashed',color:INK},label:{position:'insideEndTop',distance:6,formatter:'目标 '+fmt(target,places([target],-1))+p.unit,color:INK},data:[{yAxis:target}]}}:{})}));
            return chart(kit,{tooltip:{trigger:'axis',confine:true},grid:grid({legend:p.legend,count:list.length}),legend:legendOf(p.legend,list),xAxis:{...categoryAxis(categories),boundaryGap:false},yAxis:valueAxis(p.unit,{scale:true}),series:list},p);
        }});
    define({id:'area-stacked',kind:'series',group:'趋势',name:{zh:'堆叠面积图',en:'Stacked area'},use:'总量的走势，同时看各组成部分各占多少（各类工单每月数量）',
        params:['title','unit','decimals','smooth',['legend',{default:'top'}],'height'],
        render(data,p,kit){
            const {categories,series}=readSeries(this,data),digits=places(series.flatMap(item=>item.values),p.decimals);
            const list=series.map(item=>({type:'line',name:item.name,stack:'total',smooth:p.smooth,symbol:'none',areaStyle:{opacity:0.55},lineStyle:{width:1},data:item.values.map(value=>round(value,digits))}));
            return chart(kit,{tooltip:{trigger:'axis',confine:true},grid:grid({legend:p.legend,count:list.length}),legend:legendOf(p.legend,list),xAxis:{...categoryAxis(categories),boundaryGap:false},yAxis:valueAxis(p.unit),series:list},p);
        }});
    define({id:'bar-grouped',kind:'series',group:'对比',name:{zh:'分组柱',en:'Grouped bars'},use:'几个分类、每个分类里有几项指标并排比较（各运营商的本月 / 目标 / 上月）',
        params:['title','unit','decimals','orientation','showValue',['legend',{default:'top'}],'height'],
        render(data,p,kit){
            const {categories,series}=readSeries(this,data),digits=places(series.flatMap(item=>item.values),p.decimals),horizontal=p.orientation==='horizontal';
            const list=series.map(item=>({type:'bar',name:item.name,barMaxWidth:28,label:valueLabel(p.showValue,horizontal?'right':'top',p.unit),data:item.values.map(value=>round(value,digits))}));
            return chart(kit,{grid:grid({legend:p.legend,count:list.length,horizontal}),legend:legendOf(p.legend,list),[horizontal?'yAxis':'xAxis']:categoryAxis(categories,{horizontal}),[horizontal?'xAxis':'yAxis']:valueAxis(p.unit),series:list},p);
        }});
    define({id:'bar-stacked',kind:'series',group:'构成',name:{zh:'堆叠柱',en:'Stacked bars'},use:'每个分类的总量和内部构成（各部门按严重程度的故障数）；可按百分比堆叠看结构',
        params:['title','unit','decimals','orientation','percent','showValue',['legend',{default:'top'}],'height'],
        render(data,p,kit){
            const {categories,series}=readSeries(this,data),horizontal=p.orientation==='horizontal';
            const totals=categories.map((_,at)=>series.reduce((sum,item)=>sum+(item.values[at]??0),0));
            const values=series.map(item=>item.values.map((value,at)=>p.percent?(totals[at]?(value??0)/totals[at]*100:0):value));
            const digits=p.percent?(p.decimals<0?1:p.decimals):places(values.flat(),p.decimals),unit=p.percent?'%':p.unit;
            const list=series.map((item,index)=>({type:'bar',name:item.name,stack:'total',barMaxWidth:40,label:{show:p.showValue,position:'inside',formatter:'{c}'+unit,fontSize:10},data:values[index].map(value=>round(value,digits))}));
            return chart(kit,{grid:grid({legend:p.legend,count:list.length,horizontal}),legend:legendOf(p.legend,list),[horizontal?'yAxis':'xAxis']:categoryAxis(categories,{horizontal}),[horizontal?'xAxis':'yAxis']:valueAxis(unit,p.percent?{max:100}:{}),series:list},p);
        }});
    define({id:'combo-bar-line',kind:'series',group:'趋势',name:{zh:'柱线双轴（数量 + 比率）',en:'Bars + line, two axes'},use:'同时看数量和比率（每月工单量 + 及时率）；axis:"right" 或 type:"line" 的系列画成右轴折线，都没标时最后一个系列画成折线',
        params:['title','decimals','leftUnit','rightUnit','target','showValue',['legend',{default:'top'}],'height'],
        render(data,p,kit){
            const {categories,series,target:dataTarget}=readSeries(this,data),flagged=series.some(item=>item.axis==='right'||item.type==='line'),target=p.target??dataTarget;
            const list=series.map((item,index)=>{const right=flagged?item.axis==='right'||item.type==='line':index===series.length-1&&series.length>1,digits=places(item.values,p.decimals),unit=right?p.rightUnit:p.leftUnit;
                return right?{type:'line',name:item.name,yAxisIndex:1,symbolSize:6,label:valueLabel(p.showValue,'top',unit),data:item.values.map(value=>round(value,digits)),...(target!==null?{markLine:{symbol:'none',silent:true,lineStyle:{type:'dashed',color:INK},label:{position:'insideEndTop',formatter:'目标 '+target+unit,color:INK},data:[{yAxis:target}]}}:{})}
                    :{type:'bar',name:item.name,barMaxWidth:36,label:valueLabel(p.showValue,'top',unit),data:item.values.map(value=>round(value,digits))};});
            return chart(kit,{grid:grid({legend:p.legend,count:list.length}),legend:legendOf(p.legend,list),xAxis:categoryAxis(categories),yAxis:[valueAxis(p.leftUnit),valueAxis(p.rightUnit,{scale:true,splitLine:{show:false}})],series:list},p);
        }});
    define({id:'radar',kind:'series',group:'对比',name:{zh:'雷达图（多维对比）',en:'Radar'},use:'几个对象在多个维度上的综合表现（categories 是维度，每个系列是一个对象），维度 4–8 个最合适',
        params:['title','max',['legend',{default:'bottom'}],'area','height'],
        render(data,p,kit){
            const {categories,series}=readSeries(this,data),peak=Math.max(...series.flatMap(item=>item.values).filter(value=>value!==null),1);
            const max=p.max??Math.ceil(peak*1.1);
            return kit.chart({tooltip:{trigger:'item',confine:true},legend:legendOf(p.legend,series),radar:{indicator:categories.map(name=>({name,max})),radius:'64%',center:['50%',p.legend==='bottom'?'46%':'54%'],axisName:{fontSize:11},splitArea:{areaStyle:{color:['#fbfcfe','#f3f6fa']}}},
                series:[{type:'radar',symbolSize:5,...(p.area?{areaStyle:{opacity:0.15}}:{}),data:series.map(item=>({name:item.name,value:item.values.map(value=>value??0)}))}]},{title:p.title,height:p.height});
        }});

    define({id:'heatmap-rag',kind:'matrix',group:'达标',name:{zh:'红黄绿达标矩阵',en:'RAG matrix'},use:'多个对象 × 多个指标的达标总览（各代表处 × 各考核指标），格子按达标情况着色；给 status 或给每列 targets',
        params:['title','unit','decimals','rule',['warnAt',{label:['接近目标的范围（% 以内标黄）','Near-target band (%)'],default:3,min:0,max:50}]],
        render(data,p){
            const {rows,columns,values,status,targets}=readMatrix(this,data),digits=places(values.flat(),p.decimals);
            const BG={good:'#e3f4ec',warn:'#fdf1dc',bad:'#fbe3e2'},FG={good:'#1f7a52',warn:'#9a6510',bad:'#b23a35'};
            const toneOf=(r,c)=>{const given=status?.[r]?.[c];if(['good','warn','bad'].includes(given))return given;const value=values[r][c],target=targets?.[c]??null;const ok=passes(value,target,p.rule);if(ok===null)return '';if(ok)return 'good';
                return Math.abs(value-target)<=Math.abs(target)*p.warnAt/100?'warn':'bad';};
            const head=`<tr><th></th>${columns.map((column,c)=>`<th style="text-align:center">${esc(column)}${targets?.[c]!=null?`<br><small style="font-weight:400;color:#7a8a9b">目标 ${fmt(targets[c],places([targets[c]],-1))}${esc(p.unit)}</small>`:''}</th>`).join('')}</tr>`;
            const body=rows.map((row,r)=>`<tr><th style="text-align:left;white-space:nowrap">${esc(row)}</th>${columns.map((_,c)=>{const tone=toneOf(r,c),value=values[r][c];return `<td style="text-align:center;font-weight:600;${tone?`background:${BG[tone]};color:${FG[tone]}`:''}">${value===null?'—':fmt(round(value,digits),digits)+esc(p.unit)}</td>`;}).join('')}</tr>`).join('');
            return `${titleHtml(p.title)}<table class="kit-table kit-matrix"><thead>${head}</thead><tbody>${body}</tbody></table><div class="kit-note"><span style="color:${FG.good}">■ 达标</span>　<span style="color:${FG.warn}">■ 接近目标</span>　<span style="color:${FG.bad}">■ 未达标</span></div>`;
        }});
    define({id:'heatmap',kind:'matrix',group:'分布',name:{zh:'数值热力图',en:'Heatmap'},use:'两个维度交叉的数量分布（星期 × 时段的告警量、站点 × 月份的故障数），颜色深浅代表大小',
        params:['title','unit','decimals','scheme','height'],
        render(data,p,kit){
            const {rows,columns,values}=readMatrix(this,data),flat=values.flat().filter(value=>value!==null),digits=places(flat,p.decimals);
            const colors=p.scheme==='rg'?['#d4554f','#f3d27a','#2f9e6f']:p.scheme==='gr'?['#2f9e6f','#f3d27a','#d4554f']:['#eef4fb','#7fa9d6','#1f5e95'];
            return kit.chart({tooltip:{position:'top',confine:true},grid:{left:8,right:16,top:8,bottom:44,containLabel:true},xAxis:{type:'category',data:columns,splitArea:{show:true},axisLabel:{interval:0,overflow:'truncate',width:80}},yAxis:{type:'category',data:rows,splitArea:{show:true}},
                visualMap:{min:Math.min(...flat,0),max:Math.max(...flat,1),calculable:false,orient:'horizontal',left:'center',bottom:0,itemHeight:120,inRange:{color:colors},textStyle:{fontSize:10}},
                series:[{type:'heatmap',label:{show:true,fontSize:11},data:values.flatMap((row,r)=>row.map((value,c)=>[c,r,round(value,digits)])),emphasis:{itemStyle:{shadowBlur:6,shadowColor:'rgba(0,0,0,.2)'}}}]},{title:p.title,height:Math.max(p.height,rows.length*30+70)});
        }});

    define({id:'kpi-cards',kind:'kpis',group:'指标',name:{zh:'指标卡',en:'KPI cards'},use:'几个核心数字放在最上面（本月事故数、回传率、工单量），带较上月的变化',
        params:['title','decimals'],
        render(data,p,kit){
            const items=readKpis(this,data).map(item=>({label:item.label,value:item.number===null?item.value:round(item.number,places([item.number],p.decimals)),unit:item.unit,...(item.delta!==undefined?{delta:item.delta}:{}),...(item.deltaLabel!==undefined?{deltaLabel:item.deltaLabel}:{}),...(item.tone!==undefined?{tone:item.tone}:{})}));
            return titleHtml(p.title)+kit.kpi(items);
        }});
    define({id:'kpi-spark',kind:'kpis',group:'指标',name:{zh:'指标卡 + 迷你趋势',en:'KPI cards with sparklines'},use:'核心数字 + 近几个月的小走势线（spark 放近 3–12 期的数字）',
        params:['title','decimals','columns'],
        render(data,p){
            const items=readKpis(this,data),columns=p.columns||Math.min(4,items.length);
            const cards=items.map(item=>{const digits=places([item.number],p.decimals),value=item.number===null?esc(item.value):fmt(round(item.number,digits),digits),tone=item.tone==='good'||item.tone==='bad'?item.tone:'';
                return `<div style="border:1px solid #e3e9f0;border-radius:10px;padding:10px 12px;background:#fff;min-width:0"><div style="font-size:12px;color:#5b6b7d">${esc(item.label)}</div><div style="font-size:24px;font-weight:700;color:${tone?toneColor(tone):'var(--rep-heading,#132c45)'};line-height:1.3">${value}<small style="font-size:12px;font-weight:500;margin-left:2px">${esc(item.unit)}</small></div>${item.delta!==undefined&&item.delta!==null&&item.delta!==''?`<div style="font-size:12px;color:${tone?toneColor(tone):INK}">${deltaText(item)}</div>`:''}${item.spark?sparkline(item.spark,tone):''}${item.note?`<div class="kit-note">${esc(item.note)}</div>`:''}</div>`;}).join('');
            return `${titleHtml(p.title)}<div style="display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:10px">${cards}</div>`;
        }});
    define({id:'gauge-grid',kind:'kpis',group:'达标',name:{zh:'仪表盘组',en:'Gauges'},use:'1–6 个比率型指标各自离满分 / 目标多远（达成率、可用率），醒目的展示',
        params:['title',['max',{default:100,nullable:false,min:1,max:100000,label:['满刻度','Scale max']}],'decimals','columns','height'],
        render(data,p,kit){
            const items=readKpis(this,data).slice(0,6),columns=p.columns||Math.min(3,items.length),lines=Math.ceil(items.length/columns);
            const series=items.map((item,index)=>{const column=index%columns,line=Math.floor(index/columns),digits=places([item.number],p.decimals);
                return {type:'gauge',center:[`${(column+0.5)/columns*100}%`,`${(line+0.58)/lines*100}%`],radius:`${Math.min(90/columns,80/lines)}%`,startAngle:210,endAngle:-30,min:0,max:p.max,
                    progress:{show:true,width:10,itemStyle:{color:toneColor(item.tone==='bad'?'bad':item.tone==='good'?'good':'')}},axisLine:{lineStyle:{width:10,color:[[1,'#eef2f6']]}},pointer:{show:false},axisTick:{show:false},splitLine:{show:false},axisLabel:{show:false},
                    title:{offsetCenter:[0,'62%'],fontSize:12,color:INK},detail:{offsetCenter:[0,'8%'],fontSize:20,fontWeight:600,formatter:'{value}'+String(item.unit||'')},data:[{name:item.label,value:round(item.number??0,digits)}]};});
            return kit.chart({series},{title:p.title,height:Math.max(p.height,lines*190)});
        }});
    define({id:'ring-grid',kind:'kpis',group:'达标',name:{zh:'达成率圆环组',en:'Completion rings'},use:'几项的完成比例（value/target，没有 target 时 value 就是百分比），比仪表盘更简洁',
        params:['title','decimals','columns',['warnAt',{default:90}],'height'],
        render(data,p,kit){
            const items=readKpis(this,data).slice(0,8),columns=p.columns||Math.min(4,items.length),lines=Math.ceil(items.length/columns);
            const series=items.map((item,index)=>{const rate=item.target?(item.number??0)/item.target*100:item.number??0,digits=p.decimals<0?1:p.decimals,color=rate>=100?GOOD:rate>=p.warnAt?WARN:BAD,column=index%columns,line=Math.floor(index/columns);
                return {type:'pie',silent:true,radius:[`${Math.min(30,60/columns)}%`,`${Math.min(38,76/columns)}%`],center:[`${(column+0.5)/columns*100}%`,`${(line+0.45)/lines*100}%`],label:{show:false},
                    data:[{value:Math.min(100,rate),itemStyle:{color},label:{show:true,position:'center',formatter:`${fmt(round(rate,digits),digits)}%`,fontSize:16,fontWeight:600,color:'#1d2b3a'}},{value:Math.max(0,100-rate),itemStyle:{color:'#eef2f6'}}]};});
            const names=items.map((item,index)=>({text:item.label,left:`${(index%columns+0.5)/columns*100}%`,top:`${(Math.floor(index/columns)+0.86)/lines*100}%`,textAlign:'center',textStyle:{fontSize:12,fontWeight:500,color:INK}}));
            return kit.chart({title:names,series},{title:p.title,height:Math.max(p.height,lines*170)});
        }});
    define({id:'big-number',kind:'kpis',group:'指标',name:{zh:'大数字强调',en:'Headline number'},use:'一个最重要的数字单独放大（本月重大事故 0 起、整体达成率 98.6%），可加一句说明',
        params:['title','decimals'],
        render(data,p){
            const item=readKpis(this,data)[0],digits=places([item.number],p.decimals),tone=item.tone==='good'||item.tone==='bad'?item.tone:'';
            const value=item.number===null?esc(item.value):fmt(round(item.number,digits),digits);
            return `${titleHtml(p.title)}<div style="text-align:center;padding:12px 8px"><div style="font-size:13px;color:${INK}">${esc(item.label)}</div><div style="font-size:46px;font-weight:700;line-height:1.15;color:${tone?toneColor(tone):'var(--air-accent,#2f6fae)'}">${value}<small style="font-size:16px;font-weight:500;margin-left:4px">${esc(item.unit)}</small></div>${item.delta!==undefined&&item.delta!==null&&item.delta!==''?`<div style="font-size:13px;color:${tone?toneColor(tone):INK}">${deltaText(item)}</div>`:''}${item.note?`<div class="kit-note" style="margin-top:6px">${esc(item.note)}</div>`:''}</div>`;
        }});

    define({id:'table-basic',kind:'rows',group:'明细',name:{zh:'表格（可标红）',en:'Table'},use:'行数不多（20 行以内）的明细或汇总表，未达标的行或单元格用 $tone / $tones 标红',
        params:['title','maxRows'],
        render(data,p,kit){const {rows,columns}=readRows(this,data);return kit.table(rows,{title:p.title,maxRows:p.maxRows,...(columns?{columns}:{})});}});
    define({id:'table-paged',kind:'rows',group:'明细',name:{zh:'可搜索分页明细',en:'Searchable table'},use:'行数多的明细（工单清单、告警清单），可排序、搜索、分页',
        params:['title','pageSize','search'],
        render(data,p,kit){const {rows,columns}=readRows(this,data);return kit.datatable(rows,{title:p.title,pageSize:p.pageSize,search:p.search,...(columns?{columns}:{})});}});

    define({id:'scatter-quadrant',kind:'points',group:'分布',name:{zh:'四象限散点',en:'Quadrant scatter'},use:'用两个指标给对象分类（数量 × 质量：工单多且及时率低的是重点），按平均值分四个象限',
        params:['title','xLabel','yLabel','guides','showLabels','height'],
        render(data,p,kit){
            const points=readPoints(this,data);if(!points.length)return emptyChart(p);
            const mean=key=>round(points.reduce((sum,point)=>sum+point[key],0)/points.length,2);
            return kit.chart({tooltip:{trigger:'item',formatter:'{b}：{c}',confine:true},grid:{left:8,right:24,top:24,bottom:8,containLabel:true},xAxis:{type:'value',name:p.xLabel,nameLocation:'middle',nameGap:24,scale:true,splitLine:{lineStyle:{type:'dashed',color:'#e3e9f0'}}},yAxis:{type:'value',name:p.yLabel,scale:true,splitLine:{lineStyle:{type:'dashed',color:'#e3e9f0'}}},
                series:[{type:'scatter',symbolSize:12,label:{show:p.showLabels,position:'right',formatter:'{b}',fontSize:11},data:points.map(point=>({name:point.label,value:[point.x,point.y]})),
                    ...(p.guides==='mean'?{markLine:{symbol:'none',silent:true,lineStyle:{type:'dashed',color:INK},label:{formatter:'均值 {c}',fontSize:10},data:[{xAxis:mean('x')},{yAxis:mean('y')}]}}:{})}]},{title:p.title,height:p.height});
        }});
    define({id:'bubble',kind:'points',group:'分布',name:{zh:'气泡图',en:'Bubble chart'},use:'在散点的基础上再用气泡大小表示第三个数（size），如 工单量 × 及时率 × 用户数',
        params:['title','xLabel','yLabel','showLabels','height'],
        render(data,p,kit){
            const points=readPoints(this,data);if(!points.length)return emptyChart(p);
            const sizes=points.map(point=>point.size??1),top=Math.max(...sizes,1);
            return kit.chart({tooltip:{trigger:'item',confine:true},grid:{left:8,right:24,top:24,bottom:8,containLabel:true},xAxis:{type:'value',name:p.xLabel,nameLocation:'middle',nameGap:24,scale:true,splitLine:{lineStyle:{type:'dashed',color:'#e3e9f0'}}},yAxis:{type:'value',name:p.yLabel,scale:true,splitLine:{lineStyle:{type:'dashed',color:'#e3e9f0'}}},
                series:[{type:'scatter',itemStyle:{opacity:0.75},label:{show:p.showLabels,formatter:'{b}',fontSize:11},data:points.map((point,index)=>({name:point.label,value:[point.x,point.y,point.size],symbolSize:Math.round(10+Math.sqrt(sizes[index]/top)*38)}))}]},{title:p.title,height:p.height});
        }});

    define({id:'timeline-events',kind:'events',group:'文字',name:{zh:'事件时间线',en:'Event timeline'},use:'本月重大事件、割接、故障按时间排列，用颜色区分好坏',
        params:['title'],
        render(data,p){
            if(!Array.isArray(data))fail(this,`数据要是数组 ${KINDS.events.shape}`);
            const rows=data.map((row,index)=>{const title=pick(row,'title','label');if(title===undefined)fail(this,`第 ${index+1} 个事件缺少 title`);const tone=pick(row,'tone'),text=pick(row,'text');
                return `<li style="position:relative;padding:0 0 12px 18px;border-left:2px solid #e3e9f0;margin-left:5px"><span style="position:absolute;left:-7px;top:2px;width:12px;height:12px;border-radius:50%;background:${toneColor(tone)};border:2px solid #fff"></span><div style="font-size:12px;color:${INK}">${esc(pick(row,'date')??'')}</div><div style="font-weight:600">${esc(title)}</div>${text?`<div style="font-size:13px;color:#3c4d5f">${esc(text)}</div>`:''}</li>`;}).join('');
            return `${titleHtml(p.title)}<ul style="list-style:none;margin:0;padding:4px 0 0">${rows}</ul>`;
        }});
    define({id:'text-summary',kind:'text',group:'文字',name:{zh:'文字结论',en:'Text'},use:'由数据拼出的一段结论文字（**…** 包住的数字会加粗突出）',
        params:['title'],
        render(data,p,kit){const text=typeof data==='string'?data:pick(data,'text');if(typeof text!=='string')fail(this,`数据要是 ${KINDS.text.shape}`);return titleHtml(p.title||pick(data,'title')||'')+kit.text(text);}});
    define({id:'bullet-list',kind:'list',group:'文字',name:{zh:'要点列表',en:'Bullet list'},use:'几条要点、问题清单、改进项；每条可带 label 和红绿颜色',
        params:['title','ordered'],
        render(data,p,kit){if(!Array.isArray(data))fail(this,`数据要是 ${KINDS.list.shape}`);return kit.list(data.map(item=>typeof item==='string'?item:{...(has(item,'label')?{label:item.label}:{}),text:pick(item,'text')??'',...(has(item,'tone')?{tone:item.tone}:{})}),{title:p.title,ordered:p.ordered});}});
    define({id:'callout',kind:'text',group:'文字',name:{zh:'提示框',en:'Callout'},use:'一句需要特别提醒的话（风险提示、重点结论、下月计划），带颜色边框',
        params:['title','tone'],
        render(data,p,kit){const text=typeof data==='string'?data:pick(data,'text');if(typeof text!=='string')fail(this,`数据要是 ${KINDS.text.shape}`);const color=toneColor(p.tone==='info'?'':p.tone);
            return `<div style="border-left:4px solid ${color};background:color-mix(in srgb, ${color} 8%, #fff);border-radius:6px;padding:10px 14px">${p.title||pick(data,'title')?`<div style="font-weight:600;margin-bottom:4px;color:${color}">${esc(p.title||pick(data,'title'))}</div>`:''}${kit.text(text)}</div>`;}});
    define({id:'nav-links',kind:'links',group:'文字',name:{zh:'章节导航',en:'Navigation'},use:'快速跳转到各章节或格子（数据来自“月报内容”来源的 outline）',
        params:['title','columns'],
        render(data,p,kit){if(!Array.isArray(data))fail(this,`数据要是 ${KINDS.links.shape}`);return kit.nav(data.map(item=>({label:pick(item,'label'),anchor:pick(item,'anchor'),...(has(item,'no')?{no:item.no}:{}),...(has(item,'note')?{note:item.note}:{})})),{title:p.title,columns:p.columns});}});

    // ── Second batch: precise comparisons, scorecards, distributions, hierarchies, flows, plans ────────────────
    const DATE_RE=/^\d{4}-\d{2}-\d{2}/;
    function readTree(template,data){
        const root=Array.isArray(data)?{name:'',children:data}:data;
        if(!root||typeof root!=='object'||!Array.isArray(pick(root,'children')))fail(template,`数据要是 ${KINDS.tree.shape}`);
        const walk=(node,depth)=>{if(depth>6)return null;const children=pick(node,'children');return {name:String(pick(node,'name','label')??''),...(num(pick(node,'value'))!==null?{value:num(pick(node,'value'))}:{}),...(Array.isArray(children)&&children.length?{children:children.map(child=>walk(child,depth+1)).filter(Boolean)}:{})};};
        return walk(root,0);
    }
    function readFlow(template,data){
        const nodes=pick(data,'nodes'),links=pick(data,'links');
        if(!Array.isArray(links)||!links.length)fail(template,`数据要是 ${KINDS.flow.shape}`);
        const list=links.map((link,index)=>{const source=pick(link,'source'),target=pick(link,'target'),value=num(pick(link,'value'));if(source===undefined||target===undefined||value===null)fail(template,`第 ${index+1} 条流向缺少 source / target / value`);return {source:String(source),target:String(target),value};});
        const names=Array.isArray(nodes)?nodes.map(node=>String(typeof node==='object'?pick(node,'name','label'):node)):[...new Set(list.flatMap(link=>[link.source,link.target]))];
        if(list.some(link=>link.source===link.target))fail(template,'流向的起点和终点不能相同（会形成环）');
        return {nodes:names,links:list};
    }
    function readGroups(template,data){
        if(!Array.isArray(data)||!data.length)fail(template,`数据要是 ${KINDS.groups.shape}`);
        return data.map((row,index)=>{const values=pick(row,'values');if(!Array.isArray(values))fail(template,`第 ${index+1} 组缺少 values 数组（每个样本一个数字）`);return {label:String(pick(row,'label','name')??`组${index+1}`),values:values.map(num).filter(value=>value!==null).sort((a,b)=>a-b)};});
    }
    function readTasks(template,data){
        if(!Array.isArray(data)||!data.length)fail(template,`数据要是 ${KINDS.tasks.shape}`);
        return data.map((row,index)=>{const start=String(pick(row,'start')??''),end=String(pick(row,'end')??'');if(!DATE_RE.test(start)||!DATE_RE.test(end))fail(template,`第 ${index+1} 项的 start / end 要是 YYYY-MM-DD 日期`);
            return {label:String(pick(row,'label','name')??''),start,end,progress:num(pick(row,'progress')),tone:pick(row,'tone'),owner:pick(row,'owner')};});
    }
    function readDaily(template,data){
        if(!Array.isArray(data)||!data.length)fail(template,`数据要是 ${KINDS.daily.shape}`);
        return data.map((row,index)=>{const date=String(pick(row,'date')??'');if(!DATE_RE.test(date))fail(template,`第 ${index+1} 天的 date 要是 YYYY-MM-DD`);return {date:date.slice(0,10),value:num(pick(row,'value'))};});
    }
    const quantile=(sorted,q)=>{if(!sorted.length)return null;const at=(sorted.length-1)*q,low=Math.floor(at),high=Math.ceil(at);return sorted[low]+(sorted[high]-sorted[low])*(at-low);};
    const dayOf=text=>Date.UTC(+text.slice(0,4),+text.slice(5,7)-1,+text.slice(8,10));
    const arrow=(change,better)=>change===0?`<span style="color:${INK}">→ 持平</span>`:`<span style="color:${better?GOOD:BAD}">${change>0?'↑':'↓'} ${fmt(Math.abs(change),Math.min(2,(String(Math.abs(change)).split('.')[1]||'').length))}</span>`;

    define({id:'bar-diverging',kind:'items',group:'变化',name:{zh:'正负条形（增减对比）',en:'Diverging bars'},use:'有正有负的数：各部门较上月的增减、偏差、净值，正负用两种颜色',
        params:['title','unit','decimals','rule',['sort',{default:'desc'}],'showValue','height'],
        render(data,p,kit){
            const items=sorted(readItems(this,data),p.sort);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals);
            const color=value=>(value>=0)===(p.rule!=='lte')?GOOD:BAD;
            return chart(kit,{grid:{...grid({horizontal:true}),left:8,right:48},yAxis:{...categoryAxis(items.map(item=>item.label),{horizontal:true}),axisLine:{show:false},axisTick:{show:false}},xAxis:valueAxis(p.unit),
                series:[{type:'bar',barMaxWidth:20,label:{show:p.showValue,position:'right',formatter:'{c}'+p.unit,fontSize:11},data:items.map(item=>({value:round(item.value,digits),itemStyle:{color:color(item.value??0)},label:{position:(item.value??0)<0?'left':'right'}}))}]},{...p,height:Math.max(p.height,items.length*28+30)});
        }});
    define({id:'bar-variance',kind:'items',group:'达标',name:{zh:'与目标差值条',en:'Gap to target'},use:'只看离目标还差多少（实际 − 目标），超出的为正、落后的为负，比直接比数值更聚焦',
        params:['title','unit','decimals','rule','target',['sort',{default:'asc'}],'height'],
        render(data,p,kit){
            const items=readItems(this,data).map(item=>({...item,value:(p.target??item.target)===null||item.value===null?null:(item.value-(p.target??item.target))*(p.rule==='lte'?-1:1)}));
            if(items.every(item=>item.value===null))fail(this,'每一项都要有 target（或填统一目标值）才能算差值');
            const list=sorted(items,p.sort),digits=places(list.map(item=>item.value),p.decimals<0?1:p.decimals);
            return chart(kit,{grid:{...grid({horizontal:true}),right:56},yAxis:categoryAxis(list.map(item=>item.label),{horizontal:true}),xAxis:valueAxis(p.unit),
                series:[{type:'bar',barMaxWidth:18,data:list.map(item=>({value:round(item.value,digits),itemStyle:{color:(item.value??0)>=0?GOOD:BAD},label:{show:true,position:(item.value??0)<0?'left':'right',formatter:((item.value??0)>0?'+':'')+'{c}'+p.unit,fontSize:11}})),
                    markLine:{symbol:'none',silent:true,lineStyle:{color:INK},label:{show:false},data:[{xAxis:0}]}}]},{...p,height:Math.max(p.height,list.length*28+30)});
        }});
    define({id:'bullet',kind:'items',group:'达标',name:{zh:'子弹图（实际 / 目标 / 区间）',en:'Bullet chart'},use:'专业的达标展示：灰色底带分差、中、良三段，深色条是实际，竖线是目标；比仪表盘省空间',
        params:['title','unit','decimals','rule','target',['warnAt',{label:['“中”区间下限（目标的 %）','Fair band starts at (% of target)'],default:90}],'height'],
        render(data,p,kit){
            const items=readItems(this,data);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),targets=items.map(item=>p.target??item.target);
            const top=Math.max(...items.map((item,index)=>Math.max(item.value??0,targets[index]??0)))*1.1||1;
            const band=(share,color)=>({type:'bar',stack:'band',silent:true,barWidth:22,itemStyle:{color},tooltip:{show:false},data:targets.map(target=>target===null?0:round(target*share,digits))});
            const fair=p.warnAt/100,lower=p.rule==='lte';
            return chart(kit,{grid:{...grid({horizontal:true}),right:56},legend:{show:false},yAxis:categoryAxis(items.map(item=>item.label),{horizontal:true}),xAxis:{...valueAxis(p.unit),max:Math.ceil(top)},
                series:[band(lower?1:fair,lower?'#e9f3ee':'#f3e3e2'),{...band(lower?fair*0.2:1-fair,'#eef1f4')},{...band(lower?0.3:0.1,lower?'#f3e3e2':'#e2efe8'),data:targets.map(target=>target===null?0:round(target*(lower?0.3:0.1),digits))},
                    {type:'bar',barWidth:8,barGap:'-68%',z:3,itemStyle:{color:'#2b3d52'},label:{show:true,position:'right',formatter:'{c}'+p.unit,fontSize:11},data:items.map(item=>round(item.value,digits))},
                    {type:'scatter',symbol:'rect',symbolSize:[3,26],z:4,itemStyle:{color:BAD},data:targets.map(target=>target===null?null:round(target,digits))}]},{...p,height:Math.max(140,items.length*40+30)});
        }});
    define({id:'lollipop',kind:'items',group:'排名',name:{zh:'棒棒糖图',en:'Lollipop'},use:'分类较多时比柱状图更清爽的排名 / 对比，线细点大，适合 10–30 项',
        params:['title','unit','decimals',['sort',{default:'desc'}],'limit','showValue','height'],
        render(data,p,kit){
            const items=limited(sorted(readItems(this,data),p.sort),p.limit);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),values=items.map(item=>round(item.value,digits));
            return chart(kit,{grid:{...grid({horizontal:true}),right:52},yAxis:categoryAxis(items.map(item=>item.label),{horizontal:true}),xAxis:valueAxis(p.unit),
                series:[{type:'bar',barWidth:2,itemStyle:{color:MUTED},silent:true,data:values},{type:'scatter',symbolSize:12,z:3,label:{show:p.showValue,position:'right',formatter:'{c}'+p.unit,fontSize:11},data:values}]},{...p,height:Math.max(p.height,items.length*26+30)});
        }});
    define({id:'dumbbell',kind:'items',group:'变化',name:{zh:'哑铃图（上月 → 本月）',en:'Dumbbell'},use:'每个分类从上一期到本期移动了多少：灰点是上期、彩点是本期，连线越长变化越大（items 要有 previous）',
        params:['title','unit','decimals','currentLabel','previousLabel','rule','height'],
        render(data,p,kit){
            const items=readItems(this,data).filter(item=>item.previous!==null&&item.value!==null);if(!items.length)fail(this,'每一项都要有 value 和 previous');
            const digits=places(items.flatMap(item=>[item.value,item.previous]),p.decimals),labels=items.map(item=>item.label);
            const better=item=>p.rule==='lte'?item.value<=item.previous:item.value>=item.previous;
            return chart(kit,{grid:grid({count:2,legend:'top',horizontal:true}),legend:{top:0},yAxis:categoryAxis(labels,{horizontal:true}),xAxis:valueAxis(p.unit,{scale:true}),
                series:[{type:'bar',stack:'gap',silent:true,itemStyle:{color:'transparent'},tooltip:{show:false},barWidth:3,data:items.map(item=>round(Math.min(item.value,item.previous),digits))},
                    {type:'bar',stack:'gap',silent:true,barWidth:3,tooltip:{show:false},data:items.map(item=>({value:round(Math.abs(item.value-item.previous),digits),itemStyle:{color:better(item)?'#bfe3d1':'#f2c9c6'}}))},
                    {type:'scatter',name:p.previousLabel,symbolSize:11,itemStyle:{color:MUTED},data:items.map(item=>round(item.previous,digits))},
                    {type:'scatter',name:p.currentLabel,symbolSize:13,z:4,label:{show:true,position:'right',formatter:'{c}'+p.unit,fontSize:11},data:items.map(item=>({value:round(item.value,digits),itemStyle:{color:better(item)?GOOD:BAD}}))}]},{...p,height:Math.max(p.height,items.length*30+50)});
        }});
    define({id:'slope',kind:'items',group:'变化',name:{zh:'斜率图（两期排名变化）',en:'Slope chart'},use:'几个对象在两期之间的升降一目了然，适合 3–10 个对象（items 要有 previous）',
        params:['title','unit','decimals','currentLabel','previousLabel','rule','height'],
        render(data,p,kit){
            const items=readItems(this,data).filter(item=>item.previous!==null&&item.value!==null);if(!items.length)fail(this,'每一项都要有 value 和 previous');
            const digits=places(items.flatMap(item=>[item.value,item.previous]),p.decimals);
            return chart(kit,{tooltip:{trigger:'item',confine:true},grid:{left:90,right:90,top:28,bottom:10},xAxis:{type:'category',data:[p.previousLabel,p.currentLabel],position:'top',axisLine:{show:false},axisTick:{show:false},boundaryGap:false},yAxis:{type:'value',scale:true,show:false},
                series:items.map(item=>{const good=p.rule==='lte'?item.value<=item.previous:item.value>=item.previous;return {type:'line',name:item.label,symbolSize:8,lineStyle:{width:2,color:good?GOOD:BAD},itemStyle:{color:good?GOOD:BAD},
                    data:[{value:round(item.previous,digits),label:{show:true,position:'left',formatter:`${item.label} {c}${p.unit}`,fontSize:11,color:INK}},{value:round(item.value,digits),label:{show:true,position:'right',formatter:`{c}${p.unit} ${item.label}`,fontSize:11}}]};})},p);
        }});
    define({id:'polar-bar',kind:'items',group:'对比',name:{zh:'环形条（极坐标柱）',en:'Radial bars'},use:'少量分类（3–8 个）的比率对比，视觉醒目，适合看板角落',
        params:['title','unit','decimals','max','height'],
        render(data,p,kit){
            const items=readItems(this,data);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),max=p.max??Math.ceil(Math.max(...items.map(item=>item.value??0))*1.05);
            return kit.chart({tooltip:{trigger:'item',confine:true},polar:{radius:['18%','82%']},angleAxis:{max,startAngle:90,show:false},radiusAxis:{type:'category',data:items.map(item=>item.label),axisLine:{show:false},axisTick:{show:false},axisLabel:{fontSize:11,interval:0}},
                series:[{type:'bar',coordinateSystem:'polar',roundCap:true,barWidth:12,showBackground:true,backgroundStyle:{color:'#eef2f6'},label:{show:true,position:'end',formatter:'{c}'+p.unit,fontSize:11},data:items.map(item=>round(item.value,digits))}]},{title:p.title,height:p.height});
        }});
    define({id:'half-donut',kind:'items',group:'构成',name:{zh:'半环占比',en:'Half donut'},use:'2–5 个部分的占比，放在窄而矮的位置（看板顶部）',
        params:['title','unit','decimals','centerText',['legend',{default:'bottom'}],'height'],
        render(data,p,kit){
            const items=readItems(this,data).filter(item=>item.value>0);if(!items.length)return emptyChart(p);
            const digits=places(items.map(item=>item.value),p.decimals),total=items.reduce((sum,item)=>sum+item.value,0);
            return kit.chart({tooltip:{trigger:'item',formatter:'{b}：{c}'+p.unit+'（{d}%）',confine:true},legend:legendOf(p.legend,items),title:{text:fmt(total,digits)+p.unit,subtext:p.centerText,left:'center',top:'52%',textAlign:'center',textStyle:{fontSize:20,fontWeight:600},subtextStyle:{fontSize:12}},
                series:[{type:'pie',radius:['58%','88%'],center:['50%','72%'],startAngle:180,endAngle:360,label:{show:false},itemStyle:{borderColor:'#fff',borderWidth:2},data:items.map(item=>({name:item.label,value:round(item.value,digits)}))}]},{title:p.title,height:Math.min(p.height,260)});
        }});
    define({id:'traffic-list',kind:'items',group:'达标',name:{zh:'红绿灯清单',en:'Traffic-light list'},use:'逐项列出 实际 / 目标 和红黄绿灯，最适合给领导一眼看完（要 target 或 tone）',
        params:['title','unit','decimals','rule','target',['warnAt',{label:['接近目标的范围（% 以内标黄）','Near-target band (%)'],default:3,min:0,max:50}]],
        render(data,p){
            const items=readItems(this,data),digits=places(items.flatMap(item=>[item.value,item.target]),p.decimals);
            const toneOf=item=>{if(['good','warn','bad'].includes(item.tone))return item.tone;const target=p.target??item.target,ok=passes(item.value,target,p.rule);if(ok===null)return '';if(ok)return 'good';return Math.abs(item.value-target)<=Math.abs(target)*p.warnAt/100?'warn':'bad';};
            const rows=items.map(item=>{const tone=toneOf(item),target=p.target??item.target;return `<li style="display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid #edf1f5"><span style="width:12px;height:12px;border-radius:50%;flex:none;background:${tone?toneColor(tone):MUTED};box-shadow:0 0 0 3px color-mix(in srgb, ${tone?toneColor(tone):MUTED} 20%, transparent)"></span><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(item.label)}</span><strong style="font-variant-numeric:tabular-nums">${fmt(round(item.value,digits),digits)}${esc(p.unit)}</strong>${target!==null?`<small style="color:${INK};min-width:72px;text-align:right">目标 ${fmt(round(target,digits),digits)}${esc(p.unit)}</small>`:''}</li>`;}).join('');
            return `${titleHtml(p.title)}<ul style="list-style:none;margin:0;padding:0;font-size:13px">${rows}</ul>`;
        }});
    define({id:'scorecard',kind:'items',group:'达标',name:{zh:'计分卡表（实际 / 目标 / 差值 / 环比 / 状态）',en:'Scorecard table'},use:'月报最常用的考核汇总表：每个指标一行，自动算差值、环比箭头和达标状态（要 target，环比要 previous）',
        params:['title','unit','decimals','rule','target','currentLabel'],
        render(data,p){
            const items=readItems(this,data),digits=places(items.flatMap(item=>[item.value,item.target,item.previous]),p.decimals);
            const rows=items.map(item=>{const target=p.target??item.target,ok=passes(item.value,target,p.rule),gap=target===null||item.value===null?null:round(item.value-target,digits),change=item.previous===null||item.value===null?null:round(item.value-item.previous,digits);
                return `<tr><td>${esc(item.label)}</td><td style="text-align:right;font-weight:600">${fmt(round(item.value,digits),digits)}${esc(p.unit)}</td><td style="text-align:right">${target===null?'—':fmt(round(target,digits),digits)+esc(p.unit)}</td><td style="text-align:right;color:${gap===null?INK:ok?GOOD:BAD}">${gap===null?'—':(gap>0?'+':'')+fmt(gap,digits)}</td><td style="text-align:right">${change===null?'—':arrow(change,p.rule==='lte'?change<0:change>0)}</td><td style="text-align:center">${ok===null?'—':`<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;background:${ok?'#e3f4ec':'#fbe3e2'};color:${ok?'#1f7a52':'#b23a35'}">${ok?'达标':'未达标'}</span>`}</td></tr>`;}).join('');
            return `${titleHtml(p.title)}<table class="kit-table"><thead><tr><th>指标</th><th style="text-align:right">${esc(p.currentLabel)}</th><th style="text-align:right">目标</th><th style="text-align:right">差值</th><th style="text-align:right">环比</th><th style="text-align:center">状态</th></tr></thead><tbody>${rows}</tbody></table>`;
        }});
    define({id:'waffle',kind:'items',group:'构成',name:{zh:'华夫格（百格占比）',en:'Waffle'},use:'把占比画成 100 个小方格，“每 100 单里有 7 单超时”这类说法最直观；2–5 个部分',
        params:['title','unit','decimals'],
        render(data,p){
            const items=readItems(this,data).filter(item=>item.value>0),total=items.reduce((sum,item)=>sum+item.value,0);if(!total)return emptyChart(p);
            let cells=items.map(item=>Math.round(item.value/total*100));const diff=100-cells.reduce((a,b)=>a+b,0);cells[cells.indexOf(Math.max(...cells))]+=diff;
            const palette=index=>`var(--kit-c${index%8},${['#2f6fae','#3aa18f','#e0a33a','#c8566b','#7a63b8','#5b8fd1','#8aa34a','#d07a3c'][index%8]})`;
            const squares=cells.flatMap((count,index)=>Array.from({length:count},()=>`<i style="display:block;aspect-ratio:1;border-radius:2px;background:${palette(index)}"></i>`)).join('');
            const legend=items.map((item,index)=>`<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px"><i style="width:10px;height:10px;border-radius:2px;background:${palette(index)}"></i>${esc(item.label)} <b>${cells[index]}%</b></span>`).join('');
            return `${titleHtml(p.title)}<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><div style="display:grid;grid-template-columns:repeat(10,1fr);gap:3px;width:min(220px,100%)">${squares}</div><div style="font-size:12px;line-height:2;flex:1;min-width:120px">${legend}</div></div>`;
        }});

    define({id:'stat-strip',kind:'kpis',group:'指标',name:{zh:'数字条（紧凑一行）',en:'Stat strip'},use:'一行放 4–8 个数字，比指标卡更省高度，适合看板顶部或章节开头',
        params:['title','decimals'],
        render(data,p){
            const items=readKpis(this,data);
            const cells=items.map(item=>{const digits=places([item.number],p.decimals),tone=item.tone==='good'||item.tone==='bad'?item.tone:'';return `<div style="flex:1 1 0;min-width:96px;padding:4px 14px;border-left:1px solid #e3e9f0"><div style="font-size:12px;color:${INK};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.label)}</div><div style="font-size:20px;font-weight:700;color:${tone?toneColor(tone):'var(--rep-heading,#132c45)'}">${item.number===null?esc(item.value):fmt(round(item.number,digits),digits)}<small style="font-size:11px;font-weight:500;margin-left:2px">${esc(item.unit)}</small></div>${item.delta!==undefined&&item.delta!==null&&item.delta!==''?`<div style="font-size:11px;color:${tone?toneColor(tone):INK}">${deltaText(item)}</div>`:''}</div>`;}).join('');
            return `${titleHtml(p.title)}<div style="display:flex;flex-wrap:wrap;row-gap:8px;margin-left:-1px">${cells}</div>`;
        }});
    define({id:'kpi-target',kind:'kpis',group:'达标',name:{zh:'指标卡 + 目标进度',en:'KPI cards with target bars'},use:'每张卡显示实际值、目标和完成进度条（要 target）',
        params:['title','decimals','columns',['warnAt',{default:90}],'rule'],
        render(data,p){
            const items=readKpis(this,data),columns=p.columns||Math.min(4,items.length);
            const cards=items.map(item=>{const digits=places([item.number,item.target],p.decimals),rate=item.target&&item.number!==null?(p.rule==='lte'?item.target/Math.max(item.number,1e-9):item.number/item.target)*100:null,color=rate===null?toneColor(''):rate>=100?GOOD:rate>=p.warnAt?WARN:BAD;
                return `<div style="border:1px solid #e3e9f0;border-radius:10px;padding:10px 12px;background:#fff;min-width:0"><div style="font-size:12px;color:${INK}">${esc(item.label)}</div><div style="display:flex;align-items:baseline;gap:6px"><span style="font-size:24px;font-weight:700;color:var(--rep-heading,#132c45)">${item.number===null?esc(item.value):fmt(round(item.number,digits),digits)}</span><small>${esc(item.unit)}</small>${item.target!==null?`<small style="margin-left:auto;color:${INK}">目标 ${fmt(round(item.target,digits),digits)}${esc(item.unit)}</small>`:''}</div>${rate===null?'':`<div style="height:6px;border-radius:3px;background:#eef2f6;margin-top:6px;overflow:hidden"><div style="height:100%;width:${Math.min(100,rate).toFixed(1)}%;background:${color};border-radius:3px"></div></div><div style="font-size:11px;color:${color};margin-top:3px">完成 ${fmt(rate,1)}%</div>`}</div>`;}).join('');
            return `${titleHtml(p.title)}<div style="display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:10px">${cards}</div>`;
        }});

    define({id:'line-small-multiples',kind:'series',group:'趋势',name:{zh:'小多图（每个对象一张迷你走势）',en:'Small multiples'},use:'对象多（5–16 个）又都要看走势时，一个对象一张小图，比一张图塞十几条线清楚得多',
        params:['title','unit','decimals','target','columns',['height',{default:110,label:['每张小图高度','Panel height']}]],
        render(data,p,kit){
            const {categories,series,target:dataTarget}=readSeries(this,data),columns=p.columns||Math.min(4,series.length),lines=Math.ceil(series.length/columns),target=p.target??dataTarget;
            const digits=places(series.flatMap(item=>item.values),p.decimals),all=series.flatMap(item=>item.values).filter(value=>value!==null),low=Math.min(...all,target??Infinity),high=Math.max(...all,target??-Infinity),pad=(high-low)*0.1||1;
            const gap=4,cellW=100/columns,cellH=100/lines;
            const option={tooltip:{trigger:'axis',confine:true},title:[],grid:[],xAxis:[],yAxis:[],series:[]};
            series.forEach((item,index)=>{const column=index%columns,line=Math.floor(index/columns);
                option.title.push({text:item.name,left:`${column*cellW+1}%`,top:`${line*cellH}%`,textStyle:{fontSize:12,fontWeight:600}});
                option.grid.push({left:`${column*cellW+2}%`,width:`${cellW-gap}%`,top:`${line*cellH+cellH*0.22}%`,height:`${cellH*0.62}%`,containLabel:false});
                option.xAxis.push({type:'category',gridIndex:index,data:categories,boundaryGap:false,axisLabel:{show:line===lines-1,fontSize:9,interval:'auto'},axisTick:{show:false}});
                option.yAxis.push({type:'value',gridIndex:index,min:round(low-pad,digits),max:round(high+pad,digits),show:false});
                const last=item.values[item.values.length-1],ok=target===null?null:last>=target;
                option.series.push({type:'line',xAxisIndex:index,yAxisIndex:index,symbol:'none',lineStyle:{width:2},areaStyle:{opacity:0.1},...(ok===null?{}:{itemStyle:{color:ok?GOOD:BAD}}),
                    data:item.values.map((value,at)=>at===item.values.length-1&&value!==null?{value:round(value,digits),symbol:'circle',symbolSize:6,label:{show:true,position:'top',formatter:'{c}'+p.unit,fontSize:10}}:round(value,digits)),
                    ...(target!==null?{markLine:{symbol:'none',silent:true,lineStyle:{type:'dashed',color:INK,width:1},label:{show:false},data:[{yAxis:target}]}}:{})});});
            return kit.chart(option,{title:p.title,height:Math.max(160,lines*p.height+20)});
        }});
    define({id:'bump',kind:'series',group:'排名',name:{zh:'排名变化图',en:'Bump chart'},use:'几个对象每月的名次变化（values 填名次 1、2、3…，1 在最上面）',
        params:['title',['legend',{default:'right'}],'height'],
        render(data,p,kit){
            const {categories,series}=readSeries(this,data),worst=Math.max(...series.flatMap(item=>item.values).filter(value=>value!==null),series.length);
            return kit.chart({tooltip:{trigger:'axis',confine:true},legend:legendOf(p.legend,series),grid:grid({legend:p.legend,count:series.length}),xAxis:{type:'category',data:categories,boundaryGap:false},yAxis:{type:'value',inverse:true,min:1,max:worst,interval:1,axisLabel:{formatter:'第{value}'},splitLine:{lineStyle:{type:'dashed',color:'#e3e9f0'}}},
                series:series.map(item=>({type:'line',name:item.name,symbolSize:10,lineStyle:{width:3},endLabel:{show:true,formatter:'{a}',fontSize:11},label:{show:true,position:'inside',formatter:'{c}',fontSize:9,color:'#fff'},data:item.values}))},{title:p.title,height:p.height});
        }});
    define({id:'cumulative',kind:'series',group:'趋势',name:{zh:'累计进度对目标',en:'Cumulative vs plan'},use:'年度 / 季度目标的累计完成情况：每期数量累加成曲线，和按期均分的计划线对比（第一个系列是每期实际数；target 是期末总目标）',
        params:['title','unit','decimals','target','height'],
        render(data,p,kit){
            const {categories,series,target:dataTarget}=readSeries(this,data),target=p.target??dataTarget,values=series[0].values;let running=0;
            const actual=values.map(value=>value===null?null:(running+=value));const digits=places(actual,p.decimals);
            const plan=target===null?null:categories.map((_,index)=>round(target*(index+1)/categories.length,digits));
            const list=[{type:'line',name:'累计实际',symbolSize:6,areaStyle:{opacity:0.12},label:{show:true,position:'top',formatter:'{c}'+p.unit,fontSize:10},data:actual.map(value=>round(value,digits))}];
            if(plan)list.push({type:'line',name:'计划进度',symbol:'none',lineStyle:{type:'dashed',color:INK},itemStyle:{color:INK},data:plan});
            return chart(kit,{tooltip:{trigger:'axis',confine:true},grid:grid({legend:'top',count:list.length}),legend:legendOf('top',list),xAxis:{...categoryAxis(categories),boundaryGap:false},yAxis:valueAxis(p.unit),series:list},p);
        }});
    define({id:'table-trend',kind:'series',group:'明细',name:{zh:'带迷你趋势的表',en:'Table with sparklines'},use:'每行一个对象：近几期的小走势线 + 最新值 + 较上期变化，信息密度最高的汇总表',
        params:['title','unit','decimals','rule','target'],
        render(data,p){
            const {categories,series,target:dataTarget}=readSeries(this,data),target=p.target??dataTarget,digits=places(series.flatMap(item=>item.values),p.decimals);
            const rows=series.map(item=>{const values=item.values.filter(value=>value!==null),last=values[values.length-1]??null,prev=values[values.length-2]??null,change=last===null||prev===null?null:round(last-prev,digits),ok=passes(last,target,p.rule);
                return `<tr><td>${esc(item.name)}</td><td style="width:38%">${sparkline(item.values,ok===null?'':ok?'good':'bad')}</td><td style="text-align:right;font-weight:600;color:${ok===false?BAD:'inherit'}">${last===null?'—':fmt(round(last,digits),digits)+esc(p.unit)}</td><td style="text-align:right">${change===null?'—':arrow(change,p.rule==='lte'?change<0:change>0)}</td></tr>`;}).join('');
            return `${titleHtml(p.title)}<table class="kit-table"><thead><tr><th>对象</th><th>${esc(categories[0])} → ${esc(categories[categories.length-1])}</th><th style="text-align:right">最新</th><th style="text-align:right">较上期</th></tr></thead><tbody>${rows}</tbody></table>`;
        }});

    define({id:'calendar-heatmap',kind:'daily',group:'分布',name:{zh:'日历热力图',en:'Calendar heatmap'},use:'一个月（或一个季度）每天的量：告警、工单、故障按天分布，周末和高峰一眼可见',
        params:['title','unit','scheme','height'],
        render(data,p,kit){
            const days=readDaily(this,data),values=days.map(day=>day.value).filter(value=>value!==null);
            const first=days.map(day=>day.date).sort()[0],last=days.map(day=>day.date).sort().at(-1);
            const colors=p.scheme==='rg'?['#d4554f','#f3d27a','#2f9e6f']:p.scheme==='gr'?['#e3f4ec','#f3d27a','#d4554f']:['#eef4fb','#7fa9d6','#1f5e95'];
            const months=Math.max(1,Math.round((dayOf(last)-dayOf(first))/86400000/30)+1);
            return kit.chart({tooltip:{position:'top',confine:true},visualMap:{min:Math.min(...values,0),max:Math.max(...values,1),orient:'horizontal',left:'center',bottom:0,itemHeight:120,inRange:{color:colors},textStyle:{fontSize:10}},
                calendar:{range:[first,last],top:30,left:36,right:16,bottom:46,cellSize:['auto','auto'],orient:'horizontal',yearLabel:{show:false},monthLabel:{nameMap:'ZH',fontSize:11},dayLabel:{nameMap:'ZH',firstDay:1,fontSize:10},itemStyle:{borderColor:'#fff',borderWidth:2},splitLine:{show:false}},
                series:[{type:'heatmap',coordinateSystem:'calendar',label:{show:months<=1,formatter:'{@[1]}',fontSize:9},data:days.map(day=>[day.date,day.value])}]},{title:p.title,height:Math.max(p.height,months<=1?260:200)});
        }});
    define({id:'sunburst',kind:'tree',group:'构成',name:{zh:'旭日图（多层构成）',en:'Sunburst'},use:'两三层的构成：地区部 → 代表处 → 站点的故障数，内圈是上层',
        params:['title','unit','height'],
        render(data,p,kit){const root=readTree(this,data);return kit.chart({tooltip:{trigger:'item',formatter:'{b}：{c}'+p.unit,confine:true},series:[{type:'sunburst',radius:['12%','92%'],sort:'desc',itemStyle:{borderColor:'#fff',borderWidth:2},label:{rotate:'radial',fontSize:10,minAngle:8},levels:[{},{r0:'12%',r:'45%'},{r0:'45%',r:'72%'},{r0:'72%',r:'92%',label:{position:'outside',fontSize:9}}],data:root.children}]},{title:p.title,height:p.height});}});
    define({id:'tree-org',kind:'tree',group:'流程',name:{zh:'层级树',en:'Hierarchy tree'},use:'组织架构、指标拆解（总指标 → 分项 → 子项），节点可带数值',
        params:['title','unit','height'],
        render(data,p,kit){const root=readTree(this,data);const label=node=>({...node,name:node.value!==undefined?`${node.name}\n${fmt(node.value,places([node.value],-1))}${p.unit}`:node.name,...(node.children?{children:node.children.map(label)}:{})});
            return kit.chart({tooltip:{trigger:'item',confine:true},series:[{type:'tree',orient:'TB',top:24,bottom:40,left:20,right:20,symbolSize:10,initialTreeDepth:-1,expandAndCollapse:false,label:{position:'top',fontSize:11,lineHeight:15},leaves:{label:{position:'bottom'}},lineStyle:{color:'#b8c4d2'},data:[label(root.name?root:{...root,name:p.title||'总计'})]}]},{title:p.title,height:p.height});}});
    define({id:'sankey',kind:'flow',group:'流程',name:{zh:'桑基图（流向）',en:'Sankey'},use:'数量从哪里流到哪里：工单从受理渠道 → 处理部门 → 结果，宽度代表数量',
        params:['title','unit','height'],
        render(data,p,kit){const {nodes,links}=readFlow(this,data);return kit.chart({tooltip:{trigger:'item',confine:true},series:[{type:'sankey',left:8,right:90,top:8,bottom:8,nodeGap:10,emphasis:{focus:'adjacency'},lineStyle:{color:'gradient',opacity:0.35},label:{fontSize:11},data:nodes.map(name=>({name})),links}]},{title:p.title,height:p.height});}});
    define({id:'boxplot',kind:'groups',group:'分布',name:{zh:'箱线图（分布与异常）',en:'Box plot'},use:'比较几组数的分布：各部门的处理时长中位数、四分位和离群点（values 放每个样本）',
        params:['title','unit','decimals','height'],
        render(data,p,kit){
            const groups=readGroups(this,data),digits=p.decimals<0?1:p.decimals;
            const boxes=groups.map(group=>{const v=group.values;if(!v.length)return [0,0,0,0,0];const q1=quantile(v,0.25),q3=quantile(v,0.75),iqr=q3-q1,low=v.find(x=>x>=q1-1.5*iqr),high=[...v].reverse().find(x=>x<=q3+1.5*iqr);return [low,q1,quantile(v,0.5),q3,high].map(x=>round(x,digits));});
            const outliers=groups.flatMap((group,index)=>group.values.filter(x=>x<boxes[index][0]||x>boxes[index][4]).map(x=>[index,round(x,digits)]));
            return chart(kit,{tooltip:{trigger:'item',confine:true},grid:grid(),xAxis:categoryAxis(groups.map(group=>group.label)),yAxis:valueAxis(p.unit),series:[{type:'boxplot',itemStyle:{borderColor:'#2f6fae',color:'#eaf2fb'},data:boxes},{type:'scatter',symbolSize:7,itemStyle:{color:BAD},data:outliers}]},p);
        }});
    define({id:'histogram',kind:'groups',group:'分布',name:{zh:'直方图（区间分布）',en:'Histogram'},use:'一组数落在各个区间的个数：处理时长分布、满意度分布（只用第一组 values）',
        params:['title','unit',['limit',{label:['分几段','Bins'],default:10,min:3,max:40}],'showValue','height'],
        render(data,p,kit){
            const values=readGroups(this,data)[0].values;if(!values.length)return emptyChart(p);
            const low=values[0],high=values[values.length-1],bins=Math.max(3,p.limit||10),width=(high-low)/bins||1,counts=Array(bins).fill(0);
            for(const value of values)counts[Math.min(bins-1,Math.floor((value-low)/width))]++;
            const digits=places([width],-1)?places([width],-1):0,labels=counts.map((_,index)=>`${fmt(round(low+index*width,digits),digits)}–${fmt(round(low+(index+1)*width,digits),digits)}${p.unit}`);
            return chart(kit,{grid:grid(),xAxis:categoryAxis(labels),yAxis:valueAxis(''),series:[{type:'bar',barCategoryGap:'4%',label:valueLabel(p.showValue,'top',''),data:counts}]},p);
        }});
    define({id:'gantt',kind:'tasks',group:'流程',name:{zh:'甘特图（项目进度）',en:'Gantt'},use:'重点项目 / 整改任务的起止时间和完成进度，竖线标出今天（报告月份月底）',
        params:['title'],
        render(data,p){
            const tasks=readTasks(this,data),start=Math.min(...tasks.map(task=>dayOf(task.start))),end=Math.max(...tasks.map(task=>dayOf(task.end)))+86400000,span=end-start||1;
            const pos=time=>((time-start)/span*100).toFixed(2);
            const months=[];for(let at=new Date(start);at.getTime()<end;at=new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth()+1,1)))months.push({left:Math.max(0,+pos(at.getTime())),label:`${at.getUTCMonth()+1}月`});
            const rows=tasks.map(task=>{const left=pos(dayOf(task.start)),width=Math.max(0.8,(dayOf(task.end)+86400000-dayOf(task.start))/span*100).toFixed(2),color=toneColor(task.tone),progress=task.progress===null?null:Math.max(0,Math.min(100,task.progress));
                return `<div style="display:flex;align-items:center;min-height:30px;border-bottom:1px solid #f0f3f7"><div style="width:30%;flex:none;padding-right:8px;font-size:12px;overflow-wrap:anywhere">${esc(task.label)}${task.owner?`<small style="color:${INK}"> · ${esc(task.owner)}</small>`:''}</div><div style="position:relative;flex:1;height:18px"><div style="position:absolute;left:${left}%;width:${width}%;top:2px;height:14px;border-radius:7px;background:color-mix(in srgb, ${color} 22%, #fff);overflow:hidden">${progress===null?'':`<div style="height:100%;width:${progress}%;background:${color}"></div>`}</div>${progress===null?'':`<span style="position:absolute;left:calc(${left}% + ${width}% + 4px);top:1px;font-size:11px;color:${INK};white-space:nowrap">${fmt(progress,0)}%</span>`}</div></div>`;}).join('');
            const scale=`<div style="display:flex"><div style="width:30%;flex:none"></div><div style="position:relative;flex:1;height:18px;font-size:11px;color:${INK}">${months.map(month=>`<span style="position:absolute;left:${month.left}%;border-left:1px solid #dfe5ec;padding-left:3px">${month.label}</span>`).join('')}</div></div>`;
            return `${titleHtml(p.title)}${scale}${rows}`;
        }});
    define({id:'milestone',kind:'events',group:'流程',name:{zh:'横向里程碑',en:'Milestones'},use:'几个关键节点横向排开（立项 → 上线 → 验收），已完成 / 进行中 / 风险用颜色区分；4–8 个节点',
        params:['title'],
        render(data,p){
            if(!Array.isArray(data)||!data.length)fail(this,`数据要是数组 ${KINDS.events.shape}`);
            const nodes=data.map(row=>{const tone=pick(row,'tone'),text=pick(row,'text');return `<div style="flex:1 1 0;min-width:90px;text-align:center;position:relative;padding-top:26px"><span style="position:absolute;top:6px;left:50%;transform:translateX(-50%);width:16px;height:16px;border-radius:50%;background:${toneColor(tone)};border:3px solid #fff;box-shadow:0 0 0 1px #d3dee9"></span><div style="font-size:11px;color:${INK}">${esc(pick(row,'date')??'')}</div><div style="font-weight:600;font-size:13px">${esc(pick(row,'title','label')??'')}</div>${text?`<div style="font-size:12px;color:#3c4d5f">${esc(text)}</div>`:''}</div>`;}).join('');
            return `${titleHtml(p.title)}<div style="position:relative;display:flex;gap:6px"><div style="position:absolute;left:5%;right:5%;top:13px;height:2px;background:#d3dee9"></div>${nodes}</div>`;
        }});
    define({id:'quote',kind:'text',group:'文字',name:{zh:'大字结论',en:'Headline statement'},use:'一句话的核心结论放大显示（“本月全部指标达标”），适合章节开头或看板顶部',
        params:['title',['tone',{default:'info'}]],
        render(data,p,kit){const text=typeof data==='string'?data:pick(data,'text');if(typeof text!=='string')fail(this,`数据要是 ${KINDS.text.shape}`);const color=toneColor(p.tone==='info'?'':p.tone);
            return `${titleHtml(p.title)}<div style="font-size:20px;font-weight:600;line-height:1.5;padding:6px 4px 6px 16px;border-left:5px solid ${color};color:var(--rep-heading,#132c45)">${kit.text(text).replace(/<p class="kit-text">/g,'<p style="margin:0">')}</div>`;}});

    // ── Compositions: ready-made multi-slot layouts. `data` names the field of compute's result each slot reads. ──
    const COMPOSITIONS=[
        {id:'kpi-over-trend',name:{zh:'指标卡 + 趋势',en:'KPIs over a trend'},use:'顶部几个核心数字，下面是主要指标的月度走势',rows:[[{id:'kpi',template:'kpi-cards',data:'kpis'}],[{id:'trend',template:'line-trend',data:'trend'}]]},
        {id:'chart-table',name:{zh:'图表 + 明细表（左右）',en:'Chart beside table'},use:'左边图表看整体，右边表格看具体数字',rows:[[{id:'chart',template:'bar-target',data:'chart',width:60},{id:'table',template:'table-basic',data:'table',width:40}]]},
        {id:'chart-over-table',name:{zh:'图表 + 明细表（上下）',en:'Chart above table'},use:'表格列多、放不下左右并排时',rows:[[{id:'chart',template:'bar-basic',data:'chart'}],[{id:'table',template:'table-paged',data:'table'}]]},
        {id:'trend-and-rank',name:{zh:'趋势 + 排名',en:'Trend and ranking'},use:'左边整体走势，右边本月各对象排名',rows:[[{id:'trend',template:'line-trend',data:'trend',width:58},{id:'rank',template:'rank-bar',data:'rank',width:42}]]},
        {id:'share-and-trend',name:{zh:'构成 + 趋势',en:'Share and trend'},use:'本月构成占比，配合各部分的月度走势',rows:[[{id:'share',template:'pie-donut',data:'share',width:40},{id:'trend',template:'area-stacked',data:'trend',width:60}]]},
        {id:'kpi-gauges',name:{zh:'指标卡 + 仪表盘',en:'KPIs with gauges'},use:'数量类放指标卡，比率类放仪表盘',rows:[[{id:'kpi',template:'kpi-cards',data:'kpis'}],[{id:'gauge',template:'gauge-grid',data:'gauges'}]]},
        {id:'dashboard',name:{zh:'小型看板',en:'Mini dashboard'},use:'一个格子讲完一个专题：数字、走势、构成、问题清单',rows:[[{id:'kpi',template:'kpi-spark',data:'kpis'}],[{id:'trend',template:'line-trend',data:'trend',width:60},{id:'share',template:'pie-donut',data:'share',width:40}],[{id:'issues',template:'bullet-list',data:'issues'}]]},
        {id:'compare-with-notes',name:{zh:'环比对比 + 结论',en:'Comparison with notes'},use:'本月和上月对比，旁边写结论',rows:[[{id:'compare',template:'bar-compare',data:'compare',width:62},{id:'notes',template:'text-summary',data:'notes',width:38}]]},
        {id:'rag-with-issues',name:{zh:'达标矩阵 + 未达标说明',en:'RAG matrix with issues'},use:'达标总览，下面列出未达标项和原因',rows:[[{id:'matrix',template:'heatmap-rag',data:'matrix'}],[{id:'issues',template:'bullet-list',data:'issues'}]]},
        {id:'pareto-with-table',name:{zh:'帕累托 + 明细',en:'Pareto with detail'},use:'主要原因排序，右边列出前几项的明细',rows:[[{id:'pareto',template:'pareto',data:'pareto',width:58},{id:'table',template:'table-basic',data:'table',width:42}]]},
        {id:'headline-and-chart',name:{zh:'大数字 + 图表',en:'Headline with chart'},use:'左边一个醒目的数字，右边支撑它的图表',rows:[[{id:'headline',template:'big-number',data:'headline',width:30},{id:'chart',template:'line-trend',data:'trend',width:70}]]},
        {id:'two-charts',name:{zh:'两个图表并排',en:'Two charts side by side'},use:'两个相关但不同的视角并排（模板可以换成任意两个）',rows:[[{id:'left',template:'bar-basic',data:'left',width:50},{id:'right',template:'line-trend',data:'right',width:50}]]},
        {id:'scorecard-and-trend',name:{zh:'计分卡 + 趋势',en:'Scorecard with trend'},use:'考核汇总表配上关键指标的走势',rows:[[{id:'score',template:'scorecard',data:'score',width:55},{id:'trend',template:'line-trend',data:'trend',width:45}]]},
        {id:'bullet-and-lights',name:{zh:'子弹图 + 红绿灯',en:'Bullets with traffic lights'},use:'达标情况的专业版：左边子弹图，右边红绿灯清单',rows:[[{id:'bullet',template:'bullet',data:'bullet',width:60},{id:'lights',template:'traffic-list',data:'lights',width:40}]]},
        {id:'strip-over-multiples',name:{zh:'数字条 + 小多图',en:'Stat strip over small multiples'},use:'顶部一行数字，下面每个对象一张迷你走势',rows:[[{id:'strip',template:'stat-strip',data:'kpis'}],[{id:'multiples',template:'line-small-multiples',data:'trend'}]]},
        {id:'calendar-and-rank',name:{zh:'日历热力 + 排名',en:'Calendar with ranking'},use:'每天的量配上本月最多的对象',rows:[[{id:'calendar',template:'calendar-heatmap',data:'daily',width:62},{id:'rank',template:'rank-bar',data:'rank',width:38}]]},
        {id:'gantt-and-milestones',name:{zh:'里程碑 + 甘特',en:'Milestones with Gantt'},use:'项目专题：上面关键节点，下面任务进度',rows:[[{id:'milestones',template:'milestone',data:'milestones'}],[{id:'gantt',template:'gantt',data:'tasks'}]]},
        {id:'flow-and-table',name:{zh:'流向 + 明细',en:'Flow with detail'},use:'流转全貌加关键环节的明细数字',rows:[[{id:'flow',template:'sankey',data:'flow',width:62},{id:'table',template:'table-basic',data:'table',width:38}]]},
        {id:'distribution-pair',name:{zh:'分布对比',en:'Distribution pair'},use:'箱线图比较各组，直方图看整体分布',rows:[[{id:'box',template:'boxplot',data:'groups',width:55},{id:'hist',template:'histogram',data:'groups',width:45}]]},
        {id:'headline-over-dashboard',name:{zh:'结论 + 三联图',en:'Statement over three charts'},use:'一句大字结论，下面三张支撑图',rows:[[{id:'headline',template:'quote',data:'headline'}],[{id:'a',template:'kpi-target',data:'kpis',width:34},{id:'b',template:'half-donut',data:'share',width:33},{id:'c',template:'dumbbell',data:'compare',width:33}]]},
    ];

    // ── View: {title?, rows:[[{id, template, data?, params?, width?}]]}; {template, data?, params?} is one slot ──────
    const byId=new Map(TEMPLATES.map(template=>[template.id,template]));
    const get=id=>byId.get(String(id||''))||null;
    const slotId=(value,index)=>/^[A-Za-z][\w-]{0,30}$/.test(value||'')?value:'slot'+(index+1);
    function cleanParams(template,input){
        const source=input&&typeof input==='object'?input:{},out={};
        for(const def of template.params)out[def.key]=cleanParam(def,source[def.key]);
        return out;
    }
    // Only the parameters that differ from the defaults are stored, so a better default later reaches old cells too.
    function changedParams(template,params){const out={};for(const def of template.params){const value=cleanParam(def,params?.[def.key]);if(value!==def.default)out[def.key]=value;}return out;}
    function normalizeView(input){
        if(!input||typeof input!=='object')return null;
        const raw=Array.isArray(input.rows)?input.rows:input.template?[[input]]:null;if(!raw)return null;
        const rows=raw.map(row=>Array.isArray(row)?row:[row]).slice(0,4);let index=0;const seen=new Set();
        const out=rows.map(row=>row.slice(0,4).map(slot=>{
            if(!slot||typeof slot!=='object')return null;const template=get(slot.template);if(!template)return null;
            let id=slotId(slot.id,index++);while(seen.has(id))id+='x';seen.add(id);
            const width=num(slot.width);
            return {id,template:template.id,...(typeof slot.data==='string'&&/^[A-Za-z_$][\w$]{0,40}$/.test(slot.data)?{data:slot.data}:{}),params:changedParams(template,slot.params),...(width&&width>0&&width<=100?{width:Math.round(width)}:{})};
        }).filter(Boolean)).filter(row=>row.length);
        if(!out.length)return null;
        return {version:VERSION,...(typeof input.title==='string'&&input.title.trim()?{title:input.title.trim().slice(0,80)}:{}),rows:out};
    }
    const slots=view=>(view?.rows||[]).flat();
    function render(viewInput,result,kit){
        const view=normalizeView(viewInput);if(!view)throw new Error('展示设置无效：没有可用的模板');
        if(result&&typeof result==='object'&&result.missing===true)return kit.text(String(has(result,'message')?result.message:'本月暂无数据'));
        const list=slots(view);
        // A one-slot view and a result that wraps or unwraps its data differently ({data:[…]} vs […]) still match up.
        const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
        const pickData=slot=>{
            if(slot.data)return plain(result)&&slot.data in result?result[slot.data]:list.length===1&&!plain(result)?result:plain(result)?result[slot.data]:undefined;
            if(list.length===1&&plain(result)&&Array.isArray(KINDS[get(slot.template).kind]?.example)){const keys=Object.keys(result);if(keys.length===1&&Array.isArray(result[keys[0]]))return result[keys[0]];}
            return result;
        };
        const htmlOf=slot=>{
            const template=get(slot.template),data=pickData(slot);
            if(data===undefined||data===null)throw new Error(`模板「${template.name.zh}」读取 compute 结果里的「${slot.data||'（整个结果）'}」，但它不存在。compute 要返回 {${slot.data||'…'}: ${KINDS[template.kind].shape}}，实际只有：${result&&typeof result==='object'?Object.keys(result).join('、')||'（空）':typeName(result)}`);
            const params=cleanParams(template,slot.params);
            // No rows this month is a normal state, not a broken recipe.
            if(Array.isArray(data)&&!data.length)return titleHtml(params.title)+'<div class="kit-empty">本月暂无数据</div>';
            return template.render(data,params,kit);
        };
        // One slot whose own title says the same thing: show it once.
        if(list.length===1){const own=String(list[0].params?.title||'').trim();return (view.title&&view.title!==own?titleHtml(view.title):'')+htmlOf(list[0]);}
        return kit.layout(view.rows.map(row=>row.map(slot=>({id:slot.id,width:slot.width,html:htmlOf(slot)}))),{title:view.title});
    }
    // The render code stored in a template cell: it only hands the view to the library, so editing parameters never
    // needs new code (and the sandbox, exports and history keep working as for any recipe).
    const MARK='/* air-template-view */';
    const renderSource=view=>`function render(result, kit) { ${MARK} return AiReportTemplates.render(${JSON.stringify(normalizeView(view))}, result, kit); }`;
    const isTemplateRender=code=>String(code||'').includes(MARK);
    function viewFromRender(code){if(!isTemplateRender(code))return null;const match=String(code).match(/AiReportTemplates\.render\((\{[\s\S]*\}),\s*result,\s*kit\)/);try{return match?normalizeView(JSON.parse(match[1])):null;}catch(_){return null;}}
    const compatible=id=>{const template=get(id);return template?TEMPLATES.filter(item=>item.kind===template.kind):[];};
    const label=(pair,lang)=>Array.isArray(pair)?(lang==='en'?pair[1]:pair[0]):pair?.[lang==='en'?'en':'zh']||pair?.zh||'';

    // The platform line in the cell prompt that mirrors the view, so the prompt and the panel never disagree.
    const PROMPT_MARK='【展示参数】';
    function describe(viewInput){
        const view=normalizeView(viewInput);if(!view)return '';
        const parts=slots(view).map(slot=>{const template=get(slot.template),changed=Object.entries(slot.params).map(([key,value])=>{const def=template.params.find(item=>item.key===key);const shown=def.type==='bool'?(value?'是':'否'):def.type==='select'?(def.options.find(option=>option[0]===value)?.[1]||value):value===null?'自动':value;return `${def.label[0].replace(/（.*）/,'')}=${shown}`;});
            return `${slot.id}：${template.name.zh}（${template.id}${slot.data?'，数据='+slot.data:''}${slot.width?'，宽 '+slot.width+'%':''}）${changed.length?' '+changed.join('；'):''}`;});
        return `${PROMPT_MARK}${view.title?'总标题='+view.title+'｜':''}${parts.join('｜')}`;
    }
    const withDescription=(prompt,view)=>{const line=describe(view),rest=String(prompt||'').split('\n').filter(text=>!text.startsWith(PROMPT_MARK)).join('\n').trim();return line?`${rest}\n${line}`.trim():rest;};

    // Catalog for the model: short enough to send with every compile.
    function catalog(){
        const kinds=Object.entries(KINDS).map(([kind,info])=>`- ${kind}（${info.zh}）：${info.shape}`).join('\n');
        const list=TEMPLATES.map(template=>`- ${template.id}｜${template.name.zh}｜数据 ${template.kind}｜${template.use}｜参数：${template.params.map(def=>def.key+(def.type==='select'?'('+def.options.map(option=>option[0]).join('/')+')':'')).join(', ')}`).join('\n');
        const combos=COMPOSITIONS.map(item=>`- ${item.id}｜${item.name.zh}｜${item.use}｜${item.rows.map(row=>row.map(slot=>`${slot.id}=${slot.template}←result.${slot.data}${slot.width?' '+slot.width+'%':''}`).join(' + ')).join(' / ')}`).join('\n');
        return `数据形状：\n${kinds}\n\n模板（id｜名称｜数据｜适用场景｜参数）：\n${list}\n\n组合布局（一个格子放多个模板时参考）：\n${combos}`;
    }

    // Parameter details of the templates a view uses (and those it could switch to), for adjusting from a mark.
    function paramGuide(viewInput){
        const view=normalizeView(viewInput);if(!view)return '';
        const ids=[...new Set(slots(view).flatMap(slot=>compatible(slot.template).map(item=>item.id)))];
        return ids.map(id=>{const template=get(id);return `- ${id}｜${template.name.zh}｜数据 ${template.kind}｜参数：${template.params.map(def=>`${def.key}（${def.label[0]}；${def.type==='select'?def.options.map(option=>option[0]+'='+option[1]).join('/'):def.type}${def.default!==null&&def.default!==''?'，默认 '+def.default:''}）`).join('；')}`;}).join('\n');
    }

    // ── Settings of cells the AI wrote itself ───────────────────────────────────────────────────────────────
    // Free render code declares what users may tune in one JSON block: const P = kit.params({"top":{"label":"显示前几名",
    // "type":"number","value":10}, …}). The panel reads and rewrites only that block, so every cell gets settings
    // that need no AI, just like template cells.
    const FREE_TYPES=['number','text','bool','select','color'];
    function jsonBlockAt(code,from){
        let depth=0,quote='',start=-1;
        for(let index=from;index<code.length;index++){
            const char=code[index];
            if(quote){if(char==='\\')index++;else if(char===quote)quote='';continue;}
            if(char==='"'){quote=char;continue;}
            if(char==='{'){if(depth===0)start=index;depth++;}
            else if(char==='}'){depth--;if(depth===0)return {start,end:index+1};if(depth<0)return null;}
            else if(depth===0&&!/\s/.test(char))return null;
        }
        return null;
    }
    function normalizeFreeDef(key,input){
        if(!/^[A-Za-z_$][\w$]{0,40}$/.test(key)||!input||typeof input!=='object')return null;
        const type=FREE_TYPES.includes(input.type)?input.type:typeof input.value==='boolean'?'bool':typeof input.value==='number'?'number':'text';
        const def={label:String(input.label||key).slice(0,40),type};
        if(type==='number'){const value=Number(input.value);def.value=Number.isFinite(value)?value:0;for(const name of ['min','max','step'])if(Number.isFinite(Number(input[name]))&&input[name]!==null&&input[name]!=='')def[name]=Number(input[name]);}
        else if(type==='bool')def.value=input.value===true;
        else if(type==='color')def.value=/^#[0-9a-f]{6}$/i.test(String(input.value||''))?String(input.value):'#2f6fae';
        else if(type==='select'){
            def.options=(Array.isArray(input.options)?input.options:[]).slice(0,20).map(option=>Array.isArray(option)?[String(option[0]),String(option[1]??option[0])]:[String(option),String(option)]).filter(option=>option[0]);
            if(!def.options.length)return null;
            def.value=def.options.some(option=>option[0]===String(input.value))?String(input.value):def.options[0][0];
        }
        else def.value=String(input.value??'').slice(0,200);
        return def;
    }
    function freeParams(code){
        const source=String(code||''),at=source.search(/kit\s*\.\s*params\s*\(/);if(at<0||isTemplateRender(source))return null;
        const block=jsonBlockAt(source,source.indexOf('(',at)+1);if(!block)return null;
        try{
            const raw=JSON.parse(source.slice(block.start,block.end)),defs={};
            for(const [key,input] of Object.entries(raw).slice(0,16)){const def=normalizeFreeDef(key,input);if(def)defs[key]=def;}
            return Object.keys(defs).length?{defs,start:block.start,end:block.end}:null;
        }catch(_){return null;}
    }
    // New values go into the block; everything else in the code stays byte for byte.
    function setFreeParams(code,values){
        const found=freeParams(code);if(!found)return String(code||'');
        const defs={};
        for(const [key,def] of Object.entries(found.defs)){const next=normalizeFreeDef(key,{...def,value:key in (values||{})?values[key]:def.value});defs[key]=next||def;}
        return String(code).slice(0,found.start)+JSON.stringify(defs)+String(code).slice(found.end);
    }
    const freeValues=defs=>Object.fromEntries(Object.entries(defs||{}).map(([key,def])=>[key,def.value]));
    function describeFree(defs){
        const parts=Object.values(defs||{}).map(def=>`${def.label}=${def.type==='bool'?(def.value?'是':'否'):def.type==='select'?(def.options.find(option=>option[0]===def.value)?.[1]||def.value):def.value}`);
        return parts.length?`${PROMPT_MARK}${parts.join('；')}`:'';
    }
    const withFreeDescription=(prompt,defs)=>{const line=describeFree(defs),rest=String(prompt||'').split('\n').filter(text=>!text.startsWith(PROMPT_MARK)).join('\n').trim();return line?`${rest}\n${line}`.trim():rest;};
    // How the model writes free code with settings (added to the compile prompts of both servers).
    const FREE_GUIDE=`不用模板、自己写 render 时，必须把用户以后可能想改的展示值（标题、显示前几名、排序方向、单位、小数位、主色、是否显示数值/图例、横向/纵向等，3–8 个）放进 render 第一行的参数块，后面的代码只读 P.xxx，不要把这些值写死在别处：
const P = kit.params({"title":{"label":"标题","type":"text","value":"各运营商回传率"},"top":{"label":"显示前几名","type":"number","value":10,"min":1,"max":50},"order":{"label":"排序","type":"select","value":"desc","options":[["desc","从高到低"],["asc","从低到高"]]},"color":{"label":"主色","type":"color","value":"#2f6fae"},"showValue":{"label":"显示数值","type":"bool","value":true}});
参数块必须是严格 JSON（键和字符串都用双引号，不能有注释、变量或函数）；type 只能是 number/text/bool/select/color；参数只影响展示，不影响 compute。用户在面板里改参数时平台只改这个 JSON 块并重跑 render，不调用 AI。提示词里有【展示参数】时，按其中的值填写 value。`;

    // What the data really looks like, added to run errors so a retry (or the user) sees the real field names.
    function dataHint(input){
        const parts=[];
        for(const [id,source] of Object.entries(input||{})){
            if(!source||typeof source!=='object'||id.startsWith('$'))continue;
            if(Array.isArray(source.rows)){const keys=[...new Set(source.rows.slice(0,20).flatMap(row=>row&&typeof row==='object'?Object.keys(row):[]))].slice(0,30);parts.push(`input.${id}.rows 共 ${source.rows.length} 行${keys.length?`，字段：${keys.join('、')}`:''}`);}
            else if(Array.isArray(source.metrics))parts.push(`input.${id}.metrics 共 ${source.metrics.length} 条（按 label / metricName 筛选，数值用 numValue）`);
            else parts.push(`input.${id} 的键：${Object.keys(source).slice(0,20).join('、')}`);
        }
        const text=parts.join('；');
        return text?`【实际数据】${text.slice(0,900)}`:'';
    }

    // Server prompts (both editions): marks on free cells change only the values; old free cells get a parameter block.
    const ADJUST_PARAMS_PROMPT=`你调整月报格子的展示参数，不改数据、计算和代码。格子的展示代码声明了一组参数（label、type、当前 value、可选 options/min/max），用户在格子画面上某处做了标记并写了修改意见。
- 只能改这些参数的值；select 只能取 options 里的值，bool 只能 true/false，color 用 #RRGGBB，number 用数字。
- 意见用这些参数做不到（要新增内容、换图表类型、改数据或计算等）时，回复 data，由格子对话处理。
只输出 JSON，二选一：
{"type":"params","reply":"一句话说明改了什么","values":{"参数键":新值}}
{"type":"data","reply":"为什么需要交给格子对话"}`;
    const EXTRACT_PARAMS_PROMPT=`你整理月报格子的展示代码 render(result, kit)，让用户以后不用 AI 也能调整展示。
把代码里写死的、用户可能想改的展示值（标题、显示前几名、排序方向、单位、小数位、主色、是否显示数值/图例、横向/纵向、字号等，3–8 个）提到 render 第一行的参数块，代码改为读取 P.xxx；当前效果必须完全不变（value 填现在写死的值）。
参数块写法：const P = kit.params({"title":{"label":"标题","type":"text","value":"…"},"top":{"label":"显示前几名","type":"number","value":10,"min":1,"max":50},"order":{"label":"排序","type":"select","value":"desc","options":[["desc","从高到低"],["asc","从低到高"]]},"color":{"label":"主色","type":"color","value":"#2f6fae"},"showValue":{"label":"显示数值","type":"bool","value":true}});
参数块必须是严格 JSON（双引号，无注释、变量、函数）；type 只能是 number/text/bool/select/color。只改展示代码，不改读取的字段名和数据，不删减内容。
只输出 JSON：{"render":"function render(result, kit) { … }"}`;

    return {VERSION,KINDS,PARAMS,TEMPLATES,COMPOSITIONS,get,compatible,normalizeView,cleanParams,changedParams,render,renderSource,isTemplateRender,viewFromRender,describe,withDescription,PROMPT_MARK,catalog,slots,label,paramGuide,
        freeParams,setFreeParams,freeValues,describeFree,withFreeDescription,FREE_GUIDE,dataHint,ADJUST_PARAMS_PROMPT,EXTRACT_PARAMS_PROMPT};
});
