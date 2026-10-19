import { svg, text, node, edge, region, flowDiagram } from './diagram-kit.js';
import { packetLesson } from './packet-lesson.js';
const RFC = ['RFC 2328 · OSPFv2', 'https://www.rfc-editor.org/rfc/rfc2328.html'];
const NSSA = ['RFC 3101 · NSSA', 'https://www.rfc-editor.org/rfc/rfc3101.html'];
const choice = (id, label, value, items) => ({
    id,
    label,
    value,
    choices: items.map(([value, label]) => ({ value, label })),
});
const step = (title, text, result) => ({ title, text, result });
const part = (id, name, desc, rows) => ({ id, name, desc, rows });
const fsm = {
    id: 'fsm-ladder',
    title: 'OSPF 建邻 · 报文时序与状态',
    subtitle: '对照左右两端，观察哪个事件推进状态、为什么有时停在 2-Way。',
    sources: [RFC],
    options: [
        choice('mode', '场景', 'p2p', [
            ['p2p', '点到点正常建邻'],
            ['drother', '广播网 DROther 之间'],
            ['mtu', 'DD 的 MTU 检查失败'],
        ]),
    ],
    build(o) {
        const steps = [
            step(
                '发现邻居',
                'R1 收到 R2 的 Hello；还没有在邻居列表中看到自己的 Router-ID。',
                '接收方进入 Init；这里展示的是接收方视角。',
            ),
            step(
                '确认双向',
                '收到的 Hello 邻居列表中包含本机 Router-ID，说明对端也收到了我的 Hello。',
                '进入 2-Way，再按网络类型和 DR/BDR 角色判断是否建立邻接。',
            ),
        ];
        const messages = [
            ['R2 → R1 · Hello', 'Init'],
            ['R2 → R1 · Hello 含 R1 RID', '2-Way'],
        ];
        if (o.mode === 'drother') {
            steps.push(
                step(
                    '保留邻居关系',
                    '广播网络中，两台 DROther 通常不互相建立完整邻接。它们分别与 DR、BDR 同步。',
                    '停在 2-Way 是正常状态；不等于协议故障。',
                ),
            );
            messages.push(['Hello 周期维持', '2-Way']);
        } else {
            steps.push(
                step(
                    '协商主从',
                    '双方用 DD 协商主从及起始序列号；Router-ID 较大者作为 Master。',
                    'DD 主从与 DR/BDR 角色无关。',
                ),
            );
            messages.push(['DD · I / M / MS 协商', 'ExStart']);
            if (o.mode === 'mtu') {
                steps.push(
                    step(
                        '检查失败',
                        '本例 R1 接口 MTU=1500，收到 R2 宣告 MTU=9000 的 DD；在启用检查时拒绝接收。',
                        'DD 交换不能完成；检查两端实际 MTU 与检查配置。',
                    ),
                );
                messages.push(['DD MTU 9000 > 1500 · 拒绝', 'ExStart / Exchange']);
            } else {
                steps.push(
                    step(
                        '交换摘要',
                        'DD 传送 LSA 头部。双方比较本地数据库，建立需要请求的 LSA 清单。',
                        '摘要不是完整 LSA；DD 不直接完成所有内容同步。',
                    ),
                    step(
                        '请求与补齐',
                        'LSR 指明所需 LSA；LSU 携带完整 LSA，LSAck 确认接收。',
                        'Loading 阶段清空请求列表；图中合并展示请求、响应和确认。',
                    ),
                    step(
                        '完成同步',
                        '请求列表清空后进入 Full，之后仍通过 Hello 和可靠泛洪维护邻接。',
                        '若无需请求任何 LSA，可由 Exchange 直接到 Full。',
                    ),
                );
                messages.push(
                    ['R1 ⇄ R2 · DD 摘要', 'Exchange'],
                    ['LSR →   LSU ←   LSAck →', 'Loading'],
                    ['LSDB 同步完成', 'Full'],
                );
            }
        }
        return {
            steps,
            parts: [
                part('r1', 'R1 / 1.1.1.1', '本例 Router-ID 较小，DD 协商成功后为 Slave。'),
                part('r2', 'R2 / 2.2.2.2', '本例 Router-ID 较大，DD 协商成功后为 Master。'),
            ],
            diagram(i) {
                let out = node('r1', 190, 48, 'R1', 'RID 1.1.1.1') + node('r2', 690, 48, 'R2', 'RID 2.2.2.2');
                out += '<path class="dk-lifeline" d="M190 80 V440 M690 80 V440"/>';
                messages.forEach(([msg, state], j) => {
                    const y = 115 + j * 54;
                    const reverse = j < 2;
                    out += edge(
                        `m${j}`,
                        reverse ? 690 : 190,
                        y,
                        reverse ? 190 : 690,
                        y,
                        msg,
                        j === i ? 'active' : j < i ? 'done' : 'future',
                    );
                    out += text(800, y + 4, state, `state-label ${j === i ? 'active' : ''}`);
                });
                return svg(out, 'OSPF 建邻时序，时间自上而下', 460);
            },
            takeaway: 'Hello 建立双向关系；DD 比较摘要；LSR / LSU 补齐内容；Full 表示完整邻接。',
            caution: '时序是教学简化，不表示每个报文都产生一次状态跃迁。Attempt 主要用于 NBMA，未画入点到点主流程。',
        };
    },
};
const types = {
    1: ['Router-LSA', '区域内各路由器', '描述本区域链路'],
    2: ['Network-LSA', 'DR', '描述广播/NBMA 网络'],
    3: ['Summary-LSA', 'ABR', '描述区域间前缀'],
    4: ['ASBR Summary', 'ABR', '描述到 ASBR 的路径'],
    5: ['External-LSA', 'ASBR', '描述外部前缀'],
    7: ['NSSA External', 'NSSA ASBR', 'NSSA 内的外部前缀'],
};
export function areaAdmission(type, area) {
    if (type === 1 || type === 2) return 'local';
    if (type === 7) return area.includes('nssa') ? 'local' : 'blocked';
    if (type === 5 || type === 4) return area === 'normal' ? 'pass' : 'blocked';
    return area.startsWith('totally') ? 'default-only' : 'pass';
}
const area = {
    id: 'area-flood',
    title: '区域边界 · LSA 到哪里为止',
    subtitle: '区分“原 LSA 泛洪”与“ABR 生成新的区域间通告”，再看特殊区域允许什么。',
    sources: [RFC, NSSA],
    options: [
        choice(
            'lsa',
            'LSA 类型',
            5,
            [1, 2, 3, 4, 5, 7].map((n) => [n, `${n} 类`]),
        ),
        choice('area2', '目标 Area 2', 'normal', [
            ['normal', '普通区域'],
            ['stub', 'Stub'],
            ['totally-stub', 'Totally Stub'],
            ['nssa', 'NSSA'],
            ['totally-nssa', 'Totally NSSA'],
        ]),
    ],
    build(o) {
        const [name, origin, purpose] = types[o.lsa],
            admit = areaAdmission(o.lsa, o.area2),
            local = admit === 'local',
            pass = admit === 'pass';
        const result = local
            ? o.lsa === 7
                ? '7 类只在 NSSA 内泛洪；向外传播需由翻译者生成 5 类。'
                : '1/2 类保持在生成它的区域；区域间前缀由 ABR 另行通告。'
            : pass
              ? `${o.lsa} 类可出现在普通的目标区域；区域间 LSA 由相应 ABR 生成。`
              : admit === 'default-only'
                ? 'Totally 模式抑制普通 3 类区域间明细，通常保留 3 类缺省。'
                : `目标区域不接收来自骨干的 ${o.lsa} 类 LSA。`;
        return {
            steps: [
                step('确定生成者', `${origin} 生成 ${name}，${purpose}。`, '先分清类型和生成者，再判断传播范围。'),
                step('检查区域边界', '1/2 类不是原封不动穿越 ABR；5 类可穿越普通区域；7 类限于 NSSA。', result),
                step('查看目标 LSDB', '颜色与文字共同表示目标区域的结果；“不接收”并不代表所有目的地都不可达。', result),
            ],
            parts: [
                part('src', origin, purpose),
                part('abr', 'ABR', '连接骨干与非骨干区域；维护各区域 LSDB 并生成区域间通告。'),
                part('dst', 'Area 2 路由器', result),
            ],
            diagram(i) {
                return svg(
                    region(20, 35, 240, 280, o.lsa === 7 ? '源区域 · NSSA' : '源区域') +
                        region(320, 35, 230, 280, 'Area 0 / 边界') +
                        region(610, 35, 250, 280, `Area 2 · ${o.area2}`) +
                        edge('s', 230, 175, 360, 175, `${o.lsa} 类`, i === 0 ? 'active' : 'done') +
                        edge(
                            'd',
                            510,
                            175,
                            660,
                            175,
                            local ? '范围止于区域' : pass ? '允许' : admit === 'default-only' ? '仅缺省' : '× 不接收',
                            i > 0 ? (pass ? 'active' : 'blocked') : '',
                        ) +
                        node('src', 140, 175, origin, `${o.lsa} · ${name}`, i === 0 ? 'active' : '') +
                        node('abr', 435, 175, 'ABR', local ? '不透传原 LSA' : '检查区域类型', i === 1 ? 'active' : '') +
                        node(
                            'dst',
                            750,
                            175,
                            '目标 LSDB',
                            local
                                ? '本区域单独生成'
                                : pass
                                  ? '可见'
                                  : admit === 'default-only'
                                    ? '仅 3 类缺省'
                                    : '该类不可见',
                            i === 2 ? (pass || local ? 'active' : 'blocked') : '',
                        ) +
                        text(440, 370, '区域内掌握拓扑；区域间交换可达性。', 'diagram-caption'),
                    'LSA 传播范围与区域边界',
                    410,
                );
            },
            takeaway: result,
            caution:
                '图中箭头表示通告处理过程，不是实际物理连线。7 类需从 NSSA 起源；Totally 为厂商扩展，缺省路由生成条件需核对配置。',
        };
    },
};
const fa = {
    id: 'fa-path',
    title: 'Forwarding Address · 通告者与转发目标',
    subtitle: '同一条外部路由，FA 改变的是下一跳解析目标。把控制面和业务路径分开看。',
    sources: [RFC],
    options: [
        choice('fa', '转发地址', 'zero', [
            ['zero', 'FA = 0'],
            ['set', 'FA 非零且可达'],
            ['unreachable', 'FA 非零但不可达'],
        ]),
    ],
    build(o) {
        const nonzero = o.fa !== 'zero',
            fail = o.fa === 'unreachable';
        const target = nonzero ? 'FA 10.0.0.9' : 'ASBR';
        return {
            steps: [
                step(
                    '接收外部通告',
                    'ASBR 发布外部前缀及 FA。Advertising Router 说明谁通告；FA 说明如何解析转发目标。',
                    '谁发布路由，不一定就是业务下一跳。',
                ),
                step(
                    '解析下一跳',
                    `FA=${nonzero ? '10.0.0.9' : '0.0.0.0'}，本机查找到 ${target} 的 OSPF 路径。`,
                    fail
                        ? '没有到 FA 的区域内或区域间路径，这条外部路由不能据此安装。'
                        : `用到 ${target} 的路径确定下一跳。`,
                ),
                step(
                    '转发业务流量',
                    fail
                        ? '路由安装条件未满足，不画出一条虚假的可达路径。'
                        : nonzero
                          ? '本例 R 与外部网关共享网段，可以直接向网关转发。'
                          : '业务沿到 ASBR 的路径转发，再进入外部网络。',
                    fail
                        ? 'FA 非零不等于可达。'
                        : nonzero
                          ? '本例避免经 ASBR 绕行。'
                          : 'FA=0 表示通过通告该 LSA 的 ASBR 解析。',
                ),
            ],
            parts: [
                part('r', '内部路由器 R', '分别计算外部前缀的路径类型、度量与下一跳。'),
                part('asbr', 'ASBR', '发布外部 LSA 的设备。'),
                part('gw', '外部网关 / FA', '本示例共享网段上的外部转发目标。'),
            ],
            diagram(i) {
                return svg(
                    region(30, 40, 820, 300, '控制面：ASBR 通告前缀 · 数据面：按 FA 解析下一跳') +
                        edge('lsa', 440, 120, 170, 235, '外部 LSA', i === 0 ? 'active' : 'done') +
                        edge('via', 170, 265, 440, 150, '到 ASBR', i === 2 && !nonzero ? 'active' : '') +
                        edge(
                            'fa',
                            245,
                            270,
                            665,
                            270,
                            fail ? '× 无 OSPF 路径' : '到 FA',
                            i > 0 && nonzero ? (fail ? 'blocked' : 'active') : '',
                        ) +
                        edge('exit', 515, 120, 740, 240, '到外部网关', i === 2 && !nonzero ? 'active' : '') +
                        node('r', 170, 270, '内部路由器 R', '目的：外部前缀', i === 1 ? 'active' : '') +
                        node('asbr', 440, 120, 'ASBR', 'Advertising Router') +
                        node(
                            'gw',
                            740,
                            270,
                            '外部网关',
                            nonzero ? 'FA 10.0.0.9' : '共享网段',
                            fail ? 'blocked' : i === 2 ? 'active' : '',
                        ) +
                        text(440, 385, `解析目标：${target}${fail ? ' · 不可达' : ''}`, 'diagram-caption'),
                    'FA 控制面与数据面',
                    420,
                );
            },
            takeaway: 'FA=0：解析 ASBR；FA≠0：解析 FA，并先检查它是否通过 OSPF 内部路径可达。',
            caution: '非零 FA 不保证绕过 ASBR；是否绕行取决于拓扑。实际路由还受 E1/E2 度量与其他候选路由影响。',
        };
    },
};
const dr = {
    id: 'dr-pseudonode',
    title: 'DR / BDR · 邻接关系与伪节点',
    subtitle: '分别看真实的邻接关系和 SPF 使用的逻辑图，避免把 DR 当成业务中转站。',
    sources: [RFC],
    options: [
        choice('mode', '观察视角', 'adjacency', [
            ['adjacency', '完整邻接'],
            ['pseudo', 'SPF 伪节点'],
            ['mesh', '假设两两邻接'],
        ]),
        { id: 'n', label: '路由器数量', type: 'range', value: 5, min: 4, max: 8, step: 1 },
    ],
    build(o) {
        const n = o.n,
            count = o.mode === 'mesh' ? (n * (n - 1)) / 2 : 2 * n - 3;
        return {
            steps: [
                step(
                    '共享一个网段',
                    '广播网络上，符合条件的路由器参与 DR/BDR 选举；其他为 DROther。',
                    '优先级为 0 不参选；选举具有非抢占特性。',
                ),
                step(
                    '组织同步关系',
                    o.mode === 'pseudo'
                        ? 'DR 生成 Network-LSA，把网段表示为 SPF 图中的逻辑节点。'
                        : `本例 ${n} 台路由器，${o.mode === 'mesh' ? '假设两两' : '实际 DR/BDR'}完整邻接数为 ${count}。`,
                    'DROther 与 DR、BDR 为 Full；DROther 相互通常为 2-Way。',
                ),
                step(
                    '分清两张图',
                    'SPF 图的伪节点代表网络，不是一台新增设备。邻接连线用于协议同步，不规定业务经过 DR。',
                    '正常二层可达时，路由器之间可直接转发业务。',
                ),
            ],
            parts: [
                part('dr', 'DR', '生成本网络的 Type-2 LSA，协助组织泛洪。'),
                part('bdr', 'BDR', '与其他路由器建立完整邻接，以便接替 DR。'),
                part(
                    'pseudo',
                    'Network-LSA 伪节点',
                    '表示共享网络，Network-LSA 列出与 DR 完整邻接的路由器以及 DR 本身。',
                ),
            ],
            diagram(i) {
                const points = Array.from({ length: n }, (_, j) => ({
                    x: 440 + Math.cos(-Math.PI / 2 + (j * 2 * Math.PI) / n) * 300,
                    y: 220 + Math.sin(-Math.PI / 2 + (j * 2 * Math.PI) / n) * 150,
                }));
                let out = '';
                for (let a = 0; a < n; a++)
                    for (let b = a + 1; b < n; b++) {
                        if (o.mode === 'pseudo') continue;
                        if (o.mode === 'mesh' || a < 2)
                            out += edge(
                                `a${a}-${b}`,
                                points[a].x,
                                points[a].y,
                                points[b].x,
                                points[b].y,
                                '',
                                i === 1 ? 'done' : '',
                            );
                    }
                if (o.mode === 'pseudo') {
                    points.forEach((p, j) => {
                        out += edge(`p${j}`, p.x, p.y, 440, 220, '', i === 1 ? 'done' : '');
                    });
                    out += node('pseudo', 440, 220, '共享网络', 'Network-LSA', i > 0 ? 'active' : '');
                }
                points.forEach((p, j) => {
                    out += node(
                        j === 0 ? 'dr' : j === 1 ? 'bdr' : `r${j}`,
                        p.x,
                        p.y,
                        j === 0 ? 'DR' : j === 1 ? 'BDR' : `R${j + 1}`,
                        j < 2 ? 'Full 邻接枢纽' : 'DROther',
                        i === 0 && j < 2 ? 'active' : '',
                        130,
                    );
                });
                out += text(
                    440,
                    425,
                    o.mode === 'pseudo'
                        ? `${n} 个路由器连接一个逻辑网络节点`
                        : `${count} 条无向完整邻接 · 连线不代表业务路径`,
                    'diagram-caption',
                );
                return svg(out, '广播网络邻接或逻辑拓扑', 455).replaceAll(
                    'marker-end="url(',
                    'data-unused-marker="url(',
                );
            },
            takeaway: 'DR 组织邻接与泛洪，伪节点简化拓扑表达；DR 并非所有业务流量的必经点。',
            caution:
                '2N−3 是一个网段中一台 DR、一台 BDR、其余 DROther 均稳定 Full 时的无向邻接数量。伪节点的双向 SPF 边度量不同，此图只展示连接关系。',
        };
    },
};
const nssa = {
    id: 'nssa-pbit',
    title: 'NSSA · 7 类怎样成为 5 类',
    subtitle: '逐项检查翻译条件，观察被阻止的原因。P-bit 是翻译请求，不是转发开关。',
    sources: [NSSA],
    options: [
        choice('case', '场景', 'ext', [
            ['ext', 'P=1，FA 非零'],
            ['fa0', 'P=1，FA=0'],
            ['def0', 'ABR 产生的缺省'],
            ['def1', '反例：缺省误置 P=1'],
        ]),
    ],
    build(o) {
        const pass = o.case === 'ext',
            bad = o.case === 'def1';
        return {
            steps: [
                step(
                    '在 NSSA 内产生',
                    'NSSA ASBR 以 Type-7 表示引入的外部前缀；NSSA ABR 也可按条件产生缺省。',
                    'Type-7 先在 NSSA 内传播。',
                ),
                step(
                    '检查 P 与 FA',
                    o.case === 'fa0'
                        ? 'P=1 但 FA=0，不满足翻译条件；正常的 P=1 通告应携带非零 FA。'
                        : o.case === 'def0'
                          ? 'ABR 产生的 Type-7 缺省设置 P=0，不请求向外翻译。'
                          : bad
                            ? '这是违反 ABR 缺省生成规则的假设反例；不能当作正常配置流程。'
                            : 'P=1 且 FA 非零，继续由合格的翻译者判断。',
                    pass ? '满足基本门槛；还需检查翻译者角色、路由选择与范围策略。' : '停止本例的正常翻译流程。',
                ),
                step(
                    '生成新的外部通告',
                    pass
                        ? '翻译 ABR 按规则生成 Type-5，通告到支持外部 LSA 的区域。'
                        : '保留对阻止原因的解释，不把不合法场景画成正常收敛。',
                    pass
                        ? 'Type-7 与 Type-5 是不同 LSA；NSSA 内仍使用 Type-7。'
                        : bad
                          ? '错误缺省传播可能破坏出口选择，但不能仅凭 P=1 就断言必然环路。'
                          : '不向骨干生成相应 Type-5。',
                ),
            ],
            parts: [
                part('part-0', 'NSSA ASBR', '引入外部前缀并产生 Type-7。'),
                part('part-1', '翻译检查', 'P=1、FA 非零只是必要条件；选举、范围聚合和最佳路径也参与决定。'),
                part('part-2', '翻译 ABR', '依据 RFC 3101 生成相应 Type-5。'),
            ],
            diagram(i) {
                return flowDiagram(
                    [
                        ['Type-7', o.case === 'def0' ? 'P=0 · 缺省' : 'P=1 · 外部前缀'],
                        ['翻译检查', o.case === 'def0' ? 'P=0 · 不请求翻译' : o.case === 'fa0' ? 'FA=0' : bad ? '非法假设' : 'FA ≠ 0'],
                        ['Type-5', pass ? '进入普通区域' : '× 不生成'],
                    ],
                    i,
                    {
                        statuses: ['', !pass && i > 0 ? 'blocked' : '', !pass && i === 2 ? 'blocked' : ''],
                        caption: pass ? 'NSSA 内 Type-7 → 翻译 ABR → 普通区域 Type-5' : '先看生成规则，再看翻译条件',
                    },
                );
            },
            takeaway: 'NSSA 把区域内外部信息与域外传播分开；ABR 生成的 Type-7 缺省不应再翻译回骨干。',
            caution: '翻译者并非无条件由 Router-ID 最大的 ABR 担任，还受候选/强制角色、可达性及稳定机制影响。',
        };
    },
};
export const TE_LINKS = [
    ['A', 'B', 1000, 'gold', 10, 1],
    ['A', 'C', 400, 'silver', 10, 2],
    ['B', 'D', 1000, 'gold', 10, 1],
    ['C', 'E', 1000, 'gold', 15, 3],
    ['D', 'F', 300, 'gold', 10, 4],
    ['E', 'F', 1000, 'silver', 10, 3],
    ['B', 'E', 600, 'gold', 20, 5],
    ['C', 'D', 800, 'silver', 5, 2],
];
export function shortestPath(links, from = 'A', to = 'F') {
    const dist = { [from]: 0 },
        prev = {},
        done = new Set();
    while (true) {
        const v = Object.keys(dist)
            .filter((n) => !done.has(n))
            .sort((a, b) => dist[a] - dist[b] || a.localeCompare(b))[0];
        if (!v) return null;
        if (v === to) break;
        done.add(v);
        for (const link of links) {
            const [a, b, , , cost] = link,
                w = a === v ? b : b === v ? a : null;
            if (!w || done.has(w)) continue;
            const d = dist[v] + cost;
            if (dist[w] === undefined || d < dist[w]) {
                dist[w] = d;
                prev[w] = { v, link };
            }
        }
    }
    const nodes = [to],
        used = [];
    for (let v = to; prev[v]; v = prev[v].v) {
        nodes.unshift(prev[v].v);
        used.unshift(prev[v].link);
    }
    return { nodes, links: used, cost: dist[to] };
}
export function solveTe(o) {
    const eligible = TE_LINKS.filter((l) => l[2] >= o.bw && (o.color === 'any' || l[3] === o.color));
    const primary = shortestPath(eligible);
    const risks = new Set(primary?.links.map((l) => l[5]) || []);
    return {
        eligible,
        primary,
        backup: primary && o.srlg === 'on' ? shortestPath(eligible.filter((l) => !risks.has(l[5]))) : null,
    };
}
const te = {
    id: 'te-cspf',
    title: 'CSPF · 先筛链路，再找最短路',
    subtitle: '带宽、管理组、共享风险如何改变可选路径；成本与筛选结果同步显示。',
    sources: [
        ['RFC 3630 · OSPF-TE', 'https://www.rfc-editor.org/rfc/rfc3630.html'],
        ['RFC 3209 · RSVP-TE', 'https://www.rfc-editor.org/rfc/rfc3209.html'],
    ],
    options: [
        {
            id: 'bw',
            label: '需求带宽',
            type: 'range',
            value: 500,
            min: 0,
            max: 1000,
            step: 100,
            format: (v) => `${v} Mbit/s`,
        },
        choice('color', '管理组', 'any', [
            ['any', '不限制'],
            ['gold', '仅 gold'],
        ]),
        choice('srlg', '备份', 'off', [
            ['off', '仅主路径'],
            ['on', 'SRLG 分离'],
        ]),
    ],
    build(o) {
        const { eligible, primary, backup } = solveTe(o);
        return {
            steps: [
                step(
                    '建立 TEDB',
                    'OSPF-TE 通告链路属性；本例把对应优先级的未预留带宽、管理组、TE 度量和 SRLG 固定为演示数据。',
                    '链路标签依次给出可用带宽与 TE 度量。',
                ),
                step(
                    '剪去不合格链路',
                    `需求 ${o.bw} Mbit/s，管理组 ${o.color}。不满足任一条件的链路不能参与本次计算。`,
                    `${TE_LINKS.length - eligible.length} 条被排除，${eligible.length} 条保留。`,
                ),
                step(
                    '计算最短路径',
                    '只在剩余图上按 TE 度量累加，寻找从 A 到 F 的最低成本路径。',
                    primary
                        ? `${primary.nodes.join(' → ')}，总 TE cost=${primary.cost}。`
                        : '约束下无可达路径，不能建立本次 LSP。',
                ),
                step(
                    '信令与备份',
                    '算出路径后仍需通过 RSVP-TE 信令建立与预留；TEDB 快照不等于资源保证。',
                    o.srlg === 'on'
                        ? backup
                            ? `SRLG 分离备份：${backup.nodes.join(' → ')}，cost=${backup.cost}`
                            : '本例不存在满足约束的 SRLG 分离备份。'
                        : '本例只展示主路径；信令失败时需重算或重试。',
                ),
            ],
            parts: [...'ABCDEF']
                .map((id) =>
                    part(
                        id,
                        `节点 ${id}`,
                        id === 'A'
                            ? 'LSP 入口：计算约束路径并发起信令。'
                            : id === 'F'
                              ? 'LSP 出口。'
                              : '转发节点：提供 TE 属性并参与信令。',
                    ),
                )
                .concat(
                    TE_LINKS.map((l, j) =>
                        part(
                            `link${j}`,
                            `${l[0]}—${l[1]}`,
                            eligible.includes(l) ? '满足本次带宽和管理组约束。' : '不满足本次约束，计算时排除。',
                            [
                                ['未预留带宽', `${l[2]} Mbit/s`],
                                ['管理组', l[3]],
                                ['TE metric', l[4]],
                                ['SRLG', l[5]],
                            ],
                        ),
                    ),
                ),
            diagram(i) {
                const pos = { A: [90, 220], B: [310, 85], C: [310, 355], D: [570, 85], E: [570, 355], F: [790, 220] };
                let out = '';
                TE_LINKS.forEach((l, j) => {
                    const [x, y] = pos[l[0]],
                        [xx, yy] = pos[l[1]],
                        bad = i >= 1 && !eligible.includes(l),
                        chosen = i >= 2 && primary?.links.includes(l),
                        back = i === 3 && backup?.links.includes(l);
                    out +=
                        `<g data-part="link${j}" role="button" tabindex="0" aria-label="链路 ${l[0]} 到 ${l[1]}">` +
                        edge(
                            `te${j}`,
                            x,
                            y,
                            xx,
                            yy,
                            `${l[2]}M · ${l[4]}`,
                            bad ? 'blocked' : chosen ? 'active' : back ? 'backup' : '',
                            j === 6 ? 70 : j === 7 ? -70 : 0,
                        ) +
                        '</g>';
                });
                Object.entries(pos).forEach(([id, [x, y]]) => {
                    out += node(
                        id,
                        x,
                        y,
                        id,
                        id === 'A' ? 'Head-end' : id === 'F' ? '目的节点' : 'LSR',
                        primary?.nodes.includes(id) && i >= 2 ? 'active' : '',
                        90,
                    );
                });
                return svg(out, 'CSPF 约束拓扑；点击链路查看属性', 425);
            },
            takeaway: primary
                ? `在当前约束下选择 ${primary.nodes.join(' → ')}，代价 ${primary.cost}；不是直接选择带宽最大的链路。`
                : '当前约束没有可行解；降低要求或增加可用资源后重新计算。',
            caution: '本例链路按双向同属性简化。真实 TE 属性按方向和优先级维护，SRLG 信息及备份策略也依实现而定。',
        };
    },
};
const flap = {
    id: 'flap-damping',
    title: '链路震荡 · 计算节流与路径避让',
    subtitle: '把链路事件、控制面开销和业务选路放在同一时间轴上，辨别机制解决的问题。',
    sources: [RFC],
    options: [
        choice('mode', '处理机制', 'throttle', [
            ['none', '仅快速响应'],
            ['throttle', 'LSA / SPF 节流'],
            ['damping', '提高不稳定链路代价'],
        ]),
    ],
    build(o) {
        const labels = ['正常', '首次断开', '短暂恢复', '再次断开', '进入抑制', '稳定观察'];
        return {
            steps: labels.map((title, i) =>
                step(
                    title,
                    i === 0
                        ? '主路 cost=10，备路 cost=100，主路被优选。'
                        : o.mode === 'damping'
                          ? '本例在反复震荡后提高主路代价，并经过稳定观察后再恢复。'
                          : o.mode === 'throttle'
                            ? '节流合并密集更新、限制计算频率；它不直接改变链路质量与选路代价。'
                            : '链路反复 Up/Down，协议随事件重新计算。',
                    i === 0
                        ? '业务走主路。'
                        : o.mode === 'damping' && i >= 3
                          ? '主路恢复也暂不抢回流量，本例保持备路。'
                          : '业务可能反复切换；实际切换时刻取决于检测与收敛。',
                ),
            ),
            parts: [
                part('primary', '主链路', '初始 cost 10；本例震荡后可提高为 65535。'),
                part('backup', '备链路', 'cost 100；假定始终可用。'),
            ],
            diagram(i) {
                let out = text(35, 38, '教学时间轴（非设备实测）', 'region-title', 'start');
                const values = [1, 0, 1, 0, 1, 1];
                const routes = values.map((v, j) => (o.mode === 'damping' && j >= 3 ? 0 : v));
                ['链路 Up/Down', '选路：主 / 备'].forEach((label, row) => {
                    out += text(32, 115 + row * 130, label, 'node-sub', 'start');
                    const data = row ? routes : values;
                    let d = '';
                    data.forEach((v, j) => {
                        const x = 200 + j * 105,
                            y = 90 + row * 130 + (v ? 0 : 55);
                        d += j ? ` H${x} V${y}` : `M${x} ${y}`;
                    });
                    d += ' H830';
                    out += `<path class="dk-signal ${row ? 'route-signal' : ''}" d="${d}"/>`;
                });
                for (let j = 0; j < 6; j++) out += text(200 + j * 105, 320, labels[j], 'bit-ruler');
                out +=
                    `<path class="dk-time-cursor" d="M${200 + i * 105} 65 V290"/>` +
                    node(
                        'primary',
                        310,
                        380,
                        '主链路',
                        o.mode === 'damping' && i >= 3 ? 'cost 65535' : 'cost 10',
                        i === 0 ? 'active' : '',
                    ) +
                    node('backup', 640, 380, '备链路', 'cost 100', routes[i] === 0 ? 'active' : '');
                return svg(out, '链路事件与业务选路的对照时间轴', 430);
            },
            takeaway: '节流减少控制面工作；路径避让减少业务反复切换。两者可以配合，但作用不同。',
            caution:
                '这是机制示意，不是产品默认状态机。邻居震荡抑制也可能采用保持 Down 等方式；提高 cost 不等于硬隔离，仍需检查备用路径。',
        };
    },
};
const filters = [
    ['ASBR 引入过滤', '只阻止被过滤外部前缀生成 LSA', 5, 0],
    ['ASBR 汇总抑制', '阻止指定范围外部路由通告', 5, 0],
    ['ABR 区域汇总抑制', '阻止对应区域间前缀通告', 3, 1],
    ['ABR filter export', '限制指定源区域的区域间前缀通告', 3, 1],
    ['出接口过滤 Summary', '该接口不发送匹配的 3 类 LSA', 3, 1],
    ['ABR filter import', '限制向目标区域生成的 3 类通告', 3, 3],
    ['本机 filter-policy import', '保留 LSDB，只阻止本机路由安装', 5, -1],
    ['出接口过滤 ASE', '该接口不发送匹配的 5 类 LSA', 5, 1],
];
const filter = {
    id: 'filter-points',
    title: 'OSPF 过滤 · LSDB 与路由表对照',
    subtitle: '选择一个过滤位置，对照每台设备是否看见通告、是否安装对应路由。',
    sources: [RFC],
    options: [
        choice(
            'point',
            '过滤位置',
            7,
            filters.map((f, i) => [i + 1, `${i + 1}. ${f[0]}`]),
        ),
    ],
    build(o) {
        const f = filters[o.point - 1];
        return {
            steps: [
                step('前缀进入协议', f[1], `本例观察 ${f[2]} 类通告；源设备 R1 有原始路由。`),
                step(
                    '执行过滤',
                    o.point === 7
                        ? 'R3 已有 LSA，但在安装路由时被本地策略阻止。'
                        : `${f[0]} 在指定位置限制生成或发送。`,
                    '本例为单一传播路径；不考虑其他入口重新收到通告。',
                ),
                step(
                    '核对两张表',
                    'LSDB 记录通告，RIB 记录被选中的路由。看见 LSA 不保证最终安装路由。',
                    o.point === 7
                        ? 'R3 不安装，R4/R5 仍可根据相同 LSA 计算路由。'
                        : '后续是否可达仍须检查其他路径、其他协议或缺省路由。',
                ),
            ],
            parts: Array.from({ length: 5 }, (_, j) =>
                part(
                    `R${j + 1}`,
                    `R${j + 1}`,
                    j === 0
                        ? '源设备持有原始路由。'
                        : j === 1 || j === 3
                          ? '区域边界路由器。'
                          : '区域内部路由器；对照本机 LSDB 与 RIB。',
                ),
            ),
            diagram(i) {
                let out = region(20, 25, 840, 330, `${f[2]} 类示例 · R1 源 → R2 ABR → R3 骨干 → R4 ABR → R5`);
                for (let j = 0; j < 4; j++)
                    out += edge(
                        `f${j}`,
                        154 + j * 168,
                        125,
                        222 + j * 168,
                        125,
                        '',
                        i > 0 && f[3] >= 0 && j >= f[3] ? 'blocked' : i > 0 ? 'active' : '',
                    );
                for (let j = 0; j < 5; j++) {
                    const seen = o.point === 7 || (j <= f[3] && o.point !== 1 && o.point !== 2);
                    const rib = o.point === 7 ? j !== 2 : j <= f[3];
                    out += node(
                        `R${j + 1}`,
                        105 + j * 168,
                        125,
                        `R${j + 1}`,
                        j === 0 ? '源路由' : j === 1 || j === 3 ? 'ABR' : '内部路由器',
                        i > 0 && o.point === 7 && j === 2 ? 'blocked' : '',
                        110,
                    );
                    out += text(
                        105 + j * 168,
                        225,
                        i < 2 ? 'LSDB · 待观察' : `LSDB ${seen ? '✓ 有' : '× 无'}`,
                        'state-label',
                    );
                    out += text(
                        105 + j * 168,
                        280,
                        i < 2 ? 'RIB · 待观察' : `RIB ${rib || j === 0 ? '✓ 有' : '× 无'}`,
                        'state-label',
                    );
                }
                return svg(out, '过滤位置与五台路由器的 LSDB、RIB 对照', 390);
            },
            takeaway: '过滤通告与过滤本机路由安装是两类操作；排障时必须分别检查 LSDB 和 RIB。',
            caution:
                '名称对应 VRP 常见机制，命令支持依版本而异。接口 LSA 过滤可能破坏同区域 LSDB 一致性；本图结果仅限单路径和匹配前缀。',
        };
    },
};
export const ospfLessons = [packetLesson, fsm, area, fa, dr, nssa, te, flap, filter];
