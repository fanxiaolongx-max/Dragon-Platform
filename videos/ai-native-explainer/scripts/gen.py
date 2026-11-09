# 生成 src/sN.html：每个场景只写自己的 CSS / HTML / JS，公共骨架在这里
import os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))

def scene(n, step, title, css, html, js, dino=None):
    head = f'<div class="head" id="s{n}-h">' + (f'<span class="step">{step}</span>' if step else '') + f'<span class="ttl">{title}</span></div>'
    dino_js = ''
    if dino:
        x, y, w, body = dino
        html += f'\n  <div class="abs" id="s{n}-d" style="left:{x}px;top:{y}px"></div>'
        dino_js = f'put("s{n}-d",dino("dn",{{w:{w},h:{w},body:"{body}"}}));tl.fromTo("#s{n}-d",{{opacity:0,y:80}},{{opacity:1,y:0,duration:.6,ease:"back.out(1.5)"}},.5);dtail(tl,"dn",.6,30);'
    out = f'''<!doctype html><html><head><meta charset="UTF-8"></head><body>
<template>
<style>/*SHARED*/
{css}
</style>
<div id="root" data-composition-id="s{n}" data-width="1920" data-height="1080">
  <div class="paper"></div>
  {head}
  {html}
  <div id="s{n}-sp"></div>
  <div class="cap" id="s{n}-cap"></div>
</div>
<script>
//LIB
//DATA
(function(){{
 var tl=gsap.timeline({{paused:true}});
 var S="#s{n}-";
 tl.fromTo("#s{n}-h",{{opacity:0,x:-50}},{{opacity:1,x:0,duration:.6,ease:"back.out(1.6)"}},.25);
 {dino_js}
 {js}
 captions(tl,"s{n}-cap");
 window.__timelines["s{n}"]=tl;
}})();
</script>
</template></body></html>
'''
    open(f'src/s{n}.html', 'w', encoding='utf8').write(out)

CARD = '#root .pnl{position:absolute;background:#fffdf8;border:3px solid var(--ink);border-radius:26px;box-shadow:var(--sh)}\n#root .pnl .pt{position:absolute;left:0;right:0;top:0;height:64px;border-bottom:3px solid var(--ink);border-radius:23px 23px 0 0;display:flex;align-items:center;justify-content:center;font-size:38px}\n#root .lbl{position:absolute;font-size:36px;white-space:nowrap}\n#root .big{font-size:44px}'
SP = 'document.getElementById("s%d-sp").innerHTML=sparkle(%d,%d,44)+sparkle(%d,%d,40,"#ffb3c6");'
SPA = 'tl.fromTo(S+"sp svg",{scale:0,opacity:0},{scale:1,opacity:1,duration:.4,stagger:.3,ease:"back.out(2)",transformOrigin:"50% 50%"},%s);'

# ---------- s1 开场：用上 AI vs 生而 AI ----------
scene(1, '', '什么是 AI 原生？', CARD + '''
#root .head{left:0;right:0;justify-content:center}
#root .flow{stroke:#ffd166;stroke-width:6;fill:none;stroke-linecap:round;stroke-dasharray:6 14}''',
'''<div class="pnl" id="s1-l" style="left:150px;top:230px;width:700px;height:560px"><div class="pt" style="background:#e6dfd6">用上 AI</div></div>
  <div class="abs" id="s1-bd" style="left:330px;top:330px"></div>
  <div class="abs" id="s1-pg" style="left:600px;top:470px"></div>
  <div class="tag abs" id="s1-t1" style="left:330px;top:710px;background:#fff">外挂一个 AI 插件</div>
  <div class="pnl" id="s1-r" style="left:1070px;top:230px;width:700px;height:560px"><div class="pt" style="background:#9fe0c9">生而 AI</div></div>
  <svg class="abs" id="s1-tree" style="left:1210px;top:300px" width="420" height="440" viewBox="0 0 420 440" overflow="visible">
    <path d="M190 430 C170 420 150 432 120 438 M230 430 C250 420 270 432 300 438" class="ln" style="stroke:#c8a27a"/>
    <path d="M186 430 L192 250 L228 250 L234 430 Z" fill="#d8b48c" stroke="#5b4636" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="210" cy="170" r="110" fill="#9fe0c9" stroke="#5b4636" stroke-width="4"/>
    <circle cx="110" cy="230" r="70" fill="#9fe0c9" stroke="#5b4636" stroke-width="4"/>
    <circle cx="310" cy="230" r="70" fill="#9fe0c9" stroke="#5b4636" stroke-width="4"/>
    <path id="s1-f1" class="flow" d="M210 430 V250 C210 200 170 160 150 120"/><path id="s1-f2" class="flow" d="M210 300 C230 240 280 220 320 200"/><path id="s1-f3" class="flow" d="M210 330 C190 280 130 260 100 240"/>
  </svg>
  <div class="abs" id="s1-seed" style="left:1360px;top:690px;width:110px;height:110px;border-radius:50%;background:radial-gradient(circle,#fff6c9,#ffd166);border:3px solid var(--ink);display:flex;align-items:center;justify-content:center;font-size:40px;box-shadow:0 0 40px rgba(255,209,102,.9)">AI</div>''',
'''put("s1-bd",icon("building","#aed8f2",260));put("s1-pg",icon("plug","#ffe08f",120));
 gsap.set(S+"l,"+S+"bd,"+S+"pg,"+S+"t1,"+S+"r,"+S+"seed",{opacity:0});
 tl.fromTo(S+"l,"+S+"bd",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.15,ease:"power3.out"},T("左边")-.3);
 tl.fromTo(S+"pg",{opacity:0,x:120,rotation:30},{opacity:1,x:0,rotation:-8,duration:.7,ease:"back.out(1.6)"},T("外挂"));
 pop(tl,S+"t1",T("用上AI"),{s:.8});
 tl.fromTo(S+"r",{opacity:0,y:40},{opacity:1,y:0,duration:.6,ease:"power3.out"},T("右边")-.3);
 tl.fromTo(S+"seed",{opacity:0,scale:.3},{opacity:1,scale:1,duration:.5,ease:"back.out(2)",transformOrigin:"50% 50%"},T("种子")-.4);
 tl.fromTo(S+"tree",{opacity:0,scaleY:.05,scaleX:.4},{opacity:1,scaleY:1,scaleX:1,duration:1.1,ease:"back.out(1.3)",transformOrigin:"50% 100%"},T("长出来")-.3);
 tl.to(S+"seed",{y:-30,scale:.7,duration:.6},T("长出来")-.3);
 tl.fromTo("#s1-f1,#s1-f2,#s1-f3",{strokeDashoffset:0,opacity:0},{strokeDashoffset:-200,opacity:1,duration:3,ease:"none"},T("流着")-.3);
 tl.to("#s1-f1,#s1-f2,#s1-f3",{strokeDashoffset:-400,duration:3,ease:"none"},T("流着")+2.7);
 dwave(tl,"dn",.9,3);''', dino=(830, 620, 260, '#8fd8b8'))

# ---------- s2 检验问题 + 七个层面 ----------
s2_items = [('chip', '技术架构', '#ffb3c6'), ('phone', '产品', '#aed8f2'), ('group', '组织', '#ffe08f'), ('face', '用户', '#9fe0c9'), ('wave', '交互', '#d9c6ef'), ('coin', '商业模式', '#ffe08f'), ('headset', '硬件', '#ffb3c6')]
import math
s2h = '<div class="abs" id="s2-q" style="left:710px;top:470px;width:500px;height:150px;border-radius:30px;background:#fffdf8;border:3px solid var(--ink);box-shadow:var(--sh);display:flex;align-items:center;justify-content:center;font-size:42px;text-align:center;line-height:1.3">拿掉 AI<br>它还能成立吗？</div>\n'
for i, (ic, lb, c) in enumerate(s2_items):
    a = -math.pi / 2 + i * 2 * math.pi / 7
    x = 960 + 400 * math.cos(a) - 80; y = 545 + 300 * math.sin(a) - 80
    big = ' style="font-size:40px;background:#ffb3c6"' if lb == '硬件' else ''
    s2h += f'  <div class="abs" id="s2-i{i}" style="left:{x:.0f}px;top:{y:.0f}px;width:160px;text-align:center"><span id="s2-ic{i}"></span><br><span class="tag"{big}>{lb}</span></div>\n'
