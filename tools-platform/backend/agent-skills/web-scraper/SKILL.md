---
name: 隐身爬虫与网页提取
name_en: Web Scraper
description: 高性能隐身抓取网页、绕过防爬检测，并支持直接复用 Dragon 浏览器会话提取已登录系统的结构化数据
description_en: High-performance stealth scraping, anti-bot bypass, and live Dragon browser session extraction
workspace: false
tools: browser
order: 14
icon: 🕷️
---

# 隐身爬虫与网页提取 / Web Scraper

目标：为 Dragon Claw 智能体提供高效、低消耗、抗反爬的网页数据抓取与精准提取。

## 核心工具：`browser_scrape`

`browser_scrape` 采用两级智能驱动：
1. **轻量隐身引擎（Scrapling 驱动）**：抓取公开网页时，在底层模拟真实浏览器 TLS/JA3/HTTP2 指纹，0.5 秒极速返回，穿透 Cloudflare 等防爬屏障，不弹窗、不占浏览器资源。
2. **复用 Dragon 浏览器会话（当前标签页）**：提取需要登录、内网 SSO 或复杂鉴权的站点时，直接复用用户在 Dragon 浏览器中已打开的页面 DOM，**完全保留 Cookie 与登录态**，免去模拟登录和人机滑块风险。

---

## 工作流与决策路径

```
           用户请求抓取网页
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
  【公开/免登录网址】     【需登录/企业内部/复杂SPA】
      │                     │
使用 browser_scrape      引导在 Dragon 浏览器打开
(传入 url + css/xpath)  或调用 browser_navigate
      │                     │
极速隐身抓取 (0.5s)       调用 browser_scrape
返回结构化数据            (fromCurrentTab: true)
                        复用当前会话 DOM 提取
```

### 1. 抓取外部公开网页
* **方式**：直接调用 `browser_scrape` 并传入 `url`。
* **参数推荐**：
  * `css`：指定选择器精准提取（例如 `h1, h2, .content`、`table`、`li.item`）。
  * `xpath`：需要根据文本或复杂层级匹配时使用。
  * `mode`：默认 `markdown`，自动转换为表格和清晰文本。
* **特点**：静默高速执行，不占用图形界面，自动清洗 HTML。

### 2. 抓取需登录的系统 / 内部站点
* **适用场景**：华为 NetCare、WeLink、后台管理系统、带 SSO 或严格账号风控的页面。
* **方式**：
  1. 如果用户已在桌面端 Dragon 浏览器中打开了该页面，直接调用：
     ```json
     { "fromCurrentTab": true, "css": "table.data-table, .user-card" }
     ```
  2. 若尚未打开，先用 `browser_navigate` 导航到目标地址，待页面渲染完成后再调用 `browser_scrape`。
* **优势**：直接复用已有 Cookie、LocalStorage 和视网膜渲染环境，数据提取精准且零风控风险。

---

## 提取数据建议

* **表格数据**：`browser_scrape` 内置表格识别与转 Markdown 功能，能直接将 `<table>` 转换为 Markdown 表格，便于后续核对或生成报表。
* **数据核对**：抓取完成后，向用户汇报抓取来源（Scrapling 快速隐身抓取 或 Dragon 浏览器复用提取）、匹配数量和前若干条样本，确保数据完整性。
