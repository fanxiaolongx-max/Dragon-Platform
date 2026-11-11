import SwiftUI
import shared

struct MetricsMonitorRootScreen: View {
    @Bindable var store: DragonClawStore
    @Environment(\.dismiss) private var dismiss

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        NavigationStack(path: $store.metricsPath) {
            ZStack {
                DragonClawBackdrop(palette: palette)

                VStack(spacing: 0) {
                    monthSelectorStrip
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)

                    MetricsDashboardMonthView(store: store, month: store.currentMonth)
                }
            }
            .navigationTitle(L10n.tr(lang, zh: "KPI 与 SLA 监控", en: "KPI & SLA Monitor"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        store.metricsPath.append(.search(month: store.currentMonth))
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    Button {
                        store.ensureMonthLoaded(store.currentMonth, force: true)
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .navigationDestination(for: MetricsRoute.self) { route in
                switch route {
                case .dashboard:
                    MetricsDashboardMonthView(store: store, month: store.currentMonth)
                case .snapshotDetail(let snapshotId, let month):
                    MetricsSnapshotDetailView(store: store, snapshotId: snapshotId, month: month)
                case .metricsList(let title, let filterType, let month, let snapshotId, let category):
                    MetricsListDetailView(
                        store: store,
                        title: title,
                        filterType: filterType,
                        month: month,
                        snapshotId: snapshotId,
                        category: category
                    )
                case .alerts(let month):
                    MetricsAlertsListView(store: store, month: month)
                case .trend(let metricLabel, let category):
                    MetricTrendDetailView(store: store, metricLabel: metricLabel, category: category)
                case .search(let month):
                    MetricsSearchDetailView(store: store, month: month)
                }
            }
        }
        .onAppear {
            store.ensureMonthLoaded(store.currentMonth)
        }
    }

    private var monthSelectorStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 6) {
                    HStack(spacing: 8) {
                        ForEach(1...12, id: \.self) { m in
                            let isSelected = store.currentMonth == m
                            Button {
                                withAnimation(.snappy(duration: 0.22)) {
                                    store.currentMonth = m
                                }
                                store.ensureMonthLoaded(m)
                            } label: {
                                Text(lang == "en" ? "M\(m)" : "\(m)月")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(isSelected ? palette.accentStrong : palette.inkSecondary)
                                    .padding(.horizontal, 11)
                                    .padding(.vertical, 6)
                            }
                            .id(m)
                            .buttonStyle(.plain)
                            .glassEffect(
                                isSelected ? .regular.tint(palette.accent.opacity(0.20)).interactive() : .regular.interactive(),
                                in: .capsule
                            )
                        }
                    }
                }
            }
            .onAppear {
                proxy.scrollTo(store.currentMonth, anchor: .center)
            }
            .onChange(of: store.currentMonth) { _, targetMonth in
                withAnimation(.snappy(duration: 0.24)) {
                    proxy.scrollTo(targetMonth, anchor: .center)
                }
            }
        }
    }
}

