mod storage;
mod transfer;
use std::sync::Mutex;
use storage::{Asset, NotebookLocation, Storage, TransferFile, Workspace};
use tauri::{Manager, State, WebviewWindow};
struct Store(Mutex<Storage>);
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
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(transfer::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("workspace");
            std::fs::create_dir_all(&root)?;
            app.manage(Store(Mutex::new(Storage::new(root))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
