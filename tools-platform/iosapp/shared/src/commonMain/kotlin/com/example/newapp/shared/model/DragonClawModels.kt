package com.example.newapp.shared.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

@Serializable
data class AiModelInfo(
    val id: String,
    val name: String,
    val description: String? = null,
    val provider: String? = null
)

@Serializable
data class AiModelsResponse(
    val mode: String? = null,
    val defaultId: String? = null,
    val models: List<AiModelInfo> = emptyList()
)

@Serializable
data class AiSuggestion(
    val id: String = "",
    val question: String = "",
    val source: String? = null
)

@Serializable
data class AiSuggestionsResponse(
    val items: List<AiSuggestion> = emptyList()
)

@Serializable
data class EnhancePromptRequest(
    val text: String,
    val uiLanguage: String = "zh",
    val modelId: String? = null
)

@Serializable
data class EnhancePromptResponse(
    val prompt: String? = null,
    val error: String? = null
)

@Serializable
data class UploadedFileInfo(
    val path: String = "",
    val name: String = "",
    val size: Long = 0L
)

@Serializable
data class UploadFilesResponse(
    val files: List<UploadedFileInfo> = emptyList(),
    val error: String? = null
)

@Serializable
data class ChatHistoryMessageDto(
    val role: String,
    val content: String
)

@Serializable
data class ChatStreamRequest(
    val messages: List<ChatHistoryMessageDto>,
    val context: String = "",
    val pageTitle: String = "Dragon Claw · Mobile",
    val pagePath: String = "/",
    val uiLanguage: String = "zh",
    val sessionId: String? = null,
    val agent: String = "dragon-claw-home",
    val stream: Boolean = true,
    val modelId: String? = null
)

@Serializable
data class AiSessionSummary(
    val id: String,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val archived: Boolean = false,
    val messageCount: Int = 0,
    val title: String = "",
    val firstQuestion: String? = null,
    val lastQuestion: String? = null,
    val busy: Boolean = false
) {
    fun displayTitle(language: String): String {
        val candidate = title.ifBlank { firstQuestion.orEmpty() }.ifBlank { lastQuestion.orEmpty() }.trim()
        return candidate.ifEmpty { if (language == "en") "New conversation" else "新对话" }
    }
}

@Serializable
data class AiSessionsResponse(
    val items: List<AiSessionSummary> = emptyList()
)

@Serializable
data class SessionMessageItem(
    val id: String = "",
    val session_id: String = "",
    val role: String = "user",
    val content: String = "",
    val created_at: String? = null,
    val events: JsonArray? = null,
    val input_tokens: Int? = null,
    val output_tokens: Int? = null,
    val model_name: String? = null,
    val interrupted: Boolean = false
)

@Serializable
data class SessionMessagesResponse(
    val items: List<SessionMessageItem> = emptyList(),
    val hasMore: Boolean = false,
    val total: Int = 0
)

@Serializable
data class DeleteSessionResponse(
    val deleted: Boolean = false
)

@Serializable
data class AiUsageDto(
    val inputTokens: Int = 0,
    val outputTokens: Int = 0
)

@Serializable
data class AiDoneModelDto(
    val id: String? = null,
    val name: String? = null
)

@Serializable
data class RawStreamEnvelope(
    val type: String = "",
    val sessionId: String? = null,
    val title: String? = null,
    val status: kotlinx.serialization.json.JsonElement? = null,
    val delta: String? = null,
    val callId: String? = null,
    val tool: String? = null,
    val args: JsonObject? = null,
    val ok: Boolean? = null,
    val summary: String? = null,
    val durationMs: Long? = null,
    val phase: String? = null,
    val reply: String? = null,
    val tokens: Int? = null,
    val usage: AiUsageDto? = null,
    val model: AiDoneModelDto? = null,
    val error: String? = null
)

enum class StreamEventType {
    START,
    TITLE,
    STATUS,
    THINKING,
    DELTA,
    TOOL_START,
    TOOL_RESULT,
    MODEL_ROUND,
    COMPACTION,
    DONE,
    ERROR
}

data class ChatStreamEvent(
    val type: StreamEventType,
    val sessionId: String? = null,
    val title: String? = null,
    val text: String? = null,
    val callId: String? = null,
    val toolName: String? = null,
    val toolArgsSummary: String? = null,
    val toolOk: Boolean = true,
    val durationMs: Long? = null,
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
    val modelName: String? = null,
    val errorMessage: String? = null
)

data class ToolCallTrace(
    val callId: String,
    val toolName: String,
    val argsSummary: String = "",
    val summary: String = "",
    val ok: Boolean = true,
    val durationMs: Long? = null,
    val isFinished: Boolean = false
)

data class ChatMessage(
    val id: String,
    val role: String,
    val content: String,
    val thinking: String = "",
    val createdAt: String? = null,
    val statusText: String? = null,
    val toolCalls: List<ToolCallTrace> = emptyList(),
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
    val modelName: String? = null,
    val interrupted: Boolean = false,
    val isStreaming: Boolean = false
) {
    val isUser: Boolean get() = role == "user"
}

enum class SessionBucket {
    TODAY,
    YESTERDAY,
    LAST_7_DAYS,
    LAST_30_DAYS,
    OLDER
}

data class SessionGroup(
    val bucket: SessionBucket,
    val items: List<AiSessionSummary>
) {
    fun localizedTitle(language: String): String = when (bucket) {
        SessionBucket.TODAY -> if (language == "en") "Today" else "今天"
        SessionBucket.YESTERDAY -> if (language == "en") "Yesterday" else "昨天"
        SessionBucket.LAST_7_DAYS -> if (language == "en") "Previous 7 Days" else "近 7 天"
        SessionBucket.LAST_30_DAYS -> if (language == "en") "Previous 30 Days" else "近 30 天"
        SessionBucket.OLDER -> if (language == "en") "Older" else "更早"
    }
}

class UploadAttachmentDraft(
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray
)
