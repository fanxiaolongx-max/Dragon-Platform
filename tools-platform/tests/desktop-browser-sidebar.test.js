const test = require('node:test'), assert = require('node:assert/strict');
const { registerBrowserSidebar } = require('../desktop-browser-sidebar');
test('sidebar IPC ignores destroyed windows, dead sender frames and non-home senders', () => {
    const events = new Map(), handles = new Map(), calls = [];
    const contents = { isDestroyed: () => false, getZoomFactor: () => 1.5 };
    const frame = { url: 'http://localhost:3030/' }; contents.mainFrame = frame;
    let dead = false;
    const host = { isDestroyed: () => dead, get webContents() { if (dead) throw Error('destroyed'); return contents; }, getContentSize: () => [1200,800], on() {} };
    registerBrowserSidebar({ ipcMain: { on: (name,fn) => events.set(name,fn), handle: (name,fn) => handles.set(name,fn) }, getWindow: () => host, getBaseUrl: () => 'http://localhost:3030', browser: {
        setBrowserSidebar: () => calls.push('connect'), setBrowserSidebarBounds: value => calls.push(value), browserSidebarAction: () => calls.push('action'), popoutBrowser: () => calls.push('popout')
    } });
    const event = { sender: contents, senderFrame: frame };
    events.get('dragon-browser:bounds')(event,{x:700,y:100,width:500,height:500});
    assert.deepEqual(calls.pop(),{x:1050,y:150,width:150,height:650});
    events.get('dragon-browser:bounds')(event,{x:NaN,y:0,width:100,height:100});
    assert.equal(calls.length,0);
    dead = true;
    for (const [name,fn] of events) assert.doesNotThrow(() => fn(event,{x:0,y:0,width:10,height:10}),name);
    assert.equal(handles.get('dragon-browser:connect')(event),false);
    dead = false;
    const lateEvent = {sender:contents,get senderFrame(){throw Error('Object has been destroyed');}};
    events.get('dragon-browser:bounds')(lateEvent,null);
    events.get('dragon-browser:action')({sender:{isDestroyed:()=>false}},'new-tab');
    events.get('dragon-browser:action')({sender:contents,senderFrame:{url:frame.url}},'new-tab');
    frame.url='https://example.com/';events.get('dragon-browser:popout')(event);
    assert.equal(calls.length,0,'no native action from stale, external or child frames');
});
