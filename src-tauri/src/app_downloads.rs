//! One application-owned installer transfer. Notes and plugin data never enter this cache.
use crate::app_updates::{self, DownloadAsset, Updater};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tauri::AppHandle;
use tokio::task::AbortHandle;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadState {
    version: Option<String>,
    status: &'static str,
    downloaded: u64,
    total: u64,
    error: Option<String>,
    revision: u64,
}

impl DownloadState {
    fn idle() -> Self {
        Self { version: None, status: "idle", downloaded: 0, total: 0, error: None, revision: 0 }
    }
    fn changed(&mut self) { self.revision += 1; }
}

struct Active {
    id: u64,
    abort: AbortHandle,
}

#[derive(Clone)]
struct Ready {
    path: PathBuf,
    asset: DownloadAsset,
}

struct Inner {
    state: DownloadState,
    active: Option<Active>,
    ready: Option<Ready>,
    opening: bool,
}

pub struct Downloads {
    root: PathBuf,
    updater: Updater,
    inner: Mutex<Inner>,
}

impl Downloads {
    pub fn new(root: PathBuf) -> Result<Self> {
        Ok(Self { root, updater: Updater::new()?, inner: Mutex::new(Inner {
            state: DownloadState::idle(), active: None, ready: None, opening: false,
        }) })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Inner>> {
        self.inner.lock().map_err(|_| "更新下载暂时不可用，请重启应用".into())
    }

    pub fn status(&self) -> Result<DownloadState> { Ok(self.lock()?.state.clone()) }

    pub fn start(self: &Arc<Self>, version: String) -> Result<DownloadState> {
        app_updates::valid_upgrade_version(&version)?;
        let mut inner = self.lock()?;
        if inner.opening { return Err("正在打开安装包，请稍后重试".into()); }
        if inner.active.is_some() {
            return Err("已有更新正在下载或取消，请稍后重试".into());
        }
        if inner.state.status == "ready" && inner.state.version.as_deref() == Some(version.as_str()) {
            return Ok(inner.state.clone());
        }
        let previous = inner.ready.take();
        inner.state.version = Some(version.clone());
        inner.state.status = "downloading";
        inner.state.downloaded = 0;
        inner.state.total = 0;
        inner.state.error = None;
        inner.state.changed();
        let id = inner.state.revision;
        let worker = Arc::clone(self);
        // Holding the short state lock until the abort handle is registered closes the start/cancel gap.
        let task = tauri::async_runtime::spawn(async move {
            // One deadline covers release metadata, checksum fallback, redirects and file transfer.
            tokio::time::timeout(Duration::from_secs(15 * 60), worker.transfer(id, version, previous))
                .await.map_err(|_| "安装包下载超时，请重试".to_string())?
        });
        inner.active = Some(Active { id, abort: task.inner().abort_handle() });
        let state = inner.state.clone();
        drop(inner);
        let owner = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let result = task.await.unwrap_or_else(|_| Err("下载任务已中止，请重试".into()));
            owner.finish(id, result);
        });
        Ok(state)
    }

    pub fn cancel(&self) -> Result<DownloadState> {
        let mut inner = self.lock()?;
        if let Some(active) = &inner.active {
            active.abort.abort();
            if inner.state.status != "cancelling" {
                inner.state.status = "cancelling";
                inner.state.changed();
            }
        }
        Ok(inner.state.clone())
    }

    fn progress(&self, id: u64, status: &'static str, downloaded: u64, total: u64) -> Result<()> {
        let mut inner = self.lock()?;
        if !inner.active.as_ref().is_some_and(|active| active.id == id)
            || inner.state.status == "cancelling" {
            return Err("更新下载已取消".into());
        }
        inner.state.status = status;
        inner.state.downloaded = downloaded;
        inner.state.total = total;
        inner.state.changed();
        Ok(())
    }

    async fn transfer(&self, id: u64, version: String, previous: Option<Ready>) -> Result<Ready> {
        prepare_root(&self.root)?;
        if let Some(previous) = previous { remove_cached(&previous.path)?; }
        // Abort drops this metadata request or the pending response body immediately.
        let asset = self.updater.resolve_download(&version).await?;
        self.transfer_asset(id, asset).await
    }

    async fn transfer_asset(&self, id: u64, asset: DownloadAsset) -> Result<Ready> {
        self.progress(id, "downloading", 0, asset.size)?;
        let ready = Ready { path: self.root.join(&asset.filename), asset };
        if ready.path.exists() {
            self.progress(id, "verifying", 0, ready.asset.size)?;
            if verify(&ready).is_ok() {
                self.progress(id, "verifying", ready.asset.size, ready.asset.size)?;
                return Ok(ready);
            }
            remove_cached(&ready.path)?;
        }
        let part_path = self.root.join(format!("{}.part", ready.asset.filename));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let file = options.open(&part_path).map_err(|_| "无法创建安装包，请检查可用存储空间")?;
        let mut pending = PendingFile { path: part_path, file: Some(file) };
        let mut response = self.updater.open_download(&ready.asset).await?;
        if response.content_length().is_some_and(|size| size != ready.asset.size) {
            return Err("安装包大小与发布信息不一致，请重试".into());
        }
        let mut count = 0_u64;
        let mut hash = Sha256::new();
        while let Some(chunk) = response.chunk().await.map_err(app_updates::download_error)? {
            if chunk.len() as u64 > ready.asset.size - count {
                return Err("安装包超过发布的大小，已停止下载".into());
            }
            pending.file.as_mut().ok_or("安装包文件已关闭")?.write_all(&chunk)
                .map_err(|_| "安装包保存失败，请检查可用存储空间")?;
            hash.update(&chunk);
            count += chunk.len() as u64;
            self.progress(id, "downloading", count, ready.asset.size)?;
        }
        self.progress(id, "verifying", count, ready.asset.size)?;
        if count != ready.asset.size || format!("{:x}", hash.finalize()) != ready.asset.sha256 {
            return Err("安装包完整性校验失败，请重新下载".into());
        }
        pending.file.as_mut().ok_or("安装包文件已关闭")?.sync_all()
            .map_err(|_| "无法完成安装包保存，请检查存储空间")?;
        pending.file.take();
        fs::rename(&pending.path, &ready.path).map_err(|_| "无法保存已校验的安装包")?;
        Ok(ready)
    }

    fn finish(&self, id: u64, result: Result<Ready>) {
        // The worker has terminated and its open descriptor has dropped. Keep its active slot
        // while checking cleanup errors, so the next job cannot start using the same .part file.
        let cleanup = cleanup_parts(&self.root);
        let Ok(mut inner) = self.lock() else { return; };
        if !inner.active.as_ref().is_some_and(|active| active.id == id) { return; }
        if inner.state.status != "cancelling" {
            inner.active = None;
            match result.and_then(|ready| cleanup.map(|()| ready)) {
                Ok(ready) => {
                    inner.state.status = "ready";
                    inner.state.downloaded = ready.asset.size;
                    inner.state.total = ready.asset.size;
                    inner.state.error = None;
                    inner.ready = Some(ready);
                }
                Err(error) => { inner.state.status = "error"; inner.state.error = Some(error); }
            }
            inner.state.changed();
            return;
        }
        drop(inner);
        // An abort can arrive after the final atomic rename; remove the completed file too.
        let cleanup = cleanup.and_then(|()| match &result {
            Ok(ready) => remove_cached(&ready.path), Err(_) => Ok(()),
        });
        let Ok(mut inner) = self.lock() else { return; };
        if !inner.active.as_ref().is_some_and(|active| active.id == id) { return; }
        inner.active = None;
        inner.state.status = if cleanup.is_ok() { "cancelled" } else { "error" };
        inner.state.error = cleanup.err();
        inner.state.downloaded = 0;
        inner.state.changed();
    }

    pub async fn open(self: &Arc<Self>, app: &AppHandle) -> Result<()> {
        let ready = {
            let mut inner = self.lock()?;
            if inner.active.is_some() || inner.opening || inner.state.status != "ready" {
                return Err("请先完成安装包下载和校验".into());
            }
            let ready = inner.ready.clone().ok_or("没有可用的安装包，请重新下载")?;
            inner.opening = true;
            inner.state.error = None;
            inner.state.changed();
            ready
        };
        let _opening = Opening(Arc::clone(self));
        let check = ready.clone();
        let verified = tauri::async_runtime::spawn_blocking(move || verify(&check)).await
            .map_err(|_| "安装包校验任务未完成，请重试".to_string())?;
        if let Err(error) = verified {
            {
                let mut inner = self.lock()?;
                inner.ready = None;
                inner.state.status = "error";
                inner.state.error = Some(error.clone());
                inner.state.changed();
            }
            if let Err(cleanup) = remove_cached(&ready.path) {
                return Err(format!("{error}；{cleanup}"));
            }
            return Err(error);
        }
        // The opening slot prevents a new transfer from deleting/replacing the checked file.
        crate::app_installer::open(app, &ready.path).await
    }
}

