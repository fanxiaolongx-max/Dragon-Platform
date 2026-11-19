import Foundation
import Observation
import SwiftUI
import UIKit
import shared

enum AppWorkMode: String, CaseIterable, Hashable {
    case chat
    case tools
}

enum MetricsRoute: Hashable {
    case dashboard
    case snapshotDetail(snapshotId: String, month: Int)
    case metricsList(title: String, filterType: String, month: Int, snapshotId: String?, category: String?)
    case alerts(month: Int)
    case trend(metricLabel: String, category: String)
    case search(month: Int)
}

private func dispatchToMain(_ work: @escaping @MainActor () -> Void) {
    if Thread.isMainThread {
        MainActor.assumeIsolated(work)
    } else {
        DispatchQueue.main.async {
            MainActor.assumeIsolated(work)
        }
    }
}

@Observable
@MainActor
final class DragonClawStore {
    let sdk = DragonClawSdk(settings: SettingsManager(), api: DragonClawApiClient(settings: SettingsManager()))
    /// 共享对话：分类、邀请、共享面板与同步（SharingStore.swift）
    let sharing = SharingStore()

    @ObservationIgnored private var needsWorkspaceRefresh = false
    @ObservationIgnored private var reauthInFlight = false
    @ObservationIgnored private var lastReauthAt: Date? = nil
    @ObservationIgnored private var appIsActive = true
    @ObservationIgnored private var backgroundGraceTask: UIBackgroundTaskIdentifier = .invalid

    // Preferences & Session
    var baseUrl: String
    var language: String
    var themeMode: String
    var rememberMe: Bool
    var autoLogin: Bool
    var isPinnedCollapsed: Bool

    var token: String = ""
    var username: String = ""
    var role: String = "user"
    var tenantId: String = "default"
    var isSuper: Bool = false
    var isAuthenticated = false
    var isAuthenticating = false
    var loginError: String?

    // Platform Identity & Navigation
    var identity: PlatformIdentity = PlatformIdentity(
        platformName: "Dragon Claw",
        platformNameZh: "Dragon Claw",
        platformNameEn: "Dragon Claw",
        platformSubtitle: "埃及 CS 工具与知识中心",
        platformSubtitleEn: "Egypt CS Tools & Knowledge Center",
        platformSlogan: "“认真做好每一个工具，让日常工作更省心。”",
        platformSloganEn: "“Build every tool with care. Make everyday work easier.”",
        mediaEnabled: false
    )
    var appVersion: String
    var workMode: AppWorkMode = .chat
    var isDrawerOpen = false
    var alertUnreadCount: Int = 0
    var alertSummary: AlertCenterSummary? = nil
    var alertEvents: [AlertCenterEvent] = []
    var alertFilter: String = "all"
    var isLoadingAlertEvents = false
    var alertError: String? = nil

    // Chat State
    var models: [AiModelInfo] = []
    var selectedModelId: String
    var suggestions: [AiSuggestion] = []
    var sessions: [AiSessionSummary] = []
    var desktopAgentSessions: [DesktopAgentSessionSummary] = []
    var conversationPreferences: [ConversationListPreferenceItem] = []
    var sessionGroups: [SessionGroup] = []
    var unifiedSessionGroups: [UnifiedSessionGroup] = []
    private var rawAiSessions: [AiSessionSummary] = []
    private var rawCachedAiSessions: [AiSessionSummary] = []
    private var rawDesktopAgentSessions: [DesktopAgentSessionSummary] = []
    private var rawArchivedSessions: [AiSessionSummary] = []
    var sessionSearchQuery: String = ""
    var currentSessionId: String? = nil
    var activeDesktopSession: DesktopAgentSessionSummary? = nil
    var activeDesktopCanSend = false
    var activeDesktopCanSteer = false
    var activeDesktopBusy = false
    var activeDesktopReason: String? = nil
    var activeDesktopSelectedModel: String = ""
    var desktopModelsByProvider: [String: [DesktopAgentModelItem]] = [:]
    var desktopModelsLoading = false
    var desktopModelsError: String? = nil
    var desktopQueue: [DesktopAgentQueuedItem] = []
    var desktopBusyMode: String = "queue"
    var regularQueue: [QueuedChatPrompt] = []
    var hasMoreOlderMessages = false
    var isLoadingOlderMessages = false
    var chatOpenScrollGeneration: Int = 0
    var messages: [ChatMessage] = []
    var composerText: String = ""
    var isStreaming = false
    var isEnhancingPrompt = false
    var isUploadingFiles = false
    var isLoadingSessionMessages = false
    var pendingAttachments: [UploadedFileInfo] = []
    var chatErrorBanner: String? = nil

    var chatStatusBanner: String? = nil
    var expandedThinkingIds: Set<String> = []
    var expandedUserMessageIds: Set<String> = []

    // Voice & Skills State
    var skills: [AgentSkillItem] = []
    var selectedVoicePersona: String

    // Archived Sessions & Schedules State
    var showArchivedSessions = false
    var archivedSessions: [AiSessionSummary] = []
    var schedules: [DragonClawScheduleItem] = []
    var isLoadingSchedules = false
    var isCompactingContext = false
    var exportedSessionJson: String? = nil

    // Tools Hub State
    var tools: [PlatformTool] = []
    var favoriteToolIds: [String] = []
    var recentToolIds: [String] = []
    var toolSearchQuery: String = ""
    var toolsCategoryFilterRaw: String = "all"
    var toolsScrollOffsetY: CGFloat = 0
    var activeWebTool: PlatformTool? = nil
    var showNativeMetrics = false
    var metricsPath: [MetricsRoute] = []

    // KPI / SLA Metrics Cache
    var currentMonth: Int
    var summaryByMonth: [Int: SummaryResponse] = [:]
    var snapshotsByMonth: [Int: [Snapshot]] = [:]
    var metricsLoadingByMonth: Set<Int> = []
    var metricsErrorByMonth: [Int: String] = [:]

    private var activeStreamHandle: TaskHandle? = nil
    private var activeSessionLoadHandle: TaskHandle? = nil
    private var activeOlderLoadHandle: TaskHandle? = nil
    private var desktopPollTask: Task<Void, Never>? = nil
    private var activeTaskHandles: [TaskHandle] = []
    private var voiceTurnCompletion: ((String) -> Void)? = nil
    private var voiceTurnClauseHandler: ((String) -> Void)? = nil
    private var voiceSpeechSegmenter: StreamingSpeechSegmenter? = nil
    private var regularBeforeCursor: String? = nil
    private var desktopBeforeCursor: String? = nil
    private var desktopLoadedRawItems: [DesktopAgentMessageItem] = []
    private var lastSessionsSyncedAtMs: Int64 = 0
    private let historyPageSize: Int32 = 25
    private let uiCatalogProviders: Set<String> = ["claudecode", "antigravity"]

    var currentSidebarSelectionKey: String? {
        if let desktop = activeDesktopSession {
            return desktop.stableKey
        }
        if let id = currentSessionId {
            return "ai:\(id)"
        }
        return nil
    }

    var colorScheme: ColorScheme {
        themeMode == "dark" ? .dark : .light
    }

    var palette: DragonClawPalette {
        DragonClawPalette(isDark: themeMode == "dark")
    }

    var activeModelDisplayName: String {
        if let desktop = activeDesktopSession {
            let chosen = activeDesktopSelectedModel.trimmingCharacters(in: .whitespacesAndNewlines)
            if !chosen.isEmpty {
                if let matched = desktopModelsByProvider[desktop.provider]?.first(where: { $0.id == chosen }) {
                    return matched.name
                }
                return chosen
            }
            return L10n.tr(language, zh: "默认模型", en: "Default")
        }
        if !selectedModelId.isEmpty,
           let matched = models.first(where: { $0.id == selectedModelId }) {
            return matched.name
        }
        return models.first?.name ?? L10n.tr(language, zh: "默认模型", en: "Default")
    }

    var displayPlatformName: String {
        identity.localizedName(language: language)
    }

