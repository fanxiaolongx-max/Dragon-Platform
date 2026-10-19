// OSPFv2 教学字段定义；示例为无 VLAN、无 IPv4 选项的封装。
export const ETH = {
    id: 'eth',
    name: '以太网帧头',
    color: 0x475569,
    desc: '二层封装：组播 224.0.0.5 对应 MAC 01:00:5E:00:00:05。',
    fields: [
        {
            name: '目的 MAC',
            bits: 48,
            value: '01:00:5E:00:00:05',
            desc: '组播 IP 224.0.0.5 映射出的组播 MAC；单播报文填写对端接口 MAC。',
        },
        { name: '源 MAC', bits: 48, desc: '发送接口的 MAC 地址。' },
        { name: 'EtherType', bits: 16, value: '0x0800', desc: '0x0800 表示上层是 IPv4。' },
    ],
};
export const IP = {
    id: 'ip',
    name: 'IPv4 头部',
    color: 0x2563eb,
    desc: 'OSPF 直接承载在 IP 之上，协议号 89，不使用 TCP/UDP。',
    fields: [
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
        {
            name: 'Destination IP',
            bits: 32,
            value: '224.0.0.5',
            desc: '224.0.0.5 AllSPFRouters；224.0.0.6 AllDRouters（仅 DR/BDR 监听）；NBMA/虚链路为单播。',
        },
    ],
};
export const FCS = {
    id: 'fcs',
    name: '以太网 FCS',
    color: 0x475569,
    desc: 'CRC-32 只保护单跳线路，路由器逐跳剥离重算。',
    fields: [
        {
            name: 'FCS (CRC-32)',
            bits: 32,
            desc: '链路层帧校验序列：能 100% 检出 ≤32 位突发错误，但路由器内部损坏后会被重新计算成“合法”。',
        },
    ],
};

export function ospfHeader(type, auth) {
    const authFields = {
        null: [
            {
                name: 'Authentication = 0',
                bits: 64,
                value: '全 0',
                desc: 'AuType=0 时填充全 0，不进行身份认证；报文仍有非密码学校验和。',
            },
        ],
        simple: [
            {
                name: 'Password（明文）',
                bits: 64,
                value: 'Huawei@1',
                desc: '明文口令直接放在这 8 字节中，抓包肉眼可见，仅能防插错线。',
            },
        ],
        crypto: [
            { name: '0', bits: 16, desc: '保留。' },
            { name: 'Key ID', bits: 8, value: '1', desc: '当前使用的密钥编号，配合 Keychain 实现平滑换密。' },
            {
                name: 'Auth Data Len',
                bits: 8,
                value: '32',
                desc: '追加在报文末尾的摘要长度（MD5 16 字节 / SHA256 32 字节）。',
            },
            {
                name: 'Crypto Seq Number',
                bits: 32,
                value: '单调递增',
                desc: '防重放：用于重放防护；具体接收规则与认证机制有关。',
            },
        ],
    }[auth];
    return {
        id: 'ospf',
        name: 'OSPF 公共头部',
        color: 0x7c3aed,
        bytes: 24,
        desc: '所有五种报文共享的 24 字节头部。',
        fields: [
            { name: 'Version', bits: 8, value: '2', desc: 'OSPFv2 固定为 2。' },
            { name: 'Type', bits: 8, value: String(type), desc: '1 Hello / 2 DD / 3 LSR / 4 LSU / 5 LSAck。' },
            { name: 'Packet Length', bits: 16, desc: '包含 24 字节头部在内的 OSPF 报文总长度。' },
            { name: 'Router ID', bits: 32, value: '1.1.1.1', desc: '发送方的 Router-ID（不是接口 IP）。' },
            { name: 'Area ID', bits: 32, value: '0.0.0.0', desc: '发包接口所属区域，两端必须一致。' },
            {
                name: 'Checksum',
                bits: 16,
                desc: '非密码学认证时，计算除 64 位认证字段外的 OSPF 报文校验和；AuType=2 时该字段置 0。',
            },
            {
                name: 'AuType',
                bits: 16,
                value: { null: '0', simple: '1', crypto: '2' }[auth],
                desc: '0 空认证 / 1 明文 / 2 密码学认证（MD5、HMAC-SHA256）。',
            },
            ...authFields,
        ],
    };
}

const LSA_HEADER = {
    id: 'lsah',
    name: 'LSA 头部 (20B)',
    color: 0x0d9488,
    bytes: 20,
    desc: 'DD 与 LSAck 的载荷就是一串 LSA 头部；三元组唯一标识一条 LSA。',
    fields: [
        {
            name: 'LS age',
            bits: 16,
            desc: '随时间老化；MaxAge=3600s 的 LSA 用于冲刷，满足移除条件后才删除；不参与 LS checksum 计算。',
        },
        {
            name: 'Options',
            bits: 8,
            desc: 'LSA 级能力标签：E 位表示外部路由能力；ASBR 标志在 Router-LSA 正文中。Type-7 的 P 位控制翻译请求。',
        },
        { name: 'LS type', bits: 8, value: '1', desc: '三元组之一：1/2/3/4/5/7，Opaque 为 9/10/11。' },
        { name: 'Link State ID', bits: 32, desc: '三元组之二：含义随类型变化（Router-ID、DR 接口 IP、网段等）。' },
        { name: 'Advertising Router', bits: 32, desc: '三元组之三：生成该 LSA 的 Router-ID。' },
        {
            name: 'LS sequence number',
            bits: 32,
            value: '0x80000001',
            desc: '有符号 32 位，越大越新，是新旧仲裁的第一依据。',
        },
        { name: 'LS checksum', bits: 16, desc: 'Fletcher-16，排除 LS age，校验除 LS age 外的 LSA 内容。' },
        { name: 'length', bits: 16, desc: 'LSA 总长度（含 20 字节头部）。' },
    ],
};

