use serde::{Deserialize, Serialize};

use crate::models::JavaSettings;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon_path: Option<String>,
    pub game_version: String,
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    pub created_at: u64,
    #[serde(default)]
    pub play_time_seconds: u64,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct InstanceSettings {
    pub ram_mb: Option<u32>,
    pub jvm_args: Option<String>,
    pub java_settings: Option<JavaSettings>,
    pub resolution_width: Option<u32>,
    pub resolution_height: Option<u32>,
    pub show_console_on_launch: Option<bool>,
    pub close_launcher_on_game_start: Option<bool>,
    pub check_game_processes: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct InstanceProfileSummary {
    pub id: String,
    pub name: String,
    pub icon_path: Option<String>,
    pub game_version: String,
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    pub created_at: u64,
    pub play_time_seconds: u64,
    pub mods_count: u32,
    pub resourcepacks_count: u32,
    pub shaderpacks_count: u32,
    pub total_size_bytes: u64,
    pub directory: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct SelectedProfileFile {
    pub id: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProfileItemEntry {
    pub name: String,
    pub enabled: bool,
}

