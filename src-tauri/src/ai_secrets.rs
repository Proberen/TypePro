//! Device-local AI credentials. Neither the key nor this record enters Workspace.
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Serialize, Deserialize)]
pub struct Credential {
    pub base_url: String,
    pub key: String,
}

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.localnotes.notebook.ai";

#[cfg(target_os = "macos")]
pub fn load(_app: &AppHandle, account: &str) -> Result<Option<Credential>, String> {
    match security_framework::passwords::get_generic_password(SERVICE, account) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "AI 密钥记录损坏，请重新填写 Key".into()),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err("无法读取 macOS 钥匙串中的 AI 密钥".into()),
    }
}

#[cfg(target_os = "macos")]
pub fn save(_app: &AppHandle, account: &str, value: &Credential) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "无法编码 AI 密钥")?;
    security_framework::passwords::set_generic_password(SERVICE, account, &bytes)
        .map_err(|_| "无法将 AI 密钥存入 macOS 钥匙串".into())
}

#[cfg(target_os = "macos")]
pub fn remove(_app: &AppHandle, account: &str) -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(SERVICE, account) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == -25300 => Ok(()),
        Err(_) => Err("无法移除 macOS 钥匙串中的 AI 密钥".into()),
    }
}

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};
#[cfg(target_os = "android")]
struct AiSecrets(PluginHandle<tauri::Wry>);
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
        .state::<AiSecrets>()
        .0
        .run_mobile_plugin::<SecretResult>(
            "loadSecret",
            SecretArgs {
                account,
                value: None,
            },
        )
        .map_err(|_| "无法读取 Android 安全存储中的 AI 密钥")?;
    result
        .value
        .map(|value| {
            serde_json::from_str(&value).map_err(|_| "AI 密钥记录损坏，请重新填写 Key".into())
        })
        .transpose()
}

#[cfg(target_os = "android")]
pub fn save(app: &AppHandle, account: &str, value: &Credential) -> Result<(), String> {
    app.state::<AiSecrets>()
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "saveSecret",
            SecretArgs {
                account,
                value: Some(serde_json::to_string(value).map_err(|_| "无法编码 AI 密钥")?),
            },
        )
        .map_err(|_| "无法将 AI 密钥存入 Android 安全存储".into())
        .map(|_| ())
}

#[cfg(target_os = "android")]
pub fn remove(app: &AppHandle, account: &str) -> Result<(), String> {
    app.state::<AiSecrets>()
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "removeSecret",
            SecretArgs {
                account,
                value: None,
            },
        )
        .map_err(|_| "无法移除 Android 安全存储中的 AI 密钥".into())
        .map(|_| ())
}

#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub fn load(_app: &AppHandle, _account: &str) -> Result<Option<Credential>, String> {
    Err("此平台暂不支持 AI 安全密钥存储".into())
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub fn save(_app: &AppHandle, _account: &str, _value: &Credential) -> Result<(), String> {
    Err("此平台暂不支持 AI 安全密钥存储".into())
}
#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub fn remove(_app: &AppHandle, _account: &str) -> Result<(), String> {
    Ok(())
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("notebook-ai-secrets")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(AiSecrets(_api.register_android_plugin(
                "com.localnotes.notebook",
                "AiSecretsPlugin",
            )?));
            Ok(())
        })
        .build()
}
