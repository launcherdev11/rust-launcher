use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExternalLauncherType {
    Auto,
    MultiMC,
    PrismLauncher,
    ATLauncher,
    GDLauncher,
    CurseForge,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportableInstance {
    pub id: String,
    pub launcher_type: ExternalLauncherType,
    pub path: String,
    pub display_name: String,
    pub loader: Option<String>,
    pub game_version: Option<String>,
    pub icon_path: Option<String>,
    pub icon_data_uri: Option<String>,
    pub approx_size_bytes: Option<u64>,
    pub mods_count: Option<u32>,
    pub last_modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedLauncherPath {
    pub launcher_type: ExternalLauncherType,
    pub launcher_root: String,
    pub instances_dir: String,
    pub was_instances_dir_input: bool,
}

