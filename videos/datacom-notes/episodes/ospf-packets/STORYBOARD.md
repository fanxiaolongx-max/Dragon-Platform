# 教学分镜

## Frame 1
status: built
src: compositions/intro.html
rules: svg-path-draw, dynamic-content-sequencing

路由器见面后，到底聊什么？：两台路由器刚见面，总不能把整本地图一股脑扔过去吧？我是小码。今天跟着一次地图交接，认识 OSPF 的五种报文。从打招呼，到比目录、补内容、确认收货。把它们放进同一个故事，缩写就不难记了。

教学结论：五种报文分工合作；本片以 OSPFv2 为范围。

## Frame 2
status: built
src: compositions/envelope.html
rules: svg-path-draw, dynamic-content-sequencing

先拆开信封：不是 TCP 或 UDP：先看信封。OSPFv2 直接封装在 IP 里，协议号是八十九，不使用 TCP 或 UDP 端口。每种 OSPF 报文都有二十四字节的公共头，记录版本、报文类型、长度、路由器标识、区域和校验认证信息。类型字段选的是五种报文，不是 LSA 类型。

教学结论：IP 协议号 89；OSPF 公共头 24 字节。

## Frame 3
status: built
src: compositions/hello.html
rules: svg-path-draw, dynamic-content-sequencing

① Hello：你听见我了吗？：第一种是 Hello。它负责发现和维持邻居，也帮助选举主、备代表。收到 Hello，不等于已经双向通信。只有在对方的邻居列表里看到自己，才确认双向可达。区域、计时器、认证和网络相关参数要相容；检查掩码时，还要考虑网络类型的例外。

教学结论：Hello 是发现与保活；双向可达还要在对方列表看见自己。

## Frame 4
status: built
src: compositions/dd.html
rules: svg-path-draw, dynamic-content-sequencing

② DD：先对目录，再补正文：需要完整邻接的双方，先在 ExStart 协商主从和初始序列号，通常由路由器标识较大的一方作主。然后在 Exchange 交换 DD，也叫数据库描述报文。里面主要是一条条完整的二十字节 LSA 头。就像先比图书目录，不是先搬整座图书馆。

教学结论：DD 携带 LSA 头部摘要；主从关系服务于数据库交换。

## Frame 5
status: built
src: compositions/request.html
rules: svg-path-draw, dynamic-content-sequencing

③ LSR：按身份点名索取：比完目录，发现缺书或版本落后，就发第三种报文，链路状态请求，也就是 LSR。请求项只写三样：类型、链路状态标识、通告路由器。它按身份点名，不带序列号。对方会发送当前可提供的实例；收到正文后，仍要按协议检查它的新旧和有效性。

教学结论：LSR 的三元组用来点名；正文回来以后仍要校验。

## Frame 6
status: built
src: compositions/update.html
rules: svg-path-draw, dynamic-content-sequencing

④ LSU：真正搬运 LSA 正文：第四种是链路状态更新，也就是 LSU。一个更新报文能装一条或多条完整 LSA，所以报文、LSA、数据库，是三个层次。LSA 是一张地图资料卡，LSU 是运输这些卡片的信封，LSDB 是收好卡片的资料库。网络变化时，更新也会通过这套泛洪机制传播。

教学结论：LSU 可装多条完整 LSA；LSA 不是第六种 OSPF 报文。

## Frame 7
status: built
src: compositions/ack.html
rules: svg-path-draw, dynamic-content-sequencing

⑤ LSAck：收到了，才能停止重传：第五种是链路状态确认，也就是 LSAck。它携带被确认 LSA 的头部，让发送方撤下对应的重传项。要注意，有些场合收到对方泛洪来的同一实例，也能形成隐式确认，不一定每次都单独回一包。OSPF 自己维护确认和重传，可靠泛洪不依赖 TCP。

教学结论：可靠性来自协议自己的确认与重传；还存在隐式确认。

## Frame 8
status: built
src: compositions/timeline.html
rules: svg-path-draw, dynamic-content-sequencing

连起来看：不是只走一遍的流水线：把过程串起来：Hello 建立双向认识，DD 对目录，LSR 点名，LSU 补正文，确认让可靠交换收尾。初次同步完成，可以进入 Full。但这不是五步只跑一次：Hello 持续保活，拓扑变化还会继续发送更新和确认。普通成员之间，也可能正常停在 Two Way。

教学结论：Full 表示该邻接完成数据库同步；Hello 与增量更新仍会继续。

## Frame 9
status: built
src: compositions/trouble.html
rules: svg-path-draw, dynamic-content-sequencing

卡在 ExStart / Exchange，查哪一层？：如果应当完整邻接的两端，长期卡在 ExStart 或 Exchange，先别反复重启。先核对接口 MTU 和 DD 交换，再看路由器标识是否重复、主从协商是否稳定，以及是否丢包或被策略拦截。卡在 Loading，则重点追请求清单里缺哪条 LSA，以及更新和重传是否正常。

教学结论：先定位状态对应的报文，再查参数与收发证据。

## Frame 10
status: built
src: compositions/quiz.html
rules: svg-path-draw, dynamic-content-sequencing

小测：缺一条正文，该发什么？：小测验：DD 告诉我，对方有一条更新的 LSA，但我还没有正文。下一步该发什么？先想一秒。答案是 LSR，按三元组请求。对方用 LSU 送来正文，再完成确认。不是再发一次 Hello，也不是把 DD 当成正文直接算路。

教学结论：需要正文：LSR 请求 → LSU 提供 → 确认。

## Frame 11
status: built
src: compositions/recap.html
rules: svg-path-draw, dynamic-content-sequencing

五个名字，只记一件事各自做什么：最后把五个名字装进口袋：第一，Hello 负责认识和保活。第二，DD 比目录，LSR 点名要内容。第三，LSU 搬正文，LSAck 确认收货。看抓包时，先问这包想完成什么，再看里面装的字段，就能从缩写看到过程。

教学结论：先认报文职责，再读字段；把一次交换看成完整故事。