s2h += '  <div class="tag abs" id="s2-key" style="left:1440px;top:860px;background:#ffb3c6;font-size:36px">重点</div>'
s2js = ''.join(f'put("s2-ic{i}",icon("{ic}","{c}",{120 if lb=="硬件" else 96}));' for i, (ic, lb, c) in enumerate(s2_items))
s2js += '\n gsap.set("#s2-q,' + ','.join(f'#s2-i{i}' for i in range(7)) + ',#s2-key",{opacity:0});'
s2js += '\n tl.fromTo("#s2-q",{opacity:0,scale:.7},{opacity:1,scale:1,duration:.5,ease:"back.out(1.6)",transformOrigin:"50% 50%"},WHY.e+LEAD+.35);'
for i, (ic, lb, c) in enumerate(s2_items):
    s2js += f'\n pop(tl,"#s2-i{i}",T("{lb}")-.1,{{y:20}});'
s2js += '\n tl.to("#s2-i6",{scale:1.15,duration:.4,yoyo:true,repeat:3,ease:"sine.inOut",transformOrigin:"50% 50%"},T("重点"));tl.to("#s2-i6",{scale:1.15,duration:.3},T("重点")+1.7);pop(tl,"#s2-key",T("重点"),{});'
scene(2, '', '一个检验问题', CARD, s2h, s2js, dino=(110, 690, 220, '#8fd8b8'))

# ---------- s3 技术架构 ----------
s3h = '''<div class="pnl" id="s3-l" style="left:110px;top:220px;width:640px;height:620px"><div class="pt" style="background:#e6dfd6">传统系统</div></div>
  <div class="abs" id="s3-m" style="left:150px;top:320px;display:grid;grid-template-columns:240px 240px;gap:24px">
   <div class="tag" style="background:#fff;font-size:36px;text-align:center;padding:30px 0">订单模块</div><div class="tag" style="background:#fff;font-size:36px;text-align:center;padding:30px 0">报表模块</div>
   <div class="tag" style="background:#fff;font-size:36px;text-align:center;padding:30px 0">审批模块</div><div class="tag" style="background:#fff;font-size:36px;text-align:center;padding:30px 0">客服模块</div></div>
  <div class="abs" id="s3-pg" style="left:590px;top:560px"></div><div class="tag abs" id="s3-pt" style="left:380px;top:740px;background:#ffe08f">AI 只是外挂插件</div>
  <div class="pnl" id="s3-r" style="left:820px;top:220px;width:760px;height:620px"><div class="pt" style="background:#9fe0c9">AI 原生系统</div></div>
  <div class="abs lay" id="s3-y4" style="top:300px;background:#aed8f2">界面</div>
  <div class="abs lay" id="s3-y3" style="top:420px;background:#d9c6ef">智能体 Agent</div>
  <div class="abs lay" id="s3-y2" style="top:540px;background:#ffe08f">知识库检索</div>
  <div class="abs lay" id="s3-y1" style="top:660px;background:linear-gradient(90deg,#9fe0c9,#aed8f2);box-shadow:0 0 34px rgba(71,207,159,.7),var(--sh)">大模型（底座）</div>
  <div id="s3-dots"></div>'''
s3js = '''put("s3-pg",icon("plug","#ffe08f",110));
 var d="";for(var i=0;i<6;i++)d+='<i class="abs" id="s3-o'+i+'" style="left:'+(900+i*110)+'px;top:700px;width:22px;height:22px;border-radius:50%;background:#47cf9f;box-shadow:0 0 14px #47cf9f;opacity:0"></i>';document.getElementById("s3-dots").innerHTML=d;
 gsap.set(S+"l,"+S+"m,"+S+"pg,"+S+"pt,"+S+"r,"+S+"y1,"+S+"y2,"+S+"y3,"+S+"y4",{opacity:0});
 tl.fromTo(S+"l,"+S+"m",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.2,ease:"power3.out"},T("传统系统")-.3);
 tl.fromTo(S+"pg",{opacity:0,x:80,rotation:25},{opacity:1,x:0,rotation:-8,duration:.6,ease:"back.out(1.6)"},T("插件")-.2);pop(tl,S+"pt",T("挂在"),{});
 tl.fromTo(S+"r",{opacity:0,y:40},{opacity:1,y:0,duration:.6,ease:"power3.out"},T("AI原生")-.3);
 [["y1","底座"],["y2","知识库"],["y3","智能体"],["y4","界面"]].forEach(function(a){tl.fromTo(S+a[0],{opacity:0,y:50,scale:.9},{opacity:1,y:0,scale:1,duration:.55,ease:"back.out(1.5)"},T(a[1])-.15);});
 for(var i=0;i<6;i++){tl.fromTo("#s3-o"+i,{opacity:0,y:0},{opacity:1,y:-380,duration:1.4,ease:"sine.inOut"},T("数据和决策")+i*.18);tl.to("#s3-o"+i,{opacity:0,duration:.3},T("数据和决策")+i*.18+1.2);}'''
scene(3, '第 1 层', '技术架构', CARD + '\n#root .lay{left:880px;width:640px;height:96px;border:3px solid var(--ink);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:42px;box-shadow:var(--sh)}', s3h, s3js, dino=(1610, 630, 230, '#8fd8b8'))

# ---------- s4 产品 ----------
s4h = '''<div class="pnl" id="s4-l" style="left:110px;top:220px;width:780px;height:620px"><div class="pt" style="background:#aed8f2">天气 App</div></div>
  <div class="abs" id="s4-ph" style="left:260px;top:300px;width:300px;height:480px;border:3px solid var(--ink);border-radius:40px;background:#fff;box-shadow:var(--sh);text-align:center;padding-top:40px">
    <span id="s4-sun"></span><div style="font-size:84px;line-height:1">26°</div><div style="font-size:34px;margin-top:6px">晴 · 微风</div></div>
  <div class="tag abs" id="s4-ai1" style="left:610px;top:430px;background:#ffb3c6;font-size:32px">AI 推荐</div>
  <div class="abs" id="s4-ok1" style="left:610px;top:560px"></div><div class="tag abs" id="s4-t1" style="left:600px;top:700px;background:#e6dfd6">只是用上了 AI</div>
  <div class="pnl" id="s4-r" style="left:950px;top:220px;width:860px;height:620px"><div class="pt" style="background:#9fe0c9">对话助手</div></div>
  <div class="abs" id="s4-chat" style="left:1000px;top:310px;width:540px">
    <div class="bb" style="margin-left:auto;background:#aed8f2">帮我写一封周报</div>
    <div class="bb" style="background:#fff">好的！本周完成了 3 件事…</div>
    <div class="bb" style="margin-left:auto;background:#aed8f2">再精简一点</div>
    <div class="bb" style="background:#fff">已压缩成 3 句话 ✓</div></div>
  <div class="abs" id="s4-in" style="left:1000px;top:720px;width:540px;height:70px;border:3px solid var(--ink);border-radius:35px;background:#fff;font-size:30px;color:#a3958a;padding:16px 28px">输入你的问题…</div>
  <div class="tag abs" id="s4-ai2" style="left:1590px;top:430px;background:#ffb3c6;font-size:32px">模型</div>
  <div class="tag abs" id="s4-t2" style="left:1150px;top:470px;background:#9fe0c9;font-size:44px">AI 原生</div>
  <div class="cursor" id="s4-cur"></div>
  <div id="s4-px"></div>'''
s4js = '''put("s4-sun",icon("star","#ffe08f",110));put("s4-ok1",icon("check","#9fe0c9",110));put("s4-cur",icon("cursor","#ffffff",70));
 var px="";for(var i=0;i<24;i++){px+='<i class="abs px" style="left:'+(1010+(i%6)*90)+'px;top:'+(320+Math.floor(i/6)*90)+'px"></i>';}document.getElementById("s4-px").innerHTML=px;
 gsap.set(S+"l,"+S+"ph,"+S+"ai1,"+S+"ok1,"+S+"t1,"+S+"r,"+S+"chat,"+S+"in,"+S+"ai2,"+S+"t2,"+S+"cur,.px",{opacity:0});
 tl.fromTo(S+"l,"+S+"ph",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.15,ease:"power3.out"},T("天气")-.4);
 pop(tl,S+"ai1",T("AI推荐")-.3,{});
 tl.set(S+"cur",{x:900,y:820});tl.to(S+"cur",{opacity:1,duration:.2},T("拿")-.6);cur(tl,S+"cur",660,450,T("拿")-.5,.5);
 tl.to(S+"ai1",{x:260,y:-140,rotation:20,opacity:0,duration:.7,ease:"power2.in"},T("拿")+.1);cur(tl,S+"cur",900,300,T("拿")+.1,.7);
 tl.to(S+"ph",{rotation:-2,duration:.15,yoyo:true,repeat:3},T("照样"));
 pop(tl,S+"ok1",T("照样")+.2,{});pop(tl,S+"t1",T("用上了AI")-.2,{});
 tl.fromTo(S+"r,"+S+"chat,"+S+"in",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.15,ease:"power3.out"},T("对话助手")-.6);
 tl.fromTo("#s4-chat .bb",{opacity:0,y:16},{opacity:1,y:0,duration:.3,stagger:.2},T("对话助手")-.2);
 pop(tl,S+"ai2",T("把模型拿掉")-.4,{});
 cur(tl,S+"cur",1620,450,T("把模型拿掉")-.4,.5);
 tl.to(S+"ai2",{x:200,y:-160,rotation:25,opacity:0,duration:.7,ease:"power2.in"},T("拿掉",1)+.1);cur(tl,S+"cur",1860,260,T("拿掉",1)+.1,.7);tl.to(S+"cur",{opacity:0,duration:.3},T("拿掉",1)+.8);
 var k=T("整个产品");
 tl.set(".px",{opacity:1},k-.05);tl.to(S+"chat",{opacity:0,duration:.15},k);
 tl.to(".px",{y:function(i){return 260+((i*37)%120);},x:function(i){return ((i*53)%140)-70;},rotation:function(i){return (i*47)%180;},opacity:0,duration:1.1,stagger:.02,ease:"power2.in"},k);
 pop(tl,S+"t2",T("只剩")+.1,{});'''
