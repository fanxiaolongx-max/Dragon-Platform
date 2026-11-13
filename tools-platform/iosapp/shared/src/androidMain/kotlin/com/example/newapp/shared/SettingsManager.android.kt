package com.example.newapp.shared

import android.content.Context
import android.content.SharedPreferences

object AppContext {
    lateinit var context: Context
}

actual class SettingsManager actual constructor() {
    private val prefs: SharedPreferences by lazy {
        AppContext.context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
    }

    actual fun saveString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    actual fun getString(key: String, defaultValue: String): String {
        return prefs.getString(key, defaultValue) ?: defaultValue
    }

    actual fun saveBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).apply()
    }

    actual fun getBoolean(key: String, defaultValue: Boolean): Boolean {
        return prefs.getBoolean(key, defaultValue)
    }

    actual fun removeKey(key: String) {
        prefs.edit().remove(key).apply()
    }

    actual fun getCurrentMonth(): Int {
        return java.util.Calendar.getInstance().get(java.util.Calendar.MONTH) + 1
    }

    actual fun getAppVersion(): String {
        return try {
            val pInfo = AppContext.context.packageManager.getPackageInfo(AppContext.context.packageName, 0)
            val shortName = (pInfo.versionName ?: "1.0.614").trim()
            val code = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
            if (code > 0L) "$shortName ($code)" else shortName
        } catch (e: Exception) {
            "1.0.614"
        }
    }
}

actual fun currentEpochMillis(): Long = System.currentTimeMillis()
