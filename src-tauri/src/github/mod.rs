mod http;
mod model;
mod repository;
use crate::github_secrets::{self, Credentials};
pub use crate::storage::SyncFile;
pub use model::*;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::AppHandle;
use tokio::sync::Mutex;
use uuid::Uuid;

pub(super) type Result<T> = std::result::Result<T, String>;
const REPOSITORY: &str = "typepro-notes";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    client_id: String,
    app_slug: String,
    interval_minutes: u16,
    device_name: String,
    device_id: String,
    account: Option<Account>,
    repository: Option<Repository>,
    repository_id: Option<u64>,
    last_synced_at: Option<String>,
    last_source: Option<Source>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            client_id: option_env!("TYPEPRO_GITHUB_CLIENT_ID")
                .unwrap_or("Iv23lipNCmyApIdzUDhY")
                .into(),
            app_slug: option_env!("TYPEPRO_GITHUB_APP_SLUG")
                .unwrap_or("typepro-proberen")
                .into(),
            interval_minutes: 5,
            device_name: if cfg!(target_os = "android") {
                "我的 Android"
            } else {
                "我的 Mac"
            }
            .into(),
            device_id: Uuid::new_v4().to_string(),
            account: None,
            repository: None,
            repository_id: None,
            last_synced_at: None,
            last_source: None,
        }
    }
}
struct DeviceFlow {
    code: String,
    expires: Instant,
    interval: u64,
    next_poll: Instant,
}
struct Inner {
    config: Config,
    authorization: Option<DeviceFlow>,
}
pub struct Github {
    root: PathBuf,
    client: reqwest::Client,
    inner: Mutex<Inner>,
    cancellation: AtomicU64,
}

