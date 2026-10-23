package com.localnotes.notebook

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class UpdateInstallerArgs {
    lateinit var path: String
}

class UpdateFileProvider : FileProvider()

/** Only the private update cache can be shared with Android's install confirmation UI. */
@TauriPlugin
class UpdateInstallerPlugin(private val activity: Activity) : Plugin(activity) {
    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun sameSigningIdentity(installed: PackageInfo, candidate: PackageInfo): Boolean {
        if (Build.VERSION.SDK_INT < 28) {
            val current = installed.signatures.orEmpty().toSet()
            return current.isNotEmpty() && current == candidate.signatures.orEmpty().toSet()
        }
        val current = installed.signingInfo ?: return false
        val next = candidate.signingInfo ?: return false
        val currentSigners = current.apkContentsSigners.orEmpty().toSet()
        val nextSigners = next.apkContentsSigners.orEmpty().toSet()
        if (currentSigners.isEmpty() || nextSigners.isEmpty()) return false
        if (current.hasMultipleSigners() || next.hasMultipleSigners()) return currentSigners == nextSigners
        // Android verifies the proof of rotation in this history; never accept a rollback to an old signer.
        return currentSigners.size == 1 && next.signingCertificateHistory.orEmpty().contains(currentSigners.single())
    }

    @Suppress("DEPRECATION")
    private fun installer(value: String): File {
        val root = File(activity.cacheDir, "updates").canonicalFile
        val input = File(value)
        val file = input.canonicalFile
        require(file.parentFile == root && input.absoluteFile == file && file.isFile && file.extension == "apk" &&
            file.name.matches(Regex("TypePro-[0-9]+\\.[0-9]+\\.[0-9]+-android\\.apk"))) {
            "安装包路径无效，请重新下载"
        }
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val manager = activity.packageManager
        val candidate = manager.getPackageArchiveInfo(file.path, flags)
            ?: throw IllegalArgumentException("安装包无法解析，请重新下载")
        val installed = manager.getPackageInfo(activity.packageName, flags)
        require(candidate.packageName == activity.packageName) { "安装包与 TypePro 不匹配，请重新下载" }
        require(versionCode(candidate) > versionCode(installed)) { "安装包版本不高于当前版本，请重新检查更新" }
        require(sameSigningIdentity(installed, candidate)) { "安装包签名与当前应用不一致，无法更新" }
        return file
    }

    @Command
    fun openInstaller(invoke: Invoke) {
        Thread({
            try {
                val file = installer(invoke.parseArgs(UpdateInstallerArgs::class.java).path)
                activity.runOnUiThread {
                    try {
                        if (!activity.packageManager.canRequestPackageInstalls()) {
                            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:${activity.packageName}")))
                            invoke.reject("请在系统页面允许 TypePro 安装应用，返回后再次点击「安装更新」")
                        } else {
                            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
                            activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(uri, "application/vnd.android.package-archive")
                                clipData = ClipData.newRawUri("TypePro 更新", uri)
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            })
                            invoke.resolve(JSObject())
                        }
                    } catch (_: Exception) {
                        invoke.reject("无法打开系统安装页面，请在系统设置中允许 TypePro 安装应用后重试")
                    }
                }
            } catch (error: Exception) {
                invoke.reject(error.message ?: "无法读取更新安装包，请重新下载")
            }
        }, "typepro-update-installer").start()
    }
}
