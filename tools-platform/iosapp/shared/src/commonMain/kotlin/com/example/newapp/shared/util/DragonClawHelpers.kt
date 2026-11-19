package com.example.newapp.shared.util

import com.example.newapp.shared.model.*
import io.ktor.http.encodeURLParameter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlin.math.sin

data class AestheticImageFrame(
    val width: Double,
    val height: Double,
    val innerPadding: Double,
    val needsBackdropFrame: Boolean
)

data class MarkdownRenderRun(
    val block: MdBlock? = null,
    val imageGroup: List<MdBlock> = emptyList()
)

/** Pure Kotlin helpers shared by iOS and Android (stream parsing, timestamps, grouping, error extraction). */
object DragonClawHelpers {
    /** Line threshold before folding long user prompt bubbles (matches Web `.dc-msg--user`). */
    const val USER_MESSAGE_FOLD_MAX_LINES = 6

    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
    val lenientJson = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
        encodeDefaults = true
        explicitNulls = false
    }

    fun normalizeBaseUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim().trimEnd('/')
        if (trimmed.isEmpty()) return "https://cs.fanxiaolong.uk"
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "https://$trimmed"
        }
    }

    fun urlEncodeSegment(raw: String): String = raw.encodeURLParameter()

    fun normalizeBearerHeader(rawToken: String): String {
        val t = rawToken.trim()
        return if (t.startsWith("Bearer ", ignoreCase = true)) t else "Bearer $t"
    }

    fun stripBearerPrefix(rawToken: String): String {
        val t = rawToken.trim()
        return if (t.startsWith("Bearer ", ignoreCase = true)) t.drop(7).trim() else t
    }

    fun parseErrorMessage(statusCode: Int, rawBody: String, fallback: String = "Request failed"): String {
        if (rawBody.isNotBlank()) {
            try {
                val obj = lenientJson.parseToJsonElement(rawBody).jsonObject
                val errorText = (obj["error"] as? JsonPrimitive)?.contentOrNull
                    ?: (obj["message"] as? JsonPrimitive)?.contentOrNull
                if (!errorText.isNullOrBlank()) {
                    return errorText
                }
            } catch (_: Exception) {
                val plain = rawBody.trim()
                if (plain.length <= 200 && !plain.startsWith("<")) return plain
            }
        }
        return "$fallback (HTTP $statusCode)"
    }

    private val IMAGE_EXT_REGEX = Regex("""\.(png|jpe?g|gif|webp|bmp|avif|heic|svg)(?:[?#].*)?$""", RegexOption.IGNORE_CASE)
    private val MARKDOWN_IMAGE_URL_REGEX = Regex("""!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)""")
    private val RAW_API_IMAGE_REGEX = Regex("""/api/agent-files/raw\?path=[^\s)"'<>]+""", RegexOption.IGNORE_CASE)
    private val LOCAL_IMAGE_PATH_REGEX = Regex(
        """(?:file://)?((?:/(?:Users|Volumes|tmp|var|home|app|opt|data|root|private)/|~/|[A-Za-z]:\\)[^\s\r\n"'`()<>|\[\]]+\.(?:png|jpe?g|gif|webp|bmp|avif|heic|svg)(?:[?#][^\s)"'<>]*)?)""",
        RegexOption.IGNORE_CASE
    )
    private val UPLOAD_BLOCK_HEADER_REGEX = Regex("""^(?:📎\s*附件[：:]|\[(?:已上传附件路径：|Attached files uploaded to server:|已上传附件)])\s*$""")
    private val UPLOAD_MD_BULLET_REGEX = Regex("""^-\s+\[([^\]\r\n]*)\]\(<([^>\r\n]+)>\)\s*$""")
    private val UPLOAD_BULLET_LINE_REGEX = Regex("""^-\s+(?:([^:\r\n]{1,120}):\s+)?((?:/|~/|[A-Za-z]:\\)[^\r\n]+)\s*$""")

    /** Filters & compacts welcome suggestions down to 2-3 short single-line starter prompts. */
    fun filterStarterPrompts(
        suggestions: List<AiSuggestion>,
        language: String,
        limit: Int = 3
    ): List<String> {
        val cap = limit.coerceIn(1, 3)
        val isEn = language == "en"
        val maxLen = if (isEn) 38 else 22
        val minLen = if (isEn) 5 else 4
        val picked = mutableListOf<String>()
        val seen = mutableSetOf<String>()

        fun tryAdd(candidateRaw: String) {
            if (picked.size >= cap) return
            val clean = candidateRaw.replace(Regex("""\s+"""), " ").trim()
            if (clean.length < minLen || clean.length > maxLen) return
            if (clean.contains("http://", ignoreCase = true) ||
                clean.contains("https://", ignoreCase = true) ||
                clean.contains("~/") ||
                clean.contains("/Users/") ||
                clean.contains("/Volumes/") ||
                clean.contains("/var/") ||
                clean.contains("```") ||
                clean.contains(".log") ||
                clean.contains(".md") ||
                clean.contains("read_file", ignoreCase = true)
            ) {
                return
            }
            val key = clean.lowercase()
            if (seen.add(key)) picked.add(clean)
        }

        for (item in suggestions) {
            if (item.question.contains('\n') || item.question.contains('\r')) continue
            tryAdd(item.question)
            if (picked.size >= cap) break
        }

        val defaults = if (isEn) {
            listOf("Today's key KPIs", "Failing metrics", "At-risk SLA tickets")
        } else {
            listOf("今日重点 KPI", "本月未达标指标", "超时 SLA 工单")
        }
        if (picked.size < minOf(2, cap)) {
            for (fallback in defaults) {
                tryAdd(fallback)
                if (picked.size >= cap) break
            }
        }
        return picked.take(cap)
    }

    fun isImageReference(pathOrUrl: String, mimeType: String = ""): Boolean {
        if (mimeType.startsWith("image/", ignoreCase = true)) return true
        val trimmed = pathOrUrl.trim()
        if (trimmed.isEmpty()) return false
        if (trimmed.startsWith("data:image/", ignoreCase = true)) return true
        if (trimmed.contains("/api/agent-files/raw?", ignoreCase = true)) {
            val encodedPath = trimmed.substringAfter("path=", "").substringBefore('&')
            return encodedPath.isNotBlank() && IMAGE_EXT_REGEX.containsMatchIn(encodedPath)
        }
        return IMAGE_EXT_REGEX.containsMatchIn(trimmed)
    }

    fun basename(pathOrUrl: String): String {
        val noQuery = pathOrUrl.trim().substringBefore('#').substringBefore('?')
        return noQuery.substringAfterLast('/').substringAfterLast('\\').ifBlank { noQuery }
    }

    fun cleanFilePath(rawPath: String): String {
        val stripped = rawPath.trim()
            .removePrefix("file://")
            .substringBefore('#')
        val lineSuffix = Regex(""":\d+(?::\d+)?$""")
        return lineSuffix.replace(stripped, "")
    }

    fun resolveImageSourceUrl(baseUrl: String, rawSrc: String): String {
        val cleanBase = normalizeBaseUrl(baseUrl)
        val trimmed = rawSrc.trim()
        if (trimmed.isEmpty()) return ""
        if (trimmed.startsWith("https://", ignoreCase = true) ||
            trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("data:", ignoreCase = true)
        ) {
            return trimmed
        }
        if (trimmed.startsWith("/api/", ignoreCase = true)) {
            return "$cleanBase$trimmed"
        }
        val cleanPath = cleanFilePath(trimmed)
        return "$cleanBase/api/agent-files/raw?path=${cleanPath.encodeURLParameter(spaceToPlus = false)}"
    }

    /** Returns true when a URL targets the platform's authenticated `/api/agent-files/` endpoint. */
    fun isPlatformAgentFileUrl(rawUrlOrPath: String, baseUrl: String = ""): Boolean {
        val trimmed = rawUrlOrPath.trim()
        if (trimmed.isEmpty()) return false
        val lower = trimmed.lowercase()
        if (!lower.contains("/api/agent-files/")) return false
        if (lower.startsWith("/api/agent-files/")) return true
        val origin = extractOrigin(normalizeBaseUrl(baseUrl))
        return origin.isEmpty() || lower.startsWith("$origin/")
    }

    /** Only attach the platform Bearer token to relative URLs or URLs matching the configured server origin. */
    fun shouldAttachBearerAuth(urlString: String, baseUrl: String): Boolean {
        val trimmed = urlString.trim()
        if (trimmed.isEmpty()) return false
        if (trimmed.startsWith("/")) return true
        val origin = extractOrigin(normalizeBaseUrl(baseUrl))
        return origin.isNotEmpty() && trimmed.lowercase().startsWith("$origin/")
    }

    /** Extracts a human-friendly filename from an `/api/agent-files/...?path=...` URL or plain file URL. */
    fun extractAgentFileDisplayName(urlOrPath: String, fallback: String = "audio.mp3"): String {
        val trimmed = urlOrPath.trim()
        if (trimmed.isEmpty()) return fallback
        val query = trimmed.substringAfter('?', "")
        if (query.isNotEmpty()) {
            val rawPathParam = query.split('&')
                .firstOrNull { it.startsWith("path=", ignoreCase = true) }
                ?.substringAfter('=')
                ?.trim()
                .orEmpty()
            if (rawPathParam.isNotEmpty()) {
                val decoded = percentDecodeUtf8(rawPathParam)
                val name = basename(decoded)
                if (name.isNotBlank()) return name
            }
        }
        val base = basename(percentDecodeUtf8(trimmed))
        if (base.isNotBlank() && base !in setOf("view", "raw", "download", "stat")) {
            return base
        }
        return fallback
    }

    private fun extractOrigin(normalizedBaseUrl: String): String {
        val schemeIdx = normalizedBaseUrl.indexOf("://")
        if (schemeIdx < 0) return ""
        val pathIdx = normalizedBaseUrl.indexOf('/', schemeIdx + 3)
        return (if (pathIdx >= 0) normalizedBaseUrl.substring(0, pathIdx) else normalizedBaseUrl).lowercase()
    }

    private fun percentDecodeUtf8(input: String): String {
        if (!input.contains('%') && !input.contains('+')) return input
        val bytes = ByteArray(maxOf(input.length * 3, 32))
        var byteLen = 0
        var i = 0
        while (i < input.length) {
            val ch = input[i]
            if (ch == '%' && i + 2 < input.length) {
                val hi = input[i + 1].digitToIntOrNull(16)
                val lo = input[i + 2].digitToIntOrNull(16)
                if (hi != null && lo != null) {
                    bytes[byteLen++] = ((hi shl 4) or lo).toByte()
                    i += 3
                    continue
                }
            }
            if (ch == '+') {
                bytes[byteLen++] = ' '.code.toByte()
                i++
                continue
            }
            val utf8 = ch.toString().encodeToByteArray()
            utf8.copyInto(bytes, byteLen)
            byteLen += utf8.size
            i++
        }
        return bytes.copyOf(byteLen).decodeToString()
    }

    fun resolveAttachmentUrl(baseUrl: String, attachment: ChatAttachment): String {
        if (attachment.url.isNotBlank()) return resolveImageSourceUrl(baseUrl, attachment.url)
        if (attachment.path.isNotBlank()) return resolveImageSourceUrl(baseUrl, attachment.path)
        return ""
    }

    fun attachmentsFromUploadedFiles(files: List<UploadedFileInfo>, baseUrl: String): List<ChatAttachment> {
        return files.mapNotNull { file ->
            val cleanPath = file.path.trim()
            if (cleanPath.isEmpty()) return@mapNotNull null
            ChatAttachment(
                path = cleanPath,
                name = file.name.ifBlank { basename(cleanPath) },
                url = resolveImageSourceUrl(baseUrl, cleanPath)
            )
        }
    }

    fun extractMessageAttachmentsAndCleanText(
        rawContent: String,
        baseUrl: String,
        existingAttachments: List<ChatAttachment> = emptyList()
    ): Pair<String, List<ChatAttachment>> {
        val cleanBase = normalizeBaseUrl(baseUrl)
        val resultAttachments = mutableListOf<ChatAttachment>()
        val seenKeys = mutableSetOf<String>()

        fun addAttachment(path: String = "", name: String = "", url: String = "") {
            val cleanPath = cleanFilePath(path)
            val resolvedUrl = if (url.isNotBlank()) resolveImageSourceUrl(cleanBase, url) else resolveImageSourceUrl(cleanBase, cleanPath)
            val dedupKey = (cleanPath.ifBlank { resolvedUrl }).lowercase()
            if (dedupKey.isBlank() || !seenKeys.add(dedupKey)) return
            resultAttachments.add(
                ChatAttachment(
                    path = cleanPath,
                    name = name.ifBlank { basename(cleanPath.ifBlank { resolvedUrl }) },
                    url = resolvedUrl
                )
            )
        }

        existingAttachments.forEach { att ->
            addAttachment(path = att.path, name = att.name, url = att.url)
        }

        val markdownImageTargets = MARKDOWN_IMAGE_URL_REGEX.findAll(rawContent)
            .map { cleanFilePath(it.groupValues[1]).lowercase() }
            .toSet()

        val cleanedLines = mutableListOf<String>()
        val lines = rawContent.lines()
        var inUploadBlock = false
        for (line in lines) {
            val trimmed = line.trim()
            if (UPLOAD_BLOCK_HEADER_REGEX.matches(trimmed)) {
                inUploadBlock = true
                continue
            }
            if (inUploadBlock) {
                val mdBullet = UPLOAD_MD_BULLET_REGEX.matchEntire(trimmed)
                if (mdBullet != null) {
                    val label = mdBullet.groupValues[1].trim()
                    val filePath = mdBullet.groupValues[2].trim()
                    addAttachment(path = filePath, name = label.ifBlank { basename(filePath) })
                    continue
                }
                val bullet = UPLOAD_BULLET_LINE_REGEX.matchEntire(trimmed)
                if (bullet != null) {
                    val label = bullet.groupValues[1].trim()
                    val filePath = bullet.groupValues[2].trim()
                    addAttachment(path = filePath, name = label.ifBlank { basename(filePath) })
                    continue
                }
                if (trimmed.isEmpty()) {
                    inUploadBlock = false
                    continue
                }
                inUploadBlock = false
            }

            // Strip redundant desktop placeholder lines like "[media_...png]" when an attachment matches
            if (trimmed.startsWith("[") && trimmed.endsWith("]") && trimmed.length in 3..140) {
                val inner = trimmed.removePrefix("[").removeSuffix("]").trim()
                val matchesExisting = existingAttachments.any {
                    it.name.equals(inner, ignoreCase = true) ||
                        basename(it.path).equals(inner, ignoreCase = true) ||
                        inner.startsWith("图片") ||
                        inner.startsWith("Image #")
                }
                if (matchesExisting) continue
            }

            cleanedLines.add(line)
        }

        var cleanedText = cleanedLines.joinToString("\n").trim()

        // Extract standalone or inline local image paths / /api/agent-files/raw links outside code fences
        val textWithoutCode = cleanedText.replace(Regex("""```[\s\S]*?```"""), "")
        for (m in RAW_API_IMAGE_REGEX.findAll(textWithoutCode)) {
            val rawUrl = m.value
            val fullUrl = resolveImageSourceUrl(cleanBase, rawUrl)
            if (isImageReference(rawUrl) && cleanFilePath(rawUrl).lowercase() !in markdownImageTargets) {
                addAttachment(path = rawUrl, url = fullUrl)
            }
        }
        for (m in LOCAL_IMAGE_PATH_REGEX.findAll(textWithoutCode)) {
            val matchedPath = cleanFilePath(m.groupValues[1])
            if (matchedPath.lowercase() in markdownImageTargets) continue
            // Skip paths referenced inside Markdown `[label](file:///...png)` only if rendered inside `![]()`, else include
            addAttachment(path = matchedPath, name = basename(matchedPath))
        }

        cleanedText = cleanedText.replace(Regex("""\n{3,}"""), "\n\n").trim()
        return cleanedText to resultAttachments
    }

    fun appendUploadedFilesPrompt(
        draftText: String,
        files: List<UploadedFileInfo>,
        language: String
    ): String {
        if (files.isEmpty()) return draftText
        // Must emit Markdown link `(<path>)` matching backend `agentArtifacts.uploadsIn` & Web `attachmentBlock()`.
        val pathsBlock = files.joinToString("\n") { file ->
            val rawLabel = file.name.ifBlank { file.path.substringAfterLast('/') }
            val safeLabel = rawLabel.replace("[", "").replace("]", "").ifBlank { "attachment" }
            "- [$safeLabel](<${file.path}>)"
        }
        val base = draftText.trim().ifEmpty {
            if (language == "en") "Please look at the attached files." else "请看一下附件。"
        }
        return "$base\n\n📎 附件：\n$pathsBlock"
    }

    private fun ensureUniqueMessageId(
        rawId: String,
        fallbackPrefix: String,
        index: Int,
        seenIds: MutableSet<String>
    ): String {
        val baseId = rawId.trim().ifBlank { "${fallbackPrefix}_$index" }
        if (seenIds.add(baseId)) return baseId
        var suffix = 2
        var candidate = "${baseId}_#$suffix"
        while (!seenIds.add(candidate)) {
            suffix += 1
            candidate = "${baseId}_#$suffix"
        }
        return candidate
    }

    fun mapStoredMessages(items: List<SessionMessageItem>, baseUrl: String = ""): List<ChatMessage> {
        val seenIds = HashSet<String>(items.size)
        val mapped = items.mapIndexed { index, item ->
            val role = if (item.role == "user") "user" else "model"
            val traces = extractToolTracesFromEvents(item.events)
            val approvals = extractApprovalsFromEvents(item.events)
            val thinking = extractThinkingFromEvents(item.events)
            val author = extractSharedAuthor(item.events)
            val (cleanedText, extractedAttachments) = extractMessageAttachmentsAndCleanText(
                rawContent = item.content,
                baseUrl = baseUrl
            )
            val uniqueId = ensureUniqueMessageId(
                rawId = item.id,
                fallbackPrefix = "${item.created_at.orEmpty()}_${role}_${item.content.hashCode()}",
                index = index,
                seenIds = seenIds
            )
            ChatMessage(
                id = uniqueId,
                role = role,
                content = cleanedText,
                thinking = thinking,
                createdAt = item.created_at,
                toolCalls = traces,
                attachments = extractedAttachments,
                rawContent = item.content,
                inputTokens = item.input_tokens,
                outputTokens = item.output_tokens,
                modelName = item.model_name,
                interrupted = item.interrupted,
                isStreaming = false,
                approvals = approvals,
                sharedAuthor = author?.first,
                sharedAuthorName = author?.second
            )
        }
        return mergeConsecutiveAssistantMessages(mapped)
    }

    /** 共享对话里其他成员的消息带 { type: 'shared_author', author, name } 事件：返回 (账号, 显示名) */
    fun extractSharedAuthor(events: JsonArray?): Pair<String, String>? {
        if (events == null) return null
        for (el in events) {
            val obj = el as? JsonObject ?: continue
            if ((obj["type"] as? JsonPrimitive)?.contentOrNull != "shared_author") continue
            val author = (obj["author"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
            if (author.isEmpty()) continue
            val name = (obj["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty().ifEmpty { author }
            return author to name
        }
        return null
    }

    /** 对话标题里的附件链接 [名称](<路径>) 只保留名称，末尾被截断的 "[..." 去掉 */
    fun cleanShareTitle(raw: String): String =
        raw.replace(Regex("\\[([^\\]]*)\\]\\(<[^>]*>\\)"), "$1")
            .replace(Regex("\\s*\\[[^\\]]*$"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(160)

    /** 共享面板的账号搜索：账号名 / 显示名包含，或拼音（全拼、首字母）命中显示名 */
    fun matchesShareAccount(account: ShareAccount, query: String): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        return account.username.lowercase().contains(q) || account.name.lowercase().contains(q)
    }

    /** 搜索时完全匹配 / 前缀匹配排前面；不搜索时最近共享过的排前面，其余按账号自然顺序 */
    fun sortShareAccounts(accounts: List<ShareAccount>, query: String, recent: List<ShareRecentUser>): List<ShareAccount> {
        val q = query.trim().lowercase()
        val recentRank = recent.mapIndexed { index, user -> user.username to index }.toMap()
        fun natural(a: ShareAccount, b: ShareAccount): Int {
            val pa = Regex("^(.*?)(\\d+)$").find(a.username)
            val pb = Regex("^(.*?)(\\d+)$").find(b.username)
            if (pa != null && pb != null && pa.groupValues[1] == pb.groupValues[1]) {
                val na = pa.groupValues[2].toLongOrNull() ?: 0L
                val nb = pb.groupValues[2].toLongOrNull() ?: 0L
                if (na != nb) return na.compareTo(nb)
            }
            return a.username.compareTo(b.username)
        }
        return accounts.filter { matchesShareAccount(it, q) }.sortedWith { a, b ->
            if (q.isNotEmpty()) {
                fun rank(x: ShareAccount): Int {
                    val u = x.username.lowercase(); val n = x.name.lowercase()
                    return if (u == q || n == q) 0 else if (u.startsWith(q) || n.startsWith(q)) 1 else 2
                }
                val r = rank(a).compareTo(rank(b))
                if (r != 0) return@sortedWith r
            } else {
                val r = (recentRank[a.username] ?: 999).compareTo(recentRank[b.username] ?: 999)
                if (r != 0) return@sortedWith r
            }
            natural(a, b)
        }
    }

    fun mapDesktopAgentMessages(items: List<DesktopAgentMessageItem>, baseUrl: String = ""): List<ChatMessage> {
        val cleanBase = normalizeBaseUrl(baseUrl)
        val seenIds = HashSet<String>(items.size)
        val mapped = items.mapIndexedNotNull { index, item ->
            val structuredAttachments = item.attachments.mapNotNull { att ->
                val rawPath = att.path.trim()
                if (rawPath.isEmpty()) return@mapNotNull null
                ChatAttachment(
                    path = rawPath,
                    name = att.name.ifBlank { basename(rawPath) },
                    url = resolveImageSourceUrl(cleanBase, rawPath)
                )
            }
            val (cleanedText, mergedAttachments) = extractMessageAttachmentsAndCleanText(
                rawContent = item.content,
                baseUrl = cleanBase,
                existingAttachments = structuredAttachments
            )
            if (cleanedText.isEmpty() && mergedAttachments.isEmpty()) return@mapIndexedNotNull null
            val role = if (item.role == "user") "user" else "model"
            val lastRound = item.rounds.lastOrNull()
            val totalIn = item.rounds.mapNotNull { it.inputTokens }.takeIf { it.isNotEmpty() }?.sum()
            val totalOut = item.rounds.mapNotNull { it.outputTokens }.takeIf { it.isNotEmpty() }?.sum()
            val uniqueId = ensureUniqueMessageId(
                rawId = item.id,
                fallbackPrefix = "${item.createdAt.orEmpty()}_${role}_${cleanedText.hashCode()}_${mergedAttachments.size}",
                index = index,
                seenIds = seenIds
            )
            ChatMessage(
                id = uniqueId,
                role = role,
                content = cleanedText,
                createdAt = item.createdAt,
                attachments = mergedAttachments,
                inputTokens = totalIn,
                outputTokens = totalOut,
                modelName = lastRound?.model?.takeIf { it.isNotBlank() },
                isStreaming = false
            )
        }
        return mergeConsecutiveAssistantMessages(mapped)
    }

    /**
     * Merges consecutive non-user assistant segments within a single turn into one unified
     * turn message while preserving chronological thinking, tools, text, attachments, and totals.
     */
    fun mergeConsecutiveAssistantMessages(messages: List<ChatMessage>): List<ChatMessage> {
        if (messages.size <= 1) return messages
        val merged = ArrayList<ChatMessage>(messages.size)
        for (msg in messages) {
            val prev = merged.lastOrNull()
            // 共享对话：不同成员的 AI 回答各自成段，不合并
            if (prev == null || msg.isUser || prev.isUser || prev.sharedAuthor != msg.sharedAuthor) {
                merged.add(msg)
                continue
            }
            val mergedContents = mutableListOf<String>()
            prev.content.trim().takeIf { it.isNotEmpty() }?.let { mergedContents.add(it) }
            val nextText = msg.content.trim()
            if (nextText.isNotEmpty() && mergedContents.lastOrNull() != nextText) {
                mergedContents.add(nextText)
            }

            val mergedThinking = listOf(prev.thinking.trim(), msg.thinking.trim())
                .filter { it.isNotEmpty() }
                .distinct()
                .joinToString("\n\n")

            val traceMap = linkedMapOf<String, ToolCallTrace>()
            for (t in prev.toolCalls) {
                traceMap[t.callId.ifBlank { t.toolName + ":" + traceMap.size }] = t
            }
            for (t in msg.toolCalls) {
                traceMap[t.callId.ifBlank { t.toolName + ":" + traceMap.size }] = t
            }

            val attSeen = linkedSetOf<String>()
            val mergedAtts = mutableListOf<ChatAttachment>()
            for (att in prev.attachments + msg.attachments) {
                val key = (att.url.ifBlank { att.path }).lowercase()
                if (key.isEmpty() || attSeen.add(key)) {
                    mergedAtts.add(att)
                }
            }

            val rawParts = mutableListOf<String>()
            prev.rawContent?.trim()?.takeIf { it.isNotEmpty() }?.let { rawParts.add(it) }
            val nextRaw = msg.rawContent?.trim().orEmpty()
            if (nextRaw.isNotEmpty() && rawParts.lastOrNull() != nextRaw) {
                rawParts.add(nextRaw)
            }

            val sumIn = listOfNotNull(prev.inputTokens, msg.inputTokens).takeIf { it.isNotEmpty() }?.sum()
            val sumOut = listOfNotNull(prev.outputTokens, msg.outputTokens).takeIf { it.isNotEmpty() }?.sum()
            val approvalMap = linkedMapOf<String, PendingApproval>()
            for (ap in prev.approvals) approvalMap[ap.callId.ifBlank { ap.id }] = ap
            for (ap in msg.approvals) approvalMap[ap.callId.ifBlank { ap.id }] = ap

            merged[merged.lastIndex] = prev.copy(
                content = mergedContents.joinToString("\n\n"),
                thinking = mergedThinking,
                createdAt = prev.createdAt ?: msg.createdAt,
                statusText = msg.statusText ?: prev.statusText.takeIf { msg.isStreaming },
                toolCalls = traceMap.values.toList(),
                attachments = mergedAtts,
                rawContent = rawParts.joinToString("\n\n").ifBlank { null },
                inputTokens = sumIn,
                outputTokens = sumOut,
                modelName = msg.modelName?.takeIf { it.isNotBlank() } ?: prev.modelName,
                interrupted = msg.interrupted,
                isStreaming = prev.isStreaming || msg.isStreaming,
                approvals = approvalMap.values.toList()
            )
        }
        return merged
    }

    /**
     * Stitches newly polled desktop tail items onto an already-loaded older transcript list
     * without duplicating overlapping items or losing older pages scrolled into view.
     */
    fun mergeDesktopTailItems(
        existing: List<DesktopAgentMessageItem>,
        incomingTail: List<DesktopAgentMessageItem>
    ): List<DesktopAgentMessageItem> {
        if (existing.isEmpty() || incomingTail.isEmpty()) return incomingTail
        val anchor = incomingTail.first()
        val searchStart = (existing.size - incomingTail.size - 16).coerceAtLeast(0)
        for (i in searchStart until existing.size) {
            if (!sameDesktopAnchorItem(existing[i], anchor)) continue
            if (anchor.id.isNotBlank() && existing[i].id == anchor.id) {
                return if (i == 0) incomingTail else existing.subList(0, i) + incomingTail
            }
            // For ID-less transcripts (e.g. Antigravity DOM), verify at least 1-2 leading stable items align.
            val checkCount = minOf(2, incomingTail.size, existing.size - i)
            var matched = true
            for (k in 0 until checkCount) {
                if (!sameDesktopAnchorItem(existing[i + k], incomingTail[k])) {
                    matched = false
                    break
                }
            }
            if (matched) {
                return if (i == 0) incomingTail else existing.subList(0, i) + incomingTail
            }
        }
        return if (existing.size <= incomingTail.size) incomingTail else existing
    }

    private fun sameDesktopAnchorItem(a: DesktopAgentMessageItem, b: DesktopAgentMessageItem): Boolean {
        if (a.id.isNotBlank() && b.id.isNotBlank()) {
            return a.id == b.id && a.role == b.role
        }
        return a.role == b.role &&
            a.content == b.content &&
            a.createdAt == b.createdAt
    }

    fun isBusyQueueableError(errorText: String?): Boolean {
        val raw = errorText?.trim().orEmpty()
        if (raw.isEmpty()) return false
        return raw.contains("正在运行") ||
            raw.contains("正在执行") ||
            raw.contains("请等待") ||
            raw.contains("请先停止") ||
            raw.contains("DESKTOP_BUSY", ignoreCase = true) ||
            raw.contains("AI_CHAT_BUSY", ignoreCase = true) ||
            raw.contains("AGENT_RUN_BUSY", ignoreCase = true)
    }

    private fun extractThinkingFromEvents(events: kotlinx.serialization.json.JsonArray?): String {
        if (events == null) return ""
        val sb = StringBuilder()
        for (el in events) {
            val obj = el as? JsonObject ?: continue
            val type = (obj["type"] as? JsonPrimitive)?.contentOrNull ?: continue
            if (type == "thinking") {
                val text = (obj["delta"] as? JsonPrimitive)?.contentOrNull
                    ?: (obj["text"] as? JsonPrimitive)?.contentOrNull
                if (!text.isNullOrEmpty()) sb.append(text)
            }
        }
        return sb.toString()
    }

    private fun extractToolTracesFromEvents(events: kotlinx.serialization.json.JsonArray?): List<ToolCallTrace> {
        if (events == null) return emptyList()
        val ordered = linkedMapOf<String, ToolCallTrace>()
        var seq = 0
        for (el in events) {
            val obj = el as? JsonObject ?: continue
            val type = (obj["type"] as? JsonPrimitive)?.contentOrNull ?: continue
            val tool = (obj["tool"] as? JsonPrimitive)?.contentOrNull ?: continue
            val callId = (obj["callId"] as? JsonPrimitive)?.contentOrNull ?: "evt_${seq++}_$tool"
            when (type) {
                "tool_start" -> {
                    val argsText = obj["args"]?.toString()?.take(180).orEmpty()
                    ordered[callId] = ToolCallTrace(callId = callId, toolName = tool, argsSummary = argsText, isFinished = false)
                }
                "tool_result" -> {
                    val ok = (obj["ok"] as? JsonPrimitive)?.contentOrNull?.toBooleanStrictOrNull() ?: true
                    val summary = (obj["summary"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                    val durationMs = (obj["durationMs"] as? JsonPrimitive)?.contentOrNull?.toLongOrNull()
                    val existing = ordered[callId]
                    ordered[callId] = ToolCallTrace(
                        callId = callId,
                        toolName = tool,
                        argsSummary = existing?.argsSummary.orEmpty(),
                        summary = summary,
                        ok = ok,
                        durationMs = durationMs,
                        isFinished = true
                    )
                }
            }
        }
        return ordered.values.toList()
    }

    fun toolDisplayName(toolName: String, language: String): String {
        val en = language.lowercase().startsWith("en")
        return when (toolName) {
            "run_command" -> if (en) "Run command" else "执行命令"
            "write_file" -> if (en) "Write file" else "写入文件"
            "edit_file" -> if (en) "Edit file" else "修改文件"
            "multi_edit" -> if (en) "Edit files" else "批量修改文件"
            "delete_path" -> if (en) "Delete path" else "删除文件/目录"
            "rename_path" -> if (en) "Rename path" else "重命名"
            "zip_files" -> if (en) "Archive files" else "打包压缩"
            "unzip_file" -> if (en) "Extract archive" else "解压文件"
            "save_skill" -> if (en) "Save skill" else "保存技能"
            "publish_html_tool" -> if (en) "Publish tool" else "发布工具"
            "send_notification", "welink_send_message" -> if (en) "Send notification" else "发送通知"
            "welink_action" -> if (en) "WeLink action" else "WeLink 写操作"
            "browser_navigate", "browser_click", "browser_type", "browser_login" -> if (en) "Browser action" else "浏览器操作"
            "insert_database_row", "update_database_rows", "delete_database_rows" -> if (en) "Modify database" else "修改数据库"
            "save_uiv_script", "move_uiv_script", "delete_uiv_script", "manage_uiv_category" -> if (en) "Manage script" else "脚本变更"
            "sla_update_metric_conditions", "sla_revert_metric_rule_change" -> if (en) "Update SLA rules" else "修改指标规则"
            else -> toolName
        }
    }

    fun approvalStatusLabel(decision: String?, scope: String?, language: String): String {
        val en = language.lowercase().startsWith("en")
        return when (decision) {
            "allow" -> if (en) "Allowed" else "已允许"
            "full" -> if (en) "Full access enabled for this chat" else "本对话已开启完全访问"
            "always" -> when (scope) {
                "global" -> if (en) "Allowed permanently" else "已永久放行此类操作"
                "workspace" -> if (en) "Allowed in this workspace" else "本工作目录此类操作已放行"
                "session" -> if (en) "Allowed in this chat" else "本对话此类操作已放行"
                else -> if (en) "Always allowed in this chat" else "本对话已总是允许"
            }
            "deny" -> if (en) "Denied" else "已拒绝"
            "timeout" -> if (en) "Approval timed out" else "审批已超时，未执行"
            "abort", "aborted" -> if (en) "Stopped" else "已中止"
            else -> if (en) "Settled" else "已处理"
        }
    }

    internal fun parsePendingApproval(
        id: String,
        callId: String,
        runId: String,
        toolName: String,
        preview: JsonObject?,
        approvalUrl: String?,
        permissionMode: String?,
        noAlways: Boolean?,
        expiresInMs: Long?,
        status: String = "pending",
        chosenDecision: String? = null,
        chosenScope: String? = null
    ): PendingApproval {
        fun str(key: String): String = (preview?.get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
        fun intVal(key: String): Int = (preview?.get(key) as? JsonPrimitive)?.intOrNull ?: 0
        fun boolVal(key: String): Boolean = (preview?.get(key) as? JsonPrimitive)?.booleanOrNull ?: false

        val fields = (preview?.get("fields") as? JsonArray)?.mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            val label = (obj["label"] as? JsonPrimitive)?.contentOrNull
                ?: (obj["name"] as? JsonPrimitive)?.contentOrNull
                ?: ""
            val value = (obj["value"] as? JsonPrimitive)?.contentOrNull ?: obj["value"]?.toString().orEmpty()
            if (label.isBlank() && value.isBlank()) null else ApprovalPreviewField(label = label, value = value)
        }.orEmpty()

        val risks = (preview?.get("risk") as? JsonArray)?.mapNotNull {
            (it as? JsonPrimitive)?.contentOrNull?.takeIf { s -> s.isNotBlank() }
        }.orEmpty()

        val dangers = (preview?.get("danger") as? JsonArray)?.mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            ApprovalDangerItem(
                category = (obj["category"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                label = (obj["label"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                reason = (obj["reason"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            )
        }.orEmpty()

        val dangerScopes = (preview?.get("dangerScopes") as? JsonArray)?.mapNotNull {
            (it as? JsonPrimitive)?.contentOrNull?.takeIf { s -> s.isNotBlank() }
        }.orEmpty()

        return PendingApproval(
            id = id.ifBlank { callId },
            callId = callId.ifBlank { id },
            runId = runId,
            toolName = toolName.ifBlank { "tool" },
            approvalUrl = approvalUrl?.takeIf { it.isNotBlank() },
            permissionMode = permissionMode?.takeIf { it.isNotBlank() } ?: "auto",
            noAlways = noAlways == true,
            command = str("command"),
            cwd = str("cwd"),
            filePath = str("path"),
            diff = str("diff"),
            added = intVal("added"),
            removed = intVal("removed"),
            renameTo = str("to"),
            recursive = boolVal("recursive"),
            channel = str("channel"),
            targets = str("targets"),
            message = str("message"),
            title = str("title"),
            impact = str("impact"),
            fields = fields,
            risks = risks,
            dangers = dangers,
            dangerScopes = dangerScopes,
            status = status,
            chosenDecision = chosenDecision,
            chosenScope = chosenScope,
            expiresInMs = expiresInMs
        )
    }

    private fun extractApprovalsFromEvents(events: kotlinx.serialization.json.JsonArray?): List<PendingApproval> {
        if (events == null) return emptyList()
        val ordered = linkedMapOf<String, PendingApproval>()
        var seq = 0
        for (el in events) {
            val obj = el as? JsonObject ?: continue
            val type = (obj["type"] as? JsonPrimitive)?.contentOrNull ?: continue
            when (type) {
                "approval" -> {
                    val tool = (obj["tool"] as? JsonPrimitive)?.contentOrNull ?: "tool"
                    val callId = (obj["callId"] as? JsonPrimitive)?.contentOrNull ?: "ap_${seq++}_$tool"
                    val id = (obj["id"] as? JsonPrimitive)?.contentOrNull ?: callId
                    val preview = obj["preview"] as? JsonObject
                    val ap = parsePendingApproval(
                        id = id,
                        callId = callId,
                        runId = (obj["runId"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
                        toolName = tool,
                        preview = preview,
                        approvalUrl = (obj["approvalUrl"] as? JsonPrimitive)?.contentOrNull,
                        permissionMode = (obj["permissionMode"] as? JsonPrimitive)?.contentOrNull,
                        noAlways = (obj["noAlways"] as? JsonPrimitive)?.booleanOrNull,
                        expiresInMs = (obj["expiresInMs"] as? JsonPrimitive)?.longOrNull,
                        status = "settled",
                        chosenDecision = "aborted"
                    )
                    ordered[callId] = ap
                }
                "approval_result" -> {
                    val callId = (obj["callId"] as? JsonPrimitive)?.contentOrNull ?: continue
                    val decision = (obj["decision"] as? JsonPrimitive)?.contentOrNull
                    val scope = (obj["scope"] as? JsonPrimitive)?.contentOrNull
                    val existing = ordered[callId]
                    if (existing != null) {
                        ordered[callId] = existing.copy(
                            status = "settled",
                            chosenDecision = decision,
                            chosenScope = scope
                        )
                    }
                }
            }
        }
        return ordered.values.toList()
    }

    /**
     * Computes an aesthetically proportioned frame in logical points/dp for a single image across
     * normal, panoramic/strip, stitched-tall, and small-icon aspect ratios without cropping or upscaling.
     */
    fun computeAestheticSingleImageFrame(
        pixelWidth: Int,
        pixelHeight: Int,
        maxContainerWidth: Double = 246.0
    ): AestheticImageFrame {
        fun snap(v: Double): Double = kotlin.math.round(v * 2.0) / 2.0
        val safeMaxW = maxContainerWidth.coerceAtLeast(160.0)
        if (pixelWidth <= 0 || pixelHeight <= 0) {
            return AestheticImageFrame(
                width = snap(safeMaxW.coerceAtMost(208.0)),
                height = 148.0,
                innerPadding = 0.0,
                needsBackdropFrame = true
            )
        }

        val wPx = pixelWidth.toDouble()
        val hPx = pixelHeight.toDouble()
        val ratio = wPx / hPx

        if (ratio > 1.85) {
            // Wide banners / cropped horizontal strips: avoid stretching full screen width or blowing up small banners.
            val logicalW = (wPx / 1.5).coerceIn(176.0, safeMaxW.coerceAtMost(244.0))
            val fitH = logicalW / ratio
            return if (fitH >= 80.0) {
                AestheticImageFrame(
                    width = snap(logicalW),
                    height = snap(fitH.coerceAtMost(220.0)),
                    innerPadding = 0.0,
                    needsBackdropFrame = false
                )
            } else {
                AestheticImageFrame(
                    width = snap(logicalW),
                    height = snap(fitH.coerceAtLeast(74.0)),
                    innerPadding = 10.0,
                    needsBackdropFrame = true
                )
            }
        }

        if (ratio >= 1.0) {
            // Standard landscape & square images: balanced visual weight without excessive upscaling of tiny icons.
            val capW = safeMaxW.coerceAtMost(if (ratio >= 1.35) 244.0 else 212.0)
            val targetW = if (wPx < capW * 1.35 && hPx < 240.0) {
                (wPx / 1.25).coerceIn(88.0, capW)
            } else {
                capW
            }
            val fitH = (targetW / ratio).coerceIn(88.0, 236.0)
            val balancedW = (fitH * ratio).coerceIn(88.0, capW)
            val tiny = wPx < 160.0 && hPx < 160.0
            return AestheticImageFrame(
                width = snap(balancedW),
                height = snap(fitH),
                innerPadding = if (tiny) 6.0 else 0.0,
                needsBackdropFrame = tiny
            )
        }

        // Portrait & tall stitched images.
        val capH = if (ratio >= 0.68) 228.0 else 252.0
        val targetH = if (hPx < capH * 1.35 && wPx < 240.0) {
            (hPx / 1.25).coerceIn(112.0, capH)
        } else {
            capH
        }
        val fitW = targetH * ratio
        return if (fitW >= 114.0) {
            val boundedW = fitW.coerceAtMost(safeMaxW.coerceAtMost(208.0))
            val boundedH = (boundedW / ratio).coerceAtMost(capH)
            AestheticImageFrame(
                width = snap(boundedW),
                height = snap(boundedH),
                innerPadding = 0.0,
                needsBackdropFrame = false
            )
        } else {
            // Ultra-tall stitched screenshot: keep readable card width with tasteful inset fit.
            AestheticImageFrame(
                width = snap(safeMaxW.coerceAtMost(138.0)),
                height = snap(capH),
                innerPadding = 8.0,
                needsBackdropFrame = true
            )
        }
    }

    /** Groups consecutive Markdown image blocks into decks while leaving individual blocks separate. */
    fun buildMarkdownRenderRuns(blocks: List<MdBlock>): List<MarkdownRenderRun> {
        if (blocks.isEmpty()) return emptyList()
        val runs = mutableListOf<MarkdownRenderRun>()
        var idx = 0
        while (idx < blocks.size) {
            val current = blocks[idx]
            if (current.kind == MdBlockKind.IMAGE && current.imageUrl.isNotBlank()) {
                val collected = mutableListOf<MdBlock>()
                while (idx < blocks.size && blocks[idx].kind == MdBlockKind.IMAGE && blocks[idx].imageUrl.isNotBlank()) {
                    collected.add(blocks[idx])
                    idx += 1
                }
                if (collected.size >= 2) {
                    runs.add(MarkdownRenderRun(block = null, imageGroup = collected))
                } else {
                    runs.add(MarkdownRenderRun(block = collected.first(), imageGroup = emptyList()))
                }
            } else {
                runs.add(MarkdownRenderRun(block = current, imageGroup = emptyList()))
                idx += 1
            }
        }
        return runs
    }

    /** Studio ascending major-fifth chime (C5 -> G5) signaling voice call opened / mic live. */
    fun generateVoiceOpenCueWav(sampleRate: Int = 24_000): ByteArray {
        return synthesizeStudioChimeWav(
            sampleRate = sampleRate,
            totalSec = 0.255,
            freqs = doubleArrayOf(523.25, 783.99),
            startsSec = doubleArrayOf(0.0, 0.088),
            dursSec = doubleArrayOf(0.145, 0.165),
            harmonicMix = 0.16,
            amplitude = 0.30
        )
    }

    /** Calm descending fifth chime (D5 -> G4) signaling voice call ended / mic closed. */
    fun generateVoiceCloseCueWav(sampleRate: Int = 24_000): ByteArray {
        return synthesizeStudioChimeWav(
            sampleRate = sampleRate,
            totalSec = 0.295,
            freqs = doubleArrayOf(587.33, 392.00),
            startsSec = doubleArrayOf(0.0, 0.098),
            dursSec = doubleArrayOf(0.155, 0.195),
            harmonicMix = 0.10,
            amplitude = 0.26
        )
    }

    private fun synthesizeStudioChimeWav(
        sampleRate: Int,
        totalSec: Double,
        freqs: DoubleArray,
        startsSec: DoubleArray,
        dursSec: DoubleArray,
        harmonicMix: Double,
        amplitude: Double
    ): ByteArray {
        val rate = sampleRate.coerceIn(16_000, 48_000)
        val totalSamples = (rate * totalSec).roundToInt().coerceAtLeast(1)
        val dataSize = totalSamples * 2
        val wav = ByteArray(44 + dataSize)

        // Write standard 44-byte RIFF/WAVE mono 16-bit PCM header
        "RIFF".encodeToByteArray().copyInto(wav, 0)
        writeInt32LE(wav, 4, 36 + dataSize)
        "WAVEfmt ".encodeToByteArray().copyInto(wav, 8)
        writeInt32LE(wav, 16, 16)
        writeInt16LE(wav, 20, 1)
        writeInt16LE(wav, 22, 1)
        writeInt32LE(wav, 24, rate)
        writeInt32LE(wav, 28, rate * 2)
        writeInt16LE(wav, 32, 2)
        writeInt16LE(wav, 34, 16)
        "data".encodeToByteArray().copyInto(wav, 36)
        writeInt32LE(wav, 40, dataSize)

        val attackSec = 0.012
        for (s in 0 until totalSamples) {
            val t = s.toDouble() / rate.toDouble()
            var mix = 0.0
            for (n in freqs.indices) {
                val localT = t - startsSec[n]
                val dur = dursSec[n]
                if (localT >= 0.0 && localT <= dur) {
                    val attack = if (localT < attackSec) sin((localT / attackSec) * (PI / 2.0)) else 1.0
                    val norm = (localT / dur).coerceIn(0.0, 1.0)
                    val decay = exp(-4.8 * norm) * (1.0 - norm * norm * 0.25)
                    val f = freqs[n]
                    val tone = sin(2.0 * PI * f * localT) + harmonicMix * sin(2.0 * PI * (f * 2.0) * localT)
                    mix += tone * attack * decay
                }
            }
            val sampleVal = (mix * amplitude * 32767.0).roundToInt().coerceIn(-32767, 32767)
            val byteIdx = 44 + s * 2
            wav[byteIdx] = (sampleVal and 0xFF).toByte()
            wav[byteIdx + 1] = ((sampleVal ushr 8) and 0xFF).toByte()
        }
        return wav
    }

    private fun writeInt32LE(dst: ByteArray, offset: Int, value: Int) {
        dst[offset] = (value and 0xFF).toByte()
        dst[offset + 1] = ((value ushr 8) and 0xFF).toByte()
        dst[offset + 2] = ((value ushr 16) and 0xFF).toByte()
        dst[offset + 3] = ((value ushr 24) and 0xFF).toByte()
    }

    private fun writeInt16LE(dst: ByteArray, offset: Int, value: Int) {
        dst[offset] = (value and 0xFF).toByte()
        dst[offset + 1] = ((value ushr 8) and 0xFF).toByte()
    }

    fun localizedAccountRole(role: String, isSuper: Boolean, language: String): String {
        val isEn = language.equals("en", ignoreCase = true)
        val normalized = role.trim().lowercase()
        return when {
            isSuper || normalized == "super" || normalized == "superadmin" || normalized == "super_admin" ->
                if (isEn) "Super Admin" else "超级管理员"
            normalized == "admin" ->
                if (isEn) "Admin" else "管理员"
            else ->
                if (isEn) "Member" else "成员"
        }
    }
}

object VoicePersonaCatalog {
    const val DEFAULT_VOICE_ID = "Kore"
    const val SETTINGS_KEY_VOICE_ID = "voice_persona_id"

    val presets: List<VoicePersonaOption> = listOf(
        VoicePersonaOption(
            id = "Kore",
            labelZh = "知性女声 · Kore",
            labelEn = "Balanced · Kore",
            styleHintZh = "稳重清晰，语速稳定",
            styleHintEn = "Poised, crisp & consistent"
        ),
        VoicePersonaOption(
            id = "Aoede",
            labelZh = "温柔女声 · Aoede",
            labelEn = "Warm · Aoede",
            styleHintZh = "温和舒缓，亲和自然",
            styleHintEn = "Warm & conversational"
        ),
        VoicePersonaOption(
            id = "Zephyr",
            labelZh = "轻快女声 · Zephyr",
            labelEn = "Bright · Zephyr",
            styleHintZh = "清亮简洁，响应明快",
            styleHintEn = "Clear & brisk"
        ),
        VoicePersonaOption(
            id = "Charon",
            labelZh = "沉稳男声 · Charon",
            labelEn = "Deep · Charon",
            styleHintZh = "低沉专业，冷静克制",
            styleHintEn = "Calm, grounded male"
        ),
        VoicePersonaOption(
            id = "Puck",
            labelZh = "干练男声 · Puck",
            labelEn = "Crisp · Puck",
            styleHintZh = "轻快直率，干净利落",
            styleHintEn = "Direct & upbeat male"
        )
    )

    fun normalizeVoiceId(raw: String?): String {
        val candidate = raw?.trim().orEmpty()
        if (candidate.isEmpty()) return DEFAULT_VOICE_ID
        return presets.firstOrNull { it.id.equals(candidate, ignoreCase = true) }?.id ?: DEFAULT_VOICE_ID
    }

    fun optionFor(raw: String?): VoicePersonaOption {
        val normalized = normalizeVoiceId(raw)
        return presets.firstOrNull { it.id == normalized } ?: presets.first()
    }
}

/**
 * Incremental clause segmenter used during SSE delta streaming to kick off TTS synthesis
 * on completed leading clauses while the LLM is still streaming the rest of the reply.
 */
class StreamingSpeechSegmenter {
    private var consumedRawOffset: Int = 0
    private var emittedChunkCount: Int = 0

    fun reset() {
        consumedRawOffset = 0
        emittedChunkCount = 0
    }

    fun consumeAccumulated(accumulatedRaw: String, isFinal: Boolean): List<String> {
        if (accumulatedRaw.isEmpty()) {
            if (isFinal) consumedRawOffset = 0
            return emptyList()
        }
        val safeOffset = consumedRawOffset.coerceIn(0, accumulatedRaw.length)
        if (isFinal) {
            val tailRaw = accumulatedRaw.substring(safeOffset)
            consumedRawOffset = accumulatedRaw.length
            val speech = MarkdownParser.toSpeechText(tailRaw).trim()
            if (speech.isNotEmpty()) {
                emittedChunkCount++
                return listOf(speech)
            }
            return emptyList()
        }

        val emitted = mutableListOf<String>()
        while (consumedRawOffset < accumulatedRaw.length) {
            val rem = accumulatedRaw.substring(consumedRawOffset)
            val baseFenceCount = countCodeFences(accumulatedRaw, consumedRawOffset)
            val splitPos = findFirstStableSplit(rem, startsInCodeFence = (baseFenceCount % 2 == 1), isFirstChunk = (emittedChunkCount == 0))
            if (splitPos <= 0) break

            val candidateRaw = rem.substring(0, splitPos)
            val speech = MarkdownParser.toSpeechText(candidateRaw).trim()
            if (speech.isEmpty()) {
                consumedRawOffset += splitPos
                continue
            }
            consumedRawOffset += splitPos
            emittedChunkCount++
            emitted.add(speech)
        }
        return emitted
    }

    private fun countCodeFences(text: String, endIndex: Int): Int {
        var count = 0
        var i = 0
        val limit = endIndex.coerceIn(0, text.length)
        while (i <= limit - 3) {
            if (text[i] == '`' && text[i + 1] == '`' && text[i + 2] == '`') {
                count++
                i += 3
            } else {
                i++
            }
        }
        return count
    }

    private fun findFirstStableSplit(
        rem: String,
        startsInCodeFence: Boolean,
        isFirstChunk: Boolean
    ): Int {
        var inFence = startsInCodeFence
        var inlineBacktick = false
        var bracketDepth = 0
        var parenLinkDepth = 0
        var lastSoftSplit = -1
        var speakableCharEstimate = 0

        var i = 0
        val len = rem.length
        while (i < len) {
            val ch = rem[i]
            if (!inlineBacktick && i + 2 < len && rem[i] == '`' && rem[i + 1] == '`' && rem[i + 2] == '`') {
                inFence = !inFence
                i += 3
                continue
            }
            if (!inFence && ch == '`') {
                inlineBacktick = !inlineBacktick
                i++
                continue
            }
            if (inFence) {
                i++
                continue
            }
            if (!inlineBacktick) {
                if (ch == '[') {
                    bracketDepth++
                } else if (ch == ']' && bracketDepth > 0) {
                    bracketDepth--
                    if (i + 1 < len && rem[i + 1] == '(') {
                        parenLinkDepth++
                    }
                } else if (ch == '(' && bracketDepth == 0 && parenLinkDepth > 0) {
                    parenLinkDepth++
                } else if (ch == ')' && parenLinkDepth > 0) {
                    parenLinkDepth--
                }
            }

            if (!ch.isWhitespace() && ch != '*' && ch != '#' && ch != '`') {
                speakableCharEstimate++
            }

            if (!inlineBacktick && bracketDepth == 0 && parenLinkDepth == 0) {
                val nextCh = if (i + 1 < len) rem[i + 1] else '\u0000'
                val prevCh = if (i > 0) rem[i - 1] else '\u0000'
                val isCjkSentenceEnd = ch == '。' || ch == '！' || ch == '？'
                val isNewlineBreak = ch == '\n'
                val isAsciiSentenceMark = (ch == '!' || ch == '?' || ch == '.') &&
                    (nextCh == ' ' || nextCh == '\n' || nextCh == '\t') &&
                    nextCh != '\u0000' &&
                    !(ch == '.' && prevCh == '.') &&
                    !(ch == '.' && nextCh == '.') &&
                    !(ch == '.' && isDigitOrListDot(rem, i))

                val isStrong = isCjkSentenceEnd || isNewlineBreak || isAsciiSentenceMark
                if (isStrong) {
                    var cut = i + 1
                    while (cut < len && (rem[cut] == '”' || rem[cut] == '’' || rem[cut] == '」' || rem[cut] == ')' || rem[cut] == '）' || rem[cut] == '"')) {
                        cut++
                    }
                    val minLen = if (isFirstChunk) 8 else 20
                    if (speakableCharEstimate >= minLen) {
                        val candidateSpeakable = MarkdownParser.toSpeechText(rem.substring(0, cut)).trim()
                        if (candidateSpeakable.length >= minLen) {
                            return cut
                        }
                    }
                }

                val isSoft = ch == '，' || ch == '；' || ch == '：' ||
                    ((ch == ',' || ch == ';') && (nextCh == ' ' || nextCh == '\n' || nextCh.code >= 0x4E00))
                if (isSoft) {
                    val softCut = i + 1
                    val softMin = if (isFirstChunk) 12 else 72
                    if (speakableCharEstimate >= softMin) {
                        lastSoftSplit = softCut
                        if (isFirstChunk || speakableCharEstimate >= 90) {
                            val candidateSpeakable = MarkdownParser.toSpeechText(rem.substring(0, lastSoftSplit)).trim()
                            if (candidateSpeakable.length >= softMin) {
                                return lastSoftSplit
                            }
                        }
                    }
                }
            }
            i++
        }
        return -1
    }

    private fun isDigitOrListDot(s: String, dotIndex: Int): Boolean {
        if (dotIndex <= 0) return false
        val prev = s[dotIndex - 1]
        if (!prev.isDigit()) return false
        // Allow genuine 4-digit years ("in 2025. Then...") followed by uppercase start
        val twoBefore = if (dotIndex >= 2) s[dotIndex - 2].isDigit() else false
        val afterSpace = if (dotIndex + 2 < s.length) s[dotIndex + 2] else '\u0000'
        return !(twoBefore && afterSpace in 'A'..'Z')
    }
}

object NdjsonStreamParser {
    fun parseLine(rawLine: String): ChatStreamEvent? {
        val line = rawLine.trim()
        if (line.isEmpty()) return null
        val jsonPayload = if (line.startsWith("data:")) line.removePrefix("data:").trim() else line
        if (jsonPayload.isEmpty() || jsonPayload == "[DONE]") return null

        val env = try {
            DragonClawHelpers.lenientJson.decodeFromString(RawStreamEnvelope.serializer(), jsonPayload)
        } catch (_: Exception) {
            return null
        }

        return when (env.type) {
            "start" -> ChatStreamEvent(type = StreamEventType.START, sessionId = env.sessionId)
            "title" -> ChatStreamEvent(type = StreamEventType.TITLE, sessionId = env.sessionId, title = env.title)
            "status" -> ChatStreamEvent(
                type = StreamEventType.STATUS,
                sessionId = env.sessionId,
                text = formatStatusText(env.status)
            )
            "thinking" -> ChatStreamEvent(type = StreamEventType.THINKING, text = env.delta.orEmpty())
            "delta" -> {
                val chunk = env.delta ?: env.text.orEmpty()
                ChatStreamEvent(type = StreamEventType.DELTA, text = chunk)
            }
            "tool_start" -> ChatStreamEvent(
                type = StreamEventType.TOOL_START,
                callId = env.callId ?: env.tool.orEmpty(),
                toolName = env.tool.orEmpty(),
                toolArgsSummary = env.args?.toString()?.take(180)
            )
            "tool_result" -> ChatStreamEvent(
                type = StreamEventType.TOOL_RESULT,
                callId = env.callId ?: env.tool.orEmpty(),
                toolName = env.tool.orEmpty(),
                text = env.summary.orEmpty(),
                toolOk = env.ok ?: true,
                durationMs = env.durationMs
            )
            "approval" -> {
                val toolName = env.tool.orEmpty().ifBlank { "tool" }
                val callId = env.callId ?: env.id ?: toolName
                val approvalId = env.id ?: callId
                val approval = DragonClawHelpers.parsePendingApproval(
                    id = approvalId,
                    callId = callId,
                    runId = env.runId.orEmpty(),
                    toolName = toolName,
                    preview = env.preview,
                    approvalUrl = env.approvalUrl,
                    permissionMode = env.permissionMode,
                    noAlways = env.noAlways,
                    expiresInMs = env.expiresInMs
                )
                ChatStreamEvent(
                    type = StreamEventType.APPROVAL,
                    callId = callId,
                    toolName = toolName,
                    approval = approval
                )
            }
            "approval_result" -> ChatStreamEvent(
                type = StreamEventType.APPROVAL_RESULT,
                callId = env.callId ?: env.id,
                approvalDecision = env.decision,
                approvalScope = env.scope
            )
            "model_round" -> ChatStreamEvent(type = StreamEventType.MODEL_ROUND)
            "compaction" -> ChatStreamEvent(type = StreamEventType.COMPACTION, text = env.phase)
            "done" -> ChatStreamEvent(
                type = StreamEventType.DONE,
                sessionId = env.sessionId,
                text = env.reply ?: env.text,
                inputTokens = env.usage?.inputTokens,
                outputTokens = env.usage?.outputTokens,
                modelName = extractModelName(env.model)
            )
            "error" -> ChatStreamEvent(
                type = StreamEventType.ERROR,
                errorMessage = extractErrorText(env.error) ?: "Unknown stream error"
            )
            else -> when {
                env.type.isBlank() && (!env.reply.isNullOrBlank() || !env.text.isNullOrBlank()) -> ChatStreamEvent(
                    type = StreamEventType.DONE,
                    sessionId = env.sessionId,
                    text = env.reply ?: env.text,
                    inputTokens = env.usage?.inputTokens,
                    outputTokens = env.usage?.outputTokens,
                    modelName = extractModelName(env.model)
                )
                env.type.isBlank() && env.error != null -> ChatStreamEvent(
                    type = StreamEventType.ERROR,
                    errorMessage = extractErrorText(env.error) ?: "Unknown stream error"
                )
                else -> null
            }
        }
    }

    private fun extractModelName(model: kotlinx.serialization.json.JsonElement?): String? = when (model) {
        is JsonPrimitive -> model.contentOrNull
        is JsonObject -> (model["name"] as? JsonPrimitive)?.contentOrNull ?: (model["id"] as? JsonPrimitive)?.contentOrNull
        else -> null
    }

    private fun extractErrorText(error: kotlinx.serialization.json.JsonElement?): String? = when (error) {
        is JsonPrimitive -> error.contentOrNull
        is JsonObject -> (error["message"] as? JsonPrimitive)?.contentOrNull ?: (error["error"] as? JsonPrimitive)?.contentOrNull
        else -> null
    }

    private fun formatStatusText(element: kotlinx.serialization.json.JsonElement?): String {
        if (element == null) return ""
        if (element is JsonPrimitive) return element.contentOrNull.orEmpty()
        if (element is JsonObject) {
            val message = (element["message"] as? JsonPrimitive)?.contentOrNull
            if (!message.isNullOrBlank()) return message
            val phase = (element["phase"] as? JsonPrimitive)?.contentOrNull
            val kind = (element["kind"] as? JsonPrimitive)?.contentOrNull
            return listOfNotNull(kind, phase).joinToString(" · ")
        }
        return ""
    }
}

object SessionGrouping {
    private const val DAY_MS = 86_400_000L

    private val PINNED_ENTRY_COMPARATOR = Comparator<SidebarSessionEntry> { a, b ->
        val orderA = a.pinOrder ?: Int.MAX_VALUE
        val orderB = b.pinOrder ?: Int.MAX_VALUE
        if (orderA != orderB) return@Comparator orderA.compareTo(orderB)
        val timeCmp = b.sortTimestampMs.compareTo(a.sortTimestampMs)
        if (timeCmp != 0) return@Comparator timeCmp
        a.stableKey.compareTo(b.stableKey)
    }

    private val RECENCY_ENTRY_COMPARATOR = Comparator<SidebarSessionEntry> { a, b ->
        val timeCmp = b.sortTimestampMs.compareTo(a.sortTimestampMs)
        if (timeCmp != 0) return@Comparator timeCmp
        a.stableKey.compareTo(b.stableKey)
    }

    private fun prefKey(source: String, id: String): String = "$source::$id"

    private fun buildPreferenceLookup(
        preferences: List<ConversationListPreferenceItem>
    ): Map<String, ConversationListPreferenceItem> {
        if (preferences.isEmpty()) return emptyMap()
        val map = LinkedHashMap<String, ConversationListPreferenceItem>(preferences.size)
        for (pref in preferences) {
            if (pref.id.isBlank()) continue
            map[prefKey(pref.source, pref.id)] = pref
        }
        return map
    }

    private fun findDesktopPreference(
        provider: String,
        sessionId: String,
        lookup: Map<String, ConversationListPreferenceItem>
    ): ConversationListPreferenceItem? {
        if (lookup.isEmpty()) return null
        val unifiedPref = lookup[prefKey("mine", "desktop:$provider:$sessionId")]
        val standalonePref = lookup[prefKey("desktop:$provider", sessionId)]
        if (unifiedPref == null) return standalonePref
        if (standalonePref == null) return unifiedPref
        return ConversationListPreferenceItem(
            source = unifiedPref.source,
            id = unifiedPref.id,
            pinned = unifiedPref.pinned ?: standalonePref.pinned,
            archived = unifiedPref.archived ?: standalonePref.archived,
            hidden = unifiedPref.hidden ?: standalonePref.hidden,
            title = unifiedPref.cleanTitle.ifBlank { standalonePref.cleanTitle },
            pin_order = unifiedPref.pin_order ?: standalonePref.pin_order
        )
    }

    /** Returns `(source, id)` used on `/api/ai/conversation-list` for a Desktop Agent session. */
    fun preferenceTargetForDesktop(
        provider: String,
        sessionId: String,
        preferences: List<ConversationListPreferenceItem>
    ): Pair<String, String> {
        val unifiedId = "desktop:$provider:$sessionId"
        val hasUnified = preferences.any { it.source == "mine" && it.id == unifiedId }
        val hasStandalone = preferences.any { it.source == "desktop:$provider" && it.id == sessionId }
        return if (!hasUnified && hasStandalone) {
            "desktop:$provider" to sessionId
        } else {
            "mine" to unifiedId
        }
    }

    fun upsertPreference(
        preferences: List<ConversationListPreferenceItem>,
        source: String,
        id: String,
        setPinned: Boolean? = null,
        setArchived: Boolean? = null,
        setHidden: Boolean? = null,
        setTitle: String? = null
    ): List<ConversationListPreferenceItem> {
        if (id.isBlank()) return preferences
        val list = preferences.toMutableList()
        val idx = list.indexOfFirst { it.source == source && it.id == id }
        val existing = if (idx >= 0) list[idx] else ConversationListPreferenceItem(source = source, id = id)
        val updated = existing.copy(
            pinned = setPinned?.let { JsonPrimitive(it) } ?: existing.pinned,
            archived = setArchived?.let { JsonPrimitive(it) } ?: existing.archived,
            hidden = setHidden?.let { JsonPrimitive(it) } ?: existing.hidden,
            title = setTitle?.trim() ?: existing.title
        )
        if (idx >= 0) list[idx] = updated else list.add(updated)
        return list
    }

    /** Returns updated `order` IDs for `/api/ai/conversation-list` (`source = "mine"`) or null if at boundary. */
    fun movePinnedEntryOrder(
        groups: List<UnifiedSessionGroup>,
        preferences: List<ConversationListPreferenceItem>,
        stableKey: String,
        moveUp: Boolean
    ): List<String>? {
        val pinnedGroup = groups.firstOrNull { it.bucket == SessionBucket.PINNED } ?: return null
        val paired = pinnedGroup.items.mapNotNull { entry ->
            when {
                entry.aiSession != null -> entry.aiSession.id to entry.stableKey
                entry.desktopSession != null -> {
                    val target = preferenceTargetForDesktop(entry.desktopSession.provider, entry.desktopSession.id, preferences)
                    if (target.first == "mine") target.second to entry.stableKey else null
                }
                else -> null
            }
        }
        if (paired.size < 2) return null
        val idx = paired.indexOfFirst { it.second == stableKey }
        if (idx < 0) return null
        val swapIdx = if (moveUp) idx - 1 else idx + 1
        if (swapIdx !in paired.indices) return null
        val reordered = paired.toMutableList()
        val tmp = reordered[idx]
        reordered[idx] = reordered[swapIdx]
        reordered[swapIdx] = tmp
        return reordered.map { it.first }
    }

    fun applyLocalPinOrder(
        preferences: List<ConversationListPreferenceItem>,
        source: String = "mine",
        orderedIds: List<String>
    ): List<ConversationListPreferenceItem> {
        if (orderedIds.isEmpty()) return preferences
        val indexById = orderedIds.withIndex().associate { (i, id) -> id to i }
        val result = preferences.map { pref ->
            if (pref.source == source && indexById.containsKey(pref.id)) {
                pref.copy(pin_order = indexById[pref.id])
            } else pref
        }.toMutableList()
        for ((index, id) in orderedIds.withIndex()) {
            if (result.none { it.source == source && it.id == id }) {
                result.add(ConversationListPreferenceItem(source = source, id = id, pinned = JsonPrimitive(true), pin_order = index))
            }
        }
        return result
    }

    fun applyPreferencesToAiSessions(
        items: List<AiSessionSummary>,
        preferences: List<ConversationListPreferenceItem>
    ): List<AiSessionSummary> {
        if (items.isEmpty() || preferences.isEmpty()) return items
        val lookup = buildPreferenceLookup(preferences)
        return items.map { item ->
            val pref = lookup[prefKey("mine", item.id)] ?: return@map item
            item.copy(
                pinned = if (pref.pinned != null) pref.isPinned else item.pinned,
                customTitle = pref.cleanTitle.ifBlank { null } ?: item.customTitle,
                pinOrder = pref.pin_order ?: item.pinOrder,
                archived = item.archived || pref.isArchived,
                hidden = item.hidden || pref.isHidden
            )
        }
    }

    fun applyPreferencesToDesktopSessions(
        items: List<DesktopAgentSessionSummary>,
        preferences: List<ConversationListPreferenceItem>
    ): List<DesktopAgentSessionSummary> {
        if (items.isEmpty() || preferences.isEmpty()) return items
        val lookup = buildPreferenceLookup(preferences)
        return items.map { item ->
            val pref = findDesktopPreference(item.provider, item.id, lookup) ?: return@map item
            item.copy(
                customTitle = pref.cleanTitle.ifBlank { null } ?: item.customTitle,
                pinned = if (pref.pinned != null) pref.isPinned else item.pinned,
                pinOrder = pref.pin_order ?: item.pinOrder,
                archived = item.archived || pref.isArchived,
                hidden = item.hidden || pref.isHidden
            )
        }
    }

    fun mergeArchivedAiSessions(
        archivedApiItems: List<AiSessionSummary>,
        activeAiItems: List<AiSessionSummary>,
        preferences: List<ConversationListPreferenceItem>,
        searchQuery: String = ""
    ): List<AiSessionSummary> {
        val merged = LinkedHashMap<String, AiSessionSummary>()
        for (item in applyPreferencesToAiSessions(archivedApiItems, preferences)) {
            if (!item.hidden) merged[item.id] = item.copy(archived = true)
        }
        for (item in applyPreferencesToAiSessions(activeAiItems, preferences)) {
            if (item.isArchivedSession && !item.hidden && !merged.containsKey(item.id)) {
                merged[item.id] = item
            }
        }
        val keyword = searchQuery.trim().lowercase()
        return merged.values
            .filter { item ->
                keyword.isEmpty() ||
                    item.displayTitle("zh").lowercase().contains(keyword) ||
                    item.title.lowercase().contains(keyword) ||
                    item.firstQuestion.orEmpty().lowercase().contains(keyword) ||
                    item.lastQuestion.orEmpty().lowercase().contains(keyword)
            }
            .sortedByDescending { parseTimestampMs(it.archivedAt ?: it.updatedAt ?: it.createdAt) ?: 0L }
    }

    private fun bucketForTimestamp(rawTimestamp: String?, nowEpochMs: Long): SessionBucket {
        val ts = parseTimestampMs(rawTimestamp) ?: return SessionBucket.TODAY
        val nowDay = nowEpochMs / DAY_MS
        val itemDay = ts / DAY_MS
        val diffDays = (nowDay - itemDay).coerceAtLeast(0L)
        return when {
            diffDays == 0L -> SessionBucket.TODAY
            diffDays == 1L -> SessionBucket.YESTERDAY
            diffDays <= 7L -> SessionBucket.LAST_7_DAYS
            diffDays <= 30L -> SessionBucket.LAST_30_DAYS
            else -> SessionBucket.OLDER
        }
    }

    fun groupSessions(sessions: List<AiSessionSummary>, nowEpochMs: Long): List<SessionGroup> {
        if (sessions.isEmpty()) return emptyList()
        val buckets = linkedMapOf<SessionBucket, MutableList<AiSessionSummary>>()
        for (session in sessions) {
            if (session.hidden) continue
            val bucket = if (session.isPinned) SessionBucket.PINNED else bucketForTimestamp(session.updatedAt ?: session.createdAt, nowEpochMs)
            buckets.getOrPut(bucket) { mutableListOf() }.add(session)
        }
        return SessionBucket.entries.mapNotNull { bucket ->
            val items = buckets[bucket]
            if (items.isNullOrEmpty()) null else {
                val sorted = if (bucket == SessionBucket.PINNED) {
                    items.sortedWith { a, b ->
                        val orderCmp = (a.pinOrder ?: Int.MAX_VALUE).compareTo(b.pinOrder ?: Int.MAX_VALUE)
                        if (orderCmp != 0) orderCmp
                        else (parseTimestampMs(b.updatedAt ?: b.createdAt) ?: 0L).compareTo(parseTimestampMs(a.updatedAt ?: a.createdAt) ?: 0L)
                    }
                } else items
                SessionGroup(bucket, sorted)
            }
        }
    }

    fun groupSidebarSessions(
        aiSessions: List<AiSessionSummary>,
        desktopSessions: List<DesktopAgentSessionSummary>,
        searchQuery: String = "",
        nowEpochMs: Long
    ): List<UnifiedSessionGroup> = groupSidebarSessions(
        aiSessions = aiSessions,
        desktopSessions = desktopSessions,
        searchQuery = searchQuery,
        nowEpochMs = nowEpochMs,
        preferences = emptyList()
    )

    fun groupSidebarSessions(
        aiSessions: List<AiSessionSummary>,
        desktopSessions: List<DesktopAgentSessionSummary>,
        searchQuery: String = "",
        nowEpochMs: Long,
        preferences: List<ConversationListPreferenceItem> = emptyList(),
        shared: List<SharedConversation> = emptyList()
    ): List<UnifiedSessionGroup> {
        // 共享对话：不在已加载列表页里的也补进来，统一放在最上方的「共享对话」分类
        val sharedBySession = shared.filter { it.sessionId.isNotBlank() }.associateBy { it.sessionId }
        val loadedIds = aiSessions.mapTo(HashSet()) { it.id }
        val withShared = aiSessions + sharedBySession.values.filter { it.sessionId !in loadedIds }.map {
            AiSessionSummary(id = it.sessionId, updatedAt = it.updatedAt, createdAt = it.createdAt, title = it.title)
        }
        val resolvedAi = applyPreferencesToAiSessions(withShared, preferences)
        val resolvedDesktop = applyPreferencesToDesktopSessions(desktopSessions, preferences)
        val keyword = searchQuery.trim().lowercase()
        val entries = buildList {
            for (s in resolvedAi) {
                if (s.isArchivedSession || s.hidden) continue
                val matches = keyword.isEmpty() ||
                    s.customTitle.orEmpty().lowercase().contains(keyword) ||
                    s.title.lowercase().contains(keyword) ||
                    s.firstQuestion.orEmpty().lowercase().contains(keyword) ||
                    s.lastQuestion.orEmpty().lowercase().contains(keyword)
                if (!matches) continue
                val share = sharedBySession[s.id]
                val rawTs = share?.updatedAt?.takeIf { (parseTimestampMs(it) ?: 0L) > (parseTimestampMs(s.updatedAt) ?: 0L) } ?: s.updatedAt ?: s.createdAt
                val isPinned = s.isPinned
                val bucket = if (share != null) SessionBucket.SHARED else if (isPinned) SessionBucket.PINNED else bucketForTimestamp(rawTs, nowEpochMs)
                add(
                    SidebarSessionEntry(
                        stableKey = "ai:${s.id}",
                        aiSession = s,
                        desktopSession = null,
                        sortTimestampMs = parseTimestampMs(rawTs) ?: 0L,
                        isPinned = isPinned,
                        pinOrder = s.pinOrder,
                        shared = share
                    ) to bucket
                )
            }
            for (d in resolvedDesktop) {
                if (d.archived || d.hidden) continue
                val matches = keyword.isEmpty() ||
                    d.customTitle.orEmpty().lowercase().contains(keyword) ||
                    d.title.lowercase().contains(keyword) ||
                    d.fullTitle.orEmpty().lowercase().contains(keyword) ||
                    d.providerDisplayName().lowercase().contains(keyword)
                if (!matches) continue
                val rawTs = d.updatedAt ?: d.observedAt
                val isPinned = d.isPinned
                val bucket = if (isPinned) SessionBucket.PINNED else bucketForTimestamp(rawTs, nowEpochMs)
                add(
                    SidebarSessionEntry(
                        stableKey = d.stableKey,
                        aiSession = null,
                        desktopSession = d,
                        sortTimestampMs = parseTimestampMs(rawTs) ?: 0L,
                        isPinned = isPinned,
                        pinOrder = d.pinOrder
                    ) to bucket
                )
            }
        }
        if (entries.isEmpty()) return emptyList()
        val buckets = linkedMapOf<SessionBucket, MutableList<SidebarSessionEntry>>()
        for ((entry, bucket) in entries) {
            buckets.getOrPut(bucket) { mutableListOf() }.add(entry)
        }
        return SessionBucket.entries.mapNotNull { bucket ->
            val items = buckets[bucket]
            if (items.isNullOrEmpty()) null else {
                val comparator = if (bucket == SessionBucket.PINNED) PINNED_ENTRY_COMPARATOR else RECENCY_ENTRY_COMPARATOR
                UnifiedSessionGroup(bucket, items.sortedWith(comparator))
            }
        }
    }

    /** Collapses only the PINNED sidebar bucket when enabled, auto-expanding during active search. */
    fun shouldCollapseGroup(
        bucket: SessionBucket,
        isPinnedCollapsed: Boolean,
        searchQuery: String
    ): Boolean = bucket == SessionBucket.PINNED && isPinnedCollapsed && searchQuery.isBlank()

    /** 「共享对话」分类单独折叠，搜索时自动展开 */
    fun shouldCollapseSharedGroup(bucket: SessionBucket, isSharedCollapsed: Boolean, searchQuery: String): Boolean =
        bucket == SessionBucket.SHARED && isSharedCollapsed && searchQuery.isBlank()

    /** Parses ISO-8601 (`2026-11-11T08:00:00Z`) or SQLite (`2026-11-11 08:00:00`) UTC timestamps to epoch ms. */
    fun parseTimestampMs(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        val cleaned = raw.trim().replace('T', ' ').removeSuffix("Z")
        val datePart = cleaned.substringBefore(' ').trim()
        val parts = datePart.split('-')
        if (parts.size != 3) return null
        val year = parts[0].toIntOrNull() ?: return null
        val month = parts[1].toIntOrNull() ?: return null
        val day = parts[2].toIntOrNull() ?: return null
        if (month !in 1..12 || day !in 1..31) return null

        val days = daysFromCivil(year, month, day)
        val timePart = cleaned.substringAfter(' ', "").substringBefore('.').substringBefore('+').trim()
        var secondsOfDay = 0L
        if (timePart.contains(':')) {
            val t = timePart.split(':')
            val h = t.getOrNull(0)?.toLongOrNull() ?: 0L
            val m = t.getOrNull(1)?.toLongOrNull() ?: 0L
            val s = t.getOrNull(2)?.toLongOrNull() ?: 0L
            secondsOfDay = h * 3600L + m * 60L + s
        }
        return (days * 86_400L + secondsOfDay) * 1000L
    }

    // Howard Hinnant's civil-from-days inverse algorithm (pure integer math, zero platform deps).
    private fun daysFromCivil(yInput: Int, m: Int, d: Int): Long {
        val y = (if (m <= 2) yInput - 1 else yInput).toLong()
        val era = (if (y >= 0) y else y - 399) / 400
        val yoe = y - era * 400
        val doy = ((153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + d - 1).toLong()
        val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }
}
