package com.example.newapp.shared.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class CategoryScore(
    val category: String,
    val base_score: Float? = null,
    val manual_score: Float? = null,
    val final_score: Float? = null
) {
    fun localizedCategory(language: String): String =
        if (language == "en" && category == "整体") "OVERALL" else category
}

@Serializable
data class LabelI18n(
    val zh: String? = null,
    val en: String? = null
)

@Serializable
data class TargetConfig(
    val label_i18n: LabelI18n? = null
)

@Serializable
data class MetricSchema(
    val source_title: String? = null,
    val main_metric_label: String? = null,
    val is_sub_metric: Boolean = false,
    val target_config: TargetConfig? = null
)

@Serializable
data class Metric(
    val id: Int? = null,
    val metric_label: String,
    val category: String,
    val target_value: String? = null,
    val display_target_value: String? = null,
    val target_numeric_value: Double? = null,
    val target_is_percent: Boolean? = null,
    val raw_value: String? = null,
    val numeric_value: Float? = null,
    val is_failing: Boolean = false,
    val gap: String? = null,
    val weight: Float? = null,
    val earned_score: Float? = null,
    val schema: MetricSchema? = null,
    val is_derived_overall: Boolean? = null
) {
    fun localizedLabel(language: String): String =
        if (language == "en") {
            schema?.target_config?.label_i18n?.en?.takeIf { it.isNotBlank() } ?: metric_label
        } else {
            schema?.target_config?.label_i18n?.zh?.takeIf { it.isNotBlank() } ?: metric_label
        }

    fun localizedCategory(language: String): String =
        if (language == "en" && category == "整体") "OVERALL" else category
}

@Serializable
data class Snapshot(
    val snapshot_id: String,
    val month: Int? = null,
    val created_at: String,
    val standard_total_score: Float? = null,
    val image_path: String? = null,
    val excel_path: String? = null
)

@Serializable
data class SlaStatus(
    val raw_text: String? = null,
    val remaining_text: String? = null,
    val overdue_text: String? = null,
    val consume_percent: Float? = null,
    val sla_days: Int? = null,
    val status_label: String? = null,
    val is_overdue: Boolean = false
)

@Serializable
data class ExpiringTicket(
    val collection: String,
    val collection_label_i18n: LabelI18n? = null,
    val display_collection_label: String? = null,
    val title: String? = null,
    val title_i18n: LabelI18n? = null,
    val display_title: String? = null,
    val ticket_id: String,
    val network_name: String? = null,
    val status: String? = null,
    val owner: String? = null,
    val product_line: String? = null,
    val product: String? = null,
    val customer_name: String? = null,
    val due_date: String? = null,
    val sla_days: Int? = null,
    val urgency: String? = null,
    val sla_text: String? = null,
    val sla_text_i18n: LabelI18n? = null,
    val display_sla_text: String? = null,
    val sla_status: SlaStatus? = null,
    val raw: JsonElement? = null
) {
    val isOverdue: Boolean
        get() = sla_status?.is_overdue ?: (urgency == "overdue")

    fun localizedCollection(language: String): String =
        if (language == "en") {
            collection_label_i18n?.en ?: display_collection_label ?: collection
        } else {
            collection_label_i18n?.zh ?: display_collection_label ?: collection
        }

    fun localizedTitle(language: String): String =
        if (language == "en") {
            title_i18n?.en ?: display_title ?: title ?: "Ticket: $ticket_id"
        } else {
            title_i18n?.zh ?: display_title ?: title ?: "Ticket: $ticket_id"
        }

    fun localizedSlaText(language: String): String =
        if (language == "en") {
            sla_text_i18n?.en ?: display_sla_text ?: sla_text.orEmpty()
        } else {
            sla_text_i18n?.zh ?: display_sla_text ?: sla_text.orEmpty()
        }
}

@Serializable
data class AlertData(
    val expiring_tickets: List<ExpiringTicket> = emptyList()
)

@Serializable
data class AlertsResponse(
    val snapshot: Snapshot? = null,
    val expiring_ticket_count: Int = 0,
    val special_metric_alert_count: Int = 0,
    val expiring_tickets: List<ExpiringTicket> = emptyList()
)

@Serializable
data class SummaryResponse(
    val snapshot_count: Int = 0,
    val metric_count: Int = 0,
    val failing_metric_count: Int = 0,
    val compliance_rate: Float? = null,
    val first_snapshot_at: String? = null,
    val latest_snapshot_at: String? = null,
    val latest_snapshot: Snapshot? = null,
    val latest_metrics_total: Int = 0,
    val latest_category_scores: List<CategoryScore> = emptyList(),
    val latest_failing_metrics: List<Metric> = emptyList(),
    val latest_expiring_ticket_count: Int = 0,
    val latest_special_metric_alert_count: Int = 0,
    val latest_alerts: AlertData? = null
)

@Serializable
data class TrendPoint(
    val snapshot_id: String,
    val month: Int,
    val snapshot_created_at: String,
    val stored_at: String? = null,
    val category: String,
    val metric_label: String,
    val display_metric_label: String? = null,
    val target_value: String? = null,
    val display_target_value: String? = null,
    val target_numeric_value: Double? = null,
    val target_is_percent: Boolean? = null,
    val raw_value: String? = null,
    val numeric_value: Float? = null,
    val is_failing: Boolean,
    val gap: String? = null
)

@Serializable
data class TrendResponse(
    val point_count: Int = 0,
    val points: List<TrendPoint> = emptyList()
)

@Serializable
data class SnapshotsResponse(
    val items: List<Snapshot> = emptyList()
)

@Serializable
data class SnapshotDetailResponse(
    val snapshot: Snapshot,
    val category_scores: List<CategoryScore> = emptyList(),
    val metrics: List<Metric> = emptyList()
)

@Serializable
data class MetricsListResponse(
    val items: List<Metric> = emptyList()
)
