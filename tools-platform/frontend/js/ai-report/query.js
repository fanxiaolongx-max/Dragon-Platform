/* Query recipes: the AI says what data it wants as JSON (source, filters, grouping, fields), the platform runs it.
   Every field and filter value is checked against the real rows, so a guessed column or value fails at once with the
   real names instead of drawing zeros or empty cards. The compute stored in a cell only hands the query to this
   library, like template views do for render (same sandbox, same recipe format).
   Shared by the page, the sandbox and both servers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AiReportQuery=api;})(typeof self!=='undefined'?self:typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const OPS=['=','!=','>','>=','<','<=','in','notIn','contains','notEmpty'];
    const AGGS=['sum','avg','count','min','max','first','last'];
    const SHAPES=['items','kpis','rows','series','text'];
    const fail=message=>{throw new Error('取数查询：'+message);};
    const num=value=>{if(value===null||value===undefined)return null;if(typeof value==='number')return Number.isFinite(value)?value:null;const text=String(value).replace(/[,%\s]/g,'');if(!text)return null;const number=Number(text);return Number.isFinite(number)?number:null;};
    const round=(value,digits)=>value===null||digits===undefined||digits===null?value:Number(value.toFixed(Math.max(0,Math.min(6,digits))));
    const list=value=>Array.isArray(value)?value:value===undefined||value===null?[]:[value];
    // Rows of a source: imported tables and datasets have rows, metric sources a metrics list.
    function rowsOf(input,from){
        const source=input?.[from];
        if(!source||typeof source!=='object')fail(`数据源「${from}」不存在，recipe.sources 里要有 id 为 ${from} 的来源；现有：${Object.keys(input||{}).filter(key=>!key.startsWith('$')).join('、')||'（无）'}`);
        if(Array.isArray(source.rows))return source.rows;
        if(Array.isArray(source.metrics))return source.metrics;
        if(Array.isArray(source))return source;
        fail(`数据源「${from}」没有行数据（rows / metrics）`);
    }
    // A field must exist on some row; the error lists the real ones.
    function checker(rows,from){
        const keys=new Set(rows.slice(0,200).flatMap(row=>row&&typeof row==='object'?Object.keys(row):[]));
        return field=>{
            if(typeof field!=='string'||!field)fail('字段名不能为空');
            if(rows.length&&!keys.has(field))fail(`「${from}」里没有字段「${field}」，实际字段：${[...keys].slice(0,40).join('、')}`);
            return field;
        };
    }
    const same=(a,b)=>a===b||String(a??'').trim()===String(b??'').trim()||(num(a)!==null&&num(a)===num(b));
    function test(row,rule){
        const value=row?.[rule.field];
        switch(rule.op||'='){
            case '=':return same(value,rule.value);
            case '!=':return !same(value,rule.value);
            case '>':return num(value)!==null&&num(value)>num(rule.value);
            case '>=':return num(value)!==null&&num(value)>=num(rule.value);
            case '<':return num(value)!==null&&num(value)<num(rule.value);
            case '<=':return num(value)!==null&&num(value)<=num(rule.value);
            case 'in':return list(rule.value).some(item=>same(value,item));
            case 'notIn':return !list(rule.value).some(item=>same(value,item));
            case 'contains':return String(value??'').includes(String(rule.value??''));
            case 'notEmpty':return value!==null&&value!==undefined&&String(value).trim()!=='';
            default:return fail(`不支持的条件 ${rule.op}，可用：${OPS.join(' ')}`);
        }
    }
    // A filter on a value the field never has (a guessed 'TE' for 'TE 区域') is a mistake, not an empty month.
    function checkValues(rows,where){
        if(!rows.length)return;
        for(const rule of where){
            if(!['=','in'].includes(rule.op||'='))continue;
            const seen=[...new Set(rows.map(row=>row?.[rule.field]).filter(value=>value!==null&&value!==undefined).map(String))];
            const wanted=list(rule.value);
            const missing=wanted.filter(item=>!seen.some(value=>same(value,item)));
            if(missing.length===wanted.length&&seen.length)fail(`字段「${rule.field}」没有取值「${missing.join('、')}」，实际取值：${seen.slice(0,20).join('、')}${seen.length>20?' 等':''}`);
        }
    }
    function aggregate(rows,agg,field){
        if(agg==='count')return rows.length;
        if(agg==='first')return rows[0]?.[field]??null;
        if(agg==='last')return rows[rows.length-1]?.[field]??null;
        const values=rows.map(row=>num(row?.[field])).filter(value=>value!==null);
        if(!values.length)return null;
        if(agg==='sum')return values.reduce((sum,value)=>sum+value,0);
        if(agg==='avg')return values.reduce((sum,value)=>sum+value,0)/values.length;
        if(agg==='min')return Math.min(...values);
        if(agg==='max')return Math.max(...values);
        return fail(`不支持的汇总 ${agg}，可用：${AGGS.join(' ')}`);
    }
    // One output value: a field (optionally aggregated over a group), scaled and rounded; or a constant.
    // Columns whose values differ among rows, so an ambiguity error can say what to filter on.
    function differing(rows,field){
        const keys=Object.keys(rows[0]||{}).filter(key=>key!==field);
        const parts=keys.map(key=>[key,[...new Set(rows.map(row=>String(row?.[key]??'')))]]).filter(([,values])=>values.length>1&&values.length<=rows.length)
            // Category-like columns (text) first: they are what a filter is usually missing.
            .sort((a,b)=>(a[1].every(value=>num(value)!==null)-b[1].every(value=>num(value)!==null))||a[1].length-b[1].length).slice(0,3);
        return parts.length?`这些行的区别在：${parts.map(([key,values])=>`${key}（${values.slice(0,6).join('、')}）`).join('；')}。`:'';
    }
    function valueOf(spec,rows,check,where=''){
        if(spec===null||spec===undefined)return null;
        if(typeof spec==='string')spec={field:spec};
        if(typeof spec!=='object')return spec;
        if('const' in spec)return spec.const;
        // Several rows and no agg is ambiguous (adding up rates across periods gives 296%): say which column differs.
        if(!spec.agg&&rows.length>1)fail(`「${spec.field}」${where?`在「${where}」`:''}对应 ${rows.length} 行，没写怎么汇总。${differing(rows,spec.field)}请在 where 里再筛选到一行，或写 agg（sum/avg/max/min/first）`);
        const agg=spec.agg||'first';
        if(!AGGS.includes(agg))fail(`不支持的汇总 ${agg}，可用：${AGGS.join(' ')}`);
        if(agg!=='count')check(spec.field);
        let value=aggregate(rows,agg,spec.field);
        if(spec.divideBy){const base=aggregate(rows,spec.divideAgg||agg,check(spec.divideBy));value=num(value)!==null&&num(base)?num(value)/num(base):null;}
        if(value!==null&&spec.scale!==undefined&&num(value)!==null)value=num(value)*Number(spec.scale);
        return typeof value==='number'?round(value,spec.digits??4):value;
    }
    function groups(rows,by,check){
        if(!by)return [{key:'',rows}];
        const fields=list(by).map(check),map=new Map();
        for(const row of rows){const key=fields.map(field=>String(row?.[field]??'')).join(' / ');if(!map.has(key))map.set(key,[]);map.get(key).push(row);}
        return [...map].map(([key,members])=>({key,rows:members}));
    }
    function sortList(items,sort){
        if(!sort)return items;
        const by=sort.by||sort.field||'value',dir=sort.dir==='asc'?1:-1;
        return [...items].sort((a,b)=>{const x=num(a[by]),y=num(b[by]);if(x!==null&&y!==null)return (x-y)*dir;return String(a[by]??'').localeCompare(String(b[by]??''),'zh')*dir;});
    }
    function runOne(spec,input){
        if(!spec||typeof spec!=='object')fail('查询要是对象');
        const shape=spec.shape||'items';if(!SHAPES.includes(shape))fail(`shape 只能是 ${SHAPES.join('/')}`);
        const from=String(spec.from||'');const all=rowsOf(input,from),check=checker(all,from);
        const where=list(spec.where).map(rule=>({...rule,field:check(rule.field)}));
        checkValues(all,where);
        const rows=all.filter(row=>where.every(rule=>test(row,rule)));
        let out;
        if(shape==='kpis'){
            // Each card reads one value from the filtered rows (first row, or aggregated when agg is given).
            out=list(spec.cards).map(card=>{if(!card||!card.label)fail('kpis 的每张卡要有 label');return {label:String(card.label),value:valueOf(card.value??card.field,rows,check),...(card.unit?{unit:card.unit}:{}),...(card.target!==undefined?{target:valueOf(card.target,rows,check)}:{})};});
        }else if(shape==='rows'){
            const columns=spec.columns&&typeof spec.columns==='object'?spec.columns:null;if(!columns)fail('rows 要写 columns：{输出列名: 字段名或 {field,agg,scale}}');
            out=groups(rows,spec.groupBy,check).flatMap(group=>spec.groupBy?[Object.fromEntries(Object.entries(columns).map(([name,value])=>[name,valueOf(value,group.rows,check)]))]:group.rows.map(row=>Object.fromEntries(Object.entries(columns).map(([name,value])=>[name,valueOf(typeof value==='string'?{field:value,agg:'first'}:{...value,agg:value.agg||'first'},[row],check)]))));
        }else if(shape==='series'){
            // x along the axis (e.g. month or period), one series per measure.
            const x=check(spec.x);const measures=list(spec.series);if(!measures.length)fail('series 要写 series：[{name, field, agg?, scale?}]');
            let buckets=groups(rows,x,check);
            if(spec.order)buckets=list(spec.order).map(key=>buckets.find(group=>same(group.key,key))||{key:String(key),rows:[]});
            else if(spec.sortX!==false)buckets.sort((a,b)=>String(a.key).localeCompare(String(b.key),'zh',{numeric:true}));
            if(spec.limit)buckets=buckets.slice(-Number(spec.limit));
            out={categories:buckets.map(group=>group.key),series:measures.map(measure=>({name:String(measure.name||measure.field),values:buckets.map(group=>{const value=valueOf(measure,group.rows,check,group.key);return num(value);})}))};
        }else if(shape==='text'){
            const parts=list(spec.parts).map(part=>typeof part==='string'?part:String(valueOf(part,rows,check)??'—'));
            out=parts.join('');
        }else{
            // items: a label per group (or per row) and its value, with an optional target.
            const label=spec.label||spec.groupBy;if(!label)fail('items 要写 label（分类字段）');
            const value=spec.value;if(value===undefined)fail('items 要写 value（字段名或 {field, agg, scale}）');
            const by=spec.groupBy||label;
            out=groups(rows,by,check).map(group=>({label:group.key,value:num(valueOf(typeof value==='string'?{field:value,...(spec.groupBy?{agg:'sum'}:{})}:value,group.rows,check,group.key)),...(spec.target!==undefined?{target:num(valueOf(spec.target,group.rows,check,group.key))}:{})}));
        }
        if(Array.isArray(out)){
            if(spec.exclude)out=out.filter(item=>!list(spec.exclude).some(value=>same(item.label,value)));
            out=sortList(out,spec.sort);
            if(spec.limit&&shape!=='series')out=out.slice(0,Number(spec.limit));
        }
        return out;
    }
    // One query, or {name: query} when a view has several slots reading different fields of the result.
    function run(query,input){
        if(query&&typeof query==='object'&&!query.from&&!query.shape)return Object.fromEntries(Object.entries(query).map(([key,spec])=>[key,runOne(spec,input)]));
        return runOne(query,input);
    }
    const MARK='/* air-query */';
    const computeSource=query=>`function compute(input) { ${MARK} return AiReportQuery.run(${JSON.stringify(query)}, input); }`;
    const isQueryCompute=code=>String(code||'').includes(MARK);
    function queryFromCompute(code){if(!isQueryCompute(code))return null;const match=String(code).match(/AiReportQuery\.run\((\{[\s\S]*\}),\s*input\)/);try{return match?JSON.parse(match[1]):null;}catch(_){return null;}}
    const GUIDE=`【取数优先写 query，不写 compute】平台按 query 取数，并核对每个字段名和筛选值是否真实存在；只有 query 表达不了的复杂计算才写 compute。recipe 里写 "query":{...}（仍要写 sources）。
query 写法（严格 JSON）：
- 公共：from = sources 里的 id；where = [{"field":"列名","op":"= != > >= < <= in notIn contains notEmpty","value":值}]；sort = {"by":"value","dir":"desc|asc"}；limit = 数量；exclude = [要去掉的分类]。
- 分类对比 shape "items"（配 bar / bar-target / pie 等 items 模板）：{"shape":"items","from":"d1","where":[...],"label":"分类列","value":"数值列" 或 {"field":"列","agg":"sum|avg|count|min|max|first","scale":100,"divideBy":"分母列","digits":1},"target":{"const":95}}；同一分类多行时按 label 汇总（groupBy 可另指定分组列）。
- 指标卡 shape "kpis"：{"shape":"kpis","from":"d1","where":[...],"cards":[{"label":"SR 总量","value":"sr_total"},{"label":"FRT 达成率","value":{"field":"sr_frt","scale":100,"digits":1},"unit":"%"}]}（多行时 value 写 agg 汇总）。
- 趋势 shape "series"：{"shape":"series","from":"d1","x":"月份列","series":[{"name":"工单量","field":"cnt","agg":"sum"}],"limit":6}，横轴按 x 排序（或 order 指定顺序）。
- 明细表 shape "rows"：{"shape":"rows","from":"d1","where":[...],"columns":{"输出列":"原列名"},"sort":{...},"limit":20}；加 groupBy 时 columns 的值写 {"field","agg"}。
- 一句话 shape "text"：{"shape":"text","from":"d1","where":[...],"parts":["本月工单 ",{"field":"cnt"}," 单"]}。
- view 有多个分区读取不同数据时，query 写成 {"分区 data 名": {...}, ...}。
- 一个分类 / 一张卡 / 一个横轴点对应多行时必须写 agg（计数类用 sum，比率类先用 where 筛到一行，不要把比率相加）；否则平台会报错并说明这些行的区别。
- 比例字段若本身是 0–1 的小数，用 scale:100 变百分比；不要用除法去猜。字段名和取值必须来自工具返回或数据概况里的真实名称。`;
    return {OPS,AGGS,SHAPES,run,computeSource,isQueryCompute,queryFromCompute,GUIDE};
});
