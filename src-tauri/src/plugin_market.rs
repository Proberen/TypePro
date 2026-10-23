use regex::Regex;
use reqwest::{header, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, sync::Arc, time::Duration};

type Result<T> = std::result::Result<T, String>;
const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/Proberen/typepro-plugins/main/catalog-v3.json";
const MAX_CATALOG: usize = 1024 * 1024;
const MAX_PACKAGE: usize = 8 * 1024 * 1024;
const MAX_PLUGINS: usize = 500;
const MAX_REDIRECTS: usize = 3;
const PERMISSIONS: &[&str] = &[
    "notes.read",
    "notes.write",
    "editor.insert",
    "commands",
    "panels",
    "storage",
    "home.activity",
    "assistant",
    "editor.read",
    "ui",
    "network",
    "secrets",
    "files.pick",
    "files.export",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u8,
    pub updated_at: String,
    pub plugins: Vec<CatalogPlugin>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(
        default,
        deserialize_with = "optional_text",
        skip_serializing_if = "Option::is_none"
    )]
    pub description: Option<String>,
    pub api_version: u8,
    pub permissions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub network_origins: Vec<String>,
    pub download_url: String,
    pub sha256: String,
    pub size: usize,
}

// Missing descriptions are optional; an explicit null is not a valid string.
fn optional_text<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}

pub struct Market {
    client: Client,
}

impl Market {
    pub fn new() -> Result<Self> {
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| "无法初始化插件市场 TLS 连接")?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let client = Client::builder()
            .tls_backend_preconfigured(tls)
            .https_only(true)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("TypePro-Plugin-Market/1")
            .build()
            .map_err(|_| "无法初始化插件市场连接")?;
        Ok(Self { client })
    }

    pub async fn catalog(&self) -> Result<Catalog> {
        // A fixed public URL keeps this independent of note sync and GitHub credentials.
        let response = self
            .client
            .get(CATALOG_URL)
            .header(header::ACCEPT, "application/json")
            .header(header::CACHE_CONTROL, "no-cache")
            .send()
            .await
            .map_err(connection_error)?;
        check_status(response.status(), true)?;
        let bytes = read_limited(response, MAX_CATALOG).await?;
        parse_catalog(&bytes)
    }

    pub async fn download(&self, id: &str, version: &str, sha256: &str) -> Result<Vec<u8>> {
        if !valid_id(id)
            || !version_pattern().is_match(version)
            || version.len() > 40
            || !valid_hash(sha256)
        {
            return Err("插件安装请求不正确，请刷新市场后重试".into());
        }
        // Re-read the trusted catalog and bind the install to the item the user confirmed.
        let catalog = self.catalog().await?;
        let plugin = select_plugin(&catalog, id, version, sha256)?;
        self.download_pinned(plugin).await
    }

    // Restores a previously pinned immutable release, even after a newer version is published.
    // The private sync snapshot supplies the pin; restored code stays disabled until approval.
    pub async fn restore(&self, plugin: CatalogPlugin) -> Result<Vec<u8>> {
        let catalog = Catalog { schema_version: 1, updated_at: chrono::Utc::now().to_rfc3339(), plugins: vec![plugin] };
        let raw = serde_json::to_vec(&catalog).map_err(|_| "无法读取插件恢复记录")?;
        let verified = parse_catalog(&raw)?;
        let plugin = &verified.plugins[0];
        let identity = format!("{}@{}", plugin.id, plugin.version);
        let tag = format!("plugin-{:x}", Sha256::digest(identity.as_bytes()));
        let expected = format!("https://github.com/Proberen/typepro-plugins/releases/download/{tag}/{}.zip", plugin.id);
        if plugin.download_url != expected { return Err("插件恢复地址与版本不匹配".into()); }
        self.download_pinned(plugin).await
    }

    async fn download_pinned(&self, plugin: &CatalogPlugin) -> Result<Vec<u8>> {
        let mut url = release_url(&plugin.download_url)?;
        for redirects in 0..=MAX_REDIRECTS {
            let response = self
                .client
                .get(url.clone())
                .header(header::ACCEPT, "application/octet-stream")
                .send()
                .await
                .map_err(connection_error)?;
            if response.status().is_redirection() {
                if redirects == MAX_REDIRECTS {
                    return Err("插件下载跳转过多，请稍后重试".into());
                }
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .filter(|value| value.len() <= 8192)
                    .ok_or("插件下载地址无效")?;
                let target = url.join(location).map_err(|_| "插件下载地址无效")?;
                if !allowed_download_redirect(&target) {
                    return Err("插件下载跳转到了不受支持的地址".into());
                }
                url = target;
                continue;
            }
            check_status(response.status(), false)?;
            let bytes = read_limited(response, plugin.size).await?;
            verify_package(plugin, &bytes)?;
            return Ok(bytes);
        }
        Err("插件下载失败，请稍后重试".into())
    }
}

