package com.example.newapp.shared.network

import java.io.DataInputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore

/** Loopback-only SOCKS tunnel. WebView retains TLS, cookies, redirects, POST and WebSockets.
 * No HTTP contents or credentials are inspected. The listener lives for the app process.
 */
class WebViewDnsProxy internal constructor(
    private val resolve: (String) -> List<InetAddress> = SmartAndroidDns::lookup
) : AutoCloseable {
    private val listener = ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"))
    private val workers = Executors.newCachedThreadPool { r -> Thread(r, "tool-web-network").apply { isDaemon = true } }
    private val permits = Semaphore(32)
    private val sockets = java.util.concurrent.ConcurrentHashMap.newKeySet<Socket>()
    val port: Int get() = listener.localPort

    init {
        workers.execute {
            while (!listener.isClosed) {
                val client = runCatching { listener.accept() }.getOrNull() ?: break
                if (!permits.tryAcquire()) { client.close(); continue }
                sockets.add(client)
                workers.execute {
                    try { client.use { tunnel(it) } } catch (_: Exception) {
                        // Never log URLs, headers or payloads from authenticated tools.
                    } finally { sockets.remove(client); permits.release() }
                }
            }
        }
    }

    private fun tunnel(client: Socket) {
        client.soTimeout = 15_000
        val input = DataInputStream(client.getInputStream())
        val output = client.getOutputStream()
        if (input.readUnsignedByte() != 5) return
        val methods = ByteArray(input.readUnsignedByte()).also { input.readFully(it) }
        if (0.toByte() !in methods) { output.write(byteArrayOf(5, -1)); return }
        output.write(byteArrayOf(5, 0))
        if (input.readUnsignedByte() != 5 || input.readUnsignedByte() != 1 || input.readUnsignedByte() != 0) return
        val host = when (input.readUnsignedByte()) {
            1 -> InetAddress.getByAddress(ByteArray(4).also { input.readFully(it) }).hostAddress!!
            3 -> ByteArray(input.readUnsignedByte()).also { input.readFully(it) }.toString(Charsets.UTF_8)
            4 -> InetAddress.getByAddress(ByteArray(16).also { input.readFully(it) }).hostAddress!!
            else -> return
        }
        val targetPort = input.readUnsignedShort()
        val remote = runCatching { connect(host, targetPort) }.getOrNull()
        if (remote == null) { output.write(byteArrayOf(5, 4, 0, 1, 0, 0, 0, 0, 0, 0)); return }
        sockets.add(remote)
        try {
            remote.use {
                output.write(byteArrayOf(5, 0, 0, 1, 0, 0, 0, 0, 0, 0))
                client.soTimeout = 300_000
                remote.soTimeout = 300_000
                workers.execute {
                    try { input.copyTo(remote.getOutputStream()); remote.shutdownOutput() }
                    catch (_: Exception) { runCatching { remote.close() } }
                }
                try { remote.getInputStream().copyTo(output) }
                finally { runCatching { client.shutdownOutput() } }
            }
        } finally { sockets.remove(remote) }
    }

    private fun connect(host: String, port: Int): Socket {
        for (address in resolve(host)) {
            // The tunnel owns DNS: connect numerically and never re-enter a system proxy.
            // TLS/SNI and certificate validation remain end-to-end in WebView.
            val socket = Socket(java.net.Proxy.NO_PROXY)
            try {
                socket.connect(InetSocketAddress(InetAddress.getByAddress(address.address), port), 5_000)
                return socket
            } catch (_: Exception) { socket.close() }
        }
        throw java.io.IOException("Unable to connect tool host")
    }

    override fun close() {
        listener.close()
        sockets.forEach { runCatching { it.close() } }
        workers.shutdownNow()
    }

    companion object {
        val instance: WebViewDnsProxy by lazy { WebViewDnsProxy() }
    }
}
