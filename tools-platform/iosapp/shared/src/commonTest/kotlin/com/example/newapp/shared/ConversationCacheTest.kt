package com.example.newapp.shared

import com.example.newapp.shared.data.ConversationCacheManager
import com.example.newapp.shared.data.SessionCacheDecision
import com.example.newapp.shared.model.AiSessionSummary
import com.example.newapp.shared.model.ChatMessage
import com.example.newapp.shared.model.DesktopAgentMessageItem
import com.example.newapp.shared.model.DesktopAgentSessionSummary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class InMemoryTextCacheStorage : TextCacheStorage {
    val entries = mutableMapOf<String, String>()

    override fun readText(key: String): String? = entries[key]

    override fun writeText(key: String, value: String) {
        entries[key] = value
    }

    override fun remove(key: String) {
        entries.remove(key)
    }

    override fun clearAll() {
        entries.clear()
    }
}

class ConversationCacheTest {

    private fun sampleMessage(id: String, role: String = "user", text: String = "hello"): ChatMessage =
        ChatMessage(id = id, role = role, content = text)

    private fun sampleSummary(
        id: String = "sess_1",
        updatedAt: String = "2026-11-15T10:00:00Z",
        messageCount: Int = 2,
        busy: Boolean = false
    ): AiSessionSummary = AiSessionSummary(
        id = id,
        updatedAt = updatedAt,
        messageCount = messageCount,
        title = "Sample",
        busy = busy
    )

    @Test
    fun missReturnsFetchWithShimmerThenHitSkipsNetwork() {
        var now = 1_794_736_800_000L // ~2026-11-15 10:00Z
        val storage = InMemoryTextCacheStorage()
        val cache = ConversationCacheManager(storage = storage, clockMs = { now })
        cache.configureScope("https://cs.fanxiaolong.uk", "alice")

        val summary = sampleSummary()
        val miss = cache.evaluateAiSession(summary, lastSessionsSyncMs = now)
        assertEquals(SessionCacheDecision.FETCH_WITH_SHIMMER, miss.decision)
        assertNull(miss.cached)

        cache.saveAiSession(
            sessionId = "sess_1",
            messages = listOf(sampleMessage("m1"), sampleMessage("m2", "model", "world")),
            sessionUpdatedAt = summary.updatedAt,
            sessionMessageCount = summary.messageCount,
            beforeCursor = "m1",
            hasMore = true
        )

        now += 60_000L
        val hit = cache.evaluateAiSession(summary, lastSessionsSyncMs = now - 30_000L)
        assertEquals(SessionCacheDecision.USE_CACHE_SKIP_NETWORK, hit.decision)
        assertNotNull(hit.cached)
        assertEquals(2, hit.cached?.messages?.size)
        assertEquals("m1", hit.cached?.beforeCursor)
        assertTrue(hit.cached?.hasMore == true)
    }

    @Test
    fun historicalConversationSkipsNetworkEvenOnColdRestart() {
        var now = 1_794_736_800_000L
        val storage = InMemoryTextCacheStorage()
        val firstRun = ConversationCacheManager(storage = storage, clockMs = { now })
        firstRun.configureScope("https://cs.fanxiaolong.uk", "alice")

        // Old conversation from previous day (more than 30 min old)
        val oldSummary = sampleSummary(id = "old_1", updatedAt = "2026-11-10T08:00:00Z", messageCount = 4)
        firstRun.saveAiSession(
            sessionId = "old_1",
            messages = listOf(sampleMessage("m1"), sampleMessage("m2"), sampleMessage("m3"), sampleMessage("m4")),
            sessionUpdatedAt = oldSummary.updatedAt,
            sessionMessageCount = oldSummary.messageCount,
            beforeCursor = null,
            hasMore = false
        )

        // Simulate app cold relaunch days later before `/sessions` refresh completes (lastSessionsSyncMs = 0)
        now += 4 * 86_400_000L
        val relaunched = ConversationCacheManager(storage = storage, clockMs = { now })
        relaunched.configureScope("https://cs.fanxiaolong.uk", "alice")
        val eval = relaunched.evaluateAiSession(oldSummary, lastSessionsSyncMs = 0L)
        assertEquals(SessionCacheDecision.USE_CACHE_SKIP_NETWORK, eval.decision)
        assertEquals(4, eval.cached?.messages?.size)
    }

    @Test
    fun metadataChangeBusyOrForceRefreshTriggersBackgroundRefreshWithInstantCache() {
        var now = 1_794_736_800_000L
        val storage = InMemoryTextCacheStorage()
        val cache = ConversationCacheManager(storage = storage, clockMs = { now })
        cache.configureScope("https://cs.fanxiaolong.uk", "alice")

        val initial = sampleSummary(id = "s1", updatedAt = "2026-11-15T10:00:00Z", messageCount = 2)
        cache.saveAiSession(
            sessionId = "s1",
            messages = listOf(sampleMessage("m1"), sampleMessage("m2")),
            sessionUpdatedAt = initial.updatedAt,
            sessionMessageCount = initial.messageCount,
            beforeCursor = null,
            hasMore = false
        )

        val bumpedCount = initial.copy(updatedAt = "2026-11-15T10:05:00Z", messageCount = 4)
        val changedEval = cache.evaluateAiSession(bumpedCount, lastSessionsSyncMs = now)
        assertEquals(SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH, changedEval.decision)
        assertNotNull(changedEval.cached)

        val busyEval = cache.evaluateAiSession(initial.copy(busy = true), lastSessionsSyncMs = now)
        assertEquals(SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH, busyEval.decision)

        val forcedEval = cache.evaluateAiSession(initial, lastSessionsSyncMs = now, forceRefresh = true)
        assertEquals(SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH, forcedEval.decision)
    }

