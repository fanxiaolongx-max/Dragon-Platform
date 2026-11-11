import SwiftUI
import UIKit
import shared

struct RootShellView: View {
    @Bindable var store: DragonClawStore
    @State private var showServerSheet = false
    @State private var showSchedulesSheet = false
    @State private var scheduleDraft = ""
    @State private var serverDraft = ""
    @State private var sidebarProgress: CGFloat = 0
    @State private var dragDeltaX: CGFloat = 0

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private func setSidebarOpen(_ open: Bool) {
        dragDeltaX = 0
        withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
            sidebarProgress = open ? 1 : 0
            store.isDrawerOpen = open
        }
    }

    var body: some View {
        GeometryReader { geo in
            let width = max(geo.size.width, 1)
            let progress = min(max(sidebarProgress + dragDeltaX / width, 0), 1)

            ZStack(alignment: .leading) {
                DragonClawBackdrop(palette: palette)

                VStack(spacing: 0) {
                    topFloatingHeader
                        .padding(.horizontal, 14)
                        .padding(.top, 8)
                        .padding(.bottom, 6)

                    Group {
                        switch store.workMode {
                        case .chat:
                            ChatView(store: store)
                        case .tools:
                            ToolsHubView(store: store)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .offset(x: progress * width * 0.24)
                .scaleEffect(1 - 0.025 * progress)

                if progress > 0.005 {
                    Color.black.opacity((palette.isDark ? 0.35 : 0.18) * progress)
                        .ignoresSafeArea()
                        .onTapGesture {
                            setSidebarOpen(false)
                        }
                }

                if progress > 0.001 {
                    sidebarDrawer(width: width)
                        .offset(x: (progress - 1) * width)
                        .zIndex(10)
                }
            }
            .background(
                DirectionalDrawerPanInstaller(
                    isDrawerOpen: sidebarProgress >= 0.5,
                    isDisabled: store.activeWebTool != nil || store.showNativeMetrics || showServerSheet || showSchedulesSheet || store.exportedSessionJson != nil,
                    onDragChanged: { tx in
                        if sidebarProgress < 0.5 && tx > 0 {
                            dragDeltaX = tx
                        } else if sidebarProgress >= 0.5 && tx < 0 {
                            dragDeltaX = tx
                        } else {
                            dragDeltaX = 0
                        }
                    },
                    onDragEnded: { tx, vx in
                        let currentFraction = min(max(sidebarProgress + tx / width, 0), 1)
                        let predictedFraction = min(max(sidebarProgress + (tx + vx * 0.16) / width, 0), 1)
                        let shouldOpen: Bool
                        if sidebarProgress < 0.5 {
                            shouldOpen = currentFraction > 0.24 || predictedFraction > 0.42
                        } else {
                            shouldOpen = !(currentFraction < 0.76 || predictedFraction < 0.58)
                        }
                        sidebarProgress = currentFraction
                        setSidebarOpen(shouldOpen)
                    },
                    onDragCancelled: {
                        setSidebarOpen(sidebarProgress >= 0.5)
                    }
                )
                .allowsHitTesting(false)
            )
        }
        .onAppear {
            sidebarProgress = store.isDrawerOpen ? 1 : 0
        }
        .onChange(of: store.isDrawerOpen) { _, open in
            if open {
                store.loadSessions()
            }
            withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
                sidebarProgress = open ? 1 : 0
            }
        }
        .fullScreenCover(item: Binding(
            get: { store.activeWebTool.map { WebToolIdentifiable(tool: $0) } },
            set: { if $0 == nil { store.activeWebTool = nil } }
        )) { wrapper in
            AuthenticatedToolWebScreen(store: store, tool: wrapper.tool)
        }
        .fullScreenCover(isPresented: $store.showNativeMetrics) {
            MetricsMonitorRootScreen(store: store)
        }
        .sheet(isPresented: $showServerSheet) {
            serverSettingsSheet
        }
        .sheet(isPresented: $showSchedulesSheet) {
            schedulesSheet
        }
        .sheet(item: Binding(
            get: { store.exportedSessionJson.map { ExportedLogIdentifiable(json: $0) } },
            set: { if $0 == nil { store.exportedSessionJson = nil } }
        )) { payload in
            exportLogSheet(payload.json)
        }
    }

    private var topFloatingHeader: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                ZStack(alignment: .topTrailing) {
                    GlassCircleIconButton(
                        systemImage: "sidebar.left",
                        accessibilityLabel: L10n.tr(lang, zh: "打开历史侧边栏", en: "Open sidebar")
                    ) {
                        setSidebarOpen(!store.isDrawerOpen)
                    }

                    if store.alertUnreadCount > 0 {
                        Circle()
                            .fill(palette.danger)
                            .frame(width: 9, height: 9)
                            .offset(x: -2, y: 2)
                    }
                }

                Spacer(minLength: 4)

                GlassModeSegmentedPill(
                    options: [
                        (AppWorkMode.chat, L10n.tr(lang, zh: "对话", en: "Chat"), "bubble.left.and.text.bubble.right.fill"),
                        (AppWorkMode.tools, L10n.tr(lang, zh: "工具", en: "Tools"), "square.grid.2x2.fill")
                    ],
                    selection: $store.workMode,
                    palette: palette
                )

                Spacer(minLength: 4)

                if store.workMode == .chat {
                    GlassCircleIconButton(
                        systemImage: "square.and.pencil",
                        accessibilityLabel: L10n.tr(lang, zh: "新对话", en: "New Chat")
                    ) {
                        store.startNewChat()
                    }
                } else {
                    GlassCircleIconButton(
                        systemImage: "chart.xyaxis.line",
                        tint: palette.accentStrong,
                        accessibilityLabel: L10n.tr(lang, zh: "KPI 监控", en: "KPI Monitor")
                    ) {
                        store.openMetricsModule()
                    }
                }
            }
        }
    }

    private func sidebarDrawer(width: CGFloat) -> some View {
        ZStack {
            DragonClawBackdrop(palette: palette)

            palette.cardSurface.opacity(palette.isDark ? 0.56 : 0.64)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 11) {
                HStack(spacing: 10) {
                    Image("DragonClawAvatar")
                        .resizable()
                        .scaledToFill()
                        .frame(width: 34, height: 34)
                        .clipShape(Circle())

                    VStack(alignment: .leading, spacing: 1) {
                        Text(store.displayPlatformName)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(palette.inkPrimary)
                        Text(store.identity.localizedSubtitle(language: lang))
                            .font(.system(size: 10.5))
                            .foregroundStyle(palette.inkMuted)
                            .lineLimit(1)
                    }

                    Spacer()

                    GlassCircleIconButton(systemImage: "xmark") {
                        setSidebarOpen(false)
                    }
                }
                .padding(.top, 6)

                // Search history
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.caption)
                        .foregroundStyle(palette.inkMuted)
                    TextField(
                        L10n.tr(lang, zh: "搜索历史会话...", en: "Search sessions..."),
                        text: $store.sessionSearchQuery
                    )
                    .font(.system(size: 13))
                    .textInputAutocapitalization(.never)
                    .onChange(of: store.sessionSearchQuery) { _, _ in
                        if !store.showArchivedSessions {
                            store.regroupSessions()
                        }
                    }
                    .onSubmit {
                        if store.showArchivedSessions {
                            store.loadArchivedSessions()
                        } else {
                            store.loadSessions()
                        }
                    }

                    if !store.sessionSearchQuery.isEmpty {
                        Button {
                            store.sessionSearchQuery = ""
                            if store.showArchivedSessions {
                                store.loadArchivedSessions()
                            } else {
                                store.loadSessions()
                            }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(palette.inkMuted)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8.5)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                // Primary Navigation Actions
                GlassEffectContainer(spacing: 8) {
                    VStack(spacing: 8) {
                        Button {
                            store.startNewChat()
                        } label: {
                            HStack {
                                Image(systemName: "plus.message.fill")
                                Text(L10n.tr(lang, zh: "开启新对话", en: "New Chat"))
                                Spacer()
                            }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(palette.inkPrimary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9.5)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.tint(palette.accent.opacity(0.14)).interactive(), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                        HStack(spacing: 7) {
                            Button {
                                withAnimation(.snappy) {
                                    store.workMode = .tools
                                }
                                setSidebarOpen(false)
                            } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: "square.grid.2x2")
                                    Text(L10n.tr(lang, zh: "工具台", en: "Tools"))
                                }
                                .font(.system(size: 11, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8.5)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                            Button {
                                store.openMetricsModule()
                            } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: "chart.bar.xaxis")
                                    Text("KPI")
                                }
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(palette.accentStrong)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8.5)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                            Button {
                                store.loadSchedules()
                                showSchedulesSheet = true
                            } label: {
                                HStack(spacing: 5) {
                                    Image(systemName: "clock.arrow.2.circlepath")
                                    Text(L10n.tr(lang, zh: "定时", en: "Tasks"))
                                    let activeCount = store.schedules.filter { $0.status == "active" }.count
                                    if activeCount > 0 {
                                        Text("\(activeCount)")
                                            .font(.system(size: 9.5, weight: .bold))
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 1)
                                            .background(palette.accentStrong.opacity(0.22), in: Capsule())
                                    }
                                }
                                .font(.system(size: 11, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8.5)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }

                if store.alertUnreadCount > 0 {
                    HStack(spacing: 8) {
                        Image(systemName: "bell.badge.fill")
                            .foregroundStyle(palette.danger)
                        Text(L10n.tr(lang, zh: "告警中心有 \(store.alertUnreadCount) 条未读告警", en: "\(store.alertUnreadCount) unread system alerts"))
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(palette.inkPrimary)
                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7.5)
                    .background(palette.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                // Active vs Archived sessions segmented strip
                HStack(spacing: 6) {
                    sessionScopeTab(
                        selected: !store.showArchivedSessions,
                        title: L10n.tr(lang, zh: "最近会话", en: "Active")
                    ) {
                        store.showArchivedSessions = false
                    }
                    sessionScopeTab(
                        selected: store.showArchivedSessions,
                        title: L10n.tr(lang, zh: "已归档", en: "Archived")
                    ) {
                        store.showArchivedSessions = true
                        store.loadArchivedSessions()
                    }
                    Spacer()
                }

                Divider().overlay(palette.hairLine)

                // Session List (Active grouped or Archived)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if store.showArchivedSessions {
                            if store.archivedSessions.isEmpty {
                                Text(L10n.tr(lang, zh: "暂无已归档会话", en: "No archived conversations"))
                                    .font(.system(size: 11.5))
                                    .foregroundStyle(palette.inkMuted)
                                    .padding(.vertical, 20)
                                    .frame(maxWidth: .infinity)
                            } else {
                                ForEach(store.archivedSessions, id: \.id) { session in
                                    archivedSessionRowView(session)
                                }
                            }
                        } else if store.unifiedSessionGroups.isEmpty {
                            Text(L10n.tr(lang, zh: "暂无历史会话", en: "No conversation history"))
                                .font(.system(size: 11.5))
                                .foregroundStyle(palette.inkMuted)
                                .padding(.vertical, 20)
                                .frame(maxWidth: .infinity)
                        } else {
                            ForEach(store.unifiedSessionGroups, id: \.bucket) { group in
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(group.localizedTitle(language: lang))
                                        .font(.system(size: 10.5, weight: .semibold))
                                        .foregroundStyle(palette.inkMuted)
                                        .padding(.horizontal, 6)

                                    ForEach(group.items, id: \.stableKey) { entry in
                                        unifiedSessionRowView(entry)
                                    }
                                }
                            }
                        }
                    }
                }

                // Bottom User & Utility Footer
                VStack(spacing: 10) {
                    HStack(spacing: 10) {
                        ZStack {
                            Circle()
                                .fill(palette.accent.opacity(0.18))
                                .frame(width: 32, height: 32)
                            Text(String(store.username.prefix(1)).uppercased().ifEmpty("U"))
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(palette.accentStrong)
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(store.username.ifEmpty("User"))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(palette.inkPrimary)
                            Text(store.role.uppercased())
                                .font(.system(size: 9.5))
                                .foregroundStyle(palette.inkMuted)
                        }
                        Spacer()

                        GlassCircleIconButton(systemImage: store.themeMode == "dark" ? "sun.max.fill" : "moon.fill") {
                            store.toggleTheme()
                        }
                        GlassCircleIconButton(systemImage: "globe") {
                            store.toggleLanguage()
                        }
                    }

                    HStack(spacing: 8) {
                        Button {
                            serverDraft = store.baseUrl
                            showServerSheet = true
                        } label: {
                            Label(L10n.tr(lang, zh: "服务器", en: "Server"), systemImage: "server.rack")
                                .font(.system(size: 11.5, weight: .medium))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)

                        Button(role: .destructive) {
                            store.logout()
                        } label: {
                            Label(L10n.tr(lang, zh: "退出登录", en: "Sign Out"), systemImage: "rectangle.portrait.and.arrow.right")
                                .font(.system(size: 11.5, weight: .medium))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                    }
                }
                .padding(12)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
        }
        .frame(width: width)
        .frame(maxHeight: .infinity)
    }

    private func sessionScopeTab(selected: Bool, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(selected ? palette.accentStrong : palette.inkMuted)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    selected ? palette.accent.opacity(0.15) : Color.clear,
                    in: Capsule()
                )
        }
        .buttonStyle(.plain)
    }

    private func unifiedSessionRowView(_ entry: SidebarSessionEntry) -> some View {
        let isSelected = entry.stableKey == store.currentSidebarSelectionKey
        let iconName: String = {
            if let d = entry.desktopSession {
                switch d.provider.lowercased() {
                case "codex": return "terminal"
                case "claudecode": return "sparkles"
                case "antigravity": return "cpu"
                case "workbuddy": return "person.crop.circle.badge.checkmark"
                default: return "desktopcomputer"
                }
            }
            if entry.aiSession?.isGroupSession == true { return "person.2" }
            if entry.aiSession?.isWorkspaceAgent == true { return "hammer" }
            return "bubble.left"
        }()

        return sidebarRowContainer(
            title: entry.displayTitle(language: lang),
            badge: entry.badgeLabel(language: lang),
            providerKey: entry.desktopSession?.provider,
            iconName: iconName,
            isSelected: isSelected,
            isBusy: entry.busy,
            aiSession: entry.aiSession,
            isArchived: false
        ) {
            store.openSidebarEntry(entry)
        }
    }

    private func archivedSessionRowView(_ session: AiSessionSummary) -> some View {
        let badge = session.isGroupSession
            ? L10n.tr(lang, zh: "群聊", en: "Group")
            : (session.isWorkspaceAgent ? "Agent" : nil)
        return sidebarRowContainer(
            title: session.displayTitle(language: lang),
            badge: badge,
            providerKey: nil,
            iconName: "archivebox",
            isSelected: store.currentSidebarSelectionKey == "ai:\(session.id)",
            isBusy: session.busy,
            aiSession: session,
            isArchived: true
        ) {
            store.openSession(session)
        }
    }

    private func badgeTintColor(providerKey: String?, label: String) -> Color {
        switch providerKey?.lowercased() {
        case "codex": return .green
        case "claudecode": return .orange
        case "workbuddy": return .cyan
        default:
            return label == "群聊" || label == "Group" ? .indigo : palette.accentStrong
        }
    }

    private func sidebarRowContainer(
        title: String,
        badge: String?,
        providerKey: String?,
        iconName: String,
        isSelected: Bool,
        isBusy: Bool,
        aiSession: AiSessionSummary?,
        isArchived: Bool,
        onTap: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 8) {
            Button(action: onTap) {
                HStack(spacing: 7) {
                    Image(systemName: iconName)
                        .font(.system(size: 12))
                        .foregroundStyle(isSelected ? palette.accentStrong : palette.inkMuted)
                    Text(title)
                        .font(.system(size: 12.5))
                        .foregroundStyle(isSelected ? palette.accentStrong : palette.inkPrimary)
                        .lineLimit(1)
                    if let badge, !badge.isEmpty {
                        let tint = badgeTintColor(providerKey: providerKey, label: badge)
                        Text(badge)
                            .font(.system(size: 9.5, weight: .semibold))
                            .foregroundStyle(tint)
                            .padding(.horizontal, 5.5)
                            .padding(.vertical, 2)
                            .background(tint.opacity(0.14), in: Capsule())
                    }
                    Spacer(minLength: 4)
                    if isBusy {
                        ProgressView().controlSize(.mini)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if let session = aiSession {
                Menu {
                    sessionActionsMenu(session: session, isArchived: isArchived)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(palette.inkMuted)
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            isSelected ? palette.accent.opacity(0.14) : Color.clear,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .contextMenu {
            if let session = aiSession {
                sessionActionsMenu(session: session, isArchived: isArchived)
            }
        }
    }

    @ViewBuilder
    private func sessionActionsMenu(session: AiSessionSummary, isArchived: Bool) -> some View {
        if isArchived {
            Button {
                store.unarchiveSession(session)
            } label: {
                Label(L10n.tr(lang, zh: "恢复会话", en: "Unarchive"), systemImage: "tray.and.arrow.up")
            }
        } else {
            Button {
                store.archiveSession(session)
            } label: {
                Label(L10n.tr(lang, zh: "归档会话", en: "Archive"), systemImage: "archivebox")
            }
        }
        Button {
            store.exportSession(session)
        } label: {
            Label(L10n.tr(lang, zh: "导出日志 (JSON)", en: "Export Log"), systemImage: "square.and.arrow.up")
        }
        Divider()
        Button(role: .destructive) {
            store.removeSession(session)
        } label: {
            Label(L10n.tr(lang, zh: "删除会话", en: "Delete"), systemImage: "trash")
        }
    }

    private var serverSettingsSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                TextField("https://cs.fanxiaolong.uk", text: $serverDraft)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(14)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                HStack {
                    Button(L10n.tr(lang, zh: "保存", en: "Save")) {
                        store.updateServerBaseUrl(serverDraft)
                        showServerSheet = false
                    }
                    .buttonStyle(.glassProminent)
                    .tint(palette.accentStrong)
                }
                Spacer()
            }
            .padding(20)
            .navigationTitle(L10n.tr(lang, zh: "服务器设置", en: "Server URL"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.fraction(0.35)])
    }

    private var schedulesSheet: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    TextField(
                        L10n.tr(lang, zh: "如：每天 9:00 汇总昨日 SLA 告警", en: "e.g. Daily 9:00 summarize SLA alerts"),
                        text: $scheduleDraft
                    )
                    .font(.system(size: 13))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                    Button {
                        let text = scheduleDraft
                        scheduleDraft = ""
                        store.createSchedule(text: text)
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .bold))
                            .frame(width: 38, height: 38)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(palette.accentStrong)
                    .disabled(scheduleDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                if store.isLoadingSchedules && store.schedules.isEmpty {
                    ProgressView().padding(.top, 30)
                    Spacer()
                } else if store.schedules.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.title2)
                            .foregroundStyle(palette.inkMuted)
                        Text(L10n.tr(lang, zh: "暂无定时任务（也可直接在对话输入 /schedule）", en: "No scheduled tasks yet"))
                            .font(.system(size: 12.5))
                            .foregroundStyle(palette.inkMuted)
                    }
                    .padding(.top, 40)
                    Spacer()
                } else {
                    List {
                        ForEach(store.schedules, id: \.id) { item in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    Text(item.instruction)
                                        .font(.system(size: 13.5, weight: .semibold))
                                        .foregroundStyle(palette.inkPrimary)
                                    Spacer()
                                    Text(item.status)
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(item.status == "active" ? palette.accentStrong : palette.inkMuted)
                                        .padding(.horizontal, 7)
                                        .padding(.vertical, 2)
                                        .background(palette.accent.opacity(0.12), in: Capsule())
                                }
                                if let next = item.nextRunAt, !next.isEmpty {
                                    Text(L10n.tr(lang, zh: "下次执行: \(next)", en: "Next: \(next)"))
                                        .font(.caption2)
                                        .foregroundStyle(palette.inkMuted)
                                }
                                if !item.lastError.isEmpty {
                                    Text(item.lastError)
                                        .font(.caption2)
                                        .foregroundStyle(palette.danger)
                                        .lineLimit(2)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    store.deleteSchedule(item)
                                } label: {
                                    Label(L10n.tr(lang, zh: "取消", en: "Cancel"), systemImage: "trash")
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(L10n.tr(lang, zh: "定时指令 (/schedule)", en: "Scheduled Tasks"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.tr(lang, zh: "关闭", en: "Done")) {
                        showSchedulesSheet = false
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func exportLogSheet(_ jsonText: String) -> some View {
        NavigationStack {
            VStack(spacing: 12) {
                ScrollView {
                    Text(jsonText)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(palette.inkPrimary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .background(palette.cardSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                HStack(spacing: 12) {
                    Button {
                        UIPasteboard.general.string = jsonText
                    } label: {
                        Label(L10n.tr(lang, zh: "复制 JSON", en: "Copy JSON"), systemImage: "doc.on.doc")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)

                    ShareLink(item: jsonText) {
                        Label(L10n.tr(lang, zh: "分享文件", en: "Share"), systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(palette.accentStrong)
                }
            }
            .padding(16)
            .navigationTitle(L10n.tr(lang, zh: "导出对话日志", en: "Exported Chat Log"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.tr(lang, zh: "完成", en: "Done")) {
                        store.exportedSessionJson = nil
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// UIKit UIPanGestureRecognizer bridge attached to the hosting UIViewController.view.
/// Guarantees mutually-exclusive horizontal drawer vs vertical ScrollView axis lock
/// (~27 degree cone + UIGestureRecognizerDelegate failing vertical UIScrollView pans).
private struct DirectionalDrawerPanInstaller: UIViewRepresentable {
    var isDrawerOpen: Bool
    var isDisabled: Bool
    var onDragChanged: (CGFloat) -> Void
    var onDragEnded: (CGFloat, CGFloat) -> Void
    var onDragCancelled: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> BridgeAnchorView {
        let view = BridgeAnchorView()
        view.isHidden = true
        view.isUserInteractionEnabled = false
        view.onWindowChange = { anchor in
            context.coordinator.attachIfNeeded(from: anchor)
        }
        return view
    }

    func updateUIView(_ uiView: BridgeAnchorView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.attachIfNeeded(from: uiView)
    }

    static func dismantleUIView(_ uiView: BridgeAnchorView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class BridgeAnchorView: UIView {
        var onWindowChange: ((UIView) -> Void)?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window != nil {
                onWindowChange?(self)
            }
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: DirectionalDrawerPanInstaller
        private weak var attachedView: UIView?
        private weak var hostController: UIViewController?
        private var panRecognizer: UIPanGestureRecognizer?

        init(parent: DirectionalDrawerPanInstaller) {
            self.parent = parent
        }

        func attachIfNeeded(from anchor: UIView) {
            var responder: UIResponder? = anchor
            var foundVC: UIViewController?
            while let next = responder?.next {
                if let vc = next as? UIViewController {
                    foundVC = vc
                    break
                }
                responder = next
            }
            guard let vc = foundVC, let target = vc.view else { return }
            if attachedView === target && panRecognizer != nil { return }

            detach()
            let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
            pan.name = "DragonClawDirectionalDrawerPan"
            pan.maximumNumberOfTouches = 1
            pan.delaysTouchesBegan = false
            pan.cancelsTouchesInView = true
            pan.delegate = self
            target.addGestureRecognizer(pan)
            attachedView = target
            hostController = vc
            panRecognizer = pan
        }

        func detach() {
            if let pan = panRecognizer, let view = attachedView {
                view.removeGestureRecognizer(pan)
            }
            panRecognizer = nil
            attachedView = nil
            hostController = nil
        }

        @objc private func handlePan(_ pan: UIPanGestureRecognizer) {
            guard let view = attachedView else { return }
            let tx = pan.translation(in: view).x
            let vx = pan.velocity(in: view).x
            switch pan.state {
            case .began, .changed:
                parent.onDragChanged(tx)
            case .ended:
                parent.onDragEnded(tx, vx)
            case .cancelled, .failed:
                parent.onDragCancelled()
            default:
                break
            }
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer,
                  let view = attachedView,
                  !parent.isDisabled else {
                return false
            }
            if hostController?.presentedViewController != nil {
                return false
            }
            let velocity = pan.velocity(in: view)
            let absVx = abs(velocity.x)
            let absVy = abs(velocity.y)
            // Strict horizontal cone (~27 degrees): abs(vx) > abs(vy) * 1.9
            guard absVx > 35 && absVx > absVy * 1.9 else {
                return false
            }
            return parent.isDrawerOpen ? (velocity.x < 0) : (velocity.x > 0)
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            false
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            guard let otherView = otherGestureRecognizer.view as? UIScrollView else {
                return false
            }
            // Yield horizontal gestures inside horizontally scrollable containers (e.g. attachments / filter chips).
            let canScrollHorizontally = otherView.contentSize.width > (otherView.bounds.width + 2)
            return !canScrollHorizontally
        }
    }
}

private struct WebToolIdentifiable: Identifiable {
    let tool: PlatformTool
    var id: String { tool.id }
}

private struct ExportedLogIdentifiable: Identifiable {
    let id = UUID()
    let json: String
}

private extension String {
    func ifEmpty(_ fallback: String) -> String {
        isEmpty ? fallback : self
    }
}
