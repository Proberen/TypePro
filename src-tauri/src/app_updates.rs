use reqwest::{header, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};

type Result<T> = std::result::Result<T, String>;
const RELEASES_URL: &str = "https://api.github.com/repos/Proberen/TypePro/releases";
const RELEASES_PER_PAGE: usize = 100;
const MAX_PAGES: usize = 5;
const MAX_RESPONSE: usize = 4 * 1024 * 1024;
const MAX_CHECKSUMS: usize = 64 * 1024;
pub const MAX_INSTALLER_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    pub version: String,
    pub release_url: String,
    pub download_url: String,
    pub release_notes: String,
    pub published_at: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    current_version: String,
    platform: Option<&'static str>,
    update: Option<AppUpdate>,
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<Asset>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    name: String,
    state: String,
    size: u64,
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DownloadAsset {
    pub filename: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

pub struct Updater {
    client: Client,
}

impl Updater {
    pub fn new() -> Result<Self> {
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| "无法初始化更新检查 TLS 连接")?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let client = Client::builder()
            .tls_backend_preconfigured(tls)
            .https_only(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("TypePro-App-Updates/1")
            .build()
            .map_err(|_| "无法初始化更新检查连接")?;
        Ok(Self { client })
    }

    /// Resolve the user-selected version again; no caller-supplied URL or checksum is trusted.
    pub async fn resolve_download(&self, version: &str) -> Result<DownloadAsset> {
        let platform = current_platform().ok_or("当前设备暂不支持下载更新")?;
        self.resolve_download_for(version, env!("CARGO_PKG_VERSION"), platform).await
    }

    async fn resolve_download_for(&self, version: &str, current: &str, platform: &str) -> Result<DownloadAsset> {
        valid_upgrade_to(version, current)?;
        let response = self.client.get(format!("{RELEASES_URL}/tags/v{version}"))
            .header(header::ACCEPT, "application/vnd.github+json")
            .header(header::CACHE_CONTROL, "no-cache")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send().await.map_err(connection_error)?;
        if !response.status().is_success() {
            return Err("无法读取此版本，请重新检查更新后重试".into());
        }
        let release: Release = serde_json::from_slice(&read_limited(response).await?)
            .map_err(|_| "GitHub 更新信息格式不正确")?;
        let update = select_update(std::slice::from_ref(&release), current, platform)?
            .filter(|update| update.version == version)
            .ok_or("此版本没有可用的安装包，请重新检查更新")?;
        let asset = release.assets.iter().find(|asset| asset.browser_download_url == update.download_url)
            .ok_or("安装包信息不完整")?;
        if asset.size > MAX_INSTALLER_BYTES {
            return Err("安装包超过 512 MB 限制".into());
        }
        let sha256 = match asset.digest.as_deref() {
            Some(digest) => parse_digest(digest).ok_or("安装包 SHA-256 信息无效")?,
            None => {
                let url = format!("https://github.com/Proberen/TypePro/releases/download/v{version}/SHA256SUMS.txt");
                let checksums = release.assets.iter().find(|entry| entry.name == "SHA256SUMS.txt"
                    && entry.browser_download_url == url && entry.state == "uploaded"
                    && entry.size > 0 && entry.size <= MAX_CHECKSUMS as u64)
                    .ok_or("此版本缺少完整性校验信息，暂时不能下载")?;
                let response = self.asset_response(&checksums.browser_download_url).await?;
                let bytes = read_bounded(response, MAX_CHECKSUMS).await?;
                if bytes.len() as u64 != checksums.size {
                    return Err("版本校验文件不完整，请重试".into());
                }
                parse_checksums(&bytes, &asset.name)?
            }
        };
        Ok(DownloadAsset { filename: asset.name.clone(),
            url: update.download_url, size: asset.size, sha256 })
    }

    #[cfg(test)]
    pub(crate) async fn published_download_for_test(&self, version: &str, platform: &str) -> Result<DownloadAsset> {
        self.resolve_download_for(version, "1.7.3", platform).await
    }

    pub async fn open_download(&self, asset: &DownloadAsset) -> Result<reqwest::Response> {
        self.asset_response(&asset.url).await
    }

    async fn asset_response(&self, value: &str) -> Result<reqwest::Response> {
        let mut url = Url::parse(value).map_err(|_| "安装包下载地址无效")?;
        for redirects in 0..=3 {
            let response = self.client.get(url.clone())
                .header(header::ACCEPT, "application/octet-stream")
                .timeout(Duration::from_secs(15 * 60))
                .send().await.map_err(download_error)?;
            if response.status().is_redirection() {
                if redirects == 3 { return Err("安装包下载跳转过多".into()); }
                let location = response.headers().get(header::LOCATION)
                    .and_then(|value| value.to_str().ok()).filter(|value| value.len() <= 8192)
                    .ok_or("安装包下载跳转地址无效")?;
                let target = url.join(location).map_err(|_| "安装包下载跳转地址无效")?;
                if !allowed_download_redirect(&target) {
                    return Err("安装包下载跳转到了不受支持的地址".into());
                }
                url = target;
                continue;
            }
            if response.status() != StatusCode::OK {
                return Err("安装包下载失败，请稍后重试".into());
            }
            return Ok(response);
        }
        Err("安装包下载失败".into())
    }

    pub async fn check(&self) -> Result<UpdateCheck> {
        let current_version = env!("CARGO_PKG_VERSION").to_string();
        let platform = current_platform();
        let mut result = UpdateCheck { current_version, platform, update: None };
        let Some(platform) = platform else { return Ok(result) };
        let mut releases = Vec::new();
        for page in 1..=MAX_PAGES {
            let response = self.client.get(RELEASES_URL)
                .query(&[("per_page", RELEASES_PER_PAGE), ("page", page)])
                .header(header::ACCEPT, "application/vnd.github+json")
                .header(header::CACHE_CONTROL, "no-cache")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .send().await.map_err(connection_error)?;
            let status = response.status();
            if !status.is_success() {
                return Err(match status {
                    StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS =>
                        "GitHub 检查次数受限，请稍后重试",
                    StatusCode::NOT_FOUND => "暂时找不到 TypePro 更新仓库，请稍后重试",
                    _ => "GitHub 暂时无法提供更新，请稍后重试",
                }.into());
            }
            let bytes = read_limited(response).await?;
            let entries: Vec<Release> = serde_json::from_slice(&bytes)
                .map_err(|_| "GitHub 更新信息格式不正确，请稍后重试")?;
            if entries.len() > RELEASES_PER_PAGE {
                return Err("GitHub 更新列表过大，请在版本页面查看".into());
            }
            let last_page = entries.len() < RELEASES_PER_PAGE;
            releases.extend(entries);
            if last_page {
                result.update = select_update(&releases, &result.current_version, platform)?;
                return Ok(result);
            }
        }
        // Do not report an incomplete, bounded list as a definitive "up to date" result.
        Err("GitHub 更新列表过大，请在版本页面查看".into())
    }
}

fn current_platform() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("mac-arm64")
    } else if cfg!(target_os = "android") {
        Some("android")
    } else {
        None
    }
}

