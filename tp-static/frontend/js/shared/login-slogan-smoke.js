/* Local, short-lived stardust reveal for the login inscription: fine gold and
 * blue-white sparks trace the text left to right over a faint, still nebula halo. */
(function () {
    'use strict';
    const wrap = document.getElementById('loginSloganWrap');
    const canvas = document.getElementById('loginSloganSmoke');
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const lines = [...wrap.querySelectorAll('p')];
    let raf = 0, debounce = 0, started = 0, last = 0;
    let width = 0, height = 0, contentWidth = 0, padding = 0, sparks = [], text = '';
    let visible = false, edgeMask = null, halo = null, sprites = null, rows = [], spawnCarry = [0, 0];
    const verticalPadding = 120;
    const revealSeconds = 2.0, settleAt = 3.0;
    const clamp = v => Math.max(0, Math.min(1, v));
    const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };

    // Soft round glow sprite, tinted gold or blue-white.
    function sprite(r, g, b) {
        const size = 32, image = document.createElement('canvas');
        image.width = image.height = size;
        const context = image.getContext('2d');
        const glow = context.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        glow.addColorStop(0, 'rgba(255,255,255,1)');
        glow.addColorStop(.18, 'rgba(' + r + ',' + g + ',' + b + ',.9)');
        glow.addColorStop(.45, 'rgba(' + r + ',' + g + ',' + b + ',.25)');
        glow.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
        context.fillStyle = glow; context.fillRect(0, 0, size, size);
        return image;
    }
    function finish() {
        cancelAnimationFrame(raf); raf=0; sparks=[];
        wrap.classList.remove('slogan-smoke-active');
        ctx.clearRect(0,0,canvas.width,canvas.height);
    }
    function makeEdgeMask() {
        const mask = document.createElement('canvas');
        mask.width = Math.ceil(width); mask.height = Math.ceil(height);
        const context = mask.getContext('2d');
        function gradient(length, feather, horizontal) {
            const ramp = context.createLinearGradient(0, 0, horizontal ? length : 0, horizontal ? 0 : length);
            const span = Math.min(feather, length / 2) / length;
            // Smooth alpha ramp: fully transparent at all four clipping boundaries.
            for (const step of [0, .25, .5, .75, 1]) {
                const alpha = smooth(step);
                ramp.addColorStop(step * span, 'rgba(255,255,255,' + alpha + ')');
            }
            for (const step of [1, .75, .5, .25, 0]) {
                const alpha = smooth(step);
                ramp.addColorStop(1 - step * span, 'rgba(255,255,255,' + alpha + ')');
            }
            return ramp;
        }
        context.fillStyle = gradient(width, 90, true);
        context.fillRect(0, 0, mask.width, mask.height);
        context.globalCompositeOperation = 'destination-in';
        context.fillStyle = gradient(height, 90, false);
        context.fillRect(0, 0, mask.width, mask.height);
        return mask;
    }
    // Still nebula halo behind the inscription; rendered once, only faded in.
    function makeHalo() {
        const image = document.createElement('canvas');
        image.width = Math.ceil(width); image.height = Math.ceil(height);
        const context = image.getContext('2d');
        const parent = wrap.getBoundingClientRect();
        const cx = width / 2, cy = verticalPadding + parent.height / 2;
        const rx = Math.min(contentWidth * .52, 420), ry = Math.max(parent.height * .95, 70);
        function ellipse(offsetX, offsetY, scale, stops) {
            context.save();
            context.translate(cx + offsetX, cy + offsetY); context.scale(1, ry / rx);
            const glow = context.createRadialGradient(0, 0, 0, 0, 0, rx * scale);
            stops.forEach(([at, color]) => glow.addColorStop(at, color));
            context.fillStyle = glow;
            context.fillRect(-rx * scale, -rx * scale, rx * scale * 2, rx * scale * 2);
            context.restore();
        }
        ellipse(0, 0, 1, [[0, 'rgba(99,102,241,.20)'], [.45, 'rgba(79,70,229,.09)'], [1, 'rgba(49,46,129,0)']]);
        ellipse(-rx * .28, -ry * .12, .55, [[0, 'rgba(147,197,253,.10)'], [1, 'rgba(147,197,253,0)']]);
        ellipse(rx * .3, ry * .1, .5, [[0, 'rgba(205,184,139,.09)'], [1, 'rgba(205,184,139,0)']]);
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(edgeMask, 0, 0, width, height);
        return image;
    }
    // Rendered text rows of each line (a line may wrap on narrow screens).
    function measureRows() {
        const parent = wrap.getBoundingClientRect();
        rows = lines.map(line => {
            const range = document.createRange(); range.selectNodeContents(line);
            const box = line.getBoundingClientRect();
            const found = [...range.getClientRects()].filter(r => r.width > 2).map(r => ({
                left: r.left - parent.left + padding, right: r.right - parent.left + padding,
                top: r.top - parent.top + verticalPadding, height: r.height
            }));
            return { left: box.left - parent.left + padding, width: box.width, rows: found };
        });
    }
    function size() {
        const rect = wrap.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,1.5);
        contentWidth=rect.width; padding=Math.max(0,Math.min(80,rect.left,window.innerWidth-rect.right));
        width=contentWidth+padding*2; height=rect.height+verticalPadding*2;
        canvas.style.left=-padding+'px'; canvas.style.width=width+'px';
        canvas.width=Math.ceil(width*dpr); canvas.height=Math.ceil(height*dpr);
        ctx.setTransform(dpr,0,0,dpr,0,0);
        edgeMask=makeEdgeMask(); halo=makeHalo(); measureRows();
    }
    function start() {
        finish();
        if (!visible || motion.matches || document.hidden || document.getElementById('loginPanel')?.classList.contains('login-success')) return;
        size(); if (!width) return;
        if (!sprites) sprites={ gold: sprite(232,200,130), blue: sprite(190,215,255) };
        wrap.classList.add('slogan-smoke-ready','slogan-smoke-active');
        started=performance.now(); last=0; spawnCarry=[0,0];
        wrap.style.setProperty('--slogan-reveal','-.15');
        wrap.style.setProperty('--slogan-reveal-secondary','-.15');
        raf=requestAnimationFrame(frame);
    }
    function emit(index, reveal, dt, t) {
        const line = rows[index];
        if (!line || !line.rows.length || reveal <= -.1 || reveal >= 1.1) return;
        // Same front position as the CSS text mask (between -12% and +8%).
        const front = line.left + line.width * (reveal - .02);
        const active = line.rows.filter(r => front >= r.left - 6 && front <= r.right + 6);
        if (!active.length) return;
        spawnCarry[index] += dt * (index ? 70 : 95);
        while (spawnCarry[index] >= 1) {
            spawnCarry[index]--;
            const row = active[Math.floor(Math.random() * active.length)];
            const gold = Math.random() < (index ? .35 : .55);
            sparks.push({ born:t, life:.7+Math.random()*1.1,
                x:front+(Math.random()-.65)*22, y:row.top+row.height*(.15+Math.random()*.7),
                vx:(Math.random()-.3)*10, vy:(Math.random()-.5)*8,
                size:(Math.random()<.12 ? 9 : 4)+Math.random()*4, twinkle:Math.random()*6.28,
                sprite:gold ? sprites.gold : sprites.blue });
        }
    }
    function frame(now) {
        if (document.hidden || motion.matches) { finish(); return; }
        if (last && now-last<16) { raf=requestAnimationFrame(frame); return; }
        const dt=last ? Math.min(.05,(now-last)/1000) : 0;
        last=now;
        const t=(now-started)/1000, progress=smooth((t-.2)/revealSeconds);
        const secondary=smooth((t-.45)/revealSeconds);
        const primaryReveal=-.15+progress*1.3, secondaryReveal=-.15+secondary*1.3;
        wrap.style.setProperty('--slogan-reveal',String(primaryReveal));
        wrap.style.setProperty('--slogan-reveal-secondary',String(secondaryReveal));
        wrap.style.setProperty('--slogan-clarity',String(progress));
        emit(0, primaryReveal, dt, t); emit(1, secondaryReveal, dt, t);

        ctx.clearRect(0,0,width,height);
        ctx.globalCompositeOperation='source-over';
        ctx.globalAlpha=smooth(t/2.4); ctx.drawImage(halo,0,0,width,height);
        ctx.globalCompositeOperation='lighter';
        sparks=sparks.filter(s=>t-s.born<s.life);
        sparks.forEach(s=>{
            const age=t-s.born, fraction=age/s.life;
            const flicker=.75+.25*Math.sin(age*14+s.twinkle);
            ctx.globalAlpha=Math.sin(Math.PI*Math.min(1,fraction*1.6+.05))*(1-fraction*.4)*flicker*.9;
            const r=s.size*(1-fraction*.35);
            ctx.drawImage(s.sprite,s.x+s.vx*age-r/2,s.y+s.vy*age-r/2,r,r);
        });
        ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
        if (t>settleAt && !sparks.length) {
            // Settle: keep the halo still, release the text mask, stop animating.
            cancelAnimationFrame(raf); raf=0;
            wrap.classList.remove('slogan-smoke-active');
            ctx.clearRect(0,0,width,height); ctx.drawImage(halo,0,0,width,height);
            return;
        }
        raf=requestAnimationFrame(frame);
    }
    function schedule() { clearTimeout(debounce); debounce=setTimeout(start,160); }
    const contentObserver=new MutationObserver(()=>{
        const next=lines.map(line=>line.textContent).join('\n');
        if (next!==text) { text=next; schedule(); }
    });
    contentObserver.observe(wrap,{subtree:true,childList:true,characterData:true});
    const panelObserver=new MutationObserver(()=>{
        if (document.getElementById('loginPanel')?.classList.contains('login-success')) finish();
    });
    const panel=document.getElementById('loginPanel');
    if(panel) panelObserver.observe(panel,{attributes:true,attributeFilter:['class']});
    const visibilityObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
        const wasVisible=visible;visible=entries[0].isIntersecting;
        if(visible&&!wasVisible)schedule();else if(!visible)finish();
    },{threshold:.15}):null;
    if(visibilityObserver)visibilityObserver.observe(wrap);else{visible=true;schedule();}
    window.addEventListener('resize',schedule);
    motion.addEventListener('change',()=>{if(motion.matches)finish();else schedule();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&raf)finish();});
    window.addEventListener('pagehide',()=>{finish();clearTimeout(debounce);contentObserver.disconnect();panelObserver.disconnect();visibilityObserver?.disconnect();});
})();
