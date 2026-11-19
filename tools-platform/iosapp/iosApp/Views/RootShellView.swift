import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass
import shared

private enum ActiveDragTarget {
    case none
    case drawer
    case tab
}

private struct PinnedRowFramePreferenceKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

struct RootShellView: View {
    @Bindable var store: DragonClawStore
    @State private var showSettingsSheet = false
    @State private var showServerSheet = false
    @State private var showSchedulesSheet = false
    @State private var showAlertCenterSheet = false
    @State private var expandedAlertId: String? = nil
    @State private var scheduleDraft = ""
    @State private var serverDraft = ""
    @State private var renameTargetSession: AiSessionSummary? = nil
    @State private var renameDraft = ""
    @FocusState private var isSidebarSearchFocused: Bool
    @State private var sidebarProgress: CGFloat = 0
    @State private var dragDeltaX: CGFloat = 0
    @State private var tabDragDeltaX: CGFloat = 0
    @State private var activeDragTarget: ActiveDragTarget = .none
    @State private var draggingPinnedKey: String? = nil
    @State private var draggingPinnedStartIdx: Int = 0
    @State private var draggingPinnedTargetIdx: Int = 0
    @State private var draggingPinnedTranslationY: CGFloat = 0
    @State private var pinnedRowFrames: [String: CGRect] = [:]
    @State private var pinnedSettleOffsets: [String: CGFloat] = [:]
    @State private var lastPinnedDragEndAt: Date = .distantPast

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private func setSidebarOpen(_ open: Bool) {
        dragDeltaX = 0
        activeDragTarget = .none
        withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
            sidebarProgress = open ? 1 : 0
            store.isDrawerOpen = open
        }
    }

    private func handleDragChanged(tx: CGFloat) {
        if activeDragTarget == .none {
            guard abs(tx) > 0.5 else { return }
            if sidebarProgress >= 0.5 || (store.workMode == .chat && tx > 0) {
                activeDragTarget = .drawer
            } else {
                activeDragTarget = .tab
            }
        }
        switch activeDragTarget {
        case .drawer:
            tabDragDeltaX = 0
            dragDeltaX = sidebarProgress >= 0.5 ? min(0, tx) : max(0, tx)
        case .tab:
            dragDeltaX = 0
            if store.workMode == .chat {
                tabDragDeltaX = min(0, tx)
            } else if store.workMode == .tools {
                tabDragDeltaX = max(0, tx)
            } else {
                tabDragDeltaX = 0
            }
        case .none:
            break
        }
    }

    private func handleDragEnded(tx: CGFloat, vx: CGFloat, width: CGFloat) {
        let target = activeDragTarget
        activeDragTarget = .none
        if target == .drawer || (target == .none && (sidebarProgress >= 0.5 || (store.workMode == .chat && tx > 0 && dragDeltaX > 0))) {
            let clampedTx = sidebarProgress >= 0.5 ? min(0, tx) : max(0, tx)
            let currentFraction = min(max(sidebarProgress + clampedTx / width, 0), 1)
            let predictedFraction = min(max(sidebarProgress + (clampedTx + vx * 0.14) / width, 0), 1)
            let shouldOpen: Bool
            if sidebarProgress < 0.5 {
                shouldOpen = currentFraction > 0.22 || (clampedTx > 34 && vx > 320 && predictedFraction > 0.26)
            } else {
                shouldOpen = !(currentFraction < 0.78 || (clampedTx < -34 && vx < -320 && predictedFraction < 0.74))
            }
            sidebarProgress = currentFraction
            tabDragDeltaX = 0
            setSidebarOpen(shouldOpen)
        } else {
            if store.workMode == .chat {
                let clampedTx = min(0, tx)
                let shouldSwitchToTools = clampedTx < -width * 0.20 || (clampedTx < -36 && vx < -320)
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
                let clampedTx = max(0, tx)
                let shouldSwitchToChat = clampedTx > width * 0.20 || (clampedTx > 36 && vx > 320)
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
                store.loadSessionsIfStale()
            } else {
                isSidebarSearchFocused = false
                draggingPinnedKey = nil
                draggingPinnedTranslationY = 0
            }
            withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
                sidebarProgress = open ? 1 : 0
            }
        }
        .fullScreenCover(item: Binding(
            get: { store.activeWebTool.map { WebToolIdentifiable(tool: $0) } },
            set: { if $0 == nil { store.activeWebTool = nil } }
        )) { wrapper in
            themedModal(AuthenticatedToolWebScreen(store: store, tool: wrapper.tool))
        }
        .fullScreenCover(isPresented: $store.showNativeMetrics) {
            themedModal(MetricsMonitorRootScreen(store: store))
        }
        .sheet(isPresented: $showSettingsSheet) {
            themedModal(settingsSheet)
        }
        .sheet(isPresented: $showServerSheet) {
            themedModal(serverSettingsSheet)
        }
        .sheet(isPresented: $showSchedulesSheet) {
            themedModal(schedulesSheet)
        }
        .sheet(isPresented: $showAlertCenterSheet) {
            themedModal(alertCenterSheet)
        }
        // 共享对话：共享面板、邀请横幅、操作提示
        .sheet(isPresented: Binding(
            get: { store.sharing.sheet != nil },
            set: { if !$0 { store.sharing.closeSheet() } }
        )) {
            themedModal(ShareConversationSheet(store: store))
        }
        .overlay(alignment: .top) {
            ShareInviteBanner(store: store)
                .animation(.spring(response: 0.42, dampingFraction: 0.82), value: store.sharing.banner?.shareId)
        }
        .overlay(alignment: .bottom) {
            ShareNoticeToast(store: store)
                .animation(.snappy, value: store.sharing.notice)
        }
        .sheet(item: Binding(
            get: { store.exportedSessionJson.map { ExportedLogIdentifiable(json: $0) } },
            set: { if $0 == nil { store.exportedSessionJson = nil } }
        )) { payload in
            themedModal(exportLogSheet(payload.json))
        }
        .alert(
            L10n.tr(lang, zh: "重命名对话", en: "Rename Conversation"),
            isPresented: Binding(
                get: { renameTargetSession != nil },
                set: { if !$0 { renameTargetSession = nil } }
            )
        ) {
            TextField(
                L10n.tr(lang, zh: "输入新的对话名称", en: "Enter new name"),
                text: $renameDraft
            )
            Button(L10n.tr(lang, zh: "取消", en: "Cancel"), role: .cancel) {
                renameTargetSession = nil
            }
            Button(L10n.tr(lang, zh: "保存", en: "Save")) {
                if let target = renameTargetSession {
                    store.renameSession(target, newTitle: renameDraft)
                }
                renameTargetSession = nil
            }
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
            isDisabled: draggingPinnedKey != nil || store.activeWebTool != nil || store.showNativeMetrics || showSettingsSheet || showServerSheet || showSchedulesSheet || showAlertCenterSheet || store.exportedSessionJson != nil,
            onDragChanged: { tx in
                handleDragChanged(tx: tx)
            },
            onDragEnded: { tx, vx in
                handleDragEnded(tx: tx, vx: vx, width: width)
            },
            onDragCancelled: {
                activeDragTarget = .none
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
                    palette: palette,
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
                        palette: palette,
                        accessibilityLabel: L10n.tr(lang, zh: "新对话", en: "New Chat")
                    ) {
                        store.startNewChat()
                    }
                } else {
                    GlassCircleIconButton(
                        systemImage: "chart.xyaxis.line",
                        tint: palette.accentStrong,
                        palette: palette,
                        accessibilityLabel: L10n.tr(lang, zh: "KPI 监控", en: "KPI Monitor")
                    ) {
                        store.openMetricsModule()
                    }
                }
            }
        }
    }

    private var localizedAccountRole: String {
        DragonClawHelpers.shared.localizedAccountRole(
            role: store.role,
            isSuper: store.isSuper,
            language: lang
        )
    }

    private func triggerSidebarSearchSubmit() {
        isSidebarSearchFocused = false
        if store.showArchivedSessions {
            store.loadArchivedSessions()
        } else {
            store.loadSessions()
        }
    }

    private func sidebarDrawer(width: CGFloat) -> some View {
        ZStack(alignment: .bottom) {
            DragonClawBackdrop(palette: palette)
                .ignoresSafeArea()

            palette.cardSurface.opacity(palette.isDark ? 0.58 : 0.68)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 8) {
                // Compact User Profile Header + Collapse Button
                HStack(spacing: 11) {
                    ZStack {
                        Circle()
                            .fill(palette.accent.opacity(palette.isDark ? 0.24 : 0.16))
                            .frame(width: 38, height: 38)
                        Text(String(store.username.prefix(1)).uppercased().ifEmpty("U"))
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(palette.accentStrong)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.username.ifEmpty("User"))
                            .font(.system(size: 15.5, weight: .semibold))
                            .foregroundStyle(palette.inkPrimary)
                            .lineLimit(1)

                        HStack(spacing: 6) {
                            Text(localizedAccountRole)
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(palette.inkMuted)
                                .lineLimit(1)

                            Text("v\(store.appVersion)")
                                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                .foregroundStyle(palette.inkMuted.opacity(0.9))
                                .padding(.horizontal, 5.5)
                                .padding(.vertical, 1.5)
                                .background(palette.chipSurface, in: Capsule())
                                .lineLimit(1)
                        }
                    }

                    Spacer(minLength: 6)

                    GlassCircleIconButton(
                        systemImage: "chevron.right.2",
                        palette: palette,
                        accessibilityLabel: L10n.tr(lang, zh: "收起侧边栏", en: "Close sidebar")
                    ) {
                        isSidebarSearchFocused = false
                        setSidebarOpen(false)
                    }
                }
                .padding(.top, 4)

                // Compact Active / Archived inline scope tabs
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

                // Session List (Spacious, clean & compact)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 11) {
                        if store.showArchivedSessions {
                            if store.archivedSessions.isEmpty {
                                Text(L10n.tr(lang, zh: "暂无已归档会话", en: "No archived conversations"))
                                    .font(.system(size: 12))
                                    .foregroundStyle(palette.inkMuted)
                                    .padding(.vertical, 28)
                                    .frame(maxWidth: .infinity)
                            } else {
                                ForEach(store.archivedSessions, id: \.id) { session in
                                    archivedSessionRowView(session)
                                }
                            }
                        } else if store.unifiedSessionGroups.isEmpty {
                            Text(L10n.tr(lang, zh: "暂无历史会话", en: "No conversation history"))
                                .font(.system(size: 12))
                                .foregroundStyle(palette.inkMuted)
                                .padding(.vertical, 28)
                                .frame(maxWidth: .infinity)
                        } else {
                            ForEach(store.unifiedSessionGroups, id: \.bucket) { group in
                                // 「共享对话」分类：和置顶一样可折叠，排在最上方
                                let isSharedGroup = group.bucket.name == "SHARED"
                                let isPinnedGroup = group.bucket == .pinned || isSharedGroup
                                let isCollapsed = isSharedGroup
                                    ? SessionGrouping.shared.shouldCollapseSharedGroup(bucket: group.bucket, isSharedCollapsed: store.sharing.isSharedCollapsed, searchQuery: store.sessionSearchQuery)
                                    : SessionGrouping.shared.shouldCollapseGroup(
                                        bucket: group.bucket,
                                        isPinnedCollapsed: store.isPinnedCollapsed,
                                        searchQuery: store.sessionSearchQuery
                                    )
                                VStack(alignment: .leading, spacing: 3) {
                                    if isPinnedGroup {
                                        Button {
                                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                            withAnimation(.snappy(duration: 0.24)) {
                                                if isSharedGroup { store.sharing.toggleCollapsed() } else { store.togglePinnedCollapsed() }
                                            }
                                        } label: {
                                            HStack(spacing: 5) {
                                                Text(group.localizedTitle(language: lang))
                                                    .font(.system(size: 11, weight: .semibold))
                                                    .foregroundStyle(palette.inkMuted)

                                                Text("(\(group.items.count))")
                                                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                                                    .foregroundStyle(palette.inkMuted.opacity(0.78))

                                                Spacer()

                                                Image(systemName: "chevron.down")
                                                    .font(.system(size: 10, weight: .semibold))
                                                    .foregroundStyle(palette.inkMuted)
                                                    .rotationEffect(.degrees(isCollapsed ? -90 : 0))
                                                    .animation(.snappy(duration: 0.22), value: isCollapsed)
                                            }
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .contentShape(Rectangle())
                                        }
                                        .buttonStyle(.plain)
                                        .accessibilityLabel(
                                            isCollapsed
                                                ? L10n.tr(lang, zh: "展开\(group.localizedTitle(language: lang))", en: "Expand \(group.localizedTitle(language: lang))")
                                                : L10n.tr(lang, zh: "收起\(group.localizedTitle(language: lang))", en: "Collapse \(group.localizedTitle(language: lang))")
                                        )
                                    } else {
                                        Text(group.localizedTitle(language: lang))
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(palette.inkMuted)
                                            .padding(.horizontal, 8)
                                            .padding(.bottom, 1)
                                    }

                                    if !isCollapsed {
                                        let canDragPinned = group.bucket == .pinned && group.items.count > 1 && store.sessionSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                        if canDragPinned {
                                            ForEach(Array(group.items.enumerated()), id: \.element.stableKey) { idx, entry in
                                                let key = entry.stableKey
                                                let isDraggingThis = draggingPinnedKey == key
                                                let rowOffsetY = pinnedRowVisualOffsetY(key: key, index: idx, items: group.items)
                                                unifiedSessionRowView(entry, allowContextMenu: false, isPinnedDragElevated: isDraggingThis)
                                                    .background(
                                                        GeometryReader { proxy in
                                                            Color.clear.preference(
                                                                key: PinnedRowFramePreferenceKey.self,
                                                                value: [key: proxy.frame(in: .named("pinnedList"))]
                                                            )
                                                        }
                                                    )
                                                    .scaleEffect(isDraggingThis ? 1.025 : 1.0)
                                                    .shadow(color: Color.black.opacity(isDraggingThis ? (palette.isDark ? 0.36 : 0.16) : 0), radius: isDraggingThis ? 10 : 0, y: isDraggingThis ? 4 : 0)
                                                    .offset(y: rowOffsetY)
                                                    .zIndex(isDraggingThis ? 20 : 0)
                                                    .animation(
                                                        draggingPinnedKey != nil && !isDraggingThis
                                                            ? .spring(response: 0.24, dampingFraction: 0.82)
                                                            : nil,
                                                        value: draggingPinnedTargetIdx
                                                    )
                                                    .animation(.spring(response: 0.20, dampingFraction: 0.85), value: isDraggingThis)
                                                    .simultaneousGesture(pinnedReorderGesture(entry: entry, index: idx, items: group.items))
                                            }
                                        } else {
                                            ForEach(group.items, id: \.stableKey) { entry in
                                                unifiedSessionRowView(entry)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.bottom, 84)
                }
                .coordinateSpace(name: "pinnedList")
                .scrollDisabled(draggingPinnedKey != nil)
                .onPreferenceChange(PinnedRowFramePreferenceKey.self) { frames in
                    if draggingPinnedKey == nil {
                        pinnedRowFrames = frames
                    }
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            // Subtle bottom edge gradient under floating dock
            LinearGradient(
                colors: [
                    Color.clear,
                    (palette.isDark ? Color.black : palette.cardSurface).opacity(0.42)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 88)
            .allowsHitTesting(false)
            .ignoresSafeArea(edges: .bottom)

            // Floating Bottom Dock: Settings + Search Pill + New Chat Compose
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        isSidebarSearchFocused = false
                        serverDraft = store.baseUrl
                        store.loadSchedules()
                        store.loadAlertCenter(filter: "all")
                        store.sharing.refreshAll()
                        showSettingsSheet = true
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "gearshape")
                                .font(.system(size: 16.5, weight: .semibold))
                                .foregroundStyle(palette.inkPrimary)
                                .frame(width: 42, height: 42)
                                .contentShape(Circle())

                            if store.alertUnreadCount + store.sharing.inviteCount > 0 {
                                Circle()
                                    .fill(palette.danger)
                                    .frame(width: 8.5, height: 8.5)
                                    .overlay(Circle().stroke(palette.cardSurface, lineWidth: 1.5))
                                    .offset(x: -5, y: 6)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel(L10n.tr(lang, zh: "设置", en: "Settings"))

                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 13.5, weight: .medium))
                            .foregroundStyle(palette.inkMuted)
                        TextField(
                            L10n.tr(lang, zh: "搜索", en: "Search"),
                            text: $store.sessionSearchQuery
                        )
                        .focused($isSidebarSearchFocused)
                        .font(.system(size: 13.5))
                        .foregroundStyle(palette.inkPrimary)
                        .tint(palette.accentStrong)
                        .textInputAutocapitalization(.never)
                        .submitLabel(.search)
                        .onChange(of: store.sessionSearchQuery) { _, _ in
                            store.regroupSessions()
                        }
                        .onSubmit {
                            triggerSidebarSearchSubmit()
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
                                    .font(.system(size: 13.5))
                                    .foregroundStyle(palette.inkMuted)
                                    .frame(width: 26, height: 26)
                                    .contentShape(Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 42)
                    .frame(maxWidth: .infinity)
                    .glassEffect(.regular, in: Capsule())

                    Button {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        isSidebarSearchFocused = false
                        store.startNewChat()
                        setSidebarOpen(false)
                    } label: {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 16.5, weight: .semibold))
                            .foregroundStyle(palette.isDark ? Color.black : Color.white)
                            .frame(width: 42, height: 42)
                            .background(
                                palette.isDark ? Color.white.opacity(0.95) : palette.inkPrimary,
                                in: Circle()
                            )
                            .shadow(color: Color.black.opacity(palette.isDark ? 0.25 : 0.14), radius: 6, y: 2)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr(lang, zh: "新建对话", en: "New Chat"))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
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

    private func pinnedRowVisualOffsetY(key: String, index: Int, items: [SidebarSessionEntry]) -> CGFloat {
        if let dragged = draggingPinnedKey {
            if dragged == key {
                return draggingPinnedTranslationY
            }
            let currentMid = pinnedRowFrames[key]?.midY
            if draggingPinnedStartIdx < draggingPinnedTargetIdx,
               index > draggingPinnedStartIdx && index <= draggingPinnedTargetIdx {
                let targetMid = pinnedRowFrames[items[index - 1].stableKey]?.midY
                if let currentMid, let targetMid { return targetMid - currentMid }
                return -40
            }
            if draggingPinnedTargetIdx < draggingPinnedStartIdx,
               index >= draggingPinnedTargetIdx && index < draggingPinnedStartIdx {
                let targetMid = pinnedRowFrames[items[index + 1].stableKey]?.midY
                if let currentMid, let targetMid { return targetMid - currentMid }
                return 40
            }
            return 0
        }
        return pinnedSettleOffsets[key] ?? 0
    }

    private func pinnedReorderGesture(entry: SidebarSessionEntry, index: Int, items: [SidebarSessionEntry]) -> some Gesture {
        LongPressGesture(minimumDuration: 0.22, maximumDistance: 12)
            .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named("pinnedList")))
            .onChanged { value in
                switch value {
                case .first:
                    break
                case .second(true, nil):
                    if draggingPinnedKey != entry.stableKey {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        draggingPinnedKey = entry.stableKey
                        draggingPinnedStartIdx = index
                        draggingPinnedTargetIdx = index
                        draggingPinnedTranslationY = 0
                    }
                case .second(true, let drag?):
                    if draggingPinnedKey != entry.stableKey {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        draggingPinnedKey = entry.stableKey
                        draggingPinnedStartIdx = index
                        draggingPinnedTargetIdx = index
                    }
                    let startMid = pinnedRowFrames[entry.stableKey]?.midY
                    let firstMid = pinnedRowFrames[items.first?.stableKey ?? ""]?.midY
                    let lastMid = pinnedRowFrames[items.last?.stableKey ?? ""]?.midY
                    let clampedY: CGFloat
                    if let startMid, let firstMid, let lastMid {
                        clampedY = min(max(drag.translation.height, (firstMid - 14) - startMid), (lastMid + 14) - startMid)
                    } else {
                        clampedY = drag.translation.height
                    }
                    draggingPinnedTranslationY = clampedY
                    let draggedMidY = (startMid ?? CGFloat(index) * 40) + clampedY
                    var bestIdx = draggingPinnedTargetIdx
                    var bestDist = CGFloat.greatestFiniteMagnitude
                    for j in items.indices {
                        let slotMid = pinnedRowFrames[items[j].stableKey]?.midY ?? CGFloat(j) * 40
                        let dist = abs(draggedMidY - slotMid)
                        if dist < bestDist {
                            bestDist = dist
                            bestIdx = j
                        }
                    }
                    if bestIdx != draggingPinnedTargetIdx {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.82)) {
                            draggingPinnedTargetIdx = bestIdx
                        }
                    }
                case .second(false, _):
                    break
                }
            }
            .onEnded { value in
                if case .second(true, _) = value {
                    lastPinnedDragEndAt = Date()
                    finishPinnedDrag(items: items)
                } else if draggingPinnedKey == entry.stableKey {
                    lastPinnedDragEndAt = Date()
                    finishPinnedDrag(items: items)
                }
            }
    }

    private func finishPinnedDrag(items: [SidebarSessionEntry]) {
        guard let key = draggingPinnedKey else { return }
        let start = draggingPinnedStartIdx
        let target = draggingPinnedTargetIdx
        if start != target, items.indices.contains(start), items.indices.contains(target) {
            let startMid = pinnedRowFrames[items[start].stableKey]?.midY
            let targetMid = pinnedRowFrames[items[target].stableKey]?.midY
            let settleDelta: CGFloat
            if let startMid, let targetMid {
                settleDelta = (startMid + draggingPinnedTranslationY) - targetMid
            } else {
                settleDelta = 0
            }
            var reordered = items.map(\.stableKey)
            let moved = reordered.remove(at: start)
            reordered.insert(moved, at: target)

            var noAnim = Transaction()
            noAnim.disablesAnimations = true
            withTransaction(noAnim) {
                pinnedSettleOffsets[key] = settleDelta
                draggingPinnedKey = nil
                draggingPinnedStartIdx = 0
                draggingPinnedTargetIdx = 0
                draggingPinnedTranslationY = 0
                store.reorderPinnedEntries(orderedStableKeys: reordered)
            }
            withAnimation(.spring(response: 0.24, dampingFraction: 0.85)) {
                pinnedSettleOffsets.removeValue(forKey: key)
            }
        } else {
            withAnimation(.spring(response: 0.24, dampingFraction: 0.85)) {
                draggingPinnedKey = nil
                draggingPinnedStartIdx = 0
                draggingPinnedTargetIdx = 0
                draggingPinnedTranslationY = 0
            }
        }
    }

    private func unifiedSessionRowView(_ entry: SidebarSessionEntry, allowContextMenu: Bool = true, isPinnedDragElevated: Bool = false) -> some View {
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
            if entry.isShared { return "person.2.fill" }
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
            sidebarEntry: entry,
            aiSession: entry.aiSession,
            desktopSession: entry.desktopSession,
            isArchived: false,
            isPinned: entry.isPinned && !entry.isShared,
            sharedUnread: !isSelected && (entry.shared?.unread ?? 0) > 0,
            allowContextMenu: allowContextMenu,
            isDragElevated: isPinnedDragElevated
        ) {
            guard draggingPinnedKey == nil, Date().timeIntervalSince(lastPinnedDragEndAt) > 0.15 else { return }
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
            sidebarEntry: nil,
            aiSession: session,
            desktopSession: nil,
            isArchived: true,
            isPinned: false
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

    @ViewBuilder
    private func sidebarRowContainer(
        title: String,
        badge: String?,
        providerKey: String?,
        iconName: String,
        isSelected: Bool,
        isBusy: Bool,
        sidebarEntry: SidebarSessionEntry?,
        aiSession: AiSessionSummary?,
        desktopSession: DesktopAgentSessionSummary? = nil,
        isArchived: Bool,
        isPinned: Bool = false,
        sharedUnread: Bool = false,
        allowContextMenu: Bool = true,
        isDragElevated: Bool = false,
        onTap: @escaping () -> Void
    ) -> some View {
        let rowContent = HStack(spacing: 8) {
            Button(action: onTap) {
                HStack(spacing: 7) {
                    Image(systemName: iconName)
                        .font(.system(size: 12))
                        .foregroundStyle(isSelected ? palette.accentStrong : palette.inkMuted)
                    Text(title)
                        .font(.system(size: 12.5, weight: sharedUnread ? .semibold : .regular))
                        .foregroundStyle(isSelected ? palette.accentStrong : palette.inkPrimary)
                        .lineLimit(1)
                    if sharedUnread {
                        Circle().fill(palette.accentStrong).frame(width: 7, height: 7)
                    }
                    if let badge, !badge.isEmpty {
                        let tint = badgeTintColor(providerKey: providerKey, label: badge)
                        Text(badge)
                            .font(.system(size: 9.5, weight: .semibold))
                            .foregroundStyle(tint)
                            .padding(.horizontal, 5.5)
                            .padding(.vertical, 2)
                            .background(tint.opacity(0.14), in: Capsule())
                    }
                    if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(palette.accentStrong)
                    }
                    Spacer(minLength: 4)
                    if isBusy {
                        ProgressView().controlSize(.mini)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if aiSession != nil || desktopSession != nil {
                Menu {
                    if let session = aiSession {
                        sessionActionsMenu(session: session, sidebarEntry: sidebarEntry, isArchived: isArchived)
                    } else if let desktop = desktopSession {
                        desktopSessionActionsMenu(desktop: desktop, sidebarEntry: sidebarEntry)
                    }
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
            isDragElevated
                ? (palette.isDark ? Color.white.opacity(0.14) : palette.cardSurface.opacity(0.96))
                : (isSelected ? palette.accent.opacity(0.14) : Color.clear),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )

        if allowContextMenu {
            rowContent.contextMenu {
                if let session = aiSession {
                    sessionActionsMenu(session: session, sidebarEntry: sidebarEntry, isArchived: isArchived)
                } else if let desktop = desktopSession {
                    desktopSessionActionsMenu(desktop: desktop, sidebarEntry: sidebarEntry)
                }
            }
        } else {
            rowContent
        }
    }

    @ViewBuilder
    private func desktopSessionActionsMenu(desktop: DesktopAgentSessionSummary, sidebarEntry: SidebarSessionEntry?) -> some View {
        Button {
            store.openDesktopSession(desktop, forceRefresh: true)
        } label: {
            Label(L10n.tr(lang, zh: "刷新对话", en: "Refresh"), systemImage: "arrow.clockwise")
        }
        Button {
            store.togglePinDesktopSession(desktop)
        } label: {
            Label(
                desktop.isPinned ? L10n.tr(lang, zh: "取消置顶", en: "Unpin") : L10n.tr(lang, zh: "置顶会话", en: "Pin"),
                systemImage: desktop.isPinned ? "pin.slash" : "pin"
            )
        }
    }

    @ViewBuilder
    private func sessionActionsMenu(session: AiSessionSummary, sidebarEntry: SidebarSessionEntry?, isArchived: Bool) -> some View {
        // 共享：只有 Dragon Claw 自己的对话（第三方 Agent 对话不共享）
        if !isArchived && store.sharing.available {
            Button {
                store.sharing.openSheet(sessionId: session.id, title: session.displayTitle(language: lang))
            } label: {
                Label(
                    store.sharing.isShared(session.id) ? L10n.tr(lang, zh: "共享成员与邀请", en: "Sharing & members") : L10n.tr(lang, zh: "共享…", en: "Share…"),
                    systemImage: "person.badge.plus"
                )
            }
        }
        Button {
            store.openSession(session, forceRefresh: true)
        } label: {
            Label(L10n.tr(lang, zh: "刷新对话", en: "Refresh"), systemImage: "arrow.clockwise")
        }
        Button {
            renameDraft = session.displayTitle(language: lang)
            renameTargetSession = session
        } label: {
            Label(L10n.tr(lang, zh: "重命名", en: "Rename"), systemImage: "pencil")
        }
        if isArchived {
            Button {
                store.unarchiveSession(session)
            } label: {
                Label(L10n.tr(lang, zh: "恢复会话", en: "Unarchive"), systemImage: "tray.and.arrow.up")
            }
        } else {
            Button {
                store.togglePinSession(session)
            } label: {
                Label(
                    session.isPinned ? L10n.tr(lang, zh: "取消置顶", en: "Unpin") : L10n.tr(lang, zh: "置顶会话", en: "Pin"),
                    systemImage: session.isPinned ? "pin.slash" : "pin"
                )
            }
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

    private var settingsSheet: some View {
        NavigationStack {
            List {
                // Account Profile Summary
                Section {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(palette.accent.opacity(palette.isDark ? 0.24 : 0.16))
                                .frame(width: 44, height: 44)
                            Text(String(store.username.prefix(1)).uppercased().ifEmpty("U"))
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(palette.accentStrong)
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text(store.username.ifEmpty("User"))
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(palette.inkPrimary)
                            HStack(spacing: 6) {
                                Text(localizedAccountRole)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(palette.inkMuted)
                                Text("v\(store.appVersion)")
                                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(palette.inkMuted)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1.5)
                                    .background(palette.chipSurface, in: Capsule())
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(palette.cardSurface)

                // Workspace & Notifications (Alerts & Schedules relocated from sidebar)
                Section(L10n.tr(lang, zh: "通知与任务", en: "Alerts & Automation")) {
                    NavigationLink {
                        alertCenterBody
                            .onAppear {
                                expandedAlertId = nil
                                store.loadAlertCenter(filter: "all")
                                store.sharing.refreshAll()
                            }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "bell.badge")
                                .foregroundStyle(store.alertUnreadCount > 0 ? palette.danger : palette.accentStrong)
                                .frame(width: 22)
                            Text(L10n.tr(lang, zh: "告警中心", en: "Alert Center"))
                                .foregroundStyle(palette.inkPrimary)
                            Spacer()
                            if store.alertUnreadCount + store.sharing.inviteCount > 0 {
                                Text("\(store.alertUnreadCount + store.sharing.inviteCount)")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(palette.danger, in: Capsule())
                            }
                        }
                    }

                    NavigationLink {
                        schedulesBody
                            .onAppear {
                                store.loadSchedules()
                            }
                    } label: {
                        let activeCount = store.schedules.filter { $0.status == "active" }.count
                        HStack(spacing: 10) {
                            Image(systemName: "clock.arrow.2.circlepath")
                                .foregroundStyle(palette.accentStrong)
                                .frame(width: 22)
                            Text(L10n.tr(lang, zh: "定时任务", en: "Scheduled Tasks"))
                                .foregroundStyle(palette.inkPrimary)
                            Spacer()
                            if activeCount > 0 {
                                Text("\(activeCount)")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(palette.accentStrong)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(palette.accent.opacity(0.16), in: Capsule())
                            }
                        }
                    }
                }
                .listRowBackground(palette.cardSurface)
                .listRowSeparatorTint(palette.hairLine)

                // Appearance, Language & Server
                Section(L10n.tr(lang, zh: "偏好与连接", en: "Preferences & Server")) {
                    HStack(spacing: 10) {
                        Image(systemName: store.themeMode == "dark" ? "moon.fill" : "sun.max.fill")
                            .foregroundStyle(palette.accentStrong)
                            .frame(width: 22)
                        Text(L10n.tr(lang, zh: "外观主题", en: "Appearance"))
                            .foregroundStyle(palette.inkPrimary)
                        Spacer()
                        Picker("", selection: Binding(
                            get: { store.themeMode },
                            set: { next in
                                if next != store.themeMode {
                                    withAnimation(.easeInOut(duration: 0.22)) {
                                        store.toggleTheme()
                                    }
                                }
                            }
                        )) {
                            Text(L10n.tr(lang, zh: "浅色", en: "Light")).tag("light")
                            Text(L10n.tr(lang, zh: "深色", en: "Dark")).tag("dark")
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 132)
                    }

                    HStack(spacing: 10) {
                        Image(systemName: "globe")
                            .foregroundStyle(palette.accentStrong)
                            .frame(width: 22)
                        Text(L10n.tr(lang, zh: "界面语言", en: "Language"))
                            .foregroundStyle(palette.inkPrimary)
                        Spacer()
                        Picker("", selection: Binding(
                            get: { store.language },
                            set: { next in
                                if next != store.language {
                                    store.toggleLanguage()
                                }
                            }
                        )) {
                            Text("中文").tag("zh")
                            Text("EN").tag("en")
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 132)
                    }

                    NavigationLink {
                        ServerSettingsDestination(store: store, serverDraft: $serverDraft)
                            .onAppear { serverDraft = store.baseUrl }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "server.rack")
                                .foregroundStyle(palette.accentStrong)
                                .frame(width: 22)
                            Text(L10n.tr(lang, zh: "服务器", en: "Server"))
                                .foregroundStyle(palette.inkPrimary)
                            Spacer(minLength: 8)
                            Text(store.baseUrl)
                                .font(.caption)
                                .foregroundStyle(palette.inkMuted)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                }
                .listRowBackground(palette.cardSurface)
                .listRowSeparatorTint(palette.hairLine)

                // Account Sign Out
                Section {
                    Button(role: .destructive) {
                        showSettingsSheet = false
                        setSidebarOpen(false)
                        store.logout()
                    } label: {
                        HStack {
                            Spacer()
                            Label(L10n.tr(lang, zh: "退出登录", en: "Sign Out"), systemImage: "rectangle.portrait.and.arrow.right")
                                .font(.system(size: 14.5, weight: .semibold))
                            Spacer()
                        }
                    }
                } footer: {
                    Text("\(store.displayPlatformName) Mobile v\(store.appVersion)")
                        .foregroundStyle(palette.inkMuted)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 4)
                }
                .listRowBackground(palette.cardSurface)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(palette.elevatedSurface.ignoresSafeArea())
            .navigationTitle(L10n.tr(lang, zh: "设置", en: "Settings"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.tr(lang, zh: "完成", en: "Done")) {
                        showSettingsSheet = false
                    }
                }
            }
        }
        .presentationDetents([.large, .medium])
        .presentationBackground(palette.elevatedSurface)
    }

    @ViewBuilder
    private func themedModal<Content: View>(_ content: Content) -> some View {
        content
            .preferredColorScheme(store.colorScheme)
            .environment(\.colorScheme, store.colorScheme)
            .tint(palette.accentStrong)
    }

    private var serverSettingsSheet: some View {
        NavigationStack {
            ServerSettingsDestination(store: store, serverDraft: $serverDraft)
        }
        .presentationDetents([.fraction(0.35)])
    }

    private var alertCenterSheet: some View {
        NavigationStack {
            alertCenterBody
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(L10n.tr(lang, zh: "关闭", en: "Close")) {
                            showAlertCenterSheet = false
                        }
                    }
                }
        }
        .presentationDetents([.large, .medium])
    }

    private var alertCenterBody: some View {
        VStack(spacing: 12) {
            // 共享对话邀请（接受 / 拒绝 / 忽略）与粘贴共享链接加入
            ShareInvitesSection(store: store)

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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.elevatedSurface.ignoresSafeArea())
        .navigationTitle(L10n.tr(lang, zh: "告警中心", en: "Alert Center"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if store.alertUnreadCount > 0 {
                    Button(L10n.tr(lang, zh: "全部已读", en: "Read All")) {
                        store.markAllAlertsRead()
                    }
                    .font(.system(size: 13, weight: .semibold))
                }
            }
        }
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
            schedulesBody
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

    private var schedulesBody: some View {
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
                        .listRowBackground(palette.cardSurface)
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
                .scrollContentBackground(.hidden)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.elevatedSurface.ignoresSafeArea())
        .navigationTitle(L10n.tr(lang, zh: "定时指令 (/schedule)", en: "Scheduled Tasks"))
        .navigationBarTitleDisplayMode(.inline)
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
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(palette.elevatedSurface.ignoresSafeArea())
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

/// Directional UIPanGestureRecognizer subclass that avoids one-shot early rejection on curved
/// horizontal thumb strokes while failing cleanly vertical drags early so UIScrollView feels instant.
private final class DirectionalDrawerPanGestureRecognizer: UIPanGestureRecognizer {
    private(set) var initialWindowPoint: CGPoint = .zero
    var edgeWidth: CGFloat = 40
    var centerVerticalFailRatio: CGFloat = 1.18
    var edgeVerticalFailRatio: CGFloat = 1.55

    override func reset() {
        super.reset()
        initialWindowPoint = .zero
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        if numberOfTouches == 0, let touch = touches.first {
            initialWindowPoint = touch.location(in: nil)
        }
        super.touchesBegan(touches, with: event)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        if state == .possible, let touch = touches.first {
            let current = touch.location(in: nil)
            let absDx = abs(current.x - initialWindowPoint.x)
            let absDy = abs(current.y - initialWindowPoint.y)
            if max(absDx, absDy) >= 6 {
                let windowWidth = view?.window?.bounds.width ?? view?.bounds.width ?? 390
                let isEdge = initialWindowPoint.x <= edgeWidth || initialWindowPoint.x >= (windowWidth - edgeWidth)
                let verticalFailRatio = isEdge ? edgeVerticalFailRatio : centerVerticalFailRatio
                // Fail vertical scrolls right away so UIScrollView begins without hesitation.
                if absDy >= 6 && absDy > absDx * verticalFailRatio {
                    state = .failed
                    return
                }
            }
        }
        super.touchesMoved(touches, with: event)
    }

    func windowDelta() -> CGPoint? {
        guard numberOfTouches > 0 else { return nil }
        let current = location(in: nil)
        return CGPoint(x: current.x - initialWindowPoint.x, y: current.y - initialWindowPoint.y)
    }
}

/// UIKit UIPanGestureRecognizer bridge attached to the hosting UIViewController.view.
/// Guarantees mutually-exclusive horizontal drawer vs vertical ScrollView axis lock
/// with natural thumb-arc tolerance (~50° center, ~57° edges).
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
        private weak var lastTouchedView: UIView?
        private var panRecognizer: DirectionalDrawerPanGestureRecognizer?

        init(parent: DirectionalDrawerPanInstaller) {
            self.parent = parent
        }

        private func isHorizontalScrollView(_ scroll: UIScrollView) -> Bool {
            let canScrollHorizontally = scroll.contentSize.width > (scroll.bounds.width + 2)
            let canScrollVertically = scroll.contentSize.height > (scroll.bounds.height + 2)
            return canScrollHorizontally && !canScrollVertically
        }

        private func hasActivelyDraggingScrollView(from startView: UIView?) -> Bool {
            var cursor: UIView? = startView
            while let view = cursor {
                if let scroll = view as? UIScrollView {
                    let panState = scroll.panGestureRecognizer.state
                    if panState == .began || panState == .changed {
                        return true
                    }
                }
                cursor = view.superview
            }
            return false
        }

        private func isCompetingMotionGesture(_ recognizer: UIGestureRecognizer) -> Bool {
            if recognizer is UIPanGestureRecognizer ||
               recognizer is UISwipeGestureRecognizer ||
               recognizer is UIPinchGestureRecognizer {
                return true
            }
            if recognizer.view is UIScrollView {
                return true
            }
            let typeName = String(describing: type(of: recognizer))
            return typeName.contains("Drag") || typeName.contains("Pan") || typeName.contains("Scroll")
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
            let pan = DirectionalDrawerPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
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
            lastTouchedView = touch.view
            if !parent.isDrawerOpen,
               let window = touch.window,
               ChatDeckGestureTags.isPointInExcludedRegion(touch.location(in: window), in: window) {
                return false
            }
            var cursor: UIView? = touch.view
            while let view = cursor {
                if view.tag == ChatDeckGestureTags.horizontalDeckViewTag {
                    return false
                }
                if let scroll = view as? UIScrollView, isHorizontalScrollView(scroll) {
                    return false
                }
                if view is UISlider || view is UITextField {
                    return false
                }
                if let textView = view as? UITextView, textView.isEditable {
                    return false
                }
                cursor = view.superview
            }
            return true
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? DirectionalDrawerPanGestureRecognizer,
                  let view = attachedView,
                  !parent.isDisabled else {
                return false
            }
            if hostController?.presentedViewController != nil {
                return false
            }
            if hasActivelyDraggingScrollView(from: lastTouchedView) {
                return false
            }
            let viewDelta = pan.translation(in: view)
            let winDelta = pan.windowDelta()
            let translation: CGPoint
            if let winDelta, max(abs(winDelta.x), abs(winDelta.y)) >= max(abs(viewDelta.x), abs(viewDelta.y)) {
                translation = winDelta
            } else {
                translation = viewDelta
            }
            let absTx = abs(translation.x)
            let absTy = abs(translation.y)
            guard max(absTx, absTy) > 0.5 else { return false }

            let boundsWidth = view.window?.bounds.width ?? view.bounds.width
            let startX = pan.initialWindowPoint.x > 0
                ? pan.initialWindowPoint.x
                : (pan.location(in: view).x - viewDelta.x)
            let isNearEdge = startX <= 40 || (!parent.isDrawerOpen && parent.workMode == .chat && startX >= boundsWidth - 40)
            let slopeRatio: CGFloat = isNearEdge ? 0.65 : 0.85
            guard absTx >= 4 && absTx >= absTy * slopeRatio else {
                return false
            }
            if parent.isDrawerOpen {
                return translation.x < 0
            } else if parent.workMode == .chat {
                return true
            } else {
                return translation.x > 0
            }
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            // Allow passive press/interactive-glass touch highlights during touch-down (cancelled once pan begins),
            // while remaining strictly mutually exclusive against any pan, drag, swipe, or ScrollView motion.
            !isCompetingMotionGesture(otherGestureRecognizer)
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            guard let otherScroll = otherGestureRecognizer.view as? UIScrollView else {
                return false
            }
            if isHorizontalScrollView(otherScroll) {
                return false
            }
            return otherGestureRecognizer === otherScroll.panGestureRecognizer || otherGestureRecognizer is UIPanGestureRecognizer
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            if otherGestureRecognizer.view?.tag == ChatDeckGestureTags.horizontalDeckViewTag {
                return true
            }
            if let otherScroll = otherGestureRecognizer.view as? UIScrollView,
               otherScroll.panGestureRecognizer === otherGestureRecognizer {
                return isHorizontalScrollView(otherScroll)
            }
            return false
        }
    }
}

private struct ServerSettingsDestination: View {
    @Bindable var store: DragonClawStore
    @Binding var serverDraft: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let palette = store.palette
        let lang = store.language
        VStack(alignment: .leading, spacing: 16) {
            Text(L10n.tr(lang, zh: "API 服务地址", en: "API Endpoint"))
                .font(.caption.weight(.semibold))
                .foregroundStyle(palette.inkMuted)

            TextField("https://cs.fanxiaolong.uk", text: $serverDraft)
                .foregroundStyle(palette.inkPrimary)
                .tint(palette.accentStrong)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .padding(14)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            Button {
                store.updateServerBaseUrl(serverDraft)
                dismiss()
            } label: {
                Text(L10n.tr(lang, zh: "保存", en: "Save"))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.glassProminent)
            .tint(palette.accentStrong)

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.elevatedSurface.ignoresSafeArea())
        .navigationTitle(L10n.tr(lang, zh: "服务器设置", en: "Server URL"))
        .navigationBarTitleDisplayMode(.inline)
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
