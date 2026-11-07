const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const local=require('../backend/models/local-speech');
test('optional offline engine uses private temporary files, shell-free fixed arguments and cleans up', {skip:process.platform==='win32'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'offline-speech-test-')),copy=path.join(dir,'convert'),whisper=path.join(dir,'recognize'),marker=path.join(dir,'marker');
 fs.writeFileSync(copy,'#!/usr/bin/env node\nconst fs=require("fs");fs.copyFileSync(process.argv[process.argv.indexOf("-i")+1],process.argv.at(-1));',{mode:0o700});
 fs.writeFileSync(whisper,`#!/usr/bin/env node\nconst fs=require('fs');const output=process.argv[process.argv.indexOf('-of')+1];fs.writeFileSync(${JSON.stringify(marker)},output);fs.writeFileSync(output+'.txt','离线转写 offline');`,{mode:0o700});
 try{
  const result=await local.transcribe({file:{buffer:Buffer.alloc(100)},config:{enabled:true,ffmpeg:copy,whisper,model:path.join(dir,'model.bin')}});assert.equal(result.text,'离线转写 offline');
  const output=fs.readFileSync(marker,'utf8');assert.equal(fs.existsSync(path.dirname(output)),false,'audio and transcript temporary directory is removed');
  const controller=new AbortController();controller.abort();await assert.rejects(local.transcribe({file:{buffer:Buffer.alloc(100)},signal:controller.signal,config:{enabled:true,ffmpeg:copy,whisper,model:'model'}}),e=>e.code==='AI_SPEECH_CANCELLED');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing offline assets are reported; capability never auto-downloads or bundles a model',()=>{
 const saved={...process.env};process.env.TOOLS_SPEECH_WHISPER_PATH='/missing/whisper';process.env.TOOLS_SPEECH_FFMPEG_PATH='/missing/ffmpeg';process.env.TOOLS_SPEECH_WHISPER_MODEL='/missing/model';
 try{const info=local.capability();assert.equal(info.enabled,false);assert.equal(info.reason,'runtime-missing');}
 finally{for(const key of ['TOOLS_SPEECH_WHISPER_PATH','TOOLS_SPEECH_FFMPEG_PATH','TOOLS_SPEECH_WHISPER_MODEL'])saved[key]===undefined?delete process.env[key]:process.env[key]=saved[key];}
});
