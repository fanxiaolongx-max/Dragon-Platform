// Juniper 跨厂商知识的 3D 场景：策略引擎流水线、路由表与 VRF 交叉。
import { PALETTE, span, ease, pathPoint } from './engine3d.js';

const C = PALETTE;

// ---------------- Junos 策略引擎 vs Huawei route-policy ----------------
const POLICY = {
    junos: {
        gates: [
            { x: -8, title: 'P1 term 1', match: 'from protocol ospf', action: 'then community add RT-100', kind: 'modify', desc: '穿透修改动作：打上 RT 后不终止，隐式 next term。' },
            { x: -4, title: 'P1 term 2', match: 'from community RT-100', action: 'then accept', kind: 'accept', desc: '终止动作：命中即接受，跳出整个策略链。' },
            { x: 0, title: 'P1 term 3', match: 'route-filter 0/0 exact', action: 'then reject', kind: 'reject', desc: '终止动作：精确匹配缺省路由并拒绝。' },
            { x: 4, title: 'P2 term 1', match: 'from protocol static', action: 'then local-preference 200', kind: 'modify', desc: '策略链中的第二个策略：只修改属性，不做决断。' },
            { x: 8, title: 'BGP 默认策略', match: '所有显式策略无决断', action: 'BGP 路由 accept / 其他 reject', kind: 'default', desc: 'Junos 兜底：交给协议默认动作裁决（BGP Export 只发 BGP 学到的路由）。' }
        ],
        routes: [
            { name: '10.1.1.0/24 [OSPF]', hits: { 0: '+RT-100', 1: 'accept' }, result: 'accept', note: 'term1 打上 RT 后继续流转，term2 匹配 RT 接受。' },
            { name: '0.0.0.0/0 [Static]', hits: { 2: 'reject' }, result: 'reject', note: 'term3 精确匹配缺省路由并拒绝。' },
            { name: '172.16.0.0/16 [BGP]', hits: { 4: 'accept' }, result: 'accept', note: '无任何显式匹配，由 BGP 默认策略放行。' },
            { name: '192.168.9.0/24 [Static]', hits: { 3: 'lp 200', 4: 'reject' }, result: 'reject', note: '只被修改了属性，没有 accept，最终被默认策略拒绝。' }
        ]
    },
    huawei: {
        gates: [
            { x: -8, title: 'node 10 permit', match: 'if-match acl 2000', action: 'apply extcommunity rt 100:1', kind: 'accept', desc: 'Huawei：permit 节点命中即放行（apply 后结束），不会继续匹配后续节点。' },
            { x: -4, title: 'node 20 deny', match: 'if-match ip-prefix DEFAULT', action: 'deny', kind: 'reject', desc: 'deny 节点命中即拒绝。' },
            { x: 0, title: 'node 30 permit', match: 'if-match ip-prefix STATIC-9', action: 'apply local-preference 200', kind: 'accept', desc: 'route-policy 不能直接 if-match protocol，要靠 import-route 推送 + 前缀/ACL 匹配。' },
            { x: 4, title: '（无策略链）', match: '—', action: '—', kind: 'none', desc: 'VRP 在一个挂载点只调用一个 route-policy。' },
            { x: 8, title: '隐式 deny all', match: '所有节点都未命中', action: '直接丢弃', kind: 'reject', desc: '只要挂了 route-policy，末尾必定隐式拒绝。翻译 Junos 策略时要手工补 permit node 999！' }
        ],
        routes: [
            { name: '10.1.1.0/24 [OSPF]', hits: { 0: 'permit +RT' }, result: 'accept', note: 'node 10 命中即放行。' },
            { name: '0.0.0.0/0 [Static]', hits: { 1: 'deny' }, result: 'reject', note: 'node 20 拒绝缺省。' },
            { name: '172.16.0.0/16 [BGP]', hits: { 4: 'deny' }, result: 'reject', note: '⚠ 在 Junos 中会被默认策略放行，到了 VRP 却被隐式拒绝 —— 割接断网的元凶。' },
            { name: '192.168.9.0/24 [Static]', hits: { 2: 'permit lp200' }, result: 'accept', note: 'permit 节点在修改属性的同时放行。' }
        ]
    }
};

