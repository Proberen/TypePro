//! Generic, permission-scoped plugin transport. Protocols and business logic live in plugins.
use crate::plugin_secrets::{self, Credential};
use reqwest::{header::{HeaderMap, HeaderName, HeaderValue}, Client, Method, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{ipc::{Channel, JavaScriptChannelId}, AppHandle, State, WebviewWindow};

type Result<T> = std::result::Result<T, ServiceError>;
const MAX_INPUT: usize = 5 * 1024 * 1024;
const MAX_OUTPUT: usize = 8 * 1024 * 1024;
const MAX_CHUNK: usize = 64 * 1024;
const MAX_SESSIONS: usize = 24;
const MAX_PENDING: usize = 4;
const MAX_TOMBSTONES: usize = 256;
const TOMBSTONE_TTL: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, Serialize)]
pub struct ServiceError {
    code: &'static str,
    message: String,
}

fn error(code: &'static str, message: impl Into<String>) -> ServiceError {
    ServiceError { code, message: message.into() }
}

#[derive(Clone)]
struct Session {
    plugin_id: String,
    origins: BTreeSet<String>,
}

#[derive(Default)]
struct ServiceState {
    sessions: HashMap<String, Session>,
    requests: HashMap<String, tokio::task::AbortHandle>,
    cancelled: HashMap<String, Instant>,
    stopped: HashMap<String, Instant>,
}

fn remember(map: &mut HashMap<String, Instant>, id: String, now: Instant) {
    map.retain(|_, at| now.duration_since(*at) < TOMBSTONE_TTL);
    if map.len() >= MAX_TOMBSTONES {
        if let Some(oldest) = map.iter().min_by_key(|(_, at)| **at).map(|(id, _)| id.clone()) {
            map.remove(&oldest);
        }
    }
    map.insert(id, now);
}

impl ServiceState {
    fn expire(&mut self, now: Instant) {
        self.cancelled.retain(|_, at| now.duration_since(*at) < TOMBSTONE_TTL);
        self.stopped.retain(|_, at| now.duration_since(*at) < TOMBSTONE_TTL);
    }

    fn abort_session(&mut self, session_id: &str) {
        let prefix = format!("{session_id}/");
        self.requests.retain(|key, handle| {
            if key.starts_with(&prefix) { handle.abort(); false } else { true }
        });
    }
}

pub struct PluginServices {
    client: Result<Client>,
    state: Mutex<ServiceState>,
}

impl PluginServices {
    pub fn new() -> Self {
        Self { client: make_client(), state: Mutex::new(ServiceState::default()) }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ServiceState>> {
        self.state.lock().map_err(|_| error("INTERNAL_ERROR", "插件网络状态不可用，请重启应用"))
    }

    fn session(&self, session_id: &str) -> Result<Session> {
        identifier(session_id, "会话 id")?;
        self.lock()?.sessions.get(session_id).cloned()
            .ok_or_else(|| error("PERMISSION_DENIED", "插件已停用或会话未获授权"))
    }
}

fn make_client() -> Result<Client> {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|_| error("INTERNAL_ERROR", "无法初始化插件 TLS 连接"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Client::builder()
        .tls_backend_preconfigured(tls)
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("TypePro-Plugins/3")
        .build()
        .map_err(|_| error("INTERNAL_ERROR", "无法初始化插件网络连接"))
}

fn access(window: &WebviewWindow) -> Result<()> {
    if window.label() != "main" {
        return Err(error("PERMISSION_DENIED", "窗口无权调用插件服务"));
    }
    Ok(())
}

fn identifier(value: &str, label: &str) -> Result<()> {
    if value.is_empty() || value.len() > 128
        || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte)) {
        return Err(error("INVALID_ARGUMENT", format!("{label}无效")));
    }
    Ok(())
}

