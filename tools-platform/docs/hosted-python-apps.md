# 托管 Python Web 应用

首页「导入 HTML / ZIP / SKILL」除了网页工具和技能包，还能导入 Python Web 应用包（FastAPI、Starlette、Flask、Django 等）。平台为每个应用创建独立虚拟环境、安装依赖、在本机启动服务，并在工具菜单生成入口。用户登录平台后从入口打开，无需单独部署。

应用包格式参照需求「api文档1」（AiOps-Report 写报告服务设计文档）：按该文档开发的应用，通常不改代码即可托管。

## 应用包结构

```
my_app/                     # ZIP 里可以有一层顶级目录
├── requirements.txt        # 必需；必须包含 uvicorn
├── app/main.py             # 入口之一：def create_app() / app = FastAPI() / app = Flask(__name__)
├── run.py                  # 可选；平台不执行，只用来推断入口（uvicorn.run("app.main:create_app", factory=True)）
├── MyApp.version           # 可选；文件名作为应用名，内容作为版本号
├── platform-app.json       # 可选；显式声明入口等配置
├── db/init.sqlite.sql      # 可选；应用库初始化脚本（建表、种子数据）
├── wheels/                 # 可选；离线依赖（pip download -r requirements.txt -d wheels）
└── static/ ...
```

入口按以下顺序自动识别：`app/main.py`、`main.py`、`app.py`、`server.py`、`asgi.py`、`wsgi.py`、`run.py`。文件中的 `def create_app()` 视为工厂函数；`xxx = FastAPI()`、`Starlette()`、`Quart()` 视为 ASGI 实例；`Flask()` 视为 WSGI 实例。识别不到时，在 `platform-app.json` 中声明：

```json
{ "entry": "app.main:create_app", "factory": true, "interface": "asgi", "healthPath": "/api/healthz", "name": "AiOps-Report", "version": "1.0.1" }
```

`healthPath` 是平台启动后轮询的健康检查路径（默认 `/`，返回 5xx 以外的状态即视为就绪）。限制：ZIP 不超过 35 MB，解压后不超过 300 MB、3000 个文件；不能包含符号链接、越界路径，也不能包含平台保留的 `_platform_host.py`。`logs/`、`venv/`、`__pycache__/` 等运行期目录不会导入。

## 运行方式

- **依赖安装**：包内带 `wheels/` 时使用 `pip --no-index --find-links wheels` 离线安装；否则在线安装，可在启动页「Python 环境设置」里配置内网 pip 镜像。
- **启动**：平台用 `uvicorn _platform_host:app --host 127.0.0.1 --port <随机端口>` 启动，不执行包里的 `run.py`。原因是原 `run.py` 可能监听 0.0.0.0，会把应用暴露到局域网。宿主模块按反向代理前缀设置 ASGI `root_path`（WSGI 为 `SCRIPT_NAME`），FastAPI 的 `/docs`、重定向和 `url_for` 都能正常工作。
- **访问地址**：`/apps/<应用标识>/~<访问令牌>/`。前端 API 路径请按 `location.pathname` 拼接（原文档开发红线第 13 条），不要写死 `/api/...` 这类绝对路径。
- **生命周期**：首次打开入口时安装并启动。崩溃后按 1、2、4…60 秒退避自动重启，10 分钟内崩溃 5 次则停止重启，等待管理员处理。平台重启后，自动恢复上次处于运行状态的应用；平台进程退出时，应用进程随之退出。
- **运维**：管理员打开应用后，右上角「运行中」胶囊菜单提供重启、运行日志、重新安装依赖、Python 环境设置和停止。
- **更新**：再次导入同名应用包（按 `platform-app.json` 的 name 或 `.version` 文件名匹配）时，会询问更新还是新建。更新会保留应用库、虚拟环境和访问配置；依赖清单变化时才重新安装。删除工具时一并停止应用，并删除应用目录及应用库。

## 环境变量

