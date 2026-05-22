use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub nickname: String,
    #[serde(default)]
    pub ely_username: Option<String>,
    #[serde(default)]
    pub ely_uuid: Option<String>,
    #[serde(default)]
    pub ely_access_token: Option<String>,
    #[serde(default)]
    pub ely_client_token: Option<String>,
    #[serde(default)]
    pub ely_refresh_token: Option<String>,
    #[serde(default)]
    pub ms_access_token: Option<String>,
    #[serde(default)]
    pub ms_refresh_token: Option<String>,
    #[serde(default)]
    pub ms_id_token: Option<String>,
    #[serde(default)]
    pub mc_uuid: Option<String>,
    #[serde(default)]
    pub mc_username: Option<String>,
    #[serde(default)]
    pub mc_access_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct LauncherAccountEntry {
    pub id: String,
    pub profile: Profile,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct LauncherAccountsStore {
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub accounts: Vec<LauncherAccountEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherAccountSummary {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub is_active: bool,
}
