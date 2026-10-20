# 教学分镜

## Frame 1
status: built
src: compositions/intro.html
rules: svg-path-draw, dynamic-content-sequencing

为什么有的邻居不需要 Full？：咦，同一个交换机上的五台路由器，为什么有的邻居停在 Two Way，却完全正常？我是小码。今天开一场路由器班会，弄懂 D R、备用代表，还有地图里的神秘伪节点。

## Frame 2
status: built
src: compositions/lan.html
rules: svg-path-draw, dynamic-content-sequencing

一间教室，五位同学：先把场景放简单：五台路由器，接在同一个广播网段。大家用 Hello 确认彼此存在。如果每两台都建立完整邻接，就要维护十组数据库同步关系。人数越多，这张关系网越密。

## Frame 3
status: built
src: compositions/adjacency.html
rules: svg-path-draw, dynamic-content-sequencing

选两位代表，减少同步关系：于是选出主代表 D R，和备用代表 B D R。其他成员，称为 D R Other。大家都与这两位建立 Full；普通成员彼此保持 Two Way。五台设备，完整邻接是七组，不是四组。

## Frame 4
status: built
src: compositions/election.html
rules: svg-path-draw, dynamic-content-sequencing

谁能当代表？先看资格：代表怎么选？优先级为零，表示我不参选；不是我不参加通信。符合条件的候选者，比较接口优先级，数字大者优先；相同再比较 Router ID。注意：这是选举规则，不是随时抢位的排行榜。

## Frame 5
status: built
src: compositions/stable.html
rules: svg-path-draw, dynamic-content-sequencing

迟到的优等生，不会直接抢位：假设代表已经选好，一台优先级更高的新设备才上线。它不会直接赶走现任。选举要考虑 Hello 里大家已经声明的角色，并非每次都重新选最大值。这个不抢占的设计，是为了减少角色和邻接反复震荡。

## Frame 6
status: built
src: compositions/flood.html
rules: svg-path-draw, dynamic-content-sequencing

代表协调的是拓扑消息：再看一次消息传递。广播网段上，普通成员通常把需要泛洪的更新发给组播地址点六，主、备代表都能接收。主代表再向点五传播给所有成员。这是典型流程；确认、重传等细节，还要按协议状态处理。

## Frame 7
status: built
src: compositions/map.html
rules: svg-path-draw, dynamic-content-sequencing

伪节点：地图里的共享网段：接下来换一副眼镜：从同步关系，切换到计算路径的地图。D R 生成二类 Network LSA，把这个共享网段画成一个伪节点。所有相关路由器连向它。这个点代表网段，不代表多出来一台真实设备。

## Frame 8
status: built
src: compositions/data.html
rules: svg-path-draw, dynamic-content-sequencing

数据包不需要找代表签字：最容易混淆的是：地图上的伪节点，不等于数据转发中心。看，R3 要发给同一网段的 R4，数据可以直接交给 R4，并不先绕去 D R。代表负责控制平面的协调，实际怎么转发，仍看路由和下一跳。

## Frame 9
status: built
src: compositions/failover.html
rules: svg-path-draw, dynamic-content-sequencing

主代表离开，备用接班：如果主代表故障，备用代表接任，再选新的备用。备用平时也与大家保持完整邻接，参与数据库同步，并不是睡着的冷备。接班要先检测故障，再更新相关状态，不能把它理解成零时间、零丢包的保证。

## Frame 10
status: built
src: compositions/scope.html
rules: svg-path-draw, dynamic-content-sequencing

这个身份，属于哪一个接口？：还有两个边界：D R 是具体网段上的接口角色。同一台路由器，可以在这里当代表，在另一个网段当普通成员。广播和非广播多路访问网络使用这套机制；点到点网络不选代表，不能只凭线缆是以太网就下结论。

## Frame 11
status: built
src: compositions/quiz.html
rules: svg-path-draw, dynamic-content-sequencing

现在，你会判断了吗？：最后来个小测验：两个普通成员之间停在 Two Way，要立刻重启吗？不用，先看它们是否都已与主、备代表 Full。若应当 Full 的邻接长期卡住，再检查参数、网络类型和报文。先辨角色，再查状态。

## Frame 12
status: built
src: compositions/recap.html
rules: svg-path-draw, dynamic-content-sequencing

记住三幅图，就不会混了：收好今天的三幅图：第一，邻接图，主、备代表减少同步关系；第二，拓扑图，伪节点代表共享网段；第三，转发图，数据不必经过代表。把这三张图分开，很多看似奇怪的状态，就说得通了。
