package com.example.newapp.shared

/** Cross-platform persistent preferences and platform clock helpers. */
expect class SettingsManager() {
    fun saveString(key: String, value: String)
    fun getString(key: String, defaultValue: String): String
    fun saveBoolean(key: String, value: Boolean)
    fun getBoolean(key: String, defaultValue: Boolean): Boolean
    fun removeKey(key: String)

    /** Secrets (token / password) live in Android Keystore-encrypted prefs or the iOS Keychain. */
    fun saveSecret(key: String, value: String)
    fun getSecret(key: String): String
    fun removeSecret(key: String)
    fun getCurrentMonth(): Int
    fun getAppVersion(): String

    /** Bare marketing version (e.g. 1.0.631) for request headers. */
    fun getAppVersionName(): String
}

/** Current UTC wall-clock timestamp in milliseconds. */
expect fun currentEpochMillis(): Long
