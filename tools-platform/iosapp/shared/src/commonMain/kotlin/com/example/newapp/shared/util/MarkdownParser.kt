package com.example.newapp.shared.util

enum class MdSpanKind {
    PLAIN,
    BOLD,
    ITALIC,
    CODE,
    SYMBOL_CHIP,
    WEB_LINK
}

data class MdSpan(
    val kind: MdSpanKind,
    val text: String,
    val url: String? = null,
    val badge: String? = null,
    val isBold: Boolean = false,
    val isItalic: Boolean = false
)

enum class MdBlockKind {
    HEADING,
    PARAGRAPH,
    BULLET_ITEM,
    ORDERED_ITEM,
    CODE_BLOCK,
    BLOCKQUOTE,
    DIVIDER,
    TABLE,
    IMAGE
}

data class MdBlock(
    val id: Int,
    val kind: MdBlockKind,
    val level: Int = 0,
    val marker: String = "",
    val spans: List<MdSpan> = emptyList(),
    val codeLanguage: String = "",
    val codeText: String = "",
    val tableRows: List<List<List<MdSpan>>> = emptyList(),
    val imageUrl: String = "",
    val imageAlt: String = ""
)

/**
 * Pure Kotlin block + inline Markdown parser shared between iOS and Android so structured
 * AI and desktop-agent transcripts render consistently with symbol chips, headings, nested lists,
 * blockquotes, tables, images, and code fences.
 */
object MarkdownParser {
    private val inlineHeadingRegex = Regex("""([^\s#\n])\s+(#{1,4}\s+\S)""")
    private val headingGluedListRegex = Regex("""^(#{1,4}\s+[^\n]{3,}?)\s+(\d{1,2}\.\s+(?:\*\*|\[|`|\S.*[:：。]))$""")
    private val headingGluedBulletRegex = Regex("""^(#{1,4}\s+[^\n]{2,}?)\s+-\s+(.+)$""")
    private val inlineOrderedListRegex = Regex("""([。！？.!?:：；;)）\]`*])\s+(\d{1,2}\.\s+(?:\*\*|\[|`|[\u4E00-\u9FFFA-Z]))""")
    private val inlineDividerRegex = Regex("""([^\n\s-])\s+---+\s+(\S)""")
    private val markdownImageRegex = Regex("""!\[([^\]]*)]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)""")

    private val headingLineRegex = Regex("""^(#{1,6})\s+(.+)$""")
    private val bulletLineRegex = Regex("""^(\s*)([-*+•])\s+(.*)$""")
    private val orderedLineRegex = Regex("""^(\s*)(\d{1,3})[.)]\s+(.*)$""")
    private val dividerLineRegex = Regex("""^\s*(?:-{3,}|\*{3,}|_{3,})\s*$""")
    private val tableDividerCellRegex = Regex("""^:?-{2,}:?$""")

    private fun isTableDivider(line: String): Boolean =
        line.contains('|') && splitTableRow(line).all { tableDividerCellRegex.matches(it) }


    fun parse(raw: String): List<MdBlock> {
        if (raw.isEmpty()) return emptyList()
        val blocks = mutableListOf<MdBlock>()
        var nextId = 0

        val normalizedInput = raw.replace("\r\n", "\n").replace('\r', '\n')
        val sections = splitCodeFences(normalizedInput)
        for ((isCode, langOrRaw, codeBody) in sections) {
            if (isCode) {
                blocks.add(
                    MdBlock(
                        id = nextId++,
                        kind = MdBlockKind.CODE_BLOCK,
                        codeLanguage = langOrRaw,
                        codeText = codeBody
                    )
                )
            } else {
                val prepared = normalizeStructure(langOrRaw)
                parseTextBlocks(prepared, blocks) { nextId++ }
            }
        }
        return blocks
    }

    /** Produces clean human-readable speech text by removing Markdown punctuation, code fences, and file:// URLs. */
    fun toSpeechText(raw: String): String {
        if (raw.isBlank()) return ""
        val blocks = parse(raw)
        val parts = mutableListOf<String>()
        for (block in blocks) {
            when (block.kind) {
                MdBlockKind.DIVIDER, MdBlockKind.IMAGE -> Unit
                MdBlockKind.CODE_BLOCK -> {
                    val trimmed = block.codeText.trim()
                    if (trimmed.isNotEmpty() && trimmed.lines().size <= 3 && trimmed.length <= 120) {
                        parts.add(trimmed)
                    }
                }
                MdBlockKind.TABLE -> {
                    for (row in block.tableRows.drop(1)) {
                        val rowText = row.joinToString("，") { cell -> cell.joinToString("") { it.text } }.trim()
                        if (rowText.isNotEmpty()) parts.add(rowText)
                    }
                }
                else -> {
                    val text = block.spans.joinToString("") { it.text }.trim()
                    if (text.isNotEmpty()) parts.add(text)
                }
            }
        }
        return parts.joinToString("。").replace(Regex("""[。]{2,}"""), "。").trim()
    }

