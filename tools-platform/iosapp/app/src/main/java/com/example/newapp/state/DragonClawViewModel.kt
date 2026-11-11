package com.example.newapp.state

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.newapp.shared.SettingsManager
import com.example.newapp.shared.data.DragonClawSdk
import com.example.newapp.shared.data.TaskHandle
import com.example.newapp.shared.model.*
import com.example.newapp.shared.network.DragonClawApiClient
import com.example.newapp.ui.theme.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

enum class AppWorkMode {
    CHAT,
    TOOLS
}

sealed interface MetricsRoute {
    data object Dashboard : MetricsRoute
    data class SnapshotDetail(val snapshotId: String, val month: Int) : MetricsRoute
    data class MetricsList(
        val title: String,
        val filterType: String,
        val month: Int,
        val snapshotId: String?,
        val category: String?
    ) : MetricsRoute
    data class Alerts(val month: Int) : MetricsRoute
    data class Trend(val metricLabel: String, val category: String) : MetricsRoute
    data class Search(val month: Int) : MetricsRoute
}

class DragonClawViewModel : ViewModel() {
    private val settings = SettingsManager()
    val sdk = DragonClawSdk(settings = settings, api = DragonClawApiClient(settings))

    var baseUrl by mutableStateOf(sdk.getBaseUrl())
        private set
    var language by mutableStateOf(sdk.getLanguage())
        private set
    var themeMode by mutableStateOf(sdk.getThemeMode())
        private set
    var rememberMe by mutableStateOf(sdk.getRememberMe())
        private set
    var autoLogin by mutableStateOf(sdk.getAutoLogin())
        private set

    val isDark: Boolean get() = themeMode == "dark"

    var token by mutableStateOf("")
        private set
    var username by mutableStateOf(sdk.getSavedUsername())
        private set
    var role by mutableStateOf("user")
        private set
    var isAuthenticated by mutableStateOf(false)
        private set
    var isAuthenticating by mutableStateOf(false)
        private set
    var loginError by mutableStateOf<String?>(null)

    var identity by mutableStateOf(PlatformIdentity())
        private set
    val appVersion: String = sdk.getAppVersion()

    var workMode by mutableStateOf(AppWorkMode.CHAT)
    var alertUnreadCount by mutableIntStateOf(0)
        private set

    // Chat State
    var models by mutableStateOf<List<AiModelInfo>>(emptyList())
        private set
    var selectedModelId by mutableStateOf(sdk.getSelectedModelId())
        private set
    var suggestions by mutableStateOf<List<AiSuggestion>>(emptyList())
        private set
    var sessions by mutableStateOf<List<AiSessionSummary>>(emptyList())
        private set
    var sessionGroups by mutableStateOf<List<SessionGroup>>(emptyList())
        private set
    var sessionSearchQuery by mutableStateOf("")
    var currentSessionId by mutableStateOf<String?>(null)
        private set
    var messages by mutableStateOf<List<ChatMessage>>(emptyList())
        private set
    var composerText by mutableStateOf("")
    var isStreaming by mutableStateOf(false)
        private set
    var isEnhancingPrompt by mutableStateOf(false)
        private set
    var isUploadingFiles by mutableStateOf(false)
        private set
    var isLoadingSessionMessages by mutableStateOf(false)
        private set
    var pendingAttachments by mutableStateOf<List<UploadedFileInfo>>(emptyList())
        private set
    var chatErrorBanner by mutableStateOf<String?>(null)

    // Tool Hub & Metrics Navigation
    var tools by mutableStateOf(ToolCatalogMerger.merge(emptyList()))
        private set
    var toolSearchQuery by mutableStateOf("")
    var activeWebTool by mutableStateOf<PlatformTool?>(null)
    var showNativeMetrics by mutableStateOf(false)
    var metricsBackStack by mutableStateOf<List<MetricsRoute>>(listOf(MetricsRoute.Dashboard))

    // Metrics Cache
    var currentMonth by mutableIntStateOf(sdk.getCurrentMonth())
    val summaryByMonth = mutableStateMapOf<Int, SummaryResponse>()
    val snapshotsByMonth = mutableStateMapOf<Int, List<Snapshot>>()
    val metricsLoadingMonths = mutableStateMapOf<Int, Boolean>()
    val metricsErrorByMonth = mutableStateMapOf<Int, String?>()

