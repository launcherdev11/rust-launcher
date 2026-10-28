use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::app::paths::{instance_config_path, instance_dir};
use crate::services::game::launcher::version_supports_quick_play;
use crate::services::game::profiles::read_instance_config;
use crate::services::game::worlds::nbt::{self, Tag};

pub(crate) const QUICK_PLAY_DIR: &str = "quickPlay";
pub(crate) const QUICK_PLAY_LOG: &str = "mc16-log.json";

#[derive(Debug, Clone, Serialize)]
pub struct ContinueTarget {
    pub kind: &'static str,
    pub id: String,
    pub name: String,
    pub last_played: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct QuickPlayEntry {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(rename = "lastPlayedTime", default, skip_serializing_if = "Option::is_none")]
    pub last_played_time: Option<String>,
    #[serde(default = "default_game_mode")]
    pub gamemode: String,
}

fn default_game_mode() -> String {
    "survival".to_string()
}

pub(crate) fn quick_play_log_path(game_dir: &Path) -> PathBuf {
    game_dir.join(QUICK_PLAY_DIR).join(QUICK_PLAY_LOG)
}

pub(crate) fn record_server_join(game_dir: &Path, address: &str) {
    let entry = QuickPlayEntry {
        kind: "multiplayer".to_string(),
        id: address.to_string(),
        name: address.to_string(),
        last_played_time: None,
        gamemode: default_game_mode(),
    };
    let path = quick_play_log_path(game_dir);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_vec(&[entry]) {
        let _ = crate::infra::fs_atomic::write_atomic(&path, &json);
    }
}

fn mtime_secs(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

fn read_quick_play_log(game_dir: &Path) -> Option<(QuickPlayEntry, Option<u64>)> {
    let path = quick_play_log_path(game_dir);
    let text = std::fs::read_to_string(&path).ok()?;
    let entries: Vec<QuickPlayEntry> = serde_json::from_str(&text).ok()?;
    let entry = entries
        .into_iter()
        .filter(|e| !e.id.trim().is_empty())
        .max_by(|a, b| a.last_played_time.cmp(&b.last_played_time))?;
    Some((entry, mtime_secs(&path)))
}

fn world_display_name(world_dir: &Path) -> Option<String> {
    let level = nbt::read_gzip_file(&world_dir.join("level.dat")).ok()?;
    level
        .path(&["Data", "LevelName"])
        .and_then(Tag::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn latest_world(saves: &Path) -> Option<(String, u64)> {
    std::fs::read_dir(saves)
        .ok()?
        .flatten()
        .filter(|e| e.path().join("level.dat").is_file())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let path = e.path();
            let played = mtime_secs(&path.join("level.dat"))
                .or_else(|| mtime_secs(&path.join("session.lock")))?;
            Some((name, played))
        })
        .max_by_key(|(_, played)| *played)
}

fn world_target(saves: &Path, folder: &str, last_played: Option<u64>) -> Option<ContinueTarget> {
    let dir = saves.join(folder);
    if !dir.join("level.dat").is_file() {
        return None;
    }
    Some(ContinueTarget {
        kind: "world",
        id: folder.to_string(),
        name: world_display_name(&dir).unwrap_or_else(|| folder.to_string()),
        last_played,
    })
}

fn resolve_continue_target(game_dir: &Path, game_version: &str) -> Option<ContinueTarget> {
    let can_open_world = version_supports_quick_play(game_version, game_version);
    let saves = game_dir.join("saves");
    let world = if can_open_world { latest_world(&saves) } else { None };
    let logged = read_quick_play_log(game_dir);

    let server = logged.as_ref().and_then(|(entry, logged_at)| {
        (entry.kind == "multiplayer").then(|| ContinueTarget {
            kind: "server",
            id: entry.id.trim().to_string(),
            name: if entry.name.trim().is_empty() {
                entry.id.trim().to_string()
            } else {
                entry.name.trim().to_string()
            },
            last_played: *logged_at,
        })
    });

    match (world, server) {
        (Some((folder, played)), Some(server)) => {
            if server.last_played.unwrap_or(0) >= played {
                Some(server)
            } else {
                world_target(&saves, &folder, Some(played))
            }
        }
        (Some((folder, played)), None) => world_target(&saves, &folder, Some(played)),
        (None, server) => server,
    }
}

#[command]
pub async fn get_profile_continue_target(profile_id: String) -> Result<Option<ContinueTarget>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let game_dir = instance_dir(&profile_id)?;
        let cfg = read_instance_config(&instance_config_path(&profile_id)?)?;
        Ok(resolve_continue_target(&game_dir, &cfg.game_version))
    })
    .await
    .map_err(|e| format!("Не удалось определить последний мир: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mc16-continue-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_game_quick_play_log() {
        let dir = temp_dir("log");
        std::fs::create_dir_all(dir.join(QUICK_PLAY_DIR)).unwrap();
        std::fs::write(
            quick_play_log_path(&dir),
            r#"[{"type":"multiplayer","id":"mc.example.org","name":"Example","lastPlayedTime":"2026-10-01T10:00:00Z","gamemode":"survival"}]"#,
        )
        .unwrap();
        let target = resolve_continue_target(&dir, "1.20.1").expect("target");
        assert_eq!(target.kind, "server");
        assert_eq!(target.id, "mc.example.org");
        assert_eq!(target.name, "Example");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn recorded_join_is_readable() {
        let dir = temp_dir("record");
        record_server_join(&dir, "play.example.net:25570");
        let target = resolve_continue_target(&dir, "1.12.2").expect("target");
        assert_eq!(target.kind, "server");
        assert_eq!(target.id, "play.example.net:25570");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn worlds_need_quick_play_support() {
        let dir = temp_dir("world");
        let world = dir.join("saves").join("My World");
        std::fs::create_dir_all(&world).unwrap();
        std::fs::write(world.join("level.dat"), b"not nbt").unwrap();
        assert!(resolve_continue_target(&dir, "1.16.5").is_none());
        let target = resolve_continue_target(&dir, "1.21.1").expect("target");
        assert_eq!(target.kind, "world");
        assert_eq!(target.id, "My World");
        assert_eq!(target.name, "My World");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
