package com.example.newapp.state

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.newapp.services.AudioSpeechRecorder
import com.example.newapp.shared.SettingsManager
import com.example.newapp.shared.data.DragonClawSdk
import com.example.newapp.shared.data.TaskHandle
import com.example.newapp.shared.model.*
import com.example.newapp.shared.network.DragonClawApiClient
import com.example.newapp.shared.util.MarkdownParser
import com.example.newapp.ui.theme.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.UUID

enum class AppWorkMode {
    CHAT,
    TOOLS
}

enum class VoiceChatPhase {
    IDLE,
    LISTENING,
    TRANSCRIBING,
    THINKING,
    SPEAKING,
    PAUSED
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
    var tenantId by mutableStateOf("default")
        private set
    var isSuper by mutableStateOf(false)
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
    var desktopAgentSessions by mutableStateOf<List<DesktopAgentSessionSummary>>(emptyList())
        private set
    var sessionGroups by mutableStateOf<List<SessionGroup>>(emptyList())
        private set
    var unifiedSessionGroups by mutableStateOf<List<UnifiedSessionGroup>>(emptyList())
        private set
    var sessionSearchQuery by mutableStateOf("")
    var currentSessionId by mutableStateOf<String?>(null)
        private set
    var activeDesktopSession by mutableStateOf<DesktopAgentSessionSummary?>(null)
        private set
    var activeDesktopCanSend by mutableStateOf(false)
        private set
    var activeDesktopCanSteer by mutableStateOf(false)
        private set
    var activeDesktopBusy by mutableStateOf(false)
        private set
    var activeDesktopReason by mutableStateOf<String?>(null)
        private set
    val currentSidebarSelectionKey: String?
        get() = activeDesktopSession?.stableKey ?: currentSessionId?.let { "ai:$it" }

    private var sessionLoadJob: Job? = null
    private var desktopPollJob: Job? = null
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
    var chatStatusBanner by mutableStateOf<String?>(null)

    // Voice Recording & Waveform State
    var isRecordingVoice by mutableStateOf(false)
        private set
    var isTranscribingVoice by mutableStateOf(false)
        private set
    var voiceWaveformSamples by mutableStateOf(List(AudioSpeechRecorder.BAR_COUNT) { 0.14f })
        private set
    var voiceElapsedSeconds by mutableIntStateOf(0)
        private set

    // Live Hands-Free AI Voice Conversation State
    var isVoiceChatActive by mutableStateOf(false)
        private set
    var voiceChatPhase by mutableStateOf(VoiceChatPhase.IDLE)
        private set
    var isVoiceChatSpeechMuted by mutableStateOf(false)
        private set
    var voiceChatAudioLevel by mutableFloatStateOf(0.14f)
        private set
    var voiceChatHasSpeech by mutableStateOf(false)
        private set
    var voiceChatUserTranscript by mutableStateOf("")
        private set
    var voiceChatAssistantTranscript by mutableStateOf("")
        private set
    var voiceChatErrorText by mutableStateOf<String?>(null)
        private set

    // Skills, Archived Sessions, Schedules & Tool Nav Sync (P1)
    var skills by mutableStateOf<List<AgentSkillItem>>(emptyList())
        private set
    var showArchivedSessions by mutableStateOf(false)
    var archivedSessions by mutableStateOf<List<AiSessionSummary>>(emptyList())
        private set
    var schedules by mutableStateOf<List<DragonClawScheduleItem>>(emptyList())
        private set
    var isLoadingSchedules by mutableStateOf(false)
        private set
    var isCompactingContext by mutableStateOf(false)
        private set
    var exportedSessionJson by mutableStateOf<String?>(null)

    // Tool Hub & Metrics Navigation
    var tools by mutableStateOf(ToolCatalogMerger.merge(emptyList()))
        private set
    var favoriteToolIds by mutableStateOf<List<String>>(emptyList())
        private set
    var recentToolIds by mutableStateOf<List<String>>(emptyList())
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
    private var speechRecorder: AudioSpeechRecorder? = null
    private var ttsEngine: TextToSpeech? = null
    private var ttsReady = false
    private var voiceResumeJob: Job? = null
    private var voiceAppContext: Context? = null
    private var voiceTurnCompletion: ((String) -> Unit)? = null

