mod github;
mod app_updates;
mod github_secrets;
mod plugin_market;
mod storage;
mod transfer;
mod plugin_services;
mod plugin_secrets;
use github::{
    Authorization, AuthorizationPoll, Github, GithubStatus, PublishResult, ReadRemoteResult,
    RepositoryPreparation, SyncSnapshot, SyncWorkspace,
};
use std::sync::Mutex;
use storage::{Asset, NotebookLocation, Storage, TransferFile, Workspace};
use tauri::{AppHandle, Manager, State, WebviewWindow};
struct Store(Mutex<Storage>);
// Optional sync initialization must never prevent access to local notebooks.
struct GithubService(Result<Github, String>);
struct PluginMarketService(Result<plugin_market::Market, String>);
struct AppUpdateService(Result<app_updates::Updater, String>);
impl GithubService {
    fn get(&self) -> Response<&Github> {
        self.0.as_ref().map_err(Clone::clone)
    }
}
type Response<T> = Result<T, String>;
fn access<T>(
    window: &WebviewWindow,
    state: &State<'_, Store>,
    op: impl FnOnce(&Storage) -> Response<T>,
) -> Response<T> {
    if window.label() != "main" {
        return Err("窗口无权访问笔记".into());
    }
    let store = state
        .0
        .lock()
        .map_err(|_| "存储暂时不可用，请重启应用".to_string())?;
    op(&store)
}
#[tauri::command]
async fn load_workspace(window: WebviewWindow, state: State<'_, Store>) -> Response<Workspace> {
    access(&window, &state, Storage::load)
}
#[tauri::command]
async fn save_workspace(
    window: WebviewWindow,
    state: State<'_, Store>,
    workspace: Workspace,
) -> Response<()> {
    access(&window, &state, |s| s.save(&workspace))
}
#[tauri::command]
async fn import_bundle(
    window: WebviewWindow,
    state: State<'_, Store>,
    name: String,
    bytes: Vec<u8>,
    notebook_id: Option<String>,
) -> Response<Workspace> {
    access(&window, &state, |s| {
        s.import(&name, &bytes, notebook_id.as_deref())
    })
}
#[tauri::command]
async fn export_bundle(
    window: WebviewWindow,
    state: State<'_, Store>,
    notebook_id: Option<String>,
    document_id: Option<String>,
) -> Response<TransferFile> {
    access(&window, &state, |s| {
        s.export(notebook_id.as_deref(), document_id.as_deref())
    })
}
#[tauri::command]
async fn export_markdown(
    window: WebviewWindow,
    state: State<'_, Store>,
    notebook_id: String,
    document_id: String,
) -> Response<TransferFile> {
    access(&window, &state, |s| {
        s.export_markdown(&notebook_id, &document_id)
    })
}
#[tauri::command]
async fn save_asset(
    window: WebviewWindow,
    state: State<'_, Store>,
    name: String,
    bytes: Vec<u8>,
) -> Response<Asset> {
    access(&window, &state, |s| s.save_asset(&name, &bytes))
}
#[tauri::command]
async fn resolve_asset(
    window: WebviewWindow,
    state: State<'_, Store>,
    path: String,
) -> Response<String> {
    access(&window, &state, |s| s.resolve_asset(&path))
}
#[tauri::command]
async fn get_storage_path(window: WebviewWindow, state: State<'_, Store>) -> Response<String> {
    access(&window, &state, |s| {
        Ok(s.root.to_string_lossy().into_owned())
    })
}
#[tauri::command]
async fn get_notebook_location(
    window: WebviewWindow,
    state: State<'_, Store>,
    notebook_id: String,
) -> Response<NotebookLocation> {
    access(&window, &state, |s| s.get_notebook_location(&notebook_id))
}
#[tauri::command]
async fn set_notebook_location(
    window: WebviewWindow,
    state: State<'_, Store>,
    notebook_id: String,
    path: Option<String>,
) -> Response<NotebookLocation> {
    access(&window, &state, |s| {
        s.set_notebook_location(&notebook_id, path.as_deref())
    })
}
fn github_access(window: &WebviewWindow) -> Response<()> {
    if window.label() != "main" {
        return Err("窗口无权访问同步".into());
    }
    Ok(())
}
#[tauri::command]
async fn github_status(
    window: WebviewWindow,
    app: AppHandle,
    github: State<'_, GithubService>,
) -> Response<GithubStatus> {
    github_access(&window)?;
    let github = github.get()?;
    github.status(&app).await
}
#[tauri::command]
async fn github_configure(
    window: WebviewWindow,
    app: AppHandle,
    github: State<'_, GithubService>,
    client_id: String,
    app_slug: String,
    interval_minutes: u16,
    device_name: String,
) -> Response<GithubStatus> {
    github_access(&window)?;
    let github = github.get()?;
    github
        .configure(&app, client_id, app_slug, interval_minutes, device_name)
        .await
}
#[tauri::command]
async fn github_start_authorization(
    window: WebviewWindow,
    github: State<'_, GithubService>,
) -> Response<Authorization> {
    github_access(&window)?;
    let github = github.get()?;
    github.start_authorization().await
}
#[tauri::command]
async fn github_poll_authorization(
    window: WebviewWindow,
    app: AppHandle,
    github: State<'_, GithubService>,
) -> Response<AuthorizationPoll> {
    github_access(&window)?;
    let github = github.get()?;
    github.poll_authorization(&app).await
}
#[tauri::command]
async fn github_cancel_authorization(
    window: WebviewWindow,
    github: State<'_, GithubService>,
) -> Response<()> {
    github_access(&window)?;
    let github = github.get()?;
    github.cancel_authorization().await;
    Ok(())
}
#[tauri::command]
async fn github_prepare_repository(
    window: WebviewWindow,
    app: AppHandle,
    github: State<'_, GithubService>,
) -> Response<RepositoryPreparation> {
    github_access(&window)?;
    let github = github.get()?;
    github.prepare_repository(&app).await
}
#[tauri::command]
async fn github_read_remote(
    window: WebviewWindow,
    app: AppHandle,
    github: State<'_, GithubService>,
    store: State<'_, Store>,
) -> Response<ReadRemoteResult> {
    github_access(&window)?;
    let github = github.get()?;
    let read = github.read_remote(&app).await?;
    // Storage access is brief and synchronous; never keep its lock over network awaits.
    access(&window, &store, |s| s.import_sync_assets(&read.assets))?;
    Ok(read.wire)
}
#[tauri::command]
async fn github_publish(
    window: WebviewWindow,
    app: AppHandle,
    github: State<'_, GithubService>,
    store: State<'_, Store>,
    expected_head: String,
    workspace: SyncWorkspace,
) -> Response<PublishResult> {
    github_access(&window)?;
    let github = github.get()?;
    let files = access(&window, &store, |s| {
        s.export_sync_files(&workspace.as_workspace())
    })?;
    github.publish(&app, expected_head, workspace, files).await
}
#[tauri::command]
async fn github_checkpoint(
    window: WebviewWindow,
    app: AppHandle,
    github: State<'_, GithubService>,
    head: String,
    snapshot: SyncSnapshot,
) -> Response<()> {
    github_access(&window)?;
    let github = github.get()?;
    github.checkpoint(&app, head, snapshot).await
}
#[tauri::command]
async fn github_disconnect(
    window: WebviewWindow,
    app: AppHandle,
    github: State<'_, GithubService>,
) -> Response<GithubStatus> {
    github_access(&window)?;
    let github = github.get()?;
    github.disconnect(&app).await
}
#[tauri::command]
async fn plugin_market_catalog(
    window: WebviewWindow,
    market: State<'_, PluginMarketService>,
) -> Response<plugin_market::Catalog> {
    if window.label() != "main" {
        return Err("窗口无权访问插件市场".into());
    }
    market.0.as_ref().map_err(Clone::clone)?.catalog().await
}
#[tauri::command]
async fn plugin_market_download(
    window: WebviewWindow,
    market: State<'_, PluginMarketService>,
    id: String,
    version: String,
    sha256: String,
) -> Response<Vec<u8>> {
    if window.label() != "main" {
        return Err("窗口无权访问插件市场".into());
    }
    market
        .0
        .as_ref()
        .map_err(Clone::clone)?
        .download(&id, &version, &sha256)
        .await
}
#[tauri::command]
async fn plugin_market_restore(window: WebviewWindow, market: State<'_, PluginMarketService>, entry: plugin_market::CatalogPlugin) -> Response<Vec<u8>> {
    if window.label() != "main" { return Err("窗口无权恢复插件".into()); }
    market.0.as_ref().map_err(Clone::clone)?.restore(entry).await
}
#[tauri::command]
async fn app_check_updates(
    window: WebviewWindow,
    updater: State<'_, AppUpdateService>,
) -> Response<app_updates::UpdateCheck> {
    if window.label() != "main" {
        return Err("窗口无权检查应用更新".into());
    }
    updater.0.as_ref().map_err(Clone::clone)?.check().await
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(transfer::init())
        .plugin(github_secrets::init())
        .plugin(plugin_secrets::init())
        .manage(plugin_services::PluginServices::new())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            app.manage(GithubService(Github::new(data.join("github-sync"))));
            app.manage(PluginMarketService(plugin_market::Market::new()));
            app.manage(AppUpdateService(app_updates::Updater::new()));
            let root = data.join("workspace");
            std::fs::create_dir_all(&root)?;
            app.manage(Store(Mutex::new(Storage::new(root))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_check_updates,
            plugin_market_catalog,
            plugin_market_download,
            plugin_market_restore,
            plugin_services::plugin_session_start,
            plugin_services::plugin_session_stop,
            plugin_services::plugin_network_request,
            plugin_services::plugin_network_cancel,
            plugin_services::plugin_secret_configure,
            plugin_services::plugin_secret_status,
            plugin_services::plugin_secret_remove,
            github_status,
            github_configure,
            github_start_authorization,
            github_poll_authorization,
            github_cancel_authorization,
            github_prepare_repository,
            github_read_remote,
            github_publish,
            github_checkpoint,
            github_disconnect,
            load_workspace,
            save_workspace,
            import_bundle,
            export_bundle,
            export_markdown,
            save_asset,
            resolve_asset,
            get_storage_path,
            get_notebook_location,
            set_notebook_location,
            transfer::write_transfer_uri,
            transfer::get_transfer_name
        ])
        .build(tauri::generate_context!())
        .expect("无法启动笔记")
        .run(|app, event| {
            #[cfg(desktop)]
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    // Route menu / Command-Q through the same frontend flush as window close.
                    api.prevent_exit();
                    let _ = window.close();
                }
            }
            #[cfg(mobile)]
            let _ = (app, event);
        });
}
