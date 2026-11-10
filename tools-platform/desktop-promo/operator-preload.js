'use strict';
const {ipcRenderer}=require('electron');
let state={};
function render(){
    const presence=document.querySelector('.browser-ai-presence');
    if(!presence)return;
    const active=Boolean(state.active&&!state.manual);
    const en=state.lang==='en-US';
    presence.classList.toggle('is-active',active);
    const status=document.querySelector('.browser-ai-status');
    const message=active?(en?'AI is working · pause to interact':'AI 正在操作 · 暂停后可操作页面'):'';
    if(status.textContent!==message)status.textContent=message;
    const button=document.querySelector('button');
    button.hidden=!active;
    button.setAttribute('aria-label',en?'Stop and take control':'停止并接管');
    const pointer=document.getElementById('pointer'),cursor=state.cursor;
    pointer.hidden=!active||!cursor||Date.now()-cursor.at>5000;
    if(!pointer.hidden){pointer.style.left=`${cursor.x*innerWidth}px`;pointer.style.top=`${cursor.y*innerHeight}px`;}
}
ipcRenderer.on('dragon-browser:operator-state',(_event,value)=>{state=value;render();});
document.addEventListener('DOMContentLoaded',()=>{
    render();
    const button=document.querySelector('button');
    button.addEventListener('click',event=>{if(event.isTrusted&&!button.hidden)ipcRenderer.send('dragon-browser:operator-action','takeover');});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!button.hidden){event.preventDefault();button.focus();}});
});