private struct MetricsDashboardMonthView: View {
    @Bindable var store: DragonClawStore
    let month: Int

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if store.metricsLoadingByMonth.contains(month) && store.summaryByMonth[month] == nil {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text(L10n.tr(lang, zh: "加载 \(month) 月指标数据...", en: "Loading Month \(month) metrics..."))
                            .font(.caption)
                            .foregroundStyle(palette.inkMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 60)
                } else if let err = store.metricsErrorByMonth[month], store.summaryByMonth[month] == nil {
                    VStack(spacing: 12) {
                        Text(err)
                            .font(.subheadline)
                            .foregroundStyle(palette.danger)
                            .multilineTextAlignment(.center)
                        Button(L10n.tr(lang, zh: "重新加载", en: "Retry")) {
                            store.ensureMonthLoaded(month, force: true)
                        }
                        .buttonStyle(.glassProminent)
                        .tint(palette.accentStrong)
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                } else if let summary = store.summaryByMonth[month] {
                    if let snap = summary.latest_snapshot {
                        Button {
                            store.metricsPath.append(.snapshotDetail(snapshotId: snap.snapshot_id, month: month))
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(L10n.tr(lang, zh: "最新评估总分", en: "Latest Evaluation Score"))
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(palette.inkSecondary)
                                    Text(snap.created_at)
                                        .font(.caption2)
                                        .foregroundStyle(palette.inkMuted)
                                }
                                Spacer()
                                Text(snap.standard_total_score.map { String(format: "%.2f", $0.floatValue) } ?? "--")
                                    .font(.system(size: 30, weight: .black, design: .rounded))
                                    .foregroundStyle(palette.accentStrong)
                            }
                            .padding(18)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.tint(palette.accent.opacity(0.12)).interactive(), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }

                    if !summary.latest_category_scores.isEmpty {
                        Text(L10n.tr(lang, zh: "各领域评分", en: "Category Scores"))
                            .font(.system(size: 13.5, weight: .bold))
                            .foregroundStyle(palette.inkPrimary)

                        LazyVGrid(
                            columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                            spacing: 10
                        ) {
                            ForEach(summary.latest_category_scores, id: \.category) { cat in
                                Button {
                                    let catTitle = cat.localizedCategory(language: lang)
                                    store.metricsPath.append(
                                        .metricsList(
                                            title: catTitle,
                                            filterType: "category",
                                            month: month,
                                            snapshotId: summary.latest_snapshot?.snapshot_id,
                                            category: cat.category
                                        )
                                    )
                                } label: {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(cat.localizedCategory(language: lang))
                                            .font(.system(size: 11.5, weight: .bold))
                                            .foregroundStyle(palette.inkSecondary)
                                        Text(cat.final_score.map { String(format: "%.2f", $0.floatValue) } ?? "--")
                                            .font(.system(size: 18, weight: .bold))
                                            .foregroundStyle(palette.accentStrong)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(12)
                                }
                                .buttonStyle(.plain)
                                .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            }
                        }
                    }

                    // 2x2 Summary KPI cards
                    LazyVGrid(
                        columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                        spacing: 10
                    ) {
                        summaryCard(
                            title: L10n.tr(lang, zh: "合规率", en: "Compliance Rate"),
                            value: summary.compliance_rate.map { String(format: "%.1f%%", $0.floatValue) } ?? "--",
                            color: palette.accentStrong,
                            action: nil
                        )
                        summaryCard(
                            title: L10n.tr(lang, zh: "本月快照", en: "Snapshots"),
                            value: "\(summary.snapshot_count)",
                            color: palette.info,
                            action: summary.latest_snapshot.map { snap in
                                { store.metricsPath.append(.snapshotDetail(snapshotId: snap.snapshot_id, month: month)) }
                            }
                        )
                        summaryCard(
                            title: L10n.tr(lang, zh: "异常指标", en: "Failing KPIs"),
                            value: "\(summary.failing_metric_count)",
                            color: palette.danger,
                            action: {
                                store.metricsPath.append(
                                    .metricsList(
                                        title: L10n.tr(lang, zh: "异常指标", en: "Failing Metrics"),
                                        filterType: "failing",
                                        month: month,
                                        snapshotId: summary.latest_snapshot?.snapshot_id,
                                        category: nil
                                    )
                                )
                            }
                        )
                        summaryCard(
                            title: L10n.tr(lang, zh: "临期/超时工单", en: "Expiring Tickets"),
                            value: "\(summary.latest_expiring_ticket_count)",
                            color: palette.warning,
                            action: {
                                store.metricsPath.append(.alerts(month: month))
                            }
                        )
                    }

                    let snapshots = store.snapshotsByMonth[month] ?? []
                    if !snapshots.isEmpty {
                        Text(L10n.tr(lang, zh: "历史评估快照", en: "Historical Snapshots"))
                            .font(.system(size: 13.5, weight: .bold))
                            .foregroundStyle(palette.inkPrimary)
                            .padding(.top, 4)

                        ForEach(snapshots, id: \.snapshot_id) { snap in
                            Button {
                                store.metricsPath.append(.snapshotDetail(snapshotId: snap.snapshot_id, month: month))
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(snap.created_at)
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(palette.inkPrimary)
                                        Text("ID: \(snap.snapshot_id)")
                                            .font(.system(size: 10.5, design: .monospaced))
                                            .foregroundStyle(palette.inkMuted)
                                    }
                                    Spacer()
                                    Text(snap.standard_total_score.map { String(format: "%.2f", $0.floatValue) } ?? "--")
                                        .font(.system(size: 14.5, weight: .bold))
                                        .foregroundStyle(palette.accentStrong)
                                    Image(systemName: "chevron.right")
                                        .font(.caption2)
                                        .foregroundStyle(palette.inkMuted)
                                }
                                .padding(14)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .padding(.bottom, 24)
        }
        .refreshable {
            store.ensureMonthLoaded(month, force: true)
        }
    }