fn https_url(value: &str) -> Result<Url> {
    if value.len() > 8192 || value.trim() != value || value.contains('\\')
        || value.chars().any(char::is_control) {
        return Err(error("INVALID_ARGUMENT", "HTTPS 地址无效"));
    }
    let url = Url::parse(value).map_err(|_| error("INVALID_ARGUMENT", "HTTPS 地址无效"))?;
    if url.scheme() != "https" || url.host_str().is_none() || url.host_str().is_some_and(|host| host.contains('*')) || !url.username().is_empty()
        || url.password().is_some() || url.fragment().is_some() {
        return Err(error("INVALID_ARGUMENT", "插件网络只允许不含账号或片段的 HTTPS 地址"));
    }
    Ok(url)
}

fn canonical_origin(value: &str) -> Result<String> {
    let url = https_url(value)?;
    if !matches!(url.path(), "" | "/") || url.query().is_some() {
        return Err(error("INVALID_ARGUMENT", "授权地址只能包含 HTTPS 协议、主机和端口"));
    }
    Ok(url.origin().ascii_serialization())
}

fn check_origin(session: &Session, value: &str) -> Result<Url> {
    let url = https_url(value)?;
    if !session.origins.contains(&url.origin().ascii_serialization()) {
        return Err(error("PERMISSION_DENIED", "此插件尚未获准访问该 HTTPS 地址"));
    }
    Ok(url)
}

fn account(plugin_id: &str, id: &str) -> Result<String> {
    identifier(id, "凭据 id")?;
    Ok(format!("{:x}", Sha256::digest(format!("{plugin_id}\0{id}").as_bytes())))
}

#[tauri::command]
pub fn plugin_session_start(
    window: WebviewWindow,
    service: State<'_, PluginServices>,
    session_id: String,
    plugin_id: String,
    origins: Vec<String>,
) -> Result<()> {
    access(&window)?;
    identifier(&session_id, "会话 id")?;
    identifier(&plugin_id, "插件 id")?;
    if origins.len() > 64 { return Err(error("LIMIT_EXCEEDED", "每个插件最多授权 64 个 HTTPS 地址")); }
    let origins = origins.iter().map(|value| canonical_origin(value)).collect::<Result<BTreeSet<_>>>()?;
    let mut state = service.lock()?;
    state.expire(Instant::now());
    if state.stopped.contains_key(&session_id) {
        return Err(error("CANCELLED", "插件会话已经关闭"));
    }
    if let Some(previous) = state.sessions.get(&session_id) {
        if previous.plugin_id != plugin_id {
            return Err(error("PERMISSION_DENIED", "插件会话身份不一致"));
        }
        if !previous.origins.is_subset(&origins) { state.abort_session(&session_id); }
    } else if state.sessions.len() >= MAX_SESSIONS {
        return Err(error("LIMIT_EXCEEDED", "同时运行的插件数量超过限制"));
    }
    state.sessions.insert(session_id, Session { plugin_id, origins });
    Ok(())
}

#[tauri::command]
pub fn plugin_session_stop(
    window: WebviewWindow,
    service: State<'_, PluginServices>,
    session_id: String,
) -> Result<()> {
    access(&window)?;
    identifier(&session_id, "会话 id")?;
    let mut state = service.lock()?;
    state.sessions.remove(&session_id);
    state.abort_session(&session_id);
    remember(&mut state.stopped, session_id, Instant::now());
    Ok(())
}

#[tauri::command]
pub fn plugin_secret_configure(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, PluginServices>,
    session_id: String,
    id: String,
    origin: String,
    key: String,
) -> Result<()> {
    access(&window)?;
    let session = service.session(&session_id)?;
    let origin = canonical_origin(&origin)?;
    check_origin(&session, &origin)?;
    if key.trim().is_empty() || key.len() > 8192 || !key.bytes().all(|byte| (32..=126).contains(&byte)) {
        return Err(error("INVALID_ARGUMENT", "凭据不能为空，且不能包含控制字符或超过 8192 字节"));
    }
    plugin_secrets::save(&app, &account(&session.plugin_id, &id)?, &Credential { origin, key })
        .map_err(|message| error("INTERNAL_ERROR", message))
}

