// OSPF 复杂知识点的 3D 场景：每个场景的 update(t) 只依赖进度 t，拖动时间轴即可精确回放。
import { PALETTE, span, ease, pathPoint } from './engine3d.js';

const C = PALETTE;
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------- 通用：报文字段按 32 bit 一行排布成 3D 砖块 ----------------
export function buildBitLayers(ctx, layers, { bitsPerRow = 32, bitWidth = 0.19, rowHeight = 0.62, depth = 0.8, gap = 0.75, showTitles = true } = {}) {
    const rowWidth = bitsPerRow * bitWidth;
    const layerRecords = [];
    let y = 0;
    layers.forEach((layer, layerIndex) => {
        const records = [];
        let bit = 0;
        layer.fields.forEach((field, fieldIndex) => {
            let remaining = field.bits;
            let segment = 0;
            while (remaining > 0) {
                const row = Math.floor(bit / bitsPerRow);
                const col = bit % bitsPerRow;
                const take = Math.min(remaining, bitsPerRow - col);
                const width = take * bitWidth - 0.04;
                const x = -rowWidth / 2 + (col + take / 2) * bitWidth;
                const brick = ctx.models.brick({ width, height: rowHeight - 0.06, depth, color: field.color || layer.color, label: width >= 0.45 ? field.name : '', labelSize: take >= 8 || width >= 1.4 ? 0.17 : 0.12 });
                brick.position.set(x, y - row * rowHeight, 0);
                const record = ctx.part(brick, {
                    id: `${layer.id}-${fieldIndex}-${segment}`,
                    name: `${layer.name} · ${field.name}`,
                    desc: field.desc || '',
                    rows: [['长度', `${field.bits} bit${field.bits % 8 === 0 ? `（${field.bits / 8} 字节）` : ''}`], ...(field.value ? [['示例值', field.value]] : []), ['所在层', layer.name]],
                    explode: [x * 0.22, -layerIndex * 1.15, row * 0.35 + (layerIndex % 2 ? 0.4 : -0.4)]
                });
                records.push(record);
                bit += take;
                remaining -= take;
                segment += 1;
            }
        });
        const rows = Math.max(1, Math.ceil(bit / bitsPerRow));
        if (!showTitles) {
            layerRecords.push({ layer, records, top: y, rows });
            y -= rows * rowHeight + gap;
            return;
        }
        const tag = ctx.makeLabel(`${layer.name}\n${layer.bytes || Math.ceil(bit / 8)} 字节`, { size: 0.26, border: `#${new ctx.THREE.Color(layer.color).getHexString()}` });
        tag.position.set(-rowWidth / 2 - 1.7, y - (rows - 1) * rowHeight / 2, 0);
        const tagRecord = ctx.part(tag, { id: `${layer.id}-title`, name: layer.name, desc: layer.desc || '', explode: [-0.6, -layerIndex * 1.15, 0], focus: false });
        layerRecords.push({ layer, records: [...records, tagRecord], top: y, rows });
        y -= rows * rowHeight + gap;
    });
    return { layerRecords, height: -y, rowWidth };
}

const ETH = { id: 'eth', name: '以太网帧头', color: 0x475569, desc: '二层封装：组播 224.0.0.5 对应 MAC 01:00:5E:00:00:05。', fields: [
    { name: '目的 MAC', bits: 48, value: '01:00:5E:00:00:05', desc: '组播 IP 224.0.0.5 映射出的组播 MAC；单播报文填写对端接口 MAC。' },
    { name: '源 MAC', bits: 48, desc: '发送接口的 MAC 地址。' },
    { name: 'EtherType', bits: 16, value: '0x0800', desc: '0x0800 表示上层是 IPv4。' }
] };
const IP = { id: 'ip', name: 'IPv4 头部', color: 0x2563eb, desc: 'OSPF 直接承载在 IP 之上，协议号 89，不使用 TCP/UDP。', fields: [
    { name: 'Ver', bits: 4, value: '4', desc: 'IP 版本号 4。' },
    { name: 'IHL', bits: 4, value: '5', desc: '头部长度（4 字节为单位）。' },
    { name: 'DSCP/ECN', bits: 8, value: 'CS6 (0xC0)', desc: '协议报文通常标记网络控制优先级。' },
    { name: 'Total Length', bits: 16, desc: 'IP 报文总长度。' },
    { name: 'Identification', bits: 16, desc: '分片标识。' },
    { name: 'Flags', bits: 3, desc: '分片标志。' },
    { name: 'Fragment Offset', bits: 13, desc: '分片偏移。' },
    { name: 'TTL', bits: 8, value: '1', desc: '组播 OSPF 报文 TTL=1，只在本链路有效（虚链路为单播例外）。' },
    { name: 'Protocol', bits: 8, value: '89', desc: '89 = OSPF。' },
    { name: 'Header Checksum', bits: 16, desc: 'IP 头部校验和，每跳因 TTL 变化而增量修正。' },
    { name: 'Source IP', bits: 32, desc: '发送接口 IP 地址。' },
    { name: 'Destination IP', bits: 32, value: '224.0.0.5', desc: '224.0.0.5 AllSPFRouters；224.0.0.6 AllDRouters（仅 DR/BDR 监听）；NBMA/虚链路为单播。' }
] };
const FCS = { id: 'fcs', name: '以太网 FCS', color: 0x475569, desc: 'CRC-32 只保护单跳线路，路由器逐跳剥离重算。', fields: [
    { name: 'FCS (CRC-32)', bits: 32, desc: '链路层帧校验序列：能 100% 检出 ≤32 位突发错误，但路由器内部损坏后会被重新计算成“合法”。' }
] };

function ospfHeader(type, auth) {
    const authFields = {
        null: [{ name: 'Authentication = 0', bits: 64, value: '全 0', desc: 'AuType=0 时填充全 0，没有任何校验，报文可被伪造。' }],
        simple: [{ name: 'Password（明文）', bits: 64, value: 'Huawei@1', desc: '明文口令直接放在这 8 字节中，抓包肉眼可见，仅能防插错线。' }],
        crypto: [
            { name: '0', bits: 16, desc: '保留。' },
            { name: 'Key ID', bits: 8, value: '1', desc: '当前使用的密钥编号，配合 Keychain 实现平滑换密。' },
            { name: 'Auth Data Len', bits: 8, value: '32', desc: '追加在报文末尾的摘要长度（MD5 16 字节 / SHA256 32 字节）。' },
            { name: 'Crypto Seq Number', bits: 32, value: '单调递增', desc: '防重放：接收方丢弃序列号不大于已记录值的报文。' }
        ]
    }[auth];
    return { id: 'ospf', name: 'OSPF 公共头部', color: 0x7c3aed, bytes: 24, desc: '所有五种报文共享的 24 字节头部。', fields: [
        { name: 'Version', bits: 8, value: '2', desc: 'OSPFv2 固定为 2。' },
        { name: 'Type', bits: 8, value: String(type), desc: '1 Hello / 2 DD / 3 LSR / 4 LSU / 5 LSAck。' },
        { name: 'Packet Length', bits: 16, desc: '包含 24 字节头部在内的 OSPF 报文总长度。' },
        { name: 'Router ID', bits: 32, value: '1.1.1.1', desc: '发送方的 Router-ID（不是接口 IP）。' },
        { name: 'Area ID', bits: 32, value: '0.0.0.0', desc: '发包接口所属区域，两端必须一致。' },
        { name: 'Checksum', bits: 16, desc: 'RFC 1071 一的补码和，覆盖除 64 位认证字段外的整个报文。' },
        { name: 'AuType', bits: 16, value: { null: '0', simple: '1', crypto: '2' }[auth], desc: '0 空认证 / 1 明文 / 2 密码学认证（MD5、HMAC-SHA256）。' },
        ...authFields
    ] };
}

const LSA_HEADER = { id: 'lsah', name: 'LSA 头部 (20B)', color: 0x0d9488, bytes: 20, desc: 'DD 与 LSAck 的载荷就是一串 LSA 头部；三元组唯一标识一条 LSA。', fields: [
    { name: 'LS age', bits: 16, desc: '每秒 +1，到 MaxAge 3600s 时被清除；不参与 LS checksum 计算。' },
    { name: 'Options', bits: 8, desc: 'LSA 级能力标签：E 位标识 ASBR，7 类中 N/P 位作为 P-bit 控制 7 转 5。' },
    { name: 'LS type', bits: 8, value: '1', desc: '三元组之一：1/2/3/4/5/7，Opaque 为 9/10/11。' },
    { name: 'Link State ID', bits: 32, desc: '三元组之二：含义随类型变化（Router-ID、DR 接口 IP、网段等）。' },
    { name: 'Advertising Router', bits: 32, desc: '三元组之三：生成该 LSA 的 Router-ID。' },
    { name: 'LS sequence number', bits: 32, value: '0x80000001', desc: '有符号 32 位，越大越新，是新旧仲裁的第一依据。' },
    { name: 'LS checksum', bits: 16, desc: 'Fletcher-16，排除 LS age，保护长期驻留 LSDB 的数据。' },
    { name: 'length', bits: 16, desc: 'LSA 总长度（含 20 字节头部）。' }
] };

const PAYLOADS = {
    1: [{ id: 'hello', name: 'Hello 载荷', color: 0xdb2777, desc: '发现邻居、协商参数、维持心跳、DR/BDR 选举。', fields: [
        { name: 'Network Mask', bits: 32, desc: '广播/NBMA 必须一致，否则丢弃 Hello；P2P 与虚链路忽略。' },
        { name: 'HelloInterval', bits: 16, value: '10', desc: '两端必须一致；广播/P2P 10s，NBMA/P2MP 30s。' },
        { name: 'Options', bits: 8, desc: 'E/N 位必须一致：普通区 E=1，Stub E=0，NSSA E=0,N=1。' },
        { name: 'Rtr Pri', bits: 8, value: '1', desc: 'DR 优先级，0 表示放弃参选。' },
        { name: 'RouterDeadInterval', bits: 32, value: '40', desc: '缺省为 Hello×4，超时宣告邻居 Down。' },
        { name: 'Designated Router', bits: 32, desc: '本端认定的 DR 接口 IP，未选出时为 0.0.0.0。' },
        { name: 'Backup DR', bits: 32, desc: '本端认定的 BDR 接口 IP。' },
        { name: 'Neighbor #1', bits: 32, value: '2.2.2.2', desc: '近期收到 Hello 的邻居 Router-ID；看到自己的 RID 即进入 2-Way。' },
        { name: 'Neighbor #2', bits: 32, value: '3.3.3.3', desc: '邻居列表可以有多个。' }
    ] }],
    2: [{ id: 'dd', name: 'DD 载荷', color: 0xea580c, desc: '主从协商 + 交换 LSDB 摘要。', fields: [
        { name: 'Interface MTU', bits: 16, desc: '开启 MTU 检查且对端 MTU 更大时，邻居卡在 ExStart/Exchange。' },
        { name: 'Options', bits: 8, desc: '与 Hello 相同的能力集。' },
        { name: '00000', bits: 5, desc: '保留位。' },
        { name: 'I', bits: 1, desc: 'Init：ExStart 首包置 1。' },
        { name: 'M', bits: 1, desc: 'More：后续还有 DD 报文。' },
        { name: 'MS', bits: 1, desc: 'Master/Slave：Router-ID 大者为 Master。' },
        { name: 'DD Sequence Number', bits: 32, desc: 'Master 递增，Slave 复制作为隐式确认。' }
    ] }, LSA_HEADER],
    3: [{ id: 'lsr', name: 'LSR 载荷', color: 0x0891b2, desc: '只携带 12 字节三元组：请给我该 LSA 的最新实例。', fields: [
        { name: 'LS type', bits: 32, value: '1', desc: '被请求 LSA 的类型（占满 32 位）。' },
        { name: 'Link State ID', bits: 32, desc: '被请求 LSA 的 Link State ID。' },
        { name: 'Advertising Router', bits: 32, desc: '被请求 LSA 的通告者。' },
        { name: 'LS type #2', bits: 32, value: '3', desc: '一个 LSR 可以连续携带多个三元组。' },
        { name: 'Link State ID #2', bits: 32 },
        { name: 'Advertising Router #2', bits: 32 }
    ] }],
    4: [{ id: 'lsu', name: 'LSU 载荷', color: 0x16a34a, desc: '携带完整 LSA，用于应答 LSR 或主动泛洪。', fields: [
        { name: '# LSAs', bits: 32, value: '1', desc: '本报文包含的 LSA 条数。' }
    ] }, LSA_HEADER, { id: 'rlsa', name: 'Router-LSA 载荷', color: 0x65a30d, desc: '1 类 LSA：描述本路由器在该区域内的链路。', fields: [
        { name: '0', bits: 5, desc: '保留。' },
        { name: 'V', bits: 1, desc: '虚链路端点。' },
        { name: 'E', bits: 1, desc: '本路由器是 ASBR。' },
        { name: 'B', bits: 1, desc: '本路由器是 ABR。' },
        { name: '0', bits: 8, desc: '保留。' },
        { name: '# links', bits: 16, value: '2', desc: '链路描述块数量。' },
        { name: 'Link ID', bits: 32, desc: 'P2P 填邻居 RID；TransNet 填 DR 接口 IP；StubNet 填网段。' },
        { name: 'Link Data', bits: 32, desc: 'P2P/TransNet 填本端接口 IP；StubNet 填掩码。' },
        { name: 'Type', bits: 8, value: '2', desc: '1 P2P / 2 Transit / 3 Stub / 4 虚链路。' },
        { name: '# TOS', bits: 8, value: '0', desc: '现代设备固定为 0。' },
        { name: 'metric', bits: 16, value: '1', desc: '该链路的开销。' }
    ] }],
    5: [{ ...LSA_HEADER, id: 'ack', name: 'LSAck 载荷 = LSA 头部', desc: 'LSAck 只原样拷回 20 字节头部，对方据序列号与校验和确认送达。' }]
};

