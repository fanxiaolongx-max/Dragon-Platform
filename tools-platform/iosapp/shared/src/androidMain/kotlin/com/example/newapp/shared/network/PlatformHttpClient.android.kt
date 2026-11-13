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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URL
import java.net.URLEncoder
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

actual fun createPlatformHttpClient(block: HttpClientConfig<*>.() -> Unit): HttpClient = HttpClient(OkHttp) {
    engine {
        config {
            connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
            dns(SmartAndroidDns)
            addInterceptor { chain ->
                val req = chain.request().newBuilder()
                    .header("X-Client-Platform", "android")
                    .header("X-Client-Version", "1.0.614")
                    .build()
                chain.proceed(req)
            }
        }
    }
    block()
}

internal object SmartAndroidDns : Dns {
    private const val CACHE_TTL_MS = 120_000L
    private const val DOH_TIMEOUT_MS = 4_000

    private data class CachedEntry(val addresses: List<InetAddress>, val expiresAtMs: Long)

    private val cache = ConcurrentHashMap<String, CachedEntry>()
    private val dohEndpoints = listOf(
        "https://8.8.8.8/resolve",
        "https://223.5.5.5/resolve"
    )
    private val ipv4Regex = Regex("""^(\d{1,3}\.){3}\d{1,3}$""")
    private val dnsJson = Json { ignoreUnknownKeys = true }

    override fun lookup(hostname: String): List<InetAddress> {
        val cleanHost = hostname.trim()
        if (cleanHost.isEmpty()) throw UnknownHostException(hostname)
        if (isIpOrLocalHost(cleanHost)) {
            return Dns.SYSTEM.lookup(cleanHost)
        }

        val now = System.currentTimeMillis()
        cache[cleanHost]?.takeIf { it.expiresAtMs > now && it.addresses.isNotEmpty() }?.let {
            return it.addresses
        }

        val systemAddresses = runCatching { Dns.SYSTEM.lookup(cleanHost) }.getOrDefault(emptyList())
        val hasPreferredSystemIpv4 = systemAddresses.any { addr ->
            addr is Inet4Address && !isBlackholedEdgeIp(addr.hostAddress)
        }
        val shouldQueryDoh = cleanHost.endsWith("fanxiaolong.uk", ignoreCase = true) || !hasPreferredSystemIpv4
        val dohAddresses = if (shouldQueryDoh) lookupViaDoh(cleanHost) else emptyList()

        val ordered = mergeAndPrioritizeAddresses(dohAddresses = dohAddresses, systemAddresses = systemAddresses)
        if (ordered.isEmpty()) {
            throw UnknownHostException("Unable to resolve host: $cleanHost")
        }
        cache[cleanHost] = CachedEntry(ordered, now + CACHE_TTL_MS)
        return ordered
    }

    private fun lookupViaDoh(hostname: String): List<InetAddress> {
        val encoded = runCatching { URLEncoder.encode(hostname, "UTF-8") }.getOrDefault(hostname)
        for (endpoint in dohEndpoints) {
            val resolved = runCatching {
                val conn = (URL("$endpoint?name=$encoded&type=A").openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/dns-json")
                    connectTimeout = DOH_TIMEOUT_MS
                    readTimeout = DOH_TIMEOUT_MS
                    useCaches = false
                }
                try {
                    if (conn.responseCode !in 200..299) return@runCatching emptyList()
                    val body = conn.inputStream.bufferedReader().use { it.readText() }
                    parseDohIpv4Answers(hostname, body)
                } finally {
                    conn.disconnect()
                }
            }.getOrDefault(emptyList())
            if (resolved.isNotEmpty()) return resolved
        }
        return emptyList()
    }

    internal fun parseDohIpv4Answers(hostname: String, jsonBody: String): List<InetAddress> {
        val root = dnsJson.parseToJsonElement(jsonBody).jsonObject
        val answers = root["Answer"]?.jsonArray ?: return emptyList()
        val result = mutableListOf<InetAddress>()
        for (item in answers) {
            val obj = item.jsonObject
            val type = obj["type"]?.jsonPrimitive?.intOrNull ?: continue
            if (type != 1) continue
            val data = obj["data"]?.jsonPrimitive?.content?.trim() ?: continue
            val addr = parseIpv4WithHost(hostname, data) ?: continue
            result.add(addr)
        }
        return result
    }

    private fun parseIpv4WithHost(hostname: String, ip: String): InetAddress? {
        if (!ipv4Regex.matches(ip)) return null
        val parts = ip.split('.')
        if (parts.size != 4) return null
        val bytes = ByteArray(4)
        for (i in 0 until 4) {
            val octet = parts[i].toIntOrNull() ?: return null
            if (octet !in 0..255) return null
            bytes[i] = octet.toByte()
        }
        return runCatching { InetAddress.getByAddress(hostname, bytes) }.getOrNull()
    }

    internal fun mergeAndPrioritizeAddresses(
        dohAddresses: List<InetAddress>,
        systemAddresses: List<InetAddress>
    ): List<InetAddress> {
        val seen = LinkedHashSet<String>()
        val deduped = mutableListOf<InetAddress>()
        for (addr in dohAddresses + systemAddresses) {
            val key = addr.hostAddress ?: continue
            if (seen.add(key)) deduped.add(addr)
        }
        val preferredIpv4 = deduped.filter { it is Inet4Address && !isBlackholedEdgeIp(it.hostAddress) }
        if (preferredIpv4.isNotEmpty()) {
            // Avoid hanging OkHttp sequential connects on blocked 188.114.* / unreachable IPv6 when clean IPv4s exist.
            return preferredIpv4
        }
        val fallbackIpv4 = deduped.filterIsInstance<Inet4Address>()
        if (fallbackIpv4.isNotEmpty()) return fallbackIpv4
        return deduped
    }

    internal fun isBlackholedEdgeIp(ip: String?): Boolean =
        ip != null && ip.startsWith("188.114.")

    internal fun isIpOrLocalHost(host: String): Boolean {
        if (host.equals("localhost", ignoreCase = true)) return true
        if (host.contains(':') || ipv4Regex.matches(host)) return true
        if (!host.contains('.')) return true
        val lower = host.lowercase()
        return lower.endsWith(".local") || lower.endsWith(".internal") || lower.endsWith(".lan")
    }
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

object AndroidBinaryHttpClient {
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .dns(SmartAndroidDns)
            .build()
    }

    fun fetchBytes(urlString: String, token: String = "", maxBytes: Int = 24 * 1024 * 1024): ByteArray {
        val requestBuilder = Request.Builder()
            .url(urlString)
            .get()
        if (token.isNotBlank()) {
            requestBuilder.header("Authorization", DragonClawHelpers.normalizeBearerHeader(token))
        }
        client.newCall(requestBuilder.build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("HTTP ${response.code}")
            }
            val body = response.body ?: throw IllegalStateException("Empty response body")
            val contentLength = body.contentLength()
            if (contentLength > maxBytes) {
                throw IllegalStateException("Image exceeds ${maxBytes / (1024 * 1024)}MB limit")
            }
            return body.byteStream().use { input ->
                val buffer = ByteArrayOutputStream()
                val chunk = ByteArray(16_384)
                while (true) {
                    val read = input.read(chunk)
                    if (read <= 0) break
                    buffer.write(chunk, 0, read)
                    if (buffer.size() > maxBytes) {
                        throw IllegalStateException("Image exceeds ${maxBytes / (1024 * 1024)}MB limit")
                    }
                }
                buffer.toByteArray()
            }
        }
    }
}
