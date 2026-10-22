# 教学分镜

## Frame 1
status: built
src: compositions/intro.html
rules: svg-path-draw, dynamic-content-sequencing

路由表，是谁拼出来的？：路由表写着去哪里、从哪儿走，可是这些答案怎么来的？我是小码。今天把 OSPF 的 LSA 当作一张张资料卡，先认卡片，再拼地图，最后计算路径。学完你会发现，收到一条消息，和装进一条可用路由，中间还隔着好几道判断。

教学结论：先有资料，再有计算；LSDB 和路由表承担不同工作。

## Frame 2
status: built
src: compositions/identity.html
rules: svg-path-draw, dynamic-content-sequencing

一张卡：身份、版本、正文：每张 LSA 都有二十字节的公共头。在同一个泛洪作用域里，类型、链路状态标识、通告路由器，三元组决定身份。序列号、校验和、老化时间，帮助比较同一身份的不同实例。跨区域查数据库，还要带上区域上下文，不能把三元组当作脱离作用域的万能编号。

教学结论：先限定作用域，再以三元组认身份；版本字段另作比较。

## Frame 3
status: built
src: compositions/router.html
rules: svg-path-draw, dynamic-content-sequencing

Type 1：我连接了谁，代价多少：先看一类，路由器 LSA。每台路由器按它参与的区域，描述自己的连接和开销。图里 R1 到 R2 的代价是十，到 R3 是三十。另一台路由器也会描述自己的方向，因此不要先假定双向开销一定相同。一类资料留在所属区域，不原样越过区域边界。

教学结论：Type 1 描述本路由器的连接与 cost；作用域是区域。

## Frame 4
status: built
src: compositions/network.html
rules: svg-path-draw, dynamic-content-sequencing

Type 2：共享网段，是图里的一个点：共享广播网段不能简单画成所有路由器之间的独立线路。主代表用二类 LSA 描述这个网络和与它完整邻接的路由器，包含自己。计算图里，路由器连到网段，代价来自接口；网段连回路由器的代价是零。这个伪节点用来表达拓扑，不代表数据必须绕主代表走。

教学结论：Type 2 由 DR 始发；伪节点是拓扑抽象。

## Frame 5
status: built
src: compositions/summary.html
rules: svg-path-draw, dynamic-content-sequencing

Type 3：跨区域，只带路标：到了区域边界，边界路由器不会把另一片区域的全部细节原样搬进来。它用三类 LSA 告诉你，某个前缀可达，代价是多少。内部设备把到边界的开销，加上这张路标的开销。注意，名字里有 summary，并不表示它必然合并多个前缀；地址聚合还要另外配置。

教学结论：Type 3 传递区域间前缀与代价；Summary 不等于必然聚合。

## Frame 6
status: built
src: compositions/external.html
rules: svg-path-draw, dynamic-content-sequencing

Type 4 / 5：找出口，和找目的地：再看外部路由。自治系统边界路由器用五类 LSA 宣告外部前缀。其他区域还可能需要四类 LSA，知道怎样到达这位边界路由器。四类找发布者，五类说目的地。若五类里的转发地址非零，则还要按规则求到转发地址的内部路径；两种字段别混在一起。

教学结论：Type 4 提供 ASBR 可达性；Type 5 描述外部目的前缀。

## Frame 7
status: built
src: compositions/seven.html
rules: svg-path-draw, dynamic-content-sequencing

Type 7：NSSA 里的外部资料卡：如果外部路由来自 NSSA，区域内先用七类 LSA 表达。符合翻译条件时，由翻译边界路由器生成五类，传播到允许接收的其他区域。不是所有七类都必然翻译：还要看传播位、转发地址、翻译者和路由选择等条件。七类本身仍留在 NSSA 里。

教学结论：Type 7 留在 NSSA；符合条件才由翻译 ABR 生成 Type 5。

## Frame 8
status: built
src: compositions/spf.html
rules: svg-path-draw, dynamic-content-sequencing

真的算一次：近路不一定直连：现在动手算一小段区域内路径。R1 直达 R3 的开销是三十。先到 R2 花十，再从 R2 到 R3 花五，总共十五。于是去 R3 的更短路径经过 R2。它们可以拥有一致的区域拓扑资料，但每台设备以自己为根算树，所以最后的下一跳并不相同。

教学结论：R1 → R2 → R3：10 + 5 = 15，优于直达 30。

## Frame 9
status: built
src: compositions/metric.html
rules: svg-path-draw, dynamic-content-sequencing

外部 E1 / E2：别只看一个数字：外部路径又多一层。拿相同外部前缀、相同外部路由类型的候选来比，图里两个出口的外部代价分别是二十和十，内部到出口的代价是五和三十。E1 会相加，分别是二十五和四十；E2 先比外部代价，因此更偏向外部十的出口。若 E2 外部代价相同，再比较内部代价等规则。

教学结论：E1 比总开销；E2 先比外部开销，平手再看内部。

## Frame 10
status: built
src: compositions/freshness.html
rules: svg-path-draw, dynamic-content-sequencing

同一张卡，哪个版本更新？：同一身份的两份 LSA，先比较有符号序列号，数值大的更新；相同，再比较校验和，大的更新。还相同，如果只有一份达到最大老化时间，它优先用于撤销。否则年龄差超过九百秒时，较年轻的更新；差距没有超过，就视为同一实例。不能简单说，年龄小的永远胜出。

教学结论：比较顺序：序列号 → 校验和 → MaxAge → Age 差。

## Frame 11
status: built
src: compositions/aging.html
rules: svg-path-draw, dynamic-content-sequencing

刷新与撤销：地图也有保质期：普通情况下，即使内容不变，始发者也会在三十分钟左右刷新自己的 LSA，更新序列号。最大老化时间是一小时。主动撤销时，也能把年龄设为最大值，再泛洪出去。达到最大年龄并不是立刻无条件删除，还要满足确认、同步等清理条件。刷新、变化和撤销，是三件不同的事。

教学结论：常规刷新 1800s；MaxAge 3600s；清理还受协议条件约束。

## Frame 12
status: built
src: compositions/quiz.html
rules: svg-path-draw, dynamic-content-sequencing

小测：同一地图，下一跳也相同吗？：来个小测：同一区域的路由器同步了相同的拓扑资料，下一跳就必须完全一样吗？答案是不必。每台设备以自己为根计算，所处位置不同，下一跳当然可以不同。还要检查发布信息是否有效、内部路径是否可达，以及是否被其他候选路由优先选中。

教学结论：LSDB 一致不等于路由表逐行相同。

## Frame 13
status: built
src: compositions/recap.html
rules: svg-path-draw, dynamic-content-sequencing

一套资料，三层理解：把今天的知识折成三层：第一，识别资料卡，分清身份、版本和作用域。第二，一二类拼本区拓扑，三四类提供跨区路标，五七类带来外部前缀。第三，算出路径，再完成路由选择。先分清资料和结果，面对一大屏数据库，就能知道从哪里读起。

教学结论：先认类型和范围，再看版本与路径，最后验证路由结果。
