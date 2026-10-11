const express = require('express');
const multer = require('multer');
const repo = require('../models/import-source-repository');
const engine = require('../../frontend/js/monthly-designer/document-engine');
const monthlyTemplates = require('../models/monthly-template-repository');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
const upload = multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:128*1024*1024,fields:2,fieldSize:2000}});
// Parent router is mounted after authentication, tenant context and admin write guard.
const handle = fn => async (req,res) => { try {res.setHeader('X-Data-Source','sqlite');await fn(req,res);}catch(error){res.status(error.status || 500).json({error:error.message,code:'IMPORT_SOURCE_ERROR'});} };
router.get('/import-settings',handle(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(await repo.getImportSettings());}));
router.put('/import-settings',handle(async(req,res)=>res.json(await repo.saveImportSettings(req.body))));
router.post('/source-batches',handle(async(req,res)=>res.json(await repo.createBatch(req.body))));
router.post('/source-batches/:id/files',(req,res,next)=>upload.single('file')(req,res,error=>error?res.status(400).json({error:error.message,code:'SOURCE_UPLOAD_ERROR'}):next()),handle(async(req,res)=>{
    if(!req.file)return res.status(400).json({error:'Missing original file'});
    res.json(await repo.saveFile(req.params.id,{...req.file,originalName:req.body.originalName},req.body.kind==='structured'?'structured':'original'));
}));
router.put('/source-files/:id/sheets',handle(async(req,res)=>{await repo.saveSheets(req.params.id,req.body.sheets,req.body.parseError);res.json({success:true});}));
router.get('/source-catalog',handle(async(req,res)=>{
    const days=req.query.days===undefined?0:Number(req.query.days);
    if(!Number.isInteger(days)||days<0||days>36500)return res.status(400).json({error:'days must be an integer between 0 and 36500',code:'IMPORT_SOURCE_ERROR'});
    const stage=req.query.stage;
    if(stage!==undefined&&!['core','topic','meeting'].includes(stage))return res.status(400).json({error:'Unknown directory stage',code:'IMPORT_SOURCE_ERROR'});
    if(req.query.meetingHistory!==undefined&&!['0','1'].includes(req.query.meetingHistory))return res.status(400).json({error:'Invalid meeting history option',code:'IMPORT_SOURCE_ERROR'});
    let meetingFileIds=[];
    if(req.query.meetingFiles!==undefined){try{meetingFileIds=JSON.parse(req.query.meetingFiles);if(!Array.isArray(meetingFileIds)||meetingFileIds.length>64||meetingFileIds.some(id=>typeof id!=='string'||id.length>500||!/^ms-[\w-]+-\d{4}-\d{2}-(qr|rfc|wfm|offline|online)$/.test(id)))throw new Error();}catch(_){return res.status(400).json({error:'Invalid meeting reference IDs',code:'IMPORT_SOURCE_ERROR'});}}
    const options={meetingFileIds,...(req.query.meetingHistory==='0'?{latestOnly:true}:{}),...(days?{since:new Date(Date.now()-days*86400000).toISOString()}:{}),...(stage?{stage}:{})};
    res.setHeader('Cache-Control','no-store');
    // Existing snapshots remain usable as indicators even when their original files predate archiving.
    const snapshots = !stage||stage==='core'?(await require('../models/sla-snapshots-repository').listSnapshots(options)).items:[];
    let catalog = await repo.catalog(options);
    const existing = new Set(catalog.snapshots.map(item=>item.id));
    let registeredAny = false;
    for(const snapshot of snapshots){
        if(!existing.has(snapshot.id)){
            await repo.registerSnapshot(snapshot,{allowMissingBatch:true});
            registeredAny = true;
        }
    }
    if(registeredAny) catalog = await repo.catalog(options);
    catalog.diagnostics={...catalog.diagnostics,days};res.json(catalog);
}));
router.get('/source-files/:id/download',handle(async(req,res)=>{
    const file=await repo.getFile(req.params.id,true);if(!file)return res.status(404).json({error:'Source file not found'});
    res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.send(file.original_blob);
}));
router.get('/source-sheets/:id/editor',handle(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const state=await repo.sheetEditor(req.params.id),canWrite=req.user?.role==='admin';
    res.json({...state,editable:state.editable&&canWrite,readOnlyReason:!state.editable?'snapshot':!canWrite?'admin_required':''});
}));
router.put('/source-sheets/:id/editor',requireAdmin,handle(async(req,res)=>res.json(await repo.updateSheet(req.params.id,req.body))));
router.get('/source-sheets/:id',handle(async(req,res)=>{const sheet=await repo.getSheet(req.params.id);res.status(sheet?200:404).json(sheet || {error:'Worksheet not found'});}));
router.get('/source-snapshots/:id',handle(async(req,res)=>{const snapshot=await repo.getArchivedSnapshot(req.params.id);res.status(snapshot?200:404).json(snapshot || {error:'Import snapshot not found'});}));
router.get('/source-snapshots/:id/sections/:key',handle(async(req,res)=>{const section=await repo.getSection(req.params.id,req.params.key);res.status(section?200:404).json(section || {error:'Extracted source section not found'});}));
router.get('/source-snapshots/:id/metrics/:key/rows',handle(async(req,res)=>{const table=await repo.getMetricTable(req.params.id,req.params.key);res.status(table?200:404).json(table || {error:'Metric source table not found'});}));
router.get('/monthly-logos',handle(async(req,res)=>res.json(await repo.listLogos())));
router.post('/monthly-logos',(req,res,next)=>multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1}}).single('file')(req,res,error=>error?res.status(400).json({error:error.message}):next()),handle(async(req,res)=>res.json(await repo.saveLogo(req.file))));
router.get('/monthly-logos/:id/image',handle(async(req,res)=>{const logo=await repo.getLogo(req.params.id);if(!logo)return res.status(404).json({error:'Logo not found'});res.setHeader('X-Content-Type-Options','nosniff');res.type('png').send(logo.image_blob);}));
router.get('/monthly-mapping-presets',handle(async(req,res)=>res.json(await repo.listMappingPresets())));
router.post('/monthly-mapping-presets',handle(async(req,res)=>res.json(await repo.saveMappingPreset(req.body))));
router.put('/monthly-mapping-presets/:id',handle(async(req,res)=>res.json(await repo.saveMappingPreset(req.body,req.params.id))));
router.delete('/monthly-mapping-presets/:id',handle(async(req,res)=>res.json(await repo.deleteMappingPreset(req.params.id))));
router.get('/monthly-data-format-presets',handle(async(req,res)=>res.json(await repo.listDataFormatPresets())));
router.post('/monthly-data-format-presets',handle(async(req,res)=>res.json(await repo.saveDataFormatPreset(req.body))));
router.put('/monthly-data-format-presets/:id',handle(async(req,res)=>res.json(await repo.saveDataFormatPreset(req.body,req.params.id))));
router.delete('/monthly-data-format-presets/:id',handle(async(req,res)=>res.json(await repo.deleteDataFormatPreset(req.params.id))));
router.get('/monthly-component-presets',handle(async(req,res)=>res.json(await repo.listComponentPresets())));
router.post('/monthly-component-presets',handle(async(req,res)=>res.json(await repo.saveComponentPreset(req.body))));
router.put('/monthly-component-presets/:id',handle(async(req,res)=>res.json(await repo.saveComponentPreset(req.body,req.params.id))));
router.delete('/monthly-component-presets/:id',handle(async(req,res)=>res.json(await repo.deleteComponentPreset(req.params.id))));
router.get('/monthly-default-template',handle(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({...await monthlyTemplates.getDefault(),canSyncRepository:monthlyTemplates.canSyncRepository()&&monthlyTemplates.localRequest(req)});}));
router.put('/monthly-default-template',handle(async(req,res)=>res.json(await monthlyTemplates.saveDefault(req.body))));
router.post('/monthly-default-template/sync-repository',handle(async(req,res)=>res.json(await monthlyTemplates.syncRepository(req))));
router.get('/monthly-documents',handle(async(req,res)=>res.json(await repo.listDocuments())));
router.get('/monthly-documents/:id',handle(async(req,res)=>{const document=await repo.getDocument(req.params.id);res.status(document?200:404).json(document || {error:'Monthly document not found'});}));
router.post('/monthly-documents',handle(async(req,res)=>{let document;try{document=engine.normalize(req.body);}catch(error){return res.status(400).json({error:error.message,code:'INVALID_MONTHLY_DOCUMENT'});}res.json(await repo.saveDocument(document));}));
module.exports=router;
