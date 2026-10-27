# 数字人基座对接（NetCare 数据）

平台的 Node 后端直接请求运营数字人基座的 REST API，读取 NetCare 业务库、读写本应用 schema。参考工程「写报告服务」前面那层 FastAPI 只是它部署上线需要的外壳，这里不经过它。第一期只开放给管理员，业务库只读。

## 配置

入口：「全局设置 › 频道对接 › 数字人」。

1. 在「配置导入」里粘贴写报告服务的 `.env` 文本（从截图识别出来的也可以），点「导入并保存」。识别的键有 `BASE_QUERY_URL`、`APP_DATASOURCE_ID`、`APP_SCHEMA`、`APP_UUID`、`APP_LEVEL`、`BUSINESS_DATASOURCE_NAME`、`HTTP_TIMEOUT`、`HTTP_VERIFY_SSL`、`APP_NAME`。`PORT`、`WORKERS`、`RELOAD`、`CORS_ORIGINS`、`DEBUG` 是 FastAPI 自己的配置，会被忽略。键名里 OCR 把下划线识别成空格（如 `APP SCHEMA`）也能识别。
2. 也可以在「连接配置」里逐项修改。基座查询地址默认是 beta 基座 `https://netcareclaw-beta.icta138.huawei.com/digital-human/api/dh/query`，换基座只改这里的域名。
3. 点「测试连接」，依次检查：数据源列表、业务库 `SELECT 1`、业务库表数、应用库 `SELECT 1`。每一步都会显示耗时、错误信息和基座原始返回。测试用的是页面上当前的配置，没保存也能测。

配置存放在当前租户的 `sys_kv_store`（`digital-human/config`），代码里不内置任何连接信息。身份头 `x-app-id` / `x-app-level` 随每个请求发送。

## 基座接口（`backend/models/digital-human/base-client.js`）

| 用途 | 请求 |
| --- | --- |
| 业务库查询（只读） | `POST {base}/query` `{datasourceName, sql, limit}` |
| 应用 schema 查询 | `POST {base}/query` `{datasourceId, schema, sql, limit}` |
| 应用 schema 写入 | `POST {base}/execute` `{datasourceId, schema, sql}` |
| 数据源列表 | `GET {base}/query/datasources` |

`{base}` 是 `BASE_QUERY_URL` 去掉末尾 `/query` 后的地址。约束如下：

- 单页最多 1000 行：SQL 没写顶层 `LIMIT` 时，自动追加 `LIMIT/OFFSET` 分页取齐，总行数上限按配置（默认 50000）。需要完整结果时请带 `ORDER BY`。
- 查询只允许单条 `SELECT / WITH / SHOW / DESC / EXPLAIN`。应用库写入只允许单条 `INSERT / UPDATE / DELETE`，`UPDATE / DELETE` 必须带 `WHERE`。DDL 一律拒绝，建表改表交 DBA。
- 不走系统代理。默认不校验基座的自签证书（`HTTP_VERIFY_SSL=false`）。
- 基座返回结构未固定，兼容 `{code,message,data}`、`data.rows/records/list`、`columns + 二维数组` 等形态。解析失败时会带上原始返回，便于排查。

## NetCare 数据探查（`/netcare-explorer`）

导航「系统治理」分类，仅管理员可见。

- **表目录**：每次从基座 `information_schema` 实时读取，新增的表会自动出现，标为「新增表」，按表名规则推断粒度和类别。在此基础上叠加两层语义：
  - 全表盘点 §7/§7.1 的 441 张表种子（`netcare-table-seed.json`）：类别、粒度、项目模块、同事中文备注。已核实标错的表用核实后的名字，原标注保留。
  - 管理员标注（tools.db `dh_table_notes`）：中文名、模块、口径说明、时间/地区部/代表处字段、已核对、隐藏。
- 种子里有、库里没有的表标为「库中已不存在」。基座不可达时退回种子清单并提示离线。
- **单表**：概览与标注、字段画像（时间/区域字段识别、取值形态、`SNULL` 等占位值、毫秒时间戳）、样例数据、结构化查询（字段按真实表结构校验）、SQL 控制台。业务库只读；应用库可执行写入，执行前会二次确认。
- 统计卡片和筛选可以直接定位空表、新增表、无中文名、未核对、标注存疑的表。

## Dragon Claw：`@netcare-data`

管理员在首页普通对话里输入 `@netcare-data`，模型可用 4 个只读工具：`netcare_tables`（找表）、`netcare_describe`（字段与样例）、`netcare_query`（结构化查询与聚合）、`netcare_sql`（只读 SQL）。应用库写入不开放给模型。口径提示写在 `backend/agent-skills/netcare-data/SKILL.md`：分区族不要重复计数、日期格式不统一、要排除占位值、区域编码要关联公共表。

## API（`/api/digital-human`，整体 `requireAdmin`）

`GET/PUT /config`、`POST /config/parse`、`POST /config/import`、`POST /test`、`GET /tables?scope=business|app[&refresh=1]`、`GET /tables/:name`、`PUT /tables/:name/notes`、`POST /tables/:name/count`、`POST /query`、`POST /sql`、`POST /execute`（仅应用库）。

## 验证

- `node --test tests/digital-human.test.js`：用本地假基座覆盖 `.env` 导入、请求体与身份头、1000 行分页、SQL 守卫、写入、连通性测试、表目录合并（实时 + 种子 + 标注 + 离线回退）、字段画像、结构化查询，以及 `@netcare-data` 工具循环。
- 真实基座只能在内网验证：打包新版桌面程序后，按「配置」一节导入并测试连接，再打开 `/netcare-explorer` 核对表清单和样例。

## 后续

基座在内网实测、核心表口径核对之后：AI 月报数据集（`ai-report-datasets.js` 的 connectors）加 netcare 数据源；看板和自定义工具通过 `/api/digital-human/query` 取数，届时按需开放给普通用户只读访问；月底把查询结果定时快照到 report.db，保证历史月报可以复现。
