package com.example.newapp.shared.data

import com.example.newapp.shared.PlatformConversationDiskStore
import com.example.newapp.shared.TextCacheStorage
import com.example.newapp.shared.currentEpochMillis
import com.example.newapp.shared.model.AiSessionSummary
import com.example.newapp.shared.model.ChatMessage
import com.example.newapp.shared.model.DesktopAgentMessageItem
import com.example.newapp.shared.model.DesktopAgentSessionSummary
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.SessionGrouping
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

enum class SessionCacheDecision {
    USE_CACHE_SKIP_NETWORK,
    USE_CACHE_BACKGROUND_REFRESH,
    FETCH_WITH_SHIMMER
}

@Serializable
data class CachedAiSessionPayload(
    val sessionId: String,
    val sessionUpdatedAt: String? = null,
    val sessionMessageCount: Int = 0,
    val beforeCursor: String? = null,
    val hasMore: Boolean = false,
    val syncedAtMs: Long = 0L,
    val localWriteAtMs: Long = 0L,
    val messages: List<ChatMessage> = emptyList()
)

@Serializable
data class CachedDesktopSessionPayload(
    val stableKey: String,
    val provider: String,
    val sessionId: String,
    val sessionUpdatedAt: String? = null,
    val sessionObservedAt: String? = null,
    val beforeCursor: String? = null,
    val hasMore: Boolean = false,
    val available: Boolean = true,
    val canSend: Boolean = false,
    val canSteer: Boolean = false,
    val selectedModel: String = "",
    val reason: String? = null,
    val syncedAtMs: Long = 0L,
    val rawItems: List<DesktopAgentMessageItem> = emptyList()
)

data class AiSessionCacheEvaluation(
    val decision: SessionCacheDecision,
    val cached: CachedAiSessionPayload? = null
)

data class DesktopSessionCacheEvaluation(
    val decision: SessionCacheDecision,
    val cached: CachedDesktopSessionPayload? = null
)

@Serializable
private data class ConversationCacheIndex(
    val storageKeys: List<String> = emptyList()
)

/**
 * Bounded per-account local conversation cache with in-memory LRU + disk persistence.
 * Eliminates redundant history network fetches when revisiting unchanged / historical chats.
 */