    private func summaryCard(title: String, value: String, color: Color, action: (() -> Void)?) -> some View {
        Button {
            action?()
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(palette.inkSecondary)
                Text(value)
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(color)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
        .glassEffect(.regular.interactive(action != nil), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct MetricsSnapshotDetailView: View {
    @Bindable var store: DragonClawStore
    let snapshotId: String
    let month: Int

    @State private var detail: SnapshotDetailResponse? = nil
    @State private var isLoading = true
    @State private var errorMsg: String? = nil

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        ZStack {
            DragonClawBackdrop(palette: palette)

            if isLoading {
                ProgressView()
            } else if let errorMsg {
                Text(errorMsg).foregroundStyle(palette.danger).padding()
            } else if let detail {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(detail.snapshot.created_at)
                                    .font(.system(size: 14.5, weight: .bold))
                                Text("\(detail.metrics.count) \(L10n.tr(lang, zh: "项指标", en: "Metrics"))")
                                    .font(.system(size: 11))
                                    .foregroundStyle(palette.inkMuted)
                            }
                            Spacer()
                            Text(detail.snapshot.standard_total_score.map { String(format: "%.2f", $0.floatValue) } ?? "--")
                                .font(.system(size: 22, weight: .black))
                                .foregroundStyle(palette.accentStrong)
                        }
                        .padding(16)
                        .glassEffect(.regular.tint(palette.accent.opacity(0.12)), in: RoundedRectangle(cornerRadius: 20, style: .continuous))

                        ForEach(Array(detail.metrics.enumerated()), id: \.offset) { _, metric in
                            MetricGlassCard(metric: metric, store: store)
                        }
                    }
                    .padding(14)
                }
            }
        }
        .navigationTitle(L10n.tr(lang, zh: "快照详情", en: "Snapshot Detail"))
        .onAppear {
            store.sdk.fetchSnapshotDetail(token: store.token, snapshotId: snapshotId, month: Int32(month), includeOverall: true) { res in
                Task { @MainActor in
                    self.detail = res
                    self.isLoading = false
                }
            } onError: { err in
                Task { @MainActor in
                    self.errorMsg = err
                    self.isLoading = false
                }
            }
        }
    }
}

private struct MetricsListDetailView: View {
    @Bindable var store: DragonClawStore
    let title: String
    let filterType: String
    let month: Int
    let snapshotId: String?
    let category: String?

    @State private var items: [Metric] = []
    @State private var isLoading = true
    @State private var errorMsg: String? = nil

    private var palette: DragonClawPalette { store.palette }

    var body: some View {
        ZStack {
            DragonClawBackdrop(palette: palette)

            if isLoading {
                ProgressView()
            } else if let errorMsg {
                Text(errorMsg).foregroundStyle(palette.danger).padding()
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, metric in
                            MetricGlassCard(metric: metric, store: store)
                        }
                    }
                    .padding(14)
                }
            }
        }
        .navigationTitle(title)
        .onAppear {
            if filterType == "failing" {
                store.sdk.fetchFailingMetrics(token: store.token, month: Int32(month), category: category, snapshotId: snapshotId, limit: 2000) { res in
                    Task { @MainActor in
                        self.items = res.items
                        self.isLoading = false
                    }
                } onError: { err in
                    Task { @MainActor in
                        self.errorMsg = err
                        self.isLoading = false
                    }
                }
            } else {
                store.sdk.fetchMetrics(token: store.token, month: Int32(month), category: category, snapshotId: snapshotId, includeOverall: true, limit: 2000) { res in
                    Task { @MainActor in
                        self.items = res.items
                        self.isLoading = false
                    }
                } onError: { err in
                    Task { @MainActor in
                        self.errorMsg = err
                        self.isLoading = false
                    }
                }
            }
        }
    }
}

private struct MetricGlassCard: View {
    let metric: Metric
    @Bindable var store: DragonClawStore

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        Button {
            store.metricsPath.append(.trend(metricLabel: metric.metric_label, category: metric.category))
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(metric.localizedCategory(language: lang))
                        .font(.system(size: 11.5, weight: .bold))
                        .foregroundStyle(palette.accentStrong)
                    if metric.schema?.is_sub_metric == true {
                        Text(L10n.tr(lang, zh: "子指标", en: "SUB"))
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(palette.info)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(palette.info.opacity(0.14), in: Capsule())
                    }
                    Spacer()
                    Text(metric.is_failing ? L10n.tr(lang, zh: "异常", en: "FAIL") : L10n.tr(lang, zh: "达标", en: "OK"))
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundStyle(metric.is_failing ? palette.danger : palette.accentStrong)
                }

