package com.localnotes.notebook

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class TransferArgs {
    lateinit var uri: String
    var base64: String = ""
}

/** Uses only access already granted by Android's system document picker. */
@TauriPlugin
class TransferPlugin(private val activity: Activity) : Plugin(activity) {
    private fun contentUri(value: String): Uri {
        val uri = Uri.parse(value)
        require(uri.scheme == "content" && !uri.authority.isNullOrEmpty()) { "Invalid content URI" }
        return uri
    }

    @Command
    fun writeTransfer(invoke: Invoke) {
        Thread({
            try {
                val args = invoke.parseArgs(TransferArgs::class.java)
                require(args.base64.length <= 180_000_000) { "File exceeds transfer limit" }
                val data = Base64.decode(args.base64, Base64.DEFAULT)
                require(data.size <= 128 * 1024 * 1024) { "File exceeds transfer limit" }
                // Keep the provider-owned descriptor alive until all bytes are written and flushed.
                activity.contentResolver.openOutputStream(contentUri(args.uri), "wt")?.use { output ->
                    output.write(data)
                    output.flush()
                } ?: throw IllegalStateException("Cannot open destination")
                invoke.resolve(JSObject())
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Cannot export file")
            }
        }, "notebook-export").start()
    }

    @Command
    fun getName(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(TransferArgs::class.java)
            val uri = contentUri(args.uri)
            var name = "导入文档.md"
            activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (column >= 0) name = cursor.getString(column) ?: name
                }
            }
            val result = JSObject()
            result.put("name", name)
            invoke.resolve(result)
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Cannot read file name")
        }
    }
}
