import AVFoundation
import Foundation
import Observation
import shared

/// Native AVAudioRecorder with live metering + optional auto-silence VAD for both
/// inline speech-to-text dictation and live hands-free AI voice conversation.
@Observable
@MainActor
final class SpeechInputManager {
    static let barCount = 32

    var isRecording = false
    var isTranscribing = false
    var elapsedSeconds: Int = 0
    var waveformSamples: [CGFloat] = Array(repeating: 0.14, count: barCount)
    var audioLevel: CGFloat = 0.14
    var hasDetectedSpeech = false
    var errorMessage: String?
    var preferSpeakerOutput = true
    var shouldDeactivateSessionOnStop = true

    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var meterTask: Task<Void, Never>?
    private var startDate: Date?
    private var onSilenceDetected: (() -> Void)?
    private var onStartFailed: ((String) -> Void)?
    private var silenceCallbackFired = false

    func startRecording(
        language: String,
        onSilenceDetected: (() -> Void)? = nil,
        onStartFailed: ((String) -> Void)? = nil
    ) {
        if isRecording || isTranscribing { return }
        errorMessage = nil
        self.onSilenceDetected = onSilenceDetected
        self.onStartFailed = onStartFailed
        self.silenceCallbackFired = false
        self.hasDetectedSpeech = false

        AVAudioApplication.requestRecordPermission { [weak self] granted in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard granted else {
                    let msg = language == "en"
                        ? "Microphone permission is required for voice input."
                        : "语音输入需要麦克风权限，请在系统设置中开启"
                    self.errorMessage = msg
                    self.onStartFailed?(msg)
                    return
                }
                self.beginRecorder(language: language)
            }
        }
    }

    func cancelRecording() {
        onSilenceDetected = nil
        silenceCallbackFired = false
        hasDetectedSpeech = false
        stopMetering()
        recorder?.stop()
        recorder = nil
        deactivateSession()
        cleanupFile()
        isRecording = false
        elapsedSeconds = 0
        audioLevel = 0.14
        waveformSamples = Array(repeating: 0.14, count: Self.barCount)
    }

    func finishAndReadAudioData() -> Data? {
        onSilenceDetected = nil
        silenceCallbackFired = false
        hasDetectedSpeech = false
        stopMetering()
        recorder?.stop()
        recorder = nil
        deactivateSession()
        isRecording = false
        audioLevel = 0.14
        let url = recordingURL
        recordingURL = nil
        guard let url else { return nil }
        defer { try? FileManager.default.removeItem(at: url) }
        return try? Data(contentsOf: url)
    }

    private func beginRecorder(language: String) {
        let pendingSilence = onSilenceDetected
        let pendingFail = onStartFailed
        cancelRecording()
        onSilenceDetected = pendingSilence
        onStartFailed = pendingFail

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("dc_voice_\(UUID().uuidString).m4a")
        recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 48_000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
        ]

        do {
            let session = AVAudioSession.sharedInstance()
            let categoryOptions: AVAudioSession.CategoryOptions = preferSpeakerOutput
                ? [.defaultToSpeaker, .allowBluetooth, .duckOthers]
                : [.allowBluetooth]
            try session.setCategory(
                .playAndRecord,
                mode: preferSpeakerOutput ? .default : .voiceChat,
                options: categoryOptions
            )
            try session.overrideOutputAudioPort(preferSpeakerOutput ? .speaker : .none)
            try session.setActive(true)

            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.isMeteringEnabled = true
            guard rec.prepareToRecord(), rec.record() else {
                let msg = language == "en"
                    ? "Unable to start microphone recording."
                    : "无法启动麦克风录音"
                errorMessage = msg
                onStartFailed?(msg)
                cleanupFile()
                return
            }

            recorder = rec
            startDate = Date()
            elapsedSeconds = 0
            audioLevel = 0.14
            waveformSamples = Array(repeating: 0.14, count: Self.barCount)
            isRecording = true
            startMetering()
        } catch {
            cleanupFile()
            let msg = language == "en"
                ? "Audio error: \(error.localizedDescription)"
                : "录音初始化失败：\(error.localizedDescription)"
            errorMessage = msg
            onStartFailed?(msg)
        }
    }

    private func startMetering() {
        meterTask?.cancel()
        meterTask = Task { @MainActor [weak self] in
            var tickCount = 0
            var speechTicks = 0
            var silentTicks = 0

            while let self, self.isRecording, !Task.isCancelled {
                tickCount += 1
                if let rec = self.recorder {
                    rec.updateMeters()
                    let db = rec.averagePower(forChannel: 0)
                    let clamped = max(-52.0, min(0.0, Double(db)))
                    let normalized = CGFloat(pow((clamped + 52.0) / 52.0, 1.45))
                    let level = max(0.12, min(1.0, normalized))
                    self.audioLevel = level

                    var updated = self.waveformSamples
                    if !updated.isEmpty {
                        updated.removeFirst()
                    }
                    updated.append(level)
                    self.waveformSamples = updated

                    // Voice Activity Detection (ignore initial 0.45s mic open transient)
                    if tickCount >= 8, self.onSilenceDetected != nil, !self.silenceCallbackFired {
                        if level >= 0.26 {
                            speechTicks += 1
                            if speechTicks >= 3 {
                                self.hasDetectedSpeech = true
                            }
                            silentTicks = 0
                        } else if self.hasDetectedSpeech && level < 0.19 {
                            silentTicks += 1
                            if silentTicks >= 25 {
                                self.silenceCallbackFired = true
                                self.onSilenceDetected?()
                                break
                            }
                        }
                    }
                }
                if let start = self.startDate {
                    let secs = max(0, Int(Date().timeIntervalSince(start)))
                    self.elapsedSeconds = secs
                    if secs >= 45, self.onSilenceDetected != nil, !self.silenceCallbackFired {
                        self.silenceCallbackFired = true
                        self.onSilenceDetected?()
                        break
                    }
                }
                try? await Task.sleep(nanoseconds: 55_000_000)
            }
        }
    }

    private func stopMetering() {
        meterTask?.cancel()
        meterTask = nil
    }

    private func cleanupFile() {
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
            recordingURL = nil
        }
    }

    private func deactivateSession() {
        guard shouldDeactivateSessionOnStop else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

enum VoiceAudioRoute: String, CaseIterable {
    case speaker
    case earpiece
    case muted

    func next() -> VoiceAudioRoute {
        switch self {
        case .speaker: return .earpiece
        case .earpiece: return .muted
        case .muted: return .speaker
        }
    }

    func title(language: String, hasExternalOutput: Bool) -> String {
        switch self {
        case .speaker:
            return language == "en" ? "Speaker" : "免提"
        case .earpiece:
            if hasExternalOutput {
                return language == "en" ? "Headset" : "耳机"
            }
            return language == "en" ? "Earpiece" : "听筒"
        case .muted:
            return language == "en" ? "Muted" : "静音"
        }
    }

    func systemIconName(hasExternalOutput: Bool) -> String {
        switch self {
        case .speaker: return "speaker.wave.2.fill"
        case .earpiece: return hasExternalOutput ? "headphones" : "phone.arrow.down.left.fill"
        case .muted: return "speaker.slash.fill"
        }
    }
}

enum VoiceChatPhase: Equatable {
    case idle
    case listening
    case transcribing
    case thinking
    case speaking
    case paused
}

/// Manages real-time hands-free AI voice conversation turns (VAD record -> STT -> AI stream -> natural AI voice loop).
@Observable
@MainActor
final class VoiceChatController: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    var isPresented = false
    var phase: VoiceChatPhase = .idle
    var audioRoute: VoiceAudioRoute = .speaker
    var hasExternalAudioOutput = false
    var isSpeechMuted: Bool { audioRoute == .muted }
    var userTranscript = ""
    var assistantTranscript = ""
    var activeVoiceModelLabel = ""
    var errorText: String?

    let speechRecorder = SpeechInputManager()

    private let synthesizer = AVSpeechSynthesizer()
    private var audioPlayer: AVAudioPlayer?
    private var synthesisTaskHandle: TaskHandle?
    private weak var boundStore: DragonClawStore?
    private var resumeListeningTask: Task<Void, Never>?
    private nonisolated(unsafe) var routeObserver: NSObjectProtocol?

    override init() {
        super.init()
        synthesizer.delegate = self
        speechRecorder.shouldDeactivateSessionOnStop = false
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isPresented else { return }
                self.refreshExternalRouteState()
                if self.audioRoute != .muted {
                    self.configureActiveAudioRoute()
                }
            }
        }
    }

    deinit {
        if let observer = routeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    func startSession(store: DragonClawStore) {
        boundStore = store
        isPresented = true
        errorText = nil
        assistantTranscript = ""
        userTranscript = ""
        activeVoiceModelLabel = ""
        audioRoute = .speaker
        speechRecorder.preferSpeakerOutput = true
        refreshExternalRouteState()
        configureActiveAudioRoute()
        store.prepareVoiceConversationSessionIfNeeded()
        beginListeningTurn()
    }

    func endSession() {
        stopPlayback()
        resumeListeningTask?.cancel()
        resumeListeningTask = nil
        speechRecorder.cancelRecording()
        boundStore?.clearVoiceTurnCompletion()
        if boundStore?.isStreaming == true {
            boundStore?.stopStreaming()
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        phase = .idle
        isPresented = false
    }

    func togglePause() {
        resumeListeningTask?.cancel()
        resumeListeningTask = nil
        if phase == .paused {
            beginListeningTurn()
        } else {
            stopPlayback()
            speechRecorder.cancelRecording()
            phase = .paused
        }
    }

    func cycleAudioRoute() {
        let nextRoute = audioRoute.next()
        audioRoute = nextRoute
        speechRecorder.preferSpeakerOutput = (nextRoute == .speaker)
        refreshExternalRouteState()

        if nextRoute == .muted {
            if phase == .speaking {
                stopPlayback()
                scheduleNextListeningTurn()
            } else {
                stopPlayback()
            }
            return
        }

        configureActiveAudioRoute()
    }

    func toggleSpeechMute() {
        cycleAudioRoute()
    }

    func submitCurrentListeningTurn() {
        guard phase == .listening else { return }
        finishListeningAndSend()
    }

    func interruptAndSpeak() {
        stopPlayback()
        resumeListeningTask?.cancel()
        resumeListeningTask = nil
        boundStore?.clearVoiceTurnCompletion()
        if boundStore?.isStreaming == true {
            boundStore?.stopStreaming()
        }
        errorText = nil
        phase = .paused
        resumeListeningTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 140_000_000)
            guard let self, self.isPresented else { return }
            self.beginListeningTurn()
        }
    }

    private func stopPlayback() {
        synthesisTaskHandle?.cancel()
        synthesisTaskHandle = nil
        audioPlayer?.stop()
        audioPlayer = nil
        synthesizer.stopSpeaking(at: .immediate)
    }

    private func beginListeningTurn() {
        guard isPresented, let store = boundStore else { return }
        stopPlayback()
        resumeListeningTask?.cancel()
        errorText = nil
        phase = .listening
        speechRecorder.startRecording(
            language: store.language,
            onSilenceDetected: { [weak self] in
                Task { @MainActor [weak self] in
                    self?.finishListeningAndSend()
                }
            },
            onStartFailed: { [weak self] msg in
                Task { @MainActor [weak self] in
                    guard let self, self.isPresented else { return }
                    self.errorText = msg
                    self.phase = .paused
                }
            }
        )
    }

    private func finishListeningAndSend() {
        guard isPresented, let store = boundStore, phase == .listening else { return }
        guard let data = speechRecorder.finishAndReadAudioData(), data.count > 64 else {
            scheduleRetryListening(message: L10n.tr(store.language, zh: "没有听清，请再说一次", en: "Didn't catch that, listening again..."))
            return
        }

        phase = .transcribing
        errorText = nil
        store.transcribeAndStreamVoiceTurn(
            data,
            onRecognized: { [weak self] spoken in
                guard let self, self.isPresented else { return }
                self.userTranscript = spoken
                self.assistantTranscript = ""
                self.phase = .thinking
            },
            onReplyDone: { [weak self] fullReply in
                guard let self, self.isPresented else { return }
                self.handleReplyCompleted(fullReply)
            },
            onError: { [weak self] msg in
                guard let self, self.isPresented else { return }
                self.scheduleRetryListening(message: msg)
            }
        )
    }

    private func handleReplyCompleted(_ rawReply: String) {
        guard isPresented, let store = boundStore else { return }
        let cleanSpeech = MarkdownParser.shared.toSpeechText(raw: rawReply)
        let speakable = (cleanSpeech.isEmpty ? rawReply : cleanSpeech).trimmingCharacters(in: .whitespacesAndNewlines)
        assistantTranscript = speakable

        if isSpeechMuted || speakable.isEmpty {
            scheduleNextListeningTurn()
            return
        }

        phase = .speaking
        configureActiveAudioRoute()

        let truncatedForVoice = speakable.count > 1200 ? String(speakable.prefix(1200)) : speakable
        synthesisTaskHandle?.cancel()
        synthesisTaskHandle = store.sdk.synthesizeSpeech(
            token: store.token,
            text: truncatedForVoice,
            language: store.language,
            voice: nil
        ) { [weak self] audio in
            Task { @MainActor [weak self] in
                guard let self, self.isPresented, self.phase == .speaking, !self.isSpeechMuted else { return }
                self.synthesisTaskHandle = nil
                self.activeVoiceModelLabel = audio.model
                let nsData = IosInteropKt.byteArrayToNSData(bytes: audio.bytes)
                do {
                    self.configureActiveAudioRoute()
                    let player = try AVAudioPlayer(data: nsData as Data)
                    player.delegate = self
                    player.prepareToPlay()
                    if player.play() {
                        self.audioPlayer = player
                        return
                    }
                } catch {
                    // Fall through to local fallback only if compressed audio decode fails
                }
                self.speakWithSystemFallback(speakable, language: store.language)
            }
        } onError: { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isPresented, self.phase == .speaking, !self.isSpeechMuted else { return }
                self.synthesisTaskHandle = nil
                self.speakWithSystemFallback(speakable, language: store.language)
            }
        }
    }

    private func refreshExternalRouteState() {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        hasExternalAudioOutput = outputs.contains { out in
            switch out.portType {
            case .headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .usbAudio, .carAudio, .airPlay:
                return true
            default:
                return false
            }
        }
    }

    private func configureActiveAudioRoute() {
        guard audioRoute != .muted else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            if audioRoute == .speaker {
                try session.setCategory(
                    .playAndRecord,
                    mode: .default,
                    options: [.defaultToSpeaker, .allowBluetooth, .duckOthers]
                )
                try session.overrideOutputAudioPort(.speaker)
            } else {
                // Earpiece / wired or Bluetooth headset route (exclude defaultToSpeaker so iOS uses headset or receiver)
                try session.setCategory(
                    .playAndRecord,
                    mode: .voiceChat,
                    options: [.allowBluetooth]
                )
                try session.overrideOutputAudioPort(.none)
            }
            try session.setActive(true)
            refreshExternalRouteState()
        } catch {
            // Continue with default playback route if session override is constrained
        }
    }

    private func speakWithSystemFallback(_ text: String, language: String) {
        activeVoiceModelLabel = ""
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: language == "en" ? "en-US" : "zh-CN")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.02
        synthesizer.stopSpeaking(at: .immediate)
        synthesizer.speak(utterance)
    }

    private func scheduleRetryListening(message: String) {
        errorText = message
        phase = .paused
        resumeListeningTask?.cancel()
        resumeListeningTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard let self, self.isPresented, self.phase == .paused else { return }
            self.beginListeningTurn()
        }
    }

    private func scheduleNextListeningTurn() {
        resumeListeningTask?.cancel()
        resumeListeningTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 280_000_000)
            guard let self, self.isPresented, self.phase == .speaking || self.phase == .thinking else { return }
            self.beginListeningTurn()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, self.isPresented, self.phase == .speaking else { return }
            self.audioPlayer = nil
            self.scheduleNextListeningTurn()
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor [weak self] in
            guard let self, self.isPresented, self.phase == .speaking else { return }
            self.audioPlayer = nil
            self.scheduleNextListeningTurn()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, self.isPresented, self.phase == .speaking else { return }
            self.scheduleNextListeningTurn()
        }
    }
}
