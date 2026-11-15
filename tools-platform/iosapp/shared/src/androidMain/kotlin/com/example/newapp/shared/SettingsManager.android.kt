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

    actual fun saveSecret(key: String, value: String) {
        val sealed = SecretBox.seal(value)
        if (sealed == null) {
            // Keystore unavailable (rare, broken OEM keystore): never fall back to plaintext on disk.
            prefs.edit().remove(secretKey(key)).apply()
            return
        }
        prefs.edit().putString(secretKey(key), sealed).remove(key).apply()
    }

    actual fun getSecret(key: String): String {
        prefs.getString(secretKey(key), null)?.let { sealed ->
            return SecretBox.open(sealed).orEmpty()
        }
        // One-time migration of values written in plaintext by older builds.
        val legacy = prefs.getString(key, null) ?: return ""
        if (legacy.isNotEmpty()) saveSecret(key, legacy)
        prefs.edit().remove(key).apply()
        return legacy
    }

    actual fun removeSecret(key: String) {
        prefs.edit().remove(secretKey(key)).remove(key).apply()
    }

    private fun secretKey(key: String) = "sec_$key"

    actual fun getAppVersionName(): String = try {
        AppContext.context.packageManager
            .getPackageInfo(AppContext.context.packageName, 0)
            .versionName?.trim().orEmpty().ifEmpty { "0.0.0" }
    } catch (e: Exception) {
        "0.0.0"
    }

    actual fun getCurrentMonth(): Int {
        return java.util.Calendar.getInstance().get(java.util.Calendar.MONTH) + 1
    }

    actual fun getAppVersion(): String {
        return try {
            val pInfo = AppContext.context.packageManager.getPackageInfo(AppContext.context.packageName, 0)
            val shortName = (pInfo.versionName ?: "0.0.0").trim()
            val code = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
            if (code > 0L) "$shortName ($code)" else shortName
        } catch (e: Exception) {
            "0.0.0"
        }
    }
}

actual fun currentEpochMillis(): Long = System.currentTimeMillis()

/** AES-256-GCM with a non-exportable key held in the Android Keystore. */
private object SecretBox {
    private const val KEY_ALIAS = "dragonclaw_secret_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    private fun key(): javax.crypto.SecretKey {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? javax.crypto.SecretKey)?.let { return it }
        val generator = javax.crypto.KeyGenerator.getInstance(
            android.security.keystore.KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        generator.init(
            android.security.keystore.KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                    android.security.keystore.KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    @Synchronized
    fun seal(plain: String): String? = runCatching {
        val cipher = javax.crypto.Cipher.getInstance(TRANSFORMATION)
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key())
        val payload = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        android.util.Base64.encodeToString(payload, android.util.Base64.NO_WRAP)
    }.getOrNull()

    @Synchronized
    fun open(sealed: String): String? = runCatching {
        val payload = android.util.Base64.decode(sealed, android.util.Base64.NO_WRAP)
        val cipher = javax.crypto.Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            javax.crypto.Cipher.DECRYPT_MODE,
            key(),
            javax.crypto.spec.GCMParameterSpec(128, payload, 0, 12)
        )
        String(cipher.doFinal(payload, 12, payload.size - 12), Charsets.UTF_8)
    }.getOrNull()
}
