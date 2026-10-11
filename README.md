# Tools Platform

**从数据采集、指标分析，到月报交付与日常协作的本地 / 内网工具中台。**

[下载安装](https://github.com/fanxiaolongx-max/privacy-policy/releases) · [完整使用指南](tools-platform/README.md) · [通用月报编辑器](tools-platform/docs/monthly-designer.md) · [快速启动](#快速启动)

![Tools Platform：采集与导入、规则与分析、展示与交付](tools-platform/docs/images/readme/platform-overview.svg)

## 界面预览

### 通用月报编辑器

左侧找数据，中间编辑月报，右侧配置组件。支持数据透视、图表、指标引用、跨月模板复用与多格式导出。

![通用月报编辑器：资料库、月报画布与组件配置](tools-platform/docs/images/readme/monthly-editor.png)

*真实编辑器界面，使用虚构的团队与演示数据；具体功能见[月报编辑器指南](tools-platform/docs/monthly-designer.md)。*

### 首次启动快速上手

按需导入默认脚本与指标规则，再根据业务调整。

<img src="tools-platform/docs/images/first-run-quick-start.png" alt="首次启动：选择导入默认脚本库与指标规则" width="730">

[查看默认快速上手包与导入说明 →](tools-platform/README.md#默认快速上手包)

## 能做什么

| 工作场景 | 主要能力 | 阅读入口 |
| --- | --- | --- |
| 数据采集与导入 | UI.Vision / F12 脚本库、网站适配、Excel / CSV 导入、自动导入 | [采集](tools-platform/README.md#21-自动化数据抓取与-uivf12-ai-网站适配器) · [指标规则](tools-platform/README.md#22-sla-数据合控与指标规则引擎) |
| 月报与看板 | 通用月报、数据透视、图表、动态指标、模板复用、运营大屏 | [月报编辑器](tools-platform/docs/monthly-designer.md) · [报表能力](tools-platform/README.md#23-报表看板月报工作区与运营大屏) |
| 交付与跟进 | PDF / HTML / Excel / 图片 / MSG 导出、一键催办、名称映射 | [催办与导出](tools-platform/README.md#24-一键精准催办与导出) |
| 专项治理与协作 | 会议考勤、花名册、专题分析、部门奖惩、正向激励、PR / FRT、需求与问卷 | [专项工具链](tools-platform/README.md#26-专项治理工具链) |
| 业务核验与学习 | 采购订单核验、供应商报价比对、考题金库、阿拉伯语互动学习 | [专项工具链](tools-platform/README.md#26-专项治理工具链) · [题库助手](tools-platform/docs/f12-exam-ai.md) |
| 内容制作 | 胶片设计、PPT 素材库、光影大厅与多媒体工具 | [胶片与素材](tools-platform/README.md#25-胶片设计与-ppt-素材库) · [多媒体](tools-platform/README.md#210-光影大厅-tools-cinema-与多媒体生态) |
| AI 与桌面伴侣 | Dragon Claw 智能体、知识检索、历史会话、2D / 3D 图谱、桌面宠物与客服 | [智能体](tools-platform/README.md#29-dragon-claw-智能体与-2d3d-双视图知识图谱) · [桌面宠物](tools-platform/README.md#211-桌面宠物伴侣-哈基米-hajimi-companion-与智能客服) |
| 工具扩展 | 自定义 HTML 工具、内置工具、工具市场与离线导出 | [工具市场](tools-platform/README.md#28-自定义工具与多源工具市场生态) |
| 平台管理 | 多租户隔离、授权、备份恢复、日志、服务监控与数据迁移 | [存储](tools-platform/README.md#4-数据存储启动自愈与迁移治理) · [备份](tools-platform/README.md#5-备份恢复与远端主站同步) |

## 选择使用方式

| 方式 | 适合场景 | 获取与说明 |
| --- | --- | --- |
| 浏览器 / 内网部署 | 团队共享数据与工具，通过浏览器访问 | [快速启动](#快速启动) · [部署指南](tools-platform/README.md#12-多系统部署windows-客户端与新手配置指引) |
| Windows 客户端 | 本机运行；安装版或免安装绿色版 | [下载发行版](https://github.com/fanxiaolongx-max/privacy-policy/releases) · [客户端说明](tools-platform/README.md#123-桌面客户端指引-windows-安装版绿色版-vs-macos-签名公证版) |
| macOS 客户端 | 本机运行；DMG / ZIP，arm64 / x64 构建 | [下载发行版](https://github.com/fanxiaolongx-max/privacy-policy/releases) · [构建与验收](tools-platform/docs/macos-desktop-release.md) |
| iOS / KMP 工程 | 移动端开发与外部指标接入 | [移动端工程](tools-platform/iosapp/) · [接口说明](tools-platform/iosapp/external-metrics-api.md) |

## 快速启动

在仓库根目录执行：

```bash
cd tools-platform/backend
npm install
npm run doctor
npm start
```

打开 **http://localhost:3030**。运行环境、登录初始化、PM2 与桌面打包步骤见[完整部署指南](tools-platform/README.md#12-多系统部署windows-客户端与新手配置指引)。

## 技术与数据

| 层级 | 实现 |
| --- | --- |
| 后端 | Node.js + Express |
| 前端 | 原生 HTML / CSS / JavaScript 多页面，无前端打包步骤 |
| 数据存储 | SQLite，业务数据库按租户隔离 |
| 桌面端 | Electron，Windows / macOS |
| 移动端工程 | Kotlin Multiplatform / iOS |

源码、运行数据、备份和客户端持久化目录的详细说明见[目录结构](tools-platform/README.md#10-目录结构详解)与[客户端文件目录](tools-platform/README.md#124-桌面客户端本地生成文件与目录全景字典-windows-vs-macos)。

## 文档导航

| 想了解什么 | 文档 |
| --- | --- |
| 全部功能、数据流、架构与部署 | [工程 README](tools-platform/README.md) |
| 月报编辑、数据来源、模板与导出 | [通用月报编辑器指南](tools-platform/docs/monthly-designer.md) |
| 页面地址与 API 路由 | [页面入口](tools-platform/README.md#7-常用页面入口清单) · [API 全景](tools-platform/README.md#8-主要-api-路由全景表) |
| 外部系统接入指标 | [外部指标 API](tools-platform/docs/external-metrics-api.md) |
| macOS 构建、签名与验收 | [macOS 发布文档](tools-platform/docs/macos-desktop-release.md) |
| 题库与口语学习 | [题库助手](tools-platform/docs/f12-exam-ai.md) · [埃及口语课堂](tools-platform/docs/egyptian-classroom.md) |
| 中英双语功能介绍 | [能力概览](tools-platform/docs/tools-platform-feature-overview-bilingual.html) |
| 开发约定 | [项目 AGENTS.md](tools-platform/AGENTS.md) |

首页用于快速了解项目；功能细节与运维资料统一保留在工程文档中。
