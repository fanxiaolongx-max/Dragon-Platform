// 录音仅用于转成草稿，不自动发送；所有复用 dcInput 的对话使用同一入口。
(function(){
    'use strict';
    const en=()=>/^en/.test(window.ToolsI18n?.getLanguage?.()||localStorage.getItem('tools_lang')||'');
    const L=(zh,english)=>en()?english:zh;
    function bind({button,input,form}){
        if(!button||!input||!form||button.dataset.voiceBound)return;
        button.dataset.voiceBound='true';button.removeAttribute('aria-disabled');
        const label=document.createElement('span');label.className='chat-voice-source';label.hidden=true;label.setAttribute('role','status');label.setAttribute('aria-live','polite');button.before(label);
        const micIcon=button.innerHTML,stopIcon='<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="3" fill="currentColor"/></svg>',busyIcon='<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="25 13"/></svg>';
        let current=null,capability=null,lastSource=null,degraded=false,preferBrowser=false,suppressClick=false;
        const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
        const supported=()=>Boolean(window.isSecureContext&&(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder||Recognition));
        const toast=message=>window.DragonClawText?.toast?.(message);
        const headers=()=>{const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');return token?{Authorization:`Bearer ${token}`}:{}};
        function render(){
            const s=current,recording=s?.phase==='recording',transcribing=s?.phase==='transcribing';
            button.disabled=!s&&input.disabled;button.setAttribute('aria-pressed',String(Boolean(s)));button.setAttribute('aria-busy',String(Boolean(transcribing)));button.classList.toggle('is-recording',recording);button.classList.toggle('is-transcribing',Boolean(transcribing));
            const icon=recording?stopIcon:s?busyIcon:micIcon;if(button.innerHTML!==icon)button.innerHTML=icon;
            button.dataset.tooltip=recording?L('停止录音并转文字；长按或 Esc 取消','Stop and transcribe; hold or Esc to cancel'):s?L('取消语音输入','Cancel voice input'):L('语音输入','Voice input');button.setAttribute('aria-label',button.dataset.tooltip);
            const seconds=s?.started?Math.floor((Date.now()-s.started)/1000):0,clock=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
            const source=s?.source||lastSource;label.hidden=!source&&!s;label.classList.toggle('is-fallback',degraded);
            const name=source?.id==='gemini'?'Gemini':source?.id==='cloud-asr'?L('语音模型','ASR'):source?.id==='whisper-local'?L('平台离线识别','Server offline'):source?.id==='browser-local'?L('浏览器离线','Browser offline'):source?.id==='browser'?L('浏览器识别·可能联网','Browser · may use network'):'';
            label.textContent=s?.phase==='permission'?L('准备麦克风…','Preparing mic…'):[degraded?L('已降级','Fallback'):null,name,recording?clock:transcribing?L('识别中…','Transcribing…'):null].filter(Boolean).join(' · ');
            label.title=source?.label||label.textContent;
            button.dataset.voiceSource=source?.id||'';button.classList.toggle('is-fallback',degraded);
            const detail=[degraded?L('已降级','Fallback'):null,source?.label||name,recording?clock:null].filter(Boolean).join(' · ');
            if(detail)button.dataset.tooltip+=' · '+detail;
            button.title=button.dataset.tooltip;button.setAttribute('aria-label',button.dataset.tooltip);
        }
        function release(s){clearInterval(s.levelTimer);s.audioContext?.close().catch(()=>{});clearInterval(s.timer);clearTimeout(s.limit);s.stream?.getTracks().forEach(track=>track.stop());}
        function cancel(){const s=current;if(!s)return;current=null;s.controller?.abort();release(s);s.recognition?.abort();if(s.recorder?.state==='recording')s.recorder.stop();render();}
        async function browserSource(offlineOnly=false){
            if(!Recognition)return null;const lang=en()?'en-US':'zh-CN';
            if(typeof Recognition.available==='function')try{if(await Recognition.available({langs:[lang],processLocally:true})==='available')return {id:'browser-local',label:L('浏览器端侧识别 · 离线','Browser on-device · offline'),location:'device'};}catch(_error){}
            return offlineOnly?null:{id:'browser',label:L('浏览器/系统识别 · 可能联网','Browser/system recognition · may use network'),location:'browser'};
        }
        async function capabilityCheck(){
            const response=await fetch('/api/ai/speech',{headers:headers(),credentials:'same-origin',cache:'no-store'});const value=await response.json();
            if(!response.ok)throw Error(value.error||L('语音识别暂不可用','Voice recognition is unavailable'));
            capability=value;
            if(!value.enabled||preferBrowser){const source=await browserSource(value.offlineOnly);if(source)return {...value,enabled:true,source};}
            if(!value.enabled){lastSource=null;preferBrowser=false;degraded=false;throw Error(value.error||L('没有可用的识别能力','No recognition engine is ready'));}
            return value;
        }
        function insert(s,text){
            if(current!==s||input.disabled)return;
            if(text){const unchanged=input.value===s.before,start=unchanged?s.start:input.value.length,end=unchanged?s.end:input.value.length;
                const value=unchanged?text:(input.value&&!/\s$/.test(input.value)?'\n':'')+text;
                input.value=input.value.slice(0,start)+value+input.value.slice(end);input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});input.setSelectionRange(start+value.length,start+value.length);
            }else toast(L('没有识别到清晰语音，请重试','No clear speech detected. Try again.'));
        }
        function startBrowser(s){
            const recognition=new Recognition();s.recognition=recognition;s.recognized='';recognition.lang=en()?'en-US':'zh-CN';recognition.continuous=true;recognition.interimResults=false;
            if(s.source.id==='browser-local')recognition.processLocally=true;
            recognition.onstart=()=>{if(current!==s)return recognition.abort();s.phase='recording';s.started=Date.now();s.timer=setInterval(render,500);s.limit=setTimeout(stop,120000);render();};
            recognition.onresult=event=>{if(current!==s)return;for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)s.recognized+=event.results[i][0].transcript;};
            recognition.onerror=event=>{if(current!==s)return;cancel();toast(event.error==='not-allowed'?L('麦克风权限未开启','Microphone permission denied'):L('浏览器识别不可用，请使用语音模型或平台离线识别','Browser recognition unavailable. Use a speech model or server offline engine.'));};
            recognition.onend=()=>{if(current!==s)return;insert(s,s.recognized.trim());cancel();};recognition.start();
        }
        function monitorAudio(s){
            const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
            try{
                const context=new Audio();s.audioContext=context;
                const analyser=context.createAnalyser();analyser.fftSize=2048;
                context.createMediaStreamSource(s.stream).connect(analyser);
                const samples=new Float32Array(analyser.fftSize);s.signalSamples=0;s.audibleSamples=0;
                context.resume().catch(()=>{});
                s.levelTimer=setInterval(()=>{
                    if(context.state!=='running')return;
                    analyser.getFloatTimeDomainData(samples);let power=0;for(const value of samples)power+=value*value;
                    s.signalSamples++;if(Math.sqrt(power/samples.length)>.003)s.audibleSamples++;
                },50);
            }catch(_error){clearInterval(s.levelTimer);s.audioContext?.close().catch(()=>{});s.signalSamples=0;}
        }
        async function transcribe(s){
            release(s);if(current!==s)return;
            if(Date.now()-s.started<500||!s.parts.length){cancel();toast(L('录音太短，请重新录制','Recording was too short. Try again.'));return;}
            if(s.signalSamples>=4&&!s.audibleSamples){cancel();toast(L('没有检测到声音，请检查麦克风后重试','No sound detected. Check your microphone and try again.'));return;}
            s.phase='transcribing';render();s.controller=new AbortController();
            const blob=new Blob(s.parts,{type:s.recorder.mimeType||s.parts[0].type}),formData=new FormData();
            if(blob.size>8*1024*1024){cancel();toast(L('录音超过 8MB，请分段录制','Recording exceeds 8MB. Record shorter clips.'));return;}
            formData.append('audio',blob,blob.type.includes('mp4')?'voice.mp4':'voice.webm');
            const timeout=setTimeout(()=>s.controller.abort(),80000);
            try{
                const response=await fetch('/api/ai/speech',{method:'POST',headers:headers(),credentials:'same-origin',body:formData,signal:s.controller.signal});const data=await response.json();
                if(current!==s)return;if(!response.ok){if(response.status>=500&&Recognition&&!capability?.offlineOnly&&!capability?.local?.ready){const fallback=await browserSource();if(current!==s)return;preferBrowser=true;lastSource=fallback;degraded=true;}throw Error(data.error||L('识别失败，请重试','Transcription failed. Try again.'));}
                if(input.disabled){cancel();return;}
                lastSource=data.source||s.source;degraded=Boolean(data.degraded);s.source=lastSource;insert(s,typeof data.text==='string'?data.text.trim():'');
                cancel();
            }catch(error){if(current===s){cancel();toast(error.name==='AbortError'?L('语音识别已取消或超时，原草稿已保留','Transcription cancelled or timed out. Your draft is preserved.'):error.message);}}
            finally{clearTimeout(timeout);s.parts.length=0;}
        }
        function stop(){const s=current;if(s?.phase!=='recording')return;s.phase='transcribing';if(s.recognition)s.recognition.stop();else s.recorder.stop();release(s);render();}
        async function start(){
            if(current){current.phase==='recording'?stop():cancel();return;}
            if(input.disabled)return;
            if(!supported()){toast(L('请使用支持录音的浏览器，并通过 HTTPS 或本机地址打开平台','Use a recording-capable browser over HTTPS or localhost.'));return;}
            const s={phase:'permission',before:input.value,start:input.selectionStart||0,end:input.selectionEnd||0,parts:[]};current=s;render();
            try{
                const caps=await capabilityCheck();if(current!==s)return;s.source=caps.source||{id:'gemini',label:'Gemini'};lastSource=s.source;degraded=preferBrowser;render();
                if(s.source.id.startsWith('browser')){startBrowser(s);return;}
                if(window.ToolsSpeech?.requestMicrophone&&!await window.ToolsSpeech.requestMicrophone())throw Object.assign(Error('Microphone permission denied'),{name:'NotAllowedError'});if(current!==s)return;
                const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});s.stream=stream;
                if(current!==s){release(s);return;}
                const mimeType=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
                if(!mimeType)throw Error(L('当前浏览器没有可用的录音编码，请更新浏览器','No supported audio encoder. Update your browser.'));
                s.recorder=new MediaRecorder(stream,{mimeType,audioBitsPerSecond:64000});
                s.recorder.ondataavailable=event=>{if(event.data.size&&current===s)s.parts.push(event.data);};
                s.recorder.onstop=()=>transcribe(s);s.recorder.onerror=()=>{if(current===s){cancel();toast(L('录音中断，请重试','Recording interrupted. Try again.'));}};
                s.phase='recording';s.started=Date.now();monitorAudio(s);s.recorder.start(1000);s.timer=setInterval(render,500);s.limit=setTimeout(stop,120000);render();
            }catch(error){if(current!==s){release(s);return;}cancel();toast(['NotAllowedError','PermissionDeniedError'].includes(error.name)?L('麦克风权限未开启，请在浏览器或系统设置中允许麦克风','Microphone permission was denied. Enable it in browser or system settings.'):error.name==='NotFoundError'?L('未找到麦克风','No microphone found'):error.message||L('无法开始录音','Could not start recording'));}
        }
        button.addEventListener('click',()=>{if(suppressClick){suppressClick=false;return;}start();});
        let hold;button.addEventListener('pointerdown',()=>{if(current)hold=setTimeout(()=>{suppressClick=true;cancel();},650);});for(const name of ['pointerup','pointercancel','pointerleave'])button.addEventListener(name,()=>clearTimeout(hold));
        form.addEventListener('submit',event=>{if(current){event.preventDefault();event.stopImmediatePropagation();toast(L('请先完成语音识别，再确认发送','Finish transcription before sending.'));}},true);
        for(const name of ['home:chat-state','home:mode','home:external','home:hub'])window.addEventListener(name,cancel);
        document.getElementById('dcNewChat')?.addEventListener('click',cancel,true);
        window.addEventListener('pagehide',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
        document.addEventListener('keydown',event=>{if(current&&event.key==='Escape'){event.preventDefault();cancel();}});
        new MutationObserver(()=>{if(input.disabled)cancel();render();}).observe(input,{attributes:true,attributeFilter:['disabled']});
        window.addEventListener('tools:languagechange',render);render();capabilityCheck().then(value=>{if(!current){lastSource=value.source;render();}}).catch(()=>{});return {cancel,refresh:render};
    }
    window.ChatVoiceInput={bind};
    const init=()=>{const controller=bind({button:document.getElementById('dcVoice'),input:document.getElementById('dcInput'),form:document.getElementById('dcComposer')});if(controller)window.ChatVoiceInput.refresh=controller.refresh;};
    document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})();
