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

impl Storage {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
    fn apply(&self, workspace: &Workspace) -> Result<()> {
        validate(workspace)?;
        for notebook in &workspace.notebooks {
            for document in &notebook.documents {
                let path = self.root.join(document_path(&notebook.id, &document.id));
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
        for notebook in index.notebooks {
            valid_id(&notebook.id)?;
            let mut documents = vec![];
            for document in notebook.documents {
                valid_id(&document.id)?;
                let path = self.root.join(document_path(&notebook.id, &document.id));
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
        atomic_write(
            &self.root.join("pending.json"),
            &serde_json::to_vec(workspace).map_err(err)?,
        )?;
        self.apply(workspace)?;
        fs::remove_file(self.root.join("pending.json")).map_err(err)?;
        self.clean_removed_documents(workspace);
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
        atomic_write(&self.root.join("assets").join(&name), bytes)?;
        Ok(Asset {
            path: format!("../../assets/{name}"),
            url: data_uri(&name, bytes),
        })
    }
    pub fn resolve_asset(&self, reference: &str) -> Result<String> {
        let name = asset_name(reference)?;
        let bytes = read_limited(&self.root.join("assets").join(name), MAX_ASSET)?;
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
            let bytes = read_limited(&self.root.join("assets").join(name), MAX_ASSET)?;
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
                documents,
            });
        }
        validate(&imported)?;
        let mut replacements = BTreeMap::new();
        for reference in references {
            let name = asset_name(&reference)?;
            let data = files
                .get(&format!("assets/{name}"))
                .ok_or("ZIP 缺少文档引用的附件")?;
            let asset = self.save_asset(name, data)?;
            replacements.insert(reference, asset.path);
        }
        for mut notebook in imported.notebooks {
            notebook.id = id();
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
}
