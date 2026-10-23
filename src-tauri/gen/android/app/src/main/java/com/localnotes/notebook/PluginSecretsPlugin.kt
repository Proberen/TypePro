package com.localnotes.notebook

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class PluginSecretArgs {
    lateinit var account: String
    var value: String? = null
}

/** Separate from GitHub credentials and excluded from note/plugin synchronization. */
@TauriPlugin
class PluginSecretsPlugin(private val activity: Activity) : Plugin(activity) {
    private val alias = "typepro.plugin.credentials.v1"
    private val prefs get() = activity.getSharedPreferences("typepro_plugin_secure", Activity.MODE_PRIVATE)

    @Synchronized
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build())
            generateKey()
        }
    }

    private fun args(invoke: Invoke): PluginSecretArgs = invoke.parseArgs(PluginSecretArgs::class.java).also {
        require(it.account.matches(Regex("[A-Za-z0-9._-]{1,128}"))) { "Invalid credential account" }
    }

    @Command
    fun saveSecret(invoke: Invoke) {
        try {
            val args = args(invoke)
            val value = requireNotNull(args.value)
            require(value.length <= 16384)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, key())
                updateAAD(args.account.toByteArray(Charsets.UTF_8))
            }
            val bytes = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val payload = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(bytes, Base64.NO_WRAP)
            check(prefs.edit().putString(args.account, payload).commit())
            invoke.resolve(JSObject())
        } catch (_: Exception) {
            invoke.reject("Cannot save plugin credential securely")
        }
    }

    @Command
    fun loadSecret(invoke: Invoke) {
        try {
            val args = args(invoke)
            val payload = prefs.getString(args.account, null)
            val result = JSObject()
            if (payload != null) {
                val parts = payload.split(":", limit = 2)
                require(parts.size == 2)
                val iv = Base64.decode(parts[0], Base64.NO_WRAP)
                require(iv.size == 12)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                    init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
                    updateAAD(args.account.toByteArray(Charsets.UTF_8))
                }
                result.put("value", String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8))
            }
            invoke.resolve(result)
        } catch (_: Exception) {
            invoke.reject("Cannot read plugin credential securely; enter the key again")
        }
    }

    @Command
    fun removeSecret(invoke: Invoke) {
        try {
            check(prefs.edit().remove(args(invoke).account).commit())
            invoke.resolve(JSObject())
        } catch (_: Exception) {
            invoke.reject("Cannot remove plugin credential")
        }
    }
}
