use serde::{Deserialize, Serialize};

use crate::models::InstanceSettings;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildPreset {
    pub id: String,
    pub name: String,
    pub game_version: String,
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub settings: Option<InstanceSettings>,
    pub created_at: u64,
    #[serde(default)]
    pub icon_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct BuildPresetsFile {
    #[serde(default)]
    pub presets: Vec<BuildPreset>,
}