const TYPE_NAMES = { 1: 'Hello', 2: 'DD', 3: 'LSR', 4: 'LSU', 5: 'LSAck' };

export const packetExplode = {
    id: 'packet-explode',
    title: 'OSPF 报文封装 · 3D 爆炸图',
    subtitle: '以太网 → IP(89) → OSPF 24 字节头 → 五种载荷 → LSA：逐层封装、逐字段拆解。',
    duration: 16,
    options: [
        { id: 'type', label: '报文类型', value: 1, choices: [1, 2, 3, 4, 5].map(value => ({ value, label: TYPE_NAMES[value] })) },
        { id: 'auth', label: '认证', value: 'null', choices: [{ value: 'null', label: 'Null' }, { value: 'simple', label: '明文' }, { value: 'crypto', label: 'HMAC' }] }
    ],
    build(ctx, options) {
        const layers = [ETH, IP, ospfHeader(options.type, options.auth), ...PAYLOADS[options.type]];
        if (options.auth === 'crypto') layers.push({ id: 'digest', name: '报文尾部摘要', color: 0xb45309, desc: 'HMAC-SHA256 摘要追加在 OSPF 报文之后，密码本身从不出现在网络上。', fields: [{ name: 'Message Digest (HMAC-SHA256)', bits: 256, desc: '密钥 + 整个 OSPF 报文作为输入计算的 32 字节摘要。' }] });
        layers.push(FCS);
        const { layerRecords, height } = buildBitLayers(ctx, layers);
        ctx.camera3([11, 4 - height * 0.3, 15], [0, -height * 0.42, 0]);
        // 封装顺序：内层先生成，外层依次包裹
        const order = layerRecords.map((_, index) => index).reverse().filter(index => layers[index].id !== 'fcs');
        const ethIndex = 0;
        const fcsIndex = layers.length - 1;
        const appear = new Map();
        order.forEach((layerIndex, k) => appear.set(layerIndex, 0.04 + k * (0.5 / order.length)));
        appear.set(fcsIndex, appear.get(ethIndex));
        ctx.setSteps([
            { at: 0, title: '生成载荷', text: `${TYPE_NAMES[options.type]} 报文的载荷先在 OSPF 进程中生成。` },
            { at: appear.get(2) || 0.2, title: '加 OSPF 公共头部', text: '24 字节头部：版本、类型、Router ID、Area ID、校验和与认证字段。' },
            { at: appear.get(1) || 0.35, title: 'IP 封装（协议号 89）', text: '目的地址按网络类型和角色选择 224.0.0.5 / 224.0.0.6 / 单播，TTL=1。' },
            { at: appear.get(0) || 0.5, title: '以太网封装 + FCS', text: 'FCS 为 CRC-32，只保护这一跳线路；上层校验和才是端到端的。' },
            { at: 0.62, title: '线路传输', text: '完整的帧在链路上传输。点击任意字段砖块查看含义，拖动“拆解”滑块逐层炸开。' },
            { at: 0.8, title: '接收端逐层解封装', text: '外层先剥离：FCS/以太网 → IP → OSPF 头校验 → 交给状态机处理载荷。' }
        ]);
        return {
            update(t) {
                layerRecords.forEach(({ records }, layerIndex) => {
                    const start = appear.get(layerIndex) ?? 0;
                    const inK = ease(span(t, start, start + 0.08));
                    const outStart = 0.8 + (layerIndex === fcsIndex ? 0 : layerIndex) * (0.16 / layers.length);
                    const outK = ease(span(t, outStart, outStart + 0.05));
                    const k = inK * (1 - outK);
                    records.forEach(record => {
                        record.object.visible = k > 0.01;
                        record.object.scale.setScalar(0.4 + 0.6 * k);
                        record.anim.set(outK * 3.5, (1 - inK) * 4, 0);
                    });
                });
            }
        };
    }
};

// ---------------- 邻居状态机 ----------------
const STATES = [
    ['Down', '初始状态：最近没有收到该邻居的有效 Hello。'],
    ['Init', '收到邻居 Hello，但其中的邻居列表不含自己：单向连通。'],
    ['2-Way', '在对方 Hello 中看到自己的 Router-ID：双向通信建立，广播网在此选举 DR/BDR。'],
    ['ExStart', '互发空 DD 协商主从：I/M/MS=1，Router-ID 大者为 Master。'],
    ['Exchange', '互发携带 LSA 头部的 DD，记录缺失或更新的 LSA 到请求列表。'],
    ['Loading', '用 LSR 索取请求列表中的 LSA，收到 LSU 后回复 LSAck。'],
    ['Full', '双方 LSDB 完全一致，邻接完成，触发 SPF。']
];

export const fsmLadder = {
    id: 'fsm-ladder',
    title: 'OSPF 邻居状态机 · 3D 阶梯',
    subtitle: '两台路由器逐包握手：每个报文都推动一次状态跃迁，从 Down 一路爬升到 Full。',
    duration: 22,
    options: [{ id: 'mode', label: '场景', value: 'p2p', choices: [
        { value: 'p2p', label: '正常建邻' },
        { value: 'drother', label: 'DROther 互联' },
        { value: 'mtu', label: 'MTU 不匹配' }
    ] }],
    build(ctx, options) {
        const { models } = ctx;
        const r1 = models.router({ color: C.area0, label: 'R1', sub: 'RID 1.1.1.1' });
        r1.position.set(-8, 0, 2);
        ctx.part(r1, { id: 'r1', name: 'R1 (1.1.1.1)', desc: 'Router-ID 较小，在主从协商中成为 Slave。', explode: [-3, 0, 1] });
        const r2 = models.router({ color: C.area1, label: 'R2', sub: 'RID 2.2.2.2' });
        r2.position.set(8, 0, 2);
        ctx.part(r2, { id: 'r2', name: 'R2 (2.2.2.2)', desc: 'Router-ID 较大，成为 Master，掌握 DD 序列号的步进权。', explode: [3, 0, 1] });
        ctx.link(r1, r2, { color: 0x334155, radius: 0.06 });
        const platforms = STATES.map(([name, desc], index) => {
            const platform = models.platform({ radius: 1.05, color: index === 6 ? C.ok : C.info, label: name });
            platform.position.set(-6 + index * 2, -0.6 + index * 0.75, -3.2 - Math.sin(index / 6 * Math.PI) * 1.4);
            ctx.part(platform, { id: `state-${name}`, name: `状态 ${name}`, desc, explode: [0, index * 0.55, -index * 0.25] });
            return platform;
        });
        for (let i = 0; i < platforms.length - 1; i += 1) ctx.link(platforms[i], platforms[i + 1], { color: 0x1e3a8a, radius: 0.03, opacity: 0.6 });
        const tokenA = ctx.packet({ color: C.area0, label: 'R1 视角', size: 0.2, trail: 0 });
        const tokenB = ctx.packet({ color: C.area1, label: 'R2 视角', size: 0.2, trail: 0 });
        const lsdb1 = models.stack({ color: C.area0, count: 2, label: 'R1 LSDB' });
        lsdb1.position.set(-10.2, 0, 2);
        ctx.part(lsdb1, { id: 'lsdb1', name: 'R1 的 LSDB', desc: '同步前缺少 3 条 LSA，Loading 阶段补齐。', explode: [-2, 0, 0] });
        const lsdb2 = models.stack({ color: C.area1, count: 5, label: 'R2 LSDB' });
        lsdb2.position.set(10.2, 0, 2);
        ctx.part(lsdb2, { id: 'lsdb2', name: 'R2 的 LSDB', desc: 'R2 拥有完整数据库，请求列表为空，Exchange 后直接 Full。', explode: [2, 0, 0] });
        const extra = models.stack({ color: C.area0, count: 3 });
        extra.position.set(-10.2, 0.28, 2);
        lsdb1.add(extra);
        extra.position.set(0, 0.28, 0);

        // 事件脚本：[开始, 结束, 方向(1: R1→R2, -1: R2→R1, 0: 双向), 标签, 颜色, R1 状态, R2 状态]
        let script;
        if (options.mode === 'drother') {
            script = [
                [0.06, 0.14, 1, 'Hello 邻居:无', C.lsa1, 0, 1],
                [0.18, 0.26, -1, 'Hello 邻居:1.1.1.1', C.lsa1, 2, 1],
                [0.3, 0.38, 1, 'Hello 邻居:2.2.2.2', C.lsa1, 2, 2],
                [0.5, 0.58, 0, 'Hello 保活', C.lsa1, 2, 2],
                [0.75, 0.83, 0, 'Hello 保活', C.lsa1, 2, 2]
            ];
        } else if (options.mode === 'mtu') {
            script = [
                [0.04, 0.1, 1, 'Hello 邻居:无', C.lsa1, 0, 1],
                [0.12, 0.18, -1, 'Hello 邻居:1.1.1.1', C.lsa1, 3, 1],
                [0.2, 0.26, 1, 'Hello 邻居:2.2.2.2', C.lsa1, 3, 3],
                [0.3, 0.37, 0, 'DD I/M/MS=1', C.lsa4, 3, 3],
                [0.42, 0.5, -1, 'DD MTU=9000 ✗', C.bad, 3, 3],
                [0.55, 0.63, -1, 'DD 重传 MTU=9000 ✗', C.bad, 3, 3],
                [0.68, 0.76, -1, 'DD 重传 MTU=9000 ✗', C.bad, 3, 3],
                [0.81, 0.89, 0, 'SeqNumberMismatch', C.bad, 3, 3]
            ];
        } else {
            script = [
                [0.04, 0.1, 1, 'Hello 邻居:无', C.lsa1, 0, 1],
                [0.12, 0.18, -1, 'Hello 邻居:1.1.1.1', C.lsa1, 3, 1],
                [0.2, 0.26, 1, 'Hello 邻居:2.2.2.2', C.lsa1, 3, 3],
                [0.29, 0.35, 0, 'DD I=1 M=1 MS=1 (空)', C.lsa4, 3, 3],
                [0.38, 0.44, 1, 'DD MS=0 Seq=y (Slave)', C.lsa4, 4, 4],
                [0.46, 0.52, -1, 'DD LSA 头部×5', C.lsa4, 4, 4],
                [0.54, 0.6, 1, 'DD LSA 头部×2 M=0', C.lsa4, 5, 6],
                [0.63, 0.69, 1, 'LSR 三元组×3', C.lsa3, 5, 6],
                [0.71, 0.77, -1, 'LSU 完整 LSA×3', C.lsa2, 5, 6],
                [0.79, 0.85, 1, 'LSAck 头部×3', C.lsa5, 6, 6]
            ];
        }
        const packets = script.map(([, , dir, label, color]) => ({
            forward: ctx.packet({ color, label }),
            backward: dir === 0 ? ctx.packet({ color, label }) : null
        }));
        const stateAt = (t, which) => {
            let value = 0;
            let changedAt = 0;
            let previous = 0;
            script.forEach(event => {
                const next = which === 1 ? event[5] : event[6];
                if (t >= event[1] && next !== value) { previous = value; value = next; changedAt = event[1]; }
            });
            return { value, previous, k: ease(span(t, changedAt, changedAt + 0.04)) };
        };
        const steps = {
            p2p: [
                { at: 0, title: 'Down', text: '两端接口刚使能 OSPF，尚未收到对方任何报文。' },
                { at: 0.1, title: 'R2 → Init', text: 'R2 收到 R1 的 Hello，但邻居列表里没有自己：单向连通。' },
                { at: 0.18, title: 'R1 → 2-Way → ExStart', text: 'R1 在 Hello 中看到了自己的 RID，双向通信成立；P2P 无需 DR，AdjOK? 为是，立即进入 ExStart。' },
                { at: 0.29, title: 'ExStart：争当 Master', text: '双方都先假定自己是 Master，互发 I/M/MS=1 的空 DD。' },
                { at: 0.38, title: 'NegotiationDone', text: 'R1 的 RID 较小，承认自己是 Slave，并复制 Master 的序列号作为隐式确认 → Exchange。' },
                { at: 0.46, title: 'Exchange：交换摘要', text: 'DD 携带 20 字节 LSA 头部。R1 发现缺少 3 条，写入 Link-state request list。' },
                { at: 0.6, title: 'ExchangeDone 分岔', text: 'R1 请求列表非空 → Loading；R2 请求列表为空 → 直接 Full。' },
                { at: 0.63, title: 'Loading：LSR → LSU → LSAck', text: 'LSR 只带三元组；LSU 带完整 LSA；收到后回 LSAck 并再次做新旧核验。' },
                { at: 0.85, title: 'Full', text: '请求列表清空，LoadingDone → Full。双方 LSDB 完全一致，开始 SPF 算路。' }
            ],
            drother: [
                { at: 0, title: 'Down', text: '两台 DROther 接在同一广播网。' },
                { at: 0.14, title: 'Init', text: 'R2 收到 Hello 但未看到自己。' },
                { at: 0.26, title: '2-Way 停留', text: 'AdjOK? 判定：双方都不是 DR/BDR，不需要同步数据库，永久保持 2-Way —— 这是正常现象！' },
                { at: 0.5, title: '周期 Hello 保活', text: '它们分别与 DR/BDR 建立 Full 邻接，彼此之间只维持 Hello。' }
            ],
            mtu: [
                { at: 0, title: 'Down', text: 'R2 接口 MTU 为 9000，R1 为 1500，且开启了 MTU 检查。' },
                { at: 0.18, title: '2-Way → ExStart', text: '邻居建立正常。' },
                { at: 0.42, title: 'DD MTU 校验失败', text: 'R1 收到的 DD 中 Interface MTU 大于本地接口 MTU，丢弃该 DD。' },
                { at: 0.55, title: '反复重传', text: 'R2 每 5 秒重传，状态卡在 ExStart/Exchange。' },
                { at: 0.81, title: 'SeqNumberMismatch', text: '序列号失步触发回退 ExStart，周而复始。排查：display ospf peer 看 DD 序列号与 MTU。' }
            ]
        };
        ctx.setSteps(steps[options.mode]);
        ctx.setLegend([{ color: C.lsa1, label: 'Hello' }, { color: C.lsa4, label: 'DD' }, { color: C.lsa3, label: 'LSR' }, { color: C.lsa2, label: 'LSU' }, { color: C.lsa5, label: 'LSAck' }]);
        ctx.camera3([0, 7, 17], [0, 0.8, -1]);
        const tokenPos = (which, t) => {
            const { value, previous, k } = stateAt(t, which);
            const from = ctx.posOf(platforms[previous]);
            const to = ctx.posOf(platforms[value]);
            const p = from.lerp(to, k);
            p.y += 0.55 + Math.sin(k * Math.PI) * 0.8;
            p.x += which === 1 ? -0.4 : 0.4;
            return p;
        };
        return {
            update(t) {
                tokenA.at(tokenPos(1, t));
                tokenB.at(tokenPos(2, t));
                platforms.forEach((platform, index) => {
                    const active = stateAt(t, 1).value === index || stateAt(t, 2).value === index;
                    platform.userData.glow.scale.setScalar(active ? 1 + Math.sin(t * 80) * 0.04 + 0.08 : 1);
                });
                const p1 = ctx.posOf(r1).add(new ctx.THREE.Vector3(0, 0.6, 0));
                const p2 = ctx.posOf(r2).add(new ctx.THREE.Vector3(0, 0.6, 0));
                script.forEach(([start, end, dir], index) => {
                    const u = span(t, start, end);
                    const visible = t >= start && t <= end;
                    const forward = dir === -1 ? [p2, p1] : [p1, p2];
                    packets[index].forward.set(u, v => pathPoint(forward, v, 1.6), visible);
                    if (packets[index].backward) packets[index].backward.set(u, v => pathPoint([p2, p1], v, -0.2), visible);
                });
                extra.visible = options.mode === 'p2p' && t > 0.77;
            }
        };
    }
};

