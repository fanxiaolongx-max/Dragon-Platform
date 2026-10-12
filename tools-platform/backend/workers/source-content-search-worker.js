const {parentPort}=require('node:worker_threads');
const fold=value=>String(value??'').normalize('NFKC').toLowerCase();
let virtualSnapshot,virtualData,table,raw,query,originalError=false,position=0,headerChecked=false,fileId='',workbook=null;
function boundedArchive(bytes){
 if(bytes.length<4||bytes.readUInt32LE(0)!==0x04034b50)return true;
 const end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));if(end<0||end+22>bytes.length)return false;
 const count=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16);if(count>2000||offset>=bytes.length)return false;
 let position=offset,total=0;
 for(let i=0;i<count;i++){if(position+46>bytes.length||bytes.readUInt32LE(position)!==0x02014b50)return false;total+=bytes.readUInt32LE(position+24);if(total>64*1024*1024)return false;position+=46+bytes.readUInt16LE(position+28)+bytes.readUInt16LE(position+30)+bytes.readUInt16LE(position+32);}
 return true;
}

parentPort.on('message',async message=>{
 try{
  if(message.type==='virtual-meta'){
   table=raw=workbook=virtualData=null;fileId='';const row=message.row;
   const provider=require(message.virtualType==='meeting'?'../models/meeting-source-tables':'../models/topic-source-tables');
   const payload=virtualSnapshot?.key===message.cacheKey?virtualSnapshot.payload:JSON.parse(row.payload_json);virtualSnapshot={key:message.cacheKey,payload};
   const item=message.virtualType==='meeting'?{id:row.id,title:row.title,meetingDate:row.meeting_date,createdAt:row.created_at,created_at:row.created_at,updatedAt:row.updated_at,updated_at:row.updated_at,summary:JSON.parse(row.summary_json||'{}'),payload}:{id:row.id,name:row.name,platform:row.platform,capturedAt:row.captured_at,exportedAt:row.exported_at,importedAt:row.imported_at,period:row.period_label,payloadBytes:row.payload_bytes,createdAt:row.created_at,updatedAt:row.updated_at,summary:JSON.parse(row.summary_json||'{}'),snapshot:payload};
   virtualData=message.virtualType==='meeting'?provider.tables(item,message.parsed.period,message.parsed.category):provider.tables(item,message.parsed.key);
   parentPort.postMessage({id:message.id,file:virtualData?.file?{id:virtualData.file.id,name:virtualData.file.name,source_key:virtualData.file.source_key,kind:virtualData.file.kind}:null,sheets:(virtualData?.sheets||[]).map(sheet=>({id:sheet.id,name:sheet.name}))});return;
  }
  if(message.type==='virtual-load'){
   const data=virtualData?.sheets.find(sheet=>sheet.id===message.sheetId);if(!data){parentPort.postMessage({id:message.id,missing:true});return;}
   table={name:data.name,headers:data.headers,rows:data.rows,rules:message.rules||[]};query=fold(message.query);raw=null;position=0;headerChecked=false;parentPort.postMessage({id:message.id,loaded:true});return;
  }
  if(message.type==='probe'){virtualSnapshot=virtualData=table=raw=null;const field=JSON.parse(message.headers).find(header=>fold(header).includes(fold(message.query)));parentPort.postMessage({id:message.id,hit:field===undefined?null:{kind:'column',field:String(field).slice(0,160),sheetName:message.name}});return;}
  if(message.type==='load'){
   query=fold(message.query);table={name:message.name,headers:JSON.parse(message.headers),rows:JSON.parse(message.rows)};position=0;headerChecked=false;
   if(fileId!==message.fileId){fileId=message.fileId;workbook=null;originalError=false;if(message.original)try{const XLSX=require('../../frontend/js/shared/xlsx.full.min.js');const bytes=Buffer.from(message.original);if(!boundedArchive(bytes))originalError='ORIGINAL_ARCHIVE_LIMIT';else workbook=XLSX.read(bytes,{type:'buffer',raw:true});}catch(_){originalError=true;}}
   raw=null;const originalName=workbook?.Sheets[table.name]?table.name:workbook?.SheetNames[message.sheetIndex||0];if(originalName&&workbook?.Sheets[originalName]){const XLSX=require('../../frontend/js/shared/xlsx.full.min.js'),sheet=workbook.Sheets[originalName];raw={headers:(XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:false})[0]||[]).map(String),rows:XLSX.utils.sheet_to_json(sheet,{raw:false,defval:''})};}
   table.rules=Array.isArray(message.rules)?message.rules.slice(0,200):[];parentPort.postMessage({id:message.id,loaded:true,originalError});return;
  }
  if(message.type!=='scan')return;
  let hit=null;
  if(!headerChecked){
   headerChecked=true;
   for(const [data,kind] of [[table,'column'],[raw,'original-column']]){if(!data)continue;const field=data.headers.find(header=>fold(header).includes(query));if(field!==undefined){hit={kind,field};break;}}
   if(!hit&&!raw){const rule=table.rules.filter(rule=>rule.kind==='header').find(rule=>[rule.from,rule.to].some(value=>fold(value).includes(query))&&(rule.kind==='header'?[rule.from,rule.to].some(field=>table.headers.includes(field)||raw?.headers.includes(field)):!rule.column||table.headers.includes(rule.column)||raw?.headers.includes(rule.column)));if(rule)hit={kind:'mapping',field:rule.kind==='header'?`${rule.from} → ${rule.to}`:rule.column||''};}
  }
  const start=position,until=Date.now()+35,max=Math.min(Math.max(table.rows.length,raw?.rows.length||0),position+12000);
  while(!hit&&position<max&&Date.now()<until){
   for(const [data,kind] of [[table,'content'],[raw,'original-content']]){
    const row=data?.rows[position];if(!row)continue;
    for(const [field,value] of Object.entries(row)){const text=fold(typeof value==='object'?JSON.stringify(value):value);if(text.includes(query)){hit={kind,field,rowNumber:position+1};break;}
     if(!raw&&kind==='content'){const alias=table.rules.find(rule=>rule.kind==='replace'&&rule.to&&(!rule.column||rule.column===field||table.rules.some(header=>header.kind==='header'&&header.from===rule.column&&header.to===field))&&(rule.contains?text.includes(fold(rule.to)):text===fold(rule.to))&&text.split(fold(rule.to)).join(fold(rule.from)).includes(query));if(alias){hit={kind:'mapping',field,rowNumber:position+1};break;}}
    }
    if(hit)break;
   }
   position++;
  }
  parentPort.postMessage({id:message.id,hit:hit?{...hit,field:String(hit.field||'').slice(0,160),sheetName:table.name}:null,done:!!hit||position>=Math.max(table.rows.length,raw?.rows.length||0),scannedRows:position-start,position});
 }catch(_){parentPort.postMessage({id:message.id,error:'TABLE_SEARCH_FAILED'});}
});
