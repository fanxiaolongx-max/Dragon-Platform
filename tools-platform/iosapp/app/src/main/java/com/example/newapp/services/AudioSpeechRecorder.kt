package com.example.newapp.services

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID
import kotlin.math.ln

/**
 * Native MediaRecorder wrapper capturing MPEG-4 AAC (.m4a) audio and real-time
 * normalized amplitude bars for the inline waveform voice composer bar.
 */
class AudioSpeechRecorder(
    private val context: Context,
    private val scope: CoroutineScope
) {
    companion object {
        const val BAR_COUNT = 32
    }

    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var meterJob: Job? = null

    fun start(
        onSamples: (List<Float>, Int) -> Unit,
        onError: (String) -> Unit,
        onLevel: ((Float, Boolean) -> Unit)? = null,
        onSilenceDetected: (() -> Unit)? = null
    ): Boolean {
        cancel()
        val dir = File(context.cacheDir, "audio").apply { mkdirs() }
        val file = File(dir, "dc_voice_${UUID.randomUUID()}.m4a")
        outputFile = file

        return try {
            val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            rec.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(16_000)
                setAudioChannels(1)
                setAudioEncodingBitRate(48_000)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            recorder = rec
            val startedMs = System.currentTimeMillis()
            val ring = MutableList(BAR_COUNT) { 0.14f }
            onSamples(ring.toList(), 0)
            meterJob = scope.launch {
                var tickCount = 0
                var baselineAcc = 0L
                var baselineSamples = 0
                var noiseFloor = 450
                var speechTicks = 0
                var silentTicks = 0
                var hasSpeech = false
                var silenceFired = false

                while (isActive && recorder != null) {
                    tickCount++
                    val amp = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
                    if (tickCount in 3..8) {
                        baselineAcc += amp
                        baselineSamples++
                        if (tickCount == 8 && baselineSamples > 0) {
                            noiseFloor = (baselineAcc / baselineSamples).toInt().coerceIn(220, 1400)
                        }
                    }
                    val normalized = if (amp <= 0) {
                        0.14f
                    } else {
                        val logScaled = (ln((amp + 1).toDouble()) / ln(32768.0)).toFloat()
                        logScaled.coerceIn(0.14f, 1.0f)
                    }
                    if (ring.isNotEmpty()) ring.removeAt(0)
                    ring.add(normalized)
                    val secs = ((System.currentTimeMillis() - startedMs) / 1000L).toInt().coerceAtLeast(0)
                    onSamples(ring.toList(), secs)

                    if (tickCount >= 9) {
                        val speechThreshold = maxOf(1150, (noiseFloor * 2.5).toInt())
                        val silenceThreshold = maxOf(850, (noiseFloor * 1.65).toInt())
                        if (amp >= speechThreshold) {
                            speechTicks++
                            if (speechTicks >= 3) hasSpeech = true
                            silentTicks = 0
                        } else if (hasSpeech && amp < silenceThreshold) {
                            silentTicks++
                        }
                    }

                    val orbLevel = (amp / 14000f).coerceIn(0.12f, 1.0f)
                    onLevel?.invoke(orbLevel, hasSpeech)

                    if (onSilenceDetected != null && !silenceFired) {
                        if ((hasSpeech && silentTicks >= 25) || secs >= 45) {
                            silenceFired = true
                            onSilenceDetected()
                            break
                        }
                    }
                    delay(55L)
                }
            }
            true
        } catch (t: Throwable) {
            cleanupRecorder()
            runCatching { file.delete() }
            outputFile = null
            onError(t.message ?: "Unable to start recording")
            false
        }
    }

    fun stopAndReadBytes(): ByteArray? {
        meterJob?.cancel()
        meterJob = null
        val rec = recorder
        recorder = null
        if (rec != null) {
            runCatching { rec.stop() }
            runCatching { rec.reset() }
            runCatching { rec.release() }
        }
        val file = outputFile
        outputFile = null
        if (file == null || !file.exists()) return null
        return try {
            file.readBytes()
        } catch (_: Throwable) {
            null
        } finally {
            runCatching { file.delete() }
        }
    }

    fun cancel() {
        meterJob?.cancel()
        meterJob = null
        cleanupRecorder()
        outputFile?.let { runCatching { it.delete() } }
        outputFile = null
    }

    private fun cleanupRecorder() {
        val rec = recorder ?: return
        recorder = null
        runCatching { rec.stop() }
        runCatching { rec.reset() }
        runCatching { rec.release() }
    }
}
