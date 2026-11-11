import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import shared

struct ChatView: View {
    @Bindable var store: DragonClawStore

    @State private var speechManager = SpeechInputManager()
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false
    @State private var selectedPhotoItems: [PhotosPickerItem] = []

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    private var starterPrompts: [String] {
        if !store.suggestions.isEmpty {
            return store.suggestions.prefix(6).map(\.question)
        }
        return lang == "en"
            ? [
                "Summarize this month's failing SLA & KPI metrics",
                "Show overdue tickets that need urgent escalation",
                "How do I check the Night Duty Roster and PR audit?"
            ]
            : [
                "总结本月异常 KPI 指标并给出改进建议",
                "排查当前超时与临期 SLA 工单清单",
                "帮我说明月报核算和 PR 稽查怎么操作"
            ]
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if store.messages.isEmpty {
                    heroEmptyState
                        .padding(.horizontal, 18)
                        .padding(.top, 24)
                        .padding(.bottom, 16)
                } else {
                    LazyVStack(spacing: 16) {
                        if store.isLoadingSessionMessages {
                            ProgressView()
                                .padding(.vertical, 24)
                        }

                        ForEach(store.messages, id: \.id) { message in
                            ChatBubbleRow(
                                message: message,
                                palette: palette,
                                language: lang,
                                onRetry: { store.retryLastPrompt() }
                            )
                            .id(message.id)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.messages.last?.content) { _, _ in
                if store.messages.count > 2, let lastId = store.messages.last?.id {
                    withAnimation(.easeOut(duration: 0.16)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
            .onChange(of: store.messages.count) { _, newCount in
                if newCount > 2, let lastId = store.messages.last?.id {
                    withAnimation(.easeOut(duration: 0.16)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
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
    }

    private var heroEmptyState: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 18)

            VStack(spacing: 14) {
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

                modelSelectorPill
            }

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
                                .multilineTextAlignment(.leading)
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(palette.inkMuted)
                        }
                        .padding(.horizontal, 13)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
        }
    }

    private var modelSelectorPill: some View {
        Menu {
            Button {
                store.selectModel("")
            } label: {
                Label(
                    L10n.tr(lang, zh: "系统推荐模型", en: "Default Model"),
                    systemImage: store.selectedModelId.isEmpty ? "checkmark" : "cpu"
                )
            }
            ForEach(store.models, id: \.id) { model in
                Button {
                    store.selectModel(model.id)
                } label: {
                    Label(model.name, systemImage: store.selectedModelId == model.id ? "checkmark" : "cpu")
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "cpu")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.accentStrong)
                Text(store.activeModelDisplayName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.inkPrimary)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(palette.inkMuted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private var floatingLiquidComposer: some View {
        VStack(spacing: 8) {
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

            VStack(spacing: 10) {
                TextField(
                    L10n.tr(lang, zh: "有什么我可以帮你？", en: "How can I help you?"),
                    text: $store.composerText,
                    axis: .vertical
                )
                .lineLimit(1...5)
                .font(.system(size: 13.5))
                .foregroundStyle(palette.inkPrimary)
                .padding(.horizontal, 4)

                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        Menu {
                            Button {
                                showPhotoPicker = true
                            } label: {
                                Label(L10n.tr(lang, zh: "从相册选择图片", en: "Photo Library"), systemImage: "photo.on.rectangle")
                            }
                            Button {
                                showFileImporter = true
                            } label: {
                                Label(L10n.tr(lang, zh: "上传表格或文档", en: "Upload File"), systemImage: "doc.badge.plus")
                            }
                        } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 14, weight: .semibold))
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.glass)

                        Button {
                            store.enhanceDraftPrompt()
                        } label: {
                            HStack(spacing: 4) {
                                if store.isEnhancingPrompt {
                                    ProgressView().controlSize(.mini)
                                } else {
                                    Image(systemName: "wand.and.stars")
                                        .font(.system(size: 11, weight: .semibold))
                                }
                                Text(L10n.tr(lang, zh: "优化", en: "Enhance"))
                                    .font(.system(size: 11.5, weight: .semibold))
                            }
                            .padding(.horizontal, 10)
                            .frame(height: 32)
                        }
                        .buttonStyle(.glass)
                        .disabled(store.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isEnhancingPrompt)

                        Button {
                            speechManager.toggleRecording(language: lang) { transcript in
                                store.composerText = transcript
                            }
                        } label: {
                            Image(systemName: speechManager.isRecording ? "waveform.circle.fill" : "mic")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(speechManager.isRecording ? palette.danger : palette.inkPrimary)
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.glass)

                        Spacer()

                        if !store.messages.isEmpty {
                            Menu {
                                Button { store.selectModel("") } label: {
                                    Text(L10n.tr(lang, zh: "默认模型", en: "Default"))
                                }
                                ForEach(store.models, id: \.id) { m in
                                    Button(m.name) { store.selectModel(m.id) }
                                }
                            } label: {
                                Text(store.activeModelDisplayName)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(palette.inkSecondary)
                                    .lineLimit(1)
                                    .padding(.horizontal, 10)
                                    .frame(height: 30)
                            }
                            .buttonStyle(.glass)
                        }

                        if store.isStreaming {
                            Button {
                                store.stopStreaming()
                            } label: {
                                Image(systemName: "stop.fill")
                                    .font(.system(size: 13, weight: .bold))
                                    .frame(width: 34, height: 34)
                            }
                            .buttonStyle(.glassProminent)
                            .tint(palette.danger)
                        } else {
                            let canSend = !store.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !store.pendingAttachments.isEmpty
                            Button {
                                speechManager.stopRecording()
                                store.sendPrompt()
                            } label: {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 14, weight: .bold))
                                    .frame(width: 34, height: 34)
                            }
                            .buttonStyle(.glassProminent)
                            .tint(canSend ? palette.accentStrong : palette.inkMuted)
                            .disabled(!canSend)
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }
}

private struct ChatBubbleRow: View {
    let message: ChatMessage
    let palette: DragonClawPalette
    let language: String
    let onRetry: () -> Void

    @State private var showThinking = false
    @State private var copied = false

    var body: some View {
        if message.isUser {
            HStack {
                Spacer(minLength: 48)
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
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image("DragonClawAvatar")
                        .resizable()
                        .scaledToFill()
                        .frame(width: 26, height: 26)
                        .clipShape(Circle())
                    Text("Dragon Claw")
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
                    } else if message.isStreaming {
                        ProgressView().controlSize(.mini)
                    }
                    Spacer()
                }

                if !message.thinking.isEmpty {
                    DisclosureGroup(isExpanded: $showThinking) {
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
                    MarkdownMessageView(text: message.content, palette: palette)
                        .padding(12)
                        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }

                if !message.isStreaming {
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
            .padding(.trailing, 18)
        }
    }
}
