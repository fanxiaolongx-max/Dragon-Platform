package com.example.newapp.shared

import java.io.File

actual class PlatformConversationDiskStore actual constructor() : TextCacheStorage {
    private val cacheDir: File by lazy {
        File(AppContext.context.cacheDir, "dragonclaw_conv_cache_v1").apply {
            if (!exists()) mkdirs()
        }
    }

    private fun fileForKey(key: String): File {
        val safe = key.replace(Regex("[^A-Za-z0-9_-]"), "_").take(96).ifEmpty { "entry" }
        return File(cacheDir, "$safe.json")
    }

    override fun readText(key: String): String? = runCatching {
        val file = fileForKey(key)
        if (file.isFile) file.readText(Charsets.UTF_8) else null
    }.getOrNull()

    override fun writeText(key: String, value: String) {
        runCatching {
            val file = fileForKey(key)
            file.parentFile?.let { if (!it.exists()) it.mkdirs() }
            val tmp = File(cacheDir, "${file.name}.tmp")
            tmp.writeText(value, Charsets.UTF_8)
            if (!tmp.renameTo(file)) {
                file.writeText(value, Charsets.UTF_8)
                tmp.delete()
            }
        }
    }

    override fun remove(key: String) {
        runCatching { fileForKey(key).delete() }
    }

    override fun clearAll() {
        runCatching {
            cacheDir.listFiles()?.forEach { it.delete() }
        }
    }
}
