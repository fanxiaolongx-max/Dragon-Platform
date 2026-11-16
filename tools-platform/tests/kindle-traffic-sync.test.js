'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sample } = require('../backend/scripts/kindle-traffic-sync');
test('exports only verified PM2 HTTP rates and flags spikes after warmup', () => {
    const history = new Map();
    const item = rate => ({name:'service',pm_id:1,pid:123,pm2_env:{status:'online',secret:'not-exported',axm_monitor:{HTTP:{value:rate,unit:'req/min'},'HTTP P95 Latency':{value:9,unit:'ms'}}},monit:{cpu:1,memory:50}});
    for (let i=0;i<5;i++) assert.equal(sample([item(1)],history).services[0].anomaly,null);
    const result = sample([item(15),{name:'unsupported',pm_id:2,pm2_env:{status:'online',axm_monitor:{}}}],history);
    assert.equal(result.services[0].anomaly,true);
    assert.equal(result.services[0].latencyP95Ms,9);
    assert.equal(result.services[1].requestsPerMinute,null);
    assert.doesNotMatch(JSON.stringify(result),/not-exported/);
    const stopped = item(50); stopped.pm2_env.status='stopped';
    assert.equal(sample([stopped],history).services[0].requestsPerMinute,null);
    assert.equal(sample([item(1)],history).services[0].anomaly,null);
});
