// Run: node_modules/.bin/electron tests/dragon-claw-skill-save-browser.cjs
// Production chat UI + authenticated Skill routes + temporary SQLite; only model output is scripted.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-skill-save-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // 后端子进程关闭完成后再主动退出
setTimeout(() => { child?.kill(); app.exit(1); }, 60000).unref();
const { fork } = require('node:child_process');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const home = read('frontend/index.html'), start = home.indexOf('<section class="dc"');
const section = home.slice(start, home.indexOf('</section>', start) + 10);
const markdown = '---\nid: meeting-summarizer\nname: 会议纪要助手\nname_en: Meeting Summarizer\ndescription: 提取待办、决策和风险\ndescription_en: Extract actions, decisions and risks\nworkspace: false\n---\n\n# 会议纪要\n\n目标：整理会议记录。\n1. 提取待办、责任人和截止日期。\n2. 总结决策与风险，不虚构缺失信息。';
const draft = '草稿尚未保存，请点击保存为技能。\n\n```markdown\n' + markdown + '\n```';
let win, child, baseUrl, catalogHeld, sequence = 0;
const requests = new Map();
const backend = (action, args) => new Promise((resolve, reject) => {
    const id = ++sequence; requests.set(id, { resolve, reject }); child.send({ id, action, args });
});
const store = { getSkill: id => backend('getSkill', id), loadAll: text => backend('loadAll', text) };
const evaluate = async fn => {
    const result = await win.webContents.executeJavaScript(`Promise.resolve().then(()=>(${fn.toString()})()).catch(error=>({fixtureError:error.stack}))`, true);
    if (result?.fixtureError) throw new Error(result.fixtureError);
    return result;
};
const until = async expression => {
    const result = await win.webContents.executeJavaScript(`new Promise(resolve=>{let n=0;const poll=()=>{if(${expression})resolve(true);else if(++n>200)resolve(false);else setTimeout(poll,20)};poll()})`);
    assert.ok(result, `Timeout: ${expression}`);
};
async function boot(role = 'admin') {
    await win.loadURL(`${baseUrl}/`);
    await win.webContents.executeJavaScript(`
        localStorage.setItem('tools_token',${JSON.stringify(`fixture-${role}`)});localStorage.setItem('tools_role',${JSON.stringify(role)});
        window.locale='zh-CN';window.calls=[];window.modelReply='技能 @meeting-summarizer 已成功创建并激活。';
        window.ToolsI18n={getLanguage:()=>locale};window.HomeWorkspace={getTools:()=>[]};
        window.API={post:async(url,body)=>{
            const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('tools_token')},body:JSON.stringify(body)});
            const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error),{body:data});return data;
        }};
        window.ToolsAIAssistant={requestStreamingChat:async(payload,handlers)=>{
            calls.push(JSON.parse(JSON.stringify(payload)));handlers.onEvent({type:'start',sessionId:'skill-save-chat',skills:[{id:'create-skill'}]});
            handlers.onDelta(modelReply);return {sessionId:'skill-save-chat',reply:modelReply};
        }};
        window.sendText=text=>{const input=document.getElementById('dcInput');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('dcComposer').requestSubmit();};
        window.typeText=text=>{const input=document.getElementById('dcInput');input.value=text;input.focus();input.setSelectionRange(text.length,text.length);input.dispatchEvent(new Event('input',{bubbles:true}));};
        window.fixtureDraft=${JSON.stringify(draft)};
        ${read('frontend/js/home/dragon-claw.js')}
        ${read('frontend/js/home/dragon-claw-skills.js')}
        void 0;
    `);
}
async function cleanup() {
    win?.destroy();
    if (child?.connected) { await backend('close'); child.disconnect(); }
}
app.whenReady().then(async () => {
    child = fork(path.join(__dirname, 'fixtures/dragon-claw-skill-server.cjs'), [], { execPath: 'node', silent: true });
    child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data));
    child.on('message', message => {
        if (message.event === 'catalogHeld') return catalogHeld?.();
        const request = requests.get(message.id); if (!request) return;
        requests.delete(message.id); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
    });
    child.on('exit', code => { for (const request of requests.values()) request.reject(new Error(`Backend fixture exited: ${code}`)); requests.clear(); });
    baseUrl = await backend('start', `<style>${read('frontend/css/dragon-claw.css')}${read('frontend/css/dragon-claw-skills.css')}body{margin:0;background:#101b30;font-family:system-ui}.dc{margin:20px;--navbar-h:0px}.dc-quick,.dc-scroll-hint{display:none}</style>${section}`);
    win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('Renderer:', message); });
    await boot();
    assert.deepEqual(await evaluate(async () => {
        const sample = fixtureDraft.slice(fixtureDraft.indexOf('---'), fixtureDraft.lastIndexOf('```')).trim();
        const results = [];
        for (const tag of ['skill', 'SKILL', 'markdown', 'yaml', '']) {
            const message = document.createElement('div'); message.innerHTML = '<div class="dc-msg-main"></div>';
            document.getElementById('dcThread').appendChild(message);
            await DragonClawSkills.offerSave(message, '```' + tag + '\n' + sample + '\n```');
            results.push(!!message.querySelector('[data-draft-save]')); message.remove();
        }
        for (const sample of ['---\nid: invalid\nname: Invalid\n---', '---\nname: Generic document\n---\nBody']) {
            const message = document.createElement('div'); message.innerHTML = '<div class="dc-msg-main"></div>';
            document.getElementById('dcThread').appendChild(message);
            await DragonClawSkills.offerSave(message, '```markdown\n' + sample + '\n```');
            results.push(!!message.querySelector('[data-draft-save]')); message.remove();
        }
        return results;
    }), [true, true, true, true, true, false, false]);
    await evaluate(() => sendText('@create-skill 创建会议纪要技能'));
    await until('!!document.querySelector(".dc-skill-draft [data-dc-ask]")&&!document.querySelector(".dc-composer.is-generating")');
    assert.match(await evaluate(() => document.querySelector('.dc-skill-draft').textContent), /技能尚未保存/);
    assert.equal(await store.getSkill('meeting-summarizer'), null, 'AI success text must never be persisted as a Skill');
    assert.equal(await backend('saveCount'), 0);
    await evaluate(() => { modelReply = fixtureDraft; document.querySelector('.dc-skill-draft [data-dc-ask]').click(); });
    await until('calls.length===2&&!!document.querySelector("[data-draft-save]")&&!document.querySelector(".dc-composer.is-generating")');
    assert.match(await evaluate(() => calls[1].messages.at(-1).content), /@create-skill.*@meeting-summarizer/);
    assert.match(await evaluate(() => document.querySelector('[data-draft-save]').closest('.dc-skill-draft').textContent), /草稿尚未保存/);
    assert.equal(await backend('saveCount'), 0, 'generating a draft does not implicitly save it');

    // An older catalog response arrives after the user saves: it must not erase the new Skill.
    await backend('hold');
    const held = new Promise(resolve => { catalogHeld = resolve; });
    await evaluate(() => { void DragonClawSkills.refresh(); }); await held;
    await evaluate(() => document.querySelector('[data-draft-save]').click());
    await until('!!document.querySelector(".dc-skill-draft.is-saved")');
    await backend('release');
    await evaluate(() => typeText('@meeting'));
    await until('!!document.querySelector("[data-skill-index]")&&document.getElementById("dcSkillMenu").textContent.includes("@meeting-summarizer")');
    assert.equal(await backend('saveCount'), 1);
    assert.match((await store.loadAll('@meeting-summarizer')).prompt, /总结决策与风险/);
    await evaluate(() => document.querySelector('[data-draft-use]').click());
    assert.match(await evaluate(() => document.getElementById('dcInput').value), /@meeting-summarizer/);
    assert.equal(await evaluate(() => document.querySelector('.dc-skill-discover').classList.contains('is-warn')), false);

    // Reload uses persisted SQLite data, and regular conversational replies don't show save warnings.
    await boot(); await evaluate(() => typeText('@meeting'));
    await until('document.getElementById("dcSkillMenu").textContent.includes("@meeting-summarizer")');
    await evaluate(() => { modelReply = '技能 @meeting-summarizer 已成功创建并激活。'; sendText('确认'); });
    await until('calls.length===1&&!document.querySelector(".dc-composer.is-generating")');
    await evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));
    assert.equal(await evaluate(() => !!document.querySelector('.dc-skill-draft')), false, 'existing Skill is not falsely reported as missing');

    await evaluate(() => { modelReply = fixtureDraft.replace('总结决策与风险', '标记关键决策与风险'); sendText('完善已有技能'); });
    await until('!!document.querySelector("[data-draft-save]")&&!document.querySelector(".dc-composer.is-generating")');
    assert.match(await evaluate(() => document.querySelector('[data-draft-save]').textContent), /完善此技能/);
    await evaluate(() => document.querySelector('[data-draft-save]').click());
    await until('!!document.querySelector("[data-draft-use]")');
    assert.match((await store.getSkill('meeting-summarizer')).body, /标记关键决策与风险/);

    // Save errors stay unsaved, and a retry uses the same button.
    await evaluate(() => { modelReply = fixtureDraft.replaceAll('meeting-summarizer', 'meeting-retry'); sendText('再创建一个技能'); });
    await until('!!document.querySelector("[data-draft-save]")&&!document.querySelector(".dc-composer.is-generating")');
    await backend('failSave'); await evaluate(() => document.querySelector('[data-draft-save]').click());
    await until('document.querySelector("[data-draft-save]").closest(".dc-skill-draft").textContent.includes("保存失败")');
    assert.equal(await store.getSkill('meeting-retry'), null);
    assert.equal(await evaluate(() => document.querySelector('[data-draft-save]').closest('.dc-skill-draft').classList.contains('is-saved')), false);
    await evaluate(() => document.querySelector('[data-draft-save]').click()); await until('!document.querySelector("[data-draft-save]")');
    assert.ok(await store.getSkill('meeting-retry'));

    // Light theme, narrow Electron container, and English recovery copy.
    await evaluate(() => { locale = 'en-US'; modelReply = 'Skill @missing-meeting has been created and activated.'; sendText('Create another skill'); });
    await until('!!document.querySelector(".dc-skill-draft [data-dc-ask]")&&!document.querySelector(".dc-composer.is-generating")');
    assert.match(await evaluate(() => document.querySelector('.dc-skill-draft [data-dc-ask]').closest('.dc-skill-draft').textContent), /Skill has not been saved/);
    nativeTheme.themeSource = 'light'; win.setContentSize(430, 850);
    await evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await evaluate(() => { const thread = document.getElementById('dcThread'); thread.style.scrollBehavior = 'auto'; thread.scrollTop = thread.scrollHeight; window.scrollTo(0, 0); });
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await evaluate(() => new Promise(resolve => setTimeout(resolve, 350))); // 等消息入场动画绘制完成再截图
    assert.equal(await evaluate(() => document.getElementById('dcThread').scrollWidth <= document.getElementById('dcThread').clientWidth), true);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.dc-skill-draft [data-dc-ask]').closest('.dc-skill-draft').querySelector('b')).color), 'rgb(36, 52, 71)');
    assert.equal(await evaluate(() => { const card = document.querySelector('.dc-skill-draft [data-dc-ask]').getBoundingClientRect(), thread = document.getElementById('dcThread').getBoundingClientRect(); return card.top >= thread.top && card.bottom <= thread.bottom; }), true);
    fs.writeFileSync(path.join(temp, 'save-recovery-light-narrow.png'), (await win.webContents.capturePage()).toPNG());

    await boot('viewer'); await evaluate(() => { modelReply = fixtureDraft.replaceAll('meeting-summarizer', 'viewer-draft'); sendText('创建技能'); });
    await until('!!document.querySelector(".dc-skill-draft")&&!document.querySelector(".dc-composer.is-generating")');
    assert.equal(await evaluate(() => !!document.querySelector('[data-draft-save]')), false);
    assert.ok(await evaluate(() => !!document.querySelector('[data-draft-download]')));
    const denied = await fetch(`${baseUrl}/api/agent-skills`, { method: 'POST', headers: { Authorization: 'Bearer fixture-viewer', 'Content-Type': 'application/json' }, body: JSON.stringify({ skillMd: markdown.replaceAll('meeting-summarizer', 'viewer-draft') }) });
    assert.equal(denied.status, 403); assert.equal(await store.getSkill('viewer-draft'), null);
    console.log(`PASS: false success recovery, real draft/save/catalog/load, stale catalog race, reload persistence, save failure/retry, English, light/narrow, admin permissions. Preview: ${temp}`);
    await cleanup(); app.exit(0);
}).catch(async error => { console.error(error); await cleanup(); app.exit(1); });