// ---------------- 区域与 LSA 泛洪沙盘 ----------------
const AREA_TYPES = {
    normal: { label: '普通区域', allow: [1, 2, 3, 4, 5] },
    stub: { label: 'Stub', allow: [1, 2, 3] },
    'totally-stub': { label: 'Totally Stub', allow: [1, 2] },
    nssa: { label: 'NSSA', allow: [1, 2, 3, 7] },
    'totally-nssa': { label: 'Totally NSSA', allow: [1, 2, 7] }
};

export const areaFlood = {
    id: 'area-flood',
    title: 'OSPF 区域与 LSA 泛洪 · 3D 沙盘',
    subtitle: '域内链路状态、域间距离矢量：看每类 LSA 由谁产生、泛洪到哪里、在哪道边界被拦下或被翻译。',
    duration: 16,
    options: [
        { id: 'lsa', label: 'LSA', value: 5, choices: [1, 2, 3, 4, 5, 7].map(value => ({ value, label: `${value} 类` })) },
        { id: 'area2', label: 'Area 2', value: 'normal', choices: Object.entries(AREA_TYPES).map(([value, info]) => ({ value, label: info.label })) }
    ],
    build(ctx, options) {
        const { models, THREE } = ctx;
        const area2 = AREA_TYPES[options.area2];
        const isNssa = options.area2.includes('nssa');
        const totally = options.area2.startsWith('totally');
        const areaPart = (radius, color, label, x, explodeY, desc) => {
            const area = models.area({ radius, color, label });
            area.position.set(x, 0, 0);
            ctx.part(area, { id: `area-${label}`, name: label, desc, explode: [x * 0.15, explodeY, 0], focus: false });
            return area;
        };
        const a0 = areaPart(5.4, C.area0, 'Area 0 骨干', 0, 0, '所有非骨干区域都必须连到骨干：区域间路由经 Area 0 中转，形成星型无环结构。');
        const a1 = areaPart(4.4, C.area1, 'Area 1 普通区域', -11.5, -2.5, '普通区域：1/2/3/4/5 类 LSA 均可泛洪。R4 引入外部路由成为 ASBR。');
        const a2 = areaPart(4.4, C.area2, `Area 2 · ${area2.label}`, 11.5, 2.5, `当前类型 ${area2.label}：允许 ${area2.allow.join('/')} 类 LSA${totally ? '，3 类只剩缺省' : ''}。`);
        const node = (parent, label, sub, x, z, color, desc) => {
            const router = models.router({ color, label, sub });
            router.position.set(x, 0, z);
            parent.add(router);
            ctx.part(router, { id: label, name: `${label} ${sub}`, desc, explode: [0, 0.6, 0] });
            return router;
        };
        const sw = models.switchBox({ color: C.area0, label: 'SW-Core' });
        a0.add(sw);
        ctx.part(sw, { id: 'sw', name: 'SW-Core 广播网', desc: '多路访问网段：DR R1 为它生成 2 类 LSA（伪节点）。', explode: [0, 0.3, 0] });
        const r1 = node(a0, 'R1', 'DR', -2.4, -2.6, C.area0, 'Area 0 广播网的 DR，产生 2 类 Network-LSA。');
        const r2 = node(a0, 'R2', 'BDR', 2.4, -2.6, C.area0, '热备 BDR，与所有 DROther 保持 Full。');
        const r6 = node(a0, 'R6', 'ABR', -5.6, 0.8, C.lsa3, 'Area 0 与 Area 1 的 ABR：把 Area 1 的 1/2 类折叠成 3 类，并为 R4 签发 4 类。');
        const r3 = node(a0, 'R3', 'ABR', 5.6, 0.8, C.lsa3, 'Area 0 与 Area 2 的 ABR：特殊区域的守门人，负责拦截/下发缺省，NSSA 时负责 7 转 5。');
        const r7 = node(a1, 'R7', 'IR', 2.3, 2.2, C.area1, 'Area 1 内部路由器，只维护本区域 LSDB。');
        const r4 = node(a1, 'R4', 'ASBR', -1.6, -1.2, C.lsa5, 'import-route 引入 172.16.0.0/16，成为 ASBR，Router LSA 中 E-bit=1。');
        const r8 = node(a2, 'R8', 'IR', -2.3, 2.2, C.area2, 'Area 2 内部路由器。');
        const r5 = node(a2, 'R5', isNssa ? 'ASBR' : 'IR', 1.6, -1.2, isNssa ? C.lsa7 : C.area2, isNssa ? 'NSSA 内的 ASBR：以 7 类 LSA 引入分支专线 192.168.100.0/24。' : '非 NSSA 时，这里不能以 7 类引入外部路由。');
        const ext1 = models.cloud({ label: '外部 172.16/16' });
        ext1.position.set(-6.8, 0.6, -2.2);
        a1.add(ext1);
        ctx.part(ext1, { id: 'ext1', name: '外部网络 172.16.0.0/16', desc: '静态/BGP 等外部来源。', explode: [-1, 0.8, 0] });
        const ext2 = models.cloud({ label: '分支专线 192.168.100/24', color: C.lsa7 });
        ext2.position.set(6.8, 0.6, -2.2);
        a2.add(ext2);
        ctx.part(ext2, { id: 'ext2', name: '分支外部网络', desc: '只有 NSSA 才允许在区域内引入它。', explode: [1, 0.8, 0] });
        [[r1, sw], [r2, sw], [r6, sw], [r3, sw], [r6, r7], [r7, r4], [r4, ext1], [r3, r8], [r8, r5], [r5, ext2]].forEach(([a, b]) => ctx.link(a, b, { color: 0x334155, radius: 0.05 }));

        // 泛洪波：节点路径 + 起止时间
        const hop = 0.055;
        const waves = [];
        const blocks = [];
        const defaults = [];
        const wave = (path, start, color, label) => { waves.push({ path, start, end: start + hop * (path.length - 1), color, label }); return start + hop * (path.length - 1); };
        const block = (at, toward, start, text) => blocks.push({ at, toward, start, text });
        const lsaColor = { 1: C.lsa1, 2: C.lsa2, 3: C.lsa3, 4: C.lsa4, 5: C.lsa5, 7: C.lsa7 }[options.lsa];
        const allow = area2.allow;
        const stepsList = [];
        if (options.lsa === 1) {
            wave([r4, r7, r6], 0.05, lsaColor, '1类 R4');
            wave([r1, sw, r3], 0.05, lsaColor, '1类 R1');
            wave([r2, sw, r6], 0.08, lsaColor, '1类 R2');
            wave([r5, r8, r3], 0.05, lsaColor, '1类 R5');
            block(r6, r7, 0.2, '1 类不出区域');
            block(r3, r8, 0.2, '1 类不出区域');
            stepsList.push({ at: 0, title: '1 类：每台路由器各自生成', text: '描述“我是谁、我连着谁、开销多少”，只在所属区域内泛洪。' },
                { at: 0.2, title: 'ABR 处止步', text: 'ABR 会把它们算成路由后折叠成 3 类，但 1 类本身绝不跨区域。' });
        } else if (options.lsa === 2) {
            wave([r1, sw, r2], 0.05, lsaColor, '2类 DR=R1');
            wave([r1, sw, r6], 0.05, lsaColor, '2类 DR=R1');
            wave([r1, sw, r3], 0.05, lsaColor, '2类 DR=R1');
            block(r6, r7, 0.2, '2 类不出区域');
            block(r3, r8, 0.2, '2 类不出区域');
            stepsList.push({ at: 0, title: '2 类：DR 为广播网代言', text: 'Network-LSA 列出网段掩码与所有接入路由器，把 O(N²) 邻接降为 O(N)。' },
                { at: 0.2, title: '同样只在区域内', text: '其他区域只会看到 ABR 折叠后的 3 类前缀。' });
        } else if (options.lsa === 3) {
            const t1 = wave([r7, r6], 0.05, C.lsa1, 'Area1 拓扑');
            const t2 = wave([r6, sw, r1], t1, lsaColor, '3类 Adv=R6');
            wave([r6, sw, r2], t1, lsaColor, '3类 Adv=R6');
            const t3 = wave([r6, sw, r3], t1, lsaColor, '3类 Adv=R6');
            if (allow.includes(3) && !totally) wave([r3, r8, r5], t3 + 0.02, lsaColor, '3类 Adv=R3 (重新生成)');
            else {
                block(r3, r8, t3, totally ? 'no-summary 拦截 3 类明细' : '');
                defaults.push(wave([r3, r8, r5], t3 + 0.04, C.ok, '3类缺省 0/0'));
            }
            const back = wave([r8, r3], Math.max(t2, t3) + 0.06, C.area2, 'Area2 拓扑');
            wave([r3, sw, r6, r7, r4], back, lsaColor, '3类 Adv=R3/R6');
            stepsList.push({ at: 0, title: 'ABR 折叠拓扑', text: 'R6 把 Area 1 的 1/2 类算成路由，只以“前缀 + Metric”生成 3 类送入骨干。' },
                { at: t1, title: '通告者是 ABR', text: '3 类跨区域时由下一个 ABR 重新生成，Advertising Router 被改写为该 ABR。' },
                { at: t3, title: totally ? 'Totally 区域只收缺省' : 'R3 重新生成进入 Area 2', text: totally ? 'ABR 配置 no-summary 后，3 类明细被拦截，只下发一条 3 类缺省。' : '区域间是距离矢量：远端只知道“找 R3，开销多少”。' },
                { at: back, title: '反方向同理', text: 'Area 2 的网段同样被折叠成 3 类送往骨干与 Area 1；非骨干区域间不能横向直传。' });
        } else if (options.lsa === 4) {
            const t1 = wave([r4, r7, r6], 0.05, C.lsa1, '1类 E-bit=1');
            const t2 = wave([r6, sw, r3], t1, lsaColor, '4类 ASBR=4.4.4.4');
            wave([r6, sw, r1], t1, lsaColor, '4类 ASBR=R4');
            if (allow.includes(4)) wave([r3, r8, r5], t2 + 0.02, lsaColor, '4类 Adv=R3');
            else block(r3, r8, t2, 'Stub/NSSA 拒绝 4 类');
            stepsList.push({ at: 0, title: 'R6 发现 ASBR', text: 'R4 的 1 类 LSA 中 E-bit=1，ABR R6 据此知道 4.4.4.4 是 ASBR。' },
                { at: t1, title: '签发 4 类“GPS 定位”', text: 'Link State ID = ASBR 的 Router-ID，掩码 0.0.0.0；它不生成转发路由，只告诉别人“ASBR 在我身后”。' },
                { at: t2, title: allow.includes(4) ? '跨区域继续重签' : '特殊区域拦截', text: allow.includes(4) ? '每过一个 ABR 都重新签发，5 类才能完成“前缀 → ASBR → 下一跳”的递归。' : '既然 5 类进不来，4 类也就没有意义。' });
        } else if (options.lsa === 5) {
            const t1 = wave([ext1, r4, r7, r6], 0.04, lsaColor, '5类 Adv=R4');
            const t2 = wave([r6, sw, r3], t1, lsaColor, '5类 Adv=R4 (不变)');
            wave([r6, sw, r1], t1, lsaColor, '5类');
            wave([r6, sw, r2], t1, lsaColor, '5类');
            if (allow.includes(5)) wave([r3, r8, r5], t2, lsaColor, '5类 Adv=R4');
            else {
                block(r3, r8, t2, `${area2.label} 拒绝 5 类`);
                defaults.push(wave([r3, r8, r5], t2 + 0.05, isNssa && !totally ? C.lsa7 : C.ok, isNssa && !totally ? '7类缺省 P=0' : '3类缺省 0/0'));
            }
            stepsList.push({ at: 0, title: 'ASBR 引入外部路由', text: 'R4 import-route 生成 5 类，唯一一种全域泛洪的核心 LSA。' },
                { at: t1, title: '通告者保持不变', text: '跨 ABR 时 Advertising Router 始终是 R4，远端靠 4 类找到它。' },
                { at: t2, title: allow.includes(5) ? '进入 Area 2' : '特殊区域拦截并下发缺省', text: allow.includes(5) ? '普通区域照单全收。' : (isNssa && !totally ? 'NSSA ABR 自动下发 7 类缺省（P=0、FA=0），前提是在 Area 0 有 Full 邻居。' : 'ABR 自动下发 3 类缺省，引导流量出区域。') });
        } else if (options.lsa === 7) {
            if (isNssa) {
                const t1 = wave([ext2, r5, r8, r3], 0.04, lsaColor, '7类 P=1 FA≠0');
                const t2 = wave([r3, sw, r6, r7, r4], t1 + 0.05, C.lsa5, '5类 Adv=R3 (7转5)');
                wave([r3, sw, r1], t1 + 0.05, C.lsa5, '5类 (翻译后)');
                stepsList.push({ at: 0, title: 'NSSA 内以 7 类引入', text: 'R5 不能产生 5 类，只能披上“7 类马甲”在 Area 2 内泛洪。' },
                    { at: t1, title: 'ABR 7 转 5', text: 'P-bit=1 且 FA≠0 时，Router-ID 最大的 NSSA ABR 把它翻译成 5 类注入骨干，通告者变为 R3。' },
                    { at: t2 - 0.1, title: '全网可达', text: '翻译后的 5 类保留原 FA，其他区域可直接递归到分支下一跳。' });
            } else {
                block(r5, r8, 0.05, '非 NSSA 不能引入 7 类');
                stepsList.push({ at: 0, title: '需要 NSSA', text: `Area 2 当前为 ${area2.label}。只有 NSSA / Totally NSSA 才允许 7 类 LSA；Stub 区域禁止任何外部引入。` });
            }
        }
        ctx.setSteps(stepsList);
        const shields = blocks.filter(item => item.text !== '').map(item => {
            const shield = models.shield({ radius: 0.75 });
            const tag = ctx.makeLabel(item.text, { size: 0.22, border: '#ef4444' });
            tag.position.y = 1.2;
            shield.add(tag);
            ctx.add(shield);
            return { ...item, shield };
        });
        const packets = waves.map(item => ctx.packet({ color: item.color, label: item.label }));
        const halos = new Map();
        [r1, r2, r3, r4, r5, r6, r7, r8].forEach(router => {
            const halo = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.45, 48), new THREE.MeshBasicMaterial({ color: lsaColor, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
            halo.rotation.x = -Math.PI / 2;
            halo.position.y = -0.5;
            halo.userData.noDim = true;
            router.add(halo);
            halos.set(router, halo);
        });
        const arrival = new Map();
        waves.forEach(item => item.path.forEach((node, index) => {
            if (!halos.has(node)) return;
            const at = item.start + index * hop;
            arrival.set(node, Math.min(arrival.get(node) ?? 9, at));
        }));
        const matrix = ['Area 0', 'Area 1', 'Area 2'].map((name, index) => {
            const allowList = index === 2 ? area2.allow : [1, 2, 3, 4, 5];
            const cells = [1, 2, 3, 4, 5, 7].map(type => {
                let mark = allowList.includes(type) ? '✓' : '—';
                if (index === 2 && type === 3 && totally) mark = '缺省';
                if (index === 2 && type === 3 && !totally && !allowList.includes(4) && !isNssa) mark = '✓+缺省';
                if (index === 2 && type === 7 && isNssa) mark = '✓+缺省';
                if (index === 0 && type === 5 && isNssa) mark = '✓(含7转5)';
                return `<td class="${mark === '—' ? 'is-off' : ''}">${mark}</td>`;
            }).join('');
            return `<tr><th>${name}</th>${cells}</tr>`;
        }).join('');
        ctx.extraPanel(`<div class="dk-mini-title">各区域 LSDB 中的 LSA 类型</div><table class="dk-matrix"><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>7</th></tr>${matrix}</table>`);
        ctx.setLegend([{ color: lsaColor, label: `${options.lsa} 类 LSA` }, { color: C.ok, label: '缺省路由' }, { color: C.bad, label: '边界拦截' }]);
        ctx.camera3([0, 17, 22], [0, 0, 0]);
        return {
            update(t) {
                waves.forEach((item, index) => {
                    const visible = t >= item.start && t <= item.end + 0.02;
                    const points = item.path.map(nodeObject => ctx.posOf(nodeObject).add(new THREE.Vector3(0, 0.7, 0)));
                    packets[index].set(span(t, item.start, item.end), u => pathPoint(points, u, 0.9), visible);
                });
                halos.forEach((halo, router) => {
                    const at = arrival.get(router);
                    const k = at === undefined ? 0 : span(t, at, at + 0.03);
                    halo.material.opacity = 0.55 * k;
                    halo.scale.setScalar(1 + (1 - k) * 0.6);
                });
                shields.forEach(item => {
                    const from = ctx.posOf(item.at);
                    const to = ctx.posOf(item.toward);
                    item.shield.position.copy(from.lerp(to, 0.35)).add(new THREE.Vector3(0, 0.9, 0));
                    item.shield.lookAt(to.x, item.shield.position.y, to.z);
                    item.shield.visible = t >= item.start;
                    item.shield.scale.setScalar(ease(span(t, item.start, item.start + 0.04)) * (1 + Math.sin(t * 60) * 0.03));
                });
            }
        };
    }
};

// ---------------- FA 转发地址：三角次优 ----------------
export const faPath = {
    id: 'fa-path',
    title: '转发地址 FA · 三角次优 vs 一跳直达',
    subtitle: 'FA = 0 时流量必须先送到 ASBR；FA 指向共享网段上的真实网关时，ASBR 被完全旁路。',
    duration: 14,
    options: [{ id: 'fa', label: '5 类 LSA 的 FA', value: 'zero', choices: [{ value: 'zero', label: 'FA = 0.0.0.0' }, { value: 'set', label: 'FA = 10.1.1.254' }] }],
    build(ctx, options) {
        const { models, THREE } = ctx;
        const a0 = models.area({ radius: 3, color: C.area0, label: 'Area 0' });
        a0.position.set(-9, 0, 0);
        ctx.part(a0, { id: 'a0', name: 'Area 0', desc: '流量源头 R1 所在的骨干区域。', explode: [-2, -0.5, 0], focus: false });
        const a1 = models.area({ radius: 5.2, color: C.area1, label: 'Area 1 · 广播网 10.1.1.0/24' });
        a1.position.set(1, 0, 0);
        ctx.part(a1, { id: 'a1', name: 'Area 1 共享以太网', desc: 'R2、R3 和外部网关 R_ISP 都接在同一台交换机 SW1 上。', explode: [0, -1, 0], focus: false });
        const place = (object, x, z, id, name, desc, explode) => { object.position.set(x, 0, z); ctx.part(object, { id, name, desc, explode }); return object; };
        const r1 = place(models.router({ color: C.area0, label: 'R1', sub: '流量源头' }), -9, 0, 'r1', 'R1 (1.1.1.1)', 'Area 0 核心路由器，要访问 192.168.100.0/24。', [-2, 0, 0]);
        const r2 = place(models.router({ color: C.lsa3, label: 'R2 ABR', sub: '10.1.1.2' }), -3.5, 0, 'r2', 'R2 ABR (10.1.1.2)', '收到 5 类 LSA 后依据 FA 计算下一跳。', [-1, 0, 0]);
        const sw = place(models.switchBox({ color: C.area1, label: 'SW1' }), 1.5, 0, 'sw', 'SW1 二层交换机', '共享广播域：只要知道目标 MAC，二层可以一步直达任一端口。', [0, 0, 0]);
        const r3 = place(models.router({ color: C.lsa5, label: 'R3 ASBR', sub: '10.1.1.3' }), 1.5, -4.2, 'r3', 'R3 ASBR (10.1.1.3)', '配置静态路由 192.168.100.0/24 → 10.1.1.254 并 import-route static。', [0, 0, -1.5]);
        const isp = place(models.router({ color: C.external, label: 'R_ISP', sub: '10.1.1.254 · 无 OSPF' }), 6.2, 2.6, 'isp', 'R_ISP 外部网关', '运营商路由器，不运行 OSPF，直连目的网段。', [1.5, 0, 1]);
        const server = place(models.server({ color: C.external, label: '192.168.100.1' }), 10.5, 2.6, 'server', '业务服务器', '外部目的地。', [2.5, 0, 1]);
        [[r1, r2], [r2, sw], [sw, r3], [sw, isp], [isp, server]].forEach(([a, b]) => ctx.link(a, b, { color: 0x334155, radius: 0.06 }));
        const fa = options.fa === 'set';
        const card = ctx.makeLabel(`Type-5 LSA (Adv=3.3.3.3)\n192.168.100.0/24\nFA = ${fa ? '10.1.1.254' : '0.0.0.0'}`, { size: 0.3, border: fa ? '#22c55e' : '#f87171', mono: true });
        card.position.set(1.5, 2.6, -4.2);
        ctx.part(card, { id: 'lsa', name: 'R3 生成的 5 类 LSA', desc: fa ? '出接口使能 OSPF、广播类型、非静默：三条件满足，FA 填外部下一跳。' : '任一条件不满足（如出接口未宣告进 OSPF），FA 填 0.0.0.0。', explode: [0, 1.5, -1], focus: false });
        const path = fa ? [r1, r2, sw, isp, server] : [r1, r2, sw, r3, sw, isp, server];
        const labels = fa ? ['① 去往 FA', '② ARP 直接解析 R_ISP', '③ 二层一步到位', '④ 送达'] : ['① 找 ASBR R3', '② DMAC=R3', '③ 交付 ASBR', '④ 同一网口折返!', '⑤ 交给真实网关', '⑥ 送达'];
        const data = [0, 1, 2].map(index => ctx.packet({ color: index ? C.info : (fa ? C.ok : C.warn), label: index ? '' : labels[0] }));
        const redirect = ctx.packet({ color: C.bad, label: 'ICMP Redirect' });
        ctx.setSteps(fa ? [
            { at: 0, title: 'ASBR 智能判定', text: 'R3 发现外部下一跳 10.1.1.254 与自己同处已宣告进 OSPF 的广播网，于是把 FA 写成 10.1.1.254。' },
            { at: 0.2, title: 'ABR 以 FA 为算路终点', text: 'R2 不再寻找 ASBR 3.3.3.3，而是直接把 10.1.1.254 当作下一跳。' },
            { at: 0.45, title: '二层直通', text: 'R2 封装 DMAC = R_ISP 的 MAC，SW1 硬件交换直接送达；R3 全程旁观，0 转发开销。' }
        ] : [
            { at: 0, title: 'FA = 0.0.0.0', text: '协议规定：去往外部路由的流量必须先发给通告该 LSA 的 ASBR。' },
            { at: 0.2, title: 'R2 下一跳 = R3', text: 'R2 根据 Area 1 的 1 类 LSA 得知 3.3.3.3 的接口是 10.1.1.3。' },
            { at: 0.45, title: '同一网口进出两次', text: 'R3 查静态路由，下一跳 10.1.1.254 的出接口正是收包接口：同一根网线走两遍，带宽减半。' },
            { at: 0.7, title: 'ICMP 重定向', text: 'R3 频繁向 R2 发送重定向，CPU 与接口都被白白占用。' }
        ]);
        ctx.extraPanel(`<div class="dk-mini-title">SW1 ↔ 路由器 链路占用</div><div class="dk-big-number ${fa ? 'is-ok' : 'is-bad'}">${fa ? '1 次' : '2 次'}</div><div class="dk-mini-note">${fa ? 'ASBR 被旁路' : '经 ASBR 折返（三角次优）'}</div>`);
        ctx.camera3([1, 12, 15], [1, 0, 0]);
        return {
            update(t) {
                const points = path.map(item => ctx.posOf(item).add(new THREE.Vector3(0, 0.7, 0)));
                data.forEach((packet, index) => {
                    const start = 0.05 + index * 0.06;
                    const u = span(t, start, start + 0.7);
                    packet.set(u, v => pathPoint(points, v, 0.8), t >= start && t <= start + 0.72);
                    if (index === 0) packet.relabel(labels[Math.min(labels.length - 1, Math.floor(u * (path.length - 1)))]);
                });
                const p3 = ctx.posOf(r3).add(new THREE.Vector3(0, 0.8, 0));
                const p2 = ctx.posOf(r2).add(new THREE.Vector3(0, 0.8, 0));
                redirect.set(span(t, 0.7, 0.85), v => pathPoint([p3, p2], v, 2), !fa && t >= 0.7 && t <= 0.86);
                r3.rotation.y = fa ? 0 : Math.sin(t * 40) * 0.05 * (t > 0.3 && t < 0.6 ? 1 : 0);
            }
        };
    }
};

// ---------------- DR / BDR 与伪节点 ----------------
export const drPseudonode = {
    id: 'dr-pseudonode',
    title: 'DR/BDR 与伪节点 · O(N²) → O(N)',
    subtitle: '广播网上两两全互联会让邻接与泛洪爆炸；DR 代表伪节点，把网状结构压缩成星型。',
    duration: 16,
    options: [
        { id: 'mode', label: '模型', value: 'pseudo', choices: [{ value: 'pseudo', label: 'DR 伪节点' }, { value: 'mesh', label: '假设全互联' }] },
        { id: 'n', label: '路由器数', type: 'range', value: 6, min: 3, max: 10, step: 1 }
    ],
    build(ctx, options) {
        const { models, THREE } = ctx;
        const n = options.n;
        const pseudo = options.mode === 'pseudo';
        const priorities = [1, 1, 0, 1, 2, 1, 1, 1, 1, 1].slice(0, n);
        const routers = priorities.map((pri, index) => ({ pri, rid: index + 1, index }));
        const candidates = routers.filter(item => item.pri > 0).sort((a, b) => b.pri - a.pri || b.rid - a.rid);
        const dr = candidates[0];
        const bdr = candidates[1];
        const sw = models.switchBox({ color: C.area0, label: '广播网 10.0.0.0/24' });
        ctx.part(sw, { id: 'sw', name: '以太网交换机', desc: '多路访问网段：物理上任意两台路由器都能直接通信。', explode: [0, -1, 0] });
        const objects = routers.map(item => {
            const angle = item.index / n * Math.PI * 2;
            const router = models.router({ color: item.pri === 0 ? C.muted : C.info, label: `R${item.rid}`, sub: `RID ${item.rid}.${item.rid}.${item.rid}.${item.rid} · Pri ${item.pri}` });
            router.position.set(Math.cos(angle) * 7, 0, Math.sin(angle) * 7);
            ctx.part(router, { id: `r${item.rid}`, name: `R${item.rid}`, desc: item.pri === 0 ? '优先级 0：放弃 DR/BDR 选举，永久 DROther。' : `接口优先级 ${item.pri}，Router-ID ${item.rid}.${item.rid}.${item.rid}.${item.rid}。`, explode: [Math.cos(angle) * 2.5, 0, Math.sin(angle) * 2.5] });
            ctx.link(router, sw, { color: 0x1e293b, radius: 0.03, opacity: 0.6 });
            return router;
        });
        const crown = (color, text) => {
            const group = new THREE.Group();
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 10, 32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 }));
            ring.rotation.x = Math.PI / 2;
            const tag = ctx.makeLabel(text, { size: 0.26, border: `#${new THREE.Color(color).getHexString()}`, bold: true });
            tag.position.y = 0.7;
            group.add(ring, tag);
            group.userData.noDim = true;
            group.traverse(child => { child.userData.noDim = true; });
            ctx.add(group);
            return group;
        };
        const drCrown = crown(C.warn, 'DR');
        const bdrCrown = crown(C.info, 'BDR');
        const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: C.lsa2, emissive: C.lsa2, emissiveIntensity: 1.2, transparent: true, opacity: 0.85 }));
        node.position.set(0, 3.2, 0);
        const nodeTag = ctx.makeLabel('伪节点 (Type-2 LSA)', { size: 0.28, border: '#a78bfa' });
        nodeTag.position.y = 1.4;
        node.add(nodeTag);
        ctx.part(node, { id: 'pseudo', name: '伪节点 Pseudonode', desc: 'DR 生成 2 类 Network-LSA 代表这个网段：掩码 + 所有接入路由器 RID。每台路由器的 1 类 LSA 只需写“我连着伪节点”。', explode: [0, 2, 0] });
        const adjacencies = [];
        let nodeLink = null;
        if (pseudo) {
            objects.forEach((router, index) => {
                if (routers[index] === dr) return;
                adjacencies.push(ctx.link(router, objects[dr.index], { color: C.warn, radius: 0.025, arc: 1.2, opacity: 0.55 }));
                if (routers[index] !== bdr) adjacencies.push(ctx.link(router, objects[bdr.index], { color: C.info, radius: 0.02, arc: 0.8, opacity: 0.45 }));
            });
            nodeLink = ctx.link(node, objects[dr.index], { color: C.lsa2, radius: 0.04, dashed: true });
        } else {
            for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) adjacencies.push(ctx.link(objects[i], objects[j], { color: C.bad, radius: 0.02, arc: 0.4, opacity: 0.5 }));
        }
        node.visible = pseudo;
        const count = pseudo ? 2 * n - 3 : n * (n - 1) / 2;
        const meshCount = n * (n - 1) / 2;
        ctx.extraPanel(`<div class="dk-mini-title">Full 邻接数量</div><div class="dk-big-number ${pseudo ? 'is-ok' : 'is-bad'}">${count}</div><div class="dk-mini-note">全互联 N(N-1)/2 = ${meshCount}　伪节点 2N-3 = ${2 * n - 3}</div>`);
        const flapPick = routers.findIndex(item => item !== dr && item !== bdr && item.pri !== 0);
        const flapper = objects[flapPick >= 0 ? flapPick : routers.findIndex(item => item !== dr)];
        const flapIndex = objects.indexOf(flapper);
        const toDr = pseudo ? [dr.index, bdr.index].map(index => ({ from: flapIndex, to: index, start: 0.58, color: C.lsa5, label: '224.0.0.6' })) : [];
        const flood = pseudo
            ? objects.map((_, index) => index).filter(index => index !== dr.index && index !== flapIndex).map(index => ({ from: dr.index, to: index, start: 0.76, color: C.lsa3, label: index === 0 ? '224.0.0.5' : '' }))
            : objects.map((_, index) => index).filter(index => index !== flapIndex).flatMap((index, k) => [{ from: flapIndex, to: index, start: 0.55, color: C.lsa5, label: k === 0 ? 'LSU' : '' },
                ...objects.map((__, other) => other).filter(other => other !== index && other !== flapIndex).slice(0, 3).map(other => ({ from: index, to: other, start: 0.72, color: C.bad, label: '' }))]);
        const flights = [...toDr, ...flood].map(item => ({ ...item, packet: ctx.packet({ color: item.color, label: item.label, size: 0.16, trail: 3 }) }));
        ctx.setSteps(pseudo ? [
            { at: 0, title: 'Wait Timer', text: '接口 Up 后等待 40s（= DeadInterval）观察是否已有 DR，收到宣告了 DR/BDR 的 Hello 会立即跳出（BackupSeen）。' },
            { at: 0.25, title: '先选 BDR', text: `剔除优先级 0 的 R3，按“优先级 > Router-ID”选出 BDR：R${dr.rid}。` },
            { at: 0.36, title: 'BDR 晋升 DR，补选 BDR', text: `冷启动无人自称 DR，R${dr.rid} 晋升为 DR，再补选 R${bdr.rid} 为 BDR。选举非抢占。` },
            { at: 0.46, title: '星型邻接', text: `DROther 只与 DR/BDR 形成 Full，邻接数从 ${meshCount} 降到 ${2 * n - 3}；DROther 之间停在 2-Way。` },
            { at: 0.58, title: 'DROther 报告变化 → 224.0.0.6', text: '只有 DR/BDR 监听 224.0.0.6，其余路由器的 CPU 根本不处理这些报文。' },
            { at: 0.76, title: 'DR 统一泛洪 → 224.0.0.5', text: 'DR 校验后向全网组播；BDR 同步接收做热备，但不转发、不生成 2 类 LSA。' }
        ] : [
            { at: 0, title: '假设没有 DR', text: `每台路由器都与其他 ${n - 1} 台建立邻接，共 ${meshCount} 条。` },
            { at: 0.55, title: '一次接口抖动', text: '变化的路由器要向所有邻居发 LSU，每个邻居又要继续向其他邻居泛洪……' },
            { at: 0.72, title: '泛洪风暴 O(N²)', text: '接入 50 台时邻接达 1225 条，任何抖动都会让 CPU 雪崩。这正是 2 类 LSA 与伪节点存在的理由。' }
        ]);
        ctx.camera3([0, 14, 15], [0, 0.5, 0]);
        return {
            update(t) {
                const above = (object, height) => ctx.posOf(object).add(new THREE.Vector3(0, height, 0));
                const showCrowns = pseudo && t >= 0.25;
                const bdrStage = t < 0.36 ? dr : bdr;
                drCrown.visible = pseudo && t >= 0.36;
                bdrCrown.visible = showCrowns;
                drCrown.position.copy(above(objects[dr.index], 1.9 + Math.sin(t * 30) * 0.05));
                bdrCrown.position.copy(above(objects[bdrStage.index], 1.9));
                node.visible = pseudo && t >= 0.46;
                node.rotation.y = t * 12;
                node.scale.setScalar(ease(span(t, 0.46, 0.52)) || 0.001);
                if (nodeLink) nodeLink.holder.visible = node.visible;
                const reveal = pseudo ? span(t, 0.46, 0.52) : 1;
                adjacencies.forEach(link => { link.holder.visible = reveal > 0.01; });
                flights.forEach(item => {
                    const a = above(objects[item.from], 0.6);
                    const b = above(objects[item.to], 0.6);
                    item.packet.set(span(t, item.start, item.start + 0.12), v => pathPoint([a, b], v, 1.2), t >= item.start && t <= item.start + 0.12);
                });
                flapper.rotation.z = t > 0.52 && t < 0.58 ? Math.sin(t * 300) * 0.08 : 0;
            }
        };
    }
};