export const policyEngine = {
    id: 'policy-engine',
    title: '路由策略引擎 · Junos vs Huawei',
    subtitle: 'Junos：修改动作穿透、终止动作才停、最后交给协议默认策略；VRP：permit/deny 命中即止，末尾隐式拒绝。',
    duration: 20,
    options: [{ id: 'vendor', label: '厂商', value: 'junos', choices: [{ value: 'junos', label: 'Juniper Junos' }, { value: 'huawei', label: 'Huawei VRP' }] }],
    build(ctx, options) {
        const { models, THREE } = ctx;
        const policy = POLICY[options.vendor];
        const belt = new THREE.Mesh(new THREE.BoxGeometry(24, 0.18, 1.8), new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 }));
        belt.position.set(0, -0.75, 0);
        ctx.part(belt, { id: 'belt', name: '路由评估流水线', desc: '路由自左向右依次经过每个 Term / Node。', focus: false });
        const kindColor = { modify: C.info, accept: C.ok, reject: C.bad, default: C.warn, none: C.muted };
        const gates = policy.gates.map((gate, index) => {
            const frame = models.gate({ color: kindColor[gate.kind], label: gate.title, width: 2.4, height: 2.6 });
            frame.position.set(gate.x, 0, 0);
            const rule = ctx.makeLabel(`${gate.match}\n${gate.action}`, { size: 0.17, mono: true, bg: 'rgba(2,6,23,0.85)' });
            rule.position.set(0, -0.2, 1.3);
            frame.add(rule);
            ctx.part(frame, { id: `gate-${index}`, name: gate.title, desc: gate.desc, rows: [['匹配', `<code>${gate.match}</code>`], ['动作', `<code>${gate.action}</code>`]], explode: [0, 0, index % 2 ? 1.6 : -1.6] });
            return frame;
        });
        if (options.vendor === 'junos') {
            const box = (from, to, label, color) => {
                const frame = new THREE.Mesh(new THREE.BoxGeometry(to - from + 2.8, 3.4, 2.6), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.18 }));
                frame.position.set((from + to) / 2, 0.9, 0);
                const tag = ctx.makeLabel(label, { size: 0.26, bold: true, color: `#${new THREE.Color(color).getHexString()}`, bg: null });
                tag.position.set(0, 2.1, 0);
                frame.add(tag);
                ctx.part(frame, { id: label, name: label, desc: label.startsWith('policy-statement P1') ? 'Policy Chain 中的第一个策略。' : '策略链的第二个策略。', explode: [0, 1.5, 0], focus: false });
            };
            box(-8, 0, 'policy-statement P1', C.lsa2);
            box(4, 4, 'policy-statement P2', C.lsa2);
        }
        const accept = models.platform({ radius: 1.2, color: C.ok, label: '✓ 发布' });
        accept.position.set(12.5, -0.4, -2.2);
        ctx.part(accept, { id: 'accept', name: '接受 / 发布', desc: '被 accept / permit 的路由。', explode: [2, 0, -1] });
        const reject = models.platform({ radius: 1.2, color: C.bad, label: '✗ 丢弃' });
        reject.position.set(12.5, -0.4, 2.2);
        ctx.part(reject, { id: 'reject', name: '拒绝 / 丢弃', desc: '被 reject / deny 的路由。', explode: [2, 0, 1] });
        const slot = 1 / policy.routes.length;
        const capsules = policy.routes.map((route, index) => ({ route, index, packet: ctx.packet({ color: [C.lsa1, C.lsa4, C.lsa2, C.lsa7][index], label: route.name, size: 0.28 }) }));
        ctx.setSteps(policy.routes.map((route, index) => ({ at: index * slot, title: route.name, text: route.note })));
        ctx.setLegend([{ color: C.info, label: '修改（穿透）' }, { color: C.ok, label: 'accept / permit' }, { color: C.bad, label: 'reject / deny' }, { color: C.warn, label: '协议默认' }]);
        ctx.camera3([2, 8, 15], [1, 0.5, 0]);
        return {
            update(t) {
                capsules.forEach(({ route, index, packet }) => {
                    const start = index * slot;
                    const local = span(t, start + 0.01, start + slot - 0.01);
                    const visible = t >= start && t < start + slot;
                    const decisive = Math.max(...Object.keys(route.hits).map(Number));
                    const stops = gates.slice(0, decisive + 1).map(gate => ctx.posOf(gate).add(new THREE.Vector3(0, 0.5, 0)));
                    const points = [new THREE.Vector3(-12, 0.5, 0), ...stops];
                    const end = route.result === 'accept' ? ctx.posOf(accept).add(new THREE.Vector3(0, 0.6, 0)) : ctx.posOf(reject).add(new THREE.Vector3(0, 0.6, 0));
                    points.push(end);
                    packet.set(local, v => pathPoint(points, v, 0.35), visible);
                    const passed = Math.floor(local * (points.length - 1));
                    const tags = Object.entries(route.hits).filter(([gate]) => Number(gate) < passed).map(([, tag]) => tag);
                    packet.relabel(tags.length ? `${route.name}\n${tags.join(' · ')}` : route.name);
                    gates.forEach((gate, gateIndex) => {
                        const film = gate.userData.film;
                        if (!film || !visible) return;
                        const hit = route.hits[gateIndex] !== undefined && passed === gateIndex + 1 && local < 0.98;
                        film.material.opacity = hit ? 0.45 : 0.08;
                    });
                });
            }
        };
    }
};

