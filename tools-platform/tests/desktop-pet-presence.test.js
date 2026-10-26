const test = require('node:test');
const assert = require('node:assert/strict');
const presence = require('../desktop-pet/dragon-presence');

test('side-facing pet looks toward the middle of its own monitor, including negative origins', () => {
    const primary = { x:0, width:1440 };
    assert.equal(presence.facing(250,primary), 'right');
    assert.equal(presence.facing(1200,primary), 'left');
    const leftMonitor = { x:-1920, width:1920 };
    assert.equal(presence.facing(-1700,leftMonitor), 'right');
    assert.equal(presence.facing(-200,leftMonitor), 'left');
    const rightMonitor = { x:1440, width:2560 };
    assert.equal(presence.facing(3500,rightMonitor), 'left');
});

test('center dead band prevents repeated turning near the middle and invalid geometry preserves facing', () => {
    const area = { x:0, width:1440 };
    for (const x of [690,710,725,740,750]) assert.equal(presence.facing(x,area,'left'),'left');
    assert.equal(presence.facing(400,area,'left'),'right');
    assert.equal(presence.facing(850,area,'right'),'left');
    assert.equal(presence.facing(NaN,area,'left'),'left');
    assert.equal(presence.facing(850,null,'right'),'right');
});

test('front-facing artwork is never classified for mirroring and closed frames suppress gaze', () => {
    for (const name of ['idle','walk','think']) assert.equal(presence.profileFor(`./assets/dragon/${name}.png`).side,true);
    assert.equal(presence.profileFor('./assets/dragon/dragon-character.png').side,false);
    for (const frame of [0,1,4,5]) {
        const profile = presence.profileFor('data:image/png;base64,test',frame);
        assert.equal(profile.side,false); assert.equal(profile.closed,false);
    }
    for (const frame of [2,3]) assert.equal(presence.profileFor('data:image/png;base64,test',frame).closed,true);
    assert.equal(presence.profileFor('unknown').closed,true);
});

test('nearby gaze is bounded, compensates for mirrored artwork, and distant cursor returns to eye contact', () => {
    const center = { x:1000, y:600 }, cursor = { x:1150, y:650 };
    const right = presence.gazeTarget(cursor,center,false);
    const left = presence.gazeTarget(cursor,center,true);
    assert.equal(right.x,-left.x); assert.equal(right.y,left.y);
    assert.ok(Math.abs(right.x)<=.32 && Math.abs(right.y)<=.16);
    assert.deepEqual(presence.gazeTarget({x:1,y:1},center,false),{x:0,y:0});
    assert.deepEqual(presence.gazeTarget(null,center,false),{x:0,y:0});
});

test('gaze eases without overshoot, converges smoothly and clamps resume-time jumps', () => {
    let current = 0;
    for (let i=0;i<100;i++) {
        const next=presence.ease(current,.3,16);
        assert.ok(next>=current && next<=.3); current=next;
    }
    assert.ok(Math.abs(current-.3)<.002);
    assert.equal(presence.ease(.2,0,0),.2);
    assert.equal(presence.ease(0,.3,10000),presence.ease(0,.3,100));
    const returning=presence.ease(.3,0,16);
    assert.ok(returning>0 && returning<.3);
});
