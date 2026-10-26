/* Lightweight runtime gaze deformation; original artwork and alpha remain unchanged. */
(function (host) {
  'use strict';
  var profiles = {
    idle: { side: true, eyes: [[.471,.170,.046,.034],[.620,.160,.028,.031]] },
    walk: { side: true, eyes: [[.502,.174,.048,.034],[.650,.165,.027,.030]] },
    think: { side: true, eyes: [[.435,.166,.048,.035],[.570,.124,.033,.027]] },
    wave: { side: false, eyes: [[.494,.156,.044,.032],[.669,.184,.025,.029]] },
    front: { side: false, eyes: [[.385,.285,.065,.034],[.681,.286,.065,.034]] }
  };
  var artworkProfiles = new Map();
  function registerProfile(src, profile) { artworkProfiles.set(src, profile); }
  function profileFor(src, frame) {
    if (artworkProfiles.has(src)) return artworkProfiles.get(src);
    var match = /\/(idle|walk|think|wave)\.png(?:\?|$)/.exec(src || '');
    if (match) return profiles[match[1]];
    if ((src || '').indexOf('data:image/png') === 0) {
      return { side: false, closed: frame === 2 || frame === 3, eyes: profiles.front.eyes };
    }
    return { side: false, closed: true, eyes: [] };
  }
  function facing(x, area, previous) {
    if (!area || !Number.isFinite(x) || !(area.width > 0)) return previous || 'right';
    var center = area.x + area.width / 2;
    var margin = Math.max(24, Math.min(64, area.width * .035));
    return x < center - margin ? 'right' : x > center + margin ? 'left' : previous || 'right';
  }
  function ease(current, target, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.min(100, Math.max(0, dt)) / 280));
  }
  function gazeTarget(cursor, eyeCenter, mirrored) {
    if (!cursor || !eyeCenter) return { x: 0, y: 0 };
    var x = cursor.x - eyeCenter.x, y = cursor.y - eyeCenter.y;
    if (Math.hypot(x,y) > 450) return { x: 0, y: 0 };
    return { x: Math.max(-.32, Math.min(.32, x / 1000)) * (mirrored ? -1 : 1), y: Math.max(-.16, Math.min(.16, y / 1400)) };
  }
  function create(ui) {
    var img = ui.img, environment = null, desiredFacing = 'right', profile = profileFor(img.getAttribute('src'));
    var enabled = true, active = false, mirrored = false, x = 0, y = 0, target = {x:0,y:0};
    var lastCursor = null, lookingUntil = 0, nextGlance = performance.now() + 10000, turnTimer = null, raf = null;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width','0'); svg.setAttribute('height','0'); svg.setAttribute('aria-hidden','true');
    svg.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
    // A valid initial feImage URI avoids an empty resource entry in Electron's dev checks.
    svg.innerHTML = '<defs><filter id="dragon-gaze-filter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feImage href="data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22/%3E" preserveAspectRatio="none" result="mask"/><feComponentTransfer in="mask" result="shift"><feFuncR type="linear" slope="0" intercept="0.5"/><feFuncG type="linear" slope="0" intercept="0.5"/></feComponentTransfer><feDisplacementMap in="SourceGraphic" in2="shift" scale="3.2" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
    document.body.appendChild(svg);
    var map = svg.querySelector('feImage'), funcX = svg.querySelector('feFuncR'), funcY = svg.querySelector('feFuncG');
    function setAxis(node, value) {
      var neutral = 128/255, slope = -value * .5 / (1 - neutral);
      node.setAttribute('slope',slope.toFixed(5)); node.setAttribute('intercept',(.5 - neutral*slope).toFixed(5));
    }
    function neutral() {
      x = y = 0; target = {x:0,y:0}; lookingUntil = 0;
      setAxis(funcX,0); setAxis(funcY,0); img.classList.remove('dragon-gaze-active'); active = false;
    }
    function makeMap() {
      var w = img.clientWidth, h = img.clientHeight, iw = img.naturalWidth, ih = img.naturalHeight;
      if (!w || !h || !iw || !ih) return;
      var ratio = Math.min(w / iw,h / ih), rw = iw*ratio, rh = ih*ratio;
      var ox = (w-rw)/2, oy = (h-rh)/2;
      var ellipses = profile.eyes.map(function (eye) {
        return '<ellipse cx="'+(ox+eye[0]*rw)+'" cy="'+(oy+eye[1]*rh)+'" rx="'+(eye[2]*rw)+'" ry="'+(eye[3]*rh)+'" fill="url(#dragon-eye-weight)"/>';
      }).join('');
      var content = '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><defs><radialGradient id="dragon-eye-weight"><stop offset="0" stop-color="white"/><stop offset=".45" stop-color="white"/><stop offset="1" stop-color="#808080"/></radialGradient></defs><rect width="'+w+'" height="'+h+'" fill="#808080"/>'+ellipses+'</svg>';
      map.setAttribute('href','data:image/svg+xml;charset=utf-8,'+encodeURIComponent(content));
    }
    function setMirror(value) {
      mirrored = !!value; img.dataset.mirrored = String(mirrored); img.style.scale = mirrored ? '-1 1' : '1 1';
      img.dataset.facing = profile.side ? (mirrored ? (profile.nativeFacing === 'left' ? 'right' : 'left') : profile.nativeFacing || 'right') : 'front';
    }
    function orient() {
      var rect = img.getBoundingClientRect();
      if (environment) desiredFacing = facing(environment.bounds.x + rect.left + rect.width/2, environment.workArea, desiredFacing);
      var next = profile.side && desiredFacing !== (profile.nativeFacing || 'right');
      if (next === mirrored) { img.dataset.facing = profile.side ? desiredFacing : 'front'; return; }
      if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
      // Keep direct-facing and blink frames unmirrored immediately. No scale interpolation.
      if (!profile.side || reducedMotion.matches || !active || ui.busy()) { setMirror(next); return; }
      img.classList.add('dragon-turning');
      turnTimer = setTimeout(function () {
        setMirror(profile.side && desiredFacing !== (profile.nativeFacing || 'right')); img.classList.remove('dragon-turning'); turnTimer = null;
      }, 85);
    }
    function refreshSource() {
      if (turnTimer) clearTimeout(turnTimer);
      turnTimer = null; img.classList.remove('dragon-turning');
      profile = profileFor(img.getAttribute('src'), Number(img.dataset.blinkFrame));
      neutral(); orient(); makeMap();
      ui.onSourceChange(img.getAttribute('src'));
    }
    var observer = new MutationObserver(refreshSource);
    observer.observe(img,{attributes:true,attributeFilter:['src']});
    img.addEventListener('load',function () { makeMap(); orient(); });
    window.addEventListener('resize',function () { makeMap(); orient(); });
    var sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(makeMap) : null;
    if (sizeObserver) sizeObserver.observe(img);
    function receiveEnvironment(data) {
      if (!data || !data.bounds || !data.workArea) return;
      environment = data; orient();
      if (!enabled || reducedMotion.matches || ui.busy() || document.hidden || profile.closed) return;
      var cursor = data.cursor;
      if (cursor && (!lastCursor || Math.hypot(cursor.x-lastCursor.x,cursor.y-lastCursor.y) > 3)) {
        var rect = img.getBoundingClientRect();
        target = gazeTarget(cursor,{x:data.bounds.x+rect.left+rect.width/2,y:data.bounds.y+rect.top+rect.height*.2},mirrored);
        lookingUntil = performance.now()+1100;
      }
      lastCursor = cursor;
    }
    if (ui.ipc) {
      ui.ipc.on('pet-environment',function (_event,data) { receiveEnvironment(data); });
      ui.ipc.send('pet-request-environment');
    }
    function apply(config) {
      if (config && typeof config.eyeGazeOn === 'boolean') enabled = config.eyeGazeOn;
      if (!enabled) neutral();
    }
    var last = performance.now();
    function tick(now) {
      var dt = now-last; last=now;
      if (!enabled || reducedMotion.matches || document.hidden || profile.closed || ui.busy() || environment && environment.visible === false) {
        if (active) neutral();
      } else {
        if (now >= nextGlance) {
          nextGlance = now+10000+Math.random()*9000;
          target={x:(Math.random()-.5)*.25,y:(Math.random()-.5)*.12}; lookingUntil=now+650;
        }
        if (now > lookingUntil) target={x:0,y:0};
        if (dt >= 25 || Math.abs(x-target.x)+Math.abs(y-target.y) > .003) {
          x=ease(x,target.x,dt); y=ease(y,target.y,dt);
          setAxis(funcX,x); setAxis(funcY,y);
          if (!active) { img.classList.add('dragon-gaze-active'); active=true; }
        }
      }
      raf=requestAnimationFrame(tick);
    }
    reducedMotion.addEventListener('change',function () { neutral(); orient(); });
    document.addEventListener('visibilitychange',function () { if (document.hidden) neutral(); });
    refreshSource(); raf=requestAnimationFrame(tick);
    window.addEventListener('pagehide',function () { cancelAnimationFrame(raf); observer.disconnect(); if(sizeObserver)sizeObserver.disconnect(); if(turnTimer)clearTimeout(turnTimer); });
    return { apply:apply, receiveEnvironment:receiveEnvironment, isMirrored:function () { return mirrored; }, enabled:function () { return enabled; } };
  }
  var api = { create:create, facing:facing, ease:ease, gazeTarget:gazeTarget, profileFor:profileFor, registerProfile:registerProfile };
  if (typeof module !== 'undefined' && module.exports && !host) module.exports = api;
  if (host) host.DragonPresence = api;
})(typeof window !== 'undefined' ? window : null);
