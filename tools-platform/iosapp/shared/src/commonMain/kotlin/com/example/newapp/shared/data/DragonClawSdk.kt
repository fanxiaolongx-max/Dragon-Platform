package com.example.newapp.shared.data

import com.example.newapp.shared.SettingsManager
import com.example.newapp.shared.currentEpochMillis
import com.example.newapp.shared.model.*
import com.example.newapp.shared.network.DragonClawApiClient
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.SessionGrouping
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Cancellation token returned to Swift / Android callers for async operations and SSE/NDJSON streams. */
class TaskHandle(private val job: Job) {
    fun cancel() {
        job.cancel()
    }
}

/**
 * Shared KMP SDK exposed to both iOS (SwiftUI via callback + TaskHandle bridges)
 * and Android (Jetpack Compose via suspend methods or callback bridges).
 */
class DragonClawSdk(
    val settings: SettingsManager = SettingsManager(),
    val api: DragonClawApiClient = DragonClawApiClient(settings)
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // --- Persisted Settings ---

    fun getBaseUrl(): String = DragonClawHelpers.normalizeBaseUrl(settings.getString(KEY_BASE_URL, DEFAULT_BASE_URL))

    fun saveBaseUrl(url: String) {
        settings.saveString(KEY_BASE_URL, DragonClawHelpers.normalizeBaseUrl(url))
    }

    fun getLanguage(): String = settings.getString(KEY_LANGUAGE, "zh").let { if (it == "en") "en" else "zh" }

    fun saveLanguage(language: String) {
        settings.saveString(KEY_LANGUAGE, if (language == "en") "en" else "zh")
    }

    fun getThemeMode(): String = settings.getString(KEY_THEME, "light").let { if (it == "dark") "dark" else "light" }

    fun saveThemeMode(mode: String) {
        settings.saveString(KEY_THEME, if (mode == "dark") "dark" else "light")
    }

    fun getRememberMe(): Boolean = settings.getBoolean(KEY_REMEMBER_ME, true)

    fun saveRememberMe(remember: Boolean) {
        settings.saveBoolean(KEY_REMEMBER_ME, remember)
        if (!remember) {
            settings.removeKey(KEY_SAVED_PASSWORD)
            settings.saveBoolean(KEY_AUTO_LOGIN, false)
        }
    }

    fun getAutoLogin(): Boolean = settings.getBoolean(KEY_AUTO_LOGIN, false)

    fun saveAutoLogin(autoLogin: Boolean) {
        settings.saveBoolean(KEY_AUTO_LOGIN, autoLogin)
    }

    fun getSavedUsername(): String = settings.getString(KEY_USERNAME, "")

    fun getSavedPassword(): String = settings.getString(KEY_SAVED_PASSWORD, "")

    fun getSavedToken(): String = settings.getString(KEY_TOKEN, "")

    fun getSavedRole(): String = settings.getString(KEY_ROLE, "user")

    fun getSelectedModelId(): String = settings.getString(KEY_SELECTED_MODEL, "")

    fun saveSelectedModelId(modelId: String) {
        settings.saveString(KEY_SELECTED_MODEL, modelId.trim())
    }

    fun saveSessionAuth(
        token: String,
        username: String,
        password: String?,
        role: String,
        rememberMe: Boolean,
        autoLogin: Boolean
    ) {
        val cleanToken = DragonClawHelpers.stripBearerPrefix(token)
        settings.saveBoolean(KEY_REMEMBER_ME, rememberMe)
        settings.saveBoolean(KEY_AUTO_LOGIN, autoLogin)
        settings.saveString(KEY_TOKEN, cleanToken)
        settings.saveString(KEY_USERNAME, username)
        settings.saveString(KEY_ROLE, role.ifBlank { "user" })
        if (rememberMe && password != null) {
            settings.saveString(KEY_SAVED_PASSWORD, password)
        } else {
            settings.removeKey(KEY_SAVED_PASSWORD)
        }
    }

    fun clearSessionAuth(keepUsername: Boolean = true) {
        settings.removeKey(KEY_TOKEN)
        settings.removeKey(KEY_ROLE)
        settings.saveBoolean(KEY_AUTO_LOGIN, false)
        if (!keepUsername) {
            settings.removeKey(KEY_USERNAME)
            settings.removeKey(KEY_SAVED_PASSWORD)
        }
    }

    fun getCurrentMonth(): Int = settings.getCurrentMonth()

    fun getAppVersion(): String = settings.getAppVersion()

    fun buildToolUrl(routePath: String): String {
        val clean = routePath.trim()
        if (clean.startsWith("http://") || clean.startsWith("https://")) return clean
        val path = if (clean.startsWith("/")) clean else "/$clean"
        return "${getBaseUrl()}$path"
    }

    fun groupSessionsByDate(sessions: List<AiSessionSummary>): List<SessionGroup> =
        SessionGrouping.groupSessions(sessions, currentEpochMillis())

    fun mapHistoryMessages(items: List<SessionMessageItem>): List<ChatMessage> =
        DragonClawHelpers.mapStoredMessages(items)

    fun appendFilesToPrompt(text: String, files: List<UploadedFileInfo>, language: String): String =
        DragonClawHelpers.appendUploadedFilesPrompt(text, files, language)

    fun mergeToolCatalog(remoteTools: List<CustomToolDto>): List<PlatformTool> =
        ToolCatalogMerger.merge(remoteTools)

    // --- Callback-based Async Bridges (iOS SwiftUI friendly + main-thread safe) ---

    private fun <T> runAsync(
        block: suspend () -> T,
        onSuccess: (T) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle {
        val job = scope.launch {
            try {
                val result = block()
                withContext(Dispatchers.Main) {
                    onSuccess(result)
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                val msg = t.message?.takeIf { it.isNotBlank() } ?: "Unknown error"
                withContext(Dispatchers.Main) {
                    onError(msg)
                }
            }
        }
        return TaskHandle(job)
    }

    fun login(
        username: String,
        password: String,
        onSuccess: (LoginResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.login(LoginRequest(username = username, password = password)) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun verifySession(
        token: String,
        onSuccess: (UserProfile) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getMe(token) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchPlatformIdentity(
        onSuccess: (PlatformIdentity) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getPlatformIdentity() },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchModels(
        token: String,
        onSuccess: (AiModelsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getModels(token) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchSuggestions(
        token: String,
        limit: Int = 8,
        onSuccess: (AiSuggestionsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSuggestions(token, limit) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun enhancePrompt(
        token: String,
        text: String,
        language: String,
        modelId: String? = null,
        onSuccess: (EnhancePromptResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.enhancePrompt(token, EnhancePromptRequest(text = text, uiLanguage = language, modelId = modelId)) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun uploadFiles(
        token: String,
        drafts: List<UploadAttachmentDraft>,
        onSuccess: (UploadFilesResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.uploadFiles(token, drafts) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchSessions(
        token: String,
        query: String = "",
        limit: Int = 40,
        onSuccess: (AiSessionsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSessions(token, query = query, limit = limit) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchSessionMessages(
        token: String,
        sessionId: String,
        limit: Int = 50,
        before: String? = null,
        onSuccess: (SessionMessagesResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSessionMessages(token, sessionId, limit = limit, before = before) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun deleteSession(
        token: String,
        sessionId: String,
        onSuccess: (DeleteSessionResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.deleteSession(token, sessionId) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun streamChat(
        token: String,
        messages: List<ChatHistoryMessageDto>,
        sessionId: String?,
        language: String,
        modelId: String?,
        onEvent: (ChatStreamEvent) -> Unit,
        onComplete: () -> Unit,
        onError: (String) -> Unit
    ): TaskHandle {
        val request = ChatStreamRequest(
            messages = messages.takeLast(12),
            context = "",
            pageTitle = if (language == "en") "Dragon Claw · Mobile" else "Dragon Claw · 移动端",
            pagePath = "/",
            uiLanguage = language,
            sessionId = sessionId?.takeIf { it.isNotBlank() },
            agent = "dragon-claw-home",
            stream = true,
            modelId = modelId?.takeIf { it.isNotBlank() }
        )
        val job = scope.launch {
            try {
                api.streamChat(token, request) { evt ->
                    withContext(Dispatchers.Main) {
                        onEvent(evt)
                    }
                }
                withContext(Dispatchers.Main) {
                    onComplete()
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                val msg = t.message?.takeIf { it.isNotBlank() } ?: "Stream interrupted"
                withContext(Dispatchers.Main) {
                    onError(msg)
                }
            }
        }
        return TaskHandle(job)
    }

    fun fetchToolCatalog(
        token: String,
        onSuccess: (List<PlatformTool>) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            val remote = runCatching { api.getCustomTools(token) }.getOrDefault(emptyList())
            ToolCatalogMerger.merge(remote)
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchAlertSummary(
        token: String,
        onSuccess: (AlertCenterSummary) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getAlertCenterSummary(token) },
        onSuccess = onSuccess,
        onError = onError
    )

    // --- Metrics Monitor Bridges ---

    fun fetchMetricsSummary(
        token: String,
        month: Int,
        includeOverall: Boolean = true,
        onSuccess: (SummaryResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSummary(token, month, includeOverall) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchSnapshots(
        token: String,
        month: Int,
        limit: Int = 20,
        onSuccess: (SnapshotsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSnapshots(token, month, limit) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchSnapshotDetail(
        token: String,
        snapshotId: String,
        month: Int,
        includeOverall: Boolean = true,
        onSuccess: (SnapshotDetailResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSnapshotDetail(token, snapshotId, month, includeOverall) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchMetrics(
        token: String,
        month: Int,
        category: String? = null,
        snapshotId: String? = null,
        includeOverall: Boolean = true,
        limit: Int = 2000,
        onSuccess: (MetricsListResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getMetrics(token, month, category, snapshotId, includeOverall, limit) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchFailingMetrics(
        token: String,
        month: Int,
        category: String? = null,
        snapshotId: String? = null,
        limit: Int = 2000,
        onSuccess: (MetricsListResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getFailingMetrics(token, month, category, snapshotId, limit) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchAlerts(
        token: String,
        month: Int,
        onSuccess: (AlertsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getAlerts(token, month) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchTrend(
        token: String,
        metricLabel: String,
        category: String,
        days: Int = 30,
        language: String = "zh",
        onSuccess: (TrendResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.getTrend(
                token = token,
                metricLabel = metricLabel,
                category = category,
                days = days,
                lang = if (language == "en") "en-US" else "zh-CN"
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

    // --- Voice Speech, Skills, Session Lifecycle, Schedules & Tool Nav Sync (P1) ---

    fun transcribeSpeech(
        token: String,
        audioBytes: ByteArray,
        fileName: String = "voice.m4a",
        mimeType: String = "audio/mp4",
        onSuccess: (SpeechRecognitionResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.transcribeSpeech(token, audioBytes, fileName, mimeType) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchSkills(
        token: String,
        onSuccess: (AgentSkillsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSkills(token) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun compactSession(
        token: String,
        sessionId: String,
        modelId: String? = null,
        onSuccess: (CompactSessionResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.compactSession(token, sessionId, modelId) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchArchivedSessions(
        token: String,
        query: String = "",
        limit: Int = 40,
        onSuccess: (AiSessionsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getArchivedSessions(token, query, limit) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun archiveSession(
        token: String,
        sessionId: String,
        onSuccess: (ArchiveSessionResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.archiveSession(token, sessionId) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun unarchiveSession(
        token: String,
        sessionId: String,
        onSuccess: (ArchiveSessionResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.unarchiveSession(token, sessionId) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun exportSessionJson(
        token: String,
        sessionId: String,
        onSuccess: (String) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.exportSessionRawJson(token, sessionId) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchSchedules(
        token: String,
        onSuccess: (SchedulesResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSchedules(token) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun createSchedule(
        token: String,
        text: String,
        sessionId: String = "",
        timezone: String = "",
        modelId: String? = null,
        onSuccess: (ScheduleMutationResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.createSchedule(
                token,
                CreateScheduleRequest(
                    text = text,
                    sessionId = sessionId,
                    timezone = timezone,
                    modelId = modelId
                )
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun deleteSchedule(
        token: String,
        scheduleId: String,
        onSuccess: (ScheduleMutationResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.deleteSchedule(token, scheduleId) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchFavoriteNav(
        token: String,
        onSuccess: (NavToolIdsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getFavoriteNav(token) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun saveFavoriteNav(
        token: String,
        ids: List<String>,
        onSuccess: (NavToolIdsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.saveFavoriteNav(token, ids) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchRecentNav(
        token: String,
        onSuccess: (NavToolIdsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getRecentNav(token) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun recordRecentNav(
        token: String,
        toolId: String,
        onSuccess: (NavToolIdsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.recordRecentNav(token, toolId) },
        onSuccess = onSuccess,
        onError = onError
    )

    companion object {
        private const val DEFAULT_BASE_URL = "https://cs.fanxiaolong.uk"
        private const val KEY_BASE_URL = "api_base_url"
        private const val KEY_LANGUAGE = "app_language"
        private const val KEY_THEME = "app_theme"
        private const val KEY_REMEMBER_ME = "remember_me"
        private const val KEY_AUTO_LOGIN = "auto_login"
        private const val KEY_USERNAME = "saved_username"
        private const val KEY_SAVED_PASSWORD = "saved_password"
        private const val KEY_TOKEN = "auth_token"
        private const val KEY_ROLE = "user_role"
        private const val KEY_SELECTED_MODEL = "selected_model_id"
    }
}
