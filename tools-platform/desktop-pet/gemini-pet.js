(function () {
  if (window.__geminiThothWidget) return;
  window.__geminiThothWidget = true;

  var petT = function (text) { return window.PetI18n ? window.PetI18n.t(text) : text; };
  var isElectron = typeof require !== 'undefined';
  var ipcRenderer = null;
  if (isElectron) {
    try {
      ipcRenderer = require('electron').ipcRenderer;
    } catch (_) {}
  }

  var MIN_SCALE = 0.6;
  var MAX_SCALE = 2.5;
  var CLICK_SQ = 9;
  var ANIM_MS = 700;
  var BUBBLE_MS = 5000;

  var IMAGES = {
    idle: "./assets/thoth/idle.png",
    dragged: "./assets/thoth/walk.png",
    happy: "./assets/thoth/wave.png",
    chill: "./assets/thoth/think.png",
    fall: "./assets/thoth/walk.png",
    pat: "./assets/thoth/wave.png",
    typing: "./assets/thoth/think.png"
  };

  var SOUND_DATA = {
    duck: {
      press: "./assets/Ya1.mp3",
      release: "./assets/Ya2.mp3"
    }
  };

  var css = [
    '.gpet-root{position:fixed;right:20px;bottom:20px;--gpet-scale:1.2;--gpet-base:calc(260px * var(--gpet-scale));width:var(--gpet-base);height:calc(var(--gpet-base) * 1.385);pointer-events:none;user-select:none;-webkit-user-select:none;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;transition:left .16s ease,top .16s ease,transform .3s ease}',

    '.gpet-root.gpet-scaling, .gpet-root.gpet-scaling *{transition:none !important}',
    '.gpet-root.gpet-dragging{cursor:grabbing;transition:none !important}',
    '.gpet-root.gpet-dragging .gpet-body{transition:none !important;transform:none !important}',
    '.gpet-body{position:absolute;left:0;top:0;width:100%;height:100%}',
    '@keyframes gpet-jelly{0%{transform:scaleX(1.22) scaleY(0.78)} 24%{transform:scaleX(0.82) scaleY(1.22)} 44%{transform:scaleX(1.12) scaleY(0.90)} 64%{transform:scaleX(0.96) scaleY(1.04)} 82%{transform:scaleX(1.02) scaleY(0.98)} 100%{transform:scale(1,1)}}',
    '@keyframes gpet-breathe{0%,100%{transform:scale(1,1)} 50%{transform:scale(1.018,0.982)}}',
    '.gpet-breathe{animation:gpet-breathe 3.6s ease-in-out infinite !important}',
    '@keyframes gpet-typing-wobble{0%,100%{transform:translateY(0) scale(1,1)} 50%{transform:translateY(2.2px) scale(1.018,0.982)}}',
    '.gpet-typing-anim{animation:gpet-typing-wobble var(--gpet-typing-dur, .28s) cubic-bezier(0.35,0,0.25,1) infinite !important}',
    '.gpet-combo-badge{position:absolute;right:6%;top:30%;background:linear-gradient(135deg,#147d7a,#0d323b);color:#fff;font-weight:900;font-size:12px;padding:3px 9px;border-radius:12px;box-shadow:0 4px 12px rgba(20,125,122,0.45);pointer-events:none;z-index:90;transform:scale(0.8) translateY(0);opacity:0;transition:transform .12s cubic-bezier(.34,1.56,.64,1),opacity .18s ease,background .25s ease,box-shadow .25s ease;font-style:italic;text-shadow:0 1px 2px rgba(0,0,0,0.4);border:1px solid rgba(131,216,206,0.35);letter-spacing:.02em;white-space:nowrap}',
    '.gpet-combo-badge.gpet-combo-active{opacity:1;transform:scale(1.08) translateY(-4px)}',
    '.gpet-combo-badge.gpet-combo-pop{transform:scale(1.24) translateY(-6px) !important}',
    '.gpet-combo-badge.gpet-combo-t1{background:linear-gradient(135deg,#147d7a,#0d323b);border-color:rgba(131,216,206,0.35);box-shadow:0 4px 12px rgba(20,125,122,0.45)}',
    '.gpet-combo-badge.gpet-combo-t2{background:linear-gradient(135deg,#0d9488,#bda56e);border-color:rgba(254,240,138,0.7);box-shadow:0 4px 16px rgba(189,165,110,0.6),0 0 10px rgba(13,148,136,0.5);text-shadow:0 0 8px rgba(254,240,138,0.6)}',
    '.gpet-combo-badge.gpet-combo-t3{background:linear-gradient(135deg,#f59e0b,#ef4444);border-color:rgba(254,202,202,0.8);box-shadow:0 4px 18px rgba(239,68,68,0.65),0 0 20px rgba(245,158,11,0.55);animation:gpet-combo-shake .14s infinite alternate;text-shadow:0 0 10px rgba(254,202,202,0.7)}',
    '.gpet-combo-badge.gpet-combo-t4{background:linear-gradient(135deg,#8b5cf6,#ec4899 50%,#f59e0b 100%);border-color:rgba(244,114,182,0.85);box-shadow:0 6px 24px rgba(139,92,246,0.8),0 0 28px rgba(236,72,153,0.65);animation:gpet-combo-cosmic .18s infinite alternate;text-shadow:0 0 12px rgba(244,114,182,0.85)}',
    '.gpet-combo-badge.gpet-combo-t5{background:linear-gradient(135deg,#fbbf24,#f43f5e 50%,#a855f7 100%);border-color:#ffffff;box-shadow:0 6px 30px rgba(251,191,36,0.9),0 0 40px rgba(244,63,94,0.75);animation:gpet-combo-godspeed .12s infinite alternate;font-size:12.5px;letter-spacing:.04em;text-shadow:0 0 14px rgba(255,255,255,0.9)}',
    '.gpet-combo-badge.gpet-combo-t6{background:linear-gradient(90deg,#ffd700,#ff6b6b,#48dbfb,#1dd1a1,#ffd700);background-size:300% 100%;border-color:#ffffff;box-shadow:0 0 35px rgba(255,215,0,0.95),0 0 60px rgba(72,219,251,0.8);animation:gpet-aurora-shift 2.2s linear infinite,gpet-combo-shake .1s infinite alternate;font-size:13px;letter-spacing:.05em;text-shadow:0 0 16px rgba(255,255,255,1)}',
    '@keyframes gpet-combo-shake{0%{transform:scale(1.14) translateY(-4px) rotate(-3deg)} 100%{transform:scale(1.22) translateY(-4px) rotate(3deg)}}',
    '@keyframes gpet-combo-cosmic{0%{transform:scale(1.16) translateY(-4px) rotate(-2deg)} 100%{transform:scale(1.24) translateY(-5px) rotate(2deg)}}',
    '@keyframes gpet-combo-godspeed{0%{transform:scale(1.20) translateY(-5px) rotate(-3.5deg)} 100%{transform:scale(1.28) translateY(-5px) rotate(3.5deg)}}',
    '@keyframes gpet-aurora-shift{0%{background-position:0% 50%} 100%{background-position:300% 50%}}',
    '.gpet-img{position:absolute;right:0;bottom:0;width:62%;height:62%;display:block;pointer-events:none;-webkit-user-drag:none;user-select:none;object-fit:contain;filter:drop-shadow(0 6px 16px rgba(15,23,42,0.18));transform-origin:50% 98%;transition:transform .15s cubic-bezier(0.2,0.8,0.4,1)}',
    '.gpet-img.gpet-jelly, .gpet-body.gpet-jelly{animation:gpet-jelly .55s cubic-bezier(0.25,1,0.5,1) forwards !important;transition:none !important}',
    '.gpet-img.gpet-squished, .gpet-body.gpet-squished{transform:scaleX(1.22) scaleY(0.78) !important;transition:transform .08s cubic-bezier(0.2,0,0,1) !important}',
    '@keyframes gpet-heart-float{0%{opacity:0;transform:translateY(0) scale(0.6) rotate(0deg)} 25%{opacity:1;transform:translateY(-16px) scale(1.15) rotate(-10deg)} 75%{opacity:0.9;transform:translateY(-45px) scale(1) rotate(8deg)} 100%{opacity:0;transform:translateY(-68px) scale(0.7) rotate(-5deg)}}',
    '.gpet-heart{position:absolute;pointer-events:none;font-size:22px;line-height:1;animation:gpet-heart-float 1.1s cubic-bezier(0.2,0.8,0.4,1) forwards;z-index:100;user-select:none;filter:drop-shadow(0 2px 8px rgba(20,125,122,0.45))}',
    '.gpet-bubble{position:absolute;left:0;top:0;width:100%;aspect-ratio:1026/700;pointer-events:none;z-index:1;--gpet-u:calc(var(--gpet-base) / 1026);opacity:0;visibility:hidden;transition:opacity .2s ease,visibility .2s}',
    '.gpet-bubble.gpet-bubble-open{opacity:1;visibility:visible;transition:opacity .2s ease,visibility 0s}',
    '.gpet-bubble svg{display:block;width:100%;height:100%;pointer-events:none;filter:drop-shadow(0 12px 28px rgba(10,15,35,0.65)) drop-shadow(0 0 16px rgba(131,216,206,0.35))}',
    '.gpet-bubble svg path,.gpet-bubble svg ellipse,.gpet-bubble svg circle{pointer-events:none;cursor:pointer}',
    '.gpet-bubble.gpet-bubble-open svg path,.gpet-bubble.gpet-bubble-open svg ellipse,.gpet-bubble.gpet-bubble-open svg circle{pointer-events:visiblePainted}',
    '.gpet-bubble .gpet-bshape,.gpet-bubble .gpet-b1,.gpet-bubble .gpet-b2{opacity:0;transform:scale(.7);transform-box:fill-box;transform-origin:50% 50%;transition:opacity .2s ease,transform .2s ease}',
    '.gpet-bubble.gpet-bubble-open .gpet-bshape,.gpet-bubble.gpet-bubble-open .gpet-b1,.gpet-bubble.gpet-bubble-open .gpet-b2{opacity:1;transform:none}',
    '.gpet-bubble.gpet-bubble-open .gpet-b2{transition-delay:0s}',
    '.gpet-bubble.gpet-bubble-open .gpet-b1{transition-delay:.13s}',
    '.gpet-bubble.gpet-bubble-open .gpet-bshape{transition-delay:.26s}',
    '.gpet-bubble .gpet-bshape{transition-delay:.1s}',
    '.gpet-bubble .gpet-b1{transition-delay:.2s}',
    '.gpet-bubble .gpet-b2{transition-delay:.3s}',
    '.gpet-text{position:absolute;left:44%;top:36%;transform:translate(-50%,-50%);text-align:center;color:#f8fafc;line-height:1.25;white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .16s ease,transform .3s ease;width:68%;max-width:calc(var(--gpet-u) * 530);box-sizing:border-box}',
    '.gpet-bubble.gpet-bubble-open .gpet-text{opacity:1;visibility:visible;transition:opacity .16s ease .36s,transform .3s ease}',
    '.gpet-bubble:not(.gpet-bubble-open) .gpet-text{opacity:0 !important;visibility:hidden !important}',

    '.gpet-label{font-size:calc(var(--gpet-u) * 44);font-weight:700;letter-spacing:.04em;color:#83d8ce;text-shadow:0 0 10px rgba(131,216,206,0.45)}',
    '.gpet-amount{font-size:calc(var(--gpet-u) * 88);font-weight:800;line-height:1.1;color:#ffffff;letter-spacing:-0.01em;text-shadow:0 0 14px rgba(255,255,255,0.35)}',
    '.gpet-period{font-size:calc(var(--gpet-u) * 76);font-weight:800;line-height:1.05}',
    '.gpet-wrap{white-space:normal;max-width:calc(var(--gpet-u) * 450);line-height:1.32;font-size:calc(var(--gpet-u) * 42);margin:0 auto;word-break:break-word;text-shadow:0 1px 4px rgba(0,0,0,0.85),0 0 10px rgba(131,216,206,0.35)}',
    '.gpet-hint{font-size:calc(var(--gpet-u) * 38);color:#cbd5e1;letter-spacing:.02em;margin-top:calc(var(--gpet-u) * 10);min-height:calc(var(--gpet-u) * 46);line-height:1.2;font-weight:500;text-shadow:0 0 8px rgba(203,213,225,0.3)}',
    '.gpet-menu{position:fixed;min-width:210px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;background:rgba(255,255,255,0.96);backdrop-filter:blur(16px);border:1px solid rgba(20,125,122,0.25);border-radius:12px;padding:10px 12px;opacity:0;transform:scale(.92) translateY(-6px);transition:opacity .18s ease,transform .2s cubic-bezier(.34,1.56,.64,1);pointer-events:none;z-index:100000;box-shadow:0 12px 32px rgba(15,23,42,0.22);color-scheme:light;box-sizing:border-box}',
    '.gpet-menu.gpet-menu-open{opacity:1;transform:scale(1) translateY(0);pointer-events:auto}',
    '.gpet-menu-title{font-size:13px;font-weight:700;color:#105d61;margin-bottom:8px;display:flex;align-items:center;gap:6px}',
    '.gpet-menu-row{display:flex;align-items:center;gap:8px;margin:6px 0;color:#1e293b;font-size:12px;flex-wrap:wrap}',
    '.gpet-range{flex:1;min-width:0;accent-color:#147d7a}',
    '.gpet-number{width:46px;border:1px solid rgba(20,125,122,0.3);border-radius:6px;padding:2px 4px;font-size:12px;color:#1e293b;background:#fff;box-sizing:border-box;text-align:center}',
    '.gpet-number:disabled{opacity:.4;background:rgba(0,0,0,0.06);cursor:not-allowed}',
    '.gpet-sound{flex:1;border:1px solid rgba(20,125,122,0.3);border-radius:6px;background:rgba(20,125,122,0.06);color:#105d61;font-size:12px;padding:4px 6px;cursor:pointer;font-weight:500}',
    '.gpet-sound:hover{background:rgba(20,125,122,0.12)}',
    '.gpet-check{width:16px;height:16px;accent-color:#147d7a;cursor:pointer;flex:0 0 auto}',
    '.gpet-menu-sep{height:1px;background:rgba(20,125,122,0.15);margin:8px 0}',
    '.gpet-volpct{width:38px;text-align:right;color:#64748b;font-size:11px}'
  ].join('\n');

  function initWidget() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWidget);
      }
      return;
    }

    var styleEl = document.createElement('style');
    styleEl.textContent = css;
    var themeLink = document.querySelector('link[href^="thoth-theme.css"]');
    if (themeLink) themeLink.parentNode.insertBefore(styleEl, themeLink);
    else (document.head || document.body).appendChild(styleEl);

    var root = document.createElement('div');
    root.className = 'gpet-root';

    var body = document.createElement('div');
    body.className = 'gpet-body';

    var img = document.createElement('img');
    img.className = 'gpet-img gpet-breathe';
    img.src = IMAGES.idle;
    img.alt = petT('青绿陶瓷鸟人托特');
    img.draggable = false;

    var bubbleBox = document.createElement('div');
    bubbleBox.className = 'gpet-bubble';
    bubbleBox.innerHTML = '<svg viewBox="0 0 1026 700" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
      '  <linearGradient id="gpet-star-bg" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '    <stop offset="0%" stop-color="#092b36" stop-opacity="0.94"/>' +
      '    <stop offset="50%" stop-color="#13505a" stop-opacity="0.92"/>' +
      '    <stop offset="100%" stop-color="#0d2f3d" stop-opacity="0.95"/>' +
      '  </linearGradient>' +
      '  <linearGradient id="gpet-star-border" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '    <stop offset="0%" stop-color="#83d8ce"/>' +
      '    <stop offset="45%" stop-color="#bda56e"/>' +
      '    <stop offset="100%" stop-color="#bda56e"/>' +
      '  </linearGradient>' +
      '</defs>' +
      '<path class="gpet-bshape" fill="url(#gpet-star-bg)" stroke="url(#gpet-star-border)" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" d="M 805,225 C 805,105 660,38 450,38 C 240,38 85,105 85,225 C 85,345 240,418 450,418 C 500,418 545,412 585,398 C 655,412 730,375 770,320 C 795,290 805,258 805,225 Z"/>' +
      '<circle class="gpet-b1" cx="530" cy="468" r="22" fill="url(#gpet-star-bg)" stroke="url(#gpet-star-border)" stroke-width="11"/>' +
      '<circle class="gpet-b2" cx="600" cy="518" r="14" fill="url(#gpet-star-bg)" stroke="url(#gpet-star-border)" stroke-width="9"/>' +
      '<path d="M 750,90 Q 750,105 765,105 Q 750,105 750,120 Q 750,105 735,105 Q 750,105 750,90 Z" fill="#83d8ce" opacity="0.85"/>' +
      '<path d="M 140,120 Q 140,132 152,132 Q 140,132 140,144 Q 140,132 128,132 Q 140,132 140,120 Z" fill="#bda56e" opacity="0.75"/>' +
      '<circle cx="730" cy="140" r="3" fill="#ffffff" opacity="0.6"/>' +
      '<circle cx="165" cy="100" r="2.5" fill="#83d8ce" opacity="0.6"/>' +
      '</svg>';

    var textBox = document.createElement('div');
    textBox.className = 'gpet-text';
    var labelEl = document.createElement('div');
    labelEl.className = 'gpet-label';
    labelEl.textContent = petT('✦ Gemini 5小时配额');
    var amountEl = document.createElement('div');
    amountEl.className = 'gpet-amount';
    amountEl.textContent = '100%';
    var hintEl = document.createElement('div');
    hintEl.className = 'gpet-hint';
    hintEl.textContent = petT('反重力全速运转中 ✦');
    textBox.appendChild(labelEl);
    textBox.appendChild(amountEl);
    textBox.appendChild(hintEl);
    bubbleBox.appendChild(textBox);

    function closePetEntirely(e) {
      if (e) {
        try { e.stopPropagation(); e.preventDefault(); } catch (_) {}
      }
      try {
        root.style.display = 'none';
        menuBox.style.display = 'none';
      } catch (_) {}
      if (ipcRenderer) {
        try { ipcRenderer.send('pet-quit'); } catch (_) {}
      }
      try {
        var remote = null;
        try { remote = require('@electron/remote'); } catch (_) {}
        if (!remote) { try { remote = require('electron').remote; } catch (_) {} }
        if (remote && remote.getCurrentWindow) {
          remote.getCurrentWindow().destroy();
        }
      } catch (_) {}
      try {
        window.close();
      } catch (_) {}
    }

    // Settings Menu Box
    var menuBox = document.createElement('div');
    menuBox.className = 'gpet-menu';

    function menuLabel(text) {
      var s = document.createElement('span');
      s.textContent = text;
      return s;
    }
    function menuRow() {
      var r = document.createElement('div');
      r.className = 'gpet-menu-row';
      return r;
    }

    var titleRow = document.createElement('div');
    titleRow.className = 'gpet-menu-title';
    titleRow.innerHTML = '<span>✦</span><span style="flex:1">托特设置</span>';
    var closeMenuBtn = document.createElement('button');
    closeMenuBtn.type = 'button';
    closeMenuBtn.innerHTML = '✕';
    closeMenuBtn.title = petT('关闭菜单');
    closeMenuBtn.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:14px;color:#64748b;padding:0 4px;line-height:1;font-weight:700;';
    closeMenuBtn.addEventListener('click', function(e) { e.stopPropagation(); closeMenu(); });
    titleRow.appendChild(closeMenuBtn);
    menuBox.appendChild(titleRow);

    var scaleInput = document.createElement('input');
    scaleInput.type = 'range';
    scaleInput.min = String(MIN_SCALE);
    scaleInput.max = String(MAX_SCALE);
    scaleInput.step = '0.1';
    scaleInput.className = 'gpet-range';
    scaleInput.value = '1.2';

    var scaleNumber = document.createElement('input');
    scaleNumber.type = 'number';
    scaleNumber.min = '1';
    scaleNumber.max = '20';
    scaleNumber.step = '1';
    scaleNumber.className = 'gpet-number';
    scaleNumber.value = '7';

    scaleInput.addEventListener('input', function () {
      var raw = Number(scaleInput.value);
      var clamped = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)) * 10) / 10;
      var lvl = Math.round((clamped - 0.6) * 10) + 1;
      scaleNumber.value = String(Math.max(1, Math.min(20, lvl)));
    });
    scaleInput.addEventListener('pointerup', function () {
      setScale(scaleInput.value, false, false);
      saveConfig(true);
    });
    scaleInput.addEventListener('change', function () {
      setScale(scaleInput.value, false, false);
      saveConfig(true);
    });

    var scaleNumberMiniDebounce = null;
    function commitMiniNumber() {
      if (scaleNumberMiniDebounce) {
        clearTimeout(scaleNumberMiniDebounce);
        scaleNumberMiniDebounce = null;
      }
      var v = Math.max(1, Math.min(20, Math.round(Number(scaleNumber.value) || 7)));
      var s = (v - 1) * 0.1 + 0.6;
      setScale(s, false, true);
      saveConfig(true);
    }

    scaleNumber.addEventListener('input', function () {
      var v = Math.max(1, Math.min(20, Math.round(Number(scaleNumber.value) || 7)));
      var s = Math.round(((v - 1) * 0.1 + 0.6) * 10) / 10;
      scaleInput.value = String(s);

      if (scaleNumberMiniDebounce) clearTimeout(scaleNumberMiniDebounce);
      scaleNumberMiniDebounce = setTimeout(commitMiniNumber, 200);
    });
    scaleNumber.addEventListener('change', function () {
      commitMiniNumber();
    });
    scaleNumber.addEventListener('blur', function () {
      commitMiniNumber();
    });

    var soundSelect = document.createElement('select');
    soundSelect.className = 'gpet-sound';
    function soundOpt(val, lbl) {
      var o = document.createElement('option');
      o.value = val;
      o.textContent = lbl;
      return o;
    }
    soundSelect.appendChild(soundOpt('duck', petT('小黄鸭 (挤压音)')));
    soundSelect.appendChild(soundOpt('mute', petT('静音')));
    soundSelect.addEventListener('change', function () { setSoundSet(soundSelect.value); });

    var volInput = document.createElement('input');
    volInput.type = 'range';
    volInput.min = '0';
    volInput.max = '1';
    volInput.step = '0.05';
    volInput.className = 'gpet-range';
    volInput.value = '0.9';

    var volPct = document.createElement('span');
    volPct.className = 'gpet-volpct';
    volInput.addEventListener('input', function () {
      if (volPct) volPct.textContent = Math.round(volInput.value * 100) + '%';
    });
    volInput.addEventListener('pointerup', function () {
      setVol(volInput.value, false);
      saveConfig(true);
    });
    volInput.addEventListener('change', function () {
      setVol(volInput.value, false);
      saveConfig(true);
    });

    // Quota View Select
    var quotaViewSelect = document.createElement('select');
    quotaViewSelect.className = 'gpet-sound';
    quotaViewSelect.appendChild(soundOpt('5h', petT('5小时额度 (常用)')));
    quotaViewSelect.appendChild(soundOpt('weekly', petT('每周总额度')));
    quotaViewSelect.appendChild(soundOpt('alternate', petT('双额度交替轮播')));
    quotaViewSelect.addEventListener('change', function () { setQuotaView(quotaViewSelect.value); });

    var workStateSelect = document.createElement('select');
    workStateSelect.className = 'gpet-sound';
    workStateSelect.appendChild(soundOpt('auto', petT('自动跟随 (托腮思考/静静守候)')));
    workStateSelect.appendChild(soundOpt('typing', petT('专注思考 (键盘联动)')));
    workStateSelect.appendChild(soundOpt('chill', petT('托腮思考 (工作中)')));
    workStateSelect.appendChild(soundOpt('idle', petT('静静守候 (待机)')));
    workStateSelect.appendChild(soundOpt('happy', petT('挥手问候 (互动)')));
    workStateSelect.appendChild(soundOpt('dragged', petT('迈步出发 (拖动)')));
    workStateSelect.appendChild(soundOpt('fall', petT('轻盈落地 (下落)')));
    workStateSelect.appendChild(soundOpt('pat', petT('挥手回应 (摸头)')));
    workStateSelect.addEventListener('change', function () { setWorkStateMode(workStateSelect.value); });

    var antigravitySyncSelect = document.createElement('select');
    antigravitySyncSelect.className = 'gpet-sound';
    antigravitySyncSelect.appendChild(soundOpt('sync_all', petT('跟随反重力启动和退出')));
    antigravitySyncSelect.appendChild(soundOpt('sync_start', petT('仅跟随反重力启动')));
    antigravitySyncSelect.appendChild(soundOpt('manual', petT('自己手动启动，自动检测')));
    antigravitySyncSelect.addEventListener('change', function () { setAntigravitySyncMode(antigravitySyncSelect.value); });

    var bubbleToggle = document.createElement('input');
    bubbleToggle.type = 'checkbox';
    bubbleToggle.className = 'gpet-check';
    bubbleToggle.checked = true;
    bubbleToggle.addEventListener('change', function () { setBubbleOn(bubbleToggle.checked); });

    var typingToggle = document.createElement('input');
    typingToggle.type = 'checkbox';
    typingToggle.className = 'gpet-check';
    typingToggle.checked = true;
    typingToggle.addEventListener('change', function () { setTypingOn(typingToggle.checked); });

    var gravityToggle = document.createElement('input');
    gravityToggle.type = 'checkbox';
    gravityToggle.className = 'gpet-check';
    gravityToggle.checked = true;
    gravityToggle.addEventListener('change', function () { setGravityOn(gravityToggle.checked); });

    var turnCostToggle = document.createElement('input');
    turnCostToggle.type = 'checkbox';
    turnCostToggle.className = 'gpet-check';
    turnCostToggle.checked = true;
    turnCostToggle.addEventListener('change', function () { setTurnCostOn(turnCostToggle.checked); });

    var turnCostCloseInput = document.createElement('input');
    turnCostCloseInput.type = 'number';
    turnCostCloseInput.min = '0';
    turnCostCloseInput.step = '1';
    turnCostCloseInput.className = 'gpet-number';
    turnCostCloseInput.value = '5';
    turnCostCloseInput.title = petT('填 0 表示不自动关闭');
    turnCostCloseInput.addEventListener('input', function () { setTurnCostClose(turnCostCloseInput.value); });

    var row1 = menuRow(); row1.appendChild(menuLabel(petT('大小'))); row1.appendChild(scaleInput); row1.appendChild(scaleNumber);
    var row2 = menuRow(); row2.appendChild(menuLabel(petT('音效'))); row2.appendChild(soundSelect);
    var row3 = menuRow(); row3.appendChild(menuLabel(petT('音量'))); row3.appendChild(volInput); row3.appendChild(volPct);
    var row4 = menuRow(); row4.appendChild(menuLabel(petT('配额'))); row4.appendChild(quotaViewSelect);
    var rowWork = menuRow(); rowWork.appendChild(menuLabel(petT('状态'))); rowWork.appendChild(workStateSelect);
    var rowSync = menuRow(); rowSync.appendChild(menuLabel(petT('跟随反重力'))); rowSync.appendChild(antigravitySyncSelect);
    var row5 = menuRow(); row5.appendChild(menuLabel(petT('气泡'))); row5.appendChild(bubbleToggle);
    var rowTyping = menuRow(); rowTyping.appendChild(menuLabel(petT('打字工友'))); rowTyping.appendChild(typingToggle);
    var rowGrav = menuRow(); rowGrav.appendChild(menuLabel(petT('重力下落'))); rowGrav.appendChild(gravityToggle);
    var sep1 = document.createElement('div'); sep1.className = 'gpet-menu-sep';
    var row6 = menuRow(); row6.appendChild(menuLabel(petT('对话消耗'))); row6.appendChild(turnCostToggle); row6.appendChild(menuLabel(petT('自动关闭'))); row6.appendChild(turnCostCloseInput); row6.appendChild(menuLabel(petT('秒')));

    var sep2 = document.createElement('div'); sep2.className = 'gpet-menu-sep';
    var row7 = menuRow();
    row7.style.cssText = 'margin-top:10px;display:flex;width:100%;';
    var quitBtn = document.createElement('button');
    quitBtn.type = 'button';
    quitBtn.textContent = petT('✕ 退出桌宠');
    quitBtn.style.cssText = 'width:100%;border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.1);color:#ef4444;font-size:12px;font-weight:700;padding:8px 0;border-radius:8px;cursor:pointer;display:block;text-align:center;box-sizing:border-box;transition:background .15s ease,border-color .15s ease;';
    quitBtn.addEventListener('mouseenter', function () {
      quitBtn.style.background = 'rgba(239,68,68,0.22)';
      quitBtn.style.borderColor = '#ef4444';
    });
    quitBtn.addEventListener('mouseleave', function () {
      quitBtn.style.background = 'rgba(239,68,68,0.1)';
      quitBtn.style.borderColor = 'rgba(239,68,68,0.45)';
    });
    quitBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    quitBtn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    quitBtn.addEventListener('click', closePetEntirely);
    row7.appendChild(quitBtn);

    menuBox.appendChild(row1);
    menuBox.appendChild(row2);
    menuBox.appendChild(row3);
    menuBox.appendChild(row4);
    menuBox.appendChild(rowWork);
    menuBox.appendChild(rowSync);
    menuBox.appendChild(row5);
    menuBox.appendChild(rowTyping);
    menuBox.appendChild(rowGrav);
    menuBox.appendChild(sep1);
    menuBox.appendChild(row6);
    menuBox.appendChild(sep2);
    menuBox.appendChild(row7);

    var comboBadge = document.createElement('div');
    comboBadge.className = 'gpet-combo-badge';
    comboBadge.textContent = 'Combo x1';

    body.appendChild(img);
    body.appendChild(comboBadge);
    body.appendChild(bubbleBox);
    root.appendChild(body);

    document.body.appendChild(root);
    document.body.appendChild(menuBox);

    // State model with Gemini Quota
    var state = {
      scale: 1.2,
      h: 'right',
      hOff: 20,
      v: 'bottom',
      vOff: 20,
      left: 0,
      top: 0,
      gemini5h: null,
      gemini5hReset: '',
      geminiWeekly: null,
      geminiWeeklyReset: '',
      claude5h: 1,
      claudeWeekly: 1,
      quotaView: '5h',
      alternateFlip: false,
      status: 'ok',
      message: ''
    };

    var presence = null;
    var life = null;
    var selectedStoryHook = null;
    var drag = null;
    var shown = null;
    var animId = null;
    var bubbleShown = false;
    var bubbleTimer = null;
    var bubbleRandomActive = false;
    var bubbleRandomLines = null;
    var bubbleSwapTimer = null;
    var hintFadeTimer = null;
    var lastHintText = null;
    var costBubbleActive = false;
    var costBubbleTimer = null;
    var agentWorking = false;
    var workStateMode = 'auto'; // 'auto' | 'working' | 'idle'
    var inHappyReaction = false;
    var isAntigravityConnected = false;
    var happyTimer = null;
    var pressCount = 0;

    var soundOn = true;
    var soundVol = 0.9;
    var soundSet = 'duck';
    var bubbleOn = true;
    var turnCostOn = true;
    var turnCostCloseMs = 5000;
    var antigravitySyncMode = 'manual'; // 'sync_all' | 'sync_start' | 'manual'

    var BUBBLE_STYLE_CLASS = { A: 'gpet-label', B: 'gpet-amount', P: 'gpet-period', C: 'gpet-hint' };

    function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function singleCenter(style, text, color, wrap) { return [null, { t: text, s: style, c: color || '', w: !!wrap }, null]; }

    function fmtPct(val) {
      if (val === null || val === undefined || !isFinite(val)) return '--%';
      return Math.round(val * 100) + '%';
    }

    function getQuotaColor(val) {
      var pct = val * 100;
      if (pct <= 20) return '#fb7185';
      if (pct <= 50) return '#fbbf24';
      return '#83d8ce';
    }

    // Ceramic guardian & coder dialogue (随着按压次数随机显示)
    var TEXT_QUOTES = [
      // 捏捏互动类 (Squish & touch reactions)
      petT('轻一点，我的青绿釉面可要好好爱护。'),
      petT('碰一碰，今天的灵感就亮起来了。'),
      petT('收到你的问候，心情像釉面一样闪闪发亮。'),
      petT('青绿陶瓷，内置一点点好奇心。'),
      petT('再碰一下，灵感也许就要起飞了。'),
      petT('给我一点阳光，我就能陪你很久。'),
      petT('补充一点灵感，我们继续写代码吧。'),
      petT('今天也是与你并肩工作的一天 ✦'),

      // 陪伴与元气类 (Cheering & companion)
      petT('我是托特，今天也陪你把想法变成代码 ✦'),
      petT('遇到 Bug 别慌，我们一起梳理线索。'),
      petT('愿今天的代码顺畅，测试全绿 ✦'),
      petT('你敲代码真快，托特正在努力跟上。'),
      petT('一行一行，想法正在成为现实。'),
      petT('辛苦了，记得喝水，也让眼睛休息一下。'),
      petT('不急，慢慢来，我会一直在这里。'),
      petT('休息一下吧，回来时我还在这里。'),

      // 程序员幽默与反重力彩蛋 (Coder humor & easter eggs)
      petT('代码没有 Bug，只是有独特的个性！'),
      petT('反重力编译中… 正在将咖啡因转化为可用代码！'),
      petT('✦ 灵感之门开启，托特准备就绪！'),
      petT('Git commit: "又改了一堆玄学代码" (嘘)'),
      petT('正在向宇宙发射好运光波… 编译一次通过！'),
      petT('报错也是线索，下一步就从这里开始。'),
      petT('键盘声像细雨，想法正慢慢生长。')
    ];

    var lastQuoteIdx = -1;
    function pickRandomQuoteLines() {
      if (TEXT_QUOTES.length <= 1) return singleCenter('A', TEXT_QUOTES[0], '#e2e8f0', true);
      var idx;
      do {
        idx = Math.floor(Math.random() * TEXT_QUOTES.length);
      } while (idx === lastQuoteIdx);
      lastQuoteIdx = idx;
      return singleCenter('A', TEXT_QUOTES[idx], '#e2e8f0', true);
    }

    function clearStoryHook() {
      selectedStoryHook = null;
      bubbleBox.removeAttribute("role");
      bubbleBox.removeAttribute("tabindex");
      bubbleBox.removeAttribute("aria-label");
    }

    function applyBubbleLines(lines) {
      clearStoryHook();
      var els = [labelEl, amountEl, hintEl];
      for (var i = 0; i < 3; i++) {
        var el = els[i];
        var ln = lines && lines[i];
        if (ln) {
          el.style.display = '';
          if (typeof ln === 'string') {
            el.className = 'gpet-label gpet-wrap';
            el.textContent = ln;
            el.style.color = '#e2e8f0';
          } else {
            el.className = (BUBBLE_STYLE_CLASS[ln.s] || 'gpet-label') + (ln.w ? ' gpet-wrap' : '');
            el.textContent = ln.t !== undefined ? ln.t : '';
            el.style.color = ln.c || '';
          }
        } else {
          el.style.display = 'none';
          el.textContent = '';
          el.style.color = '';
        }
      }
    }

    function swapBubbleContent(applyFn) {
      if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null; }
      textBox.style.transition = 'opacity .14s ease';
      textBox.style.opacity = '0';
      bubbleSwapTimer = setTimeout(function () {
        bubbleSwapTimer = null;
        applyFn();
        textBox.style.opacity = '1';
        setTimeout(function () {
          textBox.style.transition = '';
          textBox.style.opacity = '';
        }, 180);
      }, 140);
    }

    function getCurrentQuotaDisplay() {
      if (!isAntigravityConnected && state.gemini5h === null) {
        return {
          label: petT('✦ 纯净桌宠模式'),
          val: null,
          hint: petT('反重力未开启 · 待机陪伴中 ✦')
        };
      }
      var isWeekly = state.quotaView === 'weekly' || (state.quotaView === 'alternate' && state.alternateFlip);
      var label = isWeekly ? petT('✦ Gemini 周配额') : petT('✦ Gemini 5小时配额');
      var val = isWeekly ? state.geminiWeekly : state.gemini5h;
      var reset = isWeekly ? state.geminiWeeklyReset : state.gemini5hReset;
      var hint = reset || (isAntigravityConnected ? petT('反重力全速运转中 ✦') : petT('离线缓存额度 · 待机中 ✦'));
      return { label: label, val: val, hint: hint };
    }

    function restoreBubbleLines(isSwapping) {
      clearStoryHook();
      if (!isSwapping) {
        if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null; }
        textBox.style.transition = '';
        textBox.style.opacity = '';
      }
      if (hintFadeTimer) { clearTimeout(hintFadeTimer); hintFadeTimer = null; }
      lastHintText = null;
      labelEl.style.display = '';
      labelEl.className = 'gpet-label';
      labelEl.style.color = '#83d8ce';
      amountEl.style.display = '';
      amountEl.className = 'gpet-amount';
      hintEl.style.display = '';
      hintEl.className = 'gpet-hint';
      hintEl.style.color = '';
      if (state.quotaView === 'alternate') {
        state.alternateFlip = !state.alternateFlip;
      }
      render();
    }

    function triggerBubbleOnPress() {
      if (!bubbleOn || costBubbleActive || menuOpen) return;
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }

      pressCount++;

      if (pressCount === 1) {
        // 第一下：在设置里现在可以设置的配额显示
        bubbleRandomActive = false;
        if (bubbleShown) {
          swapBubbleContent(function () {
            restoreBubbleLines(true);
          });
        } else {
          restoreBubbleLines(false);
          bubbleShown = true;
          bubbleBox.classList.add('gpet-bubble-open');
        }
      } else {
        // 其他文字类：全部随着按压次数随机显示
        bubbleRandomActive = true;
        var lines = pickRandomQuoteLines();
        if (bubbleShown) {
          swapBubbleContent(function () {
            applyBubbleLines(lines);
          });
        } else {
          applyBubbleLines(lines);
          bubbleShown = true;
          bubbleBox.classList.add('gpet-bubble-open');
        }
      }

      bubbleTimer = setTimeout(hideBubble, BUBBLE_MS);
    }

    function showBubble(forceQuota) {
      if (!bubbleOn || costBubbleActive || menuOpen) return;
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      if (forceQuota) pressCount = 0;
      triggerBubbleOnPress();
    }

    function showFallSpeechBubble() {
      if (!bubbleOn || costBubbleActive || menuOpen) return;
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      bubbleRandomActive = true;
      pressCount = 2;

      var fallQuotes = [
        singleCenter('A', petT('呜哇... 屁股摔得好痛痛 QAQ'), '#fb7185', true),
        singleCenter('A', petT('呜呜呜... 谁把人家扔下来的？！'), '#fb7185', true),
        singleCenter('A', petT('晕乎乎... 头顶冒小星星了 @o@'), '#bda56e', true),
        singleCenter('A', petT('哎哟... 下次要接住我嘛~ 哼！'), '#83d8ce', true)
      ];
      var lines = pickOne(fallQuotes);

      if (bubbleShown) {
        swapBubbleContent(function () {
          applyBubbleLines(lines);
        });
      } else {
        applyBubbleLines(lines);
        bubbleShown = true;
        bubbleBox.classList.add('gpet-bubble-open');
      }

      bubbleTimer = setTimeout(hideBubble, 4500);
    }

    var heartSymbols = ['✦', '✨', '◇', '✧'];
    function spawnHeartNearHead() {
      try {
        var heart = document.createElement('div');
        heart.className = 'gpet-heart';
        heart.textContent = pickOne(heartSymbols);
        var rX = 58 + Math.random() * 26;
        var rY = 38 + Math.random() * 16;
        if (state.h === 'left') rX = 100 - rX;
        heart.style.left = rX + '%';
        heart.style.top = rY + '%';
        body.appendChild(heart);
        setTimeout(function () {
          if (heart && heart.parentNode) heart.parentNode.removeChild(heart);
        }, 1100);
      } catch (_) {}
    }

    function showPatSpeechBubble() {
      if (!bubbleOn || costBubbleActive || menuOpen) return;
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      bubbleRandomActive = true;
      pressCount = 2;

      var patQuotes = [
        singleCenter('A', petT('谢谢你的摸摸，托特收到啦 ✦'), '#83d8ce', true),
        singleCenter('A', petT('一点温暖，点亮今天的青绿时光 ✦'), '#83d8ce', true),
        singleCenter('A', petT('我的釉面今天也闪闪发亮。'), '#fb7185', true),
        singleCenter('A', petT('摸摸头，愿今天的代码一路顺利 ✦'), '#83d8ce', true),
        singleCenter('A', petT('这会儿很安静，适合酝酿一个好想法。'), '#83d8ce', true),
        singleCenter('A', petT('温柔的问候，总会带来新的灵感 ✦'), '#83d8ce', true)
      ];
      var lines = pickOne(patQuotes);

      if (bubbleShown) {
        swapBubbleContent(function () {
          applyBubbleLines(lines);
        });
      } else {
        applyBubbleLines(lines);
        bubbleShown = true;
        bubbleBox.classList.add('gpet-bubble-open');
      }

      bubbleTimer = setTimeout(hideBubble, 4500);
    }

    function showCustomSpeechBubble(text, color) {
      if (!bubbleOn || costBubbleActive || menuOpen) return;
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      bubbleRandomActive = true;
      pressCount = 2;
      var lines = singleCenter('A', text, color || '#83d8ce', true);
      if (bubbleShown) {
        swapBubbleContent(function () {
          applyBubbleLines(lines);
        });
      } else {
        applyBubbleLines(lines);
        bubbleShown = true;
        bubbleBox.classList.add('gpet-bubble-open');
      }
      bubbleTimer = setTimeout(hideBubble, 5000);
    }

    function hideBubble() {
      clearStoryHook();
      if (costBubbleTimer) { clearTimeout(costBubbleTimer); costBubbleTimer = null; }
      costBubbleActive = false;
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null; }
      if (hintFadeTimer) { clearTimeout(hintFadeTimer); hintFadeTimer = null; }
      textBox.style.transition = '';
      textBox.style.opacity = '';
      amountEl.style.fontSize = '';
      hintEl.style.transition = '';
      hintEl.style.opacity = '';
      bubbleRandomActive = false;
      bubbleRandomLines = null;
      bubbleShown = false;
      pressCount = 0;
      bubbleBox.classList.remove('gpet-bubble-open');
      updateMousePassThrough(false);
    }

    bubbleBox.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!bubbleShown) return;
      if (costBubbleActive) {
        hideCostBubble();
        return;
      }
      if (selectedStoryHook && ipcRenderer) {
        ipcRenderer.send('pet-open-story', selectedStoryHook.id);
        hideBubble();
      } else triggerBubbleOnPress();
    });
    bubbleBox.addEventListener('keydown', function (event) {
      if (selectedStoryHook && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault(); bubbleBox.click();
      }
    });

    // Turn Cost Bubble (live working status + full turn token summary)
    function showCostBubble(amount, unit, isLive) {
      clearStoryHook();
      if (!bubbleOn || !turnCostOn) return;
      if (costBubbleTimer) { clearTimeout(costBubbleTimer); costBubbleTimer = null; }
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      if (animId) { cancelAnimationFrame(animId); animId = null; }
      costBubbleActive = true;
      bubbleRandomActive = false;
      bubbleShown = true;
      pressCount = 0;
      labelEl.style.display = '';
      labelEl.className = 'gpet-label';
      amountEl.style.display = '';
      amountEl.className = 'gpet-amount';
      hintEl.style.display = 'none';
      hintEl.textContent = '';

      if (isLive) {
        labelEl.textContent = petT('✦ 正在思考与敲代码...');
        labelEl.style.color = '#bda56e';
        amountEl.textContent = petT('专注工作中 ✦');
        amountEl.style.color = '#83d8ce';
        amountEl.style.fontSize = 'calc(var(--gpet-u) * 50)';
        bubbleBox.classList.add('gpet-bubble-open');
        // Keep open while agent is working
      } else {
        labelEl.textContent = petT('✦ 本次一共消耗:');
        labelEl.style.color = '#83d8ce';
        amountEl.style.fontSize = '';
        if (typeof amount === 'number') {
          amountEl.textContent = amount.toLocaleString() + ' ' + (unit || 'tokens');
        } else {
          amountEl.textContent = String(amount || '--');
        }
        amountEl.style.color = '#fb7185';
        bubbleBox.classList.add('gpet-bubble-open');
        if (turnCostCloseMs > 0) {
          costBubbleTimer = setTimeout(hideCostBubble, turnCostCloseMs);
        }
      }
    }

    function hideCostBubble() {
      if (costBubbleTimer) { clearTimeout(costBubbleTimer); costBubbleTimer = null; }
      costBubbleActive = false;
      hideBubble();
    }

    window.showTurnCostBubble = showCostBubble;

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function viewport() {
      return {
        w: window.innerWidth || document.documentElement.clientWidth || 1280,
        h: window.innerHeight || document.documentElement.clientHeight || 800
      };
    }

    function updateBaseUnits() {
      var w = Math.round(260 * state.scale);
      root.style.setProperty('--gpet-base', w + 'px');
    }
    window.addEventListener('resize', updateBaseUnits);

    function animateAmount(from, to, duration) {
      if (costBubbleActive || bubbleRandomActive) return;
      if (animId) cancelAnimationFrame(animId);
      if (from === null || !isFinite(from)) from = to;
      if (from === to) {
        shown = to;
        amountEl.textContent = fmtPct(to);
        amountEl.style.color = getQuotaColor(to);
        return;
      }
      var startTime = null;
      function step(ts) {
        if (costBubbleActive || bubbleRandomActive) { animId = null; return; }
        if (startTime === null) startTime = ts;
        var t = Math.min(1, (ts - startTime) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        var val = from + (to - from) * eased;
        amountEl.textContent = fmtPct(val);
        amountEl.style.color = getQuotaColor(val);
        if (t < 1) {
          animId = requestAnimationFrame(step);
        } else {
          animId = null;
          shown = to;
          amountEl.textContent = fmtPct(to);
          amountEl.style.color = getQuotaColor(to);
        }
      }
      animId = requestAnimationFrame(step);
    }

    function render() {
      if (costBubbleActive || bubbleRandomActive) return;
      var info = getCurrentQuotaDisplay();
      labelEl.textContent = info.label;
      var targetVal = info.val;
      if (targetVal === null || targetVal === undefined) {
        amountEl.textContent = petT('待机中');
        amountEl.style.color = '#10b981';
      } else {
        if (shown === null) shown = targetVal;
        amountEl.textContent = fmtPct(shown);
        amountEl.style.color = getQuotaColor(shown);
      }
      hintEl.textContent = info.hint;
    }

    function updateQuotaState(data) {
      if (!data) return;
      var infoBefore = getCurrentQuotaDisplay();
      var prevVal = infoBefore.val;
      if (typeof data.gemini5h === 'number') state.gemini5h = data.gemini5h;
      if (data.gemini5hReset) state.gemini5hReset = data.gemini5hReset;
      if (typeof data.geminiWeekly === 'number') state.geminiWeekly = data.geminiWeekly;
      if (data.geminiWeeklyReset) state.geminiWeeklyReset = data.geminiWeeklyReset;
      if (typeof data.claude5h === 'number') state.claude5h = data.claude5h;
      if (typeof data.claudeWeekly === 'number') state.claudeWeekly = data.claudeWeekly;

      var infoAfter = getCurrentQuotaDisplay();
      var nextVal = infoAfter.val;
      if (bubbleShown && !costBubbleActive && !bubbleRandomActive) {
        animateAmount(prevVal, nextVal, ANIM_MS);
        render();
      } else {
        shown = nextVal;
      }
    }

    function express() {
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.left = state.left + 'px';
      root.style.top = state.top + 'px';
      root.classList.toggle('gpet-left', state.h === 'left');
    }

    function settle() {
      var vp = viewport();
      var w = Math.round(260 * state.scale);
      var h = Math.round(360 * state.scale);
      if (drag && drag.active) {
        state.left = clamp(state.left, 0, Math.max(0, vp.w - w));
        state.top = clamp(state.top, 0, Math.max(0, vp.h - h));
        express();
        return;
      }
      if (state.h === 'right') {
        state.left = Math.max(0, vp.w - w - state.hOff);
      } else if (state.h === 'left') {
        state.left = state.hOff;
      } else {
        state.left = clamp(state.left, 0, Math.max(0, vp.w - w));
      }
      if (state.v === 'bottom') {
        state.top = Math.max(0, vp.h - h - state.vOff);
      } else if (state.v === 'top') {
        state.top = state.vOff;
      } else {
        state.top = clamp(state.top, 0, Math.max(0, vp.h - h));
      }
      express();
    }

    window.addEventListener('resize', settle);

    // Audio Player Engine (Embedded zero-dependency Base64)
    // Audio Player Engine
    var pressAudio = null;
    var releaseAudio = null;
    var pressing = false;
    var pressEnded = false;
    var releasePlayed = false;

    function applySoundSet() {
      if (soundSet === 'mute') {
        pressAudio = null;
        releaseAudio = null;
        return;
      }
      var set = SOUND_DATA[soundSet] || SOUND_DATA.duck;
      try {
        pressAudio = new Audio(set.press);
        pressAudio.preload = 'auto';
        pressAudio.volume = soundVol;
        releaseAudio = new Audio(set.release);
        releaseAudio.preload = 'auto';
        releaseAudio.volume = soundVol;
      } catch (err) {}
    }

    function playPress() {
      if (!pressAudio || !soundOn || soundSet === 'mute') return;
      try {
        if (releaseAudio) {
          releaseAudio.pause();
          releaseAudio.currentTime = 0;
        }
        pressEnded = false;
        releasePlayed = false;
        pressAudio.onended = function () {
          pressEnded = true;
          if (!pressing && !releasePlayed) playRelease();
        };
        pressAudio.currentTime = 0;
        var p = pressAudio.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (err) {}
    }

    function playRelease() {
      if (releasePlayed || !releaseAudio || !soundOn || soundSet === 'mute') return;
      releasePlayed = true;
      try {
        releaseAudio.currentTime = 0;
        var p = releaseAudio.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (err) {}
    }

    // Agent Working State & Sprite Management
    // Rule 1: C (chill: 托腮思考) displayed when Agent is working ("我在工作")
    // Rule 2: I (idle: 经典端庄站立) displayed when Agent is NOT working ("没工作")
    // Rule 3: D (dragged: 迈步出发) displayed when dragging
    // Rule 4: H (happy: 挥手问候) displayed when clicked (interaction)
    function isCurrentlyWorking() {
      if (workStateMode === 'chill' || workStateMode === 'working') return true;
      if (workStateMode === 'idle') return false;
      return agentWorking;
    }

    function getBaseSprite() {
      // 打字时优先使用正视肖像配合连击动效与眼神注视
      if (inTypingMode || workStateMode === 'typing') return (life && life.frontSprite()) || IMAGES.typing;
      if (workStateMode === 'chill' || workStateMode === 'working') return IMAGES.chill;
      if (workStateMode === 'idle') return (life && life.frontSprite()) || IMAGES.idle;
      if (workStateMode === 'happy') return IMAGES.happy;
      if (workStateMode === 'dragged') return IMAGES.dragged;
      if (workStateMode === 'fall') return IMAGES.fall;
      if (workStateMode === 'pat') return IMAGES.pat;
      // 'auto' 模式：主要常驻正视肖像（眼神注视+自然眨眼）；仅在 Agent 正在回复工作时呈现托腮思考
      return (agentWorking && workStateMode !== 'idle') ? IMAGES.chill : ((life && life.frontSprite()) || IMAGES.idle);
    }

    function syncSprite() {
      if (life) life.stop(false);
      var targetSrc = getBaseSprite();
      if (drag && drag.active && drag.moved) {
        targetSrc = IMAGES.dragged;
      } else if (inHappyReaction) {
        targetSrc = IMAGES.happy;
      } else if (inTypingMode || workStateMode === 'typing') {
        targetSrc = (life && life.frontSprite()) || IMAGES.typing;
      }
      if (img.dataset.curSrc !== targetSrc) {
        img.dataset.curSrc = targetSrc;
        img.dataset.blinkFrame = '';
        img.src = targetSrc;
        if (typeof updateHitTestProbe === 'function') {
          updateHitTestProbe(targetSrc);
        }
      }
    }

    function setAgentWorking(isWorking) {
      agentWorking = !!isWorking;
      syncSprite();
    }

    function setWorkStateMode(mode) {
      workStateMode = mode;
      syncSprite();
      saveConfig();
    }

    // Spring animations & Q-elastic squish tactile reaction
    function pressDown() {
      if (life) life.stop();
      pressing = true;
      img.classList.remove('gpet-breathe');
      img.classList.remove('gpet-jelly');
      img.classList.add('gpet-squished');
      playPress();
    }

    function pressUp(dragMoved) {
      pressing = false;
      img.classList.remove('gpet-squished');
      if (!dragMoved) {
        // Trigger Q-elastic jelly spring bounce!
        void img.offsetWidth;
        img.classList.add('gpet-jelly');
        setTimeout(function () {
          img.classList.remove('gpet-jelly');
          img.style.transform = '';
          img.classList.add('gpet-breathe');
        }, 550);
        playRelease();
      } else {
        img.classList.remove('gpet-jelly');
        img.style.transform = '';
        img.classList.add('gpet-breathe');
      }
    }

    // Dynamic Scale Adjustment (Electron + Web responsive)
    var scalingClassTimer = null;
    function setScale(v, fromRemote, fromNumberInput) {
      var next = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(v))) * 10) / 10;
      state.scale = next;
      if (scaleInput && scaleInput.value !== String(next)) {
        scaleInput.value = String(next);
      }
      if (scaleNumber && !fromNumberInput) {
        var lvl = Math.round((next - 0.6) * 10) + 1;
        scaleNumber.value = String(Math.max(1, Math.min(20, lvl)));
      }

      var pxW = Math.round(260 * next);
      var pxH = Math.round(360 * next);

      root.classList.add('gpet-scaling');
      if (scalingClassTimer) clearTimeout(scalingClassTimer);
      scalingClassTimer = setTimeout(function () {
        scalingClassTimer = null;
        root.classList.remove('gpet-scaling');
      }, 180);

      root.style.setProperty('--gpet-scale', String(next));
      root.style.setProperty('--gpet-base', pxW + 'px');

      if (ipcRenderer) {
        if (!fromRemote) {
          ipcRenderer.send('pet-set-scale', next, state.h === 'left');
        }
      } else {
        root.style.width = pxW + 'px';
        root.style.height = pxH + 'px';
        settle();
      }
      if (!fromRemote) {
        saveConfig(false);
      }
    }

    function setVol(v, fromRemote) {
      soundVol = Math.round(Math.min(1, Math.max(0, Number(v))) * 100) / 100;
      soundOn = soundVol > 0;
      if (volInput && volInput.value !== String(soundVol)) {
        volInput.value = String(soundVol);
      }
      if (volPct) {
        volPct.textContent = Math.round(soundVol * 100) + '%';
      }
      if (pressAudio) pressAudio.volume = soundVol;
      if (releaseAudio) releaseAudio.volume = soundVol;
      if (!fromRemote) {
        saveConfig(false);
      }
    }

    function setSoundSet(v) {
      soundSet = v;
      soundSelect.value = v;
      applySoundSet();
      saveConfig();
    }

    function setQuotaView(v) {
      state.quotaView = v;
      quotaViewSelect.value = v;
      shown = null;
      render();
      saveConfig();
    }

    function setBubbleOn(v) {
      bubbleOn = !!v;
      bubbleToggle.checked = bubbleOn;
      if (!bubbleOn) hideCostBubble();
      saveConfig();
    }

    function setTurnCostOn(v) {
      turnCostOn = !!v;
      turnCostToggle.checked = turnCostOn;
      turnCostCloseInput.disabled = !turnCostOn;
      if (!turnCostOn) hideCostBubble();
      saveConfig();
    }

    function setTurnCostClose(v) {
      var n = Math.max(0, Math.round(Number(v) || 0));
      turnCostCloseMs = n * 1000;
      turnCostCloseInput.value = String(n);
      saveConfig();
    }

    function setTypingOn(v) {
      typingOn = !!v;
      if (typingToggle) typingToggle.checked = typingOn;
      if (!typingOn && inTypingMode) {
        exitTypingMode();
      }
      saveConfig();
    }

    function setGravityOn(v) {
      gravityOn = !!v;
      if (gravityToggle) gravityToggle.checked = gravityOn;
      saveConfig();
    }

    function setAntigravitySyncMode(v) {
      antigravitySyncMode = v || 'manual';
      if (antigravitySyncSelect) antigravitySyncSelect.value = antigravitySyncMode;
      saveConfig();
      if (ipcRenderer) {
        ipcRenderer.send('pet-config-changed', { antigravitySyncMode: antigravitySyncMode });
      }
    }

    var saveConfigTimer = null;
    function doSaveConfig() {
      try {
        var cfg = {
          scale: state.scale,
          soundVol: soundVol,
          soundSet: soundSet,
          quotaView: state.quotaView,
          bubbleOn: bubbleOn,
          typingOn: typingOn,
          gravityOn: gravityOn,
          turnCostOn: turnCostOn,
          turnCostCloseMs: turnCostCloseMs,
          workStateMode: workStateMode,
          eyeGazeOn: presence ? presence.enabled() : true,
          randomMotionOn: life ? life.options.randomMotionOn : true,
          proactiveStoriesOn: life ? life.options.proactiveStoriesOn : true,
          storyIntervalMinutes: life ? life.options.storyIntervalMinutes : 3,
          antigravitySyncMode: antigravitySyncMode
        };
        localStorage.setItem('gemini-pet-config', JSON.stringify(cfg));
      } catch (_) {}
    }

    function saveConfig(immediate) {
      if (immediate) {
        if (saveConfigTimer) { clearTimeout(saveConfigTimer); saveConfigTimer = null; }
        doSaveConfig();
      } else {
        if (saveConfigTimer) clearTimeout(saveConfigTimer);
        saveConfigTimer = setTimeout(function () {
          saveConfigTimer = null;
          doSaveConfig();
        }, 400);
      }
    }

    function loadConfig() {
      try {
        var raw = localStorage.getItem('gemini-pet-config');
        if (raw) {
          var c = JSON.parse(raw);
          if (life) life.apply(c);
          if (presence) presence.apply(c);
          if (c.scale) setScale(c.scale);
          if (c.soundVol !== undefined) setVol(c.soundVol);
          if (c.soundSet) setSoundSet(c.soundSet);
          if (c.quotaView) setQuotaView(c.quotaView);
          if (c.bubbleOn !== undefined) setBubbleOn(c.bubbleOn);
          if (c.typingOn !== undefined) setTypingOn(c.typingOn);
          if (c.gravityOn !== undefined) setGravityOn(c.gravityOn);
          if (c.turnCostOn !== undefined) setTurnCostOn(c.turnCostOn);
          if (c.turnCostCloseMs) setTurnCostClose(c.turnCostCloseMs / 1000);
          if (c.workStateMode) {
            workStateMode = c.workStateMode === 'working' ? 'chill' : c.workStateMode;
            if (workStateSelect) workStateSelect.value = workStateMode;
            syncSprite();
          }
          if (c.antigravitySyncMode) {
            antigravitySyncMode = c.antigravitySyncMode;
            if (antigravitySyncSelect) antigravitySyncSelect.value = antigravitySyncMode;
          }
        }
      } catch (_) {}
    }

    var menuOpen = false;
    function toggleMenu() {
      menuOpen = !menuOpen;
      if (menuOpen) {
        hideBubble();
        positionMenu();
      }
      menuBox.classList.toggle('gpet-menu-open', menuOpen);
      updateMousePassThrough(menuOpen || bubbleShown);
    }
    function closeMenu() {
      menuOpen = false;
      menuBox.classList.remove('gpet-menu-open');
      updateMousePassThrough(bubbleShown);
    }

    function positionMenu() {
      try {
        var onLeft = state.h === 'left';
        if (onLeft) {
          menuBox.style.left = '8px';
          menuBox.style.right = 'auto';
          menuBox.style.transformOrigin = 'top left';
        } else {
          menuBox.style.right = '8px';
          menuBox.style.left = 'auto';
          menuBox.style.transformOrigin = 'top right';
        }
        menuBox.style.top = '8px';
        menuBox.style.bottom = 'auto';
      } catch (_) {}
    }

    // Pixel-level Transparent Hit-Testing Canvas (764x1024 native ratio)
    var hitCanvas = null;
    var hitCtx = null;
    var hitReady = false;
    var hitAlpha = null;
    var hitAspect = 2 / 3;
    var hitProbeVersion = 0;
    function updateHitTestProbe(src) {
      if (!hitCanvas || !hitCtx) return;
      var version = ++hitProbeVersion;
      var probe = new Image();
      probe.onload = function () {
        try {
          if (version !== hitProbeVersion) return;
          hitAspect = probe.naturalWidth / probe.naturalHeight;
          hitCtx.clearRect(0, 0, hitCanvas.width, hitCanvas.height);
          hitCtx.drawImage(probe, 0, 0, hitCanvas.width, hitCanvas.height);
          var imgData = hitCtx.getImageData(0, 0, hitCanvas.width, hitCanvas.height);
          hitAlpha = imgData.data;
          hitReady = true;
        } catch (_) {}
      };
      probe.src = src;
    }

    function setupHitTest() {
      try {
        hitCanvas = document.createElement('canvas');
        hitCanvas.width = 382;
        hitCanvas.height = 512;
        hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true });
        updateHitTestProbe(img.src || IMAGES.chill);
      } catch (_) {}
    }

    function getHitInfo(e) {
      try {
        var r = img.getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) return { hit: false, isHead: false };

        var relX = (e.clientX - r.left) / r.width;
        var relY = (e.clientY - r.top) / r.height;
        if (presence && presence.isMirrored()) relX = 1 - relX;

        var insideBox = relX >= 0 && relX <= 1 && relY >= 0 && relY <= 1;
        if (!insideBox) return { hit: false, isHead: false };

        // Head region: upper 36% of the character image (ears & crown of head only)
        var isHead = relY <= 0.36 && relX >= 0.16 && relX <= 0.84;

        var hit = true;
        if (hitCanvas && hitReady && hitAlpha) {
          try {
            var imgAspect = hitAspect;
            var containerAspect = r.width / r.height;
            var rendW = r.width;
            var rendH = r.height;
            var offX = 0;
            var offY = 0;
            if (containerAspect < imgAspect) {
              rendW = r.width;
              rendH = r.width / imgAspect;
              offY = (r.height - rendH) / 2;
            } else {
              rendH = r.height;
              rendW = r.height * imgAspect;
              offX = (r.width - rendW) / 2;
            }
            if (e.clientX < r.left + offX || e.clientX >= r.left + offX + rendW || e.clientY < r.top + offY || e.clientY >= r.top + offY + rendH) return { hit: false, isHead: false };
            var lx = Math.floor((e.clientX - (r.left + offX)) / rendW * hitCanvas.width);
            var ly = Math.floor((e.clientY - (r.top + offY)) / rendH * hitCanvas.height);
            if (presence && presence.isMirrored()) lx = hitCanvas.width - 1 - lx;
            if (lx >= 0 && ly >= 0 && lx < hitCanvas.width && ly < hitCanvas.height) {
              var idx = (ly * hitCanvas.width + lx) * 4 + 3;
              hit = hitAlpha[idx] > 10;
            }
          } catch (_) {}
        }

        return { hit: hit, isHead: isHead, relX: relX, relY: relY };
      } catch (_) {
        return { hit: true, isHead: false };
      }
    }

    function isCharacterHit(e) {
      return getHitInfo(e).hit;
    }

    // Gravity Physics Engine
    var gravityAnimId = null;
    var gravityOn = true;

    function stopGravityDrop() {
      if (gravityAnimId) {
        cancelAnimationFrame(gravityAnimId);
        gravityAnimId = null;
      }
    }

    function startGravityDrop(startX, startY, initVx, initVy) {
      if (life) life.stop();
      stopGravityDrop();

      var curX = startX;
      var curY = startY;
      var vx = Math.max(-14, Math.min(14, (typeof initVx === 'number' ? initVx : 0)));
      var vy = Math.max(-10, Math.min(12, (typeof initVy === 'number' ? initVy : 0)));
      var gravity = 0.52;
      var maxFallSpeed = 9.5;
      var bounceCount = 0;

      var isElec = !!ipcRenderer;
      var screenW = isElec ? (window.screen.availWidth || 1920) : (window.innerWidth || 1280);
      var screenH = isElec ? (window.screen.availHeight || 1080) : (window.innerHeight || 800);
      var petW = isElec ? (window.outerWidth || Math.round(260 * state.scale)) : Math.round(260 * state.scale);
      var petH = isElec ? (window.outerHeight || Math.round(360 * state.scale)) : Math.round(360 * state.scale);
      var topOff = isElec ? (window.screen.availTop || 0) : 0;
      var leftOff = isElec ? (window.screen.availLeft || 0) : 0;

      var floorY = Math.max(0, topOff + screenH - petH - 20);
      var minX = leftOff + 10;
      var maxX = Math.max(minX, leftOff + screenW - petW - 10);

      img.classList.remove('gpet-breathe');
      img.classList.remove('gpet-jelly');
      img.classList.remove('gpet-squished');
      img.src = IMAGES.happy;

      function tick() {
        vy += gravity;
        if (vy > maxFallSpeed) vy = maxFallSpeed;
        curY += vy;
        curX += vx;
        vx *= 0.985;

        // Side wall bounce
        if (curX <= minX) {
          curX = minX;
          vx = -vx * 0.5;
        } else if (curX >= maxX) {
          curX = maxX;
          vx = -vx * 0.5;
        }

        // Floor collision
        if (curY >= floorY) {
          curY = floorY;
          if (img.src !== IMAGES.fall) {
            img.src = IMAGES.fall;
          }
          if (Math.abs(vy) > 2.8) {
            playRelease();
            img.classList.remove('gpet-jelly');
            void img.offsetWidth;
            img.classList.add('gpet-jelly');
            setTimeout(function () {
              img.classList.remove('gpet-jelly');
            }, 550);

            vy = -vy * 0.34;
            vx *= 0.6;
            bounceCount++;
            if (bounceCount >= 3 || Math.abs(vy) < 1.8) {
              vy = 0;
            }
          } else {
            vy = 0;
          }
        }

        if (isElec) {
          ipcRenderer.send('pet-set-position', Math.round(curX), Math.round(curY));
        } else {
          state.left = Math.round(curX);
          state.top = Math.round(curY);
          express();
        }

        if (Math.abs(vy) > 0.1 || curY < floorY - 2) {
          gravityAnimId = requestAnimationFrame(tick);
        } else {
          gravityAnimId = null;
          if (isElec) {
            ipcRenderer.send('pet-set-position', Math.round(curX), Math.round(floorY));
          } else {
            state.left = Math.round(curX);
            state.top = Math.round(floorY);
            express();
          }

          // Keep sprawled sitting on floor rubbing head!
          img.src = IMAGES.fall;
          inHappyReaction = true;

          // Cute pout bubble!
          showFallSpeechBubble();

          if (happyTimer) clearTimeout(happyTimer);
          happyTimer = setTimeout(function () {
            inHappyReaction = false;
            syncSprite();
            img.classList.add('gpet-breathe');
          }, 2400);
        }
      }

      gravityAnimId = requestAnimationFrame(tick);
    }

    // Pointer and Drag Interaction
    function onWindowBlurDuringDrag() {
      if (drag && drag.active) {
        endDrag(null, false);
      }
    }

    function onDocPointerDown(e) {
      stopGravityDrop();
      if (e.target && e.target.closest) {
        if (e.target.closest('.gpet-bubble') || e.target.closest('.gpet-menu')) return;
      }
      if (menuOpen) {
        closeMenu();
        return;
      }
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      var hitInfo = getHitInfo(e);
      if (!hitInfo.hit) return;
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

      try {
        if (e.target && typeof e.target.setPointerCapture === 'function') {
          e.target.setPointerCapture(e.pointerId);
        }
      } catch (_) {}

      var vp = viewport();
      var rect = root.getBoundingClientRect();
      var sX = (e.screenX !== undefined && e.screenX !== 0) ? e.screenX : e.clientX;
      var sY = (e.screenY !== undefined && e.screenY !== 0) ? e.screenY : e.clientY;
      var winX = window.screenX || 0;
      var winY = window.screenY || 0;
      var now = performance.now();

      drag = {
        active: true,
        pointerId: e.pointerId,
        targetEl: e.target,
        startX: e.clientX,
        startY: e.clientY,
        startScreenX: sX,
        startScreenY: sY,
        startWinX: winX,
        startWinY: winY,
        lastScreenX: sX,
        lastScreenY: sY,
        lastTime: now,
        vx: 0,
        vy: 0,
        origLeft: rect.left,
        origTop: rect.top,
        w: rect.width,
        h: rect.height,
        moved: false,
        vp: vp
      };
      pressDown();
      document.addEventListener('pointermove', onDocPointerMove, true);
      document.addEventListener('pointerup', onDocPointerUp, true);
      document.addEventListener('pointercancel', onDocPointerCancel, true);
      window.addEventListener('blur', onWindowBlurDuringDrag);
    }

    var pendingSetPos = null;
    var setPosRafId = null;
    function scheduleSetPosition(x, y) {
      pendingSetPos = { x: x, y: y };
      if (!setPosRafId) {
        setPosRafId = requestAnimationFrame(function () {
          setPosRafId = null;
          if (pendingSetPos && ipcRenderer) {
            ipcRenderer.send('pet-set-position', pendingSetPos.x, pendingSetPos.y);
          }
        });
      }
    }
    function flushSetPosition() {
      if (setPosRafId) {
        cancelAnimationFrame(setPosRafId);
        setPosRafId = null;
      }
      if (pendingSetPos && ipcRenderer) {
        ipcRenderer.send('pet-set-position', pendingSetPos.x, pendingSetPos.y);
        pendingSetPos = null;
      }
    }

    function onDocPointerMove(e) {
      if (!drag || !drag.active) return;
      var sX = (e.screenX !== undefined && e.screenX !== 0) ? e.screenX : e.clientX;
      var sY = (e.screenY !== undefined && e.screenY !== 0) ? e.screenY : e.clientY;
      var screenDx = sX - drag.startScreenX;
      var screenDy = sY - drag.startScreenY;

      var now = performance.now();
      var dt = Math.max(1, now - (drag.lastTime || now));
      var instVx = (sX - drag.lastScreenX) / dt;
      var instVy = (sY - drag.lastScreenY) / dt;
      drag.vx = drag.vx * 0.4 + (instVx * 16.6) * 0.6;
      drag.vy = drag.vy * 0.4 + (instVy * 16.6) * 0.6;
      drag.lastScreenX = sX;
      drag.lastScreenY = sY;
      drag.lastTime = now;

      if (screenDx * screenDx + screenDy * screenDy >= CLICK_SQ) {
        if (!drag.moved) {
          drag.moved = true;
          root.classList.add('gpet-dragging');
          img.classList.remove('gpet-squished');
          img.classList.remove('gpet-jelly');
          img.style.transform = '';
          if (pressAudio) {
            try { pressAudio.pause(); pressAudio.currentTime = 0; } catch (_) {}
          }
          pressEnded = false;
          releasePlayed = true;
          img.src = IMAGES.dragged;
        }
      }

      if (drag.moved) {
        if (ipcRenderer && e.screenX !== undefined && e.screenX !== 0) {
          var targetX = Math.round(drag.startWinX + screenDx);
          var targetY = Math.round(drag.startWinY + screenDy);
          scheduleSetPosition(targetX, targetY);
          return;
        }

        var dx = e.clientX - drag.startX;
        var dy = e.clientY - drag.startY;
        state.left = clamp(drag.origLeft + dx, 0, Math.max(0, drag.vp.w - drag.w));
        state.top = clamp(drag.origTop + dy, 0, Math.max(0, drag.vp.h - drag.h));
        express();
      }
    }

    function onDocPointerUp(e) {
      try { if (isCharacterHit(e)) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
      endDrag(e, true);
    }
    function onDocPointerCancel(e) { endDrag(e, false); }

    function endDrag(e, clickAllowed) {
      if (!drag || !drag.active) return;
      flushSetPosition();
      var dragMoved = drag.moved;
      var targetEl = drag.targetEl;
      var pointerId = drag.pointerId;
      var throwVx = drag.vx;
      var throwVy = drag.vy;
      var lastMoveTime = drag.lastTime;
      var sX = (e && e.screenX !== undefined && e.screenX !== 0) ? e.screenX : drag.lastScreenX;
      var sY = (e && e.screenY !== undefined && e.screenY !== 0) ? e.screenY : drag.lastScreenY;
      var screenDx = sX - drag.startScreenX;
      var screenDy = sY - drag.startScreenY;
      var curX = ipcRenderer ? Math.round(drag.startWinX + screenDx) : state.left;
      var curY = ipcRenderer ? Math.round(drag.startWinY + screenDy) : state.top;

      try {
        if (targetEl && pointerId !== undefined && typeof targetEl.releasePointerCapture === 'function') {
          targetEl.releasePointerCapture(pointerId);
        }
      } catch (_) {}

      drag.active = false;
      drag = null;
      document.removeEventListener('pointermove', onDocPointerMove, true);
      document.removeEventListener('pointerup', onDocPointerUp, true);
      document.removeEventListener('pointercancel', onDocPointerCancel, true);
      window.removeEventListener('blur', onWindowBlurDuringDrag);
      root.classList.remove('gpet-dragging');
      pressUp(dragMoved);

      if (clickAllowed && !dragMoved) {
        if (happyTimer) clearTimeout(happyTimer);
        inHappyReaction = true;
        img.src = IMAGES.happy;
        showBubble();
        if (ipcRenderer) {
          try { ipcRenderer.send('pet-toggle-chat'); } catch (_) {}
        }
        happyTimer = setTimeout(function () {
          inHappyReaction = false;
          syncSprite();
          img.classList.add('gpet-breathe');
        }, 1200);
        return;
      }

      if (dragMoved && gravityOn) {
        var isElec = !!ipcRenderer;
        var screenH = isElec ? (window.screen.availHeight || 1080) : (window.innerHeight || 800);
        var petH = isElec ? (window.outerHeight || Math.round(360 * state.scale)) : Math.round(360 * state.scale);
        var topOff = isElec ? (window.screen.availTop || 0) : 0;
        var floorY = Math.max(0, topOff + screenH - petH - 20);

        var nowMs = performance.now();
        var timeSinceLastMove = nowMs - (lastMoveTime || nowMs);
        var throwSpeed = Math.hypot(throwVx, throwVy);

        // 抛出判定：释放时处于明显甩动滑行状态（速度 > 2.8 且距最后移动 < 110ms）
        var isThrow = (timeSinceLastMove < 110) && (throwSpeed > 2.8 || throwVy > 2.2 || throwVy < -2.6 || Math.abs(throwVx) > 2.8);

        if (isThrow) {
          startGravityDrop(curX, curY, throwVx, throwVy);
          return;
        }

        // 悬停模式：轻轻松手，停在当前任意位置（反重力浮空）
        stopGravityDrop();
        if (isElec) {
          ipcRenderer.send('pet-set-position', Math.round(curX), Math.round(curY));
        } else {
          state.left = Math.round(curX);
          state.top = Math.round(curY);
          express();
        }

        // 若悬停在半空（远离任务栏），触发反重力悬停趣味台词
        if (curY < floorY - 60 && bubbleOn && !bubbleShown) {
          var hoverQuotes = [
            petT('✦ 反重力引擎启动，青绿守护就绪'),
            petT('我在这里，陪你把思路慢慢写下来 ✦'),
            petT('浮空守候中，今天的视野很开阔 ✦'),
            petT('青绿守护者随时待命 ✦')
          ];
          var lines = singleCenter('A', pickOne(hoverQuotes), '#83d8ce', true);
          applyBubbleLines(lines);
          bubbleShown = true;
          bubbleBox.classList.add('gpet-bubble-open');
          bubbleTimer = setTimeout(hideBubble, 3200);
        }
      }

      inHappyReaction = false;
      syncSprite();
      if (ipcRenderer) {
        try {
          ipcRenderer.send('pet-request-agent-work-state');
        } catch (_) {}
      } else if (!dragMoved) {
        settle();
      }
      if (e) {
        setWidgetCursor(isCharacterHit(e) ? 'grab' : '');
      }
    }

    // Headpat Reaction Engine (Hover Petting & Wheel Petting)
    function triggerHeadpatReaction(isWheel) {
      if (life) life.stop();
      spawnHeartNearHead();
      playRelease();
      if (inHappyReaction && img.src === IMAGES.pat) {
        if (happyTimer) clearTimeout(happyTimer);
        happyTimer = setTimeout(function () {
          inHappyReaction = false;
          syncSprite();
          img.classList.add('gpet-breathe');
        }, 2200);
        return;
      }
      if (happyTimer) clearTimeout(happyTimer);
      inHappyReaction = true;
      img.src = IMAGES.pat;
      showPatSpeechBubble();
      happyTimer = setTimeout(function () {
        inHappyReaction = false;
        syncSprite();
        img.classList.add('gpet-breathe');
      }, 2200);
    }

    // 1. Hover Petting (悬停抚摸：鼠标在头顶区域轻快反复来回揉蹭)
    var hoverDist = 0;
    var hoverReversals = 0;
    var lastHoverX = 0;
    var lastHoverY = 0;
    var lastHoverDirX = 0;
    var lastHoverTime = 0;

    document.addEventListener('pointermove', function (e) {
      if (drag && drag.active) return;
      if (menuOpen) return;
      var hitInfo = getHitInfo(e);
      if (hitInfo.hit && hitInfo.isHead) {
        var now = performance.now();
        if (now - lastHoverTime > 380) {
          hoverDist = 0;
          hoverReversals = 0;
          lastHoverDirX = 0;
        }
        lastHoverTime = now;
        var hdx = e.clientX - (lastHoverX || e.clientX);
        var hdy = e.clientY - (lastHoverY || e.clientY);
        hoverDist += Math.hypot(hdx, hdy);
        lastHoverX = e.clientX;
        lastHoverY = e.clientY;

        // Detect clear horizontal direction change (rubbing back and forth)
        if (Math.abs(hdx) > 6) {
          var dir = hdx > 0 ? 1 : -1;
          if (lastHoverDirX && lastHoverDirX !== dir) {
            hoverReversals++;
          }
          lastHoverDirX = dir;
        }

        // Must intentionally rub back and forth at least 3 times with enough travel distance!
        if (hoverDist >= 140 && hoverReversals >= 3) {
          hoverDist = 0;
          hoverReversals = 0;
          lastHoverDirX = 0;
          triggerHeadpatReaction(false);
        }
      } else {
        lastHoverX = e.clientX;
        lastHoverY = e.clientY;
        hoverDist = 0;
        hoverReversals = 0;
        lastHoverDirX = 0;
      }
    }, true);

    // 3. Wheel Petting / Scratching (鼠标滚轮在头部连续滚动挠痒)
    var wheelTicks = 0;
    var lastWheelTime = 0;
    window.addEventListener('wheel', function (e) {
      if (menuOpen) return;
      var hitInfo = getHitInfo(e);
      if (hitInfo.hit && hitInfo.isHead) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        var now = performance.now();
        if (now - lastWheelTime > 450) {
          wheelTicks = 0;
        }
        lastWheelTime = now;
        wheelTicks++;

        // Each wheel scroll produces a gentle heart
        spawnHeartNearHead();

        // Requires at least 3 continuous wheel notches to trigger full pampered headpat
        if (wheelTicks >= 3) {
          triggerHeadpatReaction(true);
          wheelTicks = 0;
        }
      } else {
        wheelTicks = 0;
      }
    }, { passive: false });

    function onDocClickStopper(e) {
      if (e.target && e.target.closest && (e.target.closest('.gpet-menu') || e.target.closest('.gpet-bubble'))) return;
      if (!isCharacterHit(e)) return;
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
    }

    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('click', onDocClickStopper, true);
    document.addEventListener('contextmenu', function (e) {
      if (isCharacterHit(e)) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        if (ipcRenderer) {
          var r = img.getBoundingClientRect();
          var charRect = {
            left: Math.round(window.screenX + r.left),
            top: Math.round(window.screenY + r.top),
            right: Math.round(window.screenX + r.right),
            bottom: Math.round(window.screenY + r.bottom),
            width: Math.round(r.width),
            height: Math.round(r.height)
          };
          ipcRenderer.send('pet-toggle-settings', charRect);
        } else {
          toggleMenu();
        }
      }
    }, true);

    var widgetCursor = '';
    function setWidgetCursor(v) {
      if (v !== widgetCursor) {
        widgetCursor = v;
        try { document.body.style.cursor = v; } catch (_) {}
      }
    }

    var lastCaptureState = null;
    function updateMousePassThrough(shouldCapture) {
      if (!ipcRenderer) return;
      if (lastCaptureState === shouldCapture) return;
      lastCaptureState = shouldCapture;
      if (shouldCapture) {
        ipcRenderer.send('set-ignore-mouse-events', false);
      } else {
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
      }
    }

    function isBubbleInteractive(e) {
      if (!bubbleShown) return false;
      try {
        var el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el.closest && el.closest('.gpet-bubble-open')) {
          return true;
        }
      } catch (_) {}
      return false;
    }

    // Dynamic Hover and Cursor handling
    function onDocPointerMoveCursor(e) {
      if (drag && drag.active) {
        setWidgetCursor('grabbing');
        updateMousePassThrough(true);
        return;
      }
      var over = isCharacterHit(e);
      var overBubble = isBubbleInteractive(e);
      var overMenu = menuOpen && (function () {
        try {
          var el = document.elementFromPoint(e.clientX, e.clientY);
          return !!(el && el.closest && el.closest('.gpet-menu-open'));
        } catch (_) { return false; }
      })();
      var shouldCapture = over || overBubble || overMenu;
      setWidgetCursor(over ? 'grab' : (overBubble ? 'pointer' : ''));
      updateMousePassThrough(shouldCapture);
    }
    document.addEventListener('pointermove', onDocPointerMoveCursor, true);
    window.addEventListener('mouseleave', function () {
      if (drag && drag.active) return;
      setWidgetCursor('');
      updateMousePassThrough(false);
    });

    // Coding Companion: Typing & Keyboard combo detection
    var typingOn = true;
    var typingCombo = 0;
    var typingDecayTimer = null;
    var inTypingMode = false;
    var lastTypingBubbleTime = 0;

    var TYPING_QUOTES = [
      petT('键盘声响起来了，我们一起专注吧 ✦'),
      petT('托特正在思考，愿下一次测试全绿 ✦'),
      petT('键盘要敲冒烟啦！这就是传说中的手速吗？！(🔥)'),
      petT('先检查，再提交，让每一步都稳稳落地。'),
      petT('Ctrl+C，Ctrl+V… 别忘了留一点时间休息。'),
      petT('反重力引擎正在把灵感转化为代码 ✦'),
      petT('✦ 结对编程就绪，我们一步一步来。'),
      petT('继续写吧，遇到报错我们一起解决。')
    ];

    function getComboTier(combo) {
      if (combo >= 1000) return 6;
      if (combo >= 500) return 5;
      if (combo >= 100) return 4;
      if (combo >= 50) return 3;
      if (combo >= 30) return 2;
      return 1;
    }

    function getComboColor(tier) {
      if (tier === 2) return '#bda56e';
      if (tier === 3) return '#fef08a';
      if (tier === 4) return '#f472b6';
      if (tier === 5) return '#fde047';
      if (tier === 6) return '#ffffff';
      return '#83d8ce';
    }

    function spawnTypingSpark() {
      try {
        var spark = document.createElement('div');
        spark.className = 'gpet-heart';
        var tier = getComboTier(typingCombo);
        var symbol = '✦';
        var size = '17px';
        var glow = '#83d8ce';

        if (tier === 1) {
          symbol = pickOne(['✦', '💻', '✧']);
          size = '17px';
          glow = '#83d8ce';
        } else if (tier === 2) {
          symbol = pickOne(['⚡', '✨', '◇', '💻']);
          size = '19px';
          glow = '#bda56e';
        } else if (tier === 3) {
          symbol = pickOne(['🔥', '⚡', '✨', '💡']);
          size = '22px';
          glow = '#f59e0b';
        } else if (tier === 4) {
          symbol = pickOne(['𓅃', '🪶', '🪐', '⚡', '🌟', '✨']);
          size = '24px';
          glow = '#ec4899';
        } else if (tier === 5) {
          symbol = pickOne(['𓁹', '🪶', '💫', '🔥', '⚡', '👑']);
          size = '26px';
          glow = '#fbbf24';
        } else {
          symbol = pickOne(['𓅃', '🪶', '👑', '✨', '💫', '💎', '🌟']);
          size = '28px';
          glow = '#ffffff';
        }

        spark.textContent = symbol;
        spark.style.fontSize = size;
        spark.style.filter = 'drop-shadow(0 0 10px ' + glow + ')';
        var r = img.getBoundingClientRect();
        var ox = r.left + r.width * (0.55 + (Math.random() - 0.5) * 0.35);
        var oy = r.top + r.height * (0.65 + (Math.random() - 0.5) * 0.2);
        spark.style.left = Math.round(ox) + 'px';
        spark.style.top = Math.round(oy) + 'px';
        document.body.appendChild(spark);
        setTimeout(function () {
          if (spark && spark.parentNode) spark.parentNode.removeChild(spark);
        }, 1100);

        if (tier >= 5 && Math.random() > 0.45) {
          var spark2 = document.createElement('div');
          spark2.className = 'gpet-heart';
          spark2.textContent = pickOne(['✨', '✦', '💫']);
          spark2.style.fontSize = '18px';
          spark2.style.left = Math.round(ox + (Math.random() - 0.5) * 40) + 'px';
          spark2.style.top = Math.round(oy + (Math.random() - 0.5) * 30) + 'px';
          spark2.style.filter = 'drop-shadow(0 0 8px #ffd700)';
          document.body.appendChild(spark2);
          setTimeout(function () {
            if (spark2 && spark2.parentNode) spark2.parentNode.removeChild(spark2);
          }, 950);
        }
      } catch (_) {}
    }

    function showComboMilestoneBubble(combo) {
      if (!bubbleOn || costBubbleActive || menuOpen) return;
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      bubbleRandomActive = true;
      pressCount = 2;

      var text = '';
      var color = '#83d8ce';
      if (combo === 30) {
        text = petT('✦ 30 连击！心流渐入佳境，专注力拉满 ✦');
        color = '#bda56e';
      } else if (combo === 50) {
        text = petT('🔥 50 连击！键盘敲出残影了，这就是大神的手速吗？！');
        color = '#fef08a';
      } else if (combo === 100) {
        text = petT('⚡ 100 连击突破！反重力编译器超频全开 ⚡');
        color = '#f472b6';
      } else if (combo === 500) {
        text = petT('𓁹 500 连击封神！托特的智慧之羽已被你的手速点燃 🪶✨');
        color = '#fde047';
      } else if (combo === 1000) {
        text = petT('✦ 1000 连击破壁！唯有绝对专注与智慧不可阻挡 ✦');
        color = '#ffffff';
      }

      var lines = singleCenter('A', text, color, true);
      if (bubbleShown) {
        swapBubbleContent(function () { applyBubbleLines(lines); });
      } else {
        applyBubbleLines(lines);
        bubbleShown = true;
        bubbleBox.classList.add('gpet-bubble-open');
      }
      bubbleTimer = setTimeout(hideBubble, 4500);
    }

    function showTypingBubble() {
      if (!bubbleOn || costBubbleActive || menuOpen) return;
      var now = Date.now();
      if (now - lastTypingBubbleTime < 5000) return;
      lastTypingBubbleTime = now;
      if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
      bubbleRandomActive = true;
      pressCount = 2;

      var text = pickOne(TYPING_QUOTES);
      var tier = getComboTier(typingCombo);
      var color = getComboColor(tier);
      var lines = singleCenter('A', text, color, true);

      if (bubbleShown) {
        swapBubbleContent(function () {
          applyBubbleLines(lines);
        });
      } else {
        applyBubbleLines(lines);
        bubbleShown = true;
        bubbleBox.classList.add('gpet-bubble-open');
      }

      bubbleTimer = setTimeout(hideBubble, 3800);
    }

    function handleKeyPress() {
      if (life) life.stop();
      if (!typingOn || (drag && drag.active) || inHappyReaction || gravityAnimId) return;

      typingCombo++;
      var tier = getComboTier(typingCombo);

      var badgeText = 'Combo x' + typingCombo;
      if (tier === 2) badgeText = 'Flow x' + typingCombo + ' ✨';
      else if (tier === 3) badgeText = 'Fever x' + typingCombo + ' 🔥';
      else if (tier === 4) badgeText = '⚡ Cosmic x' + typingCombo + ' ⚡';
      else if (tier === 5) badgeText = '𓁹 GODSPEED x' + typingCombo + ' 𓁹';
      else if (tier === 6) badgeText = '✦ ' + typingCombo + ' GODLIKE ✦';

      comboBadge.textContent = badgeText;
      comboBadge.className = 'gpet-combo-badge gpet-combo-active gpet-combo-t' + tier;
      comboBadge.classList.add('gpet-combo-pop');
      setTimeout(function () {
        comboBadge.classList.remove('gpet-combo-pop');
      }, 90);

      var wobbleDur = '.28s';
      if (tier === 2) wobbleDur = '.22s';
      else if (tier === 3) wobbleDur = '.17s';
      else if (tier === 4) wobbleDur = '.13s';
      else if (tier >= 5) wobbleDur = '.10s';
      img.style.setProperty('--gpet-typing-dur', wobbleDur);

      if (!inTypingMode && workStateMode !== 'typing') {
        inTypingMode = true;
        syncSprite();
        img.classList.remove('gpet-breathe');
        img.classList.add('gpet-typing-anim');
      }

      var sparkFreq = tier >= 4 ? 2 : (tier >= 3 ? 3 : 4);
      if (typingCombo % sparkFreq === 0 || typingCombo >= 50) {
        spawnTypingSpark();
      }

      if (typingCombo === 30 || typingCombo === 50 || typingCombo === 100 || typingCombo === 500 || typingCombo === 1000) {
        showComboMilestoneBubble(typingCombo);
      } else if (typingCombo === 5 || typingCombo === 12) {
        showTypingBubble();
      }

      if (typingDecayTimer) clearTimeout(typingDecayTimer);
      typingDecayTimer = setTimeout(exitTypingMode, 5000);
    }

    function exitTypingMode() {
      if (!inTypingMode) return;
      inTypingMode = false;
      typingCombo = 0;
      comboBadge.className = 'gpet-combo-badge';
      img.classList.remove('gpet-typing-anim');
      img.style.removeProperty('--gpet-typing-dur');
      syncSprite();
      img.classList.add('gpet-breathe');
    }

    document.addEventListener('keydown', function () {
      handleKeyPress();
    });

    // Start with mouse events ignored for transparent areas
    if (ipcRenderer) {
      setTimeout(function () {
        updateMousePassThrough(false);
      }, 80);
    }

    // IPC listener for real-time Quota & Agent Work State updates
    if (ipcRenderer) {
      var hasShownInitialGreeting = false;

      ipcRenderer.on('pet-antigravity-state', function (e, alive) {
        var prev = isAntigravityConnected;
        isAntigravityConnected = !!alive;
        if (isAntigravityConnected !== prev) {
          if (isAntigravityConnected) {
            showCustomSpeechBubble(petT('✦ 反重力已连接，今天的灵感从哪里开始？'), '#83d8ce');
            try { ipcRenderer.send('pet-request-quota'); } catch (_) {}
          } else if (hasShownInitialGreeting) {
            showCustomSpeechBubble(petT('✦ 反重力已退出，托特静静守候'), '#cbd5e1');
            setAgentWorking(false);
          }
          hasShownInitialGreeting = true;
          render();
        }
      });

      ipcRenderer.on('pet-key-press', function () {
        handleKeyPress();
      });
      ipcRenderer.on('pet-call-attention', function () {
        try {
          img.classList.remove('gpet-jelly');
          void img.offsetWidth;
          img.classList.add('gpet-jelly');
          playRelease();
          showCustomSpeechBubble(petT('✦ 我在这里，托特随时为你效劳'), '#83d8ce');
        } catch (_) {}
      });
      ipcRenderer.on('pet-trigger-motion', function (e, motion) {
        try {
          if (IMAGES[motion]) {
            if (life) life.stop(false);
            img.src = IMAGES[motion];
            img.dataset.curSrc = IMAGES[motion];
            updateHitTestProbe(IMAGES[motion]);
            if (motion === 'typing') {
              img.classList.add('gpet-typing-anim');
            } else {
              img.classList.remove('gpet-typing-anim');
            }
          }
        } catch (_) {}
      });
      ipcRenderer.on('pet-quota-update', function (e, data) {
        updateQuotaState(data);
      });
      ipcRenderer.on('pet-agent-work-state', function (e, isWorking) {
        setAgentWorking(isWorking);
      });
      ipcRenderer.on('pet-chat-generating', function (e, active) {
        setAgentWorking(!!active);
      });
      ipcRenderer.on('pet-turn-cost', function (e, data) {
        if (data && (data.amount !== undefined || data.isLive)) {
          showCostBubble(data.amount, data.unit || 'tokens', !!data.isLive);
        }
      });
      ipcRenderer.on('pet-apply-scale', function (e, s) {
        if (s !== undefined && Math.abs(Number(s) - state.scale) > 0.05) {
          setScale(s, true);
        }
      });
      ipcRenderer.on('pet-apply-volume', function (e, vol) {
        if (vol !== undefined) {
          setVol(vol, true);
        }
      });
      ipcRenderer.on('pet-apply-config', function (e, c) {
        if (!c) return;
        if (life) life.apply(c);
        if (presence) presence.apply(c);
        if (c.scale !== undefined && Math.abs(Number(c.scale) - state.scale) > 0.05) {
          setScale(c.scale, true);
        }
        if (c.soundVol !== undefined) setVol(c.soundVol, true);
        if (c.soundSet) setSoundSet(c.soundSet);
        if (c.quotaView) setQuotaView(c.quotaView);
        if (c.bubbleOn !== undefined) setBubbleOn(c.bubbleOn);
        if (c.typingOn !== undefined) setTypingOn(c.typingOn);
        if (c.turnCostOn !== undefined) setTurnCostOn(c.turnCostOn);
        if (c.turnCostCloseMs !== undefined) setTurnCostClose(c.turnCostCloseMs / 1000);
        if (c.workStateMode) {
          workStateMode = c.workStateMode === 'working' ? 'chill' : c.workStateMode;
          if (workStateSelect) workStateSelect.value = workStateMode;
          syncSprite();
        }
        if (c.antigravitySyncMode) {
          antigravitySyncMode = c.antigravitySyncMode;
          if (antigravitySyncSelect) antigravitySyncSelect.value = antigravitySyncMode;
        }
      });
      ipcRenderer.on('pet-farewell-exit', function () {
        try {
          showCustomSpeechBubble(petT('✦ 反重力已退出，托特与你暂别'), '#ef4444');
        } catch (_) {}
      });
      try {
        ipcRenderer.send('pet-request-antigravity-state');
        ipcRenderer.send('pet-request-quota');
        ipcRenderer.send('pet-request-agent-work-state');
      } catch (_) {}
      setInterval(function () {
        try {
          ipcRenderer.send('pet-request-antigravity-state');
          if (isAntigravityConnected) {
            ipcRenderer.send('pet-request-quota');
            ipcRenderer.send('pet-request-agent-work-state');
          }
        } catch (_) {}
      }, 30000);
    }

    // Initialize
    applySoundSet();
    setupHitTest();
    if (window.ThothPresence) presence = window.ThothPresence.create({
      img:img, ipc:ipcRenderer,
      busy:function () { return !!drag || pressing || inHappyReaction || !!gravityAnimId; },
      onSourceChange:updateHitTestProbe
    });
    if (window.ThothLife) life = window.ThothLife.create({
      img: img, ipc: ipcRenderer,
      images: { idle: IMAGES.idle, wave: IMAGES.happy, think: IMAGES.chill },
      busy: function () { return !!drag || inHappyReaction || inTypingMode || pressing || menuOpen || bubbleShown || costBubbleActive || workStateMode !== 'auto' && workStateMode !== 'idle'; },
      bubblesOn: function () { return bubbleOn; },
      onFrontReady:function () { syncSprite(); },
      setSprite: function (src, frame) { img.dataset.blinkFrame = frame === undefined ? '' : frame; img.src = src; img.dataset.curSrc = src; updateHitTestProbe(src); },
      clearStory: function () { if (selectedStoryHook) hideBubble(); },
      showStory: function (story) {
        if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null; }
        if (bubbleTimer) clearTimeout(bubbleTimer);
        applyBubbleLines([{s:'A', t:story.hook, c:'#a5e7dc', w:true}, {s:'H', t:petT('点击听完整故事 ✦'), c:'#dfc784', w:true}]);
        selectedStoryHook = story;
        bubbleBox.setAttribute('role', 'button'); bubbleBox.setAttribute('tabindex', '0');
        bubbleBox.setAttribute('aria-label', story.hook + ' ' + petT('点击听完整故事 ✦'));
        bubbleShown = true; bubbleRandomActive = true; pressCount = 2;
        bubbleBox.classList.add('gpet-bubble-open');
        textBox.style.opacity = '1';
        bubbleTimer = setTimeout(hideBubble, 18000);
      }
    });
    loadConfig();
    settle();
    updateBaseUnits();
    render();

    // Expose API on window for external triggers
    window.closePet = closePetEntirely;
    window.GeminiPetInstance = {
      showStory: function (id) { return life && life.story(id, true); },
      triggerRandomMotion: function (kind) { if (life) life.motion(true, kind); },
      close: closePetEntirely,
      showTurnCost: showCostBubble,
      showBubble: showBubble,
      hideBubble: hideBubble,
      toggleMenu: toggleMenu,
      updateQuota: updateQuotaState,
      setAgentWorking: setAgentWorking,
      setWorkStateMode: setWorkStateMode,
      setAntigravitySyncMode: setAntigravitySyncMode,
      setScale: setScale,
      refreshQuota: function (manual) {
        if (ipcRenderer) {
          ipcRenderer.send('pet-request-quota');
          ipcRenderer.send('pet-request-agent-work-state');
        }
        if (manual) {
          showBubble();
        }
      }
    };
    updateMousePassThrough(false);
    console.log('✦ 托特 (尺寸调节 & 纯净Gemini配额版) 已就绪！');
  } // end of initWidget

  initWidget();
})();
