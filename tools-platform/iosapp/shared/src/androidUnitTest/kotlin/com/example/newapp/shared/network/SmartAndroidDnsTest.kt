package com.example.newapp.shared.network

import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SmartAndroidDnsTest {

    @Test
    fun parseDohIpv4AnswersExtractsTypeARecordsOnly() {
        val sample = """
            {
              "Status": 0,
              "Answer": [
                {"name": "cs.fanxiaolong.uk.", "type": 5, "data": "edge.example.net."},
                {"name": "cs.fanxiaolong.uk.", "type": 1, "data": "172.67.163.242"},
                {"name": "cs.fanxiaolong.uk.", "type": 1, "data": "104.21.49.148"},
                {"name": "cs.fanxiaolong.uk.", "type": 28, "data": "2a06:98c1:3120::6"}
              ]
            }
        """.trimIndent()

        val parsed = SmartAndroidDns.parseDohIpv4Answers("cs.fanxiaolong.uk", sample)
        assertEquals(listOf("172.67.163.242", "104.21.49.148"), parsed.map { it.hostAddress.orEmpty() })
    }

    @Test
    fun mergePrioritizesCleanIpv4OverBlackholedCloudflareEdgeAndIpv6() {
        val doh = listOf(
            InetAddress.getByAddress("cs.fanxiaolong.uk", byteArrayOf(172.toByte(), 67, 163.toByte(), 242.toByte())),
            InetAddress.getByAddress("cs.fanxiaolong.uk", byteArrayOf(104, 21, 49, 148.toByte()))
        )
        val systemBlocked = listOf(
            InetAddress.getByAddress("cs.fanxiaolong.uk", byteArrayOf(188.toByte(), 114, 96, 6)),
            InetAddress.getByAddress("cs.fanxiaolong.uk", byteArrayOf(188.toByte(), 114, 97, 6)),
            InetAddress.getByName("2a06:98c1:3120::6")
        )

        val merged = SmartAndroidDns.mergeAndPrioritizeAddresses(doh, systemBlocked)
        assertEquals(listOf("172.67.163.242", "104.21.49.148"), merged.map { it.hostAddress.orEmpty() })
    }

    @Test
    fun mergePreservesIpv6WhenNoIpv4Exists() {
        val ipv6Only = listOf(InetAddress.getByName("2001:db8::1"))
        val merged = SmartAndroidDns.mergeAndPrioritizeAddresses(emptyList(), ipv6Only)
        assertEquals(listOf("2001:db8:0:0:0:0:0:1"), merged.map { it.hostAddress.orEmpty() })
    }

    @Test
    fun detectsIpLiteralsAndLocalHostsCorrectly() {
        assertTrue(SmartAndroidDns.isIpOrLocalHost("localhost"))
        assertTrue(SmartAndroidDns.isIpOrLocalHost("192.168.100.1"))
        assertTrue(SmartAndroidDns.isIpOrLocalHost("server.local"))
        assertFalse(SmartAndroidDns.isIpOrLocalHost("cs.fanxiaolong.uk"))
    }
}
