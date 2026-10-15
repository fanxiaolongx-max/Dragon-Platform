---
name: 项目导览
name_en: Project map
description: 梳理入口、模块、数据流和启动方式
description_en: Map entry points, modules, data flow and setup
workspace: true
order: 1
---

# 项目导览 / Project map

目标：用实际源码帮助用户快速理解项目，不修改文件。

1. 从顶层目录、README、依赖清单和项目工作指南开始；不要递归读取所有文件。
2. 沿用户关注的功能追踪页面/入口 → API → service/repository → 存储。先搜索，再按相关行读取；大文件按页续读。
3. 区分源文件、运行数据、第三方依赖和构建产物。用源码确认文档中的启动方式，不运行安装、构建或迁移来“了解项目”。
4. 给出简短项目地图、关键路径、主要数据流、启动/测试方式及仍未确认的地方。引用实际文件路径和可获得的行号；不要把推测写成事实。

For an English request, deliver the same source-grounded project map in English.
