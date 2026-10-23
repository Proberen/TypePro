use reqwest::{Client, Method, StatusCode};
use serde_json::Value;
use std::time::Duration;

pub const JSON_LIMIT: usize = 48 * 1024 * 1024;
pub fn client() -> Result<Client, String> {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| "无法初始化 GitHub TLS 连接")?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Client::builder()
        .tls_backend_preconfigured(tls)
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("TypePro-GitHub-Sync/1")
        .build()
        .map_err(|_| "无法初始化 GitHub 网络连接".into())
}
pub fn api_url(parts: &[&str]) -> reqwest::Url {
    let mut url = reqwest::Url::parse("https://api.github.com/").expect("fixed URL");
    url.path_segments_mut().expect("fixed URL").extend(parts);
    url
}
pub async fn json(mut response: reqwest::Response, limit: usize) -> Result<Value, String> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("GitHub 响应超过容量限制".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "GitHub 连接中断，请稍后重试")?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("GitHub 响应超过容量限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "GitHub 返回了无法读取的数据".into())
}
pub async fn request(
    client: &Client,
    token: &str,
    method: Method,
    parts: &[&str],
    body: Option<&Value>,
    query: &[(&str, &str)],
) -> Result<(StatusCode, Value), String> {
    let mut request = client
        .request(method, api_url(parts))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2026-03-10")
        .query(query);
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "GitHub 连接超时，本地笔记已保留"
        } else {
            "无法连接 GitHub，本地笔记已保留"
        }
        .to_string()
    })?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err("AUTH_REQUIRED:GitHub 授权已失效，请重新连接".into());
    }
    if status == StatusCode::TOO_MANY_REQUESTS
        || (status == StatusCode::FORBIDDEN
            && (response
                .headers()
                .get("x-ratelimit-remaining")
                .is_some_and(|s| s == "0")
                || response.headers().contains_key("retry-after")))
    {
        return Err("RATE_LIMITED:GitHub 请求频率受限，请稍后同步".into());
    }
    if status == StatusCode::NO_CONTENT {
        return Ok((status, Value::Null));
    }
    Ok((status, json(response, JSON_LIMIT).await?))
}
pub fn success(status: StatusCode, value: Value) -> Result<Value, String> {
    if status.is_success() {
        return Ok(value);
    }
    Err(match status.as_u16() {
        403 => "FORBIDDEN:GitHub App 没有笔记仓库的访问权限，请检查安装与权限",
        404 => "NOT_FOUND:GitHub 笔记仓库不存在或尚未授权给 TypePro",
        409 | 422 => "REMOTE_CHANGED:远端内容已变化，请重新同步",
        500..=599 => "GitHub 服务暂不可用，请稍后重试",
        _ => "GitHub 请求失败，本地笔记已保留",
    }
    .into())
}
