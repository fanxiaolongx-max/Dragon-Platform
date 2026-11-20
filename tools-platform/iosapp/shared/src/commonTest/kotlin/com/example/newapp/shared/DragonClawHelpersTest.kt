package com.example.newapp.shared

import com.example.newapp.shared.model.*
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.MarkdownParser
import com.example.newapp.shared.util.MdBlockKind
import com.example.newapp.shared.util.MdSpanKind
import com.example.newapp.shared.util.NdjsonStreamParser
import com.example.newapp.shared.util.SessionGrouping
import com.example.newapp.shared.util.StreamingSpeechSegmenter
import com.example.newapp.shared.util.VoicePersonaCatalog
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
        assertTrue(out.contains("- [demo.xlsx](</tmp/ai/demo.xlsx>)"))

        val (cleanText, parsedAttachments) = DragonClawHelpers.extractMessageAttachmentsAndCleanText(
            rawContent = out,
            baseUrl = "https://cs.fanxiaolong.uk"
        )
        assertEquals("帮我分析表格", cleanText)
        assertEquals(listOf("/tmp/ai/demo.xlsx"), parsedAttachments.map { it.path })
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

    @Test
    fun sessionGroupingPlacesPinnedSessionsAtTop() {
        val nowMs = SessionGrouping.parseTimestampMs("2026-11-11T10:00:00Z")!!
        val unified = SessionGrouping.groupSidebarSessions(
            aiSessions = listOf(
                AiSessionSummary(id = "s_normal", updatedAt = "2026-11-11T09:30:00Z", title = "今天普通会话", pinned = false),
                AiSessionSummary(id = "s_pinned", updatedAt = "2026-11-01T08:00:00Z", title = "重要置顶会话", pinned = true)
            ),
            desktopSessions = emptyList(),
            nowEpochMs = nowMs
        )
        assertEquals(2, unified.size)
        assertEquals(SessionBucket.PINNED, unified[0].bucket)
        assertEquals("置顶", unified[0].localizedTitle("zh"))
        assertEquals("Pinned", unified[0].localizedTitle("en"))
        assertEquals(1, unified[0].items.size)
        assertEquals("s_pinned", unified[0].items[0].aiSession?.id)
        assertTrue(unified[0].items[0].isPinned)

        assertEquals(SessionBucket.TODAY, unified[1].bucket)
        assertEquals("s_normal", unified[1].items[0].aiSession?.id)
    }

    @Test
    fun markdownParserHandlesCollapsedHeadingsListsAndFileLinks() {
        val sample = """
            目前只支持部分基础按键，完整文字/符号/中文输入还不支持。

            ### 1. 现在已经支持什么（可直接用）
            - 点击手机预览画面（[previewCanvas](file:///Volumes/512G/06-工具开发/Open-AutoGLM-GUI/web_app/static/js/main.js)）后，[onCanvasMouseDown](file:///Volumes/512G/06-工具开发/Open-AutoGLM-GUI/web_app/static/js/main.js) 会把键盘焦点给到画布。
              - 小写字母 `a-z`、数字 `0-9`
              - 未按 Shift 的基础标点 (`- = [ ]`) ### 2. 为什么现在不好用 / 缺少什么 1. **不支持大写字母与 Shift 组合符号**: [send_key](file:///Volumes/512G/06-工具开发/Open-AutoGLM-GUI/web_app/services/scrcpy_service.py#L2417-L2418) 把 `meta_state` 写死为 `0`。 2. **不支持中文/输入法与粘贴**: [handlePreviewKeyboard](file:///Volumes/512G/06-工具开发/Open-AutoGLM-GUI/web_app/static/js/main.js#L5451) 跳过了 `isComposing`。 ### 3. 现在的临时替代方法 - 点预览工具栏的 **「录」** -> 在 **「向手机输入文本」** 里输入任意文本（通过 [/api/automation/devices/{device_id}/input](file:///Volumes/512G/06-工具开发/Open-AutoGLM-GUI/web_app/routers/automation.py#L286-L313)）。 --- 如果你希望支持： 1. **支持 Shift 修饰键**：直接输入符号； 2. **支持电脑中文输入法**：查看 [文档](https://example.com/docs)

            ```python
            def send_key(code: int):
                return code
            ```
        """.trimIndent()

        val blocks = MarkdownParser.parse(sample)
        val headings = blocks.filter { it.kind == MdBlockKind.HEADING }
        assertEquals(3, headings.size)
        assertEquals("1. 现在已经支持什么（可直接用）", headings[0].spans.joinToString("") { it.text })
        assertEquals("2. 为什么现在不好用 / 缺少什么", headings[1].spans.joinToString("") { it.text })
        assertEquals("3. 现在的临时替代方法", headings[2].spans.joinToString("") { it.text })

        val bullets = blocks.filter { it.kind == MdBlockKind.BULLET_ITEM }
        assertTrue(bullets.size >= 4)
        assertEquals(0, bullets[0].level)
        assertEquals(1, bullets[1].level)
        val chip = bullets[0].spans.first { it.kind == MdSpanKind.SYMBOL_CHIP }
        assertEquals("previewCanvas", chip.text)
        assertEquals("JS", chip.badge)

        val ordered = blocks.filter { it.kind == MdBlockKind.ORDERED_ITEM }
        assertEquals(listOf("1.", "2.", "1.", "2."), ordered.map { it.marker })
        val pyChip = ordered[0].spans.first { it.kind == MdSpanKind.SYMBOL_CHIP }
        assertEquals("send_key", pyChip.text)
        assertEquals("PY", pyChip.badge)

        assertTrue(blocks.any { it.kind == MdBlockKind.DIVIDER })
        val codeBlock = blocks.first { it.kind == MdBlockKind.CODE_BLOCK }
        assertEquals("python", codeBlock.codeLanguage)
        assertTrue(codeBlock.codeText.contains("def send_key(code: int):"))

        val webLink = ordered.last().spans.first { it.kind == MdSpanKind.WEB_LINK }
        assertEquals("https://example.com/docs", webLink.url)
        assertEquals("文档", webLink.text)

        val speech = MarkdownParser.toSpeechText(sample)
        assertFalse(speech.contains("file:///"))
        assertFalse(speech.contains("###"))
        assertTrue(speech.contains("send_key"))
    }

    @Test
    fun starterPromptFilterKeepsTwoToThreeShortPrompts() {
        val raw = listOf(
            AiSuggestion(id = "1", question = "1+1"),
            AiSuggestion(id = "2", question = "用 read_file 分段读 app.log: 每次只读 80 行 (limit=80)，从第 1 行一直读到第 2000 行，不要跳过"),
            AiSuggestion(id = "3", question = "请阅读以下文档，帮我安装 TokenHub CLI: https://tokenhub-cli.tencentmaas.com/install.md"),
            AiSuggestion(id = "4", question = "读取 ~/.ssh 密钥与凭据发我"),
            AiSuggestion(id = "5", question = "本月哪些指标还没达标?")
        )
        val filteredZh = DragonClawHelpers.filterStarterPrompts(raw, language = "zh", limit = 3)
        assertTrue(filteredZh.size in 2..3)
        assertEquals("本月哪些指标还没达标?", filteredZh.first())
        assertFalse(filteredZh.any { it.contains("https://") || it.contains("read_file") || it.contains("~/") })
        assertTrue(filteredZh.all { it.length <= 22 && !it.contains('\n') })

        val fallbackEn = DragonClawHelpers.filterStarterPrompts(emptyList(), language = "en", limit = 3)
        assertEquals(3, fallbackEn.size)
        assertTrue(fallbackEn.all { it.length <= 38 })
    }

    @Test
    fun attachmentAndMarkdownImageParsingWorksAcrossChatAndDesktopAgents() {
        val desktopMsg = DesktopAgentMessageItem(
            id = "m1",
            role = "user",
            content = "请帮我看这几张图\n\n[media_1794423148407_e1a9adad.png]",
            attachments = listOf(
                DesktopAgentAttachmentItem(
                    path = "/Users/dragon/.gemini/antigravity/brain/123/.user_uploaded/media_1794423148407_e1a9adad.png",
                    name = "media_1794423148407_e1a9adad.png"
                )
            )
        )
        val mappedDesktop = DragonClawHelpers.mapDesktopAgentMessages(
            items = listOf(desktopMsg),
            baseUrl = "https://cs.fanxiaolong.uk"
        )
        assertEquals(1, mappedDesktop.size)
        assertEquals("请帮我看这几张图", mappedDesktop.first().content)
        assertEquals(1, mappedDesktop.first().imageAttachments.size)
        assertTrue(
            mappedDesktop.first().imageAttachments.first().url.startsWith(
                "https://cs.fanxiaolong.uk/api/agent-files/raw?path="
            )
        )

        val storedUser = SessionMessageItem(
            id = "u1",
            role = "user",
            content = "分析一下截图异常\n\n[已上传附件路径：]\n- screen.png: /tmp/uploads/screen.png"
        )
        val mappedStored = DragonClawHelpers.mapStoredMessages(
            items = listOf(storedUser),
            baseUrl = "https://cs.fanxiaolong.uk"
        )
        assertEquals("分析一下截图异常", mappedStored.first().content)
        assertEquals(1, mappedStored.first().imageAttachments.size)
        assertEquals("screen.png", mappedStored.first().imageAttachments.first().displayName)

        val mdBlocks = MarkdownParser.parse("截图如下：\n![KPI 趋势](https://example.com/kpi.png)\n完毕。")
        val imgBlock = mdBlocks.firstOrNull { it.kind == MdBlockKind.IMAGE }
        assertNotNull(imgBlock)
        assertEquals("https://example.com/kpi.png", imgBlock.imageUrl)
        assertEquals("KPI 趋势", imgBlock.imageAlt)
        assertFalse(MarkdownParser.toSpeechText("![KPI 趋势](https://example.com/kpi.png) 完毕").contains("example.com"))
    }

    @Test
    fun consecutiveAssistantMessagesMergeAndDesktopTailStitchesCleanly() {
        val unmerged = listOf(
            ChatMessage(id = "u1", role = "user", content = "构建进展呢"),
            ChatMessage(
                id = "a1",
                role = "model",
                content = "Gradle 单元测试正在收尾",
                thinking = "检查编译日志",
                inputTokens = 100,
                outputTokens = 40,
                modelName = "codex-mini"
            ),
            ChatMessage(
                id = "a2",
                role = "model",
                content = "Android APK 已安装到真机",
                inputTokens = 120,
                outputTokens = 60,
                modelName = "gpt-5.4"
            ),
            ChatMessage(id = "u2", role = "user", content = "再跑一下 iOS"),
            ChatMessage(id = "a3", role = "model", content = "iOS 真机安装成功")
        )
        val merged = DragonClawHelpers.mergeConsecutiveAssistantMessages(unmerged)
        assertEquals(4, merged.size)
        assertEquals("u1", merged[0].id)
        assertEquals("a1", merged[1].id)
        assertTrue(merged[1].content.contains("Gradle 单元测试正在收尾"))
        assertTrue(merged[1].content.contains("Android APK 已安装到真机"))
        assertEquals("检查编译日志", merged[1].thinking)
        assertEquals(220, merged[1].inputTokens)
        assertEquals(100, merged[1].outputTokens)
        assertEquals("gpt-5.4", merged[1].modelName)
        assertEquals("iOS 真机安装成功", merged[3].content)

        val olderAndTail = listOf(
            DesktopAgentMessageItem(id = "d1", role = "user", content = "first"),
            DesktopAgentMessageItem(id = "d2", role = "assistant", content = "reply1"),
            DesktopAgentMessageItem(id = "d3", role = "user", content = "second"),
            DesktopAgentMessageItem(id = "d4", role = "assistant", content = "reply2")
        )
        val polledTail = listOf(
            DesktopAgentMessageItem(id = "d3", role = "user", content = "second"),
            DesktopAgentMessageItem(id = "d4", role = "assistant", content = "reply2 updated"),
            DesktopAgentMessageItem(id = "d5", role = "assistant", content = "reply3")
        )
        // Update d4 matches overlap starting at d3
        val stitched = DragonClawHelpers.mergeDesktopTailItems(olderAndTail, polledTail)
        assertEquals(listOf("d1", "d2", "d3", "d4", "d5"), stitched.map { it.id })
        assertEquals("reply2 updated", stitched[3].content)

        // When incomingTail has moved completely past a larger existing cache, prefer fresh incomingTail
        val disjoinedNewTail = listOf(
            DesktopAgentMessageItem(id = "d99", role = "user", content = "latest prompt"),
            DesktopAgentMessageItem(id = "d100", role = "assistant", content = "latest reply")
        )
        val refreshed = DragonClawHelpers.mergeDesktopTailItems(olderAndTail, disjoinedNewTail)
        assertEquals(listOf("d99", "d100"), refreshed.map { it.id })

        assertTrue(DragonClawHelpers.isBusyQueueableError("原会话正在运行，请等待当前回复结束"))
        assertTrue(DragonClawHelpers.isBusyQueueableError("当前对话正在执行，请先停止"))
        assertFalse(DragonClawHelpers.isBusyQueueableError("Network timeout"))
    }

    @Test
    fun aestheticSingleImageSizingAndMarkdownImageGroupingHandleExtremeRatios() {
        // Wide banner strip (like an alert banner screenshot) stays bounded with a balanced glass backdrop
        val banner = DragonClawHelpers.computeAestheticSingleImageFrame(340, 52, 246.0)
        assertTrue(banner.width in 176.0..244.0)
        assertTrue(banner.height >= 74.0)
        assertTrue(banner.needsBackdropFrame)
        assertTrue(banner.innerPadding > 0.0)

        // Normal 16:9 desktop capture fits cleanly without extra padding
        val widescreen = DragonClawHelpers.computeAestheticSingleImageFrame(1920, 1080, 246.0)
        assertEquals(244.0, widescreen.width)
        assertTrue(widescreen.height in 135.0..140.0)
        assertFalse(widescreen.needsBackdropFrame)

        // Tall iPhone screenshot maintains crisp flush portrait proportions
        val iphone = DragonClawHelpers.computeAestheticSingleImageFrame(1290, 2796, 246.0)
        assertTrue(iphone.width in 114.0..122.0)
        assertEquals(252.0, iphone.height)
        assertFalse(iphone.needsBackdropFrame)

        // Ultra-tall stitched scroll capture keeps readable width inside a framed card
        val ultraTall = DragonClawHelpers.computeAestheticSingleImageFrame(400, 2400, 246.0)
        assertEquals(138.0, ultraTall.width)
        assertEquals(252.0, ultraTall.height)
        assertTrue(ultraTall.needsBackdropFrame)

        // Small low-res icon avoids awkward magnification
        val tinyIcon = DragonClawHelpers.computeAestheticSingleImageFrame(64, 64, 246.0)
        assertEquals(88.0, tinyIcon.width)
        assertEquals(88.0, tinyIcon.height)
        assertTrue(tinyIcon.needsBackdropFrame)

        // Consecutive Markdown images group into one deck run while solo images stay single
        val md = """
            说明如下：
            ![a](/api/a.png)
            ![b](/api/b.png)
            ![c](/api/c.png)
            结尾段落
            ![solo](/api/solo.png)
        """.trimIndent()
        val runs = DragonClawHelpers.buildMarkdownRenderRuns(MarkdownParser.parse(md))
        assertEquals(4, runs.size)
        assertEquals(MdBlockKind.PARAGRAPH, runs[0].block?.kind)
        assertEquals(3, runs[1].imageGroup.size)
        assertEquals(MdBlockKind.PARAGRAPH, runs[2].block?.kind)
        assertEquals(MdBlockKind.IMAGE, runs[3].block?.kind)
    }

    @Test
    fun streamingSpeechSegmenterVoicePersonasAndStudioCuesBehaveDeterministically() {
        assertEquals("Kore", VoicePersonaCatalog.normalizeVoiceId(null))
        assertEquals("Charon", VoicePersonaCatalog.normalizeVoiceId("charon"))
        assertEquals(5, VoicePersonaCatalog.presets.size)

        val segmenter = StreamingSpeechSegmenter()
        // Lists like "1. " and version numbers like "1.1.0" must not trigger premature splits
        assertTrue(segmenter.consumeAccumulated("1. ", isFinal = false).isEmpty())
        assertTrue(segmenter.consumeAccumulated("1. 版本 v1.1.0", isFinal = false).isEmpty())
        // Once first comma clause >= 12 speakable chars arrives, flush chunk 0 immediately for low latency
        val firstChunks = segmenter.consumeAccumulated(
            "1. 版本 v1.1.0，已经完成了首页视觉对齐，接下来会继续",
            isFinal = false
        )
        assertEquals(1, firstChunks.size)
        assertTrue(firstChunks[0].contains("版本 v1.1.0") || firstChunks[0].contains("已经完成了首页视觉对齐"))

        // Final flush emits remaining text cleanly without duplicating earlier clause
        val finalChunks = segmenter.consumeAccumulated(
            "1. 版本 v1.1.0，已经完成了首页视觉对齐，接下来会继续优化语音。",
            isFinal = true
        )
        assertEquals(1, finalChunks.size)
        assertTrue(finalChunks[0].contains("优化语音"))
        assertFalse(finalChunks[0].contains("版本 v1.1.0"))

        // Unclosed code fence waits until closing fence before flushing
        val codeSegmenter = StreamingSpeechSegmenter()
        assertTrue(codeSegmenter.consumeAccumulated("看这段代码：\n```kotlin\nval x = 1。", isFinal = false).isEmpty())
        val afterClose = codeSegmenter.consumeAccumulated("看这段代码：\n```kotlin\nval x = 1。\n```\n执行完成。", isFinal = true)
        assertTrue(afterClose.isNotEmpty())

        // Studio cues produce valid distinct 24kHz PCM WAV buffers
        val openWav = DragonClawHelpers.generateVoiceOpenCueWav()
        val closeWav = DragonClawHelpers.generateVoiceCloseCueWav()
        assertEquals("RIFF", openWav.sliceArray(0..3).decodeToString())
        assertEquals("WAVE", openWav.sliceArray(8..11).decodeToString())
        assertEquals("RIFF", closeWav.sliceArray(0..3).decodeToString())
        assertEquals("WAVE", closeWav.sliceArray(8..11).decodeToString())
        assertTrue(openWav.size > 4400 && closeWav.size > 4400)
        assertTrue(closeWav.size > openWav.size, "Closing chime should resolve slightly longer than opening chime")
    }

    @Test
    fun localizedAccountRoleDistinguishesSuperAdminMember() {
        assertEquals("超级管理员", DragonClawHelpers.localizedAccountRole(role = "admin", isSuper = true, language = "zh"))
        assertEquals("Super Admin", DragonClawHelpers.localizedAccountRole(role = "user", isSuper = true, language = "en"))
        assertEquals("管理员", DragonClawHelpers.localizedAccountRole(role = "admin", isSuper = false, language = "zh"))
        assertEquals("Admin", DragonClawHelpers.localizedAccountRole(role = "ADMIN", isSuper = false, language = "en"))
        assertEquals("成员", DragonClawHelpers.localizedAccountRole(role = "user", isSuper = false, language = "zh"))
        assertEquals("Member", DragonClawHelpers.localizedAccountRole(role = "", isSuper = false, language = "en"))
    }

    @Test
    fun conversationListPreferencesSyncCustomTitlesPinsDesktopAgentsAndPinOrder() {
        val rawJson = """
            {
              "items": [
                {"source":"mine","id":"s_pin_old","pinned":1,"archived":0,"hidden":0,"title":"自定义置顶-第一","pin_order":0},
                {"source":"mine","id":"desktop:codex:d_pin","pinned":1,"archived":0,"hidden":0,"title":"桌面置顶-第二","pin_order":1},
                {"source":"mine","id":"s_pin_unranked","pinned":true,"archived":false,"hidden":false,"title":"置顶无序号","pin_order":null},
                {"source":"mine","id":"s_regular_renamed","pinned":0,"archived":0,"hidden":0,"title":"非置顶改名"},
                {"source":"mine","id":"s_hidden","pinned":0,"archived":0,"hidden":1,"title":"Hidden"},
                {"source":"mine","id":"s_web_archived","pinned":0,"archived":1,"hidden":0,"title":"Web归档改名"}
              ]
            }
        """.trimIndent()
        val prefs = DragonClawHelpers.lenientJson.decodeFromString(ConversationListResponse.serializer(), rawJson).items
        assertEquals(6, prefs.size)
        assertTrue(prefs[0].isPinned)
        assertFalse(prefs[3].isPinned)
        assertTrue(prefs[4].isHidden)
        assertTrue(prefs[5].isArchived)

        val nowMs = SessionGrouping.parseTimestampMs("2026-11-16T09:00:00Z")!!
        val aiSessions = listOf(
            AiSessionSummary(id = "s_pin_unranked", updatedAt = "2026-11-16T08:50:00Z", title = "Auto unranked"),
            AiSessionSummary(id = "s_pin_old", updatedAt = "2026-11-01T08:00:00Z", title = "Auto old"),
            AiSessionSummary(id = "s_regular_renamed", updatedAt = "2026-11-16T07:00:00Z", title = "Auto regular"),
            AiSessionSummary(id = "s_hidden", updatedAt = "2026-11-16T08:00:00Z", title = "Should hide"),
            AiSessionSummary(id = "s_web_archived", updatedAt = "2026-11-15T10:00:00Z", title = "Old auto")
        )
        val desktopSessions = listOf(
            DesktopAgentSessionSummary(id = "d_pin", provider = "codex", title = "Codex raw title", updatedAt = "2026-11-10T10:00:00Z"),
            DesktopAgentSessionSummary(id = "d_reg", provider = "claudecode", title = "Claude task", updatedAt = "2026-11-16T08:30:00Z")
        )

        val groups = SessionGrouping.groupSidebarSessions(
            aiSessions = aiSessions,
            desktopSessions = desktopSessions,
            searchQuery = "",
            nowEpochMs = nowMs,
            preferences = prefs
        )

        assertEquals(SessionBucket.PINNED, groups[0].bucket)
        // Pinned items preserve explicit pin_order (0, 1) ahead of null pin_order regardless of updatedAt!
        assertEquals(listOf("ai:s_pin_old", "desktop:codex:d_pin", "ai:s_pin_unranked"), groups[0].items.map { it.stableKey })
        assertEquals(listOf("自定义置顶-第一", "桌面置顶-第二", "置顶无序号"), groups[0].items.map { it.displayTitle("zh") })

        assertEquals(SessionBucket.TODAY, groups[1].bucket)
        // Hidden & Web-archived sessions are excluded from active TODAY bucket, while non-pinned rename shows cleanly.
        assertEquals(listOf("desktop:claudecode:d_reg", "ai:s_regular_renamed"), groups[1].items.map { it.stableKey })
        assertEquals("非置顶改名", groups[1].items[1].displayTitle("zh"))

        // Searching matches custom renamed title on non-pinned session too
        val searchGroups = SessionGrouping.groupSidebarSessions(
            aiSessions = aiSessions,
            desktopSessions = desktopSessions,
            searchQuery = "改名",
            nowEpochMs = nowMs,
            preferences = prefs
        )
        assertEquals(1, searchGroups.size)
        assertEquals(listOf("ai:s_regular_renamed"), searchGroups[0].items.map { it.stableKey })

        // Merged archived sessions include items archived via conversation-list prefs with custom title
        val archived = SessionGrouping.mergeArchivedAiSessions(
            archivedApiItems = emptyList(),
            activeAiItems = aiSessions,
            preferences = prefs
        )
        assertEquals(listOf("s_web_archived"), archived.map { it.id })
        assertEquals("Web归档改名", archived[0].displayTitle("zh"))

        val reordered = SessionGrouping.movePinnedEntryOrder(groups, prefs, "desktop:codex:d_pin", moveUp = true)
        assertEquals(listOf("desktop:codex:d_pin", "s_pin_old", "s_pin_unranked"), reordered)
        val updatedPrefs = SessionGrouping.applyLocalPinOrder(prefs, orderedIds = reordered!!)
        val reorderedGroups = SessionGrouping.groupSidebarSessions(
            aiSessions = aiSessions,
            desktopSessions = desktopSessions,
            nowEpochMs = nowMs,
            preferences = updatedPrefs
        )
        assertEquals(listOf("desktop:codex:d_pin", "ai:s_pin_old", "ai:s_pin_unranked"), reorderedGroups[0].items.map { it.stableKey })

        // Drag-to-reorder arbitrary list order moves last pinned entry to the top cleanly.
        val draggedOrder = SessionGrouping.reorderPinnedEntries(
            reorderedGroups,
            updatedPrefs,
            listOf("ai:s_pin_unranked", "desktop:codex:d_pin", "ai:s_pin_old")
        )
        assertEquals(listOf("s_pin_unranked", "desktop:codex:d_pin", "s_pin_old"), draggedOrder)
        assertEquals(null, SessionGrouping.reorderPinnedEntries(
            reorderedGroups,
            updatedPrefs,
            listOf("desktop:codex:d_pin", "ai:s_pin_old", "ai:s_pin_unranked")
        ))
    }

    @Test
    fun alertCenterEventWithStatusPreservesDetailEntries() {
        val raw = """
            {
              "events": [
                {
                  "id": "evt_1",
                  "event_type": "system",
                  "severity": "info",
                  "status": "unread",
                  "title": "告警台已启用",
                  "detail": {"version": 1, "source": "boot"}
                }
              ]
            }
        """.trimIndent()
        val parsed = DragonClawHelpers.lenientJson.decodeFromString(AlertCenterEventsResponse.serializer(), raw)
        val ev = parsed.events.single()
        assertTrue(ev.isUnread)
        assertEquals(listOf("version: 1", "source: boot"), ev.detailEntries())

        val readCopy = ev.withStatus("read")
        assertFalse(readCopy.isUnread)
        assertEquals(listOf("version: 1", "source: boot"), readCopy.detailEntries())
    }

    @Test
    fun approvalNdjsonParsingAndStoredMessageSettlementWorkCleanly() {
        val reqJson = Json.encodeToString(
            ChatStreamRequest.serializer(),
            ChatStreamRequest(
                messages = listOf(ChatHistoryMessageDto(role = "user", content = "hi")),
                supportsApproval = true
            )
        )
        assertTrue(reqJson.contains("\"supportsApproval\":true"))

        val approvalLine = """{"type":"approval","id":"ap_1","callId":"c1","runId":"r1","tool":"run_command","permissionMode":"auto","noAlways":false,"expiresInMs":300000,"preview":{"command":"node -v","cwd":"/tmp/ws","risk":["执行本地命令"]}}"""
        val apEvt = NdjsonStreamParser.parseLine(approvalLine)!!
        assertEquals(StreamEventType.APPROVAL, apEvt.type)
        val ap = apEvt.approval!!
        assertEquals("ap_1", ap.id)
        assertEquals("c1", ap.callId)
        assertEquals("node -v", ap.command)
        assertEquals("/tmp/ws", ap.cwd)
        assertTrue(ap.isPending)
        assertFalse(ap.isDanger)
        assertTrue(ap.hasRisk)
        assertTrue(ap.canOfferFullAccess)
        assertFalse(ap.canOfferAlwaysAllow)

        val dangerLine = """{"type":"approval","id":"ap_2","callId":"c2","tool":"run_command","permissionMode":"full","preview":{"command":"pm2 restart tools-platform","danger":[{"category":"system","label":"系统服务控制","reason":"将重启服务"}],"dangerScopes":["session","workspace"]}}"""
        val dangerAp = NdjsonStreamParser.parseLine(dangerLine)!!.approval!!
        assertTrue(dangerAp.isDanger)
        assertFalse(dangerAp.canOfferFullAccess)
        assertFalse(dangerAp.canOfferAlwaysAllow)
        assertEquals(listOf("session", "workspace"), dangerAp.dangerScopes)

        val resLine = """{"type":"approval_result","id":"ap_1","callId":"c1","decision":"full"}"""
        val resEvt = NdjsonStreamParser.parseLine(resLine)!!
        assertEquals(StreamEventType.APPROVAL_RESULT, resEvt.type)
        assertEquals("c1", resEvt.callId)
        assertEquals("full", resEvt.approvalDecision)
        assertEquals("本对话已开启完全访问", DragonClawHelpers.approvalStatusLabel("full", null, "zh"))
        assertEquals("Full access enabled for this chat", DragonClawHelpers.approvalStatusLabel("full", null, "en"))
        assertEquals("执行命令", DragonClawHelpers.toolDisplayName("run_command", "zh"))

        val storedEvents = Json.parseToJsonElement(
            """[{"type":"approval","id":"ap_1","callId":"c1","tool":"run_command","permissionMode":"auto","preview":{"command":"node -v"}},{"type":"approval_result","id":"ap_1","callId":"c1","decision":"full"}]"""
        ) as JsonArray
        val mapped = DragonClawHelpers.mapStoredMessages(
            listOf(
                SessionMessageItem(id = "m_u", session_id = "s_ap_1", role = "user", content = "运行命令"),
                SessionMessageItem(id = "m_a", session_id = "s_ap_1", role = "model", content = "已完成", events = storedEvents)
            )
        )
        assertEquals(2, mapped.size)
        assertEquals(1, mapped[1].approvals.size)
        assertFalse(mapped[1].approvals[0].isPending)
        assertEquals("full", mapped[1].approvals[0].chosenDecision)
    }

    @Test
    fun pinnedGroupCollapsesOnlyWhenPinnedPrefIsSetAndNotSearching() {
        assertFalse(SessionGrouping.shouldCollapseGroup(SessionBucket.PINNED, isPinnedCollapsed = false, searchQuery = ""))
        assertTrue(SessionGrouping.shouldCollapseGroup(SessionBucket.PINNED, isPinnedCollapsed = true, searchQuery = ""))
        assertTrue(SessionGrouping.shouldCollapseGroup(SessionBucket.PINNED, isPinnedCollapsed = true, searchQuery = "   "))
        assertFalse(SessionGrouping.shouldCollapseGroup(SessionBucket.PINNED, isPinnedCollapsed = true, searchQuery = "语音"))
        assertFalse(SessionGrouping.shouldCollapseGroup(SessionBucket.TODAY, isPinnedCollapsed = true, searchQuery = ""))
    }
}
