package com.example.newapp.shared.model

import kotlinx.serialization.Serializable

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
