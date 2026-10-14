const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto').webcrypto;
const factory=require('../backend/builtin-tools/f12-to-extension/netcare-backup.js');
async function legacyBackup(data,password){
 const encoder=new TextEncoder(),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('netcare-rfc-backup:2')},key,encoder.encode(JSON.stringify(data)));
 return JSON.stringify({format:'netcare-rfc-backup',version:2,encryption:{cipher:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:210000,salt:Buffer.from(salt).toString('base64'),iv:Buffer.from(iv).toString('base64')},ciphertext:Buffer.from(cipher).toString('base64')});
}
test('new configuration backup contains only settings even when given results, files, logs and runtime data',async()=>{
 const backup=factory(),configuration={netcareExtractionSettings:{sections:[{number:'3.4',textPrompt:'check'}],localRules:[{name:'KPI',pattern:'KPI'}],concurrency:10},netcareAiModels:[{id:'m',name:'internal',url:'http://model.internal:3155',protocol:'openai',model:'test',key:'test-only-key'}],netcareAiSelectedModel:'m',netcareStorageSettings:{bytes:500*1048576},f12PopupLanguage:'en'};
 const input={...configuration,netcareAuditSummaries:[{items:[{text:'runtime evidence'}]}],netcareSnapshots:[{}],netcareAttachments:['file'],netcareLogs:['log'],netcareCurrentBatch:{orders:['NC20260814000207']},'netcareWordName:NC20260814000207':'plan.docx'};
 const encrypted=await backup.encrypt(input,'test-pass-2026');assert.deepEqual(await backup.decrypt(encrypted,'test-pass-2026'),configuration);
 for(const key of Object.keys(input).filter(k=>!Object.hasOwn(configuration,k)))assert.equal(backup.allowed(key),false);
});
test('old v2 full backups restore configuration only and ignore even malformed historic audit and material payloads',async()=>{
 const backup=factory(),text=await legacyBackup({netcareExtractionSettings:{sections:[]},f12PopupLanguage:'zh',netcareAuditSummaries:'obsolete-invalid-record',netcareSnapshots:[{reports:['old']}],netcareFiles:['old file'],netcareLogs:['old log'],'netcareWordName:NC20260814000207':'old.docx',netcareCurrentBatch:{started:1}},'test-pass-2026');
 const restored=backup.validate(await backup.decrypt(text,'test-pass-2026'),()=>true,()=>{});
 assert.deepEqual(restored,{netcareExtractionSettings:{sections:[]},f12PopupLanguage:'zh'});
});
test('legacy records cannot bypass the settings validation after configuration projection',async()=>{
 const backup=factory(),text=await legacyBackup({netcareExtractionSettings:{sections:'invalid'},netcareAuditSummaries:[]},'test-pass-2026');
 const restored=await backup.decrypt(text,'test-pass-2026');assert.throws(()=>backup.validate(restored,()=>false,()=>{}),/Invalid settings/);
});
test('passwordless configuration backup encrypts and decrypts with built-in intranet key',async()=>{
 const backup=factory(),configuration={netcareExtractionSettings:{sections:[{number:'1.1',title:'Test',attachments:false,text:true,textPrompt:'check'}],embedScreenshotsInExcel:false},f12PopupLanguage:'zh'};
 const passwordless=await backup.encrypt(configuration);
 assert.ok(passwordless.includes('"format": "netcare-rfc-backup"'));
 const restoredNoArg=await backup.decrypt(passwordless);
 assert.deepEqual(restoredNoArg,configuration);
 const restoredEmptyString=await backup.decrypt(passwordless,'');
 assert.deepEqual(restoredEmptyString,configuration);
 const customEncrypted=await backup.encrypt(configuration,'custom-pass-2026');
 assert.deepEqual(await backup.decrypt(customEncrypted,'custom-pass-2026'),configuration);
 await assert.rejects(backup.decrypt(customEncrypted,'wrong-pass'),/Wrong password/);
});

