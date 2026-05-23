use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    #[serde(default)]
    pub game_directory: Option<String>,
    pub ram_mb: u32,
    pub show_console_on_launch: bool,
    pub close_launcher_on_game_start: bool,
    pub check_game_processes: bool,

    pub resolution_width: Option<u32>,
    pub resolution_height: Option<u32>,

    pub show_snapshots: bool,
    pub show_alpha_versions: bool,
    #[serde(default)]
    pub forge_ipv6_download: bool,
    #[serde(default = "default_forge_proxy_fallback_enabled")]
    pub forge_proxy_fallback: bool,

    pub notify_new_update: bool,
    pub notify_new_message: bool,
    pub notify_system_message: bool,

    pub check_updates_on_start: bool,
    pub auto_install_updates: bool,

    pub open_launcher_on_profiles_tab: bool,

    #[serde(default = "default_ui_sounds_enabled")]
    pub ui_sounds_enabled: bool,

    #[serde(default = "default_interface_language")]
    pub interface_language: String,

    pub background_accent_color: String,
    pub background_image_url: Option<String>,

    #[serde(default = "default_background_blur_enabled")]
    pub background_blur_enabled: bool,

    #[serde(default)]
    pub split_view_enabled: bool,

    #[serde(default)]
    pub onboarding_completed: bool,
}

pub fn default_interface_language() -> String {
    "ru".to_string()
}

pub fn default_background_blur_enabled() -> bool {
    true
}

pub fn default_forge_proxy_fallback_enabled() -> bool {
    true
}

pub fn default_ui_sounds_enabled() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            game_directory: None,
            ram_mb: 4096,
            show_console_on_launch: false,
            close_launcher_on_game_start: false,
            check_game_processes: true,
            resolution_width: None,
            resolution_height: None,
            show_snapshots: false,
            show_alpha_versions: false,
            forge_ipv6_download: false,
            forge_proxy_fallback: true,
            notify_new_update: true,
            notify_new_message: true,
            notify_system_message: true,
            check_updates_on_start: true,
            auto_install_updates: false,
            open_launcher_on_profiles_tab: false,
            ui_sounds_enabled: true,
            interface_language: "ru".to_string(),
            background_accent_color: "#0b1530".to_string(),
            background_image_url: None,
            background_blur_enabled: true,
            split_view_enabled: false,
            onboarding_completed: false,
        }
    }
}

