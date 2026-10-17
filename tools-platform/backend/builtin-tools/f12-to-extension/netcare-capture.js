/* Re-locate live evidence on every attempt. Reconstructed native XML is explicitly labelled. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createNetcareCapture=factory;})(typeof globalThis!=='undefined'?globalThis:this,function createNetcareCapture(){
  const title=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/^\s*\d+(?:\.\d+)*(?:[.、):\s]+)?/,'').replace(/[\s\p{P}\p{S}]+/gu,'');
  const href=el=>(el.getAttribute('data-hd-href')||el.getAttribute('href')||'').toLowerCase();
  const fail=(code,message)=>Object.assign(Error(message),{code});
  function article(doc,topic){
    const expected=title(topic.title),matches=[...doc.querySelectorAll('article')].filter(el=>{
      const heading=el.querySelector('h1,h2,h3,h4,h5,h6');if(!heading)return false;
      const text=heading.textContent.trim(),number=text.match(/^\s*(\d+(?:\.\d+)*)(?=\s|[.、):]|[A-Za-z\u3400-\u9fff])/i)?.[1];
      return title(text)===expected&&(!number||number===topic.number);
    });
    if(matches.length>1)throw fail('AMBIGUOUS_REGION','原始章节区域不唯一，已拒绝截图 / Ambiguous original section; capture refused');return matches[0]||null;
  }
  function locate(doc,shot){
    const section=article(doc,shot.topic);if(shot.kind==='text')return section;
    if(!section)return null;
    const matches=[...section.querySelectorAll('a')].filter(a=>href(a)===shot.file.href.toLowerCase());
    if(matches.length>1)throw fail('AMBIGUOUS_ATTACHMENT','附件位置不唯一，已拒绝截图 / Ambiguous attachment location; capture refused');
    const anchor=matches[0];return anchor?.closest('tr')||anchor?.closest('p')||anchor||null;
  }
  // Same attachment row => same region: tag plus the (section-unique) attachment links it holds.
  function keyOf(region){
    if(!region)return '';const tag=String(region.tagName||'').toUpperCase(),hrefs=[...new Set([...(tag==='A'?[region]:[]),...(region.querySelectorAll?.('a')||[])].map(href).filter(Boolean))].sort();
    return hrefs.length?tag+'|'+hrefs.join('|'):'';
  }
  function regionKey(doc,shot){
    if(shot.kind!=='attachments')return '';
    try{const live=locate(doc,shot);if(live)return keyOf(live);}catch{return '';}
    try{
      const source=shot.topic.xml&&new DOMParser().parseFromString(shot.topic.xml,'text/html').querySelector('article'),matches=source?[...source.querySelectorAll('a')].filter(a=>href(a)===shot.file.href.toLowerCase()):[];
      if(matches.length!==1)return '';const anchor=matches[0];return keyOf(anchor.closest('tr')||anchor.closest('p')||anchor);
    }catch{return '';}
  }
  function directoryNodes(doc){
    // OwsLiteView uses treepanel; older editors use NavigationTree.
    const nodes=[...doc.querySelectorAll('#treepanel [data-title="title"],#NavigationTree span,#NavigationTree p,#NavigationTree div,a,[role=treeitem]')].filter(el=>!el.closest('article')&&el.getBoundingClientRect().width>0);
    return nodes.filter(el=>!nodes.some(child=>child!==el&&el.contains?.(child)&&title(child.textContent)===title(el.textContent)));
  }
  const numberOf=el=>String(el.textContent||'').trim().match(/^(\d+(?:\.\d+)*)(?=\s|[.、):]|[A-Za-z\u3400-\u9fff])/)?.[1]||'';
  function directoryTarget(nodes,topic){
    const numbered=nodes.filter(el=>numberOf(el)===topic.number&&title(el.textContent)===title(topic.title));
    const matches=numbered.length?numbered:nodes.filter(el=>!numberOf(el)&&title(el.textContent)===title(topic.title));
    return matches.length===1?matches[0]:null;
  }
  function navigate(doc,topic){
    const node=directoryTarget(directoryNodes(doc),topic);if(!node)return false;node.click();return true;
  }
  const compareSection=(a,b)=>{const pa=String(a||'').split('.').map(Number),pb=String(b||'').split('.').map(Number),len=Math.max(pa.length,pb.length);for(let i=0;i<len;i++){const va=Number.isFinite(pa[i])?pa[i]:0,vb=Number.isFinite(pb[i])?pb[i]:0;if(va!==vb)return va-vb;}return 0;};
  function scrollTarget(doc){
    try{
      const pipScroller=globalThis.createNetcarePip?.()?.scrollTarget?.(doc);
      if(pipScroller&&pipScroller.scrollHeight>pipScroller.clientHeight+10)return pipScroller;
      const candidates=[doc.scrollingElement,doc.documentElement,doc.body,...(doc.querySelectorAll?.('div,main,section')||[])].filter(el=>el&&el.clientHeight>80&&el.scrollHeight>el.clientHeight+10);
      candidates.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));
      return candidates[0]||null;
    }catch{return null;}
  }
  function stepScrollToward(doc,topic){
    try{
      const scroller=scrollTarget(doc);if(!scroller)return false;
      const nums=[...doc.querySelectorAll('article')].map(el=>el.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim()?.match(/^\s*(\d+(?:\.\d+)*)(?=\s|[.、):]|[A-Za-z\u3400-\u9fff])/i)?.[1]).filter(Boolean);
      const maxScroll=Math.max(0,scroller.scrollHeight-scroller.clientHeight);if(maxScroll<=10)return false;
      const step=Math.max(240,Math.round((scroller.clientHeight||600)*0.7));
      let dir=1;
      if(nums.length&&topic?.number){
        const cmpFirst=compareSection(topic.number,nums[0]),cmpLast=compareSection(topic.number,nums[nums.length-1]);
        if(cmpFirst<0)dir=-1;else if(cmpLast>0)dir=1;
      }
      const nextTop=dir>0?(scroller.scrollTop>=maxScroll-10?0:Math.min(maxScroll,scroller.scrollTop+step)):(scroller.scrollTop<=10?maxScroll:Math.max(0,scroller.scrollTop-step));
      if(typeof scroller.scrollTo==='function')scroller.scrollTo({top:nextTop,behavior:'instant'});
      else scroller.scrollTop=nextTop;
      scroller.dispatchEvent?.(new Event('scroll',{bubbles:true}));
      doc.defaultView?.dispatchEvent?.(new Event('scroll'));
      return true;
    }catch{return false;}
  }
  async function reveal(doc,topic,signal,sleep,notify){
    const expanded=new Set();let clicked=false;
    for(let poll=0;poll<40;poll++){
      if(signal.aborted)throw fail('STOPPED','已停止 / Stopped');
      const nodes=directoryNodes(doc),target=directoryTarget(nodes,topic);
      if(target){try{target.scrollIntoView?.({block:'nearest',behavior:'instant'});}catch{}target.click();notify?.({action:'target.click',number:topic.number,title:topic.title,clicked:true,message:'已点击目标章节目录 / Clicked target directory entry'});return true;}
      const parents=nodes.filter(el=>{const n=numberOf(el);return n&&topic.number.startsWith(n+'.')&&!expanded.has(n);});
      parents.sort((a,b)=>numberOf(b).split('.').length-numberOf(a).split('.').length);
      const parent=parents[0],number=parent&&numberOf(parent);
      if(parent&&parents.filter(el=>numberOf(el)===number).length===1){
        try{parent.scrollIntoView?.({block:'nearest',behavior:'instant'});}catch{}
        parent.click();expanded.add(number);clicked=true;notify?.({action:'ancestor.click',number,title:String(parent.textContent).trim(),clicked:true,message:'已点击父章节，展开并加载子目录 / Clicked parent to reveal child directory'});
      }else if(!clicked){notify?.({action:'target.missing',number:topic.number,title:topic.title,clicked:false,entries:nodes.length,message:'未找到唯一目标章节或父章节目录 / Unique target or parent directory not found'});return false;}
      await sleep(120,signal);
    }
    notify?.({action:'target.timeout',number:topic.number,title:topic.title,clicked:false,message:'父章节已点击，但目标子目录未加载 / Parent clicked but target directory did not load'});
    return false;
  }
  async function ready(doc,shot,signal,sleep){
    let previous,signature='',stable=0;
    for(let poll=0;poll<25;poll++){
      if(signal.aborted)throw fail('STOPPED','已停止 / Stopped');
      const element=locate(doc,shot),bounds=element?.getBoundingClientRect();
      const images=element?[...element.querySelectorAll('img')]:[];
      if(element&&element.isConnected!==false&&bounds.width>0&&bounds.height>0&&images.every(img=>img.complete)){
        const next=[element.innerHTML||element.textContent||'',Math.round(bounds.width),Math.round(bounds.height)].join('|');
        stable=element===previous&&next===signature?stable+1:0;previous=element;signature=next;
        if(stable>=2)return element;
      }else{if(!element)stepScrollToward(doc,shot.topic);previous=null;stable=0;}
      await sleep(120,signal);
    }
    throw fail('REGION_NOT_STABLE','章节未在等待时间内完成挂载或稳定布局 / Section did not mount or settle within the wait period');
  }
  function reconstruct(doc,shot){
    if(!shot.topic.xml)throw fail('NO_NATIVE_XML','章节原始内容未保留，无法兜底 / Native section XML unavailable');
    const parsed=new DOMParser().parseFromString(shot.topic.xml,'text/html'),source=parsed.querySelector('article');if(!source)throw fail('INVALID_NATIVE_XML','原始章节内容无效 / Invalid native section XML');
    const heading=source.querySelector('h1,h2,h3,h4,h5,h6')?.textContent.trim(),number=heading?.match(/^\s*(\d+(?:\.\d+)*)(?=\s|[.、):]|[A-Za-z\u3400-\u9fff]|$)/i)?.[1];
    if(heading&&(number&&number!==shot.topic.number||title(heading)&&title(heading)!==title(shot.topic.title)))throw fail('NATIVE_SECTION_MISMATCH','原始内容的章节序号或名称不符，已拒绝重建 / Native section number or title mismatch; reconstruction refused');
    const clone=doc.importNode(source,true);
    // Resolve the region before sanitizing, so removed anchors cannot shift its index.
    let region=clone;if(shot.kind==='attachments'){
      const matches=[...clone.querySelectorAll('a')].filter(a=>href(a)===shot.file.href.toLowerCase());
      if(matches.length!==1)throw fail('ATTACHMENT_NOT_IN_XML','附件未唯一定位到该章节原始内容中 / Attachment not uniquely located in native section XML');
      const anchor=matches[0];region=anchor.closest('tr')||anchor.closest('p')||anchor;
    }
    const key=shot.kind==='attachments'?keyOf(region):'';
    clone.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select').forEach(el=>el.remove());
    for(const el of [clone,...clone.querySelectorAll('*')]){for(const a of [...el.attributes])if(/^on/i.test(a.name)||['id','srcdoc','srcset','poster','ping','xlink:href','autofocus','contenteditable','action','formaction','href','data-hd-href'].includes(a.name)||a.name==='style'&&/url\s*\(|expression|@import/i.test(a.value))el.removeAttribute(a.name);
      if(el.hasAttribute('src')){try{const u=new URL(el.getAttribute('src'),doc.location.href);if(u.origin!==doc.location.origin||u.username||u.password)el.removeAttribute(a.name);}catch{el.removeAttribute('src');}}
    }
    if(!clone.contains(region))throw fail('UNSAFE_ATTACHMENT_REGION','附件区域不可安全重建 / Attachment region cannot be safely reconstructed');
    const box=doc.createElement('div');box.setAttribute('data-netcare-reconstructed','true');box.style.cssText='position:fixed;left:-20000px;top:0;width:'+Math.max(320,Math.min(1400,doc.defaultView.innerWidth||1000))+'px;background:#fff;color:#243149;padding:20px;font:12px/1.6 Arial;pointer-events:none;z-index:-1;';
    const label=doc.createElement('p');label.textContent=shot.topic.number+' '+shot.topic.title+' · 内容重建截图（非页面原图） / Reconstructed native content (not a live-page screenshot)';box.append(label);
    if(region.tagName==='TR'){const table=doc.createElement('table');table.append(region);box.append(table);}else box.append(region);doc.body.append(box);
    return {element:box,key,remove:()=>box.remove()};
  }
  const delay=(ms,signal)=>new Promise((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,ms),abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(fail('STOPPED','已停止 / Stopped'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  async function capture(doc,shot,options){
    const {signal,render}=options,attempts=[],sleep=options.sleep||delay;
    for(let n=1;n<=3;n++){
      if(signal.aborted)throw fail('STOPPED','已停止 / Stopped');
      if(n>1)await sleep(n===2?400:1000,signal);
      let element;
      try{
        let ancestorClicked=false;
        const clicked=await reveal(doc,shot.topic,signal,sleep,event=>{if(event.clicked)ancestorClicked=true;options.navigation?.({attempt:n,...event});});
        element=locate(doc,shot);
        if(!element&&!clicked&&!ancestorClicked&&!scrollTarget(doc))throw fail('REGION_NOT_RENDERED','未定位到章节目录入口或原始区域 / Native directory and live region not found');
        // Never retain a node across scroll-driven virtual DOM replacement.
        element=await ready(doc,shot,signal,sleep);
        try{
          element.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
          let scroller=element.parentElement;
          while(scroller&&!(scroller.clientHeight>0&&scroller.scrollHeight>scroller.clientHeight+1))scroller=scroller.parentElement;
          scroller?.dispatchEvent(new Event('scroll',{bubbles:true}));
        }catch{}
        element=await ready(doc,shot,signal,sleep);
        if(signal.aborted)throw fail('STOPPED','已停止 / Stopped');
        const images=await render(element);
        if(element.isConnected===false||locate(doc,shot)!==element)throw fail('REGION_REPLACED','渲染期间章节节点发生替换，重新定位并重试 / Section replaced during rendering; retrying');
        options.attempt?.({attempt:n,stage:'live',ok:true});return {images,method:'live',attempts,regionKey:shot.kind==='attachments'?keyOf(element):''};
      }catch(e){if(signal.aborted)throw e;const bounds=element?.getBoundingClientRect();const item={attempt:n,stage:'live',code:e.code||e.name||'RENDER_FAILED',message:String(e.message||e).slice(0,1500),stack:String(e.stack||'').slice(0,2000),articles:doc.querySelectorAll('article').length,bounds:bounds?{width:bounds.width,height:bounds.height,connected:element.isConnected}:null};attempts.push(item);options.attempt?.(item);if(n===1&&typeof options.onStuck==='function'){try{await options.onStuck();}catch{}}}
    }
    let fallback;
    try{if(signal.aborted)throw fail('STOPPED','已停止 / Stopped');fallback=reconstruct(doc,shot);const images=await render(fallback.element);return {images,method:'reconstructed',attempts,regionKey:fallback.key};}
    catch(e){if(signal.aborted)throw e;attempts.push({attempt:4,stage:'reconstructed',code:e.code||e.name||'RENDER_FAILED',message:String(e.message||e).slice(0,1500),stack:String(e.stack||'').slice(0,2000)});throw Object.assign(fail('CAPTURE_FAILED','截图重试与兜底均失败 / Capture retries and fallback failed'),{attempts});}
    finally{fallback?.remove();}
  }
  return {article,locate,regionKey,navigate,reveal,reconstruct,capture};
});
