@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.example.newapp.shared

import platform.Foundation.NSCachesDirectory
import platform.Foundation.NSFileManager
import platform.Foundation.NSString
import platform.Foundation.NSTemporaryDirectory
import platform.Foundation.NSSearchPathForDirectoriesInDomains
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.NSUserDomainMask
import platform.Foundation.create
import platform.Foundation.stringWithContentsOfFile
import platform.Foundation.writeToFile

actual class PlatformConversationDiskStore actual constructor() : TextCacheStorage {
    private val fileManager = NSFileManager.defaultManager

    private val cacheDirPath: String by lazy {
        val caches = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, true)
            .firstOrNull() as? String
        val base = caches?.takeIf { it.isNotBlank() } ?: NSTemporaryDirectory()
        val dir = "${base.trimEnd('/')}/dragonclaw_conv_cache_v1"
        fileManager.createDirectoryAtPath(dir, withIntermediateDirectories = true, attributes = null, error = null)
        dir
    }

    private fun safeFileName(key: String): String {
        val sb = StringBuilder(key.length.coerceAtMost(96))
        for (ch in key) {
            if (sb.length >= 96) break
            sb.append(
                if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch == '_' || ch == '-') ch
                else '_'
            )
        }
        val clean = sb.toString().ifEmpty { "entry" }
        return "$cacheDirPath/$clean.json"
    }

    override fun readText(key: String): String? {
        val path = safeFileName(key)
        if (!fileManager.fileExistsAtPath(path)) return null
        return runCatching {
            NSString.stringWithContentsOfFile(path, encoding = NSUTF8StringEncoding, error = null)
        }.getOrNull()
    }

    override fun writeText(key: String, value: String) {
        runCatching {
            fileManager.createDirectoryAtPath(
                cacheDirPath,
                withIntermediateDirectories = true,
                attributes = null,
                error = null
            )
            val path = safeFileName(key)
            @Suppress("CAST_NEVER_SUCCEEDS")
            (value as NSString).writeToFile(
                path,
                atomically = true,
                encoding = NSUTF8StringEncoding,
                error = null
            )
        }
    }

    override fun remove(key: String) {
        val path = safeFileName(key)
        if (fileManager.fileExistsAtPath(path)) {
            runCatching { fileManager.removeItemAtPath(path, error = null) }
        }
    }

    override fun clearAll() {
        runCatching {
            if (fileManager.fileExistsAtPath(cacheDirPath)) {
                fileManager.removeItemAtPath(cacheDirPath, error = null)
            }
            fileManager.createDirectoryAtPath(
                cacheDirPath,
                withIntermediateDirectories = true,
                attributes = null,
                error = null
            )
        }
    }
}
