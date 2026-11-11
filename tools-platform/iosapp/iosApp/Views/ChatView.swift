import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import shared

struct ChatView: View {
    @Bindable var store: DragonClawStore

    @State private var speechManager = SpeechInputManager()
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false
    @State private var showPlusMenu = false
    @State private var showCameraPicker = false
    @State private var showSkillsSheet = false
    @State private var skillQuery = ""
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
                                renderToken: message.renderKey,
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
        let trimmed = store.composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        let canSend = !trimmed.isEmpty || !store.pendingAttachments.isEmpty

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
                        store.enhanceDraftPrompt()
                    } label: {
                        Group {
                            if store.isEnhancingPrompt {
                                ProgressView().controlSize(.mini)
                            } else {
                                Image(systemName: "wand.and.stars")
                                    .font(.system(size: 12.5, weight: .semibold))
                                    .foregroundStyle(palette.accentStrong)
                            }
                        }
                        .frame(width: 28, height: 28)
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
                        .frame(width: 32, height: 32)
                        .background(palette.chipSurface.opacity(0.65), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr(lang, zh: "更多操作", en: "More actions"))

                Spacer(minLength: 4)

                Menu {
                    Button { store.selectModel("") } label: {
                        Label(L10n.tr(lang, zh: "默认模型", en: "Default Model"), systemImage: store.selectedModelId.isEmpty ? "checkmark" : "cpu")
                    }
                    ForEach(store.models, id: \.id) { m in
                        Button {
                            store.selectModel(m.id)
                        } label: {
                            Label(m.name, systemImage: store.selectedModelId == m.id ? "checkmark" : "cpu")
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(store.activeModelDisplayName)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(palette.inkSecondary)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(palette.inkMuted)
                    }
                    .frame(maxWidth: 132, alignment: .trailing)
                    .padding(.horizontal, 8)
                    .frame(height: 30)
                }
                .buttonStyle(.plain)

                Button {
                    showPlusMenu = false
                    speechManager.startRecording(language: lang)
                } label: {
                    Image(systemName: "mic")
                        .font(.system(size: 15.5, weight: .medium))
                        .foregroundStyle(palette.inkPrimary)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr(lang, zh: "语音输入", en: "Voice input"))

                if store.isStreaming {
                    Button {
                        store.stopStreaming()
                    } label: {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 32)
                            .background(palette.danger, in: Capsule())
                    }
                    .buttonStyle(.plain)
                } else if canSend {
                    Button {
                        showPlusMenu = false
                        store.sendPrompt()
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 32)
                            .background(palette.accentStrong, in: Capsule())
                    }
                    .buttonStyle(.plain)
                } else {
                    Button {
                        showPlusMenu = false
                        speechManager.startRecording(language: lang)
                    } label: {
                        Image(systemName: "waveform")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 32)
                            .background(palette.accentStrong, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr(lang, zh: "快捷语音", en: "Voice Bar"))
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
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
                Image(systemName: "stop.fill")
                    .font(.system(size: 11.5, weight: .bold))
                    .foregroundStyle(palette.inkPrimary)
                    .frame(width: 34, height: 34)
                    .background(palette.chipSurface, in: Circle())
            }
            .buttonStyle(.plain)

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
    @Binding var isThinkingExpanded: Bool
    let palette: DragonClawPalette
    let language: String
    let onRetry: () -> Void

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