平台注入与数字人基座同名的变量，pydantic-settings 等配置会优先读取环境变量，覆盖包内 `.env`：

| 变量 | 值 |
| --- | --- |
| `PORT` / `HOST` | 分配的端口 / `127.0.0.1` |
| `RELOAD` / `WORKERS` / `DEBUG` | `false` / `1` / `false` |
| `BASE_QUERY_URL` | `http://127.0.0.1:<平台端口>/hosted-api/<数据令牌>/dh/query` |
| `APP_DATASOURCE_ID` / `APP_SCHEMA` / `APP_UUID` | `app` / 应用 UUID / 应用 UUID |
| `BUSINESS_DATASOURCE_NAME` | 已启用 NetCare 基座时为基座业务库组名，否则为 `platform:report.db` |
| `PLATFORM_APP_SECRET` | 校验平台用户头的密钥 |

子进程只继承运行所需的系统变量（Windows 的 SystemRoot、TEMP 等，或 POSIX 的 TMPDIR、LANG），不会拿到平台自身的密钥、令牌和数据目录。安装依赖时，额外传入系统代理变量。

## 数据接口

请求和响应形态与基座 REST 兼容：成功返回 `{ "code": 200, "success": true, "message": "success", "data": ... }`，失败时返回对应 HTTP 状态和 `{ "code", "success": false, "message" }`。

| 接口 | 用途 |
| --- | --- |
| `POST {base}/query` `{datasourceId:"app", schema, sql, limit}` | 查询应用库 |
| `POST {base}/query` `{datasourceName:"platform:report.db", sql, limit}` | 只读查询平台库 |
| `POST {base}/query` `{datasourceName:<基座业务库组名>, sql, limit}` | 只读查询 NetCare 业务库（经平台已配置的数字人基座转发） |
| `POST {base}/execute` `{datasourceId:"app", schema, sql}` | 写应用库：INSERT / UPDATE / DELETE / REPLACE / CREATE / ALTER / DROP；返回 `affectedRows`，插入时附带 `lastInsertId` |
| `GET {base}/query/datasources` | 可用数据源 |
| `GET {base}/query/find-table-datasource?table=` | 按表名反查数据源 |

`{base}` 是 `BASE_QUERY_URL` 去掉末尾的 `/query`。每次最多返回 1000 行，单次结果不超过 16 MB，单条语句执行超过 15 秒会被中止，每个应用每秒约 20 次请求。

- **应用库**：每个应用独立的 SQLite（约 1 GB 上限）。默认模式在首次启动时执行 `db/init.sqlite.sql`，内容变化后再执行；基座契约模式由管理员显式部署，运行期禁止 DDL，见下文。
- **平台库**：只读连接，只接受单条 SELECT / WITH 语句。执行前用 SQLite `EXPLAIN` 核对实际读取的表和列：账号、会话、租户、凭据、智能体内部状态等表（包括经视图、子查询间接读取），以及名称含 password、token、secret、api_key 等的列，一律拒绝。读取包含敏感列的表时请列出需要的列，不要用 `*`。聊天记录库不开放。
- **NetCare 业务库**：沿用平台数字人基座的只读校验，只能执行查询语句。

## 基座数据库契约（AiOps-Report）

应用包的 `platform-app.json` 可声明 `"databaseContract": "digital-human"`。未声明的旧应用保留原模式；AiOps-Report 1.4.3 的平台导入包启用此契约，需先更新平台代码再导入。宿主注入 `PLATFORM_APP_DATABASE_CONTRACT`，新版 AiOps 拒绝在未启用契约的旧宿主上冒充基座模拟。

