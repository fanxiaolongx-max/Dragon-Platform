'use strict';
function registerSpeechPermission({ipcMain,getWindow,getBaseUrl,systemPreferences,platform=process.platform}){
    ipcMain.handle('speech:microphone',async event=>{
        try{
            const host=getWindow(),frame=event.senderFrame;
            if(!host||host.isDestroyed()||event.sender.isDestroyed()||event.sender!==host.webContents||frame!==event.sender.mainFrame)return false;
            const url=new URL(frame.url),base=new URL(getBaseUrl());
            if(url.origin!==base.origin||!['/','/index.html'].includes(url.pathname))return false;
            if(platform!=='darwin')return true;
            return await systemPreferences.askForMediaAccess('microphone');
        }catch(_error){return false;}
    });
}
module.exports={registerSpeechPermission};
