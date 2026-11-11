@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.example.newapp.shared.network

import com.example.newapp.shared.util.DragonClawHelpers
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.darwin.Darwin
import kotlinx.cinterop.ObjCSignatureOverride
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import platform.Foundation.NSData
import platform.Foundation.NSError
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSMutableURLRequest
import platform.Foundation.NSOperationQueue
import platform.Foundation.NSURL
import platform.Foundation.NSURLRequestReloadIgnoringLocalCacheData
import platform.Foundation.NSURLResponse
import platform.Foundation.NSURLSession
import platform.Foundation.NSURLSessionConfiguration
import platform.Foundation.NSURLSessionDataDelegateProtocol
import platform.Foundation.NSURLSessionDataTask
import platform.Foundation.NSURLSessionResponseAllow
import platform.Foundation.NSURLSessionResponseDisposition
import platform.Foundation.NSURLSessionTask
import platform.Foundation.create
import platform.Foundation.setHTTPBody
import platform.Foundation.setHTTPMethod
import platform.Foundation.setValue
import platform.darwin.NSObject
import platform.posix.memcpy

actual fun createPlatformHttpClient(block: HttpClientConfig<*>.() -> Unit): HttpClient = HttpClient(Darwin) {
    engine {
        configureRequest {
            setTimeoutInterval(300.0)
        }
    }
    block()
}

private sealed interface StreamPacket {
    data class Line(val text: String) : StreamPacket
    data class Failure(val error: Throwable) : StreamPacket
    data object Completed : StreamPacket
}

private fun NSData.toKotlinByteArray(): ByteArray {
    val size = length.toInt()
    if (size <= 0) return ByteArray(0)
    val result = ByteArray(size)
    result.usePinned { pinned ->
        memcpy(pinned.addressOf(0), bytes, length)
    }
    return result
}

private class IncrementalNdjsonDelegate(
    private val channel: Channel<StreamPacket>
) : NSObject(), NSURLSessionDataDelegateProtocol {
    private var statusCode: Int = 200
    private var isErrorStatus: Boolean = false
    private var pendingBytes: ByteArray = ByteArray(0)
    private var errorBytes: ByteArray = ByteArray(0)

    @ObjCSignatureOverride
    override fun URLSession(
        session: NSURLSession,
        dataTask: NSURLSessionDataTask,
        didReceiveResponse: NSURLResponse,
        completionHandler: (NSURLSessionResponseDisposition) -> Unit
    ) {
        val http = didReceiveResponse as? NSHTTPURLResponse
        statusCode = http?.statusCode?.toInt() ?: 200
        isErrorStatus = statusCode >= 400
        completionHandler(NSURLSessionResponseAllow)
    }

    @ObjCSignatureOverride
    override fun URLSession(
        session: NSURLSession,
        dataTask: NSURLSessionDataTask,
        didReceiveData: NSData
    ) {
        val chunk = didReceiveData.toKotlinByteArray()
        if (chunk.isEmpty()) return

        if (isErrorStatus) {
            if (errorBytes.size < 32_768) {
                errorBytes += chunk
            }
            return
        }

        val combined = if (pendingBytes.isEmpty()) chunk else pendingBytes + chunk
        var lineStart = 0
        val newlineByte = '\n'.code.toByte()
        for (i in combined.indices) {
            if (combined[i] == newlineByte) {
                val line = combined.decodeToString(lineStart, i).trimEnd('\r')
                if (line.isNotBlank()) {
                    channel.trySend(StreamPacket.Line(line))
                }
                lineStart = i + 1
            }
        }
        pendingBytes = if (lineStart < combined.size) {
            combined.copyOfRange(lineStart, combined.size)
        } else {
            ByteArray(0)
        }
    }

    @ObjCSignatureOverride
    override fun URLSession(
        session: NSURLSession,
        task: NSURLSessionTask,
        didCompleteWithError: NSError?
    ) {
        if (didCompleteWithError != null) {
            channel.trySend(StreamPacket.Failure(IllegalStateException(didCompleteWithError.localizedDescription)))
            channel.close()
            return
        }
        if (isErrorStatus) {
            val raw = runCatching { errorBytes.decodeToString() }.getOrDefault("")
            channel.trySend(
                StreamPacket.Failure(
                    IllegalStateException(DragonClawHelpers.parseErrorMessage(statusCode, raw, "AI request failed"))
                )
            )
            channel.close()
            return
        }
        if (pendingBytes.isNotEmpty()) {
            val tail = pendingBytes.decodeToString().trimEnd('\r')
            if (tail.isNotBlank()) {
                channel.trySend(StreamPacket.Line(tail))
            }
            pendingBytes = ByteArray(0)
        }
        channel.trySend(StreamPacket.Completed)
        channel.close()
    }
}

actual suspend fun streamNdjsonPost(
    client: HttpClient,
    url: String,
    bearerHeader: String,
    jsonBody: String,
    onLine: suspend (String) -> Unit
) {
    val nsUrl = NSURL(string = url)
    val request = NSMutableURLRequest.requestWithURL(nsUrl).apply {
        setHTTPMethod("POST")
        setValue(bearerHeader, forHTTPHeaderField = "Authorization")
        setValue("application/json", forHTTPHeaderField = "Content-Type")
        setValue("application/x-ndjson, text/event-stream, */*", forHTTPHeaderField = "Accept")
        setValue("identity", forHTTPHeaderField = "Accept-Encoding")
        setCachePolicy(NSURLRequestReloadIgnoringLocalCacheData)
        setTimeoutInterval(300.0)
        val bodyBytes = jsonBody.encodeToByteArray()
        if (bodyBytes.isNotEmpty()) {
            val nsData = bodyBytes.usePinned { pinned ->
                NSData.create(bytes = pinned.addressOf(0), length = bodyBytes.size.toULong())
            }
            setHTTPBody(nsData)
        }
    }

    val channel = Channel<StreamPacket>(Channel.UNLIMITED)
    val delegate = IncrementalNdjsonDelegate(channel)
    val queue = NSOperationQueue().apply {
        maxConcurrentOperationCount = 1
    }
    val config = NSURLSessionConfiguration.ephemeralSessionConfiguration().apply {
        timeoutIntervalForRequest = 300.0
        timeoutIntervalForResource = 300.0
        requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData
    }
    val session = NSURLSession.sessionWithConfiguration(config, delegate = delegate, delegateQueue = queue)
    val task = session.dataTaskWithRequest(request)
    task.resume()

    try {
        for (packet in channel) {
            currentCoroutineContext().ensureActive()
            when (packet) {
                is StreamPacket.Line -> onLine(packet.text)
                is StreamPacket.Failure -> throw packet.error
                StreamPacket.Completed -> break
            }
        }
    } catch (ce: CancellationException) {
        task.cancel()
        session.invalidateAndCancel()
        throw ce
    } finally {
        session.finishTasksAndInvalidate()
    }
}
