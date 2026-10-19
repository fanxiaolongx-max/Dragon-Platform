// 数通协议专家 · 3D 拆解舞台
// 统一提供：程序化建模、爆炸拆解、剖面视图、射线点选 + 引线标注、相机补间、可拖拽的时间轴联动。
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';

export { THREE };

export const PALETTE = {
    area0: 0x3b82f6, area1: 0x14b8a6, area2: 0xf59e0b, external: 0xef4444,
    lsa1: 0x60a5fa, lsa2: 0xa78bfa, lsa3: 0x34d399, lsa4: 0xfbbf24, lsa5: 0xf87171, lsa7: 0xfb923c, opaque: 0x22d3ee,
    ok: 0x22c55e, bad: 0xef4444, warn: 0xf59e0b, info: 0x38bdf8, muted: 0x64748b, metal: 0x1e293b, white: 0xe2e8f0
};

const hex = value => `#${new THREE.Color(value).getHexString()}`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// 把全局进度 t 映射到某一区间内的局部进度 [0,1]
export const span = (t, start, end) => clamp((t - start) / Math.max(1e-6, end - start), 0, 1);

let glowTexture = null;
function getGlowTexture() {
    if (glowTexture) return glowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.65)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 128, 128);
    glowTexture = new THREE.CanvasTexture(canvas);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    return glowTexture;
}

