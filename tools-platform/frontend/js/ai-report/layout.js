/* Applies user-set sizes to a cell's layout slots (kit.layout). Used by the editor and by exports, so the report
   always looks the way it was adjusted, whatever the recipe wrote. */
(function(){
    'use strict';
    // A slot with a height gives its charts whatever height is left after everything else in it (titles, legends, notes,
    // wrappers the recipe added), measured as laid out, so no blank space is left over; charts side by side share a row.
    function fitCharts(slot,height){
        const charts=[...slot.querySelectorAll('.kit-widget-chart')],shown=charts.filter(chart=>chart.offsetParent);if(!shown.length)return;
        const fixed=[slot.style.height,slot.style.alignSelf];slot.style.height='auto';slot.style.alignSelf='flex-start';
        const top=slot.getBoundingClientRect().top,parts=[...slot.children].filter(child=>!child.matches('.kit-slot-tag,.kit-slot-edge,.kit-slot-badge'));
        const natural=Math.max(0,...parts.map(child=>child.getBoundingClientRect().bottom-top)),rows=new Map();
        for(const chart of shown){const row=Math.round(chart.getBoundingClientRect().top);rows.set(row,Math.max(rows.get(row)||0,chart.offsetHeight));}
        const charted=[...rows.values()].reduce((sum,value)=>sum+value,0);
        [slot.style.height,slot.style.alignSelf]=fixed;
        const each=Math.max(80,Math.floor((height-4-(natural-charted))/rows.size));
        for(const chart of charts)chart.style.height=each+'px';
    }
    function apply(root,layoutOf){
        for(const cell of root.querySelectorAll('[data-cell]')){
            const layout=layoutOf(cell.dataset.cell);if(!layout)continue;
            for(const slot of cell.querySelectorAll('.kit-slot[data-slot]')){
                const size=layout[slot.dataset.slot];if(!size)continue;
                if(size.width)slot.style.flex=`${size.width} 1 0`;
                if(size.height){slot.style.height=size.height+'px';slot.classList.add('has-height');fitCharts(slot,size.height);}
            }
        }
    }
    // Lines between cells (theme "dividers"): drawn in the gaps from where the cells actually are, so they run between
    // neighbours in a row and between rows, never along the report's edge, and nothing inside a cell can clip them.
    function drawDividers(root){
        const style=root.dataset.dividers;
        for(const grid of root.querySelectorAll('.air-grid')){
            grid.querySelectorAll(':scope>.air-divider').forEach(line=>line.remove());
            if(style!=='line'&&style!=='dashed')continue;
            const box=grid.getBoundingClientRect(),cells=[...grid.children].filter(child=>child.matches('.air-cell')).map(cell=>{const rect=cell.getBoundingClientRect();return {left:rect.left-box.left,right:rect.right-box.left,top:rect.top-box.top,bottom:rect.bottom-box.top};});
            const rows=[];
            for(const cell of cells.sort((a,b)=>a.top-b.top||a.left-b.left)){const row=rows.find(item=>Math.abs(item.top-cell.top)<3);if(row){row.cells.push(cell);row.bottom=Math.max(row.bottom,cell.bottom);}else rows.push({top:cell.top,bottom:cell.bottom,cells:[cell]});}
            const line=(kind,css)=>{const node=document.createElement('i');node.className='air-divider air-divider-'+kind;node.setAttribute('aria-hidden','true');node.style.cssText=css;grid.append(node);};
            rows.forEach((row,index)=>{
                const ordered=row.cells.sort((a,b)=>a.left-b.left);
                for(let at=1;at<ordered.length;at++)line('v',`left:${(ordered[at-1].right+ordered[at].left)/2}px;top:${row.top}px;height:${row.bottom-row.top}px`);
                const next=rows[index+1];if(next)line('h',`left:0;right:0;top:${(row.bottom+next.top)/2}px`);
            });
        }
    }
    // Blocks side by side that do not fit their row (a table wider than its share, text squeezed into a sliver): first
    // tighten fonts and spacing, then let the row wrap so the block that does not fit moves below. What had to be fixed is
    // left on the cell (data-layout-issue) so a fresh generation can be asked to lay it out properly.
    const TEXT_MIN=200;
    function needs(slot){
        const text=slot.querySelector('.kit-text,.kit-list,p'),table=slot.querySelector('table');
        const wide=Math.max(slot.scrollWidth,...[...slot.querySelectorAll('table,.kit-kpis,.kit-nav')].map(node=>node.scrollWidth));
        return Math.max(wide,text&&!table&&!slot.querySelector('.kit-widget-chart')?TEXT_MIN:0);
    }
    function crowded(row){return [...row.children].filter(slot=>slot.matches('.kit-slot')).map(slot=>({slot,need:needs(slot),have:slot.clientWidth})).filter(item=>item.need>item.have+2);}
    function fitRows(root){
        for(const cell of root.querySelectorAll('[data-cell]')){
            const issues=[];
            for(const row of cell.querySelectorAll('.kit-row')){
                if(row.children.length<2||!row.offsetParent)continue;
                let tight=crowded(row);if(!tight.length)continue;
                issues.push(...tight.map(item=>`${item.slot.dataset.slot||'内容块'} 需要约 ${Math.round(item.need)}px，只分到 ${Math.round(item.have)}px`));
                row.classList.add('is-compact');tight=crowded(row);if(!tight.length)continue;
                const width=row.clientWidth;row.classList.add('is-wrapped');
                for(const slot of row.children)if(slot.matches('.kit-slot'))slot.style.minWidth=Math.min(width,needs(slot))+'px';
            }
            if(issues.length)cell.dataset.layoutIssue=`格子宽约 ${Math.round(cell.getBoundingClientRect().width)}px，同一行并排的内容放不下：${issues.join('；')}`;else delete cell.dataset.layoutIssue;
        }
    }
    const slotsIn=html=>[...String(html||'').matchAll(/data-slot="([^"]+)"/g)].map(match=>match[1]);
    window.AiReportLayout={apply,slotsIn,fitCharts,fitRows,drawDividers};
})();