pub(crate) fn version_parts(version: &str) -> Option<[u64; 3]> {
    fn number(part: &str) -> Option<u64> {
        if part.is_empty() || part.len() > 1 && part.starts_with('0')
            || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    }
    let mut parts = version.split('.');
    let result = [number(parts.next()?)?, number(parts.next()?)?, number(parts.next()?)?];
    if parts.next().is_some() { None } else { Some(result) }
}

fn select_update(releases: &[Release], current_version: &str, platform: &str) -> Result<Option<AppUpdate>> {
    let current = version_parts(current_version).ok_or("当前应用版本不正确，无法检查更新")?;
    let suffix = match platform {
        "mac-arm64" => "mac-arm64.dmg",
        "android" => "android.apk",
        _ => return Ok(None),
    };
    let mut best: Option<([u64; 3], &Release, &Asset)> = None;
    for release in releases {
        if release.draft || release.prerelease || release.published_at.is_none() { continue; }
        let Some(version) = release.tag_name.strip_prefix('v') else { continue; };
        let Some(parts) = version_parts(version) else { continue; };
        if parts <= current || best.as_ref().is_some_and(|(previous, _, _)| parts <= *previous) { continue; }
        let release_url = format!("https://github.com/Proberen/TypePro/releases/tag/v{version}");
        if release.html_url != release_url { continue; }
        let filename = format!("TypePro-{version}-{suffix}");
        let download_url = format!("https://github.com/Proberen/TypePro/releases/download/v{version}/{filename}");
        let Some(asset) = release.assets.iter().find(|asset| {
            asset.name == filename && asset.state == "uploaded" && asset.size > 0
                && asset.browser_download_url == download_url
        }) else { continue; };
        best = Some((parts, release, asset));
    }
    Ok(best.map(|(_, release, asset)| AppUpdate {
        version: release.tag_name[1..].to_string(),
        release_url: release.html_url.clone(),
        download_url: asset.browser_download_url.clone(),
        release_notes: release.body.clone().unwrap_or_default(),
        published_at: release.published_at.clone().unwrap_or_default(),
        size: asset.size,
    }))
}