#[tauri::command]
pub fn plugin_secret_status(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, PluginServices>,
    session_id: String,
    id: String,
    origin: String,
) -> Result<bool> {
    access(&window)?;
    let session = service.session(&session_id)?;
    let origin = canonical_origin(&origin)?;
    check_origin(&session, &origin)?;
    Ok(plugin_secrets::load(&app, &account(&session.plugin_id, &id)?)
        .map_err(|message| error("INTERNAL_ERROR", message))?
        .is_some_and(|value| value.origin == origin))
}

#[tauri::command]
pub fn plugin_secret_remove(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, PluginServices>,
    session_id: String,
    id: String,
) -> Result<()> {
    access(&window)?;
    let session = service.session(&session_id)?;
    plugin_secrets::remove(&app, &account(&session.plugin_id, &id)?)
        .map_err(|message| error("INTERNAL_ERROR", message))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkCredential {
    id: String,
    header: Option<String>,
    prefix: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkRequest {
    url: String,
    method: Option<String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    body: Option<String>,
    credential: Option<NetworkCredential>,
}

#[derive(Serialize)]
pub struct NetworkResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: String,
}

fn header_name(name: &str) -> Result<HeaderName> {
    let parsed = HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| error("INVALID_ARGUMENT", "HTTP 请求头名称无效"))?;
    if matches!(parsed.as_str(), "host" | "cookie" | "connection" | "content-length"
        | "transfer-encoding" | "upgrade" | "te" | "trailer" | "proxy-authorization" | "proxy-connection") {
        return Err(error("INVALID_ARGUMENT", "此 HTTP 请求头不能由插件设置"));
    }
    Ok(parsed)
}

fn prepare_request(app: &AppHandle, client: Client, session: &Session, request: NetworkRequest) -> Result<reqwest::RequestBuilder> {
    let url = check_origin(session, &request.url)?;
    let method = match request.method.as_deref().unwrap_or("GET") {
        "GET" => Method::GET, "POST" => Method::POST, "PUT" => Method::PUT,
        "PATCH" => Method::PATCH, "DELETE" => Method::DELETE,
        _ => return Err(error("INVALID_ARGUMENT", "HTTP 方法不受支持")),
    };
    if request.body.as_ref().is_some_and(|body| body.len() > MAX_INPUT)
        || request.headers.len() > 64
        || request.headers.iter().map(|(name, value)| name.len().saturating_add(value.len())).sum::<usize>() > 32 * 1024 {
        return Err(error("LIMIT_EXCEEDED", "HTTP 请求超过容量限制"));
    }
    let mut headers = HeaderMap::new();
    for (name, value) in request.headers {
        let name = header_name(&name)?;
        if headers.contains_key(&name) { return Err(error("INVALID_ARGUMENT", "HTTP 请求包含重复的请求头")); }
        headers.insert(name, HeaderValue::from_str(&value).map_err(|_| error("INVALID_ARGUMENT", "HTTP 请求头内容无效"))?);
    }
    if let Some(credential) = request.credential {
        let secret = plugin_secrets::load(app, &account(&session.plugin_id, &credential.id)?)
            .map_err(|message| error("INTERNAL_ERROR", message))?
            .ok_or_else(|| error("NOT_FOUND", "请先在本设备配置此插件的凭据"))?;
        if secret.origin != url.origin().ascii_serialization() {
            return Err(error("PERMISSION_DENIED", "凭据绑定的 HTTPS 地址与请求不一致，请重新配置"));
        }
        let name = header_name(credential.header.as_deref().unwrap_or("Authorization"))?;
        let prefix = credential.prefix.as_deref().unwrap_or("Bearer ");
        if prefix.len() > 128 || prefix.bytes().any(|byte| !(32..=126).contains(&byte)) {
            return Err(error("INVALID_ARGUMENT", "凭据前缀无效"));
        }
        let mut value = HeaderValue::from_str(&format!("{prefix}{}", secret.key))
            .map_err(|_| error("INVALID_ARGUMENT", "凭据无法用于此 HTTP 请求头"))?;
        value.set_sensitive(true);
        headers.insert(name, value);
    }
    let mut builder = client.request(method, url).headers(headers);
    if let Some(body) = request.body { builder = builder.body(body); }
    Ok(builder)
}

