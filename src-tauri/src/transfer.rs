use tauri::WebviewWindow;

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
pub struct Transfer(pub PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteArgs {
    uri: String,
    base64: String,
}
#[cfg(target_os = "android")]
#[derive(Serialize)]
struct NameArgs {
    uri: String,
}
#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct NameResult {
    name: String,
}

fn check(window: &WebviewWindow, uri: &str) -> Result<(), String> {
    if window.label() != "main" || !uri.starts_with("content://") || uri.len() > 8192 {
        return Err("仅支持系统选择器授权的 Android 文件".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn write_transfer_uri(
    window: WebviewWindow,
    uri: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    check(&window, &uri)?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err("文件不能超过 128 MB".into());
    }
    #[cfg(target_os = "android")]
    {
        use base64::Engine;
        window
            .state::<Transfer>()
            .0
            .run_mobile_plugin::<serde_json::Value>(
                "writeTransfer",
                WriteArgs {
                    uri,
                    base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                },
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    Err("此接口仅用于 Android 文件导出".into())
}

#[tauri::command]
pub async fn get_transfer_name(window: WebviewWindow, uri: String) -> Result<String, String> {
    check(&window, &uri)?;
    #[cfg(target_os = "android")]
    {
        let result = window
            .state::<Transfer>()
            .0
            .run_mobile_plugin::<NameResult>("getName", NameArgs { uri })
            .map_err(|e| e.to_string())?;
        Ok(result.name)
    }
    #[cfg(not(target_os = "android"))]
    Err("此接口仅用于 Android 文件导入".into())
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("notebook-transfer")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(Transfer(_api.register_android_plugin(
                "com.localnotes.notebook",
                "TransferPlugin",
            )?));
            Ok(())
        })
        .build()
}
