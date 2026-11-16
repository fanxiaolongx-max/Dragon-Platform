package com.example.newapp.shared

import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.MarkdownParser
import com.example.newapp.shared.util.MdBlockKind
import com.example.newapp.shared.util.MdSpanKind
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MarkdownParserTest {
    @Test
    fun spacedTableSeparatorsRemainTables() {
        val raw = """
            ### 现在的数字
            | 状态 | 项数 |
            | --- | --- |
            | 已对齐 | 47 |
            | Web 专有 | 11 |
            | 改造（换了实现方式） | 3 |

            决策：已完成 61。
        """.trimIndent()
        val blocks = MarkdownParser.parse(raw)
        assertEquals(listOf(MdBlockKind.HEADING, MdBlockKind.TABLE, MdBlockKind.PARAGRAPH), blocks.map { it.kind })
        val rows = blocks[1].tableRows
        assertEquals(4, rows.size)
        assertEquals(listOf("状态", "项数"), rows[0].map { it.joinToString("") { span -> span.text } })
        assertEquals("47", rows[1][1].single().text)
        assertTrue(MarkdownParser.toSpeechText(raw).contains("已对齐，47"))
    }

    @Test
    fun tableVariantsKeepColumnsAndInlineFormatting() {
        val raw = "名称 | 内容 | 备注\n:--- | :---: | ---:\n**状态** | `a\\|b` | [说明](https://example.com)\n空值 | |\n多列 | 正常 | 尾列 | 忽略"
        val rows = MarkdownParser.parse(raw).single().tableRows
        assertTrue(rows.all { it.size == 3 })
        assertEquals(MdSpanKind.BOLD, rows[1][0].single().kind)
        assertEquals("a|b", rows[1][1].single().text)
        assertEquals(MdSpanKind.WEB_LINK, rows[1][2].single().kind)
        assertTrue(rows[2][1].isEmpty())
        assertTrue(rows[2][2].isEmpty())
        assertEquals("尾列", rows[3][2].single().text)
        assertEquals(MdBlockKind.TABLE, MarkdownParser.parse("| 单列 |\n| --- |\n| 值 |").single().kind)
    }

    @Test
    fun tablesDoNotNormalizeCellContentsOrConsumeFollowingParagraphs() {
        val raw = "| 名称 | 内容 |\n| --- | --- |\n| 示例 | 文字 --- 后续 ### 标记 |\n\n普通文字 a | b\n\n---"
        val blocks = MarkdownParser.parse(raw)
        assertEquals(listOf(MdBlockKind.TABLE, MdBlockKind.PARAGRAPH, MdBlockKind.DIVIDER), blocks.map { it.kind })
        assertEquals("文字 --- 后续 ### 标记", blocks[0].tableRows[1][1].single().text)
    }

    @Test
    fun fencesPreserveLiteralMarkdownAndRequireMatchingClosingFence() {
        val raw = "~~~~text\n| 名称 | 值 |\n| --- | --- |\n```\n~~~\n~~~~\n\n###### 六级标题\n+ 项目\n2) 第二项"
        val blocks = MarkdownParser.parse(raw)
        assertEquals(listOf(MdBlockKind.CODE_BLOCK, MdBlockKind.HEADING, MdBlockKind.BULLET_ITEM, MdBlockKind.ORDERED_ITEM), blocks.map { it.kind })
        assertEquals("text", blocks[0].codeLanguage)
        assertTrue(blocks[0].codeText.endsWith("```\n~~~"))
        assertEquals(6, blocks[1].level)
        assertEquals("2.", blocks[3].marker)
        val streamed = MarkdownParser.parse("```js\nconst a = 1;").single()
        assertEquals(MdBlockKind.CODE_BLOCK, streamed.kind)
        assertEquals("const a = 1;", streamed.codeText)
    }

    @Test
    fun htmlAudioTagsAndAgentFileDownloadLinksRenderWithoutRawHtmlOrCodeChips() {
        val raw = """
            🎙️ 声音生成完成！

            - **音色**: 雨薇 Yuwei
            - **试听**:

            <audio controls preload="none" src="/api/agent-files/view?path=%2FVolumes%2F512G%2Foutputs%2Faudio%2Fvoice_yuwei_20261115090359_fa347b.mp3"></audio>

            - [📥 点击直接下载音频文件](/api/agent-files/download?path=%2FVolumes%2F512G%2Foutputs%2Faudio%2Fvoice_yuwei_20261115090359_fa347b.mp3)
        """.trimIndent()

        val blocks = MarkdownParser.parse(raw)
        val audioBlocks = blocks.filter { it.kind == MdBlockKind.AUDIO }
        assertEquals(1, audioBlocks.size)
        assertEquals(
            "/api/agent-files/view?path=%2FVolumes%2F512G%2Foutputs%2Faudio%2Fvoice_yuwei_20261115090359_fa347b.mp3",
            audioBlocks.first().audioUrl
        )
        // Raw HTML <audio ...> tag must not remain as text
        assertFalse(blocks.filter { it.kind == MdBlockKind.PARAGRAPH }.any { block ->
            block.spans.any { it.text.contains("<audio") }
        })
        assertFalse(MarkdownParser.toSpeechText(raw).contains("<audio"))

        // Relative /api/agent-files/download link becomes clickable WEB_LINK instead of `</>` SYMBOL_CHIP
        val downloadSpans = blocks.filter { it.kind == MdBlockKind.BULLET_ITEM }.flatMap { it.spans }
        assertFalse(downloadSpans.any { it.kind == MdSpanKind.SYMBOL_CHIP })
        val downloadLink = downloadSpans.first { it.kind == MdSpanKind.WEB_LINK }
        assertEquals("📥 点击直接下载音频文件", downloadLink.text)
        assertTrue(downloadLink.url?.startsWith("/api/agent-files/download?path=") == true)

        assertEquals(
            "voice_yuwei_20261115090359_fa347b.mp3",
            DragonClawHelpers.extractAgentFileDisplayName(audioBlocks.first().audioUrl)
        )
        assertTrue(DragonClawHelpers.isPlatformAgentFileUrl(downloadLink.url!!, "https://cs.fanxiaolong.uk"))
        assertTrue(
            DragonClawHelpers.shouldAttachBearerAuth(
                "https://cs.fanxiaolong.uk/api/agent-files/view?path=test.mp3",
                "https://cs.fanxiaolong.uk"
            )
        )
        assertFalse(
            DragonClawHelpers.shouldAttachBearerAuth(
                "https://cdn.example.com/audio/demo.mp3",
                "https://cs.fanxiaolong.uk"
            )
        )
    }

    @Test
    fun multilineSourceAudioTagAndInlineCodeAudioAreHandledProperly() {
        val raw = """
            - **试听**：<audio controls>
              <source src="/api/agent-files/view?path=%2Ftmp%2F%E9%9F%B3%E9%A2%91%20demo.mp3" type="audio/mpeg" />
            </audio>

            说明：示例标签 `<audio controls src="/api/agent-files/view?path=example.mp3"></audio>` 应保持代码样式。
        """.trimIndent()

        val blocks = MarkdownParser.parse(raw)
        val audioBlocks = blocks.filter { it.kind == MdBlockKind.AUDIO }
        assertEquals(1, audioBlocks.size)
        assertEquals(
            "/api/agent-files/view?path=%2Ftmp%2F%E9%9F%B3%E9%A2%91%20demo.mp3",
            audioBlocks.first().audioUrl
        )
        assertEquals("音频 demo.mp3", DragonClawHelpers.extractAgentFileDisplayName(audioBlocks.first().audioUrl))
        val lastParagraph = blocks.last { it.kind == MdBlockKind.PARAGRAPH }
        assertTrue(lastParagraph.spans.any { it.kind == MdSpanKind.CODE && it.text.contains("<audio controls") })
    }
}
