use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use tauri::command;

use crate::app::paths::instance_dir;
use crate::services::game::profiles::profile_item_display_name;

pub(crate) const SNAPSHOTS_DIR: &str = ".update-snapshots";
const FILES_DIR: &str = "files";
const META_NAME: &str = "snapshot.json";
const KEEP_PER_PROFILE: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotEntry {
    old_name: String,
    new_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMeta {
    id: String,
    category: String,
    created_at: u64,
    entries: Vec<SnapshotEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSnapshotItem {
    pub old_name: String,
    pub new_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSnapshotInfo {
    pub id: String,
    pub category: String,
    pub created_at: u64,
    pub items: Vec<ContentSnapshotItem>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn snapshots_root(profile_id: &str) -> Result<PathBuf, String> {
    Ok(instance_dir(profile_id)?.join(SNAPSHOTS_DIR))
}

fn snapshot_dir(profile_id: &str, snapshot_id: &str) -> Result<PathBuf, String> {
    if snapshot_id.is_empty()
        || !snapshot_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Некорректный идентификатор снимка".into());
    }
    Ok(snapshots_root(profile_id)?.join(snapshot_id))
}

fn read_meta(dir: &Path) -> Option<SnapshotMeta> {
    let text = std::fs::read_to_string(dir.join(META_NAME)).ok()?;
    serde_json::from_str(&text).ok()
}

fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map_err(|e| format!("Не удалось скопировать {}: {e}", from.display()))?;
    std::fs::remove_file(from)
        .map_err(|e| format!("Не удалось удалить {}: {e}", from.display()))
}

fn restore_entries(
    snap_dir: &Path,
    content_dir: &Path,
    entries: &[SnapshotEntry],
) -> Result<u32, String> {
    let files = snap_dir.join(FILES_DIR);
    let mut restored = 0u32;
    let mut first_err: Option<String> = None;

    for entry in entries {
        let src = files.join(&entry.old_name);
        if !src.is_file() {
            continue;
        }
        if let Some(new_name) = entry.new_name.as_deref() {
            if new_name != entry.old_name {
                let current = content_dir.join(new_name);
                if current.is_file() {
                    let _ = std::fs::remove_file(&current);
                }
            }
        }
        let dst = content_dir.join(&entry.old_name);
        if dst.is_file() {
            let _ = std::fs::remove_file(&dst);
        }
        match move_file(&src, &dst) {
            Ok(()) => restored += 1,
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
        }
    }

    match first_err {
        Some(e) => Err(e),
        None => Ok(restored),
    }
}

fn prune(root: &Path) {
    let Ok(rd) = std::fs::read_dir(root) else {
        return;
    };
    let mut all: Vec<(u64, PathBuf)> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let path = e.path();
            let created = read_meta(&path).map(|m| m.created_at).unwrap_or(0);
            (created, path)
        })
        .collect();
    all.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in all.into_iter().skip(KEEP_PER_PROFILE) {
        let _ = std::fs::remove_dir_all(path);
    }
}

pub(crate) struct UpdateSnapshot {
    root: PathBuf,
    dir: PathBuf,
    content_dir: PathBuf,
    meta: Mutex<SnapshotMeta>,
}

impl UpdateSnapshot {
    pub(crate) fn begin(
        profile_id: &str,
        category: &str,
        content_dir: &Path,
    ) -> Result<Self, String> {
        let created_at = now_secs();
        let suffix: String = rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(5)
            .map(char::from)
            .collect();
        let id = format!("{created_at}_{suffix}");
        let root = snapshots_root(profile_id)?;
        Ok(Self {
            dir: root.join(&id),
            root,
            content_dir: content_dir.to_path_buf(),
            meta: Mutex::new(SnapshotMeta {
                id,
                category: category.to_string(),
                created_at,
                entries: Vec::new(),
            }),
        })
    }

    fn record(&self, old_name: String, new_name: Option<String>) {
        let mut meta = self.meta.lock().unwrap_or_else(|e| e.into_inner());
        meta.entries.push(SnapshotEntry { old_name, new_name });
    }

