# 托特桌宠素材

由用户提供的四张青绿陶瓷鸟人 JPG，经内置 imagegen 编辑为透明 PNG。
资源保存在项目内，不依赖远程图片地址。

| 文件 | 原图 | 使用状态 |
| --- | --- | --- |
| `idle.png` | 照片 1：站立 | 待机 |
| `wave.png` | 照片 2：挥手 | 开心互动、摸头、聊天头像 |
| `walk.png` | 照片 3：迈步 | 拖动、重力下落 |
| `think.png` | 照片 4：托腮 | 工作、键盘反馈、问答思考 |

保留原有 IPC 与保存的状态名，使旧设置继续有效。四张图是静态姿态，呼吸、按压、键盘反馈与下落动画仍由现有桌宠代码驱动。

编辑提示词（四次调用仅替换姿态为 standing / waving / walking / chin-resting thoughtful）：

> Use case: background-extraction. Edit target: the attached image. Create a clean transparent PNG cutout for a desktop pet. Remove ONLY the white background, including any white background enclosed between the limbs. Preserve this exact turquoise ceramic bird-headed Egyptian character, its [pose] pose, glossy jade glaze, gold flecks, navy outlines, white highlights and eye whites. Do not redraw, change pose, add objects, text or shadows. Keep the entire figure including all feet, generous small transparent margin, centered on a portrait transparent canvas. The background must have real alpha transparency, not painted white or a checkerboard.

## 眨眼序列

`blink-strip.png` 是用户提供的原始透明 PNG（2172 × 724，六列，每帧 362 × 724），未重绘或生成替代帧。`thoth-life.js` 在运行时通过 canvas 读取六个等宽帧，用于眨眼及双眨眼；其他随机待机动作复用上方四张姿态。拖动、摸头、键盘反馈和聊天生成会中断待机动作。

## 朝向与眼神

侧视的 `idle.png`、`walk.png`、`think.png` 按当前显示器中的位置自动镜像，面向中央；正视的 `wave.png` 和眨眼帧保持原样。待机优先展示下方新增的正视肖像。瞳孔附近的轻微动态通过运行时 SVG 位移滤镜实现，文件本身不作修改；闭眼帧禁用眼神位移，保持眨眼完整。

## 2026-10-07 新增观察素材

以下四个文件直接复制自用户提供的透明 PNG，没有重新生成角色：

| 文件 | 原文件时间 | 用途 |
| --- | --- | --- |
| `front-portrait.png` | 20_21_07 | 清晰正视待机，保留轻微眼神动效 |
| `look-directions.png` | 20_21_02 | 抬头、低头，四方向姿态 |
| `look-left-strip.png` | 20_20_40 | 八帧左转与抬头序列 |
| `look-right-strip.png` | 20_20_59 | 八帧右转与低头序列 |

`thoth-artwork.js` 在运行时按实际人物间隙裁切，测量最大连通角色的范围，排除测量中的边缘杂点与相邻角色片段。各帧显示在 400 × 724 画布上，以 y=680 为脚底锚点，最多高 600、宽 360，保持比例。原文件不改写。左右转头选择连续的一段帧、短暂停留后倒序回正，不循环跳帧；侧视帧按当前显示器中央方向镜像，正视、抬头、低头不镜像。新观察帧不叠加瞳孔位移，回到正视才恢复自然眼神。

20_20_45、20_20_49 两组与选用动作重叠，其中部分中间帧转向突变或人物间隙更紧，目前未接入，避免生硬跳转。系统“减少动态效果”会暂停随机姿态和眨眼；随机动作设置关闭后，手动触发仍可用。

旧版根目录的 idle/dragged/happy/chill/fall/pat/typing 动画已清理，当前动作统一引用本目录；根目录的 icon.png 与 Ya1/Ya2.mp3 继续保留。
