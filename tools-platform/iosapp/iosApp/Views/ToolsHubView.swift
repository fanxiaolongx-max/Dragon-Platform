import SwiftUI
import shared

struct ToolsHubView: View {
    @Bindable var store: DragonClawStore
    @State private var selectedCategory: ToolCategoryFilter = .all

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private enum ToolCategoryFilter: String, CaseIterable {
        case all, native, data, analytics, workflow, custom

        func label(_ lang: String) -> String {
            switch self {
            case .all: return L10n.tr(lang, zh: "全部", en: "All")
            case .native: return L10n.tr(lang, zh: "原生", en: "Native")
            case .data: return L10n.tr(lang, zh: "数据", en: "Data")
            case .analytics: return L10n.tr(lang, zh: "报表", en: "Analytics")
            case .workflow: return L10n.tr(lang, zh: "流转", en: "Workflow")
            case .custom: return L10n.tr(lang, zh: "扩展", en: "Custom")
            }
        }

        func matches(_ category: ToolCategory) -> Bool {
            switch self {
            case .all: return true
            case .native: return category == .native
            case .data: return category == .data
            case .analytics: return category == .analytics
            case .workflow: return category == .workflow
            case .custom: return category == .custom
            }
        }
    }

    private var visibleTools: [PlatformTool] {
        store.filteredTools.filter { selectedCategory.matches($0.category) }
    }

    private var pinnedTools: [PlatformTool] {
        store.favoriteToolIds.compactMap { id in
            store.filteredTools.first { $0.id == id }
        }
    }

    private var recentTools: [PlatformTool] {
        let favSet = Set(store.favoriteToolIds)
        return store.recentToolIds
            .filter { !favSet.contains($0) }
            .compactMap { id in store.filteredTools.first { $0.id == id } }
            .prefix(6)
            .map { $0 }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSearchAndFilters

                if selectedCategory == .all && store.toolSearchQuery.trimmingCharacters(in: .whitespaces).isEmpty {
                    featuredKpiMonitorCard

                    if !pinnedTools.isEmpty || !recentTools.isEmpty {
                        pinnedAndRecentSection
                    }
                }

                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                    spacing: 12
                ) {
                    ForEach(visibleTools.filter { selectedCategory != .all || !store.toolSearchQuery.isEmpty || !$0.isNative }, id: \.id) { tool in
                        toolGlassCard(tool)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .padding(.bottom, 24)
        }
        .onAppear {
            store.loadToolNavState()
        }
        .refreshable {
            store.loadToolsCatalog()
            store.loadAlertSummary()
            store.loadToolNavState()
        }
    }