fn version_pattern() -> Regex {
    Regex::new(concat!(
        r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)",
        r"(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)",
        r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?$"
    ))
    .expect("fixed plugin version pattern")
}

fn valid_id(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn parse_catalog(bytes: &[u8]) -> Result<Catalog> {
    if bytes.len() > MAX_CATALOG {
        return Err("插件市场清单超过容量限制".into());
    }
    let mut catalog: Catalog =
        serde_json::from_slice(bytes).map_err(|_| "插件市场清单格式不正确")?;
    if catalog.schema_version != 1
        || catalog.plugins.len() > MAX_PLUGINS
        || catalog.updated_at.len() > 40
        || chrono::DateTime::parse_from_rfc3339(&catalog.updated_at).is_err()
    {
        return Err("插件市场清单版本或内容不受支持".into());
    }
    let version = version_pattern();
    let mut ids = BTreeSet::new();
    for plugin in &mut catalog.plugins {
        if !valid_id(&plugin.id)
            || !ids.insert(plugin.id.clone())
            || plugin.name.trim().is_empty()
            || plugin.name.encode_utf16().count() > 60
            || plugin.version.len() > 40
            || !version.is_match(&plugin.version)
            || !matches!(plugin.api_version, 1 | 2 | 3)
            || (plugin.api_version == 1 && plugin.permissions.iter().any(|p| !matches!(p.as_str(), "notes.read" | "notes.write" | "editor.insert" | "commands" | "panels")))
            || (plugin.api_version == 2 && plugin.permissions.iter().any(|p| matches!(p.as_str(), "editor.read" | "ui" | "network" | "secrets" | "files.pick" | "files.export")))
            || (plugin.api_version == 3 && plugin.permissions.iter().any(|p| matches!(p.as_str(), "home.activity" | "assistant")))
            || plugin
                .description
                .as_ref()
                .is_some_and(|value| value.encode_utf16().count() > 300)
            || plugin
                .permissions
                .iter()
                .any(|permission| !PERMISSIONS.contains(&permission.as_str()))
            || !valid_hash(&plugin.sha256)
            || plugin.size == 0
            || plugin.size > MAX_PACKAGE
        {
            return Err("插件市场含有无效的插件信息，请稍后刷新".into());
        }
        if plugin.network_origins.len() > 32 || (!plugin.network_origins.is_empty()
            && (plugin.api_version != 3 || !plugin.permissions.iter().any(|p| p == "network"))) {
            return Err("插件网络权限无效".into());
        }
        let mut origins = BTreeSet::new();
        for value in &plugin.network_origins {
            let url = Url::parse(value).map_err(|_| "插件网络来源无效")?;
            let origin = url.origin().ascii_serialization();
            if value.contains('*') || url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty()
                || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
                || url.path() != "/" || (value != &origin && value != &format!("{origin}/"))
                || !origins.insert(origin) { return Err("插件网络来源无效".into()); }
        }
        plugin.network_origins = origins.into_iter().collect();
        release_url(&plugin.download_url)?;
        plugin.name = plugin.name.trim().to_owned();
        let mut permissions = BTreeSet::new();
        plugin
            .permissions
            .retain(|permission| permissions.insert(permission.clone()));
    }
    Ok(catalog)
}

fn select_plugin<'a>(
    catalog: &'a Catalog,
    id: &str,
    version: &str,
    sha256: &str,
) -> Result<&'a CatalogPlugin> {
    let plugin = catalog
        .plugins
        .iter()
        .find(|plugin| plugin.id == id)
        .ok_or("此插件已从市场移除，请刷新后重试")?;
    if plugin.version != version || plugin.sha256 != sha256 {
        return Err("此插件的发布内容已更新，请刷新市场并重新确认安装".into());
    }
    Ok(plugin)
}