scene(4, '第 2 层', '产品', CARD + '''
#root .bb{width:fit-content;max-width:430px;font-size:32px;border:2.5px solid var(--ink);border-radius:22px;padding:8px 20px 10px;margin-bottom:16px;white-space:nowrap}
#root .px{width:70px;height:70px;border-radius:12px;background:#aed8f2;border:2px solid var(--ink)}''', s4h, s4js, dino=(1610, 860, 0, '#8fd8b8') if False else None)

# ---------- s5 组织①：传统流水线 ----------
stations = [('业务', '提需求', '#ffb3c6'), ('产品', '写文档', '#aed8f2'), ('设计', '画图', '#ffe08f'), ('开发', '写代码', '#9fe0c9'), ('测试', '找问题', '#d9c6ef'), ('上线', '发布', '#ffc29a')]
s5h = '<svg class="abs" style="left:110px;top:560px" width="1700" height="20"><path id="s5-belt" d="M0 10 H1700" stroke="#5b4636" stroke-width="6" stroke-dasharray="18 14"/></svg>\n'
for i, (a, b, c) in enumerate(stations):
    s5h += f'  <div class="abs st" id="s5-k{i}" style="left:{120+i*285}px;top:300px;background:{c}"><b>{a}</b><span>{b}</span><i></i><i style="top:-8px;left:10px"></i></div>\n  <div class="abs" id="s5-d{i}" style="left:{165+i*285}px;top:600px"></div>\n'
    if i < 5:
        s5h += f'  <div class="abs ar" id="s5-a{i}" style="left:{360+i*285}px;top:355px">→</div>\n'
s5h += '<div class="pnl" id="s5-cal" style="left:1560px;top:700px;width:250px;height:190px"><div class="pt" style="background:#ffb3c6;height:56px;font-size:30px">日历</div><div class="abs" id="s5-wk" style="left:0;right:0;top:80px;text-align:center;font-size:60px">第 1 周</div></div>'
s5js = ''.join(f'put("s5-d{i}",dino("d{i}",{{w:150,h:150,body:"{c}"}}));' for i, (a, b, c) in enumerate(stations))
s5js += '\n gsap.set(".st,.ar,#s5-cal,' + ','.join(f'#s5-d{i}' for i in range(6)) + '",{opacity:0});'
keys = ['业务', '产品', '设计', '开发', '测试', '上线']
for i, k in enumerate(keys):
    s5js += f'\n pop(tl,"#s5-k{i}",T("{k}")-.15,{{y:20}});tl.fromTo("#s5-d{i}",{{opacity:0,y:40}},{{opacity:1,y:0,duration:.45,ease:"back.out(1.6)"}},T("{k}")-.05);'
    if i: s5js += f'tl.fromTo("#s5-a{i-1}",{{opacity:0,x:-20}},{{opacity:1,x:0,duration:.3}},T("{k}")-.25);'
s5js += '\n var w=T("一转眼");tl.fromTo("#s5-cal",{opacity:0,y:30},{opacity:1,y:0,duration:.4},w-.5);["第 2 周","第 3 周","第 4 周"].forEach(function(t,i){tl.set("#s5-wk",{innerHTML:t},w+.3+i*.45);tl.fromTo("#s5-wk",{rotationX:80},{rotationX:0,duration:.3},w+.3+i*.45);});'
s5js += '\n tl.to(".st i",{y:-6,duration:.4,yoyo:true,repeat:9,ease:"sine.inOut"},T("业务"));'
scene(5, '第 3 层', '组织 · 传统流程', CARD + '''
#root .st{width:230px;height:200px;border:3px solid var(--ink);border-radius:24px;box-shadow:var(--sh);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
#root .st b{font-weight:400;font-size:46px}#root .st span{font-size:30px}
#root .st i{position:absolute;right:14px;top:14px;width:46px;height:56px;background:#fff;border:2.5px solid var(--ink);border-radius:5px}
#root .ar{font-size:60px}''', s5h, s5js)

# ---------- s6 组织②：谁提需求谁来做 ----------
s6h = '''<div class="pnl" id="s6-p" style="left:110px;top:220px;width:900px;height:430px"><div class="pt" style="background:#ffb3c6">HR 自己动手</div></div>
  <div class="abs" id="s6-hr" style="left:130px;top:350px"></div>
  <div class="bubble" id="s6-say" style="left:340px;top:300px;font-size:36px">帮我做个请假登记工具</div>
  <div class="abs" id="s6-lp" style="left:400px;top:410px"></div>
  <div class="codebox" id="s6-code" style="left:452px;top:440px;width:200px;height:120px;font-size:15px;line-height:1.5;border:none;background:transparent;padding:4px 6px"></div>
  <div class="abs" id="s6-app" style="left:700px;top:400px;width:270px;height:220px;border:3px solid var(--ink);border-radius:20px;background:#fff;box-shadow:var(--sh);padding:12px 16px"><div style="font-size:32px">请假登记</div><div class="ln2"></div><div class="ln2" style="width:70%"></div><div class="tag" style="font-size:26px;background:#9fe0c9;margin-top:10px">已接入系统 ✓</div></div>
  <div class="abs" id="s6-clk" style="left:830px;top:240px"></div><div class="tag abs" id="s6-min" style="left:690px;top:250px;background:#ffe08f;font-size:30px">几分钟</div>
  <div class="pnl" id="s6-sh" style="left:110px;top:680px;width:900px;height:150px"></div>
  <div class="abs" id="s6-shi" style="left:140px;top:700px"></div>
  <div class="lbl" id="s6-sht" style="left:260px;top:712px;font-size:38px">专业团队兜底：<span class="tag" style="font-size:32px;background:#aed8f2">平台</span> <span class="tag" style="font-size:32px;background:#ffe08f">数据</span> <span class="tag" style="font-size:32px;background:#ffb3c6">安全</span></div>
  <div class="pnl" id="s6-c" style="left:1060px;top:220px;width:750px;height:610px"><div class="pt" style="background:#9fe0c9">同样的业务</div></div>
  <div class="abs" id="s6-b1" style="left:1110px;top:330px"></div><div class="lbl" id="s6-l1" style="left:1110px;top:740px">过去 · 几百人</div>
  <div class="abs" id="s6-b2" style="left:1460px;top:470px"></div><div class="lbl" id="s6-l2" style="left:1440px;top:740px">现在 · 小团队</div>
  <div class="abs bar" id="s6-v1" style="left:1340px;top:330px;height:380px"></div><div class="abs bar" id="s6-v2" style="left:1690px;top:330px;height:380px"></div>'''
