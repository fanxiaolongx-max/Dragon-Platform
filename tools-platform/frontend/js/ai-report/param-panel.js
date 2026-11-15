/* Display settings for any cell, shared by the monthly report and AI BI. Every cell has a text size; template cells
   add their template and parameters per slot, and cells the AI wrote itself add the values in their kit.params block.
   A cell without either offers one AI step that pulls such values out of its code. None of the settings need AI. */
(function(){
    'use strict';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const SCALES=[0.8,0.9,1,1.15,1.3,1.5,2,2.5,3];
    const T=()=>window.AiReportTemplates;
    function kind(recipe){
        if(!recipe||!T())return '';
        if(T().viewFromRender(recipe.render))return 'template';
        if(T().freeParams(recipe.render))return 'free';
        return 'code';
    }
    function field(name,def,value,label,{t,lang,busy}){
        const attrs=`${name} ${busy?'disabled':''}`;
        if(def.type==='bool')return `<label class="air-view-check"><input type="checkbox" ${attrs} ${value?'checked':''}> ${esc(label)}</label>`;
        const input=def.type==='select'?`<select ${attrs}>${def.options.map(option=>`<option value="${esc(option[0])}" ${String(option[0])===String(value)?'selected':''}>${esc(lang==='en'?option[2]||option[1]:option[1])}</option>`).join('')}</select>`
            :def.type==='number'?`<input type="number" ${attrs} value="${value===null||value===undefined?'':esc(value)}" ${def.min!==undefined?`min="${def.min}"`:''} ${def.max!==undefined?`max="${def.max}"`:''} step="${def.step||'any'}" placeholder="${esc(t('自动','Auto'))}">`
            :def.type==='color'?`<input type="color" ${attrs} value="${esc(value)}">`
            :`<input type="text" ${attrs} value="${esc(value)}" maxlength="${def.max||200}">`;
        return `<label class="air-view-field"><span>${esc(label)}</span>${input}</label>`;
    }
    // scale: the cell's own size factor (null = automatic); autoScale: what automatic means here (AI BI canvases).
    function html({recipe,scale=null,autoScale=0,t,lang='zh',busy=false,skip=[],extracting=false}){
        const options={t,lang,busy},L=pair=>T().label(pair,lang),type=kind(recipe);
        const sizes=`${autoScale?`<option value="" ${scale===null?'selected':''}>${esc(t(`自动（${autoScale}×）`,`Auto (${autoScale}×)`))}</option>`:''}${SCALES.map(value=>`<option value="${value}" ${(scale??(autoScale?null:1))===value?'selected':''}>${value===1?t('标准','Normal'):value+'×'}</option>`).join('')}`;
        const common=`<div class="air-view-grid air-view-common"><label class="air-view-field"><span>${esc(t('字号与图表大小','Text and chart size'))}</span><select data-pp-scale ${busy?'disabled':''}>${sizes}</select></label></div>`;
        let body='';
        if(type==='template'){
            const view=T().viewFromRender(recipe.render),slots=T().slots(view);
            body=slots.map(slot=>{
                const template=T().get(slot.template),params=T().cleanParams(template,slot.params);
                const choices=T().compatible(slot.template).map(item=>`<option value="${esc(item.id)}" ${item.id===slot.template?'selected':''}>${esc(L(item.name))}</option>`).join('');
                return `<fieldset class="air-view-slot"><legend>${slots.length>1?`<b>${esc(slot.id)}</b> · `:''}<select data-pp-template="${esc(slot.id)}" ${busy?'disabled':''} title="${esc(t('换成同样数据形状的其他模板','Switch to another template with the same data shape'))}">${choices}</select></legend>
                    <div class="air-view-grid">${template.params.filter(def=>!skip.includes(def.key)).map(def=>field(`data-pp-param="${esc(slot.id+'.'+def.key)}"`,def,params[def.key],L(def.label),options)).join('')}</div></fieldset>`;
            }).join('');
        }else if(type==='free'){
            const {defs}=T().freeParams(recipe.render);
            body=`<fieldset class="air-view-slot"><legend>${esc(t('这个格子的设置','This cell'))}</legend><div class="air-view-grid">${Object.entries(defs).map(([key,def])=>field(`data-pp-free="${esc(key)}"`,def,def.value,def.label,options)).join('')}</div></fieldset>`;
        }else if(type==='code'){
            body=`<div class="air-view-extract"><span>${esc(t('这个格子是 AI 自己写的代码，还没有可调的设置。','This cell has no settings yet.'))}</span><button type="button" data-pp-extract ${busy||extracting?'disabled':''}>${extracting?esc(t('正在整理…','Working…')):esc(t('🪄 整理出可调设置','🪄 Make it adjustable'))}</button></div>`;
        }
        return common+body;
    }
    // The new render code and prompt line from the panel's inputs; null when nothing changed.
    function read(root,recipe,prompt){
        const type=kind(recipe);
        if(type==='template'){
            const view=T().viewFromRender(recipe.render);
            for(const slot of T().slots(view)){
                const picker=root.querySelector(`[data-pp-template="${CSS.escape(slot.id)}"]`);
                // Settings both templates have (title, unit…) carry over.
                if(picker&&picker.value!==slot.template){const next=T().get(picker.value);slot.template=next.id;slot.params=T().changedParams(next,slot.params);continue;}
                const template=T().get(slot.template),next={...slot.params};
                for(const def of template.params){
                    const input=root.querySelector(`[data-pp-param="${CSS.escape(slot.id+'.'+def.key)}"]`);if(!input)continue;
                    next[def.key]=def.type==='bool'?input.checked:def.type==='number'?(input.value===''?(def.nullable?null:def.default):Number(input.value)):input.value;
                }
                slot.params=T().changedParams(template,next);
            }
            const render=T().renderSource(view);
            return render===recipe.render?null:{render,prompt:T().withDescription(prompt,view),view};
        }
        if(type==='free'){
            const {defs}=T().freeParams(recipe.render),values={};
            for(const [key,def] of Object.entries(defs)){
                const input=root.querySelector(`[data-pp-free="${CSS.escape(key)}"]`);if(!input)continue;
                values[key]=def.type==='bool'?input.checked:def.type==='number'?(input.value===''?def.value:Number(input.value)):input.value;
            }
            const render=T().setFreeParams(recipe.render,values);
            return render===recipe.render?null:{render,prompt:T().withFreeDescription(prompt,T().freeParams(render).defs)};
        }
        return null;
    }
    const readScale=root=>{const value=root.querySelector('[data-pp-scale]')?.value;return value?Number(value):null;};
    const isInput=node=>!!node?.closest?.('[data-pp-param],[data-pp-template],[data-pp-free]');
    const isScale=node=>!!node?.closest?.('[data-pp-scale]');
    window.AiReportParamPanel={SCALES,kind,html,read,readScale,isInput,isScale};
})();