// 文本精灵：用 Canvas 绘制，自动适配多行与高分屏
export function makeLabel(text, { color = '#e2e8f0', bg = 'rgba(15,23,42,0.78)', border = null, size = 0.42, bold = false, padding = 18, align = 'center', mono = false } = {}) {
    const lines = String(text).split('\n');
    const fontSize = 52;
    const family = mono ? '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace' : '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';
    const font = `${bold ? 700 : 500} ${fontSize}px ${family}`;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = font;
    const width = Math.ceil(Math.max(...lines.map(line => measure.measureText(line).width)) + padding * 2);
    const lineHeight = fontSize * 1.25;
    const height = Math.ceil(lines.length * lineHeight + padding * 1.4);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (bg) {
        g.fillStyle = bg;
        const r = Math.min(22, height / 2);
        g.beginPath();
        g.moveTo(r, 0); g.lineTo(width - r, 0); g.quadraticCurveTo(width, 0, width, r);
        g.lineTo(width, height - r); g.quadraticCurveTo(width, height, width - r, height);
        g.lineTo(r, height); g.quadraticCurveTo(0, height, 0, height - r);
        g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0);
        g.fill();
        if (border) {
            g.strokeStyle = border;
            g.lineWidth = 4;
            g.stroke();
        }
    }
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = 'middle';
    g.textAlign = align;
    lines.forEach((line, index) => {
        const x = align === 'center' ? width / 2 : padding;
        g.fillText(line, x, padding * 0.7 + lineHeight * (index + 0.5));
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    const worldHeight = size * (lines.length * 1.25 + 0.7);
    sprite.scale.set(worldHeight * (width / height), worldHeight, 1);
    sprite.userData.isLabel = true;
    sprite.renderOrder = 10;
    return sprite;
}

function standard(color, { metal = 0.55, rough = 0.35, emissive = 0, opacity = 1, emissiveColor = null } = {}) {
    return new THREE.MeshStandardMaterial({
        color, metalness: metal, roughness: rough,
        emissive: emissiveColor === null ? color : emissiveColor, emissiveIntensity: emissive,
        transparent: opacity < 1, opacity, depthWrite: opacity >= 1
    });
}

// ---------------- 程序化模型 ----------------
export const models = {
    router({ color = PALETTE.info, label = '', sub = '', scale = 1 } = {}) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.62, 48), standard(0x1f2a3d, { metal: 0.8, rough: 0.28 }));
        group.add(body);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.93, 0.06, 48), standard(0x334155, { metal: 0.5, rough: 0.4 }));
        top.position.y = 0.33;
        group.add(top);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.045, 12, 64), standard(color, { emissive: 1.4 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.05;
        group.add(ring);
        // 经典路由器符号：四向箭头
        const arrowMat = standard(color, { emissive: 0.9, metal: 0.2 });
        for (let i = 0; i < 4; i += 1) {
            const arrow = new THREE.Group();
            const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.09), arrowMat);
            shaft.position.x = 0.36;
            const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 12), arrowMat);
            head.rotation.z = (i % 2 === 0) ? -Math.PI / 2 : Math.PI / 2;
            head.position.x = (i % 2 === 0) ? 0.66 : 0.12;
            arrow.add(shaft, head);
            arrow.rotation.y = i * Math.PI / 2;
            arrow.position.y = 0.38;
            group.add(arrow);
        }
        for (let i = 0; i < 6; i += 1) {
            const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), standard(i % 2 ? PALETTE.ok : color, { emissive: 2 }));
            const angle = -0.6 + i * 0.24;
            led.position.set(Math.sin(angle) * 1.0, -0.08, Math.cos(angle) * 1.0);
            led.lookAt(led.position.clone().multiplyScalar(2));
            group.add(led);
        }
        if (label) {
            const tag = makeLabel(sub ? `${label}\n${sub}` : label, { size: 0.3, border: hex(color) });
            tag.position.y = sub ? 1.35 : 1.1;
            group.add(tag);
        }
        group.scale.setScalar(scale);
        return group;
    },
    switchBox({ color = PALETTE.info, label = '' } = {}) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.3), standard(0x1e293b, { metal: 0.75, rough: 0.3 }));
        group.add(body);
        for (let i = 0; i < 8; i += 1) {
            const port = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.05), standard(0x0b1220, { metal: 0.2 }));
            port.position.set(-0.95 + i * 0.27, 0.02, 0.66);
            const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.03), standard(i % 3 ? PALETTE.ok : color, { emissive: 2.2 }));
            led.position.set(-0.95 + i * 0.27, 0.15, 0.67);
            group.add(port, led);
        }
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.04, 1.32), standard(color, { emissive: 1.2 }));
        stripe.position.y = 0.2;
        group.add(stripe);
        if (label) {
            const tag = makeLabel(label, { size: 0.28, border: hex(color) });
            tag.position.y = 0.95;
            group.add(tag);
        }
        return group;
    },
    server({ color = PALETTE.info, label = '' } = {}) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.9), standard(0x1e293b, { metal: 0.7, rough: 0.35 }));
        group.add(body);
        for (let i = 0; i < 5; i += 1) {
            const slot = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.04), standard(0x0f172a, { metal: 0.3 }));
            slot.position.set(0, -0.6 + i * 0.3, 0.46);
            const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), standard(i % 2 ? color : PALETTE.ok, { emissive: 2 }));
            led.position.set(0.28, -0.6 + i * 0.3, 0.48);
            group.add(slot, led);
        }
        if (label) {
            const tag = makeLabel(label, { size: 0.26, border: hex(color) });
            tag.position.y = 1.3;
            group.add(tag);
        }
        return group;
    },
    cloud({ color = PALETTE.external, label = '', scale = 1 } = {}) {
        const group = new THREE.Group();
        const material = standard(color, { emissive: 0.35, opacity: 0.32, metal: 0.1, rough: 0.8 });
        [[0, 0, 0, 1.1], [1.0, -0.15, 0.2, 0.8], [-1.0, -0.1, -0.1, 0.85], [0.4, 0.45, -0.2, 0.75], [-0.45, 0.4, 0.3, 0.7]].forEach(([x, y, z, r]) => {
            const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), material);
            ball.position.set(x, y, z);
            group.add(ball);
        });
        const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.25 }));
        group.add(wire);
        if (label) {
            const tag = makeLabel(label, { size: 0.28, border: hex(color) });
            tag.position.y = 1.55;
            group.add(tag);
        }
        group.scale.setScalar(scale);
        return group;
    },
    area({ radius = 4, color = PALETTE.area0, label = '', height = 0.12 } = {}) {
        const group = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 72), standard(color, { emissive: 0.18, opacity: 0.16, metal: 0.1, rough: 0.6 }));
        disc.position.y = -0.62;
        group.add(disc);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 10, 128), standard(color, { emissive: 1.6 }));
        rim.rotation.x = Math.PI / 2;
        rim.position.y = -0.56;
        group.add(rim);
        const grid = new THREE.PolarGridHelper(radius * 0.96, 12, 5, 72, color, color);
        grid.material.transparent = true;
        grid.material.opacity = 0.18;
        grid.position.y = -0.55;
        group.add(grid);
        if (label) {
            const tag = makeLabel(label, { size: 0.36, bold: true, color: hex(color), bg: 'rgba(2,6,23,0.6)' });
            tag.position.set(0, -0.2, radius - 0.2);
            group.add(tag);
        }
        return group;
    },
    // 报文字段砖块
    brick({ width = 1, height = 0.5, depth = 0.6, color = PALETTE.info, label = '', labelSize = 0.17, opacity = 0.92 } = {}) {
        const group = new THREE.Group();
        const geometry = new THREE.BoxGeometry(width, height, depth);
        const mesh = new THREE.Mesh(geometry, standard(color, { emissive: 0.25, opacity, metal: 0.25, rough: 0.45 }));
        group.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
        group.add(edges);
        if (label) {
            const tag = makeLabel(label, { size: labelSize, bg: null, color: '#f8fafc', bold: true });
            const maxWidth = width * 0.92;
            if (tag.scale.x > maxWidth) tag.scale.multiplyScalar(maxWidth / tag.scale.x);
            tag.position.set(0, 0, depth / 2 + 0.02);
            group.add(tag);
        }
        return group;
    },
    gate({ color = PALETTE.warn, label = '', width = 2.2, height = 2.2 } = {}) {
        const group = new THREE.Group();
        const frameMat = standard(color, { emissive: 1.1 });
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.14, height, 0.14), frameMat);
        left.position.set(-width / 2, height / 2 - 0.6, 0);
        const right = left.clone();
        right.position.x = width / 2;
        const top = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, 0.14, 0.14), frameMat);
        top.position.y = height - 0.6;
        const film = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
        film.position.y = height / 2 - 0.6;
        group.add(left, right, top, film);
        group.userData.film = film;
        if (label) {
            const tag = makeLabel(label, { size: 0.22, border: hex(color) });
            tag.position.y = height - 0.1;
            group.add(tag);
        }
        return group;
    },
    shield({ color = PALETTE.bad, radius = 0.9 } = {}) {
        const group = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.07, 12, 48), standard(color, { emissive: 2 }));
        const bar = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.6, 0.12, 0.08), standard(color, { emissive: 2 }));
        bar.rotation.z = Math.PI / 4;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
        group.add(ring, bar, disc);
        return group;
    },
    platform({ radius = 1.2, color = PALETTE.info, label = '' } = {}) {
        const group = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, 0.22, 6), standard(0x1e293b, { metal: 0.7, rough: 0.3 }));
        group.add(disc);
        const glow = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, 0.04, 8, 6), standard(color, { emissive: 1.4 }));
        glow.rotation.x = Math.PI / 2;
        glow.rotation.z = Math.PI / 6;
        glow.position.y = 0.12;
        group.add(glow);
        group.userData.glow = glow;
        if (label) {
            const tag = makeLabel(label, { size: 0.3, bold: true, border: hex(color) });
            tag.position.y = 0.62;
            group.add(tag);
        }
        return group;
    },
    // 数据库叠片（LSDB / RIB 指示器）
    stack({ color = PALETTE.ok, count = 3, label = '' } = {}) {
        const group = new THREE.Group();
        for (let i = 0; i < count; i += 1) {
            const sheet = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 24), standard(color, { emissive: 0.8, opacity: 0.85 }));
            sheet.position.y = i * 0.14;
            group.add(sheet);
        }
        if (label) {
            const tag = makeLabel(label, { size: 0.18, bg: 'rgba(2,6,23,0.7)' });
            tag.position.y = count * 0.14 + 0.25;
            group.add(tag);
        }
        return group;
    }
};

