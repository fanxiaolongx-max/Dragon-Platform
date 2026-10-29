const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const {sidebarBounds,droppedSidebar,collapsedBounds,peekBounds}=require('../desktop-pet/quota-panel-layout');

test('compact bar defaults to the top and clamps saved positions on negative-origin and small displays',()=>{
    for(const area of [{x:0,y:0,width:1440,height:900},{x:-1920,y:-100,width:1920,height:1080},{x:0,y:0,width:240,height:200}]){
        const b=sidebarBounds(area);assert.equal(b.mode,'top');assert.equal(b.y,area.y);assert.equal(b.orientation,'horizontal');
        assert.ok(b.x>=area.x&&b.x+b.width<=area.x+area.width);assert.equal(b.height,64);
        assert.ok(b.y>=area.y&&b.y+b.height<=area.y+area.height);
        const moved=sidebarBounds(area,{mode:'free',x:-99999,y:99999});assert.ok(moved.x>=area.x);assert.ok(moved.y+moved.height<=area.y+area.height);
    }
});
test('compact placement rotates at all four edges, preserves free orientation and supports detailed panels',()=>{
    const area={x:-1440,y:-100,width:1440,height:900};
    for(const [mode,point] of [['top',{x:-800,y:-90}],['bottom',{x:-800,y:740}],['left',{x:-1430,y:180}],['right',{x:-430,y:180}]]){
        const result=droppedSidebar({...point,width:416,height:58},area);
        assert.equal(result.mode,mode);
        assert.equal(result.orientation,['left','right'].includes(mode)?'vertical':'horizontal');
        assert.equal(result.width,result.orientation==='vertical'?68:360);
        assert.ok(result.x>=area.x&&result.x+result.width<=area.x+area.width);
        assert.ok(result.y>=area.y&&result.y+result.height<=area.y+area.height);
    }
    const free=droppedSidebar({x:-800,y:180,width:152,height:184},area,{orientation:'vertical'});
    assert.equal(free.mode,'free');assert.equal(free.orientation,'vertical');assert.equal(free.width,68);
    const detail=sidebarBounds(area,{mode:'right',y:180},true);
    assert.equal(detail.width,286);assert.equal(detail.height,426);assert.equal(detail.y,180);
    assert.equal(sidebarBounds(area,{mode:'right',x:-286,y:180}).width,68,'old right-edge preferences become a compact side strip');
});
test('drag release snaps either edge, keeps floating positions, and preserves the vertical position',()=>{
    const area={x:-1440,y:40,width:1440,height:900};
    assert.equal(droppedSidebar({x:-305,y:150,width:286,height:426},area).mode,'right');
    assert.equal(droppedSidebar({x:-1420,y:150,width:286,height:426},area).mode,'left');
    const free=droppedSidebar({x:-800,y:180,width:286,height:426},area);assert.equal(free.mode,'free');assert.equal(free.x,-800);assert.equal(free.y,180);
});

