import SwiftUI
import UIKit
import shared

struct RootShellView: View {
    @Bindable var store: DragonClawStore
    @State private var showServerSheet = false
    @State private var showSchedulesSheet = false
    @State private var showAlertCenterSheet = false
    @State private var expandedAlertId: String? = nil
    @State private var scheduleDraft = ""
    @State private var serverDraft = ""
    @State private var sidebarProgress: CGFloat = 0
    @State private var dragDeltaX: CGFloat = 0
    @State private var tabDragDeltaX: CGFloat = 0

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private func setSidebarOpen(_ open: Bool) {
        dragDeltaX = 0
        withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
            sidebarProgress = open ? 1 : 0
            store.isDrawerOpen = open
        }
    }

    private func handleDragChanged(tx: CGFloat) {
        if sidebarProgress >= 0.5 {
            if tx < 0 {
                dragDeltaX = tx
                tabDragDeltaX = 0
            }
        } else {
            if store.workMode == .chat {
                if tx > 0 {
                    dragDeltaX = tx
                    tabDragDeltaX = 0
                } else {
                    dragDeltaX = 0
                    tabDragDeltaX = tx
                }
            } else if store.workMode == .tools {
                if tx > 0 {
                    dragDeltaX = 0
                    tabDragDeltaX = tx
                } else {
                    dragDeltaX = 0
                    tabDragDeltaX = 0
                }
            }
        }
    }

    private func handleDragEnded(tx: CGFloat, vx: CGFloat, width: CGFloat) {
        if sidebarProgress >= 0.5 || (store.workMode == .chat && tx > 0 && dragDeltaX > 0) {
            let currentFraction = min(max(sidebarProgress + tx / width, 0), 1)
            let predictedFraction = min(max(sidebarProgress + (tx + vx * 0.16) / width, 0), 1)
            let shouldOpen: Bool
            if sidebarProgress < 0.5 {
                shouldOpen = currentFraction > 0.20 || predictedFraction > 0.38
            } else {
                shouldOpen = !(currentFraction < 0.80 || predictedFraction < 0.62)
            }
            sidebarProgress = currentFraction
            tabDragDeltaX = 0
            setSidebarOpen(shouldOpen)
        } else {
            if store.workMode == .chat {
                let shouldSwitchToTools = tx < -48 || (tx < -15 && vx < -260)
                if shouldSwitchToTools {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
                        store.workMode = .tools
                        tabDragDeltaX = 0
                    }
                } else {
                    withAnimation(.spring(response: 0.30, dampingFraction: 0.88)) {
                        tabDragDeltaX = 0
                    }
                }
            } else if store.workMode == .tools {
                let shouldSwitchToChat = tx > 48 || (tx > 15 && vx > 260)
                if shouldSwitchToChat {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
                        store.workMode = .chat
                        tabDragDeltaX = 0
                    }
                } else {
                    withAnimation(.spring(response: 0.30, dampingFraction: 0.88)) {
                        tabDragDeltaX = 0
                    }
                }
            }
            dragDeltaX = 0
        }
    }

    var body: some View {
        GeometryReader { geo in
            let width = max(geo.size.width, 1)
            let progress = min(max(sidebarProgress + dragDeltaX / width, 0), 1)

            ZStack(alignment: .leading) {
                DragonClawBackdrop(palette: palette)

                mainPageContent(width: width)
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
            .background(drawerPanBackground(width: width))
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
        .sheet(isPresented: $showAlertCenterSheet) {
            alertCenterSheet
        }
        .sheet(item: Binding(
            get: { store.exportedSessionJson.map { ExportedLogIdentifiable(json: $0) } },
            set: { if $0 == nil { store.exportedSessionJson = nil } }
        )) { payload in
            exportLogSheet(payload.json)
        }
    }

    @ViewBuilder
    private func mainPageContent(width: CGFloat) -> some View {
        VStack(spacing: 0) {
            topFloatingHeader
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 6)
                .frame(width: width)

            HStack(spacing: 0) {
                ChatView(store: store)
                    .frame(width: width)
                ToolsHubView(store: store)
                    .frame(width: width)
            }
            .frame(width: width, alignment: .leading)
            .offset(x: (store.workMode == .chat ? 0 : -width) + tabDragDeltaX)
            .animation(.spring(response: 0.32, dampingFraction: 0.88), value: store.workMode)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(width: width)
        .frame(maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private func drawerPanBackground(width: CGFloat) -> some View {
        DirectionalDrawerPanInstaller(
            isDrawerOpen: sidebarProgress >= 0.5,
            workMode: store.workMode,
            isDisabled: store.activeWebTool != nil || store.showNativeMetrics || showServerSheet || showSchedulesSheet || showAlertCenterSheet || store.exportedSessionJson != nil,
            onDragChanged: { tx in
                handleDragChanged(tx: tx)
            },
            onDragEnded: { tx, vx in
                handleDragEnded(tx: tx, vx: vx, width: width)
            },
            onDragCancelled: {
                withAnimation(.spring(response: 0.30, dampingFraction: 0.88)) {
                    tabDragDeltaX = 0
                }
                setSidebarOpen(sidebarProgress >= 0.5)
            }
        )
        .allowsHitTesting(false)
    }

    private var topFloatingHeader: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                GlassCircleIconButton(
                    systemImage: "sidebar.left",
                    accessibilityLabel: L10n.tr(lang, zh: "打开历史侧边栏", en: "Open sidebar")
                ) {
                    setSidebarOpen(!store.isDrawerOpen)
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
                        HStack(spacing: 6) {
                            Text(store.displayPlatformName)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(palette.inkPrimary)
                                .lineLimit(1)
                            Text("v\(store.appVersion)")
                                .font(.system(size: 9.5, weight: .semibold))
                                .foregroundStyle(palette.inkMuted)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(palette.chipSurface, in: Capsule())
                                .lineLimit(1)
                        }
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
                    Button {
                        expandedAlertId = nil
                        store.loadAlertCenter(filter: "all")
                        showAlertCenterSheet = true
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "bell.badge.fill")
                                .foregroundStyle(palette.danger)
                            Text(L10n.tr(lang, zh: "告警中心有 \(store.alertUnreadCount) 条未读告警", en: "\(store.alertUnreadCount) unread system alerts"))
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(palette.inkPrimary)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(palette.inkMuted)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7.5)
                        .background(palette.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
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

    private var alertCenterSheet: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if let summary = store.alertSummary {
                    HStack(spacing: 8) {
                        alertStatCard(title: L10n.tr(lang, zh: "总计", en: "Total"), value: "\(summary.total)", color: palette.inkPrimary)
                        alertStatCard(
                            title: L10n.tr(lang, zh: "未读", en: "Unread"),
                            value: "\(summary.unread)",
                            color: summary.unread > 0 ? palette.danger : palette.inkPrimary
                        )
                        alertStatCard(
                            title: L10n.tr(lang, zh: "预警+", en: "Warn+"),
                            value: "\(summary.warnOrAbove)",
                            color: summary.warnOrAbove > 0 ? .orange : palette.inkPrimary
                        )
                    }
                    .padding(.horizontal, 16)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach([
                            ("all", L10n.tr(lang, zh: "全部", en: "All")),
                            ("unread", L10n.tr(lang, zh: "未读", en: "Unread")),
                            ("config", L10n.tr(lang, zh: "配置", en: "Config")),
                            ("security", L10n.tr(lang, zh: "安全", en: "Security")),
                            ("user_action", L10n.tr(lang, zh: "操作", en: "Action")),
                            ("system", L10n.tr(lang, zh: "系统", en: "System"))
                        ], id: \.0) { key, label in
                            let active = store.alertFilter == key
                            Button {
                                store.setAlertCenterFilter(key)
                            } label: {
                                Text(label)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(active ? .white : palette.inkPrimary)
                                    .padding(.horizontal, 11)
                                    .padding(.vertical, 6)
                                    .background(active ? palette.accentStrong : palette.chipSurface, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }

                if let err = store.alertError, !err.isEmpty {
                    Text(err)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(palette.danger)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(palette.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal, 16)
                }

                if store.isLoadingAlertEvents && store.alertEvents.isEmpty {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else if store.alertEvents.isEmpty {
                    Spacer()
                    Text(L10n.tr(lang, zh: "当前筛选下暂无告警记录", en: "No alerts in this filter"))
                        .font(.callout)
                        .foregroundStyle(palette.inkMuted)
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 9) {
                            ForEach(store.alertEvents, id: \.id) { ev in
                                alertEventCard(ev)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 16)
                    }
                }
            }
            .padding(.top, 8)
            .navigationTitle(L10n.tr(lang, zh: "告警中心", en: "Alert Center"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if store.alertUnreadCount > 0 {
                        Button(L10n.tr(lang, zh: "全部已读", en: "Read All")) {
                            store.markAllAlertsRead()
                        }
                        .font(.system(size: 13, weight: .semibold))
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.tr(lang, zh: "关闭", en: "Close")) {
                        showAlertCenterSheet = false
                    }
                }
            }
        }
        .presentationDetents([.large, .medium])
    }

    private func alertStatCard(title: String, value: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(color)
            Text(title)
                .font(.system(size: 10.5))
                .foregroundStyle(palette.inkMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .background(palette.chipSurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func alertEventCard(_ ev: AlertCenterEvent) -> some View {
        let isExpanded = expandedAlertId == ev.id
        let sevLower = ev.severity.lowercased()
        let sevColor: Color = (sevLower == "critical" || sevLower == "error")
            ? palette.danger
            : ((sevLower == "warn" || sevLower == "warning") ? .orange : palette.accentStrong)
        let formattedTime = String(ev.created_at.prefix(16)).replacingOccurrences(of: "T", with: " ")

        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if ev.isUnread {
                    Circle()
                        .fill(palette.danger)
                        .frame(width: 7, height: 7)
                }
                Text(ev.severityLabel(language: lang))
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(sevColor)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(sevColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 5))
                Text(ev.typeLabel(language: lang))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(palette.inkMuted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(palette.chipSurface, in: RoundedRectangle(cornerRadius: 5))
                Spacer()
                Text(formattedTime)
                    .font(.system(size: 10))
                    .foregroundStyle(palette.inkMuted)
            }

            Text(ev.title.isEmpty ? String(ev.message.prefix(60)) : ev.title)
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(palette.inkPrimary)

            if !ev.message.isEmpty {
                Text(ev.message)
                    .font(.system(size: 12))
                    .foregroundStyle(palette.inkMuted)
                    .lineLimit(isExpanded ? nil : 2)
            }

            if isExpanded {
                if !ev.actor.isEmpty || !ev.source.isEmpty {
                    let parts = [
                        ev.actor.isEmpty ? nil : "\(L10n.tr(lang, zh: "触发者", en: "Actor")): \(ev.actor)",
                        ev.source.isEmpty ? nil : "\(L10n.tr(lang, zh: "来源", en: "Source")): \(ev.source)"
                    ].compactMap { $0 }.joined(separator: " · ")
                    Text(parts)
                        .font(.system(size: 11))
                        .foregroundStyle(palette.inkMuted)
                }
                let details = ev.detailEntries()
                if !details.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(details, id: \.self) { entry in
                            Text(entry)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(palette.inkPrimary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(palette.chipSurface, in: RoundedRectangle(cornerRadius: 8))
                }
                if !ev.ai_summary.isEmpty {
                    Text("AI: \(ev.ai_summary)")
                        .font(.system(size: 11.5))
                        .foregroundStyle(palette.accentStrong)
                }
                HStack(spacing: 8) {
                    if ev.isUnread {
                        Button {
                            store.markAlertRead(ev.id)
                        } label: {
                            Text(L10n.tr(lang, zh: "标为已读", en: "Mark Read"))
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(palette.accentStrong)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(palette.accentStrong.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }
                    Button {
                        store.archiveAlert(ev.id)
                    } label: {
                        Text(L10n.tr(lang, zh: "归档", en: "Archive"))
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(palette.inkMuted)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(palette.chipSurface, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(palette.cardSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.16)) {
                expandedAlertId = isExpanded ? nil : ev.id
            }
        }
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
    var workMode: AppWorkMode
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

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            var cursor: UIView? = touch.view
            while let view = cursor {
                if view.tag == ChatDeckGestureTags.horizontalDeckViewTag {
                    return false
                }
                if let scroll = view as? UIScrollView, scroll.contentSize.width > (scroll.bounds.width + 4) {
                    return false
                }
                if view is UISlider {
                    return false
                }
                cursor = view.superview
            }
            return true
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
            // Responsive horizontal cone (~37 degrees): abs(vx) > abs(vy) * 1.30
            guard absVx > 28 && absVx > absVy * 1.30 else {
                return false
            }
            if parent.isDrawerOpen {
                return velocity.x < 0
            } else {
                if parent.workMode == .chat {
                    return true
                } else {
                    return velocity.x > 0
                }
            }
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
            // Yield ONLY inside horizontally scrollable containers (e.g. image carousel / horizontal chips).
            let canScrollHorizontally = otherView.contentSize.width > (otherView.bounds.width + 4)
            return canScrollHorizontally
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