    private var activeStreamHandle: TaskHandle? = null

    init {
        loadPlatformIdentity()
        restoreSessionIfPossible()
    }

    val activeModelDisplayName: String
        get() {
            if (selectedModelId.isNotBlank()) {
                models.firstOrNull { it.id == selectedModelId }?.let { return it.name }
            }
            return models.firstOrNull()?.name ?: tr(language, "默认模型", "Default")
        }

    val filteredTools: List<PlatformTool>
        get() {
            val q = toolSearchQuery.trim().lowercase()
            if (q.isEmpty()) return tools
            return tools.filter {
                it.titleZh.lowercase().contains(q) ||
                    it.titleEn.lowercase().contains(q) ||
                    it.descZh.lowercase().contains(q) ||
                    it.descEn.lowercase().contains(q) ||
                    it.routePath.lowercase().contains(q)
            }
        }

    fun toggleTheme() {
        themeMode = if (themeMode == "dark") "light" else "dark"
        sdk.saveThemeMode(themeMode)
    }

    fun toggleLanguage() {
        language = if (language == "zh") "en" else "zh"
        sdk.saveLanguage(language)
        sessionGroups = sdk.groupSessionsByDate(sessions)
    }

    fun updateServerBaseUrl(newUrl: String) {
        sdk.saveBaseUrl(newUrl)
        baseUrl = sdk.getBaseUrl()
        loadPlatformIdentity()
    }

    fun selectModel(modelId: String) {
        selectedModelId = modelId
        sdk.saveSelectedModelId(modelId)
    }

    fun loadPlatformIdentity() {
        viewModelScope.launch {
            runCatching { sdk.api.getPlatformIdentity() }
                .onSuccess { identity = it }
        }
    }

    private fun restoreSessionIfPossible() {
        val savedToken = sdk.getSavedToken()
        val savedUser = sdk.getSavedUsername()
        val savedPass = sdk.getSavedPassword()
        if (savedToken.isNotBlank() && autoLogin) {
            isAuthenticating = true
            viewModelScope.launch {
                runCatching { sdk.api.getMe(savedToken) }
                    .onSuccess { profile ->
                        token = savedToken
                        username = profile.username.ifBlank { savedUser }
                        role = profile.role
                        isAuthenticated = true
                        isAuthenticating = false
                        bootstrapWorkspace()
                    }
                    .onFailure {
                        isAuthenticating = false
                        if (savedUser.isNotBlank() && savedPass.isNotBlank()) {
                            performLogin(savedUser, savedPass, rememberMe, true)
                        }
                    }
            }
        }
    }

    fun performLogin(
        userInput: String,
        passwordInput: String,
        remember: Boolean,
        auto: Boolean
    ) {
        val cleanUser = userInput.trim()
        if (cleanUser.isEmpty() || passwordInput.isEmpty()) {
            loginError = tr(language, "请输入账号和密码", "Please enter username and password")
            return
        }
        isAuthenticating = true
        loginError = null
        viewModelScope.launch {
            runCatching { sdk.api.login(LoginRequest(cleanUser, passwordInput)) }
                .onSuccess { res ->
                    isAuthenticating = false
                    val newToken = res.token.orEmpty()
                    if (res.success && newToken.isNotBlank()) {
                        val finalUser = res.username ?: cleanUser
                        val finalRole = res.role ?: "user"
                        rememberMe = remember
                        autoLogin = auto
                        sdk.saveSessionAuth(
                            token = newToken,
                            username = finalUser,
                            password = passwordInput,
                            role = finalRole,
                            rememberMe = remember,
                            autoLogin = auto
                        )
                        token = sdk.getSavedToken()
                        username = finalUser
                        role = finalRole
                        isAuthenticated = true
                        bootstrapWorkspace()
                    } else {
                        loginError = res.error ?: res.message ?: tr(language, "登录失败", "Login failed")
                    }
                }
                .onFailure { err ->
                    isAuthenticating = false
                    loginError = err.message ?: tr(language, "网络或服务器错误", "Network or server error")
                }
        }
    }

