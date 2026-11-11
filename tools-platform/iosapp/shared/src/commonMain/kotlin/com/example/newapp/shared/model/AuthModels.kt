package com.example.newapp.shared.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

@Serializable
data class LoginRequest(
    val username: String,
    val password: String
)

@Serializable
data class LoginResponse(
    val success: Boolean = false,
    val token: String? = null,
    val role: String? = null,
    val username: String? = null,
    val tenantId: String? = null,
    val isSuper: Boolean? = null,
    val message: String? = null,
    val error: String? = null,
    val retry_after_seconds: Int? = null
)

@Serializable
data class UserProfile(
    val username: String = "",
    val role: String = "user",
    val tenantId: String? = null,
    val homeTenantId: String? = null,
    val isSuper: Boolean = false
)

@Serializable
data class AppVersionResponse(
    val name: String = "Dragon Claw",
    val version: String = ""
)

@Serializable
data class PlatformIdentity(
    val platformName: String = "Dragon Claw",
    val platformNameZh: String = "Dragon Claw",
    val platformNameEn: String = "Dragon Claw",
    val platformSubtitle: String = "埃及 CS 工具与知识中心",
    val platformSubtitleEn: String = "Egypt CS Tools & Knowledge Center",
    val platformSlogan: String = "“认真做好每一个工具，让日常工作更省心。”",
    val platformSloganEn: String = "“Build every tool with care. Make everyday work easier.”",
    val mediaEnabled: Boolean = false
) {
    fun localizedName(language: String): String =
        if (language == "en") platformNameEn.ifBlank { platformName } else platformNameZh.ifBlank { platformName }

    fun localizedSubtitle(language: String): String =
        if (language == "en") platformSubtitleEn else platformSubtitle

    fun localizedSlogan(language: String): String =
        if (language == "en") platformSloganEn else platformSlogan
}

@Serializable
data class AlertCenterSummary(
    val total: Int = 0,
    val unread: Int = 0,
    val critical: Int = 0,
    val warnOrAbove: Int = 0
)

@Serializable
data class AlertCenterEvent(
    val id: String = "",
    val event_type: String = "system",
    val severity: String = "info",
    val status: String = "unread",
    val title: String = "",
    val message: String = "",
    val actor: String = "",
    val source: String = "",
    val object_type: String = "",
    val object_id: String = "",
    val detail: JsonObject? = null,
    val ai_summary: String = "",
    val ai_status: String = "",
    val created_at: String = ""
) {
    val isUnread: Boolean get() = status == "unread"

    fun detailEntries(): List<String> = detail?.entries?.take(4)?.map { (k, v) ->
        val clean = if (v is JsonPrimitive && v.isString) v.content else v.toString()
        "$k: $clean"
    } ?: emptyList()

    fun severityLabel(language: String): String = when (severity.lowercase()) {
        "critical", "error" -> if (language == "en") "Critical" else "严重"
        "warn", "warning" -> if (language == "en") "Warning" else "预警"
        else -> if (language == "en") "Info" else "提示"
    }

    fun typeLabel(language: String): String = when (event_type.lowercase()) {
        "config" -> if (language == "en") "Config" else "配置"
        "security" -> if (language == "en") "Security" else "安全"
        "user_action" -> if (language == "en") "Action" else "操作"
        else -> if (language == "en") "System" else "系统"
    }
}

@Serializable
data class AlertCenterEventsResponse(
    val events: List<AlertCenterEvent> = emptyList()
)

@Serializable
data class AlertCenterMarkReadRequest(
    val ids: List<String> = emptyList()
)

@Serializable
data class AlertCenterMutationResponse(
    val changed: Int = 0
)
