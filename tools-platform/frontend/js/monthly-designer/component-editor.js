/* Progressive component settings. Draft controls never mutate the report before Apply. */
(function(){
    'use strict';
    function mount({dialog,form,metrics,t,escape:esc,metricLabel,language,versionLabel,resolveMetric,describeMetric,summaryText,onPick}) {
        const f=form.elements,field=name=>f[name]?.closest('label'),summaryField=language==='en'?'ruleEn':'ruleZh',otherSummaryField=summaryField==='ruleZh'?'ruleEn':'ruleZh';
        form.classList.add('component-editor-form');
        function details(label,className){const el=document.createElement('details');el.className=className;el.innerHTML=`<summary>${esc(label)}</summary><div class="component-editor-fields"></div>`;form.insertBefore(el,form.querySelector('footer'));return el;}
        const advanced=details(t('高级设置','Advanced settings'),'component-editor-advanced');
        for(const name of ['type','columns','limit','pinTargetPeriod','pinImportDate',otherSummaryField])if(field(name))advanced.lastElementChild.append(field(name));
        const sourceNote=form.querySelector('[data-editor-note=source]');advanced.lastElementChild.append(sourceNote);
        const filters=details(t('筛选数据（可选）','Filter data (optional)'),'component-editor-filters');
        filters.lastElementChild.append(form.querySelector('.editor-filters'),form.querySelector('[data-add-filter]'));
        form.querySelector('[data-editor-note=filters]').hidden=true;
        filters.open=!!filters.querySelector('.editor-filters').children.length;
        const picker=document.createElement('section');picker.className='component-metric-picker';
        picker.innerHTML=`<label>${t('搜索并选择指标','Find a metric')}<input type="search" data-editor-metric-search placeholder="${t('搜索指标名称，包含主指标和子指标','Search main and child metrics')}" autocomplete="off"></label><details class="component-metric-filters"><summary>${t('筛选指标（可选）','Filter metrics (optional)')}</summary><div></div></details><div class="component-metric-results" role="group" aria-label="${t('匹配指标','Matching metrics')}"></div><button type="button" data-editor-more hidden>${t('显示更多指标','Show more metrics')}</button>`;
        for(const name of ['metricOrigin','metricLevel','metricCategory'])picker.querySelector('.component-metric-filters>div').append(field(name));
        form.insertBefore(picker,field('kind'));
        const preview=document.createElement('section');preview.className='component-result-preview';preview.setAttribute('aria-live','polite');form.insertBefore(preview,picker.nextSibling);
        const hint=document.createElement('p');hint.className='component-editor-hint';form.insertBefore(hint,form.querySelector('footer'));
        const templates=document.createElement('div');templates.className='component-summary-templates';
        templates.innerHTML=`<small>${t('快捷模板','Quick templates')}</small>${[[t('指标与数值','Name and value'),t('{label}：{value}。','{label}: {value}.')],[t('包含目标','Include target'),t('{label}：{value}，目标 {target}。','{label}: {value}, target {target}.')],[t('记录数量','Record count'),t('共 {count} 条记录。','{count} records.')]].map(([label,value])=>`<button type="button" data-editor-template="${esc(value)}">${esc(label)}</button>`).join('')}`;
        field(summaryField).before(templates);
        const search=picker.querySelector('[data-editor-metric-search]'),results=picker.querySelector('.component-metric-results'),more=picker.querySelector('[data-editor-more]');let limit=12,composing=false,lastTable=null;
        const origin=metric=>metric.key.startsWith('assessment:')?'assessment':'extraction';
        function filtered(){const q=search.value.trim().toLocaleLowerCase();return metrics.filter(metric=>(!f.metricOrigin.value||origin(metric)===f.metricOrigin.value)&&(!f.metricLevel.value||(metric.metricLevel||'main')===f.metricLevel.value)&&(!f.metricCategory.value||metric.category===f.metricCategory.value)&&(!q||[metricLabel(metric.label),metric.label,metric.category].join(' ').toLocaleLowerCase().includes(q)));}
        function draw(){
            const items=filtered();results.innerHTML=items.slice(0,limit).map(metric=>`<button type="button" data-editor-metric="${esc(metric.key)}" aria-pressed="${f.metricKey.value===metric.key}"><strong>${esc(metricLabel(metric.label))}</strong><small>${t(origin(metric)==='assessment'?'考核指标':'导入指标',origin(metric)==='assessment'?'Assessment':'Imported')} · ${t(metric.metricLevel==='sub'?'子指标':'主指标',metric.metricLevel==='sub'?'Child':'Main')}${metric.category?' · '+esc(metricLabel(metric.category)):''}</small></button>`).join('')||`<p>${t('没有匹配指标，可清空搜索或调整筛选。','No matches. Clear the search or adjust filters.')}</p>`;
            more.hidden=items.length<=limit;
        }
        search.addEventListener('compositionstart',()=>composing=true);
        search.addEventListener('compositionend',()=>{composing=false;limit=12;draw();});
        search.addEventListener('input',event=>{if(composing||event.isComposing)return;limit=12;draw();});
        search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(!composing&&!event.isComposing){limit=12;draw();results.querySelector('button')?.focus();}}});
        more.onclick=()=>{limit+=12;draw();};
        results.onclick=event=>{const button=event.target.closest('[data-editor-metric]');if(button)onPick(metrics.find(metric=>metric.key===button.dataset.editorMetric));};
        templates.onclick=event=>{const button=event.target.closest('[data-editor-template]');if(button){f[summaryField].value=button.dataset.editorTemplate;f[summaryField].dispatchEvent(new Event('input',{bubbles:true}));}};
        form.addEventListener('input',event=>{if(event.target===f.ruleZh||event.target===f.ruleEn)sync();});
        function sync(){
            const type=f.type.value,metric=type!=='text'&&f.kind.value==='metric';
            picker.hidden=!metric;field('metricKey').hidden=true;if(metric)f.mode.options[0].textContent=versionLabel();
            // A metric card has a single source kind. There is no decision to expose here.
            if(type==='metric')field('kind').hidden=true;
            filters.hidden=!['table','chart','summary'].includes(type)||(type==='chart'&&metric);
            templates.hidden=type!=='summary';
            form.querySelector('[data-editor-note=filters]').hidden=true;if(type==='summary')field(summaryField).firstChild.textContent=t('总结文字模板','Summary text template');
            hint.textContent=type==='metric'?t('直接引用已保存的指标值；按月报月份匹配数据，应用前请核对预览。','Uses a saved metric value. Check the report-month preview before applying.'):type==='table'?t('选择表格与工作表，勾选要展示的列；筛选和行数可按需设置。','Choose a table and sheet, then select display columns. Filters and row limits are optional.'):type==='chart'?t('选择分组与数值列，再选择统计方式；指标图表使用保存的历史值。','Choose group/value columns and aggregation. Metric charts use saved historical values.'):type==='summary'?t('选择数据来源，再选择模板；点击快捷模板可快速填写。','Choose a source and a text template, or use a quick template.'):t('直接在月报中编辑文字，输入 @ 可引用指标。','Edit text in the report; type @ to insert a metric.');
            preview.hidden=type==='text';
            if(metric&&type!=='table'){
                const resolved=resolveMetric(),chosen=metrics.find(item=>item.key===f.metricKey.value);
                let body;
                if(!chosen)body=`<p>${t('先选择一个指标','Choose a metric first')}</p>`;
                else if(!resolved?.metric)body=`<strong>${esc(metricLabel(chosen.label))}</strong><p class="component-preview-warning">${t('对应月份或版本没有该指标；不会使用其他月份代替。','No metric in the matching month/version; other months will not be substituted.')}</p>`;
                else body=`<strong>${esc(metricLabel(resolved.metric.label))}</strong><div class="component-preview-value">${esc(resolved.metric.value)}</div><small>${esc(describeMetric(resolved))}</small>${type==='summary'?`<p>${esc(summaryText(resolved,lastTable?.rows||[]))}</p>`:''}`;
                preview.innerHTML=`<small>${t('结果预览','Result preview')}</small>${body}`;
            }else if(lastTable)tablePreview(lastTable.data,lastTable.rows,lastTable.resolved);else preview.innerHTML=`<small>${t('结果预览','Result preview')}</small><p>${t('选择来源后显示表格信息','Choose a source to preview its data')}</p>`;
            for(const row of form.querySelectorAll('.editor-row'))row.hidden=Array.from(row.children).every(child=>child.hidden);
            advanced.hidden=!Array.from(advanced.lastElementChild.children).some(child=>!child.hidden);
            if(!composing)draw();
        }
        function tablePreview(data,rows,resolved){lastTable={data,rows,resolved};const columns=f.columns.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean),headers=columns.length?columns.filter(column=>data.headers.includes(column)):data.headers;if(f.type.value==='summary'&&f.kind.value==='metric'){sync();return;}if(f.type.value==='text'||f.kind.value==='metric'&&f.type.value!=='table')return;
            preview.innerHTML=`<small>${t('结果预览','Result preview')}</small><strong>${rows.length} ${t('行','rows')} · ${headers.length} ${t('列','columns')}</strong>${f.type.value==='summary'?`<p>${esc(summaryText(resolved,rows))}</p>`:rows.length?`<div class="component-preview-table"><table><thead><tr>${headers.slice(0,3).map(header=>`<th>${esc(metricLabel(header))}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,3).map(row=>`<tr>${headers.slice(0,3).map(header=>`<td>${esc(typeof row[header]==='object'?JSON.stringify(row[header]):row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><small>${t('预览前 3 行、前 3 列','First 3 rows and columns')}</small>`:`<p>${t('当前筛选没有匹配记录','No records match these filters')}</p>`}<small>${esc(data.note||'')}</small>`;
        }
        return {sync,tablePreview,loading(){lastTable=null;if(f.kind.value!=='metric')preview.innerHTML=`<small>${t('结果预览','Result preview')}</small><p>${t('正在读取预览…','Loading preview…')}</p>`;},error(message){preview.innerHTML=`<small>${t('结果预览','Result preview')}</small><p class="component-preview-warning">${esc(message)}</p>`;}};
    }
    window.MonthlyComponentEditor={mount};
})();
