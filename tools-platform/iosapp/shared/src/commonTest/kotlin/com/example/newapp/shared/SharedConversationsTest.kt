package com.example.newapp.shared

import com.example.newapp.shared.model.*
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.SessionGrouping
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SharedConversationsTest {
    private fun events(raw: String): JsonArray = Json.parseToJsonElement(raw) as JsonArray

    @Test
    fun othersMessagesCarryTheirAccountAndAreNeverMergedAcrossAuthors() {
        val items = listOf(
            SessionMessageItem(id = "m1", role = "user", content = "我的问题"),
            SessionMessageItem(id = "m2", role = "model", content = "我的回答"),
            SessionMessageItem(id = "m3", role = "model", content = "张三的回答", events = events("""[{"type":"shared_author","author":"zhangsan","name":"张三"}]"""))
        )
        val mapped = DragonClawHelpers.mapStoredMessages(items)
        assertEquals(3, mapped.size, "two consecutive answers from different people stay separate")
        assertNull(mapped[1].sharedAuthor)
        assertEquals("zhangsan", mapped[2].sharedAuthor)
        assertEquals("张三", mapped[2].sharedAuthorName)
    }

    @Test
    fun sharedConversationsGetTheirOwnTopBucketIncludingOnesOutsideTheLoadedPage() {
        val ai = listOf(
            AiSessionSummary(id = "own", title = "普通对话", updatedAt = "2026-11-19 08:00:00"),
            AiSessionSummary(id = "local-copy", title = "共享副本", updatedAt = "2026-11-19 07:00:00", pinned = true)
        )
        val shared = listOf(
            SharedConversation(id = "s1", sessionId = "local-copy", title = "共享副本", unread = 2),
            SharedConversation(id = "s2", sessionId = "not-loaded", title = "更早的共享", updatedAt = "2026-11-01 08:00:00")
        )
        val groups = SessionGrouping.groupSidebarSessions(ai, emptyList(), "", nowEpochMs = 1_795_000_000_000L, shared = shared)
        assertEquals(SessionBucket.SHARED, groups.first().bucket)
        assertEquals(setOf("local-copy", "not-loaded"), groups.first().items.map { it.aiSession?.id }.toSet())
        assertEquals(2, groups.first().items.first { it.aiSession?.id == "local-copy" }.shared?.unread)
        assertTrue(groups.none { it.bucket != SessionBucket.SHARED && it.items.any { e -> e.isShared } })
    }

    @Test
    fun shareTitlesDropAttachmentLinksAndLinksResolveToTokens() {
        assertEquals("分析方案 拓扑图.png", DragonClawHelpers.cleanShareTitle("分析方案 [拓扑图.png](</tmp/a/拓扑图.png>)"))
        assertEquals("分析北美机房切换方案的风险点", DragonClawHelpers.cleanShareTitle("分析北美机房切换方案的风险点 [拓"))
        val accounts = listOf(ShareAccount("team10", "团队10"), ShareAccount("team2", "团队2"), ShareAccount("bob", "Bob"))
        assertEquals(listOf("bob", "team2", "team10"), DragonClawHelpers.sortShareAccounts(accounts, "", emptyList()).map { it.username })
        assertEquals(listOf("team2", "team10"), DragonClawHelpers.sortShareAccounts(accounts, "team", emptyList()).map { it.username })
    }
}
