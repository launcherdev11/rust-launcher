use serde::{Deserialize, Serialize};

use crate::models::{JavaSettings, Settings};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherSettingsBackupV1 {
    pub format_version: u32,
    pub exported_at_ms: u64,
    pub settings: Settings,
    pub java_settings: JavaSettings,
    #[serde(default)]
    pub sidebar_order: Option<Vec<String>>,
}