    private fun splitCodeFences(raw: String): List<Triple<Boolean, String, String>> {
        val out = mutableListOf<Triple<Boolean, String, String>>()
        val textBuf = mutableListOf<String>()
        val codeBuf = mutableListOf<String>()
        var inCode = false
        var codeLang = ""
        var fenceChar = '`'
        var fenceLength = 0

        fun flushText() {
            val joined = textBuf.joinToString("\n")
            if (joined.isNotBlank()) out.add(Triple(false, joined, ""))
            textBuf.clear()
        }

        fun flushCode() {
            out.add(Triple(true, codeLang, codeBuf.joinToString("\n")))
            codeBuf.clear()
            codeLang = ""
        }

        for (line in raw.lines()) {
            val trimmed = line.trimStart()
            val fence = trimmed.takeWhile { it == trimmed.firstOrNull() }
            val isFence = fence.length >= 3 && fence.firstOrNull() in listOf('`', '~')
            if (inCode && isFence && fence.first() == fenceChar && fence.length >= fenceLength
                && trimmed.drop(fence.length).isBlank()) {
                flushCode()
                inCode = false
            } else if (!inCode && isFence) {
                flushText()
                fenceChar = fence.first()
                fenceLength = fence.length
                codeLang = trimmed.drop(fence.length).trim()
                inCode = true
            } else if (inCode) {
                codeBuf.add(line)
            } else {
                textBuf.add(line)
            }
        }
        if (inCode) flushCode() else flushText()
        return out
    }

    internal fun normalizeStructure(segment: String): String {
        val intermediate = mutableListOf<String>()
        for (rawLine in segment.lines()) {
            // Protect table cells and separators from the prose repair heuristics.
            if (rawLine.contains('|')) {
                intermediate.add(rawLine)
                continue
            }
            var line = rawLine
            // Split inline headings like "内容 --- ### 2. 标题" or "...。 ### 2. 标题"
            while (true) {
                val updated = inlineHeadingRegex.replace(line) { m -> "${m.groupValues[1]}\n\n${m.groupValues[2]}" }
                if (updated == line) break
                line = updated
            }
            // Split inline horizontal dividers like "...注入)。 --- 如果..."
            line = inlineDividerRegex.replace(line) { m -> "${m.groupValues[1]}\n\n---\n\n${m.groupValues[2]}" }

            for (subLine in line.lines()) {
                var expanded = subLine
                val trimmed = expanded.trimStart()
                if (trimmed.startsWith("#")) {
                    val numberedMatch = headingGluedListRegex.matchEntire(trimmed)
                    if (numberedMatch != null) {
                        expanded = "${numberedMatch.groupValues[1]}\n${numberedMatch.groupValues[2]}"
                    } else {
                        val bulletMatch = headingGluedBulletRegex.matchEntire(trimmed)
                        if (bulletMatch != null) {
                            val tail = bulletMatch.groupValues[2]
                            if (tail.contains("**") || tail.contains("`") || tail.contains("。") || tail.length >= 24) {
                                expanded = "${bulletMatch.groupValues[1]}\n- $tail"
                            }
                        }
                    }
                }
                for (piece in expanded.lines()) {
                    var listExpanded = piece
                    if (!listExpanded.trimStart().startsWith("#")) {
                        while (true) {
                            val updated = inlineOrderedListRegex.replace(listExpanded) { m ->
                                "${m.groupValues[1]}\n${m.groupValues[2]}"
                            }
                            if (updated == listExpanded) break
                            listExpanded = updated
                        }
                    }
                    intermediate.add(listExpanded)
                }
            }
        }
        return intermediate.joinToString("\n")
    }

