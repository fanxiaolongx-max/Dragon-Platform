# AI 月报模型与交互验收（2026-11-05）

## 环境与范围

Mac Google Chrome，本机 `http://localhost:3030`。真实月报交互首先在 `/?app=%2Fmonthly` 完成；中途遇到间歇空白及浏览器调试超时，曾使用同一 Chrome 的 `/monthly` 独立页辅助核查。最后已回到新版中台完成真实重新生成、保存、刷新重开和位置测量，保留的验收标签页也是新版中台。

连续刷新压力核查中出现过 CDP 超时，但通过原生 Chrome 界面查看时，月报已完整加载。因此不能仅以自动化超时认定业务页卡死，也不能宣称所有间歇加载现象的根因已解决。

未切换全局默认模型，未覆盖正式月报。单独建立“交互月报模型验收 2026-11-05”。默认模型为 Gemini Flash Lite。其他模型探针仅发送 East/West/North/South 的公开合成数据，未发送实际业务数据，也关闭了模型自动切换，避免将后备模型结果误当目标模型结果。

## 真实结果（小样本，不能作为模型排名）

| 模型 | 两轮代码生成与渲染 | 纯文字要求“文字中心压柱顶” |
|---|---|---|
| gemini-3.1-flash-lite | 两轮成功；SVG、表格及四个标签完整，无测得的横纵溢出 | 生成后标签中心距柱顶约 0 个字高 |
| deepseek-flash | 两轮成功；SVG、表格及四个标签完整，无测得的横纵溢出 | 仍偏约 0.5 个字高，说明纯提示词不足以保证精确展示 |
| z-ai/glm-5.3-flash | 90 秒请求超时 | 未取得可评估输出，不能判定代码能力 |

当前配置未包含 Qwen、GLM-5.2；本次没有测试它们。

## Chrome 实际拖动

真实鼠标下移四个百分比标签，不先保存直接点“再试一次”。生成前后的文字中心到对应柱顶的距离（按字高归一化）分别为：

| 标签 | 生成前 | 生成后 |
|---|---:|---:|
| 58.9% | 0.041091 | 0.041090 |
| 66.2% | 0.278357 | 0.278356 |
| 9.8% | 0.039640 | 0.039647 |
| 89.3% | 0.159723 | 0.159724 |

继续修改标签字号为 16px，并反转分类顺序。程序恢复后的对应距离仍一致；表格和总结保留。该轮同时发现模型摘要会错误重配类别与数值，因此已把机器记录从摘要输入中隔离，由前端程序合并，并在展示记录中补上类别名称。

最终在新版中台再次点“再试一次”，本次生成把图表改成 ECharts SVG，TE / 58.9% 的标签仍成功绑定对应柱顶。保存并刷新中台后测得中心距柱顶 -0.040624 个字高，字号为 16px；页面显示“已保存”，保存按钮禁用。该次核查还覆盖了图表实现变化后的恢复。截图：`/tmp/ai-report-chrome-shell-verified.png`。

## 发现并修正

- 中台首次 iframe 导航改用 src；刷新控件按当前工具地址重新加载。间歇加载问题仍需独立追踪。
- 手工记录不再交给摘要模型重新映射、复述；程序合并原锚点，并明确类别。
- 成功恢复后清空待恢复队列，避免重开重复写入历史。
- 锚点约束下的像素坐标属于派生值，不参与未保存判断；真正的相对关系和文字变化仍参与判断。

## 可重复检查

- `node --test tests/ai-report-interactive.test.js tests/ai-report.test.js tests/ai-report-presentation.test.js tests/ai-report-target-label.test.js tests/ai-report-layout-scrollbar.test.js tests/report-snapshot-target-month.test.js tests/report-target-auto-fill.test.js tests/report-export-filenames.test.js`
- `node_modules/.bin/electron tests/ai-report-interactive-browser.cjs`（包含重新生成、更换容器名/分类顺序/字号及保存重开）
- `node_modules/.bin/electron tests/ai-report-model-generated-browser.cjs <探针结果目录>`（仅渲染已生成文件，不发起模型请求）
- `HOME_TOOL_EXTERNAL_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs`（九类工具及原始自定义工具链接）
- `npm --prefix backend run doctor`

上述 Node 定向测试共 49 项通过；交互浏览器回归、九类工具链接回归、实际模型四份输出的渲染核查均通过。修改的 JavaScript 已执行 `node --check`，`git diff --check` 通过。

探针结果目录：`/tmp/air-real-models-EqwybC`。临时文件不属于长期存储。