    fun logout() {
        stopStreaming()
        sdk.clearSessionAuth(keepUsername = rememberMe)
        token = ""
        isAuthenticated = false
        activeWebTool = null
        showNativeMetrics = false
        metricsBackStack = listOf(MetricsRoute.Dashboard)
        messages = emptyList()
        sessions = emptyList()
        sessionGroups = emptyList()
        pendingAttachments = emptyList()
        currentSessionId = null
        workMode = AppWorkMode.CHAT
    }

    fun bootstrapWorkspace() {
        if (token.isBlank()) return
        loadModels()
        loadSuggestions()
        loadSessions()
        loadToolsCatalog()
        loadAlertSummary()
    }

    fun loadModels() {
        viewModelScope.launch {
            runCatching { sdk.api.getModels(token) }
                .onSuccess { res ->
                    models = res.models
                    if (selectedModelId.isBlank() && !res.defaultId.isNullOrBlank()) {
                        selectedModelId = res.defaultId!!
                    }
                }
        }
    }

    fun loadSuggestions() {
        viewModelScope.launch {
            runCatching { sdk.api.getSuggestions(token, 8) }
                .onSuccess { suggestions = it.items }
        }
    }

    fun loadSessions() {
        viewModelScope.launch {
            runCatching { sdk.api.getSessions(token, query = sessionSearchQuery, limit = 40) }
                .onSuccess { res ->
                    sessions = res.items
                    sessionGroups = sdk.groupSessionsByDate(res.items)
                }
        }
    }

    fun loadToolsCatalog() {
        viewModelScope.launch {
            val remote = runCatching { sdk.api.getCustomTools(token) }.getOrDefault(emptyList())
            tools = ToolCatalogMerger.merge(remote)
        }
    }

    fun loadAlertSummary() {
        viewModelScope.launch {
            runCatching { sdk.api.getAlertCenterSummary(token) }
                .onSuccess { alertUnreadCount = it.unread }
        }
    }

    fun startNewChat() {
        stopStreaming()
        currentSessionId = null
        messages = emptyList()
        pendingAttachments = emptyList()
        chatErrorBanner = null
        workMode = AppWorkMode.CHAT
    }

    fun openSession(session: AiSessionSummary) {
        stopStreaming()
        currentSessionId = session.id
        workMode = AppWorkMode.CHAT
        chatErrorBanner = null
        isLoadingSessionMessages = true
        viewModelScope.launch {
            runCatching { sdk.api.getSessionMessages(token, session.id, limit = 60) }
                .onSuccess { res ->
                    isLoadingSessionMessages = false
                    messages = sdk.mapHistoryMessages(res.items)
                }
                .onFailure { err ->
                    isLoadingSessionMessages = false
                    chatErrorBanner = err.message
                }
        }
    }

    fun deleteSession(session: AiSessionSummary) {
        viewModelScope.launch {
            runCatching { sdk.api.deleteSession(token, session.id) }
                .onSuccess {
                    sessions = sessions.filterNot { it.id == session.id }
                    sessionGroups = sdk.groupSessionsByDate(sessions)
                    if (currentSessionId == session.id) {
                        startNewChat()
                    }
                }
        }
    }

    fun enhanceDraftPrompt() {
        val text = composerText.trim()
        if (text.isEmpty() || isEnhancingPrompt) return
        isEnhancingPrompt = true
        chatErrorBanner = null
        viewModelScope.launch {
            runCatching {
                sdk.api.enhancePrompt(
                    token = token,
                    request = EnhancePromptRequest(
                        text = text,
                        uiLanguage = language,
                        modelId = selectedModelId.ifBlank { null }
                    )
                )
            }
                .onSuccess { res ->
                    isEnhancingPrompt = false
                    val enhanced = res.prompt?.trim()
                    if (!enhanced.isNullOrEmpty()) {
                        composerText = enhanced
                    } else if (!res.error.isNullOrBlank()) {
                        chatErrorBanner = res.error
                    }
                }
                .onFailure { err ->
                    isEnhancingPrompt = false
                    chatErrorBanner = err.message
                }
        }
    }