    private fun parseTextBlocks(
        prepared: String,
        out: MutableList<MdBlock>,
        nextId: () -> Int
    ) {
        val lines = prepared.lines()
        val paragraphBuf = mutableListOf<String>()
        val quoteBuf = mutableListOf<String>()
        var i = 0

        fun flushParagraph() {
            if (paragraphBuf.isNotEmpty()) {
                val content = paragraphBuf.joinToString("\n").trim()
                if (content.isNotEmpty()) {
                    out.add(
                        MdBlock(
                            id = nextId(),
                            kind = MdBlockKind.PARAGRAPH,
                            spans = parseInline(content)
                        )
                    )
                }
                paragraphBuf.clear()
            }
        }

        fun flushQuote() {
            if (quoteBuf.isNotEmpty()) {
                val content = quoteBuf.joinToString("\n").trim()
                if (content.isNotEmpty()) {
                    out.add(
                        MdBlock(
                            id = nextId(),
                            kind = MdBlockKind.BLOCKQUOTE,
                            spans = parseInline(content)
                        )
                    )
                }
                quoteBuf.clear()
            }
        }

        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trim()

            if (trimmed.isEmpty()) {
                flushParagraph()
                flushQuote()
                i++
                continue
            }

            if (dividerLineRegex.matches(trimmed)) {
                flushParagraph()
                flushQuote()
                out.add(MdBlock(id = nextId(), kind = MdBlockKind.DIVIDER))
                i++
                continue
            }

            // Markdown table detection: header row + divider row + body rows
            if (trimmed.contains('|') && i + 1 < lines.size && isTableDivider(lines[i + 1].trim())) {
                flushParagraph()
                flushQuote()
                val rows = mutableListOf<List<List<MdSpan>>>()
                val header = splitTableRow(trimmed)
                val columnCount = header.size
                if (splitTableRow(lines[i + 1]).size != columnCount) {
                    paragraphBuf.add(line)
                    i++
                    continue
                }
                rows.add(header.map { parseInline(it) })
                i += 2
                while (i < lines.size) {
                    val rowTrimmed = lines[i].trim()
                    if (rowTrimmed.isEmpty() || !rowTrimmed.contains('|')) break
                    val cells = splitTableRow(rowTrimmed)
                    rows.add(List(columnCount) { column -> parseInline(cells.getOrElse(column) { "" }) })
                    i++
                }
                out.add(
                    MdBlock(
                        id = nextId(),
                        kind = MdBlockKind.TABLE,
                        tableRows = rows
                    )
                )
                continue
            }

            if (trimmed.startsWith(">")) {
                flushParagraph()
                val quoteText = trimmed.removePrefix(">").trimStart()
                quoteBuf.add(quoteText)
                i++
                continue
            } else {
                flushQuote()
            }

            val headingMatch = headingLineRegex.matchEntire(trimmed)
            if (headingMatch != null) {
                flushParagraph()
                val level = headingMatch.groupValues[1].length.coerceIn(1, 6)
                val body = headingMatch.groupValues[2].trim()
                out.add(
                    MdBlock(
                        id = nextId(),
                        kind = MdBlockKind.HEADING,
                        level = level,
                        spans = parseInline(body, defaultBold = true)
                    )
                )
                i++
                continue
            }

            val bulletMatch = bulletLineRegex.matchEntire(line)
            if (bulletMatch != null) {
                flushParagraph()
                val indentSpaces = bulletMatch.groupValues[1].count { it == ' ' } + bulletMatch.groupValues[1].count { it == '\t' } * 2
                val level = (indentSpaces / 2).coerceIn(0, 3)
                val body = bulletMatch.groupValues[3].trim()
                out.add(
                    MdBlock(
                        id = nextId(),
                        kind = MdBlockKind.BULLET_ITEM,
                        level = level,
                        spans = parseInline(body)
                    )
                )
                i++
                continue
            }

            val orderedMatch = orderedLineRegex.matchEntire(line)
            if (orderedMatch != null) {
                flushParagraph()
                val indentSpaces = orderedMatch.groupValues[1].count { it == ' ' } + orderedMatch.groupValues[1].count { it == '\t' } * 2
                val level = (indentSpaces / 2).coerceIn(0, 3)
                val marker = "${orderedMatch.groupValues[2]}."
                val body = orderedMatch.groupValues[3].trim()
                out.add(
                    MdBlock(
                        id = nextId(),
                        kind = MdBlockKind.ORDERED_ITEM,
                        level = level,
                        marker = marker,
                        spans = parseInline(body)
                    )
                )
                i++
                continue
            }

            if (markdownImageRegex.containsMatchIn(line)) {
                var cursor = 0
                for (match in markdownImageRegex.findAll(line)) {
                    val before = line.substring(cursor, match.range.first).trim()
                    if (before.isNotEmpty()) {
                        paragraphBuf.add(before)
                    }
                    flushParagraph()
                    flushQuote()
                    val alt = match.groupValues[1].trim()
                    val url = match.groupValues[2].trim()
                    if (url.isNotEmpty()) {
                        out.add(
                            MdBlock(
                                id = nextId(),
                                kind = MdBlockKind.IMAGE,
                                imageUrl = url,
                                imageAlt = alt
                            )
                        )
                    }
                    cursor = match.range.last + 1
                }
                val trailing = line.substring(cursor).trim()
                if (trailing.isNotEmpty()) {
                    paragraphBuf.add(trailing)
                }
                i++
                continue
            }

            paragraphBuf.add(line)
            i++
        }

