package com.example.newapp.shared

import com.example.newapp.shared.model.*
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.NdjsonStreamParser
import com.example.newapp.shared.util.SessionGrouping
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DragonClawHelpersTest {

    @Test
    fun parseNdjsonEventsCorrectly() {
        val start = NdjsonStreamParser.parseLine("""{"type":"start","sessionId":"sess_1"}""")
        assertEquals(StreamEventType.START, start?.type)
        assertEquals("sess_1", start?.sessionId)

        val thinking = NdjsonStreamParser.parseLine("""{"type":"thinking","delta":"Analyzing SLA..."}""")
        assertEquals(StreamEventType.THINKING, thinking?.type)
        assertEquals("Analyzing SLA...", thinking?.text)

        val delta = NdjsonStreamParser.parseLine("""data: {"type":"delta","delta":"Hello"}""")
        assertEquals(StreamEventType.DELTA, delta?.type)
        assertEquals("Hello", delta?.text)

        val toolStart = NdjsonStreamParser.parseLine("""{"type":"tool_start","callId":"c1","tool":"query_metrics","args":{"month":11}}""")
        assertEquals(StreamEventType.TOOL_START, toolStart?.type)
        assertEquals("query_metrics", toolStart?.toolName)
        assertEquals("c1", toolStart?.callId)

        val toolResult = NdjsonStreamParser.parseLine("""{"type":"tool_result","callId":"c1","tool":"query_metrics","ok":true,"summary":"12 rows","durationMs":42}""")
        assertEquals(StreamEventType.TOOL_RESULT, toolResult?.type)
        assertTrue(toolResult?.toolOk == true)
        assertEquals("12 rows", toolResult?.text)
        assertEquals(42L, toolResult?.durationMs)

        val done = NdjsonStreamParser.parseLine("""{"type":"done","reply":"Complete","sessionId":"sess_1","usage":{"inputTokens":120,"outputTokens":45},"model":{"id":"m1","name":"Gemini Pro"}}""")
        assertEquals(StreamEventType.DONE, done?.type)
        assertEquals("Complete", done?.text)
        assertEquals(120, done?.inputTokens)
        assertEquals(45, done?.outputTokens)
        assertEquals("Gemini Pro", done?.modelName)

        assertNull(NdjsonStreamParser.parseLine(""))
        assertNull(NdjsonStreamParser.parseLine("[DONE]"))
    }

    @Test
    fun parseErrorJsonAndFallback() {
        assertEquals(
            "Invalid username or password",
            DragonClawHelpers.parseErrorMessage(401, """{"error":"Invalid username or password"}""")
        )
        assertEquals(
            "Request failed (HTTP 502)",
            DragonClawHelpers.parseErrorMessage(502, "<html>Bad Gateway</html>")
        )
    }

    @Test
    fun groupSessionsByTimeBucket() {
        val nowMs = SessionGrouping.parseTimestampMs("2026-11-11 10:00:00")
        assertNotNull(nowMs)
        val sessions = listOf(
            AiSessionSummary(id = "today", updatedAt = "2026-11-11T08:00:00Z", title = "Today chat"),
            AiSessionSummary(id = "yesterday", updatedAt = "2026-11-10 22:00:00", title = "Yesterday chat"),
            AiSessionSummary(id = "week", updatedAt = "2026-11-06T12:00:00Z", title = "Week chat"),
            AiSessionSummary(id = "month", updatedAt = "2026-10-25T12:00:00Z", title = "Month chat"),
            AiSessionSummary(id = "older", updatedAt = "2026-08-01T12:00:00Z", title = "Older chat")
        )
        val grouped = SessionGrouping.groupSessions(sessions, nowMs)
        assertEquals(5, grouped.size)
        assertEquals(SessionBucket.TODAY, grouped[0].bucket)
        assertEquals(SessionBucket.YESTERDAY, grouped[1].bucket)
        assertEquals(SessionBucket.LAST_7_DAYS, grouped[2].bucket)
        assertEquals(SessionBucket.LAST_30_DAYS, grouped[3].bucket)
        assertEquals(SessionBucket.OLDER, grouped[4].bucket)
    }

    @Test
    fun mergeToolCatalogKeepsNativeAndOverridesRemote() {
        val remote = listOf(
            CustomToolDto(slug = "report", href = "/report", name = "定制报表", nameEn = "Custom Report", updatedAt = "2026-11-11"),
            CustomToolDto(slug = "ops-bot", name = "值守助手", nameEn = "Ops Bot", description = "值班巡检")
        )
        val merged = ToolCatalogMerger.merge(remote)
        assertTrue(merged.first().isNative)
        assertEquals("native://kpi-monitor", merged.first().routePath)
        val report = merged.first { it.routePath == "/report" }
        assertEquals("定制报表", report.titleZh)
        assertEquals("2026-11-11", report.updatedAt)
        val custom = merged.first { it.routePath == "/ops-bot" }
        assertEquals(ToolCategory.CUSTOM, custom.category)
    }

    @Test
    fun appendUploadedFilesFormatsCleanly() {
        val out = DragonClawHelpers.appendUploadedFilesPrompt(
            "帮我分析表格",
            listOf(UploadedFileInfo(path = "/tmp/ai/demo.xlsx", name = "demo.xlsx", size = 1024)),
            "zh"
        )
        assertTrue(out.contains("帮我分析表格"))
        assertTrue(out.contains("/tmp/ai/demo.xlsx"))
    }

    @Test
    fun decodeP1ModelsLeniently() {
        val json = DragonClawHelpers.lenientJson
        val speech = json.decodeFromString<SpeechRecognitionResponse>(
            """{"text":"查看今天工单趋势","degraded":false,"source":{"id":"gemini","label":"Gemini","location":"cloud"}}"""
        )
        assertEquals("查看今天工单趋势", speech.text)
        assertEquals("gemini", speech.source?.id)

        val skills = json.decodeFromString<AgentSkillsResponse>(
            """{"items":[{"id":"sla-audit","name":"SLA 核查","nameEn":"SLA Audit","description":"核查逾期工单","builtIn":true}]}"""
        )
        assertEquals(1, skills.items.size)
        assertEquals("SLA Audit", skills.items.first().localizedName("en"))
        assertEquals("SLA 核查", skills.items.first().localizedName("zh"))

        val compact = json.decodeFromString<CompactSessionResponse>(
            """{"performed":true,"beforeChars":12000,"afterChars":1800,"retainedRecentMessages":2}"""
        )
        assertTrue(compact.performed)
        assertEquals(1800, compact.afterChars)

        val schedules = json.decodeFromString<SchedulesResponse>(
            """{"items":[{"id":"sch_1","instruction":"每天早上9点汇报SLA","kind":"recurring","status":"active","runCount":3}],"active":1}"""
        )
        assertEquals(1, schedules.active)
        assertEquals("sch_1", schedules.items.first().id)

        val nav = json.decodeFromString<NavToolIdsResponse>("""{"ids":["native-kpi-monitor","report"]}""")
        assertEquals(listOf("native-kpi-monitor", "report"), nav.ids)
    }

    @Test
    fun serializeChatRequestEncodesStreamDefaultsAndParsesArchivedSnakeCase() {
        val json = DragonClawHelpers.lenientJson
        val reqBody = json.encodeToString(
            ChatStreamRequest.serializer(),
            ChatStreamRequest(
                messages = listOf(ChatHistoryMessageDto(role = "user", content = "1+1"))
            )
        )
        assertTrue(reqBody.contains(""""stream":true"""))
        assertTrue(reqBody.contains(""""agent":"dragon-claw-home""""))

        // Non-streaming JSON fallback returned if a proxy omits NDJSON framing
        val directReply = NdjsonStreamParser.parseLine(
            """{"reply":"2","sessionId":"sess_2","usage":{"inputTokens":10,"outputTokens":2},"model":"gemini-3.1-flash-lite"}"""
        )
        assertEquals(StreamEventType.DONE, directReply?.type)
        assertEquals("2", directReply?.text)
        assertEquals("sess_2", directReply?.sessionId)
        assertEquals(2, directReply?.outputTokens)
        assertEquals("gemini-3.1-flash-lite", directReply?.modelName)

        // Archived sessions endpoint historically returned snake_case fields without "title"
        val archived = json.decodeFromString<AiSessionsResponse>(
            """{"items":[{"id":"s_arc","is_archived":1,"message_count":4,"created_at":"2026-11-10T10:00:00Z","updated_at":"2026-11-10T11:00:00Z","last_question":"排查埃及SLA延迟原因"}]}"""
        )
        val firstArchived = archived.items.first()
        assertTrue(firstArchived.isArchivedSession)
        assertEquals(4, firstArchived.messageCount)
        assertEquals("排查埃及SLA延迟原因", firstArchived.displayTitle("zh"))

        // Unified sidebar grouping merges active AI & desktop agent sessions cleanly
        val desktopRes = json.decodeFromString<DesktopAgentsSessionsResponse>(
            """{"items":[{"id":"uuid-1","provider":"codex","title":"修复登录闪烁","updatedAt":"2026-11-11T09:00:00Z","busy":true}]}"""
        )
        val nowMs = SessionGrouping.parseTimestampMs("2026-11-11T10:00:00Z")!!
        val unified = SessionGrouping.groupSidebarSessions(
            aiSessions = listOf(
                firstArchived,
                AiSessionSummary(id = "ai_1", updatedAt = "2026-11-11T08:00:00Z", title = "SLA 早报", discussionMode = "group")
            ),
            desktopSessions = desktopRes.items,
            nowEpochMs = nowMs
        )
        assertEquals(1, unified.size)
        assertEquals(2, unified.first().items.size)
        assertEquals("Codex", unified.first().items[0].badgeLabel("zh"))
        assertEquals("群聊", unified.first().items[1].badgeLabel("zh"))
    }
}
