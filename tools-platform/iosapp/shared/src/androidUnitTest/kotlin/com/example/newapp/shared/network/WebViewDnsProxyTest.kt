package com.example.newapp.shared.network

import java.io.DataInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertContentEquals

class WebViewDnsProxyTest {
    @Test fun tunnelsThroughResolvedAddressWithoutChangingPayload() {
        val loopback = InetAddress.getByName("127.0.0.1")
        ServerSocket(0, 1, loopback).use { upstream ->
            val echo = thread(isDaemon = true) {
                upstream.accept().use { socket ->
                    val bytes = ByteArray(4)
                    DataInputStream(socket.getInputStream()).readFully(bytes)
                    socket.getOutputStream().write(bytes)
                }
            }
            WebViewDnsProxy { host ->
                assertEquals("unresolvable.invalid", host)
                listOf(InetAddress.getByAddress(host, loopback.address))
            }.use { proxy ->
                Socket("127.0.0.1", proxy.port).use { socket ->
                    socket.soTimeout = 3000
                    val input = DataInputStream(socket.getInputStream())
                    val out = socket.getOutputStream()
                    out.write(byteArrayOf(5, 1, 0))
                    assertEquals(5, input.readUnsignedByte())
                    assertEquals(0, input.readUnsignedByte())
                    val host = "unresolvable.invalid".toByteArray()
                    out.write(byteArrayOf(5, 1, 0, 3, host.size.toByte()))
                    out.write(host)
                    out.write(byteArrayOf((upstream.localPort shr 8).toByte(), upstream.localPort.toByte()))
                    val reply = ByteArray(10).also { input.readFully(it) }
                    assertEquals(0, reply[1].toInt())
                    val payload = byteArrayOf(0, 1, -1, 42)
                    out.write(payload)
                    assertContentEquals(payload, ByteArray(4).also { input.readFully(it) })
                }
            }
            echo.join(3000)
        }
    }
}
