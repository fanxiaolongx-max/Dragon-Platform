const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const artwork=require('../desktop-pet/dragon-artwork');
const presence=require('../desktop-pet/dragon-presence');

test('transparent frames ignore isolated specks and share a foot anchor without clipping',()=>{
 const width=20,height=30,pixels=new Uint8ClampedArray(width*height*4);
 const paint=(x,y)=>pixels[(y*width+x)*4+3]=255;
 for(let y=5;y<25;y++)for(let x=6;x<14;x++)paint(x,y);
 paint(0,0);paint(19,29);
 for(let y=5;y<9;y++)for(let x=0;x<4;x++)paint(x,y); // Separate neighbouring hand.
 assert.deepEqual(artwork.bounds(pixels,width,height),{x:6,y:5,width:8,height:20});
 assert.equal(artwork.bounds(new Uint8ClampedArray(pixels.length),width,height),null);
 for(const box of [{width:230,height:380},{width:700,height:1220},{width:410,height:680}]){
  const p=artwork.layout(box);assert.equal(p.y+box.height*p.scale,680);
  assert.ok(p.x>=20);assert.ok(p.y>=80);
  assert.equal(p.x*2+box.width*p.scale,400);
 }
});

test('observation retraces its outward frames rather than jumping back across head poses',()=>{
 for(const kind of ['left','right']){
  const order=artwork.order(kind),middle=order.length/2;
  assert.deepEqual(order.slice(0,middle),order.slice(middle).reverse());
  for(let i=1;i<order.length;i++)assert.ok(Math.abs(order[i]-order[i-1])<=1);
 }
});

test('registered native left poses retain their direction and front portraits retain calibrated eyes',()=>{
 const left={side:true,nativeFacing:'left',closed:true,eyes:[]};
 presence.registerProfile('data:image/png;base64,left',left);
 assert.equal(presence.profileFor('data:image/png;base64,left'),left);
 const front={side:false,closed:false,eyes:[[.4,.2,.05,.03]]};
 presence.registerProfile('data:image/png;base64,front',front);
 assert.equal(presence.profileFor('data:image/png;base64,front'),front);
});

async function fixture(){
 const timers=new Map(),intervals=[],listeners={},writes=[];
 let id=0,busy=false,activity='idle',now=0,source='original';const reduced={matches:false,addEventListener(_event,fn){this.change=fn;}};
 const ui={img:{dataset:{},classList:{remove(){},add(){}},getAttribute:()=>source},activity:()=>activity,busy:()=>busy,images:{think:'think',wave:'wave'},bubblesOn:()=>false,clearStory(){},setSprite(src){source=src;writes.push(src);}};
 const window={matchMedia:()=>reduced,addEventListener(name,fn){listeners[name]=fn;},PetI18n:{getLanguage:()=> 'zh-CN'},DragonArtwork:{order:artwork.order,load:async()=>({front:['new-front'],left:Array.from({length:8},(_,i)=>'left-'+i),right:Array.from({length:8},(_,i)=>'right-'+i),blink:['b0','b1','b2','b3','b4','b5'],wave:Array.from({length:8},(_,i)=>'wave-'+i),walk:Array.from({length:8},(_,i)=>'walk-'+i),states:Array.from({length:8},(_,i)=>'state-'+i)})}};
 const document={hidden:false,addEventListener(name,fn){listeners[name]=fn;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../desktop-pet/dragon-life'),'utf8'),{window,document,Math,Date:{now:()=>now},setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(key){timers.delete(key);},setInterval(fn){intervals.push(fn);return intervals.length;},clearInterval(){}});
 const life=window.DragonLife.create(ui);await Promise.resolve();await Promise.resolve();
 const step=()=>{const item=timers.entries().next().value;if(item){timers.delete(item[0]);item[1]();}};
 return {life,writes,timers,reduced,document,listeners,intervals,step,setBusy(value){busy=value;},setActivity(value){activity=value;},advance(ms){now+=ms;intervals[1]();},source:()=>source};
}

test('a complete head turn restores the new idle source; cancellation prevents delayed overwrite',async()=>{
 const f=await fixture();assert.equal(f.life.frontSprite(),'new-front');
 f.life.motion(true,'left');for(let i=0;i<12;i++)f.step();assert.equal(f.source(),'original');
 f.life.motion(true,'right');f.step();f.life.stop(false);
 assert.equal(f.timers.size,0);const src=f.source();f.step();assert.equal(f.source(),src);
});

test('busy interaction, hidden windows and reduced motion stop an active observation',async()=>{
 const f=await fixture();f.life.motion(true,'left');f.setBusy(true);f.intervals[0]();
 assert.equal(f.source(),'original');assert.equal(f.timers.size,0);
 f.setBusy(false);f.life.motion(true,'right');f.document.hidden=true;f.listeners.visibilitychange();assert.equal(f.source(),'original');
 f.document.hidden=false;f.life.motion(true,'left');f.reduced.matches=true;f.reduced.change();assert.equal(f.source(),'original');
 const count=f.writes.length;f.life.motion(true,'right');assert.equal(f.writes.length,count);
});

test('disabling random actions cancels playback but permits explicit actions when motion is allowed',async()=>{
 const f=await fixture();f.life.motion(true,'left');f.life.apply({randomMotionOn:false});assert.equal(f.timers.size,0);
 f.life.motion(false,'right');assert.equal(f.timers.size,0);
 f.life.motion(true,'right');assert.ok(f.timers.size>0);
});

test('interactive frames cancel idle playback, alternate while dragged and restore idle without stale writes',async()=>{
 const f=await fixture();f.life.motion(true,'wave');assert.equal(f.source(),'wave-0');
 f.setActivity('dragged');f.advance(100);assert.equal(f.source(),'state-2');assert.equal(f.timers.size,0);
 f.advance(600);assert.equal(f.source(),'state-3');f.step();assert.equal(f.source(),'state-3');
 f.document.hidden=true;f.advance(600);assert.equal(f.source(),'state-3');
 f.document.hidden=false;f.setActivity('idle');f.advance(100);f.setActivity('think');f.advance(100);assert.equal(f.source(),'state-0');
 f.setActivity('idle');f.advance(100);assert.equal(f.source(),'new-front');
});