function manager(t,initialConfig,platform=process.platform){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-panel-manager-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    if(initialConfig)fs.writeFileSync(path.join(root,'desktop-pet-config.json'),JSON.stringify({scaleVersion:2,...initialConfig}));
    const windows=[],listeners={},handles={},menus=[],cursor={x:0,y:0},language=new EventEmitter();let calls=0;
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
    const layout={bounds:{x:0,y:0,width:1440,height:900},workArea:{x:0,y:0,width:1440,height:900}},mod={exports:{}};
    const realRequire=createRequire(path.join(__dirname,'../desktop-pet/pet-manager.js'));
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop-pet/pet-manager.js'),'utf8'),{
        module:mod,exports:mod.exports,__dirname:path.join(__dirname,'../desktop-pet'),process:{...process,platform},console:{log(){},warn(){}},
        setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},AbortController,
        require(name){
            if(name==='electron')return{app:{getPath:()=>root},BrowserWindow:Window,Menu:{buildFromTemplate:items=>({popup:()=>menus.push(items)})},screen:{getDisplayMatching:()=>layout,getPrimaryDisplay:()=>layout,getCursorScreenPoint:()=>({...cursor})},ipcMain:{on:(n,f)=>listeners[n]=f,handle:(n,f)=>handles[n]=f}};
            if(name.endsWith('desktop-language'))return{events:language,getLanguage:()=> 'zh-CN'};
            if(name.endsWith('quota-detector'))return{detectAllQuotas:async()=>{calls++;return quotas;}};
            if(name.endsWith('pet-keyboard-hook'))return{startKeyboardHook(){},stopKeyboardHook(){}};
            return realRequire(name);
        }
    });
    mod.exports.initDesktopPet();t.after(()=>mod.exports.cleanupDesktopPet());
    return{api:mod.exports,windows,listeners,handles,menus,cursor,layout,language,quotas,root,calls:()=>calls};
}
test('default sidebar is independent, stays at its own location and hides without changing the pet',async t=>{
    const f=manager(t),pet=f.windows[0];pet.ready();
    const panel=f.windows.find(w=>w.file?.endsWith('quota-panel.html'));assert.ok(panel);
    assert.equal(panel.options.focusable,false);assert.equal(panel.ignoresMouse,false);assert.equal(panel.visible,false);
    f.listeners['pet-quota-panel-ready']({sender:{}});assert.equal(panel.visible,false);
    await new Promise(r=>setImmediate(r));
    panel.ready();f.listeners['pet-quota-panel-ready']({sender:panel.webContents});assert.equal(panel.visible,true);assert.equal(panel.inactive,true);
    assert.equal(panel.webContents.sent.some(m=>m.name==='pet-quota-update'&&m.data===f.quotas),true);
    const before=panel.getBounds();pet.setPosition(50,300);assert.deepEqual(panel.getBounds(),before);
    f.api.hidePetForNow();assert.equal(panel.visible,true);f.api.showPetForNow();assert.equal(panel.visible,true);
    f.listeners['pet-quota-panel-hide']({sender:{}});assert.equal(panel.visible,true);
    f.listeners['pet-quota-panel-hide']({sender:panel.webContents});assert.equal(panel.visible,false);assert.equal(pet.visible,true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8')).quotaPanelOn,false);
    f.listeners['pet-config-changed']({sender:pet.webContents},{quotaStandalone:true,quotaPanelOn:false,eyeGazeOn:true});assert.equal(panel.visible,false,'a full settings sync does not undo an explicit hide');
    f.api.setQuotaPanelEnabled(true);assert.equal(panel.visible,true);
    f.language.emit('change','en-US');assert.equal(panel.webContents.sent.at(-1).data,'en-US');
    f.api.setPetEnabled(false);assert.equal(panel.destroyed,false);assert.equal(panel.visible,true);
});

test('standalone HUD survives hiding and disabling the pet, persists and can open trends without a pet',async t=>{
    const f=manager(t,{quotaStandalone:false}),pet=f.windows[0];pet.ready();const panel=f.windows[1];panel.ready();
    f.listeners['pet-quota-panel-ready']({sender:panel.webContents});
    f.listeners['pet-config-changed']({sender:panel.webContents},{quotaStandalone:true});assert.equal(f.api.isQuotaStandalone(),false);
    f.api.setQuotaStandalone(true);f.api.hidePetForNow();assert.equal(panel.visible,true);
    f.api.setPetEnabled(false);assert.equal(pet.destroyed,true);assert.equal(panel.destroyed,false);assert.equal(panel.visible,true);
    assert.equal(panel.options.parent,undefined,'HUD does not inherit native pet-window lifecycle');
    f.listeners['pet-open-quota-trends']({sender:panel.webContents},{provider:'codex',groupId:'codex',windowId:'5h'});
    const trends=f.windows.find(w=>w.file?.endsWith('quota-trends.html'));assert.ok(trends);trends.ready();assert.equal(trends.visible,true);
    const config=JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8'));assert.equal(config.quotaStandalone,true);assert.equal(config.enabled,false);
    f.api.setQuotaStandalone(false);assert.equal(panel.visible,false);
});

test('standalone HUD cold-starts when pet startup is disabled and retains saved provider group',async t=>{
    const f=manager(t,{enabled:false,quotaStandalone:true,quotaPanelOn:true,quotaPanelGroup:'third-party'});
    assert.equal(f.windows.length,1);const panel=f.windows[0];assert.ok(panel.file.endsWith('quota-panel.html'));
    panel.ready();f.listeners['pet-quota-panel-ready']({sender:panel.webContents});assert.equal(panel.visible,true);
    assert.equal(panel.webContents.sent.find(m=>m.name==='pet-quota-panel-config').data.group,'third-party');
    await new Promise(r=>setImmediate(r));assert.ok(f.calls()>0,'independent HUD refreshes quotas');
    f.api.showPetForNow();assert.ok(f.windows.some(w=>w.file.endsWith('pet.html')));
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
test('quota clicks open only a validated trends window and disabling an opted-in pet closes trends',async t=>{
    const f=manager(t,{quotaStandalone:false}),pet=f.windows[0];pet.ready();const panel=f.windows[1];
    f.listeners['pet-quota-panel-hit']({sender:{}},true);assert.equal(panel.ignoresMouse,false);
    f.listeners['pet-quota-panel-hit']({sender:panel.webContents},true);assert.equal(panel.ignoresMouse,false);
    f.listeners['pet-quota-panel-hit']({sender:panel.webContents},false);assert.equal(panel.ignoresMouse,false);
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

test('drag IPC uses native cursor coordinates, persists placement and rejects other windows',t=>{
    const f=manager(t),pet=f.windows[0];pet.ready();const panel=f.windows[1];f.listeners['pet-quota-panel-ready']({sender:panel.webContents});
    const before=panel.getBounds(),event={sender:panel.webContents};
    f.listeners['pet-quota-panel-drag']({sender:pet.webContents},'start');f.cursor.x=500;f.listeners['pet-quota-panel-drag'](event,'move');assert.deepEqual(panel.getBounds(),before);
    f.listeners['pet-quota-panel-drag'](event,'start');f.cursor.x=100;f.cursor.y=200;f.listeners['pet-quota-panel-drag'](event,'move');
    assert.equal(panel.bounds.x,before.x-400);pet.setPosition(0,0);assert.equal(panel.bounds.x,before.x-400,'pet ticks cannot reset a drag');
    f.listeners['pet-quota-panel-drag'](event,'end');const saved=JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8')).quotaPanelPlacement;
    assert.equal(saved.mode,'free');assert.equal(saved.x,before.x-400);
    const restored=manager(t,{quotaPanelPlacement:saved});assert.equal(restored.windows[1].bounds.x,saved.x);assert.equal(restored.windows[1].bounds.y,saved.y);
    pet.setPosition(100,100);assert.equal(panel.bounds.x,saved.x);
    f.listeners['pet-quota-panel-dock']({sender:{}});assert.equal(panel.bounds.x,saved.x);
    f.listeners['pet-quota-panel-dock']({sender:pet.webContents});assert.equal(panel.bounds.x+panel.bounds.width,1440);
});
test('menu changes orientation and detail size, persists preferences and restores compact mode',t=>{
    const f=manager(t,{enabled:false,quotaStandalone:true}),panel=f.windows[0],event={sender:panel.webContents};
    f.listeners['pet-quota-panel-ready'](event);
    assert.equal(panel.bounds.width,360);assert.equal(panel.bounds.height,64);
    f.listeners['pet-quota-panel-menu'](event);
    const choose=label=>f.menus.at(-1).find(item=>item.label===label).click();
    choose('停靠屏幕左侧');assert.equal(panel.bounds.width,68);assert.equal(panel.bounds.height,248);
    assert.equal(panel.webContents.sent.filter(m=>m.name==='pet-quota-panel-config').at(-1).data.orientation,'vertical');
    choose('详细额度面板');assert.equal(panel.bounds.width,286);assert.equal(panel.bounds.height,426);
    const saved=JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8'));
    assert.equal(saved.quotaPanelExpanded,true);assert.equal(saved.quotaPanelPlacement.mode,'left');
    const restored=manager(t,saved);assert.equal(restored.windows[0].bounds.width,286);
    choose('精简额度栏');assert.equal(panel.bounds.width,68);
    choose('停靠屏幕顶部');assert.equal(panel.bounds.height,64);assert.equal(panel.bounds.y,0);
    choose('停靠屏幕底部');assert.equal(panel.bounds.y+panel.bounds.height,900);
});
test('sidebar right-click menu can hide only the sidebar and docking restores remain on screen',t=>{
    const f=manager(t,{quotaPanelPlacement:{mode:'free',x:99999,y:99999}}),pet=f.windows[0];pet.ready();const panel=f.windows[1];f.listeners['pet-quota-panel-ready']({sender:panel.webContents});
    assert.ok(panel.bounds.x+panel.bounds.width<=1440&&panel.bounds.y+panel.bounds.height<=900);
    f.listeners['pet-quota-panel-menu']({sender:{}});assert.equal(f.menus.length,0);
    panel.webContents.emit('context-menu');assert.equal(f.menus.length,1);
    f.menus[0].find(item=>item.label==='停靠屏幕左侧').click();assert.equal(panel.bounds.x,0);
    f.menus[0].find(item=>item.label==='隐藏额度侧栏').click();assert.equal(panel.visible,false);assert.equal(pet.visible,true);
    f.api.setQuotaPanelEnabled(true);assert.equal(panel.visible,true);assert.equal(panel.bounds.x,0);
});

test('all four dock surfaces touch the boundary and collapsed native windows occupy only six pixels',()=>{
    const area={x:-1728,y:24,width:1728,height:1093};
    for(const mode of ['left','right','top','bottom']) {
        const rail=sidebarBounds(area,{mode,x:-900,y:300}),hidden=collapsedBounds(rail);
        if(mode==='left')assert.equal(rail.x,area.x);
        if(mode==='right')assert.equal(rail.x+rail.width,area.x+area.width);
        if(mode==='top')assert.equal(rail.y,area.y);
        if(mode==='bottom')assert.equal(rail.y+rail.height,area.y+area.height);
        assert.equal(['top','bottom'].includes(mode)?hidden.height:hidden.width,6);
        assert.ok(hidden.x>=area.x&&hidden.y>=area.y);
        assert.ok(hidden.x+hidden.width<=area.x+area.width&&hidden.y+hidden.height<=area.y+area.height);
        for(let index=0;index<3;index++) {
            const peek=peekBounds(area,rail,index);
            assert.ok(peek.x>=area.x&&peek.y>=area.y);
            assert.ok(peek.x+peek.width<=area.x+area.width&&peek.y+peek.height<=area.y+area.height);
            assert.ok(peek.pointer>=24);
        }
    }
    const free=sidebarBounds(area,{mode:'free',x:-800,y:300});
    assert.deepEqual(collapsedBounds(free),free);
    for(const mode of ['left','right','top','bottom']) {
        const rail=sidebarBounds({x:0,y:0,width:180,height:160},{mode});
        const peek=peekBounds({x:0,y:0,width:180,height:160},rail,2);
        assert.ok(peek.x>=0&&peek.y>=0&&peek.x+peek.width<=180&&peek.y+peek.height<=160);
    }
});

test('auto-hide resizes the native hit area, restores the rail, and leaves preferences intact',t=>{
    const f=manager(t,{quotaPanelPlacement:{mode:'right',y:260}}),panel=f.windows[1],event={sender:panel.webContents};
    f.listeners['pet-quota-panel-ready'](event);
    const bounds=panel.getBounds();assert.equal(bounds.x+bounds.width,1440);
    f.listeners['pet-quota-panel-collapse']({sender:{}},true);assert.deepEqual(panel.getBounds(),bounds);
    f.listeners['pet-quota-panel-collapse'](event,true);
    assert.equal(panel.bounds.width,6);assert.equal(panel.bounds.x+panel.bounds.width,1440);
    assert.equal(panel.webContents.sent.filter(m=>m.name==='pet-quota-panel-config').at(-1).data.collapsed,true);
    f.listeners['pet-quota-panel-collapse'](event,false);assert.deepEqual(panel.getBounds(),bounds);
    panel.webContents.emit('context-menu');
    f.menus.at(-1).find(item=>item.label==='贴边时自动收起').click({checked:false});
    f.listeners['pet-quota-panel-collapse'](event,true);assert.deepEqual(panel.getBounds(),bounds);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8')).quotaPanelAutoHide,false);
    const free=manager(t,{quotaPanelPlacement:{mode:'free',x:300,y:200}}),floating=free.windows[1];
    const before=floating.getBounds();free.listeners['pet-quota-panel-collapse']({sender:floating.webContents},true);
    assert.deepEqual(floating.getBounds(),before,'floating rails never hide themselves');
});

test('provider hover opens a separate nonactivating peek without resizing or moving the rail',async t=>{
    const f=manager(t),panel=f.windows[1],event={sender:panel.webContents};
    f.listeners['pet-quota-panel-ready'](event);await new Promise(resolve=>setImmediate(resolve));
    const before=panel.getBounds();
    f.listeners['pet-quota-panel-peek']({sender:{}},'codex');assert.equal(f.windows.length,2);
    f.listeners['pet-quota-panel-peek'](event,'unknown');assert.equal(f.windows.length,2);
    f.listeners['pet-quota-panel-peek'](event,'codex');const peek=f.windows[2];assert.ok(peek);
    assert.equal(peek.options.focusable,false);assert.equal(peek.options.parent,undefined);
    f.listeners['pet-quota-peek-ready']({sender:peek.webContents});assert.equal(peek.visible,true);
    assert.deepEqual(panel.getBounds(),before);
    assert.equal(peek.webContents.sent.find(m=>m.name==='pet-quota-peek-config').data.provider,'codex');
    assert.ok(peek.webContents.sent.some(m=>m.name==='pet-quota-update'));
    f.listeners['pet-quota-panel-peek'](event,'claudecode');assert.equal(f.windows.length,3);
    assert.equal(peek.webContents.sent.filter(m=>m.name==='pet-quota-peek-config').at(-1).data.provider,'claudecode');
    f.listeners['pet-quota-panel-collapse'](event,true);assert.equal(peek.visible,false);
    f.listeners['pet-quota-panel-collapse'](event,false);
    f.listeners['pet-open-quota-trends']({sender:peek.webContents},{provider:'codex',groupId:'codex',windowId:'weekly'});
    assert.ok(f.windows.some(w=>w.file.endsWith('quota-trends.html')));
    f.api.setQuotaPanelEnabled(false);assert.equal(peek.visible,false);
});

test('Windows uses physical screen edges while macOS respects only its native menu-bar floor',t=>{
    for(const platform of ['win32','darwin']) {
        const f=manager(t,undefined,platform),panel=f.windows[1];
        f.layout.workArea={x:40,y:28,width:1400,height:832};
        panel.webContents.emit('context-menu');
        const choose=label=>f.menus.at(-1).find(item=>item.label===label).click();
        choose('停靠屏幕顶部');assert.equal(panel.bounds.y,platform==='darwin'?28:0);
        choose('停靠屏幕底部');assert.equal(panel.bounds.y+panel.bounds.height,900);
        choose('停靠屏幕左侧');assert.equal(panel.bounds.x,0);
        choose('停靠屏幕右侧');assert.equal(panel.bounds.x+panel.bounds.width,1440);
    }
});

test('a slow first peek load cannot reopen a provider after the pointer has left',t=>{
    const f=manager(t),panel=f.windows[1],event={sender:panel.webContents};
    f.listeners['pet-quota-panel-ready'](event);
    f.listeners['pet-quota-panel-peek'](event,'codex');const peek=f.windows[2];
    f.listeners['pet-quota-panel-peek'](event,null);
    f.listeners['pet-quota-peek-ready']({sender:peek.webContents});
    assert.equal(peek.visible,false);
    f.listeners['pet-quota-panel-peek'](event,'codex');assert.equal(peek.visible,true,'returning hover uses the ready window');
});