- 导入、更新、启动、重启和业务请求都不自动补表。管理员在右上角运维菜单选择「初始化应用表」或「升级应用表」，预览并确认 `db/init.sqlite.sql` / `db/upgrade.sqlite.sql`。脚本哈希变化后须重新确认；同一脚本重复部署会跳过。事务失败回滚，只作用于当前租户、当前应用数据库。部署 API 的预览和执行均要求管理员。
- 运行期 `/execute` 只允许单条 INSERT / UPDATE / DELETE，UPDATE / DELETE 必须有外层 WHERE。DDL、REPLACE、CTE 写入均拒绝；不返回 `lastInsertId`，应用按业务键反查。查询接口也拒绝隐藏在 WITH 中的写入。
- 应用表走 `datasourceId + schema`；业务表只读，走已配置 NetCare 基座的 `datasourceName`。严格模式不把未配置的 NetCare 自动替换为平台 `report.db`，也不开放 `platform:*` 作为替代数据源。身份与限流失败保留 HTTP 错误；业务 SQL 失败用非零 `code` 表达。
- 本次对齐数据库相关红线（需求 #142 第 1/2/3/6/7/8/9/12 条）。月报主页和页内开发者弹窗遵从用户后续产品要求。平台仍使用 SQLite 与单进程宿主，不代表复刻 MySQL 引擎、基座网关、身份注入或多进程行为；真实基座需另行验收。

基座侧由 DBA 在基座分配的应用 `APP_SCHEMA` 中执行 MySQL `db/init.sql` / `db/upgrade.sql`；不会通过业务 API 执行建表，也未引入未经证实的 init/update 导包钩子。AiOps 的 AIR 文档、格子、提示词复用 `t_report_template`、`t_report_block`、`t_report_config`，没有新增 AIR 请求表。

新增接口：`GET /api/hosted-apps/:slug/database-script?kind=init|upgrade` 预览；`POST` 同路径提交 `{kind,hash}` 执行。请使用管理员界面审阅脚本后操作。

## 安全边界

- **只有管理员能导入**：导入时会提示，平台将在本机运行包里的 Python 代码。进程级隔离不是操作系统沙箱：应用代码拥有运行平台的操作系统账号的文件和网络权限，请只导入来源可信的应用包。
- **入口鉴权**：应用只监听 `127.0.0.1`。用户必须登录平台，由启动页签发访问令牌（绑定租户、应用、用户，有效期 12 小时，HMAC 签名）。令牌无效或过期时返回 401；不带令牌访问时，跳转到工具入口。
- **请求过滤**：转发给应用的请求会去掉 Cookie、Authorization、Origin、Referer 和各类转发头，改为附带 `X-Platform-User`、`X-Platform-Role`、`X-Platform-Tenant`、`X-Platform-Timestamp`、`X-Platform-Signature`。签名为 `HMAC-SHA256(PLATFORM_APP_SECRET, user\nrole\ntenant\ntimestamp)`，应用可以据此识别平台用户。
- **响应过滤**：应用响应里的 Set-Cookie、Clear-Site-Data、HSTS、X-Frame-Options 等会被去掉，防止改写平台 Cookie 或清空平台数据。平台改设 `X-Frame-Options: SAMEORIGIN`，禁止外站嵌入；重定向地址会改写到应用前缀之下。
- **页面隔离**：所有应用响应都带 `Content-Security-Policy: sandbox ...`（不含 `allow-same-origin`），启动页的 iframe 也带同样的 sandbox 属性。应用页面因此是独立来源，读不到平台 Cookie，不能带登录态调用平台 API，也访问不了上层页面。
- **兼容层**：页面里的 `localStorage` 由平台注入的兼容脚本改为按「应用 + 用户」保存在服务端（上限 5 MB，多页面和多设备共享），`sessionStorage` 为内存实现，`document.cookie` 读写不报错但不生效。应用如需会话，请使用平台转发的用户头，不要依赖 Cookie。
- **数据接口**：只接受本机直连（带 Cloudflare 或其他转发头的请求返回 404），并且须持有注入给应用的数据令牌。应用只能访问自己的应用库；ATTACH、PRAGMA、load_extension、虚拟表等可能越界的语句一律拒绝。

## 环境要求