// ---------------- NSSA 双 ABR 与 P-bit ----------------
export const nssaPbit = {
    id: 'nssa-pbit',
    title: 'NSSA 7 转 5 · P-bit 与 FA 双门禁',
    subtitle: '只有 P=1 且 FA≠0 的 7 类才会被翻译；ABR 下发的 7 类缺省锁死 P=0，否则双 ABR 间会形成默认路由环路。',
    duration: 16,
    options: [{ id: 'case', label: '场景', value: 'ext', choices: [
        { value: 'ext', label: '分支外部路由' },
        { value: 'fa0', label: 'FA = 0' },
        { value: 'def0', label: 'ABR 缺省 P=0' },
        { value: 'def1', label: '假设 P=1 💥' }
    ] }],
    build(ctx, options) {
        const { models, THREE } = ctx;
        const a0 = models.area({ radius: 4, color: C.area0, label: 'Area 0' });
        a0.position.set(0, 0, -7);
        ctx.part(a0, { id: 'a0', name: 'Area 0', desc: '骨干区域。', explode: [0, 0, -2], focus: false });
        const nssa = models.area({ radius: 5.5, color: C.lsa7, label: 'Area 1 · NSSA（双 ABR）' });
        nssa.position.set(0, 0, 4);
        ctx.part(nssa, { id: 'nssa', name: 'NSSA 区域', desc: '两台 ABR 同时连接骨干；Router-ID 较大的 ABR-2 担任 Translator。', explode: [0, -1, 2], focus: false });
        const place = (object, x, z, id, name, desc, explode) => { object.position.set(x, 0, z); ctx.part(object, { id, name, desc, explode }); return object; };
        const core = place(models.router({ color: C.area0, label: 'Core', sub: '骨干路由器' }), 0, -7, 'core', '骨干路由器', '学习翻译后的 5 类 LSA。', [0, 0, -2]);
        const abr1 = place(models.router({ color: C.lsa3, label: 'ABR-1', sub: 'RID 3.3.3.3' }), -5, -1.2, 'abr1', 'ABR-1 (3.3.3.3)', '配置了 nssa default-route-advertise，向 NSSA 下发 7 类缺省。', [-2, 0, 0]);
        const abr2 = place(models.router({ color: C.lsa3, label: 'ABR-2 Translator', sub: 'RID 4.4.4.4' }), 5, -1.2, 'abr2', 'ABR-2 (4.4.4.4) 翻译者', 'NSSA 中 Router-ID 最大的 ABR 负责 7 转 5。', [2, 0, 0]);
        const inner = place(models.switchBox({ color: C.lsa7, label: 'NSSA 内部' }), 0, 3.5, 'inner', 'NSSA 内部网络', '7 类 LSA 在这里泛洪。', [0, 0, 1]);
        const asbr = place(models.router({ color: C.lsa7, label: 'R5 ASBR', sub: 'import-route' }), 0, 7.5, 'asbr', 'R5 分支 ASBR', '以 7 类 LSA 引入 192.168.100.0/24。', [0, 0, 2]);
        [[core, abr1], [core, abr2], [abr1, inner], [abr2, inner], [inner, asbr]].forEach(([a, b]) => ctx.link(a, b, { color: 0x334155, radius: 0.06 }));
        const gate = models.gate({ color: C.warn, label: '7 转 5 双门禁', width: 2.6, height: 2.4 });
        gate.position.set(5, 0.2, 1.4);
        ctx.part(gate, { id: 'gate', name: '翻译门禁 (RFC 3101)', desc: '必须同时满足：P-bit = 1 且 FA ≠ 0.0.0.0，缺一不可。', explode: [1.5, 0.5, 1] });
        const cases = {
            ext: { origin: asbr, p: 1, fa: '10.9.9.9', label: '7类 192.168.100/24', pass: true },
            fa0: { origin: asbr, p: 1, fa: '0.0.0.0', label: '7类 FA=0', pass: false },
            def0: { origin: abr1, p: 0, fa: '0.0.0.0', label: '7类缺省 P=0', pass: false },
            def1: { origin: abr1, p: 1, fa: '3.3.3.3', label: '7类缺省 P=1 ?!', pass: true }
        };
        const scenario = cases[options.case];
        const check = ctx.makeLabel(`P-bit = ${scenario.p}  ${scenario.p ? '✓' : '✗'}\nFA = ${scenario.fa}  ${scenario.fa !== '0.0.0.0' ? '✓' : '✗'}`, { size: 0.26, mono: true, border: scenario.pass ? '#22c55e' : '#ef4444' });
        check.position.set(0, 2.3, 0);
        gate.add(check);
        const seven = ctx.packet({ color: C.lsa7, label: scenario.label });
        const five = ctx.packet({ color: C.lsa5, label: options.case === 'def1' ? '5类缺省 Adv=4.4.4.4' : '5类 Adv=4.4.4.4' });
        const five2 = ctx.packet({ color: C.lsa5, label: '' });
        const loop = ctx.packet({ color: C.bad, label: 'TTL 64' });
        const reject = models.shield({ radius: 0.8 });
        reject.position.set(5, 1, 1.4);
        reject.userData.noDim = true;
        ctx.add(reject);
        const stepsByCase = {
            ext: [
                { at: 0, title: 'R5 引入外部路由', text: 'NSSA 内不能产生 5 类，R5 生成 7 类：P=1，FA 取外部下一跳或 Loopback。' },
                { at: 0.3, title: 'Translator 检查', text: 'ABR-2 Router-ID 更大，承担翻译。P=1 ✓，FA≠0 ✓。' },
                { at: 0.45, title: '7 转 5 注入骨干', text: '通告者改为 ABR-2，但保留原 FA，骨干可以直接递归到分支的真实下一跳。' }
            ],
            fa0: [
                { at: 0, title: 'FA 为 0 的 7 类', text: '例如未按 RFC 3101 推选出可用地址（下一跳 → Loopback → 最大 IfIndex 接口）。' },
                { at: 0.3, title: '门禁拒绝', text: 'FA = 0.0.0.0：翻译后全网无法定位原始节点，ABR 直接拒绝 7 转 5。路由被锁死在 NSSA 内。' }
            ],
            def0: [
                { at: 0, title: 'ABR-1 下发 7 类缺省', text: '这条缺省是喂给 NSSA 内部设备出网用的：协议强制 P=0、FA=0.0.0.0。' },
                { at: 0.3, title: 'ABR-2 不翻译', text: '门禁不通过，默认路由不会回灌骨干，NSSA 内部流量正常经 ABR 出区域。' }
            ],
            def1: [
                { at: 0, title: '假设：缺省带了 P=1', text: '错误设计：ABR-1 的 7 类缺省允许传播。' },
                { at: 0.3, title: 'ABR-2 误以为是外部路由', text: '门禁通过，ABR-2 把它翻译成 5 类缺省注入骨干。' },
                { at: 0.45, title: '骨干学到指向 ABR-2 的缺省', text: 'Core 乃至 ABR-1 都把去往外网的流量交给 ABR-2。' },
                { at: 0.6, title: '乒乓环路', text: 'ABR-2 的缺省来自 ABR-1 的 7 类，又把流量扔回 ABR-1……直到 TTL 耗尽。这就是 P-bit 必须为 0 的原因。' }
            ]
        };
        ctx.setSteps(stepsByCase[options.case]);
        ctx.camera3([0, 14, 16], [0, 0, 0]);
        return {
            update(t) {
                const up = object => ctx.posOf(object).add(new THREE.Vector3(0, 0.7, 0));
                const origin = up(scenario.origin);
                const toGate = scenario.origin === asbr ? [origin, up(inner), up(abr2)] : [origin, up(inner), up(abr2)];
                seven.set(span(t, 0.02, 0.3), v => pathPoint(toGate, v, 0.8), t <= 0.31);
                const passed = scenario.pass && t > 0.32;
                five.set(span(t, 0.33, 0.48), v => pathPoint([up(abr2), up(core), up(abr1)], v, 1), passed && t <= 0.48);
                five2.set(span(t, 0.33, 0.42), v => pathPoint([up(abr2), up(core)], v, 0.5), passed && t <= 0.42);
                reject.visible = !scenario.pass && t > 0.3;
                reject.scale.setScalar(ease(span(t, 0.3, 0.34)) || 0.001);
                if (options.case === 'def1') {
                    const cycle = span(t, 0.6, 0.98);
                    const loops = 4;
                    const local = (cycle * loops) % 1;
                    const ring = [up(abr1), up(core), up(abr2), up(inner), up(abr1)];
                    loop.set(local, v => pathPoint(ring, v, 0.9), t >= 0.6 && t < 0.98);
                    loop.relabel(`TTL ${Math.max(1, 64 - Math.floor(cycle * loops * 16))}`);
                } else {
                    loop.hide();
                }
            }
        };
    }
};

