const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
    const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/ai-report/image-library.js'),'utf8'),{window,Date,Map,WeakMap,Number,Math,Error,Promise});
    const record={chat:[]},calls=[],items=Array.from({length:19},(_,i)=>({id:'image-'+i,url:'/api/ai-report/images/image-'+i,name:'image '+i}));
    let hidden=new Set();
    const api={async get(url){calls.push({method:'GET',url});const page=Number(new URL(url,'http://fixture').searchParams.get('page'))||1;
        const visible=items.filter(i=>!hidden.has(i.id)),totalPages=Math.max(1,Math.ceil(visible.length/8)),current=Math.min(page,totalPages);
        return {items:visible.slice((current-1)*8,current*8),total:visible.length,page:current,pageSize:8,totalPages};},
        async post(url,body){calls.push({method:'POST',url,body});
            if(url==='/api/ai-report/image-deletions')return {type:'delete_confirmation',proposalId:'proposal',expiresAt:'2099-01-01T00:00:00.000Z',images:items.filter(i=>body.ids.includes(i.id))};
            if(url.endsWith('/confirm')){hidden.add('image-0');return {status:'confirmed',images:[items[0]]};}
            if(url.endsWith('/restore')){hidden.clear();return {status:'restored',images:[items[0]]};}
            return {status:'cancelled',images:[items[0]]};}};
    const controller=window.AiReportImageLibrary.create({API:api,t:(zh,en)=>en,find:()=>({cell:record,busy:false}),render(){},aiStep:(id,label,fn)=>fn(record)});
    return {controller,record,calls,items};
}
test('pagination loads eight images and sends the actual visible IDs in the AI context',async()=>{
    const {controller,record,calls}=setup();await controller.show('logo',record);
    assert.equal(record.chat[0].images.length,8);assert.equal(record.chat[0].gallery.totalPages,3);
    await controller.page('logo',0,2);
    assert.equal(record.chat[0].images[0].id,'image-8');assert.equal(controller.context('logo').gallery.page,2);
    assert.equal(controller.context('logo').gallery.ids.length,8);
    assert.ok(calls.every(call=>call.method==='GET'),'page buttons do not use AI or change selection');
    await controller.reply('logo',record,{type:'history_page',direction:'next'});
    assert.equal(record.chat[0].gallery.page,3);assert.equal(record.chat[0].images.length,3);
});
test('thumbnail delete only stages a review; confirming and undoing use separate APIs',async()=>{
    const {controller,record,calls}=setup();await controller.show('logo',record);
    await controller.remove('logo',0,'image-0');
    const index=record.chat.findIndex(item=>item.kind==='image_delete');
    assert.equal(record.chat[index].proposal.status,'pending');
    assert.equal(calls.some(call=>call.url.endsWith('/confirm')),false);
    assert.equal(controller.context('logo').pendingProposalId,'proposal');
    await controller.decide('logo',index,'confirm');
    assert.equal(record.chat[index].proposal.status,'confirmed');
    assert.equal(record.chat[0].gallery.total,18);assert.equal(record.chat[0].images.some(i=>i.id==='image-0'),false);
    assert.equal(calls.find(call=>call.url.endsWith('/confirm')).body.confirmed,true);
    await controller.decide('logo',index,'restore');
    assert.equal(record.chat[0].gallery.total,19);assert.equal(record.chat[index].proposal.status,'restored');
});
test('deletion reviews can be paged without changing the reviewed image set',async()=>{
    const {controller,record,items}=setup();
    await controller.reply('logo',record,{type:'delete_confirmation',images:items,proposalId:'p',expiresAt:'2099-01-01T00:00:00.000Z'});
    await controller.page('logo',0,2);
    assert.equal(record.chat[0].reviewPage,2);assert.equal(record.chat[0].images.length,19);
});
