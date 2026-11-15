@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.example.newapp.shared

import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryRef
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSDate
import platform.Foundation.NSMutableDictionary
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData
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

    actual fun saveSecret(key: String, value: String) {
        IosKeychain.delete(key)
        if (IosKeychain.save(key, value)) {
            defaults.removeObjectForKey(key)
        }
    }

    actual fun getSecret(key: String): String {
        IosKeychain.read(key)?.let { return it }
        // One-time migration of values written in plaintext by older builds.
        val legacy = defaults.stringForKey(key) ?: return ""
        if (legacy.isNotEmpty() && IosKeychain.save(key, legacy)) {
            defaults.removeObjectForKey(key)
        }
        return legacy
    }

    actual fun removeSecret(key: String) {
        IosKeychain.delete(key)
        defaults.removeObjectForKey(key)
    }

    actual fun getAppVersionName(): String =
        (platform.Foundation.NSBundle.mainBundle.objectForInfoDictionaryKey("CFBundleShortVersionString") as? String)
            ?.trim()?.takeIf { it.isNotEmpty() } ?: "0.0.0"

    actual fun getCurrentMonth(): Int {
        val date = NSDate()
        val calendar = platform.Foundation.NSCalendar.currentCalendar
        val components = calendar.components(platform.Foundation.NSCalendarUnitMonth, fromDate = date)
        return components.month.toInt()
    }

    actual fun getAppVersion(): String {
        val bundle = platform.Foundation.NSBundle.mainBundle
        val shortName = (bundle.objectForInfoDictionaryKey("CFBundleShortVersionString") as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: "0.0.0"
        val build = (bundle.objectForInfoDictionaryKey("CFBundleVersion") as? String)?.trim()?.takeIf { it.isNotEmpty() }
        return if (build != null && build != shortName) "$shortName ($build)" else shortName
    }
}

actual fun currentEpochMillis(): Long = (NSDate().timeIntervalSince1970 * 1000.0).toLong()

/** Generic-password Keychain items, readable after first unlock and never synced or backed up off-device. */
private object IosKeychain {
    private const val SERVICE = "com.fanxiaolong.dragonclaw.auth"

    private fun baseQuery(account: String): NSMutableDictionary {
        val query = NSMutableDictionary()
        query.setObject(CFBridgingRelease(kSecClassGenericPassword)!!, forKey = CFBridgingRelease(kSecClass) as NSString)
        query.setObject(SERVICE, forKey = CFBridgingRelease(kSecAttrService) as NSString)
        query.setObject(account, forKey = CFBridgingRelease(kSecAttrAccount) as NSString)
        return query
    }

    private inline fun <T> withCf(dictionary: NSMutableDictionary, block: (CFDictionaryRef?) -> T): T {
        val retained = CFBridgingRetain(dictionary)
        try {
            @Suppress("UNCHECKED_CAST")
            return block(retained as CFDictionaryRef?)
        } finally {
            CFBridgingRelease(retained)
        }
    }

    fun save(account: String, value: String): Boolean {
        @Suppress("CAST_NEVER_SUCCEEDS")
        val data = (value as NSString).dataUsingEncoding(NSUTF8StringEncoding) ?: return false
        val query = baseQuery(account)
        query.setObject(data, forKey = CFBridgingRelease(kSecValueData) as NSString)
        query.setObject(
            CFBridgingRelease(kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)!!,
            forKey = CFBridgingRelease(kSecAttrAccessible) as NSString
        )
        return withCf(query) { SecItemAdd(it, null) == errSecSuccess }
    }

    fun read(account: String): String? {
        val query = baseQuery(account)
        query.setObject(CFBridgingRelease(kCFBooleanTrue)!!, forKey = CFBridgingRelease(kSecReturnData) as NSString)
        query.setObject(CFBridgingRelease(kSecMatchLimitOne)!!, forKey = CFBridgingRelease(kSecMatchLimit) as NSString)
        return memScoped {
            val result = alloc<CFTypeRefVar>()
            val status = withCf(query) { SecItemCopyMatching(it, result.ptr) }
            if (status != errSecSuccess) return@memScoped null
            val data = CFBridgingRelease(result.value) as? NSData ?: return@memScoped null
            NSString.create(data = data, encoding = NSUTF8StringEncoding)?.toString()
        }
    }

    fun delete(account: String) {
        withCf(baseQuery(account)) { SecItemDelete(it) }
    }
}
