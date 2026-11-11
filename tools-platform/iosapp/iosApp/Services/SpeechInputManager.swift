import AVFoundation
import Foundation
import Observation
import Speech

/// Native iOS SFSpeechRecognizer wrapper for push-to-dictate inside Dragon Claw's Liquid Glass composer.
@Observable
@MainActor
final class SpeechInputManager {
    var isRecording = false
    var errorMessage: String?

    private var audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    func toggleRecording(language: String, onTranscript: @escaping (String) -> Void) {
        if isRecording {
            stopRecording()
            return
        }
        startRecording(language: language, onTranscript: onTranscript)
    }

    func stopRecording() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false
    }

    private func startRecording(language: String, onTranscript: @escaping (String) -> Void) {
        errorMessage = nil
        SFSpeechRecognizer.requestAuthorization { [weak self] authStatus in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard authStatus == .authorized else {
                    self.errorMessage = language == "en"
                        ? "Please allow Speech Recognition in iOS Settings."
                        : "请在系统设置中允许语音识别权限"
                    return
                }
                AVAudioApplication.requestRecordPermission { [weak self] granted in
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        guard granted else {
                            self.errorMessage = language == "en"
                                ? "Microphone permission is required for voice input."
                                : "语音输入需要麦克风权限"
                            return
                        }
                        self.beginSession(language: language, onTranscript: onTranscript)
                    }
                }
            }
        }
    }

    private func beginSession(language: String, onTranscript: @escaping (String) -> Void) {
        stopRecording()
        let localeId = language == "en" ? "en-US" : "zh-CN"
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)), recognizer.isAvailable else {
            errorMessage = language == "en"
                ? "Speech recognizer is unavailable on this device."
                : "当前设备语音识别服务暂不可用"
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            self.recognitionRequest = request

            let inputNode = audioEngine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            inputNode.removeTap(onBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let result {
                        onTranscript(result.bestTranscription.formattedString)
                        if result.isFinal {
                            self.stopRecording()
                        }
                    } else if error != nil {
                        self.stopRecording()
                    }
                }
            }
        } catch {
            errorMessage = error.localizedDescription
            stopRecording()
        }
    }
}
