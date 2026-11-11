@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package com.example.newapp.shared

import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSData
import platform.posix.memcpy

/** Converts Foundation NSData directly into a Kotlin ByteArray for multipart uploads on iOS. */
fun nsDataToByteArray(data: NSData): ByteArray {
    val length = data.length.toInt()
    if (length <= 0) return ByteArray(0)
    val bytes = ByteArray(length)
    bytes.usePinned { pinned ->
        memcpy(pinned.addressOf(0), data.bytes, data.length)
    }
    return bytes
}