- 需要 Python 3.9 及以上。服务器版和桌面版都会自动检测（Windows 依次尝试 `py -3`、`python`；macOS/Linux 尝试 `python3`、`python`），也可以在启动页「Python 环境设置」里指定路径。检测不到时仍可导入，配置好后再重新安装依赖。
- 设置保存在数据目录的 `hosted-apps-settings.json`，作用于本机所有租户。应用目录为 `<数据目录>/hosted-apps/<应用标识>/`，其中 `app/` 是代码，`venv/` 是虚拟环境，`data/app.db` 是应用库，`logs/runtime.log` 是运行日志。

## 已知限制

- 自定义工具的下载按钮和工具备份只包含启动页，不包含应用代码和应用库。
- 应用对外网络访问不受限制。
- 不支持需要自定义启动命令的应用（Streamlit、Gradio 等），只托管 ASGI/WSGI 应用。

## 测试

- `tests/hosted-apps.test.js`：应用包识别、入口推断、访问令牌防篡改、重定向改写、平台库 EXPLAIN 访问核对、写语句越界拦截、子进程环境净化。
- 端到端验证（需要本机 Python 和离线 wheels，未纳入自动测试）：用 FastAPI 示例包跑通导入 → 离线安装 → 启动 → 代理访问 → 用户头签名 → Cookie 剥离 → 重定向改写 → 应用库读写与初始化脚本 → 平台库只读与敏感表/列拦截 → 隧道请求拒绝 → 更新保留数据 → 停止 → 删除，共 32 项；并在 Electron（Chromium）中确认应用页面为独立来源、无法调用平台 API，localStorage 刷新后保留。

## AiOps-Report 的 ADC 聊天兼容

平台代理识别包含 ADCChat v1.4 与 `aiBarFrame` 的 AiOps 页面，在响应中替换 ADC 浏览器客户端并适配入口判断和内嵌聊天地址；不改写应用包、运行目录或 Python 业务代码。当前适配已核对 AiOps-Report 1.2.5 的 `index.html` 和 `api_test.html`；其他版本如改变客户端或页面结构，需要重新核对。它提供这些页面所需的聊天能力，不是完整的 ADC 云服务。

- 首次提问自动建会话，后续提问携带最近 40 条历史。正文完整生成后显示，支持停止等待。
- 「原 ADC 聊天页」打开平台生成的聊天页：左侧历史，中间及右侧为对话，顶部可切换平台配置的模型或模型别名。选择只作用于此会话，不修改全局激活配置。
- 会话保存在当前租户 `tools.db` 的 `hosted_adc_sessions`，按用户和应用隔离；会话列表最多显示最近 100 个，每个会话最多保存最近 100 条消息。
- `GET /apps/:slug/~:token/__platform/adc/{models,sessions,sessions/:id}` 和 `POST .../{sessions,chat}` 沿用托管应用的签名访问令牌，普通登录用户可操作自己的会话。沙箱不获得平台登录态或模型密钥。问题和回复经过平台敏感内容过滤，模型供应商错误不会原样返回浏览器。
- 聊天模型可调用 `adc_sources`、`adc_schema`、`adc_query` 读取当前应用库及当前租户的业务数据源；`netcare` 别名跟随应用的业务库配置。只开放查询，保留账号、凭据和其他用户聊天记录的保护；不接入文件操作或数据库写入。“能看到哪些表”由服务端直接读取真实目录，不依赖模型是否主动调用工具；普通数据问题支持原生工具调用，并在模型未调用时使用受相同 SQL 守卫保护的 JSON 查询计划兼容路径。查询失败时显示安全的实际错误，不把所有问题归为模型不支持。涉及数据库的问题未取得查询结果时，不输出未经核实的表名或统计。回答附实际查询依据，结果最多 200 行，超过时明确标记；统计应使用 SQL 聚合。应用升级改变页面结构后，可能需要更新兼容适配。

验证：`node --test tests/hosted-adc.test.js tests/hosted-apps.test.js`；真实页面浏览器验证使用临时数据目录与模拟模型响应，不调用收费模型。
