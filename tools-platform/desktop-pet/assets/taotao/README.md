# 桃桃彩蛋素材

四张挥手帧、两张向右跑步帧，从用户在本次会话创建的桃桃透明图集中提取，每张192×208透明PNG。
`peek-right.png` 是基于同一角色由内置 ImageGen 补绘的侧身探头姿态，裁去透明留白并缩小至192×177，不重画生成像素。
仅打包这7张小图，不包含完整的73帧图集。探头图的颈部与爪子沿原生窗口的右边界被遮挡；动画横向出入，不裁切站姿模拟探头。

源图SHA-256：`df5a98638728d711cf3071b5f78b00f31aac922406550fe44bc0f5b957825cfa`。

## 侧身探头生成提示词

Built-in `image_gen`，透明背景；参考原桃桃挥手图和 canonical base。

> Asset type: small transparent desktop-pet easter-egg sprite. Create ONE sideways peek pose of the exact pink plush bear Taotao in reference, same pink heart sunglasses, purple nose, two buck teeth, original black eyes, white plumeria at its original ear, soft 3D plush material. The bear is hiding OUTSIDE the RIGHT edge of a computer display and playfully leans its HEAD LEFT into the screen, head tilted counterclockwise about25degrees. Show only its head, a tiny bit of floral-shirt shoulder near the RIGHT boundary, and ONE small purple-clawed paw curling around that invisible vertical right edge. Its neck/body extend off to the RIGHT, not downward; NO torso, shorts, legs or feet visible. Face still recognizably looking toward viewer with warm goodbye smile, both heart lenses visible. Head and paw occupy left/center; everything should feel attached to a bear concealed on the right. Rightmost neck/shoulder ends in a straight vertical crop at the right edge, as if occluded by monitor bezel. Don't draw a monitor, door, edge line, surface or any scenery. Actual transparent background, no shadows, effects, text or labels. Single isolated head-and-paw sprite, clear silhouette readable at120px. Preserve flower physical ear; no identity changes. Not a front-standing bear cropped at the waist: specifically horizontal lean out from RIGHT with full body hidden off right.
