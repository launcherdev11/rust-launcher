use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

pub const PLUGIN_API_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiConfig {
    #[serde(default)]
    pub sidebar: bool,
    #[serde(default)]
    pub sidebar_label: Option<String>,
    #[serde(default)]
    pub sidebar_order: Option<i32>,
    #[serde(default)]
    pub settings_section: bool,
}

impl Default for PluginUiConfig {
    fn default() -> Self {
        Self {
            sidebar: false,
            sidebar_label: None,
            sidebar_order: None,
            settings_section: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PluginDefaults {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub config: Value,
}

fn default_enabled() -> bool {
    true
}

impl Default for PluginDefaults {
    fn default() -> Self {
        Self {
            enabled: true,
            config: Value::Object(Default::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PluginManifest {
    pub api_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub min_launcher_version: Option<String>,
    #[serde(default)]
    pub entry: Option<String>,
    #[serde(default)]
    pub hooks: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub ui: PluginUiConfig,
    #[serde(default)]
    pub defaults: PluginDefaults,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PluginStateEntry {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PluginsStateFile {
    #[serde(default = "default_format_version")]
    pub format_version: u32,
    #[serde(default)]
    pub plugins: HashMap<String, PluginStateEntry>,
}

fn default_format_version() -> u32 {
    1
}

impl Default for PluginsStateFile {
    fn default() -> Self {
        Self {
            format_version: 1,
            plugins: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PreLaunchHookFile {
    #[serde(default)]
    pub jvm_args_append: Vec<String>,
    #[serde(default)]
    pub game_args_append: Vec<String>,
    #[serde(default)]
    pub profile_filter: Option<Vec<String>>,
    #[serde(default)]
    pub version_filter: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PluginLaunchOverrides {
    #[serde(default)]
    pub jvm_args_append: Vec<String>,
    #[serde(default)]
    pub game_args_append: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub homepage: Option<String>,
    pub enabled: bool,
    pub has_entry: bool,
    pub entry: Option<String>,
    pub hooks: Vec<String>,
    pub permissions: Vec<String>,
    pub ui: PluginUiConfig,
    pub config: Value,
    pub path: String,
    pub has_icon: bool,
    pub load_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreLaunchEventPayload {
    pub profile_id: Option<String>,
    pub version_id: String,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostLaunchEventPayload {
    pub profile_id: Option<String>,
    pub version_id: String,
    pub pid: u32,
}