s6js = '''put("s6-hr",dino("hr",{w:220,h:220,body:"#ffb8c9",spike:"#ffe08f",wing:"#aed8f2"}));put("s6-lp",icon("laptop","#aed8f2",310));put("s6-clk",icon("clock","#9fe0c9",100));put("s6-shi",icon("shield","#9fe0c9",100));
 put("s6-b1",icon("building","#e6dfd6",220));put("s6-b2",icon("group","#9fe0c9",170));
 gsap.set(S+"p,"+S+"hr,"+S+"say,"+S+"lp,"+S+"app,"+S+"clk,"+S+"min,"+S+"sh,"+S+"shi,"+S+"sht,"+S+"c,"+S+"b1,"+S+"l1,"+S+"b2,"+S+"l2,"+S+"v1,"+S+"v2",{opacity:0});
 tl.fromTo(S+"p,"+S+"hr",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.15,ease:"power3.out"},T("HR")-.5);dtail(tl,"hr",T("HR"),20);
 pop(tl,S+"say",T("帮我做")-.2,{});tl.fromTo(S+"lp",{opacity:0,y:30},{opacity:1,y:0,duration:.4},T("帮我做"));
 typeText(tl,"s6-code","表单：请假人 · 日期\\n提交 → 审批 → 存档",T("几分钟")-.4,1.4);dtype(tl,"hr",T("几分钟")-.4,1.6);
 pop(tl,S+"clk",T("几分钟"),{});pop(tl,S+"min",T("几分钟")+.15,{});
 tl.to(S+"clk svg path:last-child",{rotation:360,svgOrigin:"50 52",duration:1.2,ease:"none"},T("几分钟")+.3);
 tl.fromTo(S+"app",{opacity:0,scale:.6,x:-60},{opacity:1,scale:1,x:0,duration:.6,ease:"back.out(1.6)"},T("生成"));
 tl.fromTo(S+"sh",{opacity:0,y:30},{opacity:1,y:0,duration:.5},T("专业团队")-.4);pop(tl,S+"shi",T("专业团队"),{});tl.fromTo(S+"sht",{opacity:0,x:-20},{opacity:1,x:0,duration:.5},T("平台"));
 tl.fromTo(S+"c",{opacity:0,y:40},{opacity:1,y:0,duration:.6,ease:"power3.out"},T("小团队")-1.2);
 tl.fromTo(S+"b1,"+S+"l1",{opacity:0,y:20},{opacity:1,y:0,duration:.4,stagger:.1},T("小团队")-.8);
 tl.fromTo(S+"v1",{opacity:1,scaleY:0},{scaleY:1,duration:.7,ease:"power2.out",transformOrigin:"50% 100%"},T("小团队")-.6);
 tl.fromTo(S+"b2,"+S+"l2",{opacity:0,y:20},{opacity:1,y:0,duration:.4,stagger:.1},T("小团队"));
 tl.fromTo(S+"v2",{opacity:1,scaleY:0},{scaleY:1.04,duration:.9,ease:"back.out(1.4)",transformOrigin:"50% 100%"},T("做出"));'''
scene(6, '第 3 层', '组织 · AI 原生', CARD + '''
#root .ln2{height:14px;border-radius:7px;background:#e6dfd6;margin-top:14px;width:90%}
#root .bar{width:56px;border:3px solid var(--ink);border-radius:14px 14px 4px 4px;background:linear-gradient(#ffe08f,#ffc29a)}''', s6h, s6js)

# ---------- s7 用户 ----------
s7h = '''<div class="pnl" id="s7-l" style="left:110px;top:220px;width:860px;height:620px"><div class="pt" style="background:#9fe0c9">新一代用户：直接说</div></div>
  <div class="abs" id="s7-kid" style="left:140px;top:520px"></div>
  <div class="bubble" id="s7-say" style="left:170px;top:330px;font-size:34px">讲一个恐龙去太空的故事！</div>
  <div class="abs" id="s7-tab" style="left:470px;top:440px;width:440px;height:330px;border:3px solid var(--ink);border-radius:30px;background:#2f3a64;box-shadow:var(--sh);overflow:hidden">
    <svg id="s7-art" width="440" height="230" viewBox="0 0 440 230"><circle cx="70" cy="50" r="5" fill="#fff"/><circle cx="380" cy="40" r="4" fill="#fff"/><circle cx="300" cy="90" r="3" fill="#fff"/><circle cx="120" cy="150" r="3" fill="#fff"/>
     <circle cx="350" cy="170" r="44" fill="#ffc29a" stroke="#5b4636" stroke-width="4"/><path d="M150 150 L200 70 L250 150 Z" fill="#fff" stroke="#5b4636" stroke-width="4" stroke-linejoin="round"/><rect x="170" y="150" width="60" height="50" rx="8" fill="#aed8f2" stroke="#5b4636" stroke-width="4"/><path id="s7-fire" d="M180 200 L200 228 L220 200 Z" fill="#ffd166"/></svg>
    <div id="s7-story" style="background:#fffdf8;height:100px;padding:14px 18px;font-size:26px;line-height:1.4"></div></div>
  <div class="pnl" id="s7-r" style="left:1010px;top:220px;width:800px;height:620px"><div class="pt" style="background:#e6dfd6">很多大人：一个字一个字地敲</div></div>
  <div class="abs" id="s7-adult" style="left:1040px;top:530px"></div>
  <div class="abs" id="s7-sb" style="left:1290px;top:400px;width:480px;height:80px;border:3px solid var(--ink);border-radius:40px;background:#fff;display:flex;align-items:center;gap:14px;padding:0 22px;font-size:34px"><span id="s7-mg"></span><span id="s7-kw"></span><i id="s7-caret" style="width:3px;height:40px;background:#5b4636"></i></div>
  <div class="abs" id="s7-res" style="left:1290px;top:510px;width:480px"><div class="ln3"></div><div class="ln3" style="width:80%"></div><div class="ln3" style="width:90%"></div><div class="ln3" style="width:60%"></div></div>'''
s7js = '''put("s7-kid",dino("kid",{w:250,h:250,body:"#ffe08f",spike:"#ffb3c6",wing:"#9fe0c9"}));put("s7-adult",dino("ad",{w:260,h:260,body:"#aed8f2",spike:"#ffe08f",wing:"#d9c6ef"}));put("s7-mg",icon("search","#aed8f2",44));
 gsap.set(S+"l,"+S+"kid,"+S+"say,"+S+"tab,"+S+"r,"+S+"adult,"+S+"sb,"+S+"res",{opacity:0});gsap.set("#s7-art",{opacity:0});
 tl.fromTo(S+"l,"+S+"kid",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.15,ease:"power3.out"},T("新一代")-.4);dtail(tl,"kid",T("新一代"),20);
 tl.fromTo(S+"tab",{opacity:0,y:30},{opacity:1,y:0,duration:.5},T("平板")-.3);
 pop(tl,S+"say",T("讲一个")-.2,{});
 tl.fromTo("#s7-art",{opacity:0,scale:.8},{opacity:1,scale:1,duration:.6,ease:"back.out(1.6)",transformOrigin:"50% 50%"},T("插画"));
 typeText(tl,"s7-story","小恐龙登上火箭，飞向橙色的星球…",T("故事",1)-.2,1.6);
 tl.to("#s7-fire",{scaleY:1.5,duration:.15,yoyo:true,repeat:11,transformOrigin:"50% 0%"},T("插画"));
 dcheer(tl,"kid",T("马上"));
 tl.fromTo(S+"r,"+S+"adult,"+S+"sb",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.15,ease:"power3.out"},T("很多大人")-.4);dtail(tl,"ad",T("很多大人"),10);
 typeText(tl,"s7-kw","恐龙 太空 故事 儿童",T("一个字")-.1,2.4);dtype(tl,"ad",T("一个字")-.1,2.4);
 tl.to("#s7-caret",{opacity:0,duration:.01,repeat:12,yoyo:true,repeatDelay:.25},T("很多大人"));
 tl.fromTo(S+"res",{opacity:0,y:20},{opacity:1,y:0,duration:.4},T("关键词")+.4);'''
scene(7, '第 4 层', '用户', CARD + '#root .ln3{height:22px;border-radius:11px;background:#e6dfd6;margin-bottom:22px}', s7h, s7js)