    var filteredTools: [PlatformTool] {
        let catalog = tools.isEmpty ? ToolCatalogMerger.shared.merge(remoteTools: []) : tools
        let q = toolSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return catalog }
        return catalog.filter {
            $0.titleZh.lowercased().contains(q)
                || $0.titleEn.lowercased().contains(q)
                || $0.descZh.lowercased().contains(q)
                || $0.descEn.lowercased().contains(q)
                || $0.routePath.lowercased().contains(q)
        }
    }

    init() {
        self.baseUrl = sdk.getBaseUrl()
        self.language = sdk.getLanguage()
        self.themeMode = sdk.getThemeMode()
        self.rememberMe = sdk.getRememberMe()
        self.autoLogin = sdk.getAutoLogin()
        self.isPinnedCollapsed = sdk.isPinnedSessionsCollapsed()
        self.selectedModelId = sdk.getSelectedModelId()
        self.selectedVoicePersona = sdk.getVoicePersonaId()
        self.appVersion = sdk.getAppVersion()
        self.currentMonth = Int(sdk.getCurrentMonth())
        self.tools = ToolCatalogMerger.shared.merge(remoteTools: [])
        self.username = sdk.getSavedUsername()

        sdk.setUnauthorizedHandler { [weak self] in
            Task { @MainActor [weak self] in
                self?.handleUnauthorized()
            }
        }
        loadPlatformIdentity()
        restoreSessionIfPossible()
        syncWindowInterfaceStyle()
    }

    // MARK: - Preferences

    func syncWindowInterfaceStyle() {
        let style: UIUserInterfaceStyle = themeMode == "dark" ? .dark : .light
        DispatchQueue.main.async {
            for scene in UIApplication.shared.connectedScenes {
                guard let windowScene = scene as? UIWindowScene else { continue }
                for window in windowScene.windows {
                    window.overrideUserInterfaceStyle = style
                }
            }
        }
    }

    func toggleTheme() {
        withAnimation(.easeInOut(duration: 0.22)) {
            themeMode = themeMode == "dark" ? "light" : "dark"
        }
        sdk.saveThemeMode(mode: themeMode)
        syncWindowInterfaceStyle()
    }

    func togglePinnedCollapsed() {
        isPinnedCollapsed.toggle()
        sdk.setPinnedSessionsCollapsed(collapsed: isPinnedCollapsed)
    }

    func toggleLanguage() {
        language = language == "zh" ? "en" : "zh"
        sdk.saveLanguage(language: language)
        regroupSessions()
    }

    func updateServerBaseUrl(_ newUrl: String) {
        sdk.saveBaseUrl(url: newUrl)
        self.baseUrl = sdk.getBaseUrl()
        loadPlatformIdentity()
    }

    func selectModel(_ modelId: String) {
        selectedModelId = modelId
        sdk.saveSelectedModelId(modelId: modelId)
    }

    func updateVoicePersona(_ voiceId: String) {
        let normalized = VoicePersonaCatalog.shared.normalizeVoiceId(raw: voiceId)
        selectedVoicePersona = normalized
        sdk.saveVoicePersonaId(voiceId: normalized)
    }

    func loadDesktopModels(provider: String, forceLive: Bool = false) {
        let cleanProvider = provider.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !cleanProvider.isEmpty, !token.isEmpty else { return }
        let cachedOnly = uiCatalogProviders.contains(cleanProvider) && !forceLive
        desktopModelsLoading = true
        desktopModelsError = nil
        let handle = sdk.fetchDesktopAgentModels(
            token: token,
            provider: cleanProvider,
            cached: cachedOnly,
            force: forceLive
        ) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self else { return }
                self.desktopModelsLoading = false
                self.desktopModelsByProvider[cleanProvider] = res.models
            }
        } onError: { [weak self] err in
            dispatchToMain { [weak self] in
                guard let self else { return }
                self.desktopModelsLoading = false
                if !cachedOnly || (self.desktopModelsByProvider[cleanProvider]?.isEmpty ?? true) {
                    self.desktopModelsError = err
                }
            }
        }
        activeTaskHandles.append(handle)
    }

    func prepareActiveModelPicker() {
        guard let desktop = activeDesktopSession else { return }
        let existing = desktopModelsByProvider[desktop.provider] ?? []
        if existing.isEmpty && !desktopModelsLoading {
            loadDesktopModels(provider: desktop.provider, forceLive: true)
        }
    }

    func selectActiveModel(_ modelId: String) {
        guard let desktop = activeDesktopSession else {
            selectModel(modelId)
            return
        }
        let cleanModel = modelId.trimmingCharacters(in: .whitespacesAndNewlines)
        let targetKey = desktop.stableKey
        let prev = activeDesktopSelectedModel
        activeDesktopSelectedModel = cleanModel
        desktopModelsError = nil
        let handle = sdk.setDesktopAgentModel(
            token: token,
            provider: desktop.provider,
            sessionId: desktop.id,
            model: cleanModel
        ) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                self.activeDesktopSelectedModel = res.selectedModel ?? ""
            }
        } onError: { [weak self] err in
            dispatchToMain { [weak self] in
                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                self.activeDesktopSelectedModel = prev
                self.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    // MARK: - Auth

    func loadPlatformIdentity() {
        let handle = sdk.fetchPlatformIdentity { [weak self] id in
            Task { @MainActor [weak self] in
                self?.identity = id
            }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    private func restoreSessionIfPossible() {
        let savedToken = sdk.getSavedToken()
        let savedUser = sdk.getSavedUsername()
        guard !savedToken.isEmpty, autoLogin else { return }

        isAuthenticating = true
        let handle = sdk.restoreSession(token: savedToken) { [weak self] outcome, profile in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isAuthenticating = false
                if outcome == SessionRestoreOutcome.expired {
                    if self.sdk.canReauthenticate() {
                        self.performLogin(
                            username: savedUser,
                            password: self.sdk.getSavedPassword(),
                            remember: self.rememberMe,
                            autoLogin: true
                        )
                    } else {
                        self.sdk.clearSessionAuth(keepUsername: self.rememberMe)
                        self.loginError = L10n.tr(self.language, zh: "登录已过期，请重新登录", en: "Session expired. Please sign in again.")
                    }
                    return
                }
                // Valid, or the server is unreachable: trust the saved session.
                // A later 401 goes through handleUnauthorized().
                let profileName = profile?.username ?? ""
                self.token = savedToken
                self.username = profileName.isEmpty ? savedUser : profileName
                self.role = profile?.role ?? self.sdk.getSavedRole()
                let tenant = profile?.tenantId ?? ""
                let homeTenant = profile?.homeTenantId ?? ""
                self.tenantId = !tenant.isEmpty ? tenant : (!homeTenant.isEmpty ? homeTenant : "default")
                self.isSuper = profile?.isSuper ?? false
                self.isAuthenticated = true
                self.needsWorkspaceRefresh = outcome == SessionRestoreOutcome.offline
                self.bootstrapWorkspace()
            }
        }
        activeTaskHandles.append(handle)
    }

    // MARK: - Session expiry & app lifecycle

    /// Called (via the API client) whenever an authenticated request comes back 401.
    private func handleUnauthorized() {
        guard isAuthenticated, !reauthInFlight else { return }
        // A 401 right after a fresh login is a permission problem, not an expired token: don't loop.
        if let last = lastReauthAt, Date().timeIntervalSince(last) < 60 { return }
        guard sdk.canReauthenticate() else {
            expireSession()
            return
        }
        reauthInFlight = true
        let savedPass = sdk.getSavedPassword()
        let handle = sdk.login(username: sdk.getSavedUsername(), password: savedPass) { [weak self] response in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.reauthInFlight = false
                if response.success, let newToken = response.token, !newToken.isEmpty {
                    self.lastReauthAt = Date()
                    self.sdk.saveSessionAuth(
                        token: newToken,
                        username: response.username ?? self.username,
                        password: savedPass,
                        role: response.role ?? self.role,
                        rememberMe: self.rememberMe,
                        autoLogin: self.autoLogin
                    )
                    let savedToken = self.sdk.getSavedToken()
                    self.token = savedToken.isEmpty ? newToken : savedToken
                    self.bootstrapWorkspace()
                } else {
                    self.expireSession()
                }
            }
        } onError: { [weak self] _ in
            // Network failure: keep the session and retry on the next 401.
            Task { @MainActor [weak self] in
                self?.reauthInFlight = false
            }
        }
        activeTaskHandles.append(handle)
    }

    private func expireSession() {
        logout()
        loginError = L10n.tr(language, zh: "登录已过期，请重新登录", en: "Session expired. Please sign in again.")
    }

    func appDidBecomeActive() {
        guard !appIsActive else { return }
        appIsActive = true
        endBackgroundGrace()
        guard isAuthenticated else { return }
        loadAlertSummary()
        if needsWorkspaceRefresh || sessions.isEmpty {
            needsWorkspaceRefresh = false
            bootstrapWorkspace()
        } else if !isStreaming {
            loadSessions()
        }
    }

    func appDidEnterBackground() {
        appIsActive = false
        // Ask iOS for a short grace period so an in-flight reply can finish instead of being cut off.
        guard isStreaming, backgroundGraceTask == .invalid else { return }
        backgroundGraceTask = UIApplication.shared.beginBackgroundTask(withName: "DragonClawStream") { [weak self] in
            Task { @MainActor [weak self] in
                self?.endBackgroundGrace()
            }
        }
    }

    private func endBackgroundGrace() {
        guard backgroundGraceTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundGraceTask)
        backgroundGraceTask = .invalid
    }

    func performLogin(username: String, password: String, remember: Bool, autoLogin: Bool) {
        let cleanUser = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanUser.isEmpty, !password.isEmpty else {
            loginError = L10n.tr(language, zh: "请输入账号和密码", en: "Please enter username and password")
            return
        }
        isAuthenticating = true
        loginError = nil

        let handle = sdk.login(username: cleanUser, password: password) { [weak self] response in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isAuthenticating = false
                if response.success, let newToken = response.token, !newToken.isEmpty {
                    let finalUser = response.username ?? cleanUser
                    let finalRole = response.role ?? "user"
                    self.rememberMe = remember
                    self.autoLogin = autoLogin
                    self.sdk.saveSessionAuth(
                        token: newToken,
                        username: finalUser,
                        password: password,
                        role: finalRole,
                        rememberMe: remember,
                        autoLogin: autoLogin
                    )
                    let savedToken = self.sdk.getSavedToken()
                    self.token = savedToken.isEmpty ? newToken : savedToken
                    self.username = finalUser
                    self.role = finalRole
                    self.tenantId = (response.tenantId?.isEmpty == false ? response.tenantId : nil) ?? "default"
                    self.isSuper = response.isSuper?.boolValue ?? false
                    self.isAuthenticated = true
                    self.bootstrapWorkspace()
                } else {
                    self.loginError = response.error ?? response.message ?? L10n.tr(self.language, zh: "登录失败", en: "Login failed")
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isAuthenticating = false
                self.loginError = self.humanReadableNetworkError(err)
            }
        }
        activeTaskHandles.append(handle)
    }

    func humanReadableNetworkError(_ raw: String) -> String {
        if raw.contains("Code=-1003") || raw.contains("hostname could not be found") {
            return L10n.tr(language, zh: "无法连接服务器：域名解析失败，请检查网络或更换网络环境后重试", en: "Cannot resolve server hostname. Please check your network connection.")
        }
        if raw.contains("Code=-1009") || raw.contains("offline") || raw.contains("not connected to the internet") {
            return L10n.tr(language, zh: "当前无网络连接，请检查蜂窝网络或 Wi-Fi 设置", en: "No internet connection. Please verify cellular or Wi-Fi settings.")
        }
        if raw.contains("Code=-1001") || raw.contains("timed out") {
            return L10n.tr(language, zh: "连接服务器超时，请检查网络稳定性或稍后重试", en: "Connection timed out. Please try again later.")
        }
        if raw.contains("Code=-1004") || raw.contains("Could not connect to the server") {
            return L10n.tr(language, zh: "无法连接到服务器，请确认后端服务已正常启动", en: "Could not connect to server. Please verify backend service is running.")
        }
        if raw.contains("Code=-1200") || raw.contains("SSL") {
            return L10n.tr(language, zh: "SSL 安全证书验证异常，请确认服务器域名配置", en: "SSL certificate error. Please verify server domain.")
        }
        if raw.hasPrefix("Exception") || raw.contains("NSURLErrorDomain") {
            return L10n.tr(language, zh: "网络连接失败，请检查手机网络设置或稍后重试", en: "Network connection failed. Please check your network and retry.")
        }
        return raw
    }

    func logout() {
        sharing.stop()
        stopStreaming()
        activeSessionLoadHandle?.cancel()
        activeSessionLoadHandle = nil
        activeOlderLoadHandle?.cancel()
        activeOlderLoadHandle = nil
        desktopPollTask?.cancel()
        desktopPollTask = nil
        activeTaskHandles.forEach { $0.cancel() }
        activeTaskHandles.removeAll()
        sdk.clearConversationCache()
        sdk.clearSessionAuth(keepUsername: rememberMe)
        lastSessionsSyncedAtMs = 0
        token = ""
        tenantId = "default"
        isSuper = false
        isAuthenticated = false
        isDrawerOpen = false
        activeWebTool = nil
        showNativeMetrics = false
        metricsPath.removeAll()
        messages.removeAll()
        rawAiSessions.removeAll()
        rawCachedAiSessions.removeAll()
        rawDesktopAgentSessions.removeAll()
        rawArchivedSessions.removeAll()
        conversationPreferences.removeAll()
        sessions.removeAll()
        desktopAgentSessions.removeAll()
        archivedSessions.removeAll()
        sessionGroups.removeAll()
        unifiedSessionGroups.removeAll()
        activeDesktopSession = nil
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = false
        activeDesktopReason = nil
        activeDesktopSelectedModel = ""
        desktopModelsByProvider.removeAll()
        desktopModelsLoading = false
        desktopModelsError = nil
        desktopQueue.removeAll()
        regularQueue.removeAll()
        regularBeforeCursor = nil
        desktopBeforeCursor = nil
        desktopLoadedRawItems.removeAll()
        hasMoreOlderMessages = false
        isLoadingOlderMessages = false
        pendingAttachments.removeAll()
        skills.removeAll()
        schedules.removeAll()
        favoriteToolIds.removeAll()
        recentToolIds.removeAll()
        toolSearchQuery = ""
        toolsCategoryFilterRaw = "all"
        toolsScrollOffsetY = 0
        expandedThinkingIds.removeAll()
        expandedUserMessageIds.removeAll()
        showArchivedSessions = false
        exportedSessionJson = nil
        chatStatusBanner = nil
        currentSessionId = nil
        workMode = .chat
    }

    // MARK: - Workspace Bootstrap

    func bootstrapWorkspace() {
        guard !token.isEmpty else { return }
        sdk.syncConversationCacheScope(username: username)
        lastSessionsSyncedAtMs = 0
        loadModels()
        loadSuggestions()
        loadSessions()
        loadToolsCatalog()
        loadAlertSummary()
        sharing.start(store: self)
        loadSkills()
        loadSchedules()
        loadToolNavState()
    }

    func loadModels() {
        let handle = sdk.fetchModels(token: token) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.models = res.models
                if self.selectedModelId.isEmpty, let def = res.defaultId, !def.isEmpty {
                    self.selectedModelId = def
                }
            }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    func loadSuggestions() {
        let handle = sdk.fetchSuggestions(token: token, limit: 8) { [weak self] res in
            Task { @MainActor [weak self] in
                self?.suggestions = res.items
            }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    func loadSessionsIfStale(minIntervalMs: Int64 = 18_000) {
        guard !token.isEmpty else { return }
        if sdk.shouldRefreshSessions(lastSyncedMs: lastSessionsSyncedAtMs, minIntervalMs: minIntervalMs) {
            loadSessions()
        }
    }

    func loadSessions() {
        let query = sessionSearchQuery
        let aiHandle = sdk.fetchSessions(token: token, query: query, limit: 80) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self else { return }
                self.lastSessionsSyncedAtMs = self.sdk.currentTimestampMs()
                self.rawAiSessions = res.items
                if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self.rawCachedAiSessions = res.items
                    self.sdk.conversationCache.reconcileAiSummaries(items: res.items)
                }
                self.regroupSessions()
            }
        } onError: { _ in }
        activeTaskHandles.append(aiHandle)

        // Fetch Web sidebar presentation preferences (renamed titles, pinned flags, pin_order, archived/hidden)
        let prefHandle = sdk.fetchConversationPreferences(token: token) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self else { return }
                self.conversationPreferences = res.items
                self.regroupSessions()
            }
        } onError: { _ in }
        activeTaskHandles.append(prefHandle)

        // Silently ignore 403/503 for non-admin accounts or offline desktop connectors.
        let desktopHandle = sdk.fetchDesktopAgentSessions(token: token, query: query) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self else { return }
                self.lastSessionsSyncedAtMs = self.sdk.currentTimestampMs()
                self.rawDesktopAgentSessions = res.items
                self.regroupSessions()
            }
        } onError: { _ in }
        activeTaskHandles.append(desktopHandle)
    }

    func regroupSessions() {
        let trimmedQuery = sessionSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        let baseAi: [AiSessionSummary]
        if trimmedQuery.isEmpty || rawCachedAiSessions.isEmpty {
            baseAi = rawAiSessions
        } else {
            var seen = Set(rawAiSessions.map(\.id))
            var merged = rawAiSessions
            for cached in rawCachedAiSessions where !seen.contains(cached.id) {
                seen.insert(cached.id)
                merged.append(cached)
            }
            baseAi = merged
        }

        sessions = sdk.applyConversationPreferencesToAi(
            sessions: baseAi,
            preferences: conversationPreferences
        )
        desktopAgentSessions = sdk.applyConversationPreferencesToDesktop(
            sessions: rawDesktopAgentSessions,
            preferences: conversationPreferences
        )
        if let activeDesktop = activeDesktopSession,
           let refreshed = desktopAgentSessions.first(where: { $0.id == activeDesktop.id && $0.provider == activeDesktop.provider }) {
            activeDesktopSession = refreshed
        }
        archivedSessions = sdk.mergeArchivedAiSessions(
            archivedApiItems: rawArchivedSessions,
            activeAiItems: baseAi,
            preferences: conversationPreferences,
            searchQuery: sessionSearchQuery
        )
        sessionGroups = sdk.groupSessionsByDate(sessions: sessions)
        unifiedSessionGroups = sdk.groupSidebarSessions(
            aiSessions: sessions,
            desktopSessions: desktopAgentSessions,
            searchQuery: sessionSearchQuery,
            preferences: conversationPreferences,
            shared: sharing.mine
        )
    }

    func loadToolsCatalog() {
        let handle = sdk.fetchToolCatalog(token: token) { [weak self] merged in
            Task { @MainActor [weak self] in
                self?.tools = merged
            }
        } onError: { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.tools = ToolCatalogMerger.shared.merge(remoteTools: [])
            }
        }
        activeTaskHandles.append(handle)
    }

    func loadAlertSummary() {
        let handle = sdk.fetchAlertSummary(token: token) { [weak self] summary in
            Task { @MainActor [weak self] in
                self?.alertSummary = summary
                self?.alertUnreadCount = Int(summary.unread)
            }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    func loadAlertCenter(filter: String? = nil) {
        guard !token.isEmpty else { return }
        let targetFilter = filter ?? alertFilter
        alertFilter = targetFilter
        isLoadingAlertEvents = true
        alertError = nil
        loadAlertSummary()
        let handle = sdk.fetchAlertEvents(token: token, filter: targetFilter) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.alertEvents = res.events
                self.isLoadingAlertEvents = false
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.alertError = err
                self.isLoadingAlertEvents = false
            }
        }
        activeTaskHandles.append(handle)
    }

    func setAlertCenterFilter(_ filter: String) {
        loadAlertCenter(filter: filter)
    }

    func markAlertRead(_ eventId: String) {
        guard !token.isEmpty, !eventId.isEmpty else { return }
        let wasUnread = alertEvents.first(where: { $0.id == eventId })?.isUnread == true
        alertEvents = alertEvents.map { ev in
            ev.id == eventId ? ev.withStatus(status: "read") : ev
        }
        if alertFilter == "unread" {
            alertEvents.removeAll { !$0.isUnread }
        }
        if wasUnread {
            alertUnreadCount = max(0, alertUnreadCount - 1)
        }
        let handle = sdk.markAlertEventsRead(token: token, ids: [eventId]) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.loadAlertCenter()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.alertError = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func markAllAlertsRead() {
        guard !token.isEmpty else { return }
        if alertFilter == "unread" {
            alertEvents = []
        } else {
            alertEvents = alertEvents.map { $0.withStatus(status: "read") }
        }
        alertUnreadCount = 0
        let handle = sdk.markAllAlertEventsRead(token: token) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.loadAlertCenter()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.alertError = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func archiveAlert(_ eventId: String) {
        guard !token.isEmpty, !eventId.isEmpty else { return }
        let wasUnread = alertEvents.first(where: { $0.id == eventId })?.isUnread == true
        alertEvents.removeAll { $0.id == eventId }
        if wasUnread {
            alertUnreadCount = max(0, alertUnreadCount - 1)
        }
        let handle = sdk.archiveAlertEvent(token: token, eventId: eventId) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.loadAlertCenter()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.alertError = err
            }
        }
        activeTaskHandles.append(handle)
    }

    // MARK: - Chat Flow

    func startNewChat() {
        resetActiveChatState(closeDrawer: true)
    }

    private func resetActiveChatState(closeDrawer: Bool) {
        stopStreaming()
        activeSessionLoadHandle?.cancel()
        activeSessionLoadHandle = nil
        activeOlderLoadHandle?.cancel()
        activeOlderLoadHandle = nil
        desktopPollTask?.cancel()
        desktopPollTask = nil
        currentSessionId = nil
        activeDesktopSession = nil
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = false
        activeDesktopReason = nil
        activeDesktopSelectedModel = ""
        desktopModelsError = nil
        desktopQueue.removeAll()
        regularQueue.removeAll()
        regularBeforeCursor = nil
        desktopBeforeCursor = nil
        desktopLoadedRawItems.removeAll()
        hasMoreOlderMessages = false
        isLoadingOlderMessages = false
        isLoadingSessionMessages = false
        messages.removeAll()
        pendingAttachments.removeAll()
        chatErrorBanner = nil
        if closeDrawer {
            showNativeMetrics = false
            activeWebTool = nil
            workMode = .chat
            isDrawerOpen = false
        }
    }

    func openSidebarEntry(_ entry: SidebarSessionEntry) {
        if let ai = entry.aiSession {
            openSession(ai)
        } else if let desktop = entry.desktopSession {
            openDesktopSession(desktop)
        }
    }

    func openSession(_ session: AiSessionSummary, forceRefresh: Bool = false) {
        stopStreaming()
        activeSessionLoadHandle?.cancel()
        activeSessionLoadHandle = nil
        activeOlderLoadHandle?.cancel()
        activeOlderLoadHandle = nil
        desktopPollTask?.cancel()
        desktopPollTask = nil

        currentSessionId = session.id
        activeDesktopSession = nil
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = false
        activeDesktopReason = nil
        activeDesktopSelectedModel = ""
        desktopModelsError = nil
        desktopQueue.removeAll()
        regularQueue.removeAll()
        regularBeforeCursor = nil
        desktopBeforeCursor = nil
        desktopLoadedRawItems.removeAll()
        hasMoreOlderMessages = false
        isLoadingOlderMessages = false

        pendingAttachments.removeAll()
        showNativeMetrics = false
        activeWebTool = nil
        workMode = .chat
        isDrawerOpen = false
        chatErrorBanner = nil

        sdk.syncConversationCacheScope(username: username)
        let cacheEval = sdk.conversationCache.evaluateAiSession(
            summary: session,
            lastSessionsSyncMs: lastSessionsSyncedAtMs,
            forceRefresh: forceRefresh
        )
        let hasCachedMessages = (cacheEval.cached?.messages.isEmpty == false)
        if let cached = cacheEval.cached, hasCachedMessages {
            regularBeforeCursor = cached.beforeCursor
            hasMoreOlderMessages = cached.hasMore && !(cached.beforeCursor?.isEmpty ?? true)
            messages = cached.messages
            isLoadingSessionMessages = false
            chatOpenScrollGeneration += 1
            // 共享对话总要同步一次：别人可能刚发了新消息
            if cacheEval.decision == .useCacheSkipNetwork && !sharing.isShared(session.id) {
                return
            }
        } else {
            // Clear immediately only on cache miss so opening an uncached session shows shimmer skeleton.
            messages.removeAll()
            isLoadingSessionMessages = true
        }

        let targetId = session.id
        if sharing.isShared(targetId) {
            sharing.syncBeforeOpen(targetId) { [weak self] in
                guard let self, self.currentSessionId == targetId else { return }
                self.fetchOpenedSessionMessages(session, hasCachedMessages: hasCachedMessages, forceRefresh: forceRefresh)
            }
            return
        }
        fetchOpenedSessionMessages(session, hasCachedMessages: hasCachedMessages, forceRefresh: forceRefresh)
    }

    private func fetchOpenedSessionMessages(_ session: AiSessionSummary, hasCachedMessages: Bool, forceRefresh: Bool) {
        let targetId = session.id
        let handle = sdk.fetchSessionMessages(token: token, sessionId: targetId, limit: historyPageSize, before: nil) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self, self.currentSessionId == targetId, self.activeDesktopSession == nil else { return }
                self.isLoadingSessionMessages = false
                let firstRawId = res.items.first?.id
                let mapped = self.sdk.mapHistoryMessages(items: res.items)
                let changed = !hasCachedMessages ||
                    mapped.count != self.messages.count ||
                    mapped.last?.id != self.messages.last?.id ||
                    mapped.last?.content != self.messages.last?.content
                self.regularBeforeCursor = firstRawId
                self.hasMoreOlderMessages = res.hasMore && !(firstRawId?.isEmpty ?? true)
                self.messages = mapped
                if changed {
                    self.chatOpenScrollGeneration += 1
                }
                let latestSummary = self.sessions.first(where: { $0.id == targetId }) ?? session
                self.sdk.conversationCache.saveAiSession(
                    sessionId: targetId,
                    messages: mapped,
                    sessionUpdatedAt: latestSummary.updatedAt,
                    sessionMessageCount: latestSummary.messageCount > 0 ? latestSummary.messageCount : res.total,
                    beforeCursor: firstRawId,
                    hasMore: res.hasMore,
                    isLocalWrite: false
                )
            }
        } onError: { [weak self] err in
            dispatchToMain { [weak self] in
                guard let self, self.currentSessionId == targetId, self.activeDesktopSession == nil else { return }
                self.isLoadingSessionMessages = false
                if !hasCachedMessages || forceRefresh {
                    self.chatErrorBanner = err
                }
            }
        }
        activeSessionLoadHandle = handle
        activeTaskHandles.append(handle)
    }

    var isAppActive: Bool { appIsActive }

    /// 接受邀请 / 打开链接后进入共享对话：列表里还没有时用最小摘要打开，并刷新列表
    func openSharedSession(sessionId: String, title: String) {
        let summary = sessions.first(where: { $0.id == sessionId })
            ?? AiSessionSummary(id: sessionId, createdAt: nil, updatedAt: nil, archivedAt: nil, archived: false, is_archived: nil, messageCount: 0, title: title, firstQuestion: nil, lastQuestion: nil, discussionMode: nil, agent: nil, busy: false, pinned: false, customTitle: nil, pinOrder: nil, hidden: false)
        openSession(summary, forceRefresh: true)
        loadSessions()
    }

    /// 共享对话里其他成员的新消息：取最新一页，把还没显示的接在后面（正在回复时先不接，下次同步再试）
    func appendSharedMessages(sessionId: String, completion: @escaping (Bool) -> Void) {
        guard currentSessionId == sessionId, activeDesktopSession == nil, !isStreaming, !isLoadingSessionMessages else { completion(false); return }
        let handle = sdk.fetchSessionMessages(token: token, sessionId: sessionId, limit: historyPageSize, before: nil) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self, self.currentSessionId == sessionId, !self.isStreaming else { completion(false); return }
                let shown = Set(self.messages.map { $0.id })
                let fresh = self.sdk.mapHistoryMessages(items: res.items).filter { $0.sharedAuthor != nil && !shown.contains($0.id) }
                if !fresh.isEmpty {
                    withAnimation(.snappy) { self.messages.append(contentsOf: fresh) }
                }
                completion(true)
            }
        } onError: { _ in
            dispatchToMain { completion(false) }
        }
        activeTaskHandles.append(handle)
    }

    func openDesktopSession(_ session: DesktopAgentSessionSummary, forceRefresh: Bool = false) {
        stopStreaming()
        activeSessionLoadHandle?.cancel()
        activeSessionLoadHandle = nil
        activeOlderLoadHandle?.cancel()
        activeOlderLoadHandle = nil
        desktopPollTask?.cancel()
        desktopPollTask = nil

        currentSessionId = nil
        activeDesktopSession = session
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = session.busy
        activeDesktopReason = nil
        activeDesktopSelectedModel = ""
        desktopModelsError = nil
        desktopQueue.removeAll()
        regularQueue.removeAll()
        regularBeforeCursor = nil
        desktopBeforeCursor = nil
        desktopLoadedRawItems.removeAll()
        hasMoreOlderMessages = false
        isLoadingOlderMessages = false

        pendingAttachments.removeAll()
        showNativeMetrics = false
        activeWebTool = nil
        workMode = .chat
        isDrawerOpen = false
        chatErrorBanner = nil

        let cleanProvider = session.provider.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if forceRefresh || (desktopModelsByProvider[cleanProvider]?.isEmpty ?? true) {
            loadDesktopModels(provider: session.provider, forceLive: false)
        }

        sdk.syncConversationCacheScope(username: username)
        let cacheEval = sdk.conversationCache.evaluateDesktopSession(
            summary: session,
            lastSessionsSyncMs: lastSessionsSyncedAtMs,
            forceRefresh: forceRefresh
        )
        let hasCachedMessages = (cacheEval.cached?.rawItems.isEmpty == false)
        if let cached = cacheEval.cached, hasCachedMessages {
            desktopLoadedRawItems = cached.rawItems
            desktopBeforeCursor = cached.beforeCursor
            hasMoreOlderMessages = cached.hasMore && !(cached.beforeCursor?.isEmpty ?? true)
            activeDesktopCanSend = cached.canSend
            activeDesktopCanSteer = cached.canSteer
            activeDesktopSelectedModel = cached.selectedModel
            activeDesktopReason = cached.reason
            messages = sdk.mapDesktopAgentMessages(items: cached.rawItems)
            isLoadingSessionMessages = false
            chatOpenScrollGeneration += 1
            if cacheEval.decision == .useCacheSkipNetwork {
                return
            }
            // Background refresh silently updates any delta without blanking out cached history.
            fetchDesktopMessages(for: session, passive: !forceRefresh)
        } else {
            messages.removeAll()
            isLoadingSessionMessages = true
            fetchDesktopMessages(for: session, passive: false)
        }
    }

    private func fetchDesktopMessages(for session: DesktopAgentSessionSummary, passive: Bool) {
        let targetKey = session.stableKey
        let handle = sdk.fetchDesktopAgentMessages(
            token: token,
            provider: session.provider,
            sessionId: session.id,
            passive: passive,
            limit: historyPageSize,
            before: nil
        ) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                self.isLoadingSessionMessages = false
                self.activeDesktopCanSend = res.canSend
                self.activeDesktopCanSteer = res.canSteer
                self.activeDesktopBusy = res.busy
                self.activeDesktopReason = res.reason
                self.desktopQueue = res.queue
                if let srvModel = res.selectedModel {
                    self.activeDesktopSelectedModel = srvModel
                }
                if let incomingTail = res.items {
                    let prevLastId = self.messages.last?.id
                    let prevLastContent = self.messages.last?.content
                    let prevCount = self.messages.count
                    let mergedRaw: [DesktopAgentMessageItem]
                    if !passive || self.desktopLoadedRawItems.isEmpty {
                        self.desktopBeforeCursor = res.nextBefore
                        self.hasMoreOlderMessages = res.hasMore && !(res.nextBefore?.isEmpty ?? true)
                        mergedRaw = incomingTail
                    } else {
                        mergedRaw = self.sdk.mergeDesktopTailItems(existing: self.desktopLoadedRawItems, incomingTail: incomingTail)
                    }
                    self.desktopLoadedRawItems = mergedRaw
                    let mapped = self.sdk.mapDesktopAgentMessages(items: mergedRaw)
                    self.messages = mapped
                    let changed = prevCount == 0 ||
                        mapped.count != prevCount ||
                        mapped.last?.id != prevLastId ||
                        mapped.last?.content != prevLastContent
                    if !passive && changed {
                        self.chatOpenScrollGeneration += 1
                    }
                    if !res.busy && res.queue.isEmpty && !mergedRaw.isEmpty {
                        let summary = res.session ?? self.desktopAgentSessions.first(where: { $0.stableKey == targetKey }) ?? session
                        self.sdk.conversationCache.saveDesktopSession(
                            session: summary,
                            rawItems: mergedRaw,
                            beforeCursor: self.desktopBeforeCursor,
                            hasMore: self.hasMoreOlderMessages,
                            available: res.available,
                            canSend: res.canSend,
                            canSteer: res.canSteer,
                            selectedModel: res.selectedModel ?? self.activeDesktopSelectedModel,
                            reason: res.reason
                        )
                    }
                }
                if !res.available, let err = res.error ?? res.reason, !err.isEmpty, self.messages.isEmpty {
                    self.chatStatusBanner = err
                }
                if res.busy || !res.queue.isEmpty {
                    self.scheduleDesktopAgentPoll(for: session)
                } else {
                    self.desktopPollTask?.cancel()
                    self.desktopPollTask = nil
                }
            }
        } onError: { [weak self] err in
            dispatchToMain { [weak self] in
                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                self.isLoadingSessionMessages = false
                if !passive {
                    self.chatErrorBanner = err
                }
            }
        }
        if !passive {
            activeSessionLoadHandle = handle
        }
        activeTaskHandles.append(handle)
    }

    private func scheduleDesktopAgentPoll(for session: DesktopAgentSessionSummary) {
        guard desktopPollTask == nil else { return }
        let targetKey = session.stableKey
        desktopPollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                guard !Task.isCancelled,
                      let self,
                      self.activeDesktopSession?.stableKey == targetKey,
                      (self.activeDesktopBusy || !self.desktopQueue.isEmpty) else {
                    break
                }
                // No network chatter while the app is not visible.
                guard self.appIsActive else { continue }
                self.fetchDesktopMessages(for: session, passive: true)
            }
            self?.desktopPollTask = nil
            self?.loadSessions()
        }
    }

    func loadOlderMessages() {
        guard !isLoadingOlderMessages, hasMoreOlderMessages, !isLoadingSessionMessages else { return }
        if let desktop = activeDesktopSession {
            guard let cursor = desktopBeforeCursor, !cursor.isEmpty else { return }
            let targetKey = desktop.stableKey
            isLoadingOlderMessages = true
            let handle = sdk.fetchDesktopAgentMessages(
                token: token,
                provider: desktop.provider,
                sessionId: desktop.id,
                passive: false,
                limit: historyPageSize,
                before: cursor
            ) { [weak self] res in
                dispatchToMain { [weak self] in
                    guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                    self.isLoadingOlderMessages = false
                    let olderItems = res.items ?? []
                    self.desktopBeforeCursor = res.nextBefore
                    self.hasMoreOlderMessages = res.hasMore && !(res.nextBefore?.isEmpty ?? true) && !olderItems.isEmpty
                    if !olderItems.isEmpty {
                        self.desktopLoadedRawItems = olderItems + self.desktopLoadedRawItems
                        self.messages = self.sdk.mapDesktopAgentMessages(items: self.desktopLoadedRawItems)
                        if !self.activeDesktopBusy && self.desktopQueue.isEmpty {
                            let summary = res.session ?? desktop
                            self.sdk.conversationCache.saveDesktopSession(
                                session: summary,
                                rawItems: self.desktopLoadedRawItems,
                                beforeCursor: self.desktopBeforeCursor,
                                hasMore: self.hasMoreOlderMessages,
                                available: res.available,
                                canSend: res.canSend,
                                canSteer: res.canSteer,
                                selectedModel: self.activeDesktopSelectedModel,
                                reason: res.reason
                            )
                        }
                    }
                }
            } onError: { [weak self] _ in
                dispatchToMain { [weak self] in
                    guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                    self.isLoadingOlderMessages = false
                }
            }
            activeOlderLoadHandle = handle
            activeTaskHandles.append(handle)
            return
        }

        guard let sessionId = currentSessionId, let cursor = regularBeforeCursor, !cursor.isEmpty else { return }
        isLoadingOlderMessages = true
        let handle = sdk.fetchSessionMessages(
            token: token,
            sessionId: sessionId,
            limit: historyPageSize,
            before: cursor
        ) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self, self.currentSessionId == sessionId, self.activeDesktopSession == nil else { return }
                self.isLoadingOlderMessages = false
                let nextCursor = res.items.first?.id
                self.regularBeforeCursor = nextCursor
                self.hasMoreOlderMessages = res.hasMore && !(nextCursor?.isEmpty ?? true) && !res.items.isEmpty
                if !res.items.isEmpty {
                    let olderMapped = self.sdk.mapHistoryMessages(items: res.items)
                    let combined = self.sdk.mergeMessages(messages: olderMapped + self.messages)
                    self.messages = combined
                    let summary = self.sessions.first(where: { $0.id == sessionId })
                    self.sdk.conversationCache.saveAiSession(
                        sessionId: sessionId,
                        messages: combined,
                        sessionUpdatedAt: summary?.updatedAt,
                        sessionMessageCount: summary?.messageCount ?? Int32(combined.count),
                        beforeCursor: self.regularBeforeCursor,
                        hasMore: self.hasMoreOlderMessages,
                        isLocalWrite: false
                    )
                }
            }
        } onError: { [weak self] _ in
            dispatchToMain { [weak self] in
                guard let self, self.currentSessionId == sessionId, self.activeDesktopSession == nil else { return }
                self.isLoadingOlderMessages = false
            }
        }
        activeOlderLoadHandle = handle
        activeTaskHandles.append(handle)
    }

    func removeSession(_ session: AiSessionSummary) {
        let targetId = session.id
        let handle = sdk.deleteSession(token: token, sessionId: targetId) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.rawAiSessions.removeAll { $0.id == targetId }
                self.rawCachedAiSessions.removeAll { $0.id == targetId }
                self.rawArchivedSessions.removeAll { $0.id == targetId }
                self.conversationPreferences.removeAll { $0.source == "mine" && $0.id == targetId }
                self.sdk.conversationCache.removeAiSession(sessionId: targetId)
                self.regroupSessions()
                if self.currentSessionId == targetId {
                    self.resetActiveChatState(closeDrawer: false)
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func enhanceDraftPrompt() {
        let trimmed = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isEnhancingPrompt else { return }
        isEnhancingPrompt = true
        chatErrorBanner = nil

        let handle = sdk.enhancePrompt(
            token: token,
            text: trimmed,
            language: language,
            modelId: selectedModelId.isEmpty ? nil : selectedModelId
        ) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isEnhancingPrompt = false
                if let enhanced = res.prompt?.trimmingCharacters(in: .whitespacesAndNewlines), !enhanced.isEmpty {
                    self.composerText = enhanced
                } else if let err = res.error {
                    self.chatErrorBanner = err
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isEnhancingPrompt = false
                self.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func uploadAttachments(_ drafts: [UploadAttachmentDraft]) {
        guard !drafts.isEmpty, !isUploadingFiles else { return }
        isUploadingFiles = true
        chatErrorBanner = nil

        let handle = sdk.uploadFiles(token: token, drafts: drafts) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isUploadingFiles = false
                if !res.files.isEmpty {
                    self.pendingAttachments.append(contentsOf: res.files)
                } else if let err = res.error {
                    self.chatErrorBanner = err
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isUploadingFiles = false
                self.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func removePendingAttachment(_ file: UploadedFileInfo) {
        pendingAttachments.removeAll { $0.path == file.path }
    }

    func cancelQueuedRegularPrompt(_ id: String) {
        regularQueue.removeAll { $0.id == id }
    }

    func flushRegularQueueIfIdle() {
        guard !isStreaming, activeDesktopSession == nil, !regularQueue.isEmpty else { return }
        let next = regularQueue.removeFirst()
        let rawAttachments = sdk.attachmentsFromUploadedFiles(files: next.attachments)
        let extracted = sdk.extractMessageAttachmentsAndCleanText(rawContent: next.text, existingAttachments: rawAttachments)
        let displayAtts = (extracted.second as? [ChatAttachment]) ?? rawAttachments
        dispatchRegularChatPrompt(
            finalContent: next.text,
            cleanedUserText: next.displayText,
            resolvedAttachments: displayAtts,
            voiceMode: next.voiceMode
        )
    }

    func cancelQueuedDesktopPrompt(_ requestId: String) {
        guard let desktop = activeDesktopSession else { return }
        let targetKey = desktop.stableKey
        let handle = sdk.cancelDesktopAgentQueuedMessage(
            token: token,
            provider: desktop.provider,
            sessionId: desktop.id,
            requestId: requestId
        ) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                self.desktopQueue = res.queue
            }
        } onError: { [weak self] err in
            dispatchToMain { [weak self] in
                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                self.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func sendPrompt(_ overridePrompt: String? = nil, voiceMode: Bool = false) {
        if let desktop = activeDesktopSession {
            guard activeDesktopCanSend else {
                chatErrorBanner = activeDesktopReason ?? L10n.tr(language, zh: "当前桌面连接只读，请在电脑端开启发送权限", en: "Desktop agent session is currently read-only")
                return
            }
            let basePrompt = (overridePrompt ?? composerText).trimmingCharacters(in: .whitespacesAndNewlines)
            let usedFiles = overridePrompt == nil ? pendingAttachments : []
            let finalPrompt = overridePrompt != nil
                ? basePrompt
                : sdk.appendFilesToPrompt(text: basePrompt, files: usedFiles, language: language)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !finalPrompt.isEmpty || !usedFiles.isEmpty else { return }
            chatErrorBanner = nil
            if overridePrompt == nil {
                composerText = ""
                pendingAttachments.removeAll()
            }
            let uploadedAttachments = sdk.attachmentsFromUploadedFiles(files: usedFiles)
            let extractedPair = sdk.extractMessageAttachmentsAndCleanText(rawContent: finalPrompt, existingAttachments: uploadedAttachments)
            let cleanDisplay = (extractedPair.first as String? ?? finalPrompt)
            let displayAttachments = (extractedPair.second as? [ChatAttachment]) ?? uploadedAttachments

            let shouldQueue = activeDesktopBusy || !desktopQueue.isEmpty
            let useSteer = activeDesktopBusy &&
                activeDesktopCanSteer &&
                desktopBusyMode == "steer" &&
                activeDesktopSelectedModel.isEmpty
            let desiredMode: String? = shouldQueue ? (useSteer ? "steer" : "queue") : nil
            let targetKey = desktop.stableKey
            let modelToSend: String? = activeDesktopSelectedModel.isEmpty ? nil : activeDesktopSelectedModel
            let reqId = UUID().uuidString

            if desiredMode == "queue" {
                let optimisticItem = DesktopAgentQueuedItem(
                    requestId: reqId,
                    text: cleanDisplay.isEmpty ? finalPrompt : cleanDisplay,
                    status: "queued",
                    error: "",
                    createdAt: nil
                )
                desktopQueue.append(optimisticItem)
                let handle = sdk.sendDesktopAgentMessage(
                    token: token,
                    provider: desktop.provider,
                    sessionId: desktop.id,
                    text: finalPrompt,
                    requestId: reqId,
                    mode: "queue",
                    model: modelToSend
                ) { [weak self] res in
                    dispatchToMain { [weak self] in
                        guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                        if !res.queue.isEmpty {
                            self.desktopQueue = res.queue
                        }
                        self.scheduleDesktopAgentPoll(for: desktop)
                        self.loadSessions()
                    }
                } onError: { [weak self] err in
                    dispatchToMain { [weak self] in
                        guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                        self.desktopQueue.removeAll { $0.requestId == reqId }
                        self.chatErrorBanner = err
                    }
                }
                activeTaskHandles.append(handle)
                return
            }

            let optimisticMsgId = UUID().uuidString
            let userMsg = ChatMessage(
                id: optimisticMsgId,
                role: "user",
                content: cleanDisplay,
                thinking: "",
                createdAt: nil,
                statusText: nil,
                toolCalls: [],
                attachments: displayAttachments,
                rawContent: finalPrompt,
                inputTokens: nil,
                outputTokens: nil,
                modelName: desktop.providerDisplayName(),
                interrupted: false,
                isStreaming: false,
                approvals: [],
                sharedAuthor: nil,
                sharedAuthorName: nil
            )
            messages.append(userMsg)
            activeDesktopBusy = true
            let handle = sdk.sendDesktopAgentMessage(
                token: token,
                provider: desktop.provider,
                sessionId: desktop.id,
                text: finalPrompt,
                requestId: reqId,
                mode: desiredMode,
                model: modelToSend
            ) { [weak self] res in
                dispatchToMain { [weak self] in
                    guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                    if !res.queue.isEmpty {
                        self.desktopQueue = res.queue
                    }
                    self.fetchDesktopMessages(for: desktop, passive: true)
                    self.scheduleDesktopAgentPoll(for: desktop)
                    self.loadSessions()
                }
            } onError: { [weak self] err in
                dispatchToMain { [weak self] in
                    guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                    if self.sdk.isBusyQueueableError(errorText: err) {
                        self.messages.removeAll { $0.id == optimisticMsgId }
                        let fallbackReqId = UUID().uuidString
                        self.desktopQueue.append(
                            DesktopAgentQueuedItem(
                                requestId: fallbackReqId,
                                text: cleanDisplay.isEmpty ? finalPrompt : cleanDisplay,
                                status: "queued",
                                error: "",
                                createdAt: nil
                            )
                        )
                        let retryHandle = self.sdk.sendDesktopAgentMessage(
                            token: self.token,
                            provider: desktop.provider,
                            sessionId: desktop.id,
                            text: finalPrompt,
                            requestId: fallbackReqId,
                            mode: "queue",
                            model: modelToSend
                        ) { [weak self] res in
                            dispatchToMain { [weak self] in
                                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                                if !res.queue.isEmpty {
                                    self.desktopQueue = res.queue
                                }
                                self.scheduleDesktopAgentPoll(for: desktop)
                            }
                        } onError: { [weak self] qErr in
                            dispatchToMain { [weak self] in
                                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                                self.desktopQueue.removeAll { $0.requestId == fallbackReqId }
                                self.activeDesktopBusy = false
                                self.chatErrorBanner = qErr
                            }
                        }
                        self.activeTaskHandles.append(retryHandle)
                    } else {
                        self.activeDesktopBusy = false
                        self.chatErrorBanner = err
                    }
                }
            }
            activeTaskHandles.append(handle)
            return
        }

        let basePrompt = (overridePrompt ?? composerText).trimmingCharacters(in: .whitespacesAndNewlines)
        let usedFiles = overridePrompt == nil ? pendingAttachments : []
        let finalContent = overridePrompt != nil
            ? basePrompt
            : sdk.appendFilesToPrompt(text: basePrompt, files: usedFiles, language: language)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !finalContent.isEmpty || !usedFiles.isEmpty else { return }

        chatErrorBanner = nil
        if overridePrompt == nil {
            composerText = ""
            pendingAttachments.removeAll()
        }

        let uploadedAttachments = sdk.attachmentsFromUploadedFiles(files: usedFiles)
        let extractedPair = sdk.extractMessageAttachmentsAndCleanText(rawContent: finalContent, existingAttachments: uploadedAttachments)
        let cleanDisplay = (extractedPair.first as String? ?? finalContent)
        let displayAttachments = (extractedPair.second as? [ChatAttachment]) ?? uploadedAttachments

        if isStreaming {
            let preview = cleanDisplay.isEmpty
                ? displayAttachments.map { $0.displayName }.joined(separator: ", ")
                : cleanDisplay
            regularQueue.append(
                QueuedChatPrompt(
                    id: UUID().uuidString,
                    text: finalContent,
                    displayText: preview,
                    attachments: usedFiles,
                    status: "queued",
                    error: "",
                    voiceMode: voiceMode
                )
            )
            return
        }

        dispatchRegularChatPrompt(
            finalContent: finalContent,
            cleanedUserText: cleanDisplay,
            resolvedAttachments: displayAttachments,
            voiceMode: voiceMode
        )
    }

    private func dispatchRegularChatPrompt(
        finalContent: String,
        cleanedUserText: String,
        resolvedAttachments: [ChatAttachment],
        voiceMode: Bool = false
    ) {
        let userMsgId = UUID().uuidString
        let userMsg = ChatMessage(
            id: userMsgId,
            role: "user",
            content: cleanedUserText,
            thinking: "",
            createdAt: nil,
            statusText: nil,
            toolCalls: [],
            attachments: resolvedAttachments,
            rawContent: finalContent,
            inputTokens: nil,
            outputTokens: nil,
            modelName: nil,
            interrupted: false,
            isStreaming: false,
            approvals: [],
            sharedAuthor: nil,
            sharedAuthorName: nil
        )
        let assistantId = UUID().uuidString
        let assistantPlaceholder = ChatMessage(
            id: assistantId,
            role: "model",
            content: "",
            thinking: "",
            createdAt: nil,
            statusText: L10n.tr(language, zh: "正在思考...", en: "Thinking..."),
            toolCalls: [],
            attachments: [],
            rawContent: nil,
            inputTokens: nil,
            outputTokens: nil,
            modelName: nil,
            interrupted: false,
            isStreaming: true,
            approvals: [],
            sharedAuthor: nil,
            sharedAuthorName: nil
        )

        messages.append(userMsg)
        messages.append(assistantPlaceholder)
        isStreaming = true

        let payloadHistory = messages.dropLast().map { msg in
            ChatHistoryMessageDto(role: msg.isUser ? "user" : "model", content: msg.historyContent)
        }

        activeStreamHandle = sdk.streamChat(
            token: token,
            messages: Array(payloadHistory),
            sessionId: currentSessionId,
            language: language,
            modelId: selectedModelId.isEmpty ? nil : selectedModelId,
            voiceMode: voiceMode
        ) { [weak self] event in
            dispatchToMain { [weak self] in
                self?.applyStreamEvent(event, assistantId: assistantId)
            }
        } onComplete: { [weak self] in
            dispatchToMain { [weak self] in
                self?.finishStreaming(assistantId: assistantId, interrupted: false)
            }
        } onError: { [weak self] err in
            dispatchToMain { [weak self] in
                guard let self else { return }
                let placeholder = self.messages.first(where: { $0.id == assistantId })
                let noPartial = placeholder == nil ||
                    (placeholder!.content.isEmpty && placeholder!.thinking.isEmpty && placeholder!.toolCalls.isEmpty)
                if noPartial && self.sdk.isBusyQueueableError(errorText: err) {
                    self.activeStreamHandle = nil
                    self.isStreaming = false
                    self.messages.removeAll { $0.id == userMsgId || $0.id == assistantId }
                    self.regularQueue.insert(
                        QueuedChatPrompt(
                            id: UUID().uuidString,
                            text: finalContent,
                            displayText: cleanedUserText,
                            attachments: [],
                            status: "queued",
                            error: "",
                            voiceMode: voiceMode
                        ),
                        at: 0
                    )
                    self.chatErrorBanner = nil
                    Task { @MainActor [weak self] in
                        try? await Task.sleep(nanoseconds: 800_000_000)
                        guard let self, !self.isStreaming, self.activeDesktopSession == nil else { return }
                        self.flushRegularQueueIfIdle()
                    }
                } else {
                    self.chatErrorBanner = err
                    self.finishStreaming(assistantId: assistantId, interrupted: true, errorNote: err)
                }
            }
        }
    }

    func stopStreaming() {
        clearVoiceTurnCompletion()
        activeStreamHandle?.cancel()
        activeStreamHandle = nil
        guard isStreaming else { return }
        if let idx = messages.lastIndex(where: { !$0.isUser && $0.isStreaming }) {
            let existing = messages[idx]
            messages[idx] = ChatMessage(
                id: existing.id,
                role: existing.role,
                content: existing.content,
                thinking: existing.thinking,
                createdAt: existing.createdAt,
                statusText: nil,
                toolCalls: existing.toolCalls,
                attachments: existing.attachments,
                rawContent: existing.rawContent,
                inputTokens: existing.inputTokens,
                outputTokens: existing.outputTokens,
                modelName: existing.modelName,
                interrupted: true,
                isStreaming: false,
                approvals: existing.approvals.map { ap in
                    ap.isPending ? copyApproval(ap, status: "settled", chosenDecision: "aborted", isSubmitting: false) : ap
                },
                sharedAuthor: existing.sharedAuthor,
                sharedAuthorName: existing.sharedAuthorName
            )
        }
        isStreaming = false
    }

    func retryLastPrompt() {
        guard !isStreaming, let lastUser = messages.last(where: { $0.isUser }) else { return }
        sendPrompt(lastUser.content)
    }

    private func updateMessage(at idx: Int, with message: ChatMessage) {
        guard messages.indices.contains(idx) else { return }
        var updated = messages
        updated[idx] = message
        self.messages = updated
    }

    private func applyStreamEvent(_ event: ChatStreamEvent, assistantId: String) {
        if let sid = event.sessionId, !sid.isEmpty {
            currentSessionId = sid
        }
        guard let idx = messages.firstIndex(where: { $0.id == assistantId }) else { return }
        let cur = messages[idx]

        switch event.type {
        case .start:
            break
        case .title:
            loadSessions()
        case .status:
            updateMessage(at: idx, with: copyMessage(cur, statusText: event.text ?? cur.statusText))
        case .thinking:
            let nextThinking = cur.thinking + (event.text ?? "")
            updateMessage(
                at: idx,
                with: copyMessage(
                    cur,
                    thinking: nextThinking,
                    statusText: L10n.tr(language, zh: "深度思考中...", en: "Reasoning...")
                )
            )
        case .delta:
            let nextContent = cur.content + (event.text ?? "")
            updateMessage(at: idx, with: copyMessage(cur, content: nextContent, statusText: nil))
            if let seg = voiceSpeechSegmenter, let clauseHandler = voiceTurnClauseHandler {
                let readyClauses = seg.consumeAccumulated(accumulatedRaw: nextContent, isFinal: false)
                for clause in readyClauses {
                    clauseHandler(clause)
                }
            }
        case .toolStart:
            let callId = event.callId ?? UUID().uuidString
            let trace = ToolCallTrace(
                callId: callId,
                toolName: event.toolName ?? "tool",
                argsSummary: event.toolArgsSummary ?? "",
                summary: "",
                ok: true,
                durationMs: nil,
                isFinished: false
            )
            var nextTools = cur.toolCalls
            if let existingIdx = nextTools.firstIndex(where: { $0.callId == callId }) {
                nextTools[existingIdx] = trace
            } else {
                nextTools.append(trace)
            }
            updateMessage(
                at: idx,
                with: copyMessage(
                    cur,
                    statusText: L10n.tr(language, zh: "正在调用 \(trace.toolName)...", en: "Running \(trace.toolName)..."),
                    toolCalls: nextTools
                )
            )
        case .toolResult:
            let callId = event.callId ?? (event.toolName ?? "tool")
            var nextTools = cur.toolCalls
            if let existingIdx = nextTools.firstIndex(where: { $0.callId == callId }) {
                let prev = nextTools[existingIdx]
                nextTools[existingIdx] = ToolCallTrace(
                    callId: prev.callId,
                    toolName: prev.toolName,
                    argsSummary: prev.argsSummary,
                    summary: event.text ?? "",
                    ok: event.toolOk,
                    durationMs: event.durationMs,
                    isFinished: true
                )
            } else {
                nextTools.append(
                    ToolCallTrace(
                        callId: callId,
                        toolName: event.toolName ?? "tool",
                        argsSummary: "",
                        summary: event.text ?? "",
                        ok: event.toolOk,
                        durationMs: event.durationMs,
                        isFinished: true
                    )
                )
            }
            updateMessage(at: idx, with: copyMessage(cur, statusText: nil, toolCalls: nextTools))
        case .approval:
            guard let ap = event.approval else { break }
            var nextApprovals = cur.approvals
            if let existingIdx = nextApprovals.firstIndex(where: { $0.callId == ap.callId || $0.id == ap.id }) {
                nextApprovals[existingIdx] = ap
            } else {
                nextApprovals.append(ap)
            }
            updateMessage(
                at: idx,
                with: copyMessage(
                    cur,
                    statusText: L10n.tr(language, zh: "等待确认...", en: "Awaiting approval..."),
                    approvals: nextApprovals
                )
            )
        case .approvalResult:
            let matchKey = event.callId ?? ""
            let nextApprovals = cur.approvals.map { ap in
                (ap.callId == matchKey || ap.id == matchKey)
                    ? copyApproval(
                        ap,
                        status: "settled",
                        chosenDecision: event.approvalDecision ?? ap.chosenDecision ?? "allow",
                        chosenScope: event.approvalScope,
                        isSubmitting: false,
                        errorMessage: "__CLEAR__"
                    )
                    : ap
            }
            let waitingLabel = L10n.tr(language, zh: "等待确认...", en: "Awaiting approval...")
            let nextStatus = cur.statusText == waitingLabel ? nil : cur.statusText
            updateMessage(at: idx, with: copyMessage(cur, statusText: nextStatus, approvals: nextApprovals))
        case .modelRound, .compaction:
            if let text = event.text, !text.isEmpty {
                updateMessage(at: idx, with: copyMessage(cur, statusText: text))
            }
        case .done:
            let finalText = (cur.content.isEmpty ? (event.text ?? "") : cur.content)
            let extracted = sdk.extractMessageAttachmentsAndCleanText(rawContent: finalText, existingAttachments: cur.attachments)
            let cleanedText = (extracted.first as String? ?? finalText)
            let attached = (extracted.second as? [ChatAttachment]) ?? cur.attachments
            let doneMsg = ChatMessage(
                id: cur.id,
                role: cur.role,
                content: cleanedText,
                thinking: cur.thinking,
                createdAt: cur.createdAt,
                statusText: nil,
                toolCalls: cur.toolCalls,
                attachments: attached,
                rawContent: finalText,
                inputTokens: event.inputTokens ?? cur.inputTokens,
                outputTokens: event.outputTokens ?? cur.outputTokens,
                modelName: event.modelName ?? cur.modelName,
                interrupted: false,
                isStreaming: false,
                approvals: cur.approvals.map { ap in
                    ap.isPending ? copyApproval(ap, status: "settled", chosenDecision: "aborted", isSubmitting: false) : ap
                },
                sharedAuthor: cur.sharedAuthor,
                sharedAuthorName: cur.sharedAuthorName
            )
            updateMessage(at: idx, with: doneMsg)
        case .error:
            let errText = event.errorMessage ?? L10n.tr(language, zh: "响应异常", en: "Stream error")
            chatErrorBanner = errText
            let content = cur.content.isEmpty ? "[\(errText)]" : cur.content
            updateMessage(at: idx, with: copyMessage(cur, content: content, statusText: nil, interrupted: true, isStreaming: false))
        default:
            break
        }
    }

    private func finishStreaming(assistantId: String, interrupted: Bool, errorNote: String? = nil) {
        endBackgroundGrace()
        activeStreamHandle = nil
        isStreaming = false
        var finalContent = ""
        if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
            let cur = messages[idx]
            let fallbackContent = cur.content.isEmpty && errorNote != nil ? "[\(errorNote!)]" : cur.content
            finalContent = cur.content
            let extracted = sdk.extractMessageAttachmentsAndCleanText(rawContent: fallbackContent, existingAttachments: cur.attachments)
            let cleanedText = (extracted.first as String? ?? fallbackContent)
            let attached = (extracted.second as? [ChatAttachment]) ?? cur.attachments
            updateMessage(
                at: idx,
                with: ChatMessage(
                    id: cur.id,
                    role: cur.role,
                    content: cleanedText,
                    thinking: cur.thinking,
                    createdAt: cur.createdAt,
                    statusText: nil,
                    toolCalls: cur.toolCalls,
                    attachments: attached,
                    rawContent: fallbackContent,
                    inputTokens: cur.inputTokens,
                    outputTokens: cur.outputTokens,
                    modelName: cur.modelName,
                    interrupted: cur.interrupted || interrupted,
                    isStreaming: false,
                    approvals: cur.approvals.map { ap in
                        ap.isPending ? copyApproval(ap, status: "settled", chosenDecision: "aborted", isSubmitting: false) : ap
                    },
                    sharedAuthor: cur.sharedAuthor,
                    sharedAuthorName: cur.sharedAuthorName
                )
            )
        }
        if let seg = voiceSpeechSegmenter, let clauseHandler = voiceTurnClauseHandler, !interrupted {
            let remainingClauses = seg.consumeAccumulated(accumulatedRaw: finalContent, isFinal: true)
            for clause in remainingClauses {
                clauseHandler(clause)
            }
        }
        voiceSpeechSegmenter = nil
        voiceTurnClauseHandler = nil
        let completion = voiceTurnCompletion
        voiceTurnCompletion = nil
        completion?(finalContent)
        if let sid = currentSessionId, activeDesktopSession == nil, !messages.isEmpty {
            let summary = sessions.first(where: { $0.id == sid })
            sdk.conversationCache.saveAiSession(
                sessionId: sid,
                messages: messages,
                sessionUpdatedAt: summary?.updatedAt,
                sessionMessageCount: Int32(messages.count),
                beforeCursor: regularBeforeCursor,
                hasMore: hasMoreOlderMessages,
                isLocalWrite: true
            )
        }
        loadSessions()
        if !interrupted, !regularQueue.isEmpty, activeDesktopSession == nil {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 160_000_000)
                guard let self, !self.isStreaming, self.activeDesktopSession == nil, !self.regularQueue.isEmpty else { return }
                self.flushRegularQueueIfIdle()
            }
        }
    }

    func submitApproval(messageId: String, approval: PendingApproval, decision: String, scope: String? = nil) {
        guard approval.isPending, !approval.isSubmitting, !token.isEmpty else { return }
        updateApprovalState(messageId: messageId, approvalId: approval.id) { ap in
            copyApproval(ap, isSubmitting: true, errorMessage: "__CLEAR__")
        }
        let handle = sdk.resolveApproval(
            token: token,
            approvalId: approval.id,
            decision: decision,
            scope: scope,
            approvalUrl: approval.approvalUrl
        ) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self else { return }
                let resolvedDecision = res.decision.isEmpty ? decision : res.decision
                let resolvedScope = res.scope ?? scope
                self.updateApprovalState(messageId: messageId, approvalId: approval.id) { ap in
                    self.copyApproval(
                        ap,
                        status: "settled",
                        chosenDecision: resolvedDecision,
                        chosenScope: resolvedScope,
                        isSubmitting: false,
                        errorMessage: "__CLEAR__"
                    )
                }
            }
        } onError: { [weak self] err in
            dispatchToMain { [weak self] in
                guard let self else { return }
                let expired = err.contains("404") || err.contains("过期") || err.contains("不存在")
                self.updateApprovalState(messageId: messageId, approvalId: approval.id) { ap in
                    if expired {
                        return self.copyApproval(
                            ap,
                            status: "settled",
                            chosenDecision: "timeout",
                            isSubmitting: false,
                            errorMessage: "__CLEAR__"
                        )
                    }
                    return self.copyApproval(ap, isSubmitting: false, errorMessage: err)
                }
            }
        }
        activeTaskHandles.append(handle)
    }

    private func updateApprovalState(messageId: String, approvalId: String, transform: (PendingApproval) -> PendingApproval) {
        guard let idx = messages.firstIndex(where: { $0.id == messageId }) else { return }
        let cur = messages[idx]
        let nextApprovals = cur.approvals.map { ap in
            ap.id == approvalId ? transform(ap) : ap
        }
        let nextStatus: String? = nextApprovals.contains(where: { $0.isPending }) ? cur.statusText : nil
        updateMessage(at: idx, with: copyMessage(cur, statusText: nextStatus, approvals: nextApprovals))
    }

    private func copyApproval(
        _ ap: PendingApproval,
        status: String? = nil,
        chosenDecision: String? = nil,
        chosenScope: String? = nil,
        isSubmitting: Bool? = nil,
        errorMessage: String? = "__KEEP__"
    ) -> PendingApproval {
        PendingApproval(
            id: ap.id,
            callId: ap.callId,
            runId: ap.runId,
            toolName: ap.toolName,
            approvalUrl: ap.approvalUrl,
            permissionMode: ap.permissionMode,
            noAlways: ap.noAlways,
            command: ap.command,
            cwd: ap.cwd,
            filePath: ap.filePath,
            diff: ap.diff,
            added: ap.added,
            removed: ap.removed,
            renameTo: ap.renameTo,
            recursive: ap.recursive,
            channel: ap.channel,
            targets: ap.targets,
            message: ap.message,
            title: ap.title,
            impact: ap.impact,
            fields: ap.fields,
            risks: ap.risks,
            dangers: ap.dangers,
            dangerScopes: ap.dangerScopes,
            status: status ?? ap.status,
            chosenDecision: chosenDecision ?? ap.chosenDecision,
            chosenScope: chosenScope ?? ap.chosenScope,
            isSubmitting: isSubmitting ?? ap.isSubmitting,
            errorMessage: errorMessage == "__CLEAR__" ? nil : (errorMessage == "__KEEP__" ? ap.errorMessage : errorMessage),
            expiresInMs: ap.expiresInMs
        )
    }

    private func copyMessage(
        _ m: ChatMessage,
        content: String? = nil,
        thinking: String? = nil,
        statusText: String? = "__KEEP__",
        toolCalls: [ToolCallTrace]? = nil,
        attachments: [ChatAttachment]? = nil,
        rawContent: String? = nil,
        interrupted: Bool? = nil,
        isStreaming: Bool? = nil,
        approvals: [PendingApproval]? = nil
    ) -> ChatMessage {
        ChatMessage(
            id: m.id,
            role: m.role,
            content: content ?? m.content,
            thinking: thinking ?? m.thinking,
            createdAt: m.createdAt,
            statusText: statusText == "__KEEP__" ? m.statusText : statusText,
            toolCalls: toolCalls ?? m.toolCalls,
            attachments: attachments ?? m.attachments,
            rawContent: rawContent ?? m.rawContent,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            modelName: m.modelName,
            interrupted: interrupted ?? m.interrupted,
            isStreaming: isStreaming ?? m.isStreaming,
            approvals: approvals ?? m.approvals,
            sharedAuthor: m.sharedAuthor,
            sharedAuthorName: m.sharedAuthorName
        )
    }

    // MARK: - Tool Hub Navigation

    func openTool(_ tool: PlatformTool) {
        isDrawerOpen = false
        recordToolOpened(tool.id)
        if tool.isNative || tool.routePath == "native://kpi-monitor" {
            metricsPath.removeAll()
            showNativeMetrics = true
            ensureMonthLoaded(currentMonth)
        } else {
            activeWebTool = tool
        }
    }

    // MARK: - Voice Transcription, Skills, Session Lifecycle, Schedules & Tool Nav Sync (P1)

    func prepareVoiceConversationSessionIfNeeded() {
        if activeDesktopSession != nil {
            startNewChat()
        }
    }

    func clearVoiceTurnCompletion() {
        voiceTurnCompletion = nil
        voiceTurnClauseHandler = nil
        voiceSpeechSegmenter = nil
    }

    func transcribeAndStreamVoiceTurn(
        _ data: Data,
        onRecognized: @escaping (String) -> Void,
        onClauseReady: @escaping (String) -> Void,
        onReplyDone: @escaping (String) -> Void,
        onError: @escaping (String) -> Void
    ) {
        guard !data.isEmpty, !token.isEmpty else {
            onError(L10n.tr(language, zh: "录音无效，请重试", en: "Empty audio, please try again"))
            return
        }
        let bytes = IosInteropKt.nsDataToByteArray(data: data)
        let handle = sdk.transcribeSpeech(
            token: token,
            audioBytes: bytes,
            fileName: "voice.m4a",
            mimeType: "audio/mp4"
        ) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let text = res.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty {
                    onError(res.error ?? L10n.tr(self.language, zh: "未识别到语音，请再试一次", en: "No speech recognized"))
                    return
                }
                if self.activeDesktopSession != nil {
                    self.startNewChat()
                }
                if self.isStreaming {
                    self.stopStreaming()
                }
                self.voiceSpeechSegmenter = StreamingSpeechSegmenter()
                self.voiceTurnClauseHandler = onClauseReady
                self.voiceTurnCompletion = onReplyDone
                onRecognized(text)
                self.sendPrompt(text, voiceMode: true)
            }
        } onError: { err in
            Task { @MainActor in
                onError(err)
            }
        }
        activeTaskHandles.append(handle)
    }

    func transcribeVoiceAudio(_ data: Data, sendImmediately: Bool) {
        guard !data.isEmpty, !token.isEmpty else { return }
        let bytes = IosInteropKt.nsDataToByteArray(data: data)
        chatErrorBanner = nil
        chatStatusBanner = L10n.tr(language, zh: "正在识别语音...", en: "Transcribing voice...")

        let handle = sdk.transcribeSpeech(
            token: token,
            audioBytes: bytes,
            fileName: "voice.m4a",
            mimeType: "audio/mp4"
        ) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.chatStatusBanner = nil
                let text = res.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty {
                    self.chatErrorBanner = res.error ?? L10n.tr(self.language, zh: "未识别到有效语音，请重试", en: "No speech recognized")
                    return
                }
                if sendImmediately {
                    let combined = self.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? text
                        : "\(self.composerText.trimmingCharacters(in: .whitespacesAndNewlines)) \(text)"
                    self.composerText = combined
                    self.sendPrompt()
                } else {
                    self.composerText = self.composerText.isEmpty ? text : "\(self.composerText) \(text)"
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.chatStatusBanner = nil
                self.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func loadSkills() {
        guard !token.isEmpty else { return }
        let handle = sdk.fetchSkills(token: token) { [weak self] res in
            Task { @MainActor [weak self] in
                self?.skills = res.items
            }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    func applySkill(_ skill: AgentSkillItem) {
        let tokenTag = "@\(skill.localizedName(language: language))"
        let trimmed = composerText.trimmingCharacters(in: .whitespaces)
        composerText = trimmed.isEmpty ? "\(tokenTag) " : "\(composerText) \(tokenTag) "
    }

    func compactCurrentSession() {
        guard let sessionId = currentSessionId, !sessionId.isEmpty, !isCompactingContext else { return }
        isCompactingContext = true
        chatErrorBanner = nil
        chatStatusBanner = L10n.tr(language, zh: "正在压缩对话上下文...", en: "Compacting conversation context...")
        let handle = sdk.compactSession(
            token: token,
            sessionId: sessionId,
            modelId: selectedModelId.isEmpty ? nil : selectedModelId
        ) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isCompactingContext = false
                if res.performed {
                    self.chatStatusBanner = L10n.tr(
                        self.language,
                        zh: "上下文已压缩（\(res.beforeChars) -> \(res.afterChars) 字符）",
                        en: "Compacted context (\(res.beforeChars) -> \(res.afterChars) chars)"
                    )
                } else {
                    self.chatStatusBanner = res.error ?? L10n.tr(self.language, zh: "当前上下文已足够精简", en: "Context is already compact")
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isCompactingContext = false
                self.chatStatusBanner = nil
                self.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func loadArchivedSessions() {
        guard !token.isEmpty else { return }
        let handle = sdk.fetchArchivedSessions(token: token, query: sessionSearchQuery, limit: 40) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.rawArchivedSessions = res.items
                self.regroupSessions()
            }
        } onError: { _ in }
        activeTaskHandles.append(handle)

        let prefHandle = sdk.fetchConversationPreferences(token: token) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.conversationPreferences = res.items
                self.regroupSessions()
            }
        } onError: { _ in }
        activeTaskHandles.append(prefHandle)
    }

    func archiveSession(_ session: AiSessionSummary) {
        let targetId = session.id
        conversationPreferences = sdk.withPreferenceArchived(
            preferences: conversationPreferences,
            source: "mine",
            id: targetId,
            archived: true
        )
        regroupSessions()
        let handle = sdk.archiveSession(token: token, sessionId: targetId) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.rawAiSessions.removeAll { $0.id == targetId }
                self.rawCachedAiSessions.removeAll { $0.id == targetId }
                self.regroupSessions()
                self.loadArchivedSessions()
                if self.currentSessionId == targetId {
                    self.resetActiveChatState(closeDrawer: false)
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.loadSessions()
                self?.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func unarchiveSession(_ session: AiSessionSummary) {
        let targetId = session.id
        conversationPreferences = sdk.withPreferenceArchived(
            preferences: conversationPreferences,
            source: "mine",
            id: targetId,
            archived: false
        )
        rawArchivedSessions.removeAll { $0.id == targetId }
        regroupSessions()
        let handle = sdk.unarchiveSession(token: token, sessionId: targetId) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.loadSessions()
                self?.loadArchivedSessions()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.loadArchivedSessions()
                self?.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func togglePinSession(_ session: AiSessionSummary) {
        let targetId = session.id
        let nextPinned = !session.isPinned
        conversationPreferences = sdk.withPreferencePinned(
            preferences: conversationPreferences,
            source: "mine",
            id: targetId,
            pinned: nextPinned
        )
        regroupSessions()
        let handle = sdk.setConversationPinned(token: token, source: "mine", id: targetId, pinned: nextPinned) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let item = res.item {
                    self.conversationPreferences = self.sdk.withPreferenceServerItem(preferences: self.conversationPreferences, item: item)
                    self.regroupSessions()
                }
                self.loadSessions()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.loadSessions()
                self?.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func togglePinDesktopSession(_ session: DesktopAgentSessionSummary) {
        let target = sdk.preferenceTargetForDesktop(
            provider: session.provider,
            sessionId: session.id,
            preferences: conversationPreferences
        )
        let source = (target.first as String?) ?? "mine"
        let id = (target.second as String?) ?? session.stableKey
        let nextPinned = !session.isPinned
        conversationPreferences = sdk.withPreferencePinned(
            preferences: conversationPreferences,
            source: source,
            id: id,
            pinned: nextPinned
        )
        regroupSessions()
        let handle = sdk.setConversationPinned(token: token, source: source, id: id, pinned: nextPinned) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let item = res.item {
                    self.conversationPreferences = self.sdk.withPreferenceServerItem(preferences: self.conversationPreferences, item: item)
                    self.regroupSessions()
                }
                self.loadSessions()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.loadSessions()
                self?.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func renameSession(_ session: AiSessionSummary, newTitle: String) {
        let trimmed = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !token.isEmpty else { return }
        let safeTitle = String(trimmed.prefix(160))
        conversationPreferences = sdk.withPreferenceTitle(
            preferences: conversationPreferences,
            source: "mine",
            id: session.id,
            title: safeTitle
        )
        regroupSessions()
        let handle = sdk.renameConversation(token: token, source: "mine", id: session.id, title: safeTitle) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let item = res.item {
                    self.conversationPreferences = self.sdk.withPreferenceServerItem(preferences: self.conversationPreferences, item: item)
                    self.regroupSessions()
                }
                self.loadSessions()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.loadSessions()
                self?.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func movePinnedEntry(_ entry: SidebarSessionEntry, moveUp: Bool) {
        guard let nextOrder = sdk.movePinnedEntryOrder(
            groups: unifiedSessionGroups,
            preferences: conversationPreferences,
            stableKey: entry.stableKey,
            moveUp: moveUp
        ), nextOrder.count >= 2 else { return }
        conversationPreferences = sdk.applyLocalPinOrder(
            preferences: conversationPreferences,
            source: "mine",
            orderedIds: nextOrder
        )
        regroupSessions()
        let handle = sdk.reorderPinnedConversations(token: token, source: "mine", order: nextOrder) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let items = res.items {
                    self.conversationPreferences = items
                    self.regroupSessions()
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.loadSessions()
                self?.chatErrorBanner = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func canMovePinnedEntry(_ entry: SidebarSessionEntry, moveUp: Bool) -> Bool {
        sdk.movePinnedEntryOrder(
            groups: unifiedSessionGroups,
            preferences: conversationPreferences,
            stableKey: entry.stableKey,
            moveUp: moveUp
        ) != nil
    }

    func exportSession(_ session: AiSessionSummary) {
        chatErrorBanner = nil
        let handle = sdk.exportSessionJson(token: token, sessionId: session.id) { [weak self] raw in
            Task { @MainActor [weak self] in
                self?.exportedSessionJson = raw
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.chatErrorBanner = err }
        }
        activeTaskHandles.append(handle)
    }

    func loadSchedules() {
        guard !token.isEmpty else { return }
        isLoadingSchedules = true
        let handle = sdk.fetchSchedules(token: token) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isLoadingSchedules = false
                self.schedules = res.items
            }
        } onError: { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.isLoadingSchedules = false
            }
        }
        activeTaskHandles.append(handle)
    }

    func createSchedule(text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !token.isEmpty else { return }
        let handle = sdk.createSchedule(
            token: token,
            text: clean,
            sessionId: currentSessionId ?? "",
            timezone: TimeZone.current.identifier,
            modelId: selectedModelId.isEmpty ? nil : selectedModelId
        ) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let item = res.item {
                    self.schedules.insert(item, at: 0)
                } else {
                    self.loadSchedules()
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.chatErrorBanner = err }
        }
        activeTaskHandles.append(handle)
    }

    func deleteSchedule(_ schedule: DragonClawScheduleItem) {
        let id = schedule.id
        let handle = sdk.deleteSchedule(token: token, scheduleId: id) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.schedules.removeAll { $0.id == id }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.chatErrorBanner = err }
        }
        activeTaskHandles.append(handle)
    }

    func loadToolNavState() {
        guard !token.isEmpty else { return }
        let favHandle = sdk.fetchFavoriteNav(token: token) { [weak self] res in
            Task { @MainActor [weak self] in self?.favoriteToolIds = res.ids }
        } onError: { _ in }
        let recentHandle = sdk.fetchRecentNav(token: token) { [weak self] res in
            Task { @MainActor [weak self] in self?.recentToolIds = res.ids }
        } onError: { _ in }
        activeTaskHandles.append(favHandle)
        activeTaskHandles.append(recentHandle)
    }

    func toggleFavoriteTool(_ toolId: String) {
        var next = favoriteToolIds
        if let idx = next.firstIndex(of: toolId) {
            next.remove(at: idx)
        } else {
            next.insert(toolId, at: 0)
        }
        favoriteToolIds = next
        let handle = sdk.saveFavoriteNav(token: token, ids: next) { [weak self] res in
            Task { @MainActor [weak self] in self?.favoriteToolIds = res.ids }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    func recordToolOpened(_ toolId: String) {
        guard !token.isEmpty else { return }
        let handle = sdk.recordRecentNav(token: token, toolId: toolId) { [weak self] res in
            Task { @MainActor [weak self] in self?.recentToolIds = res.ids }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    func openMetricsModule() {
        isDrawerOpen = false
        workMode = .tools
        metricsPath.removeAll()
        showNativeMetrics = true
        ensureMonthLoaded(currentMonth)
    }

    // MARK: - Metrics Data Loading

    func ensureMonthLoaded(_ month: Int, force: Bool = false) {
        guard !token.isEmpty else { return }
        if !force, summaryByMonth[month] != nil { return }
        if metricsLoadingByMonth.contains(month) { return }
        metricsLoadingByMonth.insert(month)
        metricsErrorByMonth[month] = nil

        let summaryHandle = sdk.fetchMetricsSummary(token: token, month: Int32(month), includeOverall: true) { [weak self] summary in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.summaryByMonth[month] = summary
                self.metricsLoadingByMonth.remove(month)
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.metricsErrorByMonth[month] = err
                self.metricsLoadingByMonth.remove(month)
            }
        }
        let snapsHandle = sdk.fetchSnapshots(token: token, month: Int32(month), limit: 20) { [weak self] res in
            Task { @MainActor [weak self] in
                self?.snapshotsByMonth[month] = res.items
            }
        } onError: { _ in }
        activeTaskHandles.append(summaryHandle)
        activeTaskHandles.append(snapsHandle)
    }
}
