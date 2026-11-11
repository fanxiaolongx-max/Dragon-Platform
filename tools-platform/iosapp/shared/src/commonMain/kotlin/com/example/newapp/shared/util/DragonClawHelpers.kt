package com.example.newapp.shared.util

import com.example.newapp.shared.model.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/** Pure Kotlin helpers shared by iOS and Android (stream parsing, timestamps, grouping, error extraction). */
object DragonClawHelpers {
    val lenientJson = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
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

    fun mapStoredMessages(items: List<SessionMessageItem>): List<ChatMessage> {
        return items.map { item ->
            val role = if (item.role == "user") "user" else "model"
            val traces = extractToolTracesFromEvents(item.events)
            val thinking = extractThinkingFromEvents(item.events)
            ChatMessage(
                id = item.id.ifBlank { "${item.created_at.orEmpty()}_${role}_${item.content.hashCode()}" },
                role = role,
                content = item.content,
                thinking = thinking,
                createdAt = item.created_at,
                toolCalls = traces,
                inputTokens = item.input_tokens,
                outputTokens = item.output_tokens,
                modelName = item.model_name,
                interrupted = item.interrupted,
                isStreaming = false
            )
        }
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
            "delta" -> ChatStreamEvent(type = StreamEventType.DELTA, text = env.delta.orEmpty())
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
                text = env.reply,
                inputTokens = env.usage?.inputTokens,
                outputTokens = env.usage?.outputTokens,
                modelName = env.model?.name ?: env.model?.id
            )
            "error" -> ChatStreamEvent(
                type = StreamEventType.ERROR,
                errorMessage = env.error ?: "Unknown stream error"
            )
            else -> null
        }
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

    fun groupSessions(sessions: List<AiSessionSummary>, nowEpochMs: Long): List<SessionGroup> {
        if (sessions.isEmpty()) return emptyList()
        val nowDay = nowEpochMs / DAY_MS
        val buckets = linkedMapOf<SessionBucket, MutableList<AiSessionSummary>>()

        for (session in sessions) {
            val ts = parseTimestampMs(session.updatedAt ?: session.createdAt)
            val bucket = if (ts == null) {
                SessionBucket.TODAY
            } else {
                val itemDay = ts / DAY_MS
                val diffDays = (nowDay - itemDay).coerceAtLeast(0L)
                when {
                    diffDays == 0L -> SessionBucket.TODAY
                    diffDays == 1L -> SessionBucket.YESTERDAY
                    diffDays <= 7L -> SessionBucket.LAST_7_DAYS
                    diffDays <= 30L -> SessionBucket.LAST_30_DAYS
                    else -> SessionBucket.OLDER
                }
            }
            buckets.getOrPut(bucket) { mutableListOf() }.add(session)
        }

        return SessionBucket.entries.mapNotNull { bucket ->
            val items = buckets[bucket]
            if (items.isNullOrEmpty()) null else SessionGroup(bucket, items)
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