// ---------------- MPLS-TE：TE-LSA → TEDB → CSPF → RSVP ----------------
const TE_NODES = { A: [-9, 0, 0], B: [-3.5, 0, -4.5], C: [-3.5, 0, 4.5], D: [3.5, 0, -4.5], E: [3.5, 0, 4.5], F: [9, 0, 0] };
const TE_LINKS = [
    ['A', 'B', 1000, 'gold', 10, 1], ['A', 'C', 400, 'silver', 10, 2], ['B', 'D', 1000, 'gold', 10, 1], ['C', 'E', 1000, 'gold', 15, 3],
    ['D', 'F', 300, 'gold', 10, 4], ['E', 'F', 1000, 'silver', 10, 3], ['B', 'E', 600, 'gold', 20, 5], ['C', 'D', 800, 'silver', 5, 2]
];

function cspf(links, from, to) {
    const dist = { [from]: 0 };
    const prev = {};
    const done = new Set();
    while (true) {
        const current = Object.keys(dist).filter(node => !done.has(node)).sort((a, b) => dist[a] - dist[b])[0];
        if (!current) return null;
        if (current === to) break;
        done.add(current);
        links.forEach(link => {
            const [a, b, , , metric] = link;
            const other = a === current ? b : (b === current ? a : null);
            if (!other || done.has(other)) return;
            const cost = dist[current] + metric;
            if (dist[other] === undefined || cost < dist[other]) { dist[other] = cost; prev[other] = { node: current, link }; }
        });
    }
    const nodes = [to];
    const used = [];
    let cursor = to;
    while (prev[cursor]) { used.unshift(prev[cursor].link); cursor = prev[cursor].node; nodes.unshift(cursor); }
    return { nodes, links: used, cost: dist[to] };
}