    @Test
    fun reconcileLocalWriteAdoptsNewServerStampWithoutReload() {
        var now = 1_794_736_800_000L
        val storage = InMemoryTextCacheStorage()
        val cache = ConversationCacheManager(storage = storage, clockMs = { now })
        cache.configureScope("https://cs.fanxiaolong.uk", "alice")

        cache.saveAiSession(
            sessionId = "s1",
            messages = listOf(sampleMessage("m1"), sampleMessage("m2", "model", "reply")),
            sessionUpdatedAt = "2026-11-15T09:50:00Z",
            sessionMessageCount = 2,
            beforeCursor = null,
            hasMore = false,
            isLocalWrite = true
        )

        now += 2_000L
        val refreshedSummary = sampleSummary(id = "s1", updatedAt = "2026-11-15T10:00:02Z", messageCount = 2)
        cache.reconcileAiSummaries(listOf(refreshedSummary))

        now += 20_000L
        val eval = cache.evaluateAiSession(refreshedSummary, lastSessionsSyncMs = now - 20_000L)
        assertEquals(SessionCacheDecision.USE_CACHE_SKIP_NETWORK, eval.decision)
    }

    @Test
    fun accountIsolationAndLruEvictionRespectLimits() {
        var now = 1_794_736_800_000L
        val storage = InMemoryTextCacheStorage()
        val cache = ConversationCacheManager(
            storage = storage,
            clockMs = { now },
            maxPersistedSessions = 2,
            maxMemoryEntries = 2
        )

        cache.configureScope("https://cs.fanxiaolong.uk", "alice")
        cache.saveAiSession("a1", listOf(sampleMessage("1")), "2026-11-15T08:00:00Z", 1, null, false)
        cache.saveAiSession("a2", listOf(sampleMessage("2")), "2026-11-15T08:01:00Z", 1, null, false)
        cache.saveAiSession("a3", listOf(sampleMessage("3")), "2026-11-15T08:02:00Z", 1, null, false)

        // maxPersistedSessions = 2 evicts oldest "a1"
        assertNull(cache.getAiSession("a1"))
        assertNotNull(cache.getAiSession("a2"))
        assertNotNull(cache.getAiSession("a3"))

        // Switch user -> must not leak alice's cache
        cache.configureScope("https://cs.fanxiaolong.uk", "bob")
        assertNull(cache.getAiSession("a2"))
        cache.saveAiSession("b1", listOf(sampleMessage("b")), "2026-11-15T08:03:00Z", 1, null, false)

        // Logout clears bob only, leaving alice untouched if still present (not clearing disk globally)
        cache.clearCurrentScope()
        assertNull(cache.getAiSession("b1"))
        cache.configureScope("https://cs.fanxiaolong.uk", "alice")
        assertNotNull(cache.getAiSession("a3"))
    }

    @Test
    fun desktopSessionCachingWorksConsistently() {
        var now = 1_794_736_800_000L
        val storage = InMemoryTextCacheStorage()
        val cache = ConversationCacheManager(storage = storage, clockMs = { now })
        cache.configureScope("https://cs.fanxiaolong.uk", "alice")

        val desktopSummary = DesktopAgentSessionSummary(
            id = "codex-1",
            provider = "codex",
            title = "Refactor cache",
            updatedAt = "2026-11-14T12:00:00Z",
            busy = false
        )
        assertEquals(
            SessionCacheDecision.FETCH_WITH_SHIMMER,
            cache.evaluateDesktopSession(desktopSummary, lastSessionsSyncMs = now).decision
        )

        cache.saveDesktopSession(
            session = desktopSummary,
            rawItems = listOf(DesktopAgentMessageItem(id = "d1", role = "user", content = "hi")),
            beforeCursor = null,
            hasMore = false,
            available = true,
            canSend = true,
            canSteer = false,
            selectedModel = "gpt-5",
            reason = null
        )

        val skip = cache.evaluateDesktopSession(desktopSummary, lastSessionsSyncMs = now)
        assertEquals(SessionCacheDecision.USE_CACHE_SKIP_NETWORK, skip.decision)
        assertEquals("gpt-5", skip.cached?.selectedModel)

        val changed = cache.evaluateDesktopSession(
            desktopSummary.copy(updatedAt = "2026-11-15T12:00:00Z"),
            lastSessionsSyncMs = now
        )
        assertEquals(SessionCacheDecision.USE_CACHE_BACKGROUND_REFRESH, changed.decision)
    }
}