# ---------- s8 交互 ----------
s8h = '''<div class="pnl" id="s8-m" style="left:110px;top:220px;width:520px;height:620px"><div class="pt" style="background:#e6dfd6">点点点的菜单</div></div>
  <div class="abs" id="s8-mn" style="left:150px;top:310px;width:440px">
   <div class="mi">设置 ›</div><div class="mi" style="margin-left:40px">高级 ›</div><div class="mi" style="margin-left:80px">偏好 ›</div><div class="mi" style="margin-left:120px">语言 ›</div><div class="mi" style="margin-left:160px">中文 ✓</div></div>
  <div class="cursor" id="s8-cur"></div>
  <div class="pnl" id="s8-k" style="left:680px;top:220px;width:1130px;height:620px"><div class="pt" style="background:#9fe0c9">戴着智能眼镜做饭</div></div>
  <div class="abs" id="s8-cook" style="left:720px;top:500px"></div>
  <div class="abs" id="s8-gl" style="left:808px;top:536px"></div>
  <div class="abs" id="s8-pot" style="left:1060px;top:600px"></div>
  <div class="abs" id="s8-fr" style="left:1560px;top:380px"></div>
  <div class="bubble" id="s8-ask" style="left:780px;top:330px;font-size:32px">这个要煮几分钟？</div>
  <div class="abs hud" id="s8-hud" style="left:1110px;top:310px">⏱ 煮 8 分钟</div>
  <div class="abs hud" id="s8-nx" style="left:1110px;top:410px;background:rgba(217,198,239,.9)">下一步：放入番茄 →</div>
  <svg class="abs" style="left:0;top:0" width="1920" height="1080" id="s8-svg"><path id="s8-sw" d="M980 520 C1040 470 1100 470 1160 500" stroke="#d9c6ef" stroke-width="10" fill="none" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/><path id="s8-gz" d="M910 560 L1560 470" stroke="#ffe08f" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="12 12" opacity="0"/></svg>
  <div class="abs" id="s8-food" style="left:1410px;top:600px;display:flex;flex-direction:column;gap:10px"><span class="tag" style="background:#ffb3c6;font-size:30px">番茄 ×3</span><span class="tag" style="background:#fff;font-size:30px">鸡蛋 ×6</span><span class="tag" style="background:#9fe0c9;font-size:30px">青菜 ×1</span></div>
  <div class="abs" id="s8-tri" style="left:1240px;top:740px;display:flex;gap:14px"><span class="tag" style="background:#aed8f2;font-size:32px">语音</span><span class="tag" style="background:#d9c6ef;font-size:32px">手势</span><span class="tag" style="background:#ffe08f;font-size:32px">视线</span></div>'''
s8js = '''put("s8-cook",dino("ck",{w:260,h:260,body:"#9fe0c9",spike:"#ffb08a",wing:"#ffb3c6"}));put("s8-gl",icon("glasses","#aed8f2",120));put("s8-pot",icon("pot","#ffc29a",170));put("s8-fr",icon("fridge","#aed8f2",220));put("s8-cur",icon("cursor","#ffffff",64));
 gsap.set(S+"m,"+S+"mn,"+S+"cur,"+S+"k,"+S+"cook,"+S+"gl,"+S+"pot,"+S+"fr,"+S+"ask,"+S+"hud,"+S+"nx,"+S+"food,"+S+"tri",{opacity:0});
 tl.fromTo(S+"m,"+S+"mn",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.15,ease:"power3.out"},.6);
 tl.set(S+"cur",{x:560,y:760});tl.to(S+"cur",{opacity:1,duration:.2},1.0);
 ["#s8-mn .mi"].forEach(function(){});var mis=document.querySelectorAll("#s8-mn .mi");
 for(var i=0;i<5;i++){cur(tl,S+"cur",230+i*40,330+i*84,1.2+i*.45,.35);click(tl,S+"cur",1.55+i*.45);tl.to(mis[i],{backgroundColor:"#ffe08f",duration:.15},1.6+i*.45);}
 tl.to(S+"m,"+S+"mn,"+S+"cur",{filter:"grayscale(1)",opacity:.35,duration:.8},T("正在慢慢")-.2);
 tl.fromTo(S+"k,"+S+"cook,"+S+"pot,"+S+"fr",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.12,ease:"power3.out"},T("智能眼镜")-.6);dtail(tl,"ck",T("智能眼镜"),14);
 tl.fromTo(S+"gl",{opacity:0,y:-60},{opacity:1,y:0,duration:.5,ease:"back.out(2)"},T("眼镜")-.1);
 pop(tl,S+"ask",T("这个要煮")-.3,{});
 tl.fromTo(S+"hud",{opacity:0,scale:.7,x:-30},{opacity:1,scale:1,x:0,duration:.5,ease:"back.out(1.8)"},T("答案"));
 tl.to(S+"ask",{opacity:0,duration:.3},T("手一挥")-.3);
 dset(tl,"ck","armR",{rotation:-70},T("手一挥")-.1,.35,"back.out(1.6)");dset(tl,"ck","armR",{rotation:0},T("手一挥")+.6,.4);
 draw(tl,"#s8-sw",T("手一挥"),.5);tl.fromTo(S+"nx",{opacity:0,x:80},{opacity:1,x:0,duration:.5,ease:"power3.out"},T("下一步")-.1);tl.to("#s8-sw",{opacity:0,duration:.4},T("下一步")+.8);
 tl.to(S+"gz",{opacity:1,strokeDashoffset:-120,duration:1.6,ease:"none"},T("看一眼"));dlook(tl,"ck",T("看一眼"),6);
 tl.fromTo("#s8-food .tag",{opacity:0,x:30},{opacity:1,x:0,duration:.35,stagger:.2},T("认出"));tl.set(S+"food",{opacity:1},T("认出"));
 tl.fromTo(S+"tri",{opacity:0,y:20},{opacity:1,y:0,duration:.4},T("食材")+.5);'''
scene(8, '第 5 层', '交互', CARD + '''
#root .mi{font-size:34px;border:2.5px solid var(--ink);border-radius:14px;background:#fff;padding:6px 18px 8px;margin-bottom:22px;width:fit-content}
#root .hud{font-size:36px;background:rgba(174,216,242,.9);border:2.5px solid var(--ink);border-radius:18px;padding:10px 22px 12px;box-shadow:0 0 24px rgba(174,216,242,.9);white-space:nowrap}''', s8h, s8js)

# ---------- s9 商业模式 ----------
s9h = '''<div class="abs" id="s9-w" style="left:150px;top:260px"></div><div class="lbl" id="s9-wl" style="left:150px;top:420px">用户请求</div>
  <div class="abs" id="s9-cl" style="left:1500px;top:220px"></div><div class="lbl" id="s9-cll" style="left:1520px;top:420px">算力中心</div>
  <div class="tag abs" id="s9-a1" style="left:600px;top:240px;background:#fff">问一句话：几枚</div>
  <div class="tag abs" id="s9-a2" style="left:600px;top:240px;background:#ffb3c6">生成视频：一大串</div>
  <div id="s9-coins"></div>
  <svg class="abs" id="s9-sc" style="left:560px;top:470px" width="800" height="380" viewBox="0 0 800 380" overflow="visible">
   <path d="M400 70 V330 M300 340 H500" class="ln" style="stroke-width:7"/>
   <g id="s9-beam"><path d="M120 70 H680" class="ln" style="stroke-width:7"/>
    <g id="s9-pl"><path d="M120 70 L70 170 M120 70 L170 170" class="ln" style="stroke-width:4"/><path d="M50 170 H190 Q120 220 50 170Z" fill="#9fe0c9" stroke="#5b4636" stroke-width="4"/><text x="120" y="250" text-anchor="middle" font-family="ZCOOL KuaiLe" font-size="34" fill="#5b4636">用户付的钱</text></g>
    <g id="s9-pr"><path d="M680 70 L630 170 M680 70 L730 170" class="ln" style="stroke-width:4"/><path d="M610 170 H750 Q680 220 610 170Z" fill="#ffb3c6" stroke="#5b4636" stroke-width="4"/><text x="680" y="250" text-anchor="middle" font-family="ZCOOL KuaiLe" font-size="34" fill="#5b4636">Token 成本</text></g></g>
   <circle cx="400" cy="70" r="14" fill="#ffe08f" stroke="#5b4636" stroke-width="4"/></svg>
  <div class="abs" id="s9-app" style="left:910px;top:300px"></div><div class="abs" id="s9-crack" style="left:930px;top:310px;font-size:80px;color:#f27b96">⚡</div>
  <div class="abs" id="s9-pt" style="left:1380px;top:640px;display:flex;flex-direction:column;gap:12px"><span class="tag" style="background:#ffe08f;font-size:34px">按用量计费</span><span class="tag" style="background:#9fe0c9;font-size:34px">按效果付费</span></div>'''