export const teCspf = {
    id: 'te-cspf',
    title: 'OSPF-TE · CSPF 约束算路',
    subtitle: 'Type-10 TE-LSA 在区域内同步链路约束 → TEDB → CSPF 剪枝后跑 SPF → RSVP-TE 沿 ERO 逐跳预留。',
    duration: 16,
    options: [
        { id: 'bw', label: '带宽需求', type: 'range', value: 500, min: 0, max: 1000, step: 100, format: value => `${value}M` },
        { id: 'color', label: '亲和属性', value: 'any', choices: [{ value: 'any', label: '任意颜色' }, { value: 'gold', label: '仅金色' }] },
        { id: 'srlg', label: '保护', value: 'off', choices: [{ value: 'off', label: '仅主路径' }, { value: 'on', label: 'SRLG 分离备份' }] }
    ],
    build(ctx, options) {
        const { models, THREE } = ctx;
        const nodes = {};
        Object.entries(TE_NODES).forEach(([name, pos]) => {
            const router = models.router({ color: name === 'A' ? C.ok : (name === 'F' ? C.warn : C.info), label: name === 'A' ? 'A 隧道起点' : (name === 'F' ? 'F 目的地' : name), sub: `LSR-ID ${'ABCDEF'.indexOf(name) + 1}.${'ABCDEF'.indexOf(name) + 1}.${'ABCDEF'.indexOf(name) + 1}.${'ABCDEF'.indexOf(name) + 1}` });
            router.position.set(...pos);
            ctx.part(router, { id: name, name: `节点 ${name}`, desc: name === 'A' ? 'Head-end：持有 TEDB，运行 CSPF，发起 RSVP Path。' : 'TE-LSA 通告者：泛洪自己每条链路的约束属性。', explode: [pos[0] * 0.25, 0, pos[2] * 0.3] });
            nodes[name] = router;
        });
        const eligible = link => link[2] >= options.bw && (options.color === 'any' || link[3] === 'gold');
        const links = TE_LINKS.map(link => {
            const [a, b, bw, color, metric, srlg] = link;
            const colorHex = color === 'gold' ? 0xfbbf24 : 0xcbd5e1;
            const record = ctx.link(nodes[a], nodes[b], { color: colorHex, radius: 0.07, opacity: 0.9, emissive: 0.5 });
            const tag = ctx.makeLabel(`${bw}M · ${color === 'gold' ? '金' : '银'} · TE${metric} · SRLG${srlg}`, { size: 0.2, mono: true });
            ctx.add(tag);
            return { link, record, tag, ok: eligible(link) };
        });
        const pruned = TE_LINKS.filter(eligible);
        const primary = cspf(pruned, 'A', 'F');
        let backup = null;
        if (primary && options.srlg === 'on') {
            const risky = new Set(primary.links.map(link => link[5]));
            backup = cspf(pruned.filter(link => !primary.links.includes(link) && !risky.has(link[5])), 'A', 'F');
        }
        const tedb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: C.opaque, emissive: C.opaque, emissiveIntensity: 0.8, transparent: true, opacity: 0.35 }));
        tedb.position.set(-9, 2.6, -2.6);
        const tedbTag = ctx.makeLabel('TEDB', { size: 0.3, bold: true, border: '#22d3ee' });
        tedbTag.position.y = 1.1;
        tedb.add(tedbTag);
        ctx.part(tedb, { id: 'tedb', name: 'TEDB 流量工程数据库', desc: '由 Type-10 TE-LSA 拼装：每条链路的最大/可预留/未预留带宽、TE Metric、管理组、SRLG。', explode: [-1, 1.5, -1] });
        const floods = TE_LINKS.flatMap(([a, b], index) => [
            { from: a, to: b, start: 0.02 + (index % 4) * 0.035, packet: ctx.packet({ color: C.opaque, size: 0.13, trail: 2 }) },
            { from: b, to: a, start: 0.04 + (index % 4) * 0.035, packet: ctx.packet({ color: C.opaque, size: 0.13, trail: 2 }) }
        ]);
        const pathMsg = ctx.packet({ color: C.ok, label: 'RSVP Path' });
        const resvMsg = ctx.packet({ color: C.info, label: 'Resv 分配标签' });
        const fail = models.shield({ radius: 1 });
        fail.position.set(9, 2.2, 0);
        fail.userData.noDim = true;
        ctx.add(fail);
        const describe = path => path ? `${path.nodes.join(' → ')}（TE Metric ${path.cost}）` : '无可用路径';
        ctx.extraPanel(`<div class="dk-mini-title">CSPF 结果</div><div class="dk-mini-note">剪枝后剩余 ${pruned.length}/${TE_LINKS.length} 条链路</div><div class="dk-result ${primary ? 'is-ok' : 'is-bad'}">主路径：${describe(primary)}</div>${options.srlg === 'on' ? `<div class="dk-result ${backup ? 'is-warn' : 'is-bad'}">SRLG 分离备份：${describe(backup)}</div>` : ''}`);
        ctx.setSteps([
            { at: 0, title: 'TE-LSA 泛洪（Type-10）', text: '每台路由器把链路带宽、颜色、TE Metric、SRLG 封装进 Link TLV，只在本区域内泛洪。' },
            { at: 0.24, title: 'CSPF 剪枝', text: `剔除带宽 < ${options.bw}M ${options.color === 'gold' ? '或颜色不是金色 ' : ''}的链路。` },
            { at: 0.45, title: primary ? '在剩余拓扑上跑 SPF' : 'CSPF Path Calculation Failed', text: primary ? `得到 ERO：${describe(primary)}${backup ? `；备份路径与主路径无共享风险链路组。` : ''}` : '约束过严，剩余拓扑不连通，隧道保持 Down。' },
            ...(primary ? [{ at: 0.62, title: 'RSVP Path', text: '沿 ERO 逐跳发送 Path 消息，检查并预占带宽。' }, { at: 0.8, title: 'RSVP Resv', text: '目的端回送 Resv，逐跳分配标签，CR-LSP 建立。' }] : [])
        ]);
        ctx.setLegend([{ color: 0xfbbf24, label: '金色链路' }, { color: 0xcbd5e1, label: '银色链路' }, { color: C.ok, label: '主路径' }, { color: C.warn, label: 'SRLG 备份' }]);
        ctx.camera3([0, 15, 15], [0, 0, 0]);
        const onPath = (path, link) => path && path.links.includes(link);
        return {
            update(t) {
                const up = name => ctx.posOf(nodes[name]).add(new THREE.Vector3(0, 0.7, 0));
                floods.forEach(item => item.packet.set(span(t, item.start, item.start + 0.1), v => pathPoint([up(item.from), up(item.to)], v, 0.5), t >= item.start && t <= item.start + 0.1));
                tedb.scale.setScalar(0.3 + 0.7 * ease(span(t, 0.02, 0.24)));
                tedb.rotation.y = t * 6;
                const prune = ease(span(t, 0.24, 0.36));
                const reveal = ease(span(t, 0.45, 0.6));
                links.forEach(({ link, record, tag, ok }) => {
                    const a = ctx.posOf(nodes[link[0]]);
                    const b = ctx.posOf(nodes[link[1]]);
                    tag.position.copy(a.lerp(b, 0.5)).add(new THREE.Vector3(0, 0.55, 0));
                    const material = record.holder.material;
                    let color = new THREE.Color(link[3] === 'gold' ? 0xfbbf24 : 0xcbd5e1);
                    let opacity = 0.9;
                    if (!ok) { color = color.lerp(new THREE.Color(C.bad), prune); opacity = 0.9 - 0.75 * prune; }
                    if (onPath(primary, link)) color = color.lerp(new THREE.Color(C.ok), reveal);
                    else if (onPath(backup, link)) color = color.lerp(new THREE.Color(C.warn), reveal);
                    material.color.copy(color);
                    material.emissive.copy(color);
                    material.opacity = opacity;
                    material.transparent = true;
                    tag.material.opacity = ok ? 1 : 1 - 0.7 * prune;
                });
                const route = primary ? primary.nodes.map(up) : null;
                pathMsg.set(span(t, 0.62, 0.78), v => pathPoint(route, v, 0.6), Boolean(route) && t >= 0.62 && t <= 0.78);
                resvMsg.set(span(t, 0.8, 0.96), v => pathPoint([...(route || [])].reverse(), v, 0.6), Boolean(route) && t >= 0.8 && t <= 0.96);
                fail.visible = !primary && t >= 0.45;
            }
        };
    }
};

