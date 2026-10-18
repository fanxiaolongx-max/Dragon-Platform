const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/pages/desktop-license-admin.html'), 'utf8');
const route = fs.readFileSync(path.join(root, 'backend/routes/desktop-license-admin.js'), 'utf8');

test('Desktop License admin hides archived records by default and fetches them on demand', () => {
    assert.match(html, /id="showArchived" type="checkbox">/);
    assert.doesNotMatch(html, /id="showArchived"[^>]*checked/);
    assert.match(html, /includeArchived=\$\{\$\('showArchived'\)\.checked\?'1':'0'\}/);
    assert.match(html, /\$\('showArchived'\)\.onchange=\(\)=>load\(true\)/);
    assert.match(route, /req\.query\.includeArchived === '1'/);
});

test('Desktop License admin paginates and visually de-emphasizes archived cards', () => {
    assert.match(html, /id="pageSize"/);
    assert.match(html, /id="prevPage"/);
    assert.match(html, /id="nextPage"/);
    assert.match(html, /filtered\.slice\(start,start\+pageSize\)/);
    assert.match(html, /\.card\.is-archived\{opacity:\.5/);
    assert.match(html, /classList\.toggle\('is-archived'/);
});

test('Desktop License admin inline script remains valid JavaScript', () => {
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'inline script should exist');
    assert.doesNotThrow(() => new Function(script));
});

test('license highlights follow effective validity, seven-day boundary, revocation and machine binding', () => {
    const elements=new Map();
    const element=id=>{
        if(!elements.has(id))elements.set(id,{value:id==='pageSize'?'10':'',checked:false,
            classList:{toggle(){},contains(){return false;}},querySelectorAll(){return [];},addEventListener(){}});
        return elements.get(id);
    };
    const context={document:{title:'Desktop License',getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},
        localStorage:{getItem:()=>''},fetch:async()=>({ok:true,json:async()=>({licenses:[],requests:[]})}),setInterval(){},setTimeout(){},clearTimeout(){}};
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
    const now=Date.UTC(2026,9,18),day=86400000;
    const row={status:'active',machine:{machineId:'a'.repeat(32)},notBefore:now-day,expiresAt:now+8*day};
    const state=(patch={})=>context.licensePresentation({...row,...patch},now);
    assert.equal(state().status,'active');
    assert.equal(state({expiresAt:now+7*day+1}).status,'active');
    assert.equal(state({expiresAt:now+7*day}).status,'expiring');
    assert.equal(state({expiresAt:now+7*day}).remaining,'剩余 7 天');
    assert.equal(state({expiresAt:now+30*60000}).remaining,'不足 1 小时');
    assert.equal(state({expiresAt:now}).status,'expired');
    assert.equal(state({status:'revoked',expiresAt:now+day}).status,'revoked');
    assert.equal(state({status:'archived'}).status,'archived');
    assert.equal(state({machine:null}).status,'unbound');
    assert.equal(state({notBefore:now+day}).status,'scheduled');
    for(const expiresAt of [undefined,null,'bad',0])assert.equal(state({expiresAt}).status,'unknown');
    assert.equal(state({status:'revoked'}).remaining,'');
    assert.equal(state({status:'archived'}).remaining,'');
});