fn plain_https(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.fragment().is_none()
}

fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}

fn release_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| "插件下载地址无效")?;
    let parts: Vec<_> = url.path().split('/').skip(1).collect();
    if value.len() > 512
        || !plain_https(&url)
        || url.host_str() != Some("github.com")
        || url.query().is_some()
        || parts.len() != 6
        || parts[..4] != ["Proberen", "typepro-plugins", "releases", "download"]
        || !safe_segment(parts[4])
        || !safe_segment(parts[5])
        || !parts[5].ends_with(".zip")
    {
        return Err("插件下载地址不属于 TypePro 插件仓库".into());
    }
    Ok(url)
}

fn allowed_download_redirect(url: &Url) -> bool {
    if !plain_https(url) {
        return false;
    }
    match url.host_str() {
        Some("github.com") => release_url(url.as_str()).is_ok(),
        Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com") => {
            url.path().starts_with("/github-production-release-asset/")
        }
        _ => false,
    }
}

fn connection_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "插件市场连接超时，请稍后重试"
    } else {
        "无法连接插件市场，请检查网络后重试"
    }
    .into()
}

fn check_status(status: StatusCode, catalog: bool) -> Result<()> {
    if status.is_success() {
        return Ok(());
    }
    Err(match status.as_u16() {
        404 if catalog => "插件市场尚未发布，请稍后刷新",
        404 => "插件包尚未发布或已移除，请刷新市场后重试",
        403 | 429 => "插件市场请求受限，请稍后重试",
        500..=599 => "GitHub 服务暂不可用，请稍后重试",
        _ => "插件市场请求失败，请稍后重试",
    }
    .into())
}

