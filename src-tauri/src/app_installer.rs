//! Opens only the verified installer selected by the native update downloader.
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "android")]
struct UpdateInstaller(tauri::plugin::PluginHandle<tauri::Wry>);

fn installer_path(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let root = app.path().app_cache_dir().map_err(|_| "无法读取更新缓存目录")?
        .join("updates").canonicalize().map_err(|_| "安装包已被清理，请重新下载")?;
    let metadata = path.symlink_metadata().map_err(|_| "安装包已被清理，请重新下载")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("安装包路径无效，请重新下载".into());
    }
    let path = path.canonicalize().map_err(|_| "无法读取安装包，请重新下载")?;
    let extension = if cfg!(target_os = "macos") { "dmg" } else { "apk" };
    if path.parent() != Some(root.as_path()) || path.extension().and_then(|s| s.to_str()) != Some(extension) {
        return Err("安装包路径无效，请重新下载".into());
    }
    Ok(path)
}

pub async fn open(app: &AppHandle, path: &Path) -> Result<(), String> {
    let path = installer_path(app, path)?;
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_opener::OpenerExt;
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            app.opener().open_path(path.to_string_lossy().into_owned(), None::<&str>)
                .map_err(|_| "无法打开安装包，请重试".to_string())
        }).await.map_err(|_| "无法打开安装包，请重试".to_string())?
    }
    #[cfg(target_os = "android")]
    {
        app.state::<UpdateInstaller>().0
            .run_mobile_plugin_async::<serde_json::Value>("openInstaller", serde_json::json!({ "path": path }))
            .await.map(|_| ()).map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    {
        let _ = path;
        Err("此设备暂不支持打开更新安装包".into())
    }
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("notebook-update-installer")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(UpdateInstaller(_api.register_android_plugin(
                "com.localnotes.notebook", "UpdateInstallerPlugin",
            )?));
            Ok(())
        })
        .build()
}
