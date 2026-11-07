'use strict';
const {ipcRenderer}=require('electron');
let state={};
function render(){
    const banner=document.getElementById('banner');if(!banner)return;
    const en=state.lang==='en-US';banner.querySelector('span').textContent=en?'AI is working · pause to interact':'AI 正在操作 · 暂停后可操作页面';
    banner.querySelector('button').textContent=en?'Stop and take control':'停止并接管';
    const pointer=document.getElementById('pointer'),cursor=state.cursor;
    pointer.hidden=!cursor||Date.now()-cursor.at>5000;
    if(cursor){pointer.style.left=`${cursor.x*innerWidth}px`;pointer.style.top=`${cursor.y*innerHeight}px`;}
}
ipcRenderer.on('dragon-browser:operator-state',(_event,value)=>{state=value;render();});
document.addEventListener('DOMContentLoaded',()=>{
    render();document.querySelector('button').addEventListener('click',event=>{if(event.isTrusted)ipcRenderer.send('dragon-browser:operator-action','takeover');});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();document.querySelector('button').focus();}});
});