s9js = '''put("s9-w",icon("wallet","#ffb3c6",150));put("s9-cl",icon("server","#aed8f2",170));put("s9-app",icon("phone","#9fe0c9",110));
 var c="";for(var i=0;i<14;i++)c+='<span class="abs cn" id="s9-c'+i+'" style="left:300px;top:'+(300+(i%3)*24)+'px"></span>';document.getElementById("s9-coins").innerHTML=c;
 document.querySelectorAll("#s9-coins .cn").forEach(function(e){e.innerHTML=icon("coin","#ffe08f",54);});
 gsap.set(S+"w,"+S+"wl,"+S+"cl,"+S+"cll,"+S+"a1,"+S+"a2,"+S+"sc,"+S+"app,"+S+"crack,"+S+"pt,.cn",{opacity:0});
 tl.fromTo(S+"w,"+S+"wl,"+S+"cl,"+S+"cll",{opacity:0,y:30},{opacity:1,y:0,duration:.5,stagger:.1},T("Token")-.8);
 var fly=function(n,t){for(var i=0;i<n;i++){tl.fromTo("#s9-c"+i,{opacity:0,x:0,y:0},{opacity:1,x:1180,y:-40+(i%3)*20,duration:1.1,ease:"sine.inOut"},t+i*.12);tl.to("#s9-c"+i,{opacity:0,duration:.15},t+i*.12+1.0);}};
 pop(tl,S+"a1",T("问一句话")-.2,{});fly(3,T("问一句话"));tl.to(S+"a1",{opacity:0,duration:.25},T("生成一段")-.3);
 pop(tl,S+"a2",T("生成一段")-.1,{});fly(14,T("生成一段")+.1);
 tl.fromTo(S+"sc",{opacity:0,y:30},{opacity:1,y:0,duration:.5},T("如果")-.3);tl.fromTo(S+"app",{opacity:0,scale:.6},{opacity:1,scale:1,duration:.4,ease:"back.out(2)"},T("如果"));
 tl.to("#s9-beam",{rotation:12,svgOrigin:"400 70",duration:.8,ease:"back.out(1.4)"},T("撑不住"));
 tl.to("#s9-pl",{rotation:-12,svgOrigin:"120 70",duration:.8},T("撑不住"));tl.to("#s9-pr",{rotation:-12,svgOrigin:"680 70",duration:.8},T("撑不住"));
 tl.fromTo(S+"crack",{opacity:0,scale:.3},{opacity:1,scale:1,duration:.3,ease:"back.out(3)"},T("亏得"));tl.to(S+"app",{rotation:-8,x:-6,duration:.08,repeat:7,yoyo:true},T("亏得"));tl.to(S+"app",{filter:"grayscale(1)",duration:.3},T("亏得"));
 tl.fromTo("#s9-pt .tag",{opacity:0,x:40},{opacity:1,x:0,duration:.4,stagger:.3},T("按用量")-.2);tl.set(S+"pt",{opacity:1},T("按用量")-.2);
 tl.to("#s9-beam,#s9-pl,#s9-pr",{rotation:0,duration:.9,ease:"back.out(1.6)"},T("回正")-.3);
 tl.to(S+"crack",{opacity:0,duration:.3},T("回正")-.3);tl.to(S+"app",{filter:"grayscale(0)",scale:1.15,duration:.4,yoyo:true,repeat:1},T("回正"));'''
scene(9, '第 6 层', '商业模式', CARD, s9h, s9js, dino=(110, 660, 230, '#8fd8b8'))

# ---------- s10 硬件①：检验 ----------
dev = [('cooker', '电饭煲', '#aed8f2', 200), ('camera', '相机', '#d9c6ef', 690), ('pendant', 'AI 录音挂件', '#ffe08f', 1180)]
s10h = '<div class="abs" id="s10-tb" style="left:110px;top:640px;width:1700px;height:40px;border-radius:20px;background:#e8c9a4;border:3px solid var(--ink)"></div>\n'
for i, (ic, nm, c, x) in enumerate(dev):
    s10h += f'  <div class="abs" id="s10-v{i}" style="left:{x}px;top:380px"></div><div class="tag abs" id="s10-c{i}" style="left:{x+150}px;top:330px;background:#ffb3c6;font-size:30px">AI 芯片</div><div class="lbl" id="s10-n{i}" style="left:{x+20}px;top:700px;font-size:38px">{nm}</div>\n'
s10h += '''  <div class="tag abs" id="s10-k0" style="left:180px;top:780px;background:#e6dfd6">照样煮饭 ✓ 只是用上 AI</div>
  <div class="tag abs" id="s10-k1" style="left:660px;top:780px;background:#e6dfd6">照样拍照 ✓ 只是用上 AI</div>
  <div class="tag abs" id="s10-k2" style="left:1160px;top:780px;background:#9fe0c9;font-size:40px">只剩空壳 → AI 原生硬件</div>
  <div class="abs" id="s10-steam" style="left:300px;top:330px;font-size:60px">♨</div><div class="abs" id="s10-flash" style="left:690px;top:380px;width:260px;height:260px;border-radius:50%;background:radial-gradient(#fff,rgba(255,255,255,0))"></div>
  <div class="cursor" id="s10-cur"></div>'''
s10js = ''.join(f'put("s10-v{i}",icon("{ic}","{c}",260));' for i, (ic, nm, c, x) in enumerate(dev)) + 'put("s10-cur",icon("cursor","#ffffff",70));'
s10js += '''
 gsap.set(S+"tb,"+S+"v0,"+S+"v1,"+S+"v2,"+S+"c0,"+S+"c1,"+S+"c2,"+S+"n0,"+S+"n1,"+S+"n2,"+S+"k0,"+S+"k1,"+S+"k2,"+S+"steam,"+S+"flash,"+S+"cur",{opacity:0});
 var b=WHY.e+LEAD+.3;
 tl.fromTo(S+"tb",{opacity:0},{opacity:1,duration:.4},b-.2);
 [0,1,2].forEach(function(i){tl.fromTo(S+"v"+i+","+S+"n"+i,{opacity:0,y:40},{opacity:1,y:0,duration:.5,ease:"back.out(1.5)"},b+i*.15);pop(tl,S+"c"+i,b+.3+i*.15,{});});
 var p=T("拔掉AI芯片");tl.set(S+"cur",{x:200,y:900});tl.to(S+"cur",{opacity:1,duration:.2},p-.6);
 [0,1].forEach(function(i){var x=[350,840][i];cur(tl,S+"cur",x,350,p-.5+i*.6,.4);tl.to(S+"c"+i,{y:-160,rotation:25,opacity:0,duration:.5,ease:"power2.in"},p+i*.6);});
 tl.fromTo(S+"steam",{opacity:0,y:20},{opacity:1,y:-30,duration:.8,repeat:2,yoyo:true},T("煮饭")-.2);
 tl.fromTo(S+"flash",{opacity:0},{opacity:1,duration:.12,yoyo:true,repeat:1},T("拍照"));
 pop(tl,S+"k0",T("只是用上")-.3,{});pop(tl,S+"k1",T("只是用上")+.1,{});
 var q=T("拔掉AI",1);cur(tl,S+"cur",1330,350,q-.5,.4);tl.to(S+"c2",{y:-160,rotation:25,opacity:0,duration:.5,ease:"power2.in"},q);tl.to(S+"cur",{opacity:0,duration:.3},q+.6);
 tl.to(S+"v2",{filter:"grayscale(1)",opacity:.45,duration:.6},T("空壳")-.6);pop(tl,S+"k2",T("空壳"),{});'''
scene(10, '第 7 层', '硬件（重点）', CARD, s10h, s10js)

# ---------- s11 硬件②：录音挂件 ----------
s11h = '''<div class="pnl" id="s11-mt" style="left:110px;top:220px;width:700px;height:620px"><div class="pt" style="background:#ffe08f">开会中</div></div>
  <div class="abs" id="s11-dn" style="left:230px;top:380px"></div>
  <div class="abs" id="s11-pd" style="left:400px;top:560px"></div>
  <div class="abs" id="s11-wv" style="left:500px;top:440px"></div>
  <div class="abs" id="s11-cl" style="left:950px;top:220px"></div><div class="abs" id="s11-br" style="left:1020px;top:270px"></div>
  <svg class="abs" style="left:0;top:0" width="1920" height="1080"><path id="s11-up" d="M560 520 C700 420 820 360 960 330" stroke="#ffd166" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="14 14" opacity="0"/></svg>
  <div class="abs out" id="s11-o1" style="left:1280px;top:250px;background:#aed8f2">文字稿</div>
  <div class="abs out" id="s11-o2" style="left:1280px;top:360px;background:#ffe08f">重点总结</div>
  <div class="abs out" id="s11-o3" style="left:1280px;top:470px;background:#9fe0c9">待办清单 ✓</div>
  <div class="abs" id="s11-ph" style="left:1420px;top:560px"></div>'''
