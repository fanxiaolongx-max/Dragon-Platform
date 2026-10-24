// 原图对象解释：先保留对应章节的原文，再给出协议行为和可观察的例子。
import { ETH, IP, FCS, ospfHeader, PAYLOADS } from './packet-data.js';

const plain = text => String(text || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/[*`]/g, '').trim();
const key = text => plain(text).toLowerCase().replace(/\([^)]*\)|（[^）]*）/g, '').replace(/(?:#\d+|=\s*[\d/x]+)$/, '').replace(/[^a-z0-9/#]/g, '');
const definitions = {
    'Interface MTU': 'Interface MTU 是本接口不分片即可发送的最大 IP 数据报长度，单位为字节，占 16 bit；它不是当前 DD 报文的长度，也不是链路带宽。DD 用它提前检查双方能否接收后续数据库同步报文。例：R1 接口 MTU=1500，收到 R2 宣告 MTU=9000 的 DD，按 RFC 2328 §10.6 应拒绝该 DD，邻接可能停在 ExStart/Exchange；即使这个 DD 自身只有几十字节也会被拒绝。§10.8/A.3.3 规定虚链路此字段填 0。原笔记的 ospf mtu-enable 是 Huawei VRP 的实现配置，不能当作所有设备的默认行为；排障应核对接口实际 MTU、DD 中的值与检查配置。',
    'Options': 'Options 是能力位集合，不是一个整体数值的优先级。Hello/DD 用它表明外部路由等能力；LSA 头部用它描述该 LSA 相关能力。同一位置在不同报文中可能含义不同，例如 Hello 的 N 位与 Type-7 LSA 的 P 位。阅读时要先确定当前报文/LSA 类型，再逐位解释。',
    'I': 'I 是 Init 位。首次进行 DD 主从协商时置 1，表示从这一组摘要的起点开始；协商完成后置 0。它不表示这台设备是 DR。',
    'M': 'M 是 More 位。1 表示本端之后还有 DD 摘要，0 表示本端摘要已经发完。双方发完摘要后还可能要通过 LSR/LSU 补齐完整 LSA，因此 M=0 本身不等于 Full。',
    'MS': 'MS 是 Master/Slave 位。1 为 DD 交换的 Master，0 为 Slave。双方按 Router-ID 比较，较大者成为 Master；Master 推进 DD 序列号，Slave 回显确认。这与 DR/BDR 选举是两套机制。',
    'DD Sequence Number': 'DD 序列号给每轮数据库摘要编号，避免把旧包或重复包当成下一页。Master 为初始交换选择序列号并在后续交换中递增；Slave 复制该序列号回包确认。它与 LSA 自身的 LS sequence number 不同。',
    'LSAs': '这里是一串完整 LSA。每条从 20 字节 LSA Header 开始，再跟随该类型的正文；接收方按各条 length 定位下一条，按外层 # LSAs 核对数量。LSU 可以一次运输多条 LSA，因此图上留白不代表字段长度固定。',
    'OSPF 协议有效载荷': '这是公共 OSPF 头之后的报文正文，格式由 Type 决定：Hello 携带邻居与参数，DD 携带摘要，LSR 请求三元组，LSU 运输完整 LSA，LSAck 回送头部确认。密码学认证摘要追加在 OSPF 报文尾部，不等同于此处的协议正文。',
    'Message Digest': '这是追加在 OSPF 报文之后的认证摘要，由共享密钥、认证算法与规定的报文内容计算。MD5 示例为 16 字节，HMAC-SHA256 示例为 32 字节，实际长度以所选算法为准。接收方重新计算并比较以验证完整性与身份；认证不加密原报文内容。',
    'LSA Header': '每条 LSA 的公共头部占 20 字节，包含三元组、版本、校验和、年龄与长度。DD 带头部，像交换目录来判断缺少哪一条；LSAck 带头部，像回执来确认哪一个版本已收到；LSU 才带完整 LSA。',
    'LS age': 'LS age 记录 LSA 的年龄，单位为秒。LSA 在数据库中随时间增长，转发时还计入 InfTransDelay；不是简单地每跳只加 1。MaxAge=3600 秒用于冲刷旧信息，满足移除条件后才删除。年龄会变化，因此不参与 LS checksum。',
    'LS type': 'LS type 指明 LSA 的格式和用途，并与 Link State ID、Advertising Router 一起定位对象。例如 1 为 Router-LSA，2 为 Network-LSA。LSA 公共头中占 8 bit，LSR 请求项中占 32 bit；不能把它与 OSPF 报文 Type 混淆。',
    'Link State ID': 'Link State ID 与 LS type、Advertising Router 组成 LSA 三元组。它不是一律填写路由器地址：Router-LSA 用生成者 Router-ID，Network-LSA 用 DR 接口地址，网络 Summary/External LSA 通常标识目标网络；ASBR Summary 则标识 ASBR。应结合当前 LSA 类型读值。',
    'Advertising Router': 'Advertising Router 是最初生成这条 LSA 的路由器 Router-ID，不一定是刚刚把报文转发给你的邻居。例如 R2 转发 R1 生成的 LSA，该字段仍是 R1；它与 LS type、Link State ID 共同确定对象。',
    'LS sequence number': '这是同一条 LSA 的版本号，以有符号 32 位数比较。从 0x80000001 开始递增，到 0x7FFFFFFF；同一作用域、同一三元组内优先比较序列号，较大者更新。达到上限时必须按规范冲刷旧实例再重启，不能直接无条件回绕。',
    'LS checksum': 'LS checksum 是 LSA 的 Fletcher-16 校验和，覆盖除 LS age 外的完整 LSA。它检查内容损坏，也用于序列号相同时的新旧仲裁；它不是 OSPF 整包 Checksum，也不能证明发送者身份。',
    'length': 'length 在 LSA 头部表示整条 LSA 的字节数，包含 20 字节公共头部。接收方靠它找到下一条 LSA 的起点；它不同于外层 IP Total Length 和 OSPF Packet Length。',
    'Network Mask': 'Network Mask 描述网络的掩码。在 Hello 中，广播/NBMA 接收检查要求与本接口一致，点到点与虚链路有例外；在 Network/Summary/External LSA 中，它与标识符一起说明所描述的网络。例：255.255.255.0 表示 /24。',
    'Attached Router': 'Network-LSA 中每个 Attached Router 是与该网段 DR 建立完整邻接的路由器 Router-ID，并包含 DR 自身。它不是所有接在交换机上的主机 IP。多个 32 bit 条目列出伪节点连接的路由器。',
    'Link ID': 'Router-LSA 的 Link ID 表示这条逻辑链路通向哪个对象：点到点填邻居 Router-ID，Transit 网络填 DR 接口 IP，Stub 网络填网络号，虚链路填对端 Router-ID。先看同一描述块内的 Type 才能正确解读。',
    'Link Data': 'Router-LSA 的 Link Data 进一步描述本端：有编号的点到点/Transit 链路通常填本端接口 IP，Stub 网络填掩码，无编号点到点可使用接口索引。它不是 Link ID 的重复副本。',
    'metric': 'metric 是这条链路或通告目标的开销，供 SPF/选路比较；数值越小通常越优。Router-LSA 中是本端出向链路 cost，Summary/External LSA 中是对应通告的度量。它不直接表示带宽或毫秒。',
    'E': 'E 的含义依位置而变：Options 中表示外部路由处理能力；Router-LSA 正文中标记生成者是 ASBR；External/Type-7 LSA 正文中表示外部度量类型（0 为 E1，1 为 E2）。这些位不能互相替代，必须按本图所在头部或正文识别。',
    'V': 'Router-LSA 的 V 位表示该路由器是一个完全邻接的虚链路端点。它是拓扑角色标志，不是虚拟接口的地址。',
    'B': 'Router-LSA 的 B 位标记生成者是 ABR。ABR 连接区域并生成区域间通告，但不会把本区域的 1/2 类 LSA 原样泛洪到另一区域。',
    '# links': 'Router-LSA 中的链路描述块数量。例：值为 3 表示后面应读取三个描述块；它不一定等于物理网口数量，因为一个接口可以对应不同逻辑描述。',
    '# TOS': '当前链路描述块中附加的 TOS 度量项数量，不是链路条数。普通 TOS=0 的基本度量已经有固定字段；没有额外 TOS 项时该值为 0。',
    'TOS': 'TOS 标识这条附加度量适用的历史服务类型。它不是 OSPF 报文 Type 或 LSA type；普通现代部署通常只使用基本度量，附加 TOS 项常为 0 或不存在。',
    'TOS metric': '与同一条目 TOS 对应的附加开销。它是旧式按服务类型选路的度量项，不能当作整个报文的长度或链路数量。',
    'Forwarding Address': 'Forwarding Address 指向外部目的应递归解析的转发地址。值为 0.0.0.0 时通常解析 ASBR；非零时解析该地址，且必须有合格的 OSPF 区域内/区域间可达路径。它不等于 LSA 的生成者，也不保证所有拓扑都能旁路 ASBR。',
    'External Route Tag': '外部路由标签是供策略识别的 32 bit 标记，可帮助跨协议重分发时防止路由回灌。OSPF 的基础最短路计算不把它当作 cost；只有配置的策略使用它才会影响导入导出。',
    'DN': 'DN 是向下位，主要用于 PE/CE 等 VPN 场景的环路防护，帮助识别已经向下传播的路由信息。它不是距离或节点编号；具体处理需结合对应 VPN 扩展规范。',
    'O': 'O 位表示 Opaque LSA 处理能力。Opaque LSA 为扩展应用携带信息，9/10/11 类分别具有链路、区域、AS 作用域；O=1 本身不意味着某种 TE 业务已经启用。',
    'DC': 'DC 位表示支持 Demand Circuit 相关扩展，用于按需链路的刷新/老化处理。它不表示链路当前有无业务流量。',
    'L': 'L 位用于 OSPF 链路本地信令 LLS 扩展，提示报文附带相应数据块；它不是 LSA 的 length。解释时应核对该位所在的报文与扩展规范。',
    'N/P': '同一个位置要按上下文读：Hello 中 N 表示 NSSA 能力，Type-7 LSA 中 P 表示请求向 5 类翻译传播。P=1 只是翻译条件之一，还需非零 FA、翻译者选择等条件，不能仅见该位就断定一定翻译。',
    'MC': 'MC 位表示历史 MOSPF 组播路由能力，不是“本报文使用组播发送”的标记。普通 OSPF 路由器可以使用组播地址发送 Hello 而不支持 MOSPF。',
    'MT': 'MT 位对应历史多 TOS 路由能力位置；不同扩展对 Options 位的定义与使用存在版本边界。看到此位应结合原笔记引用的规范，不要把它等同于接口 MTU。',
    'Opaque Type': 'Opaque Type 是 Link State ID 的高 8 bit，用来标识扩展应用，例如 TE 使用自己的 Opaque 类型。它与决定泛洪范围的 LSA Type=9/10/11 是不同字段。',
    'Opaque ID': 'Opaque ID 是 Link State ID 的低 24 bit，由对应扩展应用区分实例。它与 Opaque Type、Advertising Router 等一起定位通告，不能当作目的 IP 地址。',
    'Router Address IPv4': 'TE Router Address TLV 携带路由器的稳定 IPv4 标识地址，常取环回地址，供流量工程识别节点。这里的 TLV 长度 4 表示值部分 4 字节，不包含 Type/Length 自身。',
};
const fallback = new Map();
[ETH, IP, FCS, ospfHeader(1, 'null'), ospfHeader(1, 'crypto'), ...Object.values(PAYLOADS).flat()].forEach(layer => {
    layer.fields.forEach(field => { if (field.desc && !fallback.has(key(field.name))) fallback.set(key(field.name), field.desc); });
});
Object.entries(definitions).forEach(([name, desc]) => fallback.set(key(name), desc));
fallback.set(key('Version #'), fallback.get(key('Version')));
fallback.set(key('Backup Designated Router'), fallback.get(key('Backup DR')));
fallback.set(key('Neighbor'), fallback.get(key('Neighbor #1')));
fallback.set(key('Cryptographic Sequence Number'), fallback.get(key('Crypto Seq Number')));

function sourceRows(markdown, source) {
    const normalized = String(markdown || '').replace(/\r\n/g, '\n');
    const diagram = String(source).replace(/\r\n/g, '\n').trim();
    const at = normalized.indexOf(diagram);
    if (at < 0) return [];
    const rest = normalized.slice(at + diagram.length).replace(/^\s*```[^\n]*\n?/, '');
    const section = rest.split(/\n```/)[0];
    return section.split('\n').flatMap(line => {
        if (/^\s*\|/.test(line)) {
            const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(plain);
            return cells.length >= 2 ? [{ name: cells[0], text: cells.slice(1).join(' · ') }] : [];
        }
        const item = /^\s*(?:\d+\.|[-*])\s+\*\*([^*]+)\*\*\s*[：:]?\s*(.*)/.exec(line);
        return item ? [{ name: item[1], text: plain(item[2]) }] : [];
    });
}

export function explainFields(fields, { markdown = '', source = '', context = '' } = {}) {
    const rows = sourceRows(markdown, source);
    return fields.map(field => {
        const fieldKey = key(field.name);
        const row = rows.find(item => key(item.name) === fieldKey || (fieldKey && key(item.name).startsWith(fieldKey) && /位|bit/i.test(item.name)));
        const reserved = /^0+$/.test(field.name) || field.name === '（保留）';
        const repeated = field.name.includes('可重复') || /^\.+$/.test(field.name);
        let explanation = reserved ? '保留位置不承载当前定义的业务信息，发送时按本格式置 0；不要把它误读成新的协议字段。' : repeated ? '这里表示前面的条目可以继续出现，不是一个额外的数据字段。应按条目格式、计数和长度读取后续内容，原图显示的行数不代表固定长度。' : fallback.get(fieldKey);
        const layout = `${source} ${context}`;
        if (/^Type\s*=\s*9\/10\/11$/i.test(field.name)) explanation = 'Opaque LSA 的 LS Type 决定泛洪作用域：9 类留在本链路，10 类留在本区域，11 类在允许外部 LSA 的 AS 范围传播。具体携带什么扩展由 Opaque Type 决定。';
        else if (/^Type\s*=\s*1$/i.test(field.name) && /Router Address/.test(layout)) explanation = '这里是 TE TLV 的 Type=1，表示 Router Address TLV；它不是 OSPF 报文 Type=1 Hello，也不是 Router-LSA 的类型号。TLV 的值部分是后面的 4 字节 IPv4 地址。';
        else if (/^Length\s*=\s*4$/i.test(field.name) && /Router Address/.test(layout)) explanation = '这里的 TLV Length=4 只计算值部分的 4 字节 IPv4 地址，不包括 TLV 自身的 Type 和 Length 字段；它不是整条 LSA 或整个 OSPF 报文长度。';
        else if (field.name === 'Type' && /Link Data|Router-LSA/.test(layout)) explanation = 'Router-LSA 链路描述块的 Type 决定 Link ID/Link Data 怎样解释：1 点到点，2 Transit 共享网络，3 Stub 网络，4 虚链路。它不是外层 OSPF 报文 Type。';
        if (field.name === 'E' && /Forwarding Address/.test(layout)) explanation = '这里是外部 LSA 正文中的 E 位，用于选择度量类型：0 为 Type-1 外部度量，内部到转发目标的开销与外部度量一起计算；1 为 Type-2，先比较外部度量，再按规则比较内部开销。它不是 Options 的 E 位或 Router-LSA 的 ASBR 标志。';
        else if (field.name === 'E' && /# links|Router-LSA/.test(layout)) explanation = '这里是 Router-LSA 正文的 E 标志，置 1 表示生成者是 ASBR，能够引入外部路由。它与 Options 中表示外部路由能力的 E 位、外部 LSA 中表示度量类型的 E 位位置和作用都不同。';
        return {
            ...field,
            desc: explanation || row?.text || field.desc || `本图中 ${field.name} 占 ${field.bits} bit，位于 ${context || '当前结构'}。它是原图自定义的对象；下方保留了对应原文，未将它套用为其他协议的同名字段。`,
            rows: [...(row ? [['原文说明', row.text]] : []), ...(field.desc ? [['图内注释', field.desc]] : []), ...(context ? [['原文位置', context]] : [])],
        };
    });
}
