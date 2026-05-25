use serde::{Deserialize, Serialize};

pub const MODRINTH_USER_AGENT: &str = "16Launcher/2.0.0 (contact@16launcher.com)";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ModrinthDependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct ModrinthFileHashes {
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub sha512: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ModrinthVersionFile {
    pub id: String,
    pub url: String,
    pub filename: String,
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub hashes: ModrinthFileHashes,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ModrinthVersion {
    pub id: String,
    pub project_id: String,
    #[serde(default)]
    pub dependencies: Vec<ModrinthDependency>,
    #[serde(default)]
    pub files: Vec<ModrinthVersionFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthDownloadTarget {
    pub version_id: String,
    pub project_id: String,
    pub file_id: String,
    pub url: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha1: Option<String>,
    pub skipped: bool,
}

impl ModrinthVersionFile {
    pub fn sha1_hex(&self) -> Option<String> {
        self.hashes
            .sha1
            .as_ref()
            .map(|h| h.trim().to_ascii_lowercase())
            .filter(|h| !h.is_empty())
    }
}

impl ModrinthVersion {
    pub fn primary_file(&self) -> Option<&ModrinthVersionFile> {
        self.files
            .iter()
            .find(|f| f.primary)
            .or_else(|| self.files.first())
    }
}