s11js = '''put("s11-dn",dino("dn",{w:300,h:300}));put("s11-pd",icon("pendant","#ffe08f",80));put("s11-wv",icon("wave","#ffd166",100));put("s11-cl",icon("cloud","#aed8f2",280));put("s11-br",icon("brain","#ffb3c6",130));put("s11-ph",icon("phone","#ffb3c6",240));
 gsap.set(S+"mt,"+S+"dn,"+S+"pd,"+S+"wv,"+S+"cl,"+S+"br,"+S+"o1,"+S+"o2,"+S+"o3,"+S+"ph",{opacity:0});
 tl.fromTo(S+"mt,"+S+"dn",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.15,ease:"power3.out"},.4);dtail(tl,"dn",.6,16);
 tl.fromTo(S+"pd",{opacity:0,y:-80,scale:.5},{opacity:1,y:0,scale:1,duration:.6,ease:"back.out(2)"},T("夹在")-.1);
 tl.fromTo(S+"wv",{opacity:0,scaleY:.3},{opacity:1,scaleY:1,duration:.3,repeat:7,yoyo:true,transformOrigin:"50% 50%"},T("负责听")-.2);
 tl.fromTo(S+"cl,"+S+"br",{opacity:0,scale:.7},{opacity:1,scale:1,duration:.5,stagger:.1,ease:"back.out(1.6)"},T("云端")-.5);
 tl.to(S+"up",{opacity:1,strokeDashoffset:-140,duration:2,ease:"none"},T("声音")-.1);
 tl.to(S+"br",{scale:1.1,duration:.3,yoyo:true,repeat:5,transformOrigin:"50% 50%"},T("AI")-.1);
 [["o1","文字"],["o2","重点总结"],["o3","办"]].forEach(function(a){tl.fromTo(S+a[0],{opacity:0,x:-60,scale:.8},{opacity:1,x:0,scale:1,duration:.45,ease:"back.out(1.6)"},T(a[1])-.15);});
 tl.fromTo(S+"ph",{opacity:0,y:40},{opacity:1,y:0,duration:.5},T("推送")-.4);
 tl.to(S+"o1,"+S+"o2,"+S+"o3",{x:180,y:"+=330",scale:.5,opacity:0,duration:.7,stagger:.12,ease:"power2.in"},T("手机")-.1);'''
scene(11, '第 7 层', '硬件 · AI 录音挂件', CARD + '\n#root .out{font-size:38px;border:3px solid var(--ink);border-radius:18px;padding:10px 26px 12px;box-shadow:var(--sh);white-space:nowrap}', s11h, s11js)

# ---------- s12 硬件③：陪伴玩具 ----------
s12h = '''<div class="pnl" id="s12-l" style="left:110px;top:220px;width:780px;height:620px"><div class="pt" style="background:#ffb3c6">AI 陪伴玩具</div></div>
  <div class="abs" id="s12-kid" style="left:150px;top:480px"></div><div class="abs" id="s12-bear" style="left:380px;top:560px"></div>
  <div class="bubble" id="s12-b1" style="left:150px;top:310px;font-size:32px">小熊，我们去哪玩？</div>
  <div class="bubble" id="s12-b2" style="left:470px;top:400px;font-size:32px">你昨天说想去海边！</div>
  <div class="pnl" id="s12-r" style="left:940px;top:220px;width:870px;height:620px"><div class="pt" style="background:#aed8f2">拆开看看</div></div>
  <div class="abs" id="s12-x" style="left:990px;top:330px;width:400px;height:400px;border-radius:50%;border:4px dashed var(--ink);background:rgba(255,179,198,.18)"></div>
  <div class="abs" id="s12-p1" style="left:1030px;top:390px;text-align:center"><span id="s12-i1"></span><br><span class="tag" style="font-size:28px;background:#fff">麦克风</span></div>
  <div class="abs" id="s12-p2" style="left:1220px;top:390px;text-align:center"><span id="s12-i2"></span><br><span class="tag" style="font-size:28px;background:#fff">喇叭</span></div>
  <div class="abs" id="s12-p3" style="left:1125px;top:560px;text-align:center"><span id="s12-i3"></span><br><span class="tag" style="font-size:28px;background:#fff">联网芯片</span></div>
  <svg class="abs" style="left:0;top:0" width="1920" height="1080"><path id="s12-ln" d="M1250 600 C1400 560 1480 460 1560 420" stroke="#ffd166" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="14 14" opacity="0"/></svg>
  <div class="abs" id="s12-cl" style="left:1500px;top:280px"></div><div class="abs" id="s12-br" style="left:1560px;top:320px"></div><div class="lbl" id="s12-cll" style="left:1500px;top:470px;font-size:32px">大脑 + 记忆在云端</div>
  <div class="abs" id="s12-sf" style="left:990px;top:760px;display:flex;align-items:center;gap:12px"><span id="s12-si"></span><span class="tag" style="font-size:36px;background:#9fe0c9">儿童隐私 · 内容安全 第一位</span></div>'''
s12js = '''put("s12-kid",dino("kid2",{w:230,h:230,body:"#ffe08f",spike:"#ffb3c6",wing:"#9fe0c9"}));put("s12-bear",icon("bear","#ffc29a",200));put("s12-i1",icon("mic","#aed8f2",100));put("s12-i2",icon("wave","#ffb3c6",100));put("s12-i3",icon("chip","#ffe08f",100));put("s12-cl",icon("cloud","#aed8f2",240));put("s12-br",icon("brain","#ffb3c6",110));put("s12-si",icon("shield","#9fe0c9",70));
 gsap.set(S+"l,"+S+"kid,"+S+"bear,"+S+"b1,"+S+"b2,"+S+"r,"+S+"x,"+S+"p1,"+S+"p2,"+S+"p3,"+S+"cl,"+S+"br,"+S+"cll,"+S+"sf",{opacity:0});
 tl.fromTo(S+"l,"+S+"kid,"+S+"bear",{opacity:0,y:40},{opacity:1,y:0,duration:.6,stagger:.12,ease:"power3.out"},T("陪伴")-.4);dtail(tl,"kid2",T("陪伴"),16);
 tl.to(S+"bear",{rotation:-5,duration:.5,yoyo:true,repeat:5,ease:"sine.inOut",transformOrigin:"50% 100%"},T("聊天"));
 pop(tl,S+"b1",T("聊天")-.2,{});pop(tl,S+"b2",T("记得"),{});tl.to(S+"b1",{opacity:.4,duration:.3},T("记得"));
 tl.fromTo(S+"r,"+S+"x",{opacity:0,y:40},{opacity:1,y:0,duration:.5,stagger:.12,ease:"power3.out"},T("拆开")-.4);
 tl.to(S+"bear",{opacity:.5,duration:.4},T("拆开"));
 pop(tl,S+"p1",T("麦克风")-.15,{});pop(tl,S+"p2",T("喇叭")-.15,{});pop(tl,S+"p3",T("联网芯片")-.15,{});
 tl.to(S+"ln",{opacity:1,strokeDashoffset:-140,duration:2.2,ease:"none"},T("大脑")-.4);
 tl.fromTo(S+"cl,"+S+"br,"+S+"cll",{opacity:0,scale:.7},{opacity:1,scale:1,duration:.5,stagger:.12,ease:"back.out(1.6)"},T("大脑")-.2);
 tl.fromTo(S+"sf",{opacity:0,y:20},{opacity:1,y:0,duration:.5,ease:"back.out(1.6)"},T("儿童隐私")-.2);tl.to(S+"sf",{scale:1.06,duration:.35,yoyo:true,repeat:3,transformOrigin:"0% 50%"},T("第一"));'''
scene(12, '第 7 层', '硬件 · AI 陪伴玩具', CARD, s12h, s12js)

# ---------- s13 硬件④：Token 化 ----------
s13h = '''<div class="pnl" id="s13-a" style="left:110px;top:220px;width:1700px;height:260px"><div class="pt" style="background:#e6dfd6;justify-content:flex-start;padding-left:30px">传统硬件</div></div>
  <div class="abs tl" id="s13-l1" style="left:260px;top:380px;width:1300px"></div>
  <div class="abs node" id="s13-n1" style="left:230px;top:350px;background:#ffe08f">购买</div>
  <div class="tag abs" id="s13-e1" style="left:1380px;top:340px;background:#e6dfd6">交易结束</div>
  <div class="pnl" id="s13-b" style="left:110px;top:510px;width:1700px;height:330px"><div class="pt" style="background:#9fe0c9;justify-content:flex-start;padding-left:30px">AI 原生硬件</div></div>
  <div class="abs tl" id="s13-l2" style="left:260px;top:670px;width:1500px;background:#47cf9f"></div>
  <div class="abs node" id="s13-n2" style="left:230px;top:640px;background:#ffe08f">购买</div>
  <div class="abs ev" id="s13-v0" style="left:520px;top:600px">对话</div><div class="abs ev" id="s13-v1" style="left:760px;top:600px">总结</div><div class="abs ev" id="s13-v2" style="left:1000px;top:600px">识别</div><div class="abs ev" id="s13-v3" style="left:1240px;top:600px">提醒</div>
  <svg class="abs" style="left:300px;top:690px" width="1460" height="140" viewBox="0 0 1460 140"><path id="s13-rv" d="M0 130 C300 125 600 100 900 70 C1100 50 1300 25 1450 10" stroke="#f27b96" stroke-width="8" fill="none" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>
  <div class="tag abs" id="s13-sub" style="left:1460px;top:700px;background:#ffb3c6">会员订阅收入 ↗</div>'''
