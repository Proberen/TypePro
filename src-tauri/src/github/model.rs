use crate::storage::{Notebook, Workspace};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SyncWorkspace {
    pub version: u8,
    pub notebooks: Vec<Notebook>,
}
impl SyncWorkspace {
    pub fn as_workspace(&self) -> Workspace {
        Workspace {
            version: self.version,
            notebooks: self.notebooks.clone(),
            plugins: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub device_id: String,
    pub name: String,
    pub platform: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncSnapshot {
    pub format: String,
    pub version: u8,
    pub notebooks: Vec<Notebook>,
    pub source: Source,
    pub synced_at: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub login: String,
    pub avatar_url: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub owner: String,
    pub name: String,
    pub url: String,
    pub default_branch: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    pub client_id: String,
    pub app_slug: String,
    pub connected: bool,
    pub account: Option<Account>,
    pub repository: Option<Repository>,
    pub interval_minutes: u16,
    pub device_name: String,
    pub device_id: String,
    pub last_synced_at: Option<String>,
    pub last_source: Option<Source>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Authorization {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}
#[derive(Serialize)]
pub struct AuthorizationPoll {
    pub status: String,
    pub interval: Option<u64>,
    pub state: Option<GithubStatus>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPreparation {
    pub status: String,
    pub installation_url: Option<String>,
    pub state: GithubStatus,
}
#[derive(Serialize)]
pub struct ReadRemoteResult {
    pub head: String,
    pub base: Option<SyncSnapshot>,
    pub remote: Option<SyncSnapshot>,
}
pub struct RemoteRead {
    pub wire: ReadRemoteResult,
    pub assets: Vec<crate::storage::SyncFile>,
}
#[derive(Serialize)]
pub struct PublishResult {
    pub head: String,
    pub snapshot: SyncSnapshot,
}
