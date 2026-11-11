import Foundation
import Observation
import SwiftUI
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

    // Preferences & Session
    var baseUrl: String
    var language: String
    var themeMode: String
    var rememberMe: Bool
    var autoLogin: Bool

    var token: String = ""
    var username: String = ""
    var role: String = "user"
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

    // Chat State
    var models: [AiModelInfo] = []
    var selectedModelId: String
    var suggestions: [AiSuggestion] = []
    var sessions: [AiSessionSummary] = []
    var desktopAgentSessions: [DesktopAgentSessionSummary] = []
    var sessionGroups: [SessionGroup] = []
    var unifiedSessionGroups: [UnifiedSessionGroup] = []
    var sessionSearchQuery: String = ""
    var currentSessionId: String? = nil
    var activeDesktopSession: DesktopAgentSessionSummary? = nil
    var activeDesktopCanSend = false
    var activeDesktopCanSteer = false
    var activeDesktopBusy = false
    var activeDesktopReason: String? = nil
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

    // Voice & Skills State
    var skills: [AgentSkillItem] = []

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
    private var desktopPollTask: Task<Void, Never>? = nil
    private var activeTaskHandles: [TaskHandle] = []
    private var voiceTurnCompletion: ((String) -> Void)? = nil

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
        self.selectedModelId = sdk.getSelectedModelId()
        self.appVersion = sdk.getAppVersion()
        self.currentMonth = Int(sdk.getCurrentMonth())
        self.tools = ToolCatalogMerger.shared.merge(remoteTools: [])
        self.username = sdk.getSavedUsername()

        loadPlatformIdentity()
        restoreSessionIfPossible()
    }

    // MARK: - Preferences

    func toggleTheme() {
        themeMode = themeMode == "dark" ? "light" : "dark"
        sdk.saveThemeMode(mode: themeMode)
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
        let savedPass = sdk.getSavedPassword()

        if !savedToken.isEmpty && autoLogin {
            isAuthenticating = true
            let handle = sdk.verifySession(token: savedToken) { [weak self] profile in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.token = savedToken
                    self.username = profile.username.isEmpty ? savedUser : profile.username
                    self.role = profile.role
                    self.isAuthenticated = true
                    self.isAuthenticating = false
                    self.bootstrapWorkspace()
                }
            } onError: { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.isAuthenticating = false
                    if !savedUser.isEmpty && !savedPass.isEmpty {
                        self.performLogin(
                            username: savedUser,
                            password: savedPass,
                            remember: self.rememberMe,
                            autoLogin: true
                        )
                    }
                }
            }
            activeTaskHandles.append(handle)
        }
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
                    self.token = self.sdk.getSavedToken()
                    self.username = finalUser
                    self.role = finalRole
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
                self.loginError = err
            }
        }
        activeTaskHandles.append(handle)
    }

    func logout() {
        stopStreaming()
        activeSessionLoadHandle?.cancel()
        activeSessionLoadHandle = nil
        desktopPollTask?.cancel()
        desktopPollTask = nil
        activeTaskHandles.forEach { $0.cancel() }
        activeTaskHandles.removeAll()
        sdk.clearSessionAuth(keepUsername: rememberMe)
        token = ""
        isAuthenticated = false
        isDrawerOpen = false
        activeWebTool = nil
        showNativeMetrics = false
        metricsPath.removeAll()
        messages.removeAll()
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
        pendingAttachments.removeAll()
        skills.removeAll()
        schedules.removeAll()
        favoriteToolIds.removeAll()
        recentToolIds.removeAll()
        expandedThinkingIds.removeAll()
        showArchivedSessions = false
        exportedSessionJson = nil
        chatStatusBanner = nil
        currentSessionId = nil
        workMode = .chat
    }

    // MARK: - Workspace Bootstrap

    func bootstrapWorkspace() {
        guard !token.isEmpty else { return }
        loadModels()
        loadSuggestions()
        loadSessions()
        loadToolsCatalog()
        loadAlertSummary()
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

    func loadSessions() {
        let query = sessionSearchQuery
        let aiHandle = sdk.fetchSessions(token: token, query: query, limit: 40) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self else { return }
                self.sessions = res.items
                self.regroupSessions()
            }
        } onError: { _ in }
        activeTaskHandles.append(aiHandle)

        // Silently ignore 403/503 for non-admin accounts or offline desktop connectors.
        let desktopHandle = sdk.fetchDesktopAgentSessions(token: token, query: query) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self else { return }
                self.desktopAgentSessions = res.items
                self.regroupSessions()
            }
        } onError: { _ in }
        activeTaskHandles.append(desktopHandle)
    }

    func regroupSessions() {
        sessionGroups = sdk.groupSessionsByDate(sessions: sessions)
        unifiedSessionGroups = sdk.groupSidebarSessions(
            aiSessions: sessions,
            desktopSessions: desktopAgentSessions,
            searchQuery: sessionSearchQuery
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
                self?.alertUnreadCount = Int(summary.unread)
            }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    // MARK: - Chat Flow

    func startNewChat() {
        stopStreaming()
        activeSessionLoadHandle?.cancel()
        activeSessionLoadHandle = nil
        desktopPollTask?.cancel()
        desktopPollTask = nil
        currentSessionId = nil
        activeDesktopSession = nil
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = false
        activeDesktopReason = nil
        isLoadingSessionMessages = false
        messages.removeAll()
        pendingAttachments.removeAll()
        chatErrorBanner = nil
        showNativeMetrics = false
        activeWebTool = nil
        workMode = .chat
        isDrawerOpen = false
    }

    func openSidebarEntry(_ entry: SidebarSessionEntry) {
        if let ai = entry.aiSession {
            openSession(ai)
        } else if let desktop = entry.desktopSession {
            openDesktopSession(desktop)
        }
    }

    func openSession(_ session: AiSessionSummary) {
        stopStreaming()
        activeSessionLoadHandle?.cancel()
        activeSessionLoadHandle = nil
        desktopPollTask?.cancel()
        desktopPollTask = nil

        currentSessionId = session.id
        activeDesktopSession = nil
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = false
        activeDesktopReason = nil

        // Clear immediately so opening a session shows shimmer skeleton instead of previous chat or hero screen.
        messages.removeAll()
        pendingAttachments.removeAll()
        showNativeMetrics = false
        activeWebTool = nil
        workMode = .chat
        isDrawerOpen = false
        chatErrorBanner = nil
        isLoadingSessionMessages = true

        let targetId = session.id
        let handle = sdk.fetchSessionMessages(token: token, sessionId: targetId, limit: 60, before: nil) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self, self.currentSessionId == targetId, self.activeDesktopSession == nil else { return }
                self.isLoadingSessionMessages = false
                self.messages = self.sdk.mapHistoryMessages(items: res.items)
            }
        } onError: { [weak self] err in
            dispatchToMain { [weak self] in
                guard let self, self.currentSessionId == targetId, self.activeDesktopSession == nil else { return }
                self.isLoadingSessionMessages = false
                self.chatErrorBanner = err
            }
        }
        activeSessionLoadHandle = handle
        activeTaskHandles.append(handle)
    }

    func openDesktopSession(_ session: DesktopAgentSessionSummary) {
        stopStreaming()
        activeSessionLoadHandle?.cancel()
        activeSessionLoadHandle = nil
        desktopPollTask?.cancel()
        desktopPollTask = nil

        currentSessionId = nil
        activeDesktopSession = session
        activeDesktopCanSend = false
        activeDesktopCanSteer = false
        activeDesktopBusy = session.busy
        activeDesktopReason = nil

        messages.removeAll()
        pendingAttachments.removeAll()
        showNativeMetrics = false
        activeWebTool = nil
        workMode = .chat
        isDrawerOpen = false
        chatErrorBanner = nil
        isLoadingSessionMessages = true

        fetchDesktopMessages(for: session, passive: false)
    }

    private func fetchDesktopMessages(for session: DesktopAgentSessionSummary, passive: Bool) {
        let targetKey = session.stableKey
        let handle = sdk.fetchDesktopAgentMessages(
            token: token,
            provider: session.provider,
            sessionId: session.id,
            passive: passive
        ) { [weak self] res in
            dispatchToMain { [weak self] in
                guard let self, self.activeDesktopSession?.stableKey == targetKey else { return }
                self.isLoadingSessionMessages = false
                self.activeDesktopCanSend = res.canSend
                self.activeDesktopCanSteer = res.canSteer
                self.activeDesktopBusy = res.busy
                self.activeDesktopReason = res.reason
                if let rawItems = res.items {
                    self.messages = self.sdk.mapDesktopAgentMessages(items: rawItems)
                }
                if !res.available, let err = res.error ?? res.reason, !err.isEmpty, self.messages.isEmpty {
                    self.chatStatusBanner = err
                }
                if res.busy {
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
        activeSessionLoadHandle = handle
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
                      self.activeDesktopBusy else {
                    break
                }
                self.fetchDesktopMessages(for: session, passive: true)
            }
            self?.desktopPollTask = nil
        }
    }

    func removeSession(_ session: AiSessionSummary) {
        let targetId = session.id
        let handle = sdk.deleteSession(token: token, sessionId: targetId) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.sessions.removeAll { $0.id == targetId }
                self.regroupSessions()
                if self.currentSessionId == targetId {
                    self.startNewChat()
                }
            }
        } onError: { _ in }
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

    func sendPrompt(_ overridePrompt: String? = nil) {
        guard !isStreaming else { return }
        if let desktop = activeDesktopSession {
            guard activeDesktopCanSend else {
                chatErrorBanner = activeDesktopReason ?? L10n.tr(language, zh: "当前桌面连接只读，请在电脑端开启发送权限", en: "Desktop agent session is currently read-only")
                return
            }
            let basePrompt = (overridePrompt ?? composerText).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !basePrompt.isEmpty else { return }
            chatErrorBanner = nil
            if overridePrompt == nil {
                composerText = ""
            }
            let userMsg = ChatMessage(
                id: UUID().uuidString,
                role: "user",
                content: basePrompt,
                thinking: "",
                createdAt: nil,
                statusText: nil,
                toolCalls: [],
                inputTokens: nil,
                outputTokens: nil,
                modelName: desktop.providerDisplayName(),
                interrupted: false,
                isStreaming: false
            )
            messages.append(userMsg)
            let wasBusy = activeDesktopBusy
            activeDesktopBusy = true
            let mode = (wasBusy && activeDesktopCanSteer) ? "steer" : nil
            let handle = sdk.sendDesktopAgentMessage(
                token: token,
                provider: desktop.provider,
                sessionId: desktop.id,
                text: basePrompt,
                requestId: UUID().uuidString,
                mode: mode
            ) { [weak self] _ in
                dispatchToMain { [weak self] in
                    guard let self, self.activeDesktopSession?.stableKey == desktop.stableKey else { return }
                    self.fetchDesktopMessages(for: desktop, passive: true)
                    self.scheduleDesktopAgentPoll(for: desktop)
                    self.loadSessions()
                }
            } onError: { [weak self] err in
                dispatchToMain { [weak self] in
                    guard let self else { return }
                    self.activeDesktopBusy = false
                    self.chatErrorBanner = err
                }
            }
            activeTaskHandles.append(handle)
            return
        }

        let basePrompt = (overridePrompt ?? composerText).trimmingCharacters(in: .whitespacesAndNewlines)
        let finalContent = overridePrompt != nil
            ? basePrompt
            : sdk.appendFilesToPrompt(text: basePrompt, files: pendingAttachments, language: language)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !finalContent.isEmpty else { return }

        chatErrorBanner = nil
        if overridePrompt == nil {
            composerText = ""
            pendingAttachments.removeAll()
        }

        let userMsg = ChatMessage(
            id: UUID().uuidString,
            role: "user",
            content: finalContent,
            thinking: "",
            createdAt: nil,
            statusText: nil,
            toolCalls: [],
            inputTokens: nil,
            outputTokens: nil,
            modelName: nil,
            interrupted: false,
            isStreaming: false
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
            inputTokens: nil,
            outputTokens: nil,
            modelName: nil,
            interrupted: false,
            isStreaming: true
        )

        messages.append(userMsg)
        messages.append(assistantPlaceholder)
        isStreaming = true

        let payloadHistory = messages.dropLast().map { msg in
            ChatHistoryMessageDto(role: msg.isUser ? "user" : "model", content: msg.content)
        }

        activeStreamHandle = sdk.streamChat(
            token: token,
            messages: Array(payloadHistory),
            sessionId: currentSessionId,
            language: language,
            modelId: selectedModelId.isEmpty ? nil : selectedModelId
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
                self.chatErrorBanner = err
                self.finishStreaming(assistantId: assistantId, interrupted: true, errorNote: err)
            }
        }
    }

    func stopStreaming() {
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
                inputTokens: existing.inputTokens,
                outputTokens: existing.outputTokens,
                modelName: existing.modelName,
                interrupted: true,
                isStreaming: false
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
        case .modelRound, .compaction:
            if let text = event.text, !text.isEmpty {
                updateMessage(at: idx, with: copyMessage(cur, statusText: text))
            }
        case .done:
            let finalText = (cur.content.isEmpty ? (event.text ?? "") : cur.content)
            let doneMsg = ChatMessage(
                id: cur.id,
                role: cur.role,
                content: finalText,
                thinking: cur.thinking,
                createdAt: cur.createdAt,
                statusText: nil,
                toolCalls: cur.toolCalls,
                inputTokens: event.inputTokens ?? cur.inputTokens,
                outputTokens: event.outputTokens ?? cur.outputTokens,
                modelName: event.modelName ?? cur.modelName,
                interrupted: false,
                isStreaming: false
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
        activeStreamHandle = nil
        isStreaming = false
        var finalContent = ""
        if let idx = messages.firstIndex(where: { $0.id == assistantId }) {
            let cur = messages[idx]
            let fallbackContent = cur.content.isEmpty && errorNote != nil ? "[\(errorNote!)]" : cur.content
            finalContent = cur.content
            updateMessage(
                at: idx,
                with: copyMessage(
                    cur,
                    content: fallbackContent,
                    statusText: nil,
                    interrupted: cur.interrupted || interrupted,
                    isStreaming: false
                )
            )
        }
        let completion = voiceTurnCompletion
        voiceTurnCompletion = nil
        completion?(finalContent)
        loadSessions()
    }

    private func copyMessage(
        _ m: ChatMessage,
        content: String? = nil,
        thinking: String? = nil,
        statusText: String? = "__KEEP__",
        toolCalls: [ToolCallTrace]? = nil,
        interrupted: Bool? = nil,
        isStreaming: Bool? = nil
    ) -> ChatMessage {
        ChatMessage(
            id: m.id,
            role: m.role,
            content: content ?? m.content,
            thinking: thinking ?? m.thinking,
            createdAt: m.createdAt,
            statusText: statusText == "__KEEP__" ? m.statusText : statusText,
            toolCalls: toolCalls ?? m.toolCalls,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            modelName: m.modelName,
            interrupted: interrupted ?? m.interrupted,
            isStreaming: isStreaming ?? m.isStreaming
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
    }

    func transcribeAndStreamVoiceTurn(
        _ data: Data,
        onRecognized: @escaping (String) -> Void,
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
                self.voiceTurnCompletion = onReplyDone
                onRecognized(text)
                self.sendPrompt(text)
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
                self?.archivedSessions = res.items
            }
        } onError: { _ in }
        activeTaskHandles.append(handle)
    }

    func archiveSession(_ session: AiSessionSummary) {
        let targetId = session.id
        let handle = sdk.archiveSession(token: token, sessionId: targetId) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.sessions.removeAll { $0.id == targetId }
                self.regroupSessions()
                self.loadArchivedSessions()
                if self.currentSessionId == targetId {
                    self.startNewChat()
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.chatErrorBanner = err }
        }
        activeTaskHandles.append(handle)
    }

    func unarchiveSession(_ session: AiSessionSummary) {
        let targetId = session.id
        let handle = sdk.unarchiveSession(token: token, sessionId: targetId) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.archivedSessions.removeAll { $0.id == targetId }
                self.loadSessions()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.chatErrorBanner = err }
        }
        activeTaskHandles.append(handle)
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
