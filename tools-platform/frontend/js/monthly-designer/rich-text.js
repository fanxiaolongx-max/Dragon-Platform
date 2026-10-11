(function(){
 'use strict';
 const color=value=>/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():null;
 function cssColor(value){const match=String(value).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);return color(value)|| (match?'#'+match.slice(1).map(v=>Number(v).toString(16).padStart(2,'0')).join(''):null);}
 function read(element){
  const runs=[];
  function add(text,style){if(!text)return;const last=runs.at(-1);if(last&&JSON.stringify(last.style)===JSON.stringify(style))last.text+=text;else runs.push({text,style:{...style}});}
  function walk(node,inherited={},ignoreBreak=false){
   if(node.nodeType===3){if(node.previousSibling?.nodeType===1&&/^(DIV|P|LI|UL|OL|BLOCKQUOTE)$/.test(node.previousSibling.tagName)&&!node.textContent.startsWith('\n'))add('\n',inherited);add(node.textContent,inherited);return;}
   const style={...inherited};if(node.nodeType!==1)return;
   if(['B','STRONG'].includes(node.tagName))style.bold=true;if(node.tagName==='U')style.underline=true;
   const css=node.style;if(css.fontWeight)style.bold=css.fontWeight==='bold'||Number(css.fontWeight)>=600;if(css.textDecoration)style.underline=css.textDecoration.includes('underline');
   const size=Number.parseFloat(css.fontSize);if(size>=8&&size<=72)style.fontSize=Math.round(size);
   const foreground=cssColor(css.color||node.getAttribute('color')),background=cssColor(css.backgroundColor);if(foreground)style.color=foreground;if(background)style.background=background;else if(css.backgroundColor==='transparent'||css.backgroundColor==='rgba(0, 0, 0, 0)')delete style.background;
   if(node.dataset.metricToken){add(node.dataset.metricToken,style);return;}
   if(node.tagName==='BR'){if(!ignoreBreak)add('\n',style);return;}
   const block=/^(DIV|P|LI|UL|OL|BLOCKQUOTE|H[1-6])$/.test(node.tagName)||node.style.display==='block';
   if(block&&node.previousSibling)add('\n',style);
   const placeholder=block&&!node.textContent&&!node.querySelector('[data-metric-token]')&&node.querySelectorAll('br').length===1;
   Array.from(node.childNodes).forEach(child=>walk(child,style,ignoreBreak||placeholder));
  }
  Array.from(element.childNodes).forEach(node=>walk(node));return runs;
 }
 function start(api){
  let toolbar=null,field=null,range=null,brush=null;
  const t=api.t,palette=['#203044','#173c60','#2563eb','#15803d','#b91c1c','#7e22ce','#64748b','#ffffff'],backgrounds=['#ffffff','#dbeafe','#fef3c7','#dcfce7','#fee2e2','#f3e8ff'];
  const alignmentOptions=[['left','左对齐','Align left'],['center','居中','Center'],['right','右对齐','Align right'],['justify','两端对齐','Justify']];
  const hide=()=>{if(toolbar)toolbar.hidden=true;};
  function logicalLength(fragment){return read(fragment).reduce((length,run)=>length+run.text.length,0);}
  function atomicRange(next){
   for(const chip of field.querySelectorAll('[data-metric-token]')){
    if(chip.contains(next.startContainer))next.setStartBefore(chip);
    if(chip.contains(next.endContainer))next.setEndAfter(chip);
   }
   return next;
  }
  function restoreRange(start,end){
   const next=document.createRange();let offset=0,startSet=false,endSet=false;
   function walk(node){
    const token=node.dataset?.metricToken;
    if(node.nodeType===3||token){
     const length=token?token.length:node.textContent.length;
     if(!startSet&&start>=offset&&start<=offset+length){if(token)start===offset+length?next.setStartAfter(node):next.setStartBefore(node);else next.setStart(node,start-offset);startSet=true;}
     if(!endSet&&end>=offset&&end<=offset+length){if(token)end===offset?next.setEndBefore(node):next.setEndAfter(node);else next.setEnd(node,end-offset);endSet=true;}
     offset+=length;
    }else Array.from(node.childNodes).forEach(walk);
   }
   Array.from(field.childNodes).forEach(walk);if(!startSet)next.setStart(field,field.childNodes.length);if(!endSet)next.setEnd(field,field.childNodes.length);
   range=next;getSelection().removeAllRanges();getSelection().addRange(range);
  }
  function apply(style,command){
   if(!range||!field?.isConnected)return;
   range=atomicRange(range);field.focus();getSelection().removeAllRanges();getSelection().addRange(range);
   if(style?.textAlign){field.style.textAlign=style.textAlign;field.querySelectorAll('[style]').forEach(element=>element.style.removeProperty('text-align'));style={...style};delete style.textAlign;}
   if(command==='removeFormat'){field.style.removeProperty('text-align');field.querySelectorAll('[style]').forEach(element=>element.style.removeProperty('text-align'));}
   if(command==='bold'||command==='underline'){
    const active=selectionStyles().every(item=>item[command]);style=command==='bold'?{fontWeight:active?'400':'700'}:{textDecoration:active?'none':'underline'};command=null;
   }
   // Apply formatting to serialized runs: each reference stays atomic and background removal
   // also removes inherited highlighting without turning the reference into literal text.
   if(api.renderText&&field.getAttribute('aria-readonly')!=='true'&&(command||Object.keys(style||{}).length)){
    const prefix=range.cloneRange();prefix.selectNodeContents(field);prefix.setEnd(range.startContainer,range.startOffset);
    const start=logicalLength(prefix.cloneContents()),end=start+logicalLength(range.cloneContents()),runs=read(field),formatted=[];let offset=0;
    const update=original=>{
     const next=command==='removeFormat'?{}:{...original};
     for(const [key,value] of Object.entries(style||{})){
      if(key==='backgroundColor'){if(value==='transparent')delete next.background;else next.background=cssColor(value);}
      if(key==='color')next.color=cssColor(value);
      if(key==='fontSize')next.fontSize=parseInt(value,10);
      if(key==='fontWeight')next.bold=Number(value)>=600;
      if(key==='textDecoration')next.underline=value.includes('underline');
     }
     return next;
    };
    for(const run of runs){
     const boundaries=[0,Math.max(0,Math.min(run.text.length,start-offset)),Math.max(0,Math.min(run.text.length,end-offset)),run.text.length].sort((a,b)=>a-b);
     for(let i=1;i<boundaries.length;i++){const a=boundaries[i-1],b=boundaries[i];if(b>a)formatted.push({text:run.text.slice(a,b),style:offset+a>=start&&offset+b<=end?update(run.style):run.style});}
     offset+=run.text.length;
    }
    field.innerHTML=api.renderText(formatted.map(run=>run.text).join(''),formatted);restoreRange(start,end);
   }else if(command)document.execCommand(command,false,null);
   else if(Object.keys(style||{}).length){
    const span=document.createElement('span'),fragment=range.extractContents();
    fragment.querySelectorAll('*').forEach(element=>{
     for(const property of Object.keys(style))element.style[property]=['fontWeight','textDecoration'].includes(property)?style[property]:'';
     if(style.fontSize)element.removeAttribute('size');if(style.color)element.removeAttribute('color');
    });
    Object.assign(span.style,style);span.append(fragment);range.insertNode(span);range.selectNodeContents(span);getSelection().removeAllRanges();getSelection().addRange(range);
   }
   api.commitText(field);range=getSelection().getRangeAt(0).cloneRange();syncToolbar();
  }
  function selectionStyles(){
   if(!range||!field)return [];
   const walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT),styles=[];let node;
   while(node=walker.nextNode()){
    if(!range.intersectsNode(node))continue;
    const start=node===range.startContainer?range.startOffset:0,end=node===range.endContainer?range.endOffset:node.length;
    if(!node.textContent.slice(start,end).length)continue;
    const element=node.parentElement,css=getComputedStyle(element);let background='',underline=false;
    for(let ancestor=element;ancestor&&api.root.contains(ancestor);ancestor=ancestor.parentElement){
     const computed=getComputedStyle(ancestor);
     if(!background&&computed.backgroundColor!=='rgba(0, 0, 0, 0)'&&computed.backgroundColor!=='transparent')background=cssColor(computed.backgroundColor)||'';
     if(computed.textDecorationLine.includes('underline'))underline=true;
     if(ancestor===field)break;
    }
    styles.push({size:parseFloat(css.fontSize),color:cssColor(css.color),background,bold:Number(css.fontWeight)>=600,underline});
   }
   return styles;
  }
  function syncToolbar(){
   if(!toolbar)return;
   const formula=toolbar.querySelector('[data-create-formula]');if(formula)formula.hidden=!api.formula?.formulaSelection(field,range);
   const adjacent=toolbar.querySelector('[data-adjacent-formula]');if(adjacent)adjacent.hidden=!formula.hidden||!api.formula?.adjacentFormulaSelection(field,range);
   const styles=selectionStyles();if(!styles.length)return;
   const uniform=key=>styles.every(style=>style[key]===styles[0][key])?styles[0][key]:null;
   const alignment=getComputedStyle(field).textAlign.replace('start','left').replace('end','right');
   toolbar.querySelectorAll('[data-align]').forEach(button=>{const selected=button.dataset.align===alignment;const option=alignmentOptions.find(item=>item[0]===button.dataset.align);button.title=t(option[1],option[2]);button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(selected));button.classList.toggle('format-selected',selected);});
   const size=toolbar.querySelector('[data-size]'),actualSize=uniform('size');
   size.querySelectorAll('[data-selection-size]').forEach(option=>option.remove());
   const value=actualSize===null?'':String(actualSize);
   if(!Array.from(size.options).some(option=>option.value===value)){
    const option=document.createElement('option');option.value=value;option.textContent=actualSize===null?t('混合字号','Mixed sizes'):actualSize+'px';option.dataset.selectionSize='';size.prepend(option);
   }
   size.value=value;
   for(const key of ['bold','underline']){
    const button=toolbar.querySelector(`[data-format=${key}]`),state=uniform(key);
    button.setAttribute('aria-pressed',state===null?'mixed':String(state));button.classList.toggle('format-selected',state===true);button.classList.toggle('format-mixed',state===null);
   }
   for(const key of ['color','background']){
    const state=uniform(key),indicator=toolbar.querySelector(`[data-current-${key}]`);
    indicator.style.background=state||'transparent';indicator.textContent=state===null?t('混合','Mixed'):!state?t('无','None'):'';
    indicator.title=state===null?t('选区包含多种颜色','Selection has mixed colors'):state||t('无背景色','No background');
    toolbar.querySelectorAll(`[data-${key}]`).forEach(button=>{const selected=state!==null&&(state===button.dataset[key]||key==='background'&&!state&&button.dataset[key]==='transparent');button.setAttribute('aria-pressed',String(selected));button.classList.toggle('format-selected',selected);});
   }
  }
  function cancelBrush(){
   brush=null;api.root.classList.remove('format-brush-active');
   const button=toolbar?.querySelector('[data-format=brush]');if(button){button.setAttribute('aria-pressed','false');button.textContent=t('格式刷','Format painter');}
  }
  function captureBrush(){
   if(!range||range.collapsed||!field?.isConnected)return;
   let node=range.startContainer;
   if(node.nodeType===1)node=node.childNodes[range.startOffset]||node;
   while(node.firstChild)node=node.firstChild;
   const element=node.nodeType===1?node:node.parentElement,css=getComputedStyle(element);
   let background=null,underline=false;
   for(let ancestor=element;ancestor&&api.root.contains(ancestor);ancestor=ancestor.parentElement){
    const computed=getComputedStyle(ancestor);
    if(!background&&computed.backgroundColor!=='rgba(0, 0, 0, 0)'&&computed.backgroundColor!=='transparent')background=cssColor(computed.backgroundColor);
    if(computed.textDecorationLine.includes('underline'))underline=true;
    if(ancestor===field)break;
   }
   brush={textAlign:getComputedStyle(field).textAlign.replace('start','left').replace('end','right'),fontSize:css.fontSize,color:css.color,backgroundColor:background||'transparent',fontWeight:Number(css.fontWeight)>=600?'700':'400',textDecoration:underline?'underline':'none'};
   api.root.classList.add('format-brush-active');
   const button=toolbar.querySelector('[data-format=brush]');button.setAttribute('aria-pressed','true');button.textContent=t('请选择目标文字…','Select target text…');
  }
  function paintSelection(){
   if(!brush)return;
   const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;
   const target=selection.getRangeAt(0),node=target.commonAncestorContainer.nodeType===1?target.commonAncestorContainer:target.commonAncestorContainer.parentElement;
   const editable=node.closest('.document-edit[contenteditable=true]');
   if(!editable||!api.root.contains(editable)||!editable.contains(target.startContainer)||!editable.contains(target.endContainer))return;
   field=editable;range=target.cloneRange();const style=brush;cancelBrush();apply(style);hide();
  }
  api.root.addEventListener('pointerup',paintSelection);
  api.root.addEventListener('keyup',event=>{if(event.key==='Shift'||event.key.startsWith('Arrow'))paintSelection();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')cancelBrush();});
  document.addEventListener('selectionchange',()=>{
   if(toolbar?.contains(document.activeElement))return;
   const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed){hide();return;}
   const next=selection.getRangeAt(0),node=next.commonAncestorContainer.nodeType===1?next.commonAncestorContainer:next.commonAncestorContainer.parentElement;
   const editable=node.closest('.document-edit[contenteditable=true]');if(!editable||!api.root.contains(editable)||!editable.contains(next.startContainer)||!editable.contains(next.endContainer)){hide();return;}
   field=editable;range=next.cloneRange();
   if(toolbar&&toolbar.dataset.locale!==t('文字','Text')){toolbar.remove();toolbar=null;}
   if(!toolbar){
    toolbar=document.createElement('div');toolbar.className='rich-text-toolbar';toolbar.dataset.locale=t('文字','Text');toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label',t('文字格式','Text formatting'));
    toolbar.innerHTML=`<button type="button" data-format="bold" title="${t('粗体','Bold')}"><b>B</b></button><button type="button" data-format="underline" title="${t('下划线','Underline')}"><u>U</u></button><select data-size aria-label="${t('字号','Font size')}">${[8,10,12,14,16,18,20,24,28,32].map(size=>`<option value="${size}" ${size===16?'selected':''}>${size}px</option>`).join('')}</select>${alignmentOptions.map(([value,zh,en])=>`<button type="button" data-align="${value}" title="${t(zh,en)}" aria-label="${t(zh,en)}"><span class="format-align-icon" style="align-items:${{left:'flex-start',center:'center',right:'flex-end',justify:'stretch'}[value]}"><i></i><i></i><i></i></span></button>`).join('')}<span>${t('文字','Text')}</span><span class="format-current-color" data-current-color></span>${palette.map(value=>`<button type="button" class="format-swatch" data-color="${value}" style="background:${value}" title="${value}" aria-label="${t('文字颜色','Text color')} ${value}"></button>`).join('')}<span>${t('背景','Background')}</span><span class="format-current-color" data-current-background></span><button type="button" class="format-no-background" data-background="transparent" title="${t('去掉背景色','Remove background')}" aria-label="${t('去掉背景色','Remove background')}">${t('无','None')}</button>${backgrounds.map(value=>`<button type="button" class="format-swatch" data-background="${value}" style="background:${value}" title="${value}" aria-label="${t('背景色','Background')} ${value}"></button>`).join('')}<button type="button" data-format="brush" aria-pressed="false" title="${t('复制格式后选择目标文字，Esc 取消','Copy formatting, then select target text; Esc cancels')}">${t('格式刷','Format painter')}</button><button type="button" data-adjacent-formula hidden>${t('与相邻指标计算','Calculate with adjacent metric')}</button><button type="button" data-create-formula hidden>${t('已选中2项 · 公式计算','2 metrics selected · Calculate')}</button><button type="button" data-format="clear">${t('清除格式','Clear format')}</button>`;
    document.body.append(toolbar);
    toolbar.onpointerdown=event=>{if(!event.target.closest('select'))event.preventDefault();};
    toolbar.onclick=event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-adjacent-formula')){const pair=api.formula?.adjacentFormulaSelection(field,range);if(pair)api.formula.openFormula(field,pair.range);hide();return;}if(button.hasAttribute('data-create-formula')){api.formula?.openFormula(field,range.cloneRange());hide();return;}if(button.dataset.format==='brush'){if(brush)cancelBrush();else captureBrush();return;}if(button.dataset.align)apply({textAlign:button.dataset.align});else if(button.dataset.color)apply({color:button.dataset.color});else if(button.dataset.background)apply({backgroundColor:button.dataset.background});else if(button.dataset.format==='clear')apply(null,'removeFormat');else if(button.dataset.format)apply(null,button.dataset.format);};
    toolbar.querySelector('[data-size]').onchange=event=>{if(event.target.value)apply({fontSize:event.target.value+'px'});};
   }
   syncToolbar();toolbar.hidden=false;const rect=next.getBoundingClientRect();toolbar.style.left=Math.max(8,Math.min(rect.left,innerWidth-toolbar.offsetWidth-8))+'px';toolbar.style.top=Math.max(8,rect.top-toolbar.offsetHeight-8)+'px';
  });
  document.addEventListener('pointerdown',event=>{if(toolbar&&!toolbar.contains(event.target)&&!field?.contains(event.target))hide();});
  let scrollFrame=null;
  window.addEventListener('scroll',()=>{
   hide();if(scrollFrame!==null)return;
   scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;const selection=getSelection();if(!toolbar||!field?.isConnected||document.activeElement!==field||!selection?.rangeCount||selection.isCollapsed)return;const selected=selection.getRangeAt(0);if(!field.contains(selected.startContainer)||!field.contains(selected.endContainer))return;const rect=selected.getBoundingClientRect();if(rect.bottom<0||rect.top>innerHeight||rect.right<0||rect.left>innerWidth)return;range=selected.cloneRange();syncToolbar();toolbar.hidden=false;toolbar.style.left=Math.max(8,Math.min(rect.left,innerWidth-toolbar.offsetWidth-8))+'px';toolbar.style.top=Math.max(8,rect.top-toolbar.offsetHeight-8)+'px';});
  },true);
 }
 window.MonthlyRichText={read,start};
})();