export const PAYLOADS = {
    1: [
        {
            id: 'hello',
            name: 'Hello 载荷',
            color: 0xdb2777,
            desc: '发现邻居、协商参数、维持心跳、DR/BDR 选举。',
            fields: [
                { name: 'Network Mask', bits: 32, desc: '广播/NBMA 必须一致，否则丢弃 Hello；P2P 与虚链路忽略。' },
                { name: 'HelloInterval', bits: 16, value: '10', desc: '两端必须一致；广播/P2P 10s，NBMA/P2MP 30s。' },
                { name: 'Options', bits: 8, desc: 'E/N 位必须一致：普通区 E=1，Stub E=0，NSSA E=0,N=1。' },
                { name: 'Rtr Pri', bits: 8, value: '1', desc: 'DR 优先级，0 表示放弃参选。' },
                { name: 'RouterDeadInterval', bits: 32, value: '40', desc: '缺省为 Hello×4，超时宣告邻居 Down。' },
                { name: 'Designated Router', bits: 32, desc: '本端认定的 DR 接口 IP，未选出时为 0.0.0.0。' },
                { name: 'Backup DR', bits: 32, desc: '本端认定的 BDR 接口 IP。' },
                {
                    name: 'Neighbor #1',
                    bits: 32,
                    value: '2.2.2.2',
                    desc: '近期收到 Hello 的邻居 Router-ID；看到自己的 RID 即进入 2-Way。',
                },
                { name: 'Neighbor #2', bits: 32, value: '3.3.3.3', desc: '邻居列表可以有多个。' },
            ],
        },
    ],
    2: [
        {
            id: 'dd',
            name: 'DD 载荷',
            color: 0xea580c,
            desc: '主从协商 + 交换 LSDB 摘要。',
            fields: [
                {
                    name: 'Interface MTU',
                    bits: 16,
                    desc: '开启 MTU 检查且对端 MTU 更大时，邻居卡在 ExStart/Exchange。',
                },
                { name: 'Options', bits: 8, desc: '与 Hello 相同的能力集。' },
                { name: '00000', bits: 5, desc: '保留位。' },
                { name: 'I', bits: 1, desc: 'Init：ExStart 首包置 1。' },
                { name: 'M', bits: 1, desc: 'More：后续还有 DD 报文。' },
                { name: 'MS', bits: 1, desc: 'Master/Slave：Router-ID 大者为 Master。' },
                { name: 'DD Sequence Number', bits: 32, desc: 'Master 递增，Slave 复制作为隐式确认。' },
            ],
        },
        LSA_HEADER,
    ],
    3: [
        {
            id: 'lsr',
            name: 'LSR 载荷',
            color: 0x0891b2,
            desc: '只携带 12 字节三元组：请给我该 LSA 的最新实例。',
            fields: [
                { name: 'LS type', bits: 32, value: '1', desc: '被请求 LSA 的类型（占满 32 位）。' },
                { name: 'Link State ID', bits: 32, desc: '被请求 LSA 的 Link State ID。' },
                { name: 'Advertising Router', bits: 32, desc: '被请求 LSA 的通告者。' },
                { name: 'LS type #2', bits: 32, value: '3', desc: '一个 LSR 可以连续携带多个三元组。' },
                { name: 'Link State ID #2', bits: 32 },
                { name: 'Advertising Router #2', bits: 32 },
            ],
        },
    ],
    4: [
        {
            id: 'lsu',
            name: 'LSU 载荷',
            color: 0x16a34a,
            desc: '携带完整 LSA，用于应答 LSR 或主动泛洪。',
            fields: [{ name: '# LSAs', bits: 32, value: '1', desc: '本报文包含的 LSA 条数。' }],
        },
        LSA_HEADER,
        {
            id: 'rlsa',
            name: 'Router-LSA 载荷',
            color: 0x65a30d,
            desc: '1 类 LSA：描述本路由器在该区域内的链路。',
            fields: [
                { name: '0', bits: 5, desc: '保留。' },
                { name: 'V', bits: 1, desc: '虚链路端点。' },
                { name: 'E', bits: 1, desc: '本路由器是 ASBR。' },
                { name: 'B', bits: 1, desc: '本路由器是 ABR。' },
                { name: '0', bits: 8, desc: '保留。' },
                { name: '# links', bits: 16, value: '1', desc: '本示例包含一个链路描述块。' },
                { name: 'Link ID', bits: 32, desc: 'P2P 填邻居 RID；TransNet 填 DR 接口 IP；StubNet 填网段。' },
                { name: 'Link Data', bits: 32, desc: 'P2P/TransNet 填本端接口 IP；StubNet 填掩码。' },
                { name: 'Type', bits: 8, value: '2', desc: '1 P2P / 2 Transit / 3 Stub / 4 虚链路。' },
                { name: '# TOS', bits: 8, value: '0', desc: '现代设备固定为 0。' },
                { name: 'metric', bits: 16, value: '1', desc: '该链路的开销。' },
            ],
        },
    ],
    5: [
        {
            ...LSA_HEADER,
            id: 'ack',
            name: 'LSAck 载荷 = LSA 头部',
            desc: 'LSAck 只原样拷回 20 字节头部，对方据序列号与校验和确认送达。',
        },
    ],
};

export const TYPE_NAMES = { 1: 'Hello', 2: 'DD', 3: 'LSR', 4: 'LSU', 5: 'LSAck' };
