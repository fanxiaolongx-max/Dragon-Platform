'use strict';
const express=require('express'),multer=require('multer');
const {getTenantId,runWithTenant}=require('../models/tenant-context');
const speech=require('../models/ai-speech');
const router=express.Router(),active=new Set(),ttsControllers=new Map();
router.use((req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!req.user)return res.status(401).json({code:'AUTH_REQUIRED',error:'请先登录'});
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)throw Error();}catch(_error){return res.status(403).json({code:'ORIGIN_MISMATCH',error:'请在平台页面使用语音输入'});}}
    next();
});
router.get('/',async(_req,res)=>{
    try{res.json(await speech.capability());}
    catch(error){res.json({enabled:false,code:'AI_SPEECH_UNAVAILABLE',error:error.code==='AI_SPEECH_UNAVAILABLE'?error.message:'暂时无法读取语音模型配置'});}
});
router.post('/synthesize',async(req,res)=>{
    const tenant=getTenantId(),key=`${tenant}::${req.user.username}`;
    const turnId=typeof req.body?.turnId==='string'?req.body.turnId.trim().slice(0,64):'';
    const existing=ttsControllers.get(key);
    if(existing){
        if(!turnId||!existing.turnId||existing.turnId!==turnId){
            for(const prev of existing.controllers)prev.abort();
            existing.controllers.clear();
            existing.turnId=turnId||null;
        }else if(existing.controllers.size>=4){
            const oldest=existing.controllers.values().next().value;
            if(oldest){oldest.abort();existing.controllers.delete(oldest);}
        }
    }
    const group=existing&&ttsControllers.get(key)===existing?existing:{turnId:turnId||null,controllers:new Set()};
    if(!existing){ttsControllers.set(key,group);}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    group.controllers.add(controller);
    const onClose=()=>{if(!res.writableEnded)controller.abort();};res.on('close',onClose);
    try{
        const result=await runWithTenant(tenant,()=>speech.synthesizeSpeech({
            text:req.body?.text,
            voice:req.body?.voice,
            language:req.body?.language,
            signal:controller.signal
        }));
        if(!res.destroyed){
            res.setHeader('Content-Type',result.mimeType||'audio/wav');
            res.setHeader('X-Speech-Model',String(result.model||''));
            res.setHeader('X-Speech-Voice',String(result.voice||''));
            res.send(result.audio);
        }
    }catch(error){
        const known=String(error.code||'').startsWith('AI_SPEECH_')&&error.statusCode;
        if(!res.destroyed){
            res.status(controller.signal.aborted?504:known?error.statusCode:502).json({
                code:controller.signal.aborted?'AI_SPEECH_TIMEOUT':known?error.code:'AI_SPEECH_SYNTHESIS_FAILED',
                error:controller.signal.aborted?'语音合成超时，请重试':known?error.message:'自然语音合成失败'
            });
        }
    }finally{
        clearTimeout(timer);
        group.controllers.delete(controller);
        if(ttsControllers.get(key)===group&&group.controllers.size===0)ttsControllers.delete(key);
        res.off('close',onClose);
    }
});
router.post('/',(req,res,next)=>{
    const tenant=getTenantId(),key=`${tenant}::${req.user.username}`;
    if(active.has(key))return res.status(429).json({code:'AI_SPEECH_BUSY',error:'当前录音正在识别，请稍候'});
    active.add(key);res.once('close',()=>active.delete(key));
    multer({storage:multer.memoryStorage(),limits:{fileSize:speech.MAX_BYTES,files:1,fields:1,fieldSize:30}}).single('audio')(req,res,error=>runWithTenant(tenant,()=>{
        if(error)return res.status(400).json({code:'AI_SPEECH_UPLOAD',error:'录音上传失败，单次上限 8MB'});
        next();
    }));
},async(req,res)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),75000);
    const onClose=()=>{if(!res.writableEnded)controller.abort();};res.on('close',onClose);
    try{speech.audioType(req.file);const result=await speech.recognize({file:req.file,signal:controller.signal});if(!res.destroyed)res.json(result);}
    catch(error){const known=String(error.code||'').startsWith('AI_SPEECH_')&&error.statusCode;if(!res.destroyed)res.status(controller.signal.aborted?504:known?error.statusCode:502).json({code:controller.signal.aborted?'AI_SPEECH_TIMEOUT':known?error.code:'AI_SPEECH_FAILED',error:controller.signal.aborted?'语音识别超时，请重试':known?error.message:'语音识别失败，请稍后重试；原草稿已保留'});}
    finally{clearTimeout(timer);res.off('close',onClose);}
});
module.exports=router;
