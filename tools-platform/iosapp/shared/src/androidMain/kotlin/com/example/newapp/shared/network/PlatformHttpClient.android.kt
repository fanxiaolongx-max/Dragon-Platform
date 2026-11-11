package com.example.newapp.shared.network

import com.example.newapp.shared.util.DragonClawHelpers
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.timeout
import io.ktor.client.request.header
import io.ktor.client.request.preparePost
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.Dns
import java.net.InetAddress

actual fun createPlatformHttpClient(block: HttpClientConfig<*>.() -> Unit): HttpClient = HttpClient(OkHttp) {
    engine {
        config {
            connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
            dns(object : Dns {
                override fun lookup(hostname: String): List<InetAddress> {
                    val list = Dns.SYSTEM.lookup(hostname)
                    if (hostname.contains("fanxiaolong.uk")) {
                        // Prioritize responsive Anycast IP ranges (172.67.x.x, 104.21.x.x) over 188.114.x.x
                        return list.sortedBy { address ->
                            val ip = address.hostAddress ?: ""
                            if (ip.startsWith("188.114.")) 1 else 0
                        }
                    }
                    return list
                }
            })
        }
    }
    block()
}

actual suspend fun streamNdjsonPost(
    client: HttpClient,
    url: String,
    bearerHeader: String,
    jsonBody: String,
    onLine: suspend (String) -> Unit
) {
    client.preparePost(url) {
        header("Authorization", bearerHeader)
        header("Accept", "application/x-ndjson, text/event-stream, */*")
        contentType(ContentType.Application.Json)
        setBody(jsonBody)
        timeout {
            requestTimeoutMillis = 300_000L
            socketTimeoutMillis = 300_000L
        }
    }.execute { response ->
        if (!response.status.isSuccess()) {
            val raw = runCatching { response.bodyAsText() }.getOrDefault("")
            throw IllegalStateException(DragonClawHelpers.parseErrorMessage(response.status.value, raw, "AI request failed"))
        }
        val channel: ByteReadChannel = response.bodyAsChannel()
        while (!channel.isClosedForRead) {
            currentCoroutineContext().ensureActive()
            val line = channel.readUTF8Line() ?: break
            if (line.isNotBlank()) {
                onLine(line)
            }
        }
    }
}
