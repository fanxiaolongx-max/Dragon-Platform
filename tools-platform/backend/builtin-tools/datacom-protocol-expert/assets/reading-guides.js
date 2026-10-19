// 补充阅读边界，不改写租户原笔记或用户修订。以文章 ID 关联内置主题。
export const readingGuides = {
    'juniper-rt-priority': [
        '按导入、导出两个方向分别查看实际生效策略。策略列表顺序、community 动作与终止动作都影响结果。',
        '不要把普通 BGP 的默认行为直接套到 vrf-export 或 auto-export；应检查具体挂载点。',
    ],
    'junos-vrf-auto-export': [
        '把本地 VRF 互通、跨 PE VPN 路由分发和向 CE 发布分开验证。auto-export 主要涉及同一 PE 的本地路由泄露。',
        '笔记中的 iBGP/eBGP 差异属于具体实验条件，不宜概括为“特权通道”或单凭原始协议推断结果。',
    ],
    'junos-vrf-lab-verified': [
        'vrf-import 的匹配并非“必须且只能是 RT”。Junos 官方示例允许在 community 条件之外组合 protocol 等条件。',
        '实测结论应带上设备型号、版本、地址族、策略挂载方向以及 auto-export / vpn-apply-export 配置。',
    ],
    'junos-default-route': [
        '先确认本地是否存在可用的缺省路由，再核对生成、匹配、发布三个环节。',
        '匹配 0.0.0.0/0 exact 与匹配所有 static 路由语义不同；aggregate 是否产生也受贡献路由等条件影响。',
    ],
    'juniper-vs-huawei-policy': [
        '比较相同协议、相同方向、相同地址族的策略行为，避免仅凭“拉取/推送”比喻翻译配置。',
        '迁移时应明确设计未命中动作；只有业务意图确实是放行时，才添加 permit 兜底。',
    ],
    'junos-rib-tables': [
        'RIB 是控制面候选与选路信息，FIB 是转发信息；不能把所有以 .0 结尾的表都直接称为转发表。',
        'bgp.l3vpn.0 与 VRF 表的存在关系依路由来源与配置而异；不能仅凭表名判断路由尚未导入。',
    ],
    'junos-policy-engine': [
        '把匹配、属性修改、控制流分开检查。普通策略链中 accept/reject 终止，next term/next policy 控制继续的位置。',
        '不同类型匹配条件通常按 AND 组合；同类多个值、community 与 route-filter 的组合还各有规则。',
    ],
    'junos-vrf-leaking': [
        '先选择本地导入、多表导入或跨 PE VPN 分发，再确认设备与实例类型是否支持。',
        'RD 来自 VRF 配置并区分 VPN 前缀；RT 由策略控制分发。vrf-import 不只能够匹配 community。',
    ],
    'ospf-lsa-handbook': [
        '比较同一作用域内、同一三元组 LSA 的新旧；不同区域内的 LSA 不应仅凭三元组混在一起仲裁。',
        'P=1 与 FA 非零是 Type-7 翻译的基本门槛，还需翻译者选择、路由选择及聚合条件。',
    ],
    'ospf-te-opaque': [
        'Type-9/10/11 表示泛洪作用域，不表示某一固定业务。TE、GR、SR 的扩展还需查看各自规范。',
        '区域内前缀与 ABR 再通告通常使用区域作用域；SR Mapping Server 可按配置使用区域或 AS 作用域。不要将 Type-11 与 Prefix-SID 一一对应。',
    ],
    'ospf-areas': [
        '先比较普通、Stub 与 NSSA 的 LSA 范围，再检查缺省路由的生成者与触发配置。',
        'NSSA 缺省是否自动生成具有实现与配置前提；Totally 扩展并不删除本区域的 1/2 类 LSA。',
    ],
    'ospf-lsr-triplet': [
        'DD 用 LSA 头部比较版本，LSR 用三元组指定请求对象，LSU 才运输完整内容。',
        '接收 LSU 后仍需校验版本、校验和与接收状态；实际确认可采用显式或隐式方式。',
    ],
    'ospf-fa': [
        'FA=0 时解析 ASBR；FA 非零时解析 FA。后者必须具有合格的 OSPF 区域内或区域间可达路径。',
        '“旁路 ASBR”只是某些共享网段拓扑的结果，不是所有非零 FA 的保证。',
    ],
    'ospf-checksum': [
        'LS checksum 排除 LS age。密码学认证 AuType=2 时，OSPF 报文 Checksum 字段置 0。',
        'Fletcher-16 对位置敏感，但不是所有交换错误都必然检出；校验和不提供身份认证。',
    ],
    'ospf-lsa-philosophy': [
        '先区分真实链路、完整邻接与 SPF 逻辑边：三者不一定一一对应。',
        'ABR 生成新的区域间通告，不能把 1/2 类原样跨区域泛洪画成正确过程。',
    ],
    'ospf-dr-bdr': [
        'DR/BDR 是接口所在网段上的角色。DROther 相互停留在 2-Way 可以是正常状态。',
        'DR 组织同步与泛洪，不是业务数据的强制中转站；伪节点表示共享网络。',
    ],
    'rfc1071-checksum': [
        '发送侧先把校验和字段清零，按 16 位字累加、回卷进位，再取反。',
        '接收侧连同校验和计算，一的补码和应为 0xFFFF；偶然碰撞仍可能漏检错误。',
    ],
    'ospf-lsa-options': [
        'Options 的 E-bit 表示外部路由处理能力；ASBR 身份的 E 标志位在 Router-LSA 正文，位置和含义不同。',
        '同一比特位置在不同报文或 LSA 中可能有不同语义，必须连同类型解释。',
    ],
    'crc-checksum-system': [
        'CRC 覆盖本次链路传输的帧；IPv4 校验和只覆盖 IP 头；TCP 校验和覆盖 TCP 头、数据及伪首部。',
        '校验覆盖范围与检错强度是不同问题；CRC/Checksum 不能替代加密认证。',
    ],
    'ospf-convergence': [
        '分开观察故障检测、LSA 产生/接收、SPF 调度与业务切换，不把所有机制归为同一种“抑制”。',
        '提高 cost 依赖可用的备选路由；hold-down 则直接限制邻接。定时器默认值需要按版本核对。',
    ],
    'ospf-packets': [
        '先区分五种 OSPF 报文与各类 LSA。所有 OSPFv2 报文共用 24 字节公共头。',
        '组播目的地址与报文类型、接口角色、网络类型及确认方式有关，不宜仅靠设备角色一概判断。',
    ],
    'ospf-fsm': [
        '状态属于邻居关系的本地视角，双方不一定同一时刻进入同一状态。',
        'Exchange 后请求列表为空可直接进入 Full；ExStart/Exchange 卡住并不只有 MTU 一种原因。',
    ],
    'ospf-network-types': [
        '网络类型决定发现邻居、是否选 DR/BDR 以及部分默认参数。两端应按同一种网络模型工作。',
        '默认 Hello/Dead 值与厂商实现相关，排障时以实际接口输出为准。',
    ],
    'ospf-auth': [
        '简单口令认证不隐藏口令；密码学认证携带认证参数与摘要，但不加密 OSPF 内容。',
        '换密需要同时验证两端支持的算法、Key ID 与收发有效期，不能仅凭时间窗重叠保证无中断。',
    ],
    'ospf-router-types': [
        'IR、骨干路由器、ABR、ASBR 是功能角色，其中部分角色可以同时出现。',
        'ABR 的识别与工作条件存在实现差异；连接骨干、邻接状态和路由通告资格应分别检查。',
    ],
    'ospf-filter': [
        '排障时分别查看 LSA 是否存在、路由是否安装；filter-policy import 不等于阻止所有泛洪。',
        '接口出向 LSA 过滤的结果依赖是否存在其他传播路径，不能把单一路径示例直接套到冗余网络。',
    ],
    'ospf-default-params': [
        '区分 RFC 常量、厂商默认值和人为规划值；为设备版本建立可验证的参数基线。',
        '调整参考带宽需全域一致规划，并不意味着所有现网都应无条件修改默认值。',
    ],
    'ospf-router-id': [
        'Router-ID 是协议标识，不要求等于当前转发接口地址；唯一性比数值大小更重要。',
        '把下一次选举的候选值与当前运行值分开看；实际生效条件按设备版本确认。',
    ],
};
