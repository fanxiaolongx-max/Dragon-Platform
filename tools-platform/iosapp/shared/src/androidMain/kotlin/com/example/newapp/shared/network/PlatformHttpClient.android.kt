package com.example.newapp.shared.network

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.okhttp.OkHttp
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
