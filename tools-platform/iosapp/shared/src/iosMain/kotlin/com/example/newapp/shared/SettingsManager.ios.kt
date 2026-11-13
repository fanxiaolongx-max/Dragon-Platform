package com.example.newapp.shared

import platform.Foundation.NSDate
import platform.Foundation.NSUserDefaults
import platform.Foundation.timeIntervalSince1970

actual class SettingsManager actual constructor() {
    private val defaults = NSUserDefaults.standardUserDefaults

    actual fun saveString(key: String, value: String) {
        defaults.setObject(value, forKey = key)
    }

    actual fun getString(key: String, defaultValue: String): String {
        return defaults.stringForKey(key) ?: defaultValue
    }

    actual fun saveBoolean(key: String, value: Boolean) {
        defaults.setBool(value, forKey = key)
    }

    actual fun getBoolean(key: String, defaultValue: Boolean): Boolean {
        return if (defaults.objectForKey(key) == null) defaultValue else defaults.boolForKey(key)
    }

    actual fun removeKey(key: String) {
        defaults.removeObjectForKey(key)
    }

    actual fun getCurrentMonth(): Int {
        val date = NSDate()
        val calendar = platform.Foundation.NSCalendar.currentCalendar
        val components = calendar.components(platform.Foundation.NSCalendarUnitMonth, fromDate = date)
        return components.month.toInt()
    }

    actual fun getAppVersion(): String {
        val bundle = platform.Foundation.NSBundle.mainBundle
        val shortName = (bundle.objectForInfoDictionaryKey("CFBundleShortVersionString") as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: "1.0.614"
        val build = (bundle.objectForInfoDictionaryKey("CFBundleVersion") as? String)?.trim()?.takeIf { it.isNotEmpty() }
        return if (build != null && build != shortName) "$shortName ($build)" else shortName
    }
}

actual fun currentEpochMillis(): Long = (NSDate().timeIntervalSince1970 * 1000.0).toLong()
