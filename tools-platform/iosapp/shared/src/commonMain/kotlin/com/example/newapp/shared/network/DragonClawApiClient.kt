package com.example.newapp.shared.network

import com.example.newapp.shared.SettingsManager
import com.example.newapp.shared.model.*
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.NdjsonStreamParser
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logger
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.plugins.logging.SIMPLE
import io.ktor.client.plugins.timeout
import io.ktor.client.request.delete
import io.ktor.client.request.forms.formData
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json

class ApiHttpException(val statusCode: Int, override val message: String) : Exception(message)

/** Unified Ktor client for DragonClaw Auth, AI Chat NDJSON Streaming, Tool Hub & External Metrics. */
class DragonClawApiClient(
    private val settings: SettingsManager = SettingsManager()
) {
    val client = createPlatformHttpClient {
        install(ContentNegotiation) {
            json(DragonClawHelpers.lenientJson)
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 45_000L
            connectTimeoutMillis = 15_000L
            socketTimeoutMillis = 45_000L
        }
        install(Logging) {
            logger = Logger.SIMPLE
            level = LogLevel.HEADERS
        }
        expectSuccess = false
    }

    val baseUrl: String
        get() = DragonClawHelpers.normalizeBaseUrl(settings.getString("api_base_url", "https://cs.fanxiaolong.uk"))

    private suspend inline fun <reified T> decodeOrThrow(response: HttpResponse, fallback: String): T {
        if (!response.status.isSuccess()) {
            val raw = runCatching { response.bodyAsText() }.getOrDefault("")
            throw ApiHttpException(
                response.status.value,
                DragonClawHelpers.parseErrorMessage(response.status.value, raw, fallback)
            )
        }
        return response.body()
    }

    // --- Auth & Platform Identity ---

    suspend fun login(request: LoginRequest): LoginResponse {
        val response = client.post("$baseUrl/api/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }
        return decodeOrThrow(response, "Login failed")
    }

    suspend fun getMe(token: String): UserProfile {
        val response = client.get("$baseUrl/api/auth/me") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Session verification failed")
    }

    suspend fun getPlatformIdentity(): PlatformIdentity {
        val response = client.get("$baseUrl/api/platform-identity")
        return decodeOrThrow(response, "Failed to load platform identity")
    }

    suspend fun getAppVersion(): AppVersionResponse {
        val response = client.get("$baseUrl/api/app-version")
        return decodeOrThrow(response, "Failed to load app version")
    }

    suspend fun getAlertCenterSummary(token: String): AlertCenterSummary {
        val response = client.get("$baseUrl/api/alert-center/summary") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to load alert summary")
    }

    // --- DragonClaw AI Chat ---

    suspend fun getModels(token: String): AiModelsResponse {
        val response = client.get("$baseUrl/api/ai/models") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to load AI models")
    }

    suspend fun getSuggestions(token: String, limit: Int = 8): AiSuggestionsResponse {
        val response = client.get("$baseUrl/api/ai/suggestions") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("pagePath", "/")
                parameters.append("limit", limit.toString())
            }
        }
        return decodeOrThrow(response, "Failed to load suggestions")
    }

    suspend fun enhancePrompt(token: String, request: EnhancePromptRequest): EnhancePromptResponse {
        val response = client.post("$baseUrl/api/ai/enhance-prompt") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            contentType(ContentType.Application.Json)
            setBody(request)
        }
        return decodeOrThrow(response, "Failed to enhance prompt")
    }

    suspend fun uploadFiles(token: String, drafts: List<UploadAttachmentDraft>): UploadFilesResponse {
        val response = client.submitFormWithBinaryData(
            url = "$baseUrl/api/ai/uploads",
            formData = formData {
                drafts.take(5).forEach { draft ->
                    val safeName = draft.fileName.replace("\"", "_")
                    append(
                        key = "files",
                        value = draft.bytes,
                        headers = Headers.build {
                            append(HttpHeaders.ContentType, draft.mimeType)
                            append(HttpHeaders.ContentDisposition, "filename=\"$safeName\"")
                        }
                    )
                }
            }
        ) {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            timeout {
                requestTimeoutMillis = 120_000L
                socketTimeoutMillis = 120_000L
            }
        }
        return decodeOrThrow(response, "Failed to upload attachments")
    }

    suspend fun getSessions(token: String, query: String = "", limit: Int = 40): AiSessionsResponse {
        val response = client.get("$baseUrl/api/ai/sessions") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("mine", "1")
                parameters.append("pagePath", "/")
                parameters.append("limit", limit.toString())
                if (query.isNotBlank()) parameters.append("query", query.trim())
            }
        }
        return decodeOrThrow(response, "Failed to load sessions")
    }

    suspend fun getSessionMessages(
        token: String,
        sessionId: String,
        limit: Int = 50,
        before: String? = null
    ): SessionMessagesResponse {
        val response = client.get("$baseUrl/api/ai/sessions/$sessionId/messages") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("limit", limit.toString())
                if (!before.isNullOrBlank()) parameters.append("before", before)
            }
        }
        return decodeOrThrow(response, "Failed to load session messages")
    }

    suspend fun deleteSession(token: String, sessionId: String): DeleteSessionResponse {
        val response = client.delete("$baseUrl/api/ai/sessions/$sessionId") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to delete session")
    }

    suspend fun streamChat(
        token: String,
        request: ChatStreamRequest,
        onEvent: suspend (ChatStreamEvent) -> Unit
    ) {
        val bodyJson = DragonClawHelpers.lenientJson.encodeToString(ChatStreamRequest.serializer(), request)
        streamNdjsonPost(
            client = client,
            url = "$baseUrl/api/ai/chat",
            bearerHeader = DragonClawHelpers.normalizeBearerHeader(token),
            jsonBody = bodyJson
        ) { line ->
            val parsed = NdjsonStreamParser.parseLine(line) ?: return@streamNdjsonPost
            onEvent(parsed)
        }
    }

    // --- Voice Speech, Skills, Session Lifecycle, Schedules & Tool Nav Sync (P1) ---

    suspend fun transcribeSpeech(
        token: String,
        audioBytes: ByteArray,
        fileName: String = "voice.m4a",
        mimeType: String = "audio/mp4"
    ): SpeechRecognitionResponse {
        val safeName = fileName.replace("\"", "_")
        val response = client.submitFormWithBinaryData(
            url = "$baseUrl/api/ai/speech",
            formData = formData {
                append(
                    key = "audio",
                    value = audioBytes,
                    headers = Headers.build {
                        append(HttpHeaders.ContentType, mimeType)
                        append(HttpHeaders.ContentDisposition, "filename=\"$safeName\"")
                    }
                )
            }
        ) {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            timeout {
                requestTimeoutMillis = 75_000L
                socketTimeoutMillis = 75_000L
            }
        }
        return decodeOrThrow(response, "Speech transcription failed")
    }

    suspend fun getSkills(token: String): AgentSkillsResponse {
        val response = client.get("$baseUrl/api/ai/skills") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to load skills")
    }

    suspend fun compactSession(
        token: String,
        sessionId: String,
        modelId: String? = null
    ): CompactSessionResponse {
        val response = client.post("$baseUrl/api/ai/compact") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            contentType(ContentType.Application.Json)
            setBody(CompactSessionRequest(sessionId = sessionId, modelId = modelId))
            timeout {
                requestTimeoutMillis = 120_000L
                socketTimeoutMillis = 120_000L
            }
        }
        return decodeOrThrow(response, "Failed to compact context")
    }

    suspend fun getArchivedSessions(
        token: String,
        query: String = "",
        limit: Int = 40
    ): AiSessionsResponse {
        val response = client.get("$baseUrl/api/ai/sessions-archive") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("archivedOnly", "1")
                parameters.append("limit", limit.toString())
                if (query.isNotBlank()) parameters.append("query", query.trim())
            }
        }
        return decodeOrThrow(response, "Failed to load archived sessions")
    }

    suspend fun archiveSession(token: String, sessionId: String): ArchiveSessionResponse {
        val response = client.post("$baseUrl/api/ai/sessions/$sessionId/archive") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to archive session")
    }

    suspend fun unarchiveSession(token: String, sessionId: String): ArchiveSessionResponse {
        val response = client.post("$baseUrl/api/ai/sessions/$sessionId/unarchive") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to unarchive session")
    }

    suspend fun exportSessionRawJson(token: String, sessionId: String): String {
        val response = client.get("$baseUrl/api/ai/sessions/$sessionId/export") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        val raw = runCatching { response.bodyAsText() }.getOrDefault("")
        if (!response.status.isSuccess()) {
            throw ApiHttpException(
                response.status.value,
                DragonClawHelpers.parseErrorMessage(response.status.value, raw, "Failed to export session")
            )
        }
        return raw
    }

    suspend fun getSchedules(token: String): SchedulesResponse {
        val response = client.get("$baseUrl/api/ai/schedules") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to load schedules")
    }

    suspend fun createSchedule(token: String, request: CreateScheduleRequest): ScheduleMutationResponse {
        val response = client.post("$baseUrl/api/ai/schedules") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            contentType(ContentType.Application.Json)
            setBody(request)
        }
        return decodeOrThrow(response, "Failed to create schedule")
    }

    suspend fun deleteSchedule(token: String, scheduleId: String): ScheduleMutationResponse {
        val response = client.delete("$baseUrl/api/ai/schedules/$scheduleId") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to cancel schedule")
    }

    suspend fun getFavoriteNav(token: String): NavToolIdsResponse {
        val response = client.get("$baseUrl/api/favorite-nav") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to load favorites")
    }

    suspend fun saveFavoriteNav(token: String, ids: List<String>): NavToolIdsResponse {
        val response = client.put("$baseUrl/api/favorite-nav") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            contentType(ContentType.Application.Json)
            setBody(SaveFavoriteNavRequest(ids = ids))
        }
        return decodeOrThrow(response, "Failed to save favorites")
    }

    suspend fun getRecentNav(token: String): NavToolIdsResponse {
        val response = client.get("$baseUrl/api/recent-nav") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to load recent tools")
    }

    suspend fun recordRecentNav(token: String, toolId: String): NavToolIdsResponse {
        val response = client.post("$baseUrl/api/recent-nav") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            contentType(ContentType.Application.Json)
            setBody(RecordRecentNavRequest(toolId = toolId))
        }
        return decodeOrThrow(response, "Failed to record recent tool")
    }

    // --- Tool Hub ---

    suspend fun getCustomTools(token: String): List<CustomToolDto> {
        val response = client.get("$baseUrl/api/custom-tools") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to load custom tools")
    }

    suspend fun getHomeCapabilities(token: String): HomeCapabilitiesResponse {
        val response = client.get("$baseUrl/api/home/capabilities") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        return decodeOrThrow(response, "Failed to load capabilities")
    }

    // --- External Metrics (KPI / SLA Monitor) ---

    suspend fun getSummary(token: String, month: Int, includeOverall: Boolean? = true): SummaryResponse {
        val response = client.get("$baseUrl/api/external/metrics/summary") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("month", month.toString())
                if (includeOverall != null) parameters.append("include_overall", includeOverall.toString())
            }
        }
        return decodeOrThrow(response, "Failed to load summary")
    }

    suspend fun getSnapshots(token: String, month: Int, limit: Int = 20): SnapshotsResponse {
        val response = client.get("$baseUrl/api/external/metrics/snapshots") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("month", month.toString())
                parameters.append("limit", limit.toString())
            }
        }
        return decodeOrThrow(response, "Failed to load snapshots")
    }

    suspend fun getSnapshotDetail(
        token: String,
        snapshotId: String,
        month: Int,
        includeOverall: Boolean? = true
    ): SnapshotDetailResponse {
        val response = client.get("$baseUrl/api/external/metrics/snapshots/$snapshotId") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("month", month.toString())
                if (includeOverall != null) parameters.append("include_overall", includeOverall.toString())
            }
        }
        return decodeOrThrow(response, "Failed to load snapshot detail")
    }

    suspend fun getMetrics(
        token: String,
        month: Int,
        category: String? = null,
        snapshotId: String? = null,
        includeOverall: Boolean? = true,
        limit: Int = 2000
    ): MetricsListResponse {
        val response = client.get("$baseUrl/api/external/metrics") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("month", month.toString())
                if (category != null) parameters.append("category", category)
                if (snapshotId != null) parameters.append("snapshot_id", snapshotId)
                if (includeOverall != null) parameters.append("include_overall", includeOverall.toString())
                parameters.append("limit", limit.toString())
            }
        }
        return decodeOrThrow(response, "Failed to load metrics")
    }

    suspend fun getFailingMetrics(
        token: String,
        month: Int,
        category: String? = null,
        snapshotId: String? = null,
        limit: Int = 2000
    ): MetricsListResponse {
        val response = client.get("$baseUrl/api/external/metrics/failing") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("month", month.toString())
                if (category != null) parameters.append("category", category)
                if (snapshotId != null) parameters.append("snapshot_id", snapshotId)
                parameters.append("limit", limit.toString())
            }
        }
        return decodeOrThrow(response, "Failed to load failing metrics")
    }

    suspend fun getAlerts(token: String, month: Int): AlertsResponse {
        val response = client.get("$baseUrl/api/external/metrics/alerts") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("month", month.toString())
            }
        }
        return decodeOrThrow(response, "Failed to load alerts")
    }

    suspend fun getTrend(
        token: String,
        metricLabel: String,
        category: String,
        days: Int = 30,
        lang: String = "zh-CN"
    ): TrendResponse {
        val response = client.get("$baseUrl/api/external/metrics/trend") {
            header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
            url {
                parameters.append("metric_label", metricLabel)
                parameters.append("category", category)
                parameters.append("days", days.toString())
                parameters.append("lang", lang)
            }
        }
        return decodeOrThrow(response, "Failed to load trend")
    }
}
