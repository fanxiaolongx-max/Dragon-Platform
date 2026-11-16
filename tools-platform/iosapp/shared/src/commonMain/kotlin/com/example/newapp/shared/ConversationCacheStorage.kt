package com.example.newapp.shared

interface TextCacheStorage {
    fun readText(key: String): String?
    fun writeText(key: String, value: String)
    fun remove(key: String)
    fun clearAll()
}

expect class PlatformConversationDiskStore() : TextCacheStorage
