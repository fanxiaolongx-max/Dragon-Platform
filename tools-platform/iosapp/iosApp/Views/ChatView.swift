import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import shared

struct ChatView: View {
    @Bindable var store: DragonClawStore

    @State private var speechManager = SpeechInputManager()
    @State private var voiceChat = VoiceChatController()
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false
    @State private var showPlusMenu = false
    @State private var showCameraPicker = false
    @State private var showSkillsSheet = false
    @State private var skillQuery = ""
    @State private var showModelSheet = false
    @State private var modelQuery = ""
    @State private var lastAnchoredSessionGen = -1
    @State private var initialOpenSettled = false
    @State private var isNearBottom = true
    @State private var anchorBeforePrependId: String? = nil
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var lightboxPayload: LightboxPayload? = nil

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private var starterPrompts: [String] {
        DragonClawHelpers.shared.filterStarterPrompts(
            suggestions: store.suggestions,
            language: lang,
            limit: 3
        )
    }

    var body: some View {
        ZStack {
            if store.messages.isEmpty && store.isLoadingSessionMessages {
                ScrollView(showsIndicators: false) {
                    ChatShimmerSkeletonView(palette: palette)
                        .padding(.horizontal, 14)
                        .padding(.top, 20)
                        .padding(.bottom, 20)
                }
            } else if store.messages.isEmpty {
                GeometryReader { geo in
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 0) {
                            Spacer(minLength: 16)
                            heroEmptyState
                            Spacer(minLength: 16)
                        }
                        .padding(.horizontal, 18)
                        .frame(maxWidth: .infinity, minHeight: geo.size.height)
                    }
                    .scrollDismissesKeyboard(.interactively)
                }
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            if store.hasMoreOlderMessages || store.isLoadingOlderMessages {
                                HStack(spacing: 8) {
                                    if store.isLoadingOlderMessages {
                                        ProgressView().controlSize(.small)
                                        Text(L10n.tr(lang, zh: "正在加载更早消息...", en: "Loading earlier messages..."))
                                            .font(.caption)
                                            .foregroundStyle(palette.inkMuted)
                                    } else {
                                        Button {
                                            guard anchorBeforePrependId == nil else { return }
                                            anchorBeforePrependId = store.messages.first?.id
                                            store.loadOlderMessages()
                                        } label: {
                                            Label(
                                                L10n.tr(lang, zh: "加载更早消息", en: "Load earlier messages"),
                                                systemImage: "arrow.up.circle"
                                            )
                                            .font(.caption.weight(.medium))
                                            .foregroundStyle(palette.inkSecondary)
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 6)
                                        }
                                        .buttonStyle(.plain)
                                        .glassEffect(.regular.interactive(), in: Capsule())
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 4)
                                .id("__older_history_sentinel__")
                                .onScrollVisibilityChange(threshold: 0.1) { visible in
                                    guard visible,
                                          initialOpenSettled,
                                          lastAnchoredSessionGen == store.chatOpenScrollGeneration,
                                          anchorBeforePrependId == nil,
                                          store.hasMoreOlderMessages,
                                          !store.isLoadingOlderMessages,
                                          !store.isLoadingSessionMessages else { return }
                                    anchorBeforePrependId = store.messages.first?.id
                                    store.loadOlderMessages()
                                }
                            }

                            ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
                                let isLastMessage = index == store.messages.count - 1
                                let isDesktopActiveTurn = store.activeDesktopSession != nil &&
                                    store.activeDesktopBusy &&
                                    isLastMessage &&
                                    !message.isUser
                                ChatBubbleRow(
                                    message: message,
                                    renderToken: message.renderKey,
                                    token: store.token,
                                    baseUrl: store.baseUrl,
                                    senderLabel: !message.isUser ? store.activeDesktopSession?.providerDisplayName() : nil,
                                    suppressActionFooter: isDesktopActiveTurn,
                                    showTurnWorkingIndicator: isDesktopActiveTurn,
                                    isThinkingExpanded: Binding(
                                        get: { store.expandedThinkingIds.contains(message.id) },
                                        set: { expanded in
                                            if expanded {
                                                store.expandedThinkingIds.insert(message.id)
                                            } else {
                                                store.expandedThinkingIds.remove(message.id)
                                            }
                                        }
                                    ),
                                    palette: palette,
                                    language: lang,
                                    onRetry: { store.retryLastPrompt() },
                                    onOpenLightbox: { items, index in
                                        lightboxPayload = LightboxPayload(
                                            items: items,
                                            initialIndex: index,
                                            token: store.token
                                        )
                                    }
                                )
                                .id(message.id)
                            }

