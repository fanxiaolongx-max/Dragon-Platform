package com.example.newapp.shared.util

import com.example.newapp.shared.model.*
import io.ktor.http.encodeURLParameter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

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
    private val UPLOAD_BLOCK_HEADER_REGEX = Regex("""^\[(?:已上传附件路径：|Attached files uploaded to server:|已上传附件)]\s*$""")
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
            trimmed.startsWith("data:image/", ignoreCase = true)
        ) {
            return trimmed
        }
        if (trimmed.startsWith("/api/", ignoreCase = true)) {
            return "$cleanBase$trimmed"
        }
        val cleanPath = cleanFilePath(trimmed)
        return "$cleanBase/api/agent-files/raw?path=${cleanPath.encodeURLParameter(spaceToPlus = false)}"
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
        val pathsBlock = files.joinToString("\n") { file ->
            val label = file.name.ifBlank { file.path.substringAfterLast('/') }
            "- $label: ${file.path}"
        }
        val header = if (language == "en") "[Attached files uploaded to server:]" else "[已上传附件路径：]"
        val trimmed = draftText.trim()
        return if (trimmed.isEmpty()) {
            "$header\n$pathsBlock"
        } else {
            "$trimmed\n\n$header\n$pathsBlock"
        }
    }

    fun mapStoredMessages(items: List<SessionMessageItem>, baseUrl: String = ""): List<ChatMessage> {
        val mapped = items.map { item ->
            val role = if (item.role == "user") "user" else "model"
            val traces = extractToolTracesFromEvents(item.events)
            val thinking = extractThinkingFromEvents(item.events)
            val (cleanedText, extractedAttachments) = extractMessageAttachmentsAndCleanText(
                rawContent = item.content,
                baseUrl = baseUrl
            )
            ChatMessage(
                id = item.id.ifBlank { "${item.created_at.orEmpty()}_${role}_${item.content.hashCode()}" },
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
                isStreaming = false
            )
        }
        return mergeConsecutiveAssistantMessages(mapped)
    }

    fun mapDesktopAgentMessages(items: List<DesktopAgentMessageItem>, baseUrl: String = ""): List<ChatMessage> {
        val cleanBase = normalizeBaseUrl(baseUrl)
        val mapped = items.mapNotNull { item ->
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
            if (cleanedText.isEmpty() && mergedAttachments.isEmpty()) return@mapNotNull null
            val role = if (item.role == "user") "user" else "model"
            val lastRound = item.rounds.lastOrNull()
            val totalIn = item.rounds.mapNotNull { it.inputTokens }.takeIf { it.isNotEmpty() }?.sum()
            val totalOut = item.rounds.mapNotNull { it.outputTokens }.takeIf { it.isNotEmpty() }?.sum()
            ChatMessage(
                id = item.id.ifBlank { "${item.createdAt.orEmpty()}_${role}_${cleanedText.hashCode()}_${mergedAttachments.size}" },
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
            if (prev == null || msg.isUser || prev.isUser) {
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
                isStreaming = prev.isStreaming || msg.isStreaming
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
            val bucket = bucketForTimestamp(session.updatedAt ?: session.createdAt, nowEpochMs)
            buckets.getOrPut(bucket) { mutableListOf() }.add(session)
        }
        return SessionBucket.entries.mapNotNull { bucket ->
            val items = buckets[bucket]
            if (items.isNullOrEmpty()) null else SessionGroup(bucket, items)
        }
    }

    fun groupSidebarSessions(
        aiSessions: List<AiSessionSummary>,
        desktopSessions: List<DesktopAgentSessionSummary>,
        searchQuery: String = "",
        nowEpochMs: Long
    ): List<UnifiedSessionGroup> {
        val keyword = searchQuery.trim().lowercase()
        val entries = buildList {
            for (s in aiSessions) {
                if (s.isArchivedSession) continue
                val matches = keyword.isEmpty() ||
                    s.title.lowercase().contains(keyword) ||
                    s.firstQuestion.orEmpty().lowercase().contains(keyword) ||
                    s.lastQuestion.orEmpty().lowercase().contains(keyword)
                if (!matches) continue
                val rawTs = s.updatedAt ?: s.createdAt
                add(
                    SidebarSessionEntry(
                        stableKey = "ai:${s.id}",
                        aiSession = s,
                        desktopSession = null,
                        sortTimestampMs = parseTimestampMs(rawTs) ?: 0L
                    ) to bucketForTimestamp(rawTs, nowEpochMs)
                )
            }
            for (d in desktopSessions) {
                val matches = keyword.isEmpty() ||
                    d.title.lowercase().contains(keyword) ||
                    d.fullTitle.orEmpty().lowercase().contains(keyword) ||
                    d.providerDisplayName().lowercase().contains(keyword)
                if (!matches) continue
                val rawTs = d.updatedAt ?: d.observedAt
                add(
                    SidebarSessionEntry(
                        stableKey = d.stableKey,
                        aiSession = null,
                        desktopSession = d,
                        sortTimestampMs = parseTimestampMs(rawTs) ?: 0L
                    ) to bucketForTimestamp(rawTs, nowEpochMs)
                )
            }
        }
        if (entries.isEmpty()) return emptyList()
        val buckets = linkedMapOf<SessionBucket, MutableList<SidebarSessionEntry>>()
        for ((entry, bucket) in entries.sortedByDescending { it.first.sortTimestampMs }) {
            buckets.getOrPut(bucket) { mutableListOf() }.add(entry)
        }
        return SessionBucket.entries.mapNotNull { bucket ->
            val items = buckets[bucket]
            if (items.isNullOrEmpty()) null else UnifiedSessionGroup(bucket, items)
        }
    }

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