// ---------------- Junos 路由表与 VRF 路由交叉 ----------------
const TABLES = [
    { id: 'vrfa', name: 'VRF-A.inet.0', pos: [-8, 2.6, 0], color: C.area1, desc: 'VRF-A 的 IPv4 单播表：CE 学到的路由与本地直连/静态都在这里。' },
    { id: 'l3vpn', name: 'bgp.l3vpn.0', pos: [0, 5.4, -1], color: C.lsa2, desc: 'VPNv4 中转站：存放带 RD 的路由，尚未进入任何 VRF。' },
    { id: 'vrfb', name: 'VRF-B.inet.0', pos: [8, 2.6, 0], color: C.area2, desc: 'VRF-B 的 IPv4 单播表。' },
    { id: 'inet0', name: 'inet.0', pos: [-6, -0.6, 3.2], color: C.area0, desc: 'IPv4 单播主表，默认转发查找的表。' },
    { id: 'inet3', name: 'inet.3', pos: [0, -0.6, 3.2], color: C.opaque, desc: 'LSP 入口表：BGP 用它解析 VPN 路由的下一跳，可达才生效。' },
    { id: 'mpls0', name: 'mpls.0', pos: [6, -0.6, 3.2], color: C.lsa4, desc: '标签交换表：P 路由器据此 Swap / Pop。' }
];

