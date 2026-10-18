const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const {panelBounds}=require('../desktop-pet/quota-panel-layout');

function separated(bounds,pet,anchor){const l=pet.x+anchor.x,r=l+anchor.width;return bounds.x+bounds.width<=l||bounds.x>=r;}
test('panel stays beside the visible character, flips at screen edges and handles negative monitor origins',()=>{
    const area={x:0,y:0,width:1440,height:900},anchor={x:90,y:120,width:110,height:160};
    for(const [x,side]of [[1190,'left'],[0,'right']]){
        const pet={x,y:570,width:218,height:293},b=panelBounds(pet,area,anchor);
        assert.equal(b.side,side);assert.ok(separated(b,pet,anchor));assert.ok(b.x>=area.x);assert.ok(b.x+b.width<=area.width);
    }
    const negative={x:-1920,y:-100,width:1920,height:1080},pet={x:-1850,y:300,width:300,height:400};
    const b=panelBounds(pet,negative,anchor);assert.equal(b.side,'right');assert.ok(b.x<0);assert.ok(b.y>=negative.y);
});
test('panel preserves its side near the center, remains readable at different pet scales and clamps tiny work areas',()=>{
    const area={x:0,y:0,width:1920,height:1080},pet={x:800,y:500,width:725,height:975};
    assert.equal(panelBounds(pet,area,{x:400,y:500,width:200,height:400},'left').side,'left');
    const tiny=panelBounds({x:0,y:0,width:200,height:300},{x:0,y:0,width:240,height:200});
    assert.ok(tiny.width<=224&&tiny.height<=184);assert.ok(tiny.x>=8&&tiny.y>=8);assert.ok(tiny.x+tiny.width<=232&&tiny.y+tiny.height<=192);
});