// ---------------- 邻居震荡抑制 vs 泛洪抑制 ----------------
const FLAPS = [[3, 5], [7, 9], [11, 13], [15, 17], [19, 21], [23, 25], [27, 29], [31, 33]];
const SIM_SECONDS = 70;

function flapSimulation(mode) {
    const linkUp = s => !FLAPS.some(([down, up]) => s >= down && s < up);
    const timeline = [];
    let onPrimary = true;
    let switches = 0;
    let flapCount = 0;
    let suppressedUntil = -1;
    let nextSpf = 0;
    let backoff = 1;
    for (let s = 0; s <= SIM_SECONDS; s += 0.1) {
        const sec = Math.round(s * 10) / 10;
        const up = linkUp(sec);
        if (FLAPS.some(([down]) => Math.abs(down - sec) < 0.05)) flapCount += 1;
        let wantPrimary = up;
        if (mode === 'damping' && flapCount >= 3) {
            if (suppressedUntil < 0) suppressedUntil = 33 + 12; // 最后一次震荡后满足 resume-interval（演示缩放）才恢复
            if (sec < suppressedUntil) wantPrimary = false;
        }
        let next = onPrimary;
        if (!up) next = false; // BFD + FRR：链路断开时数据面立即切到备链
        else if (mode === 'none') next = wantPrimary;
        else if (mode === 'throttle') {
            if (sec >= nextSpf && wantPrimary !== onPrimary) { next = wantPrimary; nextSpf = sec + backoff; backoff = Math.min(5, backoff * 2); }
        } else next = wantPrimary;
        if (next !== onPrimary) switches += 1;
        onPrimary = next;
        timeline.push({ s: sec, up, onPrimary, switches, cost: mode === 'damping' && flapCount >= 3 && sec < suppressedUntil ? 65535 : 10 });
    }
    return timeline;
}

export const flapDamping = {
    id: 'flap-damping',
    title: '邻居震荡抑制 vs LSA 泛洪抑制',
    subtitle: '弱光链路每 2 秒闪断一次：节流只能让 CPU 喘口气，只有把 Cost 拉到 65535 才能把流量钉在备链上。',
    duration: 24,
    options: [{ id: 'mode', label: '部署', value: 'throttle', choices: [
        { value: 'none', label: '仅快速收敛' },
        { value: 'throttle', label: '+ 泛洪抑制' },
        { value: 'damping', label: '+ 震荡抑制' }
    ] }],
    build(ctx, options) {
        const { models, THREE } = ctx;
        const r1 = models.router({ color: C.info, label: 'R1 核心', sub: '业务网关' });
        r1.position.set(-7, 0, 0);
        ctx.part(r1, { id: 'r1', name: 'R1', desc: '流量入口。', explode: [-2, 0, 0] });
        const r2 = models.router({ color: C.ok, label: 'R2 汇聚', sub: '数据中心' });
        r2.position.set(7, 0, 0);
        ctx.part(r2, { id: 'r2', name: 'R2', desc: '流量出口。', explode: [2, 0, 0] });
        const relay = (z, label, color, desc) => {
            const hub = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1 }));
            hub.position.set(0, 0.4, z);
            const tag = ctx.makeLabel(label, { size: 0.26, border: `#${new THREE.Color(color).getHexString()}` });
            tag.position.y = 0.8;
            hub.add(tag);
            ctx.part(hub, { id: label, name: label, desc, explode: [0, 0, z * 0.4] });
            return hub;
        };
        const p = relay(-3.5, '主链路 Cost 10（弱光闪断）', C.area0, '光模块衰耗临界，Up 2 秒又 Down 2 秒，反复几十分钟。');
        const b = relay(3.5, '备链路 Cost 100（稳定）', C.warn, 'MSTP 专线，较慢但极其稳定。');
        const links = [ctx.link(r1, p, { color: C.area0, radius: 0.08 }), ctx.link(p, r2, { color: C.area0, radius: 0.08 }), ctx.link(r1, b, { color: C.warn, radius: 0.08 }), ctx.link(b, r2, { color: C.warn, radius: 0.08 })];
        const sim = flapSimulation(options.mode);
        const sample = t => sim[Math.min(sim.length - 1, Math.floor(t * (sim.length - 1)))];
        const stream = Array.from({ length: 10 }, () => ctx.packet({ color: C.ok, size: 0.15, trail: 3 }));
        const panel = ctx.extraPanel('<div class="dk-mini-title">60 秒时间线</div><canvas class="dk-chart" width="520" height="150"></canvas><div class="dk-chart-stats"></div>');
        const canvas = panel.querySelector('canvas');
        const stats = panel.querySelector('.dk-chart-stats');
        const draw = t => {
            const g = canvas.getContext('2d');
            const w = canvas.width;
            g.clearRect(0, 0, w, canvas.height);
            g.font = '20px system-ui';
            g.fillStyle = '#94a3b8';
            g.fillText('主链路', 4, 40);
            g.fillText('流量', 4, 100);
            sim.forEach((row, index) => {
                const x = 70 + index / sim.length * (w - 80);
                g.fillStyle = row.up ? '#22c55e' : '#ef4444';
                g.fillRect(x, 24, (w - 80) / sim.length + 0.6, 22);
                g.fillStyle = row.onPrimary ? '#3b82f6' : '#f59e0b';
                g.fillRect(x, 84, (w - 80) / sim.length + 0.6, 22);
                if (row.cost > 10) { g.fillStyle = 'rgba(239,68,68,0.35)'; g.fillRect(x, 50, (w - 80) / sim.length + 0.6, 30); }
            });
            const cursor = 70 + t * (w - 80);
            g.fillStyle = '#f8fafc';
            g.fillRect(cursor - 1, 10, 3, 110);
            g.fillStyle = '#94a3b8';
            g.fillText('0s', 70, 140);
            g.fillText(`${SIM_SECONDS}s`, w - 50, 140);
            const row = sample(t);
            stats.innerHTML = `<span>流量切换 <b class="${row.switches > 6 ? 'is-bad' : 'is-ok'}">${row.switches}</b> 次</span><span>主链路宣告 Cost <b class="${row.cost > 10 ? 'is-warn' : ''}">${row.cost}</b></span><span>${row.s.toFixed(0)}s</span>`;
        };
        ctx.setSteps({
            none: [
                { at: 0, title: '只有快速收敛', text: 'BFD + FRR 断链即切，链路一恢复 SPF 又立刻把流量拉回主链。' },
                { at: 0.1, title: '每次闪断都横跳两次', text: '流量在主备之间反复切换，TCP 乱序重传，业务体验极差。' }
            ],
            throttle: [
                { at: 0, title: '叠加 LSA/SPF 智能定时器', text: '泛洪与算路被指数退避节流，控制面 CPU 得到保护。' },
                { at: 0.15, title: '致命漏洞', text: '定时器一放行，SPF 仍然发现主链 Cost 10 < 100 —— 流量照样被拉回坏链。节流只管“算得别太累”，不管“选谁”。' }
            ],
            damping: [
                { at: 0, title: '叠加 suppress-flapping peer', text: '检测间隔内连续震荡达到阈值（演示为 3 次，华为缺省 10 次）即判定为病态链路。' },
                { at: 0.16, title: 'Hold-max-cost', text: '邻居仍可 Full，但本端在 1 类 LSA 中把该链路 Cost 宣告为 65535，全网算路都会避开它。' },
                { at: 0.5, title: '流量钉死在备链', text: '无论主链怎么闪，业务都稳定走备链：0 横跳。' },
                { at: 0.65, title: '恢复', text: '持续稳定超过 resume-interval 后，Cost 恢复为 10，流量平稳回切。' }
            ]
        }[options.mode]);
        ctx.camera3([0, 11, 14], [0, 0, 0]);
        return {
            update(t) {
                const row = sample(t);
                const primaryMaterials = [links[0], links[1]].map(link => link.holder.material);
                primaryMaterials.forEach(material => {
                    material.color.set(row.up ? (row.cost > 10 ? C.warn : C.area0) : C.bad);
                    material.emissive.set(row.up ? (row.cost > 10 ? C.warn : C.area0) : C.bad);
                    material.opacity = row.up ? 0.9 : 0.35;
                    material.transparent = true;
                });
                stream.forEach((packet, index) => {
                    const local = (t * 18 + index / stream.length) % 1;
                    const back = sample(Math.max(0, t - (local * 0.05)));
                    const relayNode = back.onPrimary ? p : b;
                    const points = [ctx.posOf(r1), ctx.posOf(relayNode), ctx.posOf(r2)].map(v => v.add(new THREE.Vector3(0, 0.6, 0)));
                    packet.set(local, v => pathPoint(points, v, 0.3));
                });
                draw(t);
            }
        };
    }
};

