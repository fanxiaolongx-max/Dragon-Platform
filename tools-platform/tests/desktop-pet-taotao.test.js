const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const egg = require('../desktop-pet/taotao-egg');
const { createVisitor } = require('../desktop-pet/taotao-visit');

test('only the eleventh frequent click triggers; a pause, drag/cancel reset and cooldown prevent accidental visits', () => {
    let now = 0;
    const clicks = egg.createClicks(() => now);
    for (let i = 0; i < 10; i++) { assert.equal(clicks.click(), false); now += 300; }
    assert.equal(clicks.click(), true);
    for (let i = 0; i < 50; i++) { now += 100; assert.equal(clicks.click(), false); }
    now += 30000;
    for (let i = 0; i < 10; i++) { clicks.click(); now += 200; }
    now += 1001;
    assert.equal(clicks.click(), false, 'long gap starts a new sequence');
    clicks.reset();
    for (let i = 0; i < 10; i++) { assert.equal(clicks.click(), false); now += 250; }
    clicks.reset(); // Dragged or cancelled pointers never complete a click sequence.
    assert.equal(clicks.click(), false);
});

test('slow individual clicks cannot accumulate beyond the six-second rolling window', () => {
    let now = 0;
    const clicks = egg.createClicks(() => now);
    for (let i = 0; i < 50; i++) { assert.equal(clicks.click(), false); now += 800; }
});

test('greeting lasts ten seconds, departure precedes a head-only farewell and ends completely', () => {
    for (const [time, phase] of [[0,'greeting'],[9999,'greeting'],[10000,'leaving'],
        [11499,'leaving'],[11500,'hidden'],[11800,'peek'],[14299,'peek'],[14300,'bye'],[14800,'done']]) {
        assert.equal(egg.phaseAt(time).name, phase);
    }
});

test('visitor starts beside Dragon but always leaves through the physical right edge, including side Docks and negative origins', () => {
    for (const area of [{x:0,y:0,width:1440,height:900}, {x:-1920,y:-200,width:1920,height:1080},
        {x:1440,y:40,width:200,height:180}]) {
        for (const fraction of [.1,.9]) {
            const bounds={...area,width:area.width+80}; // Right-hand Dock reserves 80 DIP.
            const p = egg.layout({x:area.x+area.width*fraction,y:area.y+100,width:80,height:140},area,bounds);
            assert.ok(p.x >= area.x && p.x + p.width <= area.x + area.width);
            assert.ok(p.y >= area.y && p.y + p.height <= area.y + area.height);
            assert.equal(p.side,'right');
            assert.equal(p.edgeX+p.width,bounds.x+bounds.width);
        }
    }
});

test('artwork only crosses its clipping edge after the native window reaches the screen boundary',()=>{
    for(const p of [0,.1,.5,.69]){
        const travel=egg.departureAt(p);assert.ok(travel.windowProgress<1);assert.equal(travel.exitProgress,0);
    }
    assert.equal(egg.departureAt(.7).windowProgress,1);
    for(const p of [.71,.8,.99,1]){
        const travel=egg.departureAt(p);assert.equal(travel.windowProgress,1);assert.ok(travel.exitProgress>0);
    }
    assert.equal(egg.departureAt(1).exitProgress,1);
});

function fixture() {
    let now = 0, callback;
    const windows = [], timers = new Set(), pending = new Set();
    class Window extends EventEmitter {
        constructor(options) {
            super(); this.options = options; this.destroyed = false; this.sent = [];
            this.webContents = new EventEmitter();
            this.webContents.send = (name, data) => this.sent.push({name,data});
            windows.push(this);
        }
        setIgnoreMouseEvents(value) { this.ignoresMouse = value; }
        loadFile() { return Promise.resolve(); }
        isDestroyed() { return this.destroyed; }
        setPosition(x,y) { this.position = {x,y}; }
        showInactive() { this.visible = true; }
        destroy() { this.destroyed = true; this.emit('closed'); }
    }
    const pet = { visible:true, isDestroyed:()=>false, isVisible(){return this.visible;},
        getBounds:()=>({x:-300,y:400,width:200,height:290}), webContents:{send(){}} };
    let language = 'zh-CN';
    const display={workArea:{x:-1440,y:0,width:1440,height:900}};
    const visitor = createVisitor({ BrowserWindow:Window,
        screen:{getDisplayMatching:()=>display},
        getPet:()=>pet, getLanguage:()=>language, now:()=>now,
        schedule(fn){callback=fn;timers.add(fn);return fn;}, cancel(fn){timers.delete(fn);},
        defer(fn){pending.add(fn);return fn;}, clearDeferred(fn){pending.delete(fn);} });
    return {visitor,windows,pet,timers,pending,display,advance(time){now=time;callback();},setLanguage(value){language=value;}};
}

test('native visit ignores untrusted readiness, never focuses or intercepts clicks, and cleans itself after farewell', () => {
    const f=fixture(); assert.equal(f.visitor.start(),true);
    const win=f.windows[0];
    assert.equal(win.options.focusable,false); assert.equal(win.ignoresMouse,true);
    assert.equal(f.visitor.ready({}),false); assert.equal(win.visible,undefined);
    assert.equal(f.visitor.ready(win.webContents),true); assert.equal(win.visible,true);
    assert.equal(f.visitor.start(),false,'cannot spawn overlapping visitors');
    assert.equal(f.visitor.ready(win.webContents),false,'duplicate ready does not restart clock');
    f.advance(9999); assert.equal(win.sent.at(-1).data.phase,'greeting');
    f.advance(10000); assert.equal(win.sent.findLast(m=>m.name==='taotao-phase').data.phase,'leaving');
    f.advance(11800); assert.equal(win.sent.at(-1).data.phase,'peek'); assert.equal(win.position.x,-240);
    f.setLanguage('en-US');f.visitor.languageChanged();assert.equal(win.sent.at(-1).data,'en-US');
    f.advance(14800);assert.equal(win.destroyed,true);assert.equal(f.timers.size,0);assert.equal(f.pending.size,0);
    assert.equal(f.visitor.start(),false,'native cooldown survives renderer repeated requests');
    f.advance(30001);assert.equal(f.visitor.start(),true);f.visitor.close();
});

test('a display geometry change is reflected in the final right-edge position',()=>{
    const f=fixture();f.visitor.start();const win=f.windows[0];f.visitor.ready(win.webContents);
    f.display.bounds={x:-1440,y:0,width:1600,height:900};
    f.advance(11050);assert.equal(win.position.x+win.options.width,160);
    assert.equal(win.sent.at(-1).name,'taotao-travel');assert.equal(win.sent.at(-1).data,0);
    f.advance(11800);assert.equal(win.position.x+win.options.width,160);
    f.visitor.close();
});

test('hide, failed assets and renderer crash dispose windows and all animation/load timers', () => {
    for (const cause of ['hide','assets','crash','close']) {
        const f=fixture();f.visitor.start();const win=f.windows[0];
        if(cause !== 'assets') f.visitor.ready(win.webContents);
        if(cause==='hide'){f.pet.visible=false;f.advance(100);}
        if(cause==='assets'){f.visitor.failed({});assert.equal(win.destroyed,false);f.visitor.failed(win.webContents);}
        if(cause==='crash')win.webContents.emit('render-process-gone');
        if(cause==='close')f.visitor.close();
        assert.equal(win.destroyed,true,cause);assert.equal(f.timers.size,0,cause);assert.equal(f.pending.size,0,cause);
    }
});