    fun uploadUris(contentResolver: ContentResolver, uris: List<Uri>) {
        if (uris.isEmpty() || isUploadingFiles) return
        isUploadingFiles = true
        chatErrorBanner = null
        viewModelScope.launch {
            val drafts = withContext(Dispatchers.IO) {
                uris.take(5).mapNotNull { uri ->
                    val name = queryFileName(contentResolver, uri) ?: "attachment_${System.currentTimeMillis()}"
                    val mime = contentResolver.getType(uri) ?: "application/octet-stream"
                    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@mapNotNull null
                    UploadAttachmentDraft(fileName = name, mimeType = mime, bytes = bytes)
                }
            }
            if (drafts.isEmpty()) {
                isUploadingFiles = false
                return@launch
            }
            runCatching { sdk.api.uploadFiles(token, drafts) }
                .onSuccess { res ->
                    isUploadingFiles = false
                    if (res.files.isNotEmpty()) {
                        pendingAttachments = pendingAttachments + res.files
                    } else if (!res.error.isNullOrBlank()) {
                        chatErrorBanner = res.error
                    }
                }
                .onFailure { err ->
                    isUploadingFiles = false
                    chatErrorBanner = err.message
                }
        }
    }

    fun removePendingAttachment(file: UploadedFileInfo) {
        pendingAttachments = pendingAttachments.filterNot { it.path == file.path }
    }

    fun sendPrompt(overridePrompt: String? = null) {
        if (isStreaming) return
        val base = (overridePrompt ?: composerText).trim()
        val finalContent = if (overridePrompt != null) {
            base
        } else {
            sdk.appendFilesToPrompt(base, pendingAttachments, language).trim()
        }
        if (finalContent.isEmpty()) return

        chatErrorBanner = null
        if (overridePrompt == null) {
            composerText = ""
            pendingAttachments = emptyList()
        }

        val userMsg = ChatMessage(
            id = UUID.randomUUID().toString(),
            role = "user",
            content = finalContent
        )
        val assistantId = UUID.randomUUID().toString()
        val placeholder = ChatMessage(
            id = assistantId,
            role = "model",
            content = "",
            statusText = tr(language, "正在思考...", "Thinking..."),
            isStreaming = true
        )
        messages = messages + userMsg + placeholder
        isStreaming = true

        val historyDtos = messages.dropLast(1).map {
            ChatHistoryMessageDto(role = if (it.isUser) "user" else "model", content = it.content)
        }

        activeStreamHandle = sdk.streamChat(
            token = token,
            messages = historyDtos,
            sessionId = currentSessionId,
            language = language,
            modelId = selectedModelId.ifBlank { null },
            onEvent = { applyStreamEvent(it, assistantId) },
            onComplete = { finishStreaming(assistantId, interrupted = false) },
            onError = { err ->
                chatErrorBanner = err
                finishStreaming(assistantId, interrupted = true, errorNote = err)
            }
        )
    }

    fun stopStreaming() {
        activeStreamHandle?.cancel()
        activeStreamHandle = null
        if (!isStreaming) return
        messages = messages.map {
            if (!it.isUser && it.isStreaming) it.copy(statusText = null, interrupted = true, isStreaming = false) else it
        }
        isStreaming = false
    }

    fun retryLastPrompt() {
        if (isStreaming) return
        val lastUser = messages.lastOrNull { it.isUser } ?: return
        sendPrompt(lastUser.content)
    }