s13js = '''gsap.set(S+"a,"+S+"l1,"+S+"n1,"+S+"e1,"+S+"b,"+S+"l2,"+S+"n2,"+S+"v0,"+S+"v1,"+S+"v2,"+S+"v3,"+S+"sub",{opacity:0});
 tl.fromTo(S+"a",{opacity:0,y:30},{opacity:1,y:0,duration:.5},T("传统硬件")-.4);pop(tl,S+"n1",T("卖"),{});
 tl.fromTo(S+"l1",{opacity:1,scaleX:0},{scaleX:1,duration:.8,ease:"power2.out",transformOrigin:"0% 50%"},T("卖")+.3);
 tl.to(S+"l1",{backgroundColor:"#d4ccc4",duration:.5},T("结束")-.2);pop(tl,S+"e1",T("结束"),{});
 tl.fromTo(S+"b",{opacity:0,y:30},{opacity:1,y:0,duration:.5},T("AI原生")-.4);pop(tl,S+"n2",T("AI原生"),{});
 tl.fromTo(S+"l2",{opacity:1,scaleX:0},{scaleX:1,duration:2.6,ease:"none",transformOrigin:"0% 50%"},T("每天")-.3);
 [["v0","对话"],["v1","总结"],["v2","识别"],["v3","提醒"]].forEach(function(a){tl.fromTo(S+a[0],{opacity:0,y:20,scale:.6},{opacity:1,y:0,scale:1,duration:.4,ease:"back.out(2)"},T(a[1])-.1);});
 tl.to(".ev",{scale:1.12,duration:.25,yoyo:true,repeat:1,stagger:.12,transformOrigin:"50% 50%"},T("Token"));
 draw(tl,"#s13-rv",T("会员订阅")-.4,1.4);pop(tl,S+"sub",T("收入")-.1,{});'''
scene(13, '第 7 层', '硬件 · 卖出去才是开始', CARD + '''
#root .tl{height:14px;border-radius:7px;background:#5b4636}
#root .node{font-size:34px;border:3px solid var(--ink);border-radius:999px;padding:8px 24px 10px;z-index:2}
#root .ev{font-size:32px;border:3px solid var(--ink);border-radius:18px;padding:6px 18px 8px;background:#fff;box-shadow:0 0 20px rgba(255,209,102,.8),var(--sh);display:flex;align-items:center;gap:8px}
#root .ev:after{content:"T";width:34px;height:34px;border-radius:50%;background:#ffe08f;border:2.5px solid var(--ink);font-size:24px;display:flex;align-items:center;justify-content:center}''', s13h, s13js)

# ---------- s14 硬件⑤：同一个云端大脑 ----------
nodes = [('glasses', '眼镜', 380, 280), ('headset', '耳机', 340, 620), ('pendant', '挂件', 960, 760), ('bear', '玩具', 1560, 620), ('car', '汽车', 1520, 280)]
s14h = '<svg class="abs" style="left:0;top:0" width="1920" height="1080">' + ''.join(f'<path id="s14-k{i}" d="M{x+70} {y+70} L960 450" stroke="#ffd166" stroke-width="8" stroke-linecap="round" fill="none" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>' for i, (ic, nm, x, y) in enumerate(nodes)) + '</svg>\n'
s14h += '  <div class="abs" id="s14-cl" style="left:810px;top:330px"></div><div class="abs" id="s14-br" style="left:895px;top:380px"></div><div class="lbl" id="s14-cll" style="left:850px;top:270px;font-size:36px">云端大脑</div>\n'
s14h += '  <div class="abs" id="s14-shell" style="left:860px;top:640px;width:200px;height:200px;border-radius:40px;border:4px solid var(--ink);background:#ffe08f"></div>\n'
for i, (ic, nm, x, y) in enumerate(nodes):
    s14h += f'  <div class="abs" id="s14-n{i}" style="left:{x}px;top:{y}px;text-align:center"><span id="s14-i{i}"></span><br><span class="tag" style="font-size:30px;background:#fff">{nm}</span></div>\n'
s14js = 'put("s14-cl",icon("cloud","#aed8f2",300));put("s14-br",icon("brain","#ffb3c6",130));' + ''.join(f'put("s14-i{i}",icon("{ic}","{["#aed8f2","#9fe0c9","#ffe08f","#ffc29a","#d9c6ef"][i]}",140));' for i, (ic, nm, x, y) in enumerate(nodes))
s14js += '''
 gsap.set(S+"cl,"+S+"br,"+S+"cll,"+S+"shell,"+S+"n0,"+S+"n1,"+S+"n2,"+S+"n3,"+S+"n4",{opacity:0});
 tl.fromTo(S+"shell",{opacity:0,scale:.6},{opacity:1,scale:1,duration:.5,ease:"back.out(1.6)"},.5);
 tl.to(S+"shell",{backgroundColor:"rgba(255,224,143,.15)",borderStyle:"dashed",duration:.8},T("变透明")-.2);
 tl.fromTo(S+"cl,"+S+"br,"+S+"cll",{opacity:0,scale:.7},{opacity:1,scale:1,duration:.6,stagger:.12,ease:"back.out(1.6)"},T("发现")-.2);
 tl.to(S+"shell",{opacity:0,duration:.4},T("眼镜")-.3);
 ["眼镜","耳机","挂件","玩具","汽车"].forEach(function(k,i){pop(tl,S+"n"+i,T(k)-.15,{y:20});draw(tl,"#s14-k"+i,T(k),.6);});
 tl.to(S+"br",{scale:1.15,duration:.35,yoyo:true,repeat:5,transformOrigin:"50% 50%"},T("同一个"));
 tl.to("#s14-k0,#s14-k1,#s14-k2,#s14-k3,#s14-k4",{strokeDasharray:"0.04 0.03",duration:.01},T("同一个"));
 tl.to("#s14-k0,#s14-k1,#s14-k2,#s14-k3,#s14-k4",{strokeDashoffset:-1,duration:3,ease:"none"},T("同一个"));'''
scene(14, '第 7 层', '硬件 · 小结', CARD, s14h, s14js)

# ---------- s15 片尾：七层塔 ----------
layers = [('技术架构', '#ffb3c6'), ('产品', '#aed8f2'), ('组织', '#ffe08f'), ('用户', '#9fe0c9'), ('交互', '#d9c6ef'), ('商业模式', '#ffc29a'), ('硬件', '#ffb3c6')]
s15h = ''
for i, (nm, c) in enumerate(layers):
    w = 620 - i * 50
    s15h += f'  <div class="abs blk" id="s15-b{i}" style="left:{960-w/2-300:.0f}px;top:{800-i*82}px;width:{w}px;background:{c}">{nm}</div>\n'
s15h += '''  <div class="abs" id="s15-top" style="left:1010px;top:330px;width:780px;font-size:60px;line-height:1.35">不是给旧东西加上 AI<br><span style="background:linear-gradient(transparent 60%,rgba(255,224,143,.9) 60%)">而是从 AI 出发，重新设计一切</span></div>
  <div class="abs" id="s15-d" style="left:1350px;top:610px"></div>
  <div class="bubble" id="s15-bye" style="left:1190px;top:600px;font-size:40px">下次见！</div>'''
s15js = '''put("s15-d",dino("dn",{w:280,h:280}));
 gsap.set(S+"top,"+S+"bye",{opacity:0});
 tl.fromTo(S+"d",{opacity:0,y:80},{opacity:1,y:0,duration:.6,ease:"back.out(1.5)"},.4);dtail(tl,"dn",.6,16);
 ["技术架构","产品","组织","用户","交互","商业模式","硬件"].forEach(function(k,i){tl.fromTo(S+"b"+i,{opacity:0,y:-260,rotation:(i%2?6:-6)},{opacity:1,y:0,rotation:0,duration:.55,ease:"bounce.out"},T(k)-.2);});
 tl.fromTo(S+"top",{opacity:0,x:40},{opacity:1,x:0,duration:.7,ease:"power3.out"},T("不是给")-.2);
 tl.to("#s15-b0,#s15-b1,#s15-b2,#s15-b3,#s15-b4,#s15-b5,#s15-b6",{boxShadow:"0 0 30px rgba(255,209,102,.9)",duration:.5,stagger:.08},T("重新设计")-.3);
 pop(tl,S+"bye",T("下次见")-.3,{});dwave(tl,"dn",T("我是小龙")-.2,4);'''
scene(15, '', '七层总览', CARD + '\n#root .blk{height:72px;border:3px solid var(--ink);border-radius:18px;box-shadow:var(--sh);display:flex;align-items:center;justify-content:center;font-size:38px}', s15h, s15js)
print('ok')