    fn stash(&self, path: &Path, new_name: Option<&str>, keep_original: bool) -> bool {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            return false;
        };
        let files = self.dir.join(FILES_DIR);
        if std::fs::create_dir_all(&files).is_err() {
            return false;
        }
        let target = files.join(name);
        let ok = if keep_original {
            std::fs::copy(path, &target).is_ok()
        } else {
            move_file(path, &target).is_ok()
        };
        if ok {
            self.record(name.to_string(), new_name.map(str::to_string));
        }
        ok
    }

    pub(crate) fn stash_copy(&self, path: &Path, new_name: &str) -> bool {
        self.stash(path, Some(new_name), true)
    }

    pub(crate) fn stash_move(&self, path: &Path, new_name: Option<&str>) {
        if !self.stash(path, new_name, false) {
            let _ = std::fs::remove_file(path);
        }
    }

    pub(crate) fn finish(self) {
        let meta = self.meta.into_inner().unwrap_or_else(|e| e.into_inner());
        if meta.entries.is_empty() {
            let _ = std::fs::remove_dir_all(&self.dir);
            return;
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(&meta) {
            let _ = std::fs::write(self.dir.join(META_NAME), bytes);
        }
        prune(&self.root);
    }

    pub(crate) fn rollback(self) {
        let meta = self.meta.into_inner().unwrap_or_else(|e| e.into_inner());
        if meta.entries.is_empty() {
            let _ = std::fs::remove_dir_all(&self.dir);
            return;
        }
        if restore_entries(&self.dir, &self.content_dir, &meta.entries).is_ok() {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}

#[command]
pub fn list_content_snapshots(profile_id: String) -> Result<Vec<ContentSnapshotInfo>, String> {
    let root = snapshots_root(&profile_id)?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut list = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|e| format!("Ошибка чтения снимков: {e}"))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(meta) = read_meta(&path) else {
            continue;
        };
        let items = meta
            .entries
            .iter()
            .map(|e| ContentSnapshotItem {
                old_name: profile_item_display_name(&e.old_name),
                new_name: e.new_name.as_deref().map(profile_item_display_name),
            })
            .collect();
        list.push(ContentSnapshotInfo {
            id: meta.id,
            category: meta.category,
            created_at: meta.created_at,
            items,
        });
    }
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    Ok(list)
}

#[command]
pub fn restore_content_snapshot(profile_id: String, snapshot_id: String) -> Result<u32, String> {
    let dir = snapshot_dir(&profile_id, &snapshot_id)?;
    let meta = read_meta(&dir).ok_or_else(|| "Снимок не найден".to_string())?;
    let subdir = match meta.category.as_str() {
        "mods" | "resourcepacks" | "shaderpacks" => meta.category.as_str(),
        _ => return Err("Неизвестная категория снимка".into()),
    };
    let content_dir = instance_dir(&profile_id)?.join(subdir);
    std::fs::create_dir_all(&content_dir)
        .map_err(|e| format!("Не удалось создать папку '{subdir}': {e}"))?;
    let restored = restore_entries(&dir, &content_dir, &meta.entries)?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "16launcher-snap-{tag}-{}-{}",
            std::process::id(),
            now_secs()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn snapshot_for(root: &Path, content: &Path) -> UpdateSnapshot {
        UpdateSnapshot {
            root: root.to_path_buf(),
            dir: root.join("snap"),
            content_dir: content.to_path_buf(),
            meta: Mutex::new(SnapshotMeta {
                id: "snap".into(),
                category: "mods".into(),
                created_at: 1,
                entries: Vec::new(),
            }),
        }
    }

    #[test]
    fn rollback_restores_renamed_and_overwritten_files() {
        let base = scratch_dir("rollback");
        let content = base.join("mods");
        std::fs::create_dir_all(&content).unwrap();

        std::fs::write(content.join("a-1.jar"), b"a-old").unwrap();
        std::fs::write(content.join("b.jar"), b"b-old").unwrap();

        let snap = snapshot_for(&base, &content);

        std::fs::write(content.join("a-2.jar"), b"a-new").unwrap();
        snap.stash_move(&content.join("a-1.jar"), Some("a-2.jar"));

        assert!(snap.stash_copy(&content.join("b.jar"), "b.jar"));
        std::fs::write(content.join("b.jar"), b"b-new").unwrap();

        snap.rollback();

        assert_eq!(std::fs::read(content.join("a-1.jar")).unwrap(), b"a-old");
        assert!(!content.join("a-2.jar").exists());
        assert_eq!(std::fs::read(content.join("b.jar")).unwrap(), b"b-old");
        assert!(!base.join("snap").exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn finish_without_entries_leaves_nothing_behind() {
        let base = scratch_dir("empty");
        let content = base.join("mods");
        std::fs::create_dir_all(&content).unwrap();

        snapshot_for(&base, &content).finish();

        assert!(!base.join("snap").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn prune_keeps_only_the_newest_snapshots() {
        let base = scratch_dir("prune");
        for i in 0..(KEEP_PER_PROFILE as u64 + 2) {
            let dir = base.join(format!("s{i}"));
            std::fs::create_dir_all(&dir).unwrap();
            let meta = SnapshotMeta {
                id: format!("s{i}"),
                category: "mods".into(),
                created_at: 100 + i,
                entries: Vec::new(),
            };
            std::fs::write(dir.join(META_NAME), serde_json::to_vec(&meta).unwrap()).unwrap();
        }

        prune(&base);

        assert!(!base.join("s0").exists());
        assert!(!base.join("s1").exists());
        assert!(base.join("s2").exists());
        assert!(base.join(format!("s{}", KEEP_PER_PROFILE + 1)).exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