                            Color.clear
                                .frame(height: 1)
                                .id("__chat_bottom_anchor__")
                                .onScrollVisibilityChange(threshold: 0.1) { visible in
                                    isNearBottom = visible
                                }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                    }
                    .defaultScrollAnchor(.bottom)
                    .scrollDismissesKeyboard(.interactively)
                    .onAppear {
                        if !store.messages.isEmpty, lastAnchoredSessionGen != store.chatOpenScrollGeneration {
                            let gen = store.chatOpenScrollGeneration
                            lastAnchoredSessionGen = gen
                            initialOpenSettled = false
                            isNearBottom = true
                            proxy.scrollTo("__chat_bottom_anchor__", anchor: .bottom)
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                                if lastAnchoredSessionGen == gen {
                                    initialOpenSettled = true
                                }
                            }
                        }
                    }
                    .onChange(of: store.chatOpenScrollGeneration) { _, newGen in
                        anchorBeforePrependId = nil
                        lastAnchoredSessionGen = newGen
                        initialOpenSettled = false
                        isNearBottom = true
                        DispatchQueue.main.async {
                            proxy.scrollTo("__chat_bottom_anchor__", anchor: .bottom)
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                                if lastAnchoredSessionGen == newGen {
                                    initialOpenSettled = true
                                }
                            }
                        }
                    }
                    .onChange(of: store.messages.first?.id) { _, _ in
                        if let anchorId = anchorBeforePrependId {
                            DispatchQueue.main.async {
                                proxy.scrollTo(anchorId, anchor: .top)
                                anchorBeforePrependId = nil
                            }
                        }
                    }
                    .onChange(of: store.messages.last?.content) { _, _ in
                        if anchorBeforePrependId == nil,
                           !store.messages.isEmpty,
                           (isNearBottom || store.messages.last?.isUser == true) {
                            withAnimation(.easeOut(duration: 0.16)) {
                                proxy.scrollTo("__chat_bottom_anchor__", anchor: .bottom)
                            }
                        }
                    }
                    .onChange(of: store.messages.last?.id) { _, _ in
                        if anchorBeforePrependId == nil,
                           !store.messages.isEmpty,
                           (isNearBottom || store.messages.last?.isUser == true) {
                            if lastAnchoredSessionGen != store.chatOpenScrollGeneration {
                                lastAnchoredSessionGen = store.chatOpenScrollGeneration
                                proxy.scrollTo("__chat_bottom_anchor__", anchor: .bottom)
                            } else {
                                withAnimation(.easeOut(duration: 0.16)) {
                                    proxy.scrollTo("__chat_bottom_anchor__", anchor: .bottom)
                                }
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay {
            if showPlusMenu {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation(.spring(response: 0.22, dampingFraction: 0.86)) {
                            showPlusMenu = false
                        }
                    }
            }
        }
        .safeAreaInset(edge: .bottom) {
            floatingLiquidComposer
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
                .padding(.top, 4)
        }
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $selectedPhotoItems,
            maxSelectionCount: 5,
            matching: .images
        )
        .onChange(of: selectedPhotoItems) { _, newItems in
            guard !newItems.isEmpty else { return }
            Task {
                var drafts: [UploadAttachmentDraft] = []
                for (index, item) in newItems.enumerated() {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        let name = "image_\(Int(Date().timeIntervalSince1970))_\(index).jpg"
                        drafts.append(
                            UploadAttachmentDraft(
                                fileName: name,
                                mimeType: "image/jpeg",
                                bytes: IosInteropKt.nsDataToByteArray(data: data)
                            )
                        )
                    }
                }
                selectedPhotoItems.removeAll()
                if !drafts.isEmpty {
                    store.uploadAttachments(drafts)
                }
            }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.data, .text, .spreadsheet, .commaSeparatedText, .json, .image],
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result else { return }
            Task {
                var drafts: [UploadAttachmentDraft] = []
                for url in urls.prefix(5) {
                    let accessed = url.startAccessingSecurityScopedResource()
                    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                    if let data = try? Data(contentsOf: url) {
                        drafts.append(
                            UploadAttachmentDraft(
                                fileName: url.lastPathComponent,
                                mimeType: "application/octet-stream",
                                bytes: IosInteropKt.nsDataToByteArray(data: data)
                            )
                        )
                    }
                }
                if !drafts.isEmpty {
                    store.uploadAttachments(drafts)
                }
            }
        }
        .sheet(isPresented: $showCameraPicker) {
            CameraCapturePicker { data in
                let draft = UploadAttachmentDraft(
                    fileName: "camera_\(Int(Date().timeIntervalSince1970)).jpg",
                    mimeType: "image/jpeg",
                    bytes: IosInteropKt.nsDataToByteArray(data: data)
                )
                store.uploadAttachments([draft])
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $showSkillsSheet) {
            skillsPickerSheet
        }
        .sheet(isPresented: $showModelSheet) {
            modelSelectorSheet
        }
        .fullScreenCover(isPresented: $voiceChat.isPresented) {
            VoiceConversationModal(voiceChat: voiceChat, store: store)
        }
        .fullScreenCover(item: $lightboxPayload) { payload in
            ImageLightboxOverlay(payload: payload)
        }
        .onChange(of: speechManager.errorMessage) { _, err in
            if let err, !err.isEmpty {
                store.chatErrorBanner = err
            }
        }
    }

    private var heroEmptyState: some View {
        VStack(spacing: 24) {
            VStack(spacing: 12) {
                Image("DragonClawAvatar")
                    .resizable()
                    .scaledToFill()
                    .frame(width: 72, height: 72)
                    .clipShape(Circle())
                    .padding(6)
                    .glassEffect(.regular, in: .circle)

                Text(L10n.tr(lang, zh: "Dragon Claw，让想法落地", en: "Dragon Claw, from idea to done"))
                    .font(.system(size: 21, weight: .bold, design: .rounded))
                    .foregroundStyle(palette.inkPrimary)
                    .multilineTextAlignment(.center)

                Text(store.identity.localizedSlogan(language: lang))
                    .font(.system(size: 12.5))
                    .foregroundStyle(palette.inkMuted)
                    .multilineTextAlignment(.center)
            }

            if !starterPrompts.isEmpty {
                VStack(alignment: .leading, spacing: 9) {
                    Text(L10n.tr(lang, zh: "快速提问", en: "Suggested Prompts"))
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(palette.inkMuted)
                        .padding(.leading, 4)

                    ForEach(starterPrompts, id: \.self) { prompt in
                        Button {
                            store.sendPrompt(prompt)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "sparkles")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(palette.accentStrong)
                                Text(prompt)
                                    .font(.system(size: 13))
                                    .foregroundStyle(palette.inkPrimary)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                    .multilineTextAlignment(.leading)
                                Spacer()
                                Image(systemName: "arrow.up.right")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(palette.inkMuted)
                            }
                            .padding(.horizontal, 13)
                            .padding(.vertical, 10)
                            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
            }
        }
    }

    private var modelSelectorSheet: some View {
        let desktop = store.activeDesktopSession
        let desktopModels = desktop.flatMap { store.desktopModelsByProvider[$0.provider] } ?? []
        let trimmedQuery = modelQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filteredDesktopModels = desktopModels.filter { item in
            trimmedQuery.isEmpty ||
            item.name.lowercased().contains(trimmedQuery) ||
            item.id.lowercased().contains(trimmedQuery)
        }
        let filteredRegularModels = store.models.filter { item in
            trimmedQuery.isEmpty ||
            item.name.lowercased().contains(trimmedQuery) ||
            item.id.lowercased().contains(trimmedQuery)
        }
        let defaultTitle = desktop != nil
            ? L10n.tr(lang, zh: "默认（沿用客户端）", en: "Default (Agent Client)")
            : L10n.tr(lang, zh: "系统推荐模型", en: "Default Model")
        let defaultSubtitle = desktop != nil
            ? L10n.tr(lang, zh: "跟随桌面端当前激活配置", en: "Follow active desktop client setting")
            : L10n.tr(lang, zh: "由 Dragon Claw 自动挑选可用模型", en: "Let Dragon Claw pick automatically")
        let isDefaultSelected = desktop != nil
            ? store.activeDesktopSelectedModel.isEmpty
            : store.selectedModelId.isEmpty

        return NavigationStack {
            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 13.5))
                        .foregroundStyle(palette.inkMuted)
                    TextField(
                        L10n.tr(lang, zh: "搜索模型...", en: "Search models..."),
                        text: $modelQuery
                    )
                    .font(.subheadline)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    if !modelQuery.isEmpty {
                        Button {
                            modelQuery = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(palette.inkMuted)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .glassEffect(.regular, in: Capsule())
                .padding(.horizontal, 16)

                ScrollView {
                    LazyVStack(spacing: 8) {
                        Button {
                            store.selectActiveModel("")
                            showModelSheet = false
                        } label: {
                            modelSheetOptionRow(
                                title: defaultTitle,
                                subtitle: defaultSubtitle,
                                isSelected: isDefaultSelected
                            )
                        }
                        .buttonStyle(.plain)

                        if let desktop {
                            if store.desktopModelsLoading && desktopModels.isEmpty {
                                HStack(spacing: 8) {
                                    ProgressView().controlSize(.small)
                                    Text(L10n.tr(lang, zh: "正在加载客户端可用模型...", en: "Loading agent models..."))
                                        .font(.caption)
                                        .foregroundStyle(palette.inkMuted)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 20)
                            } else if let err = store.desktopModelsError, !err.isEmpty, desktopModels.isEmpty {
                                VStack(spacing: 8) {
                                    Text(err)
                                        .font(.caption)
                                        .foregroundStyle(palette.danger)
                                        .multilineTextAlignment(.center)
                                    Button {
                                        store.loadDesktopModels(provider: desktop.provider, forceLive: true)
                                    } label: {
                                        Label(
                                            L10n.tr(lang, zh: "重试获取模型", en: "Retry loading"),
                                            systemImage: "arrow.clockwise"
                                        )
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                    }
                                    .buttonStyle(.glass)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                            } else if filteredDesktopModels.isEmpty {
                                Text(
                                    desktopModels.isEmpty
                                        ? L10n.tr(lang, zh: "未检测到额外模型，将使用桌面端默认配置", en: "No additional models detected; agent default will be used")
                                        : L10n.tr(lang, zh: "没有匹配的模型", en: "No matching models")
                                )
                                .font(.caption)
                                .foregroundStyle(palette.inkMuted)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 20)
                            } else {
                                ForEach(filteredDesktopModels, id: \.id) { item in
                                    Button {
                                        store.selectActiveModel(item.id)
                                        showModelSheet = false
                                    } label: {
                                        modelSheetOptionRow(
                                            title: item.name.isEmpty ? item.id : item.name,
                                            subtitle: item.name == item.id || item.name.isEmpty ? nil : item.id,
                                            isSelected: store.activeDesktopSelectedModel == item.id
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        } else {
                            if filteredRegularModels.isEmpty {
                                Text(L10n.tr(lang, zh: "没有匹配的模型", en: "No matching models"))
                                    .font(.caption)
                                    .foregroundStyle(palette.inkMuted)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 20)
                            } else {
                                ForEach(filteredRegularModels, id: \.id) { item in
                                    Button {
                                        store.selectActiveModel(item.id)
                                        showModelSheet = false
                                    } label: {
                                        modelSheetOptionRow(
                                            title: item.name,
                                            subtitle: item.name == item.id ? nil : item.id,
                                            isSelected: store.selectedModelId == item.id
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 20)
                }
            }
            .padding(.top, 10)
            .navigationTitle(
                desktop.map {
                    L10n.tr(
                        lang,
                        zh: "\($0.providerDisplayName()) 模型",
                        en: "\($0.providerDisplayName()) Models"
                    )
                } ?? L10n.tr(lang, zh: "选择模型", en: "Choose Model")
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let desktop {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            store.loadDesktopModels(provider: desktop.provider, forceLive: true)
                        } label: {
                            if store.desktopModelsLoading {
                                ProgressView().controlSize(.small)
                            } else {
                                Image(systemName: "arrow.clockwise")
                            }
                        }
                        .disabled(store.desktopModelsLoading)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.tr(lang, zh: "完成", en: "Done")) {
                        showModelSheet = false
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func modelSheetOptionRow(title: String, subtitle: String?, isSelected: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "cpu")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(isSelected ? palette.accentStrong : palette.inkMuted)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(isSelected ? .semibold : .medium))
                    .foregroundStyle(palette.inkPrimary)
                    .lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(palette.inkMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 6)

            if isSelected {
                Text(L10n.tr(lang, zh: "当前", en: "Active"))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(palette.accentStrong)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(palette.accent.opacity(0.14), in: Capsule())
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(
            isSelected ? .regular.tint(palette.accent.opacity(0.14)) : .regular,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }

    private func modelPickerButton(
        maxWidth: CGFloat?,
        font: Font,
        foreground: Color,
        showCpuIcon: Bool,
        horizontalPadding: CGFloat,
        verticalPadding: CGFloat
    ) -> some View {
        HStack(spacing: showCpuIcon ? 6 : 4) {
            if showCpuIcon {
                Image(systemName: "cpu")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.accentStrong)
            }
            Text(store.activeModelDisplayName)
                .font(font)
                .foregroundStyle(foreground)
                .lineLimit(1)
                .truncationMode(.tail)
                .contentTransition(.identity)
                .fixedSize(horizontal: false, vertical: true)
            Image(systemName: "chevron.down")
                .font(.system(size: showCpuIcon ? 10 : 9, weight: .semibold))
                .foregroundStyle(palette.inkMuted)
        }
        .frame(maxWidth: maxWidth, alignment: maxWidth == nil ? .center : .trailing)
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .transaction { $0.animation = nil }
        .animation(nil, value: store.activeModelDisplayName)
        .overlay {
            Button {
                store.prepareActiveModelPicker()
                modelQuery = ""
                showModelSheet = true
            } label: {
                Rectangle()
                    .fill(Color.clear)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.activeModelDisplayName)
        }
    }

    private var floatingLiquidComposer: some View {
        let trimmed = store.composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasPayload = !trimmed.isEmpty || !store.pendingAttachments.isEmpty
        let canSend = store.activeDesktopSession != nil
            ? (hasPayload && store.activeDesktopCanSend)
            : hasPayload

        return ZStack(alignment: .bottomLeading) {
            if showPlusMenu {
                Color.black.opacity(0.001)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.85)) {
                            showPlusMenu = false
                        }
                    }
            }

            VStack(alignment: .leading, spacing: 8) {
                if let error = store.chatErrorBanner ?? speechManager.errorMessage {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(palette.danger)
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(palette.danger)
                            .lineLimit(2)
                        Spacer()
                        Button {
                            store.chatErrorBanner = nil
                            speechManager.errorMessage = nil
                        } label: {
                            Image(systemName: "xmark")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(palette.inkMuted)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .glassEffect(.regular.tint(palette.danger.opacity(0.12)), in: Capsule())
                }

                if let desktop = store.activeDesktopSession {
                    HStack(spacing: 8) {
                        Text(desktop.providerDisplayName())
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(palette.accentStrong)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(palette.accent.opacity(0.14), in: Capsule())
                        Text(desktop.displayTitle(language: lang))
                            .font(.caption.weight(.medium))
                            .foregroundStyle(palette.inkPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        if store.activeDesktopBusy {
                            ProgressView().controlSize(.mini)
                            Text(L10n.tr(lang, zh: "运行中", en: "Running"))
                                .font(.caption2)
                                .foregroundStyle(palette.accentStrong)
                        } else if !store.activeDesktopCanSend {
                            Text(L10n.tr(lang, zh: "只读", en: "Read-only"))
                                .font(.caption2)
                                .foregroundStyle(palette.inkMuted)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .glassEffect(.regular, in: Capsule())
                }

                if let status = store.chatStatusBanner {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.mini)
                        Text(status)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(palette.accentStrong)
                            .lineLimit(1)
                        Spacer()
                        Button {
                            store.chatStatusBanner = nil
                        } label: {
                            Image(systemName: "xmark")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(palette.inkMuted)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .glassEffect(.regular.tint(palette.accent.opacity(0.12)), in: Capsule())
                }

                if store.activeDesktopSession != nil &&
                    ((store.activeDesktopBusy && store.activeDesktopCanSteer) || !store.desktopQueue.isEmpty) {
                    VStack(alignment: .leading, spacing: 6) {
                        if store.activeDesktopBusy && store.activeDesktopCanSteer {
                            HStack(spacing: 6) {
                                Text(L10n.tr(lang, zh: "运行中追加策略", en: "Busy follow-up mode"))
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(palette.inkSecondary)
                                Spacer()
                                ForEach(
                                    [
                                        ("queue", L10n.tr(lang, zh: "排队", en: "Queue")),
                                        ("steer", L10n.tr(lang, zh: "插队", en: "Steer"))
                                    ],
                                    id: \.0
                                ) { modeKey, label in
                                    let active = store.desktopBusyMode == modeKey
                                    Button {
                                        store.desktopBusyMode = modeKey
                                    } label: {
                                        Text(label)
                                            .font(.caption2.weight(active ? .bold : .medium))
                                            .foregroundStyle(active ? palette.accentStrong : palette.inkMuted)
                                            .padding(.horizontal, 9)
                                            .padding(.vertical, 3.5)
                                            .background(
                                                active ? palette.accent.opacity(0.16) : Color.clear,
                                                in: Capsule()
                                            )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 4)
                        }

                        ForEach(store.desktopQueue, id: \.requestId) { qItem in
                            let badgeText: String = switch qItem.status {
                            case "sending": L10n.tr(lang, zh: "发送中", en: "Sending")
                            case "failed": L10n.tr(lang, zh: "失败", en: "Failed")
                            default: L10n.tr(lang, zh: "排队中", en: "Queued")
                            }
                            let badgeColor: Color = switch qItem.status {
                            case "failed": palette.danger
                            default: palette.accentStrong
                            }

                            HStack(spacing: 8) {
                                Text(badgeText)
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(badgeColor)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2.5)
                                    .background(badgeColor.opacity(0.14), in: Capsule())

                                VStack(alignment: .leading, spacing: 1) {
                                    Text(qItem.text)
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(palette.inkPrimary)
                                        .lineLimit(1)
                                    if !qItem.error.isEmpty {
                                        Text(qItem.error)
                                            .font(.caption2)
                                            .foregroundStyle(palette.danger)
                                            .lineLimit(1)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)

                                Button {
                                    store.cancelQueuedDesktopPrompt(qItem.requestId)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(palette.inkMuted)
                                        .frame(width: 24, height: 24)
                                        .contentShape(Circle())
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .glassEffect(.regular.tint(palette.accent.opacity(0.08)), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                } else if store.activeDesktopSession == nil && !store.regularQueue.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Image(systemName: "text.line.first.and.arrowtriangle.forward")
                                .font(.caption2)
                                .foregroundStyle(palette.accentStrong)
                            Text(
                                L10n.tr(
                                    lang,
                                    zh: "消息队列 (\(store.regularQueue.count)) · 当前回复完成后自动发送",
                                    en: "Queued (\(store.regularQueue.count)) · Auto-sends next"
                                )
                            )
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(palette.inkSecondary)
                            Spacer()
                            if !store.isStreaming {
                                Button {
                                    store.flushRegularQueueIfIdle()
                                } label: {
                                    Text(L10n.tr(lang, zh: "立即发送", en: "Send now"))
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(palette.accentStrong)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 4)

                        ForEach(Array(store.regularQueue.enumerated()), id: \.element.id) { idx, qItem in
                            HStack(spacing: 8) {
                                Text("#\(idx + 1)")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(palette.accentStrong)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2.5)
                                    .background(palette.accent.opacity(0.14), in: Capsule())

                                Text(qItem.displayText)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(palette.inkPrimary)
                                    .lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)

                                Button {
                                    store.cancelQueuedRegularPrompt(qItem.id)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(palette.inkMuted)
                                        .frame(width: 24, height: 24)
                                        .contentShape(Circle())
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .glassEffect(.regular.tint(palette.accent.opacity(0.08)), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                }

                if !store.pendingAttachments.isEmpty || store.isUploadingFiles {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            if store.isUploadingFiles {
                                HStack(spacing: 6) {
                                    ProgressView().controlSize(.mini)
                                    Text(L10n.tr(lang, zh: "上传中...", en: "Uploading..."))
                                        .font(.caption2)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .glassEffect(.regular, in: Capsule())
                            }
                            ForEach(store.pendingAttachments, id: \.path) { file in
                                HStack(spacing: 6) {
                                    Image(systemName: "paperclip")
                                        .font(.caption2)
                                    Text(file.name)
                                        .font(.caption2.weight(.medium))
                                        .lineLimit(1)
                                    Button {
                                        store.removePendingAttachment(file)
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.caption)
                                            .foregroundStyle(palette.inkMuted)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .glassEffect(.regular, in: Capsule())
                            }
                        }
                        .padding(.horizontal, 4)
                    }
                }

                if speechManager.isRecording {
                    inlineVoiceWaveformBar
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                } else {
                    minimalistInputCard(trimmed: trimmed, canSend: canSend)
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                }
            }

            if showPlusMenu {
                plusPopoverMenu
                    .padding(.bottom, 104)
                    .transition(.scale(scale: 0.88, anchor: .bottomLeading).combined(with: .opacity))
                    .zIndex(20)
            }
        }
    }

    private func minimalistInputCard(trimmed: String, canSend: Bool) -> some View {
        VStack(spacing: 10) {
            HStack(alignment: .bottom, spacing: 6) {
                TextField(
                    L10n.tr(lang, zh: "与 \(store.displayPlatformName) 协作", en: "Collaborate with \(store.displayPlatformName)"),
                    text: $store.composerText,
                    axis: .vertical
                )
                .lineLimit(1...5)
                .font(.system(size: 14))
                .foregroundStyle(palette.inkPrimary)
                .padding(.horizontal, 4)
                .padding(.top, 2)

                if !trimmed.isEmpty {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        store.enhanceDraftPrompt()
                    } label: {
                        Group {
                            if store.isEnhancingPrompt {
                                ProgressView().controlSize(.mini)
                            } else {
                                Image(systemName: "wand.and.stars")
                                    .font(.system(size: 13.5, weight: .semibold))
                                    .foregroundStyle(palette.accentStrong)
                            }
                        }
                        .frame(width: 34, height: 34)
                        .background(palette.accent.opacity(0.12), in: Circle())
                        .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isEnhancingPrompt)
                    .accessibilityLabel(L10n.tr(lang, zh: "优化提示词", en: "Enhance prompt"))
                }
            }

            HStack(spacing: 8) {
                Button {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                        showPlusMenu.toggle()
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(palette.inkPrimary)
                        .rotationEffect(.degrees(showPlusMenu ? 45 : 0))
                        .frame(width: 34, height: 34)
                        .background(palette.chipSurface.opacity(0.65), in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr(lang, zh: "更多操作", en: "More actions"))

                Spacer(minLength: 4)

                modelPickerButton(
                    maxWidth: 138,
                    font: .system(size: 12, weight: .medium),
                    foreground: palette.inkSecondary,
                    showCpuIcon: false,
                    horizontalPadding: 8,
                    verticalPadding: 6
                )

                Button {
                    showPlusMenu = false
                    speechManager.startRecording(language: lang)
                } label: {
                    Image(systemName: "mic")
                        .font(.system(size: 15.5, weight: .medium))
                        .foregroundStyle(palette.inkPrimary)
                        .frame(width: 34, height: 34)
                        .background(palette.chipSurface.opacity(0.45), in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr(lang, zh: "语音转文字", en: "Speech to text"))

                if store.isStreaming || canSend {
                    HStack(spacing: 6) {
                        if store.isStreaming {
                            Button {
                                store.stopStreaming()
                            } label: {
                                Image(systemName: "stop.fill")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(width: canSend ? 34 : 38, height: 32)
                                    .background(palette.danger, in: Capsule())
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                        if canSend {
                            Button {
                                showPlusMenu = false
                                store.sendPrompt()
                            } label: {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(width: store.isStreaming ? 34 : 38, height: 32)
                                    .background(palette.accentStrong, in: Capsule())
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(
                                (store.isStreaming || store.activeDesktopBusy)
                                    ? L10n.tr(lang, zh: "加入消息队列", en: "Queue message")
                                    : L10n.tr(lang, zh: "发送", en: "Send")
                            )
                        }
                    }
                } else {
                    Button {
                        showPlusMenu = false
                        if speechManager.isRecording {
                            speechManager.cancelRecording()
                        }
                        voiceChat.startSession(store: store)
                    } label: {
                        Image(systemName: "waveform")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 42, height: 34)
                            .background(palette.accentStrong, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr(lang, zh: "AI 语音对话", en: "AI Voice Conversation"))
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background {
            // Absorb stray taps inside the floating composer so they never pass through to home suggestions or message list.
            Color.black.opacity(0.001)
                .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .onTapGesture {
                    if showPlusMenu {
                        withAnimation(.spring(response: 0.22, dampingFraction: 0.86)) {
                            showPlusMenu = false
                        }
                    }
                }
        }
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var inlineVoiceWaveformBar: some View {
        HStack(spacing: 10) {
            Button {
                speechManager.cancelRecording()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(palette.inkPrimary)
                    .frame(width: 34, height: 34)
                    .background(palette.chipSurface, in: Circle())
            }
            .buttonStyle(.plain)

            HStack(alignment: .center, spacing: 3) {
                ForEach(Array(speechManager.waveformSamples.enumerated()), id: \.offset) { idx, level in
                    Capsule()
                        .fill(idx >= speechManager.waveformSamples.count - 8 ? palette.inkPrimary : palette.inkMuted.opacity(0.62))
                        .frame(width: 2.5, height: max(3, level * 22))
                }
            }
            .frame(maxWidth: .infinity, minHeight: 26, maxHeight: 26)
            .animation(.easeOut(duration: 0.08), value: speechManager.waveformSamples)

            Text(formatSeconds(speechManager.elapsedSeconds))
                .font(.system(size: 11, weight: .medium).monospacedDigit())
                .foregroundStyle(palette.inkMuted)

            Button {
                if let data = speechManager.finishAndReadAudioData() {
                    store.transcribeVoiceAudio(data, sendImmediately: false)
                }
            } label: {
                Image(systemName: "checkmark")
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundStyle(palette.inkPrimary)
                    .frame(width: 34, height: 34)
                    .background(palette.chipSurface, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.tr(lang, zh: "转入输入框", en: "Transcribe to draft"))

            Button {
                if let data = speechManager.finishAndReadAudioData() {
                    store.transcribeVoiceAudio(data, sendImmediately: true)
                }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 34)
                    .background(palette.accentStrong, in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .glassEffect(.regular, in: Capsule())
        .overlay(
            Capsule().stroke(palette.accentStrong.opacity(0.35), lineWidth: 0.8)
        )
    }

    private var plusPopoverMenu: some View {
        VStack(alignment: .leading, spacing: 4) {
            plusMenuItem(
                icon: "camera",
                title: L10n.tr(lang, zh: "相机", en: "Camera")
            ) {
                showPlusMenu = false
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    showCameraPicker = true
                } else {
                    store.chatErrorBanner = L10n.tr(lang, zh: "当前设备无可用相机", en: "Camera unavailable on this device")
                }
            }
            plusMenuItem(
                icon: "photo.on.rectangle",
                title: L10n.tr(lang, zh: "照片", en: "Photos")
            ) {
                showPlusMenu = false
                showPhotoPicker = true
            }
            plusMenuItem(
                icon: "paperclip",
                title: L10n.tr(lang, zh: "文件", en: "Files")
            ) {
                showPlusMenu = false
                showFileImporter = true
            }
            plusMenuItem(
                icon: "at",
                title: L10n.tr(lang, zh: "技能", en: "Skills")
            ) {
                showPlusMenu = false
                store.loadSkills()
                showSkillsSheet = true
            }
            if store.currentSessionId != nil && !store.messages.isEmpty {
                Divider().overlay(palette.hairLine).padding(.horizontal, 10)
                plusMenuItem(
                    icon: "arrow.triangle.2.circlepath",
                    title: L10n.tr(lang, zh: "压缩上下文", en: "Compact")
                ) {
                    showPlusMenu = false
                    store.compactCurrentSession()
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 6)
        .frame(width: 192)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Color.black.opacity(palette.isDark ? 0.42 : 0.14), radius: 20, x: 0, y: 10)
    }

    private func plusMenuItem(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(palette.inkPrimary)
                    .frame(width: 34, height: 34)
                    .background(palette.chipSurface, in: Circle())
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(palette.inkPrimary)
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var skillsPickerSheet: some View {
        let filtered = store.skills.filter { skill in
            let q = skillQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if q.isEmpty { return true }
            return skill.localizedName(language: lang).lowercased().contains(q)
                || skill.localizedDescription(language: lang).lowercased().contains(q)
                || skill.id.lowercased().contains(q)
        }
        return NavigationStack {
            VStack(spacing: 10) {
                TextField(L10n.tr(lang, zh: "搜索平台技能...", en: "Search skills..."), text: $skillQuery)
                    .font(.system(size: 13.5))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                if filtered.isEmpty {
                    Text(L10n.tr(lang, zh: "暂无匹配技能", en: "No matching skills"))
                        .font(.system(size: 13))
                        .foregroundStyle(palette.inkMuted)
                        .padding(.top, 36)
                    Spacer()
                } else {
                    List(filtered, id: \.id) { skill in
                        Button {
                            store.applySkill(skill)
                            showSkillsSheet = false
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text("@\(skill.localizedName(language: lang))")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(palette.inkPrimary)
                                    Spacer()
                                    if skill.builtIn {
                                        Text(L10n.tr(lang, zh: "内置", en: "Built-in"))
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(palette.accentStrong)
                                            .padding(.horizontal, 7)
                                            .padding(.vertical, 2)
                                            .background(palette.accent.opacity(0.12), in: Capsule())
                                    }
                                }
                                let desc = skill.localizedDescription(language: lang)
                                if !desc.isEmpty {
                                    Text(desc)
                                        .font(.system(size: 12))
                                        .foregroundStyle(palette.inkSecondary)
                                        .lineLimit(2)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(L10n.tr(lang, zh: "技能与能力", en: "Skills"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.tr(lang, zh: "关闭", en: "Done")) {
                        showSkillsSheet = false
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func formatSeconds(_ totalSeconds: Int) -> String {
        let mins = totalSeconds / 60
        let secs = totalSeconds % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

private struct CameraCapturePicker: UIViewControllerRepresentable {
    var onCaptured: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: CameraCapturePicker
        init(parent: CameraCapturePicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage,
               let data = image.jpegData(compressionQuality: 0.85) {
                parent.onCaptured(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

private struct ChatBubbleRow: View {
    let message: ChatMessage
    let renderToken: String
    let token: String
    let baseUrl: String
    var senderLabel: String? = nil
    var suppressActionFooter: Bool = false
    var showTurnWorkingIndicator: Bool = false
    @Binding var isThinkingExpanded: Bool
    let palette: DragonClawPalette
    let language: String
    let onRetry: () -> Void
    let onOpenLightbox: ([LightboxImageItem], Int) -> Void

    @State private var copied = false

    private var markdownBlocks: [MdBlock] {
        MarkdownParser.shared.parse(raw: message.content)
    }

    private var inlineMarkdownImages: [LightboxImageItem] {
        markdownBlocks.compactMap { block in
            guard block.kind == .image else { return nil }
            let rawSrc = block.imageUrl
            guard !rawSrc.isEmpty else { return nil }
            let resolved = DragonClawHelpers.shared.resolveImageSourceUrl(baseUrl: baseUrl, rawSrc: rawSrc)
            let finalUrl = resolved.isEmpty ? rawSrc : resolved
            let title = block.imageAlt.isEmpty
                ? DragonClawHelpers.shared.basename(pathOrUrl: rawSrc)
                : block.imageAlt
            return LightboxImageItem(urlString: finalUrl, title: title)
        }
    }

    private var trailingAttachments: [ChatAttachment] {
        guard !message.attachments.isEmpty else { return [] }
        let inlineUrls = Set(inlineMarkdownImages.map { $0.urlString.lowercased() })
        return message.attachments.filter { att in
            guard att.isImage else { return true }
            let resolved = !att.url.isEmpty
                ? att.url
                : DragonClawHelpers.shared.resolveImageSourceUrl(baseUrl: baseUrl, rawSrc: att.path)
            return resolved.isEmpty || !inlineUrls.contains(resolved.lowercased())
        }
    }

    private var allLightboxItems: [LightboxImageItem] {
        var combined: [LightboxImageItem] = []
        var seen = Set<String>()
        for att in message.imageAttachments {
            let resolved = !att.url.isEmpty
                ? att.url
                : DragonClawHelpers.shared.resolveImageSourceUrl(baseUrl: baseUrl, rawSrc: att.path)
            let url = resolved.isEmpty ? att.path : resolved
            if !url.isEmpty && seen.insert(url.lowercased()).inserted {
                combined.append(LightboxImageItem(urlString: url, title: att.displayName))
            }
        }
        for item in inlineMarkdownImages {
            if seen.insert(item.urlString.lowercased()).inserted {
                combined.append(item)
            }
        }
        return combined
    }

    var body: some View {
        if message.isUser {
            HStack {
                Spacer(minLength: 48)
                VStack(alignment: .trailing, spacing: 8) {
                    if !message.attachments.isEmpty {
                        ChatAttachmentGalleryView(
                            attachments: message.attachments,
                            token: token,
                            baseUrl: baseUrl,
                            palette: palette,
                            onOpenLightbox: onOpenLightbox
                        )
                    }

                    if !message.content.isEmpty {
                        Text(message.content)
                            .font(.system(size: 12.5))
                            .lineSpacing(1.5)
                            .foregroundStyle(palette.inkPrimary)
                            .textSelection(.enabled)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .glassEffect(
                                .regular.tint(palette.accent.opacity(palette.isDark ? 0.22 : 0.14)),
                                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                            )
                    }
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image("DragonClawAvatar")
                        .resizable()
                        .scaledToFill()
                        .frame(width: 26, height: 26)
                        .clipShape(Circle())
                    Text(senderLabel.flatMap { $0.isEmpty ? nil : $0 } ?? "Dragon Claw")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(palette.inkPrimary)

                    if let status = message.statusText, !status.isEmpty {
                        HStack(spacing: 5) {
                            ProgressView().controlSize(.mini)
                            Text(status)
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(palette.accentStrong)
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .glassEffect(.regular.tint(palette.accent.opacity(0.10)), in: Capsule())
                    } else if message.isStreaming || showTurnWorkingIndicator {
                        ProgressView().controlSize(.mini)
                    }
                    Spacer()
                }

                if !message.thinking.isEmpty {
                    DisclosureGroup(isExpanded: $isThinkingExpanded) {
                        Text(message.thinking)
                            .font(.system(size: 11.5))
                            .foregroundStyle(palette.inkSecondary)
                            .textSelection(.enabled)
                            .padding(.top, 6)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "brain.head.profile")
                                .font(.system(size: 11.5))
                                .foregroundStyle(palette.accentStrong)
                            Text(L10n.tr(language, zh: "思考过程 (\(message.thinking.count) 字)", en: "Thinking Process"))
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(palette.inkSecondary)
                        }
                    }
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                if !message.toolCalls.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(message.toolCalls, id: \.callId) { trace in
                            HStack(spacing: 8) {
                                if trace.isFinished {
                                    Image(systemName: trace.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                                        .font(.system(size: 11.5))
                                        .foregroundStyle(trace.ok ? palette.accentStrong : palette.danger)
                                } else {
                                    ProgressView().controlSize(.mini)
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(trace.toolName)
                                        .font(.system(size: 11.5, weight: .semibold))
                                        .foregroundStyle(palette.inkPrimary)
                                    let detail = trace.summary.isEmpty ? trace.argsSummary : trace.summary
                                    if !detail.isEmpty {
                                        Text(detail)
                                            .font(.system(size: 10.5))
                                            .foregroundStyle(palette.inkMuted)
                                            .lineLimit(2)
                                    }
                                }
                                Spacer()
                                if let ms = trace.durationMs {
                                    Text("\(ms.int64Value)ms")
                                        .font(.system(size: 10.5).monospacedDigit())
                                        .foregroundStyle(palette.inkMuted)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(palette.elevatedSurface.opacity(0.85), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                }

                if !message.content.isEmpty {
                    MarkdownMessageView(
                        text: message.content,
                        palette: palette,
                        token: token,
                        baseUrl: baseUrl,
                        onTapImage: { src, alt in
                            let items = allLightboxItems
                            if let idx = items.firstIndex(where: { $0.urlString.caseInsensitiveCompare(src) == .orderedSame }) {
                                onOpenLightbox(items, idx)
                            } else {
                                let title = alt.isEmpty ? DragonClawHelpers.shared.basename(pathOrUrl: src) : alt
                                onOpenLightbox([LightboxImageItem(urlString: src, title: title)], 0)
                            }
                        }
                    )
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }

                if !trailingAttachments.isEmpty {
                    ChatAttachmentGalleryView(
                        attachments: trailingAttachments,
                        token: token,
                        baseUrl: baseUrl,
                        palette: palette,
                        onOpenLightbox: onOpenLightbox
                    )
                }

                if !message.isStreaming && !suppressActionFooter {
                    HStack(spacing: 8) {
                        Button {
                            UIPasteboard.general.string = message.content
                            copied = true
                        } label: {
                            Label(
                                copied ? L10n.tr(language, zh: "已复制", en: "Copied") : L10n.tr(language, zh: "复制", en: "Copy"),
                                systemImage: copied ? "checkmark" : "doc.on.doc"
                            )
                            .font(.caption2.weight(.medium))
                        }
                        .buttonStyle(.glass)

                        Button {
                            onRetry()
                        } label: {
                            Label(L10n.tr(language, zh: "重试", en: "Retry"), systemImage: "arrow.clockwise")
                                .font(.caption2.weight(.medium))
                        }
                        .buttonStyle(.glass)

                        Spacer()

                        if let model = message.modelName, !model.isEmpty {
                            Text(model)
                                .font(.caption2)
                                .foregroundStyle(palette.inkMuted)
                        }
                        if let out = message.outputTokens {
                            Text("\(out.intValue) tok")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(palette.inkMuted)
                        }
                    }
                }
            }
            .padding(.trailing, 4)
        }
    }
}

private struct ChatShimmerSkeletonView: View {
    let palette: DragonClawPalette
    @State private var phase: CGFloat = -0.7

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Spacer(minLength: 80)
                skeletonBlock(width: 176, height: 40, radius: 18)
            }

            assistantSkeletonCard(lineWidths: [0.92, 0.78, 0.52])

            HStack {
                Spacer(minLength: 100)
                skeletonBlock(width: 138, height: 38, radius: 18)
            }

            assistantSkeletonCard(lineWidths: [0.88, 0.64])
        }
        .onAppear {
            withAnimation(.linear(duration: 1.25).repeatForever(autoreverses: false)) {
                phase = 1.7
            }
        }
    }

    private func assistantSkeletonCard(lineWidths: [CGFloat]) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(palette.chipSurface)
                .frame(width: 28, height: 28)
                .overlay(shimmerSweep(in: Circle()))

            VStack(alignment: .leading, spacing: 10) {
                skeletonBlock(width: 96, height: 12, radius: 6)

                GeometryReader { geo in
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(Array(lineWidths.enumerated()), id: \.offset) { _, ratio in
                            skeletonBlock(width: max(60, geo.size.width * ratio), height: 14, radius: 7)
                        }
                    }
                }
                .frame(height: CGFloat(lineWidths.count) * 23)
                .padding(14)
                .background(palette.cardSurface.opacity(0.75), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(shimmerSweep(in: RoundedRectangle(cornerRadius: 18, style: .continuous)))

                HStack(spacing: 8) {
                    skeletonBlock(width: 66, height: 26, radius: 13)
                    skeletonBlock(width: 66, height: 26, radius: 13)
                }
            }
        }
    }

    private func skeletonBlock(width: CGFloat, height: CGFloat, radius: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return shape
            .fill(palette.inkMuted.opacity(palette.isDark ? 0.22 : 0.14))
            .frame(width: width, height: height)
            .overlay(shimmerSweep(in: shape))
            .clipShape(shape)
    }

    private func shimmerSweep<S: Shape>(in shape: S) -> some View {
        GeometryReader { geo in
            let w = geo.size.width
            LinearGradient(
                colors: [
                    Color.clear,
                    palette.isDark ? Color.white.opacity(0.24) : Color.white.opacity(0.75),
                    Color.clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .frame(width: max(w * 0.65, 60))
            .offset(x: phase * max(w, 180))
        }
        .clipShape(shape)
        .allowsHitTesting(false)
    }
}

private struct VoiceConversationModal: View {
    @Bindable var voiceChat: VoiceChatController
    @Bindable var store: DragonClawStore

    @State private var pulseRing = false

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private var liveAssistantText: String {
        if let streamingMsg = store.messages.last(where: { !$0.isUser }), !streamingMsg.content.isEmpty,
           voiceChat.phase == .thinking || voiceChat.phase == .speaking {
            let clean = MarkdownParser.shared.toSpeechText(raw: streamingMsg.content)
            return clean.isEmpty ? streamingMsg.content : clean
        }
        return voiceChat.assistantTranscript
    }

    private var statusTitle: String {
        switch voiceChat.phase {
        case .listening:
            return voiceChat.speechRecorder.hasDetectedSpeech
                ? L10n.tr(lang, zh: "正在聆听…", en: "Listening…")
                : L10n.tr(lang, zh: "请开始说话", en: "Speak now")
        case .transcribing:
            return L10n.tr(lang, zh: "正在识别…", en: "Transcribing…")
        case .thinking:
            return L10n.tr(lang, zh: "思考中…", en: "Thinking…")
        case .speaking:
            return L10n.tr(lang, zh: "正在回复…", en: "Speaking…")
        case .paused, .idle:
            return L10n.tr(lang, zh: "已暂停", en: "Paused")
        }
    }

    private var orbScale: CGFloat {
        switch voiceChat.phase {
        case .listening:
            return 0.94 + voiceChat.speechRecorder.audioLevel * 0.34
        case .speaking, .thinking:
            return pulseRing ? 1.12 : 0.96
        case .transcribing:
            return 1.03
        case .paused, .idle:
            return 0.92
        }
    }

    var body: some View {
        ZStack {
            DragonClawBackdrop(palette: palette)

            VStack(spacing: 22) {
                HStack {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(voiceChat.phase == .paused ? palette.inkMuted : palette.accentStrong)
                            .frame(width: 8, height: 8)
                        Text(store.activeModelDisplayName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(palette.inkPrimary)
                            .lineLimit(1)

                        Menu {
                            ForEach(VoicePersonaCatalog.shared.presets, id: \.id) { preset in
                                Button {
                                    store.updateVoicePersona(preset.id)
                                } label: {
                                    if store.selectedVoicePersona == preset.id {
                                        Label(preset.localizedLabel(language: lang), systemImage: "checkmark")
                                    } else {
                                        Text(preset.localizedLabel(language: lang))
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 3) {
                                Text("· \(VoicePersonaCatalog.shared.optionFor(raw: store.selectedVoicePersona).id)")
                                    .font(.caption2.weight(.semibold))
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 8.5, weight: .bold))
                            }
                            .foregroundStyle(palette.accentStrong)
                            .lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .glassEffect(.regular.interactive(), in: Capsule())

                    Spacer()

                    Button {
                        voiceChat.cycleAudioRoute()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: voiceChat.audioRoute.systemIconName(hasExternalOutput: voiceChat.hasExternalAudioOutput))
                                .font(.system(size: 13, weight: .semibold))
                            Text(voiceChat.audioRoute.title(language: lang, hasExternalOutput: voiceChat.hasExternalAudioOutput))
                                .font(.caption.weight(.semibold))
                                .lineLimit(1)
                        }
                        .foregroundStyle(voiceChat.audioRoute == .muted ? palette.inkMuted : palette.accentStrong)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: Capsule())
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)

                Spacer(minLength: 10)

                ZStack {
                    if voiceChat.phase == .listening {
                        VoiceInputHalo(samples: voiceChat.speechRecorder.waveformSamples,
                                       level: voiceChat.speechRecorder.audioLevel,
                                       color: palette.accentStrong)
                            .frame(width: 280, height: 280)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [palette.accent.opacity(0.28), palette.accentStrong.opacity(0.03)],
                                center: .center,
                                startRadius: 18,
                                endRadius: 120
                            )
                        )
                        .frame(width: 220, height: 220)
                        .scaleEffect(orbScale * 1.16)
                        .animation(.easeOut(duration: 0.14), value: voiceChat.speechRecorder.audioLevel)

                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [palette.accentStrong, palette.accent],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 132, height: 132)
                        .scaleEffect(orbScale)
                        .shadow(color: palette.accentStrong.opacity(0.32), radius: 22, y: 10)
                        .overlay {
                            Image("DragonClawAvatar")
                                .resizable()
                                .scaledToFill()
                                .frame(width: 92, height: 92)
                                .clipShape(Circle())
                        }
                        .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulseRing)
                        .animation(.easeOut(duration: 0.055), value: voiceChat.speechRecorder.audioLevel)
                        .onTapGesture {
                            if voiceChat.phase == .speaking || voiceChat.phase == .thinking {
                                voiceChat.interruptAndSpeak()
                            } else if voiceChat.phase == .listening {
                                voiceChat.submitCurrentListeningTurn()
                            } else {
                                voiceChat.togglePause()
                            }
                        }
                }

                VStack(spacing: 6) {
                    Text(statusTitle)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(palette.inkPrimary)

                    if voiceChat.phase == .speaking || voiceChat.phase == .thinking {
                        Text(L10n.tr(lang, zh: "轻触头像可打断", en: "Tap avatar to interrupt"))
                            .font(.caption)
                            .foregroundStyle(palette.inkMuted)
                    }
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if let err = voiceChat.errorText, !err.isEmpty {
                            HStack(spacing: 8) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(palette.danger)
                                Text(err)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(palette.danger)
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(palette.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                        }

                        if !voiceChat.userTranscript.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(L10n.tr(lang, zh: "你", en: "You"))
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(palette.accentStrong)
                                Text(voiceChat.userTranscript)
                                    .font(.subheadline)
                                    .foregroundStyle(palette.inkPrimary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .glassEffect(.regular.tint(palette.accent.opacity(0.10)), in: RoundedRectangle(cornerRadius: 16))
                        }

                        if !liveAssistantText.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Dragon Claw")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(palette.inkMuted)
                                Text(liveAssistantText)
                                    .font(.subheadline)
                                    .foregroundStyle(palette.inkPrimary)
                                    .lineSpacing(3)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16))
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .frame(maxHeight: 220)

                Spacer(minLength: 8)

                HStack(spacing: 24) {
                    Button {
                        voiceChat.togglePause()
                    } label: {
                        Image(systemName: voiceChat.phase == .paused ? "mic.fill" : "pause.fill")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(palette.inkPrimary)
                            .frame(width: 56, height: 56)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)

                    if voiceChat.phase == .listening {
                        Button {
                            voiceChat.submitCurrentListeningTurn()
                        } label: {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 66, height: 66)
                                .background(palette.accentStrong, in: Circle())
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                    } else if voiceChat.phase == .speaking || voiceChat.phase == .thinking {
                        Button {
                            voiceChat.interruptAndSpeak()
                        } label: {
                            Image(systemName: "hand.raised.fill")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 66, height: 66)
                                .background(palette.accentStrong, in: Circle())
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                    } else {
                        ProgressView()
                            .frame(width: 66, height: 66)
                            .glassEffect(.regular, in: .circle)
                    }

                    Button {
                        voiceChat.endSession()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 19, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 56, height: 56)
                            .background(palette.danger, in: Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 28)
            }
        }
        .onAppear {
            pulseRing = true
        }
    }
}

/// A mirrored history of the microphone envelope; silence stays quiet without a timer.
private struct VoiceInputHalo: View {
    let samples: [CGFloat]
    let level: CGFloat
    let color: Color

    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = min(size.width, size.height) * 0.32
            for index in 0..<64 {
                let sampleIndex = index < 32 ? index : 63 - index
                let sample = samples[min(sampleIndex, samples.count - 1)]
                let amplitude = max(0, min(1, (sample - 0.12) / 0.88))
                let current = max(0, min(1, (level - 0.12) / 0.88))
                let angle = Double(index) * .pi * 2 / 64 - .pi / 2
                let length = 3 + amplitude * 26 + current * 12
                var path = Path()
                path.move(to: CGPoint(x: center.x + CGFloat(cos(angle)) * radius,
                                      y: center.y + CGFloat(sin(angle)) * radius))
                path.addLine(to: CGPoint(x: center.x + CGFloat(cos(angle)) * (radius + length),
                                         y: center.y + CGFloat(sin(angle)) * (radius + length)))
                context.stroke(path, with: .color(color.opacity(0.22 + amplitude * 0.55)),
                               style: StrokeStyle(lineWidth: 3, lineCap: .round))
            }
        }
    }
}
