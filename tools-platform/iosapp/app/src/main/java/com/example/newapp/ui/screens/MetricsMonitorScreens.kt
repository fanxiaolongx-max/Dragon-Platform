package com.example.newapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.newapp.shared.model.*
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.state.MetricsRoute
import com.example.newapp.ui.components.DragonClawBackdrop
import com.example.newapp.ui.components.GlassCircleIconButton
import com.example.newapp.ui.components.LiquidGlassSurface
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr

@Composable
fun MetricsMonitorRootScreen(
    vm: DragonClawViewModel,
    onClose: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val currentRoute = vm.metricsBackStack.lastOrNull() ?: MetricsRoute.Dashboard

    BackHandler {
        if (!vm.popMetricsRoute()) {
            onClose()
        }
    }

    LaunchedEffect(vm.currentMonth) {
        vm.ensureMonthLoaded(vm.currentMonth)
    }

    DragonClawBackdrop {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                GlassCircleIconButton(
                    icon = if (vm.metricsBackStack.size > 1) Icons.AutoMirrored.Rounded.ArrowBack else Icons.Rounded.Close,
                    contentDescription = "Back"
                ) {
                    if (!vm.popMetricsRoute()) onClose()
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    text = when (currentRoute) {
                        MetricsRoute.Dashboard -> tr(lang, "KPI 与 SLA 监控", "KPI & SLA Monitor")
                        is MetricsRoute.SnapshotDetail -> tr(lang, "快照详情", "Snapshot Detail")
                        is MetricsRoute.MetricsList -> currentRoute.title
                        is MetricsRoute.Alerts -> tr(lang, "临期与超时工单", "Expiring Tickets")
                        is MetricsRoute.Trend -> tr(lang, "30 天趋势分析", "30-Day Trend")
                        is MetricsRoute.Search -> tr(lang, "搜索指标", "Search Metrics")
                    },
                    color = palette.inkPrimary,
                    fontSize = 15.5.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (currentRoute == MetricsRoute.Dashboard) {
                    GlassCircleIconButton(
                        icon = Icons.Rounded.Search,
                        contentDescription = "Search",
                        size = 36.dp
                    ) {
                        vm.pushMetricsRoute(MetricsRoute.Search(vm.currentMonth))
                    }
                    Spacer(Modifier.width(6.dp))
                    GlassCircleIconButton(
                        icon = Icons.Rounded.Refresh,
                        contentDescription = "Refresh",
                        size = 36.dp
                    ) {
                        vm.ensureMonthLoaded(vm.currentMonth, force = true)
                    }
                }
            }

            when (currentRoute) {
                MetricsRoute.Dashboard -> MetricsDashboardBody(vm)
                is MetricsRoute.SnapshotDetail -> SnapshotDetailBody(vm, currentRoute.snapshotId, currentRoute.month)
                is MetricsRoute.MetricsList -> MetricsListBody(
                    vm = vm,
                    filterType = currentRoute.filterType,
                    month = currentRoute.month,
                    snapshotId = currentRoute.snapshotId,
                    category = currentRoute.category
                )
                is MetricsRoute.Alerts -> MetricsAlertsBody(vm, currentRoute.month)
                is MetricsRoute.Trend -> MetricsTrendBody(vm, currentRoute.metricLabel, currentRoute.category)
                is MetricsRoute.Search -> MetricsSearchBody(vm, currentRoute.month)
            }
        }
    }
}

