package com.example.newapp.shared.data

import com.example.newapp.shared.SettingsManager
import com.example.newapp.shared.currentEpochMillis
import com.example.newapp.shared.model.*
import com.example.newapp.shared.network.DragonClawApiClient
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.SessionGrouping
import com.example.newapp.shared.util.VoicePersonaCatalog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Cancellation token returned to Swift / Android callers for async operations and SSE/NDJSON streams. */
class TaskHandle(private val job: Job) {
    fun cancel() {
        job.cancel()
    }
}

/** How a cold-start check of the saved token ended. */
enum class SessionRestoreOutcome {
    /** Server confirmed the token. */
    VALID,
    /** Server could not be reached; the token may still be good. */
    OFFLINE,
    /** Server rejected the token (401 / 403). */
    EXPIRED
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
            settings.removeSecret(KEY_SAVED_PASSWORD)
            settings.saveBoolean(KEY_AUTO_LOGIN, false)
        }
    }

    fun getAutoLogin(): Boolean = settings.getBoolean(KEY_AUTO_LOGIN, false)

    fun saveAutoLogin(autoLogin: Boolean) {
        settings.saveBoolean(KEY_AUTO_LOGIN, autoLogin)
    }

    fun getSavedUsername(): String = settings.getString(KEY_USERNAME, "")

    fun getSavedPassword(): String = settings.getSecret(KEY_SAVED_PASSWORD)

    fun getSavedToken(): String = settings.getSecret(KEY_TOKEN)

    /** True when a silent re-login is possible after the token expires. */
    fun canReauthenticate(): Boolean =
        getRememberMe() && getSavedUsername().isNotBlank() && getSavedPassword().isNotEmpty()

    fun getSavedRole(): String = settings.getString(KEY_ROLE, "user")

    fun getSelectedModelId(): String = settings.getString(KEY_SELECTED_MODEL, "")

    fun saveSelectedModelId(modelId: String) {
        settings.saveString(KEY_SELECTED_MODEL, modelId.trim())
    }

    fun getVoicePersonaId(): String =
        VoicePersonaCatalog.normalizeVoiceId(
            settings.getString(VoicePersonaCatalog.SETTINGS_KEY_VOICE_ID, VoicePersonaCatalog.DEFAULT_VOICE_ID)
        )

    fun saveVoicePersonaId(voiceId: String) {
        settings.saveString(
            VoicePersonaCatalog.SETTINGS_KEY_VOICE_ID,
            VoicePersonaCatalog.normalizeVoiceId(voiceId)
        )
    }

    fun isPinnedSessionsCollapsed(): Boolean = settings.getBoolean(KEY_PINNED_COLLAPSED, false)

    fun setPinnedSessionsCollapsed(collapsed: Boolean) {
        settings.saveBoolean(KEY_PINNED_COLLAPSED, collapsed)
    }

    val conversationCache: ConversationCacheManager by lazy {
        ConversationCacheManager().also {
            it.configureScope(getBaseUrl(), getSavedUsername())
        }
    }

    fun syncConversationCacheScope(username: String = getSavedUsername()) {
        conversationCache.configureScope(getBaseUrl(), username)
    }

    fun clearConversationCache() {
        syncConversationCacheScope()
        conversationCache.clearCurrentScope()
    }

    fun currentTimestampMs(): Long = currentEpochMillis()

    fun shouldRefreshSessions(lastSyncedMs: Long, minIntervalMs: Long = 18_000L): Boolean {
        if (lastSyncedMs <= 0L) return true
        val elapsed = currentEpochMillis() - lastSyncedMs
        return elapsed < 0L || elapsed >= minIntervalMs
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
        settings.saveSecret(KEY_TOKEN, cleanToken)
        settings.saveString(KEY_USERNAME, username)
        settings.saveString(KEY_ROLE, role.ifBlank { "user" })
        if (rememberMe && password != null) {
            settings.saveSecret(KEY_SAVED_PASSWORD, password)
        } else {
            settings.removeSecret(KEY_SAVED_PASSWORD)
        }
        syncConversationCacheScope(username)
    }

    fun clearSessionAuth(keepUsername: Boolean = true) {
        settings.removeSecret(KEY_TOKEN)
        settings.removeKey(KEY_ROLE)
        settings.saveBoolean(KEY_AUTO_LOGIN, false)
        if (!keepUsername) {
            settings.removeKey(KEY_USERNAME)
            settings.removeSecret(KEY_SAVED_PASSWORD)
        }
    }

    fun getCurrentMonth(): Int = settings.getCurrentMonth()

    fun getAppVersion(): String = settings.getAppVersion()

    fun buildToolUrl(routePath: String): String {
        return com.example.newapp.shared.util.ToolNavigation.buildUrl(getBaseUrl(), routePath)
    }

    /**
     * True only when [url] points at the configured platform server (same scheme, host and port).
     * Credentials must never be attached to, or seeded into, any other origin.
     */
    fun isPlatformOrigin(url: String): Boolean {
        val target = runCatching { io.ktor.http.Url(url) }.getOrNull() ?: return false
        val base = runCatching { io.ktor.http.Url(getBaseUrl()) }.getOrNull() ?: return false
        return target.host.isNotEmpty() &&
            target.host.equals(base.host, ignoreCase = true) &&
            target.port == base.port &&
            target.protocol.name == base.protocol.name
    }

    fun groupSessionsByDate(sessions: List<AiSessionSummary>): List<SessionGroup> =
        SessionGrouping.groupSessions(sessions, currentEpochMillis())

    fun groupSidebarSessions(
        aiSessions: List<AiSessionSummary>,
        desktopSessions: List<DesktopAgentSessionSummary>,
        searchQuery: String = ""
    ): List<UnifiedSessionGroup> =
        SessionGrouping.groupSidebarSessions(aiSessions, desktopSessions, searchQuery, currentEpochMillis())

    fun groupSidebarSessions(
        aiSessions: List<AiSessionSummary>,
        desktopSessions: List<DesktopAgentSessionSummary>,
        searchQuery: String = "",
        preferences: List<ConversationListPreferenceItem> = emptyList(),
        shared: List<SharedConversation> = emptyList()
    ): List<UnifiedSessionGroup> =
        SessionGrouping.groupSidebarSessions(aiSessions, desktopSessions, searchQuery, currentEpochMillis(), preferences, shared)

    fun shouldCollapseSharedGroup(bucket: SessionBucket, isSharedCollapsed: Boolean, searchQuery: String): Boolean =
        SessionGrouping.shouldCollapseSharedGroup(bucket, isSharedCollapsed, searchQuery)

    fun applyConversationPreferencesToAi(
        sessions: List<AiSessionSummary>,
        preferences: List<ConversationListPreferenceItem>
    ): List<AiSessionSummary> =
        SessionGrouping.applyPreferencesToAiSessions(sessions, preferences)

    fun applyConversationPreferencesToDesktop(
        sessions: List<DesktopAgentSessionSummary>,
        preferences: List<ConversationListPreferenceItem>
    ): List<DesktopAgentSessionSummary> =
        SessionGrouping.applyPreferencesToDesktopSessions(sessions, preferences)

    fun mergeArchivedAiSessions(
        archivedApiItems: List<AiSessionSummary>,
        activeAiItems: List<AiSessionSummary>,
        preferences: List<ConversationListPreferenceItem>,
        searchQuery: String = ""
    ): List<AiSessionSummary> =
        SessionGrouping.mergeArchivedAiSessions(archivedApiItems, activeAiItems, preferences, searchQuery)

    fun preferenceTargetForDesktop(
        provider: String,
        sessionId: String,
        preferences: List<ConversationListPreferenceItem>
    ): Pair<String, String> =
        SessionGrouping.preferenceTargetForDesktop(provider, sessionId, preferences)

    fun withPreferencePinned(
        preferences: List<ConversationListPreferenceItem>,
        source: String,
        id: String,
        pinned: Boolean
    ): List<ConversationListPreferenceItem> =
        SessionGrouping.upsertPreference(preferences, source, id, setPinned = pinned)

    fun withPreferenceArchived(
        preferences: List<ConversationListPreferenceItem>,
        source: String,
        id: String,
        archived: Boolean
    ): List<ConversationListPreferenceItem> =
        SessionGrouping.upsertPreference(preferences, source, id, setArchived = archived)

    fun withPreferenceTitle(
        preferences: List<ConversationListPreferenceItem>,
        source: String,
        id: String,
        title: String
    ): List<ConversationListPreferenceItem> =
        SessionGrouping.upsertPreference(preferences, source, id, setTitle = title)

    fun withPreferenceServerItem(
        preferences: List<ConversationListPreferenceItem>,
        item: ConversationListPreferenceItem
    ): List<ConversationListPreferenceItem> {
        val list = preferences.toMutableList()
        val idx = list.indexOfFirst { it.source == item.source && it.id == item.id }
        if (idx >= 0) list[idx] = item else list.add(item)
        return list
    }

    fun movePinnedEntryOrder(
        groups: List<UnifiedSessionGroup>,
        preferences: List<ConversationListPreferenceItem>,
        stableKey: String,
        moveUp: Boolean
    ): List<String>? =
        SessionGrouping.movePinnedEntryOrder(groups, preferences, stableKey, moveUp)

    fun reorderPinnedEntries(
        groups: List<UnifiedSessionGroup>,
        preferences: List<ConversationListPreferenceItem>,
        orderedStableKeys: List<String>
    ): List<String>? =
        SessionGrouping.reorderPinnedEntries(groups, preferences, orderedStableKeys)

    fun applyLocalPinOrder(
        preferences: List<ConversationListPreferenceItem>,
        source: String = "mine",
        orderedIds: List<String>
    ): List<ConversationListPreferenceItem> =
        SessionGrouping.applyLocalPinOrder(preferences, source, orderedIds)

    fun mapHistoryMessages(items: List<SessionMessageItem>): List<ChatMessage> =
        DragonClawHelpers.mapStoredMessages(items, baseUrl = getBaseUrl())

    fun mergeMessages(messages: List<ChatMessage>): List<ChatMessage> =
        DragonClawHelpers.mergeConsecutiveAssistantMessages(messages)

    fun mergeDesktopTailItems(
        existing: List<DesktopAgentMessageItem>,
        incomingTail: List<DesktopAgentMessageItem>
    ): List<DesktopAgentMessageItem> =
        DragonClawHelpers.mergeDesktopTailItems(existing, incomingTail)

    fun isBusyQueueableError(errorText: String?): Boolean =
        DragonClawHelpers.isBusyQueueableError(errorText)

    fun mapDesktopAgentMessages(items: List<DesktopAgentMessageItem>): List<ChatMessage> =
        DragonClawHelpers.mapDesktopAgentMessages(items, baseUrl = getBaseUrl())

    fun appendFilesToPrompt(text: String, files: List<UploadedFileInfo>, language: String): String =
        DragonClawHelpers.appendUploadedFilesPrompt(text, files, language)

    fun attachmentsFromUploadedFiles(files: List<UploadedFileInfo>): List<ChatAttachment> =
        DragonClawHelpers.attachmentsFromUploadedFiles(files, baseUrl = getBaseUrl())

    fun extractMessageAttachmentsAndCleanText(
        rawContent: String,
        existingAttachments: List<ChatAttachment> = emptyList()
    ): Pair<String, List<ChatAttachment>> =
        DragonClawHelpers.extractMessageAttachmentsAndCleanText(rawContent, baseUrl = getBaseUrl(), existingAttachments = existingAttachments)

    fun resolveImageUrl(rawSrc: String): String =
        DragonClawHelpers.resolveImageSourceUrl(getBaseUrl(), rawSrc)

    fun filterStarterPrompts(suggestions: List<AiSuggestion>, language: String, limit: Int = 3): List<String> =
        DragonClawHelpers.filterStarterPrompts(suggestions, language, limit)

    fun mergeToolCatalog(remoteTools: List<CustomToolDto>): List<PlatformTool> =
        ToolCatalogMerger.merge(remoteTools)

    // ── 共享对话 ──
    fun fetchShareInbox(
        token: String,
        onSuccess: (ShareInboxResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.getShareInbox(token) }, onSuccess = onSuccess, onError = onError)

    fun fetchSharedConversations(
        token: String,
        onSuccess: (SharedConversationsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.getMySharedConversations(token) }, onSuccess = onSuccess, onError = onError)

    fun respondShareInvite(
        token: String,
        shareId: String,
        action: String,
        onSuccess: (ShareRespondResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.respondShareInvite(token, shareId, action) }, onSuccess = onSuccess, onError = onError)

    fun joinShareLink(
        token: String,
        linkToken: String,
        onSuccess: (ShareLinkJoinResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.joinShareLink(token, linkToken) }, onSuccess = onSuccess, onError = onError)

    fun fetchShareAccounts(
        token: String,
        query: String = "",
        onSuccess: (ShareAccountsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.getShareAccounts(token, query) }, onSuccess = onSuccess, onError = onError)

    fun fetchShareGroups(
        token: String,
        onSuccess: (ShareGroupsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.getShareGroups(token) }, onSuccess = onSuccess, onError = onError)

    fun createShareGroup(
        token: String,
        name: String,
        members: List<String>,
        onSuccess: (ShareGroupResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.createShareGroup(token, name, members) }, onSuccess = onSuccess, onError = onError)

    fun deleteShareGroup(
        token: String,
        groupId: String,
        onSuccess: (ShareOkResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.deleteShareGroup(token, groupId) }, onSuccess = onSuccess, onError = onError)

    fun fetchShareRecent(
        token: String,
        onSuccess: (ShareRecentResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.getShareRecent(token) }, onSuccess = onSuccess, onError = onError)

    fun prepareShare(
        token: String,
        sessionId: String,
        title: String,
        onSuccess: (ShareResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.prepareShare(token, sessionId, DragonClawHelpers.cleanShareTitle(title)) }, onSuccess = onSuccess, onError = onError)

    fun inviteToShare(
        token: String,
        sessionId: String,
        title: String,
        usernames: List<String>,
        groupIds: List<String>,
        onSuccess: (ShareInviteResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.inviteToShare(token, sessionId, ShareInviteRequest(DragonClawHelpers.cleanShareTitle(title), usernames, groupIds)) }, onSuccess = onSuccess, onError = onError)

    fun syncSharedSession(
        token: String,
        sessionId: String,
        onSuccess: (ShareSyncResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.syncSharedSession(token, sessionId) }, onSuccess = onSuccess, onError = onError)

    fun leaveShare(
        token: String,
        sessionId: String,
        onSuccess: (ShareLeaveResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.leaveShare(token, sessionId) }, onSuccess = onSuccess, onError = onError)

    fun removeShareMember(
        token: String,
        sessionId: String,
        username: String,
        onSuccess: (ShareResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(block = { api.removeShareMember(token, sessionId, username) }, onSuccess = onSuccess, onError = onError)

    /** 共享链接（网页端生成的 /?share=xxx，也接受整段 URL）里的令牌；不是共享链接返回 null */
    fun shareTokenFromLink(text: String): String? =
        Regex("[?&]share=([A-Za-z0-9_-]{8,80})").find(text.trim())?.groupValues?.get(1)
            ?: text.trim().takeIf { Regex("^[A-Za-z0-9_-]{16,80}$").matches(it) }

    /** 共享链接的完整地址（复制 / 系统分享用） */
    fun absoluteShareLink(link: String): String =
        if (link.startsWith("http://") || link.startsWith("https://")) link else getBaseUrl().trimEnd('/') + "/" + link.trimStart('/')

    fun cleanTitle(raw: String): String = DragonClawHelpers.cleanShareTitle(raw)

    fun sortShareAccounts(accounts: List<ShareAccount>, query: String, recent: List<ShareRecentUser>): List<ShareAccount> =
        DragonClawHelpers.sortShareAccounts(accounts, query, recent)

    fun isSharedSessionsCollapsed(): Boolean = settings.getBoolean(KEY_SHARED_COLLAPSED, false)

    fun setSharedSessionsCollapsed(collapsed: Boolean) {
        settings.saveBoolean(KEY_SHARED_COLLAPSED, collapsed)
    }

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

    /** Registers the session-expired hook; [handler] always runs on the main thread. */
    fun setUnauthorizedHandler(handler: () -> Unit) {
        api.onUnauthorized = {
            scope.launch(Dispatchers.Main) { handler() }
        }
    }

    /**
     * Cold-start verification that tells a rejected token apart from a network failure,
     * so being offline never triggers a password re-login or a bounce to the login screen.
     */
    fun restoreSession(
        token: String,
        onResult: (SessionRestoreOutcome, UserProfile?) -> Unit
    ): TaskHandle {
        val job = scope.launch {
            val (outcome, profile) = try {
                SessionRestoreOutcome.VALID to api.getMe(token)
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: com.example.newapp.shared.network.ApiHttpException) {
                val rejected = e.statusCode == 401 || e.statusCode == 403
                (if (rejected) SessionRestoreOutcome.EXPIRED else SessionRestoreOutcome.OFFLINE) to null
            } catch (t: Throwable) {
                SessionRestoreOutcome.OFFLINE to null
            }
            withContext(Dispatchers.Main) {
                onResult(outcome, profile)
            }
        }
        return TaskHandle(job)
    }

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
        limit: Int = 80,
        onSuccess: (AiSessionsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getSessions(token, query = query, limit = limit) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchConversationPreferences(
        token: String,
        onSuccess: (ConversationListResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getConversationListPreferences(token) },
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
        voiceMode: Boolean = false,
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
            modelId = modelId?.takeIf { it.isNotBlank() },
            voiceMode = if (voiceMode) true else null,
            supportsApproval = true
        )
        val job = scope.launch {
            val coalescer = StreamCoalescer(this, STREAM_FLUSH_INTERVAL_MS) { evt ->
                withContext(Dispatchers.Main) {
                    onEvent(evt)
                }
            }
            try {
                api.streamChat(token, request) { evt -> coalescer.offer(evt) }
                coalescer.finish()
                withContext(Dispatchers.Main) {
                    onComplete()
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                runCatching { coalescer.finish() }
                val msg = t.message?.takeIf { it.isNotBlank() } ?: "Stream interrupted"
                withContext(Dispatchers.Main) {
                    onError(msg)
                }
            }
        }
        return TaskHandle(job)
    }

    fun resolveApproval(
        token: String,
        approvalId: String,
        decision: String,
        scope: String? = null,
        approvalUrl: String? = null,
        onSuccess: (ApprovalResolveResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.resolveApproval(
                token = token,
                approvalId = approvalId,
                decision = decision,
                scope = scope,
                approvalUrl = approvalUrl
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

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

    fun fetchAlertEvents(
        token: String,
        filter: String = "all",
        onSuccess: (AlertCenterEventsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getAlertCenterEvents(token, filter) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun markAlertEventsRead(
        token: String,
        ids: List<String>,
        onSuccess: (AlertCenterMutationResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.markAlertEventsRead(token, ids) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun markAllAlertEventsRead(
        token: String,
        onSuccess: (AlertCenterMutationResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.markAllAlertEventsRead(token) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun archiveAlertEvent(
        token: String,
        eventId: String,
        onSuccess: (AlertCenterMutationResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.archiveAlertEvent(token, eventId) },
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

    fun synthesizeSpeech(
        token: String,
        text: String,
        language: String = "zh",
        voice: String? = null,
        turnId: String? = null,
        onSuccess: (SynthesizedSpeechAudio) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.synthesizeSpeech(token, text, language, voice, turnId) },
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
        block = {
            val res = api.archiveSession(token, sessionId)
            runCatching {
                api.saveConversationListPreference(
                    token,
                    ConversationListSaveRequest(source = "mine", id = sessionId, archived = true)
                )
            }
            res
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun unarchiveSession(
        token: String,
        sessionId: String,
        onSuccess: (ArchiveSessionResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            val res = api.unarchiveSession(token, sessionId)
            runCatching {
                api.saveConversationListPreference(
                    token,
                    ConversationListSaveRequest(source = "mine", id = sessionId, archived = false)
                )
            }
            res
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun pinSession(
        token: String,
        sessionId: String,
        pinned: Boolean,
        onSuccess: (PinSessionResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.pinSession(token, sessionId, pinned) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun setConversationPinned(
        token: String,
        source: String = "mine",
        id: String,
        pinned: Boolean,
        onSuccess: (ConversationListSaveResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.saveConversationListPreference(
                token,
                ConversationListSaveRequest(source = source, id = id, pinned = pinned)
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun renameConversation(
        token: String,
        source: String = "mine",
        id: String,
        title: String,
        onSuccess: (ConversationListSaveResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.saveConversationListPreference(
                token,
                ConversationListSaveRequest(source = source, id = id, title = title)
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun setConversationHidden(
        token: String,
        source: String,
        id: String,
        hidden: Boolean,
        onSuccess: (ConversationListSaveResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.saveConversationListPreference(
                token,
                ConversationListSaveRequest(source = source, id = id, hidden = hidden)
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun setConversationArchived(
        token: String,
        source: String,
        id: String,
        archived: Boolean,
        onSuccess: (ConversationListSaveResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.saveConversationListPreference(
                token,
                ConversationListSaveRequest(source = source, id = id, archived = archived)
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun reorderPinnedConversations(
        token: String,
        source: String = "mine",
        order: List<String>,
        onSuccess: (ConversationListSaveResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.reorderPinnedConversations(token, source = source, order = order) },
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

    // --- Desktop Agent Connectors (Codex / Claude Code / Antigravity / WorkBuddy) ---

    fun fetchDesktopAgentSessions(
        token: String,
        query: String = "",
        onSuccess: (DesktopAgentsSessionsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getDesktopAgentSessions(token, query) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchDesktopAgentMessages(
        token: String,
        provider: String,
        sessionId: String,
        passive: Boolean = false,
        limit: Int = 0,
        before: String? = null,
        onSuccess: (DesktopAgentMessagesResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.getDesktopAgentMessages(
                token = token,
                provider = provider,
                sessionId = sessionId,
                passive = passive,
                limit = limit.takeIf { it > 0 },
                before = before
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun fetchDesktopAgentModels(
        token: String,
        provider: String,
        cached: Boolean = false,
        force: Boolean = false,
        onSuccess: (DesktopAgentModelsResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.getDesktopAgentModels(token, provider, cached = cached, force = force) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun setDesktopAgentModel(
        token: String,
        provider: String,
        sessionId: String,
        model: String,
        onSuccess: (DesktopAgentSetModelResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.setDesktopAgentModel(token, provider, sessionId, model) },
        onSuccess = onSuccess,
        onError = onError
    )

    fun sendDesktopAgentMessage(
        token: String,
        provider: String,
        sessionId: String,
        text: String,
        requestId: String,
        mode: String? = null,
        model: String? = null,
        onSuccess: (DesktopAgentSendResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = {
            api.sendDesktopAgentMessage(
                token = token,
                provider = provider,
                sessionId = sessionId,
                request = DesktopAgentSendRequest(text = text, requestId = requestId, mode = mode, model = model)
            )
        },
        onSuccess = onSuccess,
        onError = onError
    )

    fun cancelDesktopAgentQueuedMessage(
        token: String,
        provider: String,
        sessionId: String,
        requestId: String,
        onSuccess: (DesktopAgentSendResponse) -> Unit,
        onError: (String) -> Unit
    ): TaskHandle = runAsync(
        block = { api.cancelDesktopAgentQueuedMessage(token, provider, sessionId, requestId) },
        onSuccess = onSuccess,
        onError = onError
    )

    companion object {
        /** UI refresh budget while streaming: ~20 fps instead of one full re-render per token. */
        private const val STREAM_FLUSH_INTERVAL_MS = 50L
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
        private const val KEY_PINNED_COLLAPSED = "pinned_sessions_collapsed"
        private const val KEY_SHARED_COLLAPSED = "shared_sessions_collapsed"
    }
}

/**
 * Merges bursts of DELTA / THINKING tokens into one event per [intervalMs] so the UI rebuilds
 * (and re-parses Markdown) at a bounded rate. Other events are delivered immediately and in order.
 */
internal class StreamCoalescer(
    private val scope: CoroutineScope,
    private val intervalMs: Long,
    private val deliver: suspend (ChatStreamEvent) -> Unit
) {
    private val mutex = Mutex()
    private val buffer = StringBuilder()
    private var pendingType: StreamEventType? = null
    private var pendingSessionId: String? = null
    private var lastFlushAtMs = 0L
    private var timer: Job? = null

    suspend fun offer(event: ChatStreamEvent) = mutex.withLock {
        val mergeable = event.type == StreamEventType.DELTA || event.type == StreamEventType.THINKING
        if (!mergeable) {
            flushLocked()
            deliver(event)
            return@withLock
        }
        if (pendingType != null && pendingType != event.type) flushLocked()
        pendingType = event.type
        buffer.append(event.text.orEmpty())
        if (!event.sessionId.isNullOrBlank()) pendingSessionId = event.sessionId

        val elapsed = currentEpochMillis() - lastFlushAtMs
        if (elapsed >= intervalMs) {
            flushLocked()
        } else if (timer == null) {
            timer = scope.launch {
                delay(intervalMs - elapsed)
                mutex.withLock {
                    timer = null
                    flushLocked()
                }
            }
        }
    }

    suspend fun finish() = mutex.withLock {
        timer?.cancel()
        timer = null
        flushLocked()
    }

    private suspend fun flushLocked() {
        val type = pendingType ?: return
        val text = buffer.toString()
        val sessionId = pendingSessionId
        buffer.clear()
        pendingType = null
        pendingSessionId = null
        lastFlushAtMs = currentEpochMillis()
        if (text.isNotEmpty() || sessionId != null) {
            deliver(ChatStreamEvent(type = type, sessionId = sessionId, text = text))
        }
    }
}