        flushParagraph()
        flushQuote()
    }

    private fun splitTableRow(row: String): List<String> {
        val cells = mutableListOf<String>()
        val cell = StringBuilder()
        val text = row.trim()
        var index = 0
        while (index < text.length) {
            if (text[index] == '\\' && index + 1 < text.length && text[index + 1] == '|') {
                cell.append('|')
                index += 2
                continue
            }
            if (text[index] == '|') {
                cells.add(cell.toString().trim())
                cell.clear()
            } else {
                cell.append(text[index])
            }
            index++
        }
        cells.add(cell.toString().trim())
        if (text.startsWith('|')) cells.removeAt(0)
        if (text.endsWith('|') && !text.endsWith("\\|")) cells.removeAt(cells.lastIndex)
        return cells
    }

    fun parseInline(
        text: String,
        defaultBold: Boolean = false,
        defaultItalic: Boolean = false
    ): List<MdSpan> {
        val out = mutableListOf<MdSpan>()
        val plainBuf = StringBuilder()

        fun flushPlain() {
            if (plainBuf.isNotEmpty()) {
                val kind = when {
                    defaultBold -> MdSpanKind.BOLD
                    defaultItalic -> MdSpanKind.ITALIC
                    else -> MdSpanKind.PLAIN
                }
                out.add(
                    MdSpan(
                        kind = kind,
                        text = plainBuf.toString(),
                        isBold = defaultBold,
                        isItalic = defaultItalic
                    )
                )
                plainBuf.clear()
            }
        }

        var i = 0
        while (i < text.length) {
            // 1. Escaped backslash punctuation e.g. \` or \*
            if (text[i] == '\\' && i + 1 < text.length && text[i + 1] in listOf('`', '*', '_', '[', ']', '\\')) {
                plainBuf.append(text[i + 1])
                i += 2
                continue
            }

            // 2. Inline code `...`
            if (text[i] == '`') {
                val close = text.indexOf('`', i + 1)
                if (close > i + 1) {
                    flushPlain()
                    out.add(
                        MdSpan(
                            kind = MdSpanKind.CODE,
                            text = text.substring(i + 1, close),
                            isBold = defaultBold,
                            isItalic = defaultItalic
                        )
                    )
                    i = close + 1
                    continue
                }
            }

            // 3. Bold **...**
            if (text.startsWith("**", i)) {
                val close = findClosingMarker(text, "**", i + 2)
                if (close > i + 2) {
                    flushPlain()
                    val inner = text.substring(i + 2, close)
                    out.addAll(parseInline(inner, defaultBold = true, defaultItalic = defaultItalic))
                    i = close + 2
                    continue
                }
            }

            // 4. Italic *...* (single asterisk)
            if (text[i] == '*' && !text.startsWith("**", i)) {
                val close = findClosingSingleAsterisk(text, i + 1)
                if (close > i + 1) {
                    flushPlain()
                    val inner = text.substring(i + 1, close)
                    out.addAll(parseInline(inner, defaultBold = defaultBold, defaultItalic = true))
                    i = close + 1
                    continue
                }
            }

            // 5. Markdown links [label](url) - supports Unicode/file:/// paths cleanly
            if (text[i] == '[') {
                val linkMatch = matchMarkdownLink(text, i)
                if (linkMatch != null) {
                    flushPlain()
                    val (labelRaw, urlRaw, nextIdx) = linkMatch
                    val label = labelRaw.trim().removeSurrounding("`")
                    val url = urlRaw.trim()
                    if (isWebUrl(url)) {
                        out.add(
                            MdSpan(
                                kind = MdSpanKind.WEB_LINK,
                                text = label.ifEmpty { url },
                                url = url,
                                isBold = defaultBold,
                                isItalic = defaultItalic
                            )
                        )
                    } else {
                        out.add(
                            MdSpan(
                                kind = MdSpanKind.SYMBOL_CHIP,
                                text = cleanLocalSymbolLabel(label, url),
                                url = url,
                                badge = inferFileBadge(url),
                                isBold = defaultBold,
                                isItalic = defaultItalic
                            )
                        )
                    }
                    i = nextIdx
                    continue
                }
            }

            // 6. Bare http(s) URLs
            if (text.startsWith("https://", i) || text.startsWith("http://", i)) {
                var end = i
                while (end < text.length && !text[end].isWhitespace() && text[end] !in listOf(')', '）', ']', '>', ',', '，', '。')) {
                    end++
                }
                if (end > i + 8) {
                    flushPlain()
                    val url = text.substring(i, end)
                    out.add(
                        MdSpan(
                            kind = MdSpanKind.WEB_LINK,
                            text = url,
                            url = url,
                            isBold = defaultBold,
                            isItalic = defaultItalic
                        )
                    )
                    i = end
                    continue
                }
            }

            plainBuf.append(text[i])
            i++
        }

        flushPlain()
        return out
    }

    private fun findClosingMarker(text: String, marker: String, start: Int): Int {
        var idx = start
        while (idx < text.length) {
            if (text[idx] == '`') {
                val codeEnd = text.indexOf('`', idx + 1)
                if (codeEnd > idx) {
                    idx = codeEnd + 1
                    continue
                }
            }
            if (text.startsWith(marker, idx)) {
                return idx
            }
            idx++
        }
        return -1
    }

    private fun findClosingSingleAsterisk(text: String, start: Int): Int {
        var idx = start
        while (idx < text.length) {
            if (text[idx] == '`') {
                val codeEnd = text.indexOf('`', idx + 1)
                if (codeEnd > idx) {
                    idx = codeEnd + 1
                    continue
                }
            }
            if (text[idx] == '*' && !text.startsWith("**", idx) && (idx == 0 || text[idx - 1] != '*')) {
                return idx
            }
            idx++
        }
        return -1
    }

    private fun matchMarkdownLink(text: String, openBracketIndex: Int): Triple<String, String, Int>? {
        val closeBracket = findMatchingBracket(text, openBracketIndex)
        if (closeBracket <= openBracketIndex + 1) return null
        if (closeBracket + 1 >= text.length || text[closeBracket + 1] != '(') return null

        var depth = 0
        var idx = closeBracket + 1
        while (idx < text.length) {
            val ch = text[idx]
            if (ch == '(') {
                depth++
            } else if (ch == ')') {
                depth--
                if (depth == 0) {
                    val label = text.substring(openBracketIndex + 1, closeBracket)
                    val url = text.substring(closeBracket + 2, idx)
                    if (url.isBlank()) return null
                    return Triple(label, url, idx + 1)
                }
            } else if (ch == '\n') {
                return null
            }
            idx++
        }
        return null
    }

    private fun findMatchingBracket(text: String, openIdx: Int): Int {
        var depth = 0
        var idx = openIdx
        while (idx < text.length) {
            when (text[idx]) {
                '[' -> depth++
                ']' -> {
                    depth--
                    if (depth == 0) return idx
                }
                '\n' -> return -1
            }
            idx++
        }
        return -1
    }

    private fun isWebUrl(url: String): Boolean {
        val lower = url.trim().lowercase()
        return lower.startsWith("https://") || lower.startsWith("http://")
    }

    private fun cleanLocalSymbolLabel(label: String, url: String): String {
        if (label.isNotEmpty() && !label.startsWith("file://")) return label
        val noHash = url.substringBefore('#').substringBefore('?')
        return noHash.substringAfterLast('/').ifBlank { url }
    }

    private fun inferFileBadge(url: String): String? {
        val cleanPath = url.substringBefore('#').substringBefore('?').lowercase()
        return when {
            cleanPath.endsWith(".py") -> "PY"
            cleanPath.endsWith(".js") || cleanPath.endsWith(".mjs") || cleanPath.endsWith(".cjs") -> "JS"
            cleanPath.endsWith(".ts") || cleanPath.endsWith(".tsx") -> "TS"
            cleanPath.endsWith(".kt") || cleanPath.endsWith(".kts") -> "KT"
            cleanPath.endsWith(".swift") -> "SW"
            cleanPath.endsWith(".json") || cleanPath.endsWith(".html") || cleanPath.endsWith(".css") || cleanPath.endsWith(".xml") -> "</>"
            cleanPath.endsWith(".sh") || cleanPath.endsWith(".zsh") -> "$"
            else -> "</>"
        }
    }
}