@Composable
private fun MetricsDashboardBody(vm: DragonClawViewModel) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val month = vm.currentMonth
    val summary = vm.summaryByMonth[month]
    val snapshots = vm.snapshotsByMonth[month].orEmpty()
    val isLoading = vm.metricsLoadingMonths[month] == true
    val error = vm.metricsErrorByMonth[month]

    val monthRowState = rememberLazyListState()
    LaunchedEffect(month) {
        val targetIndex = (month - 1).coerceIn(0, 11)
        monthRowState.animateScrollToItem(targetIndex)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        LazyRow(
            state = monthRowState,
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            items((1..12).toList()) { m ->
                val isSelected = m == month
                LiquidGlassSurface(
                    shape = CircleShape,
                    tint = if (isSelected) palette.accent else null,
                    tintAlpha = 0.22f,
                    elevation = if (isSelected) 5.dp else 2.dp,
                    onClick = {
                        vm.currentMonth = m
                        vm.ensureMonthLoaded(m)
                    }
                ) {
                    Text(
                        text = if (lang == "en") "M$m" else "${m}月",
                        color = if (isSelected) palette.accentStrong else palette.inkSecondary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 5.5.dp)
                    )
                }
            }
        }

        if (isLoading && summary == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = palette.accentStrong)
            }
        } else if (error != null && summary == null) {
            Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                LiquidGlassSurface(shape = RoundedCornerShape(20.dp)) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(20.dp)) {
                        Text(error, color = palette.danger, fontSize = 14.sp)
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = { vm.ensureMonthLoaded(month, force = true) }) {
                            Text(tr(lang, "重新加载", "Retry"))
                        }
                    }
                }
            }
        } else if (summary != null) {
            LazyColumn(
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                summary.latest_snapshot?.let { snap ->
                    item {
                        LiquidGlassSurface(
                            shape = RoundedCornerShape(22.dp),
                            tint = palette.accent,
                            tintAlpha = 0.14f,
                            elevation = 6.dp,
                            onClick = { vm.pushMetricsRoute(MetricsRoute.SnapshotDetail(snap.snapshot_id, month)) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.padding(18.dp).fillMaxWidth()
                            ) {
                                Column {
                                    Text(tr(lang, "最新评估总分", "Latest Evaluation Score"), color = palette.inkSecondary, fontSize = 11.5.sp)
                                    Spacer(Modifier.height(3.dp))
                                    Text(snap.created_at, color = palette.inkMuted, fontSize = 10.5.sp)
                                }
                                Text(
                                    text = snap.standard_total_score?.let { String.format("%.2f", it) } ?: "--",
                                    color = palette.accentStrong,
                                    fontSize = 26.sp,
                                    fontWeight = FontWeight.Black
                                )
                            }
                        }
                    }
                }

                if (summary.latest_category_scores.isNotEmpty()) {
                    item {
                        Text(
                            text = tr(lang, "各领域评分", "Category Scores"),
                            color = palette.inkPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    summary.latest_category_scores.chunked(2).forEach { pair ->
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                pair.forEach { cat ->
                                    LiquidGlassSurface(
                                        shape = RoundedCornerShape(18.dp),
                                        elevation = 4.dp,
                                        onClick = {
                                            vm.pushMetricsRoute(
                                                MetricsRoute.MetricsList(
                                                    title = cat.localizedCategory(lang),
                                                    filterType = "category",
                                                    month = month,
                                                    snapshotId = summary.latest_snapshot?.snapshot_id,
                                                    category = cat.category
                                                )
                                            )
                                        },
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Column(modifier = Modifier.padding(12.dp)) {
                                            Text(cat.localizedCategory(lang), color = palette.inkSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                            Spacer(Modifier.height(4.dp))
                                            Text(
                                                text = cat.final_score?.let { String.format("%.2f", it) } ?: "--",
                                                color = palette.accentStrong,
                                                fontSize = 17.5.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                    }
                                }
                                if (pair.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                            SummaryKpiTile(
                                title = tr(lang, "合规率", "Compliance"),
                                value = summary.compliance_rate?.let { String.format("%.1f%%", it) } ?: "--",
                                color = palette.accentStrong,
                                modifier = Modifier.weight(1f),
                                onClick = null
                            )
                            SummaryKpiTile(
                                title = tr(lang, "本月快照", "Snapshots"),
                                value = "${summary.snapshot_count}",
                                color = palette.info,
                                modifier = Modifier.weight(1f),
                                onClick = summary.latest_snapshot?.let { snap ->
                                    { vm.pushMetricsRoute(MetricsRoute.SnapshotDetail(snap.snapshot_id, month)) }
                                }
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                            SummaryKpiTile(
                                title = tr(lang, "异常指标", "Failing KPIs"),
                                value = "${summary.failing_metric_count}",
                                color = palette.danger,
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    vm.pushMetricsRoute(
                                        MetricsRoute.MetricsList(
                                            title = tr(lang, "异常指标", "Failing KPIs"),
                                            filterType = "failing",
                                            month = month,
                                            snapshotId = summary.latest_snapshot?.snapshot_id,
                                            category = null
                                        )
                                    )
                                }
                            )
                            SummaryKpiTile(
                                title = tr(lang, "临期/超时工单", "Expiring Tickets"),
                                value = "${summary.latest_expiring_ticket_count}",
                                color = palette.warning,
                                modifier = Modifier.weight(1f),
                                onClick = { vm.pushMetricsRoute(MetricsRoute.Alerts(month)) }
                            )
                        }
                    }
                }

                if (snapshots.isNotEmpty()) {
                    item {
                        Text(
                            text = tr(lang, "历史评估快照", "Historical Snapshots"),
                            color = palette.inkPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    items(snapshots, key = { it.snapshot_id }) { snap ->
                        LiquidGlassSurface(
                            shape = RoundedCornerShape(16.dp),
                            elevation = 3.dp,
                            onClick = { vm.pushMetricsRoute(MetricsRoute.SnapshotDetail(snap.snapshot_id, month)) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.padding(14.dp).fillMaxWidth()
                            ) {
                                Column {
                                    Text(snap.created_at, color = palette.inkPrimary, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
                                    Text("ID: ${snap.snapshot_id}", color = palette.inkMuted, fontSize = 10.5.sp, fontFamily = FontFamily.Monospace)
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = snap.standard_total_score?.let { String.format("%.2f", it) } ?: "--",
                                        color = palette.accentStrong,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                    Spacer(Modifier.width(4.dp))
                                    Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = palette.inkMuted)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryKpiTile(
    title: String,
    value: String,
    color: Color,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)?
) {
    val palette = LocalDragonClawPalette.current
    LiquidGlassSurface(
        shape = RoundedCornerShape(18.dp),
        elevation = 4.dp,
        onClick = onClick,
        modifier = modifier
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(title, color = palette.inkSecondary, fontSize = 11.sp)
            Spacer(Modifier.height(4.dp))
            Text(value, color = color, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SnapshotDetailBody(vm: DragonClawViewModel, snapshotId: String, month: Int) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    var detail by remember { mutableStateOf<SnapshotDetailResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(snapshotId, month) {
        loading = true
        runCatching { vm.sdk.api.getSnapshotDetail(vm.token, snapshotId, month, true) }
            .onSuccess { detail = it; loading = false }
            .onFailure { error = it.message; loading = false }
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = palette.accentStrong) }
        error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(error!!, color = palette.danger) }
        detail != null -> {
            val d = detail!!
            LazyColumn(
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                item {
                    LiquidGlassSurface(shape = RoundedCornerShape(20.dp), tint = palette.accent, tintAlpha = 0.12f) {
                        Row(
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth().padding(16.dp)
                        ) {
                            Column {
                                Text(d.snapshot.created_at, color = palette.inkPrimary, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                                Text("${d.metrics.size} ${tr(lang, "项指标", "Metrics")}", color = palette.inkMuted, fontSize = 11.sp)
                            }
                            Text(
                                text = d.snapshot.standard_total_score?.let { String.format("%.2f", it) } ?: "--",
                                color = palette.accentStrong,
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Black
                            )
                        }
                    }
                }
                items(d.metrics) { metric ->
                    MetricGlassRow(metric, lang) {
                        vm.pushMetricsRoute(MetricsRoute.Trend(metric.metric_label, metric.category))
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricsListBody(
    vm: DragonClawViewModel,
    filterType: String,
    month: Int,
    snapshotId: String?,
    category: String?
) {
    val palette = LocalDragonClawPalette.current
    var items by remember { mutableStateOf<List<Metric>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(filterType, month, snapshotId, category) {
        loading = true
        runCatching {
            if (filterType == "failing") {
                vm.sdk.api.getFailingMetrics(vm.token, month, category, snapshotId, 2000)
            } else {
                vm.sdk.api.getMetrics(vm.token, month, category, snapshotId, true, 2000)
            }
        }
            .onSuccess { items = it.items; loading = false }
            .onFailure { error = it.message; loading = false }
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = palette.accentStrong) }
        error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(error!!, color = palette.danger) }
        else -> {
            LazyColumn(
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(items) { metric ->
                    MetricGlassRow(metric, vm.language) {
                        vm.pushMetricsRoute(MetricsRoute.Trend(metric.metric_label, metric.category))
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricGlassRow(metric: Metric, language: String, onTrendClick: () -> Unit) {
    val palette = LocalDragonClawPalette.current
    LiquidGlassSurface(
        shape = RoundedCornerShape(18.dp),
        elevation = 4.dp,
        onClick = onTrendClick,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(metric.localizedCategory(language), color = palette.accentStrong, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    if (metric.schema?.is_sub_metric == true) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = tr(language, "子指标", "SUB"),
                            color = palette.info,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .background(palette.info.copy(alpha = 0.14f), CircleShape)
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }
                Text(
                    text = if (metric.is_failing) tr(language, "异常", "FAIL") else tr(language, "达标", "OK"),
                    color = if (metric.is_failing) palette.danger else palette.accentStrong,
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(metric.localizedLabel(language), color = palette.inkPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(5.dp))
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text("${tr(language, "目标", "Target")}: ${metric.display_target_value ?: metric.target_value ?: "-"}", color = palette.inkSecondary, fontSize = 11.sp)
                Text(
                    text = "${tr(language, "实际", "Actual")}: ${metric.raw_value ?: "-"}",
                    color = if (metric.is_failing) palette.danger else palette.inkPrimary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
            metric.gap?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(3.dp))
                Text("${tr(language, "差距", "Gap")}: $it", color = palette.warning, fontSize = 10.5.sp)
            }
        }
    }
}

@Composable
private fun MetricsAlertsBody(vm: DragonClawViewModel, month: Int) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    var alerts by remember { mutableStateOf<AlertsResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(month) {
        loading = true
        runCatching { vm.sdk.api.getAlerts(vm.token, month) }
            .onSuccess { alerts = it; loading = false }
            .onFailure { error = it.message; loading = false }
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = palette.accentStrong) }
        error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(error!!, color = palette.danger) }
        else -> {
            val tickets = alerts?.expiring_tickets.orEmpty()
            if (tickets.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(tr(lang, "当前无临期或超时工单", "No expiring tickets"), color = palette.inkMuted)
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    items(tickets) { ticket ->
                        TicketGlassRow(ticket, lang)
                    }
                }
            }
        }
    }
}

@Composable
private fun TicketGlassRow(ticket: ExpiringTicket, lang: String) {
    val palette = LocalDragonClawPalette.current
    var expanded by remember { mutableStateOf(false) }
    val statusColor = if (ticket.isOverdue) palette.danger else palette.warning

    LiquidGlassSurface(
        shape = RoundedCornerShape(18.dp),
        elevation = 4.dp,
        onClick = { expanded = !expanded },
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text(ticket.localizedCollection(lang).uppercase(), color = palette.accentStrong, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text(
                    text = if (ticket.isOverdue) tr(lang, "已超时", "OVERDUE") else tr(lang, "临期", "EXPIRING"),
                    color = statusColor,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Black,
                    modifier = Modifier
                        .background(statusColor.copy(alpha = 0.14f), CircleShape)
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(ticket.localizedTitle(lang), color = palette.inkPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(5.dp))
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text("ID: ${ticket.ticket_id}", color = palette.inkSecondary, fontSize = 11.sp)
                Text("${tr(lang, "到期", "Due")}: ${ticket.due_date ?: "-"}", color = palette.inkSecondary, fontSize = 11.sp)
            }
            val sla = ticket.localizedSlaText(lang)
            if (sla.isNotBlank()) {
                Spacer(Modifier.height(3.dp))
                Text(sla, color = statusColor, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }
            AnimatedVisibility(visible = expanded) {
                Column(modifier = Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    HorizontalDivider(color = palette.hairLine)
                    Spacer(Modifier.height(4.dp))
                    ticket.owner?.let { Text("${tr(lang, "负责人", "Owner")}: $it", color = palette.inkSecondary, fontSize = 11.sp) }
                    ticket.customer_name?.let { Text("${tr(lang, "客户", "Customer")}: $it", color = palette.inkSecondary, fontSize = 11.sp) }
                    ticket.network_name?.let { Text("${tr(lang, "网络", "Network")}: $it", color = palette.inkSecondary, fontSize = 11.sp) }
                    ticket.product?.let { Text("${tr(lang, "产品", "Product")}: $it", color = palette.inkSecondary, fontSize = 11.sp) }
                    ticket.status?.let { Text("${tr(lang, "状态", "Status")}: $it", color = palette.inkSecondary, fontSize = 11.sp) }
                }
            }
        }
    }
}

@Composable
private fun MetricsTrendBody(vm: DragonClawViewModel, metricLabel: String, category: String) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    var trend by remember { mutableStateOf<TrendResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(metricLabel, category) {
        loading = true
        runCatching { vm.sdk.api.getTrend(vm.token, metricLabel, category, 30, if (lang == "en") "en-US" else "zh-CN") }
            .onSuccess { trend = it; loading = false }
            .onFailure { error = it.message; loading = false }
    }

    when {
        loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = palette.accentStrong) }
        error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(error!!, color = palette.danger) }
        trend != null -> {
            val points = trend!!.points
            val values = points.mapNotNull { it.numeric_value }
            LazyColumn(
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                item {
                    Text(metricLabel, color = palette.inkPrimary, fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                }
                if (values.size >= 2) {
                    item {
                        LiquidGlassSurface(shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                            val minV = values.minOrNull() ?: 0f
                            val maxV = values.maxOrNull() ?: 1f
                            val span = (maxV - minV).coerceAtLeast(0.0001f)
                            Canvas(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(170.dp)
                                    .padding(16.dp)
                            ) {
                                val path = Path()
                                values.forEachIndexed { idx, v ->
                                    val x = idx.toFloat() / (values.size - 1).coerceAtLeast(1) * size.width
                                    val y = size.height - ((v - minV) / span) * size.height
                                    if (idx == 0) path.moveTo(x, y) else path.lineTo(x, y)
                                    drawCircle(palette.accentStrong, radius = 6f, center = Offset(x, y))
                                }
                                drawPath(
                                    path = path,
                                    color = palette.accent,
                                    style = Stroke(width = 5f, cap = StrokeCap.Round, join = StrokeJoin.Round)
                                )
                            }
                        }
                    }
                }
                items(points.reversed()) { pt ->
                    LiquidGlassSurface(shape = RoundedCornerShape(14.dp), elevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
                        Row(
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(12.dp).fillMaxWidth()
                        ) {
                            Column {
                                Text(pt.snapshot_created_at, color = palette.inkPrimary, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
                                Text("${tr(lang, "目标", "Target")}: ${pt.display_target_value ?: pt.target_value ?: "-"}", color = palette.inkMuted, fontSize = 10.5.sp)
                            }
                            Text(
                                text = pt.raw_value ?: "-",
                                color = if (pt.is_failing) palette.danger else palette.accentStrong,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricsSearchBody(vm: DragonClawViewModel, month: Int) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    var query by remember { mutableStateOf("") }
    var allMetrics by remember { mutableStateOf<List<Metric>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(month) {
        loading = true
        runCatching { vm.sdk.api.getMetrics(vm.token, month, limit = 2000) }
            .onSuccess { allMetrics = it.items; loading = false }
            .onFailure { loading = false }
    }

    val filtered = remember(query, allMetrics, lang) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) allMetrics
        else allMetrics.filter {
            it.metric_label.lowercase().contains(q) ||
                it.localizedLabel(lang).lowercase().contains(q) ||
                it.category.lowercase().contains(q)
        }
    }

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text(tr(lang, "输入指标名称或分类...", "Filter metric name or category...")) },
            leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
            singleLine = true,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
        )
        if (loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = palette.accentStrong)
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(bottom = 20.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(filtered) { metric ->
                    MetricGlassRow(metric, lang) {
                        vm.pushMetricsRoute(MetricsRoute.Trend(metric.metric_label, metric.category))
                    }
                }
            }
        }
    }
}
