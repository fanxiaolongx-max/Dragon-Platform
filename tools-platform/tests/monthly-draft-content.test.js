const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'draft-content-'));process.env.TOOLS_DATA_DIR=path.join(root,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(root,'reports');
const C=require('../frontend/js/monthly-designer/draft-content'),E=require('../frontend/js/monthly-designer/document-engine'),drafts=require('../backend/models/monthly-draft-repository'),repo=require('../backend/models/import-source-repository'),db=require('../backend/models/app-db');
test.after(async()=>{await db.closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();});
test('browsing preferences and generated versions are excluded; text, styles and stored data remain meaningful',()=>{
 const doc=E.nextSaveVersion(E.prepareMonthlySave(E.defaults(),'2026-09'),null),browsing=structuredClone(doc);browsing.libraryPrefs={search:'test'};assert.equal(C.signature(doc),C.signature(browsing));assert.equal(C.signature(doc),C.signature(E.nextSaveVersion(doc,doc)));
 browsing.sections[0].blocks[0].text.zh='Edited';assert.notEqual(C.signature(doc),C.signature(browsing));
});
test('identical copies group once, already-saved content is suppressed, and different contents remain recoverable',async()=>{
 const formal=await repo.saveDocument(E.prepareMonthlySave(E.defaults(),'2026-09')),edit=structuredClone(formal.document);edit.sections[0].blocks[0].text.zh='Unsaved edit';
 await drafts.save('groups','a',{document:edit,baseRevision:formal.revision});const other=structuredClone(edit);other.libraryPrefs={period:'2026-09',date:'',group:'',search:'x',expandedFileIds:[],expandedSheetIds:[]};await drafts.save('groups','b',{document:other,baseRevision:formal.revision});
 const items=await drafts.list('groups');assert.equal(items.length,1);assert.equal(items[0].duplicateCount,2);assert.equal((await drafts.read('groups','a')).document.sections[0].blocks[0].text.zh,'Unsaved edit');
 other.sections[0].blocks[0].text.zh='Distinct edit';await drafts.save('groups','c',{document:other,baseRevision:formal.revision});assert.equal((await drafts.list('groups')).length,2);
 const unchanged=await drafts.save('groups','view-only',{document:formal.document,baseRevision:formal.revision});assert.equal(unchanged.unchanged,true);await assert.rejects(drafts.read('groups','view-only'),{status:404});
 // Simulate old clients' stored preference-only drafts without mutating any real data.
 await db.run('INSERT INTO monthly_document_drafts (owner,id,name,report_month,base_revision,payload_json,updated_at) VALUES (?,?,?,?,?,?,?)',['groups','legacy-view',formal.document.name,'2026-09',formal.revision,JSON.stringify(formal.document),new Date().toISOString()]);assert.equal((await drafts.list('groups')).length,2);
 await drafts.remove('groups','a');await assert.rejects(drafts.read('groups','b'),{status:404});assert.equal((await drafts.list('groups'))[0].id,'c');
});
test('cleanup after recovery cannot delete a draft changed by its original editing window',async()=>{
 const document=E.prepareMonthlySave(E.defaults(),'2026-10');document.sections[0].blocks[0].text.zh='First';await drafts.save('race','source',{document,baseRevision:null});const recovered=await drafts.read('race','source');
 document.sections[0].blocks[0].text.zh='Newer window edit';await drafts.save('race','source',{document,baseRevision:null});await drafts.remove('race','source',{updatedAt:recovered.updated_at,version:recovered.version});assert.equal((await drafts.read('race','source')).document.sections[0].blocks[0].text.zh,'Newer window edit');
});
test('cleanup removes redundant records and archives older same-name reports while retaining newest and protected edits',async()=>{
 const owner='organize',document=E.prepareMonthlySave(E.defaults(),'2026-07');
 for(const [index,id] of ['old','middle','latest'].entries()){const item=structuredClone(document);item.id='report-'+id;item.sections[0].blocks[0].text.zh=id;await drafts.save(owner,id,{document:item,baseRevision:null});await db.run('UPDATE monthly_document_drafts SET updated_at=? WHERE owner=? AND id=?',['2026-07-0'+(index+1)+'T00:00:00Z',owner,id]);}
 assert.equal(new Set((await drafts.list(owner)).map(item=>item.reportKey)).size,1,'Different document IDs with the same title and month share one report group');
 const result=await drafts.cleanup(owner,{mode:'older',protectedIds:['old']});assert.equal(result.archived,1);assert.deepEqual(new Set((await drafts.list(owner)).map(row=>row.id)),new Set(['old','latest']));
 const history=await drafts.list(owner,{archived:true});assert.equal(history.length,1);assert.match(history[0].id,/^history-/);assert.equal((await drafts.read(owner,history[0].id)).document.sections[0].blocks[0].text.zh,'middle');
 const changed=structuredClone(document);changed.sections[0].blocks[0].text.zh='middle window continued';await drafts.save(owner,'middle',{document:changed,baseRevision:null});assert.equal((await drafts.read(owner,history[0].id)).document.sections[0].blocks[0].text.zh,'middle','An old live window cannot overwrite an archived recovery point');
 const {runWithTenant}=require('../backend/models/tenant-context');await runWithTenant('cleanup-isolation',async()=>{assert.deepEqual(await drafts.list(owner,{archived:true}),[]);assert.equal((await drafts.cleanup(owner,{mode:'older'})).archived,0);await assert.rejects(drafts.read(owner,history[0].id),{status:404});});
 await drafts.remove(owner,history[0].id);assert.deepEqual(await drafts.list(owner,{archived:true}),[]);
});
test('safe cleanup physically deletes saved and duplicate copies without discarding different content',async()=>{
 const owner='safe-clean',formal=await repo.saveDocument(E.prepareMonthlySave(E.defaults(),'2026-06')),document=structuredClone(formal.document);document.sections[0].blocks[0].text.zh='Actual edit';
 for(const id of ['same-a','same-b'])await drafts.save(owner,id,{document,baseRevision:formal.revision});
 await db.run('INSERT INTO monthly_document_drafts (owner,id,name,report_month,base_revision,payload_json,updated_at) VALUES (?,?,?,?,?,?,?)',[owner,'saved-copy',formal.document.name,'2026-06',formal.revision,JSON.stringify(formal.document),new Date().toISOString()]);
 const result=await drafts.cleanup(owner);assert.equal(result.removed,2);assert.equal((await db.get('SELECT COUNT(*) AS count FROM monthly_document_drafts WHERE owner=?',[owner])).count,1);assert.equal((await drafts.list(owner)).length,1);assert.equal((await drafts.list(owner,{archived:true})).length,0);
});
