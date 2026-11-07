const test=require('node:test'),assert=require('node:assert/strict');
test('microphone permission only accepts live local homepage main frame',async()=>{
 let handler,calls=0;const frame={url:'http://localhost:3030/'},wc={mainFrame:frame,isDestroyed:()=>false},host={webContents:wc,isDestroyed:()=>false};
 require('../desktop-speech').registerSpeechPermission({ipcMain:{handle:(_name,fn)=>{handler=fn;}},getWindow:()=>host,getBaseUrl:()=> 'http://localhost:3030',platform:'darwin',systemPreferences:{askForMediaAccess:async type=>{assert.equal(type,'microphone');calls++;return true;}}});
 const event={sender:wc,senderFrame:frame};assert.equal(await handler(event),true);assert.equal(calls,1);
 assert.equal(await handler({...event,senderFrame:{url:'http://localhost:3030/'}}),false);frame.url='https://evil.invalid/';assert.equal(await handler(event),false);frame.url='http://localhost:3030/pages/report.html';assert.equal(await handler(event),false);assert.equal(calls,1);
 assert.equal(await handler({get senderFrame(){throw Error('destroyed');}}),false);
});