pub(super) fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| "无法保存同步状态")?;
    write_bytes(path, &bytes)
}
pub(super) fn write_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let parent = path.parent().ok_or("无效的同步缓存目录")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建同步缓存目录")?;
    let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|_| "无法写入同步缓存")?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法保存同步缓存")?;
        fs::rename(&temporary, path).map_err(|_| "无法更新同步缓存")?;
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|_| "无法持久化同步缓存目录")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
pub(super) fn read_json<T: serde::de::DeserializeOwned>(
    path: &Path,
    max: u64,
) -> Result<Option<T>> {
    use std::io::Read;
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取同步缓存".into()),
    };
    if file.metadata().map_err(|_| "无法读取同步缓存")?.len() > max {
        return Err("同步缓存超过容量限制".into());
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取同步缓存")?;
    if bytes.len() as u64 > max {
        return Err("同步缓存超过容量限制".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "同步缓存损坏，请断开后重新连接".into())
}
pub(super) fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| "GitHub 返回的数据不完整".into())
}
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn credential_response(value: &Value) -> Result<Credentials> {
    let access_token = text(value, "access_token")?.to_owned();
    if access_token.len() > 4096 || !access_token.starts_with("ghu_") {
        return Err("GitHub 返回了无效的 App 授权".into());
    }
    let refresh_token = value
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if refresh_token
        .as_ref()
        .is_some_and(|s| s.len() > 4096 || !s.starts_with("ghr_"))
    {
        return Err("GitHub 返回了无效的刷新凭据".into());
    }
    Ok(Credentials {
        access_token,
        refresh_token,
        expires_at: value
            .get("expires_in")
            .and_then(Value::as_i64)
            .map(|n| now() + n.clamp(0, 31_536_000)),
        refresh_expires_at: value
            .get("refresh_token_expires_in")
            .and_then(Value::as_i64)
            .map(|n| now() + n.clamp(0, 31_536_000)),
    })
}
impl Github {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(|_| "无法创建 GitHub 同步目录")?;
        let config = read_json(&root.join("config.json"), 32768)?.unwrap_or_default();
        Ok(Self {
            root,
            client: http::client()?,
            inner: Mutex::new(Inner {
                config,
                authorization: None,
            }),
            cancellation: AtomicU64::new(0),
        })
    }
    fn save_config(&self, config: &Config) -> Result<()> {
        write_json(&self.root.join("config.json"), config)
    }
    fn state(&self, app: &AppHandle, config: &Config) -> Result<GithubStatus> {
        let connected =
            !config.client_id.is_empty() && github_secrets::load(app, &config.client_id)?.is_some();
        Ok(GithubStatus {
            client_id: config.client_id.clone(),
            app_slug: config.app_slug.clone(),
            connected,
            account: config.account.clone(),
            repository: config.repository.clone(),
            interval_minutes: config.interval_minutes,
            device_name: config.device_name.clone(),
            device_id: config.device_id.clone(),
            last_synced_at: config.last_synced_at.clone(),
            last_source: config.last_source.clone(),
        })
    }
    pub async fn status(&self, app: &AppHandle) -> Result<GithubStatus> {
        self.state(app, &self.inner.lock().await.config)
    }
    pub async fn configure(
        &self,
        app: &AppHandle,
        client_id: String,
        app_slug: String,
        interval_minutes: u16,
        device_name: String,
    ) -> Result<GithubStatus> {
        let client_id = client_id.trim();
        let app_slug = app_slug.trim();
        let device_name = device_name.trim();
        if client_id.len() > 128
            || client_id.is_empty()
            || !client_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
            || app_slug.is_empty()
            || app_slug.len() > 100
            || !app_slug
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || interval_minutes > 1440
            || device_name.is_empty()
            || device_name.len() > 128
            || device_name.chars().any(char::is_control)
        {
            return Err("请检查 GitHub App 配置、设备名称和同步间隔".into());
        }
        let mut inner = self.inner.lock().await;
        if inner.config.client_id != client_id || inner.config.app_slug != app_slug {
            if !inner.config.client_id.is_empty() {
                github_secrets::remove(app, &inner.config.client_id)?;
            }
            inner.config.account = None;
            inner.config.repository = None;
            inner.config.repository_id = None;
            inner.config.last_synced_at = None;
            inner.config.last_source = None;
            inner.authorization = None;
            self.cancellation.fetch_add(1, Ordering::SeqCst);
        }
        inner.config.client_id = client_id.into();
        inner.config.app_slug = app_slug.into();
        inner.config.interval_minutes = interval_minutes;
        inner.config.device_name = device_name.into();
        self.save_config(&inner.config)?;
        self.state(app, &inner.config)
    }
    pub async fn start_authorization(&self) -> Result<Authorization> {
        let mut inner = self.inner.lock().await;
        if inner.config.client_id.is_empty() {
            return Err("请先配置 GitHub App Client ID".into());
        }
        let response = self
            .client
            .post("https://github.com/login/device/code")
            .header("Accept", "application/json")
            .form(&[("client_id", inner.config.client_id.as_str())])
            .send()
            .await
            .map_err(|_| "无法连接 GitHub 授权服务")?;
        if !response.status().is_success() {
            return Err("无法开始设备授权，请确认 GitHub App 已开启 Device flow".into());
        }
        let value = http::json(response, 32768).await?;
        if value.get("error").is_some() {
            return Err("无法开始设备授权，请确认 GitHub App 已开启 Device flow".into());
        }
        let uri = text(&value, "verification_uri")?;
        if uri != "https://github.com/login/device" {
            return Err("GitHub 授权地址异常".into());
        }
        let expires = value
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(900)
            .min(3600);
        let interval = value
            .get("interval")
            .and_then(Value::as_u64)
            .unwrap_or(5)
            .clamp(5, 60);
        let code = text(&value, "device_code")?.to_owned();
        let user_code = text(&value, "user_code")?.to_owned();
        if code.len() > 4096 || user_code.len() > 64 {
            return Err("GitHub 授权数据异常".into());
        }
        inner.authorization = Some(DeviceFlow {
            code,
            expires: Instant::now() + Duration::from_secs(expires),
            interval,
            next_poll: Instant::now() + Duration::from_secs(interval),
        });
        Ok(Authorization {
            user_code,
            verification_uri: uri.into(),
            expires_in: expires,
            interval,
        })
    }
    pub async fn cancel_authorization(&self) {
        self.cancellation.fetch_add(1, Ordering::SeqCst);
        self.inner.lock().await.authorization = None;
    }
    pub async fn poll_authorization(&self, app: &AppHandle) -> Result<AuthorizationPoll> {
        let generation = self.cancellation.load(Ordering::SeqCst);
        let mut inner = self.inner.lock().await;
        let flow = inner
            .authorization
            .as_mut()
            .ok_or("请重新开始 GitHub 授权")?;
        let mut result = AuthorizationPoll {
            status: "pending".into(),
            interval: Some(flow.interval),
            state: None,
        };
        if Instant::now() >= flow.expires {
            inner.authorization = None;
            result.status = "expired".into();
            return Ok(result);
        }
        if Instant::now() < flow.next_poll {
            return Ok(result);
        }
        let code = flow.code.clone();
        flow.next_poll = Instant::now() + Duration::from_secs(flow.interval);
        let response = self
            .client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", inner.config.client_id.as_str()),
                ("device_code", code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|_| "无法连接 GitHub 授权服务")?;
        let value = http::json(response, 32768).await?;
        self.check_cancelled(generation)?;
        if let Some(error) = value.get("error").and_then(Value::as_str) {
            match error {
                "authorization_pending" => (),
                "slow_down" => {
                    if let Some(flow) = inner.authorization.as_mut() {
                        flow.interval = value
                            .get("interval")
                            .and_then(Value::as_u64)
                            .unwrap_or(flow.interval + 5)
                            .max(flow.interval + 5)
                            .min(300);
                        flow.next_poll = Instant::now() + Duration::from_secs(flow.interval);
                        result.interval = Some(flow.interval);
                        result.status = "slow_down".into();
                    }
                }
                "expired_token" => {
                    inner.authorization = None;
                    result.status = "expired".into();
                }
                "access_denied" => {
                    inner.authorization = None;
                    result.status = "denied".into();
                }
                _ => return Err("设备授权失败，请确认 GitHub App 的设备授权配置".into()),
            }
            return Ok(result);
        }
        let credentials = credential_response(&value)?;
        let user = self
            .api(
                app,
                &inner.config,
                &credentials.access_token,
                Method::GET,
                &["user"],
                None,
            )
            .await?;
        let login = text(&user, "login")?;
        if !valid_login(login) {
            return Err("GitHub 账号标识异常".into());
        }
        self.check_cancelled(generation)?;
        github_secrets::save(app, &inner.config.client_id, &credentials)?;
        if inner
            .config
            .account
            .as_ref()
            .is_some_and(|a| !a.login.eq_ignore_ascii_case(login))
        {
            inner.config.repository = None;
            inner.config.repository_id = None;
            inner.config.last_synced_at = None;
            inner.config.last_source = None;
        }
        inner.config.account = Some(Account {
            login: login.into(),
            avatar_url: format!("https://github.com/{login}.png"),
        });
        inner.authorization = None;
        self.save_config(&inner.config)?;
        Ok(AuthorizationPoll {
            status: "authorized".into(),
            interval: None,
            state: Some(self.state(app, &inner.config)?),
        })
    }
    fn check_cancelled(&self, generation: u64) -> Result<()> {
        if generation != self.cancellation.load(Ordering::SeqCst) {
            Err("CANCELLED:同步已取消".into())
        } else {
            Ok(())
        }
    }
    async fn token(&self, app: &AppHandle, config: &Config) -> Result<String> {
        let mut credentials =
            github_secrets::load(app, &config.client_id)?.ok_or("AUTH_REQUIRED:请先连接 GitHub")?;
        if !credentials.expires_at.is_some_and(|t| t <= now() + 60) {
            return Ok(credentials.access_token);
        }
        if credentials.refresh_expires_at.is_some_and(|t| t <= now())
            || credentials.refresh_token.is_none()
        {
            github_secrets::remove(app, &config.client_id)?;
            return Err("AUTH_REQUIRED:GitHub 授权已过期，请重新连接".into());
        }
        let response = self
            .client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", config.client_id.as_str()),
                ("grant_type", "refresh_token"),
                (
                    "refresh_token",
                    credentials.refresh_token.as_deref().unwrap_or_default(),
                ),
            ])
            .send()
            .await
            .map_err(|_| "无法刷新 GitHub 授权，请联网后重试")?;
        let value = http::json(response, 32768).await?;
        if value.get("error").is_some() {
            github_secrets::remove(app, &config.client_id)?;
            return Err("AUTH_REQUIRED:GitHub 授权已失效，请重新连接".into());
        }
        credentials = credential_response(&value)?;
        github_secrets::save(app, &config.client_id, &credentials)?;
        Ok(credentials.access_token)
    }
    async fn raw_api(
        &self,
        app: &AppHandle,
        config: &Config,
        token: &str,
        method: Method,
        parts: &[&str],
        body: Option<&Value>,
    ) -> Result<(reqwest::StatusCode, Value)> {
        self.raw_api_query(app, config, token, method, parts, body, &[])
            .await
    }
    async fn raw_api_query(
        &self,
        app: &AppHandle,
        config: &Config,
        token: &str,
        method: Method,
        parts: &[&str],
        body: Option<&Value>,
        query: &[(&str, &str)],
    ) -> Result<(reqwest::StatusCode, Value)> {
        let result = http::request(&self.client, token, method, parts, body, query).await;
        if result
            .as_ref()
            .err()
            .is_some_and(|s| s.starts_with("AUTH_REQUIRED:"))
        {
            github_secrets::remove(app, &config.client_id)?;
        }
        result
    }
    async fn api(
        &self,
        app: &AppHandle,
        config: &Config,
        token: &str,
        method: Method,
        parts: &[&str],
        body: Option<&Value>,
    ) -> Result<Value> {
        let (status, value) = self
            .raw_api(app, config, token, method, parts, body)
            .await?;
        http::success(status, value)
    }
    pub async fn disconnect(&self, app: &AppHandle) -> Result<GithubStatus> {
        self.cancellation.fetch_add(1, Ordering::SeqCst);
        let mut inner = self.inner.lock().await;
        if !inner.config.client_id.is_empty() {
            github_secrets::remove(app, &inner.config.client_id)?;
        }
        inner.authorization = None;
        inner.config.account = None;
        inner.config.repository = None;
        inner.config.repository_id = None;
        inner.config.last_synced_at = None;
        inner.config.last_source = None;
        self.save_config(&inner.config)?;
        self.state(app, &inner.config)
    }
}
fn valid_login(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
