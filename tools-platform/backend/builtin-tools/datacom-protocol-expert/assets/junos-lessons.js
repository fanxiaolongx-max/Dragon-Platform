import { flowDiagram, svg, region, node, edge, text } from './diagram-kit.js';
const step = (title, text, result) => ({ title, text, result });
const option = (id, label, value, items) => ({
    id,
    label,
    value,
    choices: items.map(([value, label]) => ({ value, label })),
});
const POLICY = [
    'Junos · 策略动作',
    'https://www.juniper.net/documentation/us/en/software/junos/routing-policy/topics/concept/policy-configuring-actions-in-routing-policy-terms.html',
];
const VPN = [
    'Junos · VPN 路由分发',
    'https://www.juniper.net/documentation/us/en/software/junos/vpn-l3/topics/topic-map/l3-vpns-distributing-routes.html',
];
const policy = {
    id: 'policy-engine',
    title: '路由策略 · 匹配、修改与终止',
    subtitle: '跟随一条路由，区分“命中条件”“修改属性”“接受或拒绝”三个动作。',
    sources: [
        POLICY,
        [
            'Junos · 默认策略',
            'https://www.juniper.net/documentation/us/en/software/junos/routing-policy/topics/concept/policy-routing-policies-actions-defaults.html',
        ],
    ],
    options: [
        option('vendor', '厂商', 'junos', [
            ['junos', 'Juniper Junos'],
            ['huawei', 'Huawei VRP'],
        ]),
        option('route', '输入路由', 'match', [
            ['match', '匹配示例前缀'],
            ['miss', '不匹配任何条件'],
        ]),
    ],
    build(o) {
        const junos = o.vendor === 'junos',
            match = o.route === 'match';
        const labels = junos
            ? [
                  ['输入路由', '10.10.0.0/24'],
                  ['Term 1', '匹配后添加 RT'],
                  ['Term 2', '匹配 RT → accept'],
                  ['最终结果', match ? '接受' : '协议默认动作'],
              ]
            : [
                  ['输入路由', '10.10.0.0/24'],
                  ['Node 10', 'permit + apply RT'],
                  ['Node 20', '其他前缀 deny'],
                  ['最终结果', match ? '接受' : '隐式拒绝'],
              ];
        return {
            steps: [
                step(
                    '给出输入',
                    '本例策略依次匹配前缀、修改 RT，再观察是否继续。只演示普通策略链的基本控制流。',
                    match ? '路由满足第一个条件。' : '假定输入不满足所有显式条件。',
                ),
                step(
                    '第一个条件',
                    match
                        ? junos
                            ? 'Term 1 添加 RT，不含终止动作；继续后续 term。'
                            : 'Node 10 permit 命中，执行 apply，按本例基本语义结束评估。'
                        : '条件不满足，继续下一条。',
                    match
                        ? junos
                            ? '属性已改变，尚未作出最终决断。'
                            : '属性已改变，并已接受。'
                        : '未命中不等于立即拒绝。',
                ),
                step(
                    junos ? '后续 Term' : '检查是否继续',
                    match
                        ? junos
                            ? 'Term 2 匹配刚添加的 RT，执行 accept，结束普通策略链。'
                            : '路由已在 Node 10 接受；不会再经过 Node 20。'
                        : '后续条件仍未命中。',
                    match ? '到此已有终止决断。' : '显式规则结束，进入默认处理。',
                ),
                step(
                    '最终决断',
                    match
                        ? '接受只表示通过该策略；能否安装或发布还要满足其他协议条件。'
                        : junos
                          ? '交给调用该策略的协议、方向与地址族的默认行为；不能统一写成 accept 或 reject。'
                          : '本例普通 route-policy 未命中任何节点，隐式拒绝。',
                    match ? '通过策略。' : junos ? '需查看挂载点的默认策略。' : '拒绝。',
                ),
            ],
            parts: [
                ...labels.map((l, i) => ({ id: `part-${i}`, name: l[0], desc: l[1] })),
                { id: 'transport', name: 'inet.3', desc: '常用于 BGP VPN 下一跳的传输 LSP 解析；具体解析规则可配置。' },
                { id: 'default', name: '默认处理', desc: '按实际协议、方向、地址族及平台核对默认策略。' },
            ],
            diagram(i) {
                const stop = match && !junos;
                let drawing = region(20, 25, 840, 345, junos ? 'Junos · 普通策略链' : 'VRP · 普通 route-policy');
                drawing += edge('input', 174, 135, 256, 135, '候选', i === 0 ? 'active' : 'done');
                drawing += edge(
                    'next',
                    404,
                    135,
                    486,
                    135,
                    stop ? '× 未评估' : '继续',
                    stop ? 'blocked' : i === 1 ? 'active' : i > 1 ? 'done' : '',
                );
                drawing += edge('default', 634, 135, 706, 135, '未命中', match ? 'blocked' : i >= 2 ? 'active' : '');
                if (match)
                    drawing += edge(
                        'accept',
                        stop ? 330 : 560,
                        165,
                        stop ? 520 : 560,
                        285,
                        '接受并结束',
                        i >= (stop ? 1 : 2) ? 'active' : '',
                    );
                drawing += node(
                    'part-0',
                    100,
                    135,
                    '输入路由',
                    match ? '匹配本例前缀' : '均不匹配',
                    i === 0 ? 'active' : '',
                );
                drawing += node(
                    'part-1',
                    330,
                    135,
                    junos ? 'Term 1' : 'Node 10',
                    match ? (junos ? '添加 RT · 继续' : 'permit + apply') : '条件未命中',
                    i === 1 ? 'active' : '',
                );
                drawing += node(
                    'part-2',
                    560,
                    135,
                    junos ? 'Term 2' : 'Node 20',
                    stop ? '未评估' : match ? 'RT 匹配 · accept' : '条件未命中',
                    stop ? 'blocked' : i === 2 ? 'active' : '',
                );
                drawing += node(
                    'default',
                    780,
                    135,
                    '兜底',
                    junos ? '协议默认动作' : '隐式拒绝',
                    !match && i === 3 ? 'active' : '',
                    135,
                );
                drawing += node(
                    'part-3',
                    560,
                    315,
                    '最终结果',
                    match ? '通过该策略' : junos ? '由挂载点决定' : '拒绝',
                    i === 3 ? 'active' : '',
                );
                if (!match) drawing += edge('fallback', 780, 165, 635, 315, '最终处理', i === 3 ? 'active' : '');
                drawing += text(
                    440,
                    410,
                    match
                        ? junos
                            ? '修改属性不等于接受；accept 才结束普通策略链'
                            : '命中 permit 后结束，不再评估后续节点'
                        : '未命中显式规则后，检查挂载点的兜底行为',
                    'diagram-caption',
                );
                return svg(drawing, '路由策略控制流：继续匹配与终止分支', 445);
            },
            takeaway: '修改属性与终止评估是不同概念。迁移策略时，逐条检查控制流及挂载方向。',
            caution:
                '本例不包含 next policy、策略表达式、子策略或厂商扩展的继续匹配指令。不要把“接受”直接等同于已经发布到邻居。',
        };
    },
};
const rib = {
    id: 'rib-vrf',
    title: 'VRF 路由流转 · 表、策略与下一跳',
    subtitle: '沿有方向的路径看路由进入哪张表；RD 区分路由，RT 控制分发，下一跳决定可用性。',
    sources: [
        VPN,
        [
            'Junos · RIB groups',
            'https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/statement/rib-groups-edit-routing-options.html',
        ],
    ],
    options: [
        option('mode', '机制', 'mpbgp', [
            ['mpbgp', 'MP-BGP VPN 分发'],
            ['instance', 'instance-import'],
            ['ribgroup', 'rib-groups'],
            ['priority', 'RT 配置与策略'],
        ]),
        option('rtMatch', '导入条件', 'yes', [
            ['yes', 'RT 匹配'],
            ['no', 'RT 不匹配'],
        ]),
    ],
    build(o) {
        let steps, labels, takeaway, caution;
        if (o.mode === 'mpbgp') {
            const accept = o.rtMatch === 'yes';
            labels = [
                ['源 PE · VRF-A', '客户 IPv4 路由'],
                ['VPN 路由分发', 'RD + RT · MP-BGP'],
                ['接收 PE · VRF-B', accept ? '匹配 RT 后导入' : '× RT 不匹配'],
            ];
            steps = [
                step(
                    '从客户表导出',
                    '源 PE 按 VRF 配置与导出策略构造 VPN 路由并附加 RT；RD 是 VPN 前缀的一部分。',
                    'RD 用于区分相同 IPv4 前缀，不决定接收方。',
                ),
                step(
                    '通过 MP-BGP 分发',
                    '对端 PE 接收 VPN 路由，按策略、路由选择与下一跳解析进行处理。',
                    'bgp.l3vpn.0 用于 VPN 路由；inet.3 常用于解析传输 LSP 下一跳。',
                ),
                step(
                    '导入目标 VRF',
                    accept
                        ? '本例目标 VRF 的导入策略接受该 RT；还需满足下一跳可达等条件。'
                        : '本例目标 VRF 不接受该 RT，因此不导入这条路由。',
                    accept ? '路由可参与目标 VRF 的选择；FIB 安装是后续步骤。' : '未导入目标 VRF，不代表源路由消失。',
                ),
            ];
            takeaway = 'RD 解决唯一性，RT 表达分发意图，下一跳解析保证路由可用。';
            caution =
                '图示跨 PE 的 MP-BGP 分发。本地 VRF 间自动泄露还有 auto-export 等条件，不能把所有情形套成固定的三张表流水线。';
        } else if (o.mode === 'instance') {
            labels = [
                ['源实例 RIB', '候选路由'],
                ['instance-import', '目标侧策略'],
                ['目标实例 RIB', '接受的候选路由'],
            ];
            steps = [
                step(
                    '确定源与目标',
                    '在目标实例配置导入策略，选择允许的源实例与路由。',
                    '先明确是哪个实例从哪个实例读取。',
                ),
                step(
                    '策略筛选',
                    '本地路由表间导入，不依赖把路由封装成 VPNv4。',
                    '可按源实例、协议、前缀等受支持条件筛选。',
                ),
                step('检查可用性', '导入的候选路由仍要进行下一跳解析及优选。', '复制候选路由不保证转发立即成功。'),
            ];
            takeaway = 'instance-import 是本地表间导入；它与跨 PE 的 VPN 分发解决不同问题。';
            caution =
                '支持的 routing-instance 类型、下一跳解析与属性保留需核对目标 Junos 版本；不能笼统承诺所有 VRF 类型均支持。';
        } else if (o.mode === 'ribgroup') {
            labels = [
                ['协议学习点', '路由产生 / 接收'],
                ['rib-group', 'primary + secondary'],
                ['多张 RIB', '受策略约束的导入'],
            ];
            steps = [
                step(
                    '选择协议挂载点',
                    '把 rib-group 应用于支持的协议或接口路由入口。',
                    '它在路由导入时向指定表提供候选。',
                ),
                step(
                    '明确表顺序',
                    'import-rib 列表第一张是 primary，其余为 secondary；可用 import-policy 限定范围。',
                    '主表顺序具有语义，不是任意排列。',
                ),
                step('核对每张表', '每张表各自做路由选择与下一跳解析。', '检查需要的路由和下一跳是否同时可达。'),
            ];
            takeaway = 'rib-group 在学习入口执行多表导入，各表仍独立选择可用路由。';
            caution = '不是持续复制整个数据库；不同协议、地址族和平台存在支持差异。先限制前缀范围，再核验回程。';
        } else {
            labels = [
                ['导出方向', '给路由附加 RT'],
                ['VPN route', 'RD ≠ RT'],
                ['导入方向', o.rtMatch === 'yes' ? 'RT 匹配' : 'RT 不匹配'],
            ];
            steps = [
                step(
                    '分别检查两个方向',
                    'vrf-target 可以生成常见导入/导出行为；显式策略允许更细的规则。',
                    '先查 export，再查 import，避免混在一起判断。',
                ),
                step(
                    '查看实际生效策略',
                    '配置显式 vrf-import / vrf-export 时，需要确认对应方向的 RT 匹配、附加和最终 accept。',
                    '不要假设所有简写配置与显式策略自动叠加。',
                ),
                step(
                    '验证接收侧',
                    '检查实际 VPN 路由携带的 RT 与导入策略，进一步检查下一跳和目标表。',
                    o.rtMatch === 'yes' ? 'RT 匹配仅满足分发条件之一。' : '没有匹配的导入条件，本例不导入。',
                ),
            ];
            takeaway = '按“实际携带的 RT → 生效导入策略 → 目标表结果”排查，而不是只看配置行存在与否。';
            caution =
                'vrf-import 并非只能匹配 community；官方示例也可组合 protocol 等条件。提交约束、auto-export 和平台行为应结合版本及实测。';
        }
        return {
            steps,
            parts: [
                ...labels.map((l, i) => ({ id: `part-${i}`, name: l[0], desc: l[1] })),
                { id: 'transport', name: 'inet.3', desc: '常用于 BGP VPN 下一跳的传输 LSP 解析；具体解析规则可配置。' },
                { id: 'default', name: '默认处理', desc: '按实际协议、方向、地址族及平台核对默认策略。' },
            ],
            diagram(i) {
                if (o.mode !== 'mpbgp')
                    return flowDiagram(labels, i, {
                        statuses: ['', '', o.rtMatch === 'no' && o.mode === 'priority' && i === 2 ? 'blocked' : ''],
                        caption: '本地机制示意 · 按实际实例类型验证支持',
                    });
                const accepted = o.rtMatch === 'yes';
                let d =
                    region(20, 25, 250, 350, '源 PE') +
                    region(300, 25, 260, 350, 'MP-BGP / VPN 控制面') +
                    region(590, 25, 270, 350, '接收 PE');
                d +=
                    edge('export', 244, 145, 354, 145, 'vrf-export', i === 0 ? 'active' : 'done') +
                    edge('import', 504, 145, 654, 145, 'vrf-import', i === 2 ? (accepted ? 'active' : 'blocked') : '');
                d +=
                    node('part-0', 170, 145, 'VRF-A.inet.0', '客户前缀', i === 0 ? 'active' : '') +
                    node('part-1', 430, 145, 'VPN 路由', 'RD + prefix · RT', i === 1 ? 'active' : '') +
                    node(
                        'part-2',
                        730,
                        145,
                        'VRF-B.inet.0',
                        accepted ? '接受 RT 后候选' : '× RT 不匹配',
                        i === 2 ? (accepted ? 'active' : 'blocked') : '',
                    );
                d +=
                    edge('resolve', 730, 175, 730, 265, '下一跳解析', i === 2 && accepted ? 'active' : '') +
                    node('transport', 730, 295, 'inet.3', '传输 LSP 下一跳', i === 2 && accepted ? 'active' : '');
                d +=
                    text(430, 280, 'bgp.l3vpn.0', 'region-title') +
                    text(430, 306, 'VPN 路由与目标 VRF 分别检查', 'node-sub') +
                    text(440, 418, '分发条件：RT / 策略 · 可用条件：下一跳与路由优选', 'diagram-caption');
                return svg(d, '跨 PE VPN 路由分发与下一跳解析', 450);
            },
            takeaway,
            caution,
        };
    },
};
export const junosLessons = [policy, rib];
