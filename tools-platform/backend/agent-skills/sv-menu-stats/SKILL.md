---
name: sv-menu-stats
name_en: SV Menu Stats
description: SV 餐厅（微信 SV 群）餐单速查与作图：最近 N 天/某月菜品频次和重复率、重复排行、横向柱状图 PNG 生成、某道菜出现次数、某天吃了什么、新菜及按需导出 Excel。用户问食堂/餐厅菜单统计或要图表时使用。包内自带截至 2026-11-15 的数据。
description_en: SV canteen menu stats and chart generator from the WeChat SV group - rolling N-day or monthly frequency, repeat rate, horizontal bar chart PNGs, daily menus, rankings, JSON output, and on-demand Excel export.
workspace: true
order: 100
icon: 🍱
---

# SV 餐厅餐单速查

目标：直接通过内置 `sv-menu` 命令只读统计 SV 餐厅菜品频次与重复率、生成横向柱状图 PNG，并按需导出 Excel 汇总，无需直接解析大表格。

> [!IMPORTANT]
> **你（AI）必须自己用命令工具运行 `sv-menu`，再把结果用简短中文告诉用户，先说数字。**
> **做统计或画柱状图时，一律直接用 `sv-menu`（带 `--json` 或 `--chart auto`）出数和出图——严禁去读 Excel，严禁猜列名写 `pandas.read_excel`，也严禁用 ASCII `#` 字符画敷衍“做图片/做柱状图”需求！**

命令路径在本技能目录里（技能说明末尾列出了目录路径，记为 `<技能目录>`）：

```bash
S="<技能目录>/sv-menu"
"$S" status        # 先确认可用、看数据截止日期与在线/离线模式
```

数据机制：本技能自带 `work/slots.json.xz`（截至 2026-11-15，开罗时间），首次运行自动解压，不依赖外部包即可查询。如果宿主机连着微信实时仓库（`/Volumes/512G/wechat-local-vault`），会自动切换为在线实时数据，需要拿最新消息时加 `--refresh`（仅刷新缓存，不自动复制 Excel 到 `~/Downloads`）。

## 问法 → 命令

| 用户问 | 推荐命令 |
|---|---|
| 最近一个月 / 近 N 天重复最多、常吃排行 | `"$S" top 30 --days 30 --min-count 2 --no-staple --json`（如需含常备项与饮品去掉 `--no-staple`） |
| 要图片柱状图（如“做横向柱状图”“画个排行图”） | `"$S" top 15 --days 30 --min-count 2 --no-staple --chart auto --json`（若查某月把 `--days 30` 换为 `--month YYYY-MM`） |
| 某月排行 / 这个月重复最多的菜 | `"$S" top 15 --month YYYY-MM [--no-staple] [--meal 午餐] --json` |
| 需要按餐次筛选 | 加上 `--meal 早餐\|午餐\|晚餐\|夜宵` |
| 某月概况、重复率、新菜数 | `"$S" month [YYYY-MM] [--json]` |
| 按月一览（对比多月走势） | `"$S" months [--last N] [--json]` |
| 某道菜吃过几次、近半年趋势 | `"$S" dish <关键词> [--json]` |
| 今天 / 某天吃什么 | `"$S" --refresh today`、`"$S" date YYYY-MM-DD` |
| 某月新菜 | `"$S" new [YYYY-MM] [--json]` |
| 用户明确要求导出/下载 Excel 汇总表 | `"$S" export`（仅当用户明确要求放到 Downloads 时才加 `--downloads`，或用 `--out <路径>`） |

## 图片展示与作图规范

- **`sv-menu top ... --chart auto --json`** 会自动检测中文字体并直接绘制高分辨率横向柱状图 `.png`（优先保存在平台 `outputs/sv-menu/` 下，保证本机、管理员及网页端都能直接加载预览），同时在 JSON 的 `chart` 字段返回图片的本机绝对路径；如用户要求保存到工作区指定文件，也可传 `--chart "$PWD/sv_menu_top.png"`（注意避免 `.` 开头的隐藏目录）。
- 生成图片后，**直接在回复中用 Markdown 图片语法嵌入绝对路径**：
  ```markdown
  ![SV餐厅近期高频菜品横向柱状图](<这里填命令输出的 chart 绝对路径>)
  ```
- 如果还需要画其它类型图表（如多月折线趋势），先用 `sv-menu months --json` 或 `sv-menu dish <关键词> --json` 拿精确数据再用 Python 绘图，不要自己编造或读取大 Excel。

## 统计口径

- **最近 N 天（`--days N`）**：以数据最新日期 `d1` 为止往前含当天共 N 个自然日（例如 `--days 30`）。
- **重复率**：`1 - 当月不同菜品数 ÷ 当月菜品出现总次数`，整月一般 52%–60%；首尾不足月会偏低，汇报时需说明。
- **常备项与饮品（`--no-staple`）**：排除米饭、杂粮饭、馒头、花卷、汤粉、汤面、水煮蛋、煎蛋、茶叶蛋、牛奶、酸奶、豆浆、果汁、水果、清炒时蔬、玉米、红薯等高频常规供给；使用该参数时应在结论或图注中注明“已排除常备主食、鸡蛋、果蔬及饮品”。
- **只发图片的餐次**：仅群内文字餐单纳入菜品统计，纯图片餐次不计入菜名。

## 规矩

- 只读查询，不发微信，不提交 git，不删除用户文件。
- 默认不要改动 `~/Downloads` 下的文件；只有用户明确要求导出或下载 Excel 时才调用 `export --downloads`。

## 目录

- `sv-menu`：查询、画图与导出 CLI（支持 `matplotlib` 中文字体绘柱状图，并内置 `Pillow` 兜底）
- `work/`：`slots.json.xz`（或本地 `slots.json`）、`stats.json`、`analyze_meta.json`、`analyze.py`、`build_freq.py`、`parse.py`
