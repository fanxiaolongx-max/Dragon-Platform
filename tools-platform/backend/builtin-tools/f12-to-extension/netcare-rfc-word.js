/*
 * TP_NETCARE_RFC_WORD_V1 — automatically injected MV3 content script.
 * MAIN world + all_frames required; popup starts the panel, export frames auto-connect.
 * No credentials are exported or persisted. Uses the site's original download
 * action for every RFC so its authorization/compliance checks remain in place.
 */
function parseNetcareRfcOrders(value) {
  const orders = [...new Set(value.trim().toUpperCase().split(/[\s,，;；、]+/).filter(Boolean))];
  if (!orders.length) throw new Error('请输入 RFC 单号 / Enter RFC numbers');
  const invalid = orders.filter(order => !/^NC\d{14}$/.test(order));
  if (invalid.length) throw new Error(`单号格式应为 NC + 14 位数字：${invalid.join(', ')}`);
  if (orders.length > 50) throw new Error('每批最多 50 个 RFC / Maximum 50 RFCs per batch');
  return orders;
}

function netcareNativeOrder(value){try{const raw=String(value||'');let decoded=raw;for(let i=0;i<3;i++){try{const d=decodeURIComponent(decoded);if(d===decoded)break;decoded=d;}catch{break;}}const u=new URL(raw,typeof location!=='undefined'?location.href:undefined);const queries=[u.searchParams,new URLSearchParams(u.hash.replace(/^#/,'').split('?')[1]||''),new URLSearchParams(decoded.replace(/^[^?]*\?/,''))];const found=new Set();for(const q of queries)for(const [key,val] of q)if(['orderid','order_id','docid','id'].includes(key.toLowerCase())&&/^NC\d{14}$/.test(val))found.add(val);for(const m of (raw+' '+decoded).matchAll(/(?:orderid|order_id|docid|id)=(NC\d{14})/gi))found.add(m[1]);if(found.size>1)return '!ambiguous';if(found.size)return [...found][0];}catch{}return '';}

// Scope native redirects to the active search. The background opens the exact native
// destination, so asynchronous searches do not depend on browser popup activation.
function netcareSearchRedirects(win,order,forward){
  const original=win.open,seen=new Set();
  const wrapper=function(value,...args){
    let url;try{url=new URL(String(value||''),win.location.href);}catch{return original.call(this,value,...args);}
    const allowed=['https://netcare-ae.gts.huawei.com','https://netcare.huawei.com','https://netcare-de.gts.huawei.com'];
    if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&allowed.includes(url.origin)&&url.origin!==win.location.origin
      &&(url.pathname==='/p/netcare/index.html'||url.pathname.startsWith('/rfc/network_tuning/')||url.pathname.startsWith('/p/rfc/')||url.pathname.startsWith('/opcenter/'))&&netcareNativeOrder(url.href)===order){
      if(!seen.has(url.href)){seen.add(url.href);forward(url.href);}return null;
    }
    return original.call(this,value,...args);
  };
  win.open=wrapper;
  return ()=>{if(win.open===wrapper)win.open=original;};
}

// Search/authorization uses shared site UI sequentially; independent exports overlap.
async function executeNetcareRfcBatch(orders, concurrency, signal, prepare, transfer, onResult) {
  const running = new Set(), results = new Array(orders.length);
  const record = (index, result) => { results[index] = result; onResult(orders[index], result); };
  const limit = Math.max(1, Math.min(10, Number(concurrency) || 1));
  for (let index = 0; index < orders.length; index++) {
    if (running.size >= limit) await Promise.race(running);
    if (signal.aborted) { record(index, { ok: false, error: '已停止等待' }); continue; }
    try {
      const prepared = await prepare(orders[index], signal);
      if (signal.aborted) throw new Error('已停止等待');
      const task = Promise.resolve().then(() => transfer(orders[index], prepared, signal))
        .then(value => record(index, { ok: true, value }), error => record(index, { ok: false, error: error.message }))
        .finally(() => running.delete(task));
      running.add(task);
    } catch (error) { record(index, { ok: false, error: error.message }); }
  }
  await Promise.all(running);
  return results;
}

// Binary transfer uses bounded chunks; no credentials or server download URLs enter the cache.
function netcareArtifactRequest(message){
  return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>finish(reject,Error('审计材料传输超时')),30000);
    const finish=(fn,value)=>{clearTimeout(timer);window.removeEventListener('message',receive);fn(value);};
    const receive=event=>{if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_ARTIFACT_RESULT'&&event.data.requestId===requestId)event.data.ok?finish(resolve,event.data.data):finish(reject,Error(event.data.error||'材料缓存失败'));};
    window.addEventListener('message',receive);window.postMessage({source:'TP_RFC_ARTIFACT_REQUEST',requestId,...message},location.origin);
  });
}
var netcareLogQueue=typeof netcareLogQueue==='undefined'?Promise.resolve():netcareLogQueue;
var netcareLogFailures=typeof netcareLogFailures==='undefined'?0:netcareLogFailures;
var netcareLogRetryAt=typeof netcareLogRetryAt==='undefined'?0:netcareLogRetryAt;
function netcareLog(event,snapshotId=''){
  netcareLogQueue=netcareLogQueue.then(async()=>{if(Date.now()<netcareLogRetryAt){netcareLogFailures++;return;}try{return await netcareArtifactRequest({action:'log',order:event.order||'',event,snapshotId});}catch{netcareLogFailures++;netcareLogRetryAt=Date.now()+15000;}});return netcareLogQueue;
}
function netcareWireOperations(root,context){
  const handle=event=>{const el=event.target?.closest?.('button,input,select,textarea,summary,a');if(!el||/^(cleanCat|materialsCleanup|materialsRetention|protectSnapshot|clearResultCache|storageRefresh|snapSelect)/.test(el.id||'')||el.type==='password'||/password|token|secret|key/i.test(el.id||el.name||''))return;if(event.type==='click'&&!el.matches('button,summary,a'))return;const row=el.closest('[data-number]'),data={control:el.id||el.dataset.field||el.tagName.toLowerCase(),label:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,200),section:row?.dataset.number};if(event.type==='change'&&el.type!=='file')data.value=el.type==='checkbox'?el.checked:el.value;const c=context();netcareLog({...c,category:event.type==='change'?'configuration':'operation',action:'ui.'+event.type,message:event.type==='change'?'修改设置 / Change setting':'操作控件 / Use control',data},c.snapshotId);};
  root.addEventListener('click',handle,true);root.addEventListener('change',handle,true);return ()=>{root.removeEventListener('click',handle,true);root.removeEventListener('change',handle,true);};
}
async function netcareStoreArtifact(order,name,blob,signal,role){
  const fileId=crypto.randomUUID(),chunk=384*1024;await netcareArtifactRequest({action:'begin',order,fileId,name,size:blob.size,role});
  for(let start=0,index=0;start<blob.size;start+=chunk,index++){if(signal?.aborted)throw Error('已停止 / Stopped');const bytes=new Uint8Array(await blob.slice(start,start+chunk).arrayBuffer());let raw='';for(let n=0;n<bytes.length;n+=8192)raw+=String.fromCharCode(...bytes.subarray(n,n+8192));await netcareArtifactRequest({action:'part',order,fileId,index,data:btoa(raw)});}
  await netcareArtifactRequest({action:'finish',order,fileId});
}
async function netcareReadArtifact(file,order,signal,snapshotId=''){
  const parts=[];for(let index=0;index<file.count;index++){if(signal?.aborted)throw Error('已停止 / Stopped');const bytes=await netcareArtifactRequest({action:'read',order,fileId:file.id,index,snapshotId});parts.push(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));}return new Blob(parts);
}
function netcareSectionFolder(settings,topic,kind){
  const rule=netcareTopicRule(settings,topic,kind),number=netcareAuditOwner(settings,rule.number||topic.number,kind),row=settings.sections.find(r=>r.number===number);
  return netcareSafeFilename(number+'-'+(row?.title||topic.title||''));
}
// Standard ZIP (stored entries), UTF-8 names and CRC32; no remote dependencies.
async function createNetcareZip(entries) {
  const encoder = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const crc = bytes => {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
    return (value ^ 0xffffffff) >>> 0;
  };
  for (const entry of entries) {
    const name = encoder.encode(entry.name), bytes = new Uint8Array(await entry.blob.arrayBuffer());
    if (bytes.length > (entry.role==='audit-bundle'?500:100) * 1024 * 1024 || offset + bytes.length > 500 * 1024 * 1024) throw new Error('附件超过打包容量限制（单文件100MB，总计500MB）');
    const checksum = crc(bytes), local = new Uint8Array(30 + name.length), d = new DataView(local.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, 0x800, true);
    d.setUint16(12, 33, true); d.setUint32(14, checksum, true); d.setUint32(18, bytes.length, true); d.setUint32(22, bytes.length, true);
    d.setUint16(26, name.length, true); local.set(name, 30);
    const record = new Uint8Array(46 + name.length), r = new DataView(record.buffer);
    r.setUint32(0, 0x02014b50, true); r.setUint16(4, 20, true); r.setUint16(6, 20, true); r.setUint16(8, 0x800, true);
    r.setUint16(14, 33, true); r.setUint32(16, checksum, true); r.setUint32(20, bytes.length, true); r.setUint32(24, bytes.length, true);
    r.setUint16(28, name.length, true); r.setUint32(42, offset, true); record.set(name, 46);
    chunks.push(local, bytes); central.push(record); offset += local.length + bytes.length;
  }
  const size = central.reduce((total, part) => total + part.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
function netcareAuditLocalized(value,language='zh',localized){
  const en=language==='en';if(localized?.[en?'en':'zh'])return localized[en?'en':'zh'];
  return String(value||'').split('\n').map(line=>{
    const pieces=line.split(' / ');for(let i=1;i<pieces.length;i++){const left=pieces.slice(0,i).join(' / '),right=pieces.slice(i).join(' / ');if(/[\u3400-\u9fff]/.test(left)&&/^\s*(?:[0-9.]+[\s:·-]*)?[A-Za-z]/.test(right))return en?right:left;}
    if(!line.trim()||/^HTTP \d{3}$/.test(line))return line;
    if(en&&!/[\u3400-\u9fff]/.test(line)||!en&&/[\u3400-\u9fff]/.test(line))return line;
    return en?'This saved result has no English translation. Run the audit again.':'该历史结果缺少中文译文，请重新审计。';
  }).join('\n');
}
function netcareAuditMissingBundles(records,files){
  return records.filter(record=>record.bundleFilename?!files.some(file=>file.order===record.order&&file.name===record.bundleFilename):!files.some(file=>file.order===record.order&&file.name===record.wordFilename));
}
function netcareAuditImageKey(order,name){return order+'\u0000'+name;}
function netcareAuditScreenshots(record,report){
  const sources=report.sources?.length?report.sources:[report];
  return (record.materials||[]).filter(m=>/\.png$/i.test(m.name)&&(m.role==='screenshot'||/-(章节原图|附件位置)-\d+\.png$/i.test(m.name))&&sources.some(s=>s.section===m.section&&(m.role==='screenshot'?m.kind===s.kind:s.kind===(m.name.includes('-章节原图-')?'text':'attachments'))&&(!m.sourceFilename||m.sourceFilename===s.filename))).map(m=>({...m,order:record.order}));
}
function netcarePngSize(bytes){
  if(bytes.length<24||[137,80,78,71,13,10,26,10].some((b,i)=>bytes[i]!==b)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw Error('Invalid screenshot PNG');
  const read=i=>bytes[i]*16777216+bytes[i+1]*65536+bytes[i+2]*256+bytes[i+3],width=read(16),height=read(20);
  if(!width||!height||width>6000||height>30000)throw Error('Invalid screenshot dimensions');return {width,height};
}
function netcareAuditNotApplicable(record,report){
  if(report.notApplicable===true)return true;
  const sources=report.sources?.length?report.sources:[report];
  return report.error===true&&sources.length>0&&sources.every(source=>{
    const item=(record.items||[]).find(i=>i.section===source.section&&i.kind===source.kind&&i.filename===source.filename);
    return item&&!item.text?.trim()&&(item.notApplicable===true||/^未提取到该章节内容或附件，需人工检查 \/ Missing evidence$/.test(item.error||''));
  });
}
function netcareAuditRows(records,language='zh'){
  const rows=[];
  for(const record of [...records].reverse())for(const report of [...(record.reports||[])].sort((a,b)=>String(a.section).localeCompare(String(b.section),undefined,{numeric:true}))){
    if(netcareAuditNotApplicable(record,report))continue;
    const noAttachments=(record.reports||[]).some(r=>r.section===report.section&&r.kind==='attachments'&&netcareAuditNotApplicable(record,r));
    const sources=report.sources?.length?report.sources:[report];
    const text=sources.map(source=>{const item=(record.items||[]).find(i=>i.section===source.section&&i.kind===source.kind&&i.filename===source.filename);return (sources.length>1?'['+source.section+' · '+source.filename+']\n':'')+(item?.text||netcareAuditLocalized(item?.error||'未提取到可展示文本 / No text available',language));}).join('\n\n');
    rows.push({...report,noAttachments,summary:netcareAuditLocalized(report.summary,language,report.summaryI18n),findings:(report.findingsI18n?.length?report.findingsI18n:report.findings||[]).map(f=>netcareAuditLocalized(typeof f==='string'?f:'',language,typeof f==='object'?f:undefined)),order:record.order,wordFilename:record.wordFilename||'',text,screenshots:netcareAuditScreenshots(record,report)});
  }
  return rows;
}
async function netcareAuditExcel(records,language='zh',images=new Map(),embedScreenshots=undefined){
  const shouldEmbed=embedScreenshots!==false;
  const rows=netcareAuditRows(records,language),tr=(zh,en)=>language==='en'?en:zh,escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,''),labels={pass:tr('通过','Pass'),fail:tr('不通过','Fail'),needs_review:tr('需人工核查','Needs review')};
  const values=[{cells:[tr('方案','RFC'),tr('章节','Section'),tr('审计点与内容','Evidence'),tr('结论','Result'),tr('原因','Reason')],height:28}],ranges=[],merges=[],media=new Map(),pictures=[];
  for(const r of rows){
    const first=values.length+1,missing=[];
    values.push({cells:[r.order+(r.wordFilename?'\n'+r.wordFilename:''),netcareAuditSectionText(r,language),`${tr(r.kind==='text'?'章节文本':'附件',r.kind==='text'?'Section text':'Attachment')}: ${r.filename||''}\n${tr('审计点','Audit rule')}: ${r.rule||''}\n\n${r.text}`,labels[r.status]||labels.needs_review,[r.summary,...r.findings,r.diagnostics?tr('错误详情','Error details')+': '+JSON.stringify(r.diagnostics):''].filter(Boolean).join('\n')],height:Math.min(330,Math.max(100,Math.ceil(Math.max(r.text.length/58,(r.summary+r.findings.join('\n')).length/48))*14+48)),status:r.status});
    if(shouldEmbed){
      for(const shot of r.screenshots){
        const key=netcareAuditImageKey(r.order,shot.name),blob=images.get(key);if(!blob){missing.push(shot.name);continue;}
        let image=media.get(key);if(!image){try{const bytes=new Uint8Array(await blob.arrayBuffer()),size=netcarePngSize(bytes);image={...size,bytes,id:media.size+1};media.set(key,image);}catch{missing.push(shot.name);continue;}}
        const scale=Math.min(440/image.width,240/image.height,1),width=Math.round(image.width*scale),height=Math.round(image.height*scale),row=values.length+1;
        values.push({cells:['','',tr('原始区域截图','Source screenshot')+' · '+(shot.name.length>36?shot.name.slice(0,36)+'…':shot.name),'',''],height:Math.ceil((height+48)*.75)});pictures.push({image,row,width,height,name:shot.name});
      }
      if(missing.length)values[first-1].cells[2]+='\n\n'+tr('截图未缓存或已过期，请重新提取','Screenshots unavailable or expired; extract again')+':\n'+missing.join('\n');
    }
    const last=values.length;ranges.push({r,first,last});if(last>first){merges.push(`D${first}:D${last}`,`E${first}:E${last}`);}
  }
  for(let i=0;i<ranges.length;){let end=i+1;while(end<ranges.length&&ranges[end].r.order===ranges[i].r.order)end++;const first=ranges[i].first,last=ranges[end-1].last;if(last>first)merges.push(`A${first}:A${last}`);for(let j=i;j<end;){let next=j+1;while(next<end&&ranges[next].r.section===ranges[j].r.section)next++;const a=ranges[j].first,b=ranges[next-1].last;if(b>a)merges.push(`B${a}:B${b}`);j=next;}i=end;}
  const sheetRows=values.map((row,i)=>`<row r="${i+1}" ht="${row.height}" customHeight="1">${row.cells.map((v,j)=>`<c r="${'ABCDE'[j]}${i+1}" t="inlineStr" s="${!i?2:j===3?({pass:3,fail:4,needs_review:5}[row.status]||1):1}"><is><t xml:space="preserve">${escape(String(v).slice(0,32700)+(String(v).length>32700?'\n['+tr('单元格内容截断，完整内容见材料ZIP','Cell truncated; full content is in the materials ZIP')+']':''))}</t></is></c>`).join('')}</row>`).join('');
  const hasImages=pictures.length>0,files={'[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasImages?'<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>':''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${tr('审计结果','Audit results')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'xl/styles.xml':`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>${['21805E','C44848','996C16'].map(color=>`<font><b/><color rgb="FF${color}"/><sz val="11"/><name val="Calibri"/></font>`).join('')}</fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243149"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFDCE3ED"/></left><right style="thin"><color rgb="FFDCE3ED"/></right><top style="thin"><color rgb="FFDCE3ED"/></top><bottom style="thin"><color rgb="FFDCE3ED"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>${[2,3,4].map(font=>`<xf numFmtId="0" fontId="${font}" fillId="0" borderId="1" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${[28,30,65,20,60].map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData>${merges.length?`<mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:''}${hasImages?'<drawing r:id="rId1"/>':''}</worksheet>`};
  if(hasImages){
    files['xl/worksheets/_rels/sheet1.xml.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>';
    files['xl/drawings/_rels/drawing1.xml.rels']=`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...media.values()].map(m=>`<Relationship Id="rId${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${m.id}.png"/>`).join('')}</Relationships>`;
    files['xl/drawings/drawing1.xml']=`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${pictures.map((p,i)=>`<xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>76200</xdr:colOff><xdr:row>${p.row-1}</xdr:row><xdr:rowOff>304800</xdr:rowOff></xdr:from><xdr:ext cx="${p.width*9525}" cy="${p.height*9525}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i+1}" name="${escape(p.name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${p.image.id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${p.width*9525}" cy="${p.height*9525}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join('')}</xdr:wsDr>`;
  }
  return createNetcareZip([...Object.entries(files).map(([name,text])=>({name,blob:new Blob(['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+text])})),...[...media.values()].map(m=>({name:`xl/media/image${m.id}.png`,blob:new Blob([m.bytes],{type:'image/png'})}))]);
}
async function netcareAuditMaterials(records,files,readFile,progress=()=>{},language='zh',embedScreenshots=undefined){
  const entries=[],missing=[],reconstructed=[],images=new Map();
  for(const record of records){const sources=record.reports.flatMap(r=>r.sources?.length?r.sources:[r]),names=new Set([...sources.map(r=>r.filename),...(record.materials||[]).map(m=>m.name)]),wanted=files.filter(f=>f.order===record.order&&(f.name===record.wordFilename||f.name===record.bundleFilename||!record.wordFilename&&f.name.startsWith(record.order+'_')&&f.name.endsWith('.docx')||names.has(f.name))),added=new Set();
    if(record.bundleFilename&&!wanted.some(f=>f.name===record.bundleFilename))missing.push(record.order+' · '+record.bundleFilename);
    if(!wanted.some(f=>f.name.endsWith('.docx')))missing.push(record.order+' · 方案 Word');
    for(const report of sources){if(!wanted.some(f=>f.name===report.filename)&&!added.has(report.filename)){added.add(report.filename);const item=record.items.find(i=>i.section===report.section&&i.kind===report.kind&&i.filename===report.filename);if(item?.kind==='text'&&item.text){const mat=(record.materials||[]).find(m=>m.name===item.filename);const folderPrefix=mat?.folder?netcareSafeFilename(mat.folder)+'/方案文本/':'';entries.push({name:record.order+'/'+folderPrefix+netcareSafeFilename(item.filename),blob:new Blob(['\ufeff'+item.text],{type:'text/plain;charset=utf-8'})});reconstructed.push(record.order+' · '+item.filename);}else missing.push(record.order+' · '+report.filename);}}
    for(const name of new Set(record.reports.flatMap(r=>netcareAuditScreenshots(record,r)).map(m=>m.name)))if(!wanted.some(f=>f.name===name))missing.push(record.order+' · '+name);
    for(const file of wanted){progress(file);const blob=await readFile(file);if(record.reports.some(r=>netcareAuditScreenshots(record,r).some(m=>m.name===file.name)))images.set(netcareAuditImageKey(record.order,file.name),blob);const mat=(record.materials||[]).find(m=>m.name===file.name);const subFolder=mat?.role==='screenshot'?'方案截图':mat?.kind==='attachments'?'方案附件':'方案文本';const folderPrefix=mat?.folder?netcareSafeFilename(mat.folder)+'/'+subFolder+'/':'';entries.push({name:record.order+'/'+folderPrefix+netcareSafeFilename(file.name),blob,role:file.role});}
    entries.push({name:record.order+'/AI审计结果.json',blob:new Blob([JSON.stringify(record,null,2)],{type:'application/json'})});
  }
  if(missing.length)entries.push({name:'缺失材料清单.txt',blob:new Blob(['\ufeff'+missing.join('\n')+'\n旧记录、原方案缺少附件或过期缓存可能缺少原文件，请重新下载并审计相应RFC。'],{type:'text/plain;charset=utf-8'})});
  if(reconstructed.length)entries.push({name:'文本回填说明.txt',blob:new Blob(['\ufeff以下章节TXT由已脱敏的审计证据回填，原始TXT未缓存：\n'+reconstructed.join('\n')],{type:'text/plain;charset=utf-8'})});
  entries.push({name:language==='en'?'Audit results.xlsx':'审计结果.xlsx',blob:await netcareAuditExcel(records,language,images,embedScreenshots)});return {entries,missing,reconstructed};
}
function netcareSafeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 200) || 'unnamed';
}
function netcareUniqueFilename(name, used) {
  let candidate = name, n = 2;
  while (used.has(candidate.toLowerCase())) {
    const dot = name.lastIndexOf('.');
    candidate = dot > 0 ? `${name.slice(0, dot)} (${n++})${name.slice(dot)}` : `${name} (${n++})`;
  }
  used.add(candidate.toLowerCase()); return candidate;
}
function netcareTopicCatalogue(groups) {
  const seen = new Set();
  return groups.flat().filter(item => typeof item === 'string').map(query => {
    const p = new URLSearchParams(query);
    return { query, number: p.get('catalognumber'), title: p.get('title') || '', topic: p.get('number') };
  }).filter(item => /^\d+(\.\d+)*$/.test(item.number || '') && item.topic && !seen.has(item.number) && seen.add(item.number));
}
function netcareDefaultLocalRules() {
  return [
    { id: 'rule-1.1', name: '1.1 变更目的与背景检查 / Change Purpose Check', sectionNumber: '1.1', sectionTitle: 'Change Purpose', kind: 'text', pattern: '(?:变更目的|变更原因|影响范围|Purpose|Objective|Scope)', passCondition: 'match', passSummary: '变更目的已明确 / Change purpose specified', failSummary: '缺少变更目的或影响范围说明 / Missing change purpose or scope', enabled: true },
    { id: 'rule-1.2', name: '1.2 方案与计划检查 / Change Plan Check', sectionNumber: '1.2', sectionTitle: 'Basic Information and Change Plan', kind: 'text', pattern: '(?:拓扑|Topology|计划|Batch|外设|Peripheral|窗口|Window)', passCondition: 'match', passSummary: '变更计划与环境信息完整 / Change plan complete', failSummary: '缺少变更计划或拓扑外设说明 / Missing change plan or topology', enabled: true },
    { id: 'rule-3.2', name: '3.2 准备工作与Checklist检查 / Preparation & Checklist', sectionNumber: '3.2', sectionTitle: 'Preparation for Change Implementation', kind: 'all', pattern: '(?:Checklist|检查项|准备工作|健康检查|Health Check|Pre-check|环境确认)', passCondition: 'match', passSummary: '准备工作与Checklist齐全 / Preparation and checklist complete', failSummary: '缺少实施前准备或Checklist检查项 / Missing preparation or checklist', enabled: true },
    { id: 'rule-3.3', name: '3.3 实施操作步骤检查 / Operation Steps Check', sectionNumber: '3.3', sectionTitle: 'Operation Steps for Change', kind: 'text', pattern: '(?:操作步骤|Step|命令|Command|配置|Configuration|执行脚本|脚本)', passCondition: 'match', passSummary: '包含明确操作步骤与命令 / Contains operation steps and commands', failSummary: '缺少具体操作步骤或执行命令 / Missing operation steps or commands', enabled: true },
    { id: 'rule-3.4', name: '3.4 测试验证与KPI检查 / Test & Verification Check', sectionNumber: '3.4', sectionTitle: 'Test and Verification', kind: 'text', pattern: '(?:测试|验证|KPI|Verification|Test|指标|业务恢复)', passCondition: 'match', passSummary: '包含测试验证方案或KPI指标 / Contains test verification or KPI', failSummary: '缺少测试验证步骤或业务指标 / Missing test steps or KPIs', enabled: true },
    { id: 'rule-3.5', name: '3.5 失败回退方案检查 / Changeback Solution Check', sectionNumber: '3.5', sectionTitle: 'Solution for Changeback In the Case of Failure', kind: 'text', pattern: '(?:回退|Changeback|Rollback|应急预案|失败判定|恢复原状)', passCondition: 'match', passSummary: '包含回退方案与应急步骤 / Contains rollback plan and steps', failSummary: '缺少回退步骤或应急预案 / Missing rollback steps', enabled: true }
  ];
}
function netcareUnescapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function netcareTruncateEvidenceText(text, maxChars = 59000) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[注：附件文本超出上限，已截取前59000字用于AI审计 / Truncated to 59000 chars]';
}
function netcareFormatExportLogLine(entry) {
  const d = new Date(entry?.at || entry?.timestamp || Date.now());
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const tzH = Math.floor(Math.abs(offsetMin) / 60);
  const tzM = Math.abs(offsetMin) % 60;
  const tz = 'GMT' + sign + tzH + (tzM ? ':' + pad(tzM) : '');
  const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${tz}`;
  return `[${timeStr}] ${JSON.stringify({ ...entry, timestamp: d.toISOString() })}`;
}
function netcareGetAttachmentType(filename) {
  const name = String(filename || '').toLowerCase();
  if (/\.txt$/i.test(name)) return 'txt';
  if (/\.(docx|doc)$/i.test(name)) return 'word';
  if (/\.(xlsx|xls|csv)$/i.test(name)) return 'excel';
  if (/\.msg$/i.test(name)) return 'msg';
  return null;
}
const NETCARE_ATTACHMENT_TYPE_NAMES = {
  txt: 'TXT',
  word: 'Word',
  excel: 'Excel',
  msg: 'MSG'
};
async function netcareExtractTxt(blob) {
  if (blob.size > 10 * 1024 * 1024) throw new Error('TXT附件超过10MB，暂不自动审计');
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let text = '';
  try {
    const decoder = new TextDecoder(bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : 'utf-8', { fatal: true });
    text = decoder.decode(bytes).replace(/^\ufeff/, '');
  } catch {
    try {
      const gbkDecoder = new TextDecoder('gb18030');
      text = gbkDecoder.decode(bytes).replace(/^\ufeff/, '');
    } catch {
      const latinDecoder = new TextDecoder('iso-8859-1');
      text = latinDecoder.decode(bytes);
    }
  }
  return netcareTruncateEvidenceText(text);
}
async function netcareUnzip(bufferOrArrayBuffer) {
  const bytes = bufferOrArrayBuffer instanceof Uint8Array
    ? bufferOrArrayBuffer
    : new Uint8Array(bufferOrArrayBuffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  let eocdOffset = -1;
  const maxSearch = Math.min(bytes.length, 65535 + 22);
  for (let i = bytes.length - 22; i >= bytes.length - maxSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('无效的 ZIP/Office 文件格式 / Invalid zip format');

  const cdTotalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  let cur = cdOffset;
  for (let entryIdx = 0; entryIdx < cdTotalEntries; entryIdx++) {
    if (cur + 46 > bytes.length || view.getUint32(cur, true) !== 0x02014b50) break;
    const method = view.getUint16(cur + 10, true);
    const compSize = view.getUint32(cur + 20, true);
    const uncompSize = view.getUint32(cur + 24, true);
    const nameLen = view.getUint16(cur + 28, true);
    const extraLen = view.getUint16(cur + 30, true);
    const commentLen = view.getUint16(cur + 32, true);
    const localHeaderOffset = view.getUint32(cur + 42, true);

    const nameBytes = bytes.subarray(cur + 46, cur + 46 + nameLen);
    const fileName = new TextDecoder('utf-8').decode(nameBytes);

    cur += 46 + nameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 > bytes.length || view.getUint32(localHeaderOffset, true) !== 0x04034b50) continue;
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    const compData = bytes.subarray(dataOffset, dataOffset + compSize);
    files.set(fileName, { method, compSize, uncompSize, data: compData });
  }

  async function readText(entryName) {
    const entry = files.get(entryName);
    if (!entry) return null;
    let rawBytes;
    if (entry.method === 0) {
      rawBytes = entry.data;
    } else if (entry.method === 8) {
      if (typeof DecompressionStream === 'function') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(entry.data);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.length;
        }
        rawBytes = new Uint8Array(total);
        let offset = 0;
        for (const ch of chunks) {
          rawBytes.set(ch, offset);
          offset += ch.length;
        }
      } else {
        throw new Error('当前环境不支持 DecompressionStream');
      }
    } else {
      throw new Error(`不支持的压缩算法 (${entry.method})`);
    }
    return new TextDecoder('utf-8').decode(rawBytes);
  }

  return { files, readText };
}
function netcareExtractLegacyDoc(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length - 1; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if ((code >= 0x20 && code <= 0x7E) || (code >= 0x4E00 && code <= 0x9FA5) || code === 0x0A || code === 0x0D || code === 0x09) {
      text += String.fromCharCode(code);
    } else if (text.endsWith('\n') || text.length === 0) {
      // skip
    } else {
      text += '\n';
    }
  }
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length >= 4);
  return lines.join('\n');
}
async function netcareExtractDocx(blob, filename) {
  if (blob.size > 30 * 1024 * 1024) throw new Error('Word附件超过30MB，暂不自动审计');
  const buffer = await blob.arrayBuffer();
  const header = new Uint8Array(buffer, 0, 4);
  if (header[0] === 0xD0 && header[1] === 0xCF && header[2] === 0x11 && header[3] === 0xE0) {
    const legacyText = netcareExtractLegacyDoc(buffer);
    if (!legacyText || legacyText.trim().length < 15) {
      throw new Error('旧版二进制 DOC 格式文本解析受限，建议另存为 DOCX 或人工检查');
    }
    return netcareTruncateEvidenceText(legacyText);
  }
  const zip = await netcareUnzip(buffer);
  const docXml = await zip.readText('word/document.xml');
  if (!docXml) throw new Error('Word 文件损坏或缺少 word/document.xml');

  const paragraphs = [];
  const pRegex = /<w:p(?: [^>]*)?>([\s\S]*?)<\/w:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(docXml)) !== null) {
    let pContent = pMatch[1];
    pContent = pContent.replace(/<w:tab\s*\/?>/gi, '\t').replace(/<w:br\s*\/?>/gi, '\n');
    const tRegex = /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g;
    let tMatch;
    let pText = '';
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      pText += netcareUnescapeXml(tMatch[1]);
    }
    pText = pText.trim();
    if (pText) paragraphs.push(pText);
  }
  const fullText = paragraphs.join('\n');
  if (!fullText.trim()) throw new Error('Word 文件未提取到有效正文文本');
  return netcareTruncateEvidenceText(fullText);
}
async function netcareExtractExcel(blob, filename) {
  if (/\.csv$/i.test(filename)) {
    return await netcareExtractTxt(blob);
  }
  if (blob.size > 30 * 1024 * 1024) throw new Error('Excel附件超过30MB，暂不自动审计');
  const buffer = await blob.arrayBuffer();
  const header = new Uint8Array(buffer, 0, 4);
  if (header[0] === 0xD0 && header[1] === 0xCF && header[2] === 0x11 && header[3] === 0xE0) {
    throw new Error('旧版二进制 XLS 格式暂不支持，建议另存为 XLSX 或 CSV 后重新上传');
  }

  const zip = await netcareUnzip(buffer);
  const sharedStringsXml = await zip.readText('xl/sharedStrings.xml');
  const sharedStrings = [];
  if (sharedStringsXml) {
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(sharedStringsXml)) !== null) {
      const siContent = siMatch[1];
      const tRegex = /<t(?: [^>]*)?>([^<]*)<\/t>/g;
      let tMatch;
      let str = '';
      while ((tMatch = tRegex.exec(siContent)) !== null) {
        str += netcareUnescapeXml(tMatch[1]);
      }
      sharedStrings.push(str);
    }
  }

  const sheetNames = [];
  for (const name of zip.files.keys()) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
      sheetNames.push(name);
    }
  }
  sheetNames.sort();
  if (!sheetNames.length) throw new Error('XLSX 文件未找到工作表');

  const sheetsText = [];
  for (let sIdx = 0; sIdx < Math.min(sheetNames.length, 5); sIdx++) {
    const sheetXml = await zip.readText(sheetNames[sIdx]);
    if (!sheetXml) continue;
    const rowRegex = /<row(?: [^>]*)?>([\s\S]*?)<\/row>/g;
    let rowMatch;
    const rows = [];
    while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
      const rowContent = rowMatch[1];
      const cRegex = /<c(?: ([^>]*))?>([\s\S]*?)<\/c>/g;
      let cMatch;
      const cells = [];
      while ((cMatch = cRegex.exec(rowContent)) !== null) {
        const cAttrs = cMatch[1] || '';
        const cBody = cMatch[2] || '';
        const isShared = /t="s"/i.test(cAttrs);
        const isInline = /t="inlineStr"/i.test(cAttrs);
        const vMatch = /<v>([^<]*)<\/v>/.exec(cBody);
        let val = '';
        if (isShared && vMatch) {
          const idx = parseInt(vMatch[1], 10);
          val = sharedStrings[idx] || '';
        } else if (isInline) {
          const tMatch = /<t(?: [^>]*)?>([^<]*)<\/t>/.exec(cBody);
          val = tMatch ? netcareUnescapeXml(tMatch[1]) : '';
        } else if (vMatch) {
          val = netcareUnescapeXml(vMatch[1]);
        }
        cells.push(val.trim());
      }
      if (cells.some(c => c.length > 0)) {
        rows.push(cells.join('\t'));
      }
    }
    if (rows.length) {
      sheetsText.push(`[Sheet ${sIdx + 1}]\n` + rows.join('\n'));
    }
  }

  const fullText = sheetsText.join('\n\n');
  if (!fullText.trim()) throw new Error('Excel 表格未提取到有效内容');
  return netcareTruncateEvidenceText(fullText);
}
async function netcareExtractMsg(blob) {
  if (blob.size > 20 * 1024 * 1024) throw new Error('MSG附件超过20MB，暂不自动审计');
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 512 || view.getUint32(0, false) !== 0xD0CF11E0 || view.getUint32(4, false) !== 0xA1B11AE1) {
    throw new Error('无效的 MSG 文件格式 / Invalid MSG format');
  }

  const sectorShift = view.getUint16(0x1E, true);
  const miniSectorShift = view.getUint16(0x20, true);
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const numFatSectors = view.getUint32(0x2C, true);
  const dirFirstSector = view.getUint32(0x30, true);
  const miniCutoff = view.getUint32(0x38, true);
  const miniFatFirstSector = view.getUint32(0x3C, true);
  const numMiniFatSectors = view.getUint32(0x40, true);

  const fat = [];
  for (let i = 0; i < Math.min(numFatSectors, 109); i++) {
    const fatSecIndex = view.getUint32(0x4C + i * 4, true);
    const secOffset = (fatSecIndex + 1) * sectorSize;
    if (secOffset + sectorSize <= bytes.length) {
      for (let j = 0; j < sectorSize; j += 4) {
        fat.push(view.getUint32(secOffset + j, true));
      }
    }
  }

  function readFatChain(startSector, totalBytes) {
    const chunks = [];
    let cur = startSector;
    let readCount = 0;
    while (cur !== 0xFFFFFFFE && cur < fat.length && readCount < 10000) {
      const secOffset = (cur + 1) * sectorSize;
      if (secOffset + sectorSize > bytes.length) break;
      chunks.push(bytes.subarray(secOffset, secOffset + sectorSize));
      cur = fat[cur];
      readCount++;
    }
    const combined = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      combined.set(c, off);
      off += c.length;
    }
    return totalBytes ? combined.subarray(0, totalBytes) : combined;
  }

  const dirBytes = readFatChain(dirFirstSector);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const numDirEntries = Math.floor(dirBytes.length / 128);
  if (!numDirEntries) throw new Error('MSG 目录解析失败');

  const rootStartSector = dirView.getUint32(0x74, true);
  const rootSize = dirView.getUint32(0x78, true);
  const miniStreamData = rootStartSector !== 0xFFFFFFFE ? readFatChain(rootStartSector, rootSize) : new Uint8Array(0);

  const miniFat = [];
  if (numMiniFatSectors > 0 && miniFatFirstSector !== 0xFFFFFFFE) {
    const miniFatBytes = readFatChain(miniFatFirstSector);
    const mfv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
    for (let i = 0; i < miniFatBytes.length; i += 4) {
      miniFat.push(mfv.getUint32(i, true));
    }
  }

  function readMiniChain(startMiniSector, totalBytes) {
    const chunks = [];
    let cur = startMiniSector;
    let readCount = 0;
    while (cur !== 0xFFFFFFFE && cur < miniFat.length && readCount < 10000) {
      const secOffset = cur * miniSectorSize;
      if (secOffset + miniSectorSize > miniStreamData.length) break;
      chunks.push(miniStreamData.subarray(secOffset, secOffset + miniSectorSize));
      cur = miniFat[cur];
      readCount++;
    }
    const combined = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      combined.set(c, off);
      off += c.length;
    }
    return totalBytes ? combined.subarray(0, totalBytes) : combined;
  }

  const props = new Map();
  for (let i = 0; i < numDirEntries; i++) {
    const entryOffset = i * 128;
    const nameLen = dirView.getUint16(entryOffset + 0x40, true);
    if (!nameLen || nameLen > 64) continue;
    const nameBytes = dirBytes.subarray(entryOffset, entryOffset + nameLen);
    const entryName = new TextDecoder('utf-16le').decode(nameBytes).replace(/\0.*$/, '');
    const objType = dirView.getUint8(entryOffset + 0x42);
    if (objType !== 2) continue;

    const sectStart = dirView.getUint32(entryOffset + 0x74, true);
    const streamSize = dirView.getUint32(entryOffset + 0x78, true);

    let streamBytes;
    if (streamSize < miniCutoff) {
      streamBytes = readMiniChain(sectStart, streamSize);
    } else {
      streamBytes = readFatChain(sectStart, streamSize);
    }
    props.set(entryName.toUpperCase(), streamBytes);
  }

  function getPropString(tagHex) {
    const uniTag = `__SUBSTG1.0_${tagHex}001F`;
    if (props.has(uniTag)) {
      const buf = props.get(uniTag);
      return new TextDecoder('utf-16le').decode(buf).replace(/\0.*$/, '').trim();
    }
    const ansiTag = `__SUBSTG1.0_${tagHex}001E`;
    if (props.has(ansiTag)) {
      const buf = props.get(ansiTag);
      try {
        return new TextDecoder('utf-8').decode(buf).replace(/\0.*$/, '').trim();
      } catch {
        return new TextDecoder('gb18030').decode(buf).replace(/\0.*$/, '').trim();
      }
    }
    return '';
  }

  const subject = getPropString('0037');
  const sender = getPropString('0C1A') || getPropString('5D01');
  const to = getPropString('0E04');
  const cc = getPropString('0E03');
  let body = getPropString('1000');

  if (!body) {
    const htmlBody = getPropString('1013');
    if (htmlBody) {
      body = htmlBody.replace(/<style[\s\S]*?<\/style>/gi, '')
                     .replace(/<script[\s\S]*?<\/script>/gi, '')
                     .replace(/<br\s*[\/]?>/gi, '\n')
                     .replace(/<\/p>/gi, '\n')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/&nbsp;/g, ' ')
                     .replace(/&amp;/g, '&')
                     .replace(/&lt;/g, '<')
                     .replace(/&gt;/g, '>')
                     .replace(/\n\s*\n+/g, '\n')
                     .trim();
    }
  }

  const parts = [];
  if (subject) parts.push(`【主题 / Subject】: ${subject}`);
  if (sender) parts.push(`【发件人 / From】: ${sender}`);
  if (to) parts.push(`【收件人 / To】: ${to}`);
  if (cc) parts.push(`【抄送 / Cc】: ${cc}`);
  if (body) parts.push(`\n【正文 / Content】:\n${body}`);

  const fullText = parts.join('\n');
  if (!fullText.trim()) throw new Error('MSG 邮件未提取到有效文本或正文');
  return netcareTruncateEvidenceText(fullText);
}
async function netcareExtractAttachmentText(blob, filename, settings, section, savedFilename) {
  const fileType = netcareGetAttachmentType(filename);
  if (!fileType) {
    const ext = filename && filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '未知';
    return {
      section,
      kind: 'attachments',
      filename: savedFilename,
      error: `不支持自动审计的附件类型 (${ext})，此格式需人工检查 / Unsupported format`
    };
  }

  const enabledTypes = settings?.attachmentAuditTypes || ['txt'];
  if (!enabledTypes.includes(fileType)) {
    const label = NETCARE_ATTACHMENT_TYPE_NAMES[fileType] || fileType.toUpperCase();
    return {
      section,
      kind: 'attachments',
      filename: savedFilename,
      error: `未开启 ${label} 附件审计，此格式需人工检查 / ${label} audit disabled`
    };
  }

  try {
    let text = '';
    if (fileType === 'txt') {
      text = await netcareExtractTxt(blob);
    } else if (fileType === 'word') {
      text = await netcareExtractDocx(blob, filename);
    } else if (fileType === 'excel') {
      text = await netcareExtractExcel(blob, filename);
    } else if (fileType === 'msg') {
      text = await netcareExtractMsg(blob);
    }
    if (!text || !text.trim()) {
      throw new Error('未提取到有效文本内容 / No text extracted');
    }
    return {
      section,
      kind: 'attachments',
      filename: savedFilename,
      text
    };
  } catch (error) {
    return {
      section,
      kind: 'attachments',
      filename: savedFilename,
      error: error.message || '附件解析失败 / Parse failed'
    };
  }
}
function netcareSanitizedPlanIndex(plans, enabled = true) {
  if (!enabled) return -1;
  const matches = plans.map((plan, index) => ({name: String(plan.name || ''), index})).filter(plan =>
    !/(?:未|非)脱敏|\b(?:not|non[- ]?)\s*(?:redacted|saniti[sz]ed|anonymi[sz]ed|de[- ]?sensiti[sz]ed)/i.test(plan.name)
    && /脱敏|去敏|\b(?:redacted|saniti[sz]ed|anonymi[sz]ed|de[- ]?sensiti[sz]ed)\b/i.test(plan.name));
  return matches.length === 1 ? matches[0].index : -1;
}
function netcarePlanChoiceQueue(show) {
  let tail = Promise.resolve();
  return (request, signal) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, new Error('已停止等待 / Stopped waiting'));
    signal.addEventListener('abort', abort, {once:true}); if (signal.aborted) abort();
    const work = tail.then(async () => { if (settled) return; try { finish(resolve, await show(request, signal)); } catch(error) { finish(reject, error); } });
    tail = work.catch(() => {});
  });
}
function netcareDefaultSettings() {
  const template = [["1", "Description of Change and Change Influence"], ["1.1", "Change Purpose"], ["1.2", "Basic Information and Change Plan"], ["1.2.1", "Network Topology"], ["1.2.2", "Change Batches"], ["1.2.3", "Peripherals"], ["1.3", "Change Influence"], ["1.4", "Severity Information"], ["2", "Preparations for Change"], ["2.1", "Composition of Change Team and Responsibility of Team Members"], ["2.1.1", "Change Team of Orange Company"], ["2.1.2", "Huawei On-site Change Team"], ["2.1.3", "Huawei Support & Guarantee Team"], ["2.2", "Remote Access"], ["2.3", "Tool and Software Preparation"], ["2.4", "Check of Equipment Running"], ["2.5", "Change Risks and Countermeasures"], ["2.6", "Confirm Work Before Change"], ["3", "Operation Steps for Change"], ["3.1", "Overall Description of Change Steps"], ["3.2", "Preparation for Change Implementation"], ["3.3", "Operation Steps for Change"], ["3.3.1", "Operation Scripts"], ["3.4", "Test and Verification"], ["3.5", "Solution for Changeback In the Case of Failure"], ["3.5.1", "Definition of Change Failure"], ["3.5.2", "Overall Description of Changeback"], ["3.5.3", "Changeback Steps"], ["3.5.4", "Tests After Changeback"], ["3.5.5", "Changeback Risk Analysis"], ["3.6", "Change of Spare Parts and Emergency Workstation"], ["4", "Work After Change"], ["4.1", "Observation"], ["4.2", "Other work"]];
  return { autoSelectSanitizedPlan: true, aiAuditEnabled: false, disableLocalRules: false, concurrency: 3, openOnline: true, closeAfterAudit: false, titleFallbackEnabled: false, pipBetaEnabled: false, attachmentsEnabled: false, textEnabled: false, screenshotsEnabled: true, embedScreenshotsInExcel: false, intervalMs: 1500,
    attachmentAuditTypes: ['txt'],
    sections: template.map(([number, title]) => ({ number, title, attachments: number === '3.2', text: ['1.1', '3.2'].includes(number), attachmentsPrompt: '', textPrompt: '' })),
    localRules: netcareDefaultLocalRules() };
}
function netcareNormalizeSettings(value) {
  if (!value || !Array.isArray(value.sections) || value.sections.length > 100) throw new Error('章节模板最多 100 项 / Maximum 100 sections');
  if (value.concurrency != null && (!Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 10) || value.openOnline != null && typeof value.openOnline !== 'boolean' || value.screenshotsEnabled != null && typeof value.screenshotsEnabled !== 'boolean') throw new Error('下载全局设置无效 / Invalid preferences');
  if (['closeAfterAudit','titleFallbackEnabled','pipBetaEnabled','autoSelectSanitizedPlan','disableLocalRules','embedScreenshotsInExcel'].some(k=>value[k]!=null&&typeof value[k]!=='boolean')) throw new Error('提取设置无效 / Invalid extraction preferences');
  const ALLOWED_ATTACHMENT_AUDIT_TYPES = ['txt', 'word', 'excel', 'msg'];
  const attachmentAuditTypes = Array.isArray(value.attachmentAuditTypes)
    ? [...new Set(value.attachmentAuditTypes.filter(t => ALLOWED_ATTACHMENT_AUDIT_TYPES.includes(t)))]
    : ['txt'];
  const seen = new Set();
  const sections = value.sections.map(row => {
    const number = String(row.number || '').trim(), title = String(row.title || '').trim();
    if (!/^\d+(\.\d+)*$/.test(number) || number.length > 40 || !title || title.length > 200 || seen.has(number)) throw new Error('章节序号须为数字点号且不能重复，名称不能为空 / Invalid or duplicate section');
    const attachmentsPrompt = netcareRedactText(String(row.attachmentsPrompt || '').trim()), textPrompt = netcareRedactText(String(row.textPrompt || '').trim());
    if (attachmentsPrompt.length > 4000 || textPrompt.length > 4000) throw new Error('单条提示词最多4000字符');
    seen.add(number); return { number, title, attachments: row.attachments === true || !!attachmentsPrompt, text: row.text === true || !!textPrompt, attachmentsPrompt, textPrompt };
  });
  if (value.attachmentsEnabled === true && !sections.some(row => row.attachments) || value.textEnabled === true && !sections.some(row => row.text)) throw new Error('请为已开启的提取类型选择至少一个章节 / Select a section');
  if (value.aiAuditEnabled === true && !sections.some(row => row.textPrompt || row.attachmentsPrompt)) throw new Error('开启AI审计需要至少一条章节提示词 / Add an audit rule');
  const aiAuditEnabled = value.aiAuditEnabled === true;
  const attachmentsEnabled = value.attachmentsEnabled === true || aiAuditEnabled && sections.some(row => row.attachmentsPrompt);
  const textEnabled = value.textEnabled === true || aiAuditEnabled && sections.some(row => row.textPrompt);
  const screenshotsEnabled = (attachmentsEnabled || textEnabled) ? value.screenshotsEnabled !== false : false;
  const embedScreenshotsInExcel = screenshotsEnabled && value.embedScreenshotsInExcel === true;
  const closeAfterAudit = aiAuditEnabled && value.closeAfterAudit === true;
  const localRules = Array.isArray(value.localRules) ? value.localRules.slice(0, 100).map((r, i) => {
    const id = String(r.id || `local_rule_${i + 1}`).trim();
    const name = netcareRedactText(String(r.name || `规则 ${i + 1}`).trim().slice(0, 100));
    const sectionNumber = String(r.sectionNumber || '').trim().slice(0, 40);
    const sectionTitle = netcareRedactText(String(r.sectionTitle || '').trim().slice(0, 200));
    const kind = ['text', 'attachments'].includes(r.kind) ? r.kind : 'all';
    const pattern = String(r.pattern || '').trim().slice(0, 1000);
    if (pattern) {
      try { new RegExp(pattern, 'i'); }
      catch (e) { throw new Error(`本地审计规则【${name}】正则表达式无效: ${e.message}`); }
    }
    const passCondition = r.passCondition === 'not_match' ? 'not_match' : 'match';
    const passSummary = netcareRedactText(String(r.passSummary || '符合要求 / Compliant').trim().slice(0, 500));
    const failSummary = netcareRedactText(String(r.failSummary || '不符合要求，需人工核查 / Non-compliant').trim().slice(0, 500));
    const enabled = r.enabled !== false;
    return { id, name, sectionNumber, sectionTitle, kind, pattern, passCondition, passSummary, failSummary, enabled };
  }) : netcareDefaultLocalRules();
  return { autoSelectSanitizedPlan: value.autoSelectSanitizedPlan !== false, pipBetaEnabled:value.pipBetaEnabled===true, closeAfterAudit, titleFallbackEnabled:value.titleFallbackEnabled===true, aiAuditEnabled, disableLocalRules: aiAuditEnabled && value.disableLocalRules === true, concurrency: Number.isInteger(value.concurrency) && value.concurrency >= 1 && value.concurrency <= 10 ? value.concurrency : 3, openOnline: value.openOnline !== false, screenshotsEnabled, embedScreenshotsInExcel,
    attachmentsEnabled, textEnabled,
    intervalMs: Math.max(1000, Math.min(30000, Number(value.intervalMs) || 1500)),
    attachmentAuditTypes, sections, localRules };
}
function netcareEvaluateLocalRule(settings, item) {
  const rules = (settings?.localRules || []).filter(r => r && r.enabled && r.pattern);
  if (!rules.length) return null;
  const itemSectionTitle = item.sectionTitle || settings?.sections?.find(s => s.number === item.section || s.number === item.ruleSection)?.title || '';
  const matches = rules.filter(r => {
    const ruleKind = ['text', 'attachments'].includes(r.kind) ? r.kind : 'all';
    if (ruleKind !== 'all' && ruleKind !== item.kind) return false;
    const numMatch = !r.sectionNumber || item.section === r.sectionNumber || item.ruleSection === r.sectionNumber || (item.section && item.section.startsWith(r.sectionNumber + '.'));
    if (r.sectionNumber && !numMatch) return false;
    const titleMatch = !r.sectionTitle || (itemSectionTitle && (itemSectionTitle.toLowerCase().includes(r.sectionTitle.toLowerCase()) || r.sectionTitle.toLowerCase().includes(itemSectionTitle.toLowerCase())));
    if (r.sectionTitle && !r.sectionNumber && !titleMatch) return false;
    if (r.sectionTitle && r.sectionNumber && itemSectionTitle && !titleMatch) return false;
    return numMatch || titleMatch;
  });
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const aScore = (a.sectionNumber ? 2 : 0) + (a.sectionTitle ? 1 : 0);
    const bScore = (b.sectionNumber ? 2 : 0) + (b.sectionTitle ? 1 : 0);
    return bScore - aScore;
  });
  const rule = matches[0];
  let regex;
  try { regex = new RegExp(rule.pattern, 'i'); }
  catch { return null; }
  const text = String(item.text || '');
  const matched = regex.test(text);
  const isPass = rule.passCondition === 'not_match' ? !matched : matched;
  const status = isPass ? 'pass' : 'fail';
  const summaryZh = `[本地规则回退] ${rule.name}: ${isPass ? (rule.passSummary || '符合要求') : (rule.failSummary || '未满足关键词要求，需人工核查')}`;
  const summaryEn = `[Local rule fallback] ${rule.name}: ${isPass ? 'Passed local rule' : 'Failed local rule'}`;
  const findings = isPass ? [] : [summaryZh];
  const findingsI18n = isPass ? [] : [{ zh: summaryZh, en: summaryEn }];
  return {
    status,
    summary: `${summaryZh} / ${summaryEn}`,
    summaryI18n: { zh: summaryZh, en: summaryEn },
    findings,
    findingsI18n,
    rule: `[本地规则 / Local rule] ${rule.name} (Regex: ${rule.pattern})`,
    model: 'local-rule-fallback',
    fallback: true
  };
}
function netcareExportSettings(settings) {
  return JSON.stringify({ format: 'netcare-rfc-settings', version: 1, settings: netcareNormalizeSettings(settings) }, null, 2);
}
function netcareImportSettings(text) {
  if (text.length > 2097152) throw new Error('配置文件超过2MB / File too large');
  const data = JSON.parse(text);
  if (data?.format !== 'netcare-rfc-settings' || data.version !== 1) throw new Error('不支持的配置格式或版本 / Unsupported configuration');
  return netcareNormalizeSettings(data.settings);
}
function netcareCompareSectionNumbers(a,b){
  const left=a.split('.').map(BigInt),right=b.split('.').map(BigInt);
  for(let i=0;i<Math.min(left.length,right.length);i++){if(left[i]!==right[i])return left[i]<right[i]?-1:1;}return left.length-right.length;
}
function netcareNextSectionNumber(sections,parent=''){
  let max=0n;const prefix=parent?parent+'.':'',level=parent?parent.split('.').length:0;
  for(const row of sections){if(!/^\d+(\.\d+)*$/.test(row.number)||parent&&!row.number.startsWith(prefix))continue;const part=row.number.split('.')[level];if(part!==undefined&&BigInt(part)>max)max=BigInt(part);}
  return prefix+String(max+1n);
}
// Preserve explicit child drafts; inherited values are computed rather than persisted.
function netcareEffectiveSection(settings, number) {
  const rows=settings.sections||[], own=rows.find(r=>r.number===number);
  const ancestors=rows.filter(r=>number.startsWith(r.number+'.')).sort((a,b)=>a.number.split('.').length-b.number.split('.').length);
  const result={number,title:own?.title||'',...own};
  for(const kind of ['attachments','text']) {
    const source=ancestors.find(r=>r[kind+'Prompt']?.trim());
    result[kind+'Prompt']=source?.[kind+'Prompt']||own?.[kind+'Prompt']||'';
    result[kind]=!!result[kind+'Prompt']||!!own?.[kind]||ancestors.some(r=>r[kind]||r[kind+'Prompt']?.trim());
  }
  return result;
}
function netcareSectionMatches(settings, number, kind) {
  return !!netcareEffectiveSection(settings,number)[kind];
}
function netcareNormalizeSectionTitle(value) {
  return String(value||'').normalize('NFKC').toLowerCase().replace(/^\s*\d+(?:\.\d+)*[.、)\s]+/,'').replace(/[\s\p{P}\p{S}]+/gu,'');
}
function netcareResolveTopics(settings, catalogue) {
  const resolved=new Map(),issues=[];
  const add=(topic,rule,kind,correction)=>{let item=resolved.get(topic.number);if(!item){item={...topic,ruleNumbers:[],ruleNumbersByKind:{text:[],attachments:[]},correctionsByKind:{text:[],attachments:[]}};resolved.set(topic.number,item);}if(!item.ruleNumbers.includes(rule.number))item.ruleNumbers.push(rule.number);item.ruleNumbersByKind[kind].push(rule.number);if(correction)item.correctionsByKind[kind].push(correction);};
  for(const kind of ['text','attachments']) {
    if(!settings[kind+'Enabled'])continue;
    const rules=settings.sections.filter(r=>netcareSectionMatches(settings,r.number,kind));
    // Resolve a selected parent once; inherited children stay in its actual subtree.
    const roots=rules.filter(r=>!rules.some(parent=>r.number.startsWith(parent.number+'.')));
    for(const rule of roots) {
      const atNumber=catalogue.find(t=>t.number===rule.number),expected=netcareNormalizeSectionTitle(rule.title);
      const exact=catalogue.filter(t=>t.number===rule.number||t.number.startsWith(rule.number+'.'));
      const mismatch=!!atNumber&&netcareNormalizeSectionTitle(atNumber.title)!==expected;
      if(exact.length&&(!settings.titleFallbackEnabled||!mismatch)){exact.forEach(t=>add(t,rule,kind));continue;}
      if(!settings.titleFallbackEnabled)continue;
      let candidates=catalogue.filter(t=>expected&&netcareNormalizeSectionTitle(t.title)===expected);
      const sameDepth=candidates.filter(t=>t.number.split('.').length===rule.number.split('.').length);if(sameDepth.length)candidates=sameDepth;
      const parent=rule.number.split('.').slice(0,-1).join('.'),sameParent=candidates.filter(t=>t.number.split('.').slice(0,-1).join('.')===parent);if(candidates.length>1&&sameParent.length)candidates=sameParent;
      if(candidates.length!==1){issues.push({number:rule.number,kind,error:candidates.length?'同名章节无法唯一定位 / Multiple matching section titles; cannot select uniquely':'未找到预期名称的章节 / Expected section title not found',fromNumber:atNumber?.number||rule.number,fromTitle:atNumber?.title||''});continue;}
      const found=candidates[0],correction={ruleNumber:rule.number,ruleTitle:rule.title,fromNumber:rule.number,fromTitle:atNumber?.title||'',toNumber:found.number,toTitle:found.title,reason:mismatch?'title_mismatch':'missing_number'};
      catalogue.filter(t=>t.number===found.number||t.number.startsWith(found.number+'.')).forEach(t=>add(t,rule,kind,correction));
    }
  }
  const topics=catalogue.filter(t=>resolved.has(t.number)).map(t=>resolved.get(t.number));topics.resolutionIssues=issues;return topics;
}
function netcareAuditSectionText(report,language='zh') {
  const label=`${report.section||''} ${report.sectionTitle||''}`.trim();
  const tr=(zh,en)=>language==='en'?en:zh;
  return [label+(report.noAttachments?tr(' · 无附件',' · No attachments'):''),...(report.corrections||[]).map(c=>`${tr('预期','Expected')}: ${c.ruleNumber} ${c.ruleTitle}\n${tr('原章节','Original')}: ${c.fromNumber} ${c.fromTitle||tr('未找到','Not found')}\n→ ${tr('纠正为','Corrected')}: ${c.toNumber} ${c.toTitle}`)].join('\n\n');
}
function netcareTopicRule(settings, topic, kind) {
  if(!topic.ruleNumbers)return netcareEffectiveSection(settings,topic.number||topic.section);
  const numbers=topic.ruleNumbersByKind?.[kind]||topic.ruleNumbers;
  return numbers.map(n=>netcareEffectiveSection(settings,n)).find(r=>r[kind+'Prompt'])||numbers.map(n=>netcareEffectiveSection(settings,n)).find(r=>r[kind])||{};
}
function netcareAutoCloseReason({settings,reports,failed,cached,published,aborted}) {
  if(aborted)return '任务已停止 / Task stopped';
  if(!settings.aiAuditEnabled)return '未开启 AI 审计 / AI audit is disabled';
  if(!reports.length)return '没有执行审计项 / No audit checks were run';
  if(failed)return `提取或材料缓存有 ${failed} 处错误，请查看清单 / ${failed} extraction or cache errors; see manifest`;
  if(!cached)return '审计暂存失败 / Audit cache failed';
  const error=reports.find(r=>r.error);
  if(error){const summary=String(error.summary||'审计异常 / Audit error').slice(0,300);return (error.section&&!summary.startsWith(error.section)?error.section+' · ':'')+summary;}
  if(!published)return '汇总或快照未确认保存 / Result or snapshot saving was not confirmed';
  return '';
}

function netcareAuditOwner(settings, number, kind) {
  return settings.sections.filter(r=>(number===r.number||number.startsWith(r.number+'.'))&&(r[kind]||r[kind+'Prompt']?.trim())).sort((a,b)=>a.number.split('.').length-b.number.split('.').length)[0]?.number||number;
}
function netcareAuditRule(settings, number, kind) {
  const own=netcareEffectiveSection(settings,number)[kind+'Prompt'];if(own)return own;
  const seen=new Set();return settings.sections.filter(r=>r.number.startsWith(number+'.')).map(r=>({number:r.number,rule:netcareEffectiveSection(settings,r.number)[kind+'Prompt']})).filter(r=>r.rule&&!seen.has(r.rule)&&seen.add(r.rule)).map(r=>r.number+': '+r.rule).join('\n');
}
function netcareGroupAuditItems(items,settings) {
  const groups=new Map();
  for(const item of items){
    const number=netcareAuditOwner(settings,item.ruleSection||item.section,item.kind),rule=netcareAuditRule(settings,number,item.kind);if(!rule)continue;
    const key=number+':'+item.kind;let group=groups.get(key);
    if(!group){const row=settings.sections.find(r=>r.number===number);group={section:number,ruleSection:number,sectionTitle:row?.title||item.sectionTitle||'',corrections:[],kind:item.kind,filename:number+' · '+(item.kind==='text'?'章节汇总 / Section evidence':'附件汇总 / Attachment evidence'),sources:[],parts:[],errors:[]};groups.set(key,group);}
    for(const correction of item.corrections||[])if(!group.corrections.some(c=>JSON.stringify(c)===JSON.stringify(correction)))group.corrections.push(correction);
    group.sources.push({section:item.section,kind:item.kind,filename:item.filename});
    if(item.notApplicable===true)continue;
    if(item.error||!item.text?.trim())group.errors.push(item.section+' · '+item.filename+': '+(item.error||'文本为空 / Empty text'));
    else group.parts.push('['+item.section+' '+(item.sectionTitle||'')+' · '+item.filename+']\n'+item.text);
  }
  const result = [...groups.values()].map(({parts,errors,...group})=>({...group,text:parts.join('\n\n'),notApplicable:!parts.length&&!errors.length,error:errors.length?errors.join('\n'):undefined}));
  return result.sort((a,b)=>{
    let cmp=0;
    try{cmp=netcareCompareSectionNumbers(a.section,b.section);}catch{}
    if(cmp!==0)return cmp;
    const rank=k=>k==='text'?0:1;
    return rank(a.kind)-rank(b.kind);
  });
}

function netcareRedactText(value) {
  return String(value).replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]').replace(/(["']?(?:password|passwd|token|api[_ -]?key|secret|authorization|cookie)["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,&;]+)/gi,'$1[REDACTED]')
    .replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]');
}
// Temporary audit evidence only; keys never enter site storage. Bounded to 2MB/5 RFCs/24h.
function netcareCacheAudit(storage, order, items, reports) {
  const key = 'tpNetcareAuditCacheV1', now = Date.now(); let records = [];
  try { records = JSON.parse(storage.getItem(key) || '[]'); } catch {}
  if (!Array.isArray(records)) records = [];
  records = records.filter(r => r && r.order !== order && Number.isFinite(r.created) && now-r.created < 86400000);
  items = items.map(item=>({...item,text:item.text==null?undefined:netcareRedactText(item.text)}));
  records.push({ order, created: now, items, reports }); records = records.slice(-5);
  const encoder = new TextEncoder();
  while (records.length > 1 && encoder.encode(JSON.stringify(records)).length > 2097152) records.shift();
  const value = JSON.stringify(records); if (encoder.encode(value).length > 2097152) throw new Error('审计暂存超过2MB限制');
  storage.setItem(key,value);
}
async function netcareRunAudits(items, settings, request, signal, progress, trace=()=>{}, promptRetry=null, topLog=null) {
  const reports=[];
  if(!settings.aiAuditEnabled)return reports;
  for (const item of netcareGroupAuditItems(items,settings)) {
    if (signal.aborted) throw new Error('已停止 / Stopped');
    const row=netcareEffectiveSection(settings,item.ruleSection||item.section), rule=netcareAuditRule(settings,item.section,item.kind);
    if (!rule) continue;
    const result={section:item.section,kind:item.kind,filename:item.filename,sources:item.sources,sectionTitle:item.sectionTitle||row.title,corrections:item.corrections||[],rule:netcareRedactText(rule),status:'needs_review'};
    trace('audit.evidence',{section:item.section,sectionTitle:result.sectionTitle,kind:item.kind,rule:result.rule,sources:item.sources,corrections:result.corrections,characters:item.text?.length||0,preview:item.text?.slice(0,600),error:item.error});
    if(item.notApplicable){reports.push({...result,status:'not_applicable',notApplicable:true,summary:'',findings:[]});continue;}
    if (item.error) {result.summary=item.error;result.error=true;reports.push(result);continue;}
    if (!item.text?.trim() || item.text.length>60000) {result.summary='文本为空或超过60000字符，未提交模型 / Empty text or exceeds 60000 characters';result.error=true;reports.push(result);continue;}
    progress(`${item.section} · ${item.filename}`);
    let auditAttempt = 0;
    while (!signal.aborted) {
      auditAttempt++;
      try {
        if (topLog && auditAttempt > 1) {
          topLog('info', `正在重试 AI 接口 (第 ${auditAttempt} 次) -> 章节: ${item.section} · ${item.filename}`);
        }
        const reply = await request(item, signal);
        if (!reply?.ok) {
          result.diagnostics = reply?.diagnostics;
          throw new Error(reply?.error || 'AI request failed');
        }
        Object.assign(result, reply.report, { model: reply.model });
        if (topLog && (auditAttempt > 1 || settings.disableLocalRules)) {
          const statusText = reply.report.status === 'pass' ? '通过' : reply.report.status === 'fail' ? '不合格' : '需复核';
          topLog('success', `章节 ${item.section} AI 审计成功: [${statusText} / ${reply.report.status.toUpperCase()}] ${reply.report.summary?.zh || reply.report.summary || ''}`);
        }
        break;
      } catch (error) {
        if (signal.aborted) throw error;
        if (topLog) {
          topLog('error', `章节 ${item.section} AI 接口请求失败: ${error.message}`);
        }
        if (settings.disableLocalRules && promptRetry) {
          const shouldRetry = await promptRetry({ section: item.section, filename: item.filename, error: error.message, attempt: auditAttempt });
          if (shouldRetry) {
            if (topLog) topLog('warn', `用户确认继续重试，正在重新请求 AI 接口...`);
            continue;
          }
        }
        const fallback = !settings.disableLocalRules ? netcareEvaluateLocalRule(settings, item) : null;
        if (fallback) {
          Object.assign(result, fallback);
          result.diagnostics = { ...(result.diagnostics || {}), fallback: true, fallbackRule: fallback.rule, aiError: error.message };
          trace('audit.fallback', 'AI 异常，已回退到本地审计规则 / Fallback to local rule on AI error', { section: item.section, rule: fallback.rule, status: fallback.status, aiError: error.message }, 'audit', fallback.status === 'pass' ? 'info' : 'warn');
        } else {
          result.summary = error.message;
          result.error = true;
          if (topLog && settings.disableLocalRules) {
            topLog('warn', `已禁用本地规则，章节 ${item.section} 标记为审计异常`);
          }
        }
        break;
      }
    }
    reports.push(result);
  }
  return reports;
}
async function netcareCaptureEvidence(element,renderer,signal){
  if(!element||!element.isConnected)throw Error('未定位到在线方案原始区域 / Original region not found');
  if(typeof renderer!=='function')throw Error('截图组件未加载，请更新扩展并重新打开方案 / Renderer missing');
  if(signal.aborted)throw Error('已停止 / Stopped');
  const bounds=element.getBoundingClientRect(),width=Math.ceil(Math.max(bounds.width,element.scrollWidth)),height=Math.ceil(Math.max(bounds.height,element.scrollHeight));
  if(!width||!height||width>6000||height>30000||width*height>24000000)throw Error('区域过大或不可见，截图未保存 / Region exceeds capture limit');
  let canvas;const containers=new Set(element.ownerDocument.querySelectorAll?.('iframe.html2canvas-container')||[]);
  const images=[];
  try{let timer;
    const sFn=typeof setTimeout==='function'?setTimeout:(typeof globalThis!=='undefined'&&typeof globalThis.setTimeout==='function'?globalThis.setTimeout:null);
    const cFn=typeof clearTimeout==='function'?clearTimeout:(typeof globalThis!=='undefined'&&typeof globalThis.clearTimeout==='function'?globalThis.clearTimeout:null);
    const renderPromise=renderer(element,{scale:1,backgroundColor:'#ffffff',logging:false,useCORS:false,allowTaint:false,imageTimeout:5000,removeContainer:true,width,height});
    const timeoutPromise=new Promise((_,reject)=>{if(sFn){timer=sFn(()=>reject(Error('截图渲染超时 / Capture render timeout')),12000);signal?.addEventListener?.('abort',()=>{if(cFn&&timer)cFn(timer);reject(Error('已停止 / Stopped'));},{once:true});}});
    try{canvas=await Promise.race([renderPromise,timeoutPromise]);}finally{if(cFn&&timer)cFn(timer);}
    if(!canvas.width||!canvas.height)throw Error('截图画布为空 / Empty capture canvas');
    for(let y=0;y<canvas.height;y+=1600){if(signal.aborted)throw Error('已停止 / Stopped');const page=element.ownerDocument.createElement('canvas');try{page.width=canvas.width;page.height=Math.min(1600,canvas.height-y);const context=page.getContext('2d');if(!context)throw Error('无法创建截图上下文 / Capture context unavailable');context.drawImage(canvas,0,y,page.width,page.height,0,0,page.width,page.height);const blob=await new Promise(resolve=>page.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG编码失败 / PNG encoding failed');images.push(blob);}finally{page.width=page.height=0;}}
    return images;
  }finally{if(canvas)canvas.width=canvas.height=0;for(const el of element.ownerDocument.querySelectorAll?.('iframe.html2canvas-container')||[])if(!containers.has(el))el.remove();}

}
function mountNetcareCollector() {
  const params = new URL(location.href).searchParams;
  const rawOrder = params.get('order_id') || params.get('docId') || params.get('id') || '';
  const order = /^NC\d{14}$/.test(rawOrder) ? rawOrder : (/^D(NC\d{14})$/i.test(rawOrder) ? rawOrder.slice(1).toUpperCase() : '');
  if (!/^NC\d{14}$/.test(order)) return;
  if (window.__netcareCollectorMounted) {
    console.warn('[NetCare] 采集浮窗已在当前页挂载，忽略重复挂载 / Collector already mounted');
    return;
  }
  window.__netcareCollectorMounted = true;
  window.__netcareCollectorCleanup?.();
  try {const cached=JSON.parse(localStorage.getItem('tpNetcareAuditCacheV1')||'[]');if(Array.isArray(cached))localStorage.setItem('tpNetcareAuditCacheV1',JSON.stringify(cached.filter(r=>r&&Date.now()-r.created<86400000)));}catch{}
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;width:min(540px,calc(100vw - 32px));z-index:2147483647';
  host.id = 'netcare-solution-collector';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>*{box-sizing:border-box}section{font:11px/1.6 system-ui;background:#fff;color:#243149;padding:20px;border:1px solid #dce3ed;border-radius:16px;box-shadow:0 20px 60px #0003;max-height:calc(100vh - 40px);overflow:auto}header{display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:650;margin-bottom:16px}header button{font-size:18px;padding:2px 10px;background:transparent!important;color:inherit!important}button,input{font:inherit}button{padding:9px 14px;border:1px solid #cdd8e7;border-radius:7px;background:#f2f6fb;color:#243149;cursor:pointer;margin:10px 5px 12px 0}#zip{background:#176ae6;color:#fff;border-color:#176ae6}button:disabled{opacity:.45;cursor:default}input[type=text]{width:100%;padding:9px 10px;background:transparent;color:inherit;border:1px solid #cdd8e7;border-radius:7px;margin:6px 0 2px}.list{max-height:180px;overflow:auto;border:1px solid #dce3ed;border-radius:8px;padding:10px;margin:8px 0;background:#f7f9fc}.list>div,.list>label{padding:4px 0;border-bottom:1px solid #cdd8e733}label{display:block}input[type=checkbox]{vertical-align:middle;margin-right:7px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 system-ui;max-height:145px;overflow:auto;background:#f2f6fb;border-radius:8px;padding:12px;margin:12px 0}details{margin-top:10px}summary{cursor:pointer;font-weight:550}#captureDiagnostics button{display:block;text-align:left;width:100%;margin:5px 0;color:#ae6b25}#captureErrorDialog,#aiRetryDialog{font:12px/1.7 system-ui;max-width:min(780px,calc(100vw - 32px));width:780px;max-height:calc(100vh - 32px);overflow:auto;padding:20px;background:#fff;color:#243149;border:1px solid #dce3ed;border-radius:14px}#aiRetryDialog{width:540px}#captureErrorDialog::backdrop,#aiRetryDialog::backdrop{background:#12223f77}#captureErrorDetails{max-height:calc(100vh - 240px)}#aiRetryConfirm{background:#176ae6!important;color:#fff!important;border-color:#176ae6!important}small{display:block;color:#7b8a9f;margin-top:14px;font-size:10px}@media(prefers-color-scheme:dark){section{background:#182235;color:#e3eaf5;border-color:#314058}button,input[type=text],.list{background:#202d42;color:#e3eaf5;border-color:#314058}pre{background:#111c2d}#captureErrorDialog,#aiRetryDialog{background:#182235;color:#e3eaf5;border-color:#314058}}
</style><section><header><span>方案附件与章节 / Solution bundle</span><button id="close" aria-label="关闭采集浮窗">×</button></header><div>${order}</div><label>方案文件名 / Word filename<input id="filename" type="text" aria-label="方案文件名" placeholder="等待 Word 下载文件名，或手动填写"></label><button id="scan" disabled>扫描全部章节 / Scan</button><button id="zip" disabled>下载 ZIP / Download</button><button id="stop" disabled>停止 / Stop</button><details open><summary id="count">附件 / Attachments</summary><div id="files" class="list">尚未扫描 / Not scanned</div></details><details><summary>选择提取章节 / Select sections</summary><label><input id="all" type="checkbox">全部章节 / All sections</label><div id="chapters" class="list"></div></details><pre id="status" role="status">正在等待在线方案加载…</pre><div id="captureDiagnostics" hidden></div><details><summary>AI 审计 / Audit</summary><pre id="auditStatus">未开启 / Disabled</pre></details><small>按原生目录读取全部章节。ZIP 文件名与 Word 一致；扫描/下载错误会列入清单，不提交评审。 / Reads all native sections; errors are listed.</small></section><dialog id="captureErrorDialog"><header><span>截图诊断 / Screenshot diagnostics</span><button id="captureErrorClose">×</button></header><pre id="captureErrorDetails" data-user-content></pre><button id="captureRetry">重新提取并生成新 ZIP / Extract again and create a new ZIP</button></dialog><dialog id="aiRetryDialog"><header><span>AI 接口重试确认 / AI Audit Retry Confirmation</span><button id="aiRetryClose">×</button></header><div id="aiRetryPrompt" style="margin:12px 0;line-height:1.6"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button id="aiRetrySkip">跳过此项 / Skip</button><button id="aiRetryConfirm" class="primary">继续重试 / Retry</button></div></dialog>`;
  document.body.append(host);
  const topLogHost = document.createElement('div');
  topLogHost.id = 'netcare-top-log-hud';
  topLogHost.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;max-height:220px;overflow-y:auto;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);color:#e2e8f0;padding:10px 16px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;box-shadow:0 4px 16px rgba(0,0,0,0.4);border-bottom:1px solid rgba(255,255,255,0.15);z-index:2147483647';
  topLogHost.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px"><strong style="color:#38bdf8;font-size:12px">⚡ AI 审计请求与重试日志 / AI Audit Live Logs</strong><div style="display:flex;gap:6px"><button id="netcareTopLogClear" style="padding:2px 8px;font-size:10px;background:rgba(255,255,255,0.1);color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;cursor:pointer">清空 / Clear</button><button id="netcareTopLogClose" style="padding:2px 8px;font-size:10px;background:rgba(255,255,255,0.1);color:#e2e8f0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;cursor:pointer">收起 / Close</button></div></div><div id="netcareTopLogList" style="white-space:pre-wrap;word-break:break-word;font-size:11px;font-family:inherit"></div>`;
  document.body.append(topLogHost);
  const topLogList = topLogHost.querySelector('#netcareTopLogList');
  topLogHost.querySelector('#netcareTopLogClose').onclick = () => { topLogHost.style.display = 'none'; };
  topLogHost.querySelector('#netcareTopLogClear').onclick = () => { topLogList.textContent = ''; };
  function appendTopLog(level, message) {
    if (!topLogHost || !topLogList) return;
    topLogHost.style.display = 'block';
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
    const levelColors = { info: '#38bdf8', warn: '#fbbf24', error: '#f87171', success: '#4ade80' };
    const color = levelColors[level] || '#e2e8f0';
    const row = document.createElement('div');
    row.style.cssText = 'padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:8px;font-family:ui-monospace,monospace';
    const tSpan = document.createElement('span');
    tSpan.style.color = 'rgba(255,255,255,0.45)';
    tSpan.textContent = `[${timeStr}]`;
    const tagSpan = document.createElement('span');
    tagSpan.style.cssText = `color:${color};font-weight:600;min-width:65px`;
    tagSpan.textContent = `[${level.toUpperCase()}]`;
    const mSpan = document.createElement('span');
    mSpan.style.flex = '1';
    mSpan.textContent = message;
    row.append(tSpan, tagSpan, mSpan);
    topLogList.append(row);
    topLogHost.scrollTop = topLogHost.scrollHeight;
  }
  const $ = id => root.getElementById(id);
  let controller, topics = [], attachments = [], dirtyName = false, cleanScan = false,lastAutomatic=false, taskActive = true;const captureDiagnostics=[];
  let downloadInProgress = false, downloadCompleted = false;
  const isTaskRunning = () => !!controller || taskActive || downloadInProgress;
  function updateCollectorButtons() {
    const running = isTaskRunning();
    $('scan').disabled = running;
    $('zip').disabled = running || !scanFinished;
    $('stop').disabled = !controller;
  }
  const controls=globalThis.createNetcareControls?.().source(root,{redact:netcareRedactText});
  function renderCaptureDiagnostics(){const list=$('captureDiagnostics');list.hidden=!captureDiagnostics.length;list.replaceChildren();for(const item of captureDiagnostics){const button=document.createElement('button');button.className='capture-diagnostic';button.textContent=(item.outcome==='failed'?'截图失败 / Capture failed':'截图已恢复 / Capture recovered')+' · '+item.name;button.onclick=()=>{const tr=(zh,en)=>collectorUiLanguage==='en'?en:zh,text=value=>String(value||'').split(' / ')[collectorUiLanguage==='en'?1:0]||String(value||'');$('captureErrorDetails').textContent=[tr('单号','RFC')+': '+order,tr('截图位置','Capture location')+': '+item.name,tr('时间','Time')+': '+item.at,tr('最终结果','Outcome')+': '+(item.outcome==='failed'?tr('失败','Failed'):item.method==='reconstructed'?tr('内容重建截图（非页面原图）','Reconstructed native content (not a live-page screenshot)'):tr('原始区域截图成功','Live original capture succeeded')),tr('错误码','Error code')+': '+(item.code||'—'),text(item.message),...(item.navigations||[]).map(n=>tr('目录定位','Directory navigation')+' · '+n.attempt+' · '+n.action+' · '+n.number+' '+n.title+'\n'+text(n.message)),...item.attempts.map(a=>[tr('尝试','Attempt')+' '+a.attempt+' · '+a.stage+' · '+(a.code||'OK'),text(a.message),tr('已渲染章节数','Rendered sections')+': '+(a.articles??'—'),tr('区域尺寸与连接状态','Region size and attachment')+': '+JSON.stringify(a.bounds||null),a.stack||''].filter(Boolean).join('\n')),tr('建议：确认章节已加载和目录名称；刷新方案后重新提取。详情也保存在 ZIP 的截图诊断.json 和插件日志中。','Check section loading and native titles; refresh and extract again. Diagnostics also appear in the ZIP and plugin logs.')].filter(Boolean).join('\n\n');$('captureRetry').disabled=!!controller;$('captureErrorDialog').showModal();};list.append(button);} }
  let collectorUiLanguage='zh';
  $('captureErrorClose').onclick=()=>$('captureErrorDialog').close();$('captureRetry').onclick=()=>{$('captureErrorDialog').close();download(lastAutomatic);};
  const aiRetryDialog = $('aiRetryDialog');
  $('aiRetryClose').onclick = () => aiRetryDialog.close();
  function promptAiRetry({ section, filename, error, attempt }) {
    return new Promise(resolve => {
      if (!aiRetryDialog) return resolve(false);
      const promptEl = $('aiRetryPrompt');
      promptEl.innerHTML = `<div><strong>章节 / Section:</strong> ${section} (${filename || ''})</div><div style="margin-top:6px;color:#d9534f"><strong>AI 错误 / Error:</strong> ${netcareRedactText(error)}</div><div style="margin-top:10px;font-size:11px;color:#64748b">已开启【禁用本地审计规则】，未回退到本地规则（当前已尝试 ${attempt} 次）。<br>点击<strong>“继续重试”</strong>将再次向 AI 接口发起请求，并在页面顶部实时滚动日志；点击<strong>“跳过此项”</strong>将标记该项为审计异常并继续后续章节。</div>`;
      const onConfirm = () => { cleanup(); resolve(true); };
      const onSkip = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        $('aiRetryConfirm').onclick = null;
        $('aiRetrySkip').onclick = null;
        $('aiRetryClose').onclick = () => aiRetryDialog.close();
        aiRetryDialog.oncancel = null;
        aiRetryDialog.close();
      };
      $('aiRetryConfirm').onclick = onConfirm;
      $('aiRetrySkip').onclick = onSkip;
      $('aiRetryClose').onclick = onSkip;
      aiRetryDialog.oncancel = event => { event.preventDefault(); onSkip(); };
      aiRetryDialog.showModal();
    });
  }

  const selected = new Set(), blobs = new Map(), slots = new Map(), aiRequests = new Map();
  const collectorLanguage=globalThis.createNetcareLanguage?.(root,'zh');
  const healthSampler=globalThis.createNetcareMonitor?.().sample({send:metric=>netcareArtifactRequest({action:'metric',order,metric})});
  let generationAt=Date.now(),batchId=0;let settings = netcareDefaultSettings(), settingsReady = false, scanFinished = false, autoAttempted = false;
  const maybeAuto = () => {
    if (settingsReady && scanFinished && !controller && !downloadInProgress && !autoAttempted && !downloadCompleted && (settings.attachmentsEnabled || settings.textEnabled) && $('filename').value.trim()) {
      autoAttempted = true; taskActive = true; updateCollectorButtons(); download(true);
    }
  };
  const trace=(action,message,data={},category='extraction',level='info')=>netcareLog({order,generationAt,batchId,category,level,action,message,data});
  const unwireOperations=netcareWireOperations(root,()=>({order,generationAt,batchId}));
  const status = text => { $('status').textContent = text;trace('extraction.progress',text,{},'extraction','debug'); };
  let previewBusy=false;
  const receive = event => {
    if (event.data?.source === 'TP_RFC_EXTENSION_CONFLICT') {
      trace('system.conflict', '检测到多个插件版本冲突 / Extension ID conflict detected', event.data, 'system', 'warn');
      status($('status').textContent + `\n⚠️ 检测到多版本插件冲突（ID: ${event.data.currentId} 与 ${event.data.activeId}）。请在 chrome://extensions 中仅保留一个最新版本，避免 AI 鉴权异常与重复下载！`);
      return;
    }
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_COLLECTOR_REQUEST'&&event.data.order===order&&/^[a-f0-9-]{36}$/.test(event.data.id||'')){const request=event.data;try{if(!settingsReady||!settings.pipBetaEnabled||!controls)throw Error('在线控制尚未启用 / Live controls unavailable');const data=request.action==='control'?controls.execute(request.command):controls.snapshot();window.postMessage({source:'TP_RFC_COLLECTOR_RESULT',id:request.id,order,ok:true,data},location.origin);}catch(e){window.postMessage({source:'TP_RFC_COLLECTOR_RESULT',id:request.id,order,ok:false,error:e.message},location.origin);}return;}
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_PIP_CAPTURE'&&event.data.order===order&&/^[a-f0-9-]{36}$/.test(event.data.id||'')){
      const request=event.data;let locked=false;
      (async()=>{try{if(!settingsReady||!settings.pipBetaEnabled)throw Error('Beta 预览未开启 / Beta preview is disabled');if(previewBusy)throw Error('预览正在更新 / Preview is updating');previewBusy=true;locked=true;
        const component=globalThis.createNetcarePip?.();if(!component)throw Error('预览组件尚未连接 / Preview component missing');const data=await component.capture(window,{delta:request.delta,reset:request.reset,large:request.large});
        window.postMessage({source:'TP_RFC_PIP_CAPTURE_RESULT',id:request.id,order,ok:true,data},location.origin);
      }catch(e){window.postMessage({source:'TP_RFC_PIP_CAPTURE_RESULT',id:request.id,order,ok:false,error:e.message},location.origin);}finally{if(locked)previewBusy=false;}})();return;
    }
    if (event.source === window && event.origin === location.origin && event.data?.source === 'EXTENSION_POPUP' && event.data.action === 'STOP') { cleanup(); return; }
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'TP_RFC_COLLECTOR_NAME' || event.data.order !== order) return;
    if (event.data.loaded === true) {
      if(!settingsReady&&Number.isFinite(event.data.generationAt))generationAt=event.data.generationAt;batchId=Number(event.data.batchId)||batchId;
      collectorUiLanguage=event.data.language==='en'?'en':'zh';collectorLanguage?.set(collectorUiLanguage);
      try { const nextSettings=netcareNormalizeSettings(event.data.settings || netcareDefaultSettings()),changed=!settingsReady||JSON.stringify(nextSettings)!==JSON.stringify(settings);settings=nextSettings;settingsReady=true;if(changed){trace('collector.ready','在线方案已连接 / Solution connected',{filename:event.data.filename,preferences:{autoSelectSanitizedPlan:settings.autoSelectSanitizedPlan,concurrency:settings.concurrency,intervalMs:settings.intervalMs,aiAuditEnabled:settings.aiAuditEnabled,attachmentsEnabled:settings.attachmentsEnabled,textEnabled:settings.textEnabled,screenshotsEnabled:settings.screenshotsEnabled,closeAfterAudit:settings.closeAfterAudit,titleFallbackEnabled:settings.titleFallbackEnabled,pipBetaEnabled:settings.pipBetaEnabled}},'configuration');for(const section of settings.sections.filter(r=>r.text||r.attachments||r.textPrompt||r.attachmentsPrompt))trace('rule.applied','当前章节规则 / Applied section rule',section,'configuration');} } catch { status('提取设置无效，请回主浮窗重新保存'); return; }
      if (!scanFinished) { selected.clear(); if (settings.textEnabled) settings.sections.filter(row => row.text).forEach(row => selected.add(row.number)); }
    }
    if (!dirtyName && typeof event.data.filename === 'string' && event.data.filename.endsWith('.docx')) $('filename').value = event.data.filename;
    maybeAuto();
  };
  window.addEventListener('message', receive);
  const getName = () => window.postMessage({ source: 'TP_RFC_COLLECTOR_GET_NAME', order }, location.origin);
  const nameTimer = setInterval(getName, 2500); getName();
  $('filename').oninput = () => { dirtyName = true; };
  const receiveSlot = event => {
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_CLOSE_RESULT'&&event.data.order===order&&!event.data.ok){status($('status').textContent+'\n自动关闭未完成 / Automatic close failed: '+(event.data.error||'扩展连接失败 / Extension unavailable'));return;}
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_AUDIT_PUBLISHED'&&event.data.order===order&&(!event.data.ok||event.data.snapshotError)){$('auditStatus').textContent+='\n'+(event.data.snapshotError?'快照保存失败：'+event.data.snapshotError:'主页面汇总失败：'+event.data.error);return;}
    if(event.source===window && event.origin===location.origin && event.data?.source==='TP_RFC_AI_RESULT') { aiRequests.get(event.data.id)?.resolve(event.data); return; }
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'TP_RFC_READ_SLOT_RESULT') return;
    const slot = slots.get(event.data.id); if (slot) event.data.ok ? slot.resolve() : slot.reject(new Error(event.data.error || '请求节流连接失败'));
  };
  window.addEventListener('message', receiveSlot);
  const throttle = signal => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const finish = (fn, value) => { clearTimeout(timer); slots.delete(id); signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, new Error('已停止 / Stopped'));
    const timer = setTimeout(() => finish(reject, new Error('请求节流连接超时，请重新启动扩展')), 120000);
    slots.set(id, { resolve: () => finish(resolve), reject: error => finish(reject, error) });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else window.postMessage({ source: 'TP_RFC_READ_SLOT', id, order, intervalMs: settings.intervalMs }, location.origin);
  });
  const requestAudit = (item, signal) => new Promise((resolve, reject) => {
    const id=crypto.randomUUID();
    const finish=(fn,value)=>{clearTimeout(timer);aiRequests.delete(id);signal.removeEventListener('abort',abort);fn(value);};
    const abort=()=>{window.postMessage({source:'TP_RFC_AI_CANCEL',id,order},location.origin);finish(reject,new Error('已停止 / Stopped'));};
    const timer=setTimeout(()=>finish(reject,new Error('AI审计请求超时 / Timed out')),70000);
    aiRequests.set(id,{resolve:reply=>finish(resolve,reply)});signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)return abort(); window.postMessage({source:'TP_RFC_AI_AUDIT',id,order,section:item.section,ruleSection:item.ruleSection,kind:item.kind,filename:item.filename,text:netcareRedactText(item.text)},location.origin);
  });
  const ensureActiveEnvironment = w => {
    if (!w || w.__netcareEnvActive) return;
    try {
      w.__netcareEnvActive = true;
      const nativeRaf = w.requestAnimationFrame?.bind(w);
      if (nativeRaf) {
        w.requestAnimationFrame = function(cb) {
          if (w.document?.hidden) return w.setTimeout(() => cb(w.performance?.now?.() || Date.now()), 16);
          return nativeRaf(cb);
        };
      }
      try {
        Object.defineProperty(w.document, 'hasFocus', {
          value: () => true,
          configurable: true,
          writable: true
        });
      } catch {}
    } catch {}
  };
  const activateTab = (durationMs = 12000, restoreOpener = true, mode = 'acquire') => new Promise(resolve => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 60000);
    const onMsg = e => {
      if (e.source === window && e.origin === location.origin && e.data?.source === 'TP_RFC_ACTIVATE_RESULT' && e.data.id === id) {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(e.data.ok === true);
      }
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ source: 'TP_RFC_ACTIVATE_REQUEST', id, order, mode, durationMs, restoreOpener }, location.origin);
  });
  const waitUntilVisible = async (w, maxMs = 800) => {
    const deadline = Date.now() + maxMs;
    while ((document.hidden || w?.document?.hidden) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
    }
    try {
      w?.dispatchEvent?.(new Event('resize'));
      w?.dispatchEvent?.(new Event('scroll'));
    } catch {}
  };
  let autoScrollTimer = null, autoScrollPaused = false;
  const startAutoScroll = w => {
    if (autoScrollTimer || !w) return;
    autoScrollPaused = false;
    autoScrollTimer = setInterval(() => {
      if (autoScrollPaused) return;
      try {
        const doc = w.document;
        if (!doc) return;
        const target = (globalThis.createNetcarePip?.()?.scrollTarget || (d => d.scrollingElement || d.documentElement || d.body))(doc);
        if (!target) return;
        const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
        if (maxScroll <= 10) return;
        if (target.scrollTop >= maxScroll - 15) {
          target.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          target.scrollBy({ top: 35, behavior: 'smooth' });
        }
        target.dispatchEvent(new Event('scroll', { bubbles: true }));
        doc.defaultView?.dispatchEvent(new Event('scroll'));
      } catch {}
    }, 350);
  };
  const stopAutoScroll = () => {
    if (autoScrollTimer) {
      clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
  };
  const editor = () => {
    try { const w = document.getElementById('appFrame')?.contentWindow;
      if (w?.editorApp?.Adapter && w.navigationTree?.FirstLevelTopics?.length) {
        ensureActiveEnvironment(w);
        return w;
      }
    } catch {} return null;
  };
  const loadTopic = (w, topic, signal) => new Promise((resolve, reject) => {
    const abort = () => finish(reject, new Error('已停止 / Stopped'));
    const timer = setTimeout(() => finish(reject, new Error(`章节 ${topic.number} 读取超时`)), 45000);
    const finish = (fn, value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); fn(value); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    try { w.editorApp.Adapter.GetTopicSync(topic.query, data => {
      if (!data?.XmlContent || !/<article\b/i.test(data.XmlContent)) finish(reject, new Error(`章节 ${topic.number} 正文无效或没有权限`));
      else {const doc=new DOMParser().parseFromString(data.XmlContent,'text/html');doc.netcareNativeXml=String(data.XmlContent).length<=1000000?String(data.XmlContent):'';finish(resolve,doc);}
    }); } catch (error) { finish(reject, error); }
  });
  const bodyText = doc => {
    const article = doc.querySelector('article');
    const cloned = article.cloneNode(true);
    cloned.querySelectorAll('script,style,button,[data-generate-editor]').forEach(e => e.remove());
    cloned.querySelectorAll('tr').forEach(row => {
      row.replaceWith(doc.createTextNode('\n' + Array.from(row.querySelectorAll('th,td')).map(cell => cell.textContent.trim()).join('\t') + '\n'));
    });
    cloned.querySelectorAll('p,h1,h2,h3,h4,li,div').forEach(e => e.append(doc.createTextNode('\n')));
    return cloned.textContent.replace(/↵/g, '').replace(/\n{3,}/g, '\n\n').trim();
  };
  async function scan(automatic = false) {
    if (controller) return;
    const w = editor(); if (!w) { status('方案尚未加载，稍后再扫描 / Wait for solution'); taskActive = false; updateCollectorButtons(); return; }
    if (!settingsReady) { getName(); status('正在等待默认设置 / Waiting for settings'); taskActive = false; updateCollectorButtons(); return; }
    startAutoScroll(w);
    controller = new AbortController(); const signal = controller.signal;
    scanFinished = false; taskActive = true; updateCollectorButtons();
    topics = netcareTopicCatalogue(w.navigationTree.FirstLevelTopics);
    if (automatic && (settings.attachmentsEnabled || settings.textEnabled)) topics = netcareResolveTopics(settings,topics);
    trace('sections.resolved','章节定位完成 / Sections resolved',{automatic,topics:topics.map(t=>({number:t.number,title:t.title,ruleNumbers:t.ruleNumbers,correctionsByKind:t.correctionsByKind})),issues:topics.resolutionIssues});
    attachments = []; cleanScan = false;
    $('files').replaceChildren(); $('chapters').replaceChildren();
    let errors = topics.resolutionIssues?.length||0;
    try {
      if (!topics.length) throw new Error(topics.resolutionIssues?.map(i=>i.number+' · '+i.error).join('\n')||'未识别到完整章节目录，请检查网站页面版本');
      for (const topic of topics) {
        if (signal.aborted) throw new Error('已停止 / Stopped');
        status(`扫描 ${topic.number} ${topic.title} / Scanning`);
        try {
          await throttle(signal);
          const doc = await loadTopic(w, topic, signal);
          topic.xml=doc.netcareNativeXml;topic.text = `${topic.number} ${topic.title}\n\n${bodyText(doc)}`;trace('section.read','章节正文提取完成 / Section text extracted',{number:topic.number,title:topic.title,characters:topic.text.length});
          const seen = new Set();
          for (const a of doc.querySelectorAll('a[data-hd-attachment="true"]')) {
            const href = a.getAttribute('data-hd-href') || a.getAttribute('href') || '';
            if (!/^x-wc:\/\/file=[a-z0-9_.-]+$/i.test(href)) { errors++; topic.error = '存在不支持的附件链接'; continue; }
            if (seen.has(href)) continue; seen.add(href);
            const item = { section: topic.number, name: a.textContent.trim() || href.split('=')[1], href, topic: topic.topic };
            attachments.push(item);
            const line = document.createElement('div'); line.textContent = `${topic.number} · ${item.name}`; $('files').append(line);
          }
        } catch (error) { if (signal.aborted) throw error; topic.error = error.message; errors++; }
        const label = document.createElement('label'), box = document.createElement('input'); box.type = 'checkbox';
        const required = settings.aiAuditEnabled && !!netcareTopicRule(settings,topic,'text').textPrompt;
        if(required)selected.add(topic.number);
        box.checked = selected.has(topic.number); box.disabled = !!topic.error || !!required;
        box.onchange = () => box.checked ? selected.add(topic.number) : selected.delete(topic.number);
        label.append(box, document.createTextNode(`${topic.number} ${topic.title}${topic.error ? ' · ERROR: ' + topic.error : ''}`)); $('chapters').append(label);
      }
      cleanScan = errors === 0; scanFinished = true;
      $('count').textContent = `附件 ${attachments.length} 个 / Attachments`;
      if (!attachments.length) $('files').textContent = '未发现附件 / No attachments found';
      status(`已扫描 ${topics.length} 章，发现 ${attachments.length} 个附件；${errors} 处扫描错误。可勾选章节并下载 ZIP。`);
    } catch (error) { status(error.message + '；扫描未完成，需重新扫描。'); }
    finally {
      controller = null;
      const pendingAuto = settingsReady && scanFinished && !autoAttempted && (settings.attachmentsEnabled || settings.textEnabled);
      const willAuto = pendingAuto && !!$('filename').value.trim();
      if (!pendingAuto) stopAutoScroll();
      taskActive = !!willAuto;
      updateCollectorButtons();
      maybeAuto();
    }
  }
  async function download(automatic = false) {
    if (controller || downloadInProgress) return;
    if (automatic && downloadCompleted) return;
    const filename = $('filename').value.trim();
    if (!filename) { getName(); status('请先完成 Word 下载，或填写对应 Word 文件名 / Enter Word filename'); taskActive = false; updateCollectorButtons(); return; }
    downloadInProgress = true;
    controller = new AbortController(); const signal = controller.signal;
    taskActive = true; updateCollectorButtons();
    const selection = automatic ? new Set(settings.textEnabled ? topics.filter(t=>netcareTopicRule(settings,t,'text').text).map(t=>t.number) : []) : new Set(selected);
    if(settings.aiAuditEnabled)topics.filter(t=>netcareTopicRule(settings,t,'text').textPrompt).forEach(t=>selection.add(t.number));
    const chosen = automatic ? attachments.filter(file => settings.attachmentsEnabled && netcareTopicRule(settings,topics.find(t=>t.number===file.section)||{number:file.section},'attachments').attachments) : attachments.filter(file => selection.has(file.section));
    const evidence = [], entries = [], used = new Set(), report = [`RFC: ${order}`, `Word: ${filename}`, `扫描完整: ${cleanScan}`, ''];
    report.push(`模式: ${automatic ? '按默认设置自动提取' : '手动全部附件与所选章节'}`);
    if(automatic)for(const topic of topics)for(const number of topic.ruleNumbers||[]){const rule=settings.sections.find(r=>r.number===number);report.push(`章节映射: ${number} ${rule?.title||''} -> ${topic.number} ${topic.title}`);}
    for (const number of selection) if (!topics.some(t => t.number === number)) report.push(`章节 MISSING: ${number}`);
    if (automatic && settings.attachmentsEnabled) for (const row of settings.sections.filter(row => row.attachments)) if (!topics.some(t => t.number === row.number||t.ruleNumbers?.includes(row.number))) report.push(`附件章节 MISSING: ${row.number}`);
    for(const issue of topics.resolutionIssues||[])report.push(`章节匹配 ERROR: ${issue.number} · ${issue.error}`);
    let failed = topics.filter(t => t.error).length+(topics.resolutionIssues?.length||0), attachmentSuccess=0;
    try {
      const w = editor(); if (!w) throw new Error('在线编辑器连接失效，请重新加载方案');
      startAutoScroll(w);
      const files=await netcareArtifactRequest({action:'list',order,orders:[order]}),word=files?.find(f=>f.name===filename);
      if(!word)throw Error('方案 Word 缓存缺失，请从主浮窗重新下载 / Word cache missing; download this RFC again');
      entries.push({name:filename,blob:await netcareReadArtifact(word,order,signal)});
      for (const topic of topics) {
        if (topic.error) report.push(`章节 ERROR: ${topic.number} ${topic.title}: ${topic.error}`);
        if (selection.has(topic.number) && topic.text && !topic.error) {
          const name = netcareUniqueFilename(netcareSafeFilename(`${topic.number}-${topic.title}.txt`), used);
          evidence.push({section:topic.number,kind:'text',filename:name,text:topic.text});
          entries.push({ name,section:topic.number,kind:'text',blob: new Blob(['\ufeff' + topic.text], { type: 'text/plain;charset=utf-8' }) }); report.push(`章节 OK: ${name}`);
        }
      }
      // Same native file-state check as clicking an attachment.
      if (chosen.length && chosen.some(file => !blobs.has(file.href))) {
      await throttle(signal);
      await new Promise((resolve, reject) => {
        const abort = () => finish(reject, new Error('已停止 / Stopped'));
        const timer = setTimeout(() => finish(reject, new Error('原生附件状态检查超时')), 45000);
        const finish = (fn, value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); fn(value); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) return abort();
        try { w.editorApp.Adapter.GetFileStatus(data => data ? finish(resolve, data) : finish(reject, new Error('原生文件状态检查失败'))); }
        catch (error) { finish(reject, error); }
      });
      }
      for (const file of chosen) {
        if (signal.aborted) throw new Error('已停止 / Stopped');
        status(`下载 ${file.section} · ${file.name}`);
        try {
          let blob = blobs.get(file.href);
          if (!blob) {
          await throttle(signal);
          const href = await new Promise(resolve => w.editorApp.Adapter.DownloadAttachmentUrl(file.href, resolve));
          const u = new URL(href, location.origin);
          if (u.origin !== location.origin || u.pathname !== '/ows1/services/content/downloadAttachment') throw new Error('附件地址校验失败');
          // Credentials remain in their own KDP origin, never sent to messages.
          const token = w.sessionStorage.getItem('X-CSRF-TOKEN');
          const response = await fetch(u.href, { credentials: 'same-origin', headers: token ? { 'X-CSRF-TOKEN': token } : {}, signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          blob = await response.blob();
          const preview = await blob.slice(0, 200).text();
          if (!blob.size || /text\/html/i.test(blob.type) && /<html|<!doctype/i.test(preview)) throw new Error('附件为空或返回登录/错误页');
          if (blob.size > 100 * 1024 * 1024) throw new Error('单附件超过100MB');
          blobs.set(file.href, blob);
          }
          const saved = netcareUniqueFilename(netcareSafeFilename(`${file.section}-${file.name}`), used);
          const auditItem = await netcareExtractAttachmentText(blob, file.name, settings, file.section, saved);
          evidence.push(auditItem);
          file.savedName=saved;entries.push({ name: saved, blob,section:file.section,kind:'attachments' });attachmentSuccess++; report.push(`附件 OK: ${file.section} · ${file.name} -> ${saved} (${blob.size} bytes)`);
        } catch (error) { if (signal.aborted) throw error; failed++; report.push(`附件 ERROR: ${file.section} · ${file.name}: ${error.message}`); }
      }
      if(settings.screenshotsEnabled!==false){
        const shots=[];
        for(const topic of topics.filter(t=>selection.has(t.number)&&!t.error))shots.push({topic,section:topic.number,kind:'text',sourceFilename:evidence.find(e=>e.section===topic.number&&e.kind==='text')?.filename,name:`${topic.number}-${topic.title}-章节原图`});
        for(const file of chosen){const topic=topics.find(t=>t.number===file.section);if(topic)shots.push({topic,file,section:file.section,kind:'attachments',sourceFilename:file.savedName,name:`${file.section}-${file.name}-附件位置`});}
        const engine=globalThis.createNetcareCapture?.();if(!engine)throw Error('截图组件未加载，请更新扩展 / Capture component missing; update extension');
        const leaseMs = Math.min(45000, Math.max(8000, shots.length * 4500));
        if(shots.length) {
          await activateTab(leaseMs, false, 'acquire');
          await waitUntilVisible(w, 800);
        }
        autoScrollPaused = true;
        try {
          for(const shot of shots){
            if(signal.aborted)throw Error('已停止 / Stopped');status('保存原始区域截图 / Screenshot: '+shot.name);
            if(document.hidden || w.document?.hidden){
              await activateTab(15000, false, 'refresh');
              await waitUntilVisible(w, 600);
            }
            const diagnostic={id:crypto.randomUUID(),at:new Date().toISOString(),order,section:shot.section,name:shot.name,kind:shot.kind,attempts:[],navigations:[]};
            try{
              const capture=()=>engine.capture(w.document,shot,{signal,onStuck:async()=>{await activateTab(15000,false,'refresh');await waitUntilVisible(w,600);},navigation:event=>{diagnostic.navigations.push(event);trace('capture.navigation',event.message,{name:shot.name,...event},'extraction',event.clicked?'info':'warn');},render:element=>netcareCaptureEvidence(element,globalThis.html2canvas,signal),attempt:attempt=>{diagnostic.attempts.push(attempt);trace('capture.attempt','截图尝试 / Capture attempt',{name:shot.name,...attempt},'extraction',attempt.ok?'debug':'warn');}});
              const component=globalThis.createNetcarePip?.(),result=component?.withRenderLock?await component.withRenderLock(window,capture):await capture();
              diagnostic.method=result.method;diagnostic.attempts=result.attempts;diagnostic.outcome='ok';trace('capture.result',result.method==='live'?'原始区域截图成功 / Live original capture succeeded':'已使用内容重建兜底 / Reconstructed content fallback used',{name:shot.name,method:result.method,images:result.images.length,navigations:diagnostic.navigations},'extraction',result.method==='live'?'info':'warn');
              const name=result.method==='reconstructed'?shot.name.replace('章节原图','章节内容重建').replace('附件位置','附件区域重建'):shot.name;
              for(let i=0;i<result.images.length;i++)entries.push({section:shot.section,kind:shot.kind,role:'screenshot',captureMethod:result.method,sourceFilename:shot.sourceFilename,name:netcareUniqueFilename(netcareSafeFilename(name+`-${String(i+1).padStart(3,'0')}.png`),used),blob:result.images[i]});
              report.push(`截图 ${result.method==='reconstructed'?'FALLBACK（内容重建，非页面原图）':'OK'}: ${name} · ${result.images.length} 张`);
              if(result.attempts.length)captureDiagnostics.push(JSON.parse(netcareRedactText(JSON.stringify(diagnostic))));
            }catch(e){if(signal.aborted)throw e;failed++;diagnostic.outcome='failed';diagnostic.code=e.code||e.name;diagnostic.message=e.message;diagnostic.attempts=e.attempts||diagnostic.attempts;captureDiagnostics.push(JSON.parse(netcareRedactText(JSON.stringify(diagnostic))));report.push(`截图 ERROR: ${shot.name}: ${e.message}（详见截图诊断.json）`);trace('capture.failed','截图重试与兜底失败 / Capture retries and fallback failed',diagnostic,'extraction','error');}
            renderCaptureDiagnostics();
          }
        } finally {
          autoScrollPaused = false;
          if(shots.length) await activateTab(0, true, 'release');
        }
        if(captureDiagnostics.length)entries.push({name:netcareUniqueFilename('截图诊断.json',used),blob:new Blob([JSON.stringify(captureDiagnostics,null,2)],{type:'application/json'})});
      }
      for(const item of evidence){const topic=topics.find(t=>t.number===item.section);if(topic){item.ruleSection=netcareTopicRule(settings,topic,item.kind).number;item.sectionTitle=topic.title;item.corrections=topic.correctionsByKind?.[item.kind]||[];}}
      for(const row of settings.sections) for(const kind of ['text','attachments']) if(settings.aiAuditEnabled && row[kind+'Prompt'] && !settings.sections.some(parent=>row.number.startsWith(parent.number+'.')&&parent[kind+'Prompt']) && !evidence.some(item=>(item.ruleSection===row.number||item.section===row.number||item.section.startsWith(row.number+'.')) && item.kind===kind)) {
        const matched=topics.find(t=>netcareTopicRule(settings,t,kind).number===row.number);
        const issue=topics.resolutionIssues?.find(i=>i.number===row.number&&i.kind===kind)?.error||matched?.error;
        evidence.push({section:row.number,kind,filename:row.title,corrections:matched?.correctionsByKind?.[kind]||[],notApplicable:!issue&&!!matched,error:issue||(!matched?'未定位到章节 / Section not located':undefined)});
      }
      let reports=[], cached=true;
      try {netcareCacheAudit(localStorage,order,evidence,[]);}catch(error){cached=false;report.push('暂存 ERROR: '+error.message);}
      if(settings.aiAuditEnabled){
        if(!cached)reports=[{status:'needs_review',summary:'浏览器暂存失败，未自动提交审计',error:true}];
        else reports=await netcareRunAudits(evidence,settings,requestAudit,signal,text=>{status('AI 审计 / Auditing: '+text);$('auditStatus').textContent=text;},(action,data)=>trace(action,'准备审计证据 / Prepare audit evidence',data,'audit'),promptAiRetry,appendTopLog);
        for(const result of reports)trace('audit.result','审计项结论 / Audit check result',{...result},'audit',result.error?'error':result.status==='fail'?'warn':'info');
        const auditText=reports.filter(r=>!r.notApplicable).map(r=>`${r.section||''} ${r.filename||''} · ${r.status}\n${r.summary}\n${(r.findings||[]).join('\n')}`).join('\n\n');
        $('auditStatus').textContent=auditText || '没有匹配的审计规则 / No audit rules';
        entries.push({name:netcareUniqueFilename('AI审计结果.json',used),blob:new Blob([JSON.stringify({order,at:new Date().toISOString(),reports},null,2)],{type:'application/json'})});
        entries.push({name:netcareUniqueFilename('AI审计结果.txt',used),blob:new Blob(['\ufeff'+auditText],{type:'text/plain;charset=utf-8'})});
        report.push('AI审计: '+reports.length+' 项；需人工复核 / Human review required');
        try{netcareCacheAudit(localStorage,order,evidence,reports);}catch{}

      }
      const materials=entries.filter(e=>e.section).map(e=>({name:e.name,section:e.section,kind:e.kind,role:e.role,captureMethod:e.captureMethod,sourceFilename:e.sourceFilename,folder:netcareSectionFolder(settings,topics.find(t=>t.number===e.section)||{number:e.section},e.kind)}));
      for(const entry of entries.filter(e=>e.section)){try{await netcareStoreArtifact(order,entry.name,entry.blob,signal,entry.role||entry.kind);}catch(error){failed++;report.push('材料缓存 ERROR: '+entry.name+': '+error.message);}}
      entries.push({ name: netcareUniqueFilename('清单.txt', used), blob: new Blob(['\ufeff' + report.join('\n')], { type: 'text/plain;charset=utf-8' }) });
      if(signal.aborted)throw Error('已停止 / Stopped');status('正在生成 ZIP… / Building ZIP');
      const zip=await createNetcareZip(entries.map(e=>{
        const mat=materials.find(m=>m.name===e.name);
        if(!mat?.folder)return e;
        const subFolder=e.role==='screenshot'?'方案截图':e.kind==='attachments'?'方案附件':'方案文本';
        return {...e,name:mat.folder+'/'+subFolder+'/'+e.name};
      })),bundleFilename=netcareSafeFilename(filename.replace(/\.docx$/i,'')+'.zip');
      try{await netcareStoreArtifact(order,bundleFilename,zip,signal,'audit-bundle');trace('bundle.cached','最终审计 ZIP 已缓存 / Final audit ZIP cached',{name:bundleFilename,bytes:zip.size,files:entries.length},'storage');}catch(error){failed++;trace('bundle.cache.failed','审计 ZIP 缓存失败 / Audit ZIP cache failed',{error:error.message},'storage','error');}
      await netcareLogQueue;
      const published=new Promise(resolve=>{const timer=setTimeout(()=>{window.removeEventListener('message',ack);resolve(false);},15000);const ack=e=>{if(e.source===window&&e.origin===location.origin&&e.data?.source==='TP_RFC_AUDIT_PUBLISHED'&&e.data.order===order){clearTimeout(timer);window.removeEventListener('message',ack);if(e.data.snapshotError){trace('snapshot.ack.failed','快照保存失败 / Snapshot save failed',{error:e.data.snapshotError},'storage','error');status($('status').textContent+'\n快照保存失败 / Snapshot save failed: '+e.data.snapshotError);}resolve(e.data.ok===true&&!e.data.snapshotError);}};window.addEventListener('message',ack);});
      window.postMessage({source:'TP_RFC_AUDIT_PUBLISH',order,record:{order,wordFilename:filename,bundleFilename,generationAt,batchId,at:new Date().toISOString(),items:evidence,reports,materials,captureDiagnostics,logFailures:netcareLogFailures}},location.origin);
      if(signal.aborted)throw Error('已停止 / Stopped');
      const shouldAutoDownloadZip = !automatic || !settings.aiAuditEnabled;
      if (shouldAutoDownloadZip) {
        const href = URL.createObjectURL(zip), a = document.createElement('a'); a.href = href;
        a.download = bundleFilename; document.body.append(a); a.click(); a.remove();
        downloadCompleted = true;
        setTimeout(() => URL.revokeObjectURL(href), 60000);trace('bundle.download','ZIP 已发起下载 / ZIP download initiated',{name:bundleFilename,bytes:zip.size},'storage');
        status(`ZIP 已发起保存：${a.download}\n${attachmentSuccess} 个附件成功；${failed} 处提取/缓存错误（详见清单）；${reports.filter(r=>r.error).length} 项审计异常；${entries.length - 1} 个数据文件。`);
      } else {
        downloadCompleted = true;
        trace('bundle.download.cached','AI审计已开启，跳过单方案自动下载（可在汇总处统一打包下载） / Skipped automatic individual ZIP download since AI audit is enabled',{name:bundleFilename,bytes:zip.size},'storage');
        status(`审计材料已缓存：${bundleFilename}\n（AI审计已开启，未单独发起下载，可随时在主面板统一下载审计材料 ZIP）\n${attachmentSuccess} 个附件成功；${failed} 处提取/缓存错误（详见清单）；${reports.filter(r=>r.error).length} 项审计异常；${entries.length - 1} 个数据文件。`);
      }
      if(settings.closeAfterAudit){const reason=netcareAutoCloseReason({settings,reports,failed,cached,published:await published,aborted:signal.aborted});if(reason)status($('status').textContent+'\n自动关闭已暂停 / Automatic close paused: '+reason);else window.postMessage({source:'TP_RFC_CLOSE_AFTER_AUDIT',order},location.origin);}
    } catch (error) {trace('extraction.failed','提取或打包失败 / Extraction or packaging failed',{error:error.message},'extraction',signal.aborted?'warn':'error');status(error.message); }
    finally { stopAutoScroll(); controller = null; taskActive = false; downloadInProgress = false; updateCollectorButtons(); renderCaptureDiagnostics(); }
  }
  $('scan').onclick = () => { if (isTaskRunning()) return; scan(false); };
  $('zip').onclick = () => { if (isTaskRunning()) return; autoAttempted = true; download(false); };
  $('stop').onclick = () => { stopAutoScroll(); controller?.abort(); taskActive = false; updateCollectorButtons(); };
  $('all').onchange = () => {
    for (const box of $('chapters').querySelectorAll('input:not(:disabled)')) { box.checked = $('all').checked; box.onchange(); }
  };
  const timer = setInterval(() => {
    if (editor() && settingsReady) {
      clearInterval(timer);
      scan(true);
    } else if (settingsReady && !settings.attachmentsEnabled && !settings.textEnabled) {
      clearInterval(timer);
      taskActive = false;
      updateCollectorButtons();
    }
  }, 1000);
  const cleanup = () => { window.__netcareCollectorMounted = false; stopAutoScroll(); trace('collector.closed','关闭采集浮窗 / Close collector',{},'operation');unwireOperations();collectorLanguage?.stop();healthSampler?.stop();controls?.close();controller?.abort(); clearInterval(timer); clearInterval(nameTimer); window.removeEventListener('message', receive); window.removeEventListener('message', receiveSlot); blobs.clear(); topLogHost?.remove(); aiRetryDialog?.close(); host.remove(); };
  window.__netcareCollectorCleanup = cleanup; $('close').onclick = cleanup;
}

(() => {
  'use strict';
  const CHANNEL = 'netcare-rfc-word-v1';
  const NETCARE_ORIGINS = new Set([
    'https://netcare-ae.gts.huawei.com',
    'https://netcare.huawei.com',
    'https://netcare-de.gts.huawei.com'
  ]);
  const ID = 'netcare-rfc-word-panel';
  const validOrder = value => /^NC\d{14}$/.test(value);
  const netcareMatchesOrder = (candidate, order) => {
    if (!candidate || !order) return false;
    if (candidate === order) return true;
    return candidate.toUpperCase() === ('D' + order).toUpperCase() || (candidate.toUpperCase().endsWith(order.toUpperCase()) && /^D?NC\d{14}$/i.test(candidate));
  };
  const validExport = value => {
    const u = new URL(value);
    return u.protocol === 'https:' && /(^|\.)kdp\.(?:gts|idp)\.huawei\.com$/.test(u.hostname)
      && u.pathname === '/ows1/static/editor/IdpLiteView/PublishLiteView.html';
  };

  if (location.protocol === 'https:' && /(^|\.)kdp\.(?:gts|idp)\.huawei\.com$/.test(location.hostname)
    && location.pathname === '/ows1/static/editor/IdpLiteView/OwsPage.html' && window === window.top) {
    mountNetcareCollector(); return;
  }

  // Chrome injects this script automatically in the persistent export iframe.
  if (validExport(location.href) && window.name === 'rfc-word-worker') {
    // ancestorOrigins exposes the direct parent's origin without accessing its DOM.
    // Only a supported direct parent can initialize this dedicated worker.
    const parentOrigin = location.ancestorOrigins?.[0];
    if (!NETCARE_ORIGINS.has(parentOrigin)) return;
    window.__rfcWordWorkerCleanup?.();
    const jobs = new Map();
    let readyTimer;
    const tell = message => parent.postMessage({ channel: CHANNEL, ...message }, parentOrigin);
    const ajax = (path, params, signal) => new Promise((resolve, reject) => {
      if (!window.jQuery?.ajax) return reject(new Error('导出页面尚未加载完成，请稍后重新粘贴脚本'));
      const u = new URL('/ows1/services/' + path, location.origin);
      Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
      const request = window.jQuery.ajax({ url: u.href, type: 'GET', dataType: 'json', timeout: 45000,
        // The native ViewAjaxLoader reads this value from the export origin.
        // Keep it in this frame only; never include it in messages or logs.
        beforeSend(xhr) {
          const value = sessionStorage.getItem('X-CSRF-TOKEN');
          if (value) xhr.setRequestHeader('X-CSRF-TOKEN', value);
        }
      });
      const abort = () => request.abort();
      signal.addEventListener('abort', abort, { once: true });
      request.done(data => {
        signal.removeEventListener('abort', abort);
        if (!data || typeof data !== 'object') reject(new Error('导出服务未返回有效数据，请检查登录状态'));
        else resolve(data);
      }).fail((_xhr, status) => {
        signal.removeEventListener('abort', abort);
        reject(new Error(signal.aborted ? '已停止等待' : `导出服务请求失败：${status}（请检查登录或权限）`));
      });
      if (signal.aborted) abort();
    });
    const sleep = (ms, signal) => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('已停止等待')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    async function run(message, signal) {
      const { job, order } = message;
      const urlId = new URL(location.href).searchParams.get('id') || '';
      const docId = (urlId && netcareMatchesOrder(urlId, order)) ? urlId : order;
      const progress = text => tell({ type: 'progress', job, text });
      progress('读取方案信息…');
      // Same first request as the native Word export action.
      await ajax('alm/ows/getManualInfo', { id: docId, from: 'undefined' }, signal);
      progress('创建 Word 转换任务…');
      const created = await ajax('ows/addPublishToolTask', { owsId: docId, from: 'null' }, signal);
      if (created.status !== 'Success' || typeof created.returnValue !== 'string' || !created.returnValue) {
        throw new Error('创建任务失败；可能没有数字化方案或当前账号没有导出权限');
      }
      const taskId = created.returnValue;
      const start = Date.now();
      while (!signal.aborted && Date.now() - start < 10 * 60 * 1000) {
        const state = await ajax('ows/getPublishToolStatus', {
          taskId, docId, tm: Date.now(), from: 'ows'
        }, signal);
        const status = String(state.status);
        progress(`转换状态 ${status}：${String(state.message || '等待服务处理').slice(0, 120)}（${Math.round((Date.now() - start) / 1000)} 秒）`);
        if (status === '9') {
          if (signal.aborted) throw new Error('已停止等待');
          const filename = typeof state.fileName === 'string' && state.fileName ? state.fileName
            : typeof created.obj === 'string' ? created.obj : order;
          const u = new URL('/ows1/services/ows/downloadPublishFileFromUrl', location.origin);
          u.searchParams.set('taskId', taskId);
          u.searchParams.set('docId', docId);
          // Native endpoint uses a double-encoded fileName.
          u.searchParams.set('fileName', encodeURIComponent(filename));
          u.searchParams.set('tm', Date.now());
          u.searchParams.set('from', 'ows');
          progress('Word 已生成，正在获取文件…');
          // Native download also uses an authenticated XMLHttpRequest.
          const blob = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', u.href);
            const value = sessionStorage.getItem('X-CSRF-TOKEN');
            if (value) xhr.setRequestHeader('X-CSRF-TOKEN', value);
            xhr.responseType = 'blob';
            xhr.timeout = 120000;
            const abort = () => xhr.abort();
            signal.addEventListener('abort', abort, { once: true });
            const finish = () => signal.removeEventListener('abort', abort);
            xhr.onload = () => { finish(); if (xhr.status === 200) resolve(xhr.response);
              else reject(new Error(`文件下载失败：HTTP ${xhr.status}`)); };
            xhr.onerror = () => { finish(); reject(new Error('文件下载请求失败')); };
            xhr.ontimeout = () => { finish(); reject(new Error('文件下载超时')); };
            xhr.onabort = () => { finish(); reject(new Error('已停止等待')); };
            xhr.send();
            if (signal.aborted) xhr.abort();
          });
          const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
          if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
            throw new Error('返回文件不是有效的 DOCX/ZIP，可能登录已失效或无下载权限');
          }
          if (signal.aborted) throw new Error('已停止等待');
          const objectURL = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = objectURL;
          anchor.download = `${order}_${filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.docx$/i, '')}.docx`;
          let cached=true;
          try{await netcareStoreArtifact(order,anchor.download,blob,signal,'word');}catch(error){cached=false;progress('方案缓存失败，将单独保存 Word / Word cache failed; saving Word separately: '+error.message);}
          if(signal.aborted)throw Error('已停止 / Stopped');
          if(!message.bundleOnly||!cached){document.body.append(anchor);anchor.click();anchor.remove();}
          setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
          tell({type:'done',job,filename:anchor.download,text:message.bundleOnly&&cached?`已获取 Word 文件（${Math.round(blob.size/1024)} KB），等待章节材料合并 ZIP / Word ready for combined ZIP`:`已获取 Word 文件（${Math.round(blob.size/1024)} KB），已发起保存；请在 Chrome 下载记录中确认。`});
          return;
        }
        if (/失败|异常|无权限|不存在|failed|error|denied/i.test(String(state.message || ''))) {
          throw new Error(`转换未完成：${String(state.message).slice(0, 160)}`);
        }
        await sleep(5000, signal);
      }
      throw new Error(signal.aborted ? '已停止等待' : '转换超过 10 分钟，已停止轮询；服务端任务可能仍在运行');
    }
    const receive = event => {
      if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_ARTIFACT_READY'){window.__tpNetcareArtifactReady=true;return;}
      if (event.origin !== parentOrigin || event.source !== parent || event.data?.channel !== CHANNEL) return;
      const message = event.data;
      if (message.type === 'hello') {
        if (window.jQuery?.ajax && sessionStorage.getItem('X-CSRF-TOKEN')) tell({ type: 'ready' });
        return;
      }
      if (message.type === 'cancel') return jobs.get(message.job)?.abort();
      if (message.type !== 'run' || !validOrder(message.order) || typeof message.job !== 'string') return;
      if (jobs.has(message.job)) return;
      if (jobs.size >= 10) return tell({ type: 'error', job: message.job, text: '并发任务已达上限（10 个）' });
      const controller = new AbortController();
      jobs.set(message.job, controller);
      run(message, controller.signal).catch(error => tell({ type: 'error', job: message.job, text: error.message }))
        .finally(() => jobs.delete(message.job));
    };
    window.addEventListener('message', receive);
    window.__rfcWordWorkerCleanup = () => {
      clearInterval(readyTimer);
      jobs.forEach(controller => controller.abort());
      window.removeEventListener('message', receive);
    };
    const announce = () => {
      if (window.jQuery?.ajax && sessionStorage.getItem('X-CSRF-TOKEN')) {
        clearInterval(readyTimer);
        tell({ type: 'ready' });
      }
    };
    readyTimer = setInterval(announce, 250);
    announce();
    return;
  }

  // Native export dialogs also match the extension; only the named worker runs.
  if (!NETCARE_ORIGINS.has(location.origin) || window !== window.top) return;
  window.__rfcWordPanelCleanup?.();
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;width:min(480px,calc(100vw - 24px));z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{--bg:#fff;--soft:#f5f7fb;--ink:#243149;--muted:#738096;--line:#e0e6ef;--accent:#2563eb;--hover:#edf2fa;color-scheme:light}
    *{box-sizing:border-box}button,input,textarea,select{font:inherit}button{cursor:pointer;border:1px solid var(--line);border-radius:7px;padding:7px 11px;background:var(--bg);color:var(--ink);transition:background .15s}button:hover{background:var(--hover)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button[hidden],[hidden]{display:none!important}
    .panel{font:12px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 42px #15264326;max-height:calc(100vh - 40px);overflow:auto;padding:18px;min-height:min(600px,calc(100vh - 40px))}
    .panel header{display:flex;align-items:center;justify-content:space-between;cursor:move;touch-action:none;margin-bottom:11px}.title{font-size:14px;font-weight:650;letter-spacing:.2px}.eyebrow{font-size:10px;color:var(--muted);letter-spacing:.8px}.header-actions{display:flex;gap:4px}.icon{width:32px;height:32px;padding:4px;border:1px solid var(--line);border-radius:7px;background:var(--soft);font-size:14px;line-height:1;font-weight:600;display:grid;place-items:center}.icon svg{width:17px;height:17px}
    .badge{font-size:10px;color:var(--muted);display:inline-block;background:var(--soft);padding:3px 7px;border-radius:5px;margin-bottom:10px}textarea,input[type=text],input[type=number],select{border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);padding:8px;min-width:0}textarea{display:block;width:100%;resize:vertical;min-height:78px;max-height:160px;font:12px/1.6 ui-monospace,monospace;margin:5px 0 9px}input[type=checkbox]{accent-color:var(--accent);width:14px;height:14px;margin:0;vertical-align:middle}
    .actions{display:flex;gap:7px;margin:11px 0}.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.primary:hover{background:#1d4ed8}.actions .primary{flex:1}.summary{font-size:10px;color:var(--muted);padding:7px 0;border-bottom:1px solid var(--line)}#results{max-height:280px;overflow:auto}pre{font:11px/1.55 system-ui;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);border-radius:7px;padding:9px;margin:10px 0 0;max-height:100px;overflow:auto}.panel small{display:block;color:var(--muted);font-size:10px;margin-top:9px}
    dialog{font:12px/1.5 system-ui,sans-serif;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:0;width:min(1100px,calc(100vw - 40px));max-width:none;height:min(820px,calc(100vh - 48px));max-height:none;box-shadow:0 24px 80px #0004;overflow:hidden}dialog::backdrop{background:#101b3566;backdrop-filter:blur(3px)}.settings-shell{height:100%;display:flex;flex-direction:column}.modal-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--line)}.modal-head h2{font-size:18px;margin:0;font-weight:650}.modal-head p{margin:3px 0 0;color:var(--muted);font-size:11px}.modal-nav{display:flex;gap:6px;padding:12px 24px 0}.modal-nav button{border:0;background:transparent;color:var(--muted)}.modal-nav button[aria-selected=true]{background:var(--hover);color:var(--accent);font-weight:600}.modal-body{flex:1;min-height:0;overflow:auto;padding:18px 24px}.modal-footer{display:flex;gap:8px;align-items:center;padding:14px 24px;border-top:1px solid var(--line);background:var(--soft)}#settingsStatus{flex:1;font-size:11px;color:var(--muted)}.settings-card{border:1px solid var(--line);border-radius:10px;padding:17px;margin-bottom:14px}.settings-card h3{font-size:13px;margin:0 0 14px}.field-row{display:grid;grid-template-columns:1fr 150px;gap:20px;align-items:center;padding:11px 0;border-top:1px solid var(--line)}.field-row:first-of-type{border-top:0}.field-row label{font-weight:500}.field-row small,.note{display:block;font-size:11px;color:var(--muted);margin-top:4px}.field-row select,.field-row input[type=number]{width:100%}.switch-row{display:flex;gap:9px;align-items:center;margin:12px 0}.section-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}.section-toolbar strong{font-size:13px}.section-table{border:1px solid var(--line);border-radius:8px;overflow:hidden}.section-grid{display:grid;grid-template-columns:154px minmax(180px,1fr) 38px 38px minmax(130px,1fr) minmax(130px,1fr) 26px;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line)}.section-grid:last-child{border-bottom:0}.section-grid.table-head{background:var(--soft);font-size:10px;color:var(--muted);position:sticky;top:0;z-index:1}.section-grid input[type=text]{width:100%;padding:6px;font-size:11px}.section-grid[data-depth="0"]{background:var(--soft);border-left:3px solid var(--accent)}.section-grid[data-depth="1"]{background:var(--bg);border-left:3px solid var(--line)}.section-grid[data-depth="2"]{background:var(--hover);border-left:3px solid var(--line)}.section-number{position:relative;display:flex;align-items:center;min-width:0;padding-left:calc(var(--depth,0)*18px)}.section-number input{flex:1;min-width:0}.tree-branch{position:absolute;left:0;top:-24px;bottom:-24px;width:calc(var(--depth,0)*18px);pointer-events:none;color:var(--muted)}.tree-branch i{position:absolute;top:0;bottom:0;border-left:1px solid currentColor;opacity:.5}.tree-branch b{position:absolute;top:50%;width:14px;border-top:1px solid currentColor;opacity:.7}.section-grid input[data-field=title]{width:calc(100% - var(--depth,0)*12px);margin-left:calc(var(--depth,0)*12px);padding:6px}.section-number input[data-field=number]{padding:6px}.section-grid textarea:disabled{background:var(--soft);color:var(--muted);opacity:.7;cursor:not-allowed}.section-grid .check-cell{text-align:center}.section-grid textarea{font:11px/1.4 system-ui;margin:0;padding:6px;min-height:56px;max-height:140px;resize:vertical}.section-table{overflow:auto}.section-grid{min-width:750px}#aiFrame{border:0;width:100%;height:610px;border-radius:10px}.section-grid.section-new{animation:section-highlight 1.8s ease-out}@keyframes section-highlight{from{box-shadow:inset 0 0 0 2px var(--accent)}to{box-shadow:inset 0 0 0 2px transparent}}@media(prefers-reduced-motion:reduce){.section-grid.section-new{animation:none;box-shadow:inset 0 0 0 2px var(--accent)}}.section-add{background:var(--soft)}.section-add .config-actions{margin-top:12px}.section-add select{width:100%;margin:7px 0}.section-add p{margin:6px 0;color:var(--muted)}.section-grid .delete{font-size:17px;padding:2px;width:28px;border:0;color:var(--muted)}.config-actions{display:flex;gap:8px;flex-wrap:wrap}.note{margin:10px 0 16px}
    .local-rule-grid{display:grid;grid-template-columns:46px minmax(130px,1.2fr) minmax(100px,1fr) 68px minmax(140px,1.5fr) 88px 76px;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);font-size:11px}.local-rule-grid:last-child{border-bottom:0}.local-rule-grid.table-head{background:var(--soft);font-size:10px;color:var(--muted);position:sticky;top:0;z-index:1}.local-rule-actions{display:flex;gap:4px}.local-rule-actions button{padding:3px 6px;font-size:10px}
    .storage-multi-bar{display:flex;width:100%;height:14px;background:var(--line);border-radius:7px;overflow:hidden;margin:8px 0 12px;box-shadow:inset 0 1px 2px rgba(0,0,0,.06)}.storage-bar-segment{height:100%;transition:width .3s ease;min-width:0}.storage-breakdown-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin:10px 0 14px}.storage-breakdown-card{display:flex;align-items:center;gap:8px;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:11px}.storage-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}.storage-breakdown-info{display:flex;flex-direction:column;min-width:0;flex:1}.storage-breakdown-name{font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.storage-breakdown-meta{color:var(--muted);font-size:10px}.materials-clean-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;margin:10px 0}.materials-clean-chip{display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid var(--line);border-radius:7px;background:var(--soft);font-size:11px;cursor:pointer}.materials-clean-chip small{color:var(--muted);margin-left:auto}
    .modal-body.chapter-mode{overflow:hidden;display:flex;flex-direction:column}#chapterSettings{flex:1;min-height:0;display:flex;flex-direction:column}#chapterSettings>.section-toolbar,#chapterSettings>.note,#chapterSettings>.switch-row{flex:none}#chapterSettings .section-table{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}#chapterSettings .section-add{margin:10px;min-width:720px}#chapterSettings .section-grid{min-width:900px}#chapterSettings .table-head{z-index:2}.section-correction{border-top:1px solid var(--line);margin-top:12px;padding-top:10px;font-weight:500}.correction-label{font-size:10px;color:var(--muted);margin-bottom:6px}.correction-from{color:#9e661b}.correction-arrow{color:var(--muted);font-size:18px;line-height:1.4;padding-left:6px}.correction-to{color:#176f9c;font-weight:650}@media(prefers-color-scheme:dark){.correction-from{color:#d6b16a}.correction-to{color:#76c7dc}}

    .audit-shots{display:grid;gap:10px;margin-top:12px}.audit-shot{padding:8px;width:100%;display:flex;flex-direction:column;gap:6px;align-items:stretch;text-align:left;overflow:hidden;background:var(--soft)}.audit-shot img{display:block;width:100%;height:150px;object-fit:contain;border-radius:5px;background:#fff}.audit-shot span{font-size:10px;overflow-wrap:anywhere;color:var(--muted)}.audit-shot:hover{border-color:var(--accent)}#auditImageDialog{width:min(1200px,calc(100vw - 32px));height:calc(100vh - 40px);padding:0;background:var(--bg);color:var(--ink)}#auditImageDialog .settings-shell{height:100%}.audit-image-body{flex:1;min-height:0;overflow:auto;padding:16px;display:grid;place-items:center;background:var(--soft)}#auditImage{display:block;max-width:100%;max-height:100%;object-fit:contain;background:#fff;cursor:zoom-in}#auditImage.actual-size{max-width:none;max-height:none;cursor:zoom-out}.audit-image-body:has(.actual-size){display:block}#auditImageName{overflow-wrap:anywhere;max-width:900px}#auditImageDialog::backdrop{background:rgba(0,0,0,.7)}

    #confirmationDialog{width:min(520px,calc(100vw - 32px));height:fit-content!important;min-height:0!important;max-height:calc(100vh - 40px)}#confirmationMessage{white-space:pre-wrap;overflow-wrap:anywhere;padding:8px 24px 20px;line-height:1.8}#confirmationDialog .modal-footer{justify-content:flex-end}#confirmationAccept.danger{background:#b6454c;border-color:#b6454c}.modal-body.log-mode{overflow:hidden;display:flex;flex-direction:column}#pluginLogs:not([hidden]){display:flex;flex-direction:column;flex:1;min-height:0}.log-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.log-filters label{font-size:10px;color:var(--muted)}.log-filters select,.log-filters input{background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:7px 9px;font:inherit;display:block;width:100%;margin-top:4px;min-width:0}.log-search{grid-column:span 2}.log-advanced{margin-top:8px;flex:none}.log-advanced summary{color:var(--muted);cursor:pointer;font-size:11px}.log-advanced .log-filters{padding-top:8px}.log-advanced[open]{max-height:150px;overflow:auto}.log-filters,.log-actions,.log-pagination{flex:none}.log-actions{margin-top:10px;align-items:center}.log-actions label{display:flex;gap:6px;font-size:11px;align-items:center}#pluginLogStatus{margin:8px 0;flex:none}
    .plugin-log-list{flex:1;min-height:0;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--soft);overscroll-behavior:contain;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:10.5px;color:var(--ink)}
    .log-row{border-bottom:1px solid var(--line);border-left:3px solid transparent;background:var(--bg);transition:background .08s}
    .log-row:hover{background:var(--hover)}
    .log-row[data-category=configuration]{--log-color:#7c3aed}
    .log-row[data-category=extraction]{--log-color:#0d9488}
    .log-row[data-category=audit]{--log-color:#2563eb}
    .log-row[data-category=storage]{--log-color:#d97706}
    .log-row[data-category=operation]{--log-color:#0284c7}
    .log-row[data-category=system]{--log-color:#64748b}
    .log-row[data-level=error]{border-left-color:#dc2626;background:rgba(220,38,38,0.03)}
    .log-row[data-level=warn]{border-left-color:#d97706;background:rgba(217,119,6,0.02)}
    .log-row.is-open{background:rgba(37,99,235,0.04)}
    .log-row-line{display:flex;align-items:center;gap:7px;padding:3px 8px;min-height:22px;line-height:20px;cursor:pointer;white-space:nowrap;user-select:text}
    .log-arrow{color:var(--muted);font-size:10px;width:11px;flex:none;text-align:center;transition:transform .12s}
    .log-row.is-open .log-arrow{transform:rotate(90deg)}
    .log-time{color:var(--muted);font-size:10px;flex:none}
    .log-cat{color:var(--log-color);font-weight:600;flex:none}
    .log-level{flex:none;font-weight:600;font-size:10px;padding:0 3px;border-radius:3px}
    .log-level.error{color:#dc2626;background:rgba(220,38,38,0.1)}
    .log-level.warn{color:#d97706;background:rgba(217,119,6,0.1)}
    .log-level.info{color:#16a34a}
    .log-level.debug{color:var(--muted)}
    .log-order{color:#0284c7;font-weight:500;flex:none}
    .log-order.empty{color:var(--muted);opacity:.5}
    .log-action{color:#8b5cf6;background:rgba(139,92,246,0.08);padding:0 4px;border-radius:3px;font-size:10px;flex:none}
    .log-msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
    .log-snap-btn{padding:1px 5px;font-size:9.5px;border-radius:4px;background:var(--soft);color:var(--accent);border:1px solid var(--line);flex:none;cursor:pointer}
    .log-snap-btn:hover{background:var(--hover);border-color:var(--accent)}
    .log-row-detail{padding:8px 12px 10px 26px;border-top:1px dashed var(--line);background:var(--soft);overflow:hidden}
    .log-detail-toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px}
    .log-detail-meta{font-size:10px;color:var(--muted)}
    .log-detail-actions{display:flex;gap:6px}
    .log-detail-actions button{padding:2px 8px;font-size:10px;border-radius:4px}
    .log-detail-pre{margin:0;max-height:240px;overflow:auto;padding:8px;background:var(--bg);border:1px solid var(--line);border-radius:6px;font:inherit;font-size:10.5px;line-height:1.45;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
    .log-detail-pre mark,.log-msg mark,.log-action mark,.log-order mark{background:#ffdb78;color:#293145;border-radius:2px}
    .log-pagination{display:flex;gap:12px;justify-content:center;align-items:center;padding-top:10px;font-size:11px}
    .log-fs-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
    #settingsDialog.log-fullscreen-mode{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;border-radius:0!important;border:0!important;box-shadow:none!important;margin:0!important;z-index:2147483647!important}
    #settingsDialog.log-fullscreen-mode .settings-shell{height:100vh!important}
    #settingsDialog.log-fullscreen-mode .modal-body.log-mode{padding:12px 24px!important}
    #settingsDialog.log-fullscreen-mode .plugin-log-list{font-size:12.5px!important}
    #settingsDialog.log-fullscreen-mode .log-row-line{min-height:26px!important;line-height:24px!important;font-size:12px!important;gap:9px!important}
    #settingsDialog.log-fullscreen-mode .log-time{font-size:11.5px!important}
    #settingsDialog.log-fullscreen-mode .log-action{font-size:11.5px!important}
    #settingsDialog.log-fullscreen-mode .log-order{font-size:11.5px!important}
    #settingsDialog.log-fullscreen-mode .log-detail-pre{font-size:12px!important;max-height:450px!important}
    @media(max-width:650px){.log-filters{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.log-actions{gap:5px}.log-actions button{padding:6px;font-size:10px}.log-filters input,.log-filters select{padding:5px}.log-pagination{padding-top:6px}.log-row-line{overflow-x:auto}.modal-nav{flex-wrap:wrap}}
    @media(prefers-color-scheme:dark){
      .plugin-log-list{background:#0e1726}
      .log-row[data-category=configuration]{--log-color:#a78bfa}
      .log-row[data-category=extraction]{--log-color:#2dd4bf}
      .log-row[data-category=audit]{--log-color:#60a5fa}
      .log-row[data-category=storage]{--log-color:#fbbf24}
      .log-row[data-category=operation]{--log-color:#38bdf8}
      .log-row[data-category=system]{--log-color:#94a3b8}
      .log-row[data-level=error]{border-left-color:#f87171;background:rgba(248,113,113,0.06)}
      .log-row[data-level=warn]{border-left-color:#fbbf24;background:rgba(251,191,36,0.05)}
      .log-level.error{color:#f87171;background:rgba(248,113,113,0.18)}
      .log-level.warn{color:#fbbf24;background:rgba(251,191,36,0.18)}
      .log-level.info{color:#4ade80}
      .log-order{color:#38bdf8}
      .log-action{color:#c084fc;background:rgba(192,132,252,0.14)}
      .log-row.is-open{background:rgba(59,130,246,0.08)}
      .log-row-detail{background:#111c2e}
      .log-detail-pre{background:#0b1320;border-color:#1e293b}
    }
    #planChoiceDialog[open]{display:block}#planChoiceDialog .modal-head,#planChoiceDialog .modal-footer{flex:none}#planChoiceDialog .modal-head h2{overflow-wrap:anywhere}#planChoiceDialog .modal-footer{justify-content:flex-end}
    #auditSummaryBody{padding:0 24px 24px;background:var(--bg);scrollbar-gutter:stable}.audit-table thead{position:sticky;top:0;z-index:3;background:var(--soft)}.audit-table thead th{position:static;background:var(--soft);border-bottom:1px solid var(--line)}.audit-table thead::after{content:"";position:absolute;left:0;right:0;bottom:0;border-bottom:1px solid var(--line)}#auditSummaryDialog{width:min(1560px,calc(100vw - 40px));height:calc(100vh - 48px)}.audit-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:12px 24px;border-bottom:1px solid var(--line);background:var(--soft)}.audit-toolbar span{font-size:11px;color:var(--muted)}.audit-table{width:100%;min-width:1000px;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:11px}.audit-table th{background:var(--soft);text-align:left;font-size:11px;padding:12px;border-top:1px solid var(--line)}.audit-table td{padding:14px 12px;vertical-align:top;border-top:1px solid var(--line);border-right:1px solid var(--line);overflow-wrap:anywhere;line-height:1.65}.audit-table td:first-child{border-left:1px solid var(--line)}.audit-table .group-cell{background:var(--soft);font-weight:600}.audit-table pre{max-height:200px;font-size:11px}.audit-table details{margin:8px 0}.audit-table summary{cursor:pointer}.audit-table .rule-label{font-weight:600;margin:8px 0}.audit-table .kind-label{font-size:10px;color:var(--muted)}.audit-table .group-start td{border-top:2px solid var(--accent)}.audit-rfc{border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px}.audit-rfc>summary{font-weight:650;cursor:pointer}.audit-card{border-top:1px solid var(--line);margin-top:14px;padding-top:14px}.audit-card h4{margin:0 0 6px;font-size:13px}.audit-state{display:inline-block;border-radius:5px;padding:3px 7px;background:var(--soft);font-size:11px;margin-bottom:5px}.audit-state.pass{color:#27a77b}.audit-state.fail{color:#e36d72}.audit-state.needs_review{color:#cd9b34}.audit-card pre{max-height:220px}.audit-card details{margin-top:8px}.audit-card p{margin:5px 0;overflow-wrap:anywhere}
    @media(prefers-color-scheme:dark){:host{--bg:#182235;--soft:#131d2d;--ink:#e3eaf5;--muted:#97a8c0;--line:#314058;--accent:#4386f5;--hover:#24344d;color-scheme:dark}}
    @media(max-height:600px){#settingsDialog:has(.modal-body.log-mode) #settingsStatus{display:none}#settingsDialog:has(.modal-body.log-mode) .modal-footer{flex-wrap:nowrap;justify-content:flex-end}#settingsDialog:has(.modal-body.log-mode) .modal-head p{display:none}.log-advanced[open]{max-height:80px}.log-primary{grid-template-columns:repeat(3,minmax(0,1fr))!important}.log-primary .log-search{grid-column:auto}.modal-nav{flex-wrap:nowrap!important;overflow-x:auto;flex-shrink:0}.modal-nav button{white-space:nowrap;flex:none}.log-actions{margin-top:6px}#pluginLogStatus{margin:5px 0}.modal-body.log-mode{padding-top:10px;padding-bottom:10px}#chapterSettings>.note{display:none}#chapterSettings>.section-toolbar{margin-bottom:6px}#chapterSettings>.switch-row{margin:8px 0}}
    @media(max-width:600px){.modal-nav{flex-wrap:wrap}dialog{width:calc(100vw - 16px);height:calc(100vh - 24px)}.modal-head,.modal-footer{padding:14px}.modal-body{padding:14px}.modal-nav{padding-left:14px}.section-grid{grid-template-columns:154px minmax(180px,1fr) 38px 38px minmax(130px,1fr) minmax(130px,1fr) 26px;padding:7px 6px;gap:4px}.section-toolbar{flex-wrap:wrap}.modal-footer{flex-wrap:wrap}#settingsStatus{flex-basis:100%}}
  </style><section class="panel"><header><div><div class="eyebrow">NETCARE · RFC</div><div class="title">方案与 AI 审计 / Solutions & AI audit</div></div><div class="header-actions"><button id="languageButton" class="icon" title="切换语言 / Change language">EN</button><button id="settingsButton" class="icon" aria-label="设置 / Settings" title="设置 / Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-2Z"/></svg></button><button id="close" class="icon" aria-label="关闭">×</button></div></header>
    <div class="badge" id="connection">导出服务：尚未连接</div><label for="order">RFC 单号 / RFC numbers</label>
    <textarea id="order" aria-label="RFC 单号列表" rows="3" placeholder="每行一个单号，也支持空格或逗号 / One RFC per line" autocomplete="off"></textarea>
    <div id="routeBanner" class="summary" hidden></div><div id="configSummary" class="summary"></div>
    <div class="actions"><button id="run" class="primary">下载与审计 / Download & audit</button><button id="stop" disabled>停止 / Stop</button></div>
    <div style="display:grid;gap:10px;margin:12px 0"><button id="pipOverview" style="width:100%" hidden>方案总览 · Beta / Solution overview · Beta</button><button id="auditResultsButton" style="width:100%">审计结果 / Audit results</button></div><div id="results" role="status"></div><pre id="log" role="status">输入单号开始下载 / Enter RFC numbers to start</pre><small>Ctrl / ⌘ + Enter 快速启动 · 配置保存在当前浏览器</small>
  </section>
  <dialog id="settingsDialog" aria-labelledby="settingsTitle"><div class="settings-shell"><div class="modal-head"><div><h2 id="settingsTitle">工具设置 / Settings</h2><p>下载偏好、章节规则与配置管理 / Preferences, sections & configuration</p></div><button id="settingsClose" class="icon" aria-label="关闭设置 / Close settings">×</button></div>
  <div class="modal-nav" role="tablist" aria-label="设置分类"><button id="generalTab" role="tab" aria-selected="true" aria-controls="generalSettings">常规 / General</button><button id="sectionsTab" role="tab" aria-selected="false" aria-controls="chapterSettings">章节规则 / Sections</button><button id="localRulesTab" role="tab" aria-selected="false" aria-controls="localRulesSettings">本地审计规则 / Local rules</button><button id="storageTab" role="tab" aria-selected="false" aria-controls="storageSettings">存储与快照 / Storage & snapshots</button><button id="logsTab" role="tab" aria-selected="false" aria-controls="pluginLogs">插件日志 / Plugin logs</button><button id="performanceTab" role="tab" aria-selected="false" tabindex="-1">性能监控 / Performance</button><button id="aiTab" role="tab" aria-selected="false" aria-controls="aiSettings">AI 对接 / AI models</button></div>
  <div class="modal-body"><div id="generalSettings" role="tabpanel" aria-labelledby="generalTab"><div class="settings-card"><h3>下载与在线方案 / Download preferences</h3><div class="field-row"><div><label for="concurrency">Word 下载并发数 / Concurrency</label><small>同时处理 1–10 个下载任务 / Process 1–10 downloads at once</small></div><select id="concurrency"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option><option>9</option><option>10</option></select></div><div class="field-row"><div><label for="openOnline">同时在线打开方案 / Open online</label><small>独立开关。只下载 Word 时关闭此项和自动提取。 / Independent switch; disable for Word only.</small></div><input id="openOnline" type="checkbox"></div><div class="field-row"><div><label for="readInterval">采集请求间隔（秒） / Request interval</label><small>多个在线方案页共享间隔，范围 1–30 秒</small></div><input type="number" id="readInterval" min="1" max="30" step="0.5"></div></div>
  <div class="settings-card"><label class="switch-row"><input type="checkbox" id="autoSelectSanitizedPlan">多方案时自动选择脱敏方案 / Automatically select a sanitized plan</label><p class="note">默认开启。只自动选择唯一明确标记的脱敏方案；关闭或无法唯一识别时，弹窗按顺序提示选择。 / On by default. Selects only one clearly labeled sanitized plan; otherwise requests a choice in order.</p></div><div class="settings-card"><h3>AI 审计 / AI audit</h3><label class="switch-row"><input type="checkbox" id="aiAuditEnabled">开启 AI 审计 / Enable AI audit</label><div id="attachmentTypesGroup" style="margin-top:10px;padding:10px;background:var(--soft);border-radius:8px;border:1px solid var(--line);transition:opacity 0.2s"><div style="font-weight:600;margin-bottom:6px;font-size:12px;color:var(--ink)">在线方案附件 AI 审计类型 / Attachment audit file types:</div><div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px"><label class="switch-row" style="margin:0"><input type="checkbox" id="auditTypeTxt" checked> <span>文本 (TXT)</span></label><label class="switch-row" style="margin:0"><input type="checkbox" id="auditTypeWord"> <span>Word (.docx, .doc)</span></label><label class="switch-row" style="margin:0"><input type="checkbox" id="auditTypeExcel"> <span>Excel (.xlsx, .xls, .csv)</span></label><label class="switch-row" style="margin:0"><input type="checkbox" id="auditTypeMsg"> <span>邮件 (.msg)</span></label></div><p class="note" style="margin:6px 0 0">勾选的文件类型将提取正文并送入模型进行AI审计；未勾选或不支持的格式仅下载并保留在离线材料包中，审计标记为人工检查。 / Checked types will have content extracted for AI audit; unchecked files are downloaded but flagged for manual review.</p></div><label class="switch-row" style="margin-top:10px"><input type="checkbox" id="disableLocalRules">禁用本地审计规则 / Disable local rules (仅使用 AI)</label><p class="note" id="disableLocalRulesNote" style="margin:4px 0 8px">开启后发生 AI 异常时不再回退本地正则规则；必须配置 AI 模型，失败时将多次重试，并弹窗询问是否继续重试。 / If enabled, does not fall back to local rules on AI error; an AI model must be configured, retries will be attempted, and a confirmation dialog will prompt before skipping.</p><p class="note" style="margin-top:8px">开启后向配置的模型发送有规则的章节文本及勾选的附件格式。其它文件标记为需人工检查。先在“AI 对接”保存模型。 / Sends selected evidence to your model.</p></div><div class="settings-card"><h3>自动提取 / Automatic extraction</h3><label class="switch-row"><input type="checkbox" id="autoAttachments">指定章节的附件 / Section attachments</label><label class="switch-row"><input type="checkbox" id="autoText">指定章节的文本 / Section text</label><label class="switch-row"><input type="checkbox" id="screenshotsEnabled">保存原始区域截图（PNG） / Save source screenshots</label><label class="switch-row" style="margin-left:22px"><input type="checkbox" id="embedScreenshotsInExcel">同步保存截图到导出审计 Excel / Embed screenshots in exported Excel</label><p class="note" style="margin:-4px 0 8px 22px">默认关闭。关闭后导出的 Excel 无浮动截图图片，表格筛选过滤时行高整洁不挤压；完整截图依然会打包保留在审计材料 ZIP 中。 / Disabled by default. Keeps exported Excel clean and filterable without squashed floating images; full screenshots are always preserved in the materials ZIP.</p><label class="switch-row"><input type="checkbox" id="closeAfterAudit">审计完成后自动关闭在线方案页签 / Close online tabs after audit</label><p class="note">汇总保存并发起 ZIP 下载后关闭；异常或停止时保留页签。 / Closes after saving results and starting ZIP download; keeps tabs on errors or stop.</p><p class="note">开启后在线提取所选章节并打包；AI 审计会自动启用有提示词的必需提取。 / Select sections in the next tab; ZIP follows Word export.</p></div>
  <div class="settings-card"><h3>配置管理 / Configuration</h3><iframe id="backupFrame" title="完整配置备份 / Full configuration backup" style="width:100%;height:230px;border:0"></iframe><div class="config-actions"><button id="importSettings" hidden>导入 JSON / Import</button><button id="exportSettings" hidden>导出 JSON / Export</button><button id="resetSections">恢复默认 / Reset</button></div><input id="importFile" type="file" accept=".json,application/json" hidden><p class="note">导出已保存配置。修改后先保存，再导出完整备份；导入完整备份立即恢复。 / Save changes before backup; import restores immediately.</p></div><div class="settings-card"><h3>测试功能 / Experimental features</h3><label class="switch-row"><input type="checkbox" id="pipBetaEnabled">在线方案画中画总览（Beta） / Online solution previews (Beta)</label><p class="note">默认关闭。在线方案保留在后台页签，主页面定期更新只读预览；点击放大，拖动标题移动，右下角等比缩放。原页面操作可打开原页。 / Off by default. Keeps background tabs and periodically refreshes read-only previews. Click to enlarge, drag headers to move and corners to resize. Open the original tab for native controls.</p></div></div>
  <div id="chapterSettings" role="tabpanel" aria-labelledby="sectionsTab" hidden><div class="section-toolbar"><strong>章节模板 <span id="sectionCount"></span> / Sections</strong><button id="addSection" aria-expanded="false" aria-controls="sectionAddPanel">＋ 添加章节 / Add</button></div><p class="note">父章节包含全部子章节；子章节继承选择与提示词并锁定，清空父规则后可独立设置。文件名使用实际章节。 / Parents include descendants; inherited selections and rules are locked until the parent rule is cleared.</p><label class="switch-row"><input type="checkbox" id="titleFallbackEnabled">序号缺失或名称不符时按章节名称纠错 / Correct by title when numbers are missing or titles differ</label><p class="note">开启后同时核对编号和完整名称；编号缺失或名称不符时按名称纠错，结果显示纠错前后章节。继承子章节始终限定在所选父章节范围；同名章节无法唯一定位时提示核查。 / Checks numbers and full titles, corrects missing numbers or mismatched titles and shows before/after sections. Inherited children stay within the matched parent; ambiguous titles require review.</p><div class="section-table"><div id="sectionAddPanel" class="settings-card section-add" hidden><h3>选择新章节的位置 / New section location</h3><label for="sectionParent">顶级章节或父章节 / Top level or parent section</label><select id="sectionParent"></select><p id="sectionAddPreview" role="status"></p><p>自动生成同层级的下一个序号，按序插入并定位到名称输入框。 / Generates the next sibling number, inserts in order and focuses its title.</p><div class="config-actions"><button id="confirmSectionAdd" class="primary">添加并定位 / Add & locate</button><button id="cancelSectionAdd">取消 / Cancel</button></div></div><div class="section-grid table-head"><span>序号 / No.</span><span>章节名称 / Title</span><span>附件</span><span>文本</span><span>附件检查提示词 / Attachment rule</span><span>文本检查提示词 / Text rule</span><span></span></div><div id="sectionRows"></div></div></div><div id="localRulesSettings" role="tabpanel" aria-labelledby="localRulesTab" hidden><div class="section-toolbar"><strong>本地审计规则 <span id="localRuleCount"></span> / Local rules</strong><div class="config-actions"><button id="addLocalRule">＋ 添加规则 / Add</button><button id="resetLocalRules">恢复预制规则 / Reset</button></div></div><p class="note">开启 AI 审计后，若模型遇到异常、网络超时或未配置，将自动回退到匹配的本地规则进行关键词正则判定。支持绑定章节序号和章节名称。 / When AI audit encounters model errors, automatically falls back to matching local regex rules.</p><div id="localRuleFormCard" class="settings-card" hidden><h3 id="localRuleFormTitle">编辑规则 / Edit rule</h3><input type="hidden" id="localRuleId"><div class="field-row"><div><label for="localRuleName">规则名称 / Rule name</label><small>标识审计项，如“1.1 变更目的检查”</small></div><input type="text" id="localRuleName" maxlength="100" placeholder="规则名称 / Rule name"></div><div class="field-row"><div><label for="localRuleSectionNumber">绑定章节序号 / Section number</label><small>精确或前缀匹配，如 1.1；留空匹配全部</small></div><input type="text" id="localRuleSectionNumber" maxlength="40" placeholder="例如：1.1 / e.g. 1.1"></div><div class="field-row"><div><label for="localRuleSectionTitle">绑定章节名称 / Section title</label><small>匹配章节名称关键词；留空匹配全部</small></div><input type="text" id="localRuleSectionTitle" maxlength="200" placeholder="例如：Change Purpose"></div><div class="field-row"><div><label for="localRuleKind">适用类型 / Kind</label><small>限制正文、附件或两者皆可</small></div><select id="localRuleKind"><option value="all">全部（正文与附件） / All</option><option value="text">章节文本 / Text</option><option value="attachments">方案附件 / Attachments</option></select></div><div class="field-row"><div><label for="localRulePattern">自定义正则表达式 / Regex pattern</label><small>关键词匹配正则，如 (?:变更目的|Purpose)</small></div><input type="text" id="localRulePattern" maxlength="1000" placeholder="正则表达式 / Regular expression"></div><div class="field-row"><div><label for="localRuleCondition">判定逻辑 / Condition</label><small>匹配合格或不匹配合格（黑名单）</small></div><select id="localRuleCondition"><option value="match">正则匹配即合格 / Pass if matched</option><option value="not_match">正则不匹配即合格（黑名单） / Pass if not matched</option></select></div><div class="field-row"><div><label for="localRulePassSummary">合格结论 / Pass summary</label><small>满足条件时的审计结论说明</small></div><input type="text" id="localRulePassSummary" maxlength="500" placeholder="变更目的已明确 / Specified"></div><div class="field-row"><div><label for="localRuleFailSummary">不合格结论 / Fail summary</label><small>未满足条件时的审计结论说明</small></div><input type="text" id="localRuleFailSummary" maxlength="500" placeholder="缺少变更目的说明 / Missing"></div><label class="switch-row"><input type="checkbox" id="localRuleEnabled" checked>启用此规则 / Enable rule</label><p id="localRuleFormError" class="note" style="color:#d96570" role="status"></p><div class="config-actions"><button id="saveLocalRule" class="primary">保存规则 / Save</button><button id="cancelLocalRule">取消 / Cancel</button></div></div><div class="section-table"><div class="local-rule-grid table-head"><span>启用</span><span>规则名称 / Name</span><span>绑定章节 / Section</span><span>类型</span><span>正则表达式 / Pattern</span><span>判定逻辑</span><span>操作</span></div><div id="localRuleRows"></div></div></div><div id="storageSettings" role="tabpanel" hidden><div class="settings-card"><h3>插件存储 / Extension storage</h3><p id="storageUsage"></p><div id="storageBar" class="storage-multi-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div><progress id="storageMeter" max="1" value="0" style="width:100%" hidden></progress><div id="storageBreakdown" class="storage-breakdown-grid"></div><div class="field-row"><label for="storageCapacity">容量上限（MB） / Capacity (MB)</label><input id="storageCapacity" type="number" min="50" step="50"></div><p class="note">默认500MB，最多使用浏览器配额的一半且不超过2GB；不足时自动清理最旧快照及不再引用的材料。浏览器可能清理扩展数据，请定期下载备份。 / Default 500MB; capped at half the browser quota and 2GB. Oldest snapshots are removed when full. Download backups regularly.</p><button id="storageApply">应用容量 / Apply capacity</button><p id="storageMessage" role="status"></p></div><div class="settings-card"><div class="section-toolbar"><h3>历史快照 / Snapshot history</h3><button id="storageRefresh">刷新 / Refresh</button></div><div class="config-actions"><button id="snapSelectAll">全选 / Select all</button><button id="snapSelectNone">取消选择 / Clear selection</button></div><div id="snapshotRows"></div><p id="cleanupPreview"></p><div class="config-actions"><button id="snapshotBackup" class="primary">下载待清理快照与材料 / Backup selected</button><button id="snapshotDelete">删除所选快照 / Delete selected</button></div><p class="note">清理不会删除已下载到本地的文件；共享材料只在不再被任何快照引用时删除。 / Local downloads are kept. Shared files are removed only when no snapshot references them.</p></div><div class="settings-card" id="materialsCleanupCard"><div class="section-toolbar"><h3>按类别与保留天数清理材料 / Clean materials by category & retention</h3><button id="materialsCleanupRefresh">刷新预估 / Refresh</button></div><p class="note">即使未保存历史快照，提取的截图、附件、正文文本和未归档日志也会暂存在材料存储中。您可以在此按类别或按天数清理暂存内容，释放存储空间。 / Extracted screenshots, attachments, text and logs sit in storage even without saved snapshots. Clean them here by category or retention days.</p><div class="materials-clean-grid"><label class="materials-clean-chip"><input type="checkbox" id="cleanCatScreenshots" checked> <span class="storage-dot" style="background:#3b82f6"></span> <span>方案截图 / Screenshots</span> <small id="cleanCountScreenshots"></small></label><label class="materials-clean-chip"><input type="checkbox" id="cleanCatAttachments" checked> <span class="storage-dot" style="background:#f59e0b"></span> <span>方案附件 / Attachments</span> <small id="cleanCountAttachments"></small></label><label class="materials-clean-chip"><input type="checkbox" id="cleanCatTexts" checked> <span class="storage-dot" style="background:#10b981"></span> <span>方案文本 / Texts</span> <small id="cleanCountTexts"></small></label><label class="materials-clean-chip"><input type="checkbox" id="cleanCatBundles"> <span class="storage-dot" style="background:#8b5cf6"></span> <span>审计包与Word / Bundles & Word</span> <small id="cleanCountBundles"></small></label><label class="materials-clean-chip"><input type="checkbox" id="cleanCatLogs" checked> <span class="storage-dot" style="background:#06b6d4"></span> <span>未归档日志 / Log buffer</span> <small id="cleanCountLogs"></small></label></div><div class="field-row" style="margin-top:10px"><div><label for="materialsRetentionDays">保留期限 / Retention period</label><small>选择保留最近几天的材料，清理早于该期限的内容</small></div><select id="materialsRetentionDays"><option value="0">清理全部匹配材料（不限天数） / All matching</option><option value="1">仅清理 1 天前的材料 / Older than 1 day</option><option value="3">仅清理 3 天前的材料 / Older than 3 days</option><option value="7">仅清理 7 天前的材料 / Older than 7 days</option><option value="14">仅清理 14 天前的材料 / Older than 14 days</option><option value="30">仅清理 30 天前的材料 / Older than 30 days</option></select></div><label class="switch-row" style="margin:10px 0 6px"><input type="checkbox" id="protectSnapshotRefs" checked><strong>保护历史快照引用的材料 / Protect snapshot files (推荐 / Recommended)</strong></label><p id="materialsCleanupPreview" class="note" style="margin:8px 0;font-weight:600;color:var(--ink)"></p><div class="config-actions"><button id="materialsCleanupExecute" class="primary">执行清理 / Clean up</button></div><p id="materialsCleanupStatus" role="status"></p></div></div><div id="performanceSettings" role="tabpanel" hidden><style>.performance-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.performance-cards article{border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--soft)}.performance-cards strong{display:block;font-size:23px;margin:8px 0;color:var(--ink)}.performance-cards small{margin:0}.performance-chart{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px}.performance-chart h3{margin:0 0 8px}.performance-plots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.performance-chart svg{display:block;width:100%;color:var(--muted);height:150px;margin-top:auto}.performance-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.performance-toolbar select{padding:6px;max-width:100%;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:7px}.performance-table{overflow:auto;max-height:260px;margin-top:14px}.performance-table table{border-collapse:collapse;width:100%;font-size:11px}.performance-table td,.performance-table th{padding:8px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}.performance-table th{position:sticky;top:0;background:var(--bg)}.metric-stale{opacity:.55}#performanceWarning{background:var(--soft);color:#bc862d;padding:10px;border-radius:8px}@media(max-width:700px){.performance-plots{grid-template-columns:1fr}}@media(max-width:600px){.performance-cards{grid-template-columns:1fr}.performance-cards strong{font-size:20px}}</style><div class="performance-toolbar"><strong>性能监控 / Performance monitor</strong><select id="performanceRange" aria-label="趋势时间范围 / Trend range"><option value="1440">最近24小时 / Last 24 hours</option><option value="360">最近6小时 / Last 6 hours</option><option value="60">最近1小时 / Last hour</option><option value="15">最近15分钟 / Last 15 minutes</option></select><button id="performanceRefresh">刷新 / Refresh</button></div><p class="note">浏览器无法提供插件独立 RAM 或 CPU 利用率。以下为包含网站本身的页面 JS 堆、长任务阻塞占比与响应延迟，仅供判断页面压力；不同页签可能共享内存，因此不累加。 / Independent extension RAM/CPU is unavailable. These page JS heap, long-task occupancy and response-delay references include the website. Tabs may share memory, so values are not summed.</p><div class="performance-cards"><article>主页面 JS 堆 / Main-page JS heap<strong id="performanceHeap">—</strong><small>含网站脚本 / Includes site scripts</small></article><article>最繁忙页面阻塞占比 / Peak page blocking<strong id="performanceBusy">—</strong><small id="performanceCpu"></small></article><article>前台响应延迟 / Foreground response delay<strong id="performanceLag">—</strong><small>后台节流不计入 / Background throttling excluded</small></article></div><p id="performanceWarning" hidden role="status"></p><p id="performanceStatus" class="note" role="status"></p><div class="performance-plots"><div class="performance-chart"><div class="performance-toolbar"><h3>JS 堆内存趋势（MB） / JS heap trend (MB)</h3><select id="performanceMemoryScope" aria-label="内存趋势指标 / Memory metric"><option value="mainHeap">主页面 / Main page</option><option value="otherHeap">其他页面最大值 / Maximum of other pages</option></select></div><svg id="performanceMemoryChart" role="img" aria-label="内存趋势 / Memory trend"></svg></div><div class="performance-chart"><h3>主线程阻塞占比趋势（非 CPU 利用率） / Main-thread blocking trend (not CPU utilization)</h3><svg id="performanceCpuChart" role="img" aria-label="主线程阻塞趋势 / Main-thread blocking trend"></svg></div></div><div class="performance-table"><table><thead><tr><th>页面或单号 / Page or RFC</th><th>站点 / Site</th><th>JS 堆 / JS heap</th><th>阻塞占比 / Blocking</th><th>响应延迟 / Delay</th><th>状态 / Status</th><th>更新时间 / Updated</th></tr></thead><tbody id="performanceSources"></tbody></table></div></div><div id="aiSettings" role="tabpanel" aria-labelledby="aiTab" hidden><iframe id="aiFrame" title="AI 模型配置 / AI model settings"></iframe><p id="aiFrameStatus" class="note">等待扩展模型配置模块连接 / Waiting for extension</p></div><div id="pluginLogs" role="tabpanel" aria-labelledby="logsTab" hidden><div class="log-filters log-primary"><label>日志范围 / Scope<select id="logScope"><option value="all">全部日志 / All logs</option><option value="pending">未关联快照 / Without snapshot</option></select></label><label>RFC 单号 / RFC<input id="logRfc" placeholder="筛选 RFC / Filter RFC"></label><label class="log-search">关键词 / Keyword<input id="logSearch" placeholder="搜索并高亮关键词 / Search and highlight"></label></div><details class="log-advanced"><summary>分类、级别与时间 / Category, level & time</summary><div class="log-filters"><label>日志分类 / Category<select id="logCategory"><option value="">全部分类 / All categories</option><option value="operation">操作 / Operations</option><option value="configuration">配置 / Configuration</option><option value="extraction">提取 / Extraction</option><option value="audit">审计 / Audit</option><option value="storage">存储 / Storage</option><option value="system">系统 / System</option></select></label><label>级别 / Level<select id="logLevel"><option value="">全部级别 / All levels</option><option value="debug">调试 / Debug</option><option value="info">信息 / Info</option><option value="warn">警告 / Warning</option><option value="error">错误 / Error</option></select></label><label>开始时间 / From<input id="logFrom" type="datetime-local"></label><label>结束时间 / To<input id="logTo" type="datetime-local"></label></div></details><div class="config-actions log-actions"><button id="logRefresh">刷新 / Refresh</button><button id="logReset">清除筛选 / Reset filters</button><button id="logExport" class="primary">导出筛选日志 / Export filtered logs</button><button id="logFullscreen" type="button" class="log-fs-btn" title="全屏查看日志 / Fullscreen">⛶ 全屏 / Fullscreen</button><label><input id="logLive" type="checkbox" checked>实时刷新 / Live</label></div><p id="pluginLogStatus" class="note" role="status"></p><div id="pluginLogEntries" class="plugin-log-list"></div><div class="log-pagination"><button id="logPrevious">上一页 / Previous</button><span id="logPage"></span><button id="logNext">下一页 / Next</button></div></div></div>
  <div class="modal-footer"><div id="settingsStatus" role="status"></div><button id="cancelSettings">取消 / Cancel</button><button id="saveSettings" class="primary">保存设置 / Save</button></div></div></dialog><dialog id="auditSummaryDialog" aria-labelledby="auditSummaryTitle"><div class="settings-shell"><div class="modal-head"><div><h2 id="auditSummaryTitle">审计结果 / Audit results</h2><p id="auditCounts">尚无结果 / No results</p></div><button id="auditSummaryClose" class="icon" aria-label="关闭审计汇总 / Close audit results">×</button></div><div class="audit-toolbar"><select id="snapshotSelect" aria-label="历史快照 / Snapshot history"><option value="">当前结果 / Current results</option></select><button id="snapshotSave">保存快照 / Save snapshot</button><button id="auditExcel" class="primary">导出审计 Excel / Export</button><button id="auditBundle">下载审计材料 ZIP / Materials</button><span id="auditExportStatus" role="status"></span></div><div id="auditSummaryBody" class="modal-body"></div></div></dialog><dialog id="auditImageDialog" aria-labelledby="auditImageTitle"><div class="settings-shell"><div class="modal-head"><div><h2 id="auditImageTitle">原始区域截图 / Source screenshot</h2><p id="auditImageName" data-user-content></p><p id="auditImageHint">点击图片切换原图尺寸 / Click image to toggle original size</p></div><button id="auditImageClose" class="icon" aria-label="关闭截图 / Close screenshot">×</button></div><div class="audit-image-body"><img id="auditImage" alt=""></div></div></dialog><dialog id="confirmationDialog" aria-labelledby="confirmationTitle"><div class="modal-head"><h2 id="confirmationTitle"></h2></div><p id="confirmationMessage"></p><div class="modal-footer"><button id="confirmationCancel">取消 / Cancel</button><button id="confirmationAccept" class="primary">确认 / Confirm</button></div></dialog>`;
  document.body.append(host);
  const $ = id => root.getElementById(id);
  let active;
  const bridges = new Map(), jobs = new Map();
  const translations = {
    '导出服务连接成功。': 'Export service connected.',
    '读取方案信息…': 'Reading solution…',
    '创建 Word 转换任务…': 'Creating Word conversion task…',
    'Word 已生成，正在获取文件…': 'Word generated; fetching file…',
    '已停止等待': 'Stopped waiting.',
    '通过网站原生搜索定位作业单…': 'Finding RFC through the site search…',
    '调用网站原生下载入口，检查授权…': 'Checking authorization through the native download action…',
    '授权入口已通过，开始生成 Word…': 'Authorization passed; generating Word…',
    '单号格式应为 NC + 14 位数字。': 'RFC must be NC followed by 14 digits.'
  };
  const translate = text => translations[text] ? `${text} / ${translations[text]}` : text;
  const log = text => {
    $('log').textContent += '\n' + translate(text);
    $('log').scrollTop = $('log').scrollHeight;
  };
  let extractionSettings = netcareDefaultSettings(), settingsLoaded = false;
  const updateExtractionUiState = () => {
    const anyExtraction = $('autoAttachments').checked || $('autoText').checked;
    $('screenshotsEnabled').disabled = !anyExtraction;
    if (!anyExtraction) $('screenshotsEnabled').checked = false;

    const shotOn = $('screenshotsEnabled').checked && !$('screenshotsEnabled').disabled;
    if ($('embedScreenshotsInExcel')) {
      $('embedScreenshotsInExcel').disabled = !shotOn;
      if (!shotOn) $('embedScreenshotsInExcel').checked = false;
    }

    const aiOn = $('aiAuditEnabled').checked;
    $('closeAfterAudit').disabled = !aiOn;
    if (!aiOn) $('closeAfterAudit').checked = false;

    const typesGroup = $('attachmentTypesGroup');
    if (typesGroup) {
      typesGroup.style.opacity = aiOn ? '1' : '0.55';
      typesGroup.style.pointerEvents = aiOn ? 'auto' : 'none';
    }
    ['auditTypeTxt', 'auditTypeWord', 'auditTypeExcel', 'auditTypeMsg'].forEach(id => {
      const el = $(id);
      if (el) el.disabled = !aiOn;
    });
    const disableRulesEl = $('disableLocalRules');
    if (disableRulesEl) {
      disableRulesEl.disabled = !aiOn;
      if (!aiOn) disableRulesEl.checked = false;
    }
  };
  $('autoAttachments').onchange = () => { updateExtractionUiState(); refreshSectionInheritance(); };
  $('autoText').onchange = () => { updateExtractionUiState(); refreshSectionInheritance(); };
  $('screenshotsEnabled').onchange = updateExtractionUiState;
  $('aiAuditEnabled').onchange = () => { updateExtractionUiState(); refreshSectionInheritance(); };
  $('disableLocalRules').onchange = () => {
    if ($('disableLocalRules').checked && !$('aiAuditEnabled').checked) {
      $('aiAuditEnabled').checked = true;
    }
    updateExtractionUiState();
  };

  const renderSettings = () => {
    $('autoSelectSanitizedPlan').checked=extractionSettings.autoSelectSanitizedPlan; $('pipBetaEnabled').checked=extractionSettings.pipBetaEnabled; $('closeAfterAudit').checked=extractionSettings.closeAfterAudit; $('titleFallbackEnabled').checked=extractionSettings.titleFallbackEnabled;
    $('aiAuditEnabled').checked = extractionSettings.aiAuditEnabled;
    $('disableLocalRules').checked = extractionSettings.disableLocalRules === true;
    $('concurrency').value = extractionSettings.concurrency; $('openOnline').checked = extractionSettings.openOnline;
    updatePreferenceSummary();
    $('screenshotsEnabled').checked=extractionSettings.screenshotsEnabled!==false;
    if ($('embedScreenshotsInExcel')) $('embedScreenshotsInExcel').checked=extractionSettings.embedScreenshotsInExcel===true;
    $('autoAttachments').checked = extractionSettings.attachmentsEnabled; $('autoText').checked = extractionSettings.textEnabled;
    $('readInterval').value = extractionSettings.intervalMs / 1000; $('sectionRows').replaceChildren();$('sectionAddPanel').hidden=true;$('addSection').setAttribute('aria-expanded','false');focusedSectionNumber='';
    for (const row of extractionSettings.sections) addSectionRow(row);
    localRulesDraft = (extractionSettings.localRules || netcareDefaultLocalRules()).map(r => ({ ...r }));
    $('localRuleFormCard').hidden = true;
    renderLocalRules();
    const enabledTypes = new Set(extractionSettings.attachmentAuditTypes || ['txt']);
    if ($('auditTypeTxt')) $('auditTypeTxt').checked = enabledTypes.has('txt');
    if ($('auditTypeWord')) $('auditTypeWord').checked = enabledTypes.has('word');
    if ($('auditTypeExcel')) $('auditTypeExcel').checked = enabledTypes.has('excel');
    if ($('auditTypeMsg')) $('auditTypeMsg').checked = enabledTypes.has('msg');
    updateExtractionUiState();
    refreshSectionInheritance();
  };
  let focusedSectionNumber='';
  function sectionDrafts(){return Array.from($('sectionRows').children,line=>({...line._draft,number:line.querySelector('[data-field=number]').value.trim(),title:line.querySelector('[data-field=title]').value.trim()}));}
  function refreshSectionInheritance(){
    const rows=sectionDrafts(), settings={sections:rows};
    const autoAttachmentsOn = $('autoAttachments').checked;
    const autoTextOn = $('autoText').checked;
    const aiAuditOn = $('aiAuditEnabled').checked;
    Array.from($('sectionRows').children).forEach((line,i)=>{
      const row=rows[i], effective=netcareEffectiveSection(settings,row.number), depth=Math.max(0,row.number.split('.').length-1);
      line.dataset.depth=String(Math.min(depth,2));line.style.setProperty('--depth',Math.min(depth,4));
      const branch=line.querySelector('.tree-branch');branch.replaceChildren();branch.hidden=!depth;for(let level=0;level<Math.min(depth,4);level++){const stem=document.createElement('i');stem.style.left=(level*18+5)+'px';branch.append(stem);}if(depth){const arm=document.createElement('b');arm.style.left=((Math.min(depth,4)-1)*18+5)+'px';branch.append(arm);}
      for(const kind of ['attachments','text']){
        const box=line.querySelector(`[data-field=${kind}]`),prompt=line.querySelector(`[data-field=${kind}Prompt]`);
        const ancestors=rows.filter(r=>row.number.startsWith(r.number+'.'));
        const autoKindOn = kind === 'attachments' ? autoAttachmentsOn : autoTextOn;
        prompt.disabled = !aiAuditOn || ancestors.some(r=>r[kind+'Prompt']?.trim());
        prompt.value=effective[kind+'Prompt'];
        box.checked=autoKindOn && effective[kind];
        box.disabled=!autoKindOn || !!effective[kind+'Prompt']||ancestors.some(r=>r[kind]||r[kind+'Prompt']?.trim());
      }
    });
    $('sectionCount').textContent=`(${$('sectionRows').children.length})`;
  }
  function addSectionRow(row) {
    const line=document.createElement('div');line.className='section-grid';line._draft={...row};line.addEventListener('focusin',()=>{focusedSectionNumber=line.querySelector('[data-field=number]').value.trim();});
    for(const field of ['number','title']){const input=document.createElement('input');input.type='text';input.value=row[field];input.dataset.field=field;input.setAttribute('aria-label',field==='number'?'章节序号 / Section number':'章节名称 / Section title');input.oninput=refreshSectionInheritance;if(field==='number'){const cell=document.createElement('div');cell.className='section-number';const branch=document.createElement('span');branch.className='tree-branch';branch.setAttribute('aria-hidden','true');cell.append(branch,input);line.append(cell);}else line.append(input);}
    for(const kind of ['attachments','text']){const label=document.createElement('label'),box=document.createElement('input');label.className='check-cell';box.type='checkbox';box.dataset.field=kind;box.setAttribute('aria-label',kind==='text'?'文本 / Text':'附件 / Attachments');box.onchange=()=>{line._draft[kind]=box.checked;refreshSectionInheritance();};label.append(box);line.append(label);}
    for(const kind of ['attachments','text']){const prompt=document.createElement('textarea');prompt.dataset.field=kind+'Prompt';prompt.setAttribute('aria-label',kind==='text'?'文本检查提示词 / Text rule':'附件检查提示词 / Attachment rule');prompt.placeholder='填写后自动勾选并锁定 / Required when set';prompt.oninput=()=>{line._draft[kind+'Prompt']=prompt.value;refreshSectionInheritance();};line.append(prompt);}
    const remove=document.createElement('button');remove.textContent='×';remove.className='delete';remove.setAttribute('aria-label','删除章节 / Delete section');remove.onclick=()=>{line.remove();refreshSectionInheritance();};line.append(remove);$('sectionRows').append(line);refreshSectionInheritance();return line;
  }
  let localRulesDraft = [];
  function renderLocalRules() {
    $('localRuleCount').textContent = `(${localRulesDraft.length})`;
    const container = $('localRuleRows');
    container.replaceChildren();
    if (!localRulesDraft.length) {
      const empty = document.createElement('div');
      empty.className = 'summary';
      empty.style.padding = '14px';
      empty.textContent = '暂无本地审计规则，可点击“恢复预制规则”或“＋ 添加规则” / No local rules. Click "Reset" or "Add".';
      container.append(empty);
      return;
    }
    localRulesDraft.forEach((rule, index) => {
      const row = document.createElement('div');
      row.className = 'local-rule-grid';
      if (!rule.enabled) row.style.opacity = '0.6';
      const enableCell = document.createElement('div');
      enableCell.className = 'check-cell';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = rule.enabled !== false;
      toggle.setAttribute('aria-label', '启用状态 / Enabled');
      toggle.onchange = () => {
        rule.enabled = toggle.checked;
        row.style.opacity = rule.enabled ? '1' : '0.6';
      };
      enableCell.append(toggle);
      row.append(enableCell);

      const nameCell = document.createElement('div');
      nameCell.style.fontWeight = '550';
      nameCell.textContent = rule.name;
      nameCell.setAttribute('data-user-content', '');
      row.append(nameCell);

      const secCell = document.createElement('div');
      secCell.textContent = [rule.sectionNumber, rule.sectionTitle].filter(Boolean).join(' ') || '全部 / All';
      secCell.setAttribute('data-user-content', '');
      row.append(secCell);

      const kindCell = document.createElement('div');
      kindCell.textContent = rule.kind === 'text' ? '正文 / Text' : rule.kind === 'attachments' ? '附件 / Att' : '全部 / All';
      row.append(kindCell);

      const patCell = document.createElement('div');
      const code = document.createElement('code');
      code.textContent = rule.pattern || '—';
      code.style.font = '10px ui-monospace,monospace';
      code.style.overflowWrap = 'anywhere';
      patCell.append(code);
      row.append(patCell);

      const condCell = document.createElement('div');
      condCell.textContent = rule.passCondition === 'not_match' ? '不匹配通过' : '匹配通过';
      row.append(condCell);

      const actCell = document.createElement('div');
      actCell.className = 'local-rule-actions';
      const editBtn = document.createElement('button');
      editBtn.textContent = '编辑';
      editBtn.setAttribute('aria-label', '编辑规则 / Edit');
      editBtn.onclick = () => openLocalRuleForm(index);
      const delBtn = document.createElement('button');
      delBtn.textContent = '删除';
      delBtn.setAttribute('aria-label', '删除规则 / Delete');
      delBtn.onclick = () => {
        localRulesDraft.splice(index, 1);
        renderLocalRules();
      };
      actCell.append(editBtn, delBtn);
      row.append(actCell);

      container.append(row);
    });
  }

  let editingRuleIndex = -1;
  function openLocalRuleForm(index = -1) {
    editingRuleIndex = index;
    $('localRuleFormError').textContent = '';
    const formCard = $('localRuleFormCard');
    formCard.hidden = false;
    if (index >= 0) {
      const rule = localRulesDraft[index];
      $('localRuleFormTitle').textContent = '编辑规则 / Edit rule';
      $('localRuleId').value = rule.id || '';
      $('localRuleName').value = rule.name || '';
      $('localRuleSectionNumber').value = rule.sectionNumber || '';
      $('localRuleSectionTitle').value = rule.sectionTitle || '';
      $('localRuleKind').value = rule.kind || 'all';
      $('localRulePattern').value = rule.pattern || '';
      $('localRuleCondition').value = rule.passCondition || 'match';
      $('localRulePassSummary').value = rule.passSummary || '';
      $('localRuleFailSummary').value = rule.failSummary || '';
      $('localRuleEnabled').checked = rule.enabled !== false;
    } else {
      $('localRuleFormTitle').textContent = '添加新规则 / Add rule';
      $('localRuleId').value = 'rule-' + crypto.randomUUID().slice(0, 8);
      $('localRuleName').value = '';
      $('localRuleSectionNumber').value = '';
      $('localRuleSectionTitle').value = '';
      $('localRuleKind').value = 'all';
      $('localRulePattern').value = '';
      $('localRuleCondition').value = 'match';
      $('localRulePassSummary').value = '符合要求 / Compliant';
      $('localRuleFailSummary').value = '不符合要求，需人工核查 / Non-compliant';
      $('localRuleEnabled').checked = true;
    }
    formCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('localRuleName').focus();
  }

  $('addLocalRule').onclick = () => openLocalRuleForm(-1);
  $('cancelLocalRule').onclick = () => { $('localRuleFormCard').hidden = true; };
  $('resetLocalRules').onclick = () => {
    localRulesDraft = netcareDefaultLocalRules();
    $('localRuleFormCard').hidden = true;
    renderLocalRules();
  };

  $('saveLocalRule').onclick = () => {
    const name = $('localRuleName').value.trim();
    if (!name) { $('localRuleFormError').textContent = '请输入规则名称 / Enter rule name'; return; }
    const pattern = $('localRulePattern').value.trim();
    if (!pattern) { $('localRuleFormError').textContent = '请输入正则表达式 / Enter regex pattern'; return; }
    try { new RegExp(pattern, 'i'); }
    catch (e) { $('localRuleFormError').textContent = `正则表达式无效: ${e.message}`; return; }
    const ruleObj = {
      id: $('localRuleId').value || ('rule-' + crypto.randomUUID().slice(0, 8)),
      name,
      sectionNumber: $('localRuleSectionNumber').value.trim(),
      sectionTitle: $('localRuleSectionTitle').value.trim(),
      kind: $('localRuleKind').value,
      pattern,
      passCondition: $('localRuleCondition').value,
      passSummary: $('localRulePassSummary').value.trim() || '符合要求 / Compliant',
      failSummary: $('localRuleFailSummary').value.trim() || '不符合要求，需人工核查 / Non-compliant',
      enabled: $('localRuleEnabled').checked
    };
    if (editingRuleIndex >= 0) {
      localRulesDraft[editingRuleIndex] = ruleObj;
    } else {
      if (localRulesDraft.length >= 100) { $('localRuleFormError').textContent = '本地规则最多 100 条 / Max 100 rules'; return; }
      localRulesDraft.push(ruleObj);
    }
    $('localRuleFormCard').hidden = true;
    renderLocalRules();
  };

  const readSettings=()=>netcareNormalizeSettings({
    autoSelectSanitizedPlan:$('autoSelectSanitizedPlan').checked,
    pipBetaEnabled:$('pipBetaEnabled').checked,
    closeAfterAudit:$('closeAfterAudit').checked,
    titleFallbackEnabled:$('titleFallbackEnabled').checked,
    screenshotsEnabled:$('screenshotsEnabled').checked,
    embedScreenshotsInExcel:$('screenshotsEnabled').checked && ($('embedScreenshotsInExcel')?.checked === true),
    aiAuditEnabled:$('aiAuditEnabled').checked,
    disableLocalRules:$('disableLocalRules')?.checked && $('aiAuditEnabled')?.checked,
    concurrency:Number($('concurrency').value),
    openOnline:$('openOnline').checked,
    attachmentsEnabled:$('autoAttachments').checked,
    textEnabled:$('autoText').checked,
    intervalMs:Number($('readInterval').value)*1000,
    attachmentAuditTypes: [
      $('auditTypeTxt')?.checked ? 'txt' : null,
      $('auditTypeWord')?.checked ? 'word' : null,
      $('auditTypeExcel')?.checked ? 'excel' : null,
      $('auditTypeMsg')?.checked ? 'msg' : null
    ].filter(Boolean),
    sections:sectionDrafts(),
    localRules:localRulesDraft.slice()
  });
  const closeSectionAdd=()=>{$('sectionAddPanel').hidden=true;$('addSection').setAttribute('aria-expanded','false');};
  const previewSectionAdd=()=>{const number=netcareNextSectionNumber(sectionDrafts(),$('sectionParent').value);$('sectionAddPreview').textContent=`新章节序号：${number} / New section number: ${number}`;};
  $('addSection').onclick=()=>{
    const rows=sectionDrafts(),select=$('sectionParent');select.replaceChildren();
    const top=document.createElement('option');top.value='';top.textContent='新增顶级章节 / New top-level section';select.append(top);
    for(const row of rows.filter(r=>/^\d+(\.\d+)*$/.test(r.number)).sort((a,b)=>netcareCompareSectionNumbers(a.number,b.number))){const option=document.createElement('option');option.value=row.number;option.textContent=row.number+' · '+(row.title||tr('未命名','Untitled'));option.setAttribute('data-user-content','');select.append(option);}
    select.value=rows.some(r=>r.number===focusedSectionNumber)?focusedSectionNumber:'';previewSectionAdd();$('sectionAddPanel').hidden=false;$('addSection').setAttribute('aria-expanded','true');$('sectionAddPanel').parentElement.scrollTop=0;select.focus({preventScroll:true});
  };
  $('sectionParent').onchange=previewSectionAdd;
  $('cancelSectionAdd').onclick=()=>{closeSectionAdd();$('addSection').focus();};
  $('sectionAddPanel').onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();closeSectionAdd();$('addSection').focus();}};
  $('confirmSectionAdd').onclick=()=>{
    if($('sectionRows').children.length>=100){$('sectionAddPreview').textContent='章节模板最多 100 项 / Maximum 100 sections';return;}
    const number=netcareNextSectionNumber(sectionDrafts(),$('sectionParent').value);
    if(number.length>40){$('sectionAddPreview').textContent='章节序号最多 40 字符 / Section number exceeds 40 characters';return;}
    const line=addSectionRow({number,title:'',attachments:false,text:false,attachmentsPrompt:'',textPrompt:''});
    const before=Array.from($('sectionRows').children).find(other=>{const value=other.querySelector('[data-field=number]').value.trim();return other!==line&&/^\d+(\.\d+)*$/.test(value)&&netcareCompareSectionNumbers(value,number)>0;});
    if(before)$('sectionRows').insertBefore(line,before);refreshSectionInheritance();closeSectionAdd();line.classList.add('section-new');
    line.querySelector('[data-field=title]').focus({preventScroll:true});line.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  };
  $('resetSections').onclick = () => { const saved = extractionSettings; extractionSettings = netcareDefaultSettings(); renderSettings(); extractionSettings = saved; $('settingsStatus').textContent = '已恢复默认草稿，请保存 / Save to apply'; };
  $('saveSettings').onclick = () => {
    try { const settings = readSettings(); $('settingsStatus').textContent = '正在保存 / Saving'; window.postMessage({ source: 'TP_RFC_SETTINGS_SET', settings }, location.origin); }
    catch (error) { $('settingsStatus').textContent = error.message; }
  };
  const dialog = $('settingsDialog');
  const auditDialog=$('auditSummaryDialog'); let currentBatch=null,auditRecords=[],liveAuditRecords=[],activeSnapshot='',auditExportBusy=false;
  let routeRun=null;const routeStates=new Map(),launchedRoutes=new Set();
  let uiLanguage='zh';const localization=globalThis.createNetcareLanguage?.(root,uiLanguage);
  const setLanguage=lang=>{uiLanguage=lang==='en'?'en':'zh';localization?.set(uiLanguage);pip?.setLanguage(uiLanguage);healthView?.language(uiLanguage);$('languageButton').textContent=uiLanguage==='zh'?'EN':'中';updatePreferenceSummary();setLogFullscreen(dialog.classList.contains('log-fullscreen-mode'));if(!$('pluginLogs').hidden)refreshLogs(true);};
  const tr=(zh,en)=>uiLanguage==='en'?en:zh;
  function pipRequest(action,data={}){const id=crypto.randomUUID();return new Promise((resolve,reject)=>{
    const finish=(fn,value)=>{clearTimeout(timer);window.removeEventListener('message',receive);fn(value);};
    const receive=event=>{if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_PIP_RESULT'&&event.data.id===id)event.data.ok?finish(resolve,event.data.data):finish(reject,Error(event.data.error||'预览连接失败 / Preview connection failed'));};
    const timer=setTimeout(()=>finish(reject,Error('预览连接超时 / Preview connection timed out')),20000);window.addEventListener('message',receive);window.postMessage({source:'TP_RFC_PIP_REQUEST',id,action,...data},location.origin);
  });}
  const pip=globalThis.createNetcarePip?.().mount({request:pipRequest,avoid:()=>host.getBoundingClientRect(),log:(action,data)=>netcareLog({category:'operation',action:'pip.'+action,message:'方案画中画操作 / Solution preview action',order:data.order||'',generationAt:data.generationAt,batchId:data.batchId,data},activeSnapshot)});
  const healthSampler=globalThis.createNetcareMonitor?.().sample({send:metric=>netcareArtifactRequest({action:'metric',metric})});
  const healthView=globalThis.createNetcareMonitor?.().mount({root,read:()=>netcareArtifactRequest({action:'metric-history'})});
  $('pipOverview').onclick=()=>pip?.toggle();
  const planDialog = document.createElement('dialog'); planDialog.id = 'planChoiceDialog';
  planDialog.setAttribute('aria-label', '选择方案 / Choose a plan');
  planDialog.style.cssText = 'width:min(680px,calc(100vw - 32px));height:fit-content;min-height:0;max-height:calc(100vh - 40px);padding:0';
  root.append(planDialog);
  const choosePlan = netcarePlanChoiceQueue(({order, plans}, signal) => new Promise((resolve, reject) => {
    const head = document.createElement('div'); head.className = 'modal-head';
    const title = document.createElement('h2'); title.textContent = tr('选择方案 · ', 'Choose a plan · ') + order; head.append(title);
    const body = document.createElement('div'); body.className = 'modal-body'; body.style.maxHeight = '55vh';
    const hint = document.createElement('p'); hint.textContent = tr('选择一个方案并确认，无需点击网站中的方案链接。多个请求将依次显示。', 'Select one plan and confirm; there is no need to open its website link. Requests are shown in order.'); body.append(hint);
    let selected = -1;
    plans.forEach((plan, index) => {
      const label = document.createElement('label'); label.style.cssText = 'display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid var(--line);border-radius:10px;margin:10px 0;cursor:pointer;background:var(--soft)';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'netcare-plan-choice'; radio.checked = false; radio.style.width = 'auto'; radio.onchange = () => {selected = index; confirm.disabled = false;};
      const details = document.createElement('span'); details.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7'; details.setAttribute('data-user-content',''); details.textContent = `${index + 1}. ${plan.name}\n${plan.type}\n${plan.updated}`;
      label.append(radio, details); body.append(label);
    });
    const footer = document.createElement('div'); footer.className = 'modal-footer';
    const cancel = document.createElement('button'); cancel.textContent = tr('跳过此单', 'Skip this RFC');
    const confirm = document.createElement('button'); confirm.className = 'primary'; confirm.disabled = true; confirm.textContent = tr('确认并继续', 'Confirm and continue'); footer.append(cancel, confirm);
    const finish = (fn, value) => { signal.removeEventListener('abort', abort); planDialog.oncancel = null; planDialog.close(); fn(value); };
    const abort = () => finish(reject, Error(tr('已停止等待', 'Stopped waiting')));
    cancel.onclick = () => finish(reject, Error(tr('已取消此单的方案选择', 'Plan selection cancelled for this RFC')));
    confirm.onclick = () => finish(resolve, selected);
    planDialog.oncancel = event => {event.preventDefault(); cancel.click();};
    planDialog.replaceChildren(head, body, footer); signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) abort(); else {planDialog.showModal(); confirm.focus();}
  }));
  function applyPip(){ $('pipOverview').hidden=!extractionSettings.pipBetaEnabled;pip?.setEnabled(extractionSettings.pipBetaEnabled&&!routeRun); }

  function updatePreferenceSummary(){$('configSummary').textContent = tr(`并发 ${extractionSettings.concurrency} · 在线${extractionSettings.openOnline || extractionSettings.attachmentsEnabled || extractionSettings.textEnabled ? '开启' : '关闭'} · 自动提取${extractionSettings.attachmentsEnabled || extractionSettings.textEnabled ? '开启' : '关闭'}`,`Concurrency ${extractionSettings.concurrency} · Online ${extractionSettings.openOnline || extractionSettings.attachmentsEnabled || extractionSettings.textEnabled ? 'on' : 'off'} · Extraction ${extractionSettings.attachmentsEnabled || extractionSettings.textEnabled ? 'on' : 'off'}`);}
  $('languageButton').onclick=()=>{setLanguage(uiLanguage==='zh'?'en':'zh');window.postMessage({source:'TP_RFC_LANGUAGE_SET',language:uiLanguage},location.origin);renderAudits();};
  window.postMessage({source:'TP_RFC_LANGUAGE_GET'},location.origin);
  const auditStatusLabel=value=>({pass:tr('通过','Pass'),fail:tr('不通过','Fail'),needs_review:tr('需人工核查','Needs review')})[value]||tr('需人工核查','Needs review');
  const imageDialog=$('auditImageDialog'),imageURLs=new Set();let auditRenderGeneration=0,shotObserver;
  const clearAuditImages=()=>{auditRenderGeneration++;shotObserver?.disconnect();if(imageDialog.open)imageDialog.close();$('auditImage').removeAttribute('src');for(const url of imageURLs)URL.revokeObjectURL(url);imageURLs.clear();};
  $('auditImageClose').onclick=()=>imageDialog.close();$('auditImage').onclick=()=>{$('auditImage').classList.toggle('actual-size');};
  imageDialog.addEventListener('close',()=>{$('auditImage').removeAttribute('src');$('auditImage').classList.remove('actual-size');});
  auditDialog.addEventListener('close',clearAuditImages);
  async function refreshAuditMaterialAvailability(){
    const generation=auditRenderGeneration,snapshotId=activeSnapshot,records=auditRecords.filter(r=>netcareAuditRows([r]).length);
    $('snapshotSave').disabled=$('auditBundle').disabled=true;
    if(!records.length)return;
    try{
      const files=await netcareArtifactRequest({action:'list',orders:records.map(r=>r.order),snapshotId});
      if(generation!==auditRenderGeneration||snapshotId!==activeSnapshot)return;
      const missing=netcareAuditMissingBundles(records,files);
      $('snapshotSave').disabled=!!snapshotId||!!missing.length||auditExportBusy;$('auditBundle').disabled=!!missing.length||auditExportBusy;
      if(missing.length)$('auditExportStatus').textContent=tr('审计包缓存缺失：无法保存快照或下载完整材料。请重新提取，或清理结果缓存。','Audit ZIP cache is missing. Saving snapshots and downloading complete materials are unavailable. Extract again or clear the result cache.');
    }catch(e){if(generation===auditRenderGeneration)$('auditExportStatus').textContent=e.message;}
  }
  const renderAudits=()=>{
    clearAuditImages();const generation=auditRenderGeneration,snapshotId=activeSnapshot,language=uiLanguage,body=$('auditSummaryBody'),scroll=body.scrollTop;body.replaceChildren();let screenshotFiles;const shotQueue=[];let loadingShots=0;
    const counts={pass:0,fail:0,needs_review:0};
    const append=(parent,tag,text,className)=>{const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;parent.append(e);return e;};
    if(!netcareAuditRows(auditRecords).length)append(body,'p','暂无审计结果。开启AI审计并完成提取后自动显示。 / No audit results yet.');
    const table=append(body,'table','', 'audit-table'),colgroup=append(table,'colgroup','');for(const width of ['16%','16%','30%','12%','26%']){const col=append(colgroup,'col','');col.style.width=width;}
    const head=append(table,'thead',''),headRow=append(head,'tr','');for(const title of ['方案 / RFC','章节 / Section','审计点与内容 / Evidence','结论 / Result','原因 / Reason'])append(headRow,'th',title);
    const tbody=append(table,'tbody',''),rows=netcareAuditRows(auditRecords,uiLanguage);
    rows.forEach((report,index)=>{
      const state=['pass','fail'].includes(report.status)?report.status:'needs_review';counts[state]++;const rowEl=append(tbody,'tr','');
      if(!index||rows[index-1].order!==report.order){rowEl.className='group-start';const cell=append(rowEl,'td',report.order,'group-cell');cell.rowSpan=rows.filter(r=>r.order===report.order).length;if(report.wordFilename)append(cell,'p',report.wordFilename,'note');}
      if(!index||rows[index-1].order!==report.order||rows[index-1].section!==report.section){
        const cell=append(rowEl,'td',`${report.section||'—'} ${report.sectionTitle||''}`,'group-cell');const heading=cell.firstChild;const configured=document.createElement('span');configured.textContent=heading.textContent;configured.setAttribute('data-user-content','');heading.replaceWith(configured);const grouped=rows.filter(r=>r.order===report.order&&r.section===report.section);cell.rowSpan=grouped.length;if(grouped.some(r=>r.noAttachments)){const badge=append(cell,'p',tr('无附件','No attachments'),'note');badge.style.color='var(--muted)';}
        const corrections=grouped.flatMap(r=>r.corrections||[]).filter((c,i,all)=>all.findIndex(other=>JSON.stringify(other)===JSON.stringify(c))===i);
        for(const correction of corrections){const block=append(cell,'div','','section-correction');block.removeAttribute('data-user-content');append(block,'div',uiLanguage==='en'?'Section correction':'章节纠错','correction-label');const from=append(block,'div',`${correction.fromNumber} ${correction.fromTitle||(uiLanguage==='en'?'Not found':'未找到')}`,'correction-from');from.setAttribute('data-user-content','');const arrow=append(block,'div','↓','correction-arrow');arrow.setAttribute('aria-label','纠正为 / Corrected to');const to=append(block,'div',`${correction.toNumber} ${correction.toTitle}`,'correction-to');to.setAttribute('data-user-content','');}
      }
      const content=append(rowEl,'td','');append(content,'div',report.kind==='text'?'章节文本 / Section text':'附件 / Attachment','kind-label');append(content,'p',report.rule||'未提供规则 / No rule','rule-label');const details=append(content,'details','');append(details,'summary',report.filename||'查看内容 / Content');append(details,'pre',report.text);if(report.screenshots.length){const shots=append(content,'div','','audit-shots');for(const shot of report.screenshots){const button=append(shots,'button','','audit-shot');button.type='button';button.disabled=true;button.setAttribute('aria-label',tr('放大截图：','Enlarge screenshot: ')+shot.name);const label=append(button,'span',tr('正在读取截图…','Loading screenshot…'));shotQueue.push({shot,button,label});}}
      const result=append(rowEl,'td','');append(result,'span',auditStatusLabel(state),'audit-state '+state);
      const reason=append(rowEl,'td','');append(reason,'p',report.summary||tr('未提供理由','No reason provided')).setAttribute('data-user-content','');if(report.findings?.length){const list=append(reason,'ul','');list.setAttribute('data-user-content','');report.findings.forEach(f=>append(list,'li',f));}
      if(report.diagnostics){const d=report.diagnostics,more=append(reason,'details','');append(more,'summary','查看失败详情 / Error details');append(more,'pre',JSON.stringify({...d,response:undefined},null,2));if(d.response){let response=d.response;try{const parsed=JSON.parse(response);response=typeof parsed==='string'?parsed:JSON.stringify(parsed,null,2);}catch{}append(more,'pre',response);}}
    });
    const loadShot=async task=>{
      loadingShots++;const {shot,button,label}=task;
      try{screenshotFiles??=netcareArtifactRequest({action:'list',orders:auditRecords.map(r=>r.order),snapshotId});const files=await screenshotFiles;if(generation!==auditRenderGeneration)return;const file=files.find(f=>f.order===shot.order&&f.name===shot.name);if(!file)throw Error('Missing screenshot');const blob=await netcareReadArtifact(file,file.order,undefined,snapshotId);if(generation!==auditRenderGeneration)return;netcarePngSize(new Uint8Array(await blob.slice(0,24).arrayBuffer()));if(generation!==auditRenderGeneration)return;const url=URL.createObjectURL(new Blob([blob],{type:'image/png'}));imageURLs.add(url);const img=document.createElement('img');img.src=url;img.alt=shot.name;button.prepend(img);label.textContent=tr('点击放大 · ','Click to enlarge · ')+shot.name;label.setAttribute('data-user-content','');button.disabled=false;button.onclick=()=>{$('auditImage').src=url;$('auditImage').alt=shot.name;$('auditImageName').textContent=shot.name;imageDialog.showModal();};}
      catch{if(generation===auditRenderGeneration)label.textContent=language==='en'?'Screenshot unavailable or expired. Extract again.':'截图未缓存或已过期，请重新提取。';}
      finally{loadingShots--;pumpShots();}
    };
    const readyShots=[],pumpShots=()=>{if(generation!==auditRenderGeneration)return;while(loadingShots<3&&readyShots.length)loadShot(readyShots.shift());};
    shotObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){shotObserver.unobserve(entry.target);const task=shotQueue.find(t=>t.button===entry.target);if(task)readyShots.push(task);}pumpShots();},{root:body,rootMargin:'150px'});shotQueue.forEach(t=>shotObserver.observe(t.button));
    $('auditExcel').disabled=$('auditBundle').disabled=!rows.length||auditExportBusy;
    const orderCount=new Set(rows.map(r=>r.order)).size;
    $('auditCounts').textContent=tr(`${orderCount} 个方案 · ${rows.length} 个审计项 · 通过 ${counts.pass} · 不通过 ${counts.fail} · 需人工核查 ${counts.needs_review}`,`${orderCount} RFCs · ${rows.length} checks · Pass ${counts.pass} · Fail ${counts.fail} · Review ${counts.needs_review}`);
    $('auditResultsButton').textContent=tr(`审计结果（${orderCount} 个方案 / ${rows.length} 项）`,`Audit results (${orderCount} RFCs / ${rows.length} checks)`);body.scrollTop=scroll;refreshAuditMaterialAvailability();
  };
  const saveAuditFile=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};
  $('auditExcel').onclick=async()=>{if(auditExportBusy)return;auditExportBusy=true;const records=JSON.parse(JSON.stringify(auditRecords)),language=uiLanguage,snapshotId=activeSnapshot,embedScreenshots=extractionSettings.embedScreenshotsInExcel===true;try{$('auditExcel').disabled=$('auditBundle').disabled=true;const screenshots=embedScreenshots?netcareAuditRows(records,language).flatMap(r=>r.screenshots):[],images=new Map(),files=screenshots.length?await netcareArtifactRequest({action:'list',orders:records.map(r=>r.order),snapshotId}):[];for(const shot of screenshots){const key=netcareAuditImageKey(shot.order,shot.name);if(images.has(key))continue;const file=files.find(f=>f.order===shot.order&&f.name===shot.name);if(file){try{images.set(key,await netcareReadArtifact(file,file.order,undefined,snapshotId));}catch{}}}saveAuditFile(await netcareAuditExcel(records,language,images,embedScreenshots),'NetCare-'+(language==='en'?'Audit-results':'审计结果')+'-'+new Date().toISOString().slice(0,10)+'.xlsx');$('auditExportStatus').textContent=tr('Excel 已导出','Excel exported');}catch(e){$('auditExportStatus').textContent=e.message;}finally{auditExportBusy=false;$('auditExcel').disabled=!netcareAuditRows(auditRecords).length;refreshAuditMaterialAvailability();}};
  $('auditBundle').onclick=async()=>{if(auditExportBusy)return;auditExportBusy=true;const snapshot=JSON.parse(JSON.stringify(auditRecords)),language=uiLanguage;try{$('auditExcel').disabled=$('auditBundle').disabled=true;const selectedSnapshot=activeSnapshot,files=await netcareArtifactRequest({action:'list',orders:snapshot.map(r=>r.order),snapshotId:selectedSnapshot});
    if(netcareAuditMissingBundles(snapshot,files).length)throw Error(tr('审计压缩包已清理或未成功缓存，无法下载完整审计材料。请重新提取，或清理结果缓存。','The audit ZIP is missing; complete audit materials cannot be downloaded. Extract again or clear the result cache.'));
    if(files.reduce((n,f)=>n+f.size,0)>512*1048576)throw Error(tr('单次打包超过512MB，请按历史快照分批下载','This export exceeds 512MB. Download snapshots in smaller batches.'));
    const {entries,missing}=await netcareAuditMaterials(snapshot,files,async file=>{const parts=[];for(let index=0;index<file.count;index++){const data=await netcareArtifactRequest({action:'read',order:file.order,fileId:file.id,index,snapshotId:selectedSnapshot});parts.push(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));}return new Blob(parts);},file=>{$('auditExportStatus').textContent=tr('打包：','Packing: ')+file.order+' · '+file.name;},language,extractionSettings.embedScreenshotsInExcel===true);
    saveAuditFile(await createNetcareZip(entries),'NetCare-'+(language==='en'?'Audit-materials':'审计材料')+'-'+new Date().toISOString().slice(0,10)+'.zip');$('auditExportStatus').textContent=missing.length?tr(`ZIP 已保存；${missing.length} 个材料缺失，详见清单`,`ZIP saved; ${missing.length} missing files. See the manifest.`):tr('审计材料 ZIP 已保存','Materials ZIP saved');
  }catch(e){$('auditExportStatus').textContent=e.message;}finally{auditExportBusy=false;$('auditExcel').disabled=!netcareAuditRows(auditRecords).length;refreshAuditMaterialAvailability();}};
  const formatBytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':Math.round(n||0)+' B';
  const confirmationDialog=$('confirmationDialog');let resolveConfirmation;
  const requestConfirmation=(title,message,danger=false)=>new Promise(resolve=>{if(resolveConfirmation){resolve(false);return;}resolveConfirmation=resolve;$('confirmationTitle').textContent=title;$('confirmationMessage').textContent=message;$('confirmationAccept').classList.toggle('danger',danger);confirmationDialog.returnValue='';confirmationDialog.showModal();$('confirmationCancel').focus();});
  $('confirmationAccept').onclick=()=>confirmationDialog.close('confirmed');$('confirmationCancel').onclick=()=>confirmationDialog.close('cancelled');confirmationDialog.addEventListener('close',()=>{const resolve=resolveConfirmation;resolveConfirmation=null;resolve?.(confirmationDialog.returnValue==='confirmed');});
  const sendLogContext=()=>{for(const id of ['aiFrame','backupFrame'])try{const frame=$(id),u=new URL(frame.src);if(u.protocol==='chrome-extension:')frame.contentWindow.postMessage({source:'TP_RFC_LOG_CONTEXT',snapshotId:activeSnapshot},u.protocol+'//'+u.host);}catch{}};
  $('aiFrame').addEventListener('load',sendLogContext);$('backupFrame').addEventListener('load',sendLogContext);
  const unwirePanelOperations=netcareWireOperations(root,()=>({batchId:currentBatch?.started,snapshotId:!$('pluginLogs').hidden&&!['all','pending'].includes($('logScope').value)?$('logScope').value:activeSnapshot}));
  netcareLog({category:'operation',action:'panel.opened',message:'打开插件浮窗 / Open plugin panel'});
  let logOffset=0,logTotal=0,logBusy=false,logGeneration=0,logSearchTimer;
  const logFilters=()=>({snapshotId:$('logScope').value||'all',order:$('logRfc').value.trim().toUpperCase(),category:$('logCategory').value,level:$('logLevel').value,search:$('logSearch').value.trim().slice(0,200),from:$('logFrom').value?new Date($('logFrom').value).getTime():undefined,to:$('logTo').value?new Date($('logTo').value).getTime()+59999:undefined});
  const categoryLabel=value=>({operation:tr('操作','Operations'),configuration:tr('配置','Configuration'),extraction:tr('提取','Extraction'),audit:tr('审计','Audit'),storage:tr('存储','Storage'),system:tr('系统','System')})[value]||value;
  const levelLabel=value=>({debug:tr('调试','Debug'),info:tr('信息','Info'),warn:tr('警告','Warning'),error:tr('错误','Error')})[value]||value;
  const highlight=(node,text,keyword)=>{node.setAttribute('data-user-content','');const value=String(text),needle=keyword.toLowerCase();if(!needle){node.textContent=value;return;}let start=0,index;while((index=value.toLowerCase().indexOf(needle,start))!==-1){node.append(document.createTextNode(value.slice(start,index)));const mark=document.createElement('mark');mark.textContent=value.slice(index,index+keyword.length);node.append(mark);start=index+keyword.length;}node.append(document.createTextNode(value.slice(start)));};
  function setLogFullscreen(enabled){
    const isFull=Boolean(enabled);
    dialog.classList.toggle('log-fullscreen-mode',isFull);
    const fsBtn=$('logFullscreen');
    if(fsBtn){
      fsBtn.classList.toggle('active',isFull);
      fsBtn.textContent=isFull?tr('🗗 退出全屏 / Exit full','🗗 Exit full'):tr('⛶ 全屏 / Fullscreen','⛶ Fullscreen');
      fsBtn.title=isFull?tr('退出全屏查看 / Exit fullscreen','Exit fullscreen'):tr('全屏查看日志 / Fullscreen','Fullscreen');
    }
  }
  async function refreshLogs(reloadHistory=false){
    const generation=++logGeneration,list=$('pluginLogEntries'),scroll=list.scrollTop,opened=new Set([...list.querySelectorAll('.log-row.is-open')].map(r=>r.dataset.id));
    try{if(reloadHistory){const history=await netcareArtifactRequest({action:'history'}),scope=$('logScope'),old=scope.value;scope.replaceChildren();for(const [value,label] of [['all',tr('全部日志','All logs')],['pending',tr('未关联快照','Without snapshot')],...history.map(s=>[s.id,new Date(s.created).toLocaleString(uiLanguage==='en'?'en-GB':'zh-CN')+' · '+(s.label||s.orders.join(', '))])]){const option=document.createElement('option');option.value=value;option.textContent=label;option.setAttribute('data-user-content','');scope.append(option);}scope.value=[...scope.options].some(o=>o.value===old)?old:'all';}
      await netcareLogQueue;const filter=logFilters();if(filter.from&&filter.to&&filter.from>filter.to)throw Error(tr('开始时间不能晚于结束时间','Start time must precede end time'));const data=await netcareArtifactRequest({action:'query-logs',filter:{...filter,offset:logOffset,limit:100}});if(generation!==logGeneration)return;logTotal=data.total;if(logOffset>=data.total&&logOffset){logOffset=Math.max(0,Math.floor((data.total-1)/100)*100);return refreshLogs();}list.replaceChildren();
      for(const entry of data.entries){
        const row=document.createElement('div');row.className='log-row'+(opened.has(entry.id)?' is-open':'');row.dataset.id=entry.id;row.dataset.category=entry.category;row.dataset.level=entry.level;
        const line=document.createElement('div');line.className='log-row-line';line.title=tr('点击展开/收起详情 / Click to toggle details','Click to toggle details');
        const arrow=document.createElement('span');arrow.className='log-arrow';arrow.textContent='▶';
        const d=new Date(entry.at),pad=(n,l=2)=>String(n).padStart(l,'0');
        const timeEl=document.createElement('time');timeEl.className='log-time';timeEl.textContent=`${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(entry.at%1000,3)}`;timeEl.dateTime=d.toISOString();timeEl.title=d.toISOString();
        const catEl=document.createElement('span');catEl.className='log-cat';catEl.textContent=`[${categoryLabel(entry.category)}]`;
        const lvlEl=document.createElement('span');lvlEl.className=`log-level ${entry.level}`;lvlEl.textContent=levelLabel(entry.level);
        const orderEl=document.createElement('span');orderEl.className='log-order'+(entry.order?'':' empty');highlight(orderEl,entry.order||'—',filter.search);
        const actEl=document.createElement('code');actEl.className='log-action';highlight(actEl,entry.action||'',filter.search);
        const localizedMsg=entry.message.includes(' / ')?netcareAuditLocalized(entry.message,uiLanguage):entry.message;
        const msgEl=document.createElement('span');msgEl.className='log-msg';msgEl.title=localizedMsg;highlight(msgEl,localizedMsg,filter.search);
        line.append(arrow,timeEl,catEl,lvlEl,orderEl,actEl,msgEl);
        if(entry.snapshotIds?.length){
          const snapBtn=document.createElement('button');snapBtn.type='button';snapBtn.className='log-snap-btn';snapBtn.textContent=tr('快照','Snap');snapBtn.title=tr('查看关联快照 / View snapshot','View snapshot');
          snapBtn.onclick=async e=>{e.stopPropagation();try{activeSnapshot=entry.snapshotIds[0];const s=await netcareArtifactRequest({action:'snapshot',snapshotId:activeSnapshot});auditRecords=s.records;setLogFullscreen(false);dialog.close();renderAudits();await refreshHistory();auditDialog.showModal();}catch(err){$('pluginLogStatus').textContent=err.message;}};
          line.append(snapBtn);
        }
        const detailEl=document.createElement('div');detailEl.className='log-row-detail';detailEl.hidden=!opened.has(entry.id);
        const toolbar=document.createElement('div');toolbar.className='log-detail-toolbar';
        const metaEl=document.createElement('span');metaEl.className='log-detail-meta';metaEl.textContent=`ID: ${entry.id} · batchId: ${entry.batchId||'—'}`+(entry.generationAt?` · gen: ${entry.generationAt}`:'');
        const actionsEl=document.createElement('div');actionsEl.className='log-detail-actions';
        const copyBtn=document.createElement('button');copyBtn.type='button';copyBtn.textContent=tr('复制 JSON','Copy JSON');
        const jsonString=JSON.stringify({id:entry.id,at:entry.at,timestamp:d.toISOString(),order:entry.order,category:entry.category,level:entry.level,action:entry.action,message:entry.message,batchId:entry.batchId,generationAt:entry.generationAt,snapshotIds:entry.snapshotIds,...entry.data},null,2);
        copyBtn.onclick=async e=>{e.stopPropagation();try{await navigator.clipboard.writeText(jsonString);copyBtn.textContent=tr('已复制！','Copied!');setTimeout(()=>{copyBtn.textContent=tr('复制 JSON','Copy JSON');},1800);}catch{copyBtn.textContent=tr('复制失败','Failed');}};
        actionsEl.append(copyBtn);
        if(entry.snapshotIds?.length){
          const viewSnap=document.createElement('button');viewSnap.type='button';viewSnap.textContent=tr('查看快照','View snapshot');
          viewSnap.onclick=async e=>{e.stopPropagation();try{activeSnapshot=entry.snapshotIds[0];const s=await netcareArtifactRequest({action:'snapshot',snapshotId:activeSnapshot});auditRecords=s.records;setLogFullscreen(false);dialog.close();renderAudits();await refreshHistory();auditDialog.showModal();}catch(err){$('pluginLogStatus').textContent=err.message;}};
          actionsEl.append(viewSnap);
        }
        toolbar.append(metaEl,actionsEl);
        const pre=document.createElement('pre');pre.className='log-detail-pre';highlight(pre,jsonString,filter.search);
        detailEl.append(toolbar,pre);
        line.onclick=e=>{if(e.target.closest('button'))return;const isOpen=row.classList.toggle('is-open');detailEl.hidden=!isOpen;};
        row.append(line,detailEl);list.append(row);
      }
      if(!data.entries.length){const empty=document.createElement('p');empty.className='note';empty.style.padding='12px';empty.textContent=tr('没有符合筛选条件的日志','No matching logs');list.append(empty);}
      const removed=(data.dropped||0)+netcareLogFailures;$('pluginLogStatus').textContent=tr(`找到 ${data.total} 条日志${removed?' · '+removed+' 条日志因容量或写入失败未保留':''}`,`${data.total} matching events${removed?' · '+removed+' events not retained due to capacity or write failures':''}`);$('logPage').textContent=(data.total?logOffset+1:0)+'–'+Math.min(logOffset+100,data.total)+' / '+data.total;$('logPrevious').disabled=!logOffset;$('logNext').disabled=logOffset+100>=data.total;list.scrollTop=scroll;
    }catch(e){if(generation===logGeneration)$('pluginLogStatus').textContent=e.message;}
  }
  for(const id of ['logScope','logCategory','logLevel','logFrom','logTo'])$(id).onchange=()=>{logOffset=0;refreshLogs();};for(const id of ['logRfc','logSearch'])$(id).oninput=()=>{clearTimeout(logSearchTimer);logSearchTimer=setTimeout(()=>{logOffset=0;refreshLogs();},250);};
  $('logRefresh').onclick=()=>refreshLogs(true);$('logReset').onclick=()=>{for(const id of ['logRfc','logSearch','logFrom','logTo','logCategory','logLevel'])$(id).value='';$('logScope').value='all';logOffset=0;refreshLogs(true);};$('logPrevious').onclick=()=>{logOffset=Math.max(0,logOffset-100);refreshLogs();};$('logNext').onclick=()=>{logOffset+=100;refreshLogs();};
  $('logExport').onclick=async()=>{if(logBusy)return;logBusy=true;$('logExport').disabled=true;try{await netcareLogQueue;const filter=logFilters();filter.to=Math.min(filter.to||Date.now(),Date.now());if(filter.from&&filter.from>filter.to)throw Error(tr('开始时间不能晚于结束时间','Start time must precede end time'));const chunks=[];let offset=0,total=0,bytes=0;do{const page=await netcareArtifactRequest({action:'query-logs',filter:{...filter,offset,limit:500}});total=page.total;const text=page.entries.map(e=>netcareFormatExportLogLine(e)).join('\n')+'\n';bytes+=new TextEncoder().encode(text).length;if(bytes>100*1048576)throw Error(tr('日志超过100MB，请缩小筛选范围分批导出','Logs exceed 100MB. Narrow the filters and export in batches.'));chunks.push(text);offset+=page.entries.length;if(!page.entries.length)break;}while(offset<total);saveAuditFile(new Blob(chunks,{type:'application/x-ndjson;charset=utf-8'}),'NetCare-'+tr('插件日志','plugin-logs')+'-'+new Date().toISOString().slice(0,10)+'.jsonl');$('pluginLogStatus').textContent=tr(`已导出 ${offset} 条日志`,`Exported ${offset} events`);}catch(e){$('pluginLogStatus').textContent=e.message;}finally{logBusy=false;$('logExport').disabled=false;}};
  const logLiveTimer=setInterval(()=>{if(dialog.open&&!$('pluginLogs').hidden&&$('logLive').checked&&!logBusy)refreshLogs();},4000);
  const selectedSnapshots=()=>Array.from($('snapshotRows').querySelectorAll('input:checked')).map(e=>e.value);
  async function refreshHistory(){const history=await netcareArtifactRequest({action:'history'}),select=$('snapshotSelect');select.replaceChildren();const current=document.createElement('option');current.value='';current.textContent=tr(`当前结果 · ${new Set(netcareAuditRows(liveAuditRecords).map(r=>r.order)).size} 个方案 · ${netcareAuditRows(liveAuditRecords).length} 项`,`Current results · ${new Set(netcareAuditRows(liveAuditRecords).map(r=>r.order)).size} RFCs · ${netcareAuditRows(liveAuditRecords).length} checks`);select.append(current);for(const item of history){const option=document.createElement('option');option.value=item.id;option.textContent=new Date(item.created).toLocaleString(uiLanguage==='zh'?'zh-CN':'en-GB')+' · '+tr('历史快照','Snapshot')+' · '+item.orders.length+tr(' 个方案 · ',' RFCs · ')+(item.label||item.orders.join(', '))+' · '+item.checks+tr(' 项',' checks');select.append(option);}select.value=activeSnapshot;return history;}
  $('snapshotSelect').onchange=async()=>{try{const id=$('snapshotSelect').value;if(id){const data=await netcareArtifactRequest({action:'snapshot',snapshotId:id});auditRecords=data.records;activeSnapshot=id;}else{activeSnapshot='';auditRecords=liveAuditRecords;}renderAudits();$('auditExportStatus').textContent=tr('已载入，导出包含本快照材料','Loaded; exports use this snapshot’s files');}catch(e){$('auditExportStatus').textContent=e.message;}};
  $('snapshotSave').onclick=async()=>{try{if(activeSnapshot)throw Error(tr('当前正在查看历史快照，请先切换当前结果','Switch to current results before saving'));$('snapshotSave').disabled=true;const id=await netcareArtifactRequest({action:'save-snapshot',label:liveAuditRecords.map(r=>r.order).join(', ')});await refreshHistory();$('auditExportStatus').textContent=tr('快照已保存（仅记录结果索引，不重复占用附件存储空间）','Snapshot saved (indexes results without duplicating file storage)');}catch(e){$('auditExportStatus').textContent=e.message==='Audit ZIP is not cached'?tr('审计压缩包已清理或未成功缓存，无法保存完整快照。请重新提取，或在存储设置中清理结果缓存。','The audit ZIP was removed or was not cached. A complete snapshot cannot be saved. Extract again or clear the result cache in Storage settings.'):e.message;}finally{refreshAuditMaterialAvailability();}};
  async function previewCleanup(){const result=await netcareArtifactRequest({action:'cleanup-preview',ids:selectedSnapshots()});$('cleanupPreview').textContent=tr(`已选择 ${result.count} 个快照 · 预计释放 ${formatBytes(result.released)} · 清理后 ${formatBytes(result.remaining)}`,`${result.count} selected · Releases ${formatBytes(result.released)} · Remaining ${formatBytes(result.remaining)}`);return result;}
  function selectedMaterialsCategories(){const cats=[];if($('cleanCatScreenshots')?.checked)cats.push('screenshots');if($('cleanCatAttachments')?.checked)cats.push('attachments');if($('cleanCatTexts')?.checked)cats.push('texts');if($('cleanCatBundles')?.checked)cats.push('bundles');if($('cleanCatLogs')?.checked)cats.push('logs');return cats;}
  let materialsPreviewGeneration=0;
  async function updateMaterialsCleanupPreview(){const generation=++materialsPreviewGeneration;const cats=selectedMaterialsCategories(),days=Number($('materialsRetentionDays')?.value)||0,protect=$('protectSnapshotRefs')?.checked!==false,previewEl=$('materialsCleanupPreview'),executeBtn=$('materialsCleanupExecute');if(!previewEl)return;if(!cats.length){previewEl.textContent=tr('未选择任何清理类别 / No categories selected','No categories selected');if(executeBtn)executeBtn.disabled=true;return {count:0,fileCount:0,logCount:0,released:0,remaining:0};}const result=await netcareArtifactRequest({action:'cleanup-materials-preview',options:{categories:cats,days,protectSnapshots:protect}});if(generation!==materialsPreviewGeneration)return null;for(const [category,id] of [['screenshots','cleanCountScreenshots'],['attachments','cleanCountAttachments'],['texts','cleanCountTexts'],['bundles','cleanCountBundles'],['logs','cleanCountLogs']]){const data=result.breakdown?.[category];if(data&&$(id))$(id).textContent=`(${data.count} · ${formatBytes(data.bytes)})`;}previewEl.textContent=tr(`预计清理 ${result.fileCount} 个材料文件${result.logCount?'及 '+result.logCount+' 条未归档日志':''} · 预计释放 ${formatBytes(result.released)} · 清理后剩余约 ${formatBytes(result.remaining)}${protect?'（历史快照受保护）':''}`,`${result.fileCount} files${result.logCount?' & '+result.logCount+' logs':''} to clean · Releases ${formatBytes(result.released)} · Remaining ≈ ${formatBytes(result.remaining)}${protect?' (Snapshots protected)':''}`);if(executeBtn)executeBtn.disabled=result.count===0;return result;}
  async function refreshStorage(){
    const [stats,history]=await Promise.all([netcareArtifactRequest({action:'stats'}),refreshHistory()]);
    $('storageUsage').textContent=tr(`审计存储约 ${formatBytes(stats.used)} / ${formatBytes(stats.capacity)} · ${stats.snapshots} 个快照 · ${stats.files} 个材料 · 配置 ${formatBytes(stats.configurationBytes||0)}`,`Audit storage ≈ ${formatBytes(stats.used)} / ${formatBytes(stats.capacity)} · ${stats.snapshots} snapshots · ${stats.files} files · Config ${formatBytes(stats.configurationBytes||0)}`);
    $('storageMeter').value=stats.used/stats.capacity;
    $('storageCapacity').value=Math.floor(stats.capacity/1048576);
    $('storageCapacity').max=Math.floor(stats.maximum/1048576);

    const b=stats.breakdown||{}, resultCache=stats.auditResults||{count:0,checks:0,bytes:0};
    const totalBytes=stats.used+(stats.configurationBytes||0)+resultCache.bytes;
    let notice=$('storageResultNotice');if(!notice){notice=document.createElement('p');notice.id='storageResultNotice';notice.className='note';$('storageUsage').after(notice);const clear=document.createElement('button');clear.id='clearResultCache';clear.textContent=tr('清理结果缓存','Clear result cache');notice.after(clear);clear.onclick=async()=>{if(!await requestConfirmation(tr('清理结果缓存','Clear result cache'),tr('删除暂存的审计结果摘要。历史快照和材料保留；正在进行的审计可能产生新结果。继续？','Delete cached audit summaries. Historical snapshots and materials remain. Active audits may publish new results. Continue?'),true))return;clear.disabled=true;try{await netcareArtifactRequest({action:'clear-results'});liveAuditRecords=[];if(!activeSnapshot)auditRecords=[];renderAudits();await refreshStorage();}catch(e){$('storageMessage').textContent=e.message;}finally{clear.disabled=false;}};}
    notice.textContent=tr(`结果缓存：${resultCache.count} 个方案 · ${resultCache.checks} 个审计项。结果摘要与配置单独存储，不占上述材料库容量。${!stats.snapshots&&resultCache.count?'当前没有历史快照；结果摘要仍可查看，但不能据此恢复已缺失的截图、附件或审计压缩包。请重新提取以保存完整材料和快照。':''}`,`Result cache: ${resultCache.count} RFCs · ${resultCache.checks} checks. Summaries and configuration are stored separately from the material quota.${!stats.snapshots&&resultCache.count?' No historical snapshots exist. Summaries remain viewable, but missing images, attachments and audit ZIPs cannot be recovered from them. Extract again to save complete materials and snapshots.':''}`);
    const categories=[
      {id:'screenshots',color:'#3b82f6',label:tr('方案截图','Screenshots'),data:b.screenshots||{count:0,bytes:0}},
      {id:'attachments',color:'#f59e0b',label:tr('方案附件','Attachments'),data:b.attachments||{count:0,bytes:0}},
      {id:'texts',color:'#10b981',label:tr('方案文本','Section texts'),data:b.texts||{count:0,bytes:0}},
      {id:'bundles',color:'#8b5cf6',label:tr('审计包与Word','Bundles & Word'),data:b.bundles||{count:0,bytes:0}},
      {id:'snapshots',color:'#ec4899',label:tr('历史快照','Snapshots'),data:b.snapshots||{count:history.length,bytes:0}},
      {id:'logs',color:'#06b6d4',label:tr('未归档日志','Log buffer'),data:b.logs||{count:0,bytes:0}},
      {id:'results',color:'#6366f1',label:tr('结果缓存','Result cache'),data:resultCache},
      {id:'config',color:'#64748b',label:tr('扩展配置','Configuration'),data:{count:stats.configurationCount||0,bytes:stats.configurationBytes||0}}
    ];

    const bar=$('storageBar');
    if(bar){
      bar.replaceChildren();
      const cap=stats.capacity||500*1048576;
      for(const cat of categories){
        if(cat.data.bytes>0&&!['config','results'].includes(cat.id)){
          const pct=Math.min(100,(cat.data.bytes/cap)*100);
          const seg=document.createElement('div');
          seg.className='storage-bar-segment';
          seg.style.width=Math.max(0.3,pct).toFixed(2)+'%';
          seg.style.backgroundColor=cat.color;
          const pctOfUsed=totalBytes>0?((cat.data.bytes/totalBytes)*100).toFixed(1):'0';
          seg.title=`${cat.label}: ${formatBytes(cat.data.bytes)} (${pctOfUsed}%) · ${cat.data.count} ${tr('项','items')}`;
          bar.append(seg);
        }
      }
    }

    const breakdownEl=$('storageBreakdown');
    if(breakdownEl){
      breakdownEl.replaceChildren();
      for(const cat of categories){
        const card=document.createElement('div');card.className='storage-breakdown-card';
        const dot=document.createElement('span');dot.className='storage-dot';dot.style.backgroundColor=cat.color;
        const info=document.createElement('div');info.className='storage-breakdown-info';
        const name=document.createElement('div');name.className='storage-breakdown-name';name.textContent=cat.label;
        const meta=document.createElement('div');meta.className='storage-breakdown-meta';
        const pctOfUsed=totalBytes>0?((cat.data.bytes/totalBytes)*100).toFixed(1):'0';
        meta.textContent=`${formatBytes(cat.data.bytes)} · ${cat.data.count} ${tr('项','items')} (${pctOfUsed}%)`;
        info.append(name,meta);card.append(dot,info);breakdownEl.append(card);
      }
    }

    if($('cleanCountScreenshots'))$('cleanCountScreenshots').textContent=`(${b.screenshots?.count||0} · ${formatBytes(b.screenshots?.bytes||0)})`;
    if($('cleanCountAttachments'))$('cleanCountAttachments').textContent=`(${b.attachments?.count||0} · ${formatBytes(b.attachments?.bytes||0)})`;
    if($('cleanCountTexts'))$('cleanCountTexts').textContent=`(${b.texts?.count||0} · ${formatBytes(b.texts?.bytes||0)})`;
    if($('cleanCountBundles'))$('cleanCountBundles').textContent=`(${b.bundles?.count||0} · ${formatBytes(b.bundles?.bytes||0)})`;
    if($('cleanCountLogs'))$('cleanCountLogs').textContent=`(${b.logs?.count||0} · ${formatBytes(b.logs?.bytes||0)})`;

    const old=new Set(selectedSnapshots());$('snapshotRows').replaceChildren();
    for(const s of history){
      const label=document.createElement('label');label.className='field-row';
      const input=document.createElement('input');input.type='checkbox';input.value=s.id;input.checked=old.has(s.id);
      input.onchange=()=>previewCleanup().catch(e=>$('storageMessage').textContent=e.message);
      const title=document.createElement('span');
      title.textContent=new Date(s.created).toLocaleString(uiLanguage==='zh'?'zh-CN':'en-GB')+' · '+(s.label||s.orders.join(', '))+' · '+s.checks+' '+tr('个审计点',s.checks===1?'check':'checks');
      label.append(title,input);$('snapshotRows').append(label);
    }
    await Promise.all([previewCleanup(),updateMaterialsCleanupPreview().catch(e=>$('materialsCleanupStatus').textContent=e.message)]);
  }
  for(const id of ['cleanCatScreenshots','cleanCatAttachments','cleanCatTexts','cleanCatBundles','cleanCatLogs','protectSnapshotRefs','materialsRetentionDays']){const el=$(id);if(el)el.onchange=()=>{$('materialsCleanupStatus').textContent='';updateMaterialsCleanupPreview().catch(e=>$('materialsCleanupStatus').textContent=e.message);};}
  if($('materialsCleanupRefresh'))$('materialsCleanupRefresh').onclick=()=>updateMaterialsCleanupPreview().catch(e=>$('materialsCleanupStatus').textContent=e.message);
  if($('materialsCleanupExecute'))$('materialsCleanupExecute').onclick=async()=>{
    try{
      await netcareLogQueue;
      const cats=selectedMaterialsCategories(),days=Number($('materialsRetentionDays')?.value)||0,protect=$('protectSnapshotRefs')?.checked!==false;
      const p=await updateMaterialsCleanupPreview();
      if(!p||!p.count)return;
      const confirmed=await requestConfirmation(tr('确认清理暂存材料与缓存','Confirm cleanup'),tr(`预计将清理 ${p.fileCount} 个材料文件${p.logCount?'及 '+p.logCount+' 条未归档日志':''}，预计释放 ${formatBytes(p.released)} 存储空间。${cats.includes('bundles')?'对应审计包清理后，当前结果摘要也会同步移除。':''}\n${protect?'已保存的历史快照完全受保护，不受影响。':'警告：快照引用的材料也将被清理！'}\n此操作不可撤销，确认继续？`,`Will clean ${p.fileCount} files${p.logCount?' and '+p.logCount+' logs':''}, freeing ≈ ${formatBytes(p.released)}.${cats.includes('bundles')?' Current result summaries will be removed when their audit ZIPs are cleaned.':''}\n${protect?'Saved snapshots remain protected.':'Warning: Snapshot files will also be removed!'}\nContinue?`),true);
      if(!confirmed)return;
      await netcareLogQueue;
      $('materialsCleanupExecute').disabled=true;$('materialsCleanupStatus').textContent=tr('正在清理…','Cleaning…');
      const res=await netcareArtifactRequest({action:'cleanup-materials',options:{categories:cats,days,protectSnapshots:protect}});
      if(res.removedResultOrders?.length){const removed=new Set(res.removedResultOrders);liveAuditRecords=liveAuditRecords.filter(r=>!removed.has(r.order));if(!activeSnapshot)auditRecords=liveAuditRecords;renderAudits();}
      $('materialsCleanupStatus').textContent=tr(`清理完成，已释放 ${formatBytes(res.released)} 空间！`,`Cleaned up! Freed ${formatBytes(res.released)}.`);
      await refreshStorage();await refreshLogs(true);
    }catch(e){$('materialsCleanupStatus').textContent=e.message;}finally{await updateMaterialsCleanupPreview().catch(()=>{});}
  };
  $('storageRefresh').onclick=()=>refreshStorage().catch(e=>$('storageMessage').textContent=e.message);
  $('snapSelectAll').onclick=()=>{$('snapshotRows').querySelectorAll('input').forEach(e=>e.checked=true);previewCleanup().catch(e=>$('storageMessage').textContent=e.message);};
  $('snapSelectNone').onclick=()=>{$('snapshotRows').querySelectorAll('input').forEach(e=>e.checked=false);previewCleanup().catch(e=>$('storageMessage').textContent=e.message);};
  $('storageApply').onclick=async()=>{try{const stats=await netcareArtifactRequest({action:'stats'}),bytes=Number($('storageCapacity').value)*1048576;if(bytes<stats.used&&!await requestConfirmation(tr('调整缓存容量','Change cache capacity'),tr('降低容量将立即删除最旧快照和材料。请先备份所需快照。继续？','Reducing capacity removes oldest snapshots and materials. Back up first. Continue?')))return;await netcareArtifactRequest({action:'configure',bytes});await refreshStorage();await refreshLogs(true);$('storageMessage').textContent=tr('容量已保存','Capacity saved');}catch(e){$('storageMessage').textContent=e.message;}};
  $('snapshotDelete').onclick=async()=>{try{const ids=selectedSnapshots(),p=await previewCleanup();if(!p.count)return;if(!await requestConfirmation(tr('删除快照','Delete snapshots'),tr(`删除 ${p.count} 个快照、相关日志及不再引用的材料，预计释放 ${formatBytes(p.released)}？`,`Delete ${p.count} snapshots, their logs and unreferenced files, freeing ${formatBytes(p.released)}?`),true))return;await netcareArtifactRequest({action:'cleanup',ids});if(ids.includes(activeSnapshot)){activeSnapshot='';auditRecords=liveAuditRecords;renderAudits();}await refreshStorage();await refreshLogs(true);}catch(e){$('storageMessage').textContent=e.message;}};
  $('snapshotBackup').onclick=async()=>{const ids=selectedSnapshots(),language=uiLanguage;if(!ids.length)return;$('snapshotBackup').disabled=$('snapshotDelete').disabled=$('storageApply').disabled=true;try{const entries=[];let totalBytes=0;for(const id of ids){const s=await netcareArtifactRequest({action:'snapshot',snapshotId:id}),files=await netcareArtifactRequest({action:'list',orders:s.records.map(r=>r.order),snapshotId:id});totalBytes+=files.reduce((n,f)=>n+f.size,0);if(totalBytes>512*1048576)throw Error(tr('单次备份超过512MB，请减少选择并分批下载','This backup exceeds 512MB. Select fewer snapshots and download in batches.'));const bundle=await netcareAuditMaterials(s.records,files,async f=>{const chunks=[];for(let index=0;index<f.count;index++){const data=await netcareArtifactRequest({action:'read',fileId:f.id,order:f.order,index,snapshotId:id});chunks.push(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));}return new Blob(chunks);},()=>{},language);const prefix=new Date(s.created).toISOString().replace(/[:.]/g,'-')+'_'+id+'/';entries.push({name:prefix+'snapshot.json',blob:new Blob([JSON.stringify(s,null,2)],{type:'application/json'})},{name:prefix+'plugin-logs.jsonl',blob:new Blob([(s.logs||[]).map(e=>JSON.stringify({...e,timestamp:new Date(e.at).toISOString()})).join('\n')],{type:'application/x-ndjson;charset=utf-8'})},...bundle.entries.map(e=>({...e,name:prefix+e.name})));$('storageMessage').textContent=tr(`正在打包 ${entries.length} 个文件`,`Packing ${entries.length} files`);}saveAuditFile(await createNetcareZip(entries),'NetCare-audit-snapshots-'+new Date().toISOString().slice(0,10)+'.zip');$('storageMessage').textContent=tr('备份已发起保存，请在下载记录确认后清理','Backup save initiated. Confirm in downloads before deleting.');}catch(e){$('storageMessage').textContent=e.message;}finally{$('snapshotBackup').disabled=$('snapshotDelete').disabled=$('storageApply').disabled=false;}};
  $('auditResultsButton').onclick=()=>{renderAudits();refreshHistory().catch(e=>$('auditExportStatus').textContent=e.message);auditDialog.showModal();};$('auditSummaryClose').onclick=()=>auditDialog.close();
  const tabs=[$('generalTab'),$('sectionsTab'),$('localRulesTab'),$('storageTab'),$('logsTab'),$('performanceTab'),$('aiTab')], panes=[$('generalSettings'),$('chapterSettings'),$('localRulesSettings'),$('storageSettings'),$('pluginLogs'),$('performanceSettings'),$('aiSettings')];
  const showTab = index => {
    healthView?.show(tabs[index] === $('performanceTab'));
    if (tabs[index] === $('logsTab')) refreshLogs(true).catch(e=>$('pluginLogStatus').textContent=e.message);
    else setLogFullscreen(false);
    root.querySelector('.modal-body').classList.toggle('log-mode', tabs[index] === $('logsTab'));
    sendLogContext();
    if (tabs[index] === $('storageTab')) refreshStorage().catch(e=>$('storageMessage').textContent=e.message);
    root.querySelector('.modal-body').scrollTop = 0;
    root.querySelector('.modal-body').classList.toggle('chapter-mode', tabs[index] === $('sectionsTab'));
    tabs.forEach((tab,i)=>{tab.tabIndex=i===index?0:-1;tab.setAttribute('aria-selected',String(i===index));panes[i].hidden=i!==index;});
  };
  tabs.forEach((tab,index)=>{tab.onclick=()=>showTab(index);tab.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowLeft'?tabs.length-1:1))%tabs.length;showTab(next);tabs[next].focus();}};});
  $('settingsButton').onclick = () => { renderSettings(); $('settingsStatus').textContent = '修改后保存生效 / Save to apply'; showTab(0); dialog.showModal(); };
  const cancelSettings = () => { setLogFullscreen(false); healthView?.show(false);dialog.close(); renderSettings(); };
  $('settingsClose').onclick = $('cancelSettings').onclick = cancelSettings;
  dialog.addEventListener('cancel', () => {setLogFullscreen(false);healthView?.show(false);renderSettings();});
  dialog.addEventListener('close',()=> {setLogFullscreen(false);healthView?.show(false);});
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dialog.classList.contains('log-fullscreen-mode')) {
      e.preventDefault();
      e.stopPropagation();
      setLogFullscreen(false);
    }
  });
  $('exportSettings').onclick = () => {
    try { const blob = new Blob([netcareExportSettings(readSettings())], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'netcare-rfc-settings.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); $('settingsStatus').textContent = '配置已导出 / Exported';
    } catch (error) { $('settingsStatus').textContent = error.message; }
  };
  $('importSettings').onclick = () => $('importFile').click();
  $('importFile').onchange = async () => {
    const file = $('importFile').files[0]; if (!file) return;
    try { if (file.size > 2097152) throw new Error('配置文件超过2MB'); const draft = netcareImportSettings(await file.text()), saved = extractionSettings;
      extractionSettings = draft; renderSettings(); extractionSettings = saved; $('settingsStatus').textContent = '配置已导入草稿，请保存 / Imported; save to apply';
    } catch (error) { $('settingsStatus').textContent = `导入失败 / Import failed: ${error.message}`; }
    finally { $('importFile').value = ''; }
  };
  renderSettings();
  const settingsTimer = setInterval(() => { if (!settingsLoaded) window.postMessage({ source: 'TP_RFC_SETTINGS_GET' }, location.origin); }, 1500);
  window.postMessage({ source: 'TP_RFC_SETTINGS_GET' }, location.origin);
  const visible = element => element && element.getClientRects().length > 0
    && element.ownerDocument.defaultView.getComputedStyle(element).visibility !== 'hidden';
  const post = (connection, message) => connection.frame.contentWindow.postMessage({ channel: CHANNEL, ...message }, connection.origin);
  const wait = async (fn, ms, signal, failure) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (signal.aborted) throw new Error('已停止等待');
      const value = fn();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(failure);
  };
  const detail = order => {const nativeOrder=netcareNativeOrder(location.href);if((location.pathname.startsWith('/rfc/network_tuning/')||location.pathname.startsWith('/p/rfc/'))&&(nativeOrder?nativeOrder===order:Array.from(document.querySelectorAll('input')).some(input=>input.value===order)))return {contentDocument:document};return Array.from(document.querySelectorAll('iframe')).find(frame => {
    try {
      const u = new URL(frame.src, location.href);
      return visible(frame) && u.origin === location.origin && (u.pathname.includes('/rfc/network_tuning/') || u.pathname.startsWith('/p/rfc/'))
        && (netcareNativeOrder(u.href) === order || nativeOrder === order)
        && frame.contentDocument?.readyState === 'complete'
        && (Array.from(frame.contentDocument.querySelectorAll('input')).some(input => input.value === order) || frame.contentDocument.body?.innerText?.includes(order));
    } catch { return false; }
  });
  };
  const rows = new Map(), onlineRequests = new Map();
  function routeSend(source,id,order,data={}){const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const finish=(fn,value)=>{clearTimeout(timer);window.removeEventListener('message',receive);fn(value);};const receive=e=>{if(e.source===window&&e.origin===location.origin&&e.data?.source==='TP_RFC_ROUTE_REPLY'&&e.data.requestId===requestId)e.data.ok?finish(resolve,e.data.data):finish(reject,Error(e.data.error||'跨区域连接失败 / Region connection failed'));};const timer=setTimeout(()=>finish(reject,Error('跨区域连接超时，请更新扩展 / Region connection timed out; update extension')),12000);window.addEventListener('message',receive);window.postMessage({source,id,order,requestId,...data},location.origin);});}
  function finishRemote(entry){if(entry.result&&entry.finish){const result=entry.result;entry.finish(result.ok?null:Error(result.error||'跨区域处理失败 / Cross-region workflow failed'),result.value);}}
  function transferRemote(entry,signal){return new Promise((resolve,reject)=>{let timer;const finish=(error,value)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);entry.finish=null;error?reject(error):resolve(value);};const abort=()=>{routeSend('TP_RFC_ROUTE_CANCEL',entry.id,entry.order).catch(()=>{});finish(Error('已停止等待 / Stopped'));};entry.finish=finish;timer=setTimeout(()=>{routeSend('TP_RFC_ROUTE_CANCEL',entry.id,entry.order).catch(()=>{});finish(Error('跨区域导出超时，请检查目标站点登录 / Cross-region export timed out; check target login'));},13*60000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else finishRemote(entry);});}

  const update = (order, text) => {
    const row = rows.get(order);
    if(routeRun?.order===order)routeSend('TP_RFC_ROUTE_PROGRESS',routeRun.jobId,order,{text}).catch(()=>{});
    if (row) row.status.textContent = `${order} · ${translate(text)}`;netcareLog({order,batchId:currentBatch?.started,category:'extraction',action:'rfc.progress',message:text,level:/失败|error|failed/i.test(text)?'error':'info'});
  };
  const receive = event => {
    if (event.source === window && event.origin === location.origin
      && event.data?.source === 'EXTENSION_POPUP' && event.data.action === 'STOP') {
      cleanup();
      return;
    }
    if (event.source === window && event.origin === location.origin && event.data?.source === 'TP_RFC_EXTENSION_CONFLICT') {
      log(`⚠️ 检测到多版本插件冲突（ID: ${event.data.currentId} 与 ${event.data.activeId}）。请在 chrome://extensions 中仅保留一个最新版本，避免 AI 鉴权异常与重复下载！`);
      return;
    }
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_ROUTE_CANCEL'&&event.data.data?.jobId===routeRun?.jobId){active?.abort();return;}
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_ROUTE_LAUNCH'){
      const data=event.data.data;if(!data||!validOrder(data.order)||!/^[a-f0-9-]{36}$/.test(data.jobId||'')||active||launchedRoutes.has(data.jobId))return;launchedRoutes.add(data.jobId);routeRun=data;$('routeBanner').hidden=false;$('routeBanner').textContent=tr('跨区域接续中 · 进度同步到发起页面','Cross-region continuation · Progress synced to the initiating page');pip?.setEnabled(false);
      (async()=>{try{await wait(()=>settingsLoaded,15000,{aborted:false},'等待设置连接超时 / Settings connection timed out');$('order').value=data.order;await start();}catch(e){routeSend('TP_RFC_ROUTE_RESULT',data.jobId,data.order,{ok:false,error:e.message}).catch(()=>{});}})();return;
    }
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_ROUTE_EVENT'){
      const data=event.data.data;if(!data||data.batchId!==currentBatch?.started)return;const entry=routeStates.get(data.jobId);if(data.kind==='assigned'&&entry){entry.assigned=true;entry.targetTabId=data.targetTabId;const row=rows.get(data.order);if(row){const link=document.createElement('a');try{const u=new URL(data.url);if(NETCARE_ORIGINS.has(u.origin)){link.href=u.href;link.target='_blank';link.rel='noopener';link.textContent=tr('跨区域目标页','Target region page')+' · '+u.hostname;row.online.replaceChildren(link);}}catch{}}update(data.order,tr('已转交目标站点，继续自动处理','Handed over to the target site; continuing'));}
      else if(data.kind==='result'&&entry){entry.result=data;finishRemote(entry);}
      else if(data.kind==='progress'){const row=rows.get(data.order);if(row)row.status.textContent=data.order+' · '+translate(data.text||'');}
      return;
    }
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_PIP_CHANGED'){pip?.refresh();return;}
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_LANGUAGE'){setLanguage(event.data.language);renderAudits();return;}
    if(event.source===window&&event.origin===location.origin&&event.data?.source==='TP_RFC_AUDIT_SUMMARIES'){
      if(Array.isArray(event.data.records)){liveAuditRecords=event.data.records.filter(r=>r&&Array.isArray(r.reports)&&Array.isArray(r.items)&&(!currentBatch||currentBatch.orders.includes(r.order)&&Number(r.generationAt||Date.parse(r.at))>=currentBatch.started)).slice(-50);if(!activeSnapshot)auditRecords=liveAuditRecords;refreshHistory().catch(()=>{});renderAudits();if(event.data.updated&&auditRecords.length&&!dialog.open&&!auditDialog.open)auditDialog.showModal();}return;
    }
    if (event.source === window && event.origin === location.origin && event.data?.source === 'TP_RFC_SETTINGS_RESULT') {
      if (!event.data.ok) { $('settingsStatus').textContent = event.data.error || '设置保存失败'; return; }
      if(typeof event.data.backupPageUrl==='string'){try{const u=new URL(event.data.backupPageUrl);if(u.protocol==='chrome-extension:'&&u.pathname==='/netcare-backup.html'&&$('backupFrame').getAttribute('src')!==u.href)$('backupFrame').src=u.href;}catch{}}
      if(typeof event.data.aiPageUrl==='string') {try{const u=new URL(event.data.aiPageUrl);if(u.protocol==='chrome-extension:'&&u.pathname==='/netcare-ai.html'){if($('aiFrame').getAttribute('src')!==u.href)$('aiFrame').src=u.href;$('aiFrameStatus').textContent='';}}catch{}}
      try { extractionSettings = netcareNormalizeSettings(event.data.settings || netcareDefaultSettings()); settingsLoaded = true; clearInterval(settingsTimer); renderSettings(); applyPip(); if (event.data.saved) dialog.close(); $('settingsStatus').textContent = event.data.saved ? '已保存，下次在线打开时生效 / Saved' : '默认设置已载入 / Loaded'; } catch (error) { $('settingsStatus').textContent = error.message; }
      return;
    }
    if (event.source === window && event.origin === location.origin && event.data?.source === 'TP_RFC_OPEN_RESULT') {
      const request = onlineRequests.get(event.data.id);
      if (request) event.data.ok ? request.resolve() : request.reject(new Error(event.data.error || '在线页签打开失败'));
      else if(event.data.ok){const row=[...rows.values()].find(r=>r.onlineRequestId===event.data.id);if(row?.online.querySelector('a')){const link=row.online.querySelector('a');row.online.replaceChildren(link,document.createTextNode(tr(' · 已新开页签',' · Tab opened')));}}
      return;
    }
    const connection = bridges.get(event.origin);
    if (!connection || event.source !== connection.frame.contentWindow || event.data?.channel !== CHANNEL) return;
    const message = event.data;
    if (message.type === 'ready') {
      connection.connected = true;
      $('connection').textContent = '导出服务：已连接 / Connected';
      return;
    }
    const job = jobs.get(message.job);
    if (!job || job.connection !== connection) return;
    if (message.type === 'progress') update(job.order, message.text);
    else if (message.type === 'done') {
      if (typeof message.filename === 'string') window.postMessage({ source: 'TP_RFC_WORD_FILENAME', order: job.order, filename: message.filename }, location.origin);
      job.resolve(message.text);
    }
    else if (message.type === 'error') job.reject(new Error(message.text));
  };
  window.addEventListener('message', receive);
  window.postMessage({source:'TP_RFC_AUDIT_GET'},location.origin);
  function inspectPortalState(doc, order, phase) {
    const collectFrames = root => {
      if (!root?.querySelectorAll) return [];
      return Array.from(root.querySelectorAll('iframe')).slice(0, 12).map(item => {
        const rawSrc = item.getAttribute?.('src') || item.src || '';
        let host = '', pathname = '', queryKeys = [], idParam = '', docIdParam = '', orderIdParam = '', validKdpHost = false;
        if (rawSrc) {
          try {
            const u = new URL(rawSrc, location.href);
            host = u.hostname;
            pathname = u.pathname;
            queryKeys = [...u.searchParams.keys()].slice(0, 15);
            idParam = u.searchParams.get('id') || '';
            docIdParam = u.searchParams.get('docId') || '';
            orderIdParam = u.searchParams.get('order_id') || '';
            validKdpHost = /(^|\.)kdp\.(?:gts|idp)\.huawei\.com$/.test(u.hostname);
          } catch { pathname = String(rawSrc).slice(0, 160); }
        }
        return {
          id: item.id || '',
          name: item.name || '',
          visible: visible(item),
          host,
          pathname,
          queryKeys,
          idParam,
          docIdParam,
          orderIdParam,
          validKdpHost
        };
      });
    };
    const collectDialogs = root => {
      if (!root?.querySelectorAll) return [];
      return Array.from(root.querySelectorAll('.el-message-box,.el-dialog,.v-modal,.nc-dialog,.nt-modal,[role="dialog"],.el-notification,.el-message'))
        .filter(visible)
        .slice(0, 6)
        .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200))
        .filter(Boolean);
    };
    return {
      phase,
      order,
      pageOrigin: location.origin,
      detailFrames: collectFrames(doc),
      topFrames: doc !== document ? collectFrames(document) : [],
      dialogs: [...new Set([...collectDialogs(doc), ...collectDialogs(document)])].slice(0, 8)
    };
  }
  async function openOnline(order, doc, button, signal) {
    const row = rows.get(order);
    row.online.textContent = '在线方案：正在获取原生入口… / Opening online…';
    let openedInline = false;
    try {
      const title = button.closest('tr')?.querySelector('td:first-child .nt-table-link');
      if (!title) throw new Error('未找到方案名称入口');
      const oldFrame = doc.querySelector('iframe#IdpFrame');
      if (oldFrame && visible(oldFrame)) throw new Error('请先返回 RFC 信息再打开方案');
      title.click();
      openedInline = true;
      let loggedCandidate = '';
      let native;
      try {
        native = await wait(() => {
          const item = doc.querySelector('iframe#IdpFrame') || doc.querySelector('iframe[src*="OwsPage.html"]');
          if (!item || !visible(item)) return null;
          try {
            const u = new URL(item.src, location.href);
            const hostOk = u.protocol === 'https:' && /(^|\.)kdp\.(?:gts|idp)\.huawei\.com$/.test(u.hostname);
            const pathOk = u.pathname === '/ows1/static/editor/IdpLiteView/OwsPage.html';
            const docId = u.searchParams.get('docId') || u.searchParams.get('id') || '';
            const orderId = u.searchParams.get('order_id') || '';
            const docMatches = netcareMatchesOrder(docId, order);
            const orderMatches = !orderId || netcareMatchesOrder(orderId, order);
            const orderOk = docMatches && orderMatches;
            if (hostOk && pathOk && orderOk) {
              if (!u.searchParams.get('docId')) u.searchParams.set('docId', docId || order);
              u.searchParams.set('order_id', order);
              netcareLog({ order, batchId: currentBatch?.started, category: 'extraction', action: 'online.entry.matched', message: '已识别在线方案入口 / Online solution entry matched', data: { host: u.hostname, pathname: u.pathname, docIdParam: docId, orderIdParam: orderId || order } });
              return u;
            }
            const sig = `${u.hostname}${u.pathname}?docId=${docId}&order_id=${orderId}`;
            if (sig !== loggedCandidate) {
              loggedCandidate = sig;
              netcareLog({ order, batchId: currentBatch?.started, category: 'extraction', level: 'warn', action: 'online.entry.rejected', message: '检测到在线方案候选 iframe 但未通过校验 / Candidate online iframe rejected', data: { host: u.hostname, pathname: u.pathname, hostOk, pathOk, docIdParam: docId, orderIdParam: orderId, expectedOrder: order } });
            }
            return null;
          } catch { return null; }
        }, 45000, signal, '在线方案入口未打开，请检查网站授权提示');
      } catch (waitErr) {
        netcareLog({ order, batchId: currentBatch?.started, category: 'extraction', level: 'error', action: 'online.entry.timeout', message: '等待在线方案入口超时或失败 / Waiting for online solution entry failed: ' + (waitErr?.message || ''), data: inspectPortalState(doc, order, 'online') });
        throw waitErr;
      }
      // Keep a native link even if extension relay permissions are unavailable.
      const link = document.createElement('a');
      link.href = native.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${order} · 在线方案 / Online solution`;
      link.style.cssText = 'color:#368cff';
      row.online.replaceChildren(link);
      const id = crypto.randomUUID();row.onlineRequestId=id;
      await new Promise((resolve, reject) => {
        let timer;
        const finish = (fn, value) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          onlineRequests.delete(id);
          fn(value);
        };
        const abort = () => settle(reject, new Error('已停止等待'));
        let settled=false,failureTimer;const settle=(fn,value)=>{if(settled)return;settled=true;clearTimeout(failureTimer);finish(fn,value);};onlineRequests.set(id,{resolve:()=>settle(resolve),reject:error=>{if(!failureTimer)failureTimer=setTimeout(()=>settle(reject,error),2000);}});
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => settle(reject, new Error('扩展未响应，可点击上方链接手动打开')), 15000);
        if (signal.aborted) abort();
        else window.postMessage({ source: 'TP_RFC_OPEN_REQUEST', id, order, url: native.href }, location.origin);
      });
      row.online.append(document.createTextNode(' · 已新开页签 / Tab opened'));
    } catch (error) {
      row.online.append(document.createTextNode(` · 新页签状态未确认 / Tab status unconfirmed: ${error.message}`));
    } finally {
      if (openedInline) {
        const back = Array.from(doc.querySelectorAll('.solution_normal_text')).find(item => item.textContent.trim() === '返回RFC/HC');
        back?.click();
      }
    }
  }
  async function prepare(order, signal) {
    const log = text => update(order, text);
    const id=routeRun?.order===order?routeRun.jobId:crypto.randomUUID(),entry={id,order,assigned:false,result:null};routeStates.set(id,entry);
    let routeArmed=false;
    try{await routeSend('TP_RFC_ROUTE_ARM',id,order,{batchId:currentBatch.started});routeArmed=true;}catch(err){netcareLog({order,batchId:currentBatch?.started,category:'extraction',action:'route.arm.warning',message:'跨区域预连接未就绪，继续尝试本页检索 / Cross-region route arm deferred; trying local search: '+(err?.message||''),level:'warn'});}
    let frame = detail(order);
    if(routeRun&&!frame)frame=await wait(()=>detail(order)||entry.assigned&&{routeId:id},45000,signal,'目标站点详情未加载，请检查登录 / Target details not loaded; check login');
    if(frame?.routeId)return frame;
    if (!frame) {
      log('通过网站原生搜索定位作业单…');
      const input = document.querySelector('input[placeholder="请输入单号"]');
      const search = input?.closest('.search-input')?.querySelector('button.search-icon');
      if (!input || !search) throw new Error('未找到单号搜索入口，请在 NetCare 主页面执行');
      const previous = input.value;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, order);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
      const restoreRedirects=routeArmed?netcareSearchRedirects(window,order,url=>{netcareLog({order,batchId:currentBatch?.started,category:'system',action:'region.redirect.requested',message:'网站请求跨区域跳转 / Native cross-region redirect requested',data:{targetOrigin:new URL(url).origin}});routeSend('TP_RFC_ROUTE_OPEN',id,order,{url}).catch(error=>{entry.result={ok:false,error:error.message};});}):()=>{};
      try{search.click();frame=await wait(()=>{if(entry.result&&!entry.result.ok)throw Error(entry.result.error);return detail(order)||entry.assigned&&{routeId:id};},45000,signal,'未找到可访问的作业单或目标区域；请检查单号、登录及页面提示');}finally{restoreRedirects();if(input.isConnected){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,previous);input.dispatchEvent(new Event('input',{bubbles:true}));}}
      if(frame.routeId)return frame;
    }
    try{await routeSend('TP_RFC_ROUTE_LOCAL',id,order);}catch(_){}
    const doc = frame.contentDocument;
    const buttons = await wait(() => {
      const found = Array.from(doc.querySelectorAll('.v-icon-dolwnload-1')).filter(visible);
      return found.length ? found : null;
    }, 30000, signal, '没有可下载的方案；请检查方案信息及权限');
    let button = buttons[0];
    if (buttons.length > 1) {
      const plans = buttons.map((item, index) => {
        const cells = item.closest('tr')?.querySelectorAll('td') || [];
        return {name: cells[0]?.textContent.trim() || tr(`方案 ${index + 1}`, `Plan ${index + 1}`), type: cells[1]?.textContent.trim() || '', updated: cells[2]?.textContent.trim() || ''};
      });
      let selected = netcareSanitizedPlanIndex(plans, extractionSettings.autoSelectSanitizedPlan);
      const automatic = selected >= 0;
      if (!automatic) {
        update(order, routeRun ? tr('等待选择方案：请打开该单的跨区域目标页，在弹窗中确认', 'Waiting for a plan choice: open this RFC target-region tab and confirm in the dialog') : tr('等待选择方案，请在方案选择弹窗中确认', 'Waiting for a plan choice; confirm in the selection dialog'));
        selected = await choosePlan({order, plans}, signal);
      }
      button = buttons[selected];
      if (!button?.isConnected || !visible(button)) throw Error(tr('所选方案已变化，请重新运行该单号', 'Selected plan changed; run this RFC again'));
      netcareLog({order,batchId:currentBatch?.started,category:'extraction',action:'solution.selected',message:automatic?'自动选择脱敏方案 / Automatically selected sanitized plan':'用户选择方案 / User selected plan',data:{automatic,index:selected + 1,name:plans[selected].name}});
      update(order, tr('已选择方案：', 'Selected plan: ') + plans[selected].name);
    }
    log('调用网站原生下载入口，检查授权…');
    const oldExport = doc.querySelector('iframe[src*="PublishLiteView.html"]');
    if (oldExport && visible(oldExport)) throw new Error('请先关闭页面已有的导出弹窗，再重试（避免使用旧单号）');
    button.click();
    let loggedExportCandidate = '';
    let nativeFrame;
    try {
      nativeFrame = await wait(() => {
        const item = doc.querySelector('iframe[src*="PublishLiteView.html"]') || document?.querySelector?.('iframe[src*="PublishLiteView.html"]:not([name="rfc-word-worker"])');
        if (!item || !visible(item)) return null;
        const u = new URL(item.src, location.href);
        const hostOk = validExport(u.href);
        const idParam = u.searchParams.get('id') || '';
        if (hostOk && netcareMatchesOrder(idParam, order)) {
          netcareLog({ order, batchId: currentBatch?.started, category: 'extraction', action: 'export.entry.matched', message: '已进入数字化方案导出页 / Export dialog matched', data: { host: u.hostname, pathname: u.pathname, idParam } });
          return item;
        }
        const sig = `${u.hostname}${u.pathname}?id=${idParam}`;
        if (sig !== loggedExportCandidate) {
          loggedExportCandidate = sig;
          netcareLog({ order, batchId: currentBatch?.started, category: 'extraction', level: 'warn', action: 'export.entry.rejected', message: '检测到导出弹窗 iframe 但未通过校验 / Candidate export iframe rejected', data: { host: u.hostname, pathname: u.pathname, hostOk, idParam, expectedOrder: order } });
        }
        return null;
      }, 45000, signal, '未进入数字化方案导出页；可能需要处理授权提示，或该方案是离线附件');
    } catch (waitErr) {
      netcareLog({ order, batchId: currentBatch?.started, category: 'extraction', level: 'error', action: 'export.entry.timeout', message: '未进入数字化方案导出页（诊断快照） / Export dialog wait failed (diagnostics): ' + (waitErr?.message || ''), data: inspectPortalState(doc, order, 'export') });
      throw waitErr;
    }
    const url = new URL(nativeFrame.src, location.href);
    let connection = bridges.get(url.origin);
    if (!connection || !connection.frame.isConnected) {
      const bridge = document.createElement('iframe');
      bridge.name = 'rfc-word-worker';
      bridge.title = 'RFC Word 导出服务连接';
      bridge.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;border:0;opacity:.01;pointer-events:none';
      bridge.src = url.href;
      connection = { frame: bridge, origin: url.origin, connected: false };
      bridges.set(url.origin, connection);
      document.body.append(bridge);
      $('connection').textContent = '导出服务：等待初始化';
    }
    doc.querySelector('button.nc-close')?.click();
    if ($('openOnline').checked) await openOnline(order, doc, button, signal);
    post(connection, { type: 'hello' });
    await wait(() => connection.connected, 60000, signal, '自动连接失败，请检查导出服务登录状态和扩展的网站权限');
    return connection;
  }
  function transfer(order, connection, signal) {
    if(connection.routeId)return transferRemote(routeStates.get(connection.routeId),signal);
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (fn, value) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        jobs.delete(id);
        fn(value);
      };
      const abort = () => {
        post(connection, { type: 'cancel', job: id });
        finish(reject, new Error('已停止等待'));
      };
      jobs.set(id, { order, connection, resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        post(connection, { type: 'cancel', job: id });
        finish(reject, new Error('等待导出响应超时，请检查连接后重试'));
      }, 13 * 60 * 1000);
      if (signal.aborted) abort();
      else post(connection, { type: 'run', job: id, order,bundleOnly:extractionSettings.attachmentsEnabled||extractionSettings.textEnabled });
    });
  }
  async function start() {
    if (active) return;
    if (!settingsLoaded) { log('请等待默认提取设置加载，或重新启动扩展'); return; }
    $('concurrency').value = extractionSettings.concurrency; $('openOnline').checked = extractionSettings.openOnline || extractionSettings.attachmentsEnabled || extractionSettings.textEnabled;
    let orders;
    try { orders = parseNetcareRfcOrders($('order').value); }
    catch (error) { log(error.message); return; }
    routeStates.clear();currentBatch={orders,started:routeRun?.batchId||Date.now()};liveAuditRecords=[];if(!activeSnapshot){auditRecords=[];renderAudits();}if(!routeRun)window.postMessage({source:'TP_RFC_BATCH_BEGIN',orders,started:currentBatch.started},location.origin);
    for(const order of orders)netcareLog({order,batchId:currentBatch.started,category:'operation',action:'batch.started',message:'开始 RFC 审计流程 / Start RFC audit workflow',data:{orders,concurrency:extractionSettings.concurrency,openOnline:extractionSettings.openOnline}});
    const controller = new AbortController();
    active = controller;
    $('order').value = orders.join('\n');
    $('run').disabled = $('order').disabled = $('concurrency').disabled = $('openOnline').disabled = true;
    $('stop').disabled = false;
    $('log').textContent = `共 ${orders.length} 单 · 并发 ${$('concurrency').value} / RFC batch`;
    rows.clear();
    $('results').replaceChildren(...orders.map(order => {
      const row = document.createElement('div');
      row.style.cssText = 'font-size:12px;padding:6px 0;border-bottom:1px solid #8883;overflow-wrap:anywhere';
      const status = document.createElement('div'), online = document.createElement('div');
      status.textContent = `${order} · 排队 / Queued`;
      online.style.fontSize = '11px';
      row.append(status, online);
      rows.set(order, { status, online });
      return row;
    }));
    try {
      const results = await executeNetcareRfcBatch(orders, Number($('concurrency').value), controller.signal,
        prepare, transfer, (order, result) => {update(order,result.ok?result.value:(controller.signal.aborted?result.error:`失败 / Failed: ${result.error}`));const entry=[...routeStates.values()].find(e=>e.order===order);if(controller.signal.aborted&&entry)routeSend('TP_RFC_ROUTE_CANCEL',entry.id,order).catch(()=>{});else if(entry&&!entry.assigned)routeSend('TP_RFC_ROUTE_RESULT',entry.id,order,{ok:result.ok,value:result.value,error:result.error}).catch(()=>{});});
      const success = results.filter(result => result.ok).length;
      log(`已发起保存 ${success} / ${orders.length}；其余 ${orders.length - success} 单失败或停止。请在 Chrome 下载记录中确认。`);
    } finally {
      active = null;
      $('run').disabled = $('order').disabled = $('concurrency').disabled = $('openOnline').disabled = false;
      $('stop').disabled = true;

    }
  }
  $('run').onclick=()=>{routeRun=null;$('routeBanner').hidden=true;start();};
  $('order').onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); start(); } };
  $('stop').onclick = () => active?.abort();
  const cleanup = () => {
    netcareLog({category:'operation',action:'panel.closed',message:'关闭插件浮窗 / Close plugin panel',batchId:currentBatch?.started},activeSnapshot);
    active?.abort();planDialog.close();localization?.stop();pip?.destroy();healthSampler?.stop();healthView?.stop();
    window.removeEventListener('message', receive);
    clearInterval(settingsTimer);clearInterval(logLiveTimer);clearTimeout(logSearchTimer);unwirePanelOperations();confirmationDialog.close();clearAuditImages();dialog.close();auditDialog.close();
    bridges.forEach(connection => connection.frame.remove());
    host.remove();
  };
  window.__rfcWordPanelCleanup = cleanup;
  $('close').onclick = cleanup;
  const header = root.querySelector('header');
  header.onpointerdown = event => {
    if (event.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    const offsetX = event.clientX - rect.left, offsetY = event.clientY - rect.top;
    header.setPointerCapture(event.pointerId);
    header.onpointermove = move => {
      host.style.right = host.style.bottom = 'auto';
      host.style.left = Math.max(0, Math.min(innerWidth - rect.width, move.clientX - offsetX)) + 'px';
      host.style.top = Math.max(0, Math.min(innerHeight - rect.height, move.clientY - offsetY)) + 'px';
    };
    header.onpointerup = header.onpointercancel = () => { header.onpointermove = null; };
  };
  const current = (validOrder(netcareNativeOrder(location.href)) ? netcareNativeOrder(location.href) : null) || Array.from(document.querySelectorAll('iframe')).map(frame => {
    try { return netcareNativeOrder(frame.src) || new URLSearchParams(new URL(frame.src).hash.split('?')[1]).get('orderid'); }
    catch { return null; }
  }).find(validOrder);
  if (current) $('order').value = current;
  console.info('RFC Word 下载扩展已加载 / Extension loaded.');
})();
