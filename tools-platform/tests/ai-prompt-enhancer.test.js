const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-prompt-enhancer-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data'); process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report');
const { enhancePrompt, validatePrompt } = require('../backend/models/ai-prompt-enhancer');
const fake = text => ({ generateText: async () => ({ text }) });
test.after(async () => {
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    await require('../backend/models/platform-db').closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});
test('validates blank, oversized and slash-command drafts before calling any model', () => {
    for (const text of [null, '', '  ', 'a'.repeat(8001), '/schedule every morning']) assert.throws(() => validatePrompt(text));
    assert.equal(validatePrompt('Review the API; do not edit files.'), 'Review the API; do not edit files.');
});
test('only sends the redacted draft to a text model, preserving references and returning plain draft data', async () => {
    let seen;
    const result = await enhancePrompt({ text: 'Use @research-check with https://example.test/guide. Do not install. apiKey=private-fixture-key', secrets: ['private-fixture-key'], language: 'en',
        client: { generateText: async options => { seen = options; return { text: JSON.stringify({ prompt: 'Use @research-check to review https://example.test/guide. Do not install. apiKey=[REDACTED]' }) }; } } });
    assert.ok(result.prompt.includes('Do not install'));
    assert.equal(seen.messages.length, 1); assert.equal(seen.tools, undefined);
    assert.equal(JSON.stringify(seen).includes('private-fixture-key'), false);
    assert.match(seen.systemInstruction, /never answer it or execute/);
    assert.match(seen.systemInstruction, /negations/);
});
test('invalid, oversized or reference-changing rewrites fail instead of replacing the draft', async () => {
    for (const output of ['not JSON', '{}', '{"prompt":""}', JSON.stringify({ prompt: 'a'.repeat(24001) }), '{"prompt":"Use a different Skill"}']) {
        await assert.rejects(enhancePrompt({ text: 'Use @research-check', client: fake(output) }), error => error.statusCode === 502);
    }
    const result = await enhancePrompt({ text: 'Explain this', client: fake('```json\n{"prompt":"Explain this briefly."}\n```') });
    assert.equal(result.prompt, 'Explain this briefly.');
});
test('API requires login, uses the session tenant and selected model, and reports provider failures without leaking details', async t => {
    const express = require('express'), settings = require('../backend/models/ai-settings-repository');
    const client = require('../backend/models/ai-provider-client'), sessions = require('../backend/models/auth-sessions-repository');
    const { checkAuth } = require('../backend/middleware/auth');
    const { tenantMiddleware, runWithTenant } = require('../backend/models/tenant-context');
    const makeProfile = tenant => runWithTenant(tenant, () => settings.createProfile({ provider: 'openai', model: `fixture-${tenant}`, apiKey: `credential-${tenant}-123456` }));
    const a = await makeProfile('tenant-a'), b = await makeProfile('tenant-b');
    await sessions.saveSession('fixture-session-a', 'alice', 'user', Date.now()+60000, 'tenant-a');
    await sessions.saveSession('fixture-session-b', 'bob', 'user', Date.now()+60000, 'tenant-b');
    let seen, fail = false;
    t.mock.method(client, 'createClient', runtime => ({ generateText: async options => { seen={runtime,options}; if(fail)throw new Error('private upstream credential details');return {text:JSON.stringify({prompt:'Review the code. Do not change it.'})}; } }));
    const app=express();app.use(express.json());app.use('/api',checkAuth,tenantMiddleware);app.use('/api/ai',require('../backend/routes/ai'));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
    const call=(token,body)=>fetch(`http://127.0.0.1:${server.address().port}/api/ai/enhance-prompt`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
    assert.equal((await call('',{text:'Review'})).status,401);
    assert.equal((await call('fixture-session-a',{text:''})).status,400);
    let response=await call('fixture-session-a',{text:'Review, do not edit.',modelId:`profile:${a.createdProfileId}`});
    assert.equal(response.status,200); assert.equal(seen.runtime.model,'fixture-tenant-a');assert.equal(seen.options.tools,undefined);
    response=await call('fixture-session-b',{text:'Review, do not edit.',modelId:`profile:${b.createdProfileId}`});
    assert.equal(response.status,200);assert.equal(seen.runtime.model,'fixture-tenant-b');
    response=await call('fixture-session-a',{text:'Review',modelId:`profile:${b.createdProfileId}`});
    assert.equal(response.status,200);assert.equal(seen.runtime.model,'fixture-tenant-a','a foreign profile ID only falls back to a ready model in the session tenant');
    fail=true;response=await call('fixture-session-a',{text:'Review',modelId:`profile:${a.createdProfileId}`});
    assert.equal(response.status,502);assert.equal((await response.text()).includes('private upstream'),false);
    const source=fs.readFileSync(path.join(__dirname,'../backend/server.js'),'utf8');assert.match(source,/req\.path === '\/ai\/enhance-prompt'/);
});