struct Opening(Arc<Downloads>);
impl Drop for Opening {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.0.lock() { inner.opening = false; }
    }
}

// Aborting at a network await drops the open descriptor and then the unfinished file.
struct PendingFile { path: PathBuf, file: Option<File> }
impl Drop for PendingFile {
    fn drop(&mut self) { self.file.take(); let _ = fs::remove_file(&self.path); }
}

fn remove_cached(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("无法清理旧安装包，请检查存储空间后重试".into()),
    }
}

fn cache_filename(name: &str) -> bool {
    let Some(value) = name.strip_prefix("TypePro-") else { return false; };
    let version = value.strip_suffix("-mac-arm64.dmg").or_else(|| value.strip_suffix("-android.apk"));
    version.is_some_and(|version| app_updates::version_parts(version).is_some())
}

fn prepare_root(root: &Path) -> Result<()> {
    fs::create_dir_all(root).map_err(|_| "无法创建更新缓存，请检查存储空间")?;
    cleanup_parts(root)
}

fn cleanup_parts(root: &Path) -> Result<()> {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        _ => return Err("更新缓存路径无效".into()),
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("无法读取更新缓存".into()),
    };
    for entry in entries {
        let entry = entry.map_err(|_| "无法读取更新缓存")?;
        let name = entry.file_name();
        let Some(name) = name.to_str().and_then(|name| name.strip_suffix(".part")) else { continue; };
        if cache_filename(name) { remove_cached(&entry.path())?; }
    }
    Ok(())
}

