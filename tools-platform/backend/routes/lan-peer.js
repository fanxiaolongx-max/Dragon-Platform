// 内网直连共享的节点接口（/api/lan-peer/:shareId/*）与落地页（/lan-share/:shareId）：其他电脑上的 Dragon Claw 桌面版直接调用。
// 不走登录：加入时校验链接令牌，之后按节点号 + 节点密钥校验；只接受内网 / 本机地址的请求，且只在桌面版启用。
const express = require('express');
const lanShare = require('../models/lan-share');

const api = express.Router();
const SHARE_ID = /^[\w-]{4,80}$/;

api.use((req, res, next) => {
    if (!lanShare.enabled()) return res.status(404).json({ code: 'LAN_UNAVAILABLE', error: '内网直连共享未启用' });
    if (!lanShare.requestAllowed(req)) return res.status(403).json({ code: 'LAN_FORBIDDEN', error: '只接受内网请求' });
    res.setHeader('Cache-Control', 'no-store');
    next();
});
const handle = fn => async (req, res) => {
    if (!SHARE_ID.test(req.params.shareId)) return res.status(400).json({ code: 'LAN_BAD_SHARE', error: '共享编号无效' });
    try {
        const result = await fn(req.params.shareId, req, res);
        if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
        if (!error.statusCode) console.error('[lan-peer]', error);
        if (res.headersSent) return res.end();
        res.status(error.statusCode || 500).json({ ...(error.body || {}), code: error.code || 'LAN_PEER_FAILED', error: error.statusCode ? error.message : '内网共享节点请求失败' });
    }
};

api.post('/:shareId/join', handle((id, req) => lanShare.peerJoin(id, req.body || {})));
api.post('/:shareId/heartbeat', handle((id, req) => lanShare.peerHeartbeat(id, req)));
api.get('/:shareId/log', handle((id, req) => lanShare.peerLog(id, req)));
api.post('/:shareId/append', handle((id, req) => lanShare.peerAppend(id, req)));
api.post('/:shareId/stream', handle((id, req) => lanShare.peerStream(id, req)));
api.get('/:shareId/live', handle(async (id, req, res) => { await lanShare.peerLive(id, req, res); }));
api.get('/:shareId/state', handle((id, req) => lanShare.peerState(id, req)));
api.post('/:shareId/host-changed', handle((id, req) => lanShare.peerHostChanged(id, req)));
api.post('/:shareId/leave', handle((id, req) => lanShare.peerLeave(id, req)));
api.post('/:shareId/closed', handle((id, req) => lanShare.peerClosed(id, req)));
api.post('/:shareId/removed', handle((id, req) => lanShare.peerRemoved(id, req)));
api.get('/:shareId/preview', handle((id, req) => lanShare.peerPreview(id, String(req.query.t || ''))));

// 落地页探测本机桌面版端口用：允许任意来源（含内网页面访问 127.0.0.1 的私有网络预检），不返回任何隐私信息
function ping(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    res.json({ app: 'dragon-claw', lanShare: lanShare.enabled(), port: Number(process.env.PORT) || 3030 });
}

function landing(req, res) {
    if (!lanShare.enabled() || !SHARE_ID.test(req.params.shareId)) return res.status(404).send('Not found');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(LANDING_HTML);
}

const LANDING_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>内网共享对话</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1f2328;--ink2:#59606a;--line:#e3e5e9;--brand:#2f6bff;--brand-ink:#fff;--warn:#b54708}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1b1e23;--ink:#e9ebee;--ink2:#a2a9b3;--line:#2c3036;--brand:#5b8cff;--warn:#f5a25d}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;padding:16px}
.card{width:100%;max-width:460px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
h1{font-size:19px;margin:0 0 4px}p{margin:6px 0;color:var(--ink2)}.title{color:var(--ink);font-weight:600;font-size:16px;margin-top:14px;word-break:break-all}
.status{margin:18px 0 6px;padding:10px 12px;border-radius:10px;background:var(--bg);font-size:14px}.status.warn{color:var(--warn)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
button,a.btn{appearance:none;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:9px 14px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none}
.primary{background:var(--brand)!important;border-color:var(--brand)!important;color:var(--brand-ink)!important}
small{display:block;margin-top:14px;color:var(--ink2);font-size:12.5px}
</style></head><body><main class="card">
<h1>内网共享对话</h1><p>同事通过 Dragon Claw 桌面版与你共享了一个对话。</p>
<div class="title" id="title"></div><p id="owner"></p>
<div class="status" id="status">正在查找本机的 Dragon Claw 桌面版…</div>
<div class="row" id="actions"></div>
<small>加入后对话会保存在你自己的桌面版里；之后大家的提问与回答经共享者的电脑实时互相同步。只能在公司内网中使用。</small>
</main><script>
(function(){
var link=location.href, shareId=location.pathname.split('/').filter(Boolean).pop(), token=new URLSearchParams(location.search).get('t')||'';
var $=function(id){return document.getElementById(id)};
function text(el,v){el.textContent=v}
fetch('/api/lan-peer/'+encodeURIComponent(shareId)+'/preview?t='+encodeURIComponent(token),{cache:'no-store'}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})}).then(function(x){
  if(!x.ok){text($('title'),'');text($('status'),x.d.error||'共享链接无效或已失效');$('status').className='status warn';return}
  text($('title'),x.d.title||'共享对话');text($('owner'),x.d.ownerName?('发起者：'+x.d.ownerName+' · '+x.d.memberCount+' 台电脑已加入'):'');
}).catch(function(){});
function openAt(port){location.href='http://127.0.0.1:'+port+'/?lanjoin='+encodeURIComponent(link)}
function probe(port){
  var ctl=new AbortController();setTimeout(function(){ctl.abort()},1500);
  return fetch('http://127.0.0.1:'+port+'/api/lan-share/ping',{cache:'no-store',signal:ctl.signal,targetAddressSpace:'loopback'}).then(function(r){return r.json()}).then(function(d){if(d&&d.app==='dragon-claw')return Number(d.port)||port;throw 0});
}
var ports=[3030,3031,3032,3033,3034,3035,location.port?Number(location.port):3030].filter(function(v,i,a){return a.indexOf(v)===i});
function manual(){
  $('status').className='status warn';
  text($('status'),'没有自动找到本机的 Dragon Claw 桌面版。请先启动桌面版，再点下面的按钮；也可以复制链接，在桌面版首页「共享对话」里粘贴加入。');
  var a=$('actions');a.innerHTML='';
  var b=document.createElement('button');b.className='primary';b.textContent='在本机桌面版中打开';b.onclick=function(){openAt(3030)};a.appendChild(b);
  var c=document.createElement('button');c.textContent='复制链接';c.onclick=function(){(navigator.clipboard?navigator.clipboard.writeText(link):Promise.reject()).then(function(){c.textContent='已复制'}).catch(function(){prompt('复制这个链接',link)})};a.appendChild(c);
  var r=document.createElement('button');r.textContent='重新查找';r.onclick=find;a.appendChild(r);
}
function find(){
  text($('status'),'正在查找本机的 Dragon Claw 桌面版…');$('status').className='status';$('actions').innerHTML='';
  var done=false;
  Promise.all(ports.map(function(p){return probe(p).then(function(port){if(!done){done=true;text($('status'),'已找到本机桌面版（端口 '+port+'），正在打开…');setTimeout(function(){openAt(port)},400)}}).catch(function(){})})).then(function(){if(!done)manual()});
}
find();
})();
</script></body></html>`;

module.exports = { api, ping, landing };