                Text(metric.localizedLabel(language: lang))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(palette.inkPrimary)
                    .multilineTextAlignment(.leading)

                HStack {
                    Text("\(L10n.tr(lang, zh: "目标", en: "Target")): \(metric.display_target_value ?? metric.target_value ?? "-")")
                        .font(.system(size: 11))
                        .foregroundStyle(palette.inkSecondary)
                    Spacer()
                    Text("\(L10n.tr(lang, zh: "实际", en: "Actual")): \(metric.raw_value ?? "-")")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(metric.is_failing ? palette.danger : palette.inkPrimary)
                }

                if let gap = metric.gap, !gap.isEmpty {
                    Text("\(L10n.tr(lang, zh: "差距", en: "Gap")): \(gap)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(palette.warning)
                }

                HStack {
                    Spacer()
                    Label(L10n.tr(lang, zh: "查看 30 天趋势", en: "30-day trend"), systemImage: "chart.line.uptrend.xyaxis")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(palette.accentStrong)
                }
            }
            .padding(14)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct MetricsAlertsListView: View {
    @Bindable var store: DragonClawStore
    let month: Int

    @State private var alerts: AlertsResponse? = nil
    @State private var isLoading = true
    @State private var errorMsg: String? = nil

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        ZStack {
            DragonClawBackdrop(palette: palette)

            if isLoading {
                ProgressView()
            } else if let errorMsg {
                Text(errorMsg).foregroundStyle(palette.danger).padding()
            } else if let tickets = alerts?.expiring_tickets {
                if tickets.isEmpty {
                    Text(L10n.tr(lang, zh: "当前无临期或超时工单", en: "No expiring or overdue tickets"))
                        .font(.subheadline)
                        .foregroundStyle(palette.inkMuted)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(Array(tickets.enumerated()), id: \.offset) { _, ticket in
                                TicketGlassCard(ticket: ticket, palette: palette, lang: lang)
                            }
                        }
                        .padding(14)
                    }
                }
            }
        }
        .navigationTitle(L10n.tr(lang, zh: "临期与超时工单", en: "Expiring Tickets"))
        .onAppear {
            store.sdk.fetchAlerts(token: store.token, month: Int32(month)) { res in
                Task { @MainActor in
                    self.alerts = res
                    self.isLoading = false
                }
            } onError: { err in
                Task { @MainActor in
                    self.errorMsg = err
                    self.isLoading = false
                }
            }
        }
    }
}

private struct TicketGlassCard: View {
    let ticket: ExpiringTicket
    let palette: DragonClawPalette
    let lang: String
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(ticket.localizedCollection(language: lang).uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(palette.accentStrong)
                Spacer()
                Text(ticket.isOverdue ? L10n.tr(lang, zh: "已超时", en: "OVERDUE") : L10n.tr(lang, zh: "临期", en: "EXPIRING"))
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(ticket.isOverdue ? palette.danger : palette.warning)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background((ticket.isOverdue ? palette.danger : palette.warning).opacity(0.14), in: Capsule())
            }

            Text(ticket.localizedTitle(language: lang))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(palette.inkPrimary)

            HStack {
                Text("ID: \(ticket.ticket_id)")
                Spacer()
                Text("\(L10n.tr(lang, zh: "到期", en: "Due")): \(ticket.due_date ?? "-")")
            }
            .font(.system(size: 11))
            .foregroundStyle(palette.inkSecondary)

            let slaText = ticket.localizedSlaText(language: lang)
            if !slaText.isEmpty {
                Text(slaText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ticket.isOverdue ? palette.danger : palette.warning)
            }

