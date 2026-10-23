use super::*;
use crate::storage::{validate_extensions, Document, ExtensionState, Notebook, MAX_EXTENSIONS};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha1::{Digest, Sha1};
use std::collections::{BTreeMap, BTreeSet};

const MANIFEST: &str = ".typepro/manifest.json";
const EXTENSIONS: &str = ".typepro/extensions.json";
const MAX_TOTAL: usize = 256 * 1024 * 1024;
const MAX_FILES: usize = 10_000;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: String,
    version: u8,
    notebooks: Vec<Book>,
    assets: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    extensions: Option<String>,
    source: Source,
    synced_at: String,
}
#[derive(PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Book {
    id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cover: Option<String>,
    documents: Vec<Doc>,
}
#[derive(PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Doc {
    id: String,
    title: String,
    updated_at: String,
    path: String,
    sha: String,
}
#[derive(Serialize, Deserialize)]
struct Checkpoint {
    head: String,
    snapshot: SyncSnapshot,
}
#[derive(Clone)]
struct Entry {
    sha: String,
    size: usize,
}

fn sha(value: &str) -> Result<()> {
    if value.len() != 40
        || !value
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err("GitHub 返回了无效的文件标识（仅支持 SHA-1 仓库）".into());
    }
    Ok(())
}
fn id(value: &str) -> Result<()> {
    let uuid = Uuid::parse_str(value).map_err(|_| "无效的同步笔记标识")?;
    if uuid.to_string() != value {
        return Err("无效的同步笔记标识".into());
    }
    Ok(())
}
fn asset_path(value: &str) -> bool {
    let Some(name) = value.strip_prefix("assets/") else {
        return false;
    };
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    id(stem).is_ok()
        && !ext.is_empty()
        && ext.len() <= 12
        && ext.bytes().all(|c| c.is_ascii_alphanumeric())
}
fn valid_file(value: &str) -> bool {
    if value == MANIFEST || value == EXTENSIONS || asset_path(value) {
        return true;
    }
    let pieces: Vec<_> = value.split('/').collect();
    pieces.len() == 3
        && pieces[0] == "notebooks"
        && id(pieces[1]).is_ok()
        && pieces[2].strip_suffix(".md").is_some_and(|s| id(s).is_ok())
}
fn blob_sha(bytes: &[u8]) -> String {
    let mut hash = Sha1::new();
    hash.update(format!("blob {}\0", bytes.len()).as_bytes());
    hash.update(bytes);
    format!("{:x}", hash.finalize())
}
fn validate_snapshot(snapshot: &SyncSnapshot) -> Result<()> {
    if snapshot.format != "typepro-github"
        || snapshot.version != 1
        || snapshot.notebooks.len() > 1000
        || snapshot.source.name.trim().is_empty()
        || snapshot.source.name.len() > 256
        || snapshot.source.platform.trim().is_empty()
        || snapshot.source.platform.len() > 64
        || snapshot
            .source
            .name
            .chars()
            .chain(snapshot.source.platform.chars())
            .any(char::is_control)
        || id(&snapshot.source.device_id).is_err()
        || snapshot.synced_at.len() > 128
        || !snapshot.synced_at.ends_with('Z')
        || chrono::DateTime::parse_from_rfc3339(&snapshot.synced_at).is_err()
    {
        return Err("不支持的 TypePro 同步数据".into());
    }
    if let Some(extensions) = &snapshot.extensions {
        validate_extensions(extensions)?;
    }
    let mut ids = BTreeSet::new();
    let mut count = 0;
    let mut total = 0usize;
    for book in &snapshot.notebooks {
        id(&book.id)?;
        if book.name.len() > 1024 || !ids.insert(&book.id) {
            return Err("笔记名称过长或标识重复".into());
        }
        for doc in &book.documents {
            id(&doc.id)?;
            count += 1;
            total = total.saturating_add(doc.markdown.len());
            if !ids.insert(&doc.id)
                || doc.title.len() > 1024
                || doc.updated_at.len() > 128
                || doc.markdown.len() > 16 * 1024 * 1024
            {
                return Err("同步文档无效或超过容量限制".into());
            }
        }
    }
    if count > 5000 || total > MAX_TOTAL {
        return Err("笔记库超过同步容量限制".into());
    }
    Ok(())
}
fn validate_asset_references(snapshot: &SyncSnapshot, paths: &BTreeSet<&str>) -> Result<()> {
    static REFERENCES: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let regex = REFERENCES.get_or_init(|| regex::Regex::new(r"\.\./\.\./assets/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,12}").expect("static asset regex"));
    for book in &snapshot.notebooks {
        if let Some(cover) = book.cover.as_deref() {
            if !matches!(
                cover,
                "preset:0" | "preset:1" | "preset:2" | "preset:3" | "preset:4" | "preset:5"
            ) {
                let path = cover.strip_prefix("../../").ok_or("同步封面路径无效")?;
                if !asset_path(path) || !paths.contains(path) {
                    return Err("同步清单缺少笔记封面附件".into());
                }
            }
        }
        for document in &book.documents {
            for reference in regex.find_iter(&document.markdown) {
                if !paths.contains(&reference.as_str()[6..]) {
                    return Err("同步清单缺少文档引用的附件".into());
                }
            }
        }
    }
    Ok(())
}
impl Github {
    fn cache_root(&self, config: &Config) -> Result<PathBuf> {
        let account = config
            .account
            .as_ref()
            .ok_or("AUTH_REQUIRED:请先连接 GitHub")?;
        if !valid_login(&account.login) {
            return Err("无效的 GitHub 账号".into());
        }
        let repo = Self::repository(config)?;
        let repository_id = config
            .repository_id
            .ok_or("INSTALLATION_REQUIRED:请重新检查笔记仓库连接")?;
        Ok(self
            .root
            .join("repositories")
            .join(&config.client_id)
            .join(account.login.to_ascii_lowercase())
            .join(REPOSITORY)
            .join(repository_id.to_string())
            .join(blob_sha(repo.default_branch.as_bytes())))
    }
    fn installed_url(config: &Config) -> String {
        format!(
            "https://github.com/apps/{}/installations/new",
            config.app_slug
        )
    }
    fn repository(config: &Config) -> Result<&Repository> {
        let repo = config
            .repository
            .as_ref()
            .ok_or("INSTALLATION_REQUIRED:请先准备笔记仓库")?;
        if repo.name != REPOSITORY
            || !config
                .account
                .as_ref()
                .is_some_and(|a| a.login.eq_ignore_ascii_case(&repo.owner))
        {
            return Err("笔记仓库必须属于当前 GitHub 账号".into());
        }
        Ok(repo)
    }
    async fn verify_repository(
        &self,
        app: &AppHandle,
        config: &Config,
        token: &str,
        repo: &Repository,
    ) -> Result<Value> {
        let value = self
            .api(
                app,
                config,
                token,
                Method::GET,
                &["repos", &repo.owner, REPOSITORY],
                None,
            )
            .await?;
        if value.get("private").and_then(Value::as_bool) != Some(true)
            || value.get("archived").and_then(Value::as_bool) == Some(true)
            || !value
                .get("owner")
                .and_then(|o| o.get("login"))
                .and_then(Value::as_str)
                .is_some_and(|s| s.eq_ignore_ascii_case(&repo.owner))
            || value.get("name").and_then(Value::as_str) != Some(REPOSITORY)
        {
            return Err(
                "PRIVATE_REPOSITORY_REQUIRED:仅支持当前账号下未归档的私有 typepro-notes 仓库"
                    .into(),
            );
        }
        if config
            .repository_id
            .is_some_and(|expected| value.get("id").and_then(Value::as_u64) != Some(expected))
            || value.get("default_branch").and_then(Value::as_str) != Some(&repo.default_branch)
        {
            return Err("REPOSITORY_CHANGED:仓库或默认分支已改变，请重新检查笔记仓库连接".into());
        }
        Ok(value)
    }
    async fn installed(&self, app: &AppHandle, config: &Config, token: &str) -> Result<bool> {
        // Restrict the App installation itself to exactly the dedicated notebook repository.
        let installations = self
            .api(
                app,
                config,
                token,
                Method::GET,
                &["user", "installations"],
                None,
            )
            .await?;
        let items = installations
            .get("installations")
            .and_then(Value::as_array)
            .ok_or("GitHub 安装信息不完整")?;
        let Some(installation) = items.iter().find(|i| {
            i.get("app_slug").and_then(Value::as_str) == Some(&config.app_slug)
                && i.get("account")
                    .and_then(|a| a.get("login"))
                    .and_then(Value::as_str)
                    .is_some_and(|s| {
                        config
                            .account
                            .as_ref()
                            .is_some_and(|a| a.login.eq_ignore_ascii_case(s))
                    })
        }) else {
            return Ok(false);
        };
        if installation
            .get("repository_selection")
            .and_then(Value::as_str)
            != Some("selected")
            || installation
                .get("permissions")
                .and_then(|p| p.get("contents"))
                .and_then(Value::as_str)
                != Some("write")
        {
            return Ok(false);
        }
        let installation_id = installation
            .get("id")
            .and_then(Value::as_u64)
            .ok_or("GitHub 安装标识无效")?
            .to_string();
        let repos = self
            .api(
                app,
                config,
                token,
                Method::GET,
                &["user", "installations", &installation_id, "repositories"],
                None,
            )
            .await?;
        let repos = repos
            .get("repositories")
            .and_then(Value::as_array)
            .ok_or("GitHub 安装仓库信息不完整")?;
        Ok(repos.len() == 1
            && repos[0].get("name").and_then(Value::as_str) == Some(REPOSITORY)
            && repos[0]
                .get("owner")
                .and_then(|o| o.get("login"))
                .and_then(Value::as_str)
                .is_some_and(|s| {
                    config
                        .account
                        .as_ref()
                        .is_some_and(|a| a.login.eq_ignore_ascii_case(s))
                }))
    }
    pub async fn prepare_repository(&self, app: &AppHandle) -> Result<RepositoryPreparation> {
        let mut inner = self.inner.lock().await;
        let token = self.token(app, &inner.config).await?;
        let account = inner
            .config
            .account
            .clone()
            .ok_or("AUTH_REQUIRED:请先连接 GitHub")?;
        let (status, mut value) = self
            .raw_api(
                app,
                &inner.config,
                &token,
                Method::GET,
                &["repos", &account.login, REPOSITORY],
                None,
            )
            .await?;
        if status == reqwest::StatusCode::NOT_FOUND {
            let (created, body) = self.raw_api(app, &inner.config, &token, Method::POST, &["user", "repos"], Some(&json!({
                "name": REPOSITORY, "private": true, "auto_init": true,
                "description": "TypePro private notes", "has_issues": false, "has_projects": false, "has_wiki": false
            }))).await?;
            if created.is_success() {
                value = body;
            } else if matches!(created.as_u16(), 403 | 404 | 422) {
                return Ok(RepositoryPreparation {
                    status: "installation_required".into(),
                    installation_url: Some(Self::installed_url(&inner.config)),
                    state: self.state(app, &inner.config)?,
                });
            } else {
                http::success(created, body)?;
            }
        } else {
            http::success(status, value.clone())?;
        }
        if value.get("private").and_then(Value::as_bool) != Some(true) {
            return Err("PRIVATE_REPOSITORY_REQUIRED:已存在的 typepro-notes 不是私有仓库，请先在 GitHub 检查仓库设置".into());
        }
        let branch = text(&value, "default_branch")?;
        if branch.is_empty() || branch.len() > 255 || branch.chars().any(char::is_control) {
            return Err("GitHub 默认分支无效".into());
        }
        let repo = Repository {
            owner: account.login,
            name: REPOSITORY.into(),
            url: format!(
                "https://github.com/{}/{}",
                config_owner(&inner.config)?,
                REPOSITORY
            ),
            default_branch: branch.into(),
        };
        let repository_id = value
            .get("id")
            .and_then(Value::as_u64)
            .ok_or("GitHub 仓库标识无效")?;
        if inner.config.repository_id != Some(repository_id)
            || inner
                .config
                .repository
                .as_ref()
                .is_some_and(|previous| previous.default_branch != repo.default_branch)
        {
            inner.config.last_synced_at = None;
            inner.config.last_source = None;
        }
        inner.config.repository_id = Some(repository_id);
        self.verify_repository(app, &inner.config, &token, &repo)
            .await?;
        inner.config.repository = Some(repo);
        self.save_config(&inner.config)?;
        let installed = self.installed(app, &inner.config, &token).await?;
        Ok(RepositoryPreparation {
            status: if installed {
                "ready"
            } else {
                "installation_required"
            }
            .into(),
            installation_url: if installed {
                None
            } else {
                Some(Self::installed_url(&inner.config))
            },
            state: self.state(app, &inner.config)?,
        })
    }
    async fn head(
        &self,
        app: &AppHandle,
        config: &Config,
        token: &str,
        repo: &Repository,
    ) -> Result<String> {
        let value = self
            .api(
                app,
                config,
                token,
                Method::GET,
                &[
                    "repos",
                    &repo.owner,
                    REPOSITORY,
                    "git",
                    "ref",
                    "heads",
                    &repo.default_branch,
                ],
                None,
            )
            .await?;
        let result = value
            .get("object")
            .and_then(|o| o.get("sha"))
            .and_then(Value::as_str)
            .ok_or("GitHub 分支标识无效")?;
        sha(result)?;
        Ok(result.into())
    }
    async fn tree(
        &self,
        app: &AppHandle,
        config: &Config,
        token: &str,
        repo: &Repository,
        head: &str,
    ) -> Result<(String, BTreeMap<String, Entry>)> {
        let commit = self
            .api(
                app,
                config,
                token,
                Method::GET,
                &["repos", &repo.owner, REPOSITORY, "git", "commits", head],
                None,
            )
            .await?;
        let tree_sha = commit
            .get("tree")
            .and_then(|t| t.get("sha"))
            .and_then(Value::as_str)
            .ok_or("GitHub 文件树无效")?
            .to_owned();
        sha(&tree_sha)?;
        let (status, value) = self
            .raw_api_query(
                app,
                config,
                token,
                Method::GET,
                &["repos", &repo.owner, REPOSITORY, "git", "trees", &tree_sha],
                None,
                &[("recursive", "1")],
            )
            .await?;
        let value = http::success(status, value)?;
        if value.get("truncated").and_then(Value::as_bool) == Some(true) {
            return Err("GitHub 文件树超过同步容量限制，未覆盖任何本地笔记".into());
        }
        let files = value
            .get("tree")
            .and_then(Value::as_array)
            .ok_or("GitHub 文件树不完整")?;
        let mut entries = BTreeMap::new();
        let mut total = 0usize;
        for file in files {
            let path = text(file, "path")?;
            if !valid_file(path) {
                continue;
            }
            if file.get("type").and_then(Value::as_str) != Some("blob")
                || file.get("mode").and_then(Value::as_str) != Some("100644")
            {
                return Err("同步文件不能使用目录、符号链接或可执行模式".into());
            }
            let object_sha = text(file, "sha")?;
            sha(object_sha)?;
            let size = file
                .get("size")
                .and_then(Value::as_u64)
                .ok_or("GitHub 文件大小无效")?;
            let limit = if path == MANIFEST {
                8 * 1024 * 1024
            } else if path == EXTENSIONS {
                MAX_EXTENSIONS
            } else if asset_path(path) {
                32 * 1024 * 1024
            } else {
                16 * 1024 * 1024
            };
            if size > limit as u64 {
                return Err("GitHub 文件超过同步容量限制".into());
            }
            total = total.saturating_add(size as usize);
            if entries
                .insert(
                    path.to_owned(),
                    Entry {
                        sha: object_sha.into(),
                        size: size as usize,
                    },
                )
                .is_some()
            {
                return Err("GitHub 文件树存在重复路径".into());
            }
            if entries.len() > MAX_FILES || total > MAX_TOTAL {
                return Err("GitHub 笔记库超过容量限制".into());
            }
        }
        Ok((tree_sha, entries))
    }
    async fn blob(
        &self,
        app: &AppHandle,
        config: &Config,
        token: &str,
        repo: &Repository,
        entry: &Entry,
    ) -> Result<Vec<u8>> {
        let cache = self.cache_root(config)?.join("blobs").join(&entry.sha);
        if let Ok(metadata) = fs::metadata(&cache) {
            if metadata.len() == entry.size as u64 {
                let bytes = fs::read(&cache).map_err(|_| "无法读取同步文件缓存")?;
                if blob_sha(&bytes) == entry.sha {
                    return Ok(bytes);
                }
            }
        }
        let value = self
            .api(
                app,
                config,
                token,
                Method::GET,
                &["repos", &repo.owner, REPOSITORY, "git", "blobs", &entry.sha],
                None,
            )
            .await?;
        if value.get("encoding").and_then(Value::as_str) != Some("base64") {
            return Err("GitHub 文件编码无效".into());
        }
        let encoded = text(&value, "content")?;
        let compact: String = encoded
            .chars()
            .filter(|c| !c.is_ascii_whitespace())
            .collect();
        let bytes = STANDARD
            .decode(compact)
            .map_err(|_| "GitHub 文件编码无效")?;
        if bytes.len() != entry.size || blob_sha(&bytes) != entry.sha {
            return Err("GitHub 文件完整性检查失败".into());
        }
        write_bytes(&cache, &bytes)?;
        Ok(bytes)
    }
    pub async fn read_remote(&self, app: &AppHandle) -> Result<RemoteRead> {
        let generation = self.cancellation.load(Ordering::SeqCst);
        let inner = self.inner.lock().await;
        let config = &inner.config;
        let token = self.token(app, config).await?;
        let repo = Self::repository(config)?;
        self.verify_repository(app, config, &token, repo).await?;
        if !self.installed(app, config, &token).await? {
            return Err("INSTALLATION_REQUIRED:请只将私有 typepro-notes 仓库授权给 TypePro".into());
        }
        let head = self.head(app, config, &token, repo).await?;
        let checkpoint: Option<Checkpoint> = read_json(
            &self.cache_root(config)?.join("base.json"),
            MAX_TOTAL as u64 + 32 * 1024 * 1024,
        )?;
        let base = checkpoint.map(|c| c.snapshot);
        let (_, files) = self.tree(app, config, &token, repo, &head).await?;
        let Some(entry) = files.get(MANIFEST) else {
            self.check_cancelled(generation)?;
            return Ok(RemoteRead {
                wire: ReadRemoteResult {
                    head,
                    base,
                    remote: None,
                },
                assets: vec![],
            });
        };
        let manifest: Manifest =
            serde_json::from_slice(&self.blob(app, config, &token, repo, entry).await?)
                .map_err(|_| "远端 TypePro 清单无效，未覆盖任何本地笔记")?;
        let mut notebooks = Vec::new();
        let mut assets = Vec::new();
        let mut referenced = BTreeSet::from([MANIFEST.to_owned()]);
        for book in manifest.notebooks {
            id(&book.id)?;
            let mut documents = Vec::new();
            for doc in book.documents {
                id(&doc.id)?;
                if doc.path != format!("notebooks/{}/{}.md", book.id, doc.id)
                    || !referenced.insert(doc.path.clone())
                {
                    return Err("远端文档路径无效或重复".into());
                }
                let entry = files.get(&doc.path).ok_or("远端清单引用的文档不存在")?;
                if doc.sha != entry.sha {
                    return Err("远端文档与清单不一致".into());
                }
                let markdown =
                    String::from_utf8(self.blob(app, config, &token, repo, entry).await?)
                        .map_err(|_| "远端 Markdown 不是 UTF-8")?;
                documents.push(Document {
                    id: doc.id,
                    title: doc.title,
                    markdown,
                    updated_at: doc.updated_at,
                });
                self.check_cancelled(generation)?;
            }
            notebooks.push(Notebook {
                id: book.id,
                name: book.name,
                cover: book.cover,
                documents,
            });
        }
        for (path, expected) in manifest.assets {
            if !asset_path(&path) || !referenced.insert(path.clone()) {
                return Err("远端附件路径无效".into());
            }
            let entry = files.get(&path).ok_or("远端清单引用的附件不存在")?;
            if entry.sha != expected {
                return Err("远端附件与清单不一致".into());
            }
            assets.push(SyncFile {
                path,
                bytes: self.blob(app, config, &token, repo, entry).await?,
            });
            self.check_cancelled(generation)?;
        }
        let extensions = if let Some(expected) = manifest.extensions {
            let entry = files.get(EXTENSIONS).ok_or("远端插件数据不存在")?;
            if entry.sha != expected {
                return Err("远端插件数据与清单不一致".into());
            }
            let state: ExtensionState =
                serde_json::from_slice(&self.blob(app, config, &token, repo, entry).await?)
                    .map_err(|_| "远端插件数据无效，未覆盖本地数据")?;
            validate_extensions(&state)?;
            self.check_cancelled(generation)?;
            Some(state)
        } else {
            None
        };
        let snapshot = SyncSnapshot {
            format: manifest.format,
            version: manifest.version,
            notebooks,
            extensions,
            source: manifest.source,
            synced_at: manifest.synced_at,
        };
        validate_snapshot(&snapshot)?;
        validate_asset_references(&snapshot, &assets.iter().map(|a| a.path.as_str()).collect())?;
        Ok(RemoteRead {
            wire: ReadRemoteResult {
                head,
                base,
                remote: Some(snapshot),
            },
            assets,
        })
    }
    pub async fn publish(
        &self,
        app: &AppHandle,
        expected_head: String,
        workspace: SyncWorkspace,
        files: Vec<SyncFile>,
    ) -> Result<PublishResult> {
        sha(&expected_head)?;
        let generation = self.cancellation.load(Ordering::SeqCst);
        let inner = self.inner.lock().await;
        let config = &inner.config;
        let token = self.token(app, config).await?;
        let repo = Self::repository(config)?;
        self.verify_repository(app, config, &token, repo).await?;
        if !self.installed(app, config, &token).await? {
            return Err("INSTALLATION_REQUIRED:请只将笔记仓库授权给 TypePro".into());
        }
        if self.head(app, config, &token, repo).await? != expected_head {
            return Err("REMOTE_CHANGED:远端已更新，请重新同步".into());
        }
        let snapshot = SyncSnapshot {
            format: "typepro-github".into(),
            version: workspace.version,
            notebooks: workspace.notebooks,
            extensions: workspace.extensions,
            source: Source {
                device_id: config.device_id.clone(),
                name: config.device_name.clone(),
                platform: if cfg!(target_os = "android") {
                    "android"
                } else {
                    "macos"
                }
                .into(),
            },
            synced_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        };
        validate_snapshot(&snapshot)?;
        let mut content = BTreeMap::new();
        let mut total = 0usize;
        for file in files {
            if !valid_file(&file.path)
                || file.path == MANIFEST
                || file.path == EXTENSIONS
                || content.contains_key(&file.path)
                || file.bytes.len() > 32 * 1024 * 1024
            {
                return Err("无效的同步文件".into());
            }
            total = total.saturating_add(file.bytes.len());
            content.insert(file.path, file.bytes);
        }
        if content.len() + 1 > MAX_FILES || total > MAX_TOTAL {
            return Err("笔记库超过同步容量限制".into());
        }
        validate_asset_references(&snapshot, &content.keys().map(String::as_str).collect())?;
        let mut books = Vec::new();
        for book in &snapshot.notebooks {
            let mut documents = Vec::new();
            for doc in &book.documents {
                let path = format!("notebooks/{}/{}.md", book.id, doc.id);
                if content.get(&path).map(Vec::as_slice) != Some(doc.markdown.as_bytes()) {
                    return Err("同步正文与本地快照不一致，请重试".into());
                }
                documents.push(Doc {
                    id: doc.id.clone(),
                    title: doc.title.clone(),
                    updated_at: doc.updated_at.clone(),
                    path,
                    sha: blob_sha(doc.markdown.as_bytes()),
                });
            }
            books.push(Book {
                id: book.id.clone(),
                name: book.name.clone(),
                cover: book.cover.clone(),
                documents,
            });
        }
        let extension_hash = if let Some(extensions) = &snapshot.extensions {
            let bytes = serde_json::to_vec(extensions).map_err(|_| "无法生成插件同步文件")?;
            let hash = blob_sha(&bytes);
            total = total.saturating_add(bytes.len());
            content.insert(EXTENSIONS.into(), bytes);
            Some(hash)
        } else {
            None
        };
        let assets = content
            .iter()
            .filter(|(p, _)| asset_path(p))
            .map(|(p, bytes)| (p.clone(), blob_sha(bytes)))
            .collect();
        let manifest = Manifest {
            format: snapshot.format.clone(),
            version: snapshot.version,
            notebooks: books,
            assets,
            extensions: extension_hash,
            source: snapshot.source.clone(),
            synced_at: snapshot.synced_at.clone(),
        };
        let manifest_bytes =
            serde_json::to_vec_pretty(&manifest).map_err(|_| "无法生成同步清单")?;
        if content.len() + 1 > MAX_FILES
            || manifest_bytes.len() > 8 * 1024 * 1024
            || total.saturating_add(manifest_bytes.len()) > MAX_TOTAL
        {
            return Err("笔记清单超过同步容量限制".into());
        }
        content.insert(MANIFEST.into(), manifest_bytes);
        let (base_tree, existing) = self.tree(app, config, &token, repo, &expected_head).await?;
        let previous = if let Some(entry) = existing.get(MANIFEST) {
            let previous: Manifest =
                serde_json::from_slice(&self.blob(app, config, &token, repo, entry).await?)
                    .map_err(|_| "远端 TypePro 清单无效，停止上传")?;
            if previous.format != "typepro-github" || previous.version != 1 {
                return Err("不支持的远端 TypePro 清单版本".into());
            }
            let owned = previous
                .notebooks
                .iter()
                .flat_map(|book| {
                    book.documents
                        .iter()
                        .map(|doc| (doc.path.as_str(), &doc.sha))
                })
                .chain(
                    previous
                        .assets
                        .iter()
                        .map(|(path, hash)| (path.as_str(), hash)),
                )
                .chain(previous.extensions.iter().map(|hash| (EXTENSIONS, hash)));
            for (path, expected_sha) in owned {
                if !valid_file(path)
                    || !existing
                        .get(path)
                        .is_some_and(|entry| &entry.sha == expected_sha)
                {
                    return Err("远端文件与 TypePro 清单不一致，未覆盖任何远端内容".into());
                }
            }
            if previous.notebooks == manifest.notebooks
                && previous.assets == manifest.assets
                && previous.extensions == manifest.extensions
            {
                let unchanged = SyncSnapshot {
                    source: previous.source,
                    synced_at: previous.synced_at,
                    ..snapshot
                };
                validate_snapshot(&unchanged)?;
                self.check_cancelled(generation)?;
                return Ok(PublishResult {
                    head: expected_head,
                    snapshot: unchanged,
                });
            }
            Some(previous)
        } else {
            None
        };
        let mut changes = Vec::new();
        for (path, bytes) in &content {
            let hash = blob_sha(bytes);
            if existing.get(path).is_some_and(|e| e.sha == hash) {
                continue;
            }
            self.check_cancelled(generation)?;
            let value = self
                .api(
                    app,
                    config,
                    &token,
                    Method::POST,
                    &["repos", &repo.owner, REPOSITORY, "git", "blobs"],
                    Some(&json!({"content": STANDARD.encode(bytes), "encoding": "base64"})),
                )
                .await?;
            if text(&value, "sha")? != hash {
                return Err("GitHub 上传文件完整性检查失败".into());
            }
            changes.push(json!({"path": path, "mode":"100644", "type":"blob", "sha":hash}));
            write_bytes(&self.cache_root(config)?.join("blobs").join(&hash), bytes)?;
        }
        // Remove only files listed in the previous TypePro manifest. Unrelated repository files survive.
        if let Some(previous) = previous {
            let previous_paths = previous
                .notebooks
                .iter()
                .flat_map(|b| b.documents.iter().map(|d| d.path.clone()))
                .chain(previous.assets.into_keys())
                .chain(previous.extensions.map(|_| EXTENSIONS.to_owned()));
            for path in previous_paths {
                if !valid_file(&path) {
                    return Err("远端 TypePro 清单路径无效".into());
                }
                if !content.contains_key(&path) && existing.contains_key(&path) {
                    changes.push(
                        json!({"path":path, "mode":"100644", "type":"blob", "sha":Value::Null}),
                    );
                }
            }
        }
        self.check_cancelled(generation)?;
        let tree = self
            .api(
                app,
                config,
                &token,
                Method::POST,
                &["repos", &repo.owner, REPOSITORY, "git", "trees"],
                Some(&json!({"base_tree":base_tree,"tree":changes})),
            )
            .await?;
        let tree = text(&tree, "sha")?;
        sha(tree)?;
        let commit = self.api(app, config, &token, Method::POST, &["repos", &repo.owner, REPOSITORY, "git", "commits"], Some(&json!({"message":format!("TypePro sync · {}", config.device_name),"tree":tree,"parents":[expected_head]}))).await?;
        let new_head = text(&commit, "sha")?.to_owned();
        sha(&new_head)?;
        self.check_cancelled(generation)?;
        // GitHub rejects concurrent sibling commits: force=false keeps the previous history intact.
        self.api(
            app,
            config,
            &token,
            Method::PATCH,
            &[
                "repos",
                &repo.owner,
                REPOSITORY,
                "git",
                "refs",
                "heads",
                &repo.default_branch,
            ],
            Some(&json!({"sha":new_head,"force":false})),
        )
        .await?;
        Ok(PublishResult {
            head: new_head,
            snapshot,
        })
    }
    pub async fn checkpoint(
        &self,
        app: &AppHandle,
        head: String,
        snapshot: SyncSnapshot,
    ) -> Result<()> {
        sha(&head)?;
        validate_snapshot(&snapshot)?;
        let mut inner = self.inner.lock().await;
        if github_secrets::load(app, &inner.config.client_id)?.is_none() {
            return Err("AUTH_REQUIRED:请先连接 GitHub".into());
        }
        Self::repository(&inner.config)?;
        write_json(
            &self.cache_root(&inner.config)?.join("base.json"),
            &Checkpoint {
                head,
                snapshot: snapshot.clone(),
            },
        )?;
        inner.config.last_synced_at =
            Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
        inner.config.last_source = Some(snapshot.source);
        self.save_config(&inner.config)
    }
}
fn config_owner(config: &Config) -> Result<&str> {
    config
        .account
        .as_ref()
        .map(|a| a.login.as_str())
        .ok_or_else(|| "AUTH_REQUIRED:请先连接 GitHub".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn git_blob_integrity_and_path_boundary() {
        assert_eq!(
            blob_sha(b"hello\n"),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
        assert!(valid_file("notebooks/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.md"));
        assert!(valid_file(
            "assets/11111111-1111-4111-8111-111111111111.png"
        ));
        for invalid in [
            "../../secret",
            "assets/../../secret",
            ".github/workflows/x.yml",
            "notebooks/x.md",
            "assets/not-a-uuid.png",
        ] {
            assert!(!valid_file(invalid));
        }
        assert!(sha("../../secret").is_err());
    }
    fn snapshot() -> SyncSnapshot {
        SyncSnapshot {
            format: "typepro-github".into(),
            version: 1,
            notebooks: vec![Notebook {
                id: "11111111-1111-4111-8111-111111111111".into(),
                name: "笔记".into(),
                cover: Some("preset:0".into()),
                documents: vec![Document {
                    id: "22222222-2222-4222-8222-222222222222".into(),
                    title: "文档".into(),
                    markdown: "![图](../../assets/33333333-3333-4333-8333-333333333333.png)".into(),
                    updated_at: "2026-10-21T00:00:00Z".into(),
                }],
            }],
            extensions: None,
            source: Source {
                device_id: "44444444-4444-4444-8444-444444444444".into(),
                name: "Mac".into(),
                platform: "macos".into(),
            },
            synced_at: "2026-10-21T00:00:00Z".into(),
        }
    }
    #[test]
    fn missing_referenced_images_are_rejected_before_import() {
        let mut snapshot = snapshot();
        validate_snapshot(&snapshot).unwrap();
        assert!(validate_asset_references(&snapshot, &BTreeSet::new()).is_err());
        let assets = BTreeSet::from(["assets/33333333-3333-4333-8333-333333333333.png"]);
        validate_asset_references(&snapshot, &assets).unwrap();
        snapshot.notebooks[0].cover =
            Some("../../assets/55555555-5555-4555-8555-555555555555.png".into());
        assert!(validate_asset_references(&snapshot, &assets).is_err());
        snapshot.notebooks[0].cover = Some("../../secret".into());
        assert!(validate_asset_references(&snapshot, &assets).is_err());
    }
    #[test]
    fn account_repository_and_branch_have_separate_merge_bases() {
        let directory = tempfile::tempdir().unwrap();
        let github = Github::new(directory.path().to_path_buf()).unwrap();
        let mut config = Config::default();
        config.account = Some(Account {
            login: "owner".into(),
            avatar_url: String::new(),
        });
        config.repository = Some(Repository {
            owner: "owner".into(),
            name: REPOSITORY.into(),
            url: String::new(),
            default_branch: "main".into(),
        });
        config.repository_id = Some(100);
        let initial = github.cache_root(&config).unwrap();
        config.repository_id = Some(101);
        assert_ne!(github.cache_root(&config).unwrap(), initial);
        config.repository_id = Some(100);
        config.repository.as_mut().unwrap().default_branch = "other/branch".into();
        assert_ne!(github.cache_root(&config).unwrap(), initial);
        config.repository.as_mut().unwrap().default_branch = "main".into();
        config.account.as_mut().unwrap().login = "other".into();
        config.repository.as_mut().unwrap().owner = "other".into();
        assert_ne!(github.cache_root(&config).unwrap(), initial);
    }
}
