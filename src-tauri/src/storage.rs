use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

type Result<T> = std::result::Result<T, String>;
const MAX_TRANSFER: usize = 128 * 1024 * 1024;
const MAX_TOTAL: u64 = 256 * 1024 * 1024;
const MAX_DOC: usize = 16 * 1024 * 1024;
const MAX_ASSET: usize = 32 * 1024 * 1024;
const MAX_FILES: usize = 10_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub updated_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Notebook {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    pub documents: Vec<Document>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub api_version: u8,
    pub permissions: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Plugin {
    pub manifest: PluginManifest,
    pub code: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Workspace {
    pub version: u8,
    pub notebooks: Vec<Notebook>,
    pub plugins: Vec<Plugin>,
}
impl Default for Workspace {
    fn default() -> Self {
        Self {
            version: 1,
            notebooks: vec![],
            plugins: vec![],
        }
    }
}
#[derive(Serialize)]
pub struct TransferFile {
    pub name: String,
    pub bytes: Vec<u8>,
}
#[derive(Serialize)]
pub struct Asset {
    pub path: String,
    pub url: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NotebookLocation {
    pub path: String,
    pub custom: bool,
}
// Deliberately separate from Workspace, Index and Manifest: absolute paths belong to this Mac.
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Locations {
    version: u8,
    notebooks: BTreeMap<String, PathBuf>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocationOwner {
    version: u8,
    notebook: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DocumentIndex {
    id: String,
    title: String,
    updated_at: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotebookIndex {
    id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cover: Option<String>,
    documents: Vec<DocumentIndex>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    version: u8,
    notebooks: Vec<NotebookIndex>,
    plugins: Vec<Plugin>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    version: u8,
    notebooks: Vec<NotebookIndex>,
}

pub struct Storage {
    pub root: PathBuf,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn valid_id(value: &str) -> Result<()> {
    let parsed = Uuid::parse_str(value).map_err(|_| "无效的笔记标识".to_string())?;
    if parsed.to_string() != value {
        return Err("笔记标识必须为标准 UUID".into());
    }
    Ok(())
}
fn document_path(notebook: &str, document: &str) -> String {
    format!("notebooks/{notebook}/{document}.md")
}
fn index_of(workspace: &Workspace) -> Index {
    Index {
        version: workspace.version,
        notebooks: workspace
            .notebooks
            .iter()
            .map(|n| NotebookIndex {
                id: n.id.clone(),
                name: n.name.clone(),
                cover: n.cover.clone(),
                documents: n
                    .documents
                    .iter()
                    .map(|d| DocumentIndex {
                        id: d.id.clone(),
                        title: d.title.clone(),
                        updated_at: d.updated_at.clone(),
                    })
                    .collect(),
            })
            .collect(),
        plugins: workspace.plugins.clone(),
    }
}
fn validate(workspace: &Workspace) -> Result<()> {
    if workspace.version != 1 {
        return Err("不支持的笔记版本".into());
    }
    if workspace.notebooks.len() > 1000 {
        return Err("笔记本数量过多".into());
    }
    let mut ids = BTreeSet::new();
    let mut count = 0;
    let mut total = 0usize;
    for notebook in &workspace.notebooks {
        valid_id(&notebook.id)?;
        cover_asset(notebook.cover.as_deref())?;
        if !ids.insert(&notebook.id) || notebook.name.len() > 1024 {
            return Err("笔记本标识重复或名称过长".into());
        }
        for document in &notebook.documents {
            valid_id(&document.id)?;
            count += 1;
            total += document.markdown.len();
            if !ids.insert(&document.id)
                || document.title.len() > 1024
                || document.updated_at.len() > 128
            {
                return Err("文档标识重复或标题过长".into());
            }
            if document.markdown.len() > MAX_DOC {
                return Err("单篇文档不能超过 16 MB".into());
            }
        }
    }
    if count > 5000 || total as u64 > MAX_TOTAL {
        return Err("笔记库超过容量限制".into());
    }
    let mut plugin_ids = BTreeSet::new();
    if workspace.plugins.len() > 100 {
        return Err("插件数量过多".into());
    }
    for plugin in &workspace.plugins {
        if plugin.manifest.api_version != 1
            || plugin.code.len() > 2 * 1024 * 1024
            || plugin.manifest.id.len() > 128
            || plugin.manifest.id.is_empty()
            || !plugin_ids.insert(&plugin.manifest.id)
        {
            return Err("插件记录无效".into());
        }
    }
    Ok(())
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("无效的文件目录")?;
    fs::create_dir_all(parent).map_err(err)?;
    let temporary = parent.join(format!(".{}.tmp", id()));
    let result = (|| {
        let mut file = File::create(&temporary).map_err(err)?;
        file.write_all(bytes).map_err(err)?;
        file.sync_all().map_err(err)?;
        fs::rename(&temporary, path).map_err(err)?;
        #[cfg(unix)]
        File::open(parent).and_then(|f| f.sync_all()).map_err(err)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
fn read_limited(path: &Path, max: usize) -> Result<Vec<u8>> {
    let mut file = File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() > max as u64 {
        return Err("文件超过容量限制".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() > max {
        return Err("文件超过容量限制".into());
    }
    Ok(bytes)
}
fn asset_name(reference: &str) -> Result<&str> {
    let name = reference
        .strip_prefix("../../assets/")
        .ok_or("无效的附件路径")?;
    let (stem, extension) = name.rsplit_once('.').ok_or("无效的附件名称")?;
    valid_id(stem)?;
    if extension.is_empty()
        || extension.len() > 12
        || !extension.bytes().all(|b| b.is_ascii_alphanumeric())
    {
        return Err("无效的附件格式".into());
    }
    Ok(name)
}
fn asset_references(markdown: &str) -> BTreeSet<String> {
    let regex = Regex::new(r"\.\./\.\./assets/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,12}").expect("static asset regex");
    regex
        .find_iter(markdown)
        .map(|m| m.as_str().to_string())
        .collect()
}
fn cover_asset(cover: Option<&str>) -> Result<Option<&str>> {
    let Some(cover) = cover else {
        return Ok(None);
    };
    if matches!(
        cover,
        "preset:0" | "preset:1" | "preset:2" | "preset:3" | "preset:4" | "preset:5"
    ) {
        return Ok(None);
    }
    asset_name(cover).map_err(|_| "无效的笔记本封面".to_string())?;
    Ok(Some(cover))
}
fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty() && e.len() <= 12 && e.bytes().all(|b| b.is_ascii_alphanumeric()))
        .unwrap_or("bin")
        .to_ascii_lowercase()
}
fn data_uri(name: &str, bytes: &[u8]) -> String {
    format!(
        "data:{};base64,{}",
        mime_guess::from_path(name).first_or_octet_stream(),
        STANDARD.encode(bytes)
    )
}
fn filename(title: &str) -> String {
    let name: String = title
        .chars()
        .filter(|c| !c.is_control() && !"/\\:*?\"<>|".contains(*c))
        .take(80)
        .collect();
    if name.trim().is_empty() {
        "未命名".into()
    } else {
        name.trim().to_string()
    }
}

fn checked_path(root: &Path, relative: &Path) -> Result<PathBuf> {
    let mut path = root.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(component) = component else {
            return Err("存储路径不能包含跳转目录".into());
        };
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("笔记存储目录中不能使用符号链接".into());
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(err(error)),
        }
    }
    Ok(path)
}

fn notebook_references(notebook: &Notebook) -> Result<BTreeSet<String>> {
    let mut references = BTreeSet::new();
    if let Some(cover) = cover_asset(notebook.cover.as_deref())? {
        references.insert(cover.to_string());
    }
    for document in &notebook.documents {
        references.extend(asset_references(&document.markdown));
    }
    Ok(references)
}

impl Storage {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root: fs::canonicalize(&root).unwrap_or(root),
        }
    }
    fn locations(&self) -> Result<Locations> {
        let path = checked_path(&self.root, Path::new("locations.json"))?;
        if !path.exists() {
            return Ok(Locations {
                version: 1,
                ..Locations::default()
            });
        }
        let locations: Locations = serde_json::from_slice(&read_limited(&path, 1024 * 1024)?)
            .map_err(|e| format!("本机目录设置无法读取，已保留原文件：{e}"))?;
        if locations.version != 1 || locations.notebooks.len() > 1000 {
            return Err("不支持的本机目录设置".into());
        }
        for (notebook, path) in &locations.notebooks {
            valid_id(notebook)?;
            if !path.is_absolute() {
                return Err("本机目录设置中包含无效路径".into());
            }
        }
        Ok(locations)
    }
    fn notebook_root(&self, notebook: &str, locations: &Locations) -> Result<PathBuf> {
        let Some(path) = locations.notebooks.get(notebook) else {
            return Ok(self.root.clone());
        };
        let canonical = fs::canonicalize(path)
            .map_err(|e| format!("笔记目录不可用：{}（{e}）", path.display()))?;
        if &canonical != path {
            return Err("笔记目录位置已变化，请恢复原目录后重试".into());
        }
        let owner: LocationOwner = serde_json::from_slice(&read_limited(
            &checked_path(path, Path::new(".typepro-notebook.json"))?,
            4096,
        )?)
        .map_err(|_| "笔记目录标识损坏，已保留原文件".to_string())?;
        if owner.version != 1 || owner.notebook != notebook {
            return Err("笔记目录与当前笔记不匹配，已保留原文件".into());
        }
        Ok(path.clone())
    }
    fn asset_bytes(&self, reference: &str, locations: &Locations) -> Result<Vec<u8>> {
        self.find_asset(reference, locations)?
            .ok_or_else(|| format!("找不到笔记引用的附件：{reference}"))
    }
    fn find_asset(&self, reference: &str, locations: &Locations) -> Result<Option<Vec<u8>>> {
        let name = asset_name(reference)?;
        let relative = Path::new("assets").join(name);
        let global = checked_path(&self.root, &relative)?;
        if global.exists() {
            return read_limited(&global, MAX_ASSET).map(Some);
        }
        // Externally edited Markdown can introduce an attachment that exists only beside it.
        for notebook in locations.notebooks.keys() {
            let Ok(root) = self.notebook_root(notebook, locations) else {
                continue;
            };
            let path = checked_path(&root, &relative)?;
            if path.exists() {
                return read_limited(&path, MAX_ASSET).map(Some);
            }
        }
        Ok(None)
    }
    fn copy_assets(
        &self,
        notebook: &Notebook,
        root: &Path,
        locations: &Locations,
        require_all: bool,
    ) -> Result<()> {
        for reference in notebook_references(notebook)? {
            let name = asset_name(&reference)?;
            let Some(bytes) = self.find_asset(&reference, locations)? else {
                if require_all {
                    return Err(format!("找不到笔记引用的附件：{name}"));
                }
                // An already missing image must not prevent saving unrelated legacy Markdown.
                continue;
            };
            let target = checked_path(root, &Path::new("assets").join(name))?;
            if target.exists() {
                if read_limited(&target, MAX_ASSET)? != bytes {
                    return Err(format!("附件名称冲突，未覆盖原文件：{name}"));
                }
            } else {
                atomic_write(&target, &bytes)?;
            }
        }
        Ok(())
    }
    pub fn get_notebook_location(&self, notebook_id: &str) -> Result<NotebookLocation> {
        if cfg!(mobile) {
            return Err("手机版不支持自定义笔记目录".into());
        }
        let workspace = self.load()?;
        if !workspace.notebooks.iter().any(|n| n.id == notebook_id) {
            return Err("笔记本不存在".into());
        }
        let locations = self.locations()?;
        Ok(NotebookLocation {
            path: self
                .notebook_root(notebook_id, &locations)?
                .to_string_lossy()
                .into_owned(),
            custom: locations.notebooks.contains_key(notebook_id),
        })
    }
    pub fn set_notebook_location(
        &self,
        notebook_id: &str,
        path: Option<&str>,
    ) -> Result<NotebookLocation> {
        if cfg!(mobile) {
            return Err("手机版不支持自定义笔记目录".into());
        }
        valid_id(notebook_id)?;
        let workspace = self.load()?;
        let notebook = workspace
            .notebooks
            .iter()
            .find(|n| n.id == notebook_id)
            .ok_or("笔记本不存在")?;
        let mut locations = self.locations()?;
        let source = self.notebook_root(notebook_id, &locations)?;
        let default = fs::canonicalize(&self.root).map_err(err)?;
        let target = if let Some(path) = path {
            let expanded = if let Some(relative) = path.strip_prefix("~/") {
                PathBuf::from(std::env::var_os("HOME").ok_or("无法确定用户目录")?).join(relative)
            } else {
                PathBuf::from(path)
            };
            if !expanded.is_absolute()
                || expanded
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err("请选择绝对路径，不能包含 ..".into());
            }
            // The native picker selects existing directories. Typed paths must likewise exist;
            // never create a potentially mistyped parent tree outside the chosen directory.
            let target =
                fs::canonicalize(&expanded).map_err(|e| format!("目录不存在或无法访问：{e}"))?;
            if !target.is_dir() {
                return Err("请选择文件夹".into());
            }
            target
        } else {
            default.clone()
        };
        if source == target {
            return self.get_notebook_location(notebook_id);
        }
        if path.is_some() && (target.starts_with(&default) || default.starts_with(&target)) {
            return Err("自定义目录不能位于应用存储目录内或包含应用存储目录".into());
        }
        for (other, root) in &locations.notebooks {
            if (other != notebook_id || root != &target)
                && (target.starts_with(root) || root.starts_with(&target))
            {
                return Err("笔记目录不能重叠或互相包含".into());
            }
        }
        if source.starts_with(&target) || target.starts_with(&source) {
            return Err("新旧笔记目录不能互相包含".into());
        }
        if target != default {
            let marker = checked_path(&target, Path::new(".typepro-notebook.json"))?;
            if marker.exists() {
                let owner: LocationOwner =
                    serde_json::from_slice(&read_limited(&marker, 4096)?).map_err(err)?;
                if owner.version != 1 || owner.notebook != notebook_id {
                    return Err("此目录属于其他笔记，请选择空文件夹".into());
                }
            } else if fs::read_dir(&target).map_err(err)?.next().is_some() {
                return Err("请选择空文件夹，或此笔记以前使用的目录".into());
            }
        }
        // Stage and validate every byte before touching any live document or the path mapping.
        let stage = checked_path(
            &target,
            &PathBuf::from(format!(".typepro-migrate-{}", id())),
        )?;
        fs::create_dir(&stage).map_err(err)?;
        let result = (|| {
            self.copy_assets(notebook, &stage, &locations, true)?;
            for document in &notebook.documents {
                atomic_write(
                    &stage.join(document_path(notebook_id, &document.id)),
                    document.markdown.as_bytes(),
                )?;
            }
            let staged_book = stage.join("notebooks").join(notebook_id);
            fs::create_dir_all(&staged_book).map_err(err)?;
            let target_book = checked_path(&target, &Path::new("notebooks").join(notebook_id))?;
            let assets = checked_path(&target, Path::new("assets"))?;
            fs::create_dir_all(&assets).map_err(err)?;
            for reference in notebook_references(notebook)? {
                let name = asset_name(&reference)?;
                let destination = checked_path(&target, &Path::new("assets").join(name))?;
                let bytes = read_limited(&stage.join("assets").join(name), MAX_ASSET)?;
                if destination.exists() && read_limited(&destination, MAX_ASSET)? != bytes {
                    return Err(format!("附件名称冲突，未覆盖原文件：{name}"));
                }
                if !destination.exists() {
                    atomic_write(&destination, &bytes)?;
                }
            }
            if target != default {
                atomic_write(
                    &target.join(".typepro-notebook.json"),
                    &serde_json::to_vec(&LocationOwner {
                        version: 1,
                        notebook: notebook_id.to_string(),
                    })
                    .map_err(err)?,
                )?;
            }
            if source == default {
                // Keep the original default copy even after a later notebook deletion.
                atomic_write(
                    &checked_path(
                        &source,
                        &Path::new("notebooks")
                            .join(notebook_id)
                            .join(".typepro-preserved"),
                    )?,
                    b"1",
                )?;
            }
            fs::create_dir_all(target_book.parent().ok_or("无效的笔记目录")?).map_err(err)?;
            let backup = if target_book.exists() {
                let history = checked_path(
                    &target,
                    &Path::new(".typepro-history").join(notebook_id).join(id()),
                )?;
                fs::create_dir_all(history.parent().ok_or("无效的备份目录")?).map_err(err)?;
                fs::rename(&target_book, &history).map_err(err)?;
                Some(history)
            } else {
                None
            };
            if let Err(error) = fs::rename(&staged_book, &target_book) {
                if let Some(backup) = backup {
                    let _ = fs::rename(backup, &target_book);
                }
                return Err(err(error));
            }
            #[cfg(unix)]
            File::open(target_book.parent().ok_or("无效的笔记目录")?)
                .and_then(|directory| directory.sync_all())
                .map_err(err)?;
            if target == default {
                locations.notebooks.remove(notebook_id);
            } else {
                locations
                    .notebooks
                    .insert(notebook_id.to_string(), target.clone());
            }
            let bytes = serde_json::to_vec_pretty(&locations).map_err(err)?;
            let location_path = self.root.join("locations.json");
            if let Err(error) = atomic_write(&location_path, &bytes) {
                // A directory fsync can fail after the atomic rename already committed.
                if fs::read(&location_path).ok().as_deref() != Some(bytes.as_slice()) {
                    return Err(error);
                }
            }
            Ok(NotebookLocation {
                path: target.to_string_lossy().into_owned(),
                custom: target != default,
            })
        })();
        let _ = fs::remove_dir_all(stage);
        result
    }
    fn apply(&self, workspace: &Workspace) -> Result<()> {
        validate(workspace)?;
        let locations = self.locations()?;
        for notebook in &workspace.notebooks {
            let root = self.notebook_root(&notebook.id, &locations)?;
            self.copy_assets(notebook, &root, &locations, false)?;
            for document in &notebook.documents {
                let path =
                    checked_path(&root, Path::new(&document_path(&notebook.id, &document.id)))?;
                // Avoid rewriting unchanged files, keeping external editors and file watchers useful.
                if fs::read(&path).ok().as_deref() != Some(document.markdown.as_bytes()) {
                    atomic_write(&path, document.markdown.as_bytes())?;
                }
            }
        }
        atomic_write(
            &self.root.join("index.json"),
            &serde_json::to_vec_pretty(&index_of(workspace)).map_err(err)?,
        )?;
        Ok(())
    }
    fn recover(&self) -> Result<()> {
        let pending = self.root.join("pending.json");
        if pending.exists() {
            let workspace: Workspace = serde_json::from_slice(&read_limited(
                &pending,
                MAX_TOTAL as usize + 256 * 1024 * 1024,
            )?)
            .map_err(|e| format!("保存恢复记录损坏，已保留原文件：{e}"))?;
            self.apply(&workspace)?;
            fs::remove_file(pending).map_err(err)?;
        }
        Ok(())
    }
    pub fn load(&self) -> Result<Workspace> {
        self.recover()?;
        let index_path = self.root.join("index.json");
        if !index_path.exists() {
            return Ok(Workspace::default());
        }
        let index: Index = serde_json::from_slice(&read_limited(&index_path, MAX_TOTAL as usize)?)
            .map_err(|e| format!("笔记索引无法读取，原文件已保留：{e}"))?;
        if index.version != 1 {
            return Err("不支持的笔记版本".into());
        }
        let mut workspace = Workspace {
            version: 1,
            notebooks: vec![],
            plugins: index.plugins,
        };
        let locations = self.locations()?;
        for notebook in index.notebooks {
            valid_id(&notebook.id)?;
            let root = self.notebook_root(&notebook.id, &locations)?;
            let mut documents = vec![];
            for document in notebook.documents {
                valid_id(&document.id)?;
                let path =
                    checked_path(&root, Path::new(&document_path(&notebook.id, &document.id)))?;
                let markdown = String::from_utf8(read_limited(&path, MAX_DOC)?).map_err(err)?;
                documents.push(Document {
                    id: document.id,
                    title: document.title,
                    markdown,
                    updated_at: document.updated_at,
                });
            }
            workspace.notebooks.push(Notebook {
                id: notebook.id,
                name: notebook.name,
                cover: notebook.cover,
                documents,
            });
        }
        validate(&workspace)?;
        Ok(workspace)
    }
    pub fn save(&self, workspace: &Workspace) -> Result<()> {
        validate(workspace)?;
        self.recover()?;
        // Never replace a corrupt or unreadable index with an empty frontend state.
        if self.root.join("index.json").exists() {
            self.load()?;
        }
        let locations = self.locations()?;
        for notebook in &workspace.notebooks {
            let root = self.notebook_root(&notebook.id, &locations)?;
            // Input errors must not leave a recovery journal that retries invalid data forever.
            self.copy_assets(notebook, &root, &locations, false)?;
        }
        atomic_write(
            &self.root.join("pending.json"),
            &serde_json::to_vec(workspace).map_err(err)?,
        )?;
        self.apply(workspace)?;
        fs::remove_file(self.root.join("pending.json")).map_err(err)?;
        self.clean_removed_documents(workspace);
        let mut locations = self.locations()?;
        let old_count = locations.notebooks.len();
        locations
            .notebooks
            .retain(|id, _| workspace.notebooks.iter().any(|n| &n.id == id));
        if locations.notebooks.len() != old_count {
            atomic_write(
                &self.root.join("locations.json"),
                &serde_json::to_vec_pretty(&locations).map_err(err)?,
            )?;
        }
        Ok(())
    }
    fn clean_removed_documents(&self, workspace: &Workspace) {
        let keep: BTreeSet<String> = workspace
            .notebooks
            .iter()
            .flat_map(|n| n.documents.iter().map(|d| document_path(&n.id, &d.id)))
            .collect();
        let Ok(notebooks) = fs::read_dir(self.root.join("notebooks")) else {
            return;
        };
        for notebook in notebooks.flatten() {
            let Some(n) = notebook.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if valid_id(&n).is_err() || !notebook.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let Ok(documents) = fs::read_dir(notebook.path()) else {
                continue;
            };
            if notebook.path().join(".typepro-preserved").exists() {
                continue;
            }
            for document in documents.flatten() {
                let path = document.path();
                let Some(d) = path.file_stem().and_then(|d| d.to_str()) else {
                    continue;
                };
                if path.extension().and_then(|e| e.to_str()) == Some("md")
                    && valid_id(d).is_ok()
                    && !keep.contains(&document_path(&n, d))
                {
                    let _ = fs::remove_file(path);
                }
            }
            let _ = fs::remove_dir(notebook.path());
        }
    }
    pub fn save_asset(&self, name: &str, bytes: &[u8]) -> Result<Asset> {
        if bytes.len() > MAX_ASSET {
            return Err("单个附件不能超过 32 MB".into());
        }
        let name = format!("{}.{}", id(), extension(name));
        atomic_write(
            &checked_path(&self.root, &Path::new("assets").join(&name))?,
            bytes,
        )?;
        Ok(Asset {
            path: format!("../../assets/{name}"),
            url: data_uri(&name, bytes),
        })
    }
    pub fn resolve_asset(&self, reference: &str) -> Result<String> {
        let name = asset_name(reference)?;
        let bytes = self.asset_bytes(reference, &self.locations()?)?;
        Ok(data_uri(name, &bytes))
    }
    fn selection(&self, notebook_id: Option<&str>, document_id: Option<&str>) -> Result<Workspace> {
        if document_id.is_some() && notebook_id.is_none() {
            return Err("请先选择笔记本".into());
        }
        let mut workspace = self.load()?;
        if let Some(notebook_id) = notebook_id {
            valid_id(notebook_id)?;
            workspace.notebooks.retain(|n| n.id == notebook_id);
            if workspace.notebooks.is_empty() {
                return Err("笔记本不存在".into());
            }
        }
        if let Some(document_id) = document_id {
            valid_id(document_id)?;
            workspace.notebooks[0]
                .documents
                .retain(|d| d.id == document_id);
            if workspace.notebooks[0].documents.is_empty() {
                return Err("文档不存在".into());
            }
        }
        Ok(workspace)
    }
    pub fn export_markdown(&self, notebook_id: &str, document_id: &str) -> Result<TransferFile> {
        let workspace = self.selection(Some(notebook_id), Some(document_id))?;
        let document = &workspace.notebooks[0].documents[0];
        Ok(TransferFile {
            name: format!("{}.md", filename(&document.title)),
            bytes: document.markdown.as_bytes().to_vec(),
        })
    }
    pub fn export(
        &self,
        notebook_id: Option<&str>,
        document_id: Option<&str>,
    ) -> Result<TransferFile> {
        let workspace = self.selection(notebook_id, document_id)?;
        let index = index_of(&workspace);
        let manifest = Manifest {
            format: "local-notebook".into(),
            version: 1,
            notebooks: index.notebooks,
        };
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options).map_err(err)?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(err)?)
            .map_err(err)?;
        let mut references = BTreeSet::new();
        let mut total = 0usize;
        for notebook in &workspace.notebooks {
            if let Some(reference) = cover_asset(notebook.cover.as_deref())? {
                references.insert(reference.to_string());
            }
            for document in &notebook.documents {
                total += document.markdown.len();
                zip.start_file(document_path(&notebook.id, &document.id), options)
                    .map_err(err)?;
                zip.write_all(document.markdown.as_bytes()).map_err(err)?;
                references.extend(asset_references(&document.markdown));
            }
        }
        for reference in references {
            let name = asset_name(&reference)?;
            let bytes = self.asset_bytes(&reference, &self.locations()?)?;
            total += bytes.len();
            if total as u64 > MAX_TOTAL {
                return Err("导出内容超过 256 MB，请分笔记本导出".into());
            }
            zip.start_file(format!("assets/{name}"), options)
                .map_err(err)?;
            zip.write_all(&bytes).map_err(err)?;
        }
        let bytes = zip.finish().map_err(err)?.into_inner();
        if bytes.len() > MAX_TRANSFER {
            return Err("导出文件超过 128 MB，请分笔记本导出".into());
        }
        let title = if document_id.is_some() {
            &workspace.notebooks[0].documents[0].title
        } else if notebook_id.is_some() {
            &workspace.notebooks[0].name
        } else {
            "全部笔记"
        };
        Ok(TransferFile {
            name: format!("{}.zip", filename(title)),
            bytes,
        })
    }
    pub fn import(&self, name: &str, bytes: &[u8], notebook_id: Option<&str>) -> Result<Workspace> {
        if bytes.len() > MAX_TRANSFER {
            return Err("导入文件不能超过 128 MB".into());
        }
        let mut workspace = self.load()?;
        // Some Android document providers return an opaque URI or no display name.
        let format = if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
            "zip".to_string()
        } else {
            extension(name)
        };
        match format.as_str() {
            "md" | "markdown" => {
                if bytes.len() > MAX_DOC {
                    return Err("单篇文档不能超过 16 MB".into());
                }
                let markdown = String::from_utf8(bytes.to_vec())
                    .map_err(|_| "Markdown 文件必须为 UTF-8".to_string())?;
                let title = Path::new(name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("导入文档")
                    .to_string();
                let target = if let Some(notebook_id) = notebook_id {
                    valid_id(notebook_id)?;
                    workspace
                        .notebooks
                        .iter_mut()
                        .find(|n| n.id == notebook_id)
                        .ok_or("目标笔记本不存在")?
                } else {
                    workspace.notebooks.push(Notebook {
                        id: id(),
                        name: "导入的笔记".into(),
                        cover: None,
                        documents: vec![],
                    });
                    workspace.notebooks.last_mut().unwrap()
                };
                target.documents.push(Document {
                    id: id(),
                    title,
                    markdown,
                    updated_at: chrono::Utc::now().to_rfc3339(),
                });
            }
            "zip" => self.import_zip(bytes, &mut workspace)?,
            _ => return Err("请选择 Markdown 或笔记 ZIP 文件".into()),
        }
        self.save(&workspace)?;
        Ok(workspace)
    }
    fn import_zip(&self, bytes: &[u8], workspace: &mut Workspace) -> Result<()> {
        let mut zip =
            ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("无法读取 ZIP：{e}"))?;
        if zip.len() > MAX_FILES {
            return Err("ZIP 文件数量过多".into());
        }
        let mut files = BTreeMap::new();
        let mut total = 0u64;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(err)?;
            let name = entry.name().to_string();
            if entry.enclosed_name().is_none()
                || name.starts_with('/')
                || name.contains('\\')
                || name.split('/').any(|p| p == ".." || p == ".")
                || entry
                    .unix_mode()
                    .map(|m| m & 0o170000 == 0o120000)
                    .unwrap_or(false)
            {
                return Err("ZIP 包含不安全路径".into());
            }
            if entry.is_dir() {
                continue;
            }
            total = total.checked_add(entry.size()).ok_or("ZIP 容量溢出")?;
            if entry.size() > MAX_ASSET as u64 || total > MAX_TOTAL {
                return Err("ZIP 解压内容超过容量限制".into());
            }
            let mut data = vec![];
            entry
                .by_ref()
                .take(MAX_ASSET as u64 + 1)
                .read_to_end(&mut data)
                .map_err(err)?;
            if data.len() as u64 != entry.size() {
                return Err("ZIP 文件大小与目录声明不一致".into());
            }
            if data.len() > MAX_ASSET || files.insert(name, data).is_some() {
                return Err("ZIP 包含超大或重复文件".into());
            }
        }
        let manifest: Manifest = serde_json::from_slice(
            files
                .get("manifest.json")
                .ok_or("不是笔记导出的 ZIP（缺少 manifest.json）")?,
        )
        .map_err(err)?;
        if manifest.format != "local-notebook" || manifest.version != 1 {
            return Err("不支持的 ZIP 笔记版本".into());
        }
        let mut imported = Workspace::default();
        let mut references = BTreeSet::new();
        for notebook in manifest.notebooks {
            valid_id(&notebook.id)?;
            if let Some(reference) = cover_asset(notebook.cover.as_deref())? {
                references.insert(reference.to_string());
            }
            let mut documents = vec![];
            for document in notebook.documents {
                valid_id(&document.id)?;
                let markdown = String::from_utf8(
                    files
                        .get(&document_path(&notebook.id, &document.id))
                        .ok_or("ZIP 缺少文档")?
                        .clone(),
                )
                .map_err(err)?;
                references.extend(asset_references(&markdown));
                documents.push(Document {
                    id: document.id,
                    title: document.title,
                    markdown,
                    updated_at: document.updated_at,
                });
            }
            imported.notebooks.push(Notebook {
                id: notebook.id,
                name: notebook.name,
                cover: notebook.cover,
                documents,
            });
        }
        validate(&imported)?;
        let mut replacements = BTreeMap::new();
        for reference in references {
            let name = asset_name(&reference)?;
            let data = files
                .get(&format!("assets/{name}"))
                .ok_or("ZIP 缺少引用的附件")?;
            let asset = self.save_asset(name, data)?;
            replacements.insert(reference, asset.path);
        }
        for mut notebook in imported.notebooks {
            notebook.id = id();
            if let Some(replacement) = notebook
                .cover
                .as_ref()
                .and_then(|cover| replacements.get(cover))
            {
                notebook.cover = Some(replacement.clone());
            }
            for document in &mut notebook.documents {
                document.id = id();
                for (old, new) in &replacements {
                    document.markdown = document.markdown.replace(old, new);
                }
            }
            workspace.notebooks.push(notebook);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::new(dir.path().to_path_buf());
        (dir, storage)
    }
    fn sample() -> Workspace {
        Workspace {
            version: 1,
            notebooks: vec![Notebook {
                id: id(),
                name: "工作".into(),
                cover: None,
                documents: vec![Document {
                    id: id(),
                    title: "第一篇".into(),
                    markdown: "# 你好\n\n- [x] 离线笔记\n".into(),
                    updated_at: "2026-10-20T00:00:00Z".into(),
                }],
            }],
            plugins: vec![],
        }
    }
    #[test]
    fn document_export_requires_a_valid_notebook_even_in_empty_workspace() {
        let (_dir, s) = store();
        let document = id();
        assert!(s.export(None, Some(&document)).is_err());
        assert!(s.export(Some(&id()), Some(&document)).is_err());
    }
    #[test]
    fn zip_import_uses_magic_when_provider_has_no_filename() {
        let (_dir, s) = store();
        s.save(&sample()).unwrap();
        let archive = s.export(None, None).unwrap();
        let imported = s
            .import("opaque-provider-id", &archive.bytes, None)
            .unwrap();
        assert_eq!(imported.notebooks.len(), 2);
    }
    #[test]
    fn saves_actual_markdown_and_honors_external_edits() {
        let (_dir, s) = store();
        let w = sample();
        s.save(&w).unwrap();
        assert_eq!(s.load().unwrap(), w);
        let path = s.root.join(document_path(
            &w.notebooks[0].id,
            &w.notebooks[0].documents[0].id,
        ));
        fs::write(path, "external\n").unwrap();
        assert_eq!(
            s.load().unwrap().notebooks[0].documents[0].markdown,
            "external\n"
        );
    }
    #[test]
    fn interrupted_save_recovers_from_journal() {
        let (_dir, s) = store();
        let w = sample();
        atomic_write(
            &s.root.join("pending.json"),
            &serde_json::to_vec(&w).unwrap(),
        )
        .unwrap();
        assert_eq!(s.load().unwrap(), w);
        assert!(!s.root.join("pending.json").exists());
    }
    #[test]
    fn corrupt_index_cannot_be_overwritten() {
        let (_dir, s) = store();
        fs::write(s.root.join("index.json"), b"corrupt").unwrap();
        assert!(s.save(&Workspace::default()).is_err());
        assert_eq!(fs::read(s.root.join("index.json")).unwrap(), b"corrupt");
    }
    #[test]
    fn zip_roundtrip_keeps_assets_and_duplicates() {
        let (_dir, s) = store();
        let mut w = sample();
        let a = s.save_asset("test.png", b"image bytes").unwrap();
        w.notebooks[0].documents[0]
            .markdown
            .push_str(&format!("![image]({})", a.path));
        s.save(&w).unwrap();
        let zip = s.export(None, None).unwrap();
        let result = s.import("archive.zip", &zip.bytes, None).unwrap();
        assert_eq!(result.notebooks.len(), 2);
        assert_ne!(result.notebooks[0].id, result.notebooks[1].id);
        let imported = &result.notebooks[1].documents[0].markdown;
        let asset = asset_references(imported).into_iter().next().unwrap();
        assert_ne!(asset, a.path);
        assert_eq!(s.resolve_asset(&asset).unwrap(), a.url);
    }
    #[test]
    fn covers_roundtrip_with_shared_and_cover_only_assets() {
        let (_dir, s) = store();
        let mut w = sample();
        let asset = s.save_asset("cover.png", b"cover bytes").unwrap();
        w.notebooks[0].cover = Some(asset.path.clone());
        w.notebooks[0].documents[0].markdown = format!("![shared]({})", asset.path);
        w.notebooks.push(Notebook {
            id: id(),
            name: "空笔记本".into(),
            cover: Some(asset.path.clone()),
            documents: vec![],
        });
        s.save(&w).unwrap();
        assert_eq!(s.load().unwrap(), w);
        let bundle = s.export(None, None).unwrap();
        let archive = ZipArchive::new(Cursor::new(&bundle.bytes)).unwrap();
        assert_eq!(
            archive
                .file_names()
                .filter(|name| name.starts_with("assets/"))
                .count(),
            1
        );
        let merged = s.import("covers.zip", &bundle.bytes, None).unwrap();
        assert_eq!(merged.notebooks.len(), 4);
        assert_eq!(&merged.notebooks[..2], &w.notebooks);
        let imported_cover = merged.notebooks[2].cover.as_deref().unwrap();
        assert_ne!(imported_cover, asset.path);
        assert_eq!(merged.notebooks[3].cover.as_deref(), Some(imported_cover));
        assert!(merged.notebooks[3].documents.is_empty());
        assert_eq!(s.resolve_asset(imported_cover).unwrap(), asset.url);
        assert!(merged.notebooks[2].documents[0]
            .markdown
            .contains(imported_cover));
        assert_eq!(s.load().unwrap(), merged);
    }
    #[test]
    fn all_preset_covers_survive_storage_and_zip() {
        let (_dir, s) = store();
        let mut w = Workspace::default();
        for preset in 0..=5 {
            w.notebooks.push(Notebook {
                id: id(),
                name: format!("封面 {preset}"),
                cover: Some(format!("preset:{preset}")),
                documents: vec![],
            });
        }
        s.save(&w).unwrap();
        assert_eq!(s.load().unwrap(), w);
        let bundle = s.export(None, None).unwrap();
        let (_target_dir, target) = store();
        let imported = target.import("presets.zip", &bundle.bytes, None).unwrap();
        for (original, imported) in w.notebooks.iter().zip(&imported.notebooks) {
            assert_eq!(original.cover, imported.cover);
            assert_ne!(original.id, imported.id);
        }
    }
    #[test]
    fn legacy_workspace_index_and_zip_without_cover_stay_compatible() {
        let (_dir, s) = store();
        let w = sample();
        let legacy_json = serde_json::to_value(&w).unwrap();
        assert!(legacy_json["notebooks"][0].get("cover").is_none());
        let legacy_workspace: Workspace = serde_json::from_value(legacy_json).unwrap();
        s.save(&legacy_workspace).unwrap();
        let index: serde_json::Value =
            serde_json::from_slice(&fs::read(s.root.join("index.json")).unwrap()).unwrap();
        assert!(index["notebooks"][0].get("cover").is_none());
        assert_eq!(s.load().unwrap(), w);
        let bundle = s.export(None, None).unwrap();
        let (_target_dir, target) = store();
        let imported = target.import("legacy.zip", &bundle.bytes, None).unwrap();
        assert_eq!(imported.notebooks[0].cover, None);
        assert_eq!(
            imported.notebooks[0].documents[0].markdown,
            w.notebooks[0].documents[0].markdown
        );
    }
    #[test]
    fn invalid_or_missing_cover_assets_do_not_replace_existing_notes() {
        let (_dir, s) = store();
        let w = sample();
        s.save(&w).unwrap();
        let missing_asset = format!("../../assets/{}.png", id());
        for cover in [
            "preset:6",
            "preset:01",
            "",
            "https://example.com/cover.png",
            "../../assets/../../index.json",
            &missing_asset,
        ] {
            let mut invalid = sample();
            invalid.notebooks[0].cover = Some(cover.into());
            invalid.notebooks[0].documents.clear();
            if cover != missing_asset {
                assert!(s.save(&invalid).is_err());
            }
            let manifest = Manifest {
                format: "local-notebook".into(),
                version: 1,
                notebooks: index_of(&invalid).notebooks,
            };
            let mut zip = ZipWriter::new(Cursor::new(vec![]));
            zip.start_file("manifest.json", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&serde_json::to_vec(&manifest).unwrap())
                .unwrap();
            assert!(s
                .import(
                    "invalid-cover.zip",
                    &zip.finish().unwrap().into_inner(),
                    None
                )
                .is_err());
            assert_eq!(s.load().unwrap(), w);
        }
    }
    #[test]
    fn rejects_traversal_and_keeps_existing_state() {
        let (_dir, s) = store();
        let w = sample();
        s.save(&w).unwrap();
        assert!(s.resolve_asset("../../assets/../../index.json").is_err());
        let mut zip = ZipWriter::new(Cursor::new(vec![]));
        zip.start_file("../escape.md", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"escape").unwrap();
        assert!(s
            .import("bad.zip", &zip.finish().unwrap().into_inner(), None)
            .is_err());
        assert_eq!(s.load().unwrap(), w);
    }
    #[test]
    fn removal_only_happens_after_committed_index() {
        let (_dir, s) = store();
        let w = sample();
        s.save(&w).unwrap();
        let path = s.root.join(document_path(
            &w.notebooks[0].id,
            &w.notebooks[0].documents[0].id,
        ));
        s.save(&Workspace::default()).unwrap();
        assert!(!path.exists());
        assert_eq!(s.load().unwrap(), Workspace::default());
    }
    #[test]
    fn utf8_markdown_import_is_lossless_and_invalid_ids_fail() {
        let (_dir, s) = store();
        let text = "---\ntitle: 测试\n---\n$x^2$\n";
        let w = s.import("test.md", text.as_bytes(), None).unwrap();
        assert_eq!(w.notebooks[0].documents[0].markdown, text);
        let mut invalid = sample();
        invalid.notebooks[0].id = "../../escape".into();
        assert!(s.save(&invalid).is_err());
    }
    #[test]
    #[cfg(not(mobile))]
    fn custom_directory_migration_keeps_sources_and_relative_attachments() {
        let (_dir, s) = store();
        let target = tempfile::tempdir().unwrap();
        let mut workspace = sample();
        let asset = s.save_asset("image.png", b"portable image").unwrap();
        workspace.notebooks[0].cover = Some(asset.path.clone());
        workspace.notebooks[0].documents[0]
            .markdown
            .push_str(&format!("\n![image]({})", asset.path));
        s.save(&workspace).unwrap();
        let book = &workspace.notebooks[0];
        let relative = document_path(&book.id, &book.documents[0].id);
        let original = fs::read(s.root.join(&relative)).unwrap();
        let location = s
            .set_notebook_location(&book.id, target.path().to_str())
            .unwrap();
        let target = PathBuf::from(&location.path);
        assert!(location.custom);
        assert_eq!(fs::read(target.join(&relative)).unwrap(), original);
        assert_eq!(fs::read(s.root.join(&relative)).unwrap(), original);
        assert_eq!(
            fs::read(target.join("assets").join(asset_name(&asset.path).unwrap())).unwrap(),
            b"portable image"
        );
        // Relative paths resolve as ordinary files, without TypePro or an absolute path rewrite.
        assert_eq!(
            fs::read(target.join(&relative).parent().unwrap().join(&asset.path)).unwrap(),
            b"portable image"
        );
        assert_eq!(s.load().unwrap(), workspace);
        assert_eq!(s.get_notebook_location(&book.id).unwrap(), location);
        assert!(!serde_json::to_string(&workspace)
            .unwrap()
            .contains(&location.path));
        let bundle = s.export(Some(&book.id), None).unwrap();
        let mut zip = ZipArchive::new(Cursor::new(&bundle.bytes)).unwrap();
        assert!(zip.by_name("locations.json").is_err());
        let mut manifest = String::new();
        zip.by_name("manifest.json")
            .unwrap()
            .read_to_string(&mut manifest)
            .unwrap();
        assert!(!manifest.contains(&location.path));
        let (_portable_dir, portable) = store();
        let imported = portable
            .import("notebook.zip", &bundle.bytes, None)
            .unwrap();
        assert_eq!(
            portable
                .resolve_asset(imported.notebooks[0].cover.as_deref().unwrap())
                .unwrap(),
            asset.url
        );
        assert!(!portable.root.join("locations.json").exists());
    }
    #[test]
    #[cfg(not(mobile))]
    fn custom_directory_saves_new_assets_external_changes_and_return_to_default() {
        let (_dir, s) = store();
        let external = tempfile::tempdir().unwrap();
        let mut workspace = sample();
        s.save(&workspace).unwrap();
        let book_id = workspace.notebooks[0].id.clone();
        let relative = document_path(&book_id, &workspace.notebooks[0].documents[0].id);
        let original = fs::read(s.root.join(&relative)).unwrap();
        let location = s
            .set_notebook_location(&book_id, external.path().to_str())
            .unwrap();
        let root = PathBuf::from(location.path);
        let asset = s.save_asset("new.svg", b"new asset").unwrap();
        workspace.notebooks[0].documents[0].markdown =
            format!("new content\n![new]({})", asset.path);
        s.save(&workspace).unwrap();
        assert_eq!(fs::read(s.root.join(&relative)).unwrap(), original);
        assert_eq!(
            fs::read(root.join("assets").join(asset_name(&asset.path).unwrap())).unwrap(),
            b"new asset"
        );
        // An external edit and a new adjacent attachment are visible to load, resolve and ZIP.
        let external_name = format!("{}.png", id());
        fs::write(root.join("assets").join(&external_name), b"external asset").unwrap();
        let external_reference = format!("../../assets/{external_name}");
        let markdown = format!("# external\n![outside]({external_reference})");
        fs::write(root.join(&relative), &markdown).unwrap();
        let loaded = s.load().unwrap();
        assert_eq!(loaded.notebooks[0].documents[0].markdown, markdown);
        assert!(s
            .resolve_asset(&external_reference)
            .unwrap()
            .ends_with(&STANDARD.encode(b"external asset")));
        let bundle = s.export(Some(&book_id), None).unwrap();
        let (_portable_dir, portable) = store();
        let imported = portable
            .import("external.zip", &bundle.bytes, None)
            .unwrap();
        let imported_reference = asset_references(&imported.notebooks[0].documents[0].markdown)
            .into_iter()
            .next()
            .unwrap();
        assert!(portable
            .resolve_asset(&imported_reference)
            .unwrap()
            .ends_with(&STANDARD.encode(b"external asset")));
        let location = s.set_notebook_location(&book_id, None).unwrap();
        assert!(!location.custom);
        assert_eq!(
            fs::read_to_string(s.root.join(&relative)).unwrap(),
            markdown
        );
        assert_eq!(fs::read_to_string(root.join(&relative)).unwrap(), markdown);
        let history = s.root.join(".typepro-history").join(&book_id);
        let backup = fs::read_dir(history)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read(backup.join(Path::new(&relative).file_name().unwrap())).unwrap(),
            original
        );
        assert_eq!(s.load().unwrap(), loaded);
    }
    #[test]
    #[cfg(not(mobile))]
    fn failed_migration_and_path_collisions_leave_source_usable() {
        let (_dir, s) = store();
        let target = tempfile::tempdir().unwrap();
        let workspace = sample();
        s.save(&workspace).unwrap();
        let book = &workspace.notebooks[0];
        let relative = document_path(&book.id, &book.documents[0].id);
        fs::write(target.path().join("unrelated.txt"), b"do not touch").unwrap();
        assert!(s
            .set_notebook_location(&book.id, target.path().to_str())
            .is_err());
        assert_eq!(
            fs::read(target.path().join("unrelated.txt")).unwrap(),
            b"do not touch"
        );
        fs::remove_file(target.path().join("unrelated.txt")).unwrap();
        // A managed destination with a blocked document directory fails after staging bytes.
        atomic_write(
            &target.path().join(".typepro-notebook.json"),
            &serde_json::to_vec(&LocationOwner {
                version: 1,
                notebook: book.id.clone(),
            })
            .unwrap(),
        )
        .unwrap();
        fs::write(target.path().join("notebooks"), b"blocked").unwrap();
        assert!(s
            .set_notebook_location(&book.id, target.path().to_str())
            .is_err());
        assert_eq!(s.load().unwrap(), workspace);
        assert_eq!(
            fs::read_to_string(s.root.join(&relative)).unwrap(),
            book.documents[0].markdown
        );
        assert!(!s.root.join("locations.json").exists());
        assert!(!fs::read_dir(target.path()).unwrap().any(|f| f
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".typepro-migrate-")));
        assert!(s
            .set_notebook_location(&book.id, Some("relative/folder"))
            .is_err());
        assert!(s
            .set_notebook_location(&book.id, Some("/tmp/../escape"))
            .is_err());
        let nested = s.root.join("nested");
        fs::create_dir(&nested).unwrap();
        assert!(s.set_notebook_location(&book.id, nested.to_str()).is_err());
    }
    #[test]
    #[cfg(not(mobile))]
    fn external_directory_unavailability_never_falls_back_to_stale_default_copy() {
        let (_dir, s) = store();
        let external = tempfile::tempdir().unwrap();
        let workspace = sample();
        s.save(&workspace).unwrap();
        let book = &workspace.notebooks[0];
        let location = s
            .set_notebook_location(&book.id, external.path().to_str())
            .unwrap();
        let root = PathBuf::from(location.path);
        fs::remove_file(root.join(".typepro-notebook.json")).unwrap();
        assert!(s.load().is_err());
        assert!(s.save(&Workspace::default()).is_err());
        assert!(!s.root.join("pending.json").exists());
        let index: Index =
            serde_json::from_slice(&fs::read(s.root.join("index.json")).unwrap()).unwrap();
        assert_eq!(index.notebooks.len(), 1);
    }
    #[test]
    #[cfg(not(mobile))]
    fn pending_save_recovers_into_mapped_directory_and_asset_collision_is_not_journaled() {
        let (_dir, s) = store();
        let external = tempfile::tempdir().unwrap();
        let mut workspace = sample();
        s.save(&workspace).unwrap();
        let book_id = workspace.notebooks[0].id.clone();
        s.set_notebook_location(&book_id, external.path().to_str())
            .unwrap();
        let relative = document_path(&book_id, &workspace.notebooks[0].documents[0].id);
        workspace.notebooks[0].documents[0].markdown = "recovered external save".into();
        atomic_write(
            &s.root.join("pending.json"),
            &serde_json::to_vec(&workspace).unwrap(),
        )
        .unwrap();
        assert_eq!(s.load().unwrap(), workspace);
        assert_eq!(
            fs::read_to_string(external.path().join(&relative)).unwrap(),
            "recovered external save"
        );
        let asset = s.save_asset("conflict.png", b"original asset").unwrap();
        fs::write(
            external
                .path()
                .join("assets")
                .join(asset_name(&asset.path).unwrap()),
            b"conflicting asset",
        )
        .unwrap();
        workspace.notebooks[0].documents[0].markdown = format!("![conflict]({})", asset.path);
        assert!(s.save(&workspace).is_err());
        assert!(!s.root.join("pending.json").exists());
        assert_eq!(
            s.load().unwrap().notebooks[0].documents[0].markdown,
            "recovered external save"
        );
    }
    #[test]
    #[cfg(not(mobile))]
    fn empty_notebook_migrates_and_missing_legacy_attachment_does_not_block_save() {
        let (_dir, s) = store();
        let external = tempfile::tempdir().unwrap();
        let mut workspace = sample();
        workspace.notebooks[0].documents.clear();
        s.save(&workspace).unwrap();
        let book_id = workspace.notebooks[0].id.clone();
        s.set_notebook_location(&book_id, external.path().to_str())
            .unwrap();
        assert_eq!(s.load().unwrap(), workspace);
        workspace.notebooks[0].documents.push(Document {
            id: id(),
            title: "missing old image".into(),
            updated_at: "".into(),
            markdown: format!("![missing](../../assets/{}.png)", id()),
        });
        s.save(&workspace).unwrap();
        assert_eq!(s.load().unwrap(), workspace);
        let another = tempfile::tempdir().unwrap();
        assert!(s
            .set_notebook_location(&book_id, another.path().to_str())
            .is_err());
        assert!(fs::read_dir(another.path()).unwrap().next().is_none());
        assert!(s.get_notebook_location(&book_id).unwrap().custom);
    }
    #[test]
    #[cfg(not(mobile))]
    fn moving_document_out_of_external_notebook_copies_its_external_only_asset() {
        let (_dir, s) = store();
        let external = tempfile::tempdir().unwrap();
        let second_external = tempfile::tempdir().unwrap();
        let mut workspace = sample();
        workspace.notebooks.push(Notebook {
            id: id(),
            name: "default".into(),
            cover: None,
            documents: vec![],
        });
        workspace.notebooks.push(Notebook {
            id: id(),
            name: "external 2".into(),
            cover: None,
            documents: vec![],
        });
        s.save(&workspace).unwrap();
        let first_id = workspace.notebooks[0].id.clone();
        let third_id = workspace.notebooks[2].id.clone();
        s.set_notebook_location(&first_id, external.path().to_str())
            .unwrap();
        s.set_notebook_location(&third_id, second_external.path().to_str())
            .unwrap();
        let asset_name = format!("{}.png", id());
        let reference = format!("../../assets/{asset_name}");
        fs::write(
            external.path().join("assets").join(&asset_name),
            b"external only",
        )
        .unwrap();
        workspace.notebooks[0].documents[0].markdown = format!("![asset]({reference})");
        let document = workspace.notebooks[0].documents.remove(0);
        workspace.notebooks[1].documents.push(document.clone());
        workspace.notebooks[2].documents.push(Document {
            id: id(),
            ..document
        });
        s.save(&workspace).unwrap();
        assert_eq!(
            fs::read(s.root.join("assets").join(&asset_name)).unwrap(),
            b"external only"
        );
        assert_eq!(
            fs::read(second_external.path().join("assets").join(&asset_name)).unwrap(),
            b"external only"
        );
        assert_eq!(s.load().unwrap(), workspace);
        workspace.notebooks.remove(0);
        s.save(&workspace).unwrap();
        assert!(!s.locations().unwrap().notebooks.contains_key(&first_id));
        assert!(external.path().join(".typepro-notebook.json").exists());
    }
    #[test]
    #[cfg(all(unix, not(mobile)))]
    fn custom_directories_reject_overlap_and_symlinked_markdown_without_overwriting() {
        let (_dir, s) = store();
        let external = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let workspace = sample();
        s.save(&workspace).unwrap();
        let book = &workspace.notebooks[0];
        let location = s
            .set_notebook_location(&book.id, external.path().to_str())
            .unwrap();
        let root = PathBuf::from(location.path);
        let nested = root.join("nested");
        fs::create_dir(&nested).unwrap();
        assert!(s.set_notebook_location(&book.id, nested.to_str()).is_err());
        let relative = document_path(&book.id, &book.documents[0].id);
        fs::remove_file(root.join(&relative)).unwrap();
        let victim = outside.path().join("victim.md");
        fs::write(&victim, "untouched").unwrap();
        std::os::unix::fs::symlink(&victim, root.join(&relative)).unwrap();
        assert!(s.load().is_err());
        assert!(s.save(&workspace).is_err());
        assert_eq!(fs::read_to_string(victim).unwrap(), "untouched");
        assert!(!s.root.join("pending.json").exists());
    }
    #[test]
    #[cfg(all(unix, not(mobile)))]
    fn failed_location_commit_keeps_old_mapping_and_can_be_retried() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, s) = store();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let workspace = sample();
        s.save(&workspace).unwrap();
        let book = &workspace.notebooks[0];
        let old_location = s
            .set_notebook_location(&book.id, first.path().to_str())
            .unwrap();
        let mapping = fs::read(s.root.join("locations.json")).unwrap();
        let permissions = fs::metadata(&s.root).unwrap().permissions();
        fs::set_permissions(&s.root, fs::Permissions::from_mode(0o500)).unwrap();
        let failed = s.set_notebook_location(&book.id, second.path().to_str());
        fs::set_permissions(&s.root, permissions).unwrap();
        assert!(failed.is_err());
        assert_eq!(fs::read(s.root.join("locations.json")).unwrap(), mapping);
        assert_eq!(s.get_notebook_location(&book.id).unwrap(), old_location);
        assert_eq!(s.load().unwrap(), workspace);
        let relative = document_path(&book.id, &book.documents[0].id);
        assert_eq!(
            fs::read_to_string(first.path().join(&relative)).unwrap(),
            book.documents[0].markdown
        );
        assert_eq!(
            fs::read_to_string(second.path().join(&relative)).unwrap(),
            book.documents[0].markdown
        );
        assert!(
            s.set_notebook_location(&book.id, second.path().to_str())
                .unwrap()
                .custom
        );
        assert_eq!(s.load().unwrap(), workspace);
    }
    #[test]
    #[cfg(mobile)]
    fn mobile_directory_commands_are_disabled_before_any_filesystem_access() {
        let (_dir, s) = store();
        assert!(s
            .get_notebook_location("not-an-id")
            .unwrap_err()
            .contains("手机版"));
        assert!(s
            .set_notebook_location("not-an-id", Some("/tmp"))
            .unwrap_err()
            .contains("手机版"));
        assert!(!s.root.join("locations.json").exists());
    }
}