// 数据包：发光核心 + 光晕 + 可选标签 + 拖尾
export function makePacket({ color = PALETTE.info, label = '', size = 0.22, trail = 6 } = {}) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), new THREE.MeshBasicMaterial({ color }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(size * 6);
    group.add(core, halo);
    if (label) {
        const tag = makeLabel(label, { size: 0.2, border: hex(color) });
        tag.position.y = size + 0.42;
        group.add(tag);
        group.userData.tag = tag;
    }
    group.userData.trail = [];
    for (let i = 0; i < trail; i += 1) {
        const ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color, transparent: true, opacity: 0.5 * (1 - i / trail), blending: THREE.AdditiveBlending, depthWrite: false }));
        ghost.scale.setScalar(size * (3.2 - i * 0.35));
        ghost.userData.noDim = true;
        group.userData.trail.push(ghost);
    }
    group.userData.noDim = true;
    group.traverse(child => { child.userData.noDim = true; });
    return group;
}

// 多跳路径：按节点当前位置生成每段弧线，u ∈ [0,1] 匀速分配到各段
export function pathPoint(points, u, arc = 0.6) {
    const segments = points.length - 1;
    if (segments < 1) return points[0].clone();
    const scaled = clamp(u, 0, 1) * segments;
    const index = Math.min(segments - 1, Math.floor(scaled));
    const local = scaled - index;
    const a = points[index];
    const b = points[index + 1];
    const mid = a.clone().lerp(b, 0.5);
    mid.y += arc * Math.min(1, a.distanceTo(b) / 6);
    const p = new THREE.Vector3();
    const inv = 1 - local;
    p.x = inv * inv * a.x + 2 * inv * local * mid.x + local * local * b.x;
    p.y = inv * inv * a.y + 2 * inv * local * mid.y + local * local * b.y;
    p.z = inv * inv * a.z + 2 * inv * local * mid.z + local * local * b.z;
    return p;
}

