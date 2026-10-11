const test=require('node:test'),assert=require('node:assert/strict'),L=require('../frontend/js/monthly-designer/catalog-loader');
const part=(id,kind='original')=>({files:[{id,kind}],snapshots:[],batches:[],diagnostics:{stages:[],errors:[]}});
test('directories publish ready groups before a slow group and retain only the failed group previous data',async()=>{
 let release;const events=[],progress=[];const previous=L.combine([part('old-core'),part('old-meeting','meeting_attendance')]);
 const result=L.load({request:async url=>{if(url.includes('stage=core'))return part('new-core');if(url.includes('stage=topic'))throw Error('unavailable');return new Promise(resolve=>release=()=>resolve(part('new-meeting','meeting_attendance')));},previous,onProgress:value=>progress.push(value.files.map(file=>file.id)),onEvent:event=>events.push(event)});
 await new Promise(resolve=>setImmediate(resolve));assert.ok(progress.some(ids=>ids.includes('new-core')));assert.ok(!progress.some(ids=>ids.includes('new-meeting')));release();const data=await result;assert.deepEqual(data.failedGroups,['topic']);assert.deepEqual(data.files.map(file=>file.id).sort(),['new-core','new-meeting']);assert.ok(events.some(event=>event.state==='error'));
});
test('retrying one source preserves other groups without rereading them and meeting history is explicit',async()=>{
 const urls=[],previous=L.combine([part('core'),part('topic','topic_monthly'),part('meeting','meeting_attendance')]);
 const data=await L.load({request:async url=>{urls.push(url);return part('latest','meeting_attendance');},previous,retryGroups:['meeting']});assert.equal(urls.length,1);assert.match(urls[0],/meetingHistory=0/);assert.deepEqual(data.files.map(file=>file.id).sort(),['core','latest','topic']);
 await L.load({request:async url=>{assert.match(url,/meetingHistory=1/);return part('history','meeting_attendance');},history:true,retryGroups:['meeting']});
});
test('all failed directories reject, malformed responses are isolated, cancellation is propagated',async()=>{
 await assert.rejects(L.load({request:async()=>{throw Error('offline');}}),/All source directories failed/);
 const data=await L.load({request:async url=>url.includes('stage=core')?part('ok'):({files:[]})});assert.deepEqual(data.failedGroups.sort(),['meeting','topic']);assert.equal(data.files.length,1);
 const controller=new AbortController();controller.abort();await assert.rejects(L.load({signal:controller.signal,request:async()=>part('ok')}),error=>error.name==='AbortError');
});
