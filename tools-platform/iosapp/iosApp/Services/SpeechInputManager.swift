import AVFoundation
import Foundation
import Observation

/// Native AVAudioRecorder with live metering for Dragon Claw's inline waveform bar
/// and backend `/api/ai/speech` (audio/mp4) transcription.
@Observable
@MainActor
final class SpeechInputManager {
    static let barCount = 32

    var isRecording = false
    var isTranscribing = false
    var elapsedSeconds: Int = 0
    var waveformSamples: [CGFloat] = Array(repeating: 0.14, count: barCount)
    var errorMessage: String?

    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var meterTask: Task<Void, Never>?
    private var startDate: Date?

    func startRecording(language: String) {
        if isRecording || isTranscribing { return }
        errorMessage = nil

        AVAudioApplication.requestRecordPermission { [weak self] granted in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard granted else {
                    self.errorMessage = language == "en"
                        ? "Microphone permission is required for voice input."
                        : "语音输入需要麦克风权限"
                    return
                }
                self.beginRecorder(language: language)
            }
        }
    }

    func cancelRecording() {
        stopMetering()
        recorder?.stop()
        recorder = nil
        deactivateSession()
        cleanupFile()
        isRecording = false
        elapsedSeconds = 0
        waveformSamples = Array(repeating: 0.14, count: Self.barCount)
    }

    func finishAndReadAudioData() -> Data? {
        stopMetering()
        recorder?.stop()
        recorder = nil
        deactivateSession()
        isRecording = false
        let url = recordingURL
        recordingURL = nil
        guard let url else { return nil }
        defer { try? FileManager.default.removeItem(at: url) }
        return try? Data(contentsOf: url)
    }

    private func beginRecorder(language: String) {
        cancelRecording()

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
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)

            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.isMeteringEnabled = true
            guard rec.prepareToRecord(), rec.record() else {
                errorMessage = language == "en"
                    ? "Unable to start microphone recording."
                    : "无法启动麦克风录音"
                cleanupFile()
                return
            }

            recorder = rec
            startDate = Date()
            elapsedSeconds = 0
            waveformSamples = Array(repeating: 0.14, count: Self.barCount)
            isRecording = true
            startMetering()
        } catch {
            cleanupFile()
            errorMessage = language == "en"
                ? "Audio error: \(error.localizedDescription)"
                : "录音初始化失败：\(error.localizedDescription)"
        }
    }

    private func startMetering() {
        meterTask?.cancel()
        meterTask = Task { @MainActor [weak self] in
            while let self, self.isRecording, !Task.isCancelled {
                if let rec = self.recorder {
                    rec.updateMeters()
                    let db = rec.averagePower(forChannel: 0)
                    let clamped = max(-52.0, min(0.0, Double(db)))
                    let normalized = CGFloat(pow((clamped + 52.0) / 52.0, 1.45))
                    var updated = self.waveformSamples
                    if !updated.isEmpty {
                        updated.removeFirst()
                    }
                    updated.append(max(0.12, min(1.0, normalized)))
                    self.waveformSamples = updated
                }
                if let start = self.startDate {
                    self.elapsedSeconds = max(0, Int(Date().timeIntervalSince(start)))
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
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