// ---------------- 舞台 ----------------
export function createStage(host, sceneDef, { compact = false, onSelect = null, initialOptions = null } = {}) {
    const root = document.createElement('div');
    root.className = `dk-stage${compact ? ' is-compact' : ''}`;
    root.tabIndex = 0;
    root.innerHTML = `
        <canvas class="dk-stage-canvas"></canvas>
        <div class="dk-hud dk-hud-title"><div class="dk-hud-kicker">3D 拆解 · 动态联动</div><h3></h3><p></p></div>
        <div class="dk-hud dk-hud-options"></div>
        <div class="dk-hud dk-hud-legend"></div>
        <div class="dk-hud dk-hud-extra" hidden></div>
        <aside class="dk-hud dk-hud-detail" hidden></aside>
        <div class="dk-hud dk-hud-narration"><span class="dk-step-index"></span><div><strong></strong><p></p></div></div>
        <div class="dk-label-layer"><div class="dk-leader-label" hidden></div><div class="dk-hover-tip" hidden></div></div>
        <div class="dk-hud dk-hud-bar">
            <div class="dk-seg" role="group" aria-label="视图模式">
                <button type="button" data-view="assembled" class="is-active" title="组装视图">组装</button>
                <button type="button" data-view="section" title="剖面透视">剖面</button>
                <button type="button" data-view="exploded" title="3D 爆炸拆解">爆炸</button>
            </div>
            <label class="dk-range dk-explode"><span>拆解</span><input type="range" min="0" max="100" value="0" aria-label="爆炸程度"><b>0%</b></label>
            <button type="button" class="dk-icon-btn" data-act="play" title="播放 / 暂停（空格）">❚❚</button>
            <button type="button" class="dk-icon-btn" data-act="speed" title="倍速">1×</button>
            <div class="dk-timeline"><input type="range" min="0" max="1000" value="0" aria-label="动态流转进度"><div class="dk-ticks"></div></div>
            <button type="button" class="dk-icon-btn" data-act="reset" title="重置视角">⟲</button>
            <button type="button" class="dk-icon-btn" data-act="fullscreen" title="全屏">⛶</button>
        </div>`;
    host.appendChild(root);

    const canvas = root.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050b18);
    scene.fog = new THREE.FogExp2(0x050b18, 0.012);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 120;
    controls.minDistance = 2;

    // 环境：灯光、地面网格、星空
    const environment = new THREE.Group();
    environment.add(new THREE.HemisphereLight(0x9cc9ff, 0x0b1020, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(8, 14, 10);
    environment.add(key);
    const rim = new THREE.DirectionalLight(0x60a5fa, 0.7);
    rim.position.set(-10, 6, -12);
    environment.add(rim);
    const floor = new THREE.GridHelper(120, 120, 0x1e3a8a, 0x0f1d3a);
    floor.material.transparent = true;
    floor.material.opacity = 0.35;
    floor.position.y = -1.6;
    environment.add(floor);
    const starGeometry = new THREE.BufferGeometry();
    const stars = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i += 1) {
        const r = 80 + Math.random() * 60;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        stars.set([r * Math.sin(phi) * Math.cos(theta), Math.abs(r * Math.cos(phi)) - 10, r * Math.sin(phi) * Math.sin(theta)], i * 3);
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    environment.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.35, transparent: true, opacity: 0.6 })));
    environment.traverse(child => { child.userData.noDim = true; child.userData.env = true; });
    scene.add(environment);

    const world = new THREE.Group();
    scene.add(world);

    const state = {
        t: 0, playing: true, speed: 1, explode: 0, explodeTarget: 0, view: 'assembled',
        options: {}, steps: [], parts: [], links: [], trajectories: [], selected: null, hovered: null,
        sceneApi: null, disposed: false, visible: true, cameraTween: null, defaultView: null
    };
    const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.0);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clock = new THREE.Clock();
    const ui = {
        title: root.querySelector('.dk-hud-title h3'),
        subtitle: root.querySelector('.dk-hud-title p'),
        options: root.querySelector('.dk-hud-options'),
        legend: root.querySelector('.dk-hud-legend'),
        extra: root.querySelector('.dk-hud-extra'),
        detail: root.querySelector('.dk-hud-detail'),
        narration: root.querySelector('.dk-hud-narration'),
        leader: root.querySelector('.dk-leader-label'),
        tip: root.querySelector('.dk-hover-tip'),
        explode: root.querySelector('.dk-explode input'),
        explodeValue: root.querySelector('.dk-explode b'),
        timeline: root.querySelector('.dk-timeline input'),
        ticks: root.querySelector('.dk-ticks'),
        play: root.querySelector('[data-act="play"]'),
        speed: root.querySelector('[data-act="speed"]')
    };

    // ---- 构建上下文 ----
    function makeContext() {
        return {
            THREE, PALETTE, models, makeLabel, makePacket, pathPoint, ease, span, world, camera, controls, state,
            add(object) { world.add(object); return object; },
            part(object, { id, name, desc = '', explode = [0, 0, 0], rows = null, focus = true } = {}) {
                const record = { id: id || `part-${state.parts.length}`, name, desc, rows, object, focus,
                    base: object.position.clone(), offset: new THREE.Vector3(...explode), anim: new THREE.Vector3() };
                object.userData.part = record;
                object.traverse(child => { child.userData.partRecord = record; });
                if (!object.parent) world.add(object);
                state.parts.push(record);
                if (record.offset.lengthSq() > 0.0001) {
                    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
                    const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0 }));
                    line.userData.noDim = true;
                    world.add(line);
                    state.trajectories.push({ record, line });
                }
                return record;
            },
            // 两个对象之间的连线（管道），端点随爆炸/动画实时更新
            link(a, b, { color = 0x64748b, radius = 0.05, arc = 0, opacity = 0.85, emissive = 0.6, dashed = false } = {}) {
                const material = dashed
                    ? new THREE.LineDashedMaterial({ color, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity })
                    : standard(color, { emissive, opacity, metal: 0.3, rough: 0.4 });
                const holder = dashed ? new THREE.Line(new THREE.BufferGeometry(), material) : new THREE.Mesh(new THREE.BufferGeometry(), material);
                const record = { a, b, radius, arc, holder, dashed, last: null, color };
                world.add(holder);
                state.links.push(record);
                updateLink(record, true);
                return record;
            },
            posOf(object) { return world.worldToLocal(object.getWorldPosition(new THREE.Vector3())); },
            // 数据包：set(u, fn) 依据路径函数放置本体与拖尾；hide() 隐藏
            packet(options = {}) {
                const packet = makePacket(options);
                world.add(packet);
                packet.userData.trail.forEach(ghost => world.add(ghost));
                packet.visible = false;
                packet.userData.trail.forEach(ghost => { ghost.visible = false; });
                return {
                    object: packet,
                    set(u, fn, visible = true) {
                        packet.visible = visible;
                        packet.position.copy(fn(u));
                        packet.userData.trail.forEach((ghost, index) => {
                            const back = u - (index + 1) * 0.012;
                            ghost.visible = visible && back > 0;
                            if (ghost.visible) ghost.position.copy(fn(back));
                        });
                    },
                    at(position, visible = true) {
                        packet.visible = visible;
                        packet.position.copy(position);
                        packet.userData.trail.forEach(ghost => { ghost.visible = false; });
                    },
                    hide() {
                        packet.visible = false;
                        packet.userData.trail.forEach(ghost => { ghost.visible = false; });
                    },
                    relabel(text) {
                        const old = packet.userData.tag;
                        if (old && old.userData.text === text) return;
                        if (old) { packet.remove(old); old.material.map.dispose(); old.material.dispose(); }
                        const tag = makeLabel(text, { size: 0.2, border: hex(options.color || PALETTE.info) });
                        tag.userData.text = text;
                        tag.userData.noDim = true;
                        tag.position.y = (options.size || 0.22) + 0.42;
                        packet.add(tag);
                        packet.userData.tag = tag;
                    }
                };
            },
            setSteps(steps) { state.steps = steps || []; renderTicks(); },
            setLegend(items) {
                ui.legend.innerHTML = (items || []).map(item => `<span><i style="background:${typeof item.color === 'number' ? hex(item.color) : item.color}"></i>${item.label}</span>`).join('');
                ui.legend.hidden = !items || !items.length;
            },
            extraPanel(html) {
                ui.extra.hidden = !html;
                ui.extra.innerHTML = html || '';
                return ui.extra;
            },
            camera3(position, target) {
                state.defaultView = { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) };
            }
        };
    }

    function updateLink(record, force = false) {
        const a = record.a.isVector3 ? record.a : record.a.getWorldPosition(new THREE.Vector3());
        const b = record.b.isVector3 ? record.b : record.b.getWorldPosition(new THREE.Vector3());
        world.worldToLocal(a);
        world.worldToLocal(b);
        const key = `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}|${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`;
        if (!force && key === record.last) return;
        record.last = key;
        const mid = a.clone().lerp(b, 0.5);
        mid.y += record.arc;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        record.curve = curve;
        record.holder.geometry.dispose();
        if (record.dashed) {
            record.holder.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(32));
            record.holder.computeLineDistances();
        } else {
            record.holder.geometry = new THREE.TubeGeometry(curve, 24, record.radius, 8, false);
        }
    }

    function clearWorld() {
        world.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
            materials.forEach(material => {
                if (material.map && material.map !== glowTexture) material.map.dispose();
                material.dispose();
            });
        });
        world.clear();
        state.parts = [];
        state.links = [];
        state.trajectories = [];
        state.steps = [];
        state.selected = null;
        state.hovered = null;
        ui.detail.hidden = true;
        ui.leader.hidden = true;
        ui.tip.hidden = true;
        ui.extra.hidden = true;
        ui.extra.innerHTML = '';
        if (leaderLine) leaderLine.visible = false;
    }

    // 依据场景包围球自动取景：保留场景指定的观察方向，距离刚好容纳整个模型
    function fitView(preferred) {
        const box = new THREE.Box3();
        const measure = () => {
            world.updateMatrixWorld(true);
            world.traverse(child => {
                if (!child.visible || child.userData.noDim || child.isLine || child.isLineSegments) return;
                if (child.isMesh) box.expandByObject(child);
            });
        };
        // 组装态与完全爆炸态都要装得下
        measure();
        state.parts.forEach(record => record.object.position.copy(record.base).add(record.offset));
        measure();
        state.parts.forEach(record => record.object.position.copy(record.base));
        world.updateMatrixWorld(true);
        if (box.isEmpty()) return preferred;
        const center = box.getCenter(new THREE.Vector3());
        const direction = preferred ? preferred.position.clone().sub(preferred.target) : new THREE.Vector3(1, 0.75, 1.2);
        if (direction.lengthSq() < 1e-6) direction.set(1, 0.75, 1.2);
        direction.normalize();
        // 投影包围盒 8 个角点，迭代调整距离直到模型占满视口约 80%（顶部/底部 HUD 预留空间）
        const probe = camera.clone();
        probe.aspect = Math.max(0.5, camera.aspect || 1.6);
        probe.updateProjectionMatrix();
        const corners = [];
        for (let i = 0; i < 8; i += 1) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
        let distance = box.getSize(new THREE.Vector3()).length();
        for (let i = 0; i < 6; i += 1) {
            probe.position.copy(center).addScaledVector(direction, distance);
            probe.lookAt(center);
            probe.updateMatrixWorld(true);
            let extentX = 0;
            let extentY = 0;
            corners.forEach(corner => {
                const p = corner.clone().project(probe);
                extentX = Math.max(extentX, Math.abs(p.x));
                extentY = Math.max(extentY, Math.abs(p.y));
            });
            const need = Math.max(extentX / 0.86, extentY / (compact ? 0.62 : 0.7));
            distance = Math.max(4, distance * (0.35 + 0.65 * need));
        }
        return { position: center.clone().addScaledVector(direction, distance), target: center };
    }

    function build({ refit = false } = {}) {
        clearWorld();
        const ctx = makeContext();
        state.defaultView = null;
        state.sceneApi = sceneDef.build(ctx, { ...state.options }) || {};
        state.defaultView = fitView(state.defaultView);
        applyDim();
        renderTicks();
        if (refit) flyTo(state.defaultView, 0.8);
    }

    // ---- 选项 ----
    function renderOptions() {
        const defs = sceneDef.options || [];
        defs.forEach(def => {
            if (!(def.id in state.options)) state.options[def.id] = initialOptions && def.id in initialOptions ? initialOptions[def.id] : def.value;
        });
        ui.options.innerHTML = defs.map(def => {
            if (def.type === 'range') {
                return `<label class="dk-opt dk-opt-range"><span>${def.label}</span><input type="range" data-opt="${def.id}" min="${def.min}" max="${def.max}" step="${def.step || 1}" value="${state.options[def.id]}"><b>${def.format ? def.format(state.options[def.id]) : state.options[def.id]}</b></label>`;
            }
            const buttons = def.choices.map(choice => `<button type="button" data-opt="${def.id}" data-value="${choice.value}" class="${String(state.options[def.id]) === String(choice.value) ? 'is-active' : ''}" title="${choice.title || choice.label}">${choice.label}</button>`).join('');
            return `<div class="dk-opt"><span>${def.label}</span><div class="dk-seg">${buttons}</div></div>`;
        }).join('');
        ui.options.hidden = !defs.length;
    }

    ui.options.addEventListener('click', event => {
        const button = event.target.closest('button[data-opt]');
        if (!button) return;
        const def = (sceneDef.options || []).find(item => item.id === button.dataset.opt);
        const raw = button.dataset.value;
        state.options[def.id] = typeof def.value === 'number' ? Number(raw) : raw;
        renderOptions();
        build({ refit: true });
    });
    ui.options.addEventListener('input', event => {
        const input = event.target.closest('input[data-opt]');
        if (!input) return;
        const def = (sceneDef.options || []).find(item => item.id === input.dataset.opt);
        state.options[def.id] = Number(input.value);
        input.nextElementSibling.textContent = def.format ? def.format(state.options[def.id]) : input.value;
        build();
    });

    // ---- 时间轴 ----
    function renderTicks() {
        ui.ticks.innerHTML = state.steps.map((step, index) => `<i style="left:${(step.at * 100).toFixed(2)}%" title="${index + 1}. ${step.title}"></i>`).join('');
    }

    function currentStep() {
        let found = -1;
        state.steps.forEach((step, index) => { if (state.t >= step.at) found = index; });
        return found;
    }

    let lastNarration = '';
    function updateNarration() {
        const index = currentStep();
        const step = state.steps[index];
        const key = step ? `${index}` : 'none';
        if (key === lastNarration) return;
        lastNarration = key;
        ui.narration.hidden = !step;
        if (!step) return;
        ui.narration.querySelector('.dk-step-index').textContent = `${index + 1}/${state.steps.length}`;
        ui.narration.querySelector('strong').textContent = step.title;
        ui.narration.querySelector('p').innerHTML = step.text || '';
    }

    let scrubbing = false;
    let wasPlaying = true;
    ui.timeline.addEventListener('pointerdown', () => { scrubbing = true; wasPlaying = state.playing; state.playing = false; syncPlay(); });
    ui.timeline.addEventListener('input', () => { state.t = Number(ui.timeline.value) / 1000; });
    const endScrub = () => { if (!scrubbing) return; scrubbing = false; state.playing = wasPlaying; syncPlay(); };
    ui.timeline.addEventListener('pointerup', endScrub);
    ui.timeline.addEventListener('change', endScrub);

    function syncPlay() { ui.play.textContent = state.playing ? '❚❚' : '▶'; }

    // ---- 视图模式 / 爆炸 ----
    function setView(view) {
        state.view = view;
        root.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === view));
        renderer.clippingPlanes = view === 'section' ? [sectionPlane] : [];
        if (view === 'exploded') state.explodeTarget = Math.max(state.explodeTarget, 1);
        if (view === 'assembled') state.explodeTarget = 0;
        ui.explode.value = Math.round(state.explodeTarget * 100);
        ui.explodeValue.textContent = `${ui.explode.value}%`;
    }

    root.querySelector('.dk-hud-bar').addEventListener('click', event => {
        const view = event.target.closest('[data-view]');
        if (view) return setView(view.dataset.view);
        const action = event.target.closest('[data-act]')?.dataset.act;
        if (action === 'play') { state.playing = !state.playing; syncPlay(); }
        if (action === 'speed') {
            const speeds = [0.5, 1, 2, 4];
            state.speed = speeds[(speeds.indexOf(state.speed) + 1) % speeds.length];
            ui.speed.textContent = `${state.speed}×`;
        }
        if (action === 'reset') { select(null); flyTo(state.defaultView); }
        if (action === 'fullscreen') {
            if (document.fullscreenElement) document.exitFullscreen();
            else root.requestFullscreen?.().catch(() => root.classList.toggle('is-pseudo-full'));
        }
    });
    ui.explode.addEventListener('input', () => {
        state.explodeTarget = Number(ui.explode.value) / 100;
        ui.explodeValue.textContent = `${ui.explode.value}%`;
        root.querySelectorAll('[data-view]').forEach(button => {
            const active = button.dataset.view === (state.view === 'section' ? 'section' : (state.explodeTarget > 0 ? 'exploded' : 'assembled'));
            button.classList.toggle('is-active', active);
        });
    });
    root.addEventListener('keydown', event => {
        if (event.code === 'Space' && event.target === root) { event.preventDefault(); state.playing = !state.playing; syncPlay(); }
        if (event.key === 'Escape') select(null);
    });

    // ---- 选择、高亮与引线 ----
    const leaderGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    const leaderLine = new THREE.Line(leaderGeometry, new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, depthTest: false }));
    leaderLine.renderOrder = 20;
    leaderLine.visible = false;
    leaderLine.userData.noDim = true;
    scene.add(leaderLine);

    function materialsOf(object) {
        const list = [];
        object.traverse(child => {
            if (!child.material || child.userData.env || child === leaderLine) return;
            (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => list.push({ child, material }));
        });
        return list;
    }

    function applyDim() {
        const selected = state.selected;
        materialsOf(world).forEach(({ child, material }) => {
            if (material.userData.baseOpacity === undefined) {
                material.userData.baseOpacity = material.opacity;
                material.userData.baseTransparent = material.transparent;
                material.userData.baseEmissive = material.emissiveIntensity;
            }
            const owner = child.userData.partRecord;
            const isSelected = selected && owner === selected;
            const dim = selected && !isSelected && !child.userData.noDim;
            material.transparent = dim ? true : material.userData.baseTransparent;
            material.opacity = dim ? material.userData.baseOpacity * 0.16 : material.userData.baseOpacity;
            if (material.emissiveIntensity !== undefined && material.userData.baseEmissive !== undefined) {
                material.emissiveIntensity = isSelected ? material.userData.baseEmissive + 0.6 : material.userData.baseEmissive;
            }
            material.needsUpdate = true;
        });
    }

    function boundsCenter(object) {
        const box = new THREE.Box3().setFromObject(object);
        return { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()).length() };
    }

    function flyTo(view, duration = 0.9) {
        if (!view) return;
        state.cameraTween = { from: camera.position.clone(), fromTarget: controls.target.clone(), to: view.position.clone(), toTarget: view.target.clone(), t: 0, duration };
    }

    function focusPart(record) {
        const { center, size } = boundsCenter(record.object);
        const direction = camera.position.clone().sub(controls.target).normalize();
        const distance = clamp(size * 2.4, 6, 40);
        flyTo({ position: center.clone().add(direction.multiplyScalar(distance)), target: center });
    }

    function select(record) {
        state.selected = record;
        applyDim();
        leaderLine.visible = Boolean(record);
        ui.leader.hidden = !record;
        if (!record) {
            ui.detail.hidden = true;
            onSelect && onSelect(null);
            return;
        }
        ui.leader.innerHTML = `<strong>${record.name}</strong><span>${record.desc}</span>`;
        const rows = record.rows ? `<table>${record.rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>` : '';
        ui.detail.innerHTML = `<button type="button" class="dk-detail-close" aria-label="关闭">×</button><div class="dk-hud-kicker">选中模块</div><h4>${record.name}</h4><p>${record.desc}</p>${rows}`;
        ui.detail.hidden = false;
        if (record.focus) focusPart(record);
        onSelect && onSelect(record);
    }
    ui.detail.addEventListener('click', event => { if (event.target.closest('.dk-detail-close')) select(null); });

    function pick(event) {
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(world.children, true).filter(hit => hit.object.visible && hit.object.userData.partRecord && !hit.object.userData.isLabel);
        if (state.view === 'section') {
            const visible = hits.filter(hit => sectionPlane.distanceToPoint(hit.point) >= -0.001);
            return visible[0]?.object.userData.partRecord || null;
        }
        return hits[0]?.object.userData.partRecord || null;
    }

    let downAt = null;
    canvas.addEventListener('pointerdown', event => { downAt = { x: event.clientX, y: event.clientY }; root.focus({ preventScroll: true }); });
    canvas.addEventListener('pointerup', event => {
        if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return;
        const record = pick(event);
        select(record && record === state.selected ? null : record);
    });
    canvas.addEventListener('pointermove', event => {
        if (event.buttons) return;
        const record = pick(event);
        state.hovered = record;
        canvas.style.cursor = record ? 'pointer' : 'grab';
        if (record && record !== state.selected) {
            const rect = root.getBoundingClientRect();
            ui.tip.hidden = false;
            ui.tip.textContent = record.name;
            ui.tip.style.transform = `translate(${event.clientX - rect.left + 14}px, ${event.clientY - rect.top + 12}px)`;
        } else {
            ui.tip.hidden = true;
        }
    });
    canvas.addEventListener('pointerleave', () => { ui.tip.hidden = true; });

    function updateLeader() {
        const record = state.selected;
        if (!record) return;
        const { center } = boundsCenter(record.object);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
        const scale = camera.position.distanceTo(center) * 0.12;
        const elbow = center.clone().add(up.clone().multiplyScalar(scale * 1.1)).add(right.clone().multiplyScalar(scale * 0.8));
        const end = elbow.clone().add(right.clone().multiplyScalar(scale * 0.9));
        const positions = leaderGeometry.attributes.position;
        positions.setXYZ(0, center.x, center.y, center.z);
        positions.setXYZ(1, elbow.x, elbow.y, elbow.z);
        positions.setXYZ(2, end.x, end.y, end.z);
        positions.needsUpdate = true;
        leaderGeometry.computeBoundingSphere();
        const projected = end.clone().project(camera);
        const rect = canvas.getBoundingClientRect();
        const x = (projected.x * 0.5 + 0.5) * rect.width;
        const y = (-projected.y * 0.5 + 0.5) * rect.height;
        const maxX = rect.width - 250 - (ui.detail.hidden || rect.width < 700 ? 0 : Math.min(320, rect.width * 0.4) + 20);
        ui.leader.style.transform = `translate(${Math.max(8, Math.min(x + 6, maxX))}px, ${Math.max(8, y - 24)}px)`;
        ui.leader.hidden = projected.z > 1;
    }

    // ---- 渲染循环 ----
    function resize() {
        const width = root.clientWidth;
        const height = root.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);
    const visibilityObserver = new IntersectionObserver(entries => { state.visible = entries.some(entry => entry.isIntersecting); });
    visibilityObserver.observe(root);

    let frame = 0;
    function tick() {
        if (state.disposed) return;
        frame = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        if (!state.visible || document.hidden) return;
        const duration = sceneDef.duration || 12;
        if (state.playing && !scrubbing) {
            state.t = (state.t + dt * state.speed / duration) % 1;
            ui.timeline.value = String(Math.round(state.t * 1000));
        }
        state.explode += (state.explodeTarget - state.explode) * Math.min(1, dt * 5);
        if (Math.abs(state.explodeTarget - state.explode) < 0.001) state.explode = state.explodeTarget;
        state.sceneApi?.update?.(state.t, dt, state);
        state.parts.forEach(record => {
            record.object.position.copy(record.base).addScaledVector(record.offset, ease(state.explode)).add(record.anim);
        });
        world.updateMatrixWorld(true);
        state.links.forEach(record => updateLink(record));
        state.trajectories.forEach(({ record, line }) => {
            const visible = state.explode > 0.02;
            line.material.opacity = visible ? 0.55 * state.explode : 0;
            if (!visible) return;
            const parent = record.object.parent || world;
            const from = world.worldToLocal(parent.localToWorld(record.base.clone().add(record.anim)));
            const to = world.worldToLocal(record.object.getWorldPosition(new THREE.Vector3()));
            const positions = line.geometry.attributes.position;
            positions.setXYZ(0, from.x, from.y, from.z);
            positions.setXYZ(1, to.x, to.y, to.z);
            positions.needsUpdate = true;
            line.geometry.computeBoundingSphere();
            line.computeLineDistances();
        });
        if (state.cameraTween) {
            const tween = state.cameraTween;
            tween.t = Math.min(1, tween.t + dt / tween.duration);
            const k = ease(tween.t);
            camera.position.lerpVectors(tween.from, tween.to, k);
            controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
            if (tween.t >= 1) state.cameraTween = null;
        }
        controls.update();
        updateLeader();
        updateNarration();
        renderer.render(scene, camera);
    }

    // ---- 启动 ----
    ui.title.textContent = sceneDef.title;
    ui.subtitle.textContent = sceneDef.subtitle || '';
    renderOptions();
    resize();
    build();
    const view = state.defaultView || { position: new THREE.Vector3(14, 11, 16), target: new THREE.Vector3(0, 0, 0) };
    state.defaultView = view;
    camera.position.copy(view.target).add(view.position.clone().sub(view.target).multiplyScalar(1.6));
    controls.target.copy(view.target);
    flyTo(view, 1.6);
    resize();
    syncPlay();
    tick();

    return {
        root,
        setOptions(options) { Object.assign(state.options, options); renderOptions(); build(); },
        select(id) { select(state.parts.find(record => record.id === id) || null); },
        dispose() {
            state.disposed = true;
            cancelAnimationFrame(frame);
            resizeObserver.disconnect();
            visibilityObserver.disconnect();
            controls.dispose();
            clearWorld();
            renderer.dispose();
            renderer.forceContextLoss?.();
            root.remove();
        }
    };
}
