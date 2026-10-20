# 教学分镜

## Frame 1
status: built
src: compositions/intro.html
rules: svg-path-draw, dynamic-content-sequencing

路由是谁说的，包就要交给谁？：假设有人告诉你，快递从旁边的出口送更近。你会先绕到告诉你的人家里吗？我是小码。今天看懂转发地址 F A：它把谁发布路由，和数据应该朝哪里走，分开表达。

## Frame 2
status: built
src: compositions/fields.html
rules: svg-path-draw, dynamic-content-sequencing

先认清路由通告里的三个角色：先认识一张外部路由通告。目的前缀，说明业务要去哪里。Advertising Router，记录谁生成这条 LSA。Forwarding Address，提供计算转发方向的地址。这三个字段回答不同问题，不能因为发布者是 R3，就认为数据必须经过 R3。

## Frame 3
status: built
src: compositions/topology.html
rules: svg-path-draw, dynamic-content-sequencing

搭一个能看出差别的小网络：来看这张小地图：R1 是内部观察者。R2、R3 和外部网关，接在同一个以太网。R3 引入外部路由，叫作自治系统边界路由器，简称 ASBR。R2 连接两个区域，是区域边界路由器，简称 ABR。外部网关不运行 OSPF，但它所在网段在内部可达。我们比较两种 F A。

## Frame 4
status: built
src: compositions/zero.html
rules: svg-path-draw, dynamic-content-sequencing

FA 为零：沿内部路径找 ASBR：第一种，F A 等于零点零点零点零。它不是丢包地址，而是一个约定：先按内部路由，到达发布这条外部路由的边界路由器。于是包从 R1 到 R2，再交给 R3，最后由 R3 发给外部网关。在这个共享网段的例子里，多了一次折返。

## Frame 5
status: built
src: compositions/nonzero.html
rules: svg-path-draw, dynamic-content-sequencing

FA 非零：转向指定的递归目标：第二种，转发地址填外部网关的地址。R1 先查怎样到达这个地址，下一跳仍是 R2；R2 发现网关就在本地网段，可以直接送过去。看，发布者还是 R3，业务流量却绕开了它。这才是这个例子优化路径的关键。

## Frame 6
status: built
src: compositions/recursive.html
rules: svg-path-draw, dynamic-content-sequencing

FA 不等于每台设备的直接下一跳：停一下，这里特别容易背错。非零 F A，不等于每台路由器都能直接对它做地址解析。R1 离外部网关还远，所以先发给 R2。F A 是递归查找的目标，路由表里的直接下一跳，要从到达目标的路径推导出来。

## Frame 7
status: built
src: compositions/missing.html
rules: svg-path-draw, dynamic-content-sequencing

看得见 LSA，为什么没有业务路由？：如果通告已经收到，可是查不到到达 F A 的区域内或区域间路径呢？这条外部通告就不能据此安装路由。只靠另一条外部路由来兜这个 F A，也不满足这条计算规则。因此，数据库里有 LSA，不代表路由表里一定有对应路由。

## Frame 8
status: built
src: compositions/origin.html
rules: svg-path-draw, dynamic-content-sequencing

非零地址，不是想填就填：那发布者什么时候能填非零地址？要看引入路由的下一跳、出接口是否参与 OSPF，以及网络类型等条件，具体还要核对设备实现。不要把这个教学例子，当成所有外部路由的固定模板。F A 非零，也不保证每张拓扑都能绕过边界路由器。

## Frame 9
status: built
src: compositions/nssa.html
rules: svg-path-draw, dynamic-content-sequencing

进阶：NSSA 翻译，身份与方向分离：再向前一步：NSSA 是允许本地引入外部路由的一种特殊区域。七类通告翻译成五类时，发布者会变成执行翻译的边界路由器；保留下来的 F A，继续指明转发目标。普通翻译通常要求 P 位请求传播，且 F A 非零，但这只是资格条件，还要满足翻译者与路由处理规则。

## Frame 10
status: built
src: compositions/debug.html
rules: svg-path-draw, dynamic-content-sequencing

排障时，按这三步走：排障可以按三步走。先看外部 LSA，确认前缀、发布者和 F A。再查到 F A 的内部路径，以及真正解析出的下一跳。最后核对业务路由和实际转发。在 NSSA，还要看 P 位与翻译者状态。别只盯着一个字段就下结论。

## Frame 11
status: built
src: compositions/recap.html
rules: svg-path-draw, dynamic-content-sequencing

一张名片，一张导航卡：最后，用两张卡记住它：发布者像名片，告诉你谁提供消息；转发地址像导航卡，告诉你沿哪个目标去计算路径。为零，先找发布者；非零，先核对内部可达性，再递归解析。分清消息的来源和数据的方向，F A 就不神秘了。
