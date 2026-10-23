use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LazyModItem {
    pub provider: String,
    pub project_id: String,
    pub content_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LazyModSet {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub items: Vec<LazyModItem>,
    #[serde(default)]
    pub auto_apply: bool,
    pub created_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct LazyModsFile {
    #[serde(default)]
    pub sets: Vec<LazyModSet>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LazyModFailure {
    pub title: String,
    pub reason: String,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct LazyApplyReport {
    pub installed: u32,
    pub already_present: u32,
    pub unavailable: Vec<String>,
    pub failed: Vec<LazyModFailure>,
}
