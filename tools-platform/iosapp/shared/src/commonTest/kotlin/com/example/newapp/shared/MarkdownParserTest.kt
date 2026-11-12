package com.example.newapp.shared

import com.example.newapp.shared.util.MarkdownParser
import com.example.newapp.shared.util.MdBlockKind
import com.example.newapp.shared.util.MdSpanKind
import kotlin.test.Test
import kotlin.test.assertEquals
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
}