async fn read_limited(response: reqwest::Response) -> Result<Vec<u8>> {
    read_bounded(response, MAX_RESPONSE).await
}

async fn read_bounded(mut response: reqwest::Response, maximum: usize) -> Result<Vec<u8>> {
    if response.content_length().is_some_and(|length| length > maximum as u64) {
        return Err("GitHub 更新信息过大，请在版本页面查看".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(connection_error)? {
        if chunk.len() > maximum - bytes.len() {
            return Err("GitHub 更新信息过大，请在版本页面查看".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(crate) fn valid_upgrade_version(version: &str) -> Result<()> {
    valid_upgrade_to(version, env!("CARGO_PKG_VERSION"))
}

fn valid_upgrade_to(version: &str, current: &str) -> Result<()> {
    let requested = version_parts(version).ok_or("更新版本号无效")?;
    let current = version_parts(current).ok_or("当前版本号无效")?;
    if requested <= current { return Err("只能下载高于当前版本的更新".into()); }
    Ok(())
}

fn parse_digest(value: &str) -> Option<String> {
    let hash = value.strip_prefix("sha256:")?;
    valid_hash(hash).then(|| hash.to_ascii_lowercase())
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_checksums(bytes: &[u8], filename: &str) -> Result<String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "版本校验文件格式不正确")?;
    let mut found = None;
    for line in text.lines() {
        // GNU sha256sum text and binary markers are the only accepted formats.
        if line.len() < 67 || !line.is_char_boundary(64) { continue; }
        let (hash, rest) = line.split_at(64);
        if let Some(name) = rest.strip_prefix("  ").or_else(|| rest.strip_prefix(" *")) {
            if name == filename {
                if !valid_hash(hash) || found.is_some() {
                    return Err("安装包校验记录无效或重复".into());
                }
                found = Some(hash.to_ascii_lowercase());
            }
        }
    }
    found.ok_or_else(|| "校验文件中缺少当前安装包".into())
}

fn allowed_download_redirect(url: &Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
        && url.port_or_known_default() == Some(443) && url.fragment().is_none()
        && matches!(url.host_str(), Some("github.com" | "release-assets.githubusercontent.com" | "objects.githubusercontent.com"))
}

pub(crate) fn download_error(error: reqwest::Error) -> String {
    if error.is_timeout() { "安装包下载超时，请重试".into() }
    else { "无法下载更新，请检查网络后重试".into() }
}

fn connection_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "检查更新超时，请稍后重试".into()
    } else {
        "无法连接 GitHub，请检查网络后重试".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(version: &str, platform: &str) -> Release {
        let suffix = if platform == "android" { "android.apk" } else { "mac-arm64.dmg" };
        let filename = format!("TypePro-{version}-{suffix}");
        Release {
            tag_name: format!("v{version}"),
            html_url: format!("https://github.com/Proberen/TypePro/releases/tag/v{version}"),
            draft: false,
            prerelease: false,
            body: Some("## 更新说明\n保留 Markdown 文本".into()),
            published_at: Some("2026-10-23T03:00:00Z".into()),
            assets: vec![Asset { name: filename.clone(), state: "uploaded".into(), size: 123,
                browser_download_url: format!("https://github.com/Proberen/TypePro/releases/download/v{version}/{filename}"), digest: None }],
        }
    }

    #[test]
    fn installer_hashes_accept_only_explicit_sha256_digests() {
        let hash = "AB".repeat(32);
        assert_eq!(parse_digest(&format!("sha256:{hash}")), Some(hash.to_ascii_lowercase()));
        for value in [hash, "sha1:abcd".into(), format!("sha256:{}", "z".repeat(64)), "sha256:ab".into()] {
            assert!(parse_digest(&value).is_none());
        }
    }

    #[test]
    fn checksum_fallback_requires_one_exact_installer_name() {
        let hash = "ab".repeat(32);
        let filename = "TypePro-9.0.0-android.apk";
        for marker in ["  ", " *"] {
            assert_eq!(parse_checksums(format!("{hash}{marker}{filename}\n").as_bytes(), filename).unwrap(), hash);
        }
        for text in [format!("{hash}  ../{filename}\n"), format!("{hash}  {filename}.other\n"),
            format!("{hash}  {filename}\n{hash}  {filename}\n"), format!("{}  {filename}\n", "z".repeat(64))] {
            assert!(parse_checksums(text.as_bytes(), filename).is_err());
        }
        assert!(parse_checksums(&[0xff], filename).is_err());
    }

    #[test]
    fn installer_redirects_stay_on_explicit_github_https_hosts() {
        for url in ["https://github.com/path", "https://release-assets.githubusercontent.com/path?token=public", "https://objects.githubusercontent.com/path"] {
            assert!(allowed_download_redirect(&Url::parse(url).unwrap()));
        }
        for url in ["http://github.com/path", "https://github.com.evil.example/path", "https://evil.example/path", "https://github.com:444/path", "https://user@github.com/path", "https://github.com/path#fragment"] {
            assert!(!allowed_download_redirect(&Url::parse(url).unwrap()));
        }
    }

    #[test]
    fn strict_numeric_versions_compare_without_lexical_sorting() {
        assert!(version_parts("1.10.0") > version_parts("1.9.9"));
        for invalid in ["v1.2.3", "1.2", "1.2.3.4", "01.2.3", "1.2.3-beta", "1.2.3+meta", "1.-2.3", "1.2.18446744073709551616"] {
            assert!(version_parts(invalid).is_none(), "{invalid}");
        }
    }

    #[test]
    fn selects_highest_available_platform_version_in_any_release_order() {
        let releases = vec![release("1.10.0", "android"), release("1.8.0", "mac-arm64"),
            release("1.9.0", "mac-arm64"), release("1.7.9", "mac-arm64")];
        assert_eq!(select_update(&releases, "1.7.2", "mac-arm64").unwrap().unwrap().version, "1.9.0");
        assert_eq!(select_update(&releases, "1.7.2", "android").unwrap().unwrap().version, "1.10.0");
    }

    #[test]
    fn ignores_drafts_prereleases_and_non_version_tags() {
        let mut draft = release("2.0.0", "android"); draft.draft = true;
        let mut prerelease = release("3.0.0", "android"); prerelease.prerelease = true;
        let mut tag = release("4.0.0", "android"); tag.tag_name = "latest".into();
        let mut unpublished = release("5.0.0", "android"); unpublished.published_at = None;
        let releases = vec![draft, prerelease, tag, unpublished, release("1.8.0", "android")];
        assert_eq!(select_update(&releases, "1.7.2", "android").unwrap().unwrap().version, "1.8.0");
    }

    #[test]
    fn ignores_other_platforms_empty_or_unfinished_assets() {
        let mut unfinished = release("2.0.0", "android"); unfinished.assets[0].state = "new".into();
        let mut empty = release("3.0.0", "android"); empty.assets[0].size = 0;
        let mut missing = release("4.0.0", "android"); missing.assets.clear();
        let releases = vec![unfinished, empty, missing, release("5.0.0", "mac-arm64")];
        assert!(select_update(&releases, "1.7.2", "android").unwrap().is_none());
    }

    #[test]
    fn only_exact_repository_release_and_download_urls_are_accepted() {
        for url in ["https://evil.example/installer.apk", "http://github.com/Proberen/TypePro/releases/download/v2.0.0/TypePro-2.0.0-android.apk",
            "https://github.com/Proberen/TypePro/releases/download/v2.0.0/TypePro-2.0.0-android.apk?redirect=elsewhere",
            "https://github.com/Other/TypePro/releases/download/v2.0.0/TypePro-2.0.0-android.apk"] {
            let mut value = release("2.0.0", "android"); value.assets[0].browser_download_url = url.into();
            assert!(select_update(&[value], "1.7.2", "android").unwrap().is_none());
        }
        let mut value = release("2.0.0", "android"); value.html_url = "https://evil.example/release".into();
        assert!(select_update(&[value], "1.7.2", "android").unwrap().is_none());
    }

    #[test]
    fn does_not_offer_equal_or_older_versions_or_unsupported_platforms() {
        let values = vec![release("1.7.2", "android"), release("1.7.1", "android")];
        assert!(select_update(&values, "1.7.2", "android").unwrap().is_none());
        assert!(select_update(&values, "1.0.0", "windows").unwrap().is_none());
        assert!(select_update(&values, "not-a-version", "android").is_err());
    }

    #[test]
    fn result_uses_frontend_field_names_and_preserves_release_notes_as_text() {
        let value = UpdateCheck { current_version: "1.7.2".into(), platform: Some("android"),
            update: select_update(&[release("1.8.0", "android")], "1.7.2", "android").unwrap() };
        let json = serde_json::to_value(value).unwrap();
        assert_eq!(json["currentVersion"], "1.7.2");
        assert_eq!(json["platform"], "android");
        assert_eq!(json["update"]["releaseNotes"], "## 更新说明\n保留 Markdown 文本");
        assert!(json["update"]["downloadUrl"].as_str().unwrap().ends_with(".apk"));
        assert_eq!(json["update"]["size"], 123);
    }
}
