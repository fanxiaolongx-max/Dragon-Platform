/* node_modules/.bin/electron tests/ai-report-browser.cjs */
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ai-report-browser-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));app.on('window-all-closed',()=>{});

// Scripted AI: chat looks data up and answers or asks; the summary writes the prompt; the first compile is broken and repaired.
const aiCalls=[];let compiles=0;
const recipeFor=(sourceKey,broken)=>({type:'recipe',reply:'已编译。',recipe:{summary:{zh:'整改详单按级别计数，表格 + 柱状图',en:'Orders by severity'},sources:[{id:'s1',kind:'sheet',label:'整改详单',match:{sourceKey,sheetName:'Sheet1'}}],
    compute:broken?'function compute(input){ return input.s1.rows.notAFunction(); }':'function compute(input){ if(!input.s1) return {missing:true}; const by={}; for(const row of input.s1.rows){ by[row.级别]=(by[row.级别]||0)+1; } return {total:input.s1.rows.length, rows:Object.entries(by).map(([level,count])=>({level,count}))}; }',
    render:'function render(result, kit){ if(result.missing) return kit.text("本月无数据"); return kit.table(result.rows,{columns:[{key:"level",label:"级别"},{key:"count",label:"数量",format:"number"}]})+kit.bar(result.rows.map(r=>({label:r.level,value:r.count})),{title:"按级别"})+"<img src=x onerror=alert(1)><script>window.hacked=1<\\/script>"; }',
    narrative:{prompt:'总数和最多的级别'}}});