// ---------------- 3/5 类 LSA 过滤阻断点 ----------------
const FILTERS = {
    1: { at: 'R1', lsa: 5, name: '① filter-policy export', where: 'ASBR R1 · ospf 进程', cmd: 'filter-policy ip-prefix LIMIT_STATIC export static', lsdb: [], rib: ['R1'] },
    2: { at: 'R1', lsa: 5, name: '② asbr-summary not-advertise', where: 'ASBR R1 · ospf 进程', cmd: 'asbr-summary 172.16.0.0 255.255.0.0 not-advertise', lsdb: [], rib: ['R1'] },
    8: { at: 'R2>', lsa: 5, name: '⑧ ospf filter-lsa-out ase', where: 'R2 出接口 G0/0/2', cmd: 'ospf filter-lsa-out ase acl 2001', lsdb: ['R1', 'R2'], rib: ['R1', 'R2'] },
    7: { at: 'R3', lsa: 5, name: '⑦ filter-policy import', where: 'R3 · ospf 进程（只拦路由表）', cmd: 'filter-policy 2002 import', lsdb: ['R1', 'R2', 'R3', 'R4', 'R5'], rib: ['R1', 'R2', 'R4', 'R5'] },
    3: { at: 'R2', lsa: 3, name: '③ abr-summary not-advertise', where: 'ABR R2 · area 1 视图', cmd: 'abr-summary 10.10.0.0 255.255.0.0 not-advertise', lsdb: ['R1', 'R2'], rib: ['R1', 'R2'] },
    4: { at: 'R2', lsa: 3, name: '④ filter export', where: 'ABR R2 · area 1 视图', cmd: 'filter ip-prefix PREFIX_STOP_10 export', lsdb: ['R1', 'R2'], rib: ['R1', 'R2'] },
    5: { at: 'R2>', lsa: 3, name: '⑤ ospf filter-lsa-out summary', where: 'R2 出接口 G0/0/2', cmd: 'ospf filter-lsa-out summary acl 2000', lsdb: ['R1', 'R2'], rib: ['R1', 'R2'] },
    6: { at: 'R4', lsa: 3, name: '⑥ filter import', where: 'ABR R4 · area 2 视图', cmd: 'filter ip-prefix BLOCK_INTO_A2 import', lsdb: ['R1', 'R2', 'R3', 'R4'], rib: ['R1', 'R2', 'R3', 'R4'] }
};

export const filterPoints = {
    id: 'filter-points',
    title: 'OSPF 过滤 · 八个阻断点',
    subtitle: '拓扑级过滤改写下游 LSDB；filter-policy import 只拦截本机写入路由表，LSA 照常向下游泛洪。',
    duration: 14,
    options: [{ id: 'point', label: '阻断点', value: 7, choices: [1, 2, 8, 7, 3, 4, 5, 6].map(value => ({ value, label: '①②③④⑤⑥⑦⑧'[value - 1], title: FILTERS[value].name })) }],
    build(ctx, options) {
        const { models, THREE } = ctx;
        const filter = FILTERS[options.point];
        const names = ['R1', 'R2', 'R3', 'R4', 'R5'];
        const xs = [-10, -4, 2, 8, 13.5];
        const roles = { R1: 'ASBR · Area 1', R2: 'ABR-1', R3: 'Area 0 普通路由器', R4: 'ABR-2', R5: 'Area 2' };
        const areas = [[-8, 3.4, C.area1, 'Area 1'], [2, 4.2, C.area0, 'Area 0'], [12.5, 2.8, C.area2, 'Area 2']].map(([x, r, color, label], index) => {
            const area = models.area({ radius: r, color, label });
            area.position.set(x, 0, 0);
            ctx.part(area, { id: label, name: label, desc: '', explode: [0, -1 - index * 0.2, 0], focus: false });
            return area;
        });
        const routers = {};
        const chips = {};
        names.forEach((name, index) => {
            const router = models.router({ color: name === 'R2' || name === 'R4' ? C.lsa3 : (name === 'R1' ? C.lsa5 : C.info), label: name, sub: roles[name] });
            router.position.set(xs[index], 0, 0);
            ctx.part(router, { id: name, name: `${name} ${roles[name]}`, desc: '', explode: [0, 0.8, 0] });
            routers[name] = router;
            const lsdb = models.stack({ color: C.ok, count: 3, label: 'LSDB' });
            lsdb.position.set(-0.7, 1.8, 0.6);
            const rib = models.stack({ color: C.info, count: 2, label: 'RIB' });
            rib.position.set(0.7, 1.8, 0.6);
            router.add(lsdb, rib);
            chips[name] = { lsdb, rib };
        });
        const ext = models.cloud({ label: '外部 172.16.1.0/24', scale: 0.8 });
        ext.position.set(-15, 0.5, 0);
        ctx.part(ext, { id: 'ext', name: '外部路由', desc: '经 import-route static 引入。', explode: [-2, 0.5, 0] });
        const net1 = models.switchBox({ color: C.area1, label: '10.10.1.0/24' });
        net1.position.set(-7, 0, 3.2);
        ctx.part(net1, { id: 'net1', name: 'Area 1 业务网段', desc: '被 ABR-1 折叠为 3 类 LSA 的前缀。', explode: [0, 0.5, 1] });
        [[ext, routers.R1], [routers.R1, routers.R2], [routers.R2, routers.R3], [routers.R3, routers.R4], [routers.R4, routers.R5], [net1, routers.R1], [net1, routers.R2]].forEach(([a, b]) => ctx.link(a, b, { color: 0x334155, radius: 0.06 }));
        // 八个阻断点信标
        const beaconAnchor = key => key === 'R2>' ? { x: -1, base: 'R2' } : { x: xs[names.indexOf(key)], base: key };
        Object.entries(FILTERS).forEach(([id, item]) => {
            const anchor = beaconAnchor(item.at);
            const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 4), new THREE.MeshStandardMaterial({ color: Number(id) === options.point ? C.bad : C.muted, emissive: Number(id) === options.point ? C.bad : C.muted, emissiveIntensity: Number(id) === options.point ? 1.6 : 0.3 }));
            const sameAnchor = Object.entries(FILTERS).filter(([, other]) => other.at === item.at).map(([key]) => key);
            beacon.position.set(anchor.x + (sameAnchor.indexOf(id) - (sameAnchor.length - 1) / 2) * 0.8, -0.3, -2.4);
            beacon.rotation.x = Math.PI;
            const tag = ctx.makeLabel('①②③④⑤⑥⑦⑧'[Number(id) - 1], { size: 0.32, bold: true, border: Number(id) === options.point ? '#ef4444' : '#64748b' });
            tag.position.y = -0.7;
            beacon.add(tag);
            ctx.part(beacon, { id: `f${id}`, name: item.name, desc: `${item.where}：只影响 ${item.lsa} 类 LSA。`, rows: [['配置位置', item.where], ['命令', `<code>${item.cmd}</code>`], ['是否改 LSDB', Number(id) === 7 ? '否（仅本机 RIB）' : '是'], ['LSDB 受影响', names.filter(name => !item.lsdb.includes(name)).join('、') || '—']], explode: [0, -0.5, -1] });
        });
        const isFive = filter.lsa === 5;
        const route = isFive ? [ext, routers.R1, routers.R2, routers.R3, routers.R4, routers.R5] : [net1, routers.R2, routers.R3, routers.R4, routers.R5];
        const stopIndex = (() => {
            if (options.point === 7) return route.length - 1;
            if (filter.at === 'R2>') return route.indexOf(routers.R2) + 0.45;
            return route.indexOf(routers[filter.at]);
        })();
        const packet = ctx.packet({ color: isFive ? C.lsa5 : C.lsa3, label: isFive ? '5类 172.16.1.0/24' : '3类 10.10.1.0/24' });
        const shield = models.shield({ radius: 0.85 });
        shield.userData.noDim = true;
        ctx.add(shield);
        const arrival = name => {
            const index = route.indexOf(routers[name]);
            return index < 0 ? 0.02 : 0.05 + index / (route.length - 1) * 0.6;
        };
        ctx.extraPanel(`<div class="dk-mini-title">${filter.name}</div><div class="dk-mini-note">${filter.where}</div><code class="dk-code">${filter.cmd}</code><div class="dk-mini-note">LSDB 有：${filter.lsdb.join('、') || '无'}<br>路由表有：${filter.rib.join('、')}</div>`);
        ctx.setSteps([
            { at: 0, title: isFive ? 'ASBR 引入外部路由' : 'ABR 折叠 Area 1 网段', text: isFive ? '5 类 LSA 将泛洪整个自治系统。' : 'R2 把 10.10.1.0/24 转译为 3 类 LSA 送往骨干。' },
            { at: 0.3, title: options.point === 7 ? 'R3 照常收下并继续泛洪' : '遇到阻断点', text: options.point === 7 ? 'filter-policy import 不改 LSDB：R3 只是在写入自己的 IP 路由表时把它拦下，R4、R5 依然能学到。' : `${filter.name}（${filter.where}）在这里截断，下游设备的 LSDB 中彻底没有这条 LSA。` },
            { at: 0.7, title: '结果', text: `LSDB：${filter.lsdb.join('、') || '无设备'}；路由表：${filter.rib.join('、')}。` }
        ]);
        ctx.setLegend([{ color: C.ok, label: 'LSDB 持有' }, { color: C.info, label: 'RIB 持有' }, { color: C.muted, label: '没有' }]);
        ctx.camera3([1, 11, 17], [1, 0.5, 0]);
        return {
            update(t) {
                const points = route.map(object => ctx.posOf(object).add(new THREE.Vector3(0, 0.7, 0)));
                const maxU = Math.min(1, stopIndex / (route.length - 1));
                const u = Math.min(maxU, span(t, 0.05, 0.65));
                packet.set(u, v => pathPoint(points, v, 0.7), t >= 0.05 && t < 0.92);
                const blocked = options.point !== 7 && u >= maxU - 0.001 && t > 0.06;
                shield.visible = blocked;
                if (blocked) shield.position.copy(pathPoint(points, maxU, 0.7)).add(new THREE.Vector3(0, 0.5, 0));
                names.forEach(name => {
                    const reached = t >= arrival(name);
                    const hasLsdb = filter.lsdb.includes(name) && (reached || name === 'R1');
                    const hasRib = filter.rib.includes(name) && (reached || name === 'R1');
                    chips[name].lsdb.children.forEach(child => {
                        if (child.material?.color && !child.userData.isLabel) {
                            child.material.color.set(hasLsdb ? C.ok : C.muted);
                            if (child.material.emissive) child.material.emissive.set(hasLsdb ? C.ok : 0x000000);
                        }
                    });
                    chips[name].rib.children.forEach(child => {
                        if (child.material?.color && !child.userData.isLabel) {
                            child.material.color.set(hasRib ? C.info : C.muted);
                            if (child.material.emissive) child.material.emissive.set(hasRib ? C.info : 0x000000);
                        }
                    });
                });
            }
        };
    }
};

export const ospfScenes = [packetExplode, fsmLadder, areaFlood, faPath, drPseudonode, nssaPbit, teCspf, flapDamping, filterPoints];
