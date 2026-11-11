package com.example.newapp.shared.model

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNames
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
    val modelId: String? = null,
    val voiceMode: Boolean? = null
)

@Serializable
data class SessionAgentRef(
    val agentSessionId: String = "",
    val root: String = ""
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class AiSessionSummary(
    val id: String,
    @JsonNames("created_at") val createdAt: String? = null,
    @JsonNames("updated_at") val updatedAt: String? = null,
    @JsonNames("archived_at") val archivedAt: String? = null,
    val archived: Boolean = false,
    val is_archived: Int? = null,
    @JsonNames("message_count") val messageCount: Int = 0,
    @JsonNames("auto_title") val title: String = "",
    @JsonNames("first_question") val firstQuestion: String? = null,
    @JsonNames("last_question") val lastQuestion: String? = null,
    val discussionMode: String? = null,
    val agent: SessionAgentRef? = null,
    val busy: Boolean = false
) {
    val isArchivedSession: Boolean
        get() = archived || (is_archived ?: 0) != 0

    val isGroupSession: Boolean
        get() = discussionMode == "group"

    val isWorkspaceAgent: Boolean
        get() = agent?.root?.isNotBlank() == true

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
    val text: String? = null,
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
    val model: kotlinx.serialization.json.JsonElement? = null,
    val error: kotlinx.serialization.json.JsonElement? = null
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

@Serializable
data class ChatAttachment(
    val path: String = "",
    val name: String = "",
    val mimeType: String = "",
    val url: String = ""
) {
    val displayName: String
        get() = name.ifBlank {
            val raw = url.ifBlank { path }.substringBefore('?').substringBefore('#')
            raw.substringAfterLast('/').ifBlank { raw }
        }

    val isImage: Boolean
        get() {
            if (mimeType.startsWith("image/", ignoreCase = true)) return true
            val candidate = (path.ifBlank { url.ifBlank { name } })
                .substringAfter("path=", missingDelimiterValue = path.ifBlank { url.ifBlank { name } })
                .substringBefore('&')
                .substringBefore('#')
                .substringBefore('?')
                .lowercase()
            if (candidate.startsWith("data:image/")) return true
            return IMAGE_EXTENSIONS.any { candidate.endsWith(it) }
        }

    companion object {
        private val IMAGE_EXTENSIONS = listOf(
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".heic", ".svg"
        )
    }
}

data class ChatMessage(
    val id: String,
    val role: String,
    val content: String,
    val thinking: String = "",
    val createdAt: String? = null,
    val statusText: String? = null,
    val toolCalls: List<ToolCallTrace> = emptyList(),
    val attachments: List<ChatAttachment> = emptyList(),
    val rawContent: String? = null,
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
    val modelName: String? = null,
    val interrupted: Boolean = false,
    val isStreaming: Boolean = false
) {
    val isUser: Boolean get() = role == "user"
    val historyContent: String get() = rawContent?.takeIf { it.isNotBlank() } ?: content
    val imageAttachments: List<ChatAttachment> get() = attachments.filter { it.isImage }
    val fileAttachments: List<ChatAttachment> get() = attachments.filter { !it.isImage }
    val renderKey: String get() = "${id}_${content.length}_${thinking.length}_${statusText.orEmpty()}_${isStreaming}_${toolCalls.size}_${attachments.size}"
}

enum class SessionBucket {
    TODAY,
    YESTERDAY,
    LAST_7_DAYS,
    LAST_30_DAYS,
    OLDER;

    fun localizedTitle(language: String): String = when (this) {
        TODAY -> if (language == "en") "Today" else "今天"
        YESTERDAY -> if (language == "en") "Yesterday" else "昨天"
        LAST_7_DAYS -> if (language == "en") "Previous 7 Days" else "近 7 天"
        LAST_30_DAYS -> if (language == "en") "Previous 30 Days" else "近 30 天"
        OLDER -> if (language == "en") "Older" else "更早"
    }
}

data class SessionGroup(
    val bucket: SessionBucket,
    val items: List<AiSessionSummary>
) {
    fun localizedTitle(language: String): String = bucket.localizedTitle(language)
}

class UploadAttachmentDraft(
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray
)

@Serializable
data class SpeechSourceInfo(
    val id: String = "",
    val label: String = "",
    val location: String = ""
)

@Serializable
data class SpeechRecognitionResponse(
    val text: String = "",
    val degraded: Boolean = false,
    val source: SpeechSourceInfo? = null,
    val error: String? = null
)

@Serializable
data class SpeechSynthesisRequest(
    val text: String,
    val language: String = "zh",
    val voice: String? = null
)

class SynthesizedSpeechAudio(
    val bytes: ByteArray,
    val mimeType: String,
    val model: String = "",
    val voice: String = ""
)

@Serializable
data class AgentSkillItem(
    val id: String = "",
    val name: String = "",
    val nameEn: String? = null,
    val description: String = "",
    val descriptionEn: String? = null,
    val workspace: String? = null,
    val icon: String? = null,
    val builtIn: Boolean = false,
    val shared: Boolean = false,
    val customized: Boolean = false,
    val source: String? = null
) {
    fun localizedName(language: String): String =
        if (language == "en") nameEn?.takeIf { it.isNotBlank() } ?: name.ifBlank { id }
        else name.ifBlank { nameEn.orEmpty() }.ifBlank { id }

    fun localizedDescription(language: String): String =
        if (language == "en") descriptionEn?.takeIf { it.isNotBlank() } ?: description
        else description.ifBlank { descriptionEn.orEmpty() }
}

@Serializable
data class AgentSkillsResponse(
    val items: List<AgentSkillItem> = emptyList()
)

@Serializable
data class CompactSessionRequest(
    val sessionId: String,
    val modelId: String? = null
)

@Serializable
data class CompactSessionResponse(
    val performed: Boolean = false,
    val reason: String? = null,
    val beforeChars: Int = 0,
    val afterChars: Int = 0,
    val retainedRecentMessages: Int = 0,
    val error: String? = null
)

@Serializable
data class ArchiveSessionResponse(
    val session: AiSessionSummary? = null,
    val error: String? = null
)

@Serializable
data class DragonClawScheduleItem(
    val id: String = "",
    val instruction: String = "",
    val kind: String = "",
    val timezone: String = "",
    val sessionId: String = "",
    val status: String = "active",
    val nextRunAt: String? = null,
    val lastRunAt: String? = null,
    val lastStatus: String = "",
    val lastError: String = "",
    val lastReply: String = "",
    val runCount: Int = 0
)

@Serializable
data class SchedulesResponse(
    val items: List<DragonClawScheduleItem> = emptyList(),
    val active: Int = 0,
    val serverTime: String? = null
)

@Serializable
data class CreateScheduleRequest(
    val text: String,
    val sessionId: String = "",
    val timezone: String = "",
    val modelId: String? = null
)

@Serializable
data class ScheduleMutationResponse(
    val item: DragonClawScheduleItem? = null,
    val error: String? = null
)

@Serializable
data class NavToolIdsResponse(
    val ids: List<String> = emptyList()
)

@Serializable
data class SaveFavoriteNavRequest(
    val ids: List<String>
)

@Serializable
data class RecordRecentNavRequest(
    val toolId: String
)

// --- Desktop Agent Connectors (Codex / Claude Code / Antigravity / WorkBuddy) ---

@Serializable
data class DesktopAgentProviderState(
    val id: String = "",
    val enabled: Boolean = false,
    val connected: Boolean = false,
    val canRead: Boolean = false,
    val canSend: Boolean = false,
    val count: Int = 0,
    val reason: String? = null
)

@Serializable
data class DesktopAgentSessionSummary(
    val id: String = "",
    val provider: String = "",
    val title: String = "",
    val fullTitle: String? = null,
    val updatedAt: String? = null,
    val observedAt: String? = null,
    val source: String? = null,
    val busy: Boolean = false
) {
    val stableKey: String
        get() = "desktop:$provider:$id"

    fun displayTitle(language: String): String {
        val clean = title.trim().ifBlank { fullTitle.orEmpty().trim() }
        return clean.ifEmpty { providerDisplayName() }
    }

    fun providerDisplayName(): String = when (provider.lowercase()) {
        "codex" -> "Codex"
        "claudecode" -> "Claude"
        "antigravity" -> "Antigravity"
        "workbuddy" -> "WorkBuddy"
        else -> provider.ifBlank { "Agent" }
    }
}

@Serializable
data class DesktopAgentsSessionsResponse(
    val items: List<DesktopAgentSessionSummary> = emptyList(),
    val providers: List<DesktopAgentProviderState> = emptyList(),
    val syncedAt: String? = null
)

@Serializable
data class DesktopAgentRoundUsage(
    val model: String? = null,
    val inputTokens: Int? = null,
    val outputTokens: Int? = null
)

@Serializable
data class DesktopAgentAttachmentItem(
    val path: String = "",
    val name: String = ""
)

@Serializable
data class DesktopAgentMessageItem(
    val id: String = "",
    val role: String = "user",
    val content: String = "",
    val createdAt: String? = null,
    val channel: String? = null,
    val rounds: List<DesktopAgentRoundUsage> = emptyList(),
    val attachments: List<DesktopAgentAttachmentItem> = emptyList()
)

@Serializable
data class DesktopAgentModelItem(
    val id: String = "",
    val name: String = ""
)

@Serializable
data class DesktopAgentModelsResponse(
    val models: List<DesktopAgentModelItem> = emptyList()
)

@Serializable
data class DesktopAgentSetModelRequest(
    val model: String = ""
)

@Serializable
data class DesktopAgentSetModelResponse(
    val selectedModel: String? = null
)

@Serializable
data class DesktopAgentQueuedItem(
    val requestId: String = "",
    val text: String = "",
    val status: String = "queued",
    val error: String = "",
    val createdAt: String? = null
)

data class QueuedChatPrompt(
    val id: String,
    val text: String,
    val displayText: String,
    val attachments: List<UploadedFileInfo> = emptyList(),
    val status: String = "queued",
    val error: String = "",
    val voiceMode: Boolean = false
)

@Serializable
data class DesktopAgentMessagesResponse(
    val items: List<DesktopAgentMessageItem>? = null,
    val available: Boolean = true,
    val stale: Boolean = false,
    val busy: Boolean = false,
    val canSend: Boolean = false,
    val canSteer: Boolean = false,
    val reason: String? = null,
    val selectedModel: String? = null,
    val session: DesktopAgentSessionSummary? = null,
    val queue: List<DesktopAgentQueuedItem> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val nextBefore: String? = null,
    val error: String? = null
)

@Serializable
data class DesktopAgentSendRequest(
    val text: String,
    val requestId: String,
    val mode: String? = null,
    val model: String? = null
)

@Serializable
data class DesktopAgentSendResponse(
    val status: String? = null,
    val requestId: String? = null,
    val queue: List<DesktopAgentQueuedItem> = emptyList(),
    val error: String? = null
)

data class SidebarSessionEntry(
    val stableKey: String,
    val aiSession: AiSessionSummary? = null,
    val desktopSession: DesktopAgentSessionSummary? = null,
    val sortTimestampMs: Long = 0L
) {
    val isDesktopAgent: Boolean get() = desktopSession != null
    val busy: Boolean get() = desktopSession?.busy ?: aiSession?.busy ?: false

    fun displayTitle(language: String): String =
        desktopSession?.displayTitle(language)
            ?: aiSession?.displayTitle(language)
            ?: if (language == "en") "New conversation" else "新对话"

    fun badgeLabel(language: String): String? = when {
        desktopSession != null -> desktopSession.providerDisplayName()
        aiSession?.isGroupSession == true -> if (language == "en") "Group" else "群聊"
        aiSession?.isWorkspaceAgent == true -> "Agent"
        else -> null
    }
}

data class UnifiedSessionGroup(
    val bucket: SessionBucket,
    val items: List<SidebarSessionEntry>
) {
    fun localizedTitle(language: String): String = bucket.localizedTitle(language)
}