class ConversationCacheManager(
    private val storage: TextCacheStorage = PlatformConversationDiskStore(),
    private val clockMs: () -> Long = { currentEpochMillis() },
    private val maxPersistedSessions: Int = DEFAULT_MAX_PERSISTED_SESSIONS,
    private val maxMemoryEntries: Int = DEFAULT_MAX_MEMORY_ENTRIES,
    private val maxMessagesPerSession: Int = DEFAULT_MAX_MESSAGES_PER_SESSION
) {
    private val json = DragonClawHelpers.lenientJson

    private var currentScopeId: String = hashScope("", "")
    private val aiMemory = mutableMapOf<String, CachedAiSessionPayload>()
    private val desktopMemory = mutableMapOf<String, CachedDesktopSessionPayload>()
    private val memoryOrder = mutableListOf<String>()
    private var diskIndexKeys: MutableList<String>? = null

    fun configureScope(baseUrl: String, username: String) {
        val nextScope = hashScope(baseUrl, username)
        if (nextScope == currentScopeId) return
        currentScopeId = nextScope
        aiMemory.clear()
        desktopMemory.clear()
        memoryOrder.clear()
        diskIndexKeys = null
    }

    fun clearCurrentScope() {
        val keys = loadScopeIndex().toList()
        for (storageKey in keys) {
            storage.remove(storageKey)
        }
        storage.remove(indexKeyForScope())
        aiMemory.clear()
        desktopMemory.clear()
        memoryOrder.clear()
        diskIndexKeys = mutableListOf()
    }

    fun getAiSession(sessionId: String): CachedAiSessionPayload? {
        if (sessionId.isBlank()) return null
        val key = aiStorageKey(sessionId)
        aiMemory[key]?.let {
            touchMemoryOrder(key)
            return it
        }
        val raw = storage.readText(key) ?: return null
        val parsed = runCatching {
            json.decodeFromString(CachedAiSessionPayload.serializer(), raw)
        }.getOrNull() ?: run {
            removeEntryByStorageKey(key)
            return null
        }
        if (parsed.sessionId != sessionId || parsed.messages.isEmpty()) return null
        putMemoryAi(key, parsed)
        touchDiskIndex(key)
        return parsed
    }

    fun saveAiSession(
        sessionId: String,
        messages: List<ChatMessage>,
        sessionUpdatedAt: String?,
        sessionMessageCount: Int,
        beforeCursor: String?,
        hasMore: Boolean,
        isLocalWrite: Boolean = false
    ) {
        if (sessionId.isBlank() || messages.isEmpty()) return
        val settledMessages = messages.mapNotNull { msg ->
            if (msg.isStreaming && msg.content.isBlank() && msg.thinking.isBlank() && msg.toolCalls.isEmpty()) {
                null
            } else {
                msg.copy(isStreaming = false, statusText = null)
            }
        }
        if (settledMessages.isEmpty()) return

        val trimmed = settledMessages.size > maxMessagesPerSession
        val storedMessages = if (trimmed) settledMessages.takeLast(maxMessagesPerSession) else settledMessages
        val storedHasMore = if (trimmed) true else hasMore
        val storedCursor = if (trimmed) storedMessages.firstOrNull()?.id else beforeCursor

        val now = clockMs()
        val key = aiStorageKey(sessionId)
        val payload = CachedAiSessionPayload(
            sessionId = sessionId,
            sessionUpdatedAt = normalizeStamp(sessionUpdatedAt),
            sessionMessageCount = if (sessionMessageCount > 0) sessionMessageCount else storedMessages.size,
            beforeCursor = storedCursor?.takeIf { it.isNotBlank() },
            hasMore = storedHasMore && !storedCursor.isNullOrBlank(),
            syncedAtMs = now,
            localWriteAtMs = if (isLocalWrite) now else 0L,
            messages = storedMessages
        )
        putMemoryAi(key, payload)
        persistEntry(key, json.encodeToString(CachedAiSessionPayload.serializer(), payload))
    }

    fun removeAiSession(sessionId: String) {
        if (sessionId.isBlank()) return
        removeEntryByStorageKey(aiStorageKey(sessionId))
    }

    /**
     * After sending/receiving a reply locally, the server assigns a new `updatedAt`.
     * Align it once the next `/sessions` poll finishes so returning to the chat still hits cache.
     */
    fun reconcileAiSummaries(items: List<AiSessionSummary>) {
        if (items.isEmpty()) return
        val now = clockMs()
        for (summary in items) {
            if (summary.busy) continue
            val existing = getAiSession(summary.id) ?: continue
            if (existing.localWriteAtMs <= 0L) continue
            if (now - existing.localWriteAtMs > LOCAL_WRITE_RECONCILE_WINDOW_MS) continue
            val serverCount = summary.messageCount
            val countCompatible = serverCount <= 0 || serverCount <= existing.messages.size
            if (!countCompatible) continue
            val nextStamp = normalizeStamp(summary.updatedAt) ?: existing.sessionUpdatedAt
            val nextCount = if (serverCount > 0) serverCount else existing.sessionMessageCount
            if (nextStamp != existing.sessionUpdatedAt || nextCount != existing.sessionMessageCount) {
                val updated = existing.copy(
                    sessionUpdatedAt = nextStamp,
                    sessionMessageCount = nextCount,
                    localWriteAtMs = 0L
                )
                val key = aiStorageKey(summary.id)
                putMemoryAi(key, updated)
                persistEntry(key, json.encodeToString(CachedAiSessionPayload.serializer(), updated))
            }
        }
    }

    fun evaluateAiSession(
        summary: AiSessionSummary,
        lastSessionsSyncMs: Long,
        forceRefresh: Boolean = false
    ): AiSessionCacheEvaluation {
        val cached = getAiSession(summary.id)
        if (cached == null || cached.messages.isEmpty()) {
            return AiSessionCacheEvaluation(SessionCacheDecision.FETCH_WITH_SHIMMER, null)
        }
        if (forceRefresh || summary.busy) {
            return AiSessionCacheEvaluation(SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH, cached)
        }

        val summaryStamp = normalizeStamp(summary.updatedAt)
        val cachedStamp = normalizeStamp(cached.sessionUpdatedAt)
        val stampMatches = when {
            summaryStamp != null && cachedStamp != null -> summaryStamp == cachedStamp
            summaryStamp != null && cachedStamp == null -> false
            else -> true
        }
        val countMatches = if (summary.messageCount > 0 && cached.sessionMessageCount > 0) {
            summary.messageCount == cached.sessionMessageCount
        } else {
            true
        }

        if (!stampMatches || !countMatches) {
            return AiSessionCacheEvaluation(SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH, cached)
        }

        val now = clockMs()
        val sessionsFresh = lastSessionsSyncMs > 0L && (now - lastSessionsSyncMs) in 0L..SESSIONS_FRESH_WINDOW_MS
        val syncedRecently = cached.syncedAtMs > 0L && (now - cached.syncedAtMs) in 0L..CACHE_RECENT_SYNC_MS
        val isHistorical = isHistoricalIdle(summary.updatedAt ?: cached.sessionUpdatedAt, now)

        val decision = if (sessionsFresh || syncedRecently || isHistorical) {
            SessionCacheDecision.USE_CACHE_SKIP_NETWORK
        } else {
            SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH
        }
        return AiSessionCacheEvaluation(decision, cached)
    }

    fun getDesktopSession(stableKey: String): CachedDesktopSessionPayload? {
        if (stableKey.isBlank()) return null
        val key = desktopStorageKey(stableKey)
        desktopMemory[key]?.let {
            touchMemoryOrder(key)
            return it
        }
        val raw = storage.readText(key) ?: return null
        val parsed = runCatching {
            json.decodeFromString(CachedDesktopSessionPayload.serializer(), raw)
        }.getOrNull() ?: run {
            removeEntryByStorageKey(key)
            return null
        }
        if (parsed.stableKey != stableKey || parsed.rawItems.isEmpty()) return null
        putMemoryDesktop(key, parsed)
        touchDiskIndex(key)
        return parsed
    }

    fun saveDesktopSession(
        session: DesktopAgentSessionSummary,
        rawItems: List<DesktopAgentMessageItem>,
        beforeCursor: String?,
        hasMore: Boolean,
        available: Boolean,
        canSend: Boolean,
        canSteer: Boolean,
        selectedModel: String,
        reason: String?
    ) {
        if (session.stableKey.isBlank() || rawItems.isEmpty()) return
        val trimmed = rawItems.size > maxMessagesPerSession
        val storedItems = if (trimmed) rawItems.takeLast(maxMessagesPerSession) else rawItems
        val storedHasMore = if (trimmed) true else hasMore
        val storedCursor = if (trimmed) storedItems.firstOrNull()?.id else beforeCursor

        val key = desktopStorageKey(session.stableKey)
        val payload = CachedDesktopSessionPayload(
            stableKey = session.stableKey,
            provider = session.provider,
            sessionId = session.id,
            sessionUpdatedAt = normalizeStamp(session.updatedAt),
            sessionObservedAt = normalizeStamp(session.observedAt),
            beforeCursor = storedCursor?.takeIf { it.isNotBlank() },
            hasMore = storedHasMore && !storedCursor.isNullOrBlank(),
            available = available,
            canSend = canSend,
            canSteer = canSteer,
            selectedModel = selectedModel,
            reason = reason,
            syncedAtMs = clockMs(),
            rawItems = storedItems
        )
        putMemoryDesktop(key, payload)
        persistEntry(key, json.encodeToString(CachedDesktopSessionPayload.serializer(), payload))
    }

    fun removeDesktopSession(stableKey: String) {
        if (stableKey.isBlank()) return
        removeEntryByStorageKey(desktopStorageKey(stableKey))
    }

    fun evaluateDesktopSession(
        summary: DesktopAgentSessionSummary,
        lastSessionsSyncMs: Long,
        forceRefresh: Boolean = false
    ): DesktopSessionCacheEvaluation {
        val cached = getDesktopSession(summary.stableKey)
        if (cached == null || cached.rawItems.isEmpty()) {
            return DesktopSessionCacheEvaluation(SessionCacheDecision.FETCH_WITH_SHIMMER, null)
        }
        if (forceRefresh || summary.busy) {
            return DesktopSessionCacheEvaluation(SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH, cached)
        }

        val summaryStamp = normalizeStamp(summary.updatedAt) ?: normalizeStamp(summary.observedAt)
        val cachedStamp = normalizeStamp(cached.sessionUpdatedAt) ?: normalizeStamp(cached.sessionObservedAt)
        val stampMatches = when {
            summaryStamp != null && cachedStamp != null -> summaryStamp == cachedStamp
            summaryStamp != null && cachedStamp == null -> false
            else -> true
        }
        if (!stampMatches) {
            return DesktopSessionCacheEvaluation(SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH, cached)
        }

        val now = clockMs()
        val sessionsFresh = lastSessionsSyncMs > 0L && (now - lastSessionsSyncMs) in 0L..SESSIONS_FRESH_WINDOW_MS
        val syncedRecently = cached.syncedAtMs > 0L && (now - cached.syncedAtMs) in 0L..CACHE_RECENT_SYNC_MS
        val isHistorical = isHistoricalIdle(summary.updatedAt ?: cached.sessionUpdatedAt, now)

        val decision = if (sessionsFresh || syncedRecently || isHistorical) {
            SessionCacheDecision.USE_CACHE_SKIP_NETWORK
        } else {
            SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH
        }
        return DesktopSessionCacheEvaluation(decision, cached)
    }

    private fun isHistoricalIdle(timestampRaw: String?, nowMs: Long): Boolean {
        val parsed = SessionGrouping.parseTimestampMs(timestampRaw) ?: return false
        return (nowMs - parsed) >= HISTORICAL_IDLE_THRESHOLD_MS
    }

    private fun normalizeStamp(raw: String?): String? =
        raw?.trim()?.takeIf { it.isNotEmpty() }

    private fun putMemoryAi(key: String, value: CachedAiSessionPayload) {
        desktopMemory.remove(key)
        aiMemory[key] = value
        touchMemoryOrder(key)
    }

    private fun putMemoryDesktop(key: String, value: CachedDesktopSessionPayload) {
        aiMemory.remove(key)
        desktopMemory[key] = value
        touchMemoryOrder(key)
    }

    private fun touchMemoryOrder(key: String) {
        memoryOrder.remove(key)
        memoryOrder.add(key)
        while (memoryOrder.size > maxMemoryEntries) {
            val evicted = memoryOrder.removeAt(0)
            aiMemory.remove(evicted)
            desktopMemory.remove(evicted)
        }
    }

    private fun persistEntry(key: String, jsonText: String) {
        storage.writeText(key, jsonText)
        touchDiskIndex(key)
    }

    private fun loadScopeIndex(): MutableList<String> {
        diskIndexKeys?.let { return it }
        val raw = storage.readText(indexKeyForScope())
        val parsed = raw?.let {
            runCatching { json.decodeFromString(ConversationCacheIndex.serializer(), it) }.getOrNull()
        }
        val list = parsed?.storageKeys?.toMutableList() ?: mutableListOf()
        diskIndexKeys = list
        return list
    }

    private fun touchDiskIndex(key: String) {
        val index = loadScopeIndex()
        val alreadyLast = index.lastOrNull() == key
        if (!alreadyLast) {
            index.remove(key)
            index.add(key)
            while (index.size > maxPersistedSessions) {
                val evicted = index.removeAt(0)
                aiMemory.remove(evicted)
                desktopMemory.remove(evicted)
                memoryOrder.remove(evicted)
                storage.remove(evicted)
            }
            saveScopeIndex(index)
        }
    }

    private fun removeEntryByStorageKey(key: String) {
        aiMemory.remove(key)
        desktopMemory.remove(key)
        memoryOrder.remove(key)
        storage.remove(key)
        val index = loadScopeIndex()
        if (index.remove(key)) {
            saveScopeIndex(index)
        }
    }

    private fun saveScopeIndex(index: MutableList<String>) {
        storage.writeText(
            indexKeyForScope(),
            json.encodeToString(ConversationCacheIndex(storageKeys = index.toList()))
        )
    }

    private fun indexKeyForScope(): String = "idx_$currentScopeId"

    private fun aiStorageKey(sessionId: String): String =
        "${currentScopeId}_ai_${fnv1aHex(sessionId)}"

    private fun desktopStorageKey(stableKey: String): String =
        "${currentScopeId}_dk_${fnv1aHex(stableKey)}"

    private fun hashScope(baseUrl: String, username: String): String {
        val normUrl = DragonClawHelpers.normalizeBaseUrl(baseUrl).lowercase()
        val normUser = username.trim().lowercase()
        return fnv1aHex("$normUrl|$normUser")
    }

    private fun fnv1aHex(input: String): String {
        var hash = -0x340d631b7bdddcdbL // 0xcbf29ce484222325UL as signed Long
        val prime = 0x100000001b3L
        for (byte in input.encodeToByteArray()) {
            hash = hash xor (byte.toLong() and 0xffL)
            hash *= prime
        }
        val hexChars = "0123456789abcdef"
        val out = CharArray(16)
        var v = hash
        for (i in 15 downTo 0) {
            out[i] = hexChars[(v and 0xfL).toInt()]
            v = v ushr 4
        }
        return out.concatToString()
    }

    companion object {
        const val DEFAULT_MAX_PERSISTED_SESSIONS = 50
        const val DEFAULT_MAX_MEMORY_ENTRIES = 12
        const val DEFAULT_MAX_MESSAGES_PER_SESSION = 250
        const val SESSIONS_FRESH_WINDOW_MS = 5 * 60_000L
        const val CACHE_RECENT_SYNC_MS = 3 * 60_000L
        const val HISTORICAL_IDLE_THRESHOLD_MS = 30 * 60_000L
        const val LOCAL_WRITE_RECONCILE_WINDOW_MS = 30_000L
    }
}