function manager(t){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-panel-manager-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const windows=[],listeners={},handles={},language=new EventEmitter();let calls=0;
    const quotas={codex:{status:'live',groups:[{id:'codex',windows:[{id:'5h',remainingPercent:80}]}]}};
    class Window extends EventEmitter{
        constructor(options){super();this.options=options;this.bounds={x:options.x||0,y:options.y||0,width:options.width,height:options.height};this.visible=false;this.destroyed=false;
            this.webContents=new EventEmitter();this.webContents.loading=true;this.webContents.sent=[];this.webContents.isLoading=()=>this.webContents.loading;
            this.webContents.send=(name,data)=>this.webContents.sent.push({name,data});windows.push(this);}
        loadFile(file){this.file=file;return Promise.resolve();}
        isVisible(){return this.visible;} isDestroyed(){return this.destroyed;}getBounds(){return {...this.bounds};}
        setBounds(b){this.bounds={...b};}setPosition(x,y){this.bounds.x=x;this.bounds.y=y;this.emit('move');}
        getSize(){return[this.bounds.width,this.bounds.height];}getPosition(){return[this.bounds.x,this.bounds.y];}
        setSize(width,height){Object.assign(this.bounds,{width,height});this.emit('resize');}
        show(){this.visible=true;this.emit('show');}showInactive(){this.inactive=true;this.show();}hide(){this.visible=false;this.emit('hide');}
        setAlwaysOnTop(){}setIgnoreMouseEvents(value){this.ignoresMouse=value;}focus(){this.focused=true;}
        destroy(){if(this.destroyed)return;this.destroyed=true;this.visible=false;this.emit('closed');}
        ready(){this.webContents.loading=false;this.webContents.emit('did-finish-load');}
    }
    const layout={workArea:{x:0,y:0,width:1440,height:900}},mod={exports:{}};
    const realRequire=createRequire(path.join(__dirname,'../desktop-pet/pet-manager.js'));
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop-pet/pet-manager.js'),'utf8'),{
        module:mod,exports:mod.exports,__dirname:path.join(__dirname,'../desktop-pet'),process,console:{log(){},warn(){}},
        setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},AbortController,
        require(name){
            if(name==='electron')return{app:{getPath:()=>root},BrowserWindow:Window,screen:{getDisplayMatching:()=>layout,getPrimaryDisplay:()=>layout},ipcMain:{on:(n,f)=>listeners[n]=f,handle:(n,f)=>handles[n]=f}};
            if(name.endsWith('desktop-language'))return{events:language,getLanguage:()=> 'zh-CN'};
            if(name.endsWith('quota-detector'))return{detectAllQuotas:async()=>{calls++;return quotas;}};
            if(name.endsWith('pet-keyboard-hook'))return{startKeyboardHook(){},stopKeyboardHook(){}};
            return realRequire(name);
        }
    });
    mod.exports.initDesktopPet();t.after(()=>mod.exports.cleanupDesktopPet());
    return{api:mod.exports,windows,listeners,handles,language,quotas,root,calls:()=>calls};
}
test('default panel waits until ready, stays click-through, follows movement and hides/destroys with its pet',async t=>{
    const f=manager(t),pet=f.windows[0];pet.ready();
    const panel=f.windows.find(w=>w.file?.endsWith('quota-panel.html'));assert.ok(panel);
    assert.equal(panel.options.focusable,false);assert.equal(panel.ignoresMouse,true);assert.equal(panel.visible,false);
    f.listeners['pet-quota-panel-ready']({sender:{}});assert.equal(panel.visible,false);
    await new Promise(r=>setImmediate(r));
    panel.ready();f.listeners['pet-quota-panel-ready']({sender:panel.webContents});assert.equal(panel.visible,true);assert.equal(panel.inactive,true);
    assert.equal(panel.webContents.sent.some(m=>m.name==='pet-quota-update'&&m.data===f.quotas),true);
    const x=panel.bounds.x;pet.setPosition(50,300);assert.notEqual(panel.bounds.x,x);
    const before=panel.getBounds();f.listeners['pet-quota-anchor']({sender:{}},{x:0,y:0,width:100,height:100});assert.deepEqual(panel.getBounds(),before);
    f.api.hidePetForNow();assert.equal(panel.visible,false);f.api.showPetForNow();assert.equal(panel.visible,true);
    f.language.emit('change','en-US');assert.equal(panel.webContents.sent.at(-1).data,'en-US');
    f.api.setPetEnabled(false);assert.equal(panel.destroyed,true);
});
test('panel preferences persist, reject foreign senders and do not expose story or authentication APIs',async t=>{
    const f=manager(t),pet=f.windows[0];pet.ready();const panel=f.windows[1];
    f.listeners['pet-quota-panel-ready']({sender:panel.webContents});
    f.listeners['pet-quota-panel-options']({sender:panel.webContents},{quotaPanelOn:false});assert.equal(panel.visible,true);
    assert.throws(()=>f.handles['pet-get-stories']({sender:panel.webContents}),/WINDOW_REQUIRED/);
    await assert.rejects(f.handles['pet-get-init-data']({sender:panel.webContents}),/WINDOW_REQUIRED/);
    f.listeners['pet-quota-panel-options']({sender:pet.webContents},{quotaPanelOn:false});assert.equal(panel.visible,false);
    f.listeners['pet-quota-panel-options']({sender:pet.webContents},{quotaPanelOn:true,quotaPanelGroup:'third-party'});assert.equal(panel.visible,true);
    assert.equal(panel.webContents.sent.some(m=>m.name==='pet-quota-panel-config'&&m.data.group==='third-party'),true);
    const config=JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8'));assert.equal(config.quotaPanelOn,true);assert.equal(config.quotaPanelGroup,'third-party');
});
test('quota clicks open only a validated trends window, mouse hit regions stay scoped, and disabling closes trends',async t=>{
    const f=manager(t),pet=f.windows[0];pet.ready();const panel=f.windows[1];
    f.listeners['pet-quota-panel-hit']({sender:{}},true);assert.equal(panel.ignoresMouse,true);
    f.listeners['pet-quota-panel-hit']({sender:panel.webContents},true);assert.equal(panel.ignoresMouse,false);
    f.listeners['pet-quota-panel-hit']({sender:panel.webContents},false);assert.equal(panel.ignoresMouse,true);
    const selection={provider:'codex',groupId:'codex',windowId:'5h'};
    f.listeners['pet-open-quota-trends']({sender:{}},selection);assert.equal(f.windows.length,2);
    f.listeners['pet-open-quota-trends']({sender:panel.webContents},{...selection,provider:'unknown'});assert.equal(f.windows.length,2);
    f.listeners['pet-open-quota-trends']({sender:panel.webContents},selection);
    const trends=f.windows[2];assert.ok(trends.file.endsWith('quota-trends.html'));trends.ready();assert.equal(trends.visible,true);
    assert.deepEqual(JSON.parse(JSON.stringify(f.handles['pet-quota-trends-ready']({sender:trends.webContents}))),selection);
    assert.throws(()=>f.handles['pet-quota-trends-ready']({sender:panel.webContents}),/WINDOW_REQUIRED/);
    await assert.rejects(f.handles['pet-quota-history']({sender:panel.webContents},{provider:'codex',days:1}),/WINDOW_REQUIRED/);
    await assert.rejects(f.handles['pet-quota-history']({sender:trends.webContents},{provider:'codex',days:91}),/INVALID_QUOTA_QUERY/);
    await assert.rejects(f.handles['pet-get-init-data']({sender:trends.webContents}),/WINDOW_REQUIRED/);
    f.listeners['pet-open-quota-trends']({sender:panel.webContents},{...selection,windowId:'weekly'});assert.equal(f.windows.length,3);
    assert.equal(trends.webContents.sent.at(-1).data.windowId,'weekly');
    f.api.hidePetForNow();assert.equal(trends.visible,false);
    f.api.setPetEnabled(false);assert.equal(trends.destroyed,true);
});
