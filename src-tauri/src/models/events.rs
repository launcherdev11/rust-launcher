use serde::Serialize;

pub const EVENT_DOWNLOAD_PROGRESS: &str = "download-progress";
pub const EVENT_GAME_CONSOLE_LINE: &str = "game-console-line";
pub const EVENT_MRPACK_IMPORT_PROGRESS: &str = "mrpack-import-progress";
pub const EVENT_PLAYTIME_UPDATED: &str = "playtime-updated";

#[derive(Debug, Serialize, Clone)]
pub struct MrpackImportProgressPayload {
    pub phase: String,
    pub current: Option<u32>,
    pub total: Option<u32>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GameConsoleLinePayload {
    pub line: String,
    pub source: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlaytimeUpdatedPayload {
    pub profile_id: String,
    pub delta_seconds: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgressPayload {
    pub version_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f32,
}
