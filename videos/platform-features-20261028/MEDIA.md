# 素材与制作记录

- 小龙参考图由用户提供。透明讲解/倾听姿态由图像生成工具根据参考图制作；保持毛毡材质和同一角色，不使用机器人替代。
- 真实产品界面：本地 Electron 加载当前前端组件，API 只返回清楚标注的合成示例；AI 月报截图来自仓库 README 公开脱敏说明。
- 配音：Edge TTS / zh-CN-XiaoxiaoNeural，-3% 语速；分段生成并以实际逐词边界安排字幕。音频未人工试听，做数字响度与削波检查。
- 配乐：scripts/score.py 原创固定和声与稀疏钢琴/低音；不使用下载商用音乐；四集转调区分，按语音能量压低配乐。
- 字体：Google Fonts Noto Sans SC 子集，OFL 许可证见 assets/FONT-OFL.txt。
- 动画：GSAP 3.14.2（文件保留许可头）；HyperFrames 0.8.186，30fps，单渲染 worker；原生 HTML/CSS/SVG，可编辑。
- 制作前检索了 browser-device-stage / agent-cursor / chat reveal；审阅 browser-device-stage 源码后，采用面向实际界面和数据流程的简化工作台，不挂载无用示例组件。
- 所有 MP4、配音与渲染缓存保留在 256G 工作目录；成片发布独立媒体仓库，代码仓库仅保存制作源码、角色图、封面与清单。