    private fun applyStreamEvent(event: ChatStreamEvent, assistantId: String) {
        if (!event.sessionId.isNullOrBlank()) {
            currentSessionId = event.sessionId
        }
        messages = messages.map { cur ->
            if (cur.id != assistantId) return@map cur
            when (event.type) {
                StreamEventType.START -> cur
                StreamEventType.TITLE -> {
                    loadSessions()
                    cur
                }
                StreamEventType.STATUS -> cur.copy(statusText = event.text ?: cur.statusText)
                StreamEventType.THINKING -> cur.copy(
                    thinking = cur.thinking + event.text.orEmpty(),
                    statusText = tr(language, "深度思考中...", "Reasoning...")
                )
                StreamEventType.DELTA -> cur.copy(
                    content = cur.content + event.text.orEmpty(),
                    statusText = null
                )
                StreamEventType.TOOL_START -> {
                    val callId = event.callId ?: UUID.randomUUID().toString()
                    val trace = ToolCallTrace(
                        callId = callId,
                        toolName = event.toolName ?: "tool",
                        argsSummary = event.toolArgsSummary.orEmpty(),
                        isFinished = false
                    )
                    val updated = cur.toolCalls.filterNot { it.callId == callId } + trace
                    cur.copy(
                        statusText = tr(language, "正在调用 ${trace.toolName}...", "Running ${trace.toolName}..."),
                        toolCalls = updated
                    )
                }
                StreamEventType.TOOL_RESULT -> {
                    val callId = event.callId ?: event.toolName.orEmpty()
                    val existing = cur.toolCalls.firstOrNull { it.callId == callId }
                    val trace = ToolCallTrace(
                        callId = callId,
                        toolName = existing?.toolName ?: event.toolName ?: "tool",
                        argsSummary = existing?.argsSummary.orEmpty(),
                        summary = event.text.orEmpty(),
                        ok = event.toolOk,
                        durationMs = event.durationMs,
                        isFinished = true
                    )
                    val updated = if (existing != null) {
                        cur.toolCalls.map { if (it.callId == callId) trace else it }
                    } else {
                        cur.toolCalls + trace
                    }
                    cur.copy(statusText = null, toolCalls = updated)
                }
                StreamEventType.MODEL_ROUND, StreamEventType.COMPACTION -> {
                    if (!event.text.isNullOrBlank()) cur.copy(statusText = event.text) else cur
                }
                StreamEventType.DONE -> cur.copy(
                    content = cur.content.ifBlank { event.text.orEmpty() },
                    statusText = null,
                    inputTokens = event.inputTokens ?: cur.inputTokens,
                    outputTokens = event.outputTokens ?: cur.outputTokens,
                    modelName = event.modelName ?: cur.modelName,
                    isStreaming = false
                )
                StreamEventType.ERROR -> {
                    val err = event.errorMessage ?: tr(language, "响应异常", "Stream error")
                    chatErrorBanner = err
                    cur.copy(
                        content = cur.content.ifBlank { "[$err]" },
                        statusText = null,
                        interrupted = true,
                        isStreaming = false
                    )
                }
            }
        }
    }

    private fun finishStreaming(assistantId: String, interrupted: Boolean, errorNote: String? = null) {
        activeStreamHandle = null
        isStreaming = false
        messages = messages.map { cur ->
            if (cur.id != assistantId) cur
            else cur.copy(
                content = if (cur.content.isBlank() && errorNote != null) "[$errorNote]" else cur.content,
                statusText = null,
                interrupted = cur.interrupted || interrupted,
                isStreaming = false
            )
        }
        loadSessions()
    }

    // --- Tool Hub & KPI Monitor Navigation ---

    fun openTool(tool: PlatformTool) {
        if (tool.isNative || tool.routePath == "native://kpi-monitor") {
            openMetricsModule()
        } else {
            activeWebTool = tool
        }
    }

    fun openMetricsModule() {
        workMode = AppWorkMode.TOOLS
        metricsBackStack = listOf(MetricsRoute.Dashboard)
        showNativeMetrics = true
        ensureMonthLoaded(currentMonth)
    }

    fun pushMetricsRoute(route: MetricsRoute) {
        metricsBackStack = metricsBackStack + route
    }

    fun popMetricsRoute(): Boolean {
        if (metricsBackStack.size > 1) {
            metricsBackStack = metricsBackStack.dropLast(1)
            return true
        }
        if (showNativeMetrics) {
            showNativeMetrics = false
            return true
        }
        return false
    }

    fun ensureMonthLoaded(month: Int, force: Boolean = false) {
        if (token.isBlank()) return
        if (!force && summaryByMonth[month] != null) return
        if (metricsLoadingMonths[month] == true) return
        metricsLoadingMonths[month] = true
        metricsErrorByMonth[month] = null

        viewModelScope.launch {
            runCatching { sdk.api.getSummary(token, month, includeOverall = true) }
                .onSuccess {
                    summaryByMonth[month] = it
                    metricsLoadingMonths[month] = false
                }
                .onFailure {
                    metricsErrorByMonth[month] = it.message
                    metricsLoadingMonths[month] = false
                }
        }
        viewModelScope.launch {
            runCatching { sdk.api.getSnapshots(token, month, limit = 20) }
                .onSuccess { snapshotsByMonth[month] = it.items }
        }
    }

    private fun queryFileName(resolver: ContentResolver, uri: Uri): String? {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) return cursor.getString(idx)
            }
        }
        return uri.lastPathSegment
    }
}