async fn read_limited(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("插件市场响应超过容量限制".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(connection_error)? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("插件市场响应超过容量限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn verify_package(plugin: &CatalogPlugin, bytes: &[u8]) -> Result<()> {
    if bytes.len() != plugin.size || format!("{:x}", Sha256::digest(bytes)) != plugin.sha256 {
        return Err("插件包完整性校验失败，请刷新市场后重新下载".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn entry() -> Value {
        json!({
            "id":"my.date-tool", "name":"日期工具", "version":"1.0.0", "apiVersion":1,
            "permissions":["commands", "editor.insert"],
            "downloadUrl":"https://github.com/Proberen/typepro-plugins/releases/download/plugin-abc/my.date-tool.zip",
            "sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "size":3
        })
    }

    fn catalog(entries: Vec<Value>) -> Vec<u8> {
        serde_json::to_vec(
            &json!({"schemaVersion":1,"updatedAt":"2026-10-22T00:00:00Z","plugins":entries}),
        )
        .unwrap()
    }

    #[test]
    fn catalog_and_package_bind_to_the_confirmed_release() {
        let parsed = parse_catalog(&catalog(vec![entry()])).unwrap();
        let plugin = &parsed.plugins[0];
        assert!(select_plugin(&parsed, &plugin.id, &plugin.version, &plugin.sha256).is_ok());
        assert!(select_plugin(&parsed, &plugin.id, "1.0.1", &plugin.sha256).is_err());
        assert!(select_plugin(&parsed, &plugin.id, &plugin.version, &"0".repeat(64)).is_err());
        assert!(select_plugin(&parsed, "missing.plugin", "1.0.0", &plugin.sha256).is_err());
        assert!(verify_package(plugin, b"abc").is_ok());
        assert!(verify_package(plugin, b"abd").is_err());
        assert!(verify_package(plugin, b"ab").is_err());
    }

    #[test]
    fn catalog_rejects_duplicates_and_unsupported_metadata() {
        assert!(parse_catalog(&catalog(vec![entry(), entry()])).is_err());
        for (key, value) in [
            ("id", json!("../x")),
            ("version", json!("1.0")),
            ("version", json!("01.0.0")),
            ("version", json!("1.0.0-rc.01")),
            ("version", json!("1.0.0-a..b")),
            ("apiVersion", json!(4)),
            ("permissions", json!(["network"])),
            ("size", json!(MAX_PACKAGE + 1)),
            ("size", json!(0)),
            ("sha256", json!("F".repeat(64))),
            ("description", Value::Null),
            ("name", json!("😀".repeat(31))),
        ] {
            let mut plugin = entry();
            plugin[key] = value;
            assert!(parse_catalog(&catalog(vec![plugin])).is_err(), "{key}");
        }
        let mut plugin = entry();
        plugin["name"] = json!("  日期工具  ");
        plugin["permissions"] = json!(["commands", "commands"]);
        let parsed = parse_catalog(&catalog(vec![plugin])).unwrap();
        assert_eq!(parsed.plugins[0].name, "日期工具");
        assert_eq!(parsed.plugins[0].permissions, ["commands"]);
        let mut plugin = entry();
        plugin["apiVersion"] = json!(2);
        plugin["permissions"] = json!(["storage", "assistant", "notes.read"]);
        assert!(parse_catalog(&catalog(vec![plugin.clone()])).is_ok());
        plugin["apiVersion"] = json!(1);
        assert!(parse_catalog(&catalog(vec![plugin])).is_err());
        let mut plugin = entry();
        plugin["version"] = json!("1.0.0-rc.10");
        assert!(parse_catalog(&catalog(vec![plugin])).is_ok());
    }

    #[test]
    fn download_origin_is_fixed_and_cdn_redirects_are_bounded_to_github_assets() {
        let valid = entry()["downloadUrl"].as_str().unwrap().to_owned();
        assert!(release_url(&valid).is_ok());
        for invalid in [
            valid.replace("https:", "http:"),
            valid.replace("github.com", "127.0.0.1"),
            valid.replace("github.com", "github.com.evil.example"),
            valid.replace("github.com", "user@github.com"),
            valid.replace("github.com", "github.com:8443"),
            valid.replace("/Proberen/", "/other/"),
            valid.replace("my.date-tool.zip", "%2e%2e.zip"),
            format!("{valid}?token=anything"),
            format!("{valid}#fragment"),
        ] {
            assert!(release_url(&invalid).is_err(), "{invalid}");
        }
        for allowed in [
            "release-assets.githubusercontent.com",
            "objects.githubusercontent.com",
        ] {
            let url = Url::parse(&format!(
                "https://{allowed}/github-production-release-asset/123/456?signature=value"
            ))
            .unwrap();
            assert!(allowed_download_redirect(&url));
        }
        for invalid in [
            "https://127.0.0.1/github-production-release-asset/a/b",
            "https://release-assets.githubusercontent.com/unrelated/path",
            "https://evil.example/github-production-release-asset/a/b",
            "https://user@objects.githubusercontent.com/github-production-release-asset/a/b",
        ] {
            assert!(!allowed_download_redirect(&Url::parse(invalid).unwrap()));
        }
    }
}
