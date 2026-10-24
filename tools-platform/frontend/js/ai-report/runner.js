/* Runs a cell recipe for a report month: server resolves the month's data, the sandbox computes and renders,
   and the AI only writes the summary from the computed result. */
(function(){
    'use strict';
    const RESULT_LIMIT=60000;
    // Large results (long detail rows) are shortened, not dropped, so the summary writer still sees the numbers.
    function compact(value,depth=0){
        if(Array.isArray(value)){const items=value.slice(0,depth?20:40).map(item=>compact(item,depth+1));if(value.length>items.length)items.push(`…共 ${value.length} 项`);return items;}
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,60).map(([key,item])=>[key,compact(item,depth+1)]));
        return typeof value==='string'&&value.length>200?value.slice(0,200)+'…':value;
    }
    const keepResult=result=>{try{const text=JSON.stringify(result??null);if(text.length<=RESULT_LIMIT)return JSON.parse(text);const short=compact(JSON.parse(text));return JSON.stringify(short).length<=RESULT_LIMIT?short:{preview:JSON.stringify(short).slice(0,RESULT_LIMIT/2)};}catch(_){return null;}};

    // The report as it is on screen (saved or not), set by the editor; a recipe's report source reads it.
    let currentReport=()=>null;
    const useReport=getter=>{currentReport=getter;};
    const readsResults=cell=>!!cell?.recipe?.sources?.some(source=>source.kind==='report'&&source.include==='results');
    const readsReport=cell=>!!cell?.recipe?.sources?.some(source=>source.kind==='report');
    // A cell's name for links and overviews: the title it shows (block or chart title), else the gist of its recipe
    // summary or prompt without the instruction words ("请根据…数据", "生成一份…").
    const unescape=text=>String(text).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
    function cellTitle(cell,lang){
        const html=String(cell.output?.html||''),heading=html.match(/class="kit-title">([^<]{1,80})</)||html.match(/data-slot-title="([^"]{1,80})"/);
        if(heading)return unescape(heading[1]).trim();
        const chart=(cell.output?.widgets||[]).map(widget=>{const title=widget.spec?.option?.title;return Array.isArray(title)?title[0]?.text:title?.text;}).find(Boolean);
        if(chart)return String(chart).slice(0,40);
        const named=String(cell.prompt||'').match(/^(请)?(为|生成|做|展示)[^“]{0,12}“([^”]{2,24})”/);if(named)return named[3];
        const clauses=String(AiReportModel.text(cell.recipe?.summary,lang)||cell.prompt||'').split(/[，。,；;：:\n]/).map(clause=>clause.trim()
            .replace(/^(请)?(根据|使用|基于|按照?|用)[^，。]*?(数据|指标|工作表|表)[^，。]*$/,'')
            .replace(/^(请)?(生成|展示|做|画|制作|统计)(一份|一个|一张)?(关于)?/,'')).filter(Boolean);
        return (clauses[0]||'').slice(0,24);
    }
    // Outline: chapter numbers, titles and anchors, each cell's title and anchor. With results, the other cells'
    // summaries and computed results too; a cell never sees itself or cells that read results (no loops).
    function reportInput(self,source={include:'outline',chapters:[]}){
        const {doc,lang='zh'}=currentReport()||{};if(!doc)return null;
        const text=value=>AiReportModel.text(value,lang),results=source.include==='results';
        const numbers=AiReportView.chapterNumbers(doc);
        return {month:doc.reportMonth,title:text(doc.template.title),chapters:doc.chapters.map((chapter,index)=>({chapter,index})).filter(({chapter})=>!source.chapters?.length||source.chapters.includes(chapter.id)).map(({chapter,index})=>({
            id:chapter.id,no:numbers[index],numbered:!!numbers[index],title:text(chapter.title),anchor:'#air-chapter-'+chapter.id,
            cells:chapter.cells.filter(cell=>cell.id!==self?.id&&(cell.recipe||cell.output)).map(cell=>{
                const item={id:cell.id,anchor:'#air-cell-'+cell.id,title:cellTitle(cell,lang)};
                // Every cell carries summary and result (empty when there is none), so recipes never read undefined; a
                // cell without its own summary gets the one-line gist the AI wrote from its result.
                if(results){
                    const own=readsResults(cell)?'':text(cell.output?.narrative)||'',gist=own?'':gists.get(gistKey(cell,lang))||'';
                    item.summary=own||gist;item.summaryFrom=own?'summary':gist?'result':'none';item.result=readsResults(cell)?null:compact(cell.output?.result??null,1);
                    if(cell.output?.error)item.error=cell.output.error.slice(0,200);if(cell.missing?.length)item.missing=cell.missing.map(entry=>entry.label||entry.id);
                }
                return item;
            })
        }))};
    }
    // A compact outline for the AI (chat and compile), so it can link to and talk about the other cells.
    function outline(self){
        const input=reportInput(self,{include:'results',chapters:[]});if(!input)return null;
        return {title:input.title,chapters:input.chapters.map(chapter=>({...chapter,cells:chapter.cells.map(cell=>({id:cell.id,anchor:cell.anchor,title:cell.title,...(cell.summary?{summary:cell.summary.slice(0,160)}:{})}))}))};
    }
    // One-line gists for cells without a summary, written by the AI from their results when an overview needs them;
    // kept per result, so a cell is summarised again only when its numbers change.
    const gists=new Map();
    const gistKey=(cell,lang='zh')=>`${cell.id}|${cell.output?.generatedAt||''}|${cell.output?.month||''}|${lang}`;
    async function fillGists(self){
        const {doc,lang='zh'}=currentReport()||{};if(!doc)return;
        const wanted=AiReportModel.cells(doc).filter(cell=>cell.id!==self.id&&!readsResults(cell)&&cell.output?.result&&!cell.output.error&&!AiReportModel.text(cell.output.narrative,lang)&&!gists.has(gistKey(cell,lang)));
        if(!wanted.length)return;
        const reply=await AiReportTrace.post(self.id,'为总览提炼各格子要点','/api/ai-report/cell/gist',{month:doc.reportMonth,lang,items:wanted.slice(0,40).map(cell=>({id:cell.id,title:cellTitle(cell,lang),prompt:String(cell.prompt||'').slice(0,600),result:compact(cell.output.result,1)}))}).catch(()=>({gists:{}}));
        for(const cell of wanted)if(reply.gists?.[cell.id])gists.set(gistKey(cell,lang),String(reply.gists[cell.id]).slice(0,300));
    }
    async function compute(cell,month){
        if(readsResults(cell))await fillGists(cell);
        const {input,missing}=await API.post('/api/ai-report/run-data',{month,recipe:cell.recipe});
        input.$month=month;
        for(const source of cell.recipe.sources)if(source.kind==='report')input[source.id]=reportInput(cell,source);
        // Overviews quote other cells' conclusions on purpose, so the one-summary check does not apply to them.
        const {result,html,widgets}=await AiReportSandbox.run({compute:cell.recipe.compute,render:cell.recipe.render,input,summary:!!cell.recipe.narrative&&!readsResults(cell)});
        // A recipe without narrative must not keep the summary box of an earlier recipe (two summaries on screen).
        const output=AiReportModel.normalizeOutput({...(cell.output||{}),...(cell.recipe.narrative?{}:{narrative:{zh:'',en:''},narrativeMonth:''}),month,result:keepResult(result),html:AiReportSanitize.clean(html),widgets:AiReportWidgets.cleanSpecs(widgets),error:'',generatedAt:new Date().toISOString()});
        return {output,missing};
    }
    async function narrative(cell,month,style=''){
        if(!cell.recipe?.narrative||!cell.output)return cell.output;
        const text=await AiReportTrace.post(cell.id,'写文字总结','/api/ai-report/cell/narrative',{month,prompt:cell.prompt,recipe:cell.recipe,result:cell.output.result,style});
        return {...cell.output,narrative:{zh:text.zh||'',en:text.en||''},narrativeMonth:month};
    }
    // Numbers always come from the recipe; the summary is rewritten only when asked (it costs an AI call).
    async function run(cell,month,{withNarrative=true,style=''}={}){
        try{
            const {output,missing}=await compute(cell,month);
            cell.output=output;cell.missing=missing;
            if(withNarrative)cell.output=await narrative(cell,month,style);
        }catch(error){
            cell.output=AiReportModel.normalizeOutput({...(cell.output||{}),month,error:error.message||String(error)});
            throw error;
        }
        return cell.output;
    }
    // A title the prompt asks for (标题为“X” / 标题“X”) must show up in the cell, as a heading or a chart title.
    function missingTitle(cell){
        const wanted=[...String(cell.prompt||'').matchAll(/标题(?:为|是|改成|改为|写成)?[“"「]([^”"」]{1,40})[”"」]/g)].map(match=>match[1].trim()).filter(Boolean);
        if(!wanted.length||!cell.output||cell.output.error)return '';
        const shown=unescape(String(cell.output.html||'').replace(/<[^>]*>/g,' '))+' '+unescape(String(cell.output.html||'').match(/data-slot-title="[^"]*"/g)?.join(' ')||'')+' '+JSON.stringify((cell.output.widgets||[]).map(widget=>widget.spec?.option?.title||null));
        const squash=text=>String(text).replace(/\s+/g,'');
        return wanted.find(title=>!squash(shown).includes(squash(title)))||'';
    }
    const needsNarrative=(cell,month)=>!!(cell.recipe?.narrative&&cell.output&&!cell.output.error&&cell.output.narrativeMonth!==month);
    window.AiReportRunner={run,missingTitle,cellTitle,narrative,needsNarrative,useReport,reportInput,outline,readsReport,readsResults};
})();