fn connection_error(value: reqwest::Error) -> ServiceError {
    error("NETWORK_ERROR", if value.is_timeout() { "HTTPS 请求超时，请稍后重试" } else { "HTTPS 请求失败，请检查网络与目标地址" })
}

fn send_text(channel: &Channel<String>, text: &str) -> Result<()> {
    let mut rest = text;
    while !rest.is_empty() {
        let mut end = rest.len().min(MAX_CHUNK);
        while !rest.is_char_boundary(end) { end -= 1; }
        channel.send(rest[..end].to_owned()).map_err(|_| error("CANCELLED", "插件页面已经关闭"))?;
        rest = &rest[end..];
    }
    Ok(())
}

async fn transfer(builder: reqwest::RequestBuilder, on_chunk: Option<Channel<String>>) -> Result<NetworkResponse> {
    let mut response = builder.send().await.map_err(connection_error)?;
    if response.content_length().is_some_and(|length| length > MAX_OUTPUT as u64) {
        return Err(error("LIMIT_EXCEEDED", "HTTPS 响应超过 8 MiB 限制"));
    }
    let status = response.status().as_u16();
    let headers = response.headers().iter().filter_map(|(name, value)| {
        if matches!(name.as_str(), "set-cookie" | "authorization" | "proxy-authorization" | "cookie") { return None; }
        value.to_str().ok().map(|value| (name.to_string(), value.to_owned()))
    }).collect();
    let mut bytes = Vec::new();
    let mut received = 0usize;
    while let Some(chunk) = response.chunk().await.map_err(connection_error)? {
        received = received.saturating_add(chunk.len());
        if received > MAX_OUTPUT { return Err(error("LIMIT_EXCEEDED", "HTTPS 响应超过 8 MiB 限制")); }
        bytes.extend_from_slice(&chunk);
        if let Some(channel) = &on_chunk {
            let valid = match std::str::from_utf8(&bytes) {
                Ok(text) => text.len(),
                Err(value) if value.error_len().is_none() => value.valid_up_to(),
                Err(_) => return Err(error("NETWORK_ERROR", "HTTPS 响应不是有效的 UTF-8 文本")),
            };
            if valid > 0 {
                let text = std::str::from_utf8(&bytes[..valid])
                    .map_err(|_| error("NETWORK_ERROR", "HTTPS 响应不是有效的 UTF-8 文本"))?;
                send_text(channel, text)?;
                bytes.drain(..valid);
            }
        }
    }
    let body = String::from_utf8(bytes).map_err(|_| error("NETWORK_ERROR", "HTTPS 响应不是完整的 UTF-8 文本"))?;
    Ok(NetworkResponse { status, headers, body })
}