require('../backend/models/ai-settings-repository').getRuntimeSettings=async()=>({hasApiKey:true,keyLooksValid:true,provider:'stub',model:'stub'});
require('../backend/models/ai-provider-client').createClient=()=>({async generateChat({systemInstruction,messages}){
    const last=messages.at(-1),toolMessage=messages.find(item=>item.role==='tool'),userText=[...messages].reverse().find(item=>item.role==='user')?.content||'';
    aiCalls.push({system:systemInstruction.slice(0,30),last});
    if(systemInstruction.includes('为月报格子写总结')){const total=JSON.parse(last.content.match(/计算结果：(.*)/)[1]).total;return {text:JSON.stringify({zh:`本月整改单共 ${total} 条。`,en:`${total} rectification orders this month.`}),toolCalls:[]};}
    if(systemInstruction.includes('直接改了一段文字')){const summary=/修改位置：总结/.test(last.content),prompt=last.content.match(/当前最终提示词：\n([\s\S]*?)\n\n修改位置/)[1];
        return {text:JSON.stringify({mode:summary?'refine':'replace',note:'已写入：'+last.content.match(/改动：(.*)/)[1],prompt:prompt+(summary?'\n总结里的月份写成“X月”。':'\n表头“级别”一律写成“严重级别”。')}),toolCalls:[]};}
    if(systemInstruction.includes('格子助手')&&/以后所有总结/.test(userText))return {text:JSON.stringify({type:'answer',text:'好的，这个格子的总结会控制在两句内。',report_rule:{section:'文字与结论',item:'文字总结不超过两句。'}}),toolCalls:[]};
    if(systemInstruction.includes('图片助手'))return {text:JSON.stringify(/画/.test(userText)?{type:'generate',text:'好的，画一个蓝色盾牌。',prompt:'蓝色盾牌图形'}:{type:'answer',text:'可以上传、挑选或让我画一张。'}),toolCalls:[]};
    if(systemInstruction.includes('矢量图形设计师'))return {text:JSON.stringify({svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M256 40 L440 110 V260 C440 380 256 470 256 470 C256 470 72 380 72 260 V110 Z" fill="#1e6b4f"/></svg>',name:'盾牌'}),toolCalls:[]};
    if(systemInstruction.includes('开头字段助手'))return {text:JSON.stringify({type:'ready',text:'好的。'}),toolCalls:[]};
    if(systemInstruction.includes('总结成这个字段的“字段提示词”')){const said=[...last.content.matchAll(/用户：(.*)/g)].at(-1)[1];return {text:JSON.stringify({prompt:/固定写成 /.test(said)?'固定文字：'+said.split('固定写成 ')[1].trim():'报告时间为报告月份的下一个月，只写 6 位数字 YYYYMM'}),toolCalls:[]};}
    if(systemInstruction.includes('月报开头的一个字段')){const next=last.content.match(/下个月：\d{4}-\d{2}（也可写成 (\d{6})/)[1];return {text:JSON.stringify({zh:next,en:next}),toolCalls:[]};}
    if(systemInstruction.includes('调试记录'))return {text:'- 这一步在编译配方\n- 调用了 list_sources',toolCalls:[]};
    if(systemInstruction.includes('章节样式顾问'))return {text:JSON.stringify({type:'ready',text:'好的：本章节标题统一加“▍”前缀。'}),toolCalls:[]};
    if(systemInstruction.includes('章节样式提示词”：每条一行'))return {text:JSON.stringify({prompt:'- 标题统一加“▍”前缀。'}),toolCalls:[]};
    // A restyle may try to touch compute; the server must put the original back.
    if(/这是一次章节样式统一/.test(last.content)){const current=JSON.parse(last.content.match(/当前配方：(.*)/)[1]);return {text:JSON.stringify({type:'recipe',reply:'已统一样式。',recipe:{...current,compute:'function compute(){ return {total:999,rows:[]}; }',render:current.render.replace('return kit.table(','return "<div class=\\"kit-title\\">▍章节样式</div>"+kit.table(')}}),toolCalls:[]};}
    if(systemInstruction.includes('整体风格顾问'))return {text:JSON.stringify({type:'ready',text:'好的：沉稳的绿色商务风，措辞正式。'}),toolCalls:[]};
    if(systemInstruction.includes('总结成“月报整体风格提示词”'))return {text:JSON.stringify({prompt:'整体为沉稳的绿色商务风：主色深绿，图表用绿色系，措辞正式简洁。'}),toolCalls:[]};
    if(systemInstruction.includes('给出月报的主题配置'))return {text:JSON.stringify({reply:'已应用绿色商务主题。',theme:{accent:'#1e6b4f',accentSoft:'#e7f4ee',heading:'#123a2b',surface:'#fbfefc',palette:['#1e6b4f','#3fa57a','#8cc9a7','#c9a23f','#6b7f8f','#2f6fae'],font:'serif',radius:4}}),toolCalls:[]};
    if(systemInstruction.includes('总结成这个格子')){assert.match(last.content,/按严重级别/);return {text:JSON.stringify({prompt:'使用整改详单 Sheet1，按“级别”统计本月数量，用表格和柱状图展示，并写一句总结。'}),toolCalls:[]};}
    if(!toolMessage)return {text:'',toolCalls:[{id:'call-1',name:'list_sources',args:{}}]};
    const sources=JSON.parse(toolMessage.toolResults[0].content),table=sources.find(item=>item.name.includes('整改'));
    if(systemInstruction.includes('编译成一个可以每月重复运行的配方')){compiles++;return {text:JSON.stringify(recipeFor(table.sourceKey,!/运行出错/.test(messages[0].content))),toolCalls:[]};}
    if(/有哪些列/.test(userText))return {text:JSON.stringify({type:'answer',text:`整改详单有 ${table.sheets[0].headers.length} 列：${table.sheets[0].headers.join('、')}。`}),toolCalls:[]};
    if(/按严重级别/.test(userText))return {text:JSON.stringify({type:'ready',text:'明白：按**级别**统计本月整改单，用表格加柱状图。'}),toolCalls:[]};
    return {text:JSON.stringify({type:'ask',question:'按什么口径统计？',choices:['按严重级别','按责任人']}),toolCalls:[]};
}});

const repo=require('../backend/models/import-source-repository');
let win,server;const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(fn,...args)=>win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true).catch(error=>{console.error('Browser step failed:',fn.toString().slice(0,300));throw error;});
async function until(fn,label='condition'){for(let i=0;i<250;i++){if(await evaluate(fn))return;await wait(40);}throw new Error('Timed out: '+label+' '+fn);}

app.whenReady().then(async()=>{
    for(const [month,levels] of [[9,['高','高','中']],[10,['高','中','中','低','低']]]){
        const batch=await repo.createBatch({targetMonth:month});const file=await repo.saveFile(batch.id,{name:`整改详单-2026-${String(month).padStart(2,'0')}.csv`,buffer:Buffer.from('级别\n'+levels.join('\n'))});
        await repo.saveSheets(file.id,[{name:'Sheet1',headers:['级别'],rows:levels.map(level=>({级别:level}))}]);
    }
    const web=express();web.use(express.json({limit:'50mb'}));web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));
    web.use((req,_res,next)=>{req.user={username:'tester',role:'user'};next();});web.use('/api/ai-report',require('../backend/routes/ai-report'));web.use(express.static(path.join(__dirname,'../frontend')));
    server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});
    win=new BrowserWindow({show:false,width:1600,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
    win.webContents.on('console-message',(_,level,message)=>{if(level>=3)console.error('Renderer:',message);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/pages/ai-report.html`);
    await until(()=>!document.body.classList.contains('air-booting')&&!!document.querySelector('.air-chapter'),'boot');
    // The shared startup screen shows the loading steps and closes once the report is open.
    await until(()=>!document.getElementById('platformStartup'),'startup screen closes');
    assert.equal(await evaluate(()=>typeof ToolsPageStartup.run),'function');

    // A new report starts from the monthly template: title, meta fields, chapters with one empty cell each.
    assert.ok(await evaluate(()=>document.querySelector('.air-masthead h1').textContent.trim().length>0));
    assert.ok(await evaluate(()=>document.querySelectorAll('.air-chapter').length>=5));
    await evaluate(()=>{const input=document.getElementById('airMonth');input.value='2026-09';input.dispatchEvent(new Event('change'));});
    await until(()=>AiReportApp.state.doc.reportMonth==='2026-09','month');
    assert.equal(await evaluate(()=>document.querySelectorAll('.air-toolbar > button:not([hidden]), .air-toolbar > details').length),5,'Toolbar keeps five actions');

    // Empty cells: the input fills the cell and the start button stays tidy at any width; cell tools wait for the top-right corner.
    const emptyCell=await evaluate(async()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0],node=()=>document.querySelector(`[data-cell="${cell.id}"]`),measure=()=>{const box=node().getBoundingClientRect(),area=node().querySelector('.air-ask textarea').getBoundingClientRect(),button=node().querySelector('.air-ask button').getBoundingClientRect();return {fills:Math.abs(area.width-box.width)<4,buttonInside:button.right<=box.right&&button.bottom<=box.bottom&&button.left>=box.left,overlap:button.top<area.bottom-46};};
        const wide=measure();cell.span=1;AiReportApp.render();const narrow=measure(),narrowButton=node().querySelector('.air-ask button').getBoundingClientRect(),narrowBox=node().getBoundingClientRect();cell.span=12;AiReportApp.render();
        return {wide,narrow,fullWidth:narrowButton.width>narrowBox.width-30,tools:getComputedStyle(node().querySelector('.air-cell-tools')).opacity};});
    const corners=await evaluate(()=>[...document.querySelectorAll('.air-cell')].slice(0,3).map(cell=>{const box=cell.getBoundingClientRect();cell.scrollIntoView({block:'center',behavior:'instant'});const fresh=cell.getBoundingClientRect();return document.elementFromPoint(fresh.right-5,fresh.bottom-5)?.matches('[data-resize]');}));
    assert.ok(corners.every(Boolean),'The bottom-right corner of every cell is the resize handle, not the input under it');
    assert.equal(emptyCell.wide.fills,true);assert.equal(emptyCell.wide.buttonInside,true);assert.equal(emptyCell.narrow.buttonInside,true);assert.equal(emptyCell.fullWidth,true,'Narrow cells put the start button on its own row');assert.equal(emptyCell.tools,'0','Cell tools stay hidden until hovered');
    // Text typed into an empty cell, and the caret, survive re-renders such as resizing the cell.
    const draft=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0],input=()=>document.querySelector(`[data-ask="${cell.id}"] textarea`);
        input().value='SR FRT指标呈现一下';input().focus();input().setSelectionRange(2,2);cell.span=6;AiReportApp.render();
        const kept={value:input().value,focused:document.activeElement===input(),caret:input().selectionStart};cell.span=12;input().value='';AiReportApp.render();return {...kept,cleared:input().value};});
    assert.deepEqual(draft,{value:'SR FRT指标呈现一下',focused:true,caret:2,cleared:''},'Drafts in empty cells survive resizing');
    // A data question gets a plain answer — no recipe, nothing in the cell yet.
    await evaluate(()=>{const form=document.querySelector('[data-ask]');form.querySelector('textarea').value='整改详单有哪些列';form.requestSubmit();});
    await until(()=>document.querySelector('#airChat .air-msg-ai')?.textContent.includes('整改详单有 1 列')&&!AiReportApp.state.busy.size,'data answer');
    // Retry under the user's words: the latest one replaces the earlier answer (no duplicates); the AI is asked again.
    const retryBefore=await evaluate(()=>({buttons:document.querySelectorAll('#airChat [data-retry-msg]').length,users:AiReportApp.state.doc.chapters[0].cells[0].chat.filter(item=>item.role==='user').length,side:getComputedStyle(document.querySelector('#airChat .air-msg-tail-user')).alignSelf}));
    const callsBeforeRetry=aiCalls.length;
    await evaluate(()=>document.querySelector('#airChat [data-retry-msg]').click());
    for(let i=0;i<200&&aiCalls.length===callsBeforeRetry;i++)await wait(25);
    await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[0].cells[0].chat.length===2&&document.querySelector('#airChat .air-msg-ai')?.textContent.includes('整改详单有 1 列'),'retried');
    const retried=await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].chat.map(item=>item.role+':'+item.text));
    assert.deepEqual(retryBefore,{buttons:1,users:1,side:'flex-end'},'Every user message has a retry button next to copy');
    assert.deepEqual(retried,['user:整改详单有哪些列','ai:整改详单有 1 列：级别。'],'Retrying the latest message replaces its answer');assert.ok(aiCalls.length>callsBeforeRetry,'The words went to the AI again');
    assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].recipe),null);
    // Ask → choices → the AI says it is settled → prompt, recipe and cell content appear with no clicks (first compile breaks and is repaired).
    await evaluate(()=>{const input=document.querySelector('#airChat .air-composer textarea');input.value='统计本月整改单';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    await until(()=>!!document.querySelector('#airChat [data-choice]'),'choices');
    await evaluate(()=>document.querySelector('#airChat [data-choice="按严重级别"]').click());
    await until(()=>!!document.querySelector('.air-cell .kit-table')&&!AiReportApp.state.busy.size,'table without clicks');
    assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].prompt),'使用整改详单 Sheet1，按“级别”统计本月数量，用表格和柱状图展示，并写一句总结。');
    assert.equal(await evaluate(()=>[...document.querySelectorAll('#airChat .air-msg-ai')].some(node=>node.innerHTML.includes('<strong>级别</strong>')&&!node.textContent.includes('**'))),true,'Markdown bold renders as bold');
    const first=await evaluate(()=>{const cell=document.querySelector('.air-cell');return {table:cell.querySelector('.kit-table').textContent,chart:!!cell.querySelector('svg.kit-chart'),narrative:cell.querySelector('.air-narrative')?.textContent||'',script:!!cell.querySelector('script'),handler:!!cell.querySelector('[onerror]'),hacked:!!window.hacked,tried:document.querySelector('#airChat .air-prompt-actions')?.textContent||''};});
    assert.match(first.table,/高2/);assert.equal(first.chart,true);assert.equal(first.narrative,'本月整改单共 3 条。');assert.equal(first.script,false);assert.equal(first.handler,false);assert.equal(first.hacked,false);
    assert.equal(compiles,2,'A failed run is compiled once more with the error');assert.match(first.tried,/再试一次/);

    // The composer grows with its text; the round send button is inside it and only active with text; Enter sends.
    const composer=await evaluate(()=>{const input=document.querySelector('#airChat .air-composer textarea'),send=document.querySelector('#airChat .air-send'),box=document.querySelector('#airChat .air-composer').getBoundingClientRect();const empty={height:input.getBoundingClientRect().height,disabled:send.disabled};
        input.value='第一行\n第二行\n第三行\n第四行';input.dispatchEvent(new Event('input',{bubbles:true}));const sendBox=send.getBoundingClientRect();
        const result={empty,grown:input.getBoundingClientRect().height,enabled:!send.disabled,inside:sendBox.right<=box.right&&sendBox.bottom<=box.bottom,round:getComputedStyle(send).borderRadius};input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));return result;});
    assert.equal(composer.empty.disabled,true);assert.equal(composer.enabled,true);assert.ok(composer.grown>composer.empty.height*2.5,'Composer grows with content');assert.equal(composer.inside,true);assert.equal(composer.round,'50%');
    // Every chat message has a light copy button underneath; it copies the full text.
    const copies=await evaluate(()=>({count:document.querySelectorAll('#airChat [data-copy-msg]').length,messages:document.querySelectorAll('#airChat .air-msg[data-msg]').length,userSide:getComputedStyle(document.querySelector('#airChat .air-msg-copy-user')).alignSelf}));
    assert.equal(copies.count,copies.messages,'One copy button per message');assert.equal(copies.userSide,'flex-end');
    await evaluate(()=>{const prompt=document.querySelector('#airChat .air-msg-prompt');prompt.nextElementSibling.click();});await wait(150);
    assert.equal(require('electron').clipboard.readText(),'使用整改详单 Sheet1，按“级别”统计本月数量，用表格和柱状图展示，并写一句总结。','The prompt text is on the clipboard');
    assert.match(await evaluate(()=>document.querySelector('#airChat .air-msg-prompt').nextElementSibling.textContent),/已复制/);
    // Reopening starts at the latest prompt; scrolling up loads earlier messages.
    const cellId=await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].id);
    await evaluate(()=>document.querySelector('[data-chat-close]').click());assert.equal(await evaluate(()=>document.getElementById('airChat').hidden),true);
    await evaluate(id=>document.querySelector(`[data-cell-chat="${id}"]`).click(),cellId);
    const reopened=await evaluate(()=>({first:document.querySelector('#airChat .air-chat-log .air-msg')?.className,earlier:document.querySelector('#airChat [data-earlier]')?.textContent||''}));
    assert.match(reopened.first,/air-msg-prompt/);assert.match(reopened.earlier,/更早的 6 条/);
    // Pulling past the threshold stretches the log, says “release”, then loads on release and springs back.
    const pulled=await evaluate(()=>{const log=document.querySelector('#airChat .air-chat-log');log.scrollTop=0;const small=new WheelEvent('wheel',{deltaY:-30,bubbles:true,cancelable:true});log.dispatchEvent(small);const first={moved:document.querySelector('#airChat .air-chat-track').style.transform,text:log.querySelector('.air-pull-text').textContent,prevented:small.defaultPrevented};
        for(let i=0;i<8;i++)log.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,bubbles:true,cancelable:true}));return {first,ready:log.querySelector('.air-pull-text').textContent,messages:document.querySelectorAll('#airChat .air-msg').length};});
    assert.match(pulled.first.moved,/translateY/);assert.equal(pulled.first.prevented,true);assert.match(pulled.first.text,/下拉查看/);assert.match(pulled.ready,/松开加载/);assert.equal(pulled.messages,1,'Nothing loads until release');
    await until(()=>!document.querySelector('#airChat [data-earlier]')&&document.querySelectorAll('#airChat .air-msg').length===7,'lazy history');
    const settled=await evaluate(async()=>{await new Promise(resolve=>setTimeout(resolve,500));const log=document.querySelector('#airChat .air-chat-log');log.scrollTop=0;for(let i=0;i<3;i++)log.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,bubbles:true,cancelable:true}));return log.querySelector('.air-pull-text').textContent;});
    assert.match(settled,/没有更早/,'At the earliest message the pull says there is nothing more');
    // With the chat open, touching another cell (even its input) switches the chat to it without re-rendering the report.
    const switched=await evaluate(()=>{const first=document.querySelector('.air-cell');first.dataset.marker='kept';
        const other=document.querySelectorAll('[data-grid]')[1].querySelector('.air-cell'),input=other.querySelector('textarea');
        input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));input.focus();input.value='草稿';
        const state={selected:AiReportApp.state.selected===other.dataset.cell,header:document.querySelector('#airChat header small').textContent,empty:!!document.querySelector('#airChat .air-chat-empty'),focused:document.activeElement===input,value:input.value,firstKept:document.querySelector('.air-cell').dataset.marker==='kept',highlight:other.classList.contains('is-selected')&&!first.classList.contains('is-selected')};
        first.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
        state.back=!!document.querySelector('#airChat .air-msg-prompt');state.draftKept=input.value==='草稿';
        document.querySelector('[data-style-chat]').click();state.style=document.querySelector('#airChat header strong').textContent;
        first.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));state.fromStyle=document.querySelector('#airChat header strong').textContent;input.value='';return state;});
    assert.equal(switched.selected,true);assert.equal(switched.empty,true,'Chat shows the other cell');assert.equal(switched.focused,true,'Typing focus is kept');assert.equal(switched.value,'草稿');
    assert.equal(switched.firstKept,true,'The report is not re-rendered');assert.equal(switched.highlight,true);assert.equal(switched.back,true,'Back to the first cell shows its prompt');assert.equal(switched.draftKept,true);
    assert.match(switched.style,/整体风格/);assert.match(switched.fromStyle,/格子对话/,'From the report style chat, a cell click switches to that cell');
    // The small text link still regenerates the prompt by hand.
    assert.equal(await evaluate(()=>document.querySelector('#airChat [data-make-prompt]').tagName),'A','Regenerating the prompt is a small text link, not a button');
    // The top bars fold away from a small tab (and come back); the report and the chat move up into the space.
    const chrome=await evaluate(async()=>{const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),toggle=document.querySelector('[data-air=chrome]'),measure=()=>({toolbar:Math.round(document.querySelector('.air-toolbar').getBoundingClientRect().height),report:Math.round(document.getElementById('airReport').getBoundingClientRect().top),chat:Math.round(document.getElementById('airChat').getBoundingClientRect().top),tab:Math.round(toggle.getBoundingClientRect().top)});
        scrollTo(0,0);const open=measure();toggle.click();await wait(450);const folded={...measure(),hidden:document.documentElement.classList.contains('air-chrome-hidden'),pressed:toggle.getAttribute('aria-pressed'),saved:localStorage.getItem('air-chrome-hidden')};
        toggle.click();await wait(450);return {open,folded,back:measure(),saved:localStorage.getItem('air-chrome-hidden')};});
    assert.equal(chrome.folded.hidden,true);assert.equal(chrome.folded.toolbar,0,'The toolbar folds away');assert.equal(chrome.folded.tab,0,'The tab waits at the top edge');assert.equal(chrome.folded.pressed,'true');assert.equal(chrome.folded.saved,'1');
    assert.equal(chrome.folded.chat,chrome.folded.report,'Folded, the chat still starts level with the report');assert.ok(chrome.folded.report<chrome.open.report-40,'The report moves up');
    assert.deepEqual(chrome.back,chrome.open,'Unfolding restores the layout');assert.equal(chrome.saved,'0');
    // The chat starts level with the report, ends just above the window edge and stays put while the report scrolls.
    const chatBox=await evaluate(async()=>{const box=()=>{const chat=document.getElementById('airChat').getBoundingClientRect();return {top:Math.round(chat.top),bottom:Math.round(chat.bottom),report:Math.round(document.getElementById('airReport').getBoundingClientRect().top)};};
        scrollTo(0,0);await new Promise(resolve=>setTimeout(resolve,50));const top=box();scrollTo(0,500);await new Promise(resolve=>setTimeout(resolve,50));const scrolled=box();scrollTo(0,0);return {top,scrolled,inner:innerHeight};});
    assert.equal(chatBox.top.top,chatBox.top.report,'Chat top lines up with the report');assert.equal(chatBox.top.bottom,chatBox.inner-12,'Chat bottom sits just above the window edge');
    assert.equal(chatBox.scrolled.top,chatBox.top.top,'Chat stays in place while scrolling');assert.equal(chatBox.scrolled.bottom,chatBox.top.bottom);
    // Work in progress shows as a ring around the cell (colour = stage, lit share of the edge = progress), not as text in it.
    const ring=await evaluate(()=>{document.querySelector('#airChat [data-make-prompt]').click();const node=document.querySelector(`[data-cell="${AiReportApp.state.selected}"]`),svg=node.querySelector('.air-progress');
        return {ring:svg?.getAttribute('class'),to:svg?.style.getPropertyValue('--to'),text:/正在/.test(node.querySelector('.air-cell-body').textContent),title:node.title,stages:['等待生成…','正在查数据…','正在总结对话，生成最终提示词…','正在把提示词变成配方…','正在计算…','正在写总结…'].map(label=>AiReportView.stageOf(label).stage)};});
    assert.match(ring.ring,/air-progress-prompt/);assert.equal(ring.to,'40');assert.equal(ring.text,false,'No progress text inside the cell');assert.match(ring.title,/生成最终提示词/,'The step is still available on hover');
    assert.deepEqual(ring.stages,['queued','think','prompt','compile','compute','narrative']);
    await until(()=>document.querySelectorAll('#airChat .air-msg-prompt').length===2&&!AiReportApp.state.busy.size,'manual regenerate');
    assert.match(await evaluate(()=>document.querySelector('#airChat .air-msg-prompt:last-of-type .air-prompt-actions').textContent),/再试一次/,'Same prompt keeps its recipe');
    // Undo on the latest final prompt: the messages after the previous prompt dissolve (with particles) and are removed.
    await evaluate(()=>{const input=document.querySelector('#airChat .air-composer textarea');input.value='改成只看高级别';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[0].cells[0].chat.at(-1).kind==='ask','extra turn');
    await evaluate(()=>document.querySelector('#airChat [data-make-prompt]').click());
    await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[0].cells[0].chat.at(-1).kind==='prompt','third prompt');
    const beforeUndo=await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].chat.length);
    await evaluate(()=>{window.__particles=0;new MutationObserver(list=>list.forEach(change=>change.addedNodes.forEach(node=>{if(node.classList?.contains('air-particle'))window.__particles++;}))).observe(document.getElementById('airChat'),{childList:true,subtree:true});document.querySelector('#airChat [data-revert]').click();});
    const chatLengthIs=async(length,label)=>{for(let i=0;i<250;i++){if(await evaluate(length=>AiReportApp.state.doc.chapters[0].cells[0].chat.length===length&&!AiReportApp.state.busy.size,length))return;await wait(40);}throw new Error('Timed out: '+label);};
    await chatLengthIs(beforeUndo-3,'first undo');
    const undone=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0];return {particles:window.__particles,last:cell.chat.at(-1).kind,prompt:cell.prompt,table:!!document.querySelector(`[data-cell="${cell.id}"] .kit-table`),leftover:document.querySelectorAll('#airChat .air-particle').length,status:document.getElementById('airStatus').textContent};});
    assert.ok(undone.particles>10,'Removed messages scatter into particles');assert.equal(undone.leftover,0,'Particles clean up');assert.equal(undone.last,'prompt');assert.equal(undone.table,true,'The cell keeps the result of the restored prompt');assert.match(undone.status,/撤回到上一个最终提示词/);
    await evaluate(()=>document.querySelector('#airChat [data-revert]').click());
    await chatLengthIs(beforeUndo-4,'second undo');
    const restored=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0];return {kinds:cell.chat.map(item=>item.kind||item.role).join(','),recipe:!!cell.recipe,table:document.querySelector(`[data-cell="${cell.id}"] .kit-table`)?.textContent||'',narrative:document.querySelector(`[data-cell="${cell.id}"] .air-narrative`)?.textContent||''};});
    assert.equal(restored.kinds,'user,answer,user,ask,user,answer,prompt','Only the conversation up to the first prompt remains');assert.equal(restored.recipe,true);assert.match(restored.table,/高2/);assert.equal(restored.narrative,'本月整改单共 3 条。','The snapshot summary comes back');
    // Editing the final prompt in place: saving records an edited prompt, generates it, and undo returns to the old wording.
    const originalPrompt=await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].prompt);
    await evaluate(()=>document.querySelector('#airChat [data-edit-prompt]').click());
    await evaluate(()=>{const draft=document.querySelector('#airChat [data-prompt-draft]');draft.textContent='只统计高级别整改单，用表格展示。';draft.dispatchEvent(new Event('input',{bubbles:true}));draft.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));});
    await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[0].cells[0].prompt==='只统计高级别整改单，用表格展示。'&&AiReportApp.state.doc.chapters[0].cells[0].recipePrompt==='只统计高级别整改单，用表格展示。','edited prompt generated');
    const edited=await evaluate(()=>({tag:document.querySelector('#airChat .air-msg-prompt:last-of-type .air-prompt-tag')?.textContent||'',flag:AiReportApp.state.doc.chapters[0].cells[0].chat.at(-1).edited,table:!!document.querySelector('.air-cell .kit-table')}));
    assert.deepEqual(edited,{tag:'手动编辑',flag:true,table:true});
    await evaluate(()=>document.querySelector('#airChat [data-revert]').click());
    await until(()=>!AiReportApp.state.busy.size&&!AiReportApp.state.doc.chapters[0].cells[0].chat.at(-1).edited,'undo edit');
    assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].prompt),originalPrompt,'Undo returns to the wording before the edit');
    // Editing text in the cell: double-click, type, Enter. The AI writes the edit into the prompt; a summary edit only
    // rewrites the summary, a content edit regenerates the content. Both are new prompts, so undo works.
    const editText=async(selector,text)=>{
        const started=await evaluate((selector,text)=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.doc.chapters[0].cells[0].id}"] ${selector}`);node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
            const editing=node.isContentEditable&&node.classList.contains('air-text-editing');node.innerText=text;node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return editing;},selector,text);
        await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[0].cells[0].chat.at(-1).kind==='prompt','text edit applied');return started;};
    const compilesBefore=compiles;
    assert.equal(await editText('.air-narrative','9月整改单共 3 条。'),true,'Double-click turns the text into an editor');
    const summaryEdit=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0];return {prompt:cell.prompt,synced:cell.recipePrompt===cell.prompt,user:cell.chat.at(-3).text,note:cell.chat.at(-2).text,edited:cell.chat.at(-1).edited,narrative:document.querySelector(`[data-cell="${cell.id}"] .air-narrative`).textContent};});
    assert.match(summaryEdit.prompt,/总结里的月份写成“X月”/);assert.equal(summaryEdit.synced,true);assert.equal(compiles,compilesBefore,'A summary edit only rewrites the summary');
    assert.equal(summaryEdit.user,'（在格子里修改）把“本月”改成了“9月”');assert.match(summaryEdit.note,/^按表述优化处理：/);assert.equal(summaryEdit.edited,true);assert.equal(summaryEdit.narrative,'本月整改单共 3 条。');
    await editText('.kit-table th','严重级别');
    const contentEdit=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0];return {prompt:cell.prompt,synced:cell.recipePrompt===cell.prompt,note:cell.chat.at(-2).text};});
    assert.match(contentEdit.prompt,/表头“级别”一律写成“严重级别”/);assert.equal(contentEdit.synced,true);assert.ok(compiles>compilesBefore,'A content edit regenerates the content');assert.match(contentEdit.note,/^按明确替换处理：/);
    const cancelled=await evaluate(()=>{const node=[...document.querySelectorAll('.air-cell .kit-table td')].find(td=>td.style.textAlign==='right'),text=node.textContent,left=()=>{const range=document.createRange();range.selectNodeContents(node);return Math.round(range.getBoundingClientRect().left);},start=left();
        node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const moved=left()-start,display=getComputedStyle(node).display;node.innerText='x';node.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return {same:node.textContent===text,editing:node.isContentEditable,busy:AiReportApp.state.busy.size,moved,display};});
    assert.deepEqual(cancelled,{same:true,editing:false,busy:0,moved:0,display:'table-cell'},'Editing keeps the text in place; Esc restores it without asking the AI');
    await evaluate(async()=>{const id=AiReportApp.state.doc.chapters[0].cells[0].id;await AiReportApp.revertPrompt(id);await AiReportApp.revertPrompt(id);});
    await until(()=>!AiReportApp.state.busy.size,'edits undone');
    assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].prompt),originalPrompt,'Undo walks back through text edits');
    // New content arrives with a splash: the old content breaks into dots that gather into the new one. Re-renders
    // that change nothing (selection, preview) do not splash, and everything is cleaned up afterwards.
    const splash=await evaluate(async()=>{const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),cell=AiReportApp.state.doc.chapters[0].cells[0];
        document.querySelector(`[data-cell="${cell.id}"]`).scrollIntoView({block:'center',behavior:'instant'});AiReportApp.render();await wait(1600);
        const quiet=document.querySelectorAll('.air-splash-dot').length;
        cell.output={...cell.output,narrative:{zh:'换一种说法：本月共 3 条整改单。',en:'3 orders.'}};AiReportApp.render();
        const dots=document.querySelectorAll('.air-splash-dot').length,ghost=document.querySelectorAll('.air-splash-ghost').length,ghostHooks=document.querySelectorAll('.air-splash-ghost [data-widget],.air-splash-ghost [data-slot]').length,cells=document.querySelectorAll('.air-cell').length;
        AiReportApp.render();const repeat=document.querySelectorAll('.air-splash-dot').length;
        await wait(1700);return {quiet,dots:dots>=36,ghost,ghostHooks,repeat:repeat<=dots,cells:cells===document.querySelectorAll('.air-cell').length,clean:!document.querySelector('.air-splash-layer'),narrative:document.querySelector(`[data-cell="${cell.id}"] .air-narrative`).textContent};});
    assert.deepEqual(splash,{quiet:0,dots:true,ghost:1,ghostHooks:0,repeat:true,cells:true,clean:true,narrative:'换一种说法：本月共 3 条整改单。'},'Changed content splashes once and cleans up');
    // Copy: the duplicate sits right after the original with the same prompt, recipe and content, and its chat opens
    // with only the final prompt (no earlier conversation).
    await evaluate(()=>document.querySelector(`[data-cell-copy="${AiReportApp.state.doc.chapters[0].cells[0].id}"]`).click());
    const copied=await evaluate(()=>{const [original,copy]=AiReportApp.state.doc.chapters[0].cells;return {different:original.id!==copy.id,prompt:copy.prompt===original.prompt,recipe:JSON.stringify(copy.recipe)===JSON.stringify(original.recipe),chat:copy.chat.length===1&&copy.chat[0].kind==='prompt'&&copy.chat[0].text===original.prompt&&original.chat.length>1,span:copy.span===original.span,table:!!document.querySelector(`[data-cell="${copy.id}"] .kit-table`),selected:AiReportApp.state.selected===copy.id,chatOpen:!document.getElementById('airChat').hidden};});
    assert.deepEqual(copied,{different:true,prompt:true,recipe:true,chat:true,span:true,table:true,selected:true,chatOpen:true});
    await evaluate(()=>{const chapter=AiReportApp.state.doc.chapters[0];chapter.cells.splice(1,1);AiReportApp.state.selected=chapter.cells[0].id;AiReportApp.render();});
    // The report keeps one fixed width (same as preview and export); the chat takes the rest of the window.
    const widths=await evaluate(()=>{const report=document.getElementById('airReport'),chat=document.getElementById('airChat'),open={report:report.getBoundingClientRect().width,chat:chat.getBoundingClientRect().width,chatRight:innerWidth-chat.getBoundingClientRect().right};
        document.querySelector('[data-chat-close]').click();const closed=report.getBoundingClientRect().width;return {open,closed};});
    assert.equal(Math.round(widths.open.report),1280);assert.equal(Math.round(widths.closed),1280,'Opening the chat never changes the report width');assert.ok(widths.open.chatRight<=24&&widths.open.chat>=360,'The chat fills the rest of the window');
    await evaluate(()=>{AiReportApp.state.selected=AiReportApp.state.doc.chapters[0].cells[0].id;AiReportApp.render();});

    // The sandbox has no network or parent access, and runaway code is stopped.
    const sandbox=await evaluate(async()=>{const attempt=async compute=>{try{return (await AiReportSandbox.run({compute,render:'function render(){return "ok"}',input:{}},{timeout:1500})).result;}catch(error){return 'error:'+error.message;}};
        return {fetch:await attempt('function compute(){ return typeof fetch; }'),parent:await attempt('function compute(){ try{ return String(parent.document.cookie); }catch(e){ return "blocked"; } }'),loop:await attempt('function compute(){ while(true){} }'),random:await attempt('function compute(){ return Math.random(); }'),
        mismatch:await (async()=>{try{await AiReportSandbox.run({compute:'function compute(){ return {rows:[{name:"TE",rate:95}]}; }',render:'function render(r,kit){ return kit.table(r.rows,{columns:[{key:"name"},{key:"回传率"}]}); }',input:{}});return 'ran';}catch(error){return error.message;}})(),
        empty:await (async()=>{const input={s1:{rows:[{level:'高'}]}},run=compute=>AiReportSandbox.run({compute,render:'function render(r,kit){ return kit.table(r.rows,{columns:[{key:"level"}]}); }',input}).then(()=>'ran',error=>error.message);
            return {filtered:await run('function compute(input){ return {rows:input.s1.rows.filter(r=>r.级别==="高")}; }'),confirmed:await run('function compute(input){ return {rows:[],emptyConfirmed:true}; }')};})(),
        example:await attempt('function compute(){ const rate = 0.98; // 示例值\n return {rate}; }'),
        ties:await Promise.all(['TE 表现最高，TE 表现最低。','ET回传率最高，ORG最低；TE备案率最优，ET备案率最差。'].map(text=>AiReportSandbox.run({compute:'function compute(){ return {rows:[1]}; }',render:`function render(){ return ${JSON.stringify(text)}; }`,input:{}}).then(()=>'ran',error=>error.message)))};});
    const twice=await evaluate(()=>Promise.all([true,false].map(summary=>AiReportSandbox.run({compute:'function compute(){ return {rows:[1]}; }',render:'function render(kit){ return "<p>本月 SR FRT 整体表现为 100，各运营商持平。</p>"; }',input:{},summary}).then(()=>'ran',error=>error.message))));
    assert.match(twice[0],/两段总结/,'With the platform summary on, render may not write a second one');assert.equal(twice[1],'ran');
    const undefinedShown=await evaluate(()=>AiReportSandbox.run({compute:'function compute(input){ return {total:input.m1.values["路由器整体"]}; }',render:'function render(r){ return "整体达成率为"+r.total+"%"; }',input:{m1:{values:{"路由器":94}}}}).then(()=>'ran',error=>error.message));
    // Nothing inside a cell scrolls: recipe styles that make scroll boxes or cap heights are neutralised.
    const noScroll=await evaluate(()=>{const cleaned=AiReportSanitize.clean('<div style="max-height:40px;overflow-y:auto">x</div><div style="overflow:scroll;color:red">y</div>');
        const cell=document.querySelector('.air-cell'),output=cell?.querySelector('.air-output');const probe=document.createElement('div');probe.innerHTML=cleaned;output?.append(probe);
        const scrollers=[...(cell?.querySelectorAll('.air-cell-body, .air-cell-body *')||[])].filter(node=>/auto|scroll/.test(getComputedStyle(node).overflowY+getComputedStyle(node).overflowX));probe.remove();
        return {cleaned,scrollers:scrollers.length};});
    assert.equal(noScroll.cleaned,'<div style="max-height:none;overflow-y:visible">x</div><div style="overflow:visible;color:red">y</div>');assert.equal(noScroll.scrollers,0,'No scroll boxes inside cells');
    assert.match(undefinedShown,/undefined[\s\S]*路由器整体/,'undefined in the content is an error naming the metric that was not found');
    assert.match(sandbox.ties[0],/同时说成最高和最低/,'Calling one item both highest and lowest (a tie) is sent back');assert.equal(sandbox.ties[1],'ran','Different measures may name the same item');
    assert.match(sandbox.empty.filtered,/计算结果是空的/,'Empty lists from input with rows are caught (wrong filter, field or source)');assert.equal(sandbox.empty.confirmed,'ran','Confirmed empty results still render');
    assert.match(sandbox.example,/示例或模拟数据/,'Example or simulated numbers are refused');
    // Wide chart paddings and the label room of a hidden axis would leave a blank strip under the plot.
    const plot=await evaluate(async()=>{const probe=document.createElement('div');probe.dataset.cell='probe';probe.style.width='400px';probe.innerHTML='<div class="kit-widget kit-widget-chart" data-widget="w0" style="height:120px"></div>';document.body.append(probe);
        const option={grid:{top:30,bottom:'10%',left:40,right:40},legend:{data:['a']},xAxis:{type:'value',show:false},yAxis:{type:'category',data:['TE','ORG','ET']},series:[{name:'a',type:'bar',data:[95,92,96]}]};
        AiReportWidgets.hydrate(probe,()=>({id:'w0',type:'chart',spec:{option}}));await new Promise(resolve=>setTimeout(resolve,100));
        const chart=echarts.getInstanceByDom(probe.querySelector('.kit-chart-canvas')),grid=chart.getModel().getComponent('grid').coordinateSystem.getRect(),gap=Math.round(chart.getHeight()-grid.y-grid.height);
        probe.remove();AiReportApp.render();return gap;});
    assert.ok(plot<=12,'The plot reaches the bottom of the chart: '+plot+'px left');
    assert.equal(sandbox.fetch,'undefined');assert.match(String(sandbox.parent),/blocked|error/);assert.match(sandbox.loop,/超时/);assert.match(sandbox.random,/随机数/,'Recipes cannot fabricate numbers');assert.match(sandbox.mismatch,/不存在的字段：回传率[\s\S]*name、rate/,'Render reading a field compute never produced is caught');

    // The whole report is one more “cell”: its style chat sits behind a hidden top-right button, and applying it themes everything — skeleton untouched.
    const chapterCount=await evaluate(()=>AiReportApp.state.doc.chapters.map(chapter=>chapter.cells.length).join());
    assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('.air-report-tools')).opacity),'0');
    await evaluate(()=>document.querySelector('[data-style-chat]').click());
    assert.match(await evaluate(()=>document.querySelector('#airChat header strong').textContent),/整体风格对话/);
    // Opening it shows the report prompt at once: the style plus the rules every cell follows, by category, ready to edit.
    const opened=await evaluate(()=>({card:document.querySelector('#airChat .air-msg-prompt')?.textContent||'',edit:!!document.querySelector('#airChat [data-edit-prompt]'),dirty:!document.querySelector('[data-air=save]').disabled}));
    assert.match(opened.card,/【风格与配色】[\s\S]*【数据与计算】[\s\S]*【文字与结论】[\s\S]*【排版与图表】/);assert.equal(opened.edit,true);
    await evaluate(()=>{const input=document.querySelector('#airChat .air-composer textarea');input.value='想要沉稳的绿色商务风';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    await until(()=>!!AiReportApp.state.doc.style.theme&&!AiReportApp.state.busy.size,'style applied');
    const themed=await evaluate(()=>{const report=document.getElementById('airReport'),rect=report.querySelector('.kit-chart rect');return {accent:report.style.getPropertyValue('--air-accent'),chart:getComputedStyle(rect).fill,font:getComputedStyle(report).fontFamily,swatches:document.querySelectorAll('#airChat .air-swatches i').length,done:document.querySelector('#airChat .air-prompt-actions').textContent,prompt:AiReportApp.state.doc.style.prompt};});
    assert.equal(themed.accent,'#1e6b4f');assert.equal(themed.chart,'rgb(30, 107, 79)','Existing charts take the theme colours');assert.match(themed.font,/Songti|serif/);assert.ok(themed.swatches>=6);assert.match(themed.done,/已应用到整份月报/);
    assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters.map(chapter=>chapter.cells.length).join()),chapterCount,'Style never changes the skeleton');
    // Cells carry the style prompt as context when they compile or summarise.
    await evaluate(id=>document.querySelector(`[data-cell-run="${id}"]`).click(),await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].id));
    await wait(50);await until(()=>!AiReportApp.state.busy.size,'rerun done');
    assert.ok(aiCalls.some(call=>call.system.startsWith('你为月报格子写总结')&&/月报整体风格/.test(call.last.content)&&/绿色商务风/.test(call.last.content)&&/【文字与结论】/.test(call.last.content)),'Summary request includes the report style and the rules for every cell');
    assert.match(await evaluate(()=>AiReportApp.state.doc.style.prompt),/^【风格与配色】\n- 整体为沉稳的绿色商务风[\s\S]*【数据与计算】/,'A changed style keeps every rule');
    // A chapter style prompt restyles the chapter's cells (render only): compute and numbers stay exactly as they were.
    const restyleBefore=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0];return {compute:cell.recipe.compute,result:JSON.stringify(cell.output.result)};});
    await evaluate(()=>document.querySelector('[data-air=save]').click());await until(()=>document.querySelector('[data-air=save]').disabled,'saved before chapter style');
    await evaluate(id=>document.querySelector(`[data-chapter-style="${id}"]`).click(),await evaluate(()=>AiReportApp.state.doc.chapters[0].id));
    assert.match(await evaluate(()=>document.querySelector('#airChat header strong').textContent),/章节样式对话/);
    assert.equal(await evaluate(()=>document.querySelector('[data-air=save]').disabled),true,'Opening an empty chapter style chat is not an unsaved change');
    await evaluate(()=>{const input=document.querySelector('#airChat .air-composer textarea');input.value='标题统一加个前缀';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    await until(()=>!!AiReportApp.state.doc.chapters[0].style?.appliedPrompt&&!AiReportApp.state.busy.size,'chapter style applied');
    const restyled=await evaluate(()=>{const chapter=AiReportApp.state.doc.chapters[0],cell=chapter.cells[0];return {compute:cell.recipe.compute,result:JSON.stringify(cell.output.result),html:cell.output.html,prompt:chapter.style.prompt,done:document.querySelector('#airChat .air-prompt-actions').textContent,set:document.querySelector(`[data-chapter-style="${chapter.id}"]`).classList.contains('is-set'),other:AiReportApp.state.doc.chapters[1].cells.every(item=>!item.output||!/▍章节样式/.test(item.output.html))};});
    assert.equal(restyled.compute,restyleBefore.compute,'Restyling keeps compute');assert.equal(restyled.result,restyleBefore.result,'Restyling keeps the numbers');
    assert.match(restyled.html,/▍章节样式/);assert.match(restyled.prompt,/▍/);assert.match(restyled.done,/已应用到本章节/);assert.equal(restyled.set,true);assert.equal(restyled.other,true,'Other chapters are untouched');
    assert.ok(aiCalls.some(call=>/这是一次章节样式统一/.test(call.last.content)&&/【本章节样式要求】/.test(call.last.content)),'Restyle carries the chapter style');
    // One click recomputes every generated cell (or one chapter's) with this month's data, without compiling again.
    const compilesBeforeRefresh=compiles,narrativesBefore=aiCalls.filter(call=>call.system.startsWith('你为月报格子写总结')).length;
    await evaluate(id=>document.querySelector(`[data-chapter-refresh="${id}"]`).click(),await evaluate(()=>AiReportApp.state.doc.chapters[0].id));
    await wait(50);await until(()=>!AiReportApp.state.busy.size,'chapter refresh');
    await evaluate(()=>document.querySelector('[data-refresh-all]').click());
    await wait(50);await until(()=>!AiReportApp.state.busy.size,'refresh all');
    assert.equal(compiles,compilesBeforeRefresh,'Refreshing never recompiles');
    assert.ok(aiCalls.filter(call=>call.system.startsWith('你为月报格子写总结')).length>=narrativesBefore+2,'Refreshing rewrites the summaries');
    assert.match(await evaluate(()=>document.getElementById('airStatus').textContent),/刷新/);
    // The last run's failure is shown in the chat with a hint; developer mode records every exchange with the AI.
    const firstId=await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].id);
    await evaluate(id=>document.querySelector(`[data-cell-chat="${id}"]`).click(),firstId);
    const failure=await evaluate(id=>{const cell=AiReportApp.find(id).cell,saved=cell.output.error;cell.output.error='Failed to fetch';AiReportApp.render();const node=document.querySelector('#airChat .air-chat-failure');const text=node?.textContent||'';cell.output.error=saved;AiReportApp.render();return {text,gone:!document.querySelector('#airChat .air-chat-failure')};},firstId);
    assert.match(failure.text,/最近一次运行失败[\s\S]*Failed to fetch[\s\S]*没有连上服务器/);assert.equal(failure.gone,true);
    assert.equal(await evaluate(()=>!!document.querySelector('#airChat .air-dev')),false,'Developer mode is off by default');
    await evaluate(()=>document.querySelector('#airChat [data-dev-toggle]').click());
    assert.match(await evaluate(()=>document.querySelector('#airChat .air-dev').textContent),/还没有记录/);
    await evaluate(()=>document.querySelector('#airChat [data-try]').click());
    await wait(50);await until(()=>!AiReportApp.state.busy.size&&AiReportTrace.list(AiReportApp.state.selected).some(entry=>entry.kind==='call'&&entry.steps.length),'trace recorded');
    const dev=await evaluate(()=>{const list=AiReportTrace.list(AiReportApp.state.selected),call=list.find(entry=>entry.kind==='call'&&entry.steps.some(step=>step.kind==='ai'));const ai=call.steps.find(step=>step.kind==='ai');return {label:call.label,system:ai.system.slice(0,40),hasReply:'reply' in ai,tool:call.steps.some(step=>step.kind==='tool'&&step.name==='list_sources'),entries:document.querySelectorAll('#airChat .air-dev-entry').length,note:list.some(entry=>entry.kind==='note'&&/运行配方/.test(entry.label))};});
    assert.match(dev.label,/编译配方/);assert.match(dev.system,/编译成一个可以每月重复运行的配方/);assert.equal(dev.hasReply,true);assert.equal(dev.tool,true,'Tool calls are recorded');assert.ok(dev.entries>=2);assert.equal(dev.note,true,'Local sandbox runs are recorded');
    // Full screen: the whole text, an AI summary, and asking about a selected passage.
    await evaluate(()=>document.querySelector('#airChat .air-dev-entry [data-dev-full]').click());
    assert.match(await evaluate(()=>document.querySelector('.air-tv-text').textContent),/发送给模型[\s\S]*模型返回/);
    await evaluate(()=>document.querySelector('[data-tv-summary]').click());
    await until(()=>/这一步在编译配方/.test(document.querySelector('.air-tv-answer')?.textContent||''),'trace summary');
    await evaluate(()=>{const text=document.querySelector('.air-tv-text'),range=document.createRange();range.setStart(text.firstChild,0);range.setEnd(text.firstChild,20);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);text.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
    await until(()=>!!document.querySelector('.air-tv-select [data-tv-ask]'),'selection bar');
    await evaluate(()=>{document.querySelector('[data-tv-ask]').click();const input=document.querySelector('.air-tv-ask input');input.value='这段是做什么的';document.querySelector('.air-tv-ask').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await until(()=>document.querySelectorAll('.air-tv-answer').length===2&&!document.querySelector('.air-tv-answer.is-busy'),'selection answer');
    assert.match(await evaluate(()=>document.querySelector('.air-tv-answer h4').textContent),/这段是做什么的/);
    await evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    assert.equal(await evaluate(()=>!!document.querySelector('.air-tv')),false,'Esc closes the viewer');
    await evaluate(()=>document.querySelector('#airChat [data-dev-toggle]').click());
    assert.equal(await evaluate(()=>!!document.querySelector('#airChat .air-dev')),false);
    // Header fields have their own conversation (from the ✦ at the field's corner), like cells: fixed text needs no AI;
    // a generated prompt is filled in for the month and follows month changes; typing over the text makes it fixed again.
    const metaId=await evaluate(()=>AiReportApp.state.doc.template.meta[0].id),key='meta-value:'+metaId;
    const fieldCalls=()=>aiCalls.filter(call=>call.system.startsWith('你为月报开头的一个字段')).length,fieldCallsBefore=fieldCalls();
    const say=async text=>{await evaluate(text=>{const input=document.querySelector('#airChat .air-composer textarea');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));},text);await wait(50);await until(()=>!AiReportApp.state.busy.size,'field chat');};
    await evaluate(key=>document.querySelector(`[data-field-prompt="${key}"]`).click(),key);
    assert.match(await evaluate(()=>document.querySelector('#airChat header').textContent),/字段对话[\s\S]*月报开头/);
    await say('固定写成 埃及网络保障部');
    assert.equal(await evaluate(()=>AiReportApp.state.doc.template.meta[0].value.zh),'埃及网络保障部');
    assert.equal(fieldCalls(),fieldCallsBefore,'Fixed text needs no AI call');
    assert.match(await evaluate(()=>document.querySelector('#airChat .air-msg-prompt').textContent),/字段提示词[\s\S]*固定文字：埃及网络保障部[\s\S]*已写入月报开头/);
    await say('改成报告月份的下一个月');
    assert.equal(await evaluate(()=>AiReportApp.state.doc.template.meta[0].value.zh),'202610');
    assert.equal(await evaluate(key=>document.querySelector(`[data-field-prompt="${key}"]`).closest('.air-field').classList.contains('is-generated'),key),true);
    await evaluate(()=>{const input=document.getElementById('airMonth');input.value='2026-10';input.dispatchEvent(new Event('change'));});
    await until(()=>AiReportApp.state.doc.template.meta[0].value.zh==='202611'&&!AiReportApp.state.busy.size,'field follows month');
    await evaluate(()=>{const input=document.getElementById('airMonth');input.value='2026-09';input.dispatchEvent(new Event('change'));});
    await until(()=>AiReportApp.state.doc.template.meta[0].value.zh==='202610'&&!AiReportApp.state.busy.size,'field back');
    await evaluate(key=>{const node=document.querySelector(`[data-edit="${key}"]`);node.textContent='手写的文字';node.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));},key);
    const typed=await evaluate(key=>{const record=AiReportApp.state.doc.template.fields[key];return {prompt:record.prompt,last:record.chat.at(-1).text,count:record.chat.filter(item=>item.kind==='prompt').length};},key);
    assert.deepEqual(typed,{prompt:'固定文字：手写的文字',last:'固定文字：手写的文字',count:3},'Typing over a field makes its prompt fixed text, kept in the field conversation');
    // The logo has an image conversation: fixed steps as buttons, and typed wishes go to the AI, which draws an SVG.
    // Clicking the logo opens its image conversation with the picker at the bottom: history page 1 plus the next steps.
    await evaluate(()=>document.querySelector('[data-image-chat="logo"]').click());
    await wait(50);await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.template.images?.logo?.chat.at(-1)?.kind==='gallery','picker on open');
    const imageIntro=await evaluate(()=>({head:document.querySelector('#airChat header').textContent,current:!!document.querySelector('#airChat .air-img-current img'),base:document.querySelector('#airChat .air-img-base')?.textContent||'',actions:[...document.querySelectorAll('#airChat .air-msg-pictures:last-of-type [data-choice]')].map(button=>button.textContent)}));
    assert.match(imageIntro.head,/图片对话/);assert.equal(imageIntro.current,true);assert.match(imageIntro.base,/1:1/);assert.deepEqual(imageIntro.actions,['上传本地图片','用 AI 生成新图片','调整显示大小']);
    // Clicking the logo again does not stack a second picker on top of the first.
    await evaluate(()=>document.querySelector('[data-image-chat="logo"]').click());await wait(100);
    assert.equal(await evaluate(()=>AiReportApp.state.doc.template.images.logo.chat.filter(item=>item.kind==='gallery').length),1);
    await say('画一个蓝色盾牌');
    const drawn=await evaluate(()=>{const record=AiReportApp.state.doc.template.images.logo,last=record.chat.at(-1);return {prompt:record.prompt,kind:last.kind,url:last.images?.[0]?.url||'',choices:last.choices};});
    assert.equal(drawn.prompt,'蓝色盾牌图形');assert.equal(drawn.kind,'image');assert.match(drawn.url,/^\/api\/ai-report\/images\/[-\w]+$/);assert.deepEqual(drawn.choices,['用这张替换','再画一张','保留原来的']);
    assert.match(await evaluate(async url=>{const response=await fetch(url);return response.headers.get('content-type')+' '+response.headers.get('content-security-policy');},drawn.url),/image\/svg\+xml.*default-src 'none'/);
    await evaluate(()=>[...document.querySelectorAll('#airChat [data-choice]')].find(button=>button.textContent==='用这张替换').click());
    assert.equal(await evaluate(()=>AiReportApp.state.doc.template.logo),drawn.url,'The drawn image becomes the logo');
    await evaluate(()=>document.querySelector('[data-image-chat="logo"]').click());
    await wait(50);await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.template.images.logo.chat.at(-1).kind==='gallery','picker again at the bottom');
    // Upload (the file picker itself needs a person, so the upload request is sent directly), then pick it from history.
    const uploaded=await evaluate(async()=>{const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),'dot.png');const response=await fetch('/api/ai-report/images',{method:'POST',body:form});return response.json();});
    assert.match(uploaded.url,/^\/api\/ai-report\/images\//);
    const rejected=await evaluate(async()=>{const form=new FormData();form.append('file',new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],{type:'image/svg+xml'}),'bad.svg');const response=await fetch('/api/ai-report/images',{method:'POST',body:form});return response.status;});
    assert.equal(rejected,400,'An SVG with a script is refused');
    // A picker is already at the bottom (from clicking the logo); asking for history again loads a fresh page with the upload.
    await say('从历史图片中选择');
    await until(()=>!!document.querySelector('#airChat .air-img-gallery')&&!AiReportApp.state.busy.size,'gallery');
    assert.ok(await evaluate(()=>document.querySelectorAll('#airChat .air-img-gallery [data-pick-image]').length)>=2,'History lists drawn and uploaded images');
    // Picking previews in place: switching back and forth adds no messages, the last pick stays and is highlighted.
    const messagesBefore=await evaluate(()=>AiReportApp.state.doc.template.images.logo.chat.length),undoBefore=await evaluate(()=>AiReportApp.state.doc.template.images.logo.undo?.length||0);
    await evaluate(url=>document.querySelector(`#airChat [data-pick-image="${url}"]`).click(),uploaded.url);
    await evaluate(url=>[...document.querySelectorAll('#airChat [data-pick-image]')].find(button=>button.dataset.pickImage!==url).click(),uploaded.url);
    await evaluate(url=>document.querySelector(`#airChat [data-pick-image="${url}"]`).click(),uploaded.url);
    const picking=await evaluate(url=>({logo:AiReportApp.state.doc.template.logo,messages:AiReportApp.state.doc.template.images.logo.chat.length,picked:document.querySelector(`#airChat [data-pick-image="${url}"]`).classList.contains('is-picked'),undo:AiReportApp.state.doc.template.images.logo.undo.length,note:document.querySelector('#airChat .air-img-picked').textContent}),uploaded.url);
    assert.equal(picking.logo,uploaded.url,'Picking from history replaces the logo');assert.equal(picking.messages,messagesBefore,'Picking adds no messages');assert.equal(picking.picked,true);assert.match(picking.note,/正在使用/);
    assert.equal(picking.undo,undoBefore+1,'A run of picks is one undo step');
    await evaluate(()=>[...document.querySelectorAll('#airChat [data-choice]')].find(button=>button.textContent==='调整显示大小').click());
    await evaluate(()=>[...document.querySelectorAll('#airChat [data-choice]')].find(button=>/160px/.test(button.textContent)).click());
    assert.equal(await evaluate(()=>AiReportApp.state.doc.template.logoWidth),160);
    // Undo walks back one change at a time: first the size, then the picture picked from history.
    assert.ok(await evaluate(()=>!!document.querySelector('#airChat .air-img-undo')),'An undo button sits next to the current picture');
    await evaluate(()=>document.querySelector('#airChat .air-img-undo').click());
    assert.deepEqual(await evaluate(()=>({url:AiReportApp.state.doc.template.logo,width:AiReportApp.state.doc.template.logoWidth})),{url:uploaded.url,width:120});
    await evaluate(()=>[...document.querySelectorAll('#airChat [data-choice]')].find(button=>button.textContent==='撤回上一次更换').click());
    assert.equal(await evaluate(()=>AiReportApp.state.doc.template.logo),drawn.url,'Undo again returns to the picture before');
    // Developer mode records the field conversation like a cell's.
    await evaluate(()=>AiReportTrace.setEnabled(true));await evaluate(key=>document.querySelector(`[data-field-prompt="${key}"]`).click(),key);
    await say('改成报告月份的下一个月');
    assert.ok(await evaluate(key=>AiReportTrace.list('field:'+key).some(entry=>entry.label==='字段对话'&&entry.steps.some(step=>step.kind==='ai'))&&!!document.querySelector('#airChat .air-dev-entry'),key),'Field chat is traced');
    await evaluate(()=>AiReportTrace.setEnabled(false));
    // Back to fixed text, so later month switches stay free of AI calls.
    await evaluate(key=>{const node=document.querySelector(`[data-edit="${key}"]`);node.textContent='埃及网络保障部';node.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));},key);
    // Troubleshooting details stay folded under each prompt, including earlier ones in the history.
    await evaluate(()=>document.querySelector(`[data-cell-chat="${AiReportApp.state.doc.chapters[0].cells[0].id}"]`).click());
    const details=await evaluate(()=>{const all=[...document.querySelectorAll('#airChat .air-msg-prompt .air-recipe')];return {count:all.length,open:all.some(item=>item.open),label:all[0]?.querySelector('summary').textContent,code:!!all[0]?.querySelector('.air-recipe-code pre')};});
    assert.ok(details.count>=1);assert.equal(details.open,false,'Folded by default');assert.equal(details.label,'排查信息');assert.equal(details.code,true);
    const exportedThemed=await evaluate(async()=>AiReportExport.standalone(AiReportApp.state.doc,{lang:'zh',t:zh=>zh}));
    assert.match(exportedThemed,/--kit-c0:#1e6b4f/,'Exports keep the theme');
    // The frame and the lines between cells come from the theme: double frame and lines by default, both can be turned off.
    const framing=await evaluate(async()=>{const report=document.getElementById('airReport'),style=AiReportApp.state.doc.style,before=style.theme;
        const read=()=>({frame:report.dataset.frame,dividers:report.dataset.dividers,lines:report.querySelectorAll('.air-divider').length,inner:getComputedStyle(report,'::after').borderTopStyle});
        const chapter=AiReportApp.state.doc.chapters[3],extra=[AiReportModel.cell({span:6}),AiReportModel.cell({span:6})];chapter.cells.push(...extra);
        style.theme={...before,frame:'double',dividers:'line'};AiReportApp.render();const on=read();const exported=await AiReportExport.standalone(AiReportApp.state.doc,{lang:'zh',t:zh=>zh});chapter.cells.splice(-2);
        style.theme={...before,frame:'none',dividers:'none'};AiReportApp.render();const off=read();
        style.theme={...before,frame:'double',dividers:'line'};AiReportApp.render();return {on,off,exported:/<article class="air-report is-preview" data-frame="double" data-dividers="line"/.test(exported)&&/class="air-divider air-divider-v"/.test(exported)};});
    assert.equal(framing.on.frame,'double');assert.equal(framing.on.inner,'solid','A fine inner rule inside the outer one');assert.ok(framing.on.lines>0,'Lines run between cells');
    assert.deepEqual([framing.off.frame,framing.off.dividers,framing.off.lines],['none','none',0]);
    assert.equal(framing.exported,true,'Exports keep the frame and the lines');
    // Cells that read the report: a quick navigation built from the outline (links jump to the chapter and follow
    // renames), and an overview built from the other cells' summaries that follows their changes.
    const crossCell=await evaluate(async()=>{const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),doc=AiReportApp.state.doc,month=doc.reportMonth;
        const nav=AiReportModel.cell({span:12,prompt:'快速跳转'}),overview=AiReportModel.cell({span:12,prompt:'总览'});doc.chapters[0].cells.unshift(overview,nav);
        nav.recipe=AiReportModel.normalizeRecipe({summary:'导航',sources:[{id:'r1',kind:'report',include:'outline'}],compute:'function compute(input){ return {items:input.r1.chapters.map(chapter=>({label:chapter.title,anchor:chapter.anchor,no:chapter.no}))}; }',render:'function render(r,kit){ return kit.nav(r.items,{title:"快速跳转"}); }'});
        overview.recipe=AiReportModel.normalizeRecipe({summary:'总览',sources:[{id:'r1',kind:'report',include:'results'}],compute:'function compute(input){ const cells=input.r1.chapters.flatMap(chapter=>chapter.cells).filter(cell=>cell.summary); return {rows:cells.map(cell=>({title:cell.title,summary:cell.summary,anchor:cell.anchor}))}; }',render:'function render(r,kit){ return r.rows.map(row=>kit.link(row.summary,row.anchor)).join("<br>"); }',narrative:{prompt:'概括全部'}});
        await AiReportRunner.run(nav,month,{withNarrative:false});await AiReportRunner.run(overview,month,{withNarrative:false});overview.output={...overview.output,narrativeMonth:month,narrative:{zh:'总览总结',en:'x'}};AiReportApp.render();await wait(700);
        const navNode=()=>document.querySelector(`[data-cell="${nav.id}"]`),links=[...navNode().querySelectorAll('a.kit-nav-item')].map(link=>({text:link.textContent,href:link.getAttribute('href')}));
        const second=doc.chapters[1];navNode().querySelectorAll('a.kit-nav-item')[1].click();await wait(900);
        const target=document.getElementById('air-chapter-'+second.id),landed=Math.round(target.getBoundingClientRect().top),flashed=target.classList.contains('is-jump-target');
        const overviewLinks=document.querySelectorAll(`[data-cell="${overview.id}"] a.kit-link`).length,seesItself=JSON.stringify(overview.output.result).includes(overview.id);
        second.title={zh:'改名后的章节',en:'Renamed'};AiReportApp.render();await wait(900);
        const renamed=navNode().textContent.includes('改名后的章节');
        const source=doc.chapters[0].cells.find(cell=>cell.output?.narrative?.zh&&cell.id!==overview.id&&cell.id!==nav.id);source.output={...source.output,narrative:{zh:'变化后的总结。',en:'x'}};AiReportApp.render();await wait(1200);
        const followed=JSON.stringify(overview.output.result).includes('变化后的总结'),stale=overview.output.narrativeMonth==='';
        doc.chapters[0].cells.splice(0,2);AiReportApp.render();
        return {links:links.length===doc.chapters.length&&links[0].href==='#air-chapter-'+doc.chapters[0].id&&/^01/.test(links[0].text),landed:landed>=0&&landed<200,flashed,overviewLinks:overviewLinks>0,seesItself,renamed,followed,stale};});
    assert.deepEqual(crossCell,{links:true,landed:true,flashed:true,overviewLinks:true,seesItself:false,renamed:true,followed:true,stale:true},'Navigation and overview cells read the report and follow its changes');
    // A chapter can go without a number (overview, navigation): the others count on without gaps, and the outline that
    // navigation cells read marks it so it is left out.
    const numbering=await evaluate(()=>{const doc=AiReportApp.state.doc,first=doc.chapters[0],numbers=()=>[...document.querySelectorAll('.air-chapter')].slice(0,3).map(node=>node.querySelector('.air-chapter-no')?.textContent||'');
        document.querySelector(`[data-chapter-numbering="${first.id}"]`).click();const off=numbers(),pressed=document.querySelector(`[data-chapter-numbering="${first.id}"]`).getAttribute('aria-pressed');
        const outline=AiReportRunner.reportInput(null,{include:'outline',chapters:[]}).chapters.slice(0,2).map(chapter=>({no:chapter.no,numbered:chapter.numbered}));
        document.querySelector(`[data-chapter-numbering="${first.id}"]`).click();
        document.querySelector(`[data-chapter-heading="${first.id}"]`).click();const section=document.querySelector(`[data-chapter="${first.id}"]`),list=document.createElement('ol');list.className='kit-list';list.innerHTML=Array.from({length:12},(_,i)=>`<li>item ${i}</li>`).join('');section.querySelector('.air-cell-body')?.append(list);
        const headless={numbers:numbers(),cls:section.classList.contains('is-headless'),numbered:AiReportRunner.reportInput(null,{include:'outline',chapters:[]}).chapters[0].numbered,titleShown:getComputedStyle(section.querySelector('h2 [data-edit]')).display!=='none',boxed:getComputedStyle(section).borderTopStyle==='solid',markerRoom:parseFloat(getComputedStyle(list).paddingLeft)>=30};list.remove();
        document.querySelector('[data-air=preview]').click();headless.hiddenInPreview=getComputedStyle(document.querySelector(`[data-chapter="${first.id}"] h2`)).display==='none';document.querySelector('[data-air=preview]').click();
        document.querySelector(`[data-chapter-heading="${first.id}"]`).click();return {off,pressed,outline,on:numbers(),stored:AiReportModel.normalize(doc).chapters[0].numbered,headless};});
    assert.deepEqual(numbering,{off:['','01','02'],pressed:'false',outline:[{no:'',numbered:false},{no:'01',numbered:true}],on:['01','02','03'],stored:undefined,headless:{numbers:['','01','02'],cls:true,numbered:false,titleShown:false,boxed:true,markerRoom:true,hiddenInPreview:true}},'Unnumbered and title-less chapters are skipped by the numbering and marked in the outline');
    // A requirement for the whole report said in a cell can be added to the report prompt with one click.
    const ruleCell=await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].id);
    await evaluate(id=>{AiReportApp.converse(id,'以后所有总结都不超过两句');},ruleCell);
    await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[0].cells[0].chat.at(-1).purpose==='rule','rule offered');
    await evaluate(id=>{const choice=[...document.querySelectorAll('#airChat [data-choice]')].find(button=>/加入整体提示词/.test(button.textContent));choice.click();},ruleCell);
    await until(()=>/已加入月报整体风格提示词/.test(AiReportApp.state.doc.chapters[0].cells[0].chat.at(-1).text),'rule added');
    const ruled=await evaluate(()=>({prompt:AiReportApp.state.doc.style.prompt,versions:AiReportApp.state.doc.style.chat.filter(item=>item.kind==='prompt').length}));
    assert.match(ruled.prompt,/【文字与结论】[^【]*- 文字总结不超过两句。/,'The rule lands in its category');assert.ok(ruled.versions>=2,'As a new version that can be undone');
    await evaluate(()=>document.querySelector('[data-chat-close]').click());
    // Interactive widgets: the recipe only emits specs; the page renders ECharts, a sortable/searchable/paged table and tabs.
    await evaluate(async()=>{const chapter=AiReportApp.state.doc.chapters[1];const cell=AiReportModel.cell({span:12,prompt:'交互演示'});chapter.cells.unshift(cell);
        cell.recipe=AiReportModel.normalizeRecipe({summary:'交互',sources:[],compute:'function compute(){ const rows=[]; for(let i=1;i<=25;i++) rows.push({name:"项目"+i, value:i*3}); return {rows}; }',
            render:'function render(r,kit){ const chart=kit.chart({xAxis:{type:"category",data:r.rows.map(x=>x.name)},yAxis:{type:"value"},series:[{type:"bar",name:"数量<img src=x onerror=alert(1)>",data:r.rows.map(x=>x.value)}],dataZoom:[{type:"inside"}]},{title:"交互柱图",height:260}); return kit.tabs([{label:"图表",html:chart},{label:"明细",html:kit.datatable(r.rows,{columns:[{key:"name",label:"名称"},{key:"value",label:"数值"}],pageSize:10})}]); }'});
        await AiReportRunner.run(cell,AiReportApp.state.doc.reportMonth,{withNarrative:false});AiReportApp.state.interactiveCell=cell.id;AiReportApp.render();});
    // Hover never hides shapes: CSS variables in ECharts colours are resolved, and transparent/near-zero hover states are lifted.
    const hover=await evaluate(async()=>{const chapter=AiReportApp.state.doc.chapters[1];const cell=AiReportModel.cell({span:12,prompt:'悬停'});chapter.cells.unshift(cell);
        cell.recipe=AiReportModel.normalizeRecipe({summary:'悬停',sources:[],compute:'function compute(){ return {}; }',render:'function render(r,kit){ return kit.chart({xAxis:{type:"category",data:["A","B","C"]},yAxis:{type:"value"},series:[{type:"bar",data:[3,5,4],itemStyle:{color:"var(--air-accent)"},emphasis:{focus:"series",itemStyle:{color:"transparent"}},blur:{itemStyle:{opacity:0}}}]},{height:220}); }'});
        await AiReportRunner.run(cell,AiReportApp.state.doc.reportMonth,{withNarrative:false});AiReportApp.render();
        const canvas=document.querySelector(`[data-cell="${cell.id}"] .kit-chart-canvas`),chart=echarts.getInstanceByDom(canvas),series=chart.getOption().series[0];
        await new Promise(resolve=>setTimeout(resolve,700));chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:1});await new Promise(resolve=>setTimeout(resolve,400));
        const fills=[...canvas.querySelectorAll('path')].filter(path=>{const box=path.getBoundingClientRect();return box.width>20&&box.height>20&&box.width<canvas.clientWidth*0.8;}).map(path=>({fill:path.getAttribute('fill'),opacity:Number(path.getAttribute('fill-opacity')??path.getAttribute('opacity')??1)}));
        chapter.cells=chapter.cells.filter(item=>item.id!==cell.id);AiReportApp.render();
        return {color:series.itemStyle.color,emphasis:series.emphasis?.itemStyle?.color??null,blur:series.blur.itemStyle.opacity,fills};});
    assert.match(hover.color,/^#[0-9a-f]{6}$/i,'var() colours are resolved to real colours');assert.equal(hover.emphasis,null,'A transparent hover colour is dropped');assert.ok(hover.blur>=0.35,'Blurred shapes stay visible');
    assert.equal(hover.fills.length,3);assert.ok(hover.fills.every(item=>item.fill&&!/none|transparent/i.test(item.fill)&&item.opacity>=0.35),'Every bar is still visible while one is hovered: '+JSON.stringify(hover.fills));
    const widgetsLive=await evaluate(()=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.interactiveCell}"]`),chartEl=node.querySelector('.kit-widget-chart .kit-chart-canvas'),instance=echarts.getInstanceByDom(chartEl);
        const tabs=[...node.querySelectorAll('.kit-tabs button')];tabs[1].click();const table=node.querySelector('.kit-widget-datatable');
        const before={pager:table.querySelector('.kit-dt-pager span').textContent,rows:table.querySelectorAll('tbody tr').length,panelHidden:node.querySelectorAll('.kit-tab-panel')[0].hidden};
        const input=table.querySelector('input');input.value='项目2';input.dispatchEvent(new Event('input'));const searched=table.querySelector('.kit-dt-count').textContent;input.value='';input.dispatchEvent(new Event('input'));
        table.querySelectorAll('th')[1].click();table.querySelectorAll('th')[1].click();const top=table.querySelector('tbody tr td:last-child').textContent;
        return {instance:!!instance,color:instance?.getOption().color[0],seriesName:instance?.getOption().series[0].name,svg:!!chartEl.querySelector('svg'),tabs:tabs.length,...before,searched,top};});
    assert.equal(widgetsLive.instance,true);assert.equal(widgetsLive.svg,true);assert.equal(widgetsLive.color,'#1e6b4f','Charts use the report theme');assert.equal(widgetsLive.seriesName.includes('<'),false,'Spec strings cannot carry HTML');
    assert.equal(widgetsLive.tabs,2);assert.equal(widgetsLive.panelHidden,true);assert.equal(widgetsLive.pager,'1 / 3');assert.equal(widgetsLive.rows,10);assert.equal(widgetsLive.searched,'共 7 条');assert.equal(widgetsLive.top,'75','Sorting descending by value');
    const staticExport=await evaluate(async()=>AiReportExport.standalone(AiReportApp.state.doc,{lang:'zh',t:zh=>zh}));
    assert.ok(!/<script/i.test(staticExport)&&/<svg[^>]*kit-chart/.test(staticExport)&&(staticExport.match(/项目\d+/g)||[]).length>=25,'Mail export freezes charts to SVG and tables to all rows');
    const liveExport=await evaluate(async()=>AiReportExport.standalone(AiReportApp.state.doc,{lang:'zh',t:zh=>zh,interactive:true}));
    fs.writeFileSync(path.join(temp,'interactive.html'),liveExport);
    const exportWin=new BrowserWindow({show:false,width:1300,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false}});await exportWin.loadFile(path.join(temp,'interactive.html'));
    const exportedLive=await exportWin.webContents.executeJavaScript(`new Promise(r=>setTimeout(()=>r({chart:!!echarts.getInstanceByDom(document.querySelector('.kit-chart-canvas')),pager:document.querySelector('.kit-dt-pager span')?.textContent}),300))`);exportWin.destroy();
    assert.deepEqual(exportedLive,{chart:true,pager:'1 / 3'},'Exported HTML stays interactive offline');
    await evaluate(()=>{const chapter=AiReportApp.state.doc.chapters[1];chapter.cells=chapter.cells.filter(cell=>cell.id!==AiReportApp.state.interactiveCell);AiReportApp.render();});
    // Layout slots: sub-blocks sized by the platform. Dragging applies exact sizes at once, with no AI call, and syncs the prompt.
    await evaluate(async()=>{const chapter=AiReportApp.state.doc.chapters[1];const cell=AiReportModel.cell({span:12,prompt:'回传率对比'});chapter.cells.unshift(cell);
        cell.recipe=AiReportModel.normalizeRecipe({summary:'槽位',sources:[],compute:'function compute(){ return {rows:[{name:"TE",rate:95},{name:"ORG",rate:92},{name:"ET",rate:96}]}; }',
            render:'function render(r,kit){ return kit.layout([[{id:"chart",title:"运营商对比",width:55,html:kit.chart({xAxis:{type:"category",data:r.rows.map(x=>x.name)},yAxis:{type:"value"},series:[{type:"bar",data:r.rows.map(x=>x.rate)}]},{title:"运营商对比",height:320})},{id:"table",width:45,html:kit.table(r.rows,{columns:[{key:"name",label:"运营商"},{key:"rate",label:"回传率"}]})}],[{id:"summary",html:kit.text("总结：ET 最高。")}]]); }'});
        cell.prompt='回传率对比';cell.recipePrompt=cell.prompt;cell.chat=[{role:'user',text:'回传率对比'},{role:'ai',kind:'prompt',text:'回传率对比'}];
        await AiReportRunner.run(cell,AiReportApp.state.doc.reportMonth,{withNarrative:false});AiReportApp.state.slotCell=cell.id;AiReportApp.state.selected=cell.id;AiReportApp.render();});
    await wait(300);const slotCalls=aiCalls.length;
    const slotSetup=await evaluate(()=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.slotCell}"]`);node.scrollIntoView({block:'center',behavior:'instant'});return {slots:[...node.querySelectorAll('[data-slot]')].map(slot=>slot.dataset.slot),edges:node.querySelectorAll('[data-slot-resize]').length,tag:node.querySelector('.kit-slot-tag').textContent};});
    assert.deepEqual(slotSetup.slots,['chart','table','summary']);assert.equal(slotSetup.edges,4,'Width handle between chart and table, height handle on every block');assert.match(slotSetup.tag,/chart · 运营商对比/);
    const widthDrag=await evaluate(async()=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.slotCell}"]`),chart=node.querySelector('[data-slot="chart"]'),edge=chart.querySelector('[data-slot-resize="x"]'),row=chart.parentElement.getBoundingClientRect(),box=chart.getBoundingClientRect();
        edge.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:box.right,clientY:box.top+20}));dispatchEvent(new PointerEvent('pointermove',{clientX:row.left+row.width*0.6+1,clientY:box.top+20}));
        await new Promise(resolve=>requestAnimationFrame(()=>resolve()));// moves are applied once per frame
        const badge=chart.querySelector('.kit-slot-badge').textContent;dispatchEvent(new PointerEvent('pointerup',{}));
        const cell=AiReportApp.state.doc.chapters[1].cells[0];return {badge,layout:cell.layout,prompt:cell.prompt,synced:cell.recipePrompt===cell.prompt,note:cell.chat.at(-1).text};});
    assert.match(widthDrag.badge,/^60% · 40%$/,'Width snaps to 5% steps');assert.deepEqual([widthDrag.layout.chart.width,widthDrag.layout.table.width],[60,40]);
    assert.match(widthDrag.prompt,/【格子内部布局】[\s\S]*chart（运营商对比）宽 60%、高度自动；table 宽 40%/);assert.equal(widthDrag.synced,true,'The recipe stays current: no regeneration needed');assert.match(widthDrag.note,/已按你的调整固定小格子尺寸/);
    const heightDrag=await evaluate(()=>{const chart=document.querySelector(`[data-cell="${AiReportApp.state.slotCell}"] [data-slot="chart"]`),edge=chart.querySelector('[data-slot-resize="y"]'),box=chart.getBoundingClientRect();
        edge.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:box.left+40,clientY:box.bottom}));dispatchEvent(new PointerEvent('pointermove',{clientX:box.left+40,clientY:box.top+220}));dispatchEvent(new PointerEvent('pointerup',{}));
        const fresh=document.querySelector(`[data-cell="${AiReportApp.state.slotCell}"] [data-slot="chart"]`),cell=AiReportApp.state.doc.chapters[1].cells[0];
        return {height:cell.layout.chart.height,slot:Math.round(fresh.getBoundingClientRect().height),widget:Math.round(fresh.querySelector('.kit-widget-chart').getBoundingClientRect().height),notes:cell.chat.filter(item=>/已按你的调整固定小格子尺寸/.test(item.text)).length,prompt:cell.prompt};});
    assert.equal(heightDrag.height,220);assert.equal(heightDrag.slot,220,'Exact slot height after re-render');assert.ok(heightDrag.widget>150&&heightDrag.widget<=208,'The chart fills the slot below its title');
    // A fixed-size cell whose chart sits inside wrappers: on release the chart still fills the taller block (no blank
    // space, no snapping back) and the cell grows with it.
    const fixedSlot=await evaluate(async()=>{const chapter=AiReportApp.state.doc.chapters[1],cell=AiReportModel.cell({span:6,prompt:'包裹'});chapter.cells.push(cell);
        cell.recipe=AiReportModel.normalizeRecipe({summary:'包裹',sources:[],compute:'function compute(){ return {rows:[{name:"TE",rate:95},{name:"ET",rate:96}]}; }',
            render:'function render(r,kit){ return kit.layout([[{id:"chart",html:"<div style=\\"padding:4px\\"><div>"+kit.chart({xAxis:{type:"category",data:r.rows.map(x=>x.name)},yAxis:{type:"value"},series:[{type:"bar",data:r.rows.map(x=>x.rate)}]},{height:140})+"</div></div>"},{id:"table",html:kit.table(r.rows,{columns:[{key:"name",label:"运营商"},{key:"rate",label:"回传率"}]})}]]); }'});
        cell.prompt='包裹';cell.recipePrompt=cell.prompt;cell.chat=[{role:'user',text:'包裹'},{role:'ai',kind:'prompt',text:'包裹'}];
        await AiReportRunner.run(cell,AiReportApp.state.doc.reportMonth,{withNarrative:false});
        const node=()=>document.querySelector(`[data-cell="${cell.id}"]`);AiReportApp.render();cell.fit=true;cell.height=Math.round(node().getBoundingClientRect().height);AiReportApp.render();
        node().scrollIntoView({block:'center',behavior:'instant'});const start=cell.height,slot=node().querySelector('[data-slot="chart"]'),edge=slot.querySelector('[data-slot-resize="y"]'),box=slot.getBoundingClientRect();
        edge.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:box.left+40,clientY:box.bottom}));dispatchEvent(new PointerEvent('pointermove',{clientX:box.left+40,clientY:box.bottom+120}));dispatchEvent(new PointerEvent('pointerup',{}));
        await new Promise(resolve=>setTimeout(resolve,100));
        const fresh=node().querySelector('[data-slot="chart"]'),slotBox=fresh.getBoundingClientRect(),chartBox=fresh.querySelector('.kit-widget-chart').getBoundingClientRect(),body=node().querySelector('.air-cell-body');
        const result={target:cell.layout.chart.height,slot:Math.round(slotBox.height),blank:Math.round(slotBox.bottom-chartBox.bottom),grew:cell.height-start,clipped:Math.round(slotBox.bottom-body.getBoundingClientRect().bottom)};
        chapter.cells.pop();AiReportApp.render();return result;});
    assert.equal(fixedSlot.slot,fixedSlot.target,'The block keeps the dragged height');assert.ok(fixedSlot.blank>=0&&fixedSlot.blank<=10,'The chart fills the block, wrappers included: '+fixedSlot.blank);
    assert.ok(fixedSlot.grew>=100,'The fixed cell grows with the block: '+fixedSlot.grew);assert.ok(fixedSlot.clipped<=4,'Nothing is clipped');
    assert.equal(heightDrag.notes,1,'Repeated adjustments update one chat note');assert.match(heightDrag.prompt,/chart（运营商对比）宽 60%、高 220px/);
    assert.equal(aiCalls.length,slotCalls,'Resizing blocks never calls the AI');
    const slotExport=await evaluate(async()=>AiReportExport.standalone(AiReportApp.state.doc,{lang:'zh',t:zh=>zh}));
    assert.match(slotExport,/data-slot="chart"[^>]*style="[^"]*flex: 60 1 0[^"]*height: 220px/,'Exports keep the adjusted block sizes');assert.ok(!/kit-slot-edge|kit-slot-tag/.test(slotExport.split('</style>')[1]),'No editing handles in exports');
    const autoHeight=await evaluate(()=>{const edge=document.querySelector(`[data-cell="${AiReportApp.state.slotCell}"] [data-slot="chart"] [data-slot-resize="y"]`);edge.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
        const cell=AiReportApp.state.doc.chapters[1].cells[0];return {layout:cell.layout.chart,prompt:cell.prompt,styled:document.querySelector(`[data-cell="${cell.id}"] [data-slot="chart"]`).style.height};});
    assert.deepEqual(autoHeight.layout,{width:60},'Double-clicking the bottom edge gives the block its auto height back');assert.match(autoHeight.prompt,/chart（运营商对比）宽 60%、高度自动/);assert.equal(autoHeight.styled,'');
    // A narrow cell stacks its blocks top to bottom whatever the recipe wrote, and widening puts them side by side again.
    const narrow=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[1].cells[0],place=()=>{const node=document.querySelector(`[data-cell="${cell.id}"]`),chart=node.querySelector('[data-slot="chart"]').getBoundingClientRect(),table=node.querySelector('[data-slot="table"]').getBoundingClientRect();return {stacked:table.top>=chart.bottom-1,edge:getComputedStyle(node.querySelector('.kit-slot-edge-x')).display};};
        cell.span=4;AiReportApp.render();const thin=place();cell.span=12;AiReportApp.render();const wide=place();cell.span=4;AiReportApp.render();return {thin,wide};});
    assert.deepEqual(narrow,{thin:{stacked:true,edge:'none'},wide:{stacked:false,edge:'block'}},'Narrow cells stack, wide cells keep blocks side by side');
    // A regeneration whose content has no such blocks drops their sizes and says so; a narrow cell's prompt gets the stacking line.
    await evaluate(()=>AiReportApp.tryPrompt(AiReportApp.state.slotCell));
    await until(()=>!AiReportApp.state.busy.size&&/没有这些小格子/.test(AiReportApp.state.doc.chapters[1].cells[0].chat.at(-1).text),'stale slots dropped');
    assert.deepEqual(await evaluate(()=>AiReportApp.state.doc.chapters[1].cells[0].layout),{});
    assert.match(await evaluate(()=>AiReportApp.state.doc.chapters[1].cells[0].prompt),/【窄格子布局】格子较窄（4\/12 栏）：[^\n]*从上到下排列/,'Narrow cells get the stacking line in their prompt');
    await evaluate(()=>{AiReportApp.state.doc.chapters[1].cells.shift();AiReportApp.state.selected=null;AiReportApp.render();});
    // Drill-down: clicking a bar opens the next level and filters the linked table; leaves only filter; × resets.
    await evaluate(async()=>{const chapter=AiReportApp.state.doc.chapters[1];const cell=AiReportModel.cell({span:12,prompt:'下钻演示'});chapter.cells.unshift(cell);
        cell.recipe=AiReportModel.normalizeRecipe({summary:'下钻',sources:[],compute:`function compute(){ const rows=[["华东","江苏","延期"],["华东","江苏","正常"],["华东","浙江","正常"],["华南","广东","延期"],["华南","广东","正常"],["华北","北京","正常"]].map(([region,country,status])=>({region,country,status}));
            const count=(list,key)=>Object.entries(list.reduce((map,row)=>(map[row[key]]=(map[row[key]]||0)+1,map),{})).map(([name,value])=>({name,value}));
            return {rows,regions:count(rows,"region"),east:count(rows.filter(row=>row.region==="华东"),"country")}; }`,
            render:`function render(r,kit){ const bar=list=>({xAxis:{type:"category",data:list.map(x=>x.name)},yAxis:{type:"value"},series:[{type:"bar",data:list.map(x=>x.value)}]});
            return kit.chart(bar(r.regions),{id:"regions",height:260,drill:{field:"region",target:"detail",levels:{"华东":{option:bar(r.east),drill:{field:"country"}}}}})+kit.datatable(r.rows,{id:"detail",columns:[{key:"region",label:"地区"},{key:"country",label:"国家"},{key:"status",label:"状态"}]}); }`});
        await AiReportRunner.run(cell,AiReportApp.state.doc.reportMonth,{withNarrative:false});AiReportApp.state.drillCell=cell.id;AiReportApp.render();});
    // Real mouse input (Electron sendInputEvent) at the bar's centre, after scrolling the chart into view.
    const clickBar=async name=>{
        await evaluate(()=>document.querySelector(`[data-cell="${AiReportApp.state.drillCell}"]`).scrollIntoView({block:'center',behavior:'instant'}));
        await wait(700); // let scrolling settle and the bars finish their entry animation
        const point=await evaluate(name=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.drillCell}"]`);const canvas=node.querySelector('.kit-chart-canvas'),chart=echarts.getInstanceByDom(canvas),index=chart.getOption().xAxis[0].data.indexOf(name),box=canvas.getBoundingClientRect();
            const layout=chart.getModel().getSeriesByIndex(0).getData().getItemLayout(index);
            return {x:Math.round(box.left+layout.x+layout.width/2),y:Math.round(box.top+layout.y+layout.height/2)};},name);
        win.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});
        win.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});
        win.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});
        await wait(120);
    };
    const drillState=()=>evaluate(()=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.drillCell}"]`);return {crumbs:node.querySelector('.kit-drill-bar').hidden?'':node.querySelector('.kit-drill-bar').textContent.replace(/\s+/g,''),axis:echarts.getInstanceByDom(node.querySelector('.kit-chart-canvas')).getOption().xAxis[0].data.join(','),count:node.querySelector('.kit-dt-count').textContent,chips:node.querySelector('.kit-dt-chips').textContent.replace('×','').trim()};});
    assert.deepEqual(await drillState(),{crumbs:'',axis:'华东,华南,华北',count:'共 6 条',chips:''});
    await clickBar('华东');await wait(50);
    assert.deepEqual(await drillState(),{crumbs:'全部›华东',axis:'江苏,浙江',count:'共 3 条',chips:'地区 = 华东'},'Clicking 华东 opens its level and filters the table');
    await evaluate(()=>AiReportApp.render());
    assert.deepEqual(await drillState(),{crumbs:'全部›华东',axis:'江苏,浙江',count:'共 3 条',chips:'地区 = 华东'},'Drill state survives a full re-render');
    await clickBar('江苏');await wait(50);
    assert.deepEqual(await drillState(),{crumbs:'全部›华东›江苏',axis:'江苏,浙江',count:'共 2 条',chips:'地区 = 华东国家 = 江苏'},'The last level only filters');
    await evaluate(()=>document.querySelector(`[data-cell="${AiReportApp.state.drillCell}"] .kit-dt-clear`).click());
    assert.deepEqual(await drillState(),{crumbs:'',axis:'华东,华南,华北',count:'共 6 条',chips:''},'Clearing the filter resets the chart');
    await clickBar('华南');await wait(50);
    assert.deepEqual(await drillState(),{crumbs:'全部›华南',axis:'华东,华南,华北',count:'共 2 条',chips:'地区 = 华南'},'A name without a level filters without drilling');
    await evaluate(()=>document.querySelector(`[data-cell="${AiReportApp.state.drillCell}"] .kit-drill-bar [data-depth="0"]`).click());
    assert.equal((await drillState()).count,'共 6 条','Breadcrumb “全部” goes back to the top');
    assert.match(await evaluate(async()=>AiReportExport.standalone(AiReportApp.state.doc,{lang:'zh',t:zh=>zh})),/交互版可点击下钻/,'Static exports say drilling is in the interactive version');
    fs.writeFileSync(path.join(temp,'drill.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate(()=>{const chapter=AiReportApp.state.doc.chapters[1];chapter.cells=chapter.cells.filter(cell=>cell.id!==AiReportApp.state.drillCell);AiReportApp.render();});
    // Changing the report month reruns numbers without AI; summaries wait for one explicit update.
    const callsBefore=aiCalls.length;
    await evaluate(()=>{const input=document.getElementById('airMonth');input.value='2026-10';input.dispatchEvent(new Event('change'));});
    await until(()=>document.querySelector('.air-cell .kit-table')?.textContent.includes('低2')&&!AiReportApp.state.busy.size,'october numbers');
    assert.equal(aiCalls.length,callsBefore,'Month switch makes no AI calls');
    assert.equal(await evaluate(()=>!!document.querySelector('.air-narrative.is-stale')),true);
    assert.equal(await evaluate(()=>document.getElementById('airNarratives').hidden),false);
    await evaluate(()=>document.getElementById('airNarratives').click());
    await until(()=>document.querySelector('.air-narrative')?.textContent==='本月整改单共 5 条。'&&!document.querySelector('.air-narrative.is-stale'),'narrative update');

    // Resize by dragging the corner; adding a cell can be undone with Ctrl/Cmd+Z.
    await evaluate(()=>{const chapter=AiReportApp.state.doc.chapters[0];chapter.cells.unshift(AiReportModel.cell({span:12}));AiReportApp.render();
        const cell=document.querySelector('.air-cell'),handle=cell.querySelector('[data-resize]'),rect=cell.getBoundingClientRect(),grid=cell.parentElement.getBoundingClientRect();
        handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.right,clientY:rect.bottom}));
        dispatchEvent(new PointerEvent('pointermove',{clientX:rect.left+grid.width/2,clientY:rect.bottom+80}));dispatchEvent(new PointerEvent('pointerup',{}));});
    const resized=await evaluate(()=>{const chapter=AiReportApp.state.doc.chapters[0],cell=chapter.cells.shift();AiReportApp.render();return cell;});
    // With a neighbour in the row, dragging close to its bottom snaps to it and shows guides for the shared edges.
    const snap=await evaluate(async()=>{const chapter=AiReportApp.state.doc.chapters[0],first=AiReportModel.cell({span:6});chapter.cells.unshift(first,AiReportModel.cell({span:6,height:300}),AiReportModel.cell({span:6}));AiReportApp.render();
        const node=document.querySelector(`[data-cell="${first.id}"]`),rect=node.getBoundingClientRect(),neighbour=document.querySelector(`[data-cell="${chapter.cells[1].id}"]`).getBoundingClientRect();
        node.querySelector('[data-resize]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.right,clientY:rect.bottom}));
        dispatchEvent(new PointerEvent('pointermove',{clientX:rect.right,clientY:neighbour.bottom-6}));
        await new Promise(resolve=>requestAnimationFrame(()=>resolve()));// moves are applied once per frame
        const guides=[...document.querySelectorAll('.air-guide')].filter(line=>!line.hidden).map(line=>line.className);
        dispatchEvent(new PointerEvent('pointerup',{}));const height=first.height,left=document.querySelectorAll('.air-guide').length;chapter.cells.splice(0,3);AiReportApp.render();return {height,neighbour:Math.round(neighbour.height),guides,left};});
    assert.equal(snap.height,snap.neighbour,'Height snaps to the neighbour');assert.ok(snap.guides.some(name=>name.includes('air-guide-y')),'Horizontal guide shown');assert.ok(snap.guides.some(name=>name.includes('air-guide-x')),'Vertical guide where the right edge meets the cell below');assert.equal(snap.left,0,'Guides removed after resizing');assert.equal(resized.span,6);assert.ok(resized.height>=170);
    const sizes=await evaluate(async()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0],node=()=>document.querySelector(`[data-cell="${cell.id}"]`);cell.height=900;AiReportApp.render();const tall=node().getBoundingClientRect().height;cell.height=80;AiReportApp.render();const content=node().getBoundingClientRect().height;return {tall,content};});
    assert.ok(sizes.tall>=899&&sizes.tall<=901,'Chosen height is kept when content is smaller');assert.ok(sizes.content>200,'Bigger content grows past the chosen height');
    const cellCount=await evaluate(()=>AiReportApp.state.doc.chapters[0].cells.length);
    await evaluate(()=>document.querySelector('[data-add-cell]').click());assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters[0].cells.length),cellCount+1);
    await evaluate(()=>{document.activeElement.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));});
    assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters[0].cells.length),cellCount);

    // Chapters: a new one can be inserted between any two (its title ready to type), and dragging one zooms the whole
    // report out, lets the others slide aside, and zooms back in on where it landed. Esc puts it back.
    const chapterOps=await evaluate(async()=>{const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),doc=AiReportApp.state.doc,titles=()=>AiReportApp.state.doc.chapters.map(chapter=>chapter.id);
        const count=doc.chapters.length;document.querySelectorAll('[data-insert-chapter]')[1].click();await wait(50);
        const inserted={count:doc.chapters.length-count,second:AiReportModel.text(doc.chapters[1].title,'zh'),focused:document.activeElement?.dataset.edit===`chapter:${doc.chapters[1].id}`};
        document.activeElement.blur();doc.chapters.splice(1,1);AiReportApp.render();
        const drag=async(index,commit)=>{const node=document.querySelectorAll('.air-chapter')[index],handle=node.querySelector('[data-chapter-drag]');node.scrollIntoView({block:'center',behavior:'instant'});await wait(50);
            const from=handle.getBoundingClientRect();handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:from.left+4,clientY:from.top+4}));dispatchEvent(new PointerEvent('pointermove',{clientX:from.left+12,clientY:from.top+12}));
            await wait(650);const report=document.getElementById('airReport'),zoomed={on:report.classList.contains('is-zoomed'),small:report.getBoundingClientRect().height<innerHeight,locked:document.documentElement.style.overflow==='hidden',placeholder:!!report.querySelector(':scope>.air-chapter-placeholder')};
            const first=[...report.querySelectorAll(':scope>.air-chapter:not(.is-lifted)')][0].getBoundingClientRect();dispatchEvent(new PointerEvent('pointermove',{clientX:first.left+first.width/2,clientY:first.top+3}));
            const moved=report.querySelector(':scope>.air-chapter-placeholder').nextElementSibling===report.querySelector(':scope>.air-chapter:not(.is-lifted)');
            if(commit)dispatchEvent(new PointerEvent('pointerup',{}));else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            await wait(1100);return {zoomed,moved,after:{zoomed:report.classList.contains('is-zoomed'),transform:report.style.transform,overflow:document.documentElement.style.overflow,clean:!document.querySelector('.air-chapter-placeholder,.air-chapter.is-lifted')}};};
        const before=titles(),cancelled=await drag(2,false),afterCancel=titles(),undoDepth=AiReportApp.state.undo.length,moved=await drag(2,true),after=titles();
        const depthAfterMove=AiReportApp.state.undo.length;document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));await wait(50);
        return {inserted,cancelled,kept:afterCancel.join()===before.join(),moved,landedFirst:after[0]===before[2]&&after.length===before.length,undoable:AiReportApp.state.undo.length===depthAfterMove-1&&titles().join()===before.join()};});
    assert.deepEqual(chapterOps.inserted,{count:1,second:'新章节',focused:true},'A chapter is inserted between chapters with its title ready to type');
    const unzoomed={zoomed:false,transform:'',overflow:'',clean:true};
    assert.deepEqual(chapterOps.cancelled,{zoomed:{on:true,small:true,locked:true,placeholder:true},moved:true,after:unzoomed},'Dragging zooms the report out; Esc puts the chapter back and zooms in again');
    assert.equal(chapterOps.kept,true);
    assert.deepEqual(chapterOps.moved,{zoomed:{on:true,small:true,locked:true,placeholder:true},moved:true,after:unzoomed});assert.equal(chapterOps.landedFirst,true,'Dropped above the first chapter');assert.equal(chapterOps.undoable,true,'Ctrl/Cmd+Z undoes the move');
    // Moving cells works like rearranging home-screen icons: the card lifts, a placeholder holds its place, the cards
    // it passes slide aside, and Esc puts everything back.
    const reorder=await evaluate(async()=>{const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),cells=()=>document.querySelectorAll('[data-grid]')[0].querySelectorAll(':scope>.air-cell'),added=cells().length<2;
        if(added){document.querySelectorAll('[data-grid]')[0].querySelector('[data-add-cell]').click();await wait(50);}
        const grid=document.querySelectorAll('[data-grid]')[0];
        const [first,second]=grid.querySelectorAll(':scope>.air-cell');second.scrollIntoView({block:'center',behavior:'instant'});await wait(50);
        const order=()=>[...grid.querySelectorAll(':scope>.air-cell')].map(cell=>cell.dataset.cell).join(),before=order(),undo=AiReportApp.state.undo.length;
        const handle=first.querySelector('[data-cell-drag]').getBoundingClientRect(),target=second.getBoundingClientRect();
        first.querySelector('[data-cell-drag]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:handle.left+4,clientY:handle.top+4}));
        dispatchEvent(new PointerEvent('pointermove',{clientX:handle.left+30,clientY:handle.top+12}));
        const lifted=first.classList.contains('is-lifted')&&getComputedStyle(first).position==='fixed'&&!!grid.querySelector(':scope>.air-cell-placeholder');
        dispatchEvent(new PointerEvent('pointermove',{clientX:target.left+target.width/2,clientY:target.top+target.height/2}));
        const placeholderAfter=grid.querySelector(':scope>.air-cell-placeholder').previousElementSibling===second,sliding=second.getAnimations().some(animation=>animation.id==='air-flip');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(500);
        const result={lifted,placeholderAfter,sliding,restored:order()===before,clean:!document.querySelector('.air-cell-placeholder,.is-lifted'),undo:AiReportApp.state.undo.length===undo};
        if(added){document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));await wait(50);}
        return result;});
    assert.deepEqual(reorder,{lifted:true,placeholderAfter:true,sliding:true,restored:true,clean:true,undo:true},'Lift, make room with sliding cards, and Esc to cancel');
    const moved=await evaluate(async()=>{const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),handle=document.querySelector('[data-cell-drag]'),id=handle.closest('.air-cell').dataset.cell,target=document.querySelectorAll('[data-grid]')[1].querySelector('[data-add-cell]');
        target.scrollIntoView({block:'center',behavior:'instant'});await wait(50);const from=handle.getBoundingClientRect(),to=target.getBoundingClientRect();
        handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:from.left+4,clientY:from.top+4}));dispatchEvent(new PointerEvent('pointermove',{clientX:from.left+30,clientY:from.top+30}));
        dispatchEvent(new PointerEvent('pointermove',{clientX:to.left+40,clientY:to.top+to.height/2}));const placed=document.querySelectorAll('[data-grid]')[1].contains(document.querySelector('.air-cell-placeholder'));
        dispatchEvent(new PointerEvent('pointerup',{}));await wait(500);
        return {placed,moved:AiReportApp.state.doc.chapters[1].cells.some(cell=>cell.id===id&&cell.recipe),clean:!document.querySelector('.air-cell-placeholder,.is-lifted'),transform:document.querySelector(`[data-cell="${id}"]`).getAnimations().length};});
    assert.deepEqual(moved,{placed:true,moved:true,clean:true,transform:0},'Dragging a cell into the second chapter moves it there and it settles cleanly');
    await evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true})));
    assert.ok(await evaluate(()=>AiReportApp.state.doc.chapters[0].cells[0].recipe));

    // Forced size: dragging a generated cell smaller than its content fixes that size, shrinks charts at once, asks how to
    // abbreviate long names, writes the size into the final prompt and regenerates; undo restores the old size.
    await evaluate(async()=>{const chapter=AiReportApp.state.doc.chapters[1];const cell=AiReportModel.cell({span:12,prompt:'地区分布柱状图'});chapter.cells.unshift(cell);
        cell.recipe=AiReportModel.normalizeRecipe({summary:'地区',sources:[],compute:'function compute(){ return {rows:[{name:"北部非洲地区部",value:52},{name:"ORG:埃及代表处",value:50},{name:"ET:云核心网产品线",value:16}]}; }',render:'function render(r,kit){ return kit.chart({xAxis:{type:"category",data:r.rows.map(x=>x.name)},yAxis:{type:"value"},series:[{type:"bar",data:r.rows.map(x=>x.value)}]},{title:"地区分布",height:420})+kit.text("总结：北部非洲地区部最多。"); }'});
        cell.prompt='地区分布柱状图';cell.recipePrompt=cell.prompt;cell.chat=[{role:'user',text:'地区分布柱状图'},{role:'ai',kind:'prompt',text:'地区分布柱状图'}];
        await AiReportRunner.run(cell,AiReportApp.state.doc.reportMonth,{withNarrative:false});AiReportApp.state.sizeCell=cell.id;AiReportApp.render();});
    await wait(300);
    const shrink=await evaluate(()=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.sizeCell}"]`);node.scrollIntoView({block:'center',behavior:'instant'});const rect=node.getBoundingClientRect(),handle=node.querySelector('[data-resize]');
        handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.right-4,clientY:rect.bottom-4}));dispatchEvent(new PointerEvent('pointermove',{clientX:rect.right-4,clientY:rect.top+260}));dispatchEvent(new PointerEvent('pointerup',{}));
        const cell=AiReportApp.state.doc.chapters[1].cells[0],fresh=document.querySelector(`[data-cell="${cell.id}"]`),body=fresh.querySelector('.air-cell-body');
        return {before:Math.round(rect.height),fit:cell.fit,height:cell.height,boxHeight:Math.round(fresh.getBoundingClientRect().height),overflow:body.scrollHeight-body.clientHeight,chart:Math.round(fresh.querySelector('.kit-widget-chart').getBoundingClientRect().height),ask:cell.chat.at(-1).purpose||null,settle:!!fresh.querySelector('.air-settle [data-settle-now]')};});
    assert.ok(shrink.before>400);assert.equal(shrink.fit,true);assert.ok(Math.abs(shrink.boxHeight-shrink.height)<=1,'The cell keeps the forced height');assert.ok(shrink.overflow<=1,'Charts shrink so nothing spills out');assert.ok(shrink.chart<420);
    // The AI waits: a countdown bar appears and nothing is asked yet; grabbing the corner again pauses it, and
    // “撤销调整” brings back the size from before the first drag without any AI call.
    assert.equal(shrink.ask,null,'No question right after letting go');assert.equal(shrink.settle,true,'A countdown bar shows instead');
    const paused=await evaluate(()=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.sizeCell}"]`),rect=node.getBoundingClientRect();node.querySelector('[data-resize]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.right-4,clientY:rect.bottom-4}));const bar=node.querySelector('.air-settle');const out={paused:bar?.classList.contains('is-paused'),text:bar?.textContent||''};dispatchEvent(new PointerEvent('pointermove',{clientX:rect.right-4,clientY:rect.bottom-20}));dispatchEvent(new PointerEvent('pointerup',{}));return out;});
    assert.equal(paused.paused,true);assert.match(paused.text,/调整中/);
    const callsBeforeUndo=aiCalls.length;
    await evaluate(()=>document.querySelector('[data-settle-undo]').click());
    const sizeUndone=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[1].cells[0];return {height:cell.height,fit:cell.fit,bar:!!document.querySelector('.air-settle')};});
    assert.deepEqual(sizeUndone,{height:0,fit:false,bar:false},'Undo restores the size from before the first drag');
    await wait(2800);assert.equal(aiCalls.length,callsBeforeUndo,'An undone resize never reaches the AI');assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters[1].cells[0].chat.at(-1).purpose||null),null);
    // Drag again and skip the wait: now the long labels are asked about.
    await evaluate(()=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.sizeCell}"]`),rect=node.getBoundingClientRect();node.querySelector('[data-resize]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.right-4,clientY:rect.bottom-4}));dispatchEvent(new PointerEvent('pointermove',{clientX:rect.right-4,clientY:rect.top+260}));dispatchEvent(new PointerEvent('pointerup',{}));});
    await evaluate(()=>document.querySelector('[data-settle-now]').click());
    const asked=await evaluate(()=>({ask:AiReportApp.state.doc.chapters[1].cells[0].chat.at(-1).purpose,choices:document.querySelectorAll('#airChat [data-choice]').length,question:document.querySelector('#airChat .air-msg-ai:last-of-type')?.textContent||''}));
    assert.equal(asked.ask,'abbr');assert.equal(asked.choices,4);assert.match(asked.question,/北部非洲地区部|ET:云核心网产品线/,'The question names the long labels');
    await evaluate(()=>[...document.querySelectorAll('#airChat [data-choice]')].find(button=>button.textContent.startsWith('去掉前缀')).click());
    await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[1].cells[0].chat.at(-1).sized,'size applied');
    const sized=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[1].cells[0];return {prompt:cell.prompt,abbr:cell.abbreviation,note:cell.chat.at(-2).text,previous:cell.chat.at(-1).previousSize,compiled:cell.recipePrompt===cell.prompt};});
    assert.match(sized.prompt,/【尺寸约束】格子宽 12\/12 栏（约 \d+px）、高 \d+px/);assert.match(sized.prompt,/去掉前缀/);assert.match(sized.abbr,/去掉前缀/);assert.match(sized.note,/已把格子固定为/);assert.equal(sized.compiled,true,'Regenerated for the new size');
    assert.deepEqual(sized.previous,{height:0,fit:false,span:12});
    await evaluate(()=>document.querySelector('#airChat [data-revert]').click());
    await until(()=>!AiReportApp.state.busy.size&&!AiReportApp.state.doc.chapters[1].cells[0].chat.at(-1)?.sized&&AiReportApp.state.doc.chapters[1].cells[0].fit===false,'size undone');
    assert.equal(await evaluate(()=>AiReportApp.state.doc.chapters[1].cells[0].height),0,'Undo restores the automatic height');
    await evaluate(()=>{const chapter=AiReportApp.state.doc.chapters[1];chapter.cells.shift();AiReportApp.state.selected=null;AiReportApp.render();});
    // Enlarging past what the content can fill also fixes the size and regenerates, asking the content to use the space.
    const growCell=async(render,span)=>evaluate(async(render,span)=>{const chapter=AiReportApp.state.doc.chapters[1];const cell=AiReportModel.cell({span,prompt:'放大测试'});chapter.cells.unshift(cell);
        cell.recipe=AiReportModel.normalizeRecipe({summary:'放大',sources:[],compute:'function compute(){ return {rows:[{name:"A",value:3},{name:"B",value:5}]}; }',render});
        cell.prompt='放大测试';cell.recipePrompt=cell.prompt;cell.chat=[{role:'user',text:'放大测试'},{role:'ai',kind:'prompt',text:'放大测试'}];
        await AiReportRunner.run(cell,AiReportApp.state.doc.reportMonth,{withNarrative:false});AiReportApp.state.growCell=cell.id;AiReportApp.render();},render,span);
    const dragGrow=(dx,dy)=>evaluate((dx,dy)=>{const node=document.querySelector(`[data-cell="${AiReportApp.state.growCell}"]`);node.scrollIntoView({block:'start',behavior:'instant'});const rect=node.getBoundingClientRect(),handle=node.querySelector('[data-resize]'),before=Math.round(node.querySelector('.kit-widget-chart')?.getBoundingClientRect().height||0);
        handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.right-4,clientY:rect.bottom-4}));dispatchEvent(new PointerEvent('pointermove',{clientX:rect.right-4+dx,clientY:rect.bottom-4+dy}));dispatchEvent(new PointerEvent('pointerup',{}));
        const cell=AiReportApp.state.doc.chapters[1].cells[0],fresh=document.querySelector(`[data-cell="${cell.id}"]`);
        return {fit:cell.fit,mode:cell.pendingSize?.mode||null,asked:cell.chat.at(-1).purpose||null,chartBefore:before,chartAfter:Math.round(fresh.querySelector('.kit-widget-chart')?.getBoundingClientRect().height||0)};},dx,dy);
    await growCell('function render(r,kit){ return kit.chart({xAxis:{type:"category",data:r.rows.map(x=>x.name)},yAxis:{type:"value"},series:[{type:"bar",data:r.rows.map(x=>x.value)}]},{height:300}); }',12);await wait(300);
    const grownTall=await dragGrow(0,260);
    assert.equal(grownTall.fit,true);assert.equal(grownTall.asked,null,'Enlarging never asks about abbreviations');assert.ok(grownTall.chartAfter>grownTall.chartBefore+150,'Charts stretch into the new height at once');
    await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[1].cells[0].chat.at(-1).sized,'grow regenerated');
    const grownPrompt=await evaluate(()=>{const cell=AiReportApp.state.doc.chapters[1].cells[0];return {prompt:cell.prompt,note:cell.chat.at(-2).text,compiled:cell.recipePrompt===cell.prompt};});
    assert.match(grownPrompt.prompt,/充分利用这个空间/);assert.match(grownPrompt.note,/充分利用新空间/);assert.equal(grownPrompt.compiled,true);
    await evaluate(()=>{AiReportApp.state.doc.chapters[1].cells.shift();AiReportApp.state.selected=null;AiReportApp.render();});
    await growCell('function render(r,kit){ return kit.pie(r.rows.map(x=>({label:x.name,value:x.value}))); }',4);await wait(200);
    const grownWide=await dragGrow(900,0);
    assert.equal(grownWide.fit,true,'A pie that cannot fill a much wider cell triggers regeneration too');
    await until(()=>!AiReportApp.state.busy.size&&AiReportApp.state.doc.chapters[1].cells[0].chat.at(-1).sized,'wide regenerated');
    assert.match(await evaluate(()=>AiReportApp.state.doc.chapters[1].cells[0].prompt),/宽 12\/12 栏[\s\S]*充分利用这个空间/);
    await evaluate(()=>{AiReportApp.state.doc.chapters[1].cells.shift();AiReportApp.state.selected=null;AiReportApp.render();});
    // Header meta labels share one width so columns line up; editable text highlights as one block.
    const meta=await evaluate(()=>({labels:[...new Set([...document.querySelectorAll('.air-meta-item>b')].map(node=>Math.round(node.getBoundingClientRect().width)))],display:getComputedStyle(document.querySelector('.air-meta-item [contenteditable]')).display,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}));
    assert.deepEqual(meta.labels,[96]);assert.equal(meta.display,'block');assert.equal(meta.overflow,false,'No horizontal page scroll');
    // Template text edits, save and reload keep cells, recipes and outputs.
    await evaluate(()=>{const title=document.querySelector('[data-edit="title"]');title.focus();title.textContent='网络安全 AI 月报';title.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));});
    assert.equal(await evaluate(()=>AiReportApp.state.doc.template.title.zh),'网络安全 AI 月报');
    await evaluate(()=>document.querySelector('[data-air=save]').click());await until(()=>!!AiReportApp.state.doc.id&&document.getElementById('airStatus').textContent.includes('已保存'),'save');
    await win.reload();await until(()=>!document.body.classList.contains('air-booting')&&!!document.querySelector('.air-cell .kit-table'),'reload');
    assert.equal(await evaluate(()=>document.querySelector('.air-masthead h1').textContent),'网络安全 AI 月报');assert.equal(await evaluate(()=>AiReportApp.state.doc.reportMonth),'2026-10');

    // Preview hides every editing control; the standalone export has styles, data and no scripts.
    await evaluate(()=>document.querySelector('[data-air=preview]').click());
    assert.equal(await evaluate(()=>document.querySelectorAll('#airReport [contenteditable], #airReport .air-cell-tools, #airReport [data-add-cell]').length),0);
    fs.writeFileSync(path.join(temp,'preview.png'),(await win.webContents.capturePage()).toPNG());
    const exported=await evaluate(async()=>AiReportExport.standalone(AiReportApp.state.doc,{lang:'zh',t:(zh)=>zh}));
    assert.ok(exported.includes('kit-table')&&exported.includes('.air-report')&&!/<script/i.test(exported)&&!/onerror/i.test(exported));
    await evaluate(()=>document.querySelector('[data-air=preview]').click());
    await evaluate(()=>{document.querySelector('.air-cell').click();});await wait(100);
    fs.writeFileSync(path.join(temp,'editor.png'),(await win.webContents.capturePage()).toPNG());
    console.log('PASS: AI report template start, cell chat with choices, auto-repaired recipe, sandboxed compute/render, sanitized output, month rerun without AI, summary update, resize, move, undo, save/reload, preview and export.',temp);
}).catch(async error=>{process.exitCode=1;console.error(error);try{if(win)fs.writeFileSync(path.join(temp,'failure.png'),(await win.webContents.capturePage()).toPNG());console.error('Failure screenshot',path.join(temp,'failure.png'));}catch(_){}})
.finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
