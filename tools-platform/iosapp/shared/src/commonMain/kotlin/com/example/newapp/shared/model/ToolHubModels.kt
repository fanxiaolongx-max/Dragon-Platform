package com.example.newapp.shared.model

import kotlinx.serialization.Serializable

@Serializable
data class CustomToolDto(
    val slug: String = "",
    val href: String? = null,
    val name: String = "",
    val nameEn: String? = null,
    val description: String? = null,
    val descriptionEn: String? = null,
    val icon: String? = null,
    val builtIn: Boolean = false,
    val updatedAt: String? = null,
    val hostedApp: Boolean = false
)

@Serializable
data class HomeCapabilitiesResponse(
    val canManageSettings: Boolean = false,
    val canManageUsers: Boolean = false,
    val isSuper: Boolean = false,
    val mediaEnabled: Boolean = false
)

enum class ToolCategory {
    NATIVE,
    DATA,
    ANALYTICS,
    WORKFLOW,
    CUSTOM
}

data class PlatformTool(
    val id: String,
    val routePath: String,
    val titleZh: String,
    val titleEn: String,
    val descZh: String,
    val descEn: String,
    val iconKey: String,
    val category: ToolCategory,
    val isNative: Boolean = false,
    val updatedAt: String? = null
) {
    fun localizedTitle(language: String): String =
        if (language == "en") titleEn.ifBlank { titleZh } else titleZh.ifBlank { titleEn }

    fun localizedDesc(language: String): String =
        if (language == "en") descEn.ifBlank { descZh } else descZh.ifBlank { descEn }
}

/**
 * Built-in catalog matching tools-platform/frontend/index.html v2 tool cards
 * plus the native KPI/SLA Monitor module and merged dynamic /api/custom-tools items.
 */
object ToolCatalogMerger {

    val nativeTools: List<PlatformTool> = listOf(
        PlatformTool(
            id = "kpi-monitor",
            routePath = "native://kpi-monitor",
            titleZh = "KPI 与 SLA 指标监控",
            titleEn = "KPI & SLA Monitor",
            descZh = "月度总分、异常指标、临期工单告警、30 天趋势分析与全局搜索",
            descEn = "Monthly scores, failing metrics, expiring tickets, 30-day trends & search",
            iconKey = "kpi",
            category = ToolCategory.NATIVE,
            isNative = true
        )
    )

    val builtInWebTools: List<PlatformTool> = listOf(
        PlatformTool("uivf12", "/uivf12", "数据抓取", "Data Fetcher", "自动化 F12 数据采集与巡检", "Automated F12 telemetry & data fetch", "fetch", ToolCategory.DATA),
        PlatformTool("sla", "/sla", "数据导入", "Data Import", "导入并标准化 SLA / 工单明细表", "Import and normalize SLA ticket workbooks", "import", ToolCategory.DATA),
        PlatformTool("report", "/report", "报表看板", "Report Dashboard", "多维统计、导出与日常汇报视图", "Multi-dimensional KPI & operational reports", "report", ToolCategory.ANALYTICS),
        PlatformTool("expedite", "/expedite", "一键催办", "Quick Expedite", "筛选超时临期工单并生成催办通知", "Track overdue tickets and dispatch nudges", "expedite", ToolCategory.WORKFLOW),
        PlatformTool("monthly", "/monthly", "月报页面", "Monthly Report", "月度汇总、目标达成率与总结归档", "Monthly target achievement and rollups", "monthly", ToolCategory.ANALYTICS),
        PlatformTool("duty-roster", "/duty-roster", "夜间运维值班表", "Night Duty Roster", "查看和编排夜间运维排班表", "View and coordinate night-shift rosters", "duty", ToolCategory.WORKFLOW),
        PlatformTool("bigscreen", "/bigscreen", "大屏看板", "Big Screen Wall", "实时运维大屏与核心健康度投影", "Live NOC status & health board", "bigscreen", ToolCategory.ANALYTICS),
        PlatformTool("topic-analysis", "/topic-analysis", "专题分析", "Topic Analysis", "重点故障与异常专题深度复盘", "Deep-dive operational incident analysis", "topic", ToolCategory.ANALYTICS),
        PlatformTool("frt", "/frt", "FRT KPI核算", "FRT KPI Audit", "首次响应时长核算与明细校验", "First response time KPI calculation & audit", "frt", ToolCategory.ANALYTICS),
        PlatformTool("requirements", "/requirements", "需求管理", "Requirements", "跟进研发与业务需求排期状态", "Track feature requests and delivery status", "requirements", ToolCategory.WORKFLOW),
        PlatformTool("praudit", "/praudit", "PR稽查", "PR Audit", "问题单与变更合规性稽查核验", "Problem record and compliance inspection", "praudit", ToolCategory.WORKFLOW)
    )

    fun merge(remoteTools: List<CustomToolDto>): List<PlatformTool> {
        val byRoute = linkedMapOf<String, PlatformTool>()
        for (tool in nativeTools) {
            byRoute[tool.routePath] = tool
        }
        val builtInByPath = builtInWebTools.associateBy { normalizeRoute(it.routePath) }
        for (tool in builtInWebTools) {
            byRoute[normalizeRoute(tool.routePath)] = tool
        }
        for (dto in remoteTools) {
            val route = normalizeRoute(dto.href ?: "/${dto.slug}")
            if (route == "/" || route.isBlank()) continue
            val existing = byRoute[route] ?: builtInByPath[route]
            if (existing != null) {
                byRoute[route] = existing.copy(
                    titleZh = dto.name.ifBlank { existing.titleZh },
                    titleEn = dto.nameEn?.ifBlank { existing.titleEn } ?: existing.titleEn,
                    descZh = dto.description?.ifBlank { existing.descZh } ?: existing.descZh,
                    descEn = dto.descriptionEn?.ifBlank { existing.descEn } ?: existing.descEn,
                    updatedAt = dto.updatedAt ?: existing.updatedAt
                )
            } else {
                byRoute[route] = PlatformTool(
                    id = dto.slug.ifBlank { route.trimStart('/') },
                    routePath = route,
                    titleZh = dto.name.ifBlank { dto.slug },
                    titleEn = dto.nameEn?.ifBlank { dto.name } ?: dto.name.ifBlank { dto.slug },
                    descZh = dto.description.orEmpty().ifBlank { "平台扩展工具" },
                    descEn = dto.descriptionEn.orEmpty().ifBlank { dto.description ?: "Platform custom tool" },
                    iconKey = dto.icon?.ifBlank { "custom" } ?: "custom",
                    category = ToolCategory.CUSTOM,
                    isNative = false,
                    updatedAt = dto.updatedAt
                )
            }
        }
        return byRoute.values.toList()
    }

    private fun normalizeRoute(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""
        return if (trimmed.startsWith("/") || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("native://")) {
            trimmed
        } else {
            "/$trimmed"
        }
    }
}
