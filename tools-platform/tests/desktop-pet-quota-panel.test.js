const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const {sidebarBounds,droppedSidebar,collapsedBounds,peekBounds,NOTCH_GLOW}=require('../desktop-pet/quota-panel-layout');

test('compact bar defaults to the top and clamps saved positions on negative-origin and small displays',()=>{
    for(const area of [{x:0,y:0,width:1440,height:900},{x:-1920,y:-100,width:1920,height:1080},{x:0,y:0,width:240,height:200}]){
        const b=sidebarBounds(area);assert.equal(b.mode,'top');assert.equal(b.y,area.y);assert.equal(b.orientation,'horizontal');
        assert.ok(b.x>=area.x&&b.x+b.width<=area.x+area.width);assert.equal(b.height,42,'default 32px bar + 10px halo margin');
        assert.ok(b.y>=area.y&&b.y+b.height<=area.y+area.height);
        const moved=sidebarBounds(area,{mode:'free',x:-99999,y:99999});assert.ok(moved.x>=area.x);assert.ok(moved.y+moved.height<=area.y+area.height);
    }
});
test('every placement is the top notch; only x is kept and detail panels stay on the top edge',()=>{
    const area={x:-1440,y:-100,width:1440,height:900};
    for(const point of [{x:-800,y:-90},{x:-800,y:740},{x:-1430,y:180},{x:-430,y:180}]){
        const result=droppedSidebar({...point,width:404,height:42},area);
        assert.equal(result.mode,'top');assert.equal(result.orientation,'horizontal');
        assert.equal(result.width,404);assert.equal(result.y,area.y);
        assert.ok(result.x>=area.x&&result.x+result.width<=area.x+area.width);
    }
    assert.equal(droppedSidebar({x:-800,y:500,width:404,height:42},area).x,-800);
    const detail=sidebarBounds(area,{mode:'right',y:180},true);
    assert.equal(detail.width,330);assert.equal(detail.height,436);assert.equal(detail.y,area.y);assert.equal(detail.mode,'top');
    assert.equal(sidebarBounds(area,{mode:'left',x:-286,y:180}).mode,'top','old side-edge preferences become the top notch');
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
        setAlwaysOnTop(){}setIgnoreMouseEvents(value,options){this.ignoresMouse=value;this.ignoreOptions=options;}focus(){this.focused=true;}
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
    assert.equal(panel.options.focusable,false);assert.equal(panel.ignoresMouse,true,'halo margin is click-through until the pointer is on the notch');assert.equal(panel.visible,false);
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
    f.listeners['pet-quota-panel-hit']({sender:{}},true);assert.equal(panel.ignoresMouse,true,'foreign senders cannot capture the mouse');
    f.listeners['pet-quota-panel-hit']({sender:panel.webContents},true);assert.equal(panel.ignoresMouse,false);assert.equal(JSON.stringify(panel.ignoreOptions),'{"forward":true}');
    f.listeners['pet-quota-panel-hit']({sender:panel.webContents},false);assert.equal(panel.ignoresMouse,true);assert.equal(JSON.stringify(panel.ignoreOptions),'{"forward":true}');
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

test('drag IPC slides horizontally along the top edge, persists placement and rejects other windows',t=>{
    const f=manager(t),pet=f.windows[0];pet.ready();const panel=f.windows[1];f.listeners['pet-quota-panel-ready']({sender:panel.webContents});
    const before=panel.getBounds(),event={sender:panel.webContents};
    f.listeners['pet-quota-panel-drag']({sender:pet.webContents},'start');f.cursor.x=500;f.listeners['pet-quota-panel-drag'](event,'move');assert.deepEqual(panel.getBounds(),before);
    f.listeners['pet-quota-panel-drag'](event,'start');f.cursor.x=100;f.cursor.y=200;f.listeners['pet-quota-panel-drag'](event,'move');
    assert.equal(panel.bounds.x,before.x-400);assert.equal(panel.bounds.y,0,'vertical drag is ignored');
    pet.setPosition(0,0);assert.equal(panel.bounds.x,before.x-400,'pet ticks cannot reset a drag');
    f.listeners['pet-quota-panel-drag'](event,'end');const saved=JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8')).quotaPanelPlacement;
    assert.equal(saved.mode,'top');assert.equal(saved.x,before.x-400);assert.equal(saved.y,0);
    f.listeners['pet-quota-panel-drag'](event,'start');f.cursor.x=-99999;f.listeners['pet-quota-panel-drag'](event,'end');assert.equal(panel.bounds.x,0,'clamped to the screen');
    const restored=manager(t,{quotaPanelPlacement:saved});assert.equal(restored.windows[1].bounds.x,saved.x);assert.equal(restored.windows[1].bounds.y,0);
    f.listeners['pet-quota-panel-dock']({sender:{}});assert.equal(panel.bounds.x,0);
    f.listeners['pet-quota-panel-dock']({sender:pet.webContents});assert.equal(panel.bounds.x,Math.round((1440-404)/2));
});

test('menu offers no side docks, changes detail size, persists preferences and restores compact mode',t=>{
    const f=manager(t,{enabled:false,quotaStandalone:true}),panel=f.windows[0],event={sender:panel.webContents};
    f.listeners['pet-quota-panel-ready'](event);
    assert.equal(panel.bounds.width,404);assert.equal(panel.bounds.height,42);assert.equal(panel.bounds.y,0);
    assert.equal(panel.options.enableLargerThanScreen,true);
    f.listeners['pet-quota-panel-menu'](event);
    const labels=f.menus.at(-1).map(item=>item.label);
    for(const label of ['停靠屏幕左侧','停靠屏幕右侧','停靠屏幕底部'])assert.ok(!labels.includes(label));
    const choose=label=>f.menus.at(-1).find(item=>item.label===label).click();
    choose('详细额度面板');assert.equal(panel.bounds.width,330);assert.equal(panel.bounds.height,436);assert.equal(panel.bounds.y,0);
    const saved=JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8'));
    assert.equal(saved.quotaPanelExpanded,true);
    const restored=manager(t,saved);assert.equal(restored.windows[0].bounds.width,330);
    choose('精简额度栏');assert.equal(panel.bounds.width,404);
    choose('居中到屏幕顶部');assert.equal(panel.bounds.y,0);assert.equal(panel.bounds.x,Math.round((1440-404)/2));
});

test('sidebar right-click menu can hide only the sidebar and stale placements are restored onto the top edge',t=>{
    const f=manager(t,{quotaPanelPlacement:{mode:'free',x:99999,y:99999}}),pet=f.windows[0];pet.ready();const panel=f.windows[1];f.listeners['pet-quota-panel-ready']({sender:panel.webContents});
    assert.equal(panel.bounds.x+panel.bounds.width,1440);assert.equal(panel.bounds.y,0);
    f.listeners['pet-quota-panel-menu']({sender:{}});assert.equal(f.menus.length,0);
    panel.webContents.emit('context-menu');assert.equal(f.menus.length,1);
    f.menus[0].find(item=>item.label==='隐藏额度侧栏').click();assert.equal(panel.visible,false);assert.equal(pet.visible,true);
    f.api.setQuotaPanelEnabled(true);assert.equal(panel.visible,true);assert.equal(panel.bounds.y,0);
});

test('the notch touches the top edge and its collapsed native window occupies only six pixels',()=>{
    const area={x:-1728,y:24,width:1728,height:1093};
    for(const x of [-99999,-900,99999]) {
        const rail=sidebarBounds(area,{x}),hidden=collapsedBounds(rail);
        assert.equal(rail.y,area.y);assert.equal(hidden.height,6);assert.equal(hidden.y,area.y);
        assert.ok(hidden.x>=area.x&&hidden.x+hidden.width<=area.x+area.width);
        for(let index=0;index<3;index++) {
            const peek=peekBounds(area,rail,index);
            assert.equal(peek.side,'top');assert.ok(peek.y>=rail.y+rail.height-NOTCH_GLOW,'below the notch (the halo margin may overlap)');
            assert.ok(peek.x>=area.x&&peek.x+peek.width<=area.x+area.width&&peek.y+peek.height<=area.y+area.height);
            assert.ok(peek.pointer>=24);
        }
    }
    const rail=sidebarBounds({x:0,y:0,width:180,height:160});
    const peek=peekBounds({x:0,y:0,width:180,height:160},rail,2);
    assert.ok(peek.x>=0&&peek.y>=0&&peek.x+peek.width<=180&&peek.y+peek.height<=160);
});

test('auto-hide resizes the native hit area, restores the rail, and leaves preferences intact',t=>{
    const f=manager(t,{quotaPanelPlacement:{mode:'right',y:260}}),panel=f.windows[1],event={sender:panel.webContents};
    f.listeners['pet-quota-panel-ready'](event);
    const bounds=panel.getBounds();assert.equal(bounds.y,0);
    f.listeners['pet-quota-panel-collapse']({sender:{}},true);assert.deepEqual(panel.getBounds(),bounds);
    f.listeners['pet-quota-panel-collapse'](event,true);
    assert.equal(panel.bounds.height,6);assert.equal(panel.bounds.y,0);assert.equal(panel.bounds.width,bounds.width);
    assert.equal(panel.webContents.sent.filter(m=>m.name==='pet-quota-panel-config').at(-1).data.collapsed,true);
    f.listeners['pet-quota-panel-collapse'](event,false);assert.deepEqual(panel.getBounds(),bounds);
    panel.webContents.emit('context-menu');
    f.menus.at(-1).find(item=>item.label==='贴边时自动收起').click({checked:false});
    f.listeners['pet-quota-panel-collapse'](event,true);assert.deepEqual(panel.getBounds(),bounds);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8')).quotaPanelAutoHide,false);
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

test('Windows and macOS both hang the notch from the physical top edge, above the menu bar or taskbar',t=>{
    for(const platform of ['win32','darwin']) {
        const f=manager(t,undefined,platform),panel=f.windows[1];
        f.layout.workArea={x:40,y:28,width:1400,height:832};
        panel.webContents.emit('context-menu');
        f.menus.at(-1).find(item=>item.label==='居中到屏幕顶部').click();
        assert.equal(panel.bounds.y,0);assert.equal(panel.bounds.x,Math.round((1440-404)/2));
        assert.equal(panel.bounds.height,28+10,'the notch is as tall as the 28px top bar, plus the halo margin');
    }
});

test('appearance menu switches the tray and its peek between system, light and dark, and persists',t=>{
    const f=manager(t,{enabled:false,quotaStandalone:true}),panel=f.windows[0],event={sender:panel.webContents};
    f.listeners['pet-quota-panel-ready'](event);
    const lastTheme=()=>panel.webContents.sent.filter(m=>m.name==='pet-quota-panel-config').at(-1).data.theme;
    assert.equal(lastTheme(),'auto');
    f.listeners['pet-quota-panel-menu'](event);
    const appearance=()=>f.menus.at(-1).find(item=>item.label==='外观').submenu;
    assert.equal(JSON.stringify(appearance().map(item=>[item.label,item.type,item.checked])),JSON.stringify([['跟随系统','radio',true],['浅色','radio',false],['深色','radio',false]]));
    appearance()[2].click();
    assert.equal(lastTheme(),'dark');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'desktop-pet-config.json'),'utf8')).quotaPanelTheme,'dark');
    f.listeners['pet-quota-panel-peek'](event,'codex');const peek=f.windows.at(-1);
    f.listeners['pet-quota-peek-ready']({sender:peek.webContents});
    assert.equal(peek.webContents.sent.find(m=>m.name==='pet-quota-peek-config').data.theme,'dark');
    f.listeners['pet-quota-panel-menu'](event);appearance()[1].click();
    assert.equal(lastTheme(),'light');
    assert.equal(peek.webContents.sent.filter(m=>m.name==='pet-quota-peek-theme').at(-1).data,'light');
    const restored=manager(t,{enabled:false,quotaStandalone:true,quotaPanelTheme:'light'}),again=restored.windows[0];
    restored.listeners['pet-quota-panel-ready']({sender:again.webContents});
    assert.equal(again.webContents.sent.filter(m=>m.name==='pet-quota-panel-config').at(-1).data.theme,'light');
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

test('hidden visitor IPC accepts only Dragon clicks and its own readiness, and hides with Dragon',t=>{
    const f=manager(t),pet=f.windows[0];pet.ready();
    const before=f.windows.length;
    f.listeners['pet-taotao-surprise']({sender:{}});
    assert.equal(f.windows.length,before,'other windows cannot summon the hidden visitor');
    f.listeners['pet-taotao-surprise']({sender:pet.webContents});
    const visitor=f.windows.at(-1);
    assert.ok(visitor.file.endsWith('taotao.html'));
    f.listeners['pet-taotao-ready']({sender:pet.webContents});assert.equal(visitor.visible,false);
    f.listeners['pet-taotao-ready']({sender:visitor.webContents});assert.equal(visitor.visible,true);
    assert.equal(visitor.ignoresMouse,true);assert.equal(visitor.focused,undefined);
    assert.equal(pet.webContents.sent.some(m=>m.name==='pet-taotao-greeting'),true);
    f.listeners['pet-taotao-surprise']({sender:pet.webContents});assert.equal(f.windows.length,before+1);
    f.api.hidePetForNow();assert.equal(visitor.destroyed,true);
});