#[tauri::command]
pub async fn plugin_network_request(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, PluginServices>,
    session_id: String,
    request_id: String,
    request: NetworkRequest,
    on_chunk: Option<JavaScriptChannelId>,
) -> Result<NetworkResponse> {
    access(&window)?;
    let on_chunk = on_chunk.map(|id| id.channel_on(window.as_ref().clone()));
    identifier(&session_id, "会话 id")?;
    identifier(&request_id, "请求 id")?;
    let key = format!("{session_id}/{request_id}");
    let client = service.client.as_ref().cloned().map_err(Clone::clone)?;
    let handle = {
        let mut state = service.lock()?;
        state.expire(Instant::now());
        let session = state.sessions.get(&session_id).cloned()
            .ok_or_else(|| error("PERMISSION_DENIED", "插件已停用或会话未获授权"))?;
        if state.cancelled.contains_key(&key) { return Err(error("CANCELLED", "HTTPS 请求已取消")); }
        if state.requests.contains_key(&key) { return Err(error("CONFLICT", "HTTPS 请求 id 已存在")); }
        let count = state.requests.keys().filter(|key| {
            key.split_once('/').and_then(|(id, _)| state.sessions.get(id))
                .is_some_and(|other| other.plugin_id == session.plugin_id)
        }).count();
        if count >= MAX_PENDING { return Err(error("LIMIT_EXCEEDED", "每个插件同时最多运行 4 个 HTTPS 请求")); }
        let builder = prepare_request(&app, client, &session, request)?;
        let handle = tauri::async_runtime::spawn(transfer(builder, on_chunk));
        state.requests.insert(key.clone(), handle.inner().abort_handle());
        handle
    };
    let result = handle.await;
    if let Ok(mut state) = service.state.lock() { state.requests.remove(&key); }
    result.map_err(|_| error("CANCELLED", "HTTPS 请求已取消或插件已经停用"))?
}

#[tauri::command]
pub fn plugin_network_cancel(
    window: WebviewWindow,
    service: State<'_, PluginServices>,
    session_id: String,
    request_id: String,
) -> Result<()> {
    access(&window)?;
    identifier(&session_id, "会话 id")?;
    identifier(&request_id, "请求 id")?;
    let mut state = service.lock()?;
    let key = format!("{session_id}/{request_id}");
    if let Some(handle) = state.requests.get(&key) { handle.abort(); }
    remember(&mut state.cancelled, key, Instant::now());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_https_origin_authorization() {
        assert_eq!(canonical_origin("https://EXAMPLE.com:443/").unwrap(), "https://example.com");
        for invalid in ["http://example.com", "https://*.example.com", "https://user@example.com", "https://example.com/v1", "https://example.com?x=1", "https://example.com/#x", " https://example.com"] {
            assert!(canonical_origin(invalid).is_err(), "{invalid}");
        }
        let session = Session { plugin_id: "test.plugin".into(), origins: BTreeSet::from(["https://example.com".into()]) };
        assert!(check_origin(&session, "https://example.com/v1?q=1").is_ok());
        assert!(check_origin(&session, "https://example.com.evil.test/v1").is_err());
        assert!(check_origin(&session, "https://example.com:8443/v1").is_err());
    }

    #[test]
    fn credential_accounts_are_unambiguous_and_plugin_scoped() {
        assert_ne!(account("a.b", "c").unwrap(), account("a", "b.c").unwrap());
        assert_ne!(account("first.plugin", "key").unwrap(), account("second.plugin", "key").unwrap());
        assert_eq!(account("first.plugin", "key").unwrap().len(), 64);
        assert!(account("test.plugin", "../other").is_err());
    }

    #[test]
    fn early_cancellation_and_closed_session_memory_is_bounded() {
        let mut state = ServiceState::default();
        let now = Instant::now();
        for index in 0..MAX_TOMBSTONES + 1 {
            remember(&mut state.cancelled, format!("s/r{index}"), now + Duration::from_millis(index as u64));
        }
        assert_eq!(state.cancelled.len(), MAX_TOMBSTONES);
        assert!(!state.cancelled.contains_key("s/r0"));
        remember(&mut state.stopped, "s".into(), now);
        state.expire(now + TOMBSTONE_TTL + Duration::from_secs(1));
        assert!(state.cancelled.is_empty());
        assert!(state.stopped.is_empty());
    }

    #[test]
    fn managed_and_transport_headers_cannot_be_forged() {
        for name in ["Host", "Cookie", "Content-Length", "Connection", "Proxy-Authorization", "Transfer-Encoding"] {
            assert!(header_name(name).is_err(), "{name}");
        }
        assert!(header_name("Authorization").is_ok());
        assert!(header_name("X-Api-Key").is_ok());
        assert!(header_name("invalid\r\nheader").is_err());
    }
}
