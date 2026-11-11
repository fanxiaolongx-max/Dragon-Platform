package com.example.newapp.shared

/** Cross-platform persistent preferences and platform clock helpers. */
expect class SettingsManager() {
    fun saveString(key: String, value: String)
    fun getString(key: String, defaultValue: String): String
    fun saveBoolean(key: String, value: Boolean)
    fun getBoolean(key: String, defaultValue: Boolean): Boolean
    fun removeKey(key: String)
    fun getCurrentMonth(): Int
    fun getAppVersion(): String
}

/** Current UTC wall-clock timestamp in milliseconds. */
expect fun currentEpochMillis(): Long
