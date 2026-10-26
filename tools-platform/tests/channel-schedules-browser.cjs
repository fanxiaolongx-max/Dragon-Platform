/* Run: node_modules/.bin/electron tests/channel-schedules-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-schedules-ui-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server, staleResponse, failSchedules = false;
const followups = ['open', 'paused', 'done'].map((status, index) => ({
    id: `followup-${index}`, title: ['跟进设备问题，确认修复结果', '等待客户反馈后恢复跟进', '已完成的指标核对'][index],
    status, urgency: 'normal', frequency: '每 2 个工作日', progress: index === 0 ? '已定位原因，等待回归验证' : '',
    assignees: [], nextRemindAt: '2026-10-27T06:00:00Z', remindCount: 1, creator: 'weixin:owner',
    events: [{ type: 'created', createdAt: '2026-10-25T20:00:00Z', actor: 'weixin:owner' }]
}));
const followupActions = [];
const statuses = ['active', 'running', 'failed', 'done', 'cancelled', 'active', 'done', 'active', 'done', 'active'];
const tasks = statuses.map((status, index) => ({
    id: `schedule-${index}`, instruction: ['汇总本周运营指标并发送日报', '正在生成今天的告警摘要', '定时提醒：核对 SLA 月报', '发送消息测试', '已取消的会议提醒', '每日早报：上次执行异常待检查', '执行已完成，但推送未送达', '一项较长的定时指令，用来确认多行标题不会挤压状态标签或撑破工作区的边界'][index] || `历史任务 ${index}`,
    status, description: index === 5 ? '每天 09:00' : '一次性', kind: index === 5 ? 'recurring' : 'once', runCount: index,
    nextRunAt: '2026-10-27T06:00:00Z', lastRunAt: '2026-10-25T20:00:00Z', timezone: 'Africa/Cairo',
    lastStatus: index === 5 ? 'failed' : 'ok', lastError: index === 2 || index === 5 ? '模型暂时不可用' : '',
    lastPush: index === 6 ? { ok: false, error: '频道暂时断开' } : null
}));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(code) {
    for (let n = 0; n < 150; n++) {
        if (await evaluate(code)) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out: ${code}`);
}
async function open(channel, kind, id) {
    await evaluate(`HomeWelinkThreads.open(${JSON.stringify({ channel, kind, id, name: id === 'fast' ? 'WeLink 运维群' : '本人（Bot 绑定的微信）' })});void 0`);
}
app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());
    web.get('/', (_, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, tag => tag.includes('id="homeModeBootstrap"') || /src="\/js\/(?:home\/(?:home-mode|dragon-claw|welink-threads)|shared\/i18n)\.js"/.test(tag) ? tag : '');
        html = html.replace(/<body\b[^>]*>/, tag => `${tag}<script>
            localStorage.setItem('tools_user','schedule-viewer');
            localStorage.setItem('tools_lang','zh-CN');
            const nativeInterval=window.setInterval;
            window.taskRefreshes=[];
            window.showNavbarConfirm=async()=>true;
            window.setInterval=(fn,ms)=>{if(ms===20000)taskRefreshes.push(fn);return nativeInterval(fn,ms);};
            window.DragonClawWorkspace={
                resetSession(){},hideExternal(){},
                showExternal({title,meta,open}={}){
                    const panel=document.getElementById('dcWorkspacePanel');panel.hidden=false;panel.classList.add('is-external','is-drawer-open');
                    let card=panel.querySelector('[data-card="external"]');
                    if(!card){card=document.createElement('section');card.className='wsp-card wsp-card--external is-open';card.dataset.card='external';card.innerHTML='<div class="wsp-card-head" data-ext-title></div><div class="wsp-card-body" data-ext-body></div>';panel.appendChild(card);}
                    card.querySelector('[data-ext-title]').textContent=title;
                    if(open!==false)document.body.classList.add('dc-workspace-open');
                    return card.querySelector('[data-ext-body]');
                }
            };
        </script>`);
        res.type('html').send(html);
    });
    web.get('/api/ai/models', (_, res) => res.json({ models: [] }));
    web.get('/api/ai/sessions', (_, res) => res.json({ items: [] }));
    web.get('/api/channels', (_, res) => res.json({ items: [] }));
    web.get('/api/channels/:channel/threads', (_, res) => res.json({ items: [] }));
    web.get('/api/channels/:channel/threads/:kind/:id/messages', (_, res) => res.json({ items: [{ id: 'message', role: 'model', content: '⏰ 定时任务 · 发送消息测试', createdAt: '2026-10-25T20:00:00Z' }], segments: [], canSend: false }));
    web.get('/api/channels/:channel/threads/:kind/:id/followups', (req, res) => res.json({ items: req.params.channel === 'weixin' && req.params.id === 'wechat' ? followups : [], canManage: true, calendar: { timezone: 'Africa/Cairo' } }));
    web.patch('/api/channels/:channel/followups/:id', (req, res) => {
        assert.equal(req.params.channel, 'weixin');
        const task = followups.find(item => item.id === req.params.id);
        assert.ok(task);
        followupActions.push(req.body.action);
        task.status = ({ pause: 'paused', resume: 'open', done: 'done' })[req.body.action];
        res.json({ item: task });
    });
    web.get('/api/channels/:channel/threads/:kind/:id/schedules', (req, res) => {
        if (req.params.id === 'slow') { staleResponse = res; return; }
        if (failSchedules) return res.status(503).json({ error: 'temporary' });
        res.json({ items: req.params.id === 'fast' ? [{ ...tasks[0], id: 'welink-only' }] : req.params.id === 'empty' ? [] : tasks });
    });
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until('!!window.HomeWelinkThreads');
    await open('weixin', 'user', 'wechat');
    await until('document.querySelectorAll("[data-wl-schedule]").length===8');
    await until('document.querySelectorAll("[data-wl-card]").length===3');
    assert.equal(await evaluate('document.querySelectorAll(".wl-followups .wl-status.is-open").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll(".wl-followups .wl-status.is-paused").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll(".wl-followups .wl-status.is-done").length'), 1);
    assert.match(await evaluate('document.querySelector("[data-wl-card=followup-0]").textContent'), /等待回归验证/);
    assert.match(await evaluate('document.querySelector("[data-wl-card=followup-0]").textContent'), /当前微信单聊/);
    assert.doesNotMatch(await evaluate('document.querySelector(".wl-followups").textContent'), /群内相关人/);
    await evaluate('document.querySelector("[data-wl-card=followup-0] [data-wl-act=pause]").click()');
    await until('!!document.querySelector("[data-wl-card=followup-0].is-paused")');
    await evaluate('document.querySelector("[data-wl-card=followup-0] [data-wl-act=resume]").click()');
    await until('!!document.querySelector("[data-wl-card=followup-0].is-open")');
    assert.equal(await evaluate('document.querySelectorAll("[data-wl-schedule-filter]").length'), 4);
    assert.equal(await evaluate('document.querySelector("[data-wl-schedule-filter=attention] span").textContent'), '3');
    assert.equal(await evaluate('document.querySelector("[data-ext-body]").textContent.includes("暂不支持")'), false);
    await evaluate('document.querySelector("[data-wl-schedule=\\"schedule-0\\"] summary").click()');
    await evaluate('document.querySelector("[data-wl-schedule-more]").click()');
    assert.equal(await evaluate('document.querySelectorAll("[data-wl-schedule]").length'), 10);
    assert.equal(await evaluate('document.querySelector("[data-wl-schedule=\\"schedule-0\\"]").open'), true);
    await evaluate('document.querySelector("[data-wl-schedule=\\"schedule-0\\"] summary").focus()');
    await evaluate('taskRefreshes.at(-1)()');
    await until('document.querySelector(".wl-schedules").getAttribute("aria-busy")==="false"');
    assert.equal(await evaluate('document.querySelector("[data-wl-schedule=\\"schedule-0\\"]").open'), true);
    assert.equal(await evaluate('document.activeElement.parentElement.dataset.wlSchedule'), 'schedule-0', 'refresh preserves keyboard focus');
    await evaluate('document.querySelector("[data-wl-schedule-filter=attention]").click()');
    assert.equal(await evaluate('document.querySelectorAll("[data-wl-schedule]").length'), 3);
    assert.match(await evaluate('document.querySelector(".wl-schedules").textContent'), /推送失败/);
    failSchedules = true;
    await evaluate('taskRefreshes.at(-1)()');
    await until('!!document.querySelector("[data-wl-schedule-retry]")');
    assert.equal(await evaluate('document.querySelectorAll("[data-wl-schedule]").length'), 3, 'failed refresh preserves cached cards');
    failSchedules = false;
    await evaluate('document.querySelector("[data-wl-schedule-retry]").click()');
    await until('!document.querySelector("[data-wl-schedule-retry]")');
    await evaluate('document.querySelector("[data-wl-schedule-filter=all]").click()');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await new Promise(resolve => setTimeout(resolve, 100));
    const panel = await evaluate('(()=>{const r=dcWorkspacePanel.getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()');
    fs.writeFileSync(path.join(temp, 'desktop.png'), (await win.webContents.capturePage(panel)).toPNG());
    await evaluate('document.querySelector(".wl-followups").scrollIntoView({block:"start"})');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(temp, 'wechat-followups.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("[data-wl-card=followup-0] [data-wl-act=done]").click()');
    await until('!!document.querySelector("[data-wl-card=followup-0].is-done")');
    assert.deepEqual(followupActions, ['pause', 'resume', 'done']);
    await open('weixin', 'user', 'slow');
    await until('document.querySelector(".wl-scheduled-empty")?.textContent.includes("加载")');
    await open('welink', 'group', 'fast');
    await until('!!document.querySelector("[data-wl-schedule=welink-only]")');
    assert.ok(staleResponse);
    staleResponse.json({ items: tasks });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(await evaluate('document.querySelectorAll("[data-wl-schedule]").length'), 1, 'stale response never replaces a new conversation');
    assert.ok(await evaluate('!!document.querySelector(".wl-followups")'));
    await evaluate('localStorage.setItem("tools_lang","en-US");window.dispatchEvent(new Event("tools:languagechange"))');
    assert.match(await evaluate('document.querySelector(".wl-schedules").textContent'), /Scheduled tasks/);
    await open('weixin', 'user', 'wechat');
    await until('document.querySelectorAll("[data-wl-card]").length===3');
    assert.match(await evaluate('document.querySelector(".wl-followups").textContent'), /Paused/);
    win.setSize(390, 844);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.ok(await evaluate('dcWorkspacePanel.scrollWidth<=dcWorkspacePanel.clientWidth+1'), 'narrow panel has no horizontal overflow');
    fs.writeFileSync(path.join(temp, 'mobile-en.png'), (await win.webContents.capturePage()).toPNG());
    await open('weixin', 'user', 'empty');
    await until('document.querySelector(".wl-scheduled-empty")?.textContent.includes("No scheduled tasks")');
    assert.match(await evaluate('document.querySelector(".wl-scheduled-empty").textContent'), /No scheduled tasks/);
    console.log(`PASS: WeChat follow-up states and pause/resume/completion; WeChat/WeLink schedules, paging, filtering, refresh, stale responses, English and mobile. Previews: ${temp}`);
    win.destroy();server.close();app.quit();
}).catch(error => { console.error(error); if (win) win.destroy(); if (server) server.close(); app.exit(1); });
