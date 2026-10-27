const test=require('node:test'),assert=require('node:assert/strict');
const {connectionHealth}=require('../backend/models/channels/connection-health');
test('connection health distinguishes failures, degraded usable connections and recovered historical errors',()=>{
 const now=Date.UTC(2026,9,27,8),ready={connected:true,runtime:{state:'ready'}};
 assert.deepEqual(connectionHealth(ready,now),{level:'ok',reason:'connected'});
 assert.equal(connectionHealth({connected:false,runtime:{state:'failed'}},now).level,'error');
 assert.deepEqual(connectionHealth({connected:false,runtime:{state:'connecting'}},now),{level:'warning',reason:'connecting'});
 assert.deepEqual(connectionHealth({...ready,stale:true},now),{level:'warning',reason:'stale'});
 assert.deepEqual(connectionHealth({...ready,lastPollAt:new Date(now-181000).toISOString()},now),{level:'warning',reason:'delayed'});
 const lastError={at:new Date(now-10000).toISOString(),message:'token=never-send-this'};
 assert.deepEqual(connectionHealth({...ready,lastError},now),{level:'warning',reason:'degraded'});
 assert.deepEqual(connectionHealth({...ready,lastError,lastPollAt:new Date(now-5000).toISOString()},now),{level:'ok',reason:'connected'});
 assert.equal(connectionHealth({...ready,lastError:{at:new Date(now-600000).toISOString()}},now).level,'ok');
 assert.equal(JSON.stringify(connectionHealth({...ready,lastError},now)).includes('never-send'),false);
});
