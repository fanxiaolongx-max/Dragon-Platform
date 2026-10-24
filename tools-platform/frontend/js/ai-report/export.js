/* Exports: standalone HTML (styles and logo inlined), browser print / PDF, and Outlook MSG via the existing endpoint. */
(function(){
    'use strict';
    const safeName=value=>String(value||'AI 月报').replace(/[\\/:*?"<>|]+/g,'_').slice(0,120);
    async function dataUrl(url){
        if(!url||url.startsWith('data:'))return url||'';
        const response=await fetch(url);if(!response.ok)return '';
        const blob=await response.blob();
        return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>resolve('');reader.readAsDataURL(blob);});
    }
    // The page's script tags carry content-versioned URLs; fetching those avoids stale browser or CDN copies.
    const versioned=url=>document.querySelector(`script[src^="${url}"]`)?.getAttribute('src')||url;
    const scriptText=url=>fetch(versioned(url),{cache:'no-cache'}).then(response=>{if(!response.ok)throw new Error('Cannot load '+url);return response.text();});
    const inlineScript=text=>`<script>${text.replace(/<\/script/gi,'<\\/script')}<\/script>`;
    // Interactive exports (HTML file) keep live charts and tables by embedding the trusted renderer and ECharts;
    // static exports (mail) freeze widgets into SVG and full tables so nothing depends on scripts.
    async function standalone(doc,{lang,t,interactive=false}){
        const [css,logoSrc]=await Promise.all([fetch('/css/ai-report.css').then(response=>response.text()),dataUrl(doc.template.logo).catch(()=>'')]);
        // Laid out off-screen so slot sizes and chart heights can be measured like on the page.
        const holder=document.createElement('article');holder.className='air-report is-preview';holder.style.cssText=`position:absolute;left:-100000px;top:0;width:${document.getElementById('airReport')?.getBoundingClientRect().width||1280}px`;holder.setAttribute('style',holder.style.cssText+';'+AiReportView.themeStyle(doc.style?.theme));const frame=AiReportView.frameOf(doc.style?.theme);Object.assign(holder.dataset,frame);
        holder.innerHTML=AiReportView.report(doc,{mode:'export',lang,t,month:doc.reportMonth,logoSrc});document.body.append(holder);
        AiReportLayout.apply(holder,cellId=>AiReportModel.findCell(doc,cellId)?.cell?.layout);AiReportLayout.fitRows(holder);
        const widgets={};for(const cell of AiReportModel.cells(doc))if(cell.output?.widgets?.length)widgets[cell.id]=cell.output.widgets;
        const lookup=(cellId,widgetId)=>(widgets[cellId]||[]).find(item=>item.id===widgetId),palette=AiReportWidgets.paletteOf(doc.style?.theme);
        let scripts='';
        if(interactive&&Object.keys(widgets).length){
            const [echarts,kit,renderer]=await Promise.all(['/js/vendor/echarts.min.js','/js/ai-report/render-kit.js','/js/ai-report/widgets.js'].map(scriptText));
            const data=JSON.stringify({widgets,palette}).replace(/</g,'\\u003c');
            scripts=[echarts,kit,renderer].map(inlineScript).join('')+inlineScript(`(function(){var d=${data};AiReportWidgets.hydrate(document.querySelector('.air-report'),function(c,w){return (d.widgets[c]||[]).filter(function(x){return x.id===w;})[0];},{palette:d.palette});})();`);
        }else AiReportWidgets.freeze(holder,lookup,{palette});
        AiReportLayout.drawDividers(holder);
        const markup=holder.innerHTML;holder.remove();
        return `<!doctype html><html lang="${lang==='en'?'en':'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${AiReportView.esc(doc.name)}</title><style>${css}</style></head><body class="air-export"><article class="air-report is-preview" data-frame="${frame.frame}" data-dividers="${frame.dividers}" data-panels="${frame.panels}" style="${AiReportView.esc(AiReportView.themeStyle(doc.style?.theme))}">${markup}</article>${scripts}</body></html>`;
    }
    function download(name,blob){const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;document.body.append(link);link.click();setTimeout(()=>{URL.revokeObjectURL(link.href);link.remove();},1000);}
    async function html(doc,options){download(safeName(doc.name)+'-'+doc.reportMonth+'.html',new Blob([await standalone(doc,{...options,interactive:true})],{type:'text/html;charset=utf-8'}));}
    async function msg(doc,options){
        const body=await standalone(doc,options),text=new DOMParser().parseFromString(body,'text/html').body.innerText.slice(0,200000);
        const response=await fetch('/api/report-msg/export',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({subject:(doc.name+' '+doc.reportMonth).slice(0,200),html:body,text})});
        if(!response.ok){let message='MSG export failed';try{message=(await response.json()).message||message;}catch(_){}throw new Error(message);}
        download(safeName(doc.name)+'-'+doc.reportMonth+'.msg',await response.blob());
    }
    function print(){document.body.classList.add('air-printing');const done=()=>{document.body.classList.remove('air-printing');removeEventListener('afterprint',done);};addEventListener('afterprint',done);window.print();setTimeout(done,1500);}
    window.AiReportExport={standalone,html,msg,print};
})();