            if expanded {
                Divider().overlay(palette.hairLine)
                VStack(alignment: .leading, spacing: 4) {
                    if let owner = ticket.owner { Text("\(L10n.tr(lang, zh: "负责人", en: "Owner")): \(owner)") }
                    if let cust = ticket.customer_name { Text("\(L10n.tr(lang, zh: "客户", en: "Customer")): \(cust)") }
                    if let net = ticket.network_name { Text("\(L10n.tr(lang, zh: "网络", en: "Network")): \(net)") }
                    if let prod = ticket.product { Text("\(L10n.tr(lang, zh: "产品", en: "Product")): \(prod)") }
                    if let status = ticket.status { Text("\(L10n.tr(lang, zh: "状态", en: "Status")): \(status)") }
                }
                .font(.caption2)
                .foregroundStyle(palette.inkSecondary)
            }
        }
        .padding(14)
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.snappy(duration: 0.22)) { expanded.toggle() }
        }
        .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct MetricTrendDetailView: View {
    @Bindable var store: DragonClawStore
    let metricLabel: String
    let category: String

    @State private var trend: TrendResponse? = nil
    @State private var isLoading = true
    @State private var errorMsg: String? = nil

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        ZStack {
            DragonClawBackdrop(palette: palette)

            if isLoading {
                ProgressView()
            } else if let errorMsg {
                Text(errorMsg).foregroundStyle(palette.danger).padding()
            } else if let points = trend?.points {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(metricLabel)
                            .font(.system(size: 14.5, weight: .bold))
                            .foregroundStyle(palette.inkPrimary)

                        let numericPoints = points.compactMap { pt -> (String, Double)? in
                            guard let v = pt.numeric_value?.doubleValue else { return nil }
                            return (String(pt.snapshot_created_at.prefix(10)), v)
                        }

                        if numericPoints.count >= 2 {
                            Canvas { ctx, size in
                                let values = numericPoints.map(\.1)
                                let minV = values.min() ?? 0
                                let maxV = values.max() ?? 1
                                let span = max(maxV - minV, 0.0001)
                                var path = Path()
                                for (idx, pair) in numericPoints.enumerated() {
                                    let x = CGFloat(idx) / CGFloat(max(numericPoints.count - 1, 1)) * (size.width - 16) + 8
                                    let y = size.height - 16 - CGFloat((pair.1 - minV) / span) * (size.height - 32)
                                    if idx == 0 {
                                        path.move(to: CGPoint(x: x, y: y))
                                    } else {
                                        path.addLine(to: CGPoint(x: x, y: y))
                                    }
                                    ctx.fill(Path(ellipseIn: CGRect(x: x - 3.5, y: y - 3.5, width: 7, height: 7)), with: .color(palette.accentStrong))
                                }
                                ctx.stroke(path, with: .color(palette.accent), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                            }
                            .frame(height: 180)
                            .padding(14)
                            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        }

                        ForEach(Array(points.reversed().enumerated()), id: \.offset) { _, pt in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(pt.snapshot_created_at)
                                        .font(.system(size: 11.5, weight: .medium))
                                    Text("\(L10n.tr(lang, zh: "目标", en: "Target")): \(pt.display_target_value ?? pt.target_value ?? "-")")
                                        .font(.system(size: 10.5))
                                        .foregroundStyle(palette.inkMuted)
                                }
                                Spacer()
                                Text(pt.raw_value ?? "-")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(pt.is_failing ? palette.danger : palette.accentStrong)
                            }
                            .padding(12)
                            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                    .padding(14)
                }
            }
        }
        .navigationTitle(L10n.tr(lang, zh: "30 天趋势", en: "30-Day Trend"))
        .onAppear {
            store.sdk.fetchTrend(token: store.token, metricLabel: metricLabel, category: category, days: 30, language: lang) { res in
                Task { @MainActor in
                    self.trend = res
                    self.isLoading = false
                }
            } onError: { err in
                Task { @MainActor in
                    self.errorMsg = err
                    self.isLoading = false
                }
            }
        }
    }
}

private struct MetricsSearchDetailView: View {
    @Bindable var store: DragonClawStore
    let month: Int

    @State private var query = ""
    @State private var allMetrics: [Metric] = []
    @State private var isLoading = true

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private var filtered: [Metric] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return allMetrics }
        return allMetrics.filter {
            $0.metric_label.lowercased().contains(q)
                || $0.localizedLabel(language: lang).lowercased().contains(q)
                || $0.category.lowercased().contains(q)
        }
    }

    var body: some View {
        ZStack {
            DragonClawBackdrop(palette: palette)

            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(palette.inkMuted)
                    TextField(L10n.tr(lang, zh: "输入指标名称、分类关键词...", en: "Filter metric name or category..."), text: $query)
                        .textInputAutocapitalization(.never)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.horizontal, 14)

                if isLoading {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(Array(filtered.enumerated()), id: \.offset) { _, metric in
                                MetricGlassCard(metric: metric, store: store)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.bottom, 20)
                    }
                }
            }
            .padding(.top, 8)
        }
        .navigationTitle(L10n.tr(lang, zh: "搜索指标", en: "Search Metrics"))
        .onAppear {
            store.sdk.fetchMetrics(token: store.token, month: Int32(month), category: nil, snapshotId: nil, includeOverall: true, limit: 2000) { res in
                Task { @MainActor in
                    self.allMetrics = res.items
                    self.isLoading = false
                }
            } onError: { _ in
                Task { @MainActor in self.isLoading = false }
            }
        }
    }
}