    override fun onCleared() {
        voiceResumeJob?.cancel()
        ttsEngine?.stop()
        ttsEngine?.shutdown()
        ttsEngine = null
        speechRecorder?.cancel()
        speechRecorder = null
        super.onCleared()
    }

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
        regroupSessions()
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
                        tenantId = profile.tenantId?.takeIf { it.isNotBlank() }
                            ?: profile.homeTenantId?.takeIf { it.isNotBlank() }
                            ?: "default"
                        isSuper = profile.isSuper
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
                        tenantId = res.tenantId?.takeIf { it.isNotBlank() } ?: "default"
                        isSuper = res.isSuper == true
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
        sessionLoadJob?.cancel()
        sessionLoadJob = null
        desktopPollJob?.cancel()
        desktopPollJob = null
        sdk.clearSessionAuth(keepUsername = rememberMe)
        token = ""
        tenantId = "default"
        isSuper = false
        isAuthenticated = false
        activeWebTool = null
        showNativeMetrics = false
        metricsBackStack = listOf(MetricsRoute.Dashboard)
        messages = emptyList()
        sessions = emptyList()
        desktopAgentSessions = emptyList()
        archivedSessions = emptyList()
        sessionGroups = emptyList()
        unifiedSessionGroups = emptyList()
        activeDesktopSession = null
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = false
        activeDesktopReason = null
        pendingAttachments = emptyList()
        skills = emptyList()
        schedules = emptyList()
        favoriteToolIds = emptyList()
        recentToolIds = emptyList()
        showArchivedSessions = false
        exportedSessionJson = null
        chatStatusBanner = null
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
        loadSkills()
        loadSchedules()
        loadToolNavState()
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
        val query = sessionSearchQuery
        viewModelScope.launch {
            runCatching { sdk.api.getSessions(token, query = query, limit = 40) }
                .onSuccess { res ->
                    sessions = res.items
                    regroupSessions()
                }
        }
        viewModelScope.launch {
            runCatching { sdk.api.getDesktopAgentSessions(token, query = query) }
                .onSuccess { res ->
                    desktopAgentSessions = res.items
                    regroupSessions()
                }
        }
    }

    fun regroupSessions() {
        sessionGroups = sdk.groupSessionsByDate(sessions)
        unifiedSessionGroups = sdk.groupSidebarSessions(sessions, desktopAgentSessions, sessionSearchQuery)
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
        resetActiveChatState(resetShellSurface = true)
    }

    private fun resetActiveChatState(resetShellSurface: Boolean) {
        stopStreaming()
        sessionLoadJob?.cancel()
        sessionLoadJob = null
        desktopPollJob?.cancel()
        desktopPollJob = null
        currentSessionId = null
        activeDesktopSession = null
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = false
        activeDesktopReason = null
        isLoadingSessionMessages = false
        messages = emptyList()
        pendingAttachments = emptyList()
        chatErrorBanner = null
        if (resetShellSurface) {
            showNativeMetrics = false
            activeWebTool = null
            workMode = AppWorkMode.CHAT
        }
    }

    fun openSidebarEntry(entry: SidebarSessionEntry) {
        entry.aiSession?.let { openSession(it) }
            ?: entry.desktopSession?.let { openDesktopSession(it) }
    }

    fun openSession(session: AiSessionSummary) {
        stopStreaming()
        sessionLoadJob?.cancel()
        desktopPollJob?.cancel()
        desktopPollJob = null
        currentSessionId = session.id
        activeDesktopSession = null
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = false
        activeDesktopReason = null
        messages = emptyList()
        pendingAttachments = emptyList()
        showNativeMetrics = false
        activeWebTool = null
        workMode = AppWorkMode.CHAT
        chatErrorBanner = null
        isLoadingSessionMessages = true
        val targetId = session.id
        sessionLoadJob = viewModelScope.launch {
            runCatching { sdk.api.getSessionMessages(token, targetId, limit = 60) }
                .onSuccess { res ->
                    if (currentSessionId == targetId && activeDesktopSession == null) {
                        isLoadingSessionMessages = false
                        messages = sdk.mapHistoryMessages(res.items)
                    }
                }
                .onFailure { err ->
                    if (currentSessionId == targetId && activeDesktopSession == null) {
                        isLoadingSessionMessages = false
                        chatErrorBanner = err.message
                    }
                }
        }
    }

    fun openDesktopSession(session: DesktopAgentSessionSummary) {
        stopStreaming()
        sessionLoadJob?.cancel()
        desktopPollJob?.cancel()
        desktopPollJob = null
        currentSessionId = null
        activeDesktopSession = session
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = session.busy
        activeDesktopReason = null
        messages = emptyList()
        pendingAttachments = emptyList()
        showNativeMetrics = false
        activeWebTool = null
        workMode = AppWorkMode.CHAT
        chatErrorBanner = null
        isLoadingSessionMessages = true
        fetchDesktopMessages(session, passive = false)
    }

    private fun fetchDesktopMessages(session: DesktopAgentSessionSummary, passive: Boolean) {
        val targetKey = session.stableKey
        sessionLoadJob = viewModelScope.launch {
            runCatching { sdk.api.getDesktopAgentMessages(token, session.provider, session.id, passive = passive) }
                .onSuccess { res ->
                    if (activeDesktopSession?.stableKey != targetKey) return@onSuccess
                    isLoadingSessionMessages = false
                    activeDesktopCanSend = res.canSend
                    activeDesktopCanSteer = res.canSteer
                    activeDesktopBusy = res.busy
                    activeDesktopReason = res.reason
                    res.items?.let { items ->
                        messages = sdk.mapDesktopAgentMessages(items)
                    }
                    if (!res.available) {
                        val note = res.error ?: res.reason
                        if (!note.isNullOrBlank() && messages.isEmpty()) {
                            chatStatusBanner = note
                        }
                    }
                    if (res.busy) {
                        scheduleDesktopPoll(session)
                    } else {
                        desktopPollJob?.cancel()
                        desktopPollJob = null
                    }
                }
                .onFailure { err ->
                    if (activeDesktopSession?.stableKey != targetKey) return@onFailure
                    isLoadingSessionMessages = false
                    if (!passive) chatErrorBanner = err.message
                }
        }
    }

    private fun scheduleDesktopPoll(session: DesktopAgentSessionSummary) {
        if (desktopPollJob?.isActive == true) return
        val targetKey = session.stableKey
        desktopPollJob = viewModelScope.launch {
            while (isActive) {
                delay(2500L)
                if (activeDesktopSession?.stableKey != targetKey || !activeDesktopBusy) break
                runCatching { sdk.api.getDesktopAgentMessages(token, session.provider, session.id, passive = true) }
                    .onSuccess { res ->
                        if (activeDesktopSession?.stableKey != targetKey) return@onSuccess
                        activeDesktopCanSend = res.canSend
                        activeDesktopCanSteer = res.canSteer
                        activeDesktopBusy = res.busy
                        activeDesktopReason = res.reason
                        res.items?.let { items ->
                            messages = sdk.mapDesktopAgentMessages(items)
                        }
                    }
                if (!activeDesktopBusy) break
            }
            desktopPollJob = null
            loadSessions()
        }
    }

    fun deleteSession(session: AiSessionSummary) {
        viewModelScope.launch {
            runCatching { sdk.api.deleteSession(token, session.id) }
                .onSuccess {
                    sessions = sessions.filterNot { it.id == session.id }
                    archivedSessions = archivedSessions.filterNot { it.id == session.id }
                    regroupSessions()
                    if (currentSessionId == session.id) {
                        resetActiveChatState(resetShellSurface = false)
                    }
                }
                .onFailure { chatErrorBanner = it.message }
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
        val desktop = activeDesktopSession
        if (desktop != null) {
            if (!activeDesktopCanSend) {
                chatErrorBanner = activeDesktopReason ?: tr(language, "当前桌面连接只读，请在电脑端开启发送权限", "Desktop agent session is read-only")
                return
            }
            val text = (overridePrompt ?: composerText).trim()
            if (text.isEmpty()) return
            chatErrorBanner = null
            if (overridePrompt == null) composerText = ""
            messages = messages + ChatMessage(
                id = UUID.randomUUID().toString(),
                role = "user",
                content = text,
                modelName = desktop.providerDisplayName()
            )
            val wasBusy = activeDesktopBusy
            activeDesktopBusy = true
            val mode = if (wasBusy && activeDesktopCanSteer) "steer" else null
            viewModelScope.launch {
                runCatching {
                    sdk.api.sendDesktopAgentMessage(
                        token = token,
                        provider = desktop.provider,
                        sessionId = desktop.id,
                        request = DesktopAgentSendRequest(
                            text = text,
                            requestId = UUID.randomUUID().toString(),
                            mode = mode
                        )
                    )
                }
                    .onSuccess {
                        fetchDesktopMessages(desktop, passive = true)
                        scheduleDesktopPoll(desktop)
                        loadSessions()
                    }
                    .onFailure { err ->
                        activeDesktopBusy = false
                        chatErrorBanner = err.message
                    }
            }
            return
        }
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
        var finalContent = ""
        messages = messages.map { cur ->
            if (cur.id != assistantId) cur
            else {
                finalContent = cur.content
                cur.copy(
                    content = if (cur.content.isBlank() && errorNote != null) "[$errorNote]" else cur.content,
                    statusText = null,
                    interrupted = cur.interrupted || interrupted,
                    isStreaming = false
                )
            }
        }
        val callback = voiceTurnCompletion
        voiceTurnCompletion = null
        callback?.invoke(finalContent)
        loadSessions()
    }

    // --- Tool Hub & KPI Monitor Navigation ---

    fun openTool(tool: PlatformTool) {
        recordToolOpened(tool.id)
        if (tool.isNative || tool.routePath == "native://kpi-monitor") {
            openMetricsModule()
        } else {
            activeWebTool = tool
        }
    }

    // --- Voice Input, Camera Upload, Skills, Session Lifecycle, Schedules & Tool Nav Sync (P1) ---

    fun startVoiceRecording(context: Context) {
        if (isRecordingVoice || isTranscribingVoice) return
        chatErrorBanner = null
        val rec = speechRecorder ?: AudioSpeechRecorder(context.applicationContext, viewModelScope).also {
            speechRecorder = it
        }
        val started = rec.start(
            onSamples = { samples, secs ->
                voiceWaveformSamples = samples
                voiceElapsedSeconds = secs
            },
            onError = { err ->
                isRecordingVoice = false
                chatErrorBanner = err
            }
        )
        if (started) {
            isRecordingVoice = true
        }
    }

    fun cancelVoiceRecording() {
        speechRecorder?.cancel()
        isRecordingVoice = false
        voiceElapsedSeconds = 0
        voiceWaveformSamples = List(AudioSpeechRecorder.BAR_COUNT) { 0.14f }
    }

    fun finishVoiceRecording(sendImmediately: Boolean) {
        val bytes = speechRecorder?.stopAndReadBytes()
        isRecordingVoice = false
        voiceElapsedSeconds = 0
        voiceWaveformSamples = List(AudioSpeechRecorder.BAR_COUNT) { 0.14f }
        if (bytes == null || bytes.size < 44) {
            chatErrorBanner = tr(language, "录音时间太短，请重试", "Recording is too short")
            return
        }
        isTranscribingVoice = true
        chatErrorBanner = null
        chatStatusBanner = tr(language, "正在识别语音...", "Transcribing voice...")
        viewModelScope.launch {
            runCatching {
                sdk.api.transcribeSpeech(
                    token = token,
                    audioBytes = bytes,
                    fileName = "voice.m4a",
                    mimeType = "audio/mp4"
                )
            }
                .onSuccess { res ->
                    isTranscribingVoice = false
                    chatStatusBanner = null
                    val spoken = res.text.trim()
                    if (spoken.isEmpty()) {
                        chatErrorBanner = res.error ?: tr(language, "未识别到有效语音，请重试", "No speech recognized")
                        return@onSuccess
                    }
                    if (sendImmediately) {
                        val combined = if (composerText.isBlank()) spoken else "${composerText.trim()} $spoken"
                        composerText = combined
                        sendPrompt()
                    } else {
                        composerText = if (composerText.isBlank()) spoken else "$composerText $spoken"
                    }
                }
                .onFailure { err ->
                    isTranscribingVoice = false
                    chatStatusBanner = null
                    chatErrorBanner = err.message ?: tr(language, "语音识别失败", "Voice recognition failed")
                }
        }
    }

    // --- Live Hands-Free AI Voice Conversation ---

    fun startVoiceConversation(context: Context) {
        val appCtx = context.applicationContext
        voiceAppContext = appCtx
        ensureTtsInitialized(appCtx)
        if (isRecordingVoice) cancelVoiceRecording()
        if (activeDesktopSession != null) startNewChat()

        isVoiceChatActive = true
        voiceChatErrorText = null
        voiceChatUserTranscript = ""
        voiceChatAssistantTranscript = ""
        beginVoiceConversationListening()
    }

    fun endVoiceConversation() {
        voiceResumeJob?.cancel()
        voiceResumeJob = null
        ttsEngine?.stop()
        speechRecorder?.cancel()
        voiceTurnCompletion = null
        if (isStreaming) stopStreaming()
        isVoiceChatActive = false
        voiceChatPhase = VoiceChatPhase.IDLE
        voiceChatAudioLevel = 0.14f
        voiceChatHasSpeech = false
    }

    fun toggleVoiceChatPause() {
        voiceResumeJob?.cancel()
        if (voiceChatPhase == VoiceChatPhase.PAUSED) {
            beginVoiceConversationListening()
        } else {
            ttsEngine?.stop()
            speechRecorder?.cancel()
            voiceChatPhase = VoiceChatPhase.PAUSED
            voiceChatAudioLevel = 0.14f
            voiceChatHasSpeech = false
        }
    }

    fun toggleVoiceChatMute() {
        isVoiceChatSpeechMuted = !isVoiceChatSpeechMuted
        if (isVoiceChatSpeechMuted && voiceChatPhase == VoiceChatPhase.SPEAKING) {
            ttsEngine?.stop()
            scheduleNextVoiceChatListening()
        }
    }

    fun submitVoiceConversationTurn() {
        if (!isVoiceChatActive || voiceChatPhase != VoiceChatPhase.LISTENING) return
        finishVoiceConversationListeningAndSend()
    }

    fun interruptAndListenInVoiceChat() {
        voiceResumeJob?.cancel()
        ttsEngine?.stop()
        voiceTurnCompletion = null
        if (isStreaming) stopStreaming()
        voiceChatErrorText = null
        voiceChatPhase = VoiceChatPhase.PAUSED
        voiceResumeJob = viewModelScope.launch {
            delay(140L)
            if (isVoiceChatActive) beginVoiceConversationListening()
        }
    }

    private fun ensureTtsInitialized(appCtx: Context) {
        if (ttsEngine != null) return
        ttsEngine = TextToSpeech(appCtx) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                val locale = if (language == "en") Locale.US else Locale.SIMPLIFIED_CHINESE
                runCatching { ttsEngine?.language = locale }
                ttsEngine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) = Unit
                    override fun onDone(utteranceId: String?) {
                        viewModelScope.launch {
                            if (isVoiceChatActive && voiceChatPhase == VoiceChatPhase.SPEAKING) {
                                scheduleNextVoiceChatListening()
                            }
                        }
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) {
                        viewModelScope.launch {
                            if (isVoiceChatActive && voiceChatPhase == VoiceChatPhase.SPEAKING) {
                                scheduleNextVoiceChatListening()
                            }
                        }
                    }
                })
            }
        }
    }

    private fun beginVoiceConversationListening() {
        val ctx = voiceAppContext ?: return
        if (!isVoiceChatActive) return
        voiceResumeJob?.cancel()
        ttsEngine?.stop()
        voiceChatErrorText = null
        voiceChatHasSpeech = false
        voiceChatAudioLevel = 0.14f
        voiceChatPhase = VoiceChatPhase.LISTENING

        val rec = speechRecorder ?: AudioSpeechRecorder(ctx, viewModelScope).also {
            speechRecorder = it
        }
        val started = rec.start(
            onSamples = { samples, secs ->
                voiceWaveformSamples = samples
                voiceElapsedSeconds = secs
            },
            onError = { err ->
                voiceChatErrorText = err
                voiceChatPhase = VoiceChatPhase.PAUSED
            },
            onLevel = { level, hasSpeech ->
                voiceChatAudioLevel = level
                voiceChatHasSpeech = hasSpeech
            },
            onSilenceDetected = {
                viewModelScope.launch {
                    finishVoiceConversationListeningAndSend()
                }
            }
        )
        if (!started) {
            voiceChatPhase = VoiceChatPhase.PAUSED
        }
    }

    private fun finishVoiceConversationListeningAndSend() {
        if (!isVoiceChatActive || voiceChatPhase != VoiceChatPhase.LISTENING) return
        val bytes = speechRecorder?.stopAndReadBytes()
        voiceChatAudioLevel = 0.14f
        voiceChatHasSpeech = false
        if (bytes == null || bytes.size < 64) {
            scheduleVoiceRetry(tr(language, "没有听清，请再说一次", "Didn't catch that, listening again..."))
            return
        }

        voiceChatPhase = VoiceChatPhase.TRANSCRIBING
        voiceChatErrorText = null
        viewModelScope.launch {
            runCatching {
                sdk.api.transcribeSpeech(
                    token = token,
                    audioBytes = bytes,
                    fileName = "voice.m4a",
                    mimeType = "audio/mp4"
                )
            }
                .onSuccess { res ->
                    if (!isVoiceChatActive) return@onSuccess
                    val spoken = res.text.trim()
                    if (spoken.isEmpty()) {
                        scheduleVoiceRetry(res.error ?: tr(language, "未识别到语音，请再试一次", "No speech recognized"))
                        return@onSuccess
                    }
                    if (activeDesktopSession != null) startNewChat()
                    if (isStreaming) stopStreaming()
                    voiceChatUserTranscript = spoken
                    voiceChatAssistantTranscript = ""
                    voiceChatPhase = VoiceChatPhase.THINKING
                    voiceTurnCompletion = { reply ->
                        if (isVoiceChatActive) handleVoiceReplyCompleted(reply)
                    }
                    sendPrompt(spoken)
                }
                .onFailure { err ->
                    if (!isVoiceChatActive) return@onFailure
                    scheduleVoiceRetry(err.message ?: tr(language, "语音识别失败", "Voice recognition failed"))
                }
        }
    }

    private fun handleVoiceReplyCompleted(rawReply: String) {
        if (!isVoiceChatActive) return
        val speechText = MarkdownParser.toSpeechText(rawReply).ifBlank { rawReply.trim() }
        voiceChatAssistantTranscript = speechText

        if (isVoiceChatSpeechMuted || speechText.isBlank()) {
            scheduleNextVoiceChatListening()
            return
        }

        voiceChatPhase = VoiceChatPhase.SPEAKING
        val engine = ttsEngine
        if (engine != null && ttsReady) {
            val locale = if (language == "en") Locale.US else Locale.SIMPLIFIED_CHINESE
            runCatching { engine.language = locale }
            val result = engine.speak(speechText, TextToSpeech.QUEUE_FLUSH, null, "dc_voice_${System.currentTimeMillis()}")
            if (result != TextToSpeech.SUCCESS) {
                scheduleNextVoiceChatListening()
            }
        } else {
            // Fallback brief pause so user can read the response on screen before next turn
            voiceResumeJob?.cancel()
            voiceResumeJob = viewModelScope.launch {
                delay(2400L)
                if (isVoiceChatActive && voiceChatPhase == VoiceChatPhase.SPEAKING) {
                    beginVoiceConversationListening()
                }
            }
        }
    }

    private fun scheduleVoiceRetry(message: String) {
        voiceChatErrorText = message
        voiceChatPhase = VoiceChatPhase.PAUSED
        voiceResumeJob?.cancel()
        voiceResumeJob = viewModelScope.launch {
            delay(1200L)
            if (isVoiceChatActive && voiceChatPhase == VoiceChatPhase.PAUSED) {
                beginVoiceConversationListening()
            }
        }
    }

    private fun scheduleNextVoiceChatListening() {
        voiceResumeJob?.cancel()
        voiceResumeJob = viewModelScope.launch {
            delay(280L)
            if (isVoiceChatActive && (voiceChatPhase == VoiceChatPhase.SPEAKING || voiceChatPhase == VoiceChatPhase.THINKING)) {
                beginVoiceConversationListening()
            }
        }
    }

    fun uploadCapturedBytes(bytes: ByteArray, fileName: String, mimeType: String) {
        if (bytes.isEmpty() || isUploadingFiles) return
        isUploadingFiles = true
        chatErrorBanner = null
        viewModelScope.launch {
            val draft = UploadAttachmentDraft(fileName = fileName, mimeType = mimeType, bytes = bytes)
            runCatching { sdk.api.uploadFiles(token, listOf(draft)) }
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

    fun loadSkills() {
        if (token.isBlank()) return
        viewModelScope.launch {
            runCatching { sdk.api.getSkills(token) }
                .onSuccess { skills = it.items }
        }
    }

    fun applySkill(skill: AgentSkillItem) {
        val tag = "@${skill.localizedName(language)}"
        composerText = if (composerText.isBlank()) "$tag " else "$composerText $tag "
    }

    fun compactCurrentSession() {
        val sid = currentSessionId ?: return
        if (isCompactingContext || sid.isBlank()) return
        isCompactingContext = true
        chatErrorBanner = null
        chatStatusBanner = tr(language, "正在压缩对话上下文...", "Compacting conversation context...")
        viewModelScope.launch {
            runCatching { sdk.api.compactSession(token, sid, selectedModelId.ifBlank { null }) }
                .onSuccess { res ->
                    isCompactingContext = false
                    chatStatusBanner = if (res.performed) {
                        tr(language, "上下文已压缩（${res.beforeChars} -> ${res.afterChars} 字符）", "Context compacted (${res.beforeChars} -> ${res.afterChars} chars)")
                    } else {
                        res.error ?: tr(language, "当前上下文已足够精简", "Context is already compact")
                    }
                }
                .onFailure { err ->
                    isCompactingContext = false
                    chatStatusBanner = null
                    chatErrorBanner = err.message
                }
        }
    }

    fun loadArchivedSessions() {
        if (token.isBlank()) return
        viewModelScope.launch {
            runCatching { sdk.api.getArchivedSessions(token, query = sessionSearchQuery, limit = 40) }
                .onSuccess { archivedSessions = it.items }
        }
    }

    fun archiveSession(session: AiSessionSummary) {
        viewModelScope.launch {
            runCatching { sdk.api.archiveSession(token, session.id) }
                .onSuccess {
                    sessions = sessions.filterNot { it.id == session.id }
                    regroupSessions()
                    loadArchivedSessions()
                    if (currentSessionId == session.id) {
                        resetActiveChatState(resetShellSurface = false)
                    }
                }
                .onFailure { chatErrorBanner = it.message }
        }
    }

    fun unarchiveSession(session: AiSessionSummary) {
        viewModelScope.launch {
            runCatching { sdk.api.unarchiveSession(token, session.id) }
                .onSuccess {
                    archivedSessions = archivedSessions.filterNot { it.id == session.id }
                    loadSessions()
                }
                .onFailure { chatErrorBanner = it.message }
        }
    }

    fun exportSession(session: AiSessionSummary) {
        viewModelScope.launch {
            runCatching { sdk.api.exportSessionRawJson(token, session.id) }
                .onSuccess { exportedSessionJson = it }
                .onFailure { chatErrorBanner = it.message }
        }
    }

    fun loadSchedules() {
        if (token.isBlank()) return
        isLoadingSchedules = true
        viewModelScope.launch {
            runCatching { sdk.api.getSchedules(token) }
                .onSuccess {
                    isLoadingSchedules = false
                    schedules = it.items
                }
                .onFailure { isLoadingSchedules = false }
        }
    }

    fun createSchedule(text: String) {
        val clean = text.trim()
        if (clean.isEmpty() || token.isBlank()) return
        viewModelScope.launch {
            val tz = java.util.TimeZone.getDefault().id
            runCatching {
                sdk.api.createSchedule(
                    token = token,
                    request = CreateScheduleRequest(
                        text = clean,
                        sessionId = currentSessionId.orEmpty(),
                        timezone = tz,
                        modelId = selectedModelId.ifBlank { null }
                    )
                )
            }
                .onSuccess { res ->
                    res.item?.let { schedules = listOf(it) + schedules } ?: loadSchedules()
                }
                .onFailure { chatErrorBanner = it.message }
        }
    }

    fun deleteSchedule(schedule: DragonClawScheduleItem) {
        viewModelScope.launch {
            runCatching { sdk.api.deleteSchedule(token, schedule.id) }
                .onSuccess { schedules = schedules.filterNot { it.id == schedule.id } }
                .onFailure { chatErrorBanner = it.message }
        }
    }

    fun loadToolNavState() {
        if (token.isBlank()) return
        viewModelScope.launch {
            runCatching { sdk.api.getFavoriteNav(token) }
                .onSuccess { favoriteToolIds = it.ids }
            runCatching { sdk.api.getRecentNav(token) }
                .onSuccess { recentToolIds = it.ids }
        }
    }

    fun toggleFavoriteTool(toolId: String) {
        val next = favoriteToolIds.toMutableList()
        if (!next.remove(toolId)) next.add(0, toolId)
        favoriteToolIds = next
        viewModelScope.launch {
            runCatching { sdk.api.saveFavoriteNav(token, next) }
                .onSuccess { favoriteToolIds = it.ids }
        }
    }

    fun recordToolOpened(toolId: String) {
        if (token.isBlank()) return
        viewModelScope.launch {
            runCatching { sdk.api.recordRecentNav(token, toolId) }
                .onSuccess { recentToolIds = it.ids }
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