fn verify(ready: &Ready) -> Result<()> {
    let metadata = fs::symlink_metadata(&ready.path).map_err(|_| "安装包已不存在，请重新下载")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != ready.asset.size {
        return Err("安装包已变化，请重新下载".into());
    }
    let mut file = File::open(&ready.path).map_err(|_| "无法读取安装包，请重新下载")?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut count = 0_u64;
    loop {
        let size = file.read(&mut buffer).map_err(|_| "无法校验安装包，请重新下载")?;
        if size == 0 { break; }
        count += size as u64;
        if count > ready.asset.size { return Err("安装包已变化，请重新下载".into()); }
        hash.update(&buffer[..size]);
    }
    if count != ready.asset.size || format!("{:x}", hash.finalize()) != ready.asset.sha256 {
        return Err("安装包完整性校验失败，请重新下载".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_download(root: &Path) -> Arc<Downloads> {
        let downloads = Arc::new(Downloads::new(root.to_path_buf()).unwrap());
        let task = tauri::async_runtime::spawn(std::future::pending::<()>());
        let abort = task.inner().abort_handle();
        task.abort();
        {
            let mut inner = downloads.lock().unwrap();
            inner.state.version = Some("99.0.0".into());
            inner.state.status = "downloading";
            inner.state.revision = 1;
            inner.active = Some(Active { id: 1, abort });
        }
        downloads
    }

    #[test]
    fn cancellation_wins_when_transfer_already_renamed_the_installer() {
        let directory = tempfile::tempdir().unwrap();
        let downloads = active_download(directory.path());
        let path = directory.path().join("TypePro-99.0.0-android.apk");
        fs::write(&path, b"ready").unwrap();
        let ready = Ready { path: path.clone(), asset: DownloadAsset { filename: "TypePro-99.0.0-android.apk".into(),
            url: String::new(), size: 5, sha256: format!("{:x}", Sha256::digest(b"ready")) } };
        let cancelling = downloads.cancel().unwrap();
        assert_eq!(cancelling.status, "cancelling");
        assert!(downloads.start("99.0.1".into()).is_err());
        downloads.finish(1, Ok(ready));
        let state = downloads.status().unwrap();
        assert_eq!(state.status, "cancelled");
        assert!(state.revision > cancelling.revision);
        assert!(!path.exists());
        assert!(downloads.lock().unwrap().active.is_none());
    }

    #[test]
    fn cancellation_reports_cleanup_failure_instead_of_false_success() {
        let directory = tempfile::tempdir().unwrap();
        let downloads = active_download(directory.path());
        fs::create_dir(directory.path().join("TypePro-99.0.0-android.apk.part")).unwrap();
        downloads.cancel().unwrap();
        downloads.finish(1, Err("aborted".into()));
        let state = downloads.status().unwrap();
        assert_eq!(state.status, "error");
        assert!(state.error.unwrap().contains("清理"));
        assert!(downloads.lock().unwrap().active.is_none());
    }

    #[test]
    fn opening_slot_blocks_download_until_guard_is_released() {
        let directory = tempfile::tempdir().unwrap();
        let downloads = Arc::new(Downloads::new(directory.path().to_path_buf()).unwrap());
        downloads.lock().unwrap().opening = true;
        let opening = Opening(Arc::clone(&downloads));
        assert!(downloads.start("99.0.0".into()).is_err());
        drop(opening);
        assert!(!downloads.lock().unwrap().opening);
    }

    // Network acceptance deliberately starts below the current app version only in cfg(test).
    // The production downloader/HTTP/redirect/hash functions themselves stay unchanged.
    fn network_start(downloads: &Arc<Downloads>, asset: DownloadAsset) {
        let mut inner = downloads.lock().unwrap();
        assert!(inner.active.is_none() && !inner.opening);
        inner.ready = None;
        inner.state.version = Some("1.7.4".into());
        inner.state.status = "downloading";
        inner.state.downloaded = 0;
        inner.state.total = asset.size;
        inner.state.error = None;
        inner.state.changed();
        let id = inner.state.revision;
        let owner = Arc::clone(downloads);
        let task = tauri::async_runtime::spawn(async move {
            prepare_root(&owner.root)?;
            owner.transfer_asset(id, asset).await
        });
        inner.active = Some(Active { id, abort: task.inner().abort_handle() });
        drop(inner);
        let owner = Arc::clone(downloads);
        tauri::async_runtime::spawn(async move {
            let result = task.await.unwrap_or_else(|_| Err("下载任务已中止".into()));
            owner.finish(id, result);
        });
    }

    async fn network_terminal(downloads: &Downloads) -> DownloadState {
        tokio::time::timeout(Duration::from_secs(300), async {
            loop {
                let state = downloads.status().unwrap();
                if matches!(state.status, "ready" | "cancelled" | "error") { break state; }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }).await.expect("network acceptance timeout")
    }

    fn no_partial_files(root: &Path) -> bool {
        fs::read_dir(root).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().ends_with(".part"))
    }

    #[test]
    #[ignore = "downloads public GitHub release assets into temporary directories"]
    fn published_installers_native_network_acceptance() {
        tauri::async_runtime::block_on(async {
            let updater = Updater::new().unwrap();
            let mac = updater.published_download_for_test("1.7.4", "mac-arm64").await.unwrap();
            let android = updater.published_download_for_test("1.7.4", "android").await.unwrap();
            assert_eq!(mac.size, 13_474_851);
            assert_eq!(mac.sha256, "cf1f8e61c471e98807db1cbfd4669136cf45930a77acacf70cedf6e5d94c2af0");
            assert_eq!(android.size, 34_340_021);
            assert_eq!(android.sha256, "b6a2ababaf553f4ea075587927c64e5602a1826e85069c15bbf3a51e6c6450b0");
            for asset in [mac.clone(), android.clone()] {
                let directory = tempfile::tempdir().unwrap();
                let downloads = Arc::new(Downloads::new(directory.path().to_path_buf()).unwrap());
                network_start(&downloads, asset.clone());
                let state = network_terminal(&downloads).await;
                assert_eq!(state.status, "ready", "{:?}", state.error);
                assert_eq!(state.downloaded, asset.size);
                assert!(no_partial_files(directory.path()));
                verify(downloads.lock().unwrap().ready.as_ref().unwrap()).unwrap();
                println!("native release verified: {} bytes={} sha256={}", asset.filename, asset.size, asset.sha256);
            }

            let directory = tempfile::tempdir().unwrap();
            let downloads = Arc::new(Downloads::new(directory.path().to_path_buf()).unwrap());
            let mut wrong_hash = mac.clone(); wrong_hash.sha256 = "00".repeat(32);
            network_start(&downloads, wrong_hash);
            let state = network_terminal(&downloads).await;
            assert_eq!(state.status, "error");
            assert!(state.error.unwrap().contains("完整性校验失败"));
            assert!(no_partial_files(directory.path()));
            assert!(!directory.path().join(&mac.filename).exists());
            println!("native wrong SHA-256 rejected; partial removed");

            let mut wrong_size = mac.clone(); wrong_size.size += 1;
            network_start(&downloads, wrong_size);
            let state = network_terminal(&downloads).await;
            assert_eq!(state.status, "error");
            assert!(state.error.unwrap().contains("大小"));
            assert!(no_partial_files(directory.path()));
            println!("native size mismatch rejected; partial removed");

            network_start(&downloads, android.clone());
            tokio::time::timeout(Duration::from_secs(120), async {
                loop {
                    let state = downloads.status().unwrap();
                    assert_eq!(state.status, "downloading", "cancel probe must reach a real in-flight chunk");
                    if state.downloaded > 0 && state.downloaded < state.total { break; }
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            }).await.unwrap();
            assert_eq!(downloads.cancel().unwrap().status, "cancelling");
            let state = network_terminal(&downloads).await;
            assert_eq!(state.status, "cancelled", "{:?}", state.error);
            assert!(no_partial_files(directory.path()));
            assert!(!directory.path().join(&android.filename).exists());
            println!("native live response cancelled; partial removed before retry");

            network_start(&downloads, mac.clone());
            assert_eq!(network_terminal(&downloads).await.status, "ready");
            verify(downloads.lock().unwrap().ready.as_ref().unwrap()).unwrap();
            let path = directory.path().join(&mac.filename);
            let original_modified = path.metadata().unwrap().modified().unwrap();
            let cache = Arc::new(Downloads::new(directory.path().to_path_buf()).unwrap());
            let resolved = updater.published_download_for_test("1.7.4", "mac-arm64").await.unwrap();
            network_start(&cache, resolved);
            assert_eq!(network_terminal(&cache).await.status, "ready");
            assert_eq!(path.metadata().unwrap().modified().unwrap(), original_modified);
            println!("native retry succeeded; fresh metadata revalidated cached installer without rewriting");

            let mut file = OpenOptions::new().write(true).open(&path).unwrap();
            file.write_all(b"CORRUPTED").unwrap(); drop(file);
            assert!(verify(cache.lock().unwrap().ready.as_ref().unwrap()).is_err());
            let recovery = Arc::new(Downloads::new(directory.path().to_path_buf()).unwrap());
            network_start(&recovery, mac.clone());
            assert_eq!(network_terminal(&recovery).await.status, "ready");
            verify(recovery.lock().unwrap().ready.as_ref().unwrap()).unwrap();
            assert!(no_partial_files(directory.path()));
            println!("native cache mutation detected and repaired by verified fresh download");
        });
    }

    #[test]
    fn cleanup_only_removes_generated_partial_installer_names() {
        let directory = tempfile::tempdir().unwrap();
        for name in ["TypePro-9.0.0-android.apk.part", "TypePro-9.0.0-mac-arm64.dmg.part", "keep.part", "TypePro-invalid-android.apk.part", "TypePro-9.0.0-android.apk"] {
            fs::write(directory.path().join(name), b"keep").unwrap();
        }
        prepare_root(directory.path()).unwrap();
        assert!(!directory.path().join("TypePro-9.0.0-android.apk.part").exists());
        assert!(!directory.path().join("TypePro-9.0.0-mac-arm64.dmg.part").exists());
        for name in ["keep.part", "TypePro-invalid-android.apk.part", "TypePro-9.0.0-android.apk"] {
            assert!(directory.path().join(name).exists());
        }
    }

    #[test]
    fn abort_cleanup_closes_and_removes_partial_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("installer.part");
        let pending = PendingFile { file: Some(File::create(&path).unwrap()), path: path.clone() };
        drop(pending);
        assert!(!path.exists());
    }

    #[test]
    fn verify_rejects_truncated_and_changed_installers() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("TypePro-9.0.0-android.apk");
        let bytes = b"test installer";
        let ready = Ready { path: path.clone(), asset: DownloadAsset { filename: "TypePro-9.0.0-android.apk".into(), url: String::new(), size: bytes.len() as u64,
            sha256: format!("{:x}", Sha256::digest(bytes)) } };
        fs::write(&path, bytes).unwrap();
        assert!(verify(&ready).is_ok());
        fs::write(&path, b"test installeR").unwrap();
        assert!(verify(&ready).is_err());
        fs::write(&path, b"short").unwrap();
        assert!(verify(&ready).is_err());
        fs::remove_file(&path).unwrap();
        assert!(verify(&ready).is_err());
    }
}
