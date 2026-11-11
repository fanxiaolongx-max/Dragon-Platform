import SwiftUI
import shared

struct RootShellView: View {
    @Bindable var store: DragonClawStore
    @State private var showServerSheet = false
    @State private var serverDraft = ""
    @State private var sidebarProgress: CGFloat = 0
    @GestureState private var dragDeltaX: CGFloat = 0

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private func setSidebarOpen(_ open: Bool) {
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
                }

                if progress > 0.001 {
                    sidebarDrawer(width: width)
                        .offset(x: (progress - 1) * width)
                        .zIndex(10)
                }
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 18, coordinateSpace: .global)
                    .updating($dragDeltaX) { value, state, _ in
                        let dx = value.translation.width
                        let dy = value.translation.height
                        guard abs(dx) > abs(dy) * 1.35 else {
                            state = 0
                            return
                        }
                        if sidebarProgress < 0.5 && dx > 0 {
                            state = dx
                        } else if sidebarProgress >= 0.5 && dx < 0 {
                            state = dx
                        } else {
                            state = 0
                        }
                    }
                    .onEnded { value in
                        let dx = value.translation.width
                        let dy = value.translation.height
                        guard abs(dx) > abs(dy) * 1.35 else { return }
                        let predictedDx = value.predictedEndTranslation.width
                        let shouldOpen: Bool
                        if sidebarProgress < 0.5 && dx > 0 {
                            shouldOpen = (dx / width) > 0.22 || (predictedDx / width) > 0.45
                        } else if sidebarProgress >= 0.5 && dx < 0 {
                            shouldOpen = !((-dx / width) > 0.22 || (-predictedDx / width) > 0.45)
                        } else {
                            return
                        }
                        setSidebarOpen(shouldOpen)
                    }
            )
        }
        .onAppear {
            sidebarProgress = store.isDrawerOpen ? 1 : 0
        }
        .onChange(of: store.isDrawerOpen) { _, open in
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

            VStack(alignment: .leading, spacing: 12) {
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
                    .onSubmit {
                        store.loadSessions()
                    }

                    if !store.sessionSearchQuery.isEmpty {
                        Button {
                            store.sessionSearchQuery = ""
                            store.loadSessions()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(palette.inkMuted)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
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
                            .padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.tint(palette.accent.opacity(0.14)).interactive(), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                        HStack(spacing: 8) {
                            Button {
                                withAnimation(.snappy) {
                                    store.workMode = .tools
                                }
                                setSidebarOpen(false)
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "square.grid.2x2")
                                    Text(L10n.tr(lang, zh: "工具台", en: "Tools"))
                                }
                                .font(.system(size: 11.5, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 9)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                            Button {
                                store.openMetricsModule()
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "chart.bar.xaxis")
                                    Text("KPI / SLA")
                                }
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(palette.accentStrong)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 9)
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
                    .padding(.vertical, 8)
                    .background(palette.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                Divider().overlay(palette.hairLine)

                // Date-grouped Session History
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if store.sessionGroups.isEmpty {
                            Text(L10n.tr(lang, zh: "暂无历史会话", en: "No conversation history"))
                                .font(.system(size: 11.5))
                                .foregroundStyle(palette.inkMuted)
                                .padding(.vertical, 20)
                                .frame(maxWidth: .infinity)
                        } else {
                            ForEach(store.sessionGroups, id: \.bucket) { group in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(group.localizedTitle(language: lang))
                                        .font(.system(size: 10.5, weight: .semibold))
                                        .foregroundStyle(palette.inkMuted)
                                        .padding(.horizontal, 6)

                                    ForEach(group.items, id: \.id) { session in
                                        let isSelected = session.id == store.currentSessionId
                                        Button {
                                            store.openSession(session)
                                        } label: {
                                            HStack(spacing: 8) {
                                                Image(systemName: "bubble.left")
                                                    .font(.system(size: 12))
                                                    .foregroundStyle(isSelected ? palette.accentStrong : palette.inkMuted)
                                                Text(session.displayTitle(language: lang))
                                                    .font(.system(size: 12.5))
                                                    .foregroundStyle(isSelected ? palette.accentStrong : palette.inkPrimary)
                                                    .lineLimit(1)
                                                Spacer()
                                                if session.busy {
                                                    ProgressView().controlSize(.mini)
                                                }
                                            }
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 8)
                                            .background(
                                                isSelected ? palette.accent.opacity(0.14) : Color.clear,
                                                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            )
                                        }
                                        .buttonStyle(.plain)
                                        .contextMenu {
                                            Button(role: .destructive) {
                                                store.removeSession(session)
                                            } label: {
                                                Label(L10n.tr(lang, zh: "删除会话", en: "Delete"), systemImage: "trash")
                                            }
                                        }
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
}

private struct WebToolIdentifiable: Identifiable {
    let tool: PlatformTool
    var id: String { tool.id }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String {
        isEmpty ? fallback : self
    }
}
