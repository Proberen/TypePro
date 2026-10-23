//! Device-local plugin credentials. Neither the key nor this record enters Workspace.
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Serialize, Deserialize)]
pub struct Credential {
    pub origin: String,
    pub key: String,
}

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.localnotes.notebook.plugins";

#[cfg(target_os = "macos")]
pub fn load(_app: &AppHandle, account: &str) -> Result<Option<Credential>, String> {
    match security_framework::passwords::get_generic_password(SERVICE, account) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "插件凭据记录损坏，请重新配置".into()),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err("无法读取 macOS 钥匙串中的插件凭据".into()),
    }
}

#[cfg(target_os = "macos")]
pub fn save(_app: &AppHandle, account: &str, value: &Credential) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "无法编码插件凭据")?;
    security_framework::passwords::set_generic_password(SERVICE, account, &bytes)
        .map_err(|_| "无法将插件凭据存入 macOS 钥匙串".into())
}

#[cfg(target_os = "macos")]
pub fn remove(_app: &AppHandle, account: &str) -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(SERVICE, account) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err("无法移除 macOS 钥匙串中的插件凭据".into()),
    }
}

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};
#[cfg(target_os = "android")]
struct PluginSecrets(PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
#[derive(Serialize)]
struct SecretArgs<'a> {
    account: &'a str,
    value: Option<String>,
}
#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct SecretResult {
    value: Option<String>,
}

#[cfg(target_os = "android")]
pub fn load(app: &AppHandle, account: &str) -> Result<Option<Credential>, String> {
    let result = app
        .state::<PluginSecrets>()
        .0
        .run_mobile_plugin::<SecretResult>(
            "loadSecret",
            SecretArgs {
                account,
                value: None,
            },
        )
        .map_err(|_| "无法读取 Android 安全存储中的插件凭据")?;
    result
        .value
        .map(|value| {
            serde_json::from_str(&value).map_err(|_| "插件凭据记录损坏，请重新配置".into())
        })
        .transpose()
}

#[cfg(target_os = "android")]
pub fn save(app: &AppHandle, account: &str, value: &Credential) -> Result<(), String> {
    app.state::<PluginSecrets>()
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "saveSecret",
            SecretArgs {
                account,
                value: Some(serde_json::to_string(value).map_err(|_| "无法编码插件凭据")?),
            },
        )
        .map_err(|_| "无法将插件凭据存入 Android 安全存储".into())
        .map(|_| ())
}

#[cfg(target_os = "android")]
pub fn remove(app: &AppHandle, account: &str) -> Result<(), String> {
    app.state::<PluginSecrets>()
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "removeSecret",
            SecretArgs {
                account,
                value: None,
            },
        )
        .map_err(|_| "无法移除 Android 安全存储中的插件凭据".into())
        .map(|_| ())
}

#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub fn load(_app: &AppHandle, _account: &str) -> Result<Option<Credential>, String> {
    Err("此平台暂不支持插件安全凭据存储".into())
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub fn save(_app: &AppHandle, _account: &str, _value: &Credential) -> Result<(), String> {
    Err("此平台暂不支持插件安全凭据存储".into())
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub fn remove(_app: &AppHandle, _account: &str) -> Result<(), String> {
    Ok(())
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("notebook-plugin-secrets")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(PluginSecrets(_api.register_android_plugin(
                "com.localnotes.notebook",
                "PluginSecretsPlugin",
            )?));
            Ok(())
        })
        .build()
}
