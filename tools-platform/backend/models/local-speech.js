'use strict';
// 可选离线引擎：复用已安装的 whisper.cpp / ffmpeg，不随应用捆绑或自动下载模型。
const fs=require('fs'),fsp=require('fs/promises'),path=require('path'),os=require('os'),{spawn}=require('child_process');
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:503});
function executable(envName,names){
    const configured=process.env[envName];
    const candidates=configured?[configured]:String(process.env.PATH||'').split(path.delimiter).flatMap(dir=>names.map(name=>path.join(dir,name))).concat(names.flatMap(name=>['/opt/homebrew/bin','/usr/local/bin','/usr/bin'].map(dir=>path.join(dir,name))));
    return candidates.find(file=>{try{return fs.statSync(file).isFile()&&(process.platform==='win32'||(fs.accessSync(file,fs.constants.X_OK),true));}catch(_error){return false;}})||null;
}
function capability(){
    const whisper=executable('TOOLS_SPEECH_WHISPER_PATH',['whisper-cli','whisper-cli.exe']),ffmpeg=executable('TOOLS_SPEECH_FFMPEG_PATH',['ffmpeg','ffmpeg.exe']);
    const dirs=[process.env.TOOLS_SPEECH_MODEL_DIR,path.join(os.homedir(),'.cache','whisper'),path.join(os.homedir(),'Library','Application Support','DragonClaw','Speech','models'),path.join(process.env.LOCALAPPDATA||os.homedir(),'DragonClaw','Speech','models')].filter(Boolean);
    const candidates=process.env.TOOLS_SPEECH_WHISPER_MODEL?[process.env.TOOLS_SPEECH_WHISPER_MODEL]:dirs.flatMap(dir=>['ggml-small.bin','ggml-base.bin','ggml-base-q5_1.bin','ggml-tiny.bin'].map(name=>path.join(dir,name)));
    const model=candidates.find(file=>{try{return fs.statSync(file).isFile()&&fs.statSync(file).size>1024*1024;}catch(_error){return false;}})||null;
    return {enabled:Boolean(whisper&&ffmpeg&&model),whisper,ffmpeg,model,reason:!whisper||!ffmpeg?'runtime-missing':!model?'model-missing':null};
}
function run(exe,args,signal){
    return new Promise((resolve,reject)=>{
        if(signal?.aborted)return reject(fail('AI_SPEECH_CANCELLED','离线识别已取消'));
        const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','ignore'],shell:false});let output='',settled=false;
        const terminate=()=>{child.kill();const forced=setTimeout(()=>child.kill('SIGKILL'),1000);forced.unref?.();};
        const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(output);};
        const abort=()=>{terminate();};signal?.addEventListener('abort',abort,{once:true});
        const timer=setTimeout(()=>terminate(),40000);timer.unref?.();
        child.stdout.on('data',chunk=>{output+=chunk;if(output.length>256*1024)terminate();});
        child.on('error',()=>finish(fail('AI_SPEECH_LOCAL_FAILED','离线识别程序无法运行')));
        child.on('close',code=>finish(signal?.aborted?fail('AI_SPEECH_CANCELLED','离线识别已取消'):code===0?null:fail('AI_SPEECH_LOCAL_FAILED','离线识别失败，请检查本地模型和运行程序')));
    });
}
async function transcribe({file,signal,config=capability()}){
    if(!config.enabled)throw fail('AI_SPEECH_LOCAL_UNAVAILABLE','离线识别尚未就绪：需要 whisper.cpp、ffmpeg 和单独安装的语音模型');
    const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'dragon-speech-'));await fsp.chmod(dir,0o700);
    const input=path.join(dir,'input.audio'),wav=path.join(dir,'input.wav'),output=path.join(dir,'result');
    try{
        await fsp.writeFile(input,file.buffer,{mode:0o600});
        await run(config.ffmpeg,['-nostdin','-loglevel','error','-y','-protocol_whitelist','file,pipe','-i',input,'-t','120','-ar','16000','-ac','1',wav],signal);
        await run(config.whisper,['-m',config.model,'-f',wav,'-l','auto','-nt','-np','-otxt','-of',output,'-t','4'],signal);
        const text=(await fsp.readFile(`${output}.txt`,'utf8')).replace(/\[BLANK_AUDIO\]/g,'').trim();
        if(text.length>12000)throw fail('AI_SPEECH_LOCAL_FAILED','离线识别结果过长，请分段录制');
        return {text};
    }finally{await fsp.rm(dir,{recursive:true,force:true});}
}
module.exports={capability,transcribe};