export const ribVrf = {
    id: 'rib-vrf',
    title: 'Junos 路由表与 VRF 路由交叉',
    subtitle: '三条交叉路径：MP-BGP（经 bgp.l3vpn.0，协议变 BGP）、instance-import（表对表）、rib-groups（学习时多路写入）。',
    duration: 14,
    options: [{ id: 'mode', label: '机制', value: 'mpbgp', choices: [
        { value: 'mpbgp', label: 'vrf-export/import' },
        { value: 'instance', label: 'instance-import' },
        { value: 'ribgroup', label: 'rib-groups' },
        { value: 'priority', label: 'RT 优先级屏蔽' }
    ] }],
    build(ctx, options) {
        const { THREE } = ctx;
        const tables = {};
        TABLES.forEach(table => {
            const group = new THREE.Group();
            const slab = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.22, 2.6), new THREE.MeshStandardMaterial({ color: table.color, emissive: table.color, emissiveIntensity: 0.25, transparent: true, opacity: 0.32, metalness: 0.1, roughness: 0.2 }));
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: table.color }));
            group.add(slab, edges);
            for (let i = 0; i < 3; i += 1) {
                const row = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.06, 0.32), new THREE.MeshStandardMaterial({ color: table.color, emissive: table.color, emissiveIntensity: 0.6 }));
                row.position.set(0, 0.14, -0.8 + i * 0.8);
                group.add(row);
            }
            const tag = ctx.makeLabel(table.name, { size: 0.3, bold: true, border: `#${new THREE.Color(table.color).getHexString()}`, mono: true });
            tag.position.set(0, 0.75, -1.2);
            group.add(tag);
            group.position.set(...table.pos);
            ctx.part(group, { id: table.id, name: table.name, desc: table.desc, explode: [table.pos[0] * 0.2, table.pos[1] > 2 ? 1.5 : -1, table.pos[2] * 0.4] });
            tables[table.id] = group;
        });
        const gateAt = (label, position, color, desc) => {
            const gate = ctx.models.gate({ color, label, width: 1.8, height: 1.8 });
            gate.position.set(...position);
            gate.rotation.y = Math.PI / 2 * (position[0] < 0 ? 1 : -1) * 0.5;
            ctx.part(gate, { id: label, name: label, desc, explode: [0, 1, 0] });
            return gate;
        };
        const flights = [];
        const fly = (points, start, end, color, labels, visibleWhen = () => true) => {
            flights.push({ points, start, end, labels, visibleWhen, packet: ctx.packet({ color, label: labels[0], size: 0.24 }) });
        };
        const at = (id, dy = 0.5) => () => ctx.posOf(tables[id]).add(new THREE.Vector3(0, dy, 0));
        let steps;
        if (options.mode === 'mpbgp') {
            const exportGate = gateAt('vrf-export', [-4.2, 3.8, -0.5], C.ok, '加 RD 与 RT（community add），写入 bgp.l3vpn.0；路由被转换成 VPNv4。');
            const importGate = gateAt('vrf-import', [4.2, 3.8, -0.5], C.warn, '只能匹配 community (RT)：命中则交叉进本 VRF，默认拒绝。');
            fly([at('vrfa'), () => ctx.posOf(exportGate).add(new THREE.Vector3(0, 0.6, 0)), at('l3vpn'), () => ctx.posOf(importGate).add(new THREE.Vector3(0, 0.6, 0)), at('vrfb')], 0.05, 0.62, C.ok,
                ['10.1.1.0/24 [Static/5]', '+RD 65000:100 +RT 100:1', '65000:100:10.1.1.0/24 [BGP]', 'RT 100:1 匹配 ✓', '10.1.1.0/24 [BGP/170]']);
            fly([at('vrfa', 0.9), () => ctx.posOf(exportGate).add(new THREE.Vector3(0, 0.9, 0)), at('l3vpn', 0.9), () => ctx.posOf(importGate).add(new THREE.Vector3(0, 1.4, 0))], 0.3, 0.8, C.bad,
                ['10.2.2.0/24 [Direct]', '+RT 200:1', '65000:100:10.2.2.0/24', 'RT 200:1 不匹配 ✗']);
            steps = [
                { at: 0, title: 'vrf-export', text: 'VRF-A 中的静态路由经 vrf-export 加上 RD/RT，变成 VPNv4 写入 bgp.l3vpn.0。' },
                { at: 0.25, title: 'bgp.l3vpn.0 中转', text: '此刻它是一条带 RD 的 BGP 路由，原始的 Static 属性已不可见。' },
                { at: 0.42, title: 'vrf-import 按 RT 放行', text: 'vrf-import 只能写 from community；RT 100:1 命中，交叉进入 VRF-B，协议身份变成 BGP。' },
                { at: 0.7, title: 'RT 不匹配即丢弃', text: 'RT 200:1 的路由被 vrf-import 默认拒绝，留在 bgp.l3vpn.0 不进入 VRF-B。' }
            ];
        } else if (options.mode === 'instance') {
            gateAt('instance-import', [0, 1.6, 1.6], C.info, 'policy: from instance VRF-A + from protocol static → accept；在 VRF-B 的 routing-options 下调用。');
            fly([at('vrfa'), () => new THREE.Vector3(0, 2.2, 1.6), at('vrfb')], 0.08, 0.6, C.info, ['10.1.1.0/24 [Static/5]', '表对表直接拷贝', '10.1.1.0/24 [Static/5] ✓ 属性保留']);
            steps = [
                { at: 0, title: 'instance-import', text: 'VRF-B 直接从 VRF-A 的路由表拉取，不经过 BGP，也不需要 RD/RT。' },
                { at: 0.4, title: '属性完整保留', text: '协议类型、Metric 原样保留，可用 from protocol static 精细过滤。适合业务 VRF 访问公共服务 VRF。' }
            ];
        } else if (options.mode === 'ribgroup') {
            const source = ctx.makeLabel('static route 学习', { size: 0.3, border: '#38bdf8' });
            source.position.set(-12, 1.2, 1.5);
            ctx.part(source, { id: 'src', name: '协议学习点', desc: 'rib-group 挂在 static / ospf 等协议下，在学习时即复写。', focus: false });
            fly([() => ctx.posOf(source), at('vrfa')], 0.08, 0.45, C.info, ['10.9.9.0/24 [Static]', '写入 VRF-A.inet.0']);
            fly([() => ctx.posOf(source), at('inet0')], 0.08, 0.45, C.lsa1, ['10.9.9.0/24 [Static]', '同时写入 inet.0']);
            steps = [
                { at: 0, title: 'rib-groups', text: '在协议计算/学习路由的第一时间复制多份，直接写入多张 RIB（如 VRF-A.inet.0 与 inet.0）。' },
                { at: 0.5, title: '最灵活也最危险', text: '完全保留原始属性，可配 import-policy 过滤；但用不好容易形成环路。常用于 FBF 或全局表泄露到 VRF。' }
            ];
        } else {
            const layers = [
                ['① vrf-import 策略', C.ok, '最高优先级：一旦配置，下面两种全部失效；可叠加成策略链。'],
                ['② vrf-target import', C.muted, '单向拆分 RT：被策略屏蔽。新配置覆盖旧值。'],
                ['③ vrf-target (双向)', C.muted, '全局双向 RT：优先级最低，被屏蔽。']
            ].map(([label, color, desc], index) => {
                const shield = ctx.models.gate({ color, label, width: 2.4, height: 2.4 });
                shield.position.set(4.8 - index * 0.9, 2.2, 0.6 + index * 0.4);
                shield.rotation.y = Math.PI / 2;
                ctx.part(shield, { id: `rt-${index}`, name: label, desc, explode: [index * 1.2, index * 0.6, 0] });
                return shield;
            });
            fly([at('l3vpn'), () => ctx.posOf(layers[0]).add(new THREE.Vector3(0, 0.6, 0)), at('vrfb')], 0.08, 0.55, C.ok, ['VPNv4 RT 100:1', '策略裁决 ✓', '进入 VRF-B']);
            steps = [
                { at: 0, title: '同方向只有一种生效', text: '高级策略 > 单向拆分 > 全局双向。收发两个方向各自独立裁决。' },
                { at: 0.35, title: '屏蔽而非叠加', text: '配置了 vrf-import 策略后，vrf-target import 中的 RT 不再参与匹配；export 方向同理，RT 要在策略里 community add。' },
                { at: 0.7, title: 'Commit 校验', text: 'vrf-import 中每个 accept 的 Term 必须且只能匹配 RT，否则 commit 报错。' }
            ];
        }
        ctx.setSteps(steps);
        ctx.setLegend([{ color: C.area1, label: 'VRF 表' }, { color: C.lsa2, label: 'VPN 中转表' }, { color: C.area0, label: '全局表' }]);
        ctx.camera3([0, 9, 16], [0, 2, 0]);
        return {
            update(t) {
                flights.forEach(item => {
                    const points = item.points.map(fn => fn());
                    const local = span(t, item.start, item.end);
                    item.packet.set(local, v => pathPoint(points, v, 0.8), t >= item.start && t <= item.end + 0.04);
                    item.packet.relabel(item.labels[Math.min(item.labels.length - 1, Math.round(local * (item.labels.length - 1)))]);
                });
            }
        };
    }
};

export const junosScenes = [policyEngine, ribVrf];