    private var pinnedAndRecentSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.tr(lang, zh: "常用 & 最近", en: "Pinned & Recent"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(palette.inkMuted)
                .padding(.horizontal, 2)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(pinnedTools, id: \.id) { tool in
                        toolQuickNavPill(tool, isFavorite: true)
                    }
                    ForEach(recentTools, id: \.id) { tool in
                        toolQuickNavPill(tool, isFavorite: false)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func toolQuickNavPill(_ tool: PlatformTool, isFavorite: Bool) -> some View {
        Button {
            store.openTool(tool)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isFavorite ? "star.fill" : "clock.arrow.circlepath")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(isFavorite ? palette.warning : palette.inkMuted)
                Text(tool.localizedTitle(language: lang))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(palette.inkPrimary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        }
        .buttonStyle(.plain)
        .glassEffect(
            isFavorite ? .regular.tint(palette.warning.opacity(0.14)).interactive() : .regular.interactive(),
            in: Capsule()
        )
    }

    private var headerSearchAndFilters: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(palette.inkMuted)
                TextField(
                    L10n.tr(lang, zh: "搜索工具、报表或功能...", en: "Search tools & dashboards..."),
                    text: $store.toolSearchQuery
                )
                .font(.system(size: 13))
                .textInputAutocapitalization(.never)

                if !store.toolSearchQuery.isEmpty {
                    Button {
                        store.toolSearchQuery = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(palette.inkMuted)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(ToolCategoryFilter.allCases, id: \.self) { cat in
                            let isSelected = selectedCategory == cat
                            Button {
                                withAnimation(.snappy(duration: 0.22)) {
                                    selectedCategory = cat
                                }
                            } label: {
                                Text(cat.label(lang))
                                    .font(.system(size: 11.5, weight: .semibold))
                                    .foregroundStyle(isSelected ? palette.accentStrong : palette.inkSecondary)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6.5)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(
                                isSelected ? .regular.tint(palette.accent.opacity(0.18)).interactive() : .regular.interactive(),
                                in: .capsule
                            )
                        }
                    }
                }
            }
        }
    }

    private var featuredKpiMonitorCard: some View {
        Button {
            store.openMetricsModule()
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(palette.accent.opacity(0.16))
                        .frame(width: 52, height: 52)
                    Image(systemName: "chart.xyaxis.line")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(palette.accentStrong)
                }

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(L10n.tr(lang, zh: "KPI 与 SLA 指标监控", en: "KPI & SLA Monitor"))
                            .font(.system(size: 14.5, weight: .bold))
                            .foregroundStyle(palette.inkPrimary)
                        Text(L10n.tr(lang, zh: "原生", en: "NATIVE"))
                            .font(.system(size: 9.5, weight: .bold))
                            .foregroundStyle(palette.accentStrong)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(palette.accent.opacity(0.16), in: Capsule())
                    }
                    Text(L10n.tr(lang, zh: "多月份指标快照、异常指标、临期工单与 30 天趋势分析", en: "Snapshots, failing KPIs, expiring tickets & 30-day trends"))
                        .font(.system(size: 11.5))
                        .foregroundStyle(palette.inkSecondary)
                        .lineLimit(2)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(palette.inkMuted)
            }
            .padding(16)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(palette.accent.opacity(0.10)).interactive(), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func toolGlassCard(_ tool: PlatformTool) -> some View {
        Button {
            store.openTool(tool)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(toolAccentColor(tool).opacity(0.15))
                            .frame(width: 40, height: 40)
                        Image(systemName: sfSymbol(for: tool.iconKey))
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(toolAccentColor(tool))
                    }
                    Spacer()
                    Image(systemName: tool.isNative ? "sparkles" : "arrow.up.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(palette.inkMuted)
                        .padding(.trailing, 26)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(tool.localizedTitle(language: lang))
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(palette.inkPrimary)
                        .lineLimit(1)

                    Text(tool.localizedDesc(language: lang))
                        .font(.system(size: 11))
                        .foregroundStyle(palette.inkSecondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 2)

                HStack {
                    Text(tool.isNative ? L10n.tr(lang, zh: "原生视图", en: "Native") : tool.routePath)
                        .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(palette.inkMuted)
                        .lineLimit(1)
                    Spacer()
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 136, alignment: .topLeading)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(alignment: .topTrailing) {
            let isFav = store.favoriteToolIds.contains(tool.id)
            Button {
                store.toggleFavoriteTool(tool.id)
            } label: {
                Image(systemName: isFav ? "star.fill" : "star")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(isFav ? palette.warning : palette.inkMuted)
                    .frame(width: 28, height: 28)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(.top, 9)
            .padding(.trailing, 9)
        }
    }

    private func toolAccentColor(_ tool: PlatformTool) -> Color {
        switch tool.category {
        case .native: return palette.accentStrong
        case .data: return palette.info
        case .analytics: return palette.accent
        case .workflow: return palette.warning
        case .custom: return Color(hex: 0x8B5CF6)
        default: return palette.accentStrong
        }
    }

    private func sfSymbol(for iconKey: String) -> String {
        switch iconKey {
        case "kpi": return "chart.xyaxis.line"
        case "fetch": return "antenna.radiowaves.left.and.right"
        case "import": return "square.and.arrow.down.on.square"
        case "report": return "doc.text.magnifyingglass"
        case "expedite": return "bolt.badge.clock"
        case "monthly": return "calendar.badge.checkmark"
        case "duty": return "moon.stars"
        case "bigscreen": return "tv"
        case "topic": return "scope"
        case "frt": return "timer"
        case "requirements": return "checklist"
        case "praudit": return "checkmark.shield"
        default: return "wrench.and.screwdriver"
        }
    }
}
